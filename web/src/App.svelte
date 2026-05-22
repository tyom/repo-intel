<script lang="ts">
  import { onMount } from "svelte";
  import type { RepoData } from "$types";
  import type { AuthorPopover as AuthorPopoverAdapter } from "$lib/popovers";
  import { createAuthorPopover } from "$lib/popovers";
  import { fmtTimelineDuration } from "$lib/format";
  import { configureCharts } from "$lib/theme";
  import { initDashboard } from "$lib/dashboard";
  import type { Mode } from "$types";
  import Header from "$components/Header.svelte";
  import TechGrid from "$components/TechGrid.svelte";
  import Table from "$components/Table.svelte";
  import YearToggles from "$components/YearToggles.svelte";
  import Heatmap from "$components/Heatmap.svelte";
  import ContributorCard from "$components/ContributorCard.svelte";
  import AuthorPopover from "$components/AuthorPopover.svelte";
  import CommitPopover from "$components/CommitPopover.svelte";

  let { data }: { data: RepoData } = $props();

  // Set Chart.js global defaults before any chart is built. ContributorCard
  // creates its sparkline in its own onMount, which (children-first) fires
  // before App's onMount → before initDashboard, so this must run at script
  // top level rather than inside the dashboard engine.
  configureCharts();

  // The timeline heading gains a ": <duration>" suffix when the span is known.
  const timelineDur = $derived(fmtTimelineDuration(data.dateRange.start, data.dateRange.end));
  const timelineHeading = $derived(
    timelineDur ? `Commit timeline: ${timelineDur}` : "Commit timeline",
  );

  // The author popover (shared by the table and the timeline lane labels) is
  // rendered by <AuthorPopover/>; this adapter writes the shared popover store
  // and is handed to the Table component and the imperative dashboard engine.
  let authorPopover = $state<AuthorPopoverAdapter | undefined>(undefined);

  // Heatmap view mode, chosen by YearToggles and read by the Heatmap component.
  let heatmapMode = $state<Mode>("current");

  // The dashboard engine renders into the container elements below (by id) and
  // wires all canvas / Chart.js / popover behavior. Run it once mounted.
  onMount(() => {
    authorPopover = createAuthorPopover(data.contributors);
    initDashboard(data, authorPopover);
  });
</script>

<div class="container">
  <!-- Rendered here for tree placement, but both use:portal to <body>. -->
  <AuthorPopover />
  <CommitPopover />
  <Header {data} />
  <div class="layout">
    <aside class="sidebar">
      <nav>
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
        <div class="grid-2">
          <div class="card chart-resettable"><canvas id="overallTimeline"></canvas></div>
          <div class="card chart-resettable"><canvas id="commitsPie"></canvas></div>
          <div class="card"><canvas id="addDel"></canvas></div>
          <div class="card"><canvas id="ratioChart"></canvas></div>
        </div>
      </div>
      <div class="section" id="commit-frequency">
        <h2>Commit frequency over time</h2>
        <div class="grid-5">
          {#each data.contributors as c, i (c.email)}
            <ContributorCard contributor={c} index={i} weeks={data.weeks} weekly={data.weeklyData[c.email]} />
          {/each}
        </div>
      </div>
      <div class="section" id="hour-patterns">
        <h2>Commit time patterns (hour of day)</h2>
        <div class="scroll-row" id="hourlyCharts"></div>
      </div>
      <div class="section" id="dow-patterns">
        <h2>Day of week patterns</h2>
        <div class="scroll-row" id="dowCharts"></div>
      </div>
    </main>
  </div>
</div>
