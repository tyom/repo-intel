<script lang="ts">
  // The repo-wide ECharts charts: weekly-commits line (stacked area), commit-share
  // pie, lines added-vs-deleted bar, net-lines-per-commit bar, and a languages-by-
  // contributor treemap. The line and pie carry a "Reset" affordance that reappears
  // once the legend hides a series; Reset re-selects every series. Each chart mounts
  // through the `echart` action (div + setOption + auto-resize + dispose).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { echart } from "$lib/actions";
  import { fmtBytes, weekLabel } from "$lib/format";
  import { bgCard, borderDefault, clr, colorAdded, colorDeleted, contrastText } from "$lib/theme";
  import type { FileSizes, RepoData } from "$types";
  import type { EChartsCoreOption, EChartsType } from "echarts/core";

  let { data }: { data: RepoData } = $props();

  // Hide the languages treemap entirely when no contributor has a language mix,
  // rather than rendering an empty chart.
  const hasLangData = $derived(data.contributors.some((c) => c.languages?.length > 0));

  // The two file-size treemaps are absent on the remote GraphQL path (no tree
  // fetched), so hide each card unless its payload arrived with files.
  const hasHeadFiles = $derived(!!data.largestFiles?.items.length);
  const hasHistFiles = $derived(!!data.diskByPath?.items.length);
  const hasFiles = $derived(hasHeadFiles || hasHistFiles);

  // The combined "Largest files" card toggles between the HEAD snapshot and the
  // full-history disk usage. Start on whichever payload exists (HEAD when both
  // do); switching swaps the treemap option, which resets any drilled-in zoom.
  type FilesTab = "head" | "hist";
  let filesTab = $state<FilesTab>("head");
  const activeFilesTab = $derived<FilesTab>(
    filesTab === "head" && !hasHeadFiles
      ? "hist"
      : filesTab === "hist" && !hasHistFiles
        ? "head"
        : filesTab,
  );

  // Build a one-level-grouped treemap from a file-size payload: files are
  // grouped under their top-level directory (a path with no slash stays a
  // root-level tile), with the capped remainder as a single "N more files"
  // tile. Each top-level node gets a palette colour its children share, so a
  // directory reads as one hue; tooltips show the full path + byte size.
  // `sizeNote` distinguishes the two charts' units in the tooltip: HEAD blob
  // sizes are uncompressed, while the history figures are the compressed on-disk
  // (packed) sizes — so a value in one chart isn't directly comparable to the
  // other, and the note says which is which.
  function fileTreemap(payload: FileSizes, sizeNote: string): EChartsCoreOption {
    type Node = {
      name: string;
      value?: number;
      total: number;
      fullPath?: string;
      children?: Node[];
    };
    const groups = new Map<string, Node>();
    const nodes: Node[] = [];
    for (const f of payload.items) {
      const slash = f.path.indexOf("/");
      if (slash < 0) {
        nodes.push({ name: f.path, fullPath: f.path, value: f.bytes, total: f.bytes });
        continue;
      }
      const dir = f.path.slice(0, slash);
      let g = groups.get(dir);
      if (!g) {
        g = { name: dir, children: [], total: 0 };
        groups.set(dir, g);
        nodes.push(g);
      }
      g.children!.push({
        name: f.path.slice(slash + 1),
        fullPath: f.path,
        value: f.bytes,
        total: f.bytes,
      });
      g.total += f.bytes;
    }
    if (payload.otherBytes > 0) {
      const n = payload.otherCount;
      nodes.push({
        name: `${n} more file${n === 1 ? "" : "s"}`,
        value: payload.otherBytes,
        total: payload.otherBytes,
      });
    }
    // Biggest-first so the colour cycle tracks the layout (treemap lays out
    // largest tiles first too) and the dominant path gets clr(0).
    nodes.sort((a, b) => b.total - a.total);

    const styled = nodes.map((node, i) => {
      const base = clr(i);
      if (node.children) {
        return {
          name: node.name,
          upperLabel: { color: contrastText(base) },
          itemStyle: { color: base, borderColor: base, borderWidth: 2 },
          children: node.children.map((c) => ({
            name: c.name,
            value: c.value,
            fullPath: c.fullPath,
            itemStyle: { color: base, borderColor: tileInnerBorder, borderWidth: 1 },
            label: { color: contrastText(base) },
          })),
        };
      }
      return {
        name: node.name,
        value: node.value,
        fullPath: node.fullPath,
        itemStyle: { color: base, borderColor: tileInnerBorder, borderWidth: 1 },
        label: { color: contrastText(base) },
      };
    });

    return {
      tooltip: {
        formatter: (info: any) => {
          const path = info.data?.fullPath || info.name;
          return `${path}: ${fmtBytes(info.value)} (${sizeNote})`;
        },
      },
      animation: false,
      series: [
        {
          type: "treemap",
          // Click a tile to zoom into it; the parent header strip and the
          // breadcrumb both zoom back out (no custom handlers needed). The
          // default pointer cursor is the affordance, so this chart skips the
          // cursor-to-default override the languages treemap uses.
          roam: false,
          // Built-in click is disabled and drilling is handled in
          // onFilesTreemapReady: with the nested (container-with-header) layout
          // ECharts' own nodeClick only visually scales, so a click handler
          // re-roots via dispatchAction instead — that's what both keeps the
          // nested view and makes the .files-crumbs path meaningful.
          nodeClick: false,
          // ECharts' own breadcrumb is disabled: it can't be hidden at the root
          // without a setOption that reinitialises the series and corrupts the
          // drill state. A Svelte overlay (.files-crumbs) renders the path.
          breadcrumb: { show: false },
          // Hug the card edges; the title overlay blurs over the top and the
          // crumb overlay floats over the bottom, so no inset is reserved.
          top: 2,
          bottom: 2,
          left: 2,
          right: 2,
          // Directory containers carry a name strip; the existing languages
          // treemap establishes this upperLabel idiom.
          upperLabel: { show: true, height: 20, fontSize: 11, overflow: "truncate" },
          label: { show: true, fontSize: 11, overflow: "truncate" },
          itemStyle: { color: bgCard, borderColor: bgCard },
          levels: [{ itemStyle: { gapWidth: 4 } }, { itemStyle: { gapWidth: 1 } }],
          data: styled,
        },
      ],
    };
  }

  // Half-transparent dark inner border on the treemap tiles, so each brand-
  // coloured tile reads against the contributor-coloured gap around it.
  const tileInnerBorder = "rgba(0, 0, 0, 0.6)";

  // The Reset button shows (via .has-hidden on the card) once the legend has
  // hidden at least one series, and re-selects everything when clicked.
  let timelineHasHidden = $state(false);
  let pieHasHidden = $state(false);
  let timelineChart: EChartsType | undefined;
  let pieChart: EChartsType | undefined;

  const someHidden = (p: any): boolean => Object.values(p.selected).some((v) => v === false);
  function onTimelineReady(c: EChartsType): void {
    timelineChart = c;
    c.on("legendselectchanged", (p: any) => (timelineHasHidden = someHidden(p)));
  }
  function onPieReady(c: EChartsType): void {
    pieChart = c;
    c.on("legendselectchanged", (p: any) => (pieHasHidden = someHidden(p)));
  }
  function resetTimeline(): void {
    timelineChart?.dispatchAction({ type: "legendAllSelect" });
    timelineHasHidden = false;
  }
  function resetPie(): void {
    pieChart?.dispatchAction({ type: "legendAllSelect" });
    pieHasHidden = false;
  }

  // ECharts' treemap view forces a pointer cursor on every node (and on the root
  // background) and ignores series.cursor, so override it to the default after
  // each render — `finished` fires on the initial draw and on every redraw/resize.
  // zrender exposes no public per-node cursor API, so we reach into the display
  // list; guard the private access so a future ECharts bump degrades to a stray
  // pointer cursor instead of throwing and breaking the treemap mount.
  function onTreemapReady(chart: EChartsType): void {
    const useDefaultCursor = (): void => {
      const list = (chart.getZr() as any)?.storage?.getDisplayList?.();
      if (!list) return;
      for (const el of list) el.cursor = "default";
    };
    chart.on("finished", useDefaultCursor);
    useDefaultCursor();
  }

  // Files treemaps drill by re-rooting (dispatchAction treemapRootToNode), which
  // both preserves the nested container view and changes the view root — so the
  // path can be read straight from the series. After every drill we read the
  // current view root's ancestor chain (a read-only access; unlike a setOption
  // it never corrupts the drill state) and mirror it into filesPath. At the root
  // the chain is just [root], so the overlay and Reset stay hidden.
  let filesChart: EChartsType | undefined;
  type Crumb = { label: string; node: unknown };
  let filesPath = $state<Crumb[]>([]);

  const sameCrumbs = (a: Crumb[], b: Crumb[]): boolean =>
    a.length === b.length && a.every((c, i) => c.node === b[i].node);

  function onFilesTreemapReady(chart: EChartsType): void {
    filesChart = chart;
    const series = () => (chart as any).getModel().getSeriesByIndex(0);
    const syncPath = (): void => {
      let crumbs: Crumb[] = [];
      try {
        const chain: any[] = series()?.getViewRoot?.()?.getAncestors?.(true) ?? [];
        // getAncestors(true) → [root, …, viewRoot]; the synthetic root's name is
        // empty, so label it "All". Only show crumbs once drilled below root.
        if (chain.length > 1) {
          crumbs = chain.map((n, i) => ({ label: i === 0 ? "All" : n.name, node: n }));
        }
      } catch {
        crumbs = [];
      }
      if (!sameCrumbs(crumbs, filesPath)) filesPath = crumbs;
    };
    // Clicking a tile drills into its folder: a container drills into itself, a
    // file drills into its parent folder, so any cell zooms to its directory.
    // Root-level files (parent is the synthetic root) do nothing.
    chart.on("click", (params: any) => {
      if (params.seriesType !== "treemap") return;
      try {
        const node = series()?.getData?.()?.tree?.getNodeByDataIndex?.(params.dataIndex);
        const target = node?.children?.length ? node : node?.parentNode;
        if (target?.parentNode) zoomFilesTo(target);
      } catch {
        /* ignore — a future internal change just disables drilling */
      }
    });
    // Re-root drills dispatch treemapRootToNode; the view root is updated by the
    // time that event fires. "rendered" also catches the initial paint, resizes,
    // and the tab-switch setOption (which resets the view root back to root).
    chart.on("treemaproottonode", syncPath);
    chart.on("rendered", syncPath);
    syncPath();
  }

  // Re-root the files treemap to a node — a crumb click, or the Reset button
  // (which targets the tree root). dispatchAction is ECharts' own navigation, so
  // it leaves the drill state coherent.
  function zoomFilesTo(node: unknown): void {
    filesChart?.dispatchAction({ type: "treemapRootToNode", seriesIndex: 0, targetNode: node });
  }
  function resetFiles(): void {
    const root = (filesChart as any)?.getModel?.().getSeriesByIndex(0)?.getData?.()?.tree?.root;
    if (root) zoomFilesTo(root);
  }

  // All five chart options, derived from data (data is set once at mount, but
  // $derived keeps the reads reactive and avoids capturing only the initial value).
  const opts = $derived.by(() => {
    const { contributors, totals, weeks, weeklyData } = data;
    // Top-N commit subtotal, so the pie's "Others" slice is the remainder.
    const subC = contributors.reduce((acc, c) => acc + c.commits, 0);

    const timeline: EChartsCoreOption = {
      tooltip: { trigger: "axis" },
      legend: {
        top: 42,
        type: "scroll",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 10 },
      },
      grid: { left: 36, right: 14, top: 76, bottom: 34 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: weeks.map(weekLabel),
        axisLabel: { rotate: 35, fontSize: 10 },
      },
      yAxis: { type: "value", min: 0 },
      series: contributors.map((c, i) => ({
        name: c.name,
        type: "line",
        stack: "total",
        smooth: true,
        showSymbol: false,
        // Line area ignores `cursor`; silent stops the series setting a pointer
        // cursor on hover. Axis tooltip + legend toggle are unaffected.
        silent: true,
        cursor: "default",
        lineStyle: { width: 1.5, color: clr(i) },
        itemStyle: { color: clr(i) },
        areaStyle: { color: clr(i), opacity: 0.38 },
        data: weeklyData[c.email],
      })),
    };

    const pie: EChartsCoreOption = {
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 8,
        top: "middle",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 11 },
      },
      series: [
        {
          type: "pie",
          cursor: "default",
          radius: ["50%", "72%"],
          center: ["42%", "56%"],
          data: [
            ...contributors.map((c, i) => ({
              name: c.name,
              value: c.commits,
              itemStyle: { color: clr(i) },
            })),
            // Only show "Others" when the top-N contributors don't cover every
            // commit; otherwise it's a 0-value slice cluttering the legend.
            ...(totals.commits - subC > 0
              ? [
                  {
                    name: "Others",
                    value: totals.commits - subC,
                    itemStyle: { color: borderDefault },
                  },
                ]
              : []),
          ],
          itemStyle: { borderColor: bgCard, borderWidth: 2 },
          label: { show: false },
          labelLine: { show: false },
          emphasis: { scale: false },
        },
      ],
    };

    const addDel: EChartsCoreOption = {
      tooltip: { trigger: "axis" },
      legend: { top: 42, itemWidth: 10, itemHeight: 10 },
      grid: { left: 56, right: 14, top: 76, bottom: 40 },
      xAxis: {
        type: "category",
        data: contributors.map((c) => c.name),
        axisLabel: { rotate: 35, fontSize: 10 },
      },
      yAxis: { type: "value", min: 0 },
      series: [
        {
          name: "Added",
          type: "bar",
          cursor: "default",
          data: contributors.map((c) => c.added),
          itemStyle: { color: colorAdded },
        },
        {
          name: "Deleted",
          type: "bar",
          cursor: "default",
          data: contributors.map((c) => c.deleted),
          itemStyle: { color: colorDeleted },
        },
      ],
    };

    const ratio: EChartsCoreOption = {
      tooltip: { trigger: "axis" },
      grid: { left: 44, right: 14, top: 48, bottom: 40 },
      xAxis: {
        type: "category",
        data: contributors.map((c) => c.name),
        axisLabel: { rotate: 35, fontSize: 10 },
      },
      yAxis: { type: "value" },
      series: [
        {
          type: "bar",
          cursor: "default",
          // Net lines per commit, derived here (was the c.lc mutation in dashboard.ts).
          data: contributors.map((c, i) => ({
            value: c.commits ? +((c.added - c.deleted) / c.commits).toFixed(1) : 0,
            itemStyle: { color: clr(i) },
          })),
        },
      ],
    };

    // Two-level hierarchy: contributor → their language mix (pct), laid out like
    // ECharts' "treemap-show-parent": each contributor is a container with a
    // name-header strip in the contributor's colour (clr(i)), and the languages
    // are tiles inside carrying their own brand colour (l.color). Tiles are
    // separated by dark (card-coloured) gaps; tile + header labels flip
    // near-white/near-black for contrast.
    const treemap: EChartsCoreOption = {
      // Only language tiles get a tooltip; the root and contributor containers
      // (which carry summed/empty values) would otherwise show e.g. ": 300%".
      tooltip: {
        // Suppress the tooltip on the root and contributor containers (returning
        // "" still renders an empty box; undefined hides it). Only language tiles
        // — leaf nodes, no children — get a "name: pct%" tooltip.
        formatter: (info: any) =>
          !info.name || info.data?.children ? undefined : `${info.name}: ${info.value}%`,
      },
      animation: false,
      series: [
        {
          type: "treemap",
          cursor: "default",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          // No hover interaction: the emphasis state would otherwise re-layout the
          // header label (jumping it back to the left) and show a pointer cursor.
          emphasis: { disabled: true },
          top: 24,
          bottom: 6,
          left: 6,
          right: 6,
          squareRatio: 1,
          // Root background (shows in the gaps between contributor containers and
          // at the edges); default is white, so paint it the card colour.
          itemStyle: { color: bgCard, borderColor: bgCard },
          upperLabel: {
            show: true,
            height: 24,
            fontSize: 12,
            fontWeight: "bold",
            // Anchor at the strip's horizontal centre (default is the left edge)
            // so align:center actually centres the name across the full strip.
            position: ["50%", "50%"],
            align: "center",
            overflow: "truncate",
          },
          label: { show: true, fontSize: 12, overflow: "truncate" },
          levels: [
            // Contributor containers: dark gap separates regions; the contributor
            // colour is applied per-node as a 3px border + the gap fill below.
            { itemStyle: { gapWidth: 6, borderWidth: 3 } },
            // Language tiles: the gap reveals the contributor (parent) colour; each
            // tile carries a half-transparent white inner border for contrast.
            { itemStyle: { gapWidth: 3 } },
          ],
          data: contributors.map((c, i) => {
            const base = clr(i);
            const langs = [...c.languages].sort((a, b) => b.pct - a.pct);
            return {
              name: c.name,
              // Container fill = contributor colour (shows in the language gaps);
              // matching border frames the whole section.
              itemStyle: { color: base, borderColor: base, borderWidth: 3 },
              // Header strip is the contributor colour already (it's the container
              // fill, which shows in the top strip above the tiles); just colour
              // the label so it reads. No backgroundColor, so `align: center` can
              // centre the text across the full-width strip.
              upperLabel: { color: contrastText(base) },
              children: langs.map((l) => {
                const color = l.color || base;
                return {
                  name: l.name,
                  value: l.pct,
                  itemStyle: { color, borderColor: tileInnerBorder, borderWidth: 1 },
                  label: { color: contrastText(color) },
                };
              }),
            };
          }),
        },
      ],
    };

    const headFiles = data.largestFiles?.items.length
      ? fileTreemap(data.largestFiles, "uncompressed")
      : null;
    const histFiles = data.diskByPath?.items.length
      ? fileTreemap(data.diskByPath, "on disk, all history")
      : null;

    return { timeline, pie, addDel, ratio, treemap, headFiles, histFiles };
  });

  // The option backing the combined files card, picked by the active tab.
  const filesOption = $derived(activeFilesTab === "head" ? opts.headFiles : opts.histFiles);
</script>

<div class="grid-2">
  <div class="card chart-card chart-resettable" class:has-hidden={timelineHasHidden}>
    <div class="chart-title">Weekly commits (stacked)</div>
    <div class="ec" use:echart={{ option: opts.timeline, onReady: onTimelineReady }}></div>
    <button class="chart-reset-btn" onclick={resetTimeline}>Reset</button>
  </div>
  <div class="card chart-card chart-resettable" class:has-hidden={pieHasHidden}>
    <div class="chart-title">Commit share</div>
    <div class="ec" use:echart={{ option: opts.pie, onReady: onPieReady }}></div>
    <button class="chart-reset-btn" onclick={resetPie}>Reset</button>
  </div>
  <div class="card chart-card">
    <div class="chart-title">Lines added vs deleted</div>
    <div class="ec" use:echart={{ option: opts.addDel }}></div>
  </div>
  <div class="card chart-card">
    <div class="chart-title">Net lines per commit</div>
    <div class="ec" use:echart={{ option: opts.ratio }}></div>
  </div>
  {#if hasLangData}
    <div class="card chart-card span-2">
      <div class="chart-title">Languages by contributor</div>
      <div class="ec ec-tree" use:echart={{ option: opts.treemap, onReady: onTreemapReady }}></div>
    </div>
  {/if}
  {#if hasFiles && filesOption}
    <div class="card chart-card span-2">
      <div class="chart-title chart-title-opaque">Largest files</div>
      {#if filesPath.length > 1}
        <button class="files-reset" type="button" onclick={resetFiles}>Reset</button>
      {/if}
      <div class="files-tabs">
        {#if hasHeadFiles}
          <button
            class="files-tab"
            class:active={activeFilesTab === "head"}
            type="button"
            onclick={() => (filesTab = "head")}>HEAD</button
          >
        {/if}
        {#if hasHistFiles}
          <button
            class="files-tab"
            class:active={activeFilesTab === "hist"}
            type="button"
            onclick={() => (filesTab = "hist")}>Full history</button
          >
        {/if}
      </div>
      <div
        class="ec ec-tree"
        use:echart={{ option: filesOption, onReady: onFilesTreemapReady }}
      ></div>
      {#if filesPath.length > 1}
        <nav class="files-crumbs" aria-label="Treemap path">
          {#each filesPath as crumb, i (crumb.node)}
            {#if i > 0}<span class="files-crumb-sep" aria-hidden="true">›</span>{/if}
            <button
              class="files-crumb"
              class:current={i === filesPath.length - 1}
              type="button"
              disabled={i === filesPath.length - 1}
              onclick={() => zoomFilesTo(crumb.node)}>{crumb.label}</button
            >
          {/each}
        </nav>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chart-card {
    position: relative;
  }
  .ec {
    width: 100%;
    height: 260px;
  }
  .ec-tree {
    height: 320px;
  }
  .span-2 {
    grid-column: 1 / -1;
  }
  /* The files treemap hugs the top edge, so the default translucent + blurred
     title strip would smear the tiles beneath it. Give this card's header a flat
     opaque fill (no gradient fade, no backdrop blur) for a clean divide. */
  .chart-title-opaque {
    background: var(--bg-card);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  /* Reset-to-root, pinned top-left; only mounts while drilled in. Mirrors the
     line/pie chart-reset-btn styling. */
  .files-reset {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 2;
    background: var(--bg-badge);
    border: 1px solid var(--border-default);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 0.72rem;
    padding: 3px 8px;
    cursor: pointer;
    font-family: inherit;

    &:hover {
      color: var(--text-primary);
      border-color: var(--text-muted);
    }
  }
  /* Tab toggle pinned top-right above the centered title overlay (which is
     pointer-events: none), mirroring the Reset button's placement and the
     year-toggle button styling. */
  .files-tabs {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
    display: flex;
    gap: 2px;
  }
  .files-tab {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 0.72rem;
    padding: 3px 8px;
    cursor: pointer;
    font-family: inherit;

    &:hover {
      color: var(--text-primary);
    }
    &.active {
      color: var(--text-primary);
      background: var(--bg-badge);
      border-color: var(--border-default);
    }
  }
  /* Drill path for the files treemap, floated over the bottom of the tiles.
     Rendered in HTML (not the ECharts canvas) so it has crisp contrast, sits
     flush at the bottom, and has no canvas hit-region offset. Only mounts once
     drilled in (filesPath.length > 1), so the root view shows no stray crumb. */
  .files-crumbs {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 2px;
    max-width: calc(100% - 24px);
    padding: 3px 6px;
    border-radius: 6px;
    background: var(--bg-popover);
    border: 1px solid var(--border-default);
  }
  .files-crumb {
    background: transparent;
    border: 0;
    border-radius: 4px;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 0.72rem;
    padding: 2px 6px;
    max-width: 22ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;

    &:hover:not(:disabled) {
      color: var(--text-primary);
      background: var(--bg-badge);
    }
    &.current {
      color: var(--text-primary);
      cursor: default;
    }
  }
  .files-crumb-sep {
    color: var(--text-muted);
    font-size: 0.72rem;
  }
  .chart-resettable {
    position: relative;

    &.has-hidden .chart-reset-btn {
      opacity: 1;
    }
  }
  .chart-reset-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 2;
    background: var(--bg-badge);
    border: 1px solid var(--border-default);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 0.65rem;
    padding: 2px 8px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s;

    &:hover {
      color: var(--text-primary);
      border-color: var(--text-muted);
    }
  }
</style>
