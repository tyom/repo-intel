<script lang="ts">
  // The four repo-wide charts: weekly-commits line (stacked), commit-share
  // doughnut, lines added-vs-deleted bar, and net-lines-per-commit bar. The line
  // and doughnut carry a "Reset" affordance that reappears once the legend hides
  // a series. Svelte port of the overall-charts block + setupResetButton() in
  // lib/charts.ts; each chart owns its canvas via bind:this and is destroyed on
  // unmount (the imperative version never tore them down).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { onMount } from "svelte";
  import type { RepoData } from "$types";
  import { Chart } from "$lib/chart";
  import { clr, textPrimary, borderDefault, bgCard, colorAdded, colorDeleted } from "$lib/theme";
  import { weekLabel } from "$lib/format";

  let { data }: { data: RepoData } = $props();

  let timelineCanvas: HTMLCanvasElement;
  let pieCanvas: HTMLCanvasElement;
  let addDelCanvas: HTMLCanvasElement;
  let ratioCanvas: HTMLCanvasElement;

  // The Reset button is shown (via .has-hidden on the card) once the legend has
  // hidden at least one series, and clears all hidden state when clicked.
  let timelineHasHidden = $state(false);
  let pieHasHidden = $state(false);
  let timelineChart: any;
  let pieChart: any;

  const miniOpts: any = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: { legend: { display: false } },
  };
  const barOpts = (title: string): any => ({
    plugins: {
      title: { display: true, text: title, color: textPrimary, font: { size: 13 } },
      legend: { display: false },
    },
    scales: { y: { beginAtZero: true }, x: { ticks: { maxRotation: 35, font: { size: 10 } } } },
    responsive: true,
    maintainAspectRatio: true,
  });

  function resetTimeline(): void {
    timelineChart.data.datasets.forEach((_: unknown, i: number) => {
      timelineChart.getDatasetMeta(i).hidden = false;
    });
    timelineChart.update();
    timelineHasHidden = false;
  }
  function resetPie(): void {
    for (let i = 0; i < pieChart.data.labels.length; i++) {
      if (!pieChart.getDataVisibility(i)) pieChart.toggleDataVisibility(i);
    }
    pieChart.update();
    pieHasHidden = false;
  }

  // Wrap the legend's default onClick so the reset affordance reacts to toggles.
  function watchLegend(chart: any, onToggle: () => void): void {
    const orig = chart.options.plugins.legend.onClick;
    chart.options.plugins.legend.onClick = function (
      this: unknown,
      e: any,
      item: any,
      legend: any,
    ) {
      (orig || Chart.defaults.plugins.legend.onClick).call(this, e, item, legend);
      onToggle();
    };
    chart.update();
  }

  onMount(() => {
    const { contributors, totals, weeks, weeklyData } = data;
    // Top-N commit subtotal, so the doughnut's "Others" slice is the remainder.
    const subC = contributors.reduce((acc, c) => acc + c.commits, 0);
    const contribColors = contributors.map((_, i) => clr(i));

    timelineChart = new Chart(timelineCanvas, {
      type: "line",
      data: {
        labels: weeks.map(weekLabel),
        datasets: contributors.map((c, i) => ({
          label: c.name,
          data: weeklyData[c.email],
          backgroundColor: clr(i) + "60",
          borderColor: clr(i),
          borderWidth: 1.5,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        })),
      },
      options: {
        ...miniOpts,
        plugins: {
          ...miniOpts.plugins,
          title: {
            display: true,
            text: "Weekly commits (stacked)",
            color: textPrimary,
            font: { size: 13 },
          },
          legend: { display: true, labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
        },
        scales: {
          x: { ticks: { maxRotation: 35, font: { size: 10 } } },
          y: { stacked: true, beginAtZero: true },
        },
        interaction: { mode: "index" },
      },
    } as any);

    pieChart = new Chart(pieCanvas, {
      type: "doughnut",
      data: {
        labels: [...contributors.map((c) => c.name), "Others"],
        datasets: [
          {
            data: [...contributors.map((c) => c.commits), totals.commits - subC],
            backgroundColor: [...contribColors, borderDefault],
            borderColor: bgCard,
            borderWidth: 2,
          },
        ],
      },
      options: {
        ...miniOpts,
        plugins: {
          ...miniOpts.plugins,
          title: { display: true, text: "Commit share", color: textPrimary, font: { size: 13 } },
          legend: {
            display: true,
            position: "right",
            labels: { boxWidth: 10, padding: 6, font: { size: 10 } },
          },
        },
      },
    } as any);

    const addDel = new Chart(addDelCanvas, {
      type: "bar",
      data: {
        labels: contributors.map((c) => c.name),
        datasets: [
          { label: "Added", data: contributors.map((c) => c.added), backgroundColor: colorAdded },
          {
            label: "Deleted",
            data: contributors.map((c) => c.deleted),
            backgroundColor: colorDeleted,
          },
        ],
      },
      options: {
        ...barOpts("Lines added vs deleted"),
        plugins: {
          ...barOpts("").plugins,
          title: {
            display: true,
            text: "Lines added vs deleted",
            color: textPrimary,
            font: { size: 13 },
          },
          legend: { display: true, labels: { boxWidth: 10, padding: 8 } },
        },
      },
    } as any);

    const ratio = new Chart(ratioCanvas, {
      type: "bar",
      data: {
        labels: contributors.map((c) => c.name),
        datasets: [
          {
            label: "Lines/Commit",
            // Net lines per commit, derived here (was the c.lc mutation in dashboard.ts).
            data: contributors.map((c) =>
              c.commits ? +((c.added - c.deleted) / c.commits).toFixed(1) : 0,
            ),
            backgroundColor: contribColors,
          },
        ],
      },
      options: barOpts("Net lines per commit"),
    } as any);

    watchLegend(timelineChart, () => {
      timelineHasHidden = timelineChart.data.datasets.some(
        (_: unknown, i: number) => timelineChart.getDatasetMeta(i).hidden,
      );
    });
    watchLegend(pieChart, () => {
      pieHasHidden = pieChart
        .getDatasetMeta(0)
        .data.some((_: unknown, i: number) => pieChart.getDataVisibility(i) === false);
    });

    return () => {
      timelineChart.destroy();
      pieChart.destroy();
      addDel.destroy();
      ratio.destroy();
    };
  });
</script>

<div class="grid-2">
  <div class="card chart-resettable" class:has-hidden={timelineHasHidden}>
    <canvas bind:this={timelineCanvas}></canvas>
    <button class="chart-reset-btn" onclick={resetTimeline}>Reset</button>
  </div>
  <div class="card chart-resettable" class:has-hidden={pieHasHidden}>
    <canvas bind:this={pieCanvas}></canvas>
    <button class="chart-reset-btn" onclick={resetPie}>Reset</button>
  </div>
  <div class="card"><canvas bind:this={addDelCanvas}></canvas></div>
  <div class="card"><canvas bind:this={ratioCanvas}></canvas></div>
</div>

<style>
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
