<script lang="ts">
  // One contributor's frequency card: rank/name/meta markup (the conversion win)
  // plus a Chart.js weekly-commits sparkline that stays imperative on its own
  // canvas. Svelte port of the contributor-cards block from lib/charts.ts.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { onMount } from "svelte";
  import type { Contributor } from "$types";
  import { Chart } from "$lib/chart";
  import { clr } from "$lib/theme";
  import { fmt, weekLabel } from "$lib/format";

  let {
    contributor,
    index,
    weeks,
    weekly,
  }: { contributor: Contributor; index: number; weeks: string[]; weekly: number[] } = $props();

  const color = $derived(clr(index));

  let canvas: HTMLCanvasElement;

  onMount(() => {
    const chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: weeks.map(weekLabel),
        datasets: [
          {
            data: weekly,
            backgroundColor: color + "40",
            borderColor: color,
            borderWidth: 1.5,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { display: true, ticks: { maxTicksLimit: 4, font: { size: 9 }, maxRotation: 0 } },
          y: { display: false, beginAtZero: true },
        },
      },
    } as any);
    return () => chart.destroy();
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
  <canvas bind:this={canvas}></canvas>
</div>
