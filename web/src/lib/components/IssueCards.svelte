<script lang="ts">
  // Issue stat cards: who files the issues, which open issues have stalled, and
  // how long closes take. All computed from the payload's issues (newest ≤1000
  // closed) / openIssues (oldest ≤100 open); the whole section is omitted by
  // App.svelte when there's no issue data. Mirror of PrCards.svelte.
  import type { RepoData } from "$types";
  import type { AuthorPopover } from "$lib/popovers";
  import { clr } from "$lib/theme";
  import { fmt, fmtDuration, median, issuePageUrl, repoBase } from "$lib/format";

  let { data, authorPopover }: { data: RepoData; authorPopover: AuthorPopover | undefined } =
    $props();

  const closed = $derived(data.issues ?? []);
  const open = $derived(data.openIssues ?? []);
  const base = $derived(repoBase(data));
  const issueUrl = (n: number) => issuePageUrl(data, n);

  // The closed list is a window (newest MAX_ISSUES); say so when the repo has
  // more, so the per-reporter counts and close times read honestly.
  const windowNote = $derived(
    data.issueClosedCount != null && data.issueClosedCount > closed.length
      ? `Based on the ${fmt(closed.length)} most recent of ${fmt(data.issueClosedCount)} closed issues.`
      : "",
  );

  // --- top reporters by closed issues ---
  // Rows are styled like the summary table's author cells: matched contributors
  // get their identity dot, display name and the shared author popover; issue
  // reporters outside the contributor list fall back to a muted dot + login.
  const reporters = $derived.by(() => {
    const contribIdx = new Map<string, number>();
    data.contributors.forEach((c, i) => {
      if (c.login) contribIdx.set(c.login.toLowerCase(), i);
    });
    const counts = new Map<string, number>();
    for (const issue of closed) {
      if (!issue.author) continue;
      counts.set(issue.author, (counts.get(issue.author) ?? 0) + 1);
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
        url: base ? `${base}/issues?q=is%3Aissue+author%3A${login}` : undefined,
      };
    });
  });

  // --- time to close ---
  const durations = $derived(
    closed
      .map((issue) => ({ issue, ms: +new Date(issue.closedAt) - +new Date(issue.createdAt) }))
      .filter((d) => !Number.isNaN(d.ms) && d.ms >= 0),
  );
  // Sorted ascending once; the median reads the middle, the slowest the tail.
  const byMs = $derived([...durations].sort((a, b) => a.ms - b.ms));
  const medianMs = $derived(median(byMs.map((d) => d.ms)));
  const avgMs = $derived(
    durations.length ? durations.reduce((t, d) => t + d.ms, 0) / durations.length : 0,
  );
  const slowest = $derived(byMs.slice(-5).reverse());

  // --- stalled open issues ---
  // Age is measured to generation time, not view time: the dashboard is a
  // static snapshot and shouldn't age its issues while sitting in a browser tab.
  const asOf = $derived(data.generatedAt ? +new Date(data.generatedAt) : Date.now());
  const stalled = $derived(
    open
      .slice(0, 8)
      .map((issue) => ({ issue, age: fmtDuration(asOf - +new Date(issue.createdAt)) })),
  );
</script>

{#snippet issueLink(number: number, title: string)}
  {#if issueUrl(number)}
    <a class="pr-link" href={issueUrl(number)} target="_blank" rel="noopener noreferrer"
      ><span class="pr-num">#{number}</span> {title}</a
    >
  {:else}
    <span class="pr-link"><span class="pr-num">#{number}</span> {title}</span>
  {/if}
{/snippet}

<div class="grid-2">
  {#if reporters.length}
    <div class="card">
      <h3>Top issue reporters</h3>
      <div class="pr-rows">
        {#each reporters as a (a.login)}
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
      <h3>Time to close</h3>
      <div class="headline">
        <span><strong>{fmtDuration(medianMs) || "—"}</strong> median</span>
        <span><strong>{fmtDuration(avgMs) || "—"}</strong> average</span>
      </div>
      <div class="list-label">Slowest closes</div>
      <div class="pr-rows">
        {#each slowest as d (d.issue.number)}
          <div class="pr-row">
            {@render issueLink(d.issue.number, d.issue.title)}
            <span class="pr-meta">{fmtDuration(d.ms)}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
  {#if stalled.length}
    <div class="card">
      <h3>Stalled open issues</h3>
      <div class="pr-rows">
        {#each stalled as s (s.issue.number)}
          <div class="pr-row">
            {@render issueLink(s.issue.number, s.issue.title)}
            <span class="pr-meta"
              >{#if s.issue.author}{s.issue.author}{" · "}{/if}open {s.age}</span
            >
          </div>
        {/each}
      </div>
      {#if data.issueOpenCount != null && data.issueOpenCount > open.length}
        <div class="pr-note">
          Oldest {fmt(open.length)} of {fmt(data.issueOpenCount)} open issues.
        </div>
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
      background: rgb(var(--accent-issue));
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
