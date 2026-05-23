# repo-intel

Generate a self-contained HTML **contributor-stats dashboard** for any git
repo — top contributors, weekly/daily activity, time-of-day patterns,
per-author commit feeds, plus a **language** breakdown and **framework**
detection from dependency manifests.

The shipped tool is a single file (`dist/repo-intel`) with the HTML template
and detection data embedded, so it depends only on **Python 3 + `git`**
(optional [`gh`](https://cli.github.com/) for remote repos and author
hovercards). No install step, no third-party packages.

Use it four ways:

- **[Homebrew](#homebrew)** — `brew install tyom/tap/repo-intel`.
- **[curl installer](#install-with-curl)** — drop `repo-intel` on your PATH with
  one command.
- **[curl-pipe](#run-without-installing)** — run the script straight from a URL,
  no install.
- **[GitHub Action](#github-action--publish-to-github-pages)** — publish a
  dashboard for your repo to GitHub Pages.

## GitHub Action — publish to GitHub Pages

Add a workflow (copy [`examples/pages.yml`](examples/pages.yml) to
`.github/workflows/repo-intel.yml`):

```yaml
name: Repo Intel
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # required — repo-intel reads full git history
      - uses: tyom/repo-intel@v1 # moves with v1.x; pin @v1.0.0 to lock a version
        with:
          contributors: "10" # optional, top N
          output: public # optional, dir for index.html
      - uses: actions/upload-pages-artifact@v3
        with:
          path: public
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Then enable Pages: **Settings → Pages → Build and deployment → Source: GitHub
Actions**.

> **`fetch-depth: 0` is required.** `repo-intel` reads the full commit history
> in local mode; the default shallow checkout would show only one commit.

### Action inputs

| Input          | Default  | Description                                                        |
| -------------- | -------- | ------------------------------------------------------------------ |
| `contributors` | `10`     | Number of top contributors to include.                             |
| `output`       | `public` | Directory to write the dashboard into (`index.html` inside).       |
| `args`         | `""`     | Extra flags forwarded to `repo-intel` (e.g. `--since 2024-01-01`). |

The action generates the dashboard only — you keep control of the Pages
deploy via `upload-pages-artifact` + `deploy-pages` (above), so the workflow's
permissions and concurrency stay yours.

## Homebrew

```bash
brew install tyom/tap/repo-intel
```

(Resolves to the [`tyom/homebrew-tap`](https://github.com/tyom/homebrew-tap)
tap.)

## Install with curl

No Homebrew? Drop the latest release onto your PATH:

```bash
curl -fsSL https://tyom.github.io/repo-intel/install.sh | sh
```

Installs to `~/.local/bin/repo-intel` (override with
`REPO_INTEL_BIN=/some/dir`). Needs only `sh`, `curl`/`wget`, and Python 3.

## Run without installing

Pipe the artifact straight into Python — no clone, no install:

```bash
curl -sSL https://github.com/tyom/repo-intel/releases/latest/download/repo-intel \
  | python3 - <owner/repo>
```

Everything after `python3 -` is forwarded to the script. Replace
`<owner/repo>` with the GitHub repo you want stats for (e.g. `tyom/repo-intel`),
or drop it to run against the current directory's git repo. Append `--help`
for the full flag reference:

```bash
curl -sSL https://github.com/tyom/repo-intel/releases/latest/download/repo-intel \
  | python3 - --help
```

The `releases/latest/download/` URL always resolves to the newest release; swap
`latest/download` for a tag (e.g. `download/v1.0.0`) to pin a version.

In this mode stdin is the script body, so the interactive subset prompt for
large remote repos is auto-skipped and the script fetches all commits — pass
`--commits N` (or `--since` / `--until`) to trim the fetch on big repos.

## Usage

```
repo-intel [N] [REPO] [options]
```

- `N` — number of top contributors to include (default `10`).
- `REPO` — `owner/repo`, `https://github.com/owner/repo`, or
  `remote:owner/repo`. Omit to use the cwd's git repo.

Run `repo-intel --help` for the full flag reference.

### Modes

- **Local** — no `REPO`. Reads `git log` from the current working directory.
- **Remote (GraphQL)** — `REPO` plus a GitHub token from
  `gh auth token -h github.com` or `$GITHUB_TOKEN`. Fetches via the GitHub
  GraphQL API.
- **Remote (bare-clone fallback)** — `REPO` with no token. Clones to
  `/tmp/repo-intel-<owner>-<repo>.git` and reads locally. Subsequent runs
  `git fetch` the cached bare clone. Force it with `--clone` even when a token
  is present (unlocks per-author language churn the GraphQL path can't give).

The [GitHub CLI (`gh`)](https://cli.github.com/) is optional but recommended:
when authenticated (`gh auth login`), `repo-intel` uses its token to fetch
remote repos and to enrich author cards with GitHub profile data. Without it,
the script falls back to `$GITHUB_TOKEN` or a bare clone.

### Filtering commits

| Flag                 | Meaning                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `--commits N`        | Last `N` commits (newest)                                                |
| `--commits A-B`      | Positions `[A, B)` counted from the oldest commit (0-indexed, half-open) |
| `--since YYYY-MM-DD` | Commits on or after the date (inclusive)                                 |
| `--until YYYY-MM-DD` | Commits on or before the date (inclusive)                                |

Filters compose: date bounds apply first, then the position slice. The run
prints `filtered: X/total commits` so you can see what was kept.

When a remote repo has more than 1000 commits and no filter flag was passed,
`repo-intel` prompts interactively for a subset (Last 500, Last 1000, Past
year, or All) on the GraphQL path. The prompt is skipped on the bare-clone
fallback, when stdin/stderr is not a TTY, or when any filter flag is given.

### Output

| Flag                | Default                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `--format LIST`     | `html`. Comma-separated, repeatable: `html`, `json`, `md` (e.g. `--format html,json,md`)       |
| `-o, --output PATH` | `/tmp/<owner>--<repo>.<ext>` (or `/tmp/<repo>.<ext>` for a local repo without a GitHub origin) |
| `--no-open`         | Opens the **HTML** result in your default browser unless given                                 |

`json` is the raw analysis data (the same object the HTML embeds); `md` is a
Markdown report — totals, a top-contributors table, language/framework
breakdowns, tags, and recent commits — for reading or feeding to an LLM.

With a single `--format`, `-o PATH` is used verbatim. With several, `-o` is a
stem and each format appends its own extension (`-o ./stats` → `stats.html`,
`stats.json`, `stats.md`). Only the HTML artifact is ever opened in a browser.
`--output` creates parent directories if they don't exist.

### Cache

Remote runs cache commit nodes per repo under `$XDG_CACHE_HOME/repo-intel`
(default `~/.cache/repo-intel`), one JSON file per repo. The next run
paginates from HEAD and stops at the first already-cached SHA, so only new
commits hit the network.

- `--no-cache` — ignore the cache and re-fetch everything.
- Delete the relevant `<owner>-<repo>.json` to force a fresh fetch for one repo.

### Examples

```bash
repo-intel                                            # cwd, top 10
repo-intel 20                                         # cwd, top 20
repo-intel tyom/repo-intel                            # remote, top 10
repo-intel --commits 100 facebook/react               # last 100 commits
repo-intel --commits 0-100 facebook/react             # first 100 commits
repo-intel --since 2024-01-01 --until 2024-12-31 .    # all of 2024 in cwd
repo-intel --no-open -o ./stats.html tyom/repo-intel  # save without opening
repo-intel --format json,md facebook/react            # JSON + Markdown, no HTML
repo-intel --format html,json,md -o ./out             # all three: out.{html,json,md}
repo-intel facebook/react --clone                     # analyse via bare clone
```

## Development

| File                      | Purpose                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `repo-intel.py`           | The script. Holds `TEMPLATE` + `TECHDATA` placeholders until bundled                               |
| `web/`                    | Frontend app (Svelte 5 + Vite + TypeScript). `bun run build` → `web/dist/index.html`               |
| `web/src/App.svelte`      | Root component — composes the dashboard from the `lib/components/` pieces                          |
| `web/src/lib/components/` | Dashboard UI as Svelte components — heatmap, table, charts, cards, popovers (one `.svelte` each)   |
| `web/src/lib/`            | Shared engine helpers: ECharts registration, the canvas timeline, popover state, theme, formatting |
| `techdata.json`           | Generated language + framework detection data (committed; embedded at build)                       |
| `gen_techdata.py`         | Regenerates `techdata.json` from GitHub Linguist + a curated framework map                         |
| `build.py`                | Substitutes the `TEMPLATE` / `TECHDATA` lines with their data as a `repr()`                        |
| `dist/repo-intel`         | The built single-file artifact (committed; this is what curl/Action/Homebrew use)                  |

The frontend is built with [Bun](https://bun.sh). It compiles to a single
self-contained `web/dist/index.html` (all JS + CSS inlined, Apache ECharts
bundled, no CDN) that still carries the `/*__DATA_INJECTION__*/` marker; `build.py` embeds
that HTML into `repo-intel.py`. Bun/Vite are **build-time only** — the shipped
tool is still a zero-dependency Python script.

```bash
make install-hooks   # one-time per clone: auto-rebuild dist on commit
make web-dev         # frontend dev server with HMR (renders web/public/mock-data.json)
make build           # rebuild the frontend bundle + dist/repo-intel
make techdata        # regenerate techdata.json from Linguist (needs network)
make dev ARGS="3 facebook/react"   # build frontend, then run from source live
make format          # format the whole repo (Prettier + Ruff)
make check           # run all static checks — Prettier + Ruff + svelte-check (mirrors CI)
```

`make web-dev` runs Vite's dev server with hot-reload against
`web/public/mock-data.json`, so you can iterate on the UI without the Python
side. `make dev` builds the frontend then runs the unbundled script (it detects
`TEMPLATE` is still the placeholder and reads `web/dist/index.html` /
`techdata.json` from disk).

> Commit `dist/repo-intel` alongside source changes — CI fails if it's stale.
> Run `make install-hooks` once after cloning: it points `core.hooksPath` at
> the tracked `.githooks/`, whose `pre-commit` rebuilds the frontend bundle and
> stages `dist/repo-intel` whenever you commit a change to `repo-intel.py`,
> `techdata.json`, or anything under `web/`. (This needs Bun installed; the
> first rebuild after a clone runs `bun install`.) The weekly `refresh-techdata`
> workflow rebuilds it automatically when Linguist changes.

### Releasing

Run the **Cut release** workflow (Actions → _Cut release_ → _Run workflow_) and
enter a version like `1.2.3`. It validates main, re-runs the CI gates and a
smoke test against that exact commit, and only then tags `vX.Y.Z` — so a tag is
never created for a red build. The tag drives the rest automatically: the
`Release` workflow builds and publishes the GitHub release (with generated
notes) + the single-file asset, smoke-tests the published artifact, moves the
floating `vX` major tag (skipped for prereleases, and guarded so it can only
point at a commit on `main`), and bumps the [`tyom/homebrew-tap`](https://github.com/tyom/homebrew-tap)
formula. Nothing is manual per release beyond entering the number.

Pushing a `vX.Y.Z` tag by hand still works as a fallback and runs the same
`Release` workflow — but it skips the pre-tag build gate, so prefer _Cut
release_.

**Syncing tags locally.** Because `Release` _force-moves_ the floating `vX`
major tag onto each new release commit, a plain `git fetch --tags` refuses to
update it (`! [rejected] vX -> vX (would clobber existing tag)`). Pull the
realigned tags with:

```sh
git fetch --tags --force --prune origin
```

The `vX.Y.Z` tags are immutable and always fetch cleanly; only the floating
`vX` tag needs `--force`.

### Detection data (`techdata.json`)

Language detection (extension/filename → language, colors, vendored-path noise
filter) is generated from [GitHub Linguist](https://github.com/github-linguist/linguist)
— `languages.yml` (with fine-grained languages folded into their `group`, e.g.
`TSX`→`TypeScript`) and `vendor.yml`. Frameworks are a small curated
dependency → framework map maintained in `gen_techdata.py`. `techdata.json` is
committed and embedded into the artifact, so the shipped tool stays offline and
single-file.

### How the embedding works

`build.py` looks for exactly one occurrence each of:

```python
TEMPLATE = "__TEMPLATE_PLACEHOLDER__"
TECHDATA = "__TECHDATA_PLACEHOLDER__"
```

and replaces them with `TEMPLATE = <repr(template_html)>` and
`TECHDATA = <repr(techdata_json)>`, producing a valid Python file carrying
both as string literals. The runtime substitution of `/*__DATA_INJECTION__*/`
with `window.__DATA__ = {...}` still happens inside `main()`.

## License

[MIT](LICENSE)
