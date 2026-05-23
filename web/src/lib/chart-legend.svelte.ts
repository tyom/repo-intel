// Shared legend-selection state for the cards whose HTML ChartLegend drives an
// ECharts hidden legend (weekly-commits line, commit-share pie). The chart owns
// the source of truth for what's hidden; this factory mirrors its `selected`
// map back into $state so the legend can dim rows and reveal Reset, and wraps
// the legend chart-actions the legend's callbacks dispatch. Lives in a .svelte.ts
// module so it can hold $state (the popover-store.svelte.ts convention).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EChartsType } from "echarts/core";

export function createLegendSelection() {
  // Keyed by series/slice name (the contributor's email, or "Others"); a missing
  // key means selected. Only onReady writes it, from the chart's own event.
  let sel = $state<Record<string, boolean>>({});
  let chart: EChartsType | undefined;
  return {
    get selected(): Record<string, boolean> {
      return sel;
    },
    onReady(c: EChartsType): void {
      chart = c;
      c.on("legendselectchanged", (p: any) => (sel = { ...p.selected }));
    },
    toggle(key: string): void {
      chart?.dispatchAction({ type: "legendToggleSelect", name: key });
    },
    reset(): void {
      chart?.dispatchAction({ type: "legendAllSelect" });
      sel = {};
    },
    // Pie only: hovering a legend row emphasises the matching slice by name (the
    // legend's toggle key). Harmless on cards that never wire onEmphasize.
    highlight(key: string, on: boolean): void {
      chart?.dispatchAction({ type: on ? "highlight" : "downplay", name: key });
    },
  };
}
