// Summary table: per-contributor row + subtotal + grand totals, with the shared
// author popover on hover. Ported verbatim from template.html.
import type { RepoData } from "../types";
import { clr } from "./theme";
import { authorUrl, escapeHtml, fmt, pct } from "./format";
import type { AuthorPopover } from "./popovers";

// Sum of the listed contributors' commits (top-N), used by the commit-share pie.
export function topCommitSubtotal(D: RepoData): number {
  return D.contributors.reduce((acc, c) => acc + c.commits, 0);
}

export function renderTable(D: RepoData, authorPopover: AuthorPopover): void {
  const { contributors, totals } = D;
  const tbody = document.getElementById("tableBody");
  if (!tbody) return;
  let subC = 0,
    subA = 0,
    subD = 0,
    subN = 0;
  const rowsHtml = contributors
    .map((c, i) => {
      subC += c.commits;
      subA += c.added;
      subD += c.deleted;
      subN += c.net!;
      const highlight = c.highlight ? " highlight" : "";
      return `<tr><td>${i + 1}</td><td><span class="dot" style="background:${clr(i)}"></span><a class="author-link${highlight}" data-idx="${i}" href="${authorUrl(D, c)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">${escapeHtml(c.name)}</a></td><td class="num">${fmt(c.commits)}</td><td class="num pct">${pct(c.commits, totals.commits)}</td><td class="num">${fmt(c.added)}</td><td class="num pct">${pct(c.added, totals.added)}</td><td class="num">${fmt(c.deleted)}</td><td class="num pct">${pct(c.deleted, totals.deleted)}</td><td class="num">${fmt(c.net!)}</td><td class="num pct">${pct(c.net!, totals.net!)}</td><td class="num">${c.lc}</td><td class="num">${c.activeDays}</td><td class="num">${c.avgPerDay}</td><td style="font-size:0.72rem;color:var(--text-muted);">${c.first}</td><td style="font-size:0.72rem;color:var(--text-muted);">${c.last}</td></tr>`;
    })
    .join("");
  const subtotalHtml = `<tr class="subtotal"><td></td><td>Top ${contributors.length}</td><td class="num">${fmt(subC)}</td><td class="num">${pct(subC, totals.commits)}</td><td class="num">${fmt(subA)}</td><td class="num">${pct(subA, totals.added)}</td><td class="num">${fmt(subD)}</td><td class="num">${pct(subD, totals.deleted)}</td><td class="num">${fmt(subN)}</td><td class="num">${pct(subN, totals.net!)}</td><td class="num"></td><td class="num"></td><td class="num"></td><td></td><td></td></tr>`;
  const totalsHtml = `<tr class="totals"><td></td><td>All</td><td class="num">${fmt(totals.commits)}</td><td class="num">100%</td><td class="num">${fmt(totals.added)}</td><td class="num">100%</td><td class="num">${fmt(totals.deleted)}</td><td class="num">100%</td><td class="num">${fmt(totals.net!)}</td><td class="num">100%</td><td class="num">${+(totals.net! / totals.commits).toFixed(1)}</td><td class="num"></td><td class="num"></td><td></td><td></td></tr>`;
  tbody.innerHTML = rowsHtml + subtotalHtml + totalsHtml;

  tbody.addEventListener("mouseover", (e) => {
    const el = (e.target as Element).closest(".author-link") as HTMLElement | null;
    if (!el) return;
    authorPopover.show(+el.dataset.idx!, el);
  });
  tbody.addEventListener("mouseout", (e) => {
    const el = (e.target as Element).closest(".author-link") as HTMLElement | null;
    if (!el) return;
    if (el.contains((e as MouseEvent).relatedTarget as Node)) return;
    authorPopover.hide();
  });
}
