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
      // axisPointer "none": keep the floating tooltip, drop the dashed column line.
      tooltip: { trigger: "axis", axisPointer: { type: "none" } },
      grid: { left: 6, right: 6, top: 40, bottom: 22 },
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
          itemStyle: { borderRadius: kind === "hour" ? 2 : 3 },
          data: values.map((v, i) => ({ value: v, itemStyle: { color: barColor(i) } })),
        },
      ],
    };
  });

  function onReady(chart: EChartsType): void {
    // Listen on the whole canvas (zrender), not the bar graphic, so a click
    // anywhere in a column opens its bucket — matching the axis-triggered hover
    // area instead of forcing a pixel-perfect hit on the thin bar.
    chart.getZr().on("click", (e: any) => {
      if (!commitPopover || !linksEnabled) return;
      const x = e.offsetX as number;
      const y = e.offsetY as number;
      if (!chart.containPixel("grid", [x, y])) return;
      const idx = Math.round(chart.convertFromPixel({ xAxisIndex: 0 }, x) as number);
      if (idx < 0 || idx >= values.length) return;
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
  <div class="chart-title" style="color:{color}">{contributor.name}</div>
  <div class="ec" class:clickable={linksEnabled} use:echart={{ option, onReady }}></div>
</div>

<style>
  .pattern-card {
    position: relative;
    padding: 14px;
  }
  .ec {
    width: 100%;
    height: 160px;

    &.clickable {
      cursor: pointer;
    }
  }
</style>
