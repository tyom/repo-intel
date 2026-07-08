<script lang="ts">
  // Page header: repo title (linked to GitHub when there's a base URL) and the
  // subtitle stat line. Svelte port of renderHeader() from lib/header.ts. The
  // net value is derived here so the component stands alone; document.title is
  // set as a side effect.
  import type { RepoData } from "$types";
  import { colorAdded, colorDeleted } from "$lib/theme";
  import { fmt, fmtSize, relativeTime, fmtDateTime, repoBase } from "$lib/format";

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
  const base = $derived(repoBase(data));
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

  // GitHub social counts (top-right line); present only for reachable GitHub
  // repos, so each entry is included only when its count is. Built as a list so
  // the "·" separators land between whatever subset is present.
  const plural = (n: number, w: string) => `${fmt(n)} ${w}${n === 1 ? "" : "s"}`;
  const socialItems = $derived.by(() => {
    const link = (path: string) => (base ? `${base}/${path}` : null);
    const items: { url: string | null; label: string }[] = [];
    if (data.stars != null)
      items.push({ url: link("stargazers"), label: plural(data.stars, "star") });
    if (data.watchers != null)
      items.push({ url: link("watchers"), label: plural(data.watchers, "watcher") });
    if (data.forks != null) items.push({ url: link("forks"), label: plural(data.forks, "fork") });
    if (data.prCount != null)
      items.push({
        url: link("pulls?q=is%3Apr+is%3Amerged"),
        label: plural(data.prCount, "merged PR"),
      });
    if (data.prOpenCount != null)
      items.push({ url: link("pulls"), label: plural(data.prOpenCount, "open PR") });
    if (data.prClosedCount != null)
      items.push({
        url: link("pulls?q=is%3Apr+is%3Aclosed+is%3Aunmerged"),
        label: plural(data.prClosedCount, "closed PR"),
      });
    return items;
  });

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
  {#if socialItems.length || generatedAgo}
    <div class="header-meta">
      {#if socialItems.length}
        <!-- prettier-ignore -->
        <div class="social">
          {#each socialItems as it, i (it.label)}{#if i > 0}{" · "}{/if}{#if it.url}<a href={it.url} target="_blank" rel="noopener noreferrer">{it.label}</a>{:else}{it.label}{/if}{/each}
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
<!-- A subtitle stat: a link to its GitHub page when there is one, plain text
     otherwise. Kept on one line (prettier-ignore) so no stray whitespace leaks
     into the space-sensitive subtitle below. -->
<!-- prettier-ignore -->
{#snippet stat(url: string | null, label: string)}{#if url}<a href={url} target="_blank" rel="noopener noreferrer">{label}</a>{:else}{label}{/if}{/snippet}

<!-- Single line so the literal spaces between the colored +/- spans are preserved. -->
<p class="subtitle" id="subtitle">
  {data.dateRange.start} — {data.dateRange.end} · {@render stat(
    commitsUrl,
    commitsLabel,
  )}{#if mergeCount > 0}{" "}({fmt(mergeCount)} merge{mergeCount === 1 ? "" : "s"}){/if} ·
  <span style="color:{colorAdded}">+{fmt(totals.added)}</span>
  <span style="color:{colorDeleted}">-{fmt(totals.deleted)}</span>
  (net {#if net > 0}<span style="color:{colorAdded}">+{fmt(net)}</span>{:else if net < 0}<span
      style="color:{colorDeleted}">{fmt(net)}</span
    >{:else}{fmt(net)}{/if}) · {@render stat(
    contributorsUrl,
    contribLabel,
  )}{#if branchCount != null}{" "}· {@render stat(
      branchesUrl,
      branchLabel,
    )}{/if}{#if fileCount != null}{" "}· {fmt(fileCount)} files{/if}{#if sizeStr}{" "}· {sizeStr}{/if}
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
