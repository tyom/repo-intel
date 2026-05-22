// Pure formatting / string helpers ported verbatim from template.html.
import type { Contributor, RepoData } from "$types";

export const fmt = (n: number): string => n.toLocaleString();
export const pct = (n: number, t: number): string => (t ? (n / t) * 100 : 0).toFixed(1) + "%";

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
      (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as Record<string, string>)[
        m
      ],
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
  if (years < 10) return months === 0 ? pl(years, "year") : `${pl(years, "year")} and ${pl(months, "month")}`;
  return pl(years, "year");
}

// Link to a contributor's commits on the repo's default branch, or '#' for a
// local-only repo with no GitHub base.
export function authorUrl(D: RepoData, c: Contributor): string {
  if (!D.githubBaseUrl) return "#";
  return `${D.githubBaseUrl}/commits/${encodeBranch(D.defaultBranch)}?author=${encodeURIComponent(c.email)}`;
}

// GitHub code-search URL for a language within a repo, or '' when there's no
// GitHub base (local-only repo) or the bucket isn't a real language ("Other").
export function langSearchUrl(base: string | null | undefined, name: string): string {
  const m = /^(https?:\/\/[^/]+)\/(.+?)\/?$/.exec(base || "");
  if (!m || name === "Other") return "";
  return `${m[1]}/search?q=${encodeURIComponent(`repo:${m[2]} language:${name}`)}&type=code`;
}
