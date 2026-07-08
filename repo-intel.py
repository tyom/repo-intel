#!/usr/bin/env python3
"""repo-intel — generate a contributor stats dashboard for a git repo."""

# The git tag is the single source of truth for the version. build.py bakes the
# tag into the released artifact (from $REPO_INTEL_VERSION); a raw source
# checkout falls back to `git describe` against this file's own directory (see
# resolve_version). The committed dist/repo-intel keeps this "0.0.0-dev"
# sentinel so `make build` stays byte-for-byte reproducible — CI gates that —
# while the released asset carries the real version.
VERSION = "0.0.0-dev"

HELP = """\
repo-intel — generate a contributor stats dashboard for a git repo.

Usage:
  repo-intel [N] [REPO] [-o PATH] [--format LIST] [--no-open] [--clone] [-n]
  repo-intel -h | --help
  repo-intel -v | --version

Arguments:
  N       Number of top contributors to include (default: 10)
  REPO    A GitHub repository, in any of these forms:
            owner/repo
            https://github.com/owner/repo
            remote:owner/repo
          When omitted, the current working directory is used as a local git repo.

Options:
  -o, --output PATH   Write output to PATH instead of /tmp/<owner>--<repo>.<ext>.
                      With a single --format, PATH is used verbatim. With several,
                      PATH is a stem and each format appends its own extension
                      (-o ./stats → stats.html, stats.json, stats.md).
  --format LIST       Comma-separated output formats (repeatable): html, json, md.
                      Default: html. JSON is the raw data; md is a report for
                      reading or feeding to an LLM. e.g. --format html,json,md.
  --no-open           Don't open the result in a browser.
  --no-cache          Ignore the local cache and re-fetch all commits.
  --clone             For a remote REPO, analyse a bare `git clone` instead of
                      the GitHub GraphQL API (alias: --bare). Slower to fetch
                      but unlocks per-author language churn the API can't give.
  --commits SPEC      Filter commits by position. SPEC is either N (last N
                      commits, newest) or A-B (positions [A, B), 0-indexed
                      from oldest, half-open like Python slicing).
  --since DATE        Only include commits on or after DATE (YYYY-MM-DD, inclusive).
  --until DATE        Only include commits on or before DATE (YYYY-MM-DD, inclusive).
  --max-prs N         Max merged PRs to fetch for stats/timeline (default: 1000).
  --max-issues N      Max closed issues to fetch for stats/timeline (default: 1000).
  --lanes N           Max stacked rows in the timeline's PR and issue strips
                      (default: 10).
  -n, --non-interactive
                      Skip interactive prompts (clone suggestion, commit-subset
                      choice) and take the defaults.
  -h, --help          Show this help message and exit.
  -v, --version       Show the version and exit.

Examples:
  repo-intel                       # local repo (cwd), top 10
  repo-intel 20                    # local repo, top 20
  repo-intel facebook/react        # remote, top 10
  repo-intel 15 facebook/react     # remote, top 15
  repo-intel -o ./stats.html       # write to a specific path
  repo-intel --no-open             # generate without launching browser
  repo-intel facebook/react --clone  # analyse via bare clone, not the API
  repo-intel --commits 100         # only the last 100 commits
  repo-intel --commits 0-100       # the first 100 commits
  repo-intel --commits 400-800     # commits at positions 400..799 (oldest-first)
  repo-intel --since 2024-01-01    # commits since 2024-01-01
  repo-intel --since 2024-01-01 --until 2024-06-30  # H1 2024
  repo-intel --format json,md facebook/react  # JSON + Markdown, no HTML

Remote auth:
  The GitHub CLI (`gh`, https://cli.github.com/) is optional but
  recommended — when authenticated it unlocks GraphQL remote fetching
  and author hovercard enrichment (avatar, bio, follower counts).
  Lookup order: `gh auth token -h github.com`, then $GITHUB_TOKEN.
  Falls back to `git clone --bare` into /tmp if neither is available;
  pass --clone to force that bare-clone path even when a token is present.

Output:
  /tmp/<owner>--<repo>.<ext> per --format (or --output PATH). Falls back to
  /tmp/<repo>.<ext> for local repos without a github.com origin. Only the HTML
  artifact is opened in the default browser, and only unless --no-open is given.

Cache:
  Remote commit nodes are cached under
  $XDG_CACHE_HOME/repo-intel (default ~/.cache/repo-intel) as one JSON
  file per repo. Re-runs only fetch new commits.
"""

import contextlib
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

TEMPLATE = "__TEMPLATE_PLACEHOLDER__"
PLACEHOLDER = "/*__DATA_INJECTION__*/"
NOREPLY_RE = re.compile(r"(?:\d+\+)?(.+)@users\.noreply\.github\.com")
ORIGIN_RE = re.compile(
    r"^(?:https?://(?P<https_host>[^/]+)/|git@(?P<ssh_host>[^:]+):)"
    r"(?P<owner>[^/]+)/(?P<repo>.+?)(?:\.git)?/?$"
)
CACHE_DIR = Path(os.environ.get("XDG_CACHE_HOME") or (Path.home() / ".cache")) / "repo-intel"
# Newest merged PRs / closed issues fetched for timeline markers (100 per
# GraphQL page); defaults for --max-prs / --max-issues.
MAX_PULL_REQUESTS = 1000
MAX_ISSUES = 1000
# Default for --lanes: stacked rows in the timeline's PR/issue strips.
DEFAULT_LANES = 10


def parse_iso_instant(s):
    """Parse an ISO 8601 timestamp to a UTC-aware datetime; epoch on failure.

    Tags mix `Z`-suffixed UTC (GraphQL) with offset-suffixed local time
    (`git for-each-ref iso8601-strict`), so lex-sorting can misorder them.
    """
    if not s:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _slugify(s):
    return re.sub(r"[^\w.-]+", "-", s).strip("-")


def cache_path(slug):
    safe = _slugify(slug.lower()) or "repo"
    return CACHE_DIR / f"{safe}.json"


def load_cache(slug):
    p = cache_path(slug)
    if not p.exists():
        return [], False
    try:
        data = json.loads(p.read_text())
        # v2 nodes carry parents.totalCount (merge detection); older caches
        # lack it and would count merges as authored commits — refetch.
        if data.get("v") != 2:
            return [], False
        return data.get("nodes", []), bool(data.get("complete", False))
    except (json.JSONDecodeError, OSError):
        return [], False


def save_cache(slug, nodes, complete):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path(slug).write_text(json.dumps({"v": 2, "nodes": nodes, "complete": complete}))


def needs_older_fetch(have_count, cached_oldest_date, prev_complete, commits_filter, since, until):
    """Should we paginate below the oldest cached commit after top-fetch?

    have_count: len(new_nodes) + len(cached_nodes) after the top-fetch.
    cached_oldest_date: YYYY-MM-DD of the oldest cached commit, "" if empty.
    """
    if prev_complete:
        return False
    if not cached_oldest_date:
        return False
    if until:
        return True
    if commits_filter:
        if commits_filter[0] == "last":
            return have_count < commits_filter[1]
        return True  # range — slice is anchored at oldest, must walk full history
    if since:
        return cached_oldest_date > since
    return True


def parse_commits_spec(val):
    if re.fullmatch(r"\d+", val):
        n = int(val)
        if n <= 0:
            raise ValueError("--commits N requires a positive integer")
        return ("last", n)
    m = re.fullmatch(r"(\d+)-(\d+)", val)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        if a >= b:
            raise ValueError(f"--commits A-B requires A < B (got {a}-{b})")
        return ("range", a, b)
    raise ValueError(f"--commits must be N or A-B (got {val!r})")


def parse_date(val, flag):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", val):
        raise ValueError(f"{flag} requires YYYY-MM-DD (got {val!r})")
    return val


VALID_FORMATS = ("html", "json", "md")


def parse_formats(val, acc):
    """Merge a comma-separated --format value into acc, order-preserving + deduped."""
    for raw in val.split(","):
        name = raw.strip().lower()
        if not name:
            continue
        if name not in VALID_FORMATS:
            raise ValueError(f"--format must be one of {', '.join(VALID_FORMATS)} (got {name!r})")
        if name not in acc:
            acc.append(name)
    return acc


def resolve_version():
    # Released builds carry the tag baked in by build.py. A raw source checkout
    # has the sentinel, so derive from the git tag (the source of truth) using
    # this file's own directory — cwd is the repo being analysed, not ours.
    if VERSION != "0.0.0-dev":
        return VERSION
    try:
        out = subprocess.run(
            ["git", "describe", "--tags", "--always", "--dirty"],
            cwd=Path(__file__).resolve().parent,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        return out or VERSION
    except (OSError, subprocess.CalledProcessError):
        return VERSION


def parse_args(argv):
    if any(tok in ("-h", "--help") for tok in argv):
        sys.stdout.write(HELP)
        sys.exit(0)
    if any(tok in ("-v", "--version") for tok in argv):
        sys.stdout.write(f"repo-intel {resolve_version()}\n")
        sys.exit(0)
    top_n, remote, output, no_open, no_cache = 10, None, None, False, False
    clone, non_interactive = False, False
    commits_filter, since, until = None, None, None
    max_prs, max_issues, lanes = MAX_PULL_REQUESTS, MAX_ISSUES, DEFAULT_LANES
    formats = []
    i = 0

    def parse_positive(val, name):
        # Cap keeps runaway values (thousands of GraphQL pages, absurd lane
        # counts) from ever reaching the fetchers or the renderer.
        if not val.isdigit() or not 0 < int(val) <= 100_000:
            raise ValueError(f"{name} requires a positive integer up to 100000 (got {val!r})")
        return int(val)

    def take_value(name):
        tok = argv[i]
        if tok == name:
            if i + 1 >= len(argv):
                sys.stderr.write(f"repo-intel: {name} requires a value\n")
                sys.exit(2)
            return argv[i + 1], 2
        if tok.startswith(name + "="):
            return tok[len(name) + 1 :], 1
        return None, 0

    while i < len(argv):
        tok = argv[i]
        try:
            if tok == "--no-open":
                no_open = True
                i += 1
                continue
            if tok == "--no-cache":
                no_cache = True
                i += 1
                continue
            if tok in ("--clone", "--bare"):
                clone = True
                i += 1
                continue
            if tok in ("-n", "--non-interactive"):
                non_interactive = True
                i += 1
                continue
            if tok == "-o":
                if i + 1 >= len(argv):
                    sys.stderr.write("repo-intel: -o requires a value\n")
                    sys.exit(2)
                output = argv[i + 1]
                i += 2
                continue
            val, step = take_value("--output")
            if step:
                output = val
                i += step
                continue
            val, step = take_value("--commits")
            if step:
                commits_filter = parse_commits_spec(val)
                i += step
                continue
            val, step = take_value("--since")
            if step:
                since = parse_date(val, "--since")
                i += step
                continue
            val, step = take_value("--until")
            if step:
                until = parse_date(val, "--until")
                i += step
                continue
            val, step = take_value("--format")
            if step:
                parse_formats(val, formats)
                i += step
                continue
            val, step = take_value("--max-prs")
            if step:
                max_prs = parse_positive(val, "--max-prs")
                i += step
                continue
            val, step = take_value("--max-issues")
            if step:
                max_issues = parse_positive(val, "--max-issues")
                i += step
                continue
            val, step = take_value("--lanes")
            if step:
                lanes = parse_positive(val, "--lanes")
                i += step
                continue
        except ValueError as exc:
            sys.stderr.write(f"repo-intel: {exc}\n")
            sys.exit(2)
        if tok.isdigit():
            n = int(tok)
            if n <= 0:
                sys.stderr.write(f"repo-intel: N must be a positive integer (got {tok!r})\n")
                sys.exit(2)
            top_n = n
            i += 1
            continue
        t = tok.removeprefix("remote:")
        t = t.removeprefix("https://github.com/").removeprefix("http://github.com/")
        parts = t.rstrip("/").split("/")
        if (
            len(parts) >= 2
            and re.fullmatch(r"[\w.-]+", parts[0])
            and re.fullmatch(r"[\w.-]+", parts[1])
        ):
            remote = f"{parts[0]}/{parts[1]}"
            i += 1
            continue
        sys.stderr.write(f"repo-intel: unrecognized argument: {tok!r}\n")
        sys.stderr.write("Try 'repo-intel --help' for usage.\n")
        sys.exit(2)
    if since and until and since > until:
        sys.stderr.write(f"repo-intel: --since {since} is after --until {until}\n")
        sys.exit(2)
    if not formats:
        formats = ["html"]
    return (
        top_n,
        remote,
        output,
        no_open,
        no_cache,
        clone,
        commits_filter,
        since,
        until,
        formats,
        max_prs,
        max_issues,
        lanes,
        non_interactive,
    )


def login_from_email(email):
    m = NOREPLY_RE.fullmatch(email or "")
    return m.group(1) if m else ""


def avatar_url(email, override=None):
    if override:
        return override
    login = login_from_email(email)
    if login:
        return f"https://github.com/{login}.png?size=64"
    h = hashlib.md5(email.strip().lower().encode()).hexdigest()
    return f"https://www.gravatar.com/avatar/{h}?d=mp&s=64"


def iso_week_label(dt):
    y, w, _ = dt.isocalendar()
    return f"{y}-W{w:02d}"


# Language + framework detection data, generated from GitHub Linguist and a
# curated framework map by gen_techdata.py (see `make repo-intel-techdata`).
# build.py inlines the JSON here; when unbuilt we read the sibling file. Used
# only on the local + bare-clone paths — the GraphQL remote path lacks per-file
# data, so these maps go unused there.
TECHDATA = "__TECHDATA_PLACEHOLDER__"
OTHER_LANG = "Other"
OTHER_COLOR = "#8b949e"


def _load_techdata():
    raw = TECHDATA
    if raw == "__TECHDATA_PLACEHOLDER__":
        sibling = Path(__file__).resolve().parent / "techdata.json"
        if not sibling.exists():
            return {}
        try:
            return json.loads(sibling.read_text())
        except (json.JSONDecodeError, OSError):
            return {}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return {}


_TECH = _load_techdata()
_LANG = _TECH.get("lang", {})
EXT_LANG = _LANG.get("ext", {})  # extension (no dot, lower) -> language
FILENAME_LANG = _LANG.get("filename", {})  # lowercased filename -> language
NAME_COLOR = _LANG.get("color", {})  # language -> hex color
FW_DEPS = _TECH.get("fw_deps", {})  # {ecosystem: {dependency: framework}}
FW_SENTINELS_JS = _TECH.get("fw_sentinels_js", [])  # [[basename, framework]]
FW_SENTINELS_OTHER = _TECH.get("fw_sentinels_other", [])  # [[path, framework, lang]]


def _compile_vendor(patterns):
    """One matcher from Linguist's vendor.yml/documentation.yml regexes; skips
    Python-incompatible ones (they're Ruby-flavored) so the union still compiles."""
    good = []
    for p in patterns:
        try:
            re.compile(p)
            good.append(p)
        except re.error:
            continue
    try:
        return re.compile("|".join(f"(?:{p})" for p in good)) if good else None
    except re.error:
        return None


# Linguist excludes both vendored and documentation paths from language stats;
# match its behavior so the bar agrees with GitHub's (e.g. `docs/`, READMEs).
_VENDOR_RE = _compile_vendor(_TECH.get("vendor", []) + _TECH.get("documentation", []))

# Lockfiles Linguist classifies as *generated* (handled in code, not vendor.yml)
# — kept as a small supplement so they don't dominate the language bar.
NOISE_BASENAMES = frozenset(
    {
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "npm-shrinkwrap.json",
        "composer.lock",
        "cargo.lock",
        "gemfile.lock",
        "poetry.lock",
        "go.sum",
        "pdm.lock",
        "uv.lock",
        "flake.lock",
    }
)

# Shebang interpreter → language, for extensionless scripts Linguist can't name
# from a path alone (e.g. `bin/deploy` with `#!/usr/bin/env bash`). A small
# curated map mirroring Linguist's `interpreters:`; trailing version digits are
# stripped (`python3` → `python`) before lookup. Names must be real Linguist
# languages so they pick up a color.
SHEBANG_LANG = {
    "sh": "Shell",
    "bash": "Shell",
    "zsh": "Shell",
    "dash": "Shell",
    "ksh": "Shell",
    "fish": "fish",
    "python": "Python",
    "ruby": "Ruby",
    "node": "JavaScript",
    "perl": "Perl",
    "awk": "Awk",
    "gawk": "Awk",
    "lua": "Lua",
    "php": "PHP",
    "rscript": "R",
    "tclsh": "Tcl",
    "groovy": "Groovy",
    "osascript": "AppleScript",
}


def shebang_lang(first_line):
    """Language for a `#!…` first line, or None. Resolves `env interp` and pins
    `python3`→Python by stripping trailing version digits from the interpreter."""
    if not first_line.startswith("#!"):
        return None
    interp = None
    for tok in first_line[2:].split():
        name = tok.rsplit("/", 1)[-1]
        if name != "env":  # skip the `env` in `#!/usr/bin/env python3`
            interp = name
            break
    if not interp:
        return None
    interp = interp.lower()
    return SHEBANG_LANG.get(interp) or SHEBANG_LANG.get(interp.rstrip("0123456789"))


def numstat_newpath(field):
    """Resolve a numstat path column to the post-rename path.

    Renames render as `old => new`, or with a shared brace group like
    `src/{old => new}/file.js`; plain paths pass through unchanged.
    """
    if " => " not in field:
        return field
    lo = field.find("{")
    hi = field.find("}", lo) if lo != -1 else -1
    if lo != -1 and hi != -1 and " => " in field[lo:hi]:
        new = field[lo + 1 : hi].split(" => ", 1)[1]
        return field[:lo] + new + field[hi + 1 :]
    return field.split(" => ", 1)[1]


def classify_path(field, present=None, shebang=None):
    """Map a numstat path column to a language name, or None to exclude it.

    `present`: when given, the set of paths at HEAD — files absent from it
    (deleted since, or renamed away) are excluded so the bar reflects the repo
    as it stands, not churn against files that no longer exist.
    `shebang`: {path: language} for extensionless/unknown scripts a `#!` line
    identified, so they land in their real language instead of "Other".
    """
    path = numstat_newpath(field.strip().strip('"')).replace("\\", "/")
    if present is not None and path not in present:
        return None  # file no longer exists at HEAD — count only survivors
    if _VENDOR_RE and _VENDOR_RE.search(path):  # Linguist vendored/documentation paths
        return None
    base = path.rsplit("/", 1)[-1].lower()
    if base in NOISE_BASENAMES:
        return None
    if base.endswith((".min.js", ".min.css", ".map")):
        return None
    if base in FILENAME_LANG:  # Dockerfile, Makefile, Rakefile, …
        return FILENAME_LANG[base]
    # Longest dotted suffix first, so multi-part Linguist extensions like
    # "pc.in" or "blade.php" win over the bare "in"/"php" fallback.
    dot = base.find(".", 1)
    while dot > 0:
        lang = EXT_LANG.get(base[dot + 1 :])
        if lang:
            return lang
        dot = base.find(".", dot + 1)
    if shebang and path in shebang:  # extensionless/unknown but has a #! line
        return shebang[path]
    return OTHER_LANG


def top_languages(langs, limit=10):
    """Build a sorted language-bar list from {name: [added, deleted, files]}.

    Ranks by lines touched (added + deleted); languages past `limit` collapse
    into a single grey "Other" segment. Returns [] when nothing qualifies.
    """
    items = [(name, a + d, files) for name, (a, d, files) in langs.items()]
    total = sum(lines for _, lines, _ in items)
    if total <= 0:
        return []
    items.sort(key=lambda x: x[1], reverse=True)
    out = [
        {
            "name": name,
            "lines": lines,
            "files": files,
            "pct": round(lines * 100 / total, 1),
            "color": NAME_COLOR.get(name, OTHER_COLOR),
        }
        for name, lines, files in items[:limit]
    ]
    overflow = sum(lines for _, lines, _ in items[limit:])
    if overflow > 0:
        existing = next((o for o in out if o["name"] == OTHER_LANG), None)
        if existing:
            existing["lines"] += overflow
            existing["pct"] = round(existing["lines"] * 100 / total, 1)
        else:
            out.append(
                {
                    "name": OTHER_LANG,
                    "lines": overflow,
                    "files": 0,
                    "pct": round(overflow * 100 / total, 1),
                    "color": OTHER_COLOR,
                }
            )
    return out


def git(*args, cwd=None, quiet=False):
    # quiet=True hides git's stderr — for best-effort probes that are expected
    # to fail (e.g. work-tree-only commands run against a bare clone).
    return subprocess.check_output(
        ["git", *args],
        text=True,
        cwd=cwd,
        stderr=subprocess.DEVNULL if quiet else None,
    )


def _git_show(path, cwd=None):
    """Contents of `path` at HEAD, or "" if missing. Works on bare clones."""
    try:
        return git("show", f"HEAD:{path}", cwd=cwd)
    except subprocess.CalledProcessError:
        return ""


def _head_first_line(path, cwd=None):
    """First line of `path` at HEAD, decoded leniently, or "". Reads bytes so a
    stray binary doesn't crash the utf-8 decode `git(text=True)` would attempt."""
    try:
        out = subprocess.run(["git", "show", f"HEAD:{path}"], cwd=cwd, capture_output=True).stdout
    except OSError:
        return ""
    nl = out.find(b"\n")
    return (out if nl < 0 else out[:nl]).decode("utf-8", "replace")


def detect_frameworks(paths, cwd=None):
    """Detect frameworks at HEAD from a local repo / bare clone.

    `paths`: the HEAD tree (repo-relative), already listed by the caller.
    Returns a list grouped by language, ordered by framework count:
        [{"language": "TypeScript", "color": "#3178c6", "names": [...]}, ...]
    Best-effort and local-only — the GraphQL remote path skips this.
    """
    return _frameworks_from_files(paths, lambda p: _git_show(p, cwd))


def _frameworks_from_files(paths, read_file):
    """Core framework detection over a file list, driven by techdata maps.

    `paths`: repo-relative paths that exist. `read_file(path)` -> contents
    ("" if unavailable; only called for manifests worth parsing). Decoupled
    from git so the remote path can supply GraphQL-fetched blobs.
    """
    if not FW_DEPS:
        return []
    paths = set(paths)
    by_base = defaultdict(list)
    for p in paths:
        by_base[p.rsplit("/", 1)[-1].lower()].append(p)

    found = defaultdict(list)
    seen = defaultdict(set)

    def add(language, name):
        if name and name not in seen[language]:
            seen[language].add(name)
            found[language].append(name)

    def present(dep, text):
        return re.search(r"(?<![\w.-])" + re.escape(dep) + r"(?![\w.-])", text) is not None

    def gather(bases, requirements=False):
        text = ""
        for base, names in by_base.items():
            if base in bases or (
                requirements and base.startswith("requirements") and base.endswith(".txt")
            ):
                for path in names:
                    text += "\n" + read_file(path)
        return text

    # JS/TS — package.json (deps + dev/peer). Language resolves to TypeScript
    # when a tsconfig or a typescript dependency is present.
    is_ts = bool(by_base.get("tsconfig.json"))
    npm_map = FW_DEPS.get("npm", {})
    npm_hits = []
    for path in by_base.get("package.json", []):
        try:
            pkg = json.loads(read_file(path) or "{}")
        except (json.JSONDecodeError, ValueError):
            continue
        deps = {}
        for key in ("dependencies", "devDependencies", "peerDependencies"):
            d = pkg.get(key)
            if isinstance(d, dict):
                deps.update(d)
        if "typescript" in deps:
            is_ts = True
        npm_hits.extend(npm_map[dep] for dep in deps if dep in npm_map)
    js_lang = "TypeScript" if is_ts else "JavaScript"
    for fw in npm_hits:
        add(js_lang, fw)

    # Text-matched ecosystems — concatenate the relevant manifests and look for
    # dependency names. Go matches case-sensitive substrings (deps are full
    # module paths like `github.com/gin-gonic/gin`); the rest fold to lowercase
    # and match on whole words. Python also pulls in requirements*.txt.
    text_ecosystems = (
        # (language, manifest basenames, requirements*.txt?, case-sensitive substring?)
        ("Python", {"pyproject.toml", "pipfile", "setup.py", "setup.cfg"}, True, False),
        ("Ruby", {"gemfile", "gemfile.lock"}, False, False),
        ("Go", {"go.mod", "go.sum"}, False, True),
        ("Rust", {"cargo.toml"}, False, False),
    )
    for lang, bases, requirements, case_sensitive in text_ecosystems:
        text = gather(bases, requirements=requirements)
        if not case_sensitive:
            text = text.lower()
        for dep, fw in FW_DEPS.get(lang, {}).items():
            if (dep in text) if case_sensitive else present(dep, text):
                add(lang, fw)

    # PHP — composer.json require sections (JSON).
    php_map = FW_DEPS.get("PHP", {})
    for path in by_base.get("composer.json", []):
        try:
            comp = json.loads(read_file(path) or "{}")
        except (json.JSONDecodeError, ValueError):
            continue
        deps = {}
        for key in ("require", "require-dev"):
            d = comp.get(key)
            if isinstance(d, dict):
                deps.update(d)
        for dep, fw in php_map.items():
            if dep in deps:
                add("PHP", fw)

    # Sentinel files — catch frameworks no parsed manifest surfaced.
    for base, fw in FW_SENTINELS_JS:
        if base.lower() in by_base:
            add(js_lang, fw)
    for base, fw, lang in FW_SENTINELS_OTHER:
        if base.endswith("/"):  # directory-prefix sentinel (e.g. .github/workflows/)
            hit = any(p.startswith(base) for p in paths)
        elif "/" in base:  # exact sub-path
            hit = base in paths
        else:  # basename
            hit = base.lower() in by_base
        if hit:
            add(lang, fw)

    groups = []
    for lang in sorted(found, key=lambda L: (-len(found[L]), L)):
        groups.append(
            {
                "language": lang,
                "color": NAME_COLOR.get(lang, OTHER_COLOR),
                "names": found[lang][:15],
            }
        )
    return groups


def head_shebangs(present, cwd=None):
    """Shebang map for the language bar: {path: language}.

    `present`: the HEAD tree (repo-relative). Returns the subset of
    extensionless/unknown files whose `#!` line names an interpreter — peeked
    only for files `classify_path` would otherwise bucket as "Other", so the
    read stays cheap. Plumbing-only (`git show`), so it works on bare clones;
    the remote GraphQL path has no per-file data and skips this entirely.
    """
    shebang = {}
    for path in present:
        # Only extensionless files need a peek: scripts (`bin/deploy`) live here,
        # while binaries carry an extension and would just waste a read (and
        # choke a text decode). Skip anything classify_path can already name.
        if "." in path.rsplit("/", 1)[-1] or classify_path(path) != OTHER_LANG:
            continue
        lang = shebang_lang(_head_first_line(path, cwd=cwd))
        if lang:
            shebang[path] = lang
    return shebang


_CLONE_REFRESHED = set()


def ensure_bare_clone(owner, repo, no_cache):
    """Clone or fetch-update a bare repo under /tmp; idempotent within a run."""
    clone_dir = f"/tmp/repo-intel-{owner}-{repo}.git"
    if clone_dir in _CLONE_REFRESHED:
        return clone_dir
    if not os.path.isdir(clone_dir):
        # SSH first: HTTPS interactively prompts for username/password on
        # private repos, while a failed SSH attempt (no key) fails fast and
        # falls through to HTTPS.
        for url in (
            f"git@github.com:{owner}/{repo}.git",
            f"https://github.com/{owner}/{repo}.git",
        ):
            if subprocess.run(["git", "clone", "--bare", url, clone_dir]).returncode == 0:
                break
        else:
            raise SystemExit(f"git clone failed for {owner}/{repo}")
    elif not no_cache:
        print("  updating cached bare clone…", file=sys.stderr)
        subprocess.run(["git", "fetch", "--quiet", "origin"], cwd=clone_dir, check=False)
    _CLONE_REFRESHED.add(clone_dir)
    return clone_dir


def read_key(default):
    """One keypress, no Enter needed; Enter/EOF returns `default`; Ctrl-C
    aborts the run. Falls back to a line read when stdin isn't a TTY (pipes,
    tests) or termios is missing."""
    try:
        import termios
        import tty
    except ImportError:
        termios = None
    try:
        if termios is None or not sys.stdin.isatty():
            line = sys.stdin.readline()
            return (line.strip() or default) if line else default
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            tty.setcbreak(fd)
            ch = sys.stdin.read(1)
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)
    except KeyboardInterrupt:
        sys.stderr.write("\nAborted.\n")
        sys.exit(130)
    # cbreak disables ECHO — echo the keypress ourselves so the choice shows.
    if ch in ("", "\r", "\n"):
        sys.stderr.write("\n")
        return default
    sys.stderr.write(f"{ch}\n")
    return ch


def prompt_subset(total):
    """Ask which subset to fetch when a repo has many commits.

    Returns (commits_filter, since, until). All-None means "fetch all".
    """
    today = datetime.now(timezone.utc).date()
    one_year_ago = (today - timedelta(days=365)).isoformat()
    sys.stderr.write(
        f"\nRepository has {total:,} commits. Choose a subset to fetch:\n"
        f"  [1] Last 500\n"
        f"  [2] Last 1000\n"
        f"  [3] Past year (since {one_year_ago})\n"
        f"  [4] All\n"
    )
    while True:
        sys.stderr.write("Choice [4]: ")
        sys.stderr.flush()
        choice = read_key("4")
        if choice == "1":
            return ("last", 500), None, None
        if choice == "2":
            return ("last", 1000), None, None
        if choice == "3":
            return None, one_year_ago, None
        if choice == "4":
            return None, None, None
        sys.stderr.write(f"  invalid choice {choice!r}\n")


def prompt_more(cached_count, total):
    """Ask whether to extend a partial cache with more history.

    Returns (commits_filter, since, until), like prompt_subset.
    """
    sys.stderr.write(
        f"\nCache has {cached_count:,} of {total:,} commits. Fetch additional history?\n"
        f"  [1] 500 more\n"
        f"  [2] 1000 more\n"
        f"  [3] 2000 more\n"
        f"  [4] All\n"
        f"  [5] None — keep the cached {cached_count:,}\n"
    )
    while True:
        sys.stderr.write("Choice [5]: ")
        sys.stderr.flush()
        choice = read_key("5")
        more = {"1": 500, "2": 1000, "3": 2000}.get(choice)
        if more:
            return ("last", cached_count + more), None, None
        if choice == "4":
            return None, None, None
        if choice == "5":
            return ("last", cached_count), None, None
        sys.stderr.write(f"  invalid choice {choice!r}\n")


# ponytail: "not huge" cutoff for offering a clone; tune if 200 MB feels wrong
CLONE_SUGGEST_MAX_KB = 200 * 1024


def prompt_clone(disk_kb):
    """Offer the bare-clone path for richer stats. Default: no."""
    mb = disk_kb / 1024
    size = f"{mb:,.0f} MB" if mb >= 1 else f"{disk_kb} KB"
    while True:
        sys.stderr.write(
            f"\nRepository is ~{size}. Clone it for richer stats "
            f"(per-contributor languages)? [y/N]: "
        )
        sys.stderr.flush()
        choice = read_key("n").lower()
        if choice in ("y", "yes"):
            return True
        if choice in ("n", "no"):
            return False
        sys.stderr.write(f"  invalid choice {choice!r}\n")


def repo_disk_kb(cwd=None):
    """Total on-disk size of git objects (loose + packed) in KB."""
    try:
        out = git("count-objects", "-v", cwd=cwd)
    except subprocess.CalledProcessError:
        return 0
    size = size_pack = 0
    for line in out.splitlines():
        key, _, val = line.partition(":")
        try:
            n = int(val.strip())
        except ValueError:
            continue
        if key == "size":
            size = n
        elif key == "size-pack":
            size_pack = n
    return size + size_pack


def _top_with_remainder(sized, limit):
    """Shape a {path: bytes} map into the sunburst payload: the `limit` largest
    paths as items, plus the summed/counted remainder. Returns None when empty
    so the web hides the chart rather than drawing an empty ring."""
    if not sized:
        return None
    ranked = sorted(sized.items(), key=lambda kv: kv[1], reverse=True)
    items = [{"path": p, "bytes": b} for p, b in ranked[:limit]]
    rest = ranked[limit:]
    return {
        "items": items,
        "otherBytes": sum(b for _, b in rest),
        "otherCount": len(rest),
    }


def head_file_sizes(cwd=None, limit=40):
    """Blob sizes of every file at HEAD, shaped for the sunburst. Best-effort:
    None on failure or on a tree with no blobs (e.g. an empty repo)."""
    try:
        # -l adds the blob size column; quotePath=false keeps non-ASCII paths raw
        # so they tie back to the same path strings used elsewhere (the log walk).
        # Read bytes and decode leniently (not git(), which is text=True): a path
        # with non-UTF-8 bytes would otherwise raise UnicodeDecodeError and abort
        # the run — the trap _head_first_line documents and sidesteps the same way.
        out = subprocess.run(
            ["git", "-c", "core.quotePath=false", "ls-tree", "-r", "-l", "HEAD"],
            cwd=cwd,
            capture_output=True,
            check=True,
        ).stdout.decode("utf-8", "replace")
    except (subprocess.CalledProcessError, OSError):
        return None
    sized = {}
    for line in out.splitlines():
        meta, _, path = line.partition("\t")
        if not path:
            continue
        cols = meta.split()
        # `<mode> <type> <object> <size>`; submodules list as type commit with a
        # "-" size — skip those, they hold no bytes in this tree.
        if len(cols) < 4 or cols[1] != "blob":
            continue
        try:
            sized[path] = int(cols[3])
        except ValueError:
            continue
    return _top_with_remainder(sized, limit)


def history_disk_by_path(cwd=None, limit=40):
    """On-disk (compressed) size of all blob versions ever committed, summed per
    path across full history — what actually fills the .git object store. Walks
    every reachable object, so it's O(history) like the log scan; best-effort,
    returns None on failure."""
    sized = {}
    try:
        # Pipe rev-list straight into cat-file and read the result line by line, so
        # neither the full object list nor the size table is buffered in memory at
        # once — this walks every reachable object and can be huge on big repos.
        revs = subprocess.Popen(
            ["git", "-c", "core.quotePath=false", "rev-list", "--objects", "--all"],
            cwd=cwd,
            stdout=subprocess.PIPE,
        )
        # `%(rest)` echoes the path rev-list appended after each blob's oid.
        # No text=True: read bytes and decode each line leniently, so a non-UTF-8
        # path (quotePath=false emits raw bytes) can't crash the strict UTF-8
        # decode and abort the run — same trap _head_first_line sidesteps.
        cat = subprocess.Popen(
            ["git", "cat-file", "--batch-check=%(objecttype) %(objectsize:disk) %(rest)"],
            cwd=cwd,
            stdin=revs.stdout,
            stdout=subprocess.PIPE,
        )
        # Drop our handle so rev-list gets SIGPIPE if cat-file exits early.
        revs.stdout.close()
        for raw in cat.stdout:
            # `blob <disk-size> <path>`; non-blobs (commits/trees) and pathless blobs
            # split short and are skipped. rstrip drops the streamed line's newline
            # so it doesn't bleed into the path key.
            parts = raw.decode("utf-8", "replace").rstrip("\n").split(" ", 2)
            if len(parts) < 3 or parts[0] != "blob":
                continue
            try:
                sized[parts[2]] = sized.get(parts[2], 0) + int(parts[1])
            except ValueError:
                continue
        cat.stdout.close()
        if cat.wait() != 0 or revs.wait() != 0:
            return None
    except OSError:
        return None
    return _top_with_remainder(sized, limit)


def detect_default_branch(cwd=None):
    try:
        ref = git(
            "symbolic-ref", "--short", "refs/remotes/origin/HEAD", cwd=cwd, quiet=True
        ).strip()
        if ref.startswith("origin/"):
            return ref[len("origin/") :]
    except subprocess.CalledProcessError:
        pass
    try:
        ref = git("symbolic-ref", "--short", "HEAD", cwd=cwd).strip()
        if ref:
            return ref
    except subprocess.CalledProcessError:
        pass
    return "main"


def count_branches(cwd=None):
    """Total distinct branches, counting local heads and remote-tracking heads
    deduped by short name. A bare/mirror clone keeps every branch under
    refs/heads; a working clone keeps the full set under refs/remotes/origin —
    the union covers both. None when no refs resolve."""
    try:
        out = git(
            "for-each-ref",
            "--format=%(refname)",
            "refs/heads",
            "refs/remotes",
            cwd=cwd,
            quiet=True,
        )
    except subprocess.CalledProcessError:
        return None
    names = set()
    for line in out.splitlines():
        ref = line.strip()
        if ref.startswith("refs/heads/"):
            names.add(ref[len("refs/heads/") :])
        elif ref.startswith("refs/remotes/"):
            # refs/remotes/<remote>/<branch> — drop the remote and skip the
            # symbolic origin/HEAD pointer so it isn't counted as a branch.
            _, _, branch = ref[len("refs/remotes/") :].partition("/")
            if branch and branch != "HEAD":
                names.add(branch)
    return len(names) or None


def collect_local_tags(cwd=None):
    """Return list of {name, oid, date, message} for git tags, by commit date."""
    fmt = (
        "%(refname:short)\x1f"
        "%(*objectname)\x1f%(objectname)\x1f"
        "%(*committerdate:iso8601-strict)\x1f%(committerdate:iso8601-strict)\x1f"
        "%(contents:subject)"
    )
    try:
        out = git("tag", "-l", f"--format={fmt}", cwd=cwd)
    except subprocess.CalledProcessError:
        return []
    tags = []
    for line in out.splitlines():
        if not line:
            continue
        parts = line.split("\x1f")
        if len(parts) < 6:
            continue
        name, peel_oid, obj_oid, peel_date, obj_date = parts[:5]
        subject = "\x1f".join(parts[5:])
        oid = peel_oid or obj_oid
        date = peel_date or obj_date
        if not oid or not date:
            continue
        tags.append({"name": name, "oid": oid, "date": date, "message": subject})
    tags.sort(key=lambda t: parse_iso_instant(t.get("date")))
    return tags


def collect_local(cwd=None, suppress_current_user=False):
    try:
        repo_root = git("rev-parse", "--show-toplevel", cwd=cwd, quiet=True).strip()
    except subprocess.CalledProcessError:
        # Bare clone (no work tree): --show-toplevel fails. Fall back to the
        # repo directory name — overridden by the origin match below anyway.
        repo_root = (cwd or os.getcwd()).rstrip("/")
    repo_name = os.path.basename(repo_root)
    github_base = ""
    try:
        url = git("remote", "get-url", "origin", cwd=cwd).strip()
        m = ORIGIN_RE.match(url)
        if m:
            host = m.group("https_host") or m.group("ssh_host")
            host_lc = (host or "").lower()
            if host_lc == "github.com" or host_lc.endswith(".github.com"):
                github_base = f"https://{host}/{m.group('owner')}/{m.group('repo')}"
                repo_name = m.group("repo")
    except subprocess.CalledProcessError:
        pass

    current_email = ""
    if not suppress_current_user:
        with contextlib.suppress(subprocess.CalledProcessError):
            current_email = git("config", "user.email", cwd=cwd).strip().lower()

    log = git(
        # -c core.quotePath=false: keep non-ASCII paths raw so log paths match
        # the `present` set from the HEAD tree below (both feed classify_path).
        "-c",
        "core.quotePath=false",
        "log",
        "--no-merges",
        "-M",
        "--format=%H\x1f%s\x1f%aE\x1f%aN\x1f%aI",
        "--numstat",
        cwd=cwd,
    )
    commits_meta, line_stats, lang_stats = {}, {}, {}
    try:
        tree = git("ls-tree", "-r", "HEAD", "--name-only", cwd=cwd)
        present = {p for p in tree.splitlines() if p}
    except subprocess.CalledProcessError:
        present = set()
    shebang = head_shebangs(present, cwd=cwd)
    # classify_path scans the vendor regex per path; the same paths recur across
    # thousands of commits, so cache per unique numstat field (present/shebang
    # are fixed for the run).
    lang_cache = {}
    cur = None
    for line in log.splitlines():
        if not line:
            continue
        if "\x1f" in line:
            parts = line.split("\x1f")
            if len(parts) != 5:
                continue
            h, s, email, name, dt_iso = parts
            commits_meta[h] = {
                "subject": s,
                "email": email.lower(),
                "name": name,
                "iso": dt_iso,
            }
            cur = h
            line_stats[cur] = [0, 0]
            continue
        if cur is None:
            continue
        cols = line.split("\t")
        if len(cols) < 2 or cols[0] == "-" or cols[1] == "-":
            continue
        try:
            added, deleted = int(cols[0]), int(cols[1])
        except ValueError:
            continue
        line_stats[cur][0] += added
        line_stats[cur][1] += deleted
        if len(cols) >= 3:
            field = cols[2]
            if field in lang_cache:
                lang = lang_cache[field]
            else:
                lang = classify_path(field, present=present, shebang=shebang)
                lang_cache[field] = lang
            if lang:
                rec = lang_stats.setdefault(cur, {}).setdefault(lang, [0, 0, 0])
                rec[0] += added
                rec[1] += deleted
                rec[2] += 1

    default_branch = detect_default_branch(cwd=cwd)
    extras = {
        "lang_stats": lang_stats,
        "frameworks": detect_frameworks(present, cwd=cwd),
        "file_count": len(present),
        "branch_count": count_branches(cwd=cwd),
        # Whole-repo merge count for the header's "(N merges)" note. The stats
        # pipeline runs --no-merges, so the headline total is rebuilt as
        # no-merge commits + this. It can't be filtered (merges aren't in
        # commits_meta to recount), so main() drops it under any --since/--until/
        # --commits filter rather than inflate the now-filtered headline.
        "merge_count": int(git("rev-list", "--merges", "--count", "HEAD", cwd=cwd).strip() or 0),
        # HEAD's commit date (includes merges) for the header's "updated N ago".
        # Whole-repo like the counts above; the browser renders it relative to now.
        "last_commit_iso": git("log", "-1", "--format=%cI", cwd=cwd).strip(),
        "largest_files": head_file_sizes(cwd=cwd),
        "disk_by_path": history_disk_by_path(cwd=cwd),
    }
    return (
        repo_name,
        github_base,
        current_email,
        commits_meta,
        line_stats,
        {},
        {},
        default_branch,
        repo_disk_kb(cwd=cwd),
        collect_local_tags(cwd=cwd),
        extras,
    )


def gh_graphql(query, variables, token):
    """POST a GraphQL query to api.github.com. Returns the parsed JSON body."""
    payload = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        "https://api.github.com/graphql",
        data=payload,
        headers={
            "Authorization": f"bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "repo-intel",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


# GitHub returns these transient statuses when its GraphQL backend is
# overloaded or times out; they're worth retrying.
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})

# Plan for a single Commit.history page: (page_size, seconds_to_wait_first).
# Resolving Commit.history makes GitHub compute per-commit diff stats
# (additions/deletions), so a page holding a few large commits can blow past
# its backend timeout and return 502 — deterministically, at the same cursor.
# Shrinking `first` cuts the per-request work; the backoff rides out flakiness.
HISTORY_FETCH_PLAN = (
    (100, 0),
    (100, 2),
    (25, 4),
    (25, 8),
    (10, 15),
)


_SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
_status = {"msg": None, "frame": 0}
_status_lock = threading.Lock()
_spinner_started = False


def _draw_status():
    # Caller holds _status_lock. The frame glyph + space sits where the
    # message's two-space indent would be.
    frame = _SPINNER_FRAMES[_status["frame"] % len(_SPINNER_FRAMES)]
    print(f"\r\x1b[K{frame} {_status['msg'].lstrip()}", end="", file=sys.stderr, flush=True)


def _spinner_loop():
    while True:
        time.sleep(0.1)
        with _status_lock:
            if _status["msg"] is not None:
                _status["frame"] += 1
                _draw_status()


def status_line(msg, transient=False):
    """Stderr progress line. On a TTY, transient lines overwrite in place with
    an animated spinner and permanent lines replace any leftover transient one;
    elsewhere (CI, logs) every line prints normally."""
    global _spinner_started
    if not sys.stderr.isatty():
        print(msg, file=sys.stderr)
        return
    with _status_lock:
        if transient:
            _status["msg"] = msg
            _draw_status()
            if not _spinner_started:
                _spinner_started = True
                threading.Thread(target=_spinner_loop, daemon=True).start()
        else:
            _status["msg"] = None
            print(f"\r\x1b[K{msg}", file=sys.stderr, flush=True)


def clear_status_line():
    """Erase any transient status_line so the next print starts on a clean line."""
    if sys.stderr.isatty():
        with _status_lock:
            _status["msg"] = None
            print("\r\x1b[K", end="", file=sys.stderr, flush=True)


def fetch_history_page(query, variables, token, label):
    """gh_graphql for a Commit.history page, retrying transient 5xx with
    backoff and a shrinking page size. Raises the last error if all attempts
    fail. `variables` must omit `pageSize` — it is injected per attempt."""
    last_exc = None
    for page_size, sleep_s in HISTORY_FETCH_PLAN:
        if sleep_s:
            time.sleep(sleep_s)
        try:
            return gh_graphql(query, {**variables, "pageSize": page_size}, token)
        except urllib.error.HTTPError as exc:
            if exc.code not in RETRYABLE_STATUS:
                raise
            last_exc, detail = exc, f"HTTP {exc.code}"
        except urllib.error.URLError as exc:
            last_exc, detail = exc, str(exc.reason)
        status_line(f"  warning: {label} page (size {page_size}) failed: {detail}")
    raise last_exc


def gh_repository(body):
    """Extract data.repository defensively — GraphQL returns null on errors."""
    return (body.get("data") or {}).get("repository") or {}


def probe_remote_meta(owner, repo, token):
    """Repo size in KB (diskUsage) and total commits on the default branch,
    in one GraphQL round-trip; (None, None) on error."""
    query = """
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    diskUsage
    defaultBranchRef {
      target { ... on Commit { history(first: 1) { totalCount } } }
    }
  }
}
""".strip()
    try:
        body = gh_graphql(query, {"owner": owner, "repo": repo}, token)
    except urllib.error.URLError:
        return None, None
    if "errors" in body:
        return None, None
    repo_node = gh_repository(body)
    kb = repo_node.get("diskUsage")
    branch = repo_node.get("defaultBranchRef") or {}
    target = branch.get("target") or {}
    history = target.get("history") or {}
    total = history.get("totalCount")
    return (
        kb if isinstance(kb, int) else None,
        total if isinstance(total, int) else None,
    )


def fetch_repo_social(github_base, token):
    """Stars / watchers / forks for a github.com repo via REST; None otherwise
    (non-GitHub origin, offline, private repo without a token, etc.)."""
    m = ORIGIN_RE.match(github_base or "")
    host = (m.group("https_host") or m.group("ssh_host")) if m else ""
    if not m or not (host == "github.com" or host.endswith(".github.com")):
        return None
    url = f"https://api.github.com/repos/{m.group('owner')}/{m.group('repo')}"
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "repo-intel"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, headers=headers), timeout=5
        ) as resp:
            body = json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, ValueError):
        return None
    return {
        "stars": body.get("stargazers_count"),
        # REST quirk: "Watchers" in GitHub's UI is subscribers_count;
        # watchers_count is a legacy alias of the star count.
        "watchers": body.get("subscribers_count"),
        "forks": body.get("forks_count"),
    }


def get_github_token():
    try:
        token = subprocess.check_output(
            ["gh", "auth", "token", "-h", "github.com"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        token = ""
    return token or os.environ.get("GITHUB_TOKEN") or None


def fetch_logins_for_commits(owner, repo, oids_by_email, token):
    """Look up GitHub author login for each email using a few sample oids.

    Used in the local-repo path where the commit walk doesn't know logins.
    Local commits not yet pushed return null, so multiple oids per email are
    queried in one batched GraphQL call; the first that resolves wins.
    Returns {email: login}.
    """
    if not oids_by_email or not token:
        return {}
    aliases = []
    oid_values = []
    for email, oids in oids_by_email.items():
        for oid in oids:
            aliases.append((len(oid_values), email))
            oid_values.append(oid)
    if not aliases:
        return {}
    var_decls = ", ".join(f"$oid{i}: GitObjectID!" for i in range(len(oid_values)))
    fragments = " ".join(
        f"c{i}: object(oid: $oid{i}) {{ ... on Commit {{ author {{ user {{ login }} }} }} }}"
        for i in range(len(oid_values))
    )
    query = (
        f"query($owner: String!, $repo: String!, {var_decls}) "
        f"{{ repository(owner: $owner, name: $repo) {{ {fragments} }} }}"
    )
    variables = {"owner": owner, "repo": repo}
    for i, oid in enumerate(oid_values):
        variables[f"oid{i}"] = oid

    try:
        body = gh_graphql(query, variables, token)
    except urllib.error.URLError as exc:
        status_line(f"  warning: login lookup failed: {exc}")
        return {}
    if "errors" in body:
        status_line(f"  warning: login lookup errors: {body['errors']}")
    repo_node = gh_repository(body)
    out = {}
    for i, email in aliases:
        if email in out:
            continue
        node = repo_node.get(f"c{i}") or {}
        user = ((node.get("author") or {}).get("user")) or {}
        login = user.get("login")
        if login:
            out[email] = login
    return out


def fetch_user_profiles(logins, token):
    """Fetch GitHub profile fields for `logins` in one aliased GraphQL query.

    Returns {login: {login,name,bio,location,websiteUrl,followers,following,publicRepos}}.
    Missing/renamed users are silently skipped.
    """
    if not logins or not token:
        return {}
    unique = []
    seen = set()
    for login in logins:
        # Bot accounts (e.g. "github-actions[bot]") are GraphQL Bot nodes, not
        # User nodes — user(login:) can never resolve them, so querying just
        # yields a NOT_FOUND error. Skip them rather than emit a noisy warning.
        if login and login not in seen and not login.endswith("[bot]"):
            seen.add(login)
            unique.append(login)
    if not unique:
        return {}

    fields = (
        "login name bio location websiteUrl "
        "followers { totalCount } following { totalCount } "
        "repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount }"
    )
    var_decls = ", ".join(f"$l{i}: String!" for i in range(len(unique)))
    fragments = " ".join(f"u{i}: user(login: $l{i}) {{ {fields} }}" for i in range(len(unique)))
    query = f"query({var_decls}) {{ {fragments} }}"
    variables = {f"l{i}": login for i, login in enumerate(unique)}

    try:
        body = gh_graphql(query, variables, token)
    except urllib.error.URLError as exc:
        status_line(f"  warning: profile fetch failed: {exc}")
        return {}
    # NOT_FOUND just means a login no longer resolves (deleted/renamed account);
    # the per-alias `if not node: continue` below already skips those. Only warn
    # about other errors (auth, rate limits) that signal a real fetch problem.
    real_errors = [e for e in body.get("errors", []) if e.get("type") != "NOT_FOUND"]
    if real_errors:
        status_line(f"  warning: profile fetch errors: {real_errors}")
    data = body.get("data") or {}
    out = {}
    for i, login in enumerate(unique):
        node = data.get(f"u{i}")
        if not node:
            continue
        out[login] = {
            "login": node.get("login") or login,
            "name": node.get("name") or "",
            "bio": node.get("bio") or "",
            "location": node.get("location") or "",
            "websiteUrl": node.get("websiteUrl") or "",
            "followers": (node.get("followers") or {}).get("totalCount") or 0,
            "following": (node.get("following") or {}).get("totalCount") or 0,
            "publicRepos": (node.get("repositories") or {}).get("totalCount") or 0,
        }
    return out


def fetch_remote_tags(owner, repo, token):
    """Fetch all tag refs via GraphQL. Returns list of {name, oid, date, message}."""
    query = """
query($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    refs(refPrefix: "refs/tags/", first: 100, after: $cursor, orderBy: {field: TAG_COMMIT_DATE, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        target {
          __typename
          ... on Tag {
            message
            target { ... on Commit { oid committedDate } }
          }
          ... on Commit { oid committedDate }
        }
      }
    }
  }
}
""".strip()
    cursor = None
    tags = []
    while True:
        try:
            body = gh_graphql(query, {"owner": owner, "repo": repo, "cursor": cursor}, token)
        except urllib.error.URLError as exc:
            status_line(f"  warning: tag fetch failed: {exc}")
            return tags
        if "errors" in body:
            status_line(f"  warning: tag fetch GraphQL error: {body['errors']}")
            return tags
        refs = gh_repository(body).get("refs") or {}
        for node in refs.get("nodes") or []:
            tgt = node.get("target") or {}
            kind = tgt.get("__typename")
            if kind == "Tag":
                inner = tgt.get("target") or {}
                oid = inner.get("oid") or ""
                date = inner.get("committedDate") or ""
                message = tgt.get("message") or ""
            elif kind == "Commit":
                oid = tgt.get("oid") or ""
                date = tgt.get("committedDate") or ""
                message = ""
            else:
                continue
            if not oid or not date:
                continue
            tags.append(
                {
                    "name": node.get("name") or "",
                    "oid": oid,
                    "date": date,
                    "message": (message.splitlines() or [""])[0],
                }
            )
        page = refs.get("pageInfo") or {}
        if not page.get("hasNextPage"):
            break
        cursor = page.get("endCursor")
    tags.sort(key=lambda t: parse_iso_instant(t.get("date")))
    return tags


def _gh_open_nodes(conn):
    """Open PR/issue GraphQL nodes → the payload's openPullRequests/openIssues
    entry shape."""
    return [
        {
            "number": node.get("number"),
            "title": node.get("title") or "",
            "createdAt": node.get("createdAt") or "",
            "author": ((node.get("author") or {}).get("login")) or "",
        }
        for node in conn.get("nodes") or []
    ]


def _fetch_gh_items(github_base, token, limit, query, list_key, date_key, build_counts, label):
    """Shared cursor walk behind fetch_pull_requests/fetch_issues: pages the
    `list_key` connection newest-first, builds counts once (first page only,
    via `build_counts(repo, conn)` — later pages skip the counts sub-queries
    with @include on $withCounts), keeps nodes that have `date_key`, then trims
    to `limit` and sorts ascending by it. (None, None) when unavailable
    (non-GitHub origin, no token, network error)."""
    m = ORIGIN_RE.match(github_base or "")
    host = (m.group("https_host") or m.group("ssh_host")) if m else ""
    # gh_graphql is hardcoded to api.github.com, so GHE hosts are out.
    if not m or host != "github.com" or not token:
        return None, None
    variables = {"owner": m.group("owner"), "repo": m.group("repo")}
    cursor = None
    items = []
    counts = None
    while True:
        variables["cursor"] = cursor
        variables["withCounts"] = counts is None
        try:
            body = gh_graphql(query, variables, token)
        except urllib.error.URLError as exc:
            status_line(f"  warning: {label} fetch failed: {exc}")
            break
        if "errors" in body:
            status_line(f"  warning: {label} fetch GraphQL error: {body['errors']}")
            break
        repo = gh_repository(body)
        conn = repo.get(list_key) or {}
        if counts is None:
            counts = build_counts(repo, conn)
        for node in conn.get("nodes") or []:
            ended_at = node.get(date_key)
            if not ended_at:
                continue
            items.append(
                {
                    "number": node.get("number"),
                    "title": node.get("title") or "",
                    "createdAt": node.get("createdAt") or "",
                    date_key: ended_at,
                    # author is null for deleted accounts
                    "author": ((node.get("author") or {}).get("login")) or "",
                }
            )
        page = conn.get("pageInfo") or {}
        if not page.get("hasNextPage") or len(items) >= limit:
            break
        cursor = page.get("endCursor")
    if counts is None and not items:
        return None, None
    # Pages come 100 at a time, so a sub-page limit overshoots — trim the tail
    # (pages accumulate newest-first, so this keeps the newest `limit`).
    del items[limit:]
    items.sort(key=lambda x: x[date_key])
    return items, counts or {}


def fetch_pull_requests(github_base, token, limit=MAX_PULL_REQUESTS):
    """Merged PRs (newest `limit`), PR counts (merged/open/closed)
    and the oldest open PRs via GraphQL; (None, None) when unavailable
    (non-GitHub origin, no token, network error)."""
    # orderBy has no MERGED_AT field; CREATED_AT DESC is the proxy for
    # "newest merged first", which is fine for timeline markers.
    # openPrs/closedPrs are only needed once, so later pages of the merged-PR
    # cursor walk skip them via @include.
    query = """
query($owner: String!, $repo: String!, $cursor: String, $withCounts: Boolean!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: MERGED, first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { number title createdAt mergedAt author { login } }
    }
    openPrs: pullRequests(states: OPEN, first: 100, orderBy: {field: CREATED_AT, direction: ASC}) @include(if: $withCounts) {
      totalCount
      nodes { number title createdAt author { login } }
    }
    closedPrs: pullRequests(states: CLOSED) @include(if: $withCounts) { totalCount }
  }
}
""".strip()

    def build_counts(repo, pulls):
        # GitHub's CLOSED state excludes merged, so the three are disjoint.
        open_prs = repo.get("openPrs") or {}
        return {
            "prCount": pulls.get("totalCount"),
            "prOpenCount": open_prs.get("totalCount"),
            "prClosedCount": (repo.get("closedPrs") or {}).get("totalCount"),
            # ponytail: oldest 100 open PRs only; paginate if a repo ever has more
            "openPullRequests": _gh_open_nodes(open_prs),
        }

    return _fetch_gh_items(
        github_base, token, limit, query, "pullRequests", "mergedAt", build_counts, "PR"
    )


def fetch_issues(github_base, token, limit=MAX_ISSUES):
    """Closed issues (newest `limit`), issue counts (open/closed) and the
    oldest open issues via GraphQL; (None, None) when unavailable (non-GitHub
    origin, no token, network error). GraphQL issues already exclude PRs."""
    # orderBy has no CLOSED_AT field; CREATED_AT DESC is the proxy for
    # "newest closed first", which is fine for timeline markers.
    query = """
query($owner: String!, $repo: String!, $cursor: String, $withCounts: Boolean!) {
  repository(owner: $owner, name: $repo) {
    issues(states: CLOSED, first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { number title createdAt closedAt author { login } }
    }
    openIssues: issues(states: OPEN, first: 100, orderBy: {field: CREATED_AT, direction: ASC}) @include(if: $withCounts) {
      totalCount
      nodes { number title createdAt author { login } }
    }
  }
}
""".strip()

    def build_counts(repo, closed):
        open_issues = repo.get("openIssues") or {}
        return {
            "issueClosedCount": closed.get("totalCount"),
            "issueOpenCount": open_issues.get("totalCount"),
            # ponytail: oldest 100 open issues only; paginate if a repo ever has more
            "openIssues": _gh_open_nodes(open_issues),
        }

    return _fetch_gh_items(
        github_base, token, limit, query, "issues", "closedAt", build_counts, "issue"
    )


def gh_rest_get(path, token):
    """GET an api.github.com REST endpoint; returns the parsed JSON body."""
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={
            "Authorization": f"bearer {token}",
            "User-Agent": "repo-intel",
            "Accept": "application/vnd.github+json",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


# Manifests _frameworks_from_files actually parses (so we only fetch those
# blobs). tsconfig.json / sentinels are presence-only — covered by the tree.
_REMOTE_MANIFEST_BASES = frozenset(
    {
        "package.json",
        "composer.json",
        "pyproject.toml",
        "pipfile",
        "setup.py",
        "setup.cfg",
        "gemfile",
        "go.mod",
        "cargo.toml",
    }
)


def _remote_manifest_paths(paths):
    out = []
    for p in paths:
        base = p.rsplit("/", 1)[-1].lower()
        if base in _REMOTE_MANIFEST_BASES or (
            base.startswith("requirements") and base.endswith(".txt")
        ):
            out.append(p)
    return out


def fetch_blob_texts(owner, repo, paths, token):
    """HEAD blob text for each path via aliased GraphQL. Returns {path: text}."""
    out = {}
    paths = list(paths)
    for start in range(0, len(paths), 50):
        chunk = paths[start : start + 50]
        var_decls = ", ".join(f"$p{i}: String!" for i in range(len(chunk)))
        frags = " ".join(
            f"b{i}: object(expression: $p{i}) {{ ... on Blob {{ text }} }}"
            for i in range(len(chunk))
        )
        query = (
            f"query($owner: String!, $repo: String!, {var_decls}) "
            f"{{ repository(owner: $owner, name: $repo) {{ {frags} }} }}"
        )
        variables = {"owner": owner, "repo": repo}
        for i, p in enumerate(chunk):
            variables[f"p{i}"] = f"HEAD:{p}"
        try:
            body = gh_graphql(query, variables, token)
        except urllib.error.URLError as exc:
            status_line(f"  warning: manifest fetch failed: {exc}")
            continue
        node = gh_repository(body)
        for i, p in enumerate(chunk):
            blob = node.get(f"b{i}")
            if blob and blob.get("text") is not None:
                out[p] = blob["text"]
    return out


def fetch_frameworks_remote(owner, repo, token):
    """Detect frameworks on the GraphQL path without a clone.

    Lists the repo tree (REST, recursive — manifests can be nested) and fetches
    just the manifest blobs (GraphQL), then runs the shared detection core.
    Per-file *languages* stay local-only (too expensive over the network), but
    manifests are cheap, so frameworks work here too.
    """
    if not token:
        return []
    try:
        tree = gh_rest_get(f"/repos/{owner}/{repo}/git/trees/HEAD?recursive=1", token)
    except urllib.error.URLError as exc:
        status_line(f"  warning: framework tree fetch failed: {exc}")
        return []
    if tree.get("truncated"):
        # GitHub caps the recursive tree at ~100k entries / 7MB; deep manifests
        # past the cap are dropped, so detection may miss frameworks silently.
        status_line(
            "  warning: repo tree truncated by GitHub — framework detection may be incomplete"
        )
    paths = [e["path"] for e in (tree.get("tree") or []) if e.get("type") == "blob"]
    if not paths:
        return []
    contents = fetch_blob_texts(owner, repo, _remote_manifest_paths(paths), token)
    return _frameworks_from_files(paths, lambda p: contents.get(p, ""))


def fetch_languages_remote(owner, repo, token):
    """Repo-wide language breakdown on the GraphQL path, no clone needed.

    GitHub runs Linguist itself and exposes the result as bytes-per-language at
    HEAD. That's a composition snapshot, not the per-commit line churn the local
    path tracks — so it can only fill the repo-wide bar, never per-author or
    per-commit language stats. Reuses `top_languages` (ranking by the first
    slot, here byte size) so colors and overflow collapsing match local runs.
    Returns [] on error or when the repo has no detected languages.
    """
    if not token:
        return []
    query = """
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    languages(first: 50, orderBy: {field: SIZE, direction: DESC}) {
      edges { size node { name } }
    }
  }
}
""".strip()
    try:
        body = gh_graphql(query, {"owner": owner, "repo": repo}, token)
    except urllib.error.URLError as exc:
        status_line(f"  warning: language fetch failed: {exc}")
        return []
    if "errors" in body:
        return []
    edges = ((gh_repository(body).get("languages") or {}).get("edges")) or []
    langs = {}
    for e in edges:
        name = ((e.get("node") or {}).get("name") or "").strip()
        size = e.get("size") or 0
        if name and size > 0:
            langs[name] = [size, 0, 0]
    return top_languages(langs)


def _paginate_history(
    fetch_page, cached_oids, last_n, since, have_count_baseline, label, skip_first=False
):
    """Walk a Commit.history connection page by page.

    fetch_page(cursor) -> history dict, or None when the anchor object is gone.
    Returns (nodes, reason) where reason ∈
        "hit_cache" | "short_circuit" | "page_end" | "anchor_null" | "fetch_failed"
    On "fetch_failed" the returned nodes are still a contiguous run from the
    walk's start, so the caller can persist them and resume on a re-run.
    """
    nodes = []
    cursor = None
    dropped_anchor = not skip_first
    expected = None
    try:
        while True:
            try:
                history = fetch_page(cursor)
            except urllib.error.URLError as exc:
                # A non-retryable HTTP status (401/403/404) is a hard failure, not
                # a resumable one — propagate it rather than persisting a partial
                # cache and telling the user to re-run.
                if isinstance(exc, urllib.error.HTTPError) and exc.code not in RETRYABLE_STATUS:
                    raise
                status_line(f"  error: {label} fetch aborted: {exc}")
                return nodes, "fetch_failed"
            if history is None:
                return nodes, "anchor_null"
            if expected is None and history.get("totalCount"):
                # How many commits this walk should yield: the whole connection,
                # minus what we already have (the cached run for the top walk,
                # just the anchor commit for the older walk), capped by --commits.
                expected = history["totalCount"] - (1 if skip_first else len(cached_oids))
                if last_n is not None:
                    expected = min(expected, last_n - have_count_baseline)
                if expected <= 0:
                    expected = None
            for n in history.get("nodes") or []:
                if not dropped_anchor:
                    dropped_anchor = True
                    continue
                if n["oid"] in cached_oids:
                    return nodes, "hit_cache"
                nodes.append(n)
                if last_n is not None and len(nodes) + have_count_baseline >= last_n:
                    return nodes, "short_circuit"
                if since:
                    d = ((n.get("author") or {}).get("date") or "")[:10]
                    if d and d < since:
                        return nodes, "short_circuit"
            page = history.get("pageInfo") or {}
            if not page.get("hasNextPage"):
                return nodes, "page_end"
            cursor = page.get("endCursor")
            if expected:
                # A since-filtered walk stops early (bar ends short) and a
                # force-push can shrink the connection (bar would overshoot) —
                # clamp rather than trust the estimate.
                filled = int(20 * min(len(nodes) / expected, 1.0))
                msg = (
                    f"  {'█' * filled}{'░' * (20 - filled)} {len(nodes)}/{expected} {label} commits"
                    if sys.stderr.isatty()
                    else f"  fetched {len(nodes)}/{expected} {label} commits…"
                )
                status_line(msg, transient=True)
            else:
                status_line(f"  fetched {len(nodes)} {label} commits…", transient=True)
    finally:
        # Leave the cursor on a clean line so the caller's summary print
        # doesn't append to a transient progress line.
        clear_status_line()


def collect_remote(slug, token, no_cache=False, commits_filter=None, since=None, until=None):
    owner, repo = slug.split("/", 1)

    if not token:
        clone_dir = ensure_bare_clone(owner, repo, no_cache)
        (
            repo_name,
            github_base,
            _,
            commits_meta,
            line_stats,
            _,
            _,
            default_branch,
            repo_size_kb,
            tags,
            extras,
        ) = collect_local(cwd=clone_dir, suppress_current_user=True)
        if not github_base:
            github_base = f"https://github.com/{owner}/{repo}"
        return (
            repo_name,
            github_base,
            "",
            commits_meta,
            line_stats,
            {},
            {},
            default_branch,
            repo_size_kb,
            tags,
            extras,
        )

    history_block = """
history(first: $pageSize, after: $cursor) {
  totalCount
  pageInfo { hasNextPage endCursor }
  nodes {
    oid messageHeadline
    author { name email date user { avatarUrl(size: 64) login } }
    additions deletions
    parents { totalCount }
  }
}""".strip()

    top_query = f"""
query($owner: String!, $repo: String!, $cursor: String, $pageSize: Int!) {{
  repository(owner: $owner, name: $repo) {{
    name url diskUsage
    refs(refPrefix: "refs/heads/") {{ totalCount }}
    defaultBranchRef {{
      name
      target {{ ... on Commit {{ {history_block} }} }}
    }}
  }}
}}""".strip()

    bottom_query = f"""
query($owner: String!, $repo: String!, $oid: GitObjectID!, $cursor: String, $pageSize: Int!) {{
  repository(owner: $owner, name: $repo) {{
    object(oid: $oid) {{ ... on Commit {{ {history_block} }} }}
  }}
}}""".strip()

    loaded_nodes, loaded_complete = ([], False) if no_cache else load_cache(slug)
    cached_nodes = loaded_nodes
    cached_oids = {n["oid"] for n in cached_nodes}
    if cached_nodes:
        label = "complete" if loaded_complete else "partial"
        print(f"  cache: {len(cached_nodes)} commits ({label})", file=sys.stderr)

    last_n = commits_filter[1] if commits_filter and commits_filter[0] == "last" else None

    repo_meta = {
        "name": repo,
        "url": f"https://github.com/{owner}/{repo}",
        "branch": "main",
        "disk_kb": 0,
        "branch_count": None,
    }

    def top_fetch_page(cursor):
        body = fetch_history_page(
            top_query, {"owner": owner, "repo": repo, "cursor": cursor}, token, "new"
        )
        if "errors" in body:
            sys.exit(f"GraphQL error: {body['errors']}")
        repo_node = gh_repository(body)
        if not repo_node:
            sys.exit(f"Repository not found or inaccessible: {slug}")
        repo_meta["name"] = repo_node["name"]
        repo_meta["url"] = repo_node["url"]
        repo_meta["disk_kb"] = repo_node.get("diskUsage") or 0
        repo_meta["branch_count"] = (repo_node.get("refs") or {}).get("totalCount")
        branch_ref = repo_node.get("defaultBranchRef")
        if not branch_ref or not branch_ref.get("target"):
            sys.exit(f"error: {slug} has no commits on its default branch")
        repo_meta["branch"] = branch_ref.get("name") or repo_meta["branch"]
        return branch_ref["target"]["history"]

    def bail_partial(nodes):
        """Persist a contiguous partial run after a fetch failure, then exit so
        the next run resumes from its tail. Saved as incomplete on purpose."""
        if not no_cache and nodes:
            save_cache(slug, nodes, False)
            print(
                f"  cached {len(nodes)} commits so far — re-run to resume",
                file=sys.stderr,
            )
        sys.exit("error: GitHub fetch failed after repeated retries; aborting.")

    new_nodes, top_reason = _paginate_history(
        top_fetch_page,
        cached_oids,
        last_n,
        since,
        have_count_baseline=len(cached_nodes),
        label="new",
    )

    if top_reason == "fetch_failed":
        # new_nodes is a contiguous run from HEAD. We never reached the old
        # cache, so merging would leave a gap — persist just the fresh prefix
        # (the next run resumes its tail via the older-fetch) and bail out.
        bail_partial(new_nodes)

    if top_reason == "page_end" and cached_oids:
        print(
            f"  cache: orphaned by force-push/rewrite, discarded ({len(cached_nodes)} commits)",
            file=sys.stderr,
        )
        cached_nodes = []
        cached_oids = set()
        loaded_complete = False
    if new_nodes:
        print(f"  fetched {len(new_nodes)} new commits", file=sys.stderr)

    older_nodes = []
    bottom_reason = None
    have_count = len(new_nodes) + len(cached_nodes)
    cached_oldest_date = (
        ((cached_nodes[-1].get("author") or {}).get("date") or "")[:10] if cached_nodes else ""
    )
    if needs_older_fetch(
        have_count,
        cached_oldest_date,
        loaded_complete,
        commits_filter,
        since,
        until,
    ):
        anchor_oid = cached_nodes[-1]["oid"]

        def bottom_fetch_page(cursor):
            body = fetch_history_page(
                bottom_query,
                {"owner": owner, "repo": repo, "oid": anchor_oid, "cursor": cursor},
                token,
                "older",
            )
            if "errors" in body:
                sys.exit(f"GraphQL error: {body['errors']}")
            obj = gh_repository(body).get("object")
            if not obj:
                return None
            return obj.get("history") or {"nodes": [], "pageInfo": {}}

        older_nodes, bottom_reason = _paginate_history(
            bottom_fetch_page,
            cached_oids,
            last_n,
            since,
            have_count_baseline=have_count,
            label="older",
            skip_first=True,
        )
        if bottom_reason == "anchor_null":
            print(
                "  warning: cache anchor commit no longer exists; keeping what we have",
                file=sys.stderr,
            )
        elif older_nodes:
            print(f"  fetched {len(older_nodes)} older commits", file=sys.stderr)

    repo_name = repo_meta["name"]
    repo_url = repo_meta["url"]
    default_branch = repo_meta["branch"]
    repo_size_kb = repo_meta["disk_kb"]

    nodes = new_nodes + cached_nodes + older_nodes
    if bottom_reason == "fetch_failed":
        # new + cached + older are contiguous, so the partial run is a valid
        # prefix to persist; the next run extends from its tail.
        bail_partial(nodes)
    if bottom_reason is None:
        new_complete = top_reason == "page_end" or loaded_complete
    else:
        new_complete = bottom_reason == "page_end"
    if not no_cache and nodes:
        save_cache(slug, nodes, new_complete)

    commits_meta, line_stats, avatars, logins = {}, {}, {}, {}
    merge_count = 0
    for n in nodes:
        # GitHub reports a merge commit's additions/deletions as the full diff
        # vs its first parent — the whole PR again, attributed to the merger.
        # The local path runs --no-merges; mirror that here.
        if ((n.get("parents") or {}).get("totalCount") or 1) > 1:
            merge_count += 1
            continue
        author = n.get("author") or {}
        email = (author.get("email") or "").lower()
        commits_meta[n["oid"]] = {
            "subject": n.get("messageHeadline") or "",
            "email": email,
            "name": author.get("name") or email or "unknown",
            "iso": author.get("date"),
        }
        line_stats[n["oid"]] = [n.get("additions") or 0, n.get("deletions") or 0]
        user = author.get("user")
        if user and email:
            if user.get("avatarUrl") and email not in avatars:
                avatars[email] = user["avatarUrl"]
            if user.get("login") and email not in logins:
                logins[email] = user["login"]

    tags = fetch_remote_tags(owner, repo, token)
    # Per-commit/per-author language churn needs a clone, so `lang_stats` stays
    # empty here. But the repo-wide bar and frameworks both come straight from
    # the API: GitHub runs Linguist for `repo_languages`, and manifests are
    # cheap to fetch for frameworks.
    frameworks = fetch_frameworks_remote(owner, repo, token)
    repo_languages = fetch_languages_remote(owner, repo, token)
    return (
        repo_name,
        repo_url,
        "",
        commits_meta,
        line_stats,
        avatars,
        logins,
        default_branch,
        repo_size_kb,
        tags,
        {
            "lang_stats": {},
            "frameworks": frameworks,
            "repo_languages": repo_languages,
            "branch_count": repo_meta["branch_count"],
            "merge_count": merge_count,
        },
    )


def apply_filters(commits_meta, line_stats, commits_filter, since, until):
    if since or until:

        def in_range(m):
            d = (m.get("iso") or "")[:10]
            return bool(d) and (not since or d >= since) and (not until or d <= until)

        commits_meta = {h: m for h, m in commits_meta.items() if in_range(m)}
    if commits_filter:
        epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)

        def _ts(h):
            iso = commits_meta[h].get("iso") or ""
            if not iso:
                return epoch
            try:
                return datetime.fromisoformat(iso.replace("Z", "+00:00"))
            except ValueError:
                return epoch

        ordered = sorted(commits_meta, key=_ts)
        if commits_filter[0] == "last":
            keep = set(ordered[-commits_filter[1] :])
        else:
            keep = set(ordered[commits_filter[1] : commits_filter[2]])
        commits_meta = {h: m for h, m in commits_meta.items() if h in keep}
    line_stats = {h: line_stats[h] for h in commits_meta if h in line_stats}
    return commits_meta, line_stats


def filter_tags_to_range(tags, commits_meta):
    if not tags or not commits_meta:
        return []
    dates = [(m.get("iso") or "")[:10] for m in commits_meta.values()]
    dates = [d for d in dates if d]
    if not dates:
        return list(tags)
    lo, hi = min(dates), max(dates)
    return [t for t in tags if lo <= (t.get("date") or "")[:10] <= hi]


def build_data(
    top_n,
    repo_name,
    github_base,
    current_email,
    commits_meta,
    line_stats,
    avatars,
    logins,
    default_branch,
    repo_size_kb,
    tags,
    extras,
):
    lang_stats = (extras or {}).get("lang_stats", {})
    frameworks = (extras or {}).get("frameworks", [])
    # Remote runs ship a precomputed repo-wide bar (bytes at HEAD); local/bare
    # runs build it below from per-commit line churn. `repo_languages` being a
    # non-empty list signals the former.
    repo_languages = (extras or {}).get("repo_languages") or []
    # File count at HEAD: a snapshot stat like repoSizeKb. None on the remote
    # GraphQL path (no per-file tree fetched); a real count on local/bare runs.
    file_count = (extras or {}).get("file_count")
    # Total branch count: a snapshot stat like file_count. None on paths that
    # can't determine it.
    branch_count = (extras or {}).get("branch_count")
    merge_count = (extras or {}).get("merge_count") or 0
    # HEAD commit date for "updated N ago"; fall back to the newest commit we
    # have (the remote GraphQL path supplies no extras).
    last_commit_iso = (extras or {}).get("last_commit_iso") or max(
        (m.get("iso") or "" for m in commits_meta.values()), default=""
    )
    # File-size sunbursts: blob sizes at HEAD and accumulated on-disk size per
    # path across history. None on the remote GraphQL path (no tree fetched).
    largest_files = (extras or {}).get("largest_files")
    disk_by_path = (extras or {}).get("disk_by_path")
    repo_langs = {}
    authors = {}
    daily_by_author = defaultdict(lambda: defaultdict(int))
    weekly_by_author = defaultdict(lambda: defaultdict(int))
    all_dates, all_weeks = set(), set()
    total_added = total_deleted = total_commits = 0

    for h, meta in commits_meta.items():
        iso = meta.get("iso")
        if not iso:
            continue
        try:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        except ValueError:
            continue
        total_commits += 1
        d_key = dt.strftime("%Y-%m-%d")
        wk = iso_week_label(dt)
        email, name = meta["email"], meta["name"]
        a, d = line_stats.get(h, [0, 0])
        total_added += a
        total_deleted += d

        rec = authors.setdefault(
            email,
            {
                "name": name,
                "email": email,
                "commits": 0,
                "added": 0,
                "deleted": 0,
                "dates": set(),
                "daily_counts": defaultdict(int),
                "langs": {},
                "first": d_key,
                "last": d_key,
            },
        )
        rec["commits"] += 1
        rec["added"] += a
        rec["deleted"] += d
        rec["dates"].add(d_key)
        rec["daily_counts"][d_key] += 1
        for lang, (la, ld, lf) in lang_stats.get(h, {}).items():
            agg = rec["langs"].setdefault(lang, [0, 0, 0])
            agg[0] += la
            agg[1] += ld
            agg[2] += lf
            repo = repo_langs.setdefault(lang, [0, 0, 0])
            repo[0] += la
            repo[1] += ld
            repo[2] += lf
        if d_key < rec["first"]:
            rec["first"] = d_key
        if d_key > rec["last"]:
            rec["last"] = d_key

        daily_by_author[email][d_key] += 1
        weekly_by_author[email][wk] += 1
        all_dates.add(d_key)
        all_weeks.add(wk)

    total_contributors = len(authors)
    ranked = sorted(authors.values(), key=lambda r: r["commits"], reverse=True)
    top = ranked[:top_n]
    top_emails = {r["email"] for r in top}

    contributors = []
    for r in top:
        busiest_day, busiest_count = "", 0
        for k, v in r["daily_counts"].items():
            if v > busiest_count:
                busiest_day, busiest_count = k, v
        login = logins.get(r["email"]) or login_from_email(r["email"])
        contributors.append(
            {
                "name": r["name"],
                "email": r["email"],
                "login": login,
                "commits": r["commits"],
                "added": r["added"],
                "deleted": r["deleted"],
                "activeDays": len(r["dates"]),
                "first": r["first"],
                "last": r["last"],
                "busiestDay": busiest_day,
                "busiestCount": busiest_count,
                "avatarUrl": avatar_url(r["email"], override=avatars.get(r["email"])),
                "highlight": bool(current_email) and r["email"] == current_email,
                "languages": top_languages(r["langs"]),
            }
        )

    # Top 3 contributors for each of the top 5 languages — the inverse of each
    # contributor's language mix. Ranks all authors (not just top_n) so shares
    # sum correctly; empty in API-only runs, where lang_stats is empty.
    lang_leaders = []
    lang_totals = sorted(
        ((lang, a + d) for lang, (a, d, _) in repo_langs.items() if lang != OTHER_LANG),
        key=lambda x: x[1],
        reverse=True,
    )
    for lang, lang_total in lang_totals[:5]:
        if lang_total <= 0:
            continue
        by_author = sorted(
            (
                (r["name"], r["email"], sum(r["langs"][lang][:2]))
                for r in ranked
                if lang in r["langs"]
            ),
            key=lambda x: x[2],
            reverse=True,
        )
        lang_leaders.append(
            {
                "name": lang,
                "color": NAME_COLOR.get(lang, OTHER_COLOR),
                "contributors": [
                    # email keys the segment to the contributor's chart colour
                    # and author popover on the dashboard side.
                    {
                        "name": name,
                        "email": email,
                        "pct": round(lines * 100 / lang_total, 1),
                        "avatarUrl": avatar_url(email, override=avatars.get(email)),
                    }
                    for name, email, lines in by_author[:3]
                    if lines > 0
                ],
            }
        )

    weeks_sorted = sorted(all_weeks)
    weekly_data = {
        r["email"]: [weekly_by_author[r["email"]].get(w, 0) for w in weeks_sorted] for r in top
    }
    daily_data = {r["email"]: dict(daily_by_author[r["email"]]) for r in top}

    commits_list = []
    for h, meta in commits_meta.items():
        if meta["email"] not in top_emails:
            continue
        a, d = line_stats.get(h, [0, 0])
        entry = {
            "h": h[:7],
            "s": (meta["subject"] or "")[:120],
            "e": meta["email"],
            "d": meta.get("iso") or "",
            "a": a,
            "l": d,
        }
        cl = lang_stats.get(h)
        if cl:
            ftypes = sorted(
                (
                    [name, NAME_COLOR.get(name, OTHER_COLOR), files]
                    for name, (_, _, files) in cl.items()
                ),
                key=lambda x: x[2],
                reverse=True,
            )
            entry["f"] = ftypes[:4]
        commits_list.append(entry)

    date_range = (
        {"start": min(all_dates), "end": max(all_dates)} if all_dates else {"start": "", "end": ""}
    )
    return {
        "repoName": repo_name,
        "githubBaseUrl": github_base,
        "defaultBranch": default_branch,
        "branchCount": branch_count,
        "repoSizeKb": repo_size_kb,
        "fileCount": file_count,
        "largestFiles": largest_files,
        "diskByPath": disk_by_path,
        "dateRange": date_range,
        "lastCommit": last_commit_iso,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "totals": {
            # Authored (no-merge) commits — equals the sum of contributors'
            # commits, so it's the denominator for every share/percentage.
            # Merges are tracked separately; the GitHub-comparable headline
            # (commits + merges) is composed at display time.
            "commits": total_commits,
            "merges": merge_count,
            "added": total_added,
            "deleted": total_deleted,
            "contributors": total_contributors,
        },
        "contributors": contributors,
        "weeks": weeks_sorted,
        "weeklyData": weekly_data,
        "dailyData": daily_data,
        "commits": commits_list,
        "tags": tags or [],
        "repoLanguages": repo_languages or top_languages(repo_langs),
        "repoLanguagesBasis": "size" if repo_languages else "churn",
        "langLeaders": lang_leaders,
        "frameworks": frameworks or [],
    }


def _sample_oids_per_email(commits_meta, target_emails, per_email=3):
    """Up to `per_email` oldest oids per email. Unknown-date commits sort last."""
    by_email = defaultdict(list)
    for h, meta in commits_meta.items():
        if meta["email"] in target_emails:
            by_email[meta["email"]].append((meta.get("iso") or "", h))
    sample = {}
    for email, items in by_email.items():
        items.sort(key=lambda x: (not x[0], x[0]))
        sample[email] = [h for _, h in items[:per_email]]
    return sample


def enrich_contributor_profiles(contributors, commits_meta, github_base, token=None):
    """In-place: attach `profile` dict to contributors using GitHub GraphQL."""
    if not github_base:
        return
    if token is None:
        token = get_github_token()
    if not token:
        return
    origin = ORIGIN_RE.match(github_base)
    if not origin:
        return
    # gh_graphql is hardcoded to api.github.com; skip Enterprise hosts so we
    # don't issue lookups against the wrong API.
    if (origin.group("https_host") or "").lower() != "github.com":
        return

    missing = [c for c in contributors if not c.get("login")]
    if missing:
        sample = _sample_oids_per_email(commits_meta, {c["email"] for c in missing})
        resolved = fetch_logins_for_commits(
            origin.group("owner"), origin.group("repo"), sample, token
        )
        for c in missing:
            login = resolved.get(c["email"])
            if login:
                c["login"] = login

    top_logins = [c["login"] for c in contributors if c.get("login")]
    profiles = fetch_user_profiles(top_logins, token)
    for c in contributors:
        p = profiles.get(c.get("login") or "")
        if p:
            c["profile"] = p


def render_html(data):
    """Inject the data payload into the bundled (or sibling) frontend template."""
    payload = f"window.__DATA__ = {json.dumps(data, ensure_ascii=False, separators=(',', ':'))};"
    template = TEMPLATE
    if template == "__TEMPLATE_PLACEHOLDER__":
        sibling = Path(__file__).resolve().parent / "web" / "dist" / "index.html"
        if not sibling.exists():
            sys.exit(
                f"error: unbuilt script and frontend bundle not found at {sibling} — "
                "run `bun run build` in web/ first"
            )
        template = sibling.read_text()
    if PLACEHOLDER not in template:
        sys.exit(f"error: placeholder {PLACEHOLDER!r} not found in template")
    return template.replace(PLACEHOLDER, payload)


def resolve_out_path(output, data, ext, multi):
    """Where to write the `ext` artifact.

    Single format with -o → that exact path. Multiple formats with -o → -o is a
    stem and `ext` is appended. No -o → /tmp/<owner>--<repo>.<ext>.
    """
    if output:
        p = Path(output).expanduser()
        return p.with_suffix("." + ext) if multi else p
    safe_name = _slugify(data["repoName"]) or "repo"
    owner = ""
    if data["githubBaseUrl"]:
        m = ORIGIN_RE.match(data["githubBaseUrl"])
        if m:
            owner = _slugify(m.group("owner"))
    stem = f"{owner}--{safe_name}" if owner else safe_name
    return Path("/tmp") / f"{stem}.{ext}"


def _md_cell(s):
    """Escape a string for use inside a Markdown table cell."""
    return (s or "").replace("|", "\\|").replace("\n", " ")


def _fmt_bytes(n):
    """Human-readable byte size: 12.3 KB / 4.6 MB. Mirrors the web's fmtSize."""
    v = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if v < 1024 or unit == "TB":
            return f"{int(v)} {unit}" if unit == "B" else f"{v:.1f} {unit}"
        v /= 1024


def _md_file_sizes(out, heading, payload):
    """Render a file-size section (largest files / disk by path) as a table.
    Skips entirely when the payload is absent (the remote path has neither)."""
    if not payload or not payload.get("items"):
        return
    out.append(f"## {heading}")
    out.append("")
    out.append("| Path | Size |")
    out.append("|------|-----:|")
    for it in payload["items"]:
        out.append(f"| `{_md_cell(it['path'])}` | {_fmt_bytes(it['bytes'])} |")
    other_bytes, other_count = payload.get("otherBytes", 0), payload.get("otherCount", 0)
    if other_count:
        out.append(
            f"| _… {other_count:,} more file{'' if other_count == 1 else 's'}_ "
            f"| {_fmt_bytes(other_bytes)} |"
        )
    out.append("")


def render_markdown(data):
    """A human + LLM readable Markdown report of the same data the HTML embeds.

    Sections backed by an empty list are skipped — the GraphQL remote path has
    no per-file language/framework data.
    """
    t = data["totals"]
    dr = data["dateRange"]
    out = []

    name = data["repoName"]
    base = data.get("githubBaseUrl")
    out.append(f"# repo-intel — {f'[{name}]({base})' if base else name}")
    out.append("")
    n_contrib = t["contributors"]
    # Headline commit count matches GitHub (authored + merges); the per-author
    # stats below use the merge-free t["commits"].
    merges = t.get("merges") or 0
    commits_all = t["commits"] + merges
    merge_note = f" ({merges:,} merge{'' if merges == 1 else 's'})" if merges else ""
    out.append(
        f"_{commits_all:,} commits · {dr['start'] or '?'} — {dr['end'] or '?'} · "
        f"{n_contrib:,} contributor{'' if n_contrib == 1 else 's'}_"
    )
    out.append("")

    out.append("## Totals")
    out.append("")
    out.append(f"- Commits: {commits_all:,}{merge_note}")
    out.append(f"- Lines: +{t['added']:,} / -{t['deleted']:,}")
    out.append(f"- Contributors: {t['contributors']:,}")
    out.append(f"- Default branch: `{data['defaultBranch']}`")
    branch_count = data.get("branchCount")
    if branch_count is not None:
        out.append(f"- Branches: {branch_count:,}")
    file_count = data.get("fileCount")
    if file_count is not None:
        out.append(f"- Files at HEAD: {file_count:,}")
    size_kb = data.get("repoSizeKb") or 0
    if size_kb:
        size = f"{size_kb / 1024:.1f} MB" if size_kb >= 1024 else f"{size_kb:,} KB"
        out.append(f"- Repo size: {size}")
    out.append("")

    _md_file_sizes(out, "Largest files (at HEAD)", data.get("largestFiles"))
    _md_file_sizes(out, "Disk usage by path (full history)", data.get("diskByPath"))

    contribs = data["contributors"]
    if contribs:
        out.append(f"## Top contributors ({len(contribs)})")
        out.append("")
        out.append("| # | Name | Commits | +/- | Active days | First | Last |")
        out.append("|--:|------|--------:|-----|------------:|-------|------|")
        for i, c in enumerate(contribs, 1):
            who = c["name"]
            if c.get("login"):
                who += f" (@{c['login']})"
            out.append(
                f"| {i} | {_md_cell(who)} | {c['commits']:,} | "
                f"+{c['added']:,}/-{c['deleted']:,} | {c['activeDays']:,} | "
                f"{c['first']} | {c['last']} |"
            )
        out.append("")

    langs = data.get("repoLanguages") or []
    if langs:
        out.append(f"## Languages (by {data.get('repoLanguagesBasis', 'size')})")
        out.append("")
        for lng in langs:
            out.append(f"- {lng['name']} — {lng['pct']}%")
        out.append("")

    fws = data.get("frameworks") or []
    if fws:
        out.append("## Frameworks")
        out.append("")
        for fw in fws:
            out.append(f"- **{fw['language']}**: {', '.join(fw.get('names') or [])}")
        out.append("")

    tags = data.get("tags") or []
    if tags:
        shown = tags[-50:][::-1]  # tags are oldest-first; show most recent, cap 50
        out.append(f"## Tags ({len(tags)})")
        out.append("")
        for tg in shown:
            date = (tg.get("date") or "")[:10]
            out.append(f"- `{tg['name']}`{f' ({date})' if date else ''}")
        if len(tags) > len(shown):
            out.append(f"- …and {len(tags) - len(shown):,} more")
        out.append("")

    commits = data.get("commits") or []
    if commits:
        recent = sorted(commits, key=lambda c: c.get("d") or "", reverse=True)[:25]
        out.append(f"## Recent commits (showing {len(recent)} of {len(commits):,})")
        out.append("")
        for c in recent:
            date = (c.get("d") or "")[:10]
            subj = (c.get("s") or "").replace("\n", " ")
            out.append(f"- `{c['h']}` {subj} — {c['e']}, {date} (+{c['a']:,}/-{c['l']:,})")
        out.append("")

    return "\n".join(out).rstrip() + "\n"


def main():
    (
        top_n,
        remote,
        output,
        no_open,
        no_cache,
        clone,
        commits_filter,
        since,
        until,
        formats,
        max_prs,
        max_issues,
        lanes,
        non_interactive,
    ) = parse_args(sys.argv[1:])

    token = None
    if remote:
        owner, repo = remote.split("/", 1)
        token = get_github_token()
        # --clone forces the bare-clone path even when a token is present: a
        # local clone unlocks per-author language churn the GraphQL history API
        # can't provide. The token (if any) is still used below for hovercard
        # enrichment, so `use_graphql` — not `token` — gates the API path.
        use_graphql = bool(token) and not clone

        if not use_graphql and not clone:
            print("No GitHub token — falling back to bare clone.", file=sys.stderr)

        interactive = sys.stdin.isatty() and sys.stderr.isatty() and not non_interactive

        # One GraphQL round-trip serves both interactive prompts below: repo
        # size for the clone offer, commit total for the subset choice.
        disk_kb = total = None
        if use_graphql and interactive:
            disk_kb, total = probe_remote_meta(owner, repo, token)

        # A clone unlocks per-author language churn the API can't give; if the
        # repo is small enough to clone quickly, offer the upgrade up front.
        if disk_kb is not None and disk_kb <= CLONE_SUGGEST_MAX_KB and prompt_clone(disk_kb):
            clone, use_graphql = True, False

        # Subset prompt only in the GraphQL path: probing total via the API is
        # cheap, and skipping `--commits N` actually saves network. In the
        # bare-clone path the full clone runs regardless, so the prompt would
        # only trim local display — pass `--commits` / `--since` for that.
        if use_graphql and interactive and not (commits_filter or since or until):
            # Gate on what load_cache accepts, not bare file existence — a
            # stale-version or corrupt cache file would otherwise suppress the
            # prompt while contributing zero commits to the fetch.
            cached_nodes, cached_complete = ([], False) if no_cache else load_cache(remote)
            if cached_nodes and not cached_complete:
                # Partial cache (an earlier subset choice): without asking, a
                # re-run would silently extend it to the full history.
                if total and total > len(cached_nodes):
                    commits_filter, since, until = prompt_more(len(cached_nodes), total)
            elif not cached_nodes and total and total > 1000:
                commits_filter, since, until = prompt_subset(total)

        if use_graphql:
            print(f"Fetching {remote} via GitHub GraphQL…", file=sys.stderr)
            print(
                "Note: per-contributor language stats need a clone — pass --clone to get them.",
                file=sys.stderr,
            )
        else:
            print(f"Cloning {remote} (bare) for local analysis…", file=sys.stderr)
        (
            repo_name,
            github_base,
            current_email,
            commits_meta,
            line_stats,
            avatars,
            logins,
            default_branch,
            repo_size_kb,
            tags,
            extras,
        ) = collect_remote(
            remote,
            token if use_graphql else None,
            no_cache=no_cache,
            commits_filter=commits_filter,
            since=since,
            until=until,
        )
    else:
        try:
            subprocess.check_output(["git", "rev-parse", "--git-dir"], stderr=subprocess.DEVNULL)
        except subprocess.CalledProcessError:
            sys.exit("error: not in a git repository (and no owner/repo argument given)")
        (
            repo_name,
            github_base,
            current_email,
            commits_meta,
            line_stats,
            avatars,
            logins,
            default_branch,
            repo_size_kb,
            tags,
            extras,
        ) = collect_local()

    if not commits_meta:
        sys.exit("error: no commits found")

    if commits_filter or since or until:
        total_before = len(commits_meta)
        commits_meta, line_stats = apply_filters(
            commits_meta, line_stats, commits_filter, since, until
        )
        print(f"  filtered: {len(commits_meta)}/{total_before} commits", file=sys.stderr)
        if not commits_meta:
            sys.exit("error: no commits match the given filters")
        # The merge tally is whole-history (collected before filtering, and
        # merges aren't in commits_meta to recount), so adding it to the now
        # date/subset-filtered authored total would inflate the "N commits"
        # headline. Drop it under any filter — the headline then reads as just
        # the commits in range.
        if extras:
            extras.pop("merge_count", None)

    tags = filter_tags_to_range(tags, commits_meta)

    data = build_data(
        top_n,
        repo_name,
        github_base,
        current_email,
        commits_meta,
        line_stats,
        avatars,
        logins,
        default_branch,
        repo_size_kb,
        tags,
        extras,
    )

    status_line("  enriching contributor profiles…", transient=True)
    enrich_contributor_profiles(data["contributors"], commits_meta, github_base, token=token)

    # --remote already resolved the token (possibly to ""); don't re-run gh.
    gh_token = get_github_token() if token is None else token
    status_line("  fetching repo details, pull requests and issues…", transient=True)
    social = fetch_repo_social(github_base, gh_token)
    if social:
        data.update(social)
    prs, pr_counts = fetch_pull_requests(github_base, gh_token, limit=max_prs)
    if prs is not None:
        data["pullRequests"] = prs
        data.update(pr_counts)
    issues, issue_counts = fetch_issues(github_base, gh_token, limit=max_issues)
    if issues is not None:
        data["issues"] = issues
        data.update(issue_counts)
    data["timelineLanes"] = lanes

    multi = len(formats) > 1
    builders = {
        "html": lambda: render_html(data),
        "json": lambda: json.dumps(data, indent=2, ensure_ascii=False),
        "md": lambda: render_markdown(data),
    }
    written = {}
    for fmt in formats:
        status_line(f"  generating {fmt}…", transient=True)
        content = builders[fmt]()
        out_path = resolve_out_path(output, data, fmt, multi)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(content)
        written[fmt] = out_path
        clear_status_line()
        print(f"Wrote {out_path}")

    print(
        f"  {data['totals']['commits'] + (data['totals'].get('merges') or 0)} commits · "
        f"{data['dateRange']['start']} — {data['dateRange']['end']} · "
        f"{data['totals']['contributors']} contributor"
        f"{'' if data['totals']['contributors'] == 1 else 's'}"
    )
    print("  top 3:")
    for c in data["contributors"][:3]:
        print(f"    {c['commits']:>5}  {c['name']} <{c['email']}>")

    # --no-open is HTML-only; json/md never open. A multi-format run still opens
    # the html artifact if one was written.
    html_path = written.get("html")
    if no_open or not html_path:
        return
    opener = "open" if sys.platform == "darwin" else "xdg-open"
    try:
        subprocess.run([opener, str(html_path)], check=False)
    except FileNotFoundError:
        webbrowser.open(html_path.as_uri())


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nAborted.", file=sys.stderr)
        sys.exit(130)
