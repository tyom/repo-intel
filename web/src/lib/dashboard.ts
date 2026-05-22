// Wires the dashboard together: derives the client-side computed fields, then
// renders each section in the same order as the original template.html script.
// Call once after the static layout (App.svelte) is in the DOM.
import type { RepoData } from "../types";
import { configureCharts } from "./theme";
import { initHeatmap, type Mode } from "./heatmap";
import { buildTimeline } from "./timeline";
import { renderCharts } from "./charts";
import { initScrollRows, initSidebar } from "./interactions";
import { createCommitPopover, type AuthorPopover } from "./popovers";

// The summary table is now a Svelte component (lib/components/Table.svelte); the
// author popover it shares with the timeline is created by App.svelte and passed
// in here so both halves wire to the same singleton. Returns the imperative
// bridges App needs to wire to Svelte components — currently the heatmap rebuild
// the year toggles call on selection.
export interface DashboardBridges {
  rebuildHeatmap: (mode: Mode) => void;
}

export function initDashboard(D: RepoData, authorPopover: AuthorPopover): DashboardBridges {
  // Client-side derived fields (mirrors template.html lines 326-327).
  D.totals.net = D.totals.added - D.totals.deleted;
  D.contributors.forEach((c) => {
    c.net = c.added - c.deleted;
    c.lc = c.commits ? +(c.net / c.commits).toFixed(1) : 0;
    c.avgPerDay = c.activeDays ? +(c.commits / c.activeDays).toFixed(1) : 0;
  });

  configureCharts();

  const allDaily: Record<string, number> = {};
  Object.values(D.dailyData).forEach((d) => {
    Object.entries(d).forEach(([k, v]) => {
      allDaily[k] = (allDaily[k] || 0) + v;
    });
  });
  const rebuildHeatmap = initHeatmap(D, allDaily);

  buildTimeline(D, authorPopover);

  const commitPopover = createCommitPopover(D);
  renderCharts(D, commitPopover);

  initScrollRows();
  initSidebar();

  return { rebuildHeatmap };
}
