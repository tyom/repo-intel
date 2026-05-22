// Body-appended singleton popovers, ported verbatim from template.html.
//  - Author popover: shared by the timeline lane labels and the summary table.
//  - Commit-bucket popover: opened by clicking a bar in the hour/dow charts.
import type { Commit, Contributor, RepoData } from "../types";
import { clr } from "./theme";
import { escapeHtml, fmt, langBarHtml } from "./format";
import { installAvatarFallback } from "./avatar";

const ICON_LOC =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M11.536 3.464a5 5 0 0 1 0 7.072L8 14.07l-3.536-3.535a5 5 0 1 1 7.072-7.072Zm1.06 8.132a6.5 6.5 0 1 0-9.192 0l3.535 3.536a1.5 1.5 0 0 0 2.122 0l3.535-3.536ZM8 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>';
const ICON_MAIL =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25v-8.5C0 2.784.784 2 1.75 2ZM1.5 12.251c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V5.809L8.38 9.397a.75.75 0 0 1-.76 0L1.5 5.809v6.442Zm13-8.181v-.32a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25v.32L8 7.88Z"/></svg>';
const ICON_LINK =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0Z"/></svg>';

export interface AuthorPopover {
  show(idx: number, el: Element): void;
  hide(): void;
}

export function createAuthorPopover(contributors: Contributor[]): AuthorPopover {
  const authorPopover = document.createElement("div");
  authorPopover.className = "lane-popover";
  document.body.appendChild(authorPopover);

  function show(idx: number, el: Element): void {
    const c = contributors[idx];
    if (!c) return;
    const av = c.avatarUrl;
    const p = c.profile || {};
    const handle = c.login ? "@" + c.login : "";
    const initial = (c.name || "?").trim().charAt(0).toUpperCase();
    const avatarHtml = av
      ? `<img class="lp-avatar" src="${escapeHtml(av)}" alt="" data-fallback-class="lp-avatar-fallback" data-bg="${escapeHtml(clr(idx))}" data-initial="${escapeHtml(initial)}">`
      : `<div class="lp-avatar-fallback" style="background:${clr(idx)}">${escapeHtml(initial)}</div>`;

    const bioHtml = p.bio ? `<div class="lp-bio">${escapeHtml(p.bio)}</div>` : "";

    const counts: string[] = [];
    if (typeof p.followers === "number")
      counts.push(`<strong>${fmt(p.followers)}</strong> follower${p.followers === 1 ? "" : "s"}`);
    if (typeof p.following === "number") counts.push(`<strong>${fmt(p.following)}</strong> following`);
    if (typeof p.publicRepos === "number")
      counts.push(`<strong>${fmt(p.publicRepos)}</strong> repo${p.publicRepos === 1 ? "" : "s"}`);
    const countsHtml = counts.length ? `<div class="lp-counts">${counts.join(" · ")}</div>` : "";

    const metaRows: string[] = [];
    if (p.location)
      metaRows.push(`<div class="lp-meta-row">${ICON_LOC}<span class="lp-meta-text">${escapeHtml(p.location)}</span></div>`);
    if (c.email)
      metaRows.push(`<div class="lp-meta-row">${ICON_MAIL}<span class="lp-meta-text">${escapeHtml(c.email)}</span></div>`);
    if (p.websiteUrl)
      metaRows.push(`<div class="lp-meta-row">${ICON_LINK}<span class="lp-meta-text">${escapeHtml(p.websiteUrl)}</span></div>`);
    const metaHtml = metaRows.length ? `<div class="lp-meta">${metaRows.join("")}</div>` : "";

    const net = c.added - c.deleted;
    const netHtml =
      net > 0 ? `<span class="add">+${fmt(net)}</span>` : net < 0 ? `<span class="del">${fmt(net)}</span>` : fmt(net);

    authorPopover.innerHTML =
      `<div class="lp-header">${avatarHtml}<div class="lp-id"><div class="lp-name">${escapeHtml(c.name)}</div>${handle ? `<span class="lp-handle">${escapeHtml(handle)}</span>` : ""}</div></div>` +
      bioHtml +
      countsHtml +
      metaHtml +
      `<div class="lp-divider"></div>` +
      `<div class="lp-stats">${fmt(c.commits)} commits · ${c.activeDays} active day${c.activeDays === 1 ? "" : "s"}</div>` +
      `<div class="lp-stats"><span class="add">+${fmt(c.added)}</span> <span class="del">-${fmt(c.deleted)}</span> (net ${netHtml})</div>` +
      `<div class="lp-period">${c.first} — ${c.last}</div>` +
      langBarHtml(c.languages, { legend: true });
    installAvatarFallback(authorPopover.querySelector(".lp-avatar"));

    authorPopover.style.transform = "";
    authorPopover.style.left = "-9999px";
    authorPopover.style.top = "0px";
    const w = authorPopover.offsetWidth;
    const h = authorPopover.offsetHeight;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = rect.right + 12;
    if (left + w + margin > vw) left = Math.max(margin, rect.left - 12 - w);
    let top = rect.top + rect.height / 2 - h / 2;
    if (top + h + margin > vh) top = vh - h - margin;
    if (top < margin) top = margin;
    authorPopover.style.left = left + "px";
    authorPopover.style.top = top + "px";
    authorPopover.classList.add("visible");
  }

  function hide(): void {
    authorPopover.classList.remove("visible");
  }

  return { show, hide };
}

// === Commit-bucket popover ===
const dowFull = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// The bars are histograms bucketed server-side by the commit's author-local
// wall-clock. Reproduce that bucketing from the ISO string itself —
// new Date(iso).getHours() would reinterpret the instant in the viewer's tz.
function isoBuckets(iso: string): { hour: number; dow: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):/.exec(iso || "");
  if (!m) return null;
  const dow = (new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() + 6) % 7;
  return { hour: +m[4], dow };
}

export interface CommitPopover {
  show(
    anchor: { x: number; top: number; bottom: number },
    c: Contributor,
    colorIdx: number,
    label: string,
    list: Commit[],
  ): void;
  hide(): void;
  commitsInBucket(email: string, kind: "hour" | "dow", idx: number): Commit[];
  readonly dowFull: string[];
}

export function createCommitPopover(D: RepoData): CommitPopover {
  const commitPopover = document.createElement("div");
  commitPopover.className = "commit-popover";
  document.body.appendChild(commitPopover);
  let open = false;

  function hide(): void {
    if (open) {
      commitPopover.classList.remove("visible");
      open = false;
    }
  }

  function commitsInBucket(email: string, kind: "hour" | "dow", idx: number): Commit[] {
    return (D.commits || [])
      .filter((c) => {
        if (c.e !== email) return false;
        const b = isoBuckets(c.d);
        return b && (kind === "hour" ? b.hour === idx : b.dow === idx);
      })
      .sort((a, b) => +new Date(b.d) - +new Date(a.d));
  }

  function show(
    anchor: { x: number; top: number; bottom: number },
    c: Contributor,
    colorIdx: number,
    label: string,
    list: Commit[],
  ): void {
    const ROW_CAP = 200;
    const rows = list
      .slice(0, ROW_CAP)
      .map(
        (c2) =>
          `<a class="cp-row" href="${D.githubBaseUrl}/commit/${encodeURIComponent(c2.h)}" target="_blank" rel="noopener">` +
          `<span class="cp-hash">${escapeHtml(c2.h)}</span>` +
          `<span class="cp-msg">${escapeHtml(c2.s || "")}</span>` +
          `<span class="cp-date">${escapeHtml((c2.d || "").slice(0, 16).replace("T", " "))}</span></a>`,
      )
      .join("");
    const more = list.length > ROW_CAP ? `<div class="cp-more">+${fmt(list.length - ROW_CAP)} more</div>` : "";
    commitPopover.innerHTML =
      `<div class="cp-title" style="color:${clr(colorIdx)}">${escapeHtml(label)}</div>` +
      `<div class="cp-sub">${escapeHtml(c.name)} · ${fmt(list.length)} commit${list.length === 1 ? "" : "s"}</div>` +
      `<div class="cp-list">${rows}</div>${more}`;

    commitPopover.style.left = "-9999px";
    commitPopover.style.top = "0px";
    commitPopover.classList.add("visible");
    open = true;
    const w = commitPopover.offsetWidth,
      h = commitPopover.offsetHeight,
      margin = 8;
    const vw = document.documentElement.clientWidth,
      vh = document.documentElement.clientHeight;
    let left = Math.max(margin, Math.min(anchor.x - w / 2, vw - w - margin));
    let top = anchor.top - h - 10;
    if (top < margin) top = anchor.bottom + 10;
    if (top + h + margin > vh) top = Math.max(margin, vh - h - margin);
    commitPopover.style.left = left + "px";
    commitPopover.style.top = top + "px";
  }

  // Dismiss on outside click, scroll, or Escape (capture phase, so reopening on
  // a fresh bar still works).
  document.addEventListener(
    "click",
    (e) => {
      if (open && !commitPopover.contains(e.target as Node)) hide();
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  window.addEventListener(
    "scroll",
    (e) => {
      if (open && !commitPopover.contains(e.target as Node)) hide();
    },
    true,
  );

  return { show, hide, commitsInBucket, dowFull };
}
