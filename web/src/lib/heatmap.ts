// Contributions heatmap: GitHub-style calendar grid with year toggles and a
// hover tooltip. Ported verbatim from template.html.
import type { RepoData } from "../types";
import { colorHeatmap, bgEmptyCell } from "./theme";
import { encodeBranch } from "./format";

export type Mode = "current" | number;

// Returns a `rebuild(mode)` closure so the (now Svelte) year toggles can
// re-render the heatmap for a chosen year. The heatmap grid itself stays
// imperative (innerHTML + a body-appended hover tooltip).
export function initHeatmap(
  D: RepoData,
  allDaily: Record<string, number>,
): (mode: Mode) => void {
  const color = colorHeatmap;

  function shade(opacity: number): string {
    const r = parseInt(color.slice(1, 3), 16),
      g = parseInt(color.slice(3, 5), 16),
      b = parseInt(color.slice(5, 7), 16);
    const bg = { r: 22, g: 27, b: 34 };
    return `rgb(${Math.round(bg.r + (r - bg.r) * opacity)},${Math.round(bg.g + (g - bg.g) * opacity)},${Math.round(bg.b + (b - bg.b) * opacity)})`;
  }

  function buildHeatmap(containerId: string, daily: Record<string, number>, mode?: Mode): void {
    const container = document.getElementById(containerId);
    if (!container) return;
    let startDate: Date, endDate: Date;
    if (mode == null || mode === "current") {
      endDate = new Date(D.dateRange.end);
      const today = new Date();
      if (today > endDate) endDate = today;
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 52 * 7 + 1);
      const startDow = (startDate.getDay() + 6) % 7;
      if (startDow !== 0) startDate.setDate(startDate.getDate() - startDow);
    } else {
      startDate = new Date(mode, 0, 1);
      endDate = new Date(mode, 11, 31);
    }
    const allDates: Date[] = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) allDates.push(new Date(d));
    const weeksArr: { date: Date; key: string; count: number; dow: number }[][] = [];
    let currentWeek: { date: Date; key: string; count: number; dow: number }[] = [];
    allDates.forEach((d) => {
      const dow = (d.getDay() + 6) % 7;
      if (dow === 0 && currentWeek.length > 0) {
        weeksArr.push(currentWeek);
        currentWeek = [];
      }
      const key = d.toISOString().slice(0, 10);
      currentWeek.push({ date: d, key, count: daily[key] || 0, dow });
    });
    if (currentWeek.length) weeksArr.push(currentWeek);
    const maxCount = Math.max(...allDates.map((d) => daily[d.toISOString().slice(0, 10)] || 0), 1);
    function cellColor(count: number): string {
      if (count === 0) return bgEmptyCell;
      const ratio = count / maxCount;
      if (ratio <= 0.25) return shade(0.25);
      if (ratio <= 0.5) return shade(0.5);
      if (ratio <= 0.75) return shade(0.75);
      return color;
    }
    let lastMonth = "",
      monthSpans: { label: string; count: number }[] = [];
    weeksArr.forEach((week) => {
      const m = week[0].date.toLocaleDateString("en-GB", { month: "short" });
      if (m !== lastMonth) {
        monthSpans.push({ label: m, count: 1 });
        lastMonth = m;
      } else monthSpans[monthSpans.length - 1].count++;
    });
    let monthHtml = '<div class="heatmap-months">';
    monthSpans.forEach((ms) => {
      monthHtml += `<span style="flex:${ms.count} ${ms.count} 0;text-align:left;">${ms.label}</span>`;
    });
    monthHtml += "</div>";
    let dayLabelsHtml = '<div class="heatmap-day-labels">';
    ["Mon", "", "Wed", "", "Fri", "", ""].forEach((l) => {
      dayLabelsHtml += `<span>${l}</span>`;
    });
    dayLabelsHtml += "</div>";
    const baseUrl = D.githubBaseUrl;
    const branchPath = encodeBranch(D.defaultBranch);
    let gridHtml = '<div class="heatmap">';
    weeksArr.forEach((week, wi) => {
      gridHtml += '<div class="heatmap-week">';
      if (wi === 0 && week[0].dow > 0)
        for (let i = 0; i < week[0].dow; i++)
          gridHtml += '<div class="heatmap-cell" style="visibility:hidden;"></div>';
      week.forEach((day) => {
        const bg = cellColor(day.count);
        const cellBg = day.dow >= 5 ? `linear-gradient(rgba(240,170,90,0.05),rgba(240,170,90,0.05)),${bg}` : bg;
        const href = baseUrl ? `${baseUrl}/commits/${branchPath}?after=&since=${day.key}&until=${day.key}` : "#";
        gridHtml += `<a href="${href}" target="_blank" class="heatmap-cell" style="background:${cellBg};" data-date="${day.key}" data-count="${day.count}" data-color="${bg}"></a>`;
      });
      if (wi === weeksArr.length - 1 && week[week.length - 1].dow < 6)
        for (let i = week[week.length - 1].dow + 1; i <= 6; i++)
          gridHtml += '<div class="heatmap-cell" style="visibility:hidden;"></div>';
      gridHtml += "</div>";
    });
    gridHtml += "</div>";
    const legendHtml = `<div class="heatmap-legend"><span>Less</span><div class="heatmap-cell" style="background:var(--bg-empty-cell);"></div><div class="heatmap-cell" style="background:${shade(0.25)};"></div><div class="heatmap-cell" style="background:${shade(0.5)};"></div><div class="heatmap-cell" style="background:${shade(0.75)};"></div><div class="heatmap-cell" style="background:${color};"></div><span>More</span></div>`;
    container.innerHTML = `<div class="heatmap-wrap">${monthHtml}<div class="heatmap-grid">${dayLabelsHtml}${gridHtml}</div>${legendHtml}</div>`;
  }

  buildHeatmap("heatmapContainer", allDaily);

  // Tooltip
  const tooltip = document.createElement("div");
  tooltip.className = "heatmap-tooltip";
  document.body.appendChild(tooltip);
  const heatmapContainer = document.getElementById("heatmapContainer")!;
  heatmapContainer.addEventListener("mouseover", (e) => {
    const cell = (e.target as Element).closest(".heatmap-cell[data-date]") as HTMLElement | null;
    if (!cell) return;
    const { date, count, color: cellColorAttr } = cell.dataset as Record<string, string>;
    const d = new Date(date + "T00:00:00");
    const formatted = d.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    const label = count === "0" ? "No commits" : `${count} commit${count === "1" ? "" : "s"}`;
    tooltip.innerHTML = `<span class="tt-dot" style="background:${cellColorAttr}"></span><span class="tt-date">${label}</span><span class="tt-count">on ${formatted}</span>`;
    const rect = cell.getBoundingClientRect();
    const w = tooltip.offsetWidth,
      h = tooltip.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const m = 8,
      gap = 6,
      cx = rect.left + rect.width / 2;
    let left = cx - w / 2;
    left = Math.max(m, Math.min(left, vw - w - m));
    let top = rect.top - h - gap;
    let side = "above";
    if (top < m) {
      top = rect.bottom + gap;
      side = "below";
    }
    if (top + h + m > vh) top = Math.max(m, vh - h - m);
    tooltip.dataset.side = side;
    const arrowLeft = Math.max(8, Math.min(w - 8, cx - left));
    tooltip.style.setProperty("--arrow-left", arrowLeft + "px");
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
    tooltip.classList.add("visible");
  });
  heatmapContainer.addEventListener("mouseout", (e) => {
    if (!(e.target as Element).closest(".heatmap-cell[data-date]")) return;
    const rel = (e as MouseEvent).relatedTarget as Element | null;
    const next = rel && rel.closest && rel.closest(".heatmap-cell[data-date]");
    if (!next) tooltip.classList.remove("visible");
  });

  return (mode: Mode) => buildHeatmap("heatmapContainer", allDaily, mode);
}
