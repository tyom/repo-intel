<script lang="ts">
  // Weekly commits as a stacked area/line chart, one series per contributor.
  // Series are named by the (unique) email so duplicate display names don't
  // collapse in ECharts' legend; the HTML ChartLegend below drives selection via
  // the chart's hidden legend, and a Reset reappears once a series is hidden.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { echart } from "$lib/actions";
  import { escapeHtml, weekLabel } from "$lib/format";
  import type { AuthorPopover } from "$lib/popovers";
  import { buildContribLegend, buildNameByEmail } from "$lib/chart-helpers";
  import { clr } from "$lib/theme";
  import type { RepoData } from "$types";
  import type { EChartsCoreOption, EChartsType } from "echarts/core";
  import ChartLegend from "$components/ChartLegend.svelte";

  let { data, authorPopover }: { data: RepoData; authorPopover: AuthorPopover | undefined } =
    $props();

  const nameByEmail = $derived(buildNameByEmail(data.contributors));
  const dispName = (email: string): string => nameByEmail.get(email) ?? email;
  const contribLegend = $derived(buildContribLegend(data.contributors));

  // The chart owns the source of truth for what's hidden; we mirror its
  // `selected` map back here so the legend can dim rows and reveal Reset.
  let sel = $state<Record<string, boolean>>({});
  let chart: EChartsType | undefined;

  function onReady(c: EChartsType): void {
    chart = c;
    c.on("legendselectchanged", (p: any) => (sel = { ...p.selected }));
  }
  function toggle(key: string): void {
    chart?.dispatchAction({ type: "legendToggleSelect", name: key });
  }
  function reset(): void {
    chart?.dispatchAction({ type: "legendAllSelect" });
    sel = {};
  }

  const option = $derived.by<EChartsCoreOption>(() => {
    const { contributors, weeks, weeklyData } = data;
    return {
      // Series are named by email (unique), so map back to the display name and
      // drop zero-commit weeks to keep the stacked tooltip readable.
      tooltip: {
        trigger: "axis",
        formatter: (ps: any) => {
          const arr = Array.isArray(ps) ? ps : [ps];
          const head = arr[0]?.axisValueLabel ?? "";
          const rows = arr
            .filter((p: any) => p.value)
            .map((p: any) => `${p.marker}${escapeHtml(dispName(p.seriesName))}: ${p.value}`)
            .join("<br>");
          return rows ? (head ? `${head}<br>${rows}` : rows) : head;
        },
      },
      // ECharts' own legend is hidden; the HTML legend below drives selection.
      legend: { show: false },
      grid: { left: 36, right: 14, top: 38, bottom: 34 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: weeks.map(weekLabel),
        axisLabel: { rotate: 35, fontSize: 10 },
      },
      yAxis: { type: "value", min: 0 },
      series: contributors.map((c, i) => ({
        name: c.email,
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
  });
</script>

<div class="card chart-card">
  <div class="chart-title">Weekly commits (stacked)</div>
  <div class="ec" use:echart={{ option, onReady }}></div>
  <ChartLegend
    items={contribLegend}
    selected={sel}
    layout="row"
    onToggle={toggle}
    onReset={reset}
    {authorPopover}
  />
</div>
