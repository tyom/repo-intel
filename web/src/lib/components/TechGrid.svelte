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
        <div class="tech-empty">No known frameworks detected in the repo's dependency manifests.</div>
      {/if}
    </div>
  </div>
</div>
