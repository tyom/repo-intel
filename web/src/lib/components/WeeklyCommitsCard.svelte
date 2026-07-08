<script lang="ts">
  // Weekly commits as a stacked bar chart, one series per contributor.
  // Series are named by the (unique) email so duplicate display names don't
  // collapse in ECharts' legend; the HTML ChartLegend below drives selection via
  // the chart's hidden legend, and a Reset reappears once a series is hidden.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { echart } from "$lib/actions";
  import { escapeHtml, weekLabel } from "$lib/format";
  import type { AuthorPopover } from "$lib/popovers";
  import { buildContribLegend, buildNameByEmail } from "$lib/chart-helpers";
  import { createLegendSelection } from "$lib/chart-legend.svelte";
  import { clr } from "$lib/theme";
  import type { RepoData } from "$types";
  import type { EChartsCoreOption } from "echarts/core";
  import ChartLegend from "$components/ChartLegend.svelte";

  let { data, authorPopover }: { data: RepoData; authorPopover: AuthorPopover | undefined } =
    $props();

  const nameByEmail = $derived(buildNameByEmail(data.contributors));
  const dispName = (email: string): string => nameByEmail.get(email) ?? email;
  const contribLegend = $derived(buildContribLegend(data.contributors));

  // Legend selection: the chart owns what's hidden, this mirrors it back so the
  // legend can dim rows and reveal Reset.
  const legend = createLegendSelection();

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
        data: weeks.map(weekLabel),
        axisLabel: { rotate: 35, fontSize: 10 },
      },
      yAxis: { type: "value", min: 0 },
      series: contributors.map((c, i) => ({
        name: c.email,
        type: "bar",
        stack: "total",
        // Bars scale with the category slot so few weeks get wide bars, capped
        // so sparse charts don't turn into slabs.
        barWidth: "60%",
        barMaxWidth: 56,
        // Silent stops the series setting a pointer cursor on hover. Axis
        // tooltip + legend toggle are unaffected.
        silent: true,
        cursor: "default",
        itemStyle: { color: clr(i) },
        data: weeklyData[c.email],
      })),
    };
  });
</script>

<div class="card chart-card">
  <div class="chart-title">Weekly commits (stacked)</div>
  <div class="ec" use:echart={{ option, onReady: legend.onReady }}></div>
  <ChartLegend
    items={contribLegend}
    selected={legend.selected}
    layout="row"
    onToggle={legend.toggle}
    onReset={legend.reset}
    {authorPopover}
  />
</div>
