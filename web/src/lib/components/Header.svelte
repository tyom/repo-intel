<script lang="ts">
  // Page header: repo title (linked to GitHub when there's a base URL) and the
  // subtitle stat line. Svelte port of renderHeader() from lib/header.ts. The
  // net value is derived here so the component stands alone; document.title is
  // set as a side effect.
  import type { RepoData } from "$types";
  import { colorAdded, colorDeleted } from "$lib/theme";
  import { fmt, fmtSize, relativeTime, fmtDateTime } from "$lib/format";

  let { data }: { data: RepoData } = $props();

  const baseMatch = $derived((data.githubBaseUrl || "").match(/\/\/[^/]+\/([^/]+\/[^/]+?)\/?$/));
  const titleText = $derived(baseMatch ? baseMatch[1] : data.repoName);

  const totals = $derived(data.totals);
  const net = $derived(data.totals.added - data.totals.deleted);
  const contribCount = $derived(
    typeof totals.contributors === "number" ? totals.contributors : data.contributors.length,
  );
  const sizeStr = $derived(fmtSize(data.repoSizeKb));
  const fileCount = $derived(data.fileCount);
  const branchCount = $derived(data.branchCount);
  // GitHub base URL without a trailing slash; the deep links and social links hang off it.
  const base = $derived(data.githubBaseUrl ? data.githubBaseUrl.replace(/\/$/, "") : null);
  const contributorsUrl = $derived(base ? `${base}/graphs/contributors` : null);
  const branchesUrl = $derived(base ? `${base}/branches` : null);
  const commitsUrl = $derived(base ? `${base}/commits` : null);
  const mergeCount = $derived(totals.merges ?? 0);
  const generatedAgo = $derived(relativeTime(data.generatedAt));
  const generatedFull = $derived(fmtDateTime(data.generatedAt));

  // Subtitle stat labels, extracted so the link/plain-text branches below don't
  // each repeat the text. branchLabel is only rendered when branchCount != null.
  const commitsLabel = $derived(`${fmt(totals.commits + mergeCount)} commits`);
  const contribLabel = $derived(`${fmt(contribCount)} contributor${contribCount === 1 ? "" : "s"}`);
  const branchLabel = $derived(
    branchCount != null ? `${fmt(branchCount)} branch${branchCount === 1 ? "" : "es"}` : "",
  );

  // GitHub social counts (top-right line); present only for reachable GitHub repos.
  const stars = $derived(data.stars ?? null);
  const watchers = $derived(data.watchers ?? null);
  const forks = $derived(data.forks ?? null);
  const hasSocial = $derived(stars != null || watchers != null || forks != null);
  const plural = (n: number, w: string) => `${fmt(n)} ${w}${n === 1 ? "" : "s"}`;

  $effect(() => {
    document.title = titleText ? `${titleText} · Repo Intel` : "Repo Intel";
  });
</script>

<div class="header-top">
  <h1 id="title">
    {#if data.githubBaseUrl}
      <a href={data.githubBaseUrl} target="_blank" rel="noopener noreferrer">{titleText}</a>
    {:else}{titleText}{/if}
  </h1>
  {#if hasSocial || generatedAgo}
    <div class="header-meta">
      {#if hasSocial}
        <div class="social">
          {#if stars != null}<a
              href={base ? `${base}/stargazers` : undefined}
              target="_blank"
              rel="noopener noreferrer">{plural(stars, "star")}</a
            >{/if}{#if watchers != null}{" "}·
            <a
              href={base ? `${base}/watchers` : undefined}
              target="_blank"
              rel="noopener noreferrer">{plural(watchers, "watcher")}</a
            >{/if}{#if forks != null}{" "}·
            <a href={base ? `${base}/forks` : undefined} target="_blank" rel="noopener noreferrer"
              >{plural(forks, "fork")}</a
            >{/if}
        </div>
      {/if}
      {#if generatedAgo}
        <div>
          Generated <time datetime={data.generatedAt} title={generatedFull}>{generatedAgo}</time>
        </div>
      {/if}
    </div>
  {/if}
</div>
<!-- Single line so the literal spaces between the colored +/- spans are preserved. -->
<p class="subtitle" id="subtitle">
  {data.dateRange.start} — {data.dateRange.end} · {#if commitsUrl}<a
      href={commitsUrl}
      target="_blank"
      rel="noopener noreferrer">{commitsLabel}</a
    >{:else}{commitsLabel}{/if}{#if mergeCount > 0}{" "}({fmt(mergeCount)} merge{mergeCount === 1
      ? ""
      : "s"}){/if} ·
  <span style="color:{colorAdded}">+{fmt(totals.added)}</span>
  <span style="color:{colorDeleted}">-{fmt(totals.deleted)}</span>
  (net {#if net > 0}<span style="color:{colorAdded}">+{fmt(net)}</span>{:else if net < 0}<span
      style="color:{colorDeleted}">{fmt(net)}</span
    >{:else}{fmt(net)}{/if}) · {#if contributorsUrl}<a
      href={contributorsUrl}
      target="_blank"
      rel="noopener noreferrer">{contribLabel}</a
    >{:else}{contribLabel}{/if}{#if branchCount != null}{" "}· {#if branchesUrl}<a
        href={branchesUrl}
        target="_blank"
        rel="noopener noreferrer">{branchLabel}</a
      >{:else}{branchLabel}{/if}{/if}{#if fileCount != null}{" "}· {fmt(fileCount)} files{/if}{#if sizeStr}{" "}·
    {sizeStr}{/if}
</p>

<style>
  .subtitle a {
    color: inherit;
    text-decoration: underline;

    &:hover {
      text-decoration: none;
    }
  }

  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
  }

  .header-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    color: var(--text-muted);
    font-size: 0.8rem;
    text-align: right;
    white-space: nowrap;

    a {
      color: inherit;
      text-decoration: underline;

      &:hover {
        text-decoration: none;
      }
    }

    time {
      cursor: help;
    }
  }
</style>
