<script lang="ts">
  // Year filter for the contributions heatmap. Svelte port of the buildYearToggles
  // IIFE from lib/heatmap.ts: the year list and active state live here, while the
  // actual re-render stays imperative — selecting a mode calls onSelect, which
  // App wires to the heatmap rebuild closure returned by initDashboard.
  import type { RepoData } from "../../types";
  import type { Mode } from "../heatmap";

  let { data, onSelect }: { data: RepoData; onSelect: (mode: Mode) => void } = $props();

  const years = $derived.by(() => {
    const startYear = parseInt((data.dateRange.start || "").slice(0, 4), 10);
    const endYear = parseInt((data.dateRange.end || "").slice(0, 4), 10);
    if (!startYear || !endYear) return [];
    const ys: number[] = [];
    for (let y = endYear; y >= startYear && ys.length < 20; y--) ys.push(y);
    return ys;
  });

  let active = $state<Mode>("current");

  function select(mode: Mode) {
    active = mode;
    onSelect(mode);
  }
</script>

<div class="year-toggles">
  {#if years.length}
    <button
      class="year-toggle"
      class:active={active === "current"}
      type="button"
      onclick={() => select("current")}>Current</button
    >
    {#each years as y}
      <button class="year-toggle" class:active={active === y} type="button" onclick={() => select(y)}
        >{y}</button
      >
    {/each}
  {/if}
</div>
