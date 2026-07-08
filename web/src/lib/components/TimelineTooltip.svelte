<script lang="ts">
  // Timeline hover tooltip: one body-portaled node with two content shapes — a
  // commit-bundle tip and a git-tag tip, discriminated by timelineTipState.kind.
  // Unlike the popovers it follows the cursor, so the position action's params
  // carry the live {x, y} (the action ignores them; their presence is what makes
  // Svelte re-run update() on each mousemove). Svelte port of showTooltipFor /
  // showTagTooltip's innerHTML in lib/timeline.ts.
  import { timelineTipState as tip } from "$lib/popover-store.svelte";
  import { portal, position } from "$lib/actions";
  import { colorAdded, colorDeleted } from "$lib/theme";
  import { fmt, fmtDuration } from "$lib/format";

  function dateTime(d: string): [string, string] {
    const dt = new Date(d);
    if (isNaN(+dt)) return ["", ""];
    return [
      dt.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    ];
  }

  // --- commit tip ---
  const c = $derived(tip.kind === "commit" ? tip.c : null);
  const bundle = $derived(c?.commits ?? []);
  const commitDT = $derived(c ? dateTime(c.d) : ["", ""]);

  // Churn by file-type, aggregated across the bundle; top 5 + "+N" overflow.
  const ftypes = $derived.by(() => {
    const agg: Record<string, [string, number]> = {};
    for (const cc of bundle)
      for (const [name, color, files] of cc.f ?? []) {
        if (!agg[name]) agg[name] = [color, 0];
        agg[name][1] += files;
      }
    const sorted = Object.entries(agg).sort((a, b) => b[1][1] - a[1][1]);
    const shown = sorted.slice(0, 5);
    return { shown, more: sorted.length - shown.length };
  });

  // Reset the avatar-failed flag when the hovered bundle changes, so a 404 on
  // one avatar doesn't suppress the next one's image.
  let imgFailed = $state(false);
  $effect(() => {
    tip.c;
    imgFailed = false;
  });

  // --- tag tip ---
  // One or more tags sharing the hovered commit; they share date + oid, so the
  // meta line is taken from the first.
  const tags = $derived(tip.kind === "tag" ? tip.tags : []);
  const tag0 = $derived(tags[0] ?? null);
  const tagDT = $derived(tag0 ? dateTime(String(tag0.date ?? "")) : ["", ""]);
  const tagOid = $derived((tag0?.oid ?? "").slice(0, 7));
  // A tag's message, only when it adds something beyond the tag name.
  const tagMsg = (t: { name?: string; message?: string }): string => {
    const msg = (t.message ?? "").trim();
    return msg && msg !== (t.name ?? "").trim() ? msg : "";
  };

  // --- pr tip ---
  const pr = $derived(tip.kind === "pr" ? tip.pr : null);
  const prDT = $derived(pr ? dateTime(pr.mergedAt) : ["", ""]);
  // How long the PR was open, in the largest sensible unit.
  const prOpenFor = $derived(
    pr ? fmtDuration(+new Date(pr.mergedAt) - +new Date(pr.createdAt)) : "",
  );

  // Place at the cursor: 12px to the right, flipped left near the right edge,
  // vertically centred, clamped to the viewport with an 8px margin.
  function place(m: { w: number; h: number; vw: number; vh: number }) {
    if (tip.kind == null) return null;
    const margin = 8,
      gap = 12;
    let left = tip.x + gap;
    if (left + m.w + margin > m.vw) left = tip.x - gap - m.w;
    left = Math.max(margin, Math.min(left, m.vw - m.w - margin));
    let top = tip.y - m.h / 2;
    top = Math.max(margin, Math.min(top, m.vh - m.h - margin));
    return { left, top };
  }
</script>

<div
  class="timeline-tooltip"
  use:portal
  use:position={{ visible: tip.kind != null, place, deps: [tip.x, tip.y] }}
>
  {#if c}
    <div class="tt-author-row">
      {#if tip.author?.avatarUrl && !imgFailed}
        <img
          class="tt-avatar"
          src={tip.author.avatarUrl}
          alt=""
          onerror={() => (imgFailed = true)}
        />
      {:else}
        <span class="tt-dot" style="background:{tip.color}"></span>
      {/if}
      <span class="tt-author">{tip.author?.name}</span>
      {#if bundle.length > 1}<span class="tt-bundle-count">· {bundle.length} commits</span>{/if}
    </div>
    {#if bundle.length > 1}
      <!-- prettier-ignore -->
      <div class="tt-meta">{commitDT[0]} {commitDT[1]} · <span style="color:{colorAdded}">+{fmt(c.a)}</span> <span style="color:{colorDeleted}">-{fmt(c.l)}</span></div>
      <div class="tt-bundle-list">
        {#each bundle as cc (cc.h)}
          <div class="tt-bundle-item">
            <div class="tt-bundle-subject">{cc.s || ""}</div>
            <!-- prettier-ignore -->
            <div class="tt-bundle-meta"><span style="color:{colorAdded}">+{fmt(cc.a || 0)}</span> <span style="color:{colorDeleted}">-{fmt(cc.l || 0)}</span> · <span class="tt-hash">{cc.h}</span></div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="tt-subject">{c.s || ""}</div>
      <!-- prettier-ignore -->
      <div class="tt-meta">{commitDT[0]} {commitDT[1]} · <span style="color:{colorAdded}">+{fmt(c.a)}</span> <span style="color:{colorDeleted}">-{fmt(c.l)}</span> · <span class="tt-hash">{c.h}</span></div>
    {/if}
    {#if ftypes.shown.length}
      <div class="tt-ftypes">
        {#each ftypes.shown as [name, [color, files]] (name)}
          <span class="tt-ftype"
            ><span class="tt-fdot" style="background:{color}"></span>{name} ×{fmt(files)}</span
          >
        {/each}
        {#if ftypes.more > 0}<span class="tt-ftype">+{ftypes.more}</span>{/if}
      </div>
    {/if}
  {:else if tag0}
    <div class="tt-author-row">
      <span class="tt-tag-icon"></span><span class="tt-tag-kicker"
        >{tags.length > 1 ? "TAGS" : "TAG"}</span
      >{#if tags.length === 1}<span class="tt-tag-name">{tag0.name || ""}</span>{/if}
    </div>
    {#if tags.length === 1}
      {#if tagMsg(tag0)}<div class="tt-subject">{tagMsg(tag0)}</div>{/if}
    {:else}
      <div class="tt-tag-group">
        {#each tags as t (t.name)}
          <div class="tt-tag-row">
            <span class="tt-tag-name">{t.name || ""}</span>
            <span class="tt-tag-msg">{tagMsg(t)}</span>
          </div>
        {/each}
      </div>
    {/if}
    <!-- prettier-ignore -->
    <div class="tt-meta">{tagDT[0] || tag0.date || ""}{tagDT[1] ? " " + tagDT[1] : ""}{#if tagOid}{" · "}<span class="tt-hash">{tagOid}</span>{/if}</div>
  {:else if pr}
    <div class="tt-author-row">
      <span
        class="tt-tag-icon"
        style="background:rgb(var(--accent-pr));border-color:rgb(var(--accent-pr))"
      ></span><span class="tt-tag-kicker">MERGED PR</span><span class="tt-tag-name"
        >#{pr.number}</span
      >
    </div>
    <div class="tt-subject">{pr.title || ""}</div>
    <!-- prettier-ignore -->
    <div class="tt-meta">{prDT[0]} {prDT[1]}{#if prOpenFor}{" · open for "}{prOpenFor}{/if}{#if pr.author}{" · "}{pr.author}{/if}</div>
  {/if}
</div>

<style>
  .timeline-tooltip {
    position: fixed;
    z-index: 100;
    pointer-events: none;
    background: var(--bg-popover);
    color: var(--text-primary);
    font-size: 0.75rem;
    padding: 8px 10px;
    border-radius: 4px;
    max-width: 360px;
    line-height: 1.4;
    opacity: 0;
    transition: opacity 0.1s;
    border: 1px solid var(--border-default);

    /* .visible is toggled at runtime by the position action. */
    &:global(.visible) {
      opacity: 1;
    }
    .tt-author {
      font-weight: 600;
    }
    .tt-author-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tt-avatar {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--bg-badge);
      object-fit: cover;
    }
    /* Avatar fallback: a colour swatch filling the same slot. */
    .tt-dot {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .tt-subject {
      color: var(--text-primary);
      margin: 4px 0;
      word-break: normal;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .tt-meta {
      color: var(--text-muted);
      font-size: 0.7rem;
    }
    .tt-hash {
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .tt-bundle-count {
      color: var(--text-muted);
      font-size: 0.7rem;
    }
    .tt-bundle-list {
      margin-top: 6px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .tt-bundle-item {
      padding-top: 6px;
      border-top: 1px solid var(--border-default);

      &:first-child {
        padding-top: 0;
        border-top: none;
      }
    }
    .tt-bundle-subject {
      color: var(--text-primary);
      word-break: normal;
      overflow-wrap: anywhere;
    }
    .tt-bundle-meta {
      color: var(--text-muted);
      font-size: 0.7rem;
      margin-top: 2px;
    }
    .tt-tag-kicker {
      font-size: 0.62rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-right: 6px;
    }
    .tt-tag-name {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-weight: 600;
      color: var(--text-primary);
    }
    /* Tag rows as a 2-column table: names share a column so messages line up;
       a hairline rule separates each row (mirrors .tt-bundle-item). */
    .tt-tag-group {
      display: grid;
      grid-template-columns: max-content 1fr;
      margin: 4px 0;
    }
    .tt-tag-row {
      display: grid;
      grid-template-columns: subgrid;
      grid-column: 1 / -1;
      gap: 0 12px;
      padding-top: 5px;
      margin-top: 5px;
      border-top: 1px solid var(--border-default);

      &:first-child {
        padding-top: 0;
        margin-top: 0;
        border-top: none;
      }
    }
    .tt-tag-msg {
      color: var(--text-muted);
      overflow-wrap: anywhere;
    }
    .tt-tag-icon {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.9);
      margin-right: 6px;
      vertical-align: middle;
    }
    .tt-ftypes {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 10px;
      margin-top: 5px;
    }
    .tt-ftype {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.7rem;
      color: var(--text-secondary);

      .tt-fdot {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        flex-shrink: 0;
      }
    }
  }
</style>
