// Reactive state for the body-portaled popovers + the timeline hover tooltip.
// The imperative consumers (timeline lane labels & canvas, punch-card cells)
// drive these through the thin adapters in popovers.ts; the AuthorPopover /
// CommitPopover / TimelineTooltip components read the state and render it. Lives
// in a .svelte.ts module so it can hold $state.
import type { Commit, Contributor, Tag } from "$types";
import type { TimelineBundle } from "./timeline";

export interface AuthorPopoverState {
  c: Contributor | null;
  idx: number;
  anchor: DOMRect | null;
}

export interface CommitPopoverState {
  c: Contributor | null;
  colorIdx: number;
  label: string;
  list: Commit[];
  anchor: { x: number; top: number; bottom: number } | null;
  baseUrl: string;
  open: boolean;
}

export const authorState: AuthorPopoverState = $state({ c: null, idx: 0, anchor: null });

// Repo-wide commit total, set once at startup so the popover can show each
// contributor's share of all commits. Kept here (not on each setAuthor call)
// because every consumer — table, timeline, churn axis, treemap — would
// otherwise have to thread the same total through.
export const authorMeta = $state({ totalCommits: 0 });

export function setAuthorTotalCommits(total: number): void {
  authorMeta.totalCommits = total;
}

export const commitState: CommitPopoverState = $state({
  c: null,
  colorIdx: 0,
  label: "",
  list: [],
  anchor: null,
  baseUrl: "",
  open: false,
});

export function setAuthor(c: Contributor, idx: number, anchor: DOMRect): void {
  authorState.c = c;
  authorState.idx = idx;
  authorState.anchor = anchor;
}

export function clearAuthor(): void {
  authorState.c = null;
}

export function setCommitBaseUrl(baseUrl: string): void {
  commitState.baseUrl = baseUrl;
}

export function setCommit(
  c: Contributor,
  colorIdx: number,
  label: string,
  list: Commit[],
  anchor: { x: number; top: number; bottom: number },
): void {
  commitState.c = c;
  commitState.colorIdx = colorIdx;
  commitState.label = label;
  commitState.list = list;
  commitState.anchor = anchor;
  commitState.open = true;
}

export function clearCommit(): void {
  commitState.open = false;
}

// === Timeline hover tooltip ===
// One shared node, two content shapes: a commit (bundle) tip and a git-tag tip,
// discriminated by `kind`. Unlike the popovers above it follows the cursor, so
// it also carries the live {x, y} the position action reads to reposition.
export interface TimelineTipState {
  kind: "commit" | "tag" | null;
  // commit
  c: TimelineBundle | null;
  author: Contributor | null;
  color: string;
  // tag — one or more tags sharing the hovered commit (same dot)
  tags: Tag[];
  // cursor (viewport coords)
  x: number;
  y: number;
}

export const timelineTipState: TimelineTipState = $state({
  kind: null,
  c: null,
  author: null,
  color: "",
  tags: [],
  x: 0,
  y: 0,
});

// Reassign the content fields only when the hovered bundle changes (cheap
// reposition on every mousemove otherwise) — this replaces the old tooltipHash
// guard and avoids re-triggering the component's $derived rebuild.
export function setCommitTip(
  c: TimelineBundle,
  author: Contributor,
  color: string,
  x: number,
  y: number,
): void {
  if (timelineTipState.kind !== "commit" || timelineTipState.c?.h !== c.h) {
    timelineTipState.kind = "commit";
    timelineTipState.c = c;
    timelineTipState.author = author;
    timelineTipState.color = color;
  }
  timelineTipState.x = x;
  timelineTipState.y = y;
}

export function setTagTip(tags: Tag[], x: number, y: number): void {
  // Tags in a group share a commit (oid), so the first oid + count identify it.
  if (
    timelineTipState.kind !== "tag" ||
    timelineTipState.tags[0]?.oid !== tags[0]?.oid ||
    timelineTipState.tags.length !== tags.length
  ) {
    timelineTipState.kind = "tag";
    timelineTipState.tags = tags;
  }
  timelineTipState.x = x;
  timelineTipState.y = y;
}

export function clearTip(): void {
  timelineTipState.kind = null;
}
