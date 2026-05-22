// All Chart.js charts: overall weekly/pie/add-del/ratio, per-contributor
// sparkline cards, and the hour-of-day / day-of-week pattern charts (whose bars
// open the commit-bucket popover). Ported verbatim from template.html. Chart.js
// is now bundled (no CDN). `any` is used for chart configs to match the original
// untyped option objects.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Chart } from "./chart";
import type { Contributor, RepoData } from "../types";
import { clr, textPrimary, borderDefault, bgCard, colorAdded, colorDeleted } from "./theme";
import { escapeHtml, fmt, weekLabel } from "./format";
import type { CommitPopover } from "./popovers";
import { topCommitSubtotal } from "./table";

export function renderCharts(D: RepoData, commitPopover: CommitPopover): void {
  const { contributors, totals, weeks, weeklyData, hourlyData, dowData } = D;
  const subC = topCommitSubtotal(D);

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

  const contribColors = contributors.map((_, i) => clr(i));
  const timelineChart = new Chart(document.getElementById("overallTimeline") as HTMLCanvasElement, {
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
        title: { display: true, text: "Weekly commits (stacked)", color: textPrimary, font: { size: 13 } },
        legend: { display: true, labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
      },
      scales: { x: { ticks: { maxRotation: 35, font: { size: 10 } } }, y: { stacked: true, beginAtZero: true } },
      interaction: { mode: "index" },
    },
  } as any);
  const pieChart = new Chart(document.getElementById("commitsPie") as HTMLCanvasElement, {
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
        legend: { display: true, position: "right", labels: { boxWidth: 10, padding: 6, font: { size: 10 } } },
      },
    },
  } as any);
  new Chart(document.getElementById("addDel") as HTMLCanvasElement, {
    type: "bar",
    data: {
      labels: contributors.map((c) => c.name),
      datasets: [
        { label: "Added", data: contributors.map((c) => c.added), backgroundColor: colorAdded },
        { label: "Deleted", data: contributors.map((c) => c.deleted), backgroundColor: colorDeleted },
      ],
    },
    options: {
      ...barOpts("Lines added vs deleted"),
      plugins: {
        ...barOpts("").plugins,
        title: { display: true, text: "Lines added vs deleted", color: textPrimary, font: { size: 13 } },
        legend: { display: true, labels: { boxWidth: 10, padding: 8 } },
      },
    },
  } as any);
  new Chart(document.getElementById("ratioChart") as HTMLCanvasElement, {
    type: "bar",
    data: {
      labels: contributors.map((c) => c.name),
      datasets: [{ label: "Lines/Commit", data: contributors.map((c) => c.lc), backgroundColor: contribColors }],
    },
    options: barOpts("Net lines per commit"),
  } as any);

  // Contributor cards
  const cardsContainer = document.getElementById("contributorCards");
  if (cardsContainer) {
    contributors.forEach((c, i) => {
      const card = document.createElement("div");
      card.className = "contributor-card";
      card.innerHTML = `<div class="rank">#${i + 1}</div><div class="name" style="color:${clr(i)}">${escapeHtml(c.name)}</div><div class="meta"><span>${fmt(c.commits)} commits</span><span class="add">${fmt(c.added)} ++</span><span class="del">${fmt(c.deleted)} --</span></div><canvas id="contrib-${i}"></canvas>`;
      cardsContainer.appendChild(card);
      new Chart(document.getElementById(`contrib-${i}`) as HTMLCanvasElement, {
        type: "line",
        data: {
          labels: weeks.map(weekLabel),
          datasets: [
            {
              data: weeklyData[c.email],
              backgroundColor: clr(i) + "40",
              borderColor: clr(i),
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
    });
  }

  function renderChartCards(
    container: HTMLElement | null,
    idPrefix: string,
    chartConfig: (c: Contributor, i: number) => any,
  ): void {
    if (!container) return;
    contributors.forEach((c, i) => {
      const div = document.createElement("div");
      div.className = "card";
      div.style.padding = "14px";
      div.innerHTML = `<canvas id="${idPrefix}-${i}"></canvas>`;
      container.appendChild(div);
      new Chart(document.getElementById(`${idPrefix}-${i}`) as HTMLCanvasElement, chartConfig(c, i));
    });
  }

  const miniBarOpts = (c: Contributor, i: number, xTicks: any): any => ({
    responsive: true,
    maintainAspectRatio: true,
    plugins: { legend: { display: false }, title: { display: true, text: c.name, color: clr(i), font: { size: 11 } } },
    scales: { x: { ticks: { ...xTicks, font: { size: 9 } } }, y: { display: false, beginAtZero: true } },
  });

  function makeBarClick(kind: "hour" | "dow", c: Contributor, colorIdx: number) {
    return (_evt: any, els: any[], chart: any) => {
      if (!D.githubBaseUrl || !els.length) return;
      const idx = els[0].index;
      const list = commitPopover.commitsInBucket(c.email, kind, idx);
      if (!list.length) return;
      const bar = chart.getDatasetMeta(0).data[idx];
      const rect = chart.canvas.getBoundingClientRect();
      const label = kind === "hour" ? `${idx}:00–${idx}:59` : commitPopover.dowFull[idx];
      commitPopover.show({ x: rect.left + bar.x, top: rect.top + bar.y, bottom: rect.bottom }, c, colorIdx, label, list);
    };
  }
  const barHover = (evt: any, els: any[]) => {
    if (evt.native) evt.native.target.style.cursor = els.length && D.githubBaseUrl ? "pointer" : "";
  };

  const hourLabels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  renderChartCards(document.getElementById("hourlyCharts"), "hourly", (c, i) => ({
    type: "bar",
    data: { labels: hourLabels, datasets: [{ data: hourlyData[c.email], backgroundColor: clr(i) + "90", borderRadius: 2 }] },
    options: { ...miniBarOpts(c, i, { maxTicksLimit: 6 }), onClick: makeBarClick("hour", c, i), onHover: barHover },
  }));

  const dowLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  renderChartCards(document.getElementById("dowCharts"), "dow", (c, i) => ({
    type: "bar",
    data: {
      labels: dowLabels,
      datasets: [
        {
          data: dowData[c.email],
          backgroundColor: dowData[c.email].map((_v, di) => (di >= 5 ? clr(i) + "30" : clr(i) + "90")),
          borderRadius: 3,
        },
      ],
    },
    options: { ...miniBarOpts(c, i, {}), onClick: makeBarClick("dow", c, i), onHover: barHover },
  }));

  // Reset buttons (overall weekly line + commit-share doughnut)
  function setupResetButton(chart: any): void {
    const card = chart.canvas.closest(".chart-resettable");
    if (!card) return;
    const btn = document.createElement("button");
    btn.className = "chart-reset-btn";
    btn.textContent = "Reset";
    card.appendChild(btn);
    const isDoughnut = chart.config.type === "doughnut" || chart.config.type === "pie";
    function checkHidden(): void {
      let h = false;
      if (isDoughnut) {
        const meta = chart.getDatasetMeta(0);
        h = meta.data.some((_: unknown, i: number) => chart.getDataVisibility(i) === false);
      } else {
        h = chart.data.datasets.some((_: unknown, i: number) => chart.getDatasetMeta(i).hidden);
      }
      card.classList.toggle("has-hidden", h);
    }
    const origClick = chart.options.plugins.legend.onClick;
    chart.options.plugins.legend.onClick = function (this: unknown, e: any, item: any, legend: any) {
      (origClick || Chart.defaults.plugins.legend.onClick).call(this, e, item, legend);
      checkHidden();
    };
    chart.update();
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isDoughnut) {
        for (let i = 0; i < chart.data.labels.length; i++) {
          if (!chart.getDataVisibility(i)) chart.toggleDataVisibility(i);
        }
      } else {
        chart.data.datasets.forEach((_: unknown, i: number) => {
          chart.getDatasetMeta(i).hidden = false;
        });
      }
      chart.update();
      card.classList.remove("has-hidden");
    });
  }
  setupResetButton(timelineChart);
  setupResetButton(pieChart);
}
