<script lang="ts">
  import { onMount } from "svelte";
  import type { RepoData, Mode } from "$types";
  import type {
    AuthorPopover as AuthorPopoverApi,
    CommitPopover as CommitPopoverApi,
  } from "$lib/popovers";
  import { createAuthorPopover, createCommitPopover, createTimelineTooltip } from "$lib/popovers";
  import { fmtTimelineDuration } from "$lib/format";
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

  // The author popover (shared by the table and the timeline lane labels) and the
  // commit-bucket popover (opened by the pattern-card bars) write the shared
  // popover store rendered by <AuthorPopover/> / <CommitPopover/>. Created in
  // onMount; consumers read them reactively (the table on hover, the pattern bars
  // on click), so they're defined well before any interaction fires.
  let authorPopover = $state<AuthorPopoverApi>();
  let commitPopover = $state<CommitPopoverApi>();
  const patternsEnabled = $derived(!!data.githubBaseUrl);

  // Heatmap view mode, chosen by YearToggles and read by the Heatmap component.
  let heatmapMode = $state<Mode>("current");

  // The timeline is still rendered imperatively into the container elements below
  // (it's a hand-drawn canvas); wire it once the static layout is mounted.
  onMount(() => {
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
        <a href="#overall">Overall</a>
        <a href="#commit-frequency">Commit frequency</a>
        <a href="#hour-patterns">Hour of day</a>
        <a href="#dow-patterns">Day of week</a>
      </nav>
    </aside>
    <main class="main">
      <div class="section" id="contributions">
        <div class="card">
          <div class="contributions-header">
            <h2>Contributions</h2>
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
      <div class="section" id="overall">
        <h2>Overall</h2>
        <OverallCharts {data} />
      </div>
      <div class="section" id="commit-frequency">
        <h2>Commit frequency over time</h2>
        <div class="grid-5">
          {#each data.contributors as c, i (c.email)}
            <ContributorCard
              contributor={c}
              index={i}
              weeks={data.weeks}
              weekly={data.weeklyData[c.email]}
            />
          {/each}
        </div>
      </div>
      <div class="section" id="hour-patterns">
        <h2>Commit time patterns (hour of day)</h2>
        <div class="scroll-row" use:dragScroll>
          {#each data.contributors as c, i (c.email)}
            <PatternCard
              contributor={c}
              index={i}
              values={data.hourlyData[c.email]}
              kind="hour"
              {commitPopover}
              linksEnabled={patternsEnabled}
            />
          {/each}
        </div>
      </div>
      <div class="section" id="dow-patterns">
        <h2>Day of week patterns</h2>
        <div class="scroll-row" use:dragScroll>
          {#each data.contributors as c, i (c.email)}
            <PatternCard
              contributor={c}
              index={i}
              values={data.dowData[c.email]}
              kind="dow"
              {commitPopover}
              linksEnabled={patternsEnabled}
            />
          {/each}
        </div>
      </div>
    </main>
  </div>
</div>
