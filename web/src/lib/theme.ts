// Reads the CSS custom properties (the --c1..--c10 palette and named colors)
// and registers the "repo" ECharts theme. Call registerEchartsTheme() once at
// boot, before any chart mounts.
import { echarts } from "./echarts";

const cs = getComputedStyle(document.documentElement);
const readVar = (name: string) => cs.getPropertyValue(name).trim();

export const colors = Array.from({ length: 10 }, (_, i) => readVar(`--c${i + 1}`));
export const clr = (i: number): string => colors[i % colors.length];

// A label colour (near-white or near-black) that reads on the given hex `bg`.
// Used by the treemap so each tile's label stays legible on its brand colour.
export const contrastText = (bg: string): string => {
  const h = bg.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum >= 0.6 ? bgPrimary : textPrimary;
};

export const textPrimary = readVar("--text-primary");
export const colorAdded = readVar("--color-added");
export const colorDeleted = readVar("--color-deleted");
export const bgPrimary = readVar("--bg-primary");
export const bgCard = readVar("--bg-card");
export const borderDefault = readVar("--border-default");
export const colorHeatmap = readVar("--color-heatmap");
export const bgEmptyCell = readVar("--bg-empty-cell");
export const textMuted = readVar("--text-muted");
export const borderSubtle = readVar("--border-subtle");

// Canvas-only decorations (timeline). The grid/selection colours are shared
// with CSS rules via :root; --accent-weekend is a raw "r,g,b" triplet so each
// consumer can pick its own alpha.
export const gridLine = readVar("--grid-line");
export const selectionFill = readVar("--selection-fill");
export const selectionStroke = readVar("--selection-stroke");
export const accentWeekend = readVar("--accent-weekend");

// The shared dashboard theme — the ECharts analog of the old Chart.defaults
// block. Per-chart options still override (titles, per-series colour); this just
// sets the palette, fonts, and axis/grid colours every chart inherits.
export function registerEchartsTheme(): void {
  const axis = {
    axisLine: { lineStyle: { color: borderSubtle } },
    axisTick: { show: false },
    axisLabel: { color: textMuted, fontSize: 11 },
    splitLine: { lineStyle: { color: gridLine || borderSubtle } },
  };
  echarts.registerTheme("repo", {
    color: colors,
    backgroundColor: "transparent",
    textStyle: { fontFamily: "system-ui", fontSize: 11, color: textMuted },
    title: { textStyle: { color: textPrimary, fontSize: 13, fontWeight: "bold" } },
    legend: { textStyle: { color: textMuted } },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: axis,
  });
}
