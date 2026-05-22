<script lang="ts">
  // One contributor's frequency card: rank/name/meta markup plus an ECharts
  // weekly-commits sparkline mounted via the `echart` action. Svelte port of the
  // contributor-cards block from lib/charts.ts.
  import type { Contributor } from "$types";
  import type { EChartsCoreOption } from "echarts/core";
  import { echart } from "$lib/actions";
  import { clr, textMuted } from "$lib/theme";
  import { fmt, weekLabel } from "$lib/format";

  let {
    contributor,
    index,
    weeks,
    weekly,
  }: { contributor: Contributor; index: number; weeks: string[]; weekly: number[] } = $props();

  const color = $derived(clr(index));

  const option: EChartsCoreOption = $derived.by(() => {
    const labels = weeks.map(weekLabel);
    // Aim for ~4 x-axis labels (chart.js used maxTicksLimit: 4).
    const interval = Math.max(0, Math.round(labels.length / 4) - 1);
    return {
      grid: { left: 2, right: 2, top: 4, bottom: 16 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: labels,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 9, color: textMuted, interval, hideOverlap: true },
      },
      yAxis: { type: "value", show: false, min: 0 },
      series: [
        {
          type: "line",
          silent: true,
          cursor: "default",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 1.5, color },
          areaStyle: { color, opacity: 0.25 },
          data: weekly,
        },
      ],
    };
  });
</script>

<div class="contributor-card">
  <div class="rank">#{index + 1}</div>
  <div class="name" style="color:{color}">{contributor.name}</div>
  <div class="meta">
    <span>{fmt(contributor.commits)} commits</span>
    <span class="add">{fmt(contributor.added)} ++</span>
    <span class="del">{fmt(contributor.deleted)} --</span>
  </div>
  <div class="spark" use:echart={{ option }}></div>
</div>

<style>
  .contributor-card {
    background: var(--bg-card);
    border-radius: 8px;
    padding: 12px;
    overflow: hidden;
    min-width: 0;

    .name {
      font-weight: 600;
      font-size: 0.75rem;
      margin-bottom: 2px;
    }
    .meta {
      font-size: 0.62rem;
      color: var(--text-muted);
      margin-bottom: 8px;
      white-space: nowrap;

      span {
        margin-right: 6px;
      }
      .add {
        color: var(--color-added);
      }
      .del {
        color: var(--color-deleted);
      }
    }
    .rank {
      float: right;
      color: var(--text-muted);
      font-size: 0.7rem;
      font-weight: 600;
    }
    .spark {
      height: 80px;
    }
  }
</style>
