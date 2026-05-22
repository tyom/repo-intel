<script lang="ts">
  // Summary table: per-contributor row + "Top N" subtotal + grand totals, with
  // the shared author popover on hover. Svelte port of the old renderTable() —
  // names are auto-escaped by Svelte (no escapeHtml), net/lc/avgPerDay are
  // computed here, and the popover is wired per-row instead of via event
  // delegation + data-idx.
  import type { RepoData } from "$types";
  import type { AuthorPopover } from "$lib/popovers";
  import { clr } from "$lib/theme";
  import { authorUrl, fmt, pct } from "$lib/format";

  let { data, authorPopover }: { data: RepoData; authorPopover: AuthorPopover | undefined } =
    $props();

  const totals = $derived(data.totals);
  const totalNet = $derived(data.totals.added - data.totals.deleted);

  // Per-row view models, with net/lc/avgPerDay derived locally.
  const rows = $derived(
    data.contributors.map((c, i) => {
      const net = c.added - c.deleted;
      return {
        c,
        i,
        color: clr(i),
        url: authorUrl(data, c),
        net,
        lc: c.commits ? +(net / c.commits).toFixed(1) : 0,
        avgPerDay: c.activeDays ? +(c.commits / c.activeDays).toFixed(1) : 0,
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
        return acc;
      },
      { commits: 0, added: 0, deleted: 0, net: 0 },
    ),
  );

  const grandLc = $derived(totals.commits ? +(totalNet / totals.commits).toFixed(1) : 0);
</script>

<div class="card">
  <h2>Summary</h2>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Author</th>
          <th class="num">Commits</th>
          <th class="num">%</th>
          <th class="num">Added</th>
          <th class="num">%</th>
          <th class="num">Deleted</th>
          <th class="num">%</th>
          <th class="num">Net</th>
          <th class="num">%</th>
          <th class="num">L/C</th>
          <th class="num">Active days</th>
          <th class="num">Avg/day</th>
          <th>First</th>
          <th>Last</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.i)}
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
          <td></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
