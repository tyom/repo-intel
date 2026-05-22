// Reactive state for the two body-portaled popovers. The imperative consumers
// (timeline lane labels, hour/dow chart bars) drive these through the thin
// adapters in popovers.ts; the AuthorPopover / CommitPopover components read the
// state and render it. Lives in a .svelte.ts module so it can hold $state.
import type { Commit, Contributor } from "../types";

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
