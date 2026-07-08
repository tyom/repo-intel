// Pure formatting / string helpers ported verbatim from template.html.
import type { Contributor, RepoData } from "$types";

export const fmt = (n: number): string => n.toLocaleString();
export const pct = (n: number, t: number): string => (t ? (n / t) * 100 : 0).toFixed(1) + "%";

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function fmtSize(kb: number): string {
  if (!kb || kb <= 0) return "";
  const units = ["KB", "MB", "GB", "TB"];
  let v = kb,
    i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const s = v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, "");
  return `${s} ${units[i]}`;
}

// Byte-accurate size, for the file-size treemaps. fmtSize works in KB and so
// can't render sub-KB blobs; this starts at bytes.
export function fmtBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes,
    i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  if (i === 0) return `${v} B`;
  const s = v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, "");
  return `${s} ${units[i]}`;
}

// "12 minutes ago" / "2 days ago" / "1 year ago", relative to `now` (the
// browser's clock at render time, so a stale report reads as old). Returns ""
// for an unparseable timestamp.
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const secs = Math.max(0, Math.round((now.getTime() - t) / 1000));
  const ago = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"} ago`;
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return ago(mins, "minute");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return ago(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return ago(days, "day");
  if (days < 30) return ago(Math.floor(days / 7), "week");
  if (days < 365) return ago(Math.floor(days / 30), "month");
  return ago(Math.floor(days / 365), "year");
}

// Coarse single-unit duration ("42 min" / "18 h" / "12 days" / "4 months"),
// for PR open-time readouts. "" for negative/NaN input.
export function fmtDuration(ms: number): string {
  if (Number.isNaN(ms) || ms < 0) return "";
  const h = ms / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  const days = Math.round(h / 24);
  if (days < 90) return `${days} days`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months`;
  return `${(days / 365.25).toFixed(1).replace(/\.0$/, "")} years`;
}

// Full timestamp for the hover title behind a relative time. "" when unparseable.
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

export const weekLabel = (w: string): string => {
  const [y, wn] = w.split("-W").map(Number);
  const jan4 = new Date(y, 0, 4);
  const d = new Date(jan4.getTime() + ((wn - 1) * 7 - ((jan4.getDay() + 6) % 7)) * 86400000);
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
};

export function escapeHtml(s: unknown): string {
  return String(s).replace(
    /[&<>"']/g,
    (m) =>
      (
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<
          string,
          string
        >
      )[m],
  );
}

// GitHub branch paths preserve slashes (`feature/foo`), so encode segment-wise.
export function encodeBranch(b: string | null | undefined): string {
  return (b || "main").split("/").map(encodeURIComponent).join("/");
}

export function fmtTimelineDuration(start: string, end: string): string {
  // start/end are UTC-derived "YYYY-MM-DD" strings; parse directly so this
  // doesn't shift by a day in non-UTC timezones.
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  const ms = re.exec(start),
    me = re.exec(end);
  if (!ms || !me) return "";
  const sY = +ms[1],
    sM = +ms[2],
    sD = +ms[3];
  const eY = +me[1],
    eM = +me[2],
    eD = +me[3];
  const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  let years = eY - sY;
  let months = eM - sM;
  if (eD < sD) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const totalMonths = years * 12 + months;
  if (totalMonths < 1) {
    const days = Math.round((Date.UTC(eY, eM - 1, eD) - Date.UTC(sY, sM - 1, sD)) / 86400000) + 1;
    return pl(Math.max(1, days), "day");
  }
  if (totalMonths < 12) return pl(totalMonths, "month");
  if (years < 10)
    return months === 0 ? pl(years, "year") : `${pl(years, "year")} and ${pl(months, "month")}`;
  return pl(years, "year");
}

// githubBaseUrl without any trailing slash (safe to join paths onto), or null
// for a local-only repo.
export const repoBase = (D: RepoData): string | null =>
  D.githubBaseUrl ? D.githubBaseUrl.replace(/\/$/, "") : null;

// GitHub page for a pull request, or null when there's no GitHub base.
export function prPageUrl(D: RepoData, n: number): string | null {
  const base = repoBase(D);
  return base && n ? `${base}/pull/${n}` : null;
}

// GitHub page for an issue, or null when there's no GitHub base.
export function issuePageUrl(D: RepoData, n: number): string | null {
  const base = repoBase(D);
  return base && n ? `${base}/issues/${n}` : null;
}

// Link to a contributor's commits on the repo's default branch, or '#' for a
// local-only repo with no GitHub base.
export function authorUrl(D: RepoData, c: Contributor): string {
  if (!D.githubBaseUrl) return "#";
  return `${D.githubBaseUrl}/commits/${encodeBranch(D.defaultBranch)}?author=${encodeURIComponent(c.email)}`;
}

// Synthetic buckets (see SYNTHETIC_COLORS in gen_techdata.py) aren't real GitHub
// languages, so `language:` can't resolve them. Map the ones with a clean extension
// set to a `path:` glob (grouped so the repo: scope covers every clause); the rest
// (e.g. "Tools" — a grab-bag of Dockerfiles/Makefiles/lockfiles) have no tidy query.
const SYNTHETIC_PATH_QUERY: Record<string, string> = {
  "Gettext Catalog": "(path:*.po OR path:*.pot)",
};
const UNLINKED_BUCKETS = new Set(["Other", "Tools"]);

// GitHub code-search URL for a language within a repo, or '' when there's no GitHub
// base (local-only repo) or the bucket has no resolvable query.
export function langSearchUrl(base: string | null | undefined, name: string): string {
  const m = /^(https?:\/\/[^/]+)\/(.+?)\/?$/.exec(base || "");
  if (!m || UNLINKED_BUCKETS.has(name)) return "";
  const [, origin, repo] = m;
  // Multi-word names must be quoted, or GitHub reads only the first word as the
  // language (e.g. `language:Common Lisp` → `language:Common` + loose "Lisp").
  const query = SYNTHETIC_PATH_QUERY[name] ?? `language:${/\s/.test(name) ? `"${name}"` : name}`;
  return `${origin}/search?q=${encodeURIComponent(`repo:${repo} ${query}`)}&type=code`;
}
