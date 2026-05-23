<script lang="ts">
  // The HTML legend shared by the weekly-commits line and the commit-share pie.
  // ECharts' own legend is hidden; this drives selection by dispatching
  // legendToggleSelect/legendAllSelect through the card's `onToggle`/`onReset`.
  // The chart still owns the source of truth for what's hidden — the card mirrors
  // its `selected` map back into Svelte state, which we read so a row dims when
  // its series is off and the Reset button appears once anything is hidden.
  // One entry per identity: a colour swatch + the plain name. Hover opens the
  // same author popover the timeline lanes use (so people committing under
  // several emails are told apart on hover, not in the label); click toggles the
  // matching series.
  import type { AuthorPopover } from "$lib/popovers";
  import type { LegendItem } from "$lib/chart-helpers";

  let {
    items,
    selected,
    layout,
    onToggle,
    onReset,
    onEmphasize,
    authorPopover,
  }: {
    items: LegendItem[];
    // Keyed by series name (the contributor's email, or "Others" on the pie). A
    // missing key means selected (the initial state).
    selected: Record<string, boolean>;
    layout: "row" | "col";
    onToggle: (key: string) => void;
    onReset: () => void;
    // Pie only: hovering a row emphasises the matching slice.
    onEmphasize?: (key: string, on: boolean) => void;
    authorPopover: AuthorPopover | undefined;
  } = $props();

  const isHidden = (key: string): boolean => selected[key] === false;
  const hasHidden = $derived(Object.values(selected).some((v) => v === false));

  // Author popover on row hover, mirroring the timeline lane labels. The "Others"
  // pie row has idx < 0 (no contributor), so it gets no popover.
  function legendEnter(e: MouseEvent, idx: number): void {
    if (idx >= 0) authorPopover?.show(idx, e.currentTarget as Element);
  }
</script>

<div
  class="chart-legend"
  class:chart-legend-row={layout === "row"}
  class:chart-legend-col={layout === "col"}
>
  {#each items as item (item.key)}
    <button
      type="button"
      class="legend-item"
      class:hidden={isHidden(item.key)}
      aria-pressed={!isHidden(item.key)}
      onmouseenter={(e) => {
        legendEnter(e, item.idx);
        onEmphasize?.(item.key, true);
      }}
      onmouseleave={() => {
        authorPopover?.hide();
        onEmphasize?.(item.key, false);
      }}
      onclick={() => onToggle(item.key)}
    >
      <span class="legend-dot" style="background:{item.color}"></span>
      <span class="legend-name">{item.name}</span>
    </button>
  {/each}
</div>
<button
  class="chart-reset-btn"
  class:visible={hasHidden}
  tabindex={hasHidden ? 0 : -1}
  aria-hidden={!hasHidden}
  onclick={onReset}>Reset</button
>

<style>
  /* The weekly-commits legend wraps as a centered row beneath the chart. */
  .chart-legend-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 2px 4px;
    margin-top: 6px;
  }
  /* The commit-share legend is a column beside the pie; it scrolls if there are
     many people. */
  .chart-legend-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex-shrink: 0;
    max-width: 45%;
    max-height: 240px;
    overflow-y: auto;
  }
  /* One legend entry: swatch + plain name. Mirrors the timeline lane labels —
     hover opens the author popover, click toggles the series (dimmed when off). */
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    padding: 2px 5px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 0.72rem;
    line-height: 1.3;
    cursor: pointer;

    &:hover {
      color: var(--text-primary);
      background: var(--bg-badge);
    }
    &.hidden {
      opacity: 0.4;
    }
  }
  .legend-dot {
    flex-shrink: 0;
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }
  .legend-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  /* Reset re-selects every series; it fades in only once the legend has hidden
     something. Pinned to the card's top-right corner (the card is the nearest
     positioned ancestor via .chart-card). */
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
    /* Hidden state: invisible, untabbable (tabindex/aria-hidden on the element),
       and inert to clicks so the zero-opacity button can't be hit. */
    pointer-events: none;
    transition: opacity 0.2s;

    &.visible {
      opacity: 1;
      pointer-events: auto;
    }
    &:hover {
      color: var(--text-primary);
      border-color: var(--text-muted);
    }
  }
</style>
