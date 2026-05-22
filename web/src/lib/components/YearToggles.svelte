<script lang="ts">
  // Year filter for the contributions heatmap. The year list and active state
  // live here; selecting a mode calls onSelect, which App wires to the
  // heatmapMode state read by the Heatmap component.
  import type { Mode, RepoData } from "$types";

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

<style>
  .year-toggles {
    display: flex;
    flex-direction: row-reverse;
    gap: 2px;
    flex-wrap: wrap;
    justify-content: flex-start;
  }
  .year-toggle {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 0.72rem;
    padding: 3px 8px;
    cursor: pointer;
    font-family: inherit;
    font-variant-numeric: tabular-nums;

    &:hover {
      color: var(--text-primary);
    }
    &.active {
      color: var(--text-primary);
      background: var(--bg-badge);
      border-color: var(--border-default);
    }
  }
</style>
