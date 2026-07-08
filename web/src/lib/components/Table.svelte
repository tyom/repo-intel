<script lang="ts">
  // Summary table: per-contributor row + "Top N" subtotal + grand totals, with
  // the shared author popover on hover. Svelte port of the old renderTable() —
  // names are auto-escaped by Svelte (no escapeHtml), net/lc/avgPerDay are
  // computed here, and the popover is wired per-row instead of via event
  // delegation + data-idx.
  import type { RepoData } from "$types";
  import { buildPrCountsByLogin, type AuthorPopover } from "$lib/popovers";
  import { clr } from "$lib/theme";
  import { authorUrl, fmt, pct } from "$lib/format";

  let { data, authorPopover }: { data: RepoData; authorPopover: AuthorPopover | undefined } =
    $props();

  const totals = $derived(data.totals);
  const totalNet = $derived(data.totals.added - data.totals.deleted);

  // Per-login PR counts (merged from the fetched window, open from the open
  // list), matched to contributors by GitHub login. Columns only exist when
  // the collector fetched PR data at all.
  const hasPrCols = $derived(
    (data.pullRequests?.length ?? 0) > 0 || (data.openPullRequests?.length ?? 0) > 0,
  );
  const prCounts = $derived(buildPrCountsByLogin(data));

  // Per-row view models, with net/lc/avgPerDay derived locally.
  const rows = $derived(
    data.contributors.map((c, i) => {
      const net = c.added - c.deleted;
      const login = (c.login || "").toLowerCase();
      return {
        c,
        i,
        color: clr(i),
        url: authorUrl(data, c),
        net,
        lc: c.commits ? +(net / c.commits).toFixed(1) : 0,
        avgPerDay: c.activeDays ? +(c.commits / c.activeDays).toFixed(1) : 0,
        prMerged: (login && prCounts.get(login)?.merged) || 0,
        prOpen: (login && prCounts.get(login)?.open) || 0,
      };
    }),
  );

  // Running totals for the "Top N" subtotal row.
  const sub = $derived(
    rows.reduce(
      (acc, r) => {
        acc.commits += r.c.commits;
        acc.added += r.c.added;
        acc.deleted += r.c.deleted;
        acc.net += r.net;
        acc.prMerged += r.prMerged;
        acc.prOpen += r.prOpen;
        return acc;
      },
      { commits: 0, added: 0, deleted: 0, net: 0, prMerged: 0, prOpen: 0 },
    ),
  );

  const grandLc = $derived(totals.commits ? +(totalNet / totals.commits).toFixed(1) : 0);

  // Column sorting: click a header to sort, click again to flip. Numeric
  // columns start descending (biggest first), text/date columns ascending.
  // The % columns mirror their neighbour so they aren't separately sortable,
  // and the # column keeps the original commits rank.
  type Row = (typeof rows)[number];
  type SortKey =
    | "name"
    | "commits"
    | "added"
    | "deleted"
    | "net"
    | "lc"
    | "activeDays"
    | "avgPerDay"
    | "prMerged"
    | "prOpen"
    | "first"
    | "last";
  const getters: Record<SortKey, (r: Row) => number | string> = {
    name: (r) => r.c.name.toLowerCase(),
    commits: (r) => r.c.commits,
    added: (r) => r.c.added,
    deleted: (r) => r.c.deleted,
    net: (r) => r.net,
    lc: (r) => r.lc,
    activeDays: (r) => r.c.activeDays,
    avgPerDay: (r) => r.avgPerDay,
    prMerged: (r) => r.prMerged,
    prOpen: (r) => r.prOpen,
    first: (r) => r.c.first,
    last: (r) => r.c.last,
  };
  const textKeys: SortKey[] = ["name", "first", "last"];
  let sortKey = $state<SortKey | null>(null);
  let sortAsc = $state(false);

  function sortBy(key: SortKey) {
    if (sortKey === key) sortAsc = !sortAsc;
    else {
      sortKey = key;
      sortAsc = textKeys.includes(key);
    }
  }

  const sortedRows = $derived.by(() => {
    if (!sortKey) return rows;
    const get = getters[sortKey];
    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a),
        vb = get(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  });
</script>

{#snippet sortTh(key: SortKey, label: string, num: boolean)}
  <th
    class="sortable"
    class:num
    aria-sort={sortKey === key ? (sortAsc ? "ascending" : "descending") : undefined}
    onclick={() => sortBy(key)}
    >{label}{#if sortKey === key}<span class="sort-arrow">{sortAsc ? "▲" : "▼"}</span>{/if}</th
  >
{/snippet}

<div class="card summary-card">
  <h2>Summary</h2>
  <!-- Same hidden-until-useful treatment as .chart-reset-btn: invisible,
       untabbable and click-inert until a sort is active. -->
  <button
    class="table-reset-btn"
    class:visible={sortKey != null}
    tabindex={sortKey != null ? 0 : -1}
    aria-hidden={sortKey == null}
    onclick={() => (sortKey = null)}>Reset sort</button
  >
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>#</th>
          {@render sortTh("name", "Author", false)}
          {@render sortTh("commits", "Commits", true)}
          <th class="num">%</th>
          {@render sortTh("added", "Added", true)}
          <th class="num">%</th>
          {@render sortTh("deleted", "Deleted", true)}
          <th class="num">%</th>
          {@render sortTh("net", "Net", true)}
          <th class="num">%</th>
          {@render sortTh("lc", "L/C", true)}
          {@render sortTh("activeDays", "Active days", true)}
          {@render sortTh("avgPerDay", "Avg/day", true)}
          {#if hasPrCols}
            {@render sortTh("prMerged", "Merged PRs", true)}
            {@render sortTh("prOpen", "Open PRs", true)}
          {/if}
          {@render sortTh("first", "First", false)}
          {@render sortTh("last", "Last", false)}
        </tr>
      </thead>
      <tbody>
        {#each sortedRows as r (r.i)}
          <tr>
            <td>{r.i + 1}</td>
            <td>
              <span class="dot" style="background:{r.color}"></span>
              <!-- mouseenter/leave (not over/out) means no relatedTarget guard
                   is needed: leave doesn't fire when moving onto child nodes. -->
              <a
                class="author-link"
                class:highlight={r.c.highlight}
                href={r.url}
                target="_blank"
                rel="noopener"
                style="color:inherit;text-decoration:none;"
                onmouseenter={(e) => authorPopover?.show(r.i, e.currentTarget)}
                onmouseleave={() => authorPopover?.hide()}>{r.c.name}</a
              >
            </td>
            <td class="num">{fmt(r.c.commits)}</td>
            <td class="num pct">{pct(r.c.commits, totals.commits)}</td>
            <td class="num">{fmt(r.c.added)}</td>
            <td class="num pct">{pct(r.c.added, totals.added)}</td>
            <td class="num">{fmt(r.c.deleted)}</td>
            <td class="num pct">{pct(r.c.deleted, totals.deleted)}</td>
            <td class="num">{fmt(r.net)}</td>
            <td class="num pct">{pct(r.net, totalNet)}</td>
            <td class="num">{r.lc}</td>
            <td class="num">{r.c.activeDays}</td>
            <td class="num">{r.avgPerDay}</td>
            {#if hasPrCols}
              <td class="num">{r.prMerged ? fmt(r.prMerged) : ""}</td>
              <td class="num">{r.prOpen ? fmt(r.prOpen) : ""}</td>
            {/if}
            <td style="font-size:0.72rem;color:var(--text-muted);">{r.c.first}</td>
            <td style="font-size:0.72rem;color:var(--text-muted);">{r.c.last}</td>
          </tr>
        {/each}
        <tr class="subtotal">
          <td></td>
          <td>Top {rows.length}</td>
          <td class="num">{fmt(sub.commits)}</td>
          <td class="num">{pct(sub.commits, totals.commits)}</td>
          <td class="num">{fmt(sub.added)}</td>
          <td class="num">{pct(sub.added, totals.added)}</td>
          <td class="num">{fmt(sub.deleted)}</td>
          <td class="num">{pct(sub.deleted, totals.deleted)}</td>
          <td class="num">{fmt(sub.net)}</td>
          <td class="num">{pct(sub.net, totalNet)}</td>
          <td class="num"></td>
          <td class="num"></td>
          <td class="num"></td>
          {#if hasPrCols}
            <td class="num">{fmt(sub.prMerged)}</td>
            <td class="num">{fmt(sub.prOpen)}</td>
          {/if}
          <td></td>
          <td></td>
        </tr>
        <tr class="totals">
          <td></td>
          <td>All</td>
          <td class="num">{fmt(totals.commits)}</td>
          <td class="num">100%</td>
          <td class="num">{fmt(totals.added)}</td>
          <td class="num">100%</td>
          <td class="num">{fmt(totals.deleted)}</td>
          <td class="num">100%</td>
          <td class="num">{fmt(totalNet)}</td>
          <td class="num">100%</td>
          <td class="num">{grandLc}</td>
          <td class="num"></td>
          <td class="num"></td>
          {#if hasPrCols}
            <!-- Repo-wide counts from GitHub, so they can exceed the column sums
                 (authors outside the top N, or beyond the fetched window). -->
            <td class="num">{data.prCount != null ? fmt(data.prCount) : ""}</td>
            <td class="num">{data.prOpenCount != null ? fmt(data.prOpenCount) : ""}</td>
          {/if}
          <td></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>

<style>
  .summary-card {
    position: relative;
  }

  .table-reset-btn {
    position: absolute;
    top: 20px;
    right: 20px;
    background: var(--bg-badge);
    border: 1px solid var(--border-default);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 0.65rem;
    padding: 2px 8px;
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;

    &.visible {
      opacity: 1;
      pointer-events: auto;
    }

    &:hover {
      color: var(--text-primary);
    }
  }

  .sortable {
    cursor: pointer;
    user-select: none;
    white-space: nowrap;

    &:hover {
      color: var(--text-primary);
    }
  }

  .sort-arrow {
    font-size: 0.6rem;
    margin-left: 4px;
  }
</style>
