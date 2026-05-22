<script lang="ts">
  // Page header: repo title (linked to GitHub when there's a base URL) and the
  // subtitle stat line. Svelte port of renderHeader() from lib/header.ts. The
  // net value is derived here so the component stands alone; document.title is
  // set as a side effect.
  import type { RepoData } from "$types";
  import { colorAdded, colorDeleted } from "$lib/theme";
  import { fmt, fmtSize } from "$lib/format";

  let { data }: { data: RepoData } = $props();

  const baseMatch = $derived((data.githubBaseUrl || "").match(/\/\/[^/]+\/([^/]+\/[^/]+?)\/?$/));
  const titleText = $derived(baseMatch ? baseMatch[1] : data.repoName);

  const totals = $derived(data.totals);
  const net = $derived(data.totals.added - data.totals.deleted);
  const contribCount = $derived(
    typeof totals.contributors === "number" ? totals.contributors : data.contributors.length,
  );
  const sizeStr = $derived(fmtSize(data.repoSizeKb));

  $effect(() => {
    document.title = titleText ? `${titleText} · Repo Intel` : "Repo Intel";
  });
</script>

<h1 id="title">
  {#if data.githubBaseUrl}
    <a href={data.githubBaseUrl} target="_blank" rel="noopener noreferrer">{titleText}</a>
  {:else}{titleText}{/if}
</h1>
<!-- Single line so the literal spaces between the colored +/- spans are preserved. -->
<p class="subtitle" id="subtitle">
  {data.dateRange.start} — {data.dateRange.end} · {fmt(totals.commits)} commits ·
  <span style="color:{colorAdded}">+{fmt(totals.added)}</span>
  <span style="color:{colorDeleted}">-{fmt(totals.deleted)}</span>
  (net {#if net > 0}<span style="color:{colorAdded}">+{fmt(net)}</span>{:else if net < 0}<span
      style="color:{colorDeleted}">{fmt(net)}</span
    >{:else}{fmt(net)}{/if}) · {fmt(contribCount)} contributor{contribCount === 1
    ? ""
    : "s"}{#if sizeStr}{" "}· {sizeStr}{/if}
</p>
