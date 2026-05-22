<script lang="ts">
  // One contributor's commit-time pattern card: an ECharts bar chart whose bars
  // open the commit-bucket popover. Handles the hour-of-day and day-of-week
  // variants (kind), rendered via {#each} in App from the hourlyData / dowData
  // maps. Svelte port of renderChartCards() in lib/charts.ts.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import type { Contributor } from "$types";
  import type { EChartsType, EChartsCoreOption } from "echarts/core";
  import type { CommitPopover } from "$lib/popovers";
  import { echart } from "$lib/actions";
  import { clr } from "$lib/theme";

  let {
    contributor,
    index,
    values,
    kind,
    commitPopover,
    linksEnabled,
  }: {
    contributor: Contributor;
    index: number;
    values: number[];
    kind: "hour" | "dow";
    commitPopover: CommitPopover | undefined;
    linksEnabled: boolean;
  } = $props();

  const color = $derived(clr(index));

  const option: EChartsCoreOption = $derived.by(() => {
    const labels =
      kind === "hour"
        ? Array.from({ length: 24 }, (_, i) => `${i}:00`)
        : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    // Weekend bars (Sat/Sun) are dimmed; hour bars share one tint.
    const barColor = (i: number): string =>
      kind === "dow" && i >= 5 ? color + "30" : color + "90";
    return {
      title: { text: contributor.name, left: "center", top: 4, textStyle: { color, fontSize: 11 } },
      tooltip: { trigger: "axis" },
      grid: { left: 6, right: 6, top: 28, bottom: 22 },
      xAxis: {
        type: "category",
        data: labels,
        axisTick: { show: false },
        axisLabel: { fontSize: 9, interval: kind === "hour" ? 3 : 0 },
      },
      yAxis: { type: "value", show: false, min: 0 },
      series: [
        {
          type: "bar",
          // Bars are the only clickable chart — pointer only when links are on.
          cursor: linksEnabled ? "pointer" : "default",
          itemStyle: { borderRadius: kind === "hour" ? 2 : 3 },
          data: values.map((v, i) => ({ value: v, itemStyle: { color: barColor(i) } })),
        },
      ],
    };
  });

  function onReady(chart: EChartsType): void {
    chart.on("click", (p: any) => {
      if (!commitPopover || !linksEnabled) return;
      const idx = p.dataIndex as number;
      const list = commitPopover.commitsInBucket(contributor.email, kind, idx);
      if (!list.length) return;
      // Pixel of the bar's top within the chart, then offset by the canvas rect.
      const px = chart.convertToPixel({ seriesIndex: 0 }, [idx, values[idx]]) as number[];
      const rect = chart.getDom().getBoundingClientRect();
      const label = kind === "hour" ? `${idx}:00–${idx}:59` : commitPopover.dowFull[idx];
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
  <div class="ec" use:echart={{ option, onReady }}></div>
</div>

<style>
  .pattern-card {
    padding: 14px;
  }
  .ec {
    width: 100%;
    height: 160px;
  }
</style>
