<script lang="ts">
  // Stacked language bar + optional legend. Svelte port of langBarHtml() in
  // lib/format.ts; that string version stays for now because the (still
  // imperative) author popover renders it inline. When the popover becomes a
  // component, langBarHtml can be deleted in favour of this.
  import type { LanguageStat } from "../../types";
  import { langSearchUrl } from "../format";

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
