// Shared scaffolding for the repo-wide OverallCharts cards. Contributors are
// aggregated by email, so one person who committed under several addresses (old
// work emails, a noreply alias) shows up as several rows that all share one
// display name. ECharts keys legend selection by the series/slice name, so
// identical names would collapse into a single legend entry and toggle together.
// Every card therefore names its series/slice by the (unique) email under the
// hood, hides ECharts' own legend, and renders the HTML legend (ChartLegend)
// below — plain names, one entry per identity. These helpers map email ↔ name ↔
// original contributor index so the cards can share that mapping.
import { clr } from "$lib/theme";
import type { Contributor } from "$types";

// Legend rows for the weekly-commits line and the commit-share pie. `idx` is the
// original contributor index (so clr() and the author popover line up); the pie
// gains a non-author "Others" row (idx -1 → no popover) when the top-N don't
// cover every commit.
export type LegendItem = { key: string; name: string; color: string; idx: number };

// Email → display name, for tooltips that key series by the unique email.
export const buildNameByEmail = (contributors: Contributor[]): Map<string, string> =>
  new Map(contributors.map((c) => [c.email, c.name] as const));

// Email → original contributor index, so a chart that filters/re-sorts a local
// copy (the churn bars) can still resolve the right person's colour and popover.
export const buildEmailToOrig = (contributors: Contributor[]): Map<string, number> =>
  new Map(contributors.map((c, i) => [c.email, i] as const));

export const buildContribLegend = (contributors: Contributor[]): LegendItem[] =>
  contributors.map((c, i) => ({ key: c.email, name: c.name, color: clr(i), idx: i }));

// Contributors with their original index, minus bots. A `[bot]` login (the ones
// repo-intel.py skips for profiles — Renovate, CI accounts) churns nothing like a
// human and only flattens everyone else's scale, so the churn and commit-style
// charts drop them. `origIdx` is preserved so each row still resolves the right
// identity colour (clr) and author popover after the chart re-sorts its own copy.
export const humanContribRows = (
  contributors: Contributor[],
): { c: Contributor; origIdx: number }[] =>
  contributors.map((c, origIdx) => ({ c, origIdx })).filter((r) => !r.c.login.endsWith("[bot]"));

// Half-transparent dark inner border on the treemap tiles, so each grey/brand
// tile reads against the gap around it (shared by the languages and files
// treemaps).
export const tileInnerBorder = "rgba(0, 0, 0, 0.6)";
