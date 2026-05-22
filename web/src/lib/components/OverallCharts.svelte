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
    contrastText,
    textMuted,
    borderDefault,
    bgCard,
    colorAdded,
    colorDeleted,
  } from "$lib/theme";
  import { weekLabel } from "$lib/format";

  let { data }: { data: RepoData } = $props();

  // Hide the languages treemap entirely when no contributor has a language mix,
  // rather than rendering an empty chart.
  const hasLangData = $derived(data.contributors.some((c) => c.languages?.length > 0));

  // Half-transparent dark inner border on the treemap tiles, so each brand-
  // coloured tile reads against the contributor-coloured gap around it.
  const tileInnerBorder = "rgba(0, 0, 0, 0.6)";

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

  // ECharts' treemap view forces a pointer cursor on every node (and on the root
  // background) and ignores series.cursor, so override it to the default after
  // each render — `finished` fires on the initial draw and on every resize.
  function onTreemapReady(chart: EChartsType): void {
    const useDefaultCursor = (): void => {
      for (const el of (chart.getZr() as any).storage.getDisplayList()) el.cursor = "default";
    };
    chart.on("finished", useDefaultCursor);
    useDefaultCursor();
  }

  // All five chart options, derived from data (data is set once at mount, but
  // $derived keeps the reads reactive and avoids capturing only the initial value).
  const opts = $derived.by(() => {
    const { contributors, totals, weeks, weeklyData } = data;
    // Top-N commit subtotal, so the pie's "Others" slice is the remainder.
    const subC = contributors.reduce((acc, c) => acc + c.commits, 0);

    const timeline: EChartsCoreOption = {
      tooltip: { trigger: "axis" },
      legend: {
        top: 42,
        type: "scroll",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 10 },
      },
      grid: { left: 36, right: 14, top: 76, bottom: 34 },
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
      tooltip: { trigger: "axis" },
      legend: { top: 42, itemWidth: 10, itemHeight: 10 },
      grid: { left: 56, right: 14, top: 76, bottom: 40 },
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
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 14, top: 48, bottom: 40 },
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

    // Two-level hierarchy: contributor → their language mix (pct), laid out like
    // ECharts' "treemap-show-parent": each contributor is a container with a
    // name-header strip in the contributor's colour (clr(i)), and the languages
    // are tiles inside carrying their own brand colour (l.color). Tiles are
    // separated by dark (card-coloured) gaps; tile + header labels flip
    // near-white/near-black for contrast.
    const treemap: EChartsCoreOption = {
      // Only language tiles get a tooltip; the root and contributor containers
      // (which carry summed/empty values) would otherwise show e.g. ": 300%".
      tooltip: {
        formatter: (info: any) =>
          !info.name || info.data?.children ? "" : `${info.name}: ${info.value}%`,
      },
      animation: false,
      series: [
        {
          type: "treemap",
          cursor: "default",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          // No hover interaction: the emphasis state would otherwise re-layout the
          // header label (jumping it back to the left) and show a pointer cursor.
          emphasis: { disabled: true },
          top: 24,
          bottom: 6,
          left: 6,
          right: 6,
          squareRatio: 1,
          // Root background (shows in the gaps between contributor containers and
          // at the edges); default is white, so paint it the card colour.
          itemStyle: { color: bgCard, borderColor: bgCard },
          upperLabel: {
            show: true,
            height: 24,
            fontSize: 12,
            fontWeight: "bold",
            // Anchor at the strip's horizontal centre (default is the left edge)
            // so align:center actually centres the name across the full strip.
            position: ["50%", "50%"],
            align: "center",
            overflow: "truncate",
          },
          label: { show: true, fontSize: 12, overflow: "truncate" },
          levels: [
            // Contributor containers: dark gap separates regions; the contributor
            // colour is applied per-node as a 3px border + the gap fill below.
            { itemStyle: { gapWidth: 6, borderWidth: 3 } },
            // Language tiles: the gap reveals the contributor (parent) colour; each
            // tile carries a half-transparent white inner border for contrast.
            { itemStyle: { gapWidth: 3 } },
          ],
          data: contributors.map((c, i) => {
            const base = clr(i);
            const langs = [...c.languages].sort((a, b) => b.pct - a.pct);
            return {
              name: c.name,
              // Container fill = contributor colour (shows in the language gaps);
              // matching border frames the whole section.
              itemStyle: { color: base, borderColor: base, borderWidth: 3 },
              // Header strip is the contributor colour already (it's the container
              // fill, which shows in the top strip above the tiles); just colour
              // the label so it reads. No backgroundColor, so `align: center` can
              // centre the text across the full-width strip.
              upperLabel: { color: contrastText(base) },
              children: langs.map((l) => {
                const color = l.color || base;
                return {
                  name: l.name,
                  value: l.pct,
                  itemStyle: { color, borderColor: tileInnerBorder, borderWidth: 1 },
                  label: { color: contrastText(color) },
                };
              }),
            };
          }),
        },
      ],
    };

    return { timeline, pie, addDel, ratio, treemap };
  });
</script>

<div class="grid-2">
  <div class="card chart-card chart-resettable" class:has-hidden={timelineHasHidden}>
    <div class="chart-title">Weekly commits (stacked)</div>
    <div class="ec" use:echart={{ option: opts.timeline, onReady: onTimelineReady }}></div>
    <button class="chart-reset-btn" onclick={resetTimeline}>Reset</button>
  </div>
  <div class="card chart-card chart-resettable" class:has-hidden={pieHasHidden}>
    <div class="chart-title">Commit share</div>
    <div class="ec" use:echart={{ option: opts.pie, onReady: onPieReady }}></div>
    <button class="chart-reset-btn" onclick={resetPie}>Reset</button>
  </div>
  <div class="card chart-card">
    <div class="chart-title">Lines added vs deleted</div>
    <div class="ec" use:echart={{ option: opts.addDel }}></div>
  </div>
  <div class="card chart-card">
    <div class="chart-title">Net lines per commit</div>
    <div class="ec" use:echart={{ option: opts.ratio }}></div>
  </div>
  {#if hasLangData}
    <div class="card chart-card span-2">
      <div class="chart-title">Languages by contributor</div>
      <div class="ec ec-tree" use:echart={{ option: opts.treemap, onReady: onTreemapReady }}></div>
    </div>
  {/if}
</div>

<style>
  .chart-card {
    position: relative;
  }
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
