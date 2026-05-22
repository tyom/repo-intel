<script lang="ts">
  // Commit-bucket popover, opened by clicking a cell in the commit-pattern punch cards.
  // Reads the reactive commitState; portal/position actions handle the body
  // portal and viewport placement. Dismisses on outside click, scroll, or
  // Escape. Svelte port of createCommitPopover's innerHTML in lib/popovers.ts.
  import { commitState, clearCommit } from "$lib/popover-store.svelte";
  import { portal, position } from "$lib/actions";
  import { clr } from "$lib/theme";
  import { fmt } from "$lib/format";

  const ROW_CAP = 200;

  const c = $derived(commitState.c);
  const rows = $derived(commitState.list.slice(0, ROW_CAP));
  const moreCount = $derived(commitState.list.length - ROW_CAP);

  let node = $state<HTMLElement>();

  // Dismiss on outside click, scroll (both capture phase, so reopening on a
  // fresh bar still works), or Escape.
  $effect(() => {
    function onOutside(e: Event) {
      if (commitState.open && node && !node.contains(e.target as Node)) clearCommit();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") clearCommit();
    }
    document.addEventListener("click", onOutside, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onOutside, true);
    return () => {
      document.removeEventListener("click", onOutside, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onOutside, true);
    };
  });

  function place(m: { w: number; h: number; vw: number; vh: number }) {
    const a = commitState.anchor;
    if (!a) return null;
    const margin = 8;
    const left = Math.max(margin, Math.min(a.x - m.w / 2, m.vw - m.w - margin));
    let top = a.top - m.h - 10;
    if (top < margin) top = a.bottom + 10;
    if (top + m.h + margin > m.vh) top = Math.max(margin, m.vh - m.h - margin);
    return { left, top };
  }
</script>

<div
  class="commit-popover"
  bind:this={node}
  use:portal
  use:position={{ visible: commitState.open, place }}
>
  {#if c}
    <div class="cp-title" style="color:{clr(commitState.colorIdx)}">{commitState.label}</div>
    <!-- prettier-ignore -->
    <div class="cp-sub">{c.name} · {fmt(commitState.list.length)} commit{commitState.list.length === 1 ? "" : "s"}</div>
    <div class="cp-list">
      {#each rows as c2 (c2.h)}
        <a
          class="cp-row"
          href="{commitState.baseUrl}/commit/{encodeURIComponent(c2.h)}"
          target="_blank"
          rel="noopener"
        >
          <span class="cp-hash">{c2.h}</span>
          <span class="cp-msg">{c2.s || ""}</span>
          <span class="cp-date">{(c2.d || "").slice(0, 16).replace("T", " ")}</span>
        </a>
      {/each}
    </div>
    {#if moreCount > 0}<div class="cp-more">+{fmt(moreCount)} more</div>{/if}
  {/if}
</div>

<style>
  .commit-popover {
    position: fixed;
    z-index: 120;
    pointer-events: auto;
    background: var(--bg-popover);
    color: var(--text-primary);
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 12px 14px;
    min-width: 280px;
    max-width: 380px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    opacity: 0;
    transition: opacity 0.12s;
    visibility: hidden;

    /* .visible is toggled at runtime by the position action. */
    &:global(.visible) {
      opacity: 1;
      visibility: visible;
    }
    .cp-title {
      font-weight: 600;
      font-size: 0.9rem;
      line-height: 1.2;
    }
    .cp-sub {
      color: var(--text-muted);
      font-size: 0.76rem;
      margin: 2px 0 10px;
    }
    .cp-list {
      max-height: 280px;
      overflow-y: auto;
      margin: 0 -14px;
      padding: 0;
    }
    .cp-row {
      display: flex;
      gap: 9px;
      align-items: baseline;
      padding: 5px 14px;
      text-decoration: none;
      color: var(--text-secondary);

      &:hover {
        background: var(--bg-badge);
      }
    }
    .cp-hash {
      font-family: ui-monospace, monospace;
      font-size: 0.72rem;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .cp-msg {
      font-size: 0.78rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
    .cp-date {
      font-size: 0.72rem;
      color: var(--text-muted);
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }
    .cp-more {
      color: var(--text-muted);
      font-size: 0.74rem;
      margin-top: 8px;
      text-align: center;
    }
  }
</style>
