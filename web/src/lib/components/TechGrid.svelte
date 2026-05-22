<script lang="ts">
  // Repo-wide Technologies section: language bar + frameworks grouped by
  // language. Svelte port of renderTech() from lib/header.ts. Always renders
  // (with fallbacks when data is missing), so the section no longer needs the
  // initial `hidden` + reveal dance.
  import type { RepoData } from "$types";
  import LangBar from "./LangBar.svelte";

  let { data }: { data: RepoData } = $props();

  const repoLangs = $derived(data.repoLanguages || []);
  const frameworks = $derived(data.frameworks || []);
  const langLabel = $derived(
    data.repoLanguagesBasis === "size" ? "Languages by code size" : "Languages by lines changed",
  );
</script>

<div class="card">
  <h2>Technologies</h2>
  <div class="tech-grid">
    <div>
      {#if repoLangs.length}
        <div class="tech-bar-label">{langLabel}</div>
        <LangBar langs={repoLangs} legend repoBase={data.githubBaseUrl} />
      {:else}
        <div class="tech-bar-label">Languages</div>
        <div class="tech-empty">Couldn't load language data from the GitHub API for this repo.</div>
      {/if}
    </div>
    <div>
      <div class="tech-bar-label">Frameworks &amp; tools</div>
      {#if frameworks.length}
        <div class="frameworks">
          {#each frameworks as g}
            <div class="fw-group">
              <!-- prettier-ignore -->
              <span class="fw-lang"><span class="lang-dot" style="background:{g.color}"></span>{g.language}</span>
              <span class="fw-items">{g.names.join(", ")}</span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="tech-empty">
          No known frameworks detected in the repo's dependency manifests.
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  /* The #tech id (App.svelte's section wrapper) was only a global namespace;
     Svelte scoping isolates these, so the prefix is dropped. */
  .tech-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    align-items: start;

    @media (max-width: 900px) {
      grid-template-columns: 1fr;
    }
  }
  .tech-bar-label {
    font-size: 0.78rem;
    color: var(--text-muted);
    margin: 0 0 4px;
  }
  .frameworks {
    display: flex;
    flex-direction: column;
  }
  .fw-group {
    display: grid;
    grid-template-columns: 130px 1fr;
    gap: 10px;
    align-items: baseline;
    padding: 9px 0;
    border-top: 1px solid var(--border-default);

    &:first-child {
      border-top: none;
    }
  }
  .fw-lang {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 0.82rem;
    color: var(--text-secondary);
    font-weight: 600;

    .lang-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
  }
  .fw-items {
    font-size: 0.82rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .tech-empty {
    color: var(--text-muted);
    font-size: 0.8rem;
    font-style: italic;
  }
</style>
