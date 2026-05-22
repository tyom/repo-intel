<script lang="ts">
  // One contributor's commit-time pattern card: a Chart.js bar chart on its own
  // canvas whose bars open the commit-bucket popover. Handles both the hour-of-day
  // and day-of-week variants (kind), rendered via {#each} in App from the
  // hourlyData / dowData maps. Svelte port of renderChartCards() in lib/charts.ts.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { onMount } from "svelte";
  import type { Contributor } from "$types";
  import type { CommitPopover } from "$lib/popovers";
  import { Chart } from "$lib/chart";
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
  const hourLabels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  const dowLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  let canvas: HTMLCanvasElement;

  function onBarClick(_evt: any, els: any[], chart: any): void {
    if (!commitPopover || !linksEnabled || !els.length) return;
    const idx = els[0].index;
    const list = commitPopover.commitsInBucket(contributor.email, kind, idx);
    if (!list.length) return;
    const bar = chart.getDatasetMeta(0).data[idx];
    const rect = chart.canvas.getBoundingClientRect();
    const label = kind === "hour" ? `${idx}:00–${idx}:59` : commitPopover.dowFull[idx];
    commitPopover.show(
      { x: rect.left + bar.x, top: rect.top + bar.y, bottom: rect.bottom },
      contributor,
      index,
      label,
      list,
    );
  }
  function onBarHover(evt: any, els: any[]): void {
    if (evt.native) evt.native.target.style.cursor = els.length && linksEnabled ? "pointer" : "";
  }

  onMount(() => {
    // Weekend bars (Sat/Sun) are dimmed; hour bars share one tint.
    const backgroundColor =
      kind === "dow"
        ? values.map((_v, di) => (di >= 5 ? color + "30" : color + "90"))
        : color + "90";
    const xTicks = kind === "hour" ? { maxTicksLimit: 6 } : {};
    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: kind === "hour" ? hourLabels : dowLabels,
        datasets: [{ data: values, backgroundColor, borderRadius: kind === "hour" ? 2 : 3 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          title: { display: true, text: contributor.name, color, font: { size: 11 } },
        },
        scales: {
          x: { ticks: { ...xTicks, font: { size: 9 } } },
          y: { display: false, beginAtZero: true },
        },
        onClick: onBarClick,
        onHover: onBarHover,
      },
    } as any);
    return () => chart.destroy();
  });
</script>

<div class="card pattern-card">
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .pattern-card {
    padding: 14px;
  }
</style>
