// Wires the dashboard together: derives the client-side computed fields, then
// renders each section in the same order as the original template.html script.
// Call once after the static layout (App.svelte) is in the DOM.
import type { RepoData } from "../types";
import { buildTimeline } from "./timeline";
import { renderCharts } from "./charts";
import { initScrollRows, initSidebar } from "./interactions";
import { createCommitPopover, type AuthorPopover } from "./popovers";

// The summary table and contributions heatmap are now Svelte components; the
// author popover the timeline shares with the table is created by App.svelte and
// passed in here so both halves wire to the same singleton. This wires the
// remaining imperative pieces: the timeline, the Chart.js charts, and the
// scroll-row / sidebar behavior.
export function initDashboard(D: RepoData, authorPopover: AuthorPopover): void {
  // Client-side derived fields (mirrors template.html lines 326-327).
  D.totals.net = D.totals.added - D.totals.deleted;
  D.contributors.forEach((c) => {
    c.net = c.added - c.deleted;
    c.lc = c.commits ? +(c.net / c.commits).toFixed(1) : 0;
    c.avgPerDay = c.activeDays ? +(c.commits / c.activeDays).toFixed(1) : 0;
  });

  buildTimeline(D, authorPopover);

  const commitPopover = createCommitPopover(D);
  renderCharts(D, commitPopover);

  initScrollRows();
  initSidebar();
}
