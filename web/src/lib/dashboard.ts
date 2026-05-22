// Wires the dashboard together: derives the client-side computed fields, then
// renders each section in the same order as the original template.html script.
// Call once after the static layout (App.svelte) is in the DOM.
import type { RepoData } from "../types";
import { configureCharts } from "./theme";
import { renderHeader, renderTech } from "./header";
import { initHeatmap } from "./heatmap";
import { buildTimeline } from "./timeline";
import { renderTable } from "./table";
import { renderCharts } from "./charts";
import { initScrollRows, initSidebar } from "./interactions";
import { createAuthorPopover, createCommitPopover } from "./popovers";

export function initDashboard(D: RepoData): void {
  // Client-side derived fields (mirrors template.html lines 326-327).
  D.totals.net = D.totals.added - D.totals.deleted;
  D.contributors.forEach((c) => {
    c.net = c.added - c.deleted;
    c.lc = +(c.net / c.commits).toFixed(1);
    c.avgPerDay = +(c.commits / c.activeDays).toFixed(1);
  });

  configureCharts();
  renderHeader(D);

  const allDaily: Record<string, number> = {};
  Object.values(D.dailyData).forEach((d) => {
    Object.entries(d).forEach(([k, v]) => {
      allDaily[k] = (allDaily[k] || 0) + v;
    });
  });
  initHeatmap(D, allDaily);

  renderTech(D);

  const authorPopover = createAuthorPopover(D.contributors);
  buildTimeline(D, authorPopover);
  renderTable(D, authorPopover);

  const commitPopover = createCommitPopover(D);
  renderCharts(D, commitPopover);

  initScrollRows();
  initSidebar();
}
