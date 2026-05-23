<script lang="ts">
  // One contributor's commit-pattern punch card: an ECharts scatter chart laying
  // commit density across hour-of-day (x) and day-of-week (y). Dot size encodes
  // the per-cell commit count (scaled to this author's busiest cell). Clicking a
  // cell opens the commit-bucket popover. Rendered via {#each} in App from the
  // per-author point map (buildPunchPoints).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import type { Contributor } from "$types";
  import type { EChartsType, EChartsCoreOption } from "echarts/core";
  import type { AuthorPopover, CommitPopover } from "$lib/popovers";
  import type { PunchPoint } from "$lib/popovers";
  import { echart } from "$lib/actions";
  import { clr, accentWeekend } from "$lib/theme";

  let {
    authorPopover,
    contributor,
    url,
    index,
    points,
    commitPopover,
    linksEnabled,
  }: {
    authorPopover: AuthorPopover | undefined;
    contributor: Contributor;
    // Author-commits URL, or "#" for a local-only repo (no GitHub base) — in
    // which case the name renders as a non-navigating label (see the markup).
    url: string;
    index: number;
    points: PunchPoint[];
    commitPopover: CommitPopover | undefined;
    linksEnabled: boolean;
  } = $props();

  const color = $derived(clr(index));
  // "#" means a local-only repo (no GitHub base): render a non-navigating label,
  // dropping target/rel along with the href so they aren't left dangling.
  const href = $derived(url === "#" ? undefined : url);

  const HOURS = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const WEEKEND = new Set([5, 6]); // Sat, Sun — row indices into DAYS

  const option: EChartsCoreOption = $derived.by(() => {
    // Scale dot radius to this author's busiest cell so light contributors
    // still read — an absolute scale would render their cells as dust.
    const max = points.reduce((m, p) => Math.max(m, p[2]), 0) || 1;
    return {
      tooltip: {
        trigger: "item",
        formatter: (p: any): string => {
          const [h, dow, n] = p.value as PunchPoint;
          return `${DAYS[dow]} ${h}:00 · ${n} commit${n === 1 ? "" : "s"}`;
        },
      },
      grid: { left: 4, right: 10, top: 40, bottom: 4, containLabel: true },
      xAxis: {
        type: "category",
        data: HOURS,
        axisTick: { show: false },
        axisLabel: { fontSize: 9, interval: 3 },
        // interval: 0 forces a line at every hour (splitLine otherwise inherits
        // the label's interval: 3). The cycling colour array keeps the 4-hour
        // marks brighter while the in-between hours read as a faint subdivision.
        splitLine: {
          show: true,
          interval: 0,
          lineStyle: {
            color: [
              "rgba(255,255,255,0.06)",
              "rgba(255,255,255,0.03)",
              "rgba(255,255,255,0.03)",
              "rgba(255,255,255,0.03)",
            ],
          },
        },
      },
      yAxis: {
        // inverse so Monday sits on top, matching GitHub-style punch cards.
        type: "category",
        data: DAYS,
        inverse: true,
        axisTick: { show: false },
        axisLabel: { fontSize: 9 },
        // Faint, uniform row separators. Kept low because the weekend tint
        // amplifies the Sat/Sun line that sits inside it — at higher opacity it
        // became the chart's boldest rule, which read as a misplaced divider.
        splitLine: { show: true, lineStyle: { color: "rgba(255,255,255,0.035)" } },
        // Tint the Sat/Sun rows to match the weekend shading in the contributor
        // heatmap and timeline. Under `inverse: true`, ECharts shifts the
        // splitArea colour array by one band (verified in-browser): color[i]
        // paints the row for DAYS[i + 1], the top (Mon) band goes unpainted, and
        // the final slot is unused. So we colour slot i when DAYS[i + 1] is a
        // weekend, which lands the tint on the Sat and Sun rows.
        splitArea: {
          show: true,
          areaStyle: {
            color: DAYS.map((_, i) =>
              WEEKEND.has(i + 1) ? `rgba(${accentWeekend},0.05)` : "transparent",
            ),
          },
        },
      },
      series: [
        {
          type: "scatter",
          symbolSize: (val: number[]): number => 4 + (val[2] / max) * 14,
          itemStyle: { color: color + "cc" },
          data: points,
        },
      ],
    };
  });

  function onReady(chart: EChartsType): void {
    // Listen on the whole canvas (zrender) and snap the click to the nearest
    // grid cell, so a click near a dot opens its bucket without demanding a
    // pixel-perfect hit on the symbol.
    chart.getZr().on("click", (e: any) => {
      if (!commitPopover || !linksEnabled) return;
      const x = e.offsetX as number;
      const y = e.offsetY as number;
      if (!chart.containPixel("grid", [x, y])) return;
      const hour = Math.round(chart.convertFromPixel({ xAxisIndex: 0 }, x) as number);
      const dow = Math.round(chart.convertFromPixel({ yAxisIndex: 0 }, y) as number);
      if (hour < 0 || hour > 23 || dow < 0 || dow > 6) return;
      const list = commitPopover.commitsInCell(contributor.email, hour, dow);
      if (!list.length) return;
      // Pixel of the cell within the chart, then offset by the canvas rect.
      const px = chart.convertToPixel({ seriesIndex: 0 }, [hour, dow]) as number[];
      const rect = chart.getDom().getBoundingClientRect();
      const label = `${commitPopover.dowFull[dow]} ${hour}:00–${hour}:59`;
      commitPopover.show(
        { x: rect.left + px[0], top: rect.top + px[1], bottom: rect.bottom },
        contributor,
        index,
        label,
        list,
      );
    });
  }
</script>

<div class="card pattern-card">
  <!-- The title strip is pointer-events:none so chart clicks pass through; the
       name link re-enables pointer events for itself so it can carry the same
       author popover as the table/legends (telling apart same-named identities). -->
  <div class="chart-title">
    <a
      class="title-link"
      style="color:{color}"
      {href}
      target={href ? "_blank" : undefined}
      rel={href ? "noopener" : undefined}
      onmouseenter={(e) => authorPopover?.show(index, e.currentTarget)}
      onmouseleave={() => authorPopover?.hide()}>{contributor.name}</a
    >
  </div>
  <div class="ec" class:clickable={linksEnabled} use:echart={{ option, onReady }}></div>
</div>

<style>
  .pattern-card {
    position: relative;
    padding: 14px;
  }
  /* Re-enable pointer events for just the name (the title strip disables them so
     chart hover/clicks pass through), and strip the default anchor styling. */
  .title-link {
    pointer-events: auto;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
  .ec {
    width: 100%;
    height: 280px;

    &.clickable {
      cursor: pointer;
    }
  }
</style>
