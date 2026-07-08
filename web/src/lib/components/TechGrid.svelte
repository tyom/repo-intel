<script lang="ts">
  // Repo-wide Technologies section: language bar + frameworks grouped by
  // language. Svelte port of renderTech() from lib/header.ts. Always renders
  // (with fallbacks when data is missing), so the section no longer needs the
  // initial `hidden` + reveal dance.
  import type { RepoData } from "$types";
  import type { AuthorPopover } from "$lib/popovers";
  import { clr, contrastText } from "$lib/theme";
  import LangBar from "./LangBar.svelte";

  let { data, authorPopover }: { data: RepoData; authorPopover: AuthorPopover | undefined } =
    $props();

  const repoLangs = $derived(data.repoLanguages || []);
  const frameworks = $derived(data.frameworks || []);
  const langLeaders = $derived((data.langLeaders || []).filter((l) => l.contributors.length));
  // Segment colour + popover both key on the contributor's index in the
  // top-N list; leaders outside it fall back to grey with no popover.
  const idxByEmail = $derived(new Map(data.contributors.map((c, i) => [c.email, i])));
  const langLabel = $derived(
    data.repoLanguagesBasis === "size" ? "Languages by code size" : "Languages by lines changed",
  );
</script>

<div class="card">
  <h2>Technologies</h2>
  <div class="tech-grid" class:three={langLeaders.length > 0}>
    <div>
      {#if repoLangs.length}
        <div class="tech-bar-label">{langLabel}</div>
        <LangBar langs={repoLangs} legend repoBase={data.githubBaseUrl} />
      {:else}
        <div class="tech-bar-label">Languages</div>
        <div class="tech-empty">Couldn't load language data from the GitHub API for this repo.</div>
      {/if}
    </div>
    {#if langLeaders.length}
      <div>
        <div class="tech-bar-label">Top contributors by language</div>
        <div class="leaders">
          {#each langLeaders as l}
            {@const others =
              Math.round((100 - l.contributors.reduce((s, c) => s + c.pct, 0)) * 10) / 10}
            <div class="fw-group">
              <!-- prettier-ignore -->
              <span class="fw-lang"><span class="lang-dot" style="background:{l.color}"></span>{l.name}</span>
              <!-- Widths are flex-grow ratios, so the bar always fills its row.
                   The long tail beyond the top 3 sits collapsed at the end and
                   stretches to its true share while the bar is hovered. -->
              <div class="leader-bar">
                {#each l.contributors as c}
                  {@const idx = idxByEmail.get(c.email) ?? -1}
                  {@const color = idx >= 0 ? clr(idx) : "#8b949e"}
                  <span
                    class="seg"
                    role="img"
                    aria-label="{c.name} {c.pct}%"
                    style="--pct:{c.pct};background:{color};color:{contrastText(color)}"
                    title="{c.name} {c.pct}%"
                    onmouseenter={(e) => idx >= 0 && authorPopover?.show(idx, e.currentTarget)}
                    onmouseleave={() => authorPopover?.hide()}
                    >{#if c.avatarUrl}<img
                        class="seg-avatar"
                        src={c.avatarUrl}
                        alt=""
                      />{/if}{c.pct}%</span
                  >
                {/each}
                {#if others > 0}
                  <span class="others" style="--pct:{others}" title="Everyone else {others}%"
                  ></span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
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
    /* Two columns (languages | frameworks); `.three` adds the
       contributors-by-language column, present in clone-mode runs only. */
    grid-template-columns: 1fr 1fr;
    gap: 48px;
    align-items: start;

    &.three {
      grid-template-columns: 1fr 1fr 1fr;

      @media (max-width: 1200px) {
        grid-template-columns: 1fr 1fr;
        gap: 32px 48px;
      }
    }
    @media (max-width: 900px) {
      &,
      &.three {
        grid-template-columns: 1fr;
        gap: 16px;
      }
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
  .leaders .fw-group {
    grid-template-columns: 110px 1fr;
    align-items: center;
  }
  .leader-bar {
    display: flex;
    gap: 1px;
    height: 18px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--bg-badge);

    .seg {
      flex: var(--pct) 1 0px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 100%;
      min-width: 2px;
      font-size: 0.68rem;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      cursor: default;
      transition: flex-grow 0.25s ease;

      &:hover {
        filter: brightness(0.85);
      }
    }
    .seg-avatar {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    /* The long tail beyond the top 3: collapsed to a token sliver, stretched
       to its true share while itself hovered — expanding on row hover would
       shift the coloured segments under the cursor. */
    .others {
      flex: 5 1 0px;
      background: var(--bg-badge);
      transition: flex-grow 0.25s ease;

      &:hover {
        flex-grow: var(--pct);
      }
    }
  }
  .tech-empty {
    color: var(--text-muted);
    font-size: 0.8rem;
    font-style: italic;
  }
</style>
