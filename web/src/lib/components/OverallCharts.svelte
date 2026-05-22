<script lang="ts">
  // The repo-wide ECharts charts: weekly-commits line (stacked area), commit-share
  // pie, lines added-vs-deleted bar, net-lines-per-commit bar, and a languages-by-
  // contributor treemap. The line and pie carry a "Reset" affordance that reappears
  // once the legend hides a series; Reset re-selects every series. Each chart mounts
  // through the `echart` action (div + setOption + auto-resize + dispose).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import type { RepoData } from "$types";
  import type { EChartsType, EChartsCoreOption } from "echarts/core";
  import { echart } from "$lib/actions";
  import {
    clr,
    textPrimary,
    textMuted,
    borderDefault,
    bgCard,
    colorAdded,
    colorDeleted,
  } from "$lib/theme";
  import { weekLabel } from "$lib/format";

  let { data }: { data: RepoData } = $props();

  // The Reset button shows (via .has-hidden on the card) once the legend has
  // hidden at least one series, and re-selects everything when clicked.
  let timelineHasHidden = $state(false);
  let pieHasHidden = $state(false);
  let timelineChart: EChartsType | undefined;
  let pieChart: EChartsType | undefined;

  const someHidden = (p: any): boolean => Object.values(p.selected).some((v) => v === false);
  function onTimelineReady(c: EChartsType): void {
    timelineChart = c;
    c.on("legendselectchanged", (p: any) => (timelineHasHidden = someHidden(p)));
  }
  function onPieReady(c: EChartsType): void {
    pieChart = c;
    c.on("legendselectchanged", (p: any) => (pieHasHidden = someHidden(p)));
  }
  function resetTimeline(): void {
    timelineChart?.dispatchAction({ type: "legendAllSelect" });
    timelineHasHidden = false;
  }
  function resetPie(): void {
    pieChart?.dispatchAction({ type: "legendAllSelect" });
    pieHasHidden = false;
  }

  // All five chart options, derived from data (data is set once at mount, but
  // $derived keeps the reads reactive and avoids capturing only the initial value).
  const opts = $derived.by(() => {
    const { contributors, totals, weeks, weeklyData } = data;
    // Top-N commit subtotal, so the pie's "Others" slice is the remainder.
    const subC = contributors.reduce((acc, c) => acc + c.commits, 0);

    const timeline: EChartsCoreOption = {
      title: { text: "Weekly commits (stacked)", left: "center", top: 4 },
      tooltip: { trigger: "axis" },
      legend: {
        top: 26,
        type: "scroll",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 10 },
      },
      grid: { left: 36, right: 14, top: 60, bottom: 34 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: weeks.map(weekLabel),
        axisLabel: { rotate: 35, fontSize: 10 },
      },
      yAxis: { type: "value", min: 0 },
      series: contributors.map((c, i) => ({
        name: c.name,
        type: "line",
        stack: "total",
        smooth: true,
        showSymbol: false,
        // Line area ignores `cursor`; silent stops the series setting a pointer
        // cursor on hover. Axis tooltip + legend toggle are unaffected.
        silent: true,
        cursor: "default",
        lineStyle: { width: 1.5, color: clr(i) },
        itemStyle: { color: clr(i) },
        areaStyle: { color: clr(i), opacity: 0.38 },
        data: weeklyData[c.email],
      })),
    };

    const pie: EChartsCoreOption = {
      title: { text: "Commit share", left: "center", top: 8 },
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 8,
        top: "middle",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 11 },
      },
      series: [
        {
          type: "pie",
          cursor: "default",
          radius: ["50%", "72%"],
          center: ["42%", "56%"],
          data: [
            ...contributors.map((c, i) => ({
              name: c.name,
              value: c.commits,
              itemStyle: { color: clr(i) },
            })),
            { name: "Others", value: totals.commits - subC, itemStyle: { color: borderDefault } },
          ],
          itemStyle: { borderColor: bgCard, borderWidth: 2 },
          label: { show: false },
          labelLine: { show: false },
          emphasis: { scale: false },
        },
      ],
    };

    const addDel: EChartsCoreOption = {
      title: { text: "Lines added vs deleted", left: "center", top: 4 },
      tooltip: { trigger: "axis" },
      legend: { top: 26, itemWidth: 10, itemHeight: 10 },
      grid: { left: 56, right: 14, top: 60, bottom: 40 },
      xAxis: {
        type: "category",
        data: contributors.map((c) => c.name),
        axisLabel: { rotate: 35, fontSize: 10 },
      },
      yAxis: { type: "value", min: 0 },
      series: [
        {
          name: "Added",
          type: "bar",
          cursor: "default",
          data: contributors.map((c) => c.added),
          itemStyle: { color: colorAdded },
        },
        {
          name: "Deleted",
          type: "bar",
          cursor: "default",
          data: contributors.map((c) => c.deleted),
          itemStyle: { color: colorDeleted },
        },
      ],
    };

    const ratio: EChartsCoreOption = {
      title: { text: "Net lines per commit", left: "center", top: 4 },
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 14, top: 44, bottom: 40 },
      xAxis: {
        type: "category",
        data: contributors.map((c) => c.name),
        axisLabel: { rotate: 35, fontSize: 10 },
      },
      yAxis: { type: "value" },
      series: [
        {
          type: "bar",
          cursor: "default",
          // Net lines per commit, derived here (was the c.lc mutation in dashboard.ts).
          data: contributors.map((c, i) => ({
            value: c.commits ? +((c.added - c.deleted) / c.commits).toFixed(1) : 0,
            itemStyle: { color: clr(i) },
          })),
        },
      ],
    };

    // Two-level hierarchy: contributor → their language mix (pct). The treemap
    // chart.js couldn't do; denser file-tree data is a future pipeline task.
    const treemap: EChartsCoreOption = {
      title: { text: "Languages by contributor", left: "center", top: 8 },
      tooltip: { formatter: "{b}: {c}" },
      animation: false,
      series: [
        {
          type: "treemap",
          cursor: "default",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          top: 34,
          bottom: 6,
          left: 6,
          right: 6,
          squareRatio: 1,
          upperLabel: {
            show: true,
            height: 16,
            color: textPrimary,
            fontSize: 10,
            overflow: "truncate",
          },
          label: { show: true, color: "#fff", fontSize: 11, overflow: "truncate" },
          levels: [
            { itemStyle: { gapWidth: 3, borderColor: bgCard, borderWidth: 0 } },
            { itemStyle: { gapWidth: 1 }, colorSaturation: [0.35, 0.55] },
          ],
          data: contributors.map((c, i) => ({
            name: c.name,
            itemStyle: { color: clr(i) },
            children: c.languages.map((l) => ({
              name: l.name,
              value: l.pct,
              itemStyle: { color: l.color },
            })),
          })),
        },
      ],
    };

    return { timeline, pie, addDel, ratio, treemap };
  });
</script>

<div class="grid-2">
  <div class="card chart-resettable" class:has-hidden={timelineHasHidden}>
    <div class="ec" use:echart={{ option: opts.timeline, onReady: onTimelineReady }}></div>
    <button class="chart-reset-btn" onclick={resetTimeline}>Reset</button>
  </div>
  <div class="card chart-resettable" class:has-hidden={pieHasHidden}>
    <div class="ec" use:echart={{ option: opts.pie, onReady: onPieReady }}></div>
    <button class="chart-reset-btn" onclick={resetPie}>Reset</button>
  </div>
  <div class="card"><div class="ec" use:echart={{ option: opts.addDel }}></div></div>
  <div class="card"><div class="ec" use:echart={{ option: opts.ratio }}></div></div>
  <div class="card span-2">
    <div class="ec ec-tree" use:echart={{ option: opts.treemap }}></div>
  </div>
</div>

<style>
  .ec {
    width: 100%;
    height: 260px;
  }
  .ec-tree {
    height: 320px;
  }
  .span-2 {
    grid-column: 1 / -1;
  }
  .chart-resettable {
    position: relative;

    &.has-hidden .chart-reset-btn {
      opacity: 1;
    }
  }
  .chart-reset-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
    background: var(--bg-badge);
    border: 1px solid var(--border-default);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 0.65rem;
    padding: 2px 8px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s;

    &:hover {
      color: var(--text-primary);
      border-color: var(--text-muted);
    }
  }
</style>
