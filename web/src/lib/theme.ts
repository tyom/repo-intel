// Reads the CSS custom properties (the --c1..--c10 palette and named colors)
// and configures Chart.js global defaults. Call configureCharts() once at boot.
import Chart from "chart.js/auto";

const cs = getComputedStyle(document.documentElement);
const readVar = (name: string) => cs.getPropertyValue(name).trim();

export const colors = Array.from({ length: 10 }, (_, i) => readVar(`--c${i + 1}`));
export const clr = (i: number): string => colors[i % colors.length];

export const textPrimary = readVar("--text-primary");
export const colorAdded = readVar("--color-added");
export const colorDeleted = readVar("--color-deleted");
export const bgCard = readVar("--bg-card");
export const borderDefault = readVar("--border-default");
export const colorHeatmap = readVar("--color-heatmap");
export const bgEmptyCell = readVar("--bg-empty-cell");
export const textMuted = readVar("--text-muted");
export const borderSubtle = readVar("--border-subtle");

export function configureCharts(): void {
  const cd = Chart.defaults;
  cd.color = textMuted;
  cd.borderColor = borderSubtle;
  cd.font.family = "system-ui";
  cd.font.size = 11;
}
