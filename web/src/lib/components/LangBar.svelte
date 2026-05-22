<script lang="ts">
  // Stacked language bar + optional legend. Used by the Technologies grid and
  // the author popover. (Replaced the old langBarHtml() string builder, now
  // removed from lib/format.ts.)
  import type { LanguageStat } from "$types";
  import { langSearchUrl } from "$lib/format";

  let {
    langs,
    legend = true,
    repoBase = null,
  }: { langs: LanguageStat[] | undefined; legend?: boolean; repoBase?: string | null } = $props();
</script>

{#if langs && langs.length}
  <div class="langbar">
    {#each langs as l}
      <span style="width:{l.pct}%;background:{l.color}" title="{l.name} {l.pct}%"></span>
    {/each}
  </div>
  {#if legend}
    <div class="lang-legend">
      {#each langs as l}
        {@const url = langSearchUrl(repoBase, l.name)}
        {#if url}
          <!-- prettier-ignore -->
          <a class="lang-item" href={url} target="_blank" rel="noopener" title="Browse {l.name} on GitHub"><span class="lang-dot" style="background:{l.color}"></span>{l.name} <span class="lang-pct">{l.pct}%</span></a>
        {:else}
          <!-- prettier-ignore -->
          <span class="lang-item"><span class="lang-dot" style="background:{l.color}"></span>{l.name} <span class="lang-pct">{l.pct}%</span></span>
        {/if}
      {/each}
    </div>
  {/if}
{/if}

<style>
  .langbar {
    display: flex;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--bg-badge);
    margin-top: 10px;

    > span {
      display: block;
      height: 100%;
      min-width: 2px;
    }
  }
  .lang-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin-top: 8px;
    font-size: 0.74rem;
    color: var(--text-secondary);

    .lang-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }
    a.lang-item {
      color: inherit;
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
    .lang-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .lang-pct {
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
  }
</style>
