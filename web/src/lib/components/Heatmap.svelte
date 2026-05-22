<script lang="ts">
  // Contributions heatmap: GitHub-style calendar grid with a hover tooltip.
  // Svelte port of buildHeatmap() from the (now removed) lib/heatmap.ts — the
  // grid is reactive markup ({mode} drives a $derived rebuild), and the tooltip
  // is a single body-portaled node positioned with the shared portal/position
  // actions, like the popovers.
  import type { Mode, RepoData } from "../../types";
  import { colorHeatmap, bgEmptyCell } from "../theme";
  import { encodeBranch } from "../format";
  import { portal, position } from "../actions";

  let { data, mode = "current" }: { data: RepoData; mode?: Mode } = $props();

  // Interpolate from the empty-cell background toward the heatmap color.
  function shade(opacity: number): string {
    const r = parseInt(colorHeatmap.slice(1, 3), 16),
      g = parseInt(colorHeatmap.slice(3, 5), 16),
      b = parseInt(colorHeatmap.slice(5, 7), 16);
    const bg = { r: 22, g: 27, b: 34 };
    return `rgb(${Math.round(bg.r + (r - bg.r) * opacity)},${Math.round(bg.g + (g - bg.g) * opacity)},${Math.round(bg.b + (b - bg.b) * opacity)})`;
  }

  // Total commits per day, summed across all contributors.
  const daily = $derived.by(() => {
    const all: Record<string, number> = {};
    Object.values(data.dailyData).forEach((d) => {
      Object.entries(d).forEach(([k, v]) => {
        all[k] = (all[k] || 0) + v;
      });
    });
    return all;
  });

  const legendShades = $derived([
    bgEmptyCell,
    shade(0.25),
    shade(0.5),
    shade(0.75),
    colorHeatmap,
  ]);

  interface Cell {
    key: string;
    count: number;
    bg: string; // solid swatch (also the tooltip dot color)
    cellBg: string; // bg + weekend tint, painted on the cell
    href: string;
  }

  // Rebuilds whenever {mode} (or {data}) changes — the load-bearing reactivity
  // that the year toggles drive.
  const grid = $derived.by(() => {
    let startDate: Date, endDate: Date;
    if (mode == null || mode === "current") {
      endDate = new Date(data.dateRange.end);
      const today = new Date();
      if (today > endDate) endDate = today;
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 52 * 7 + 1);
      const startDow = (startDate.getDay() + 6) % 7;
      if (startDow !== 0) startDate.setDate(startDate.getDate() - startDow);
    } else {
      startDate = new Date(mode, 0, 1);
      endDate = new Date(mode, 11, 31);
    }

    const allDates: Date[] = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) allDates.push(new Date(d));

    type Day = { date: Date; key: string; count: number; dow: number };
    const weeksArr: Day[][] = [];
    let currentWeek: Day[] = [];
    allDates.forEach((d) => {
      const dow = (d.getDay() + 6) % 7;
      if (dow === 0 && currentWeek.length > 0) {
        weeksArr.push(currentWeek);
        currentWeek = [];
      }
      const key = d.toISOString().slice(0, 10);
      currentWeek.push({ date: d, key, count: daily[key] || 0, dow });
    });
    if (currentWeek.length) weeksArr.push(currentWeek);

    const maxCount = Math.max(...allDates.map((d) => daily[d.toISOString().slice(0, 10)] || 0), 1);
    function cellColor(count: number): string {
      if (count === 0) return bgEmptyCell;
      const ratio = count / maxCount;
      if (ratio <= 0.25) return shade(0.25);
      if (ratio <= 0.5) return shade(0.5);
      if (ratio <= 0.75) return shade(0.75);
      return colorHeatmap;
    }

    let lastMonth = "";
    const monthSpans: { label: string; count: number }[] = [];
    weeksArr.forEach((week) => {
      const m = week[0].date.toLocaleDateString("en-GB", { month: "short" });
      if (m !== lastMonth) {
        monthSpans.push({ label: m, count: 1 });
        lastMonth = m;
      } else monthSpans[monthSpans.length - 1].count++;
    });

    const baseUrl = data.githubBaseUrl;
    const branchPath = encodeBranch(data.defaultBranch);
    const lastWi = weeksArr.length - 1;
    const weeks = weeksArr.map((week, wi) => ({
      lead: wi === 0 ? week[0].dow : 0,
      trail: wi === lastWi ? 6 - week[week.length - 1].dow : 0,
      cells: week.map((day): Cell => {
        const bg = cellColor(day.count);
        const cellBg =
          day.dow >= 5
            ? `linear-gradient(rgba(240,170,90,0.05),rgba(240,170,90,0.05)),${bg}`
            : bg;
        const href = baseUrl
          ? `${baseUrl}/commits/${branchPath}?after=&since=${day.key}&until=${day.key}`
          : "#";
        return { key: day.key, count: day.count, bg, cellBg, href };
      }),
    }));

    return { monthSpans, weeks };
  });

  const dayLabels = ["Mon", "", "Wed", "", "Fri", "", ""];

  // === Hover tooltip ===
  let tipNode = $state<HTMLElement>();
  let hovered = $state<{ key: string; count: number; color: string; rect: DOMRect } | null>(null);

  const tipLabel = $derived(
    hovered ? (hovered.count === 0 ? "No commits" : `${hovered.count} commit${hovered.count === 1 ? "" : "s"}`) : "",
  );
  const tipDate = $derived(
    hovered
      ? new Date(hovered.key + "T00:00:00").toLocaleDateString("en-GB", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "",
  );

  function showTip(cell: Cell, el: HTMLElement) {
    hovered = { key: cell.key, count: cell.count, color: cell.bg, rect: el.getBoundingClientRect() };
  }
  // Only clear if we're still on the cell we last entered — guards against
  // out-of-order leave/enter when the pointer crosses a cell boundary fast.
  function hideTip(cell: Cell) {
    if (hovered?.key === cell.key) hovered = null;
  }

  // Place the tooltip above the cell (flip below if it'd clip the top), and set
  // the arrow position + side directly on the node (neither affects the box's
  // measured size, so this is safe inside place()).
  function place(m: { w: number; h: number; vw: number; vh: number }) {
    const a = hovered?.rect;
    if (!a) return null;
    const margin = 8,
      gap = 6,
      cx = a.left + a.width / 2;
    let left = Math.max(margin, Math.min(cx - m.w / 2, m.vw - m.w - margin));
    let top = a.top - m.h - gap;
    let side = "above";
    if (top < margin) {
      top = a.bottom + gap;
      side = "below";
    }
    if (top + m.h + margin > m.vh) top = Math.max(margin, m.vh - m.h - margin);
    if (tipNode) {
      tipNode.dataset.side = side;
      tipNode.style.setProperty("--arrow-left", Math.max(8, Math.min(m.w - 8, cx - left)) + "px");
    }
    return { left, top };
  }
</script>

<div class="heatmap-wrap">
  <div class="heatmap-months">
    {#each grid.monthSpans as ms}
      <span style="flex:{ms.count} {ms.count} 0;text-align:left;">{ms.label}</span>
    {/each}
  </div>
  <div class="heatmap-grid">
    <div class="heatmap-day-labels">
      {#each dayLabels as l}<span>{l}</span>{/each}
    </div>
    <div class="heatmap">
      {#each grid.weeks as week}
        <div class="heatmap-week">
          {#each Array(week.lead) as _}
            <div class="heatmap-cell" style="visibility:hidden;"></div>
          {/each}
          {#each week.cells as cell (cell.key)}
            <a
              href={cell.href}
              target="_blank"
              class="heatmap-cell"
              style="background:{cell.cellBg};"
              aria-label="{cell.count} commit{cell.count === 1 ? '' : 's'} on {cell.key}"
              onmouseenter={(e) => showTip(cell, e.currentTarget)}
              onmouseleave={() => hideTip(cell)}
            ></a>
          {/each}
          {#each Array(week.trail) as _}
            <div class="heatmap-cell" style="visibility:hidden;"></div>
          {/each}
        </div>
      {/each}
    </div>
  </div>
  <div class="heatmap-legend">
    <span>Less</span>
    {#each legendShades as s}
      <div class="heatmap-cell" style="background:{s};"></div>
    {/each}
    <span>More</span>
  </div>
</div>

<div class="heatmap-tooltip" bind:this={tipNode} use:portal use:position={{ visible: hovered != null, place }}>
  {#if hovered}
    <span class="tt-dot" style="background:{hovered.color}"></span>
    <span class="tt-date">{tipLabel}</span>
    <span class="tt-count">on {tipDate}</span>
  {/if}
</div>
