<script lang="ts">
  // Pull-request stat cards: who lands the merged PRs, which open PRs have
  // stalled, and how long merges take. All computed from the payload's
  // pullRequests (newest ≤1000 merged) / openPullRequests (oldest ≤100 open);
  // the whole section is omitted by App.svelte when there's no PR data.
  import type { RepoData } from "$types";
  import type { AuthorPopover } from "$lib/popovers";
  import { clr } from "$lib/theme";
  import { fmt, fmtDuration, median, prPageUrl, repoBase } from "$lib/format";

  let { data, authorPopover }: { data: RepoData; authorPopover: AuthorPopover | undefined } =
    $props();

  const merged = $derived(data.pullRequests ?? []);
  const open = $derived(data.openPullRequests ?? []);
  const base = $derived(repoBase(data));
  const prUrl = (n: number) => prPageUrl(data, n);

  // The merged list is a window (newest MAX_PULL_REQUESTS); say so when the
  // repo has more, so the per-author counts and merge times read honestly.
  const windowNote = $derived(
    data.prCount != null && data.prCount > merged.length
      ? `Based on the ${fmt(merged.length)} most recent of ${fmt(data.prCount)} merged PRs.`
      : "",
  );

  // --- top authors by merged PRs ---
  // Rows are styled like the summary table's author cells: matched contributors
  // get their identity dot, display name and the shared author popover; PR
  // authors outside the contributor list fall back to a muted dot + login.
  const authors = $derived.by(() => {
    const contribIdx = new Map<string, number>();
    data.contributors.forEach((c, i) => {
      if (c.login) contribIdx.set(c.login.toLowerCase(), i);
    });
    const counts = new Map<string, number>();
    for (const pr of merged) {
      if (!pr.author) continue;
      counts.set(pr.author, (counts.get(pr.author) ?? 0) + 1);
    }
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    const max = rows[0]?.[1] ?? 1;
    return rows.map(([login, count]) => {
      const idx = contribIdx.get(login.toLowerCase());
      const c = idx != null ? data.contributors[idx] : undefined;
      return {
        login,
        idx,
        name: c?.name ?? login,
        color: idx != null ? clr(idx) : "var(--text-muted)",
        highlight: c?.highlight ?? false,
        count,
        width: (count / max) * 100,
        url: base ? `${base}/pulls?q=is%3Apr+is%3Amerged+author%3A${login}` : undefined,
      };
    });
  });

  // --- time to merge ---
  const durations = $derived(
    merged
      .map((pr) => ({ pr, ms: +new Date(pr.mergedAt) - +new Date(pr.createdAt) }))
      .filter((d) => !Number.isNaN(d.ms) && d.ms >= 0),
  );
  // Sorted ascending once; the median reads the middle, the slowest the tail.
  const byMs = $derived([...durations].sort((a, b) => a.ms - b.ms));
  const medianMs = $derived(median(byMs.map((d) => d.ms)));
  const avgMs = $derived(
    durations.length ? durations.reduce((t, d) => t + d.ms, 0) / durations.length : 0,
  );
  const slowest = $derived(byMs.slice(-5).reverse());

  // --- stalled open PRs ---
  // Age is measured to generation time, not view time: the dashboard is a
  // static snapshot and shouldn't age its PRs while sitting in a browser tab.
  const asOf = $derived(data.generatedAt ? +new Date(data.generatedAt) : Date.now());
  const stalled = $derived(
    open.slice(0, 8).map((pr) => ({ pr, age: fmtDuration(asOf - +new Date(pr.createdAt)) })),
  );
</script>

{#snippet prLink(number: number, title: string)}
  {#if prUrl(number)}
    <a class="pr-link" href={prUrl(number)} target="_blank" rel="noopener noreferrer"
      ><span class="pr-num">#{number}</span> {title}</a
    >
  {:else}
    <span class="pr-link"><span class="pr-num">#{number}</span> {title}</span>
  {/if}
{/snippet}

<div class="grid-2">
  {#if authors.length}
    <div class="card">
      <h3>Top PR authors</h3>
      <div class="pr-rows">
        {#each authors as a (a.login)}
          <div class="author-row">
            <span class="author-cell">
              <span class="dot" style="background:{a.color}"></span>
              {#if a.url}
                <a
                  class="pr-author"
                  class:highlight={a.highlight}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onmouseenter={(e) => a.idx != null && authorPopover?.show(a.idx, e.currentTarget)}
                  onmouseleave={() => authorPopover?.hide()}>{a.name}</a
                >
              {:else}<span class="pr-author" class:highlight={a.highlight}>{a.name}</span>{/if}
            </span>
            <div class="bar-track"><div class="bar" style="width:{a.width}%"></div></div>
            <span class="pr-count">{fmt(a.count)}</span>
          </div>
        {/each}
      </div>
      {#if windowNote}<div class="pr-note">{windowNote}</div>{/if}
    </div>
  {/if}
  {#if durations.length}
    <div class="card">
      <h3>Time to merge</h3>
      <div class="headline">
        <span><strong>{fmtDuration(medianMs) || "—"}</strong> median</span>
        <span><strong>{fmtDuration(avgMs) || "—"}</strong> average</span>
      </div>
      <div class="list-label">Slowest merges</div>
      <div class="pr-rows">
        {#each slowest as d (d.pr.number)}
          <div class="pr-row">
            {@render prLink(d.pr.number, d.pr.title)}
            <span class="pr-meta">{fmtDuration(d.ms)}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
  {#if stalled.length}
    <div class="card">
      <h3>Stalled open PRs</h3>
      <div class="pr-rows">
        {#each stalled as s (s.pr.number)}
          <div class="pr-row">
            {@render prLink(s.pr.number, s.pr.title)}
            <span class="pr-meta"
              >{#if s.pr.author}{s.pr.author}{" · "}{/if}open {s.age}</span
            >
          </div>
        {/each}
      </div>
      {#if data.prOpenCount != null && data.prOpenCount > open.length}
        <div class="pr-note">Oldest {fmt(open.length)} of {fmt(data.prOpenCount)} open PRs.</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  h3 {
    margin: 0 0 12px;
    font-size: 0.8rem;
    font-weight: 700;
  }

  .pr-rows {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .author-row {
    display: grid;
    grid-template-columns: minmax(110px, 180px) 1fr max-content;
    align-items: center;
    gap: 10px;
    font-size: 0.75rem;
  }

  .author-cell {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .pr-author {
    color: var(--text-primary);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
      text-decoration: underline;
    }
  }

  .bar-track {
    height: 8px;
    border-radius: 4px;
    background: var(--bg-badge);
    overflow: hidden;

    .bar {
      height: 100%;
      border-radius: 4px;
      background: rgb(var(--accent-pr));
    }
  }

  .pr-count {
    font-size: 0.72rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .headline {
    display: flex;
    gap: 18px;
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 14px;

    strong {
      color: var(--text-primary);
      font-size: 0.95rem;
      margin-right: 4px;
    }
  }

  .list-label {
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .pr-row {
    display: grid;
    grid-template-columns: 1fr max-content;
    align-items: baseline;
    gap: 12px;
    font-size: 0.75rem;
  }

  .pr-link {
    color: var(--text-primary);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
      text-decoration: underline;
    }
  }

  .pr-num {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .pr-meta {
    font-size: 0.7rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .pr-note {
    margin-top: 12px;
    font-size: 0.68rem;
    color: var(--text-muted);
  }
</style>
