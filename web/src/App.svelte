<script lang="ts">
  import { onMount } from "svelte";
  import type { RepoData, Mode } from "$types";
  import type {
    AuthorPopover as AuthorPopoverApi,
    CommitPopover as CommitPopoverApi,
  } from "$lib/popovers";
  import {
    createAuthorPopover,
    createCommitPopover,
    createTimelineTooltip,
    buildPunchPoints,
    buildPrCountsByLogin,
  } from "$lib/popovers";
  import { authorUrl, fmtTimelineDuration, relativeTime, fmtDateTime } from "$lib/format";
  import { setAuthorTotalCommits, setAuthorPrCounts } from "$lib/popover-store.svelte";
  import { registerEchartsTheme } from "$lib/theme";
  import { buildTimeline } from "$lib/timeline";
  import { dragScroll, scrollSpy } from "$lib/actions";
  import Header from "$components/Header.svelte";
  import TechGrid from "$components/TechGrid.svelte";
  import Table from "$components/Table.svelte";
  import YearToggles from "$components/YearToggles.svelte";
  import Heatmap from "$components/Heatmap.svelte";
  import ContributorCard from "$components/ContributorCard.svelte";
  import OverallCharts from "$components/OverallCharts.svelte";
  import PrCards from "$components/PrCards.svelte";
  import PatternCard from "$components/PatternCard.svelte";
  import AuthorPopover from "$components/AuthorPopover.svelte";
  import CommitPopover from "$components/CommitPopover.svelte";
  import TimelineTooltip from "$components/TimelineTooltip.svelte";

  let { data }: { data: RepoData } = $props();

  // Register the shared "repo" ECharts theme before any chart mounts. The
  // chart-owning components (ContributorCard / OverallCharts / PatternCard) mount
  // their charts in their own onMount, which (children-first) fires before App's
  // onMount, so this must run at script top level rather than inside onMount.
  registerEchartsTheme();

  // The timeline heading gains a ": <duration>" suffix when the span is known.
  const timelineDur = $derived(fmtTimelineDuration(data.dateRange.start, data.dateRange.end));
  const timelineHeading = $derived(
    timelineDur ? `Commit timeline: ${timelineDur}` : "Commit timeline",
  );

  // "Last commit N ago" shown in the Contributions header.
  const lastCommitAgo = $derived(relativeTime(data.lastCommit));
  const lastCommitFull = $derived(fmtDateTime(data.lastCommit));

  // The author popover (shared by the table and the timeline lane labels) and the
  // commit-bucket popover (opened by the punch-card cells) write the shared
  // popover store rendered by <AuthorPopover/> / <CommitPopover/>. Created in
  // onMount; consumers read them reactively (the table on hover, the punch cards
  // on click), so they're defined well before any interaction fires.
  let authorPopover = $state<AuthorPopoverApi>();
  let commitPopover = $state<CommitPopoverApi>();
  const patternsEnabled = $derived(!!data.githubBaseUrl);

  // The punch cards plot the joint hour×weekday commit distribution, which can't
  // be reconstructed from the per-axis marginals — build it once from the commit
  // list (keyed by email) and hand each card its author's points.
  const punchData = $derived(buildPunchPoints(data.commits || []));

  // Heatmap view mode, chosen by YearToggles and read by the Heatmap component.
  let heatmapMode = $state<Mode>("current");

  // PR section (cards + nav link) only exists when the collector fetched PRs.
  const hasPrs = $derived(
    (data.pullRequests?.length ?? 0) > 0 || (data.openPullRequests?.length ?? 0) > 0,
  );

  // The timeline is still rendered imperatively into the container elements below
  // (it's a hand-drawn canvas); wire it once the static layout is mounted.
  onMount(() => {
    setAuthorTotalCommits(data.totals.commits);
    setAuthorPrCounts(buildPrCountsByLogin(data));
    authorPopover = createAuthorPopover(data.contributors);
    commitPopover = createCommitPopover(data);
    buildTimeline(data, authorPopover, createTimelineTooltip());
  });
</script>

<div class="container">
  <!-- Rendered here for tree placement, but all use:portal to <body>. -->
  <AuthorPopover />
  <CommitPopover />
  <TimelineTooltip />
  <Header {data} />
  <div class="layout">
    <aside class="sidebar">
      <nav use:scrollSpy>
        <a href="#contributions">Contributions</a>
        <a href="#commit-timeline">Commit timeline</a>
        <a href="#tech">Technologies</a>
        <a href="#summary">Summary</a>
        {#if hasPrs}<a href="#pull-requests">Pull requests</a>{/if}
        <a href="#overall">Overall</a>
        <a href="#commit-frequency">Commit frequency</a>
        <a href="#patterns">Commit patterns</a>
      </nav>
    </aside>
    <main class="main">
      <div class="section" id="contributions">
        <div class="card">
          <div class="contributions-header">
            <div class="contributions-title">
              <h2>Contributions</h2>
              {#if lastCommitAgo}
                <span class="last-commit"
                  >Last commit <time datetime={data.lastCommit} title={lastCommitFull}
                    >{lastCommitAgo}</time
                  ></span
                >
              {/if}
            </div>
            <YearToggles {data} onSelect={(mode) => (heatmapMode = mode)} />
          </div>
          <Heatmap {data} mode={heatmapMode} />
        </div>
      </div>
      <div class="section" id="commit-timeline">
        <div class="card">
          <h2 class="timeline-h">{timelineHeading}</h2>
          <div class="timeline-hint">
            Drag to draw a zoom window (drag to pan once zoomed in) · Drag the histogram below to
            jump · Shift-scroll or pinch to zoom · Hover for details · Hover tag dots to mark a
            moment · Click to open on GitHub
          </div>
          <div class="timeline-wrap">
            <div class="timeline-labels" id="timelineLabels"></div>
            <div class="timeline-scroll" id="timelineScroll">
              <div class="timeline-inner" id="timelineInner"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="section" id="tech">
        <TechGrid {data} />
      </div>
      <div class="section" id="summary">
        <Table {data} {authorPopover} />
      </div>
      {#if hasPrs}
        <div class="section" id="pull-requests">
          <h2>Pull requests</h2>
          <PrCards {data} {authorPopover} />
        </div>
      {/if}
      <div class="section" id="overall">
        <h2>Overall</h2>
        <OverallCharts {data} {authorPopover} />
      </div>
      <div class="section" id="commit-frequency">
        <h2>Commit frequency over time</h2>
        <div class="grid-5">
          {#each data.contributors as c, i (c.email)}
            <ContributorCard
              {authorPopover}
              contributor={c}
              url={authorUrl(data, c)}
              index={i}
              weeks={data.weeks}
              weekly={data.weeklyData[c.email]}
            />
          {/each}
        </div>
      </div>
      <div class="section" id="patterns">
        <h2>Commit time patterns</h2>
        <div class="scroll-row" use:dragScroll>
          {#each data.contributors as c, i (c.email)}
            <PatternCard
              {authorPopover}
              contributor={c}
              url={authorUrl(data, c)}
              index={i}
              points={punchData[c.email] ?? []}
              {commitPopover}
              linksEnabled={patternsEnabled}
            />
          {/each}
        </div>
      </div>
    </main>
  </div>
</div>
