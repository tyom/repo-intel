// Commit timeline: a custom-canvas swimlane chart with drag-to-zoom, pan with
// inertia, wheel/pinch zoom, a draggable histogram minimap, tag markers, and a
// rich hover tooltip. Ported ~verbatim from template.html (imperative canvas /
// pointer-event code that is wrapped, not rewritten).
import type { Commit, RepoData } from "$types";
import { clr, gridLine, selectionFill, selectionStroke, accentWeekend } from "./theme";
import { authorUrl, escapeHtml } from "./format";
import type { AuthorPopover, TimelineTooltip } from "./popovers";

// A day+author commit bundle (one or more commits collapsed onto one square),
// with churn aggregated across the bundle. Consumed by the timeline tooltip.
export interface TimelineBundle {
  h: string;
  e: string;
  d: string;
  s: string;
  a: number;
  l: number;
  commits: Commit[];
}
interface Drawable {
  idx: number;
  tMs: number;
  stack: number;
  lineLog: number;
  c: TimelineBundle;
}
interface Position {
  x: number;
  y: number;
  hw: number;
  hh: number;
  c: TimelineBundle;
  color: string;
  idx: number;
}

export function buildTimeline(
  D: RepoData,
  authorPopover: AuthorPopover,
  tooltip: TimelineTooltip,
): void {
  const contributors = D.contributors;
  const commits = D.commits || [];
  const labelsDiv = document.getElementById("timelineLabels");
  const scrollDiv = document.getElementById("timelineScroll") as HTMLElement;
  const innerDiv = document.getElementById("timelineInner");
  if (!commits.length || !labelsDiv || !scrollDiv || !innerDiv) return;

  const emailIdx: Record<string, number> = {};
  contributors.forEach((c, i) => {
    emailIdx[c.email] = i;
  });

  let minD = commits[0].d,
    maxD = commits[0].d;
  for (const c of commits) {
    if (c.d < minD) minD = c.d;
    if (c.d > maxD) maxD = c.d;
  }
  const dataStart = new Date(minD.slice(0, 10) + "T00:00:00");
  const end = new Date(maxD.slice(0, 10) + "T23:59:59");
  const start = dataStart;
  const startT = start.getTime();
  const totalMs = Math.max(1, +end - +start);
  const totalDays = Math.max(1, Math.ceil(totalMs / 86400000));
  const laneHeight = 32;
  const axisHeight = 22;
  const histBarsHeight = 56;
  const tags = D.tags || [];
  const tagMsList = tags.map((t) => {
    const dt = new Date(t.date as string);
    return isNaN(+dt) ? 0 : +dt - +start;
  });
  const hasTags = tags.length > 0;
  const tagHeight = hasTags ? 16 : 0;
  const tagDotRadius = 3.5;
  const tagHitPad = 4;
  const histTagStripH = hasTags ? 6 : 0;
  const histHeight = histBarsHeight + histTagStripH;
  const yearsBarHeight = 18;
  const height = contributors.length * laneHeight;

  const viewportWidth0 = Math.max(600, scrollDiv.clientWidth || 800);
  let initialPxPerDay = Math.min(14, viewportWidth0 / totalDays);
  let minPxPerDay = initialPxPerDay;
  const maxInnerPx = 5e6;
  const maxPxPerDay = Math.min(10000, maxInnerPx / totalDays);

  let labelsHtml = `<div style="height:${axisHeight}px;flex-shrink:0;"></div>`;
  contributors.forEach((c, i) => {
    labelsHtml += `<a class="lane-label" data-idx="${i}" href="${authorUrl(D, c)}" target="_blank" rel="noopener" style="height:${laneHeight}px;"><span class="dot" style="background:${clr(i)}"></span><span>${escapeHtml(c.name)}</span></a>`;
  });
  if (hasTags) {
    labelsHtml += `<div style="height:${tagHeight}px;"></div>`;
  }
  labelsHtml += `<div class="years-label" style="height:${yearsBarHeight}px;"></div>`;
  labelsHtml += `<div class="histogram-label" style="height:${histHeight}px;"><button class="timeline-reset-btn" id="timelineReset" type="button">Reset zoom</button></div>`;
  labelsDiv.innerHTML = labelsHtml;

  labelsDiv.addEventListener("mouseover", (e) => {
    const el = (e.target as Element).closest(".lane-label") as HTMLElement | null;
    if (!el) return;
    authorPopover.show(+el.dataset.idx!, el);
  });
  labelsDiv.addEventListener("mouseout", (e) => {
    const el = (e.target as Element).closest(".lane-label") as HTMLElement | null;
    if (!el) return;
    if (el.contains((e as MouseEvent).relatedTarget as Node)) return;
    authorPopover.hide();
  });

  // One-time precomputation. r/y depend on zoom so they're computed in drawCanvas.
  const sorted = commits.slice().sort((a, b) => +new Date(a.d) - +new Date(b.d));
  const dayStackTmp = new Map<string, number>();
  const bundleByKey = new Map<string, Drawable>();
  const drawables: Drawable[] = [];
  sorted.forEach((c) => {
    const idx = emailIdx[c.e];
    if (idx === undefined) return;
    const dt = new Date(c.d);
    if (isNaN(+dt)) return;
    const bkey = c.e + "|" + c.d;
    const existing = bundleByKey.get(bkey);
    if (existing) {
      existing.c.commits.push(c);
      existing.c.a += c.a || 0;
      existing.c.l += c.l || 0;
      existing.lineLog = Math.log10(existing.c.a + existing.c.l + 1);
      return;
    }
    const key = idx + "|" + c.d.slice(0, 10);
    const stack = dayStackTmp.get(key) || 0;
    dayStackTmp.set(key, stack + 1);
    const bundle: Drawable = {
      idx,
      tMs: +dt - +start,
      stack,
      lineLog: Math.log10((c.a || 0) + (c.l || 0) + 1),
      c: { h: c.h, e: c.e, d: c.d, s: c.s, a: c.a || 0, l: c.l || 0, commits: [c] },
    };
    bundleByKey.set(bkey, bundle);
    drawables.push(bundle);
  });

  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.className = "timeline-canvas";
  const ctx = canvas.getContext("2d")!;
  innerDiv.appendChild(canvas);

  let tagCanvas: HTMLCanvasElement | null = null,
    tagctx: CanvasRenderingContext2D | null = null;
  if (hasTags) {
    tagCanvas = document.createElement("canvas");
    tagCanvas.className = "timeline-canvas timeline-tags";
    tagctx = tagCanvas.getContext("2d");
    innerDiv.appendChild(tagCanvas);
  }

  const yearsBar = document.createElement("div");
  yearsBar.className = "timeline-years";
  yearsBar.style.height = yearsBarHeight + "px";
  innerDiv.appendChild(yearsBar);

  const histCanvas = document.createElement("canvas");
  histCanvas.className = "timeline-canvas timeline-histogram";
  const hctx = histCanvas.getContext("2d")!;
  innerDiv.appendChild(histCanvas);

  const rangeEl = document.createElement("div");
  rangeEl.className = "timeline-range";
  rangeEl.id = "timelineRange";
  innerDiv.appendChild(rangeEl);

  let currentPxPerDay = initialPxPerDay;
  let currentWidth = 0;
  let canvasViewW = 0;
  let positions: Position[] = [];
  let hoveredHash: string | null = null;
  let hoveredTagIdx: number | null = null;
  let selecting = false,
    selStartX = 0,
    selCurX = 0,
    selMoved = false;
  const resetBtn = document.getElementById("timelineReset") as HTMLButtonElement | null;
  let lastRangeText = "";

  function updateResetBtn(): void {
    if (!resetBtn) return;
    resetBtn.classList.toggle("visible", Math.abs(currentPxPerDay - initialPxPerDay) > 0.001);
  }
  function resizeInner(): void {
    currentWidth = Math.max(canvasViewW, Math.floor(totalDays * currentPxPerDay));
    innerDiv!.style.width = currentWidth + "px";
    rebuildAxis(true);
    rebuildYears();
  }
  let resetAnimId: number | null = null;
  function stopResetAnim(): void {
    if (resetAnimId) {
      cancelAnimationFrame(resetAnimId);
      resetAnimId = null;
    }
  }
  function animateReset(): void {
    stopResetAnim();
    if (Math.abs(currentPxPerDay - initialPxPerDay) < 1e-4) return;
    const startPxPerDay = currentPxPerDay;
    const endPxPerDay = initialPxPerDay;
    const anchorFrac =
      currentWidth > 0 ? (scrollDiv.scrollLeft + canvasViewW / 2) / currentWidth : 0.5;
    const duration = 320;
    const startTime = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    function step(now: number): void {
      const t = Math.min(1, (now - startTime) / duration);
      const e = ease(t);
      if (t >= 1) {
        currentPxPerDay = endPxPerDay;
        applyLayout();
      } else {
        currentPxPerDay = startPxPerDay + (endPxPerDay - startPxPerDay) * e;
        resizeInner();
      }
      scrollDiv.scrollLeft = clampSL(anchorFrac * currentWidth - canvasViewW / 2);
      drawCanvas();
      resetAnimId = t < 1 ? requestAnimationFrame(step) : null;
    }
    resetAnimId = requestAnimationFrame(step);
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      stopInertia();
      animateReset();
    });
  }

  function formatVisibleRange(): string {
    const sl = scrollDiv.scrollLeft;
    const startMs = startT + (sl / currentWidth) * totalMs;
    const endMs = startT + ((sl + canvasViewW) / currentWidth) * totalMs;
    const a = new Date(startMs),
      b = new Date(endMs);
    let opts: Intl.DateTimeFormatOptions;
    if (currentPxPerDay < 1.5) {
      opts = { month: "short", year: "numeric" };
      return `${a.toLocaleDateString("en-GB", opts)} — ${b.toLocaleDateString("en-GB", opts)}`;
    }
    if (currentPxPerDay < 30) {
      opts = { day: "numeric", month: "short", year: "numeric" };
      return `${a.toLocaleDateString("en-GB", opts)} — ${b.toLocaleDateString("en-GB", opts)}`;
    }
    if (currentPxPerDay < 350) {
      const f = (d: Date) =>
        d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
        " " +
        String(d.getHours()).padStart(2, "0") +
        ":00";
      return `${f(a)} — ${f(b)}`;
    }
    const f = (d: Date) =>
      d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
      " " +
      d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `${f(a)} — ${f(b)}`;
  }

  function updateRangeText(): void {
    if (!rangeEl) return;
    const t = formatVisibleRange();
    if (t !== lastRangeText) {
      rangeEl.textContent = t;
      lastRangeText = t;
    }
  }

  function viewportW(): number {
    return Math.max(1, scrollDiv.clientWidth || viewportWidth0);
  }

  function buildAxisHtml(width: number): string {
    let mode: string;
    let hourStep = 0;
    if (currentPxPerDay >= 350) {
      mode = "hour";
      const pxPerHour = currentPxPerDay / 24;
      const minLabelPx = 56;
      hourStep = [1, 2, 3, 6, 12].find((s) => s * pxPerHour >= minLabelPx) || 12;
    } else if (currentPxPerDay >= 30) mode = "day";
    else if (currentPxPerDay >= 6) mode = "week";
    else if (currentPxPerDay >= 1.5) mode = "month";
    else if (currentPxPerDay >= 0.5) mode = "quarter";
    else if (currentPxPerDay >= 0.2) mode = "half";
    else mode = "year";

    const sl = scrollDiv.scrollLeft;
    const vw = canvasViewW || viewportW();
    const visStartMs = (sl / width) * totalMs;
    const visEndMs = ((sl + vw) / width) * totalMs;
    const bufferMs = Math.max(86400000, (visEndMs - visStartMs) * 0.5);
    const renderStartMs = Math.max(0, visStartMs - bufferMs);
    const renderEndMs = Math.min(totalMs, visEndMs + bufferMs);

    const cur = new Date(startT + renderStartMs);
    if (mode === "hour") {
      cur.setMinutes(0, 0, 0);
      cur.setHours(Math.floor(cur.getHours() / hourStep) * hourStep);
    } else {
      cur.setHours(0, 0, 0, 0);
      if (mode === "week") cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7));
      else if (mode === "month") cur.setDate(1);
      else if (mode === "quarter") {
        cur.setDate(1);
        cur.setMonth(Math.floor(cur.getMonth() / 3) * 3);
      } else if (mode === "half") {
        cur.setDate(1);
        cur.setMonth(Math.floor(cur.getMonth() / 6) * 6);
      } else if (mode === "year") {
        cur.setDate(1);
        cur.setMonth(0);
      }
    }

    const fmtHour = (h: number) => {
      if (h === 0) return "12 AM";
      if (h === 12) return "12 PM";
      return h < 12 ? `${h} AM` : `${h - 12} PM`;
    };

    let html = `<div class="timeline-axis" style="width:${width}px;height:${axisHeight}px;">`;
    while (cur <= end && cur.getTime() - startT <= renderEndMs) {
      const x = ((+cur - +start) / totalMs) * width;
      const nextCur = new Date(cur);
      if (mode === "hour") nextCur.setHours(nextCur.getHours() + hourStep);
      else if (mode === "day") nextCur.setDate(nextCur.getDate() + 1);
      else if (mode === "week") nextCur.setDate(nextCur.getDate() + 7);
      else if (mode === "month") nextCur.setMonth(nextCur.getMonth() + 1);
      else if (mode === "quarter") nextCur.setMonth(nextCur.getMonth() + 3);
      else if (mode === "half") nextCur.setMonth(nextCur.getMonth() + 6);
      else nextCur.setFullYear(nextCur.getFullYear() + 1);
      const nextX = ((+nextCur - +start) / totalMs) * width;
      const labelX = mode === "hour" ? x : (x + nextX) / 2;
      const yr = cur.getFullYear();
      if (labelX >= -60 && labelX <= width + 60) {
        let label: string | number,
          cls = "";
        if (mode === "hour") {
          if (cur.getHours() === 0) {
            label = cur.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
          } else {
            label = fmtHour(cur.getHours());
            cls = ' class="axis-hour"';
          }
        } else if (mode === "year") {
          label = yr;
        } else if (mode === "day" || mode === "week") {
          label = cur.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        } else {
          label = cur.toLocaleDateString("en-GB", { month: "short" });
        }
        html += `<span${cls} style="left:${labelX}px;">${label}</span>`;
      }
      if (mode === "hour") cur.setHours(cur.getHours() + hourStep);
      else if (mode === "day") cur.setDate(cur.getDate() + 1);
      else if (mode === "week") cur.setDate(cur.getDate() + 7);
      else if (mode === "month") cur.setMonth(cur.getMonth() + 1);
      else if (mode === "quarter") cur.setMonth(cur.getMonth() + 3);
      else if (mode === "half") cur.setMonth(cur.getMonth() + 6);
      else cur.setFullYear(cur.getFullYear() + 1);
    }
    return html + "</div>";
  }

  function applyLayout(): void {
    const vw = viewportW();
    const fit = Math.min(14, vw / totalDays);
    if (Math.abs(currentPxPerDay - initialPxPerDay) < 1e-4) currentPxPerDay = fit;
    initialPxPerDay = fit;
    minPxPerDay = fit;
    canvasViewW = vw;
    resizeInner();

    canvas.width = Math.round(canvasViewW * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = canvasViewW + "px";
    canvas.style.height = height + "px";

    if (tagCanvas) {
      tagCanvas.width = Math.round(canvasViewW * dpr);
      tagCanvas.height = Math.round(tagHeight * dpr);
      tagCanvas.style.width = canvasViewW + "px";
      tagCanvas.style.height = tagHeight + "px";
    }

    histCanvas.width = Math.round(canvasViewW * dpr);
    histCanvas.height = Math.round(histHeight * dpr);
    histCanvas.style.width = canvasViewW + "px";
    histCanvas.style.height = histHeight + "px";

    rangeEl.style.width = canvasViewW + "px";

    rebuildHistogram();
  }

  function buildYearsInner(width: number): string {
    const firstYear = start.getFullYear();
    const lastYear = end.getFullYear();
    let html = "";
    for (let y = firstYear; y <= lastYear; y++) {
      const segStart = Math.max(startT, new Date(y, 0, 1).getTime());
      const segEnd = Math.min(end.getTime(), new Date(y + 1, 0, 1).getTime());
      if (segEnd <= segStart) continue;
      const x0 = ((segStart - startT) / totalMs) * width;
      const x1 = ((segEnd - startT) / totalMs) * width;
      const cls = y % 2 === 0 ? "year-seg" : "year-seg odd";
      html += `<span class="${cls}" style="left:${x0}px;width:${x1 - x0}px;"></span>`;
      html += `<span class="year-label" data-x0="${x0}" data-x1="${x1}" style="left:${x0}px;">${y}</span>`;
    }
    return html;
  }

  let yearLabels: NodeListOf<HTMLElement> | HTMLElement[] = [];
  function positionYearLabels(): void {
    const sl = scrollDiv.scrollLeft;
    const vw = canvasViewW || viewportW();
    for (const lab of yearLabels) {
      const x0 = +lab.dataset.x0!,
        x1 = +lab.dataset.x1!;
      const visLo = Math.max(x0, sl),
        visHi = Math.min(x1, sl + vw);
      if (visHi <= visLo) {
        lab.style.display = "none";
        continue;
      }
      lab.style.display = "";
      lab.style.left = (visLo + visHi) / 2 + "px";
    }
  }

  function rebuildYears(): void {
    yearsBar.style.width = currentWidth + "px";
    yearsBar.innerHTML = buildYearsInner(currentWidth);
    yearLabels = yearsBar.querySelectorAll<HTMLElement>(".year-label");
    positionYearLabels();
  }

  let lastAxisSL = -Infinity;
  function rebuildAxis(force: boolean): void {
    const sl = scrollDiv.scrollLeft;
    if (!force && Math.abs(sl - lastAxisSL) < canvasViewW * 0.25) return;
    const newAxis = buildAxisHtml(currentWidth);
    const oldAxis = innerDiv!.querySelector(".timeline-axis");
    if (oldAxis) oldAxis.outerHTML = newAxis;
    else innerDiv!.insertAdjacentHTML("afterbegin", newAxis);
    lastAxisSL = sl;
  }

  function drawGridLines(
    alignFn: (d: Date) => void,
    stepFn: (d: Date) => void,
    color: string,
    dash?: number[],
  ): void {
    const sl = scrollDiv.scrollLeft;
    const visStartMs = (sl / currentWidth) * totalMs;
    const visEndMs = ((sl + canvasViewW) / currentWidth) * totalMs;
    const cursor = new Date(startT + visStartMs);
    alignFn(cursor);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    let drawn = 0;
    while (drawn < 5000) {
      const tMs = cursor.getTime() - startT;
      if (tMs > visEndMs) break;
      const xCanvas = (tMs / totalMs) * currentWidth - sl;
      if (xCanvas >= -1 && xCanvas <= canvasViewW + 1) {
        ctx.moveTo(Math.round(xCanvas) + 0.5, 0);
        ctx.lineTo(Math.round(xCanvas) + 0.5, height);
      }
      stepFn(cursor);
      drawn++;
    }
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }

  function drawWeekendBands(): void {
    const sl = scrollDiv.scrollLeft;
    const visStartMs = (sl / currentWidth) * totalMs;
    const visEndMs = ((sl + canvasViewW) / currentWidth) * totalMs;
    const cursor = new Date(startT + visStartMs);
    cursor.setHours(0, 0, 0, 0);
    ctx.fillStyle = `rgba(${accentWeekend},0.045)`;
    let drawn = 0;
    while (drawn < 5000) {
      const tMs = cursor.getTime() - startT;
      if (tMs > visEndMs) break;
      const dow = cursor.getDay();
      if (dow === 0 || dow === 6) {
        const xStart = (tMs / totalMs) * currentWidth - sl;
        const xEnd = ((tMs + 86400000) / totalMs) * currentWidth - sl;
        const x0 = Math.max(0, xStart);
        const x1 = Math.min(canvasViewW, xEnd);
        if (x1 > x0) ctx.fillRect(x0, 0, x1 - x0, height);
      }
      cursor.setDate(cursor.getDate() + 1);
      drawn++;
    }
  }

  function drawYearLines(c: CanvasRenderingContext2D, h: number): void {
    const sl = scrollDiv.scrollLeft;
    const visEndMs = ((sl + canvasViewW) / currentWidth) * totalMs;
    const cursor = new Date(startT + (sl / currentWidth) * totalMs);
    cursor.setMonth(0, 1);
    cursor.setHours(0, 0, 0, 0);
    c.strokeStyle = "rgba(255,255,255,0.14)";
    c.lineWidth = 1;
    c.beginPath();
    let drawn = 0;
    while (drawn < 200) {
      const tMs = cursor.getTime() - startT;
      if (tMs > visEndMs) break;
      const x = (tMs / totalMs) * currentWidth - sl;
      if (x >= -1 && x <= canvasViewW + 1) {
        c.moveTo(Math.round(x) + 0.5, 0);
        c.lineTo(Math.round(x) + 0.5, h);
      }
      cursor.setFullYear(cursor.getFullYear() + 1);
      drawn++;
    }
    c.stroke();
  }

  function drawCanvas(): void {
    const sl = scrollDiv.scrollLeft;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasViewW, height);

    for (let i = 0; i < contributors.length; i++) {
      if (i % 2 === 1) {
        ctx.fillStyle = "rgba(255,255,255,0.025)";
        ctx.fillRect(0, i * laneHeight, canvasViewW, laneHeight);
      }
    }

    if (currentPxPerDay > 6) drawWeekendBands();
    if (currentPxPerDay >= 1.5 && currentPxPerDay <= 25) {
      drawGridLines(
        (d) => {
          d.setDate(1);
          d.setHours(0, 0, 0, 0);
        },
        (d) => d.setMonth(d.getMonth() + 1),
        gridLine,
      );
    }
    if (currentPxPerDay > 25) {
      drawGridLines(
        (d) => d.setHours(0, 0, 0, 0),
        (d) => d.setDate(d.getDate() + 1),
        gridLine,
      );
    }
    if (currentPxPerDay > 350) {
      drawGridLines(
        (d) => d.setMinutes(0, 0, 0),
        (d) => d.setHours(d.getHours() + 1),
        "rgba(255,255,255,0.025)",
      );
    }
    if (currentPxPerDay > 80) {
      drawGridLines(
        (d) => d.setHours(12, 0, 0, 0),
        (d) => d.setDate(d.getDate() + 1),
        "rgba(255,255,255,0.05)",
        [3, 4],
      );
    }
    drawYearLines(ctx, height);

    if (hoveredTagIdx != null && tags[hoveredTagIdx]) {
      const tMs = tagMsList[hoveredTagIdx];
      const xCanvas = (tMs / totalMs) * currentWidth - sl;
      if (xCanvas >= -1 && xCanvas <= canvasViewW + 1) {
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(xCanvas) + 0.5, 0);
        ctx.lineTo(Math.round(xCanvas) + 0.5, height);
        ctx.stroke();
      }
    }

    const slotMsLo = (sl / currentWidth) * totalMs - 86400000;
    const slotMsHi = ((sl + canvasViewW) / currentWidth) * totalMs + 86400000;

    let lo = 0,
      hi = drawables.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (drawables[mid].tMs < slotMsLo) lo = mid + 1;
      else hi = mid;
    }

    const baseW = Math.max(1.0, Math.min(3.5, currentPxPerDay * 0.12));
    const baseH = Math.min(22, laneHeight * 0.85);
    const useJitter = currentPxPerDay < 30;

    positions = [];
    const groups: number[][] = new Array(contributors.length);
    for (let i = 0; i < contributors.length; i++) groups[i] = [];

    for (let i = lo; i < drawables.length; i++) {
      const d = drawables[i];
      if (d.tMs > slotMsHi) break;
      const xCanvas = (d.tMs / totalMs) * currentWidth - sl;
      if (xCanvas < -8 || xCanvas > canvasViewW + 8) continue;
      const sizeFactor = 0.18 + Math.min(0.82, d.lineLog * d.lineLog * 0.07);
      const w = baseW;
      const h = baseH * sizeFactor;
      let offset = 0;
      if (useJitter) {
        const stackSpread = Math.min(laneHeight * 0.42, Math.max(w * 2.4, 4));
        offset = (((d.stack % 5) - 2) * stackSpread) / 4;
      }
      const y = d.idx * laneHeight + laneHeight / 2 + offset;
      groups[d.idx].push(xCanvas - w / 2, y - h / 2, w, h);
      positions.push({
        x: xCanvas,
        y,
        hw: w / 2,
        hh: h / 2,
        c: d.c,
        color: clr(d.idx),
        idx: d.idx,
      });
    }

    ctx.globalAlpha = 0.78;
    for (let i = 0; i < groups.length; i++) {
      const pts = groups[i];
      if (!pts.length) continue;
      ctx.fillStyle = clr(i);
      ctx.beginPath();
      for (let j = 0; j < pts.length; j += 4) {
        ctx.rect(pts[j], pts[j + 1], pts[j + 2], pts[j + 3]);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (hoveredHash) {
      for (let i = 0; i < positions.length; i++) {
        if (positions[i].c.h !== hoveredHash) continue;
        const p = positions[i];
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.hw, p.y - p.hh, p.hw * 2, p.hh * 2);
        break;
      }
    }

    if (selecting && selMoved) {
      const xa = Math.min(selStartX, selCurX),
        xb = Math.max(selStartX, selCurX);
      ctx.fillStyle = selectionFill;
      ctx.fillRect(xa, 0, xb - xa, height);
      ctx.strokeStyle = selectionStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(xa + 0.5, 0.5, Math.max(1, xb - xa - 1), height - 1);
    }

    drawTags();
    drawHistogram();
    updateRangeText();
    updateResetBtn();
    updateZoomCursor();
    positionYearLabels();
  }

  function drawTags(): void {
    if (!tagCanvas || !tagctx) return;
    tagctx.setTransform(1, 0, 0, 1, 0, 0);
    tagctx.scale(dpr, dpr);
    tagctx.clearRect(0, 0, canvasViewW, tagHeight);
    drawYearLines(tagctx, tagHeight);
    const sl = scrollDiv.scrollLeft;
    const cy = tagHeight / 2;
    tagctx.lineWidth = 1;
    let hoveredX: number | null = null;
    for (let i = 0; i < tags.length; i++) {
      const tMs = tagMsList[i];
      const xCanvas = (tMs / totalMs) * currentWidth - sl;
      if (xCanvas < -tagDotRadius - 2 || xCanvas > canvasViewW + tagDotRadius + 2) continue;
      if (i === hoveredTagIdx) {
        hoveredX = xCanvas;
        continue;
      }
      tagctx.beginPath();
      tagctx.arc(xCanvas, cy, tagDotRadius, 0, Math.PI * 2);
      tagctx.fillStyle = "rgba(13,17,23,0.85)";
      tagctx.fill();
      tagctx.strokeStyle = "rgba(255,255,255,0.55)";
      tagctx.stroke();
    }
    if (hoveredX !== null) {
      tagctx.beginPath();
      tagctx.moveTo(Math.round(hoveredX) + 0.5, 0);
      tagctx.lineTo(Math.round(hoveredX) + 0.5, tagHeight);
      tagctx.strokeStyle = "rgba(255,255,255,0.55)";
      tagctx.stroke();
      tagctx.beginPath();
      tagctx.arc(hoveredX, cy, tagDotRadius + 0.5, 0, Math.PI * 2);
      tagctx.fillStyle = "rgba(255,255,255,0.98)";
      tagctx.fill();
    }
  }

  let histogramByPx: Map<number, { total: number; per: number[] }> | null = null;
  let histogramMax = 0;
  let histogramViewW = -1;

  function rebuildHistogram(): void {
    if (histogramViewW === canvasViewW) return;
    histogramByPx = new Map();
    for (let i = 0; i < drawables.length; i++) {
      const d = drawables[i];
      const px = Math.floor((d.tMs / totalMs) * canvasViewW);
      let b = histogramByPx.get(px);
      if (!b) {
        b = { total: 0, per: new Array(contributors.length).fill(0) };
        histogramByPx.set(px, b);
      }
      b.total++;
      b.per[d.idx]++;
    }
    histogramMax = 0;
    for (const b of histogramByPx.values()) {
      if (b.total > histogramMax) histogramMax = b.total;
    }
    histogramViewW = canvasViewW;
  }
  function drawHistogram(): void {
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    hctx.scale(dpr, dpr);
    hctx.clearRect(0, 0, canvasViewW, histHeight);
    if (!histogramByPx || !histogramMax) {
      drawMinimapWindow();
      return;
    }

    const innerH = histBarsHeight - 2;
    const groups: number[][] = new Array(contributors.length);
    for (let i = 0; i < contributors.length; i++) groups[i] = [];

    for (const [px, bucket] of histogramByPx) {
      let yBase = histBarsHeight;
      const scale = innerH / histogramMax;
      for (let ci = 0; ci < contributors.length; ci++) {
        const count = bucket.per[ci];
        if (!count) continue;
        const h = count * scale;
        groups[ci].push(px, yBase - h, 1, h);
        yBase -= h;
      }
    }

    for (let ci = 0; ci < contributors.length; ci++) {
      const pts = groups[ci];
      if (!pts.length) continue;
      hctx.fillStyle = clr(ci);
      hctx.beginPath();
      for (let j = 0; j < pts.length; j += 4) {
        hctx.rect(pts[j], pts[j + 1], pts[j + 2], pts[j + 3]);
      }
      hctx.fill();
    }

    drawMinimapWindow();
  }

  function getMinimapWindow(): { left: number; right: number } {
    if (!currentWidth || !canvasViewW) return { left: 0, right: canvasViewW };
    const sl = scrollDiv.scrollLeft;
    const left = (sl / currentWidth) * canvasViewW;
    const right = ((sl + canvasViewW) / currentWidth) * canvasViewW;
    return {
      left: Math.max(0, Math.min(canvasViewW, left)),
      right: Math.max(0, Math.min(canvasViewW, right)),
    };
  }

  function drawMinimapWindow(): void {
    const { left, right } = getMinimapWindow();
    hctx.fillStyle = "rgba(13,17,23,0.55)";
    if (left > 0) hctx.fillRect(0, 0, left, histHeight);
    if (right < canvasViewW) hctx.fillRect(right, 0, canvasViewW - right, histHeight);
    if (right - left < canvasViewW - 0.5) {
      hctx.strokeStyle = "rgba(255,255,255,0.4)";
      hctx.lineWidth = 1;
      const bx = Math.max(0.5, left + 0.5);
      const bw = Math.max(1, right - left - 1);
      hctx.strokeRect(bx, 0.5, bw, histBarsHeight - 1);
    }
    drawHistogramTags();
    drawSelectionPreview();
  }

  function drawHistogramTags(): void {
    if (!hasTags || totalMs <= 0 || canvasViewW <= 0) return;
    const cy = histBarsHeight + Math.floor(histTagStripH / 2);
    hctx.fillStyle = "rgba(255,255,255,0.95)";
    for (let i = 0; i < tags.length; i++) {
      const tMs = tagMsList[i];
      const x = (tMs / totalMs) * canvasViewW;
      if (x < -1 || x > canvasViewW + 1) continue;
      hctx.fillRect(Math.round(x) - 1, cy - 1, 2, 2);
    }
  }

  let mmMode: "pan" | "select" | null = null;
  let mmStartX = 0,
    mmStartSL = 0,
    mmPointerId = -1;
  let mmSelStartX = 0,
    mmSelCurX = 0,
    mmSelMoved = false;
  function drawSelectionPreview(): void {
    if (mmMode !== "select" || !mmSelMoved) return;
    const x1 = Math.max(0, Math.min(mmSelStartX, mmSelCurX));
    const x2 = Math.min(canvasViewW, Math.max(mmSelStartX, mmSelCurX));
    if (x2 <= x1) return;
    hctx.fillStyle = selectionFill;
    hctx.fillRect(x1, 0, x2 - x1, histHeight);
    hctx.strokeStyle = selectionStroke;
    hctx.lineWidth = 1;
    hctx.strokeRect(x1 + 0.5, 0.5, Math.max(1, x2 - x1 - 1), histHeight - 1);
  }

  applyLayout();
  drawCanvas();

  function findHit(mx: number, my: number): Position | null {
    let best: Position | null = null,
      bestDist = Infinity;
    const pad = 3;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      if (p.x < mx - 30) continue;
      if (p.x > mx + 30) break;
      const dx = p.x - mx,
        dy = p.y - my;
      if (Math.abs(dx) > p.hw + pad || Math.abs(dy) > p.hh + pad) continue;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDist) {
        best = p;
        bestDist = distSq;
      }
    }
    return best;
  }

  let dragging = false;

  contributors.forEach((c) => {
    if (c.avatarUrl) {
      const img = new Image();
      img.src = c.avatarUrl;
    }
  });

  let lastMouse: { clientX: number; clientY: number } | null = null;
  function applyHover(clientX: number, clientY: number): void {
    if (dragging) {
      tooltip.hide();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const outside = mx < 0 || mx > rect.width || my < 0 || my > rect.height;
    const hit = outside ? null : findHit(mx, my);
    if (hit) {
      tooltip.showCommit(hit.c, contributors[hit.idx], hit.color, clientX, clientY);
      canvas.style.cursor = "pointer";
    } else {
      tooltip.hide();
      canvas.style.cursor = "";
    }
    const newHash = hit ? hit.c.h : null;
    if (newHash !== hoveredHash) {
      hoveredHash = newHash;
      drawCanvas();
    }
  }
  canvas.addEventListener("mousemove", (e) => {
    lastMouse = { clientX: e.clientX, clientY: e.clientY };
    applyHover(e.clientX, e.clientY);
  });
  canvas.addEventListener("mouseleave", () => {
    lastMouse = null;
    tooltip.hide();
    if (hoveredHash) {
      hoveredHash = null;
      drawCanvas();
    }
  });
  let isDown = false,
    startX = 0,
    scrollLeft = 0,
    lastX = 0,
    lastTime = 0,
    velocity = 0,
    animId: number | null = null;
  let suppressClickUntil = 0;
  const SEL_THRESHOLD = 4;

  canvas.addEventListener("click", (e) => {
    if (Date.now() < suppressClickUntil || !D.githubBaseUrl) return;
    const rect = canvas.getBoundingClientRect();
    const hit = findHit(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) window.open(`${D.githubBaseUrl}/commit/${hit.c.h}`, "_blank");
  });

  function stopInertia(): void {
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }
  function inertia(): void {
    if (Math.abs(velocity) < 0.5) return;
    scrollDiv.scrollLeft -= velocity;
    velocity *= 0.95;
    animId = requestAnimationFrame(inertia);
  }
  scrollDiv.addEventListener("mousedown", (e) => {
    stopInertia();
    stopResetAnim();
    if (isZoomedOut()) {
      selecting = true;
      dragging = true;
      const rect = scrollDiv.getBoundingClientRect();
      selStartX = Math.max(0, Math.min(canvasViewW, e.clientX - rect.left));
      selCurX = selStartX;
      selMoved = false;
      tooltip.hide();
      return;
    }
    isDown = true;
    dragging = true;
    scrollDiv.classList.add("dragging");
    startX = e.pageX - scrollDiv.offsetLeft;
    scrollLeft = scrollDiv.scrollLeft;
    lastX = e.pageX;
    lastTime = Date.now();
    velocity = 0;
  });
  scrollDiv.addEventListener("mousemove", (e) => {
    if (selecting) {
      e.preventDefault();
      const rect = scrollDiv.getBoundingClientRect();
      selCurX = Math.max(0, Math.min(canvasViewW, e.clientX - rect.left));
      if (!selMoved && Math.abs(selCurX - selStartX) >= SEL_THRESHOLD) selMoved = true;
      if (selMoved) drawCanvas();
      return;
    }
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - scrollDiv.offsetLeft;
    scrollDiv.scrollLeft = scrollLeft - (x - startX);
    const now = Date.now(),
      dt = now - lastTime;
    if (dt > 0) {
      velocity = ((e.pageX - lastX) / dt) * 16;
      lastX = e.pageX;
      lastTime = now;
    }
  });
  function release(e?: MouseEvent): void {
    if (selecting) {
      selecting = false;
      dragging = false;
      const moved = selMoved;
      selMoved = false;
      if (moved) {
        const sl = scrollDiv.scrollLeft;
        const xa = Math.min(selStartX, selCurX),
          xb = Math.max(selStartX, selCurX);
        const sl1 = Math.max(0, Math.min(currentWidth, sl + xa));
        const sl2 = Math.max(0, Math.min(currentWidth, sl + xb));
        if (sl2 - sl1 >= 1 && currentWidth > 0 && canvasViewW > 0) {
          const daysSpan = Math.max(1e-6, (sl2 - sl1) / currentPxPerDay);
          const newPxPerDay = Math.max(minPxPerDay, Math.min(maxPxPerDay, canvasViewW / daysSpan));
          const frac = sl1 / currentWidth;
          currentPxPerDay = newPxPerDay;
          applyLayout();
          scrollDiv.scrollLeft = clampSL(frac * currentWidth);
          drawCanvas();
        }
        suppressClickUntil = Date.now() + 250;
      } else {
        drawCanvas();
      }
      return;
    }
    if (!isDown) return;
    const moved = Math.abs((e ? e.pageX : lastX) - (startX + scrollDiv.offsetLeft));
    isDown = false;
    dragging = false;
    scrollDiv.classList.remove("dragging");
    if (Math.abs(velocity) > 0.5) animId = requestAnimationFrame(inertia);
    if (moved > 4) suppressClickUntil = Date.now() + 250;
  }
  scrollDiv.addEventListener("mouseup", release);
  scrollDiv.addEventListener("mouseleave", release);

  function clampSL(sl: number): number {
    return Math.max(0, Math.min(currentWidth - canvasViewW, sl));
  }
  function isZoomedOut(): boolean {
    return currentPxPerDay <= minPxPerDay + 1e-4;
  }
  function updateZoomCursor(): void {
    scrollDiv.classList.toggle("zoom-mode", isZoomedOut());
  }
  function mmWindowAtX(x: number): boolean {
    const { left, right } = getMinimapWindow();
    return x >= left && x <= right;
  }
  function endMmDrag(): void {
    if (mmMode === null) return;
    const wasSelecting = mmMode === "select" && mmSelMoved;
    mmMode = null;
    mmSelMoved = false;
    document.body.style.cursor = "";
    histCanvas.style.cursor = "";
    if (mmPointerId !== -1 && histCanvas.hasPointerCapture(mmPointerId)) {
      histCanvas.releasePointerCapture(mmPointerId);
    }
    mmPointerId = -1;
    if (wasSelecting) drawHistogram();
  }
  const MM_SEL_THRESHOLD = 4;
  histCanvas.addEventListener("mousedown", (e) => e.stopPropagation());
  histCanvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stopInertia();
    stopResetAnim();
    tooltip.hide();
    const rect = histCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    mmPointerId = e.pointerId;
    histCanvas.setPointerCapture(e.pointerId);
    if (mmWindowAtX(x)) {
      mmMode = "pan";
      mmStartX = e.clientX;
      mmStartSL = scrollDiv.scrollLeft;
      document.body.style.cursor = "grabbing";
      histCanvas.style.cursor = "grabbing";
    } else {
      mmMode = "select";
      mmSelStartX = x;
      mmSelCurX = x;
      mmSelMoved = false;
      document.body.style.cursor = "crosshair";
      histCanvas.style.cursor = "crosshair";
    }
  });
  histCanvas.addEventListener("pointermove", (e) => {
    if (mmMode === "pan") {
      e.preventDefault();
      const dx = e.clientX - mmStartX;
      const slDelta = (dx / Math.max(1, canvasViewW)) * currentWidth;
      scrollDiv.scrollLeft = clampSL(mmStartSL + slDelta);
      return;
    }
    if (mmMode === "select") {
      e.preventDefault();
      const rect = histCanvas.getBoundingClientRect();
      mmSelCurX = Math.max(0, Math.min(canvasViewW, e.clientX - rect.left));
      if (!mmSelMoved && Math.abs(mmSelCurX - mmSelStartX) >= MM_SEL_THRESHOLD) {
        mmSelMoved = true;
      }
      if (mmSelMoved) drawHistogram();
      return;
    }
    const rect = histCanvas.getBoundingClientRect();
    histCanvas.style.cursor = mmWindowAtX(e.clientX - rect.left) ? "grab" : "pointer";
  });
  function commitMmPointer(): void {
    if (mmMode === "select") {
      if (mmSelMoved) {
        const x1 = Math.max(0, Math.min(mmSelStartX, mmSelCurX));
        const x2 = Math.min(canvasViewW, Math.max(mmSelStartX, mmSelCurX));
        const span = x2 - x1;
        if (span >= 1 && currentWidth > 0 && canvasViewW > 0) {
          const sl1 = (x1 / canvasViewW) * currentWidth;
          const sl2 = (x2 / canvasViewW) * currentWidth;
          const daysSpan = Math.max(1e-6, (sl2 - sl1) / currentPxPerDay);
          const newPxPerDay = Math.max(minPxPerDay, Math.min(maxPxPerDay, canvasViewW / daysSpan));
          const frac = sl1 / currentWidth;
          currentPxPerDay = newPxPerDay;
          applyLayout();
          scrollDiv.scrollLeft = clampSL(frac * currentWidth);
          drawCanvas();
        }
      } else {
        const frac = mmSelStartX / Math.max(1, canvasViewW);
        scrollDiv.scrollLeft = clampSL(frac * currentWidth - canvasViewW / 2);
      }
    }
    endMmDrag();
  }
  histCanvas.addEventListener("pointerup", commitMmPointer);
  histCanvas.addEventListener("pointercancel", () => endMmDrag());
  histCanvas.addEventListener("dblclick", (e) => {
    const rect = histCanvas.getBoundingClientRect();
    if (!mmWindowAtX(e.clientX - rect.left)) return;
    e.preventDefault();
    endMmDrag();
    stopInertia();
    animateReset();
  });

  function findTagHit(mx: number): number | null {
    if (!tags.length) return null;
    const sl = scrollDiv.scrollLeft;
    let best = -1,
      bestDist = Infinity;
    for (let i = 0; i < tags.length; i++) {
      const tMs = tagMsList[i];
      const xCanvas = (tMs / totalMs) * currentWidth - sl;
      const dx = Math.abs(xCanvas - mx);
      if (dx > tagDotRadius + tagHitPad) continue;
      if (dx < bestDist) {
        bestDist = dx;
        best = i;
      }
    }
    return best === -1 ? null : best;
  }

  function tagUrl(name: string): string | null {
    if (!D.githubBaseUrl || !name) return null;
    return `${D.githubBaseUrl}/releases/tag/${encodeURIComponent(name)}`;
  }

  if (tagCanvas) {
    tagCanvas.addEventListener("mousedown", (e) => e.stopPropagation());
    tagCanvas.addEventListener("mousemove", (e) => {
      const rect = tagCanvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const hit = findTagHit(mx);
      if (hit !== hoveredTagIdx) {
        hoveredTagIdx = hit;
        drawCanvas();
      }
      if (hit != null) {
        tagCanvas!.style.cursor = "pointer";
        tooltip.showTag(tags[hit], e.clientX, e.clientY);
      } else {
        tagCanvas!.style.cursor = "";
        tooltip.hide();
      }
    });
    tagCanvas.addEventListener("mouseleave", () => {
      if (hoveredTagIdx !== null) {
        hoveredTagIdx = null;
        drawCanvas();
      }
      tooltip.hide();
    });
    tagCanvas.addEventListener("click", (e) => {
      const rect = tagCanvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const hit = findTagHit(mx);
      if (hit == null) return;
      const url = tagUrl(tags[hit].name);
      if (url) window.open(url, "_blank");
    });
  }

  let scrollFrameQueued = false;
  scrollDiv.addEventListener(
    "scroll",
    () => {
      if (scrollFrameQueued) return;
      scrollFrameQueued = true;
      requestAnimationFrame(() => {
        scrollFrameQueued = false;
        rebuildAxis(false);
        drawCanvas();
        if (lastMouse) applyHover(lastMouse.clientX, lastMouse.clientY);
      });
    },
    { passive: true },
  );

  let zoomFrameQueued = false,
    accumDelta = 0,
    accumCtrl = false,
    lastWheel: { clientX: number } | null = null;
  scrollDiv.addEventListener(
    "wheel",
    (e) => {
      const zoomIntent = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!zoomIntent) return;
      e.preventDefault();
      stopInertia();
      stopResetAnim();
      accumDelta += e.deltaY || e.deltaX;
      accumCtrl = accumCtrl || e.ctrlKey;
      lastWheel = { clientX: e.clientX };
      tooltip.hide();
      if (zoomFrameQueued) return;
      zoomFrameQueued = true;
      requestAnimationFrame(() => {
        zoomFrameQueued = false;
        const k = accumCtrl ? 0.02 : 0.005;
        const factor = Math.exp(-accumDelta * k);
        accumDelta = 0;
        accumCtrl = false;
        const newPxPerDay = Math.max(minPxPerDay, Math.min(maxPxPerDay, currentPxPerDay * factor));
        if (Math.abs(newPxPerDay - currentPxPerDay) < 1e-4) return;
        const viewportRect = scrollDiv.getBoundingClientRect();
        const cursorInViewport = lastWheel!.clientX - viewportRect.left;
        const fracPos = (cursorInViewport + scrollDiv.scrollLeft) / currentWidth;
        currentPxPerDay = newPxPerDay;
        applyLayout();
        scrollDiv.scrollLeft = fracPos * currentWidth - cursorInViewport;
        drawCanvas();
      });
    },
    { passive: false },
  );

  window.addEventListener("resize", () => {
    if (canvasViewW === viewportW()) return;
    applyLayout();
    drawCanvas();
  });

  scrollDiv.scrollLeft = scrollDiv.scrollWidth;
  drawCanvas();
}
