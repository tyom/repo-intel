<script lang="ts">
  import { onMount } from "svelte";
  import type { RepoData } from "./types";
  import type { AuthorPopover } from "./lib/popovers";
  import { createAuthorPopover } from "./lib/popovers";
  import { initDashboard } from "./lib/dashboard";
  import Table from "./lib/components/Table.svelte";

  let { data }: { data: RepoData } = $props();

  // The author popover (shared by the table and the timeline lane labels) is a
  // body-appended singleton, so it's created on mount and handed to both the
  // Table component and the imperative dashboard engine.
  let authorPopover = $state<AuthorPopover | undefined>(undefined);

  // The dashboard engine renders into the container elements below (by id) and
  // wires all canvas / Chart.js / popover behavior. Run it once mounted.
  onMount(() => {
    authorPopover = createAuthorPopover(data.contributors);
    initDashboard(data, authorPopover);
  });
</script>

<div class="container">
  <!-- svelte-ignore a11y_missing_content -->
  <!-- Title and subtitle are populated at runtime by renderHeader(). -->
  <h1 id="title"></h1>
  <p class="subtitle" id="subtitle"></p>
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
            <div class="year-toggles" id="yearToggles"></div>
          </div>
          <div id="heatmapContainer"></div>
        </div>
      </div>
      <div class="section" id="commit-timeline">
        <div class="card">
          <h2 class="timeline-h">Commit timeline</h2>
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
      <div class="section" id="tech" hidden>
        <div class="card">
          <h2>Technologies</h2>
          <div class="tech-grid">
            <div id="techLanguages"></div>
            <div id="techFrameworks"></div>
          </div>
        </div>
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
        <div class="grid-5" id="contributorCards"></div>
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
