// Thin adapters bridging the imperative consumers (timeline lane labels and the
// hour/dow chart bars) to the reactive popover state in popover-store.svelte.ts,
// which the AuthorPopover / CommitPopover components render. The show/hide call
// sites in timeline.ts and charts.ts stay unchanged — they still receive an
// object with the same shape.
import type { Commit, Contributor, RepoData } from "$types";
import {
  setAuthor,
  clearAuthor,
  setCommit,
  clearCommit,
  setCommitBaseUrl,
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
  setCommitBaseUrl(D.githubBaseUrl ?? "");

  function commitsInBucket(email: string, kind: "hour" | "dow", idx: number): Commit[] {
    return (D.commits || [])
      .filter((c) => {
        if (c.e !== email) return false;
        const b = isoBuckets(c.d);
        return b && (kind === "hour" ? b.hour === idx : b.dow === idx);
      })
      .sort((a, b) => +new Date(b.d) - +new Date(a.d));
  }

  return {
    show(anchor, c, colorIdx, label, list): void {
      setCommit(c, colorIdx, label, list, anchor);
    },
    hide: clearCommit,
    commitsInBucket,
    dowFull,
  };
}
