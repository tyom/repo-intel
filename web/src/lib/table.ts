// The summary table render moved to lib/components/Table.svelte. This module now
// only holds the top-N commit subtotal used by the commit-share pie (charts.ts).
import type { RepoData } from "../types";

// Sum of the listed contributors' commits (top-N), used by the commit-share pie.
export function topCommitSubtotal(D: RepoData): number {
  return D.contributors.reduce((acc, c) => acc + c.commits, 0);
}
