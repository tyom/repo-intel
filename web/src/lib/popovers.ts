// Thin adapters bridging the imperative consumers (timeline lane labels and the
// punch-card cells) to the reactive popover state in popover-store.svelte.ts,
// which the AuthorPopover / CommitPopover components render. The show/hide call
// sites in timeline.ts and charts.ts stay unchanged — they still receive an
// object with the same shape.
import type {
  Commit,
  Contributor,
  Issue,
  OpenIssue,
  OpenPullRequest,
  PullRequest,
  RepoData,
  Tag,
} from "$types";
import type { TimelineBundle } from "./timeline";
import {
  setAuthor,
  clearAuthor,
  setCommit,
  clearCommit,
  setCommitBaseUrl,
  setCommitTip,
  setTagTip,
  setPrTip,
  setIssueTip,
  clearTip,
} from "./popover-store.svelte";

export interface AuthorPopover {
  show(idx: number, el: Element): void;
  hide(): void;
}

export function createAuthorPopover(contributors: Contributor[]): AuthorPopover {
  return {
    show(idx: number, el: Element): void {
      const c = contributors[idx];
      if (!c) return;
      setAuthor(c, idx, el.getBoundingClientRect());
    },
    hide: clearAuthor,
  };
}

// === Commit-bucket popover ===
const dowFull = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// The punch card buckets each commit by the author-local wall-clock. Reproduce
// that from the ISO string itself — new Date(iso).getHours() would reinterpret
// the instant in the viewer's tz. dow is 0=Mon..6=Sun (matches Python weekday()).
function isoBuckets(iso: string): { hour: number; dow: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):/.exec(iso || "");
  if (!m) return null;
  const dow = (new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() + 6) % 7;
  return { hour: +m[4], dow };
}

// A single scatter point: [hour 0-23, dow 0-6, commit count]. Zero-count cells
// are omitted so the scatter only renders dots that exist.
export type PunchPoint = [number, number, number];

// One pass over the commit list builds the joint hour×weekday distribution for
// every author — the marginals the old bar charts used can't be re-joined, so
// the punch card is computed straight from the per-commit timestamps.
export function buildPunchPoints(commits: Commit[]): Record<string, PunchPoint[]> {
  const acc: Record<string, Map<number, number>> = {};
  for (const c of commits) {
    const b = isoBuckets(c.d);
    if (!b) continue;
    const cells = (acc[c.e] ??= new Map());
    const key = b.dow * 24 + b.hour;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  const out: Record<string, PunchPoint[]> = {};
  for (const [email, cells] of Object.entries(acc)) {
    out[email] = Array.from(cells, ([key, count]) => [key % 24, Math.floor(key / 24), count]);
  }
  return out;
}

// Whether the payload carries any PR data. Single definition so the nav link,
// PR section and table columns can't disagree.
export const hasPrData = (D: RepoData): boolean =>
  (D.pullRequests?.length ?? 0) > 0 || (D.openPullRequests?.length ?? 0) > 0;

// Same, for issue data — keeps the nav link and issue section in agreement.
export const hasIssueData = (D: RepoData): boolean =>
  (D.issues?.length ?? 0) > 0 || (D.openIssues?.length ?? 0) > 0;

// Per-login PR counts (merged from the fetched window, open from the open
// list), keyed by lowercased GitHub login. Shared by the summary table, the
// PR-authors card and the author popover.
export interface PrAuthorCounts {
  merged: number;
  open: number;
}

export function buildPrCountsByLogin(D: RepoData): Map<string, PrAuthorCounts> {
  const map = new Map<string, PrAuthorCounts>();
  const add = (login: string, key: keyof PrAuthorCounts) => {
    if (!login) return;
    const k = login.toLowerCase();
    const e = map.get(k) ?? { merged: 0, open: 0 };
    e[key]++;
    map.set(k, e);
  };
  for (const p of D.pullRequests ?? []) add(p.author, "merged");
  for (const p of D.openPullRequests ?? []) add(p.author, "open");
  return map;
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
  commitsInCell(email: string, hour: number, dow: number): Commit[];
  readonly dowFull: string[];
}

export function createCommitPopover(D: RepoData): CommitPopover {
  setCommitBaseUrl(D.githubBaseUrl ?? "");

  function commitsInCell(email: string, hour: number, dow: number): Commit[] {
    return (D.commits || [])
      .filter((c) => {
        if (c.e !== email) return false;
        const b = isoBuckets(c.d);
        return b !== null && b.hour === hour && b.dow === dow;
      })
      .sort((a, b) => +new Date(b.d) - +new Date(a.d));
  }

  return {
    show(anchor, c, colorIdx, label, list): void {
      setCommit(c, colorIdx, label, list, anchor);
    },
    hide: clearCommit,
    commitsInCell,
    dowFull,
  };
}

// === Timeline hover tooltip ===
// The timeline canvas hover handlers drive this; TimelineTooltip.svelte renders
// it. show* fires on every mousemove over a commit/tag (the store guards against
// rebuilding when the hovered item is unchanged), hide on leave/drag/zoom.
export interface TimelineTooltip {
  showCommit(c: TimelineBundle, author: Contributor, color: string, x: number, y: number): void;
  showTag(tags: Tag[], x: number, y: number): void;
  showPr(pr: PullRequest | OpenPullRequest, x: number, y: number): void;
  showIssue(issue: Issue | OpenIssue, x: number, y: number): void;
  hide(): void;
}

export function createTimelineTooltip(): TimelineTooltip {
  return {
    showCommit: setCommitTip,
    showTag: setTagTip,
    showPr: setPrTip,
    showIssue: setIssueTip,
    hide: clearTip,
  };
}
