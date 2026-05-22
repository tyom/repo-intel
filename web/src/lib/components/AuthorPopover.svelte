<script lang="ts">
  // Author/contributor popover, shared by the timeline lane labels and the
  // summary table. Reads the reactive authorState; the body-portal and viewport
  // positioning are handled by the portal/position actions, so this component
  // only builds the (auto-escaped) markup. Svelte port of createAuthorPopover's
  // innerHTML in lib/popovers.ts.
  import { authorState } from "../popover-store.svelte";
  import { portal, position } from "../actions";
  import { clr } from "../theme";
  import { fmt } from "../format";
  import LangBar from "./LangBar.svelte";

  const ICON_LOC =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M11.536 3.464a5 5 0 0 1 0 7.072L8 14.07l-3.536-3.535a5 5 0 1 1 7.072-7.072Zm1.06 8.132a6.5 6.5 0 1 0-9.192 0l3.535 3.536a1.5 1.5 0 0 0 2.122 0l3.535-3.536ZM8 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>';
  const ICON_MAIL =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25v-8.5C0 2.784.784 2 1.75 2ZM1.5 12.251c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V5.809L8.38 9.397a.75.75 0 0 1-.76 0L1.5 5.809v6.442Zm13-8.181v-.32a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25v.32L8 7.88Z"/></svg>';
  const ICON_LINK =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0Z"/></svg>';

  const c = $derived(authorState.c);
  const idx = $derived(authorState.idx);
  const p = $derived(c?.profile ?? {});
  const handle = $derived(c?.login ? "@" + c.login : "");
  const initial = $derived((c?.name || "?").trim().charAt(0).toUpperCase());
  const net = $derived(c ? c.added - c.deleted : 0);

  const counts = $derived(
    c
      ? [
          typeof p.followers === "number"
            ? { v: fmt(p.followers), label: `follower${p.followers === 1 ? "" : "s"}` }
            : null,
          typeof p.following === "number" ? { v: fmt(p.following), label: "following" } : null,
          typeof p.publicRepos === "number"
            ? { v: fmt(p.publicRepos), label: `repo${p.publicRepos === 1 ? "" : "s"}` }
            : null,
        ].filter((x): x is { v: string; label: string } => x !== null)
      : [],
  );

  // Reset the avatar-failed flag whenever the shown contributor changes, so a
  // 404 on one avatar doesn't suppress the next one's image.
  let imgFailed = $state(false);
  $effect(() => {
    authorState.idx;
    authorState.c;
    imgFailed = false;
  });

  function place(m: { w: number; h: number; vw: number; vh: number }) {
    const rect = authorState.anchor;
    if (!rect) return null;
    const margin = 8;
    let left = rect.right + 12;
    if (left + m.w + margin > m.vw) left = Math.max(margin, rect.left - 12 - m.w);
    let top = rect.top + rect.height / 2 - m.h / 2;
    if (top + m.h + margin > m.vh) top = m.vh - m.h - margin;
    if (top < margin) top = margin;
    return { left, top };
  }
</script>

<div class="lane-popover" use:portal use:position={{ visible: c != null, place }}>
  {#if c}
    <div class="lp-header">
      {#if c.avatarUrl && !imgFailed}
        <img class="lp-avatar" src={c.avatarUrl} alt="" onerror={() => (imgFailed = true)} />
      {:else}
        <div class="lp-avatar-fallback" style="background:{clr(idx)}">{initial}</div>
      {/if}
      <div class="lp-id">
        <div class="lp-name">{c.name}</div>
        {#if handle}<span class="lp-handle">{handle}</span>{/if}
      </div>
    </div>
    {#if p.bio}<div class="lp-bio">{p.bio}</div>{/if}
    {#if counts.length}
      <!-- prettier-ignore -->
      <div class="lp-counts">{#each counts as ct, i}{#if i > 0}{" · "}{/if}<strong>{ct.v}</strong>{" "}{ct.label}{/each}</div>
    {/if}
    {#if p.location || c.email || p.websiteUrl}
      <div class="lp-meta">
        {#if p.location}
          <div class="lp-meta-row">{@html ICON_LOC}<span class="lp-meta-text">{p.location}</span></div>
        {/if}
        {#if c.email}
          <div class="lp-meta-row">{@html ICON_MAIL}<span class="lp-meta-text">{c.email}</span></div>
        {/if}
        {#if p.websiteUrl}
          <div class="lp-meta-row">{@html ICON_LINK}<span class="lp-meta-text">{p.websiteUrl}</span></div>
        {/if}
      </div>
    {/if}
    <div class="lp-divider"></div>
    <!-- prettier-ignore -->
    <div class="lp-stats">{fmt(c.commits)} commits · {c.activeDays} active day{c.activeDays === 1 ? "" : "s"}</div>
    <!-- prettier-ignore -->
    <div class="lp-stats"><span class="add">+{fmt(c.added)}</span> <span class="del">-{fmt(c.deleted)}</span> (net {#if net > 0}<span class="add">+{fmt(net)}</span>{:else if net < 0}<span class="del">{fmt(net)}</span>{:else}{fmt(net)}{/if})</div>
    <div class="lp-period">{c.first} — {c.last}</div>
    <LangBar langs={c.languages} legend />
  {/if}
</div>
