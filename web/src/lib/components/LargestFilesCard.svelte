<script lang="ts">
  // The largest files as a one-level-grouped treemap, toggling between the HEAD
  // snapshot and the full-history on-disk usage. Files are grouped under their
  // top-level directory; each tile's grey shade encodes its byte size (brighter =
  // larger). Clicking a folder drills in (re-rooting via dispatchAction, which
  // keeps the nested view coherent); a Svelte breadcrumb overlay renders the path.
  // The two file-size payloads are absent on the remote GraphQL path (no tree
  // fetched), so the whole card hides unless at least one arrived with files.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { echart } from "$lib/actions";
  import { fmtBytes } from "$lib/format";
  import { tileInnerBorder } from "$lib/chart-helpers";
  import { bgCard, bgPrimary, borderDefault, contrastText, textMuted } from "$lib/theme";
  import type { FileSizes, RepoData } from "$types";
  import type { EChartsCoreOption, EChartsType } from "echarts/core";

  let { data }: { data: RepoData } = $props();

  const hasHeadFiles = $derived(!!data.largestFiles?.items.length);
  const hasHistFiles = $derived(!!data.diskByPath?.items.length);
  const hasFiles = $derived(hasHeadFiles || hasHistFiles);

  // The card toggles between the HEAD snapshot and the full-history disk usage.
  // Start on whichever payload exists (HEAD when both do); switching swaps the
  // treemap option, which resets any drilled-in zoom.
  type FilesTab = "head" | "hist";
  let filesTab = $state<FilesTab>("head");
  const activeFilesTab = $derived<FilesTab>(
    filesTab === "head" && !hasHeadFiles
      ? "hist"
      : filesTab === "hist" && !hasHistFiles
        ? "head"
        : filesTab,
  );

  // Build a one-level-grouped treemap from a file-size payload: files are grouped
  // under their top-level directory (a path with no slash stays a root-level
  // tile), with the capped remainder as a single "N more files" tile. Tiles are
  // monochrome: each one's grey shade encodes its byte size (brighter = larger),
  // so the grey scale reinforces the area cue. Tooltips show the full path + byte
  // size. `sizeNote` distinguishes the two charts' units: HEAD blob sizes are
  // uncompressed, while the history figures are the compressed on-disk (packed)
  // sizes — so a value in one chart isn't directly comparable to the other.
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
    // Biggest-first, so the largest tiles lay out first (treemap does the same).
    nodes.sort((a, b) => b.total - a.total);

    // One grey scale across every file tile, so a file's shade is comparable
    // wherever it sits. File sizes are log-skewed, so map on log(bytes), and
    // brighter = larger. Folder headers are deliberately left off this scale (see
    // below) — their area already carries the folder's size. The "N more files"
    // remainder is a sum of many files, not a single file (it has no fullPath), so
    // keep it off the scale — otherwise its large aggregate pins `hi` and washes
    // every real tile toward the dark floor, defeating the size encoding.
    const leafTotals: number[] = [];
    for (const n of nodes) {
      if (n.children) for (const c of n.children) leafTotals.push(c.total);
      else if (n.fullPath) leafTotals.push(n.total);
    }
    const lo = Math.log(Math.max(Math.min(...leafTotals), 1));
    const hi = Math.log(Math.max(...leafTotals, 1));
    const grey = (value: number): string => {
      const raw = hi > lo ? (Math.log(Math.max(value, 1)) - lo) / (hi - lo) : 1;
      // Clamp: the remainder tile sits above the real-file range (it's off the
      // scale above), so its t > 1 would overflow the byte into invalid hex.
      const t = Math.min(1, Math.max(0, raw));
      const h = Math.round(58 + t * (210 - 58))
        .toString(16)
        .padStart(2, "0");
      return `#${h}${h}${h}`;
    };

    // Only folders are zoom targets, so file leaves are made inert (default
    // cursor) while folders keep the pointer. ECharts' treemap reads a per-node
    // `cursor` only for leaf nodes (TreemapView applies it to the leaf content),
    // which is exactly the half we need to override; container nodes ignore it and
    // fall back to zrender's default pointer — so a declarative `cursor` per node
    // is enough, no reaching into the display list like the languages chart.
    const styled = nodes.map((node) => {
      if (node.children) {
        return {
          name: node.name,
          // The folder header is fixed dark "chrome", not size-keyed: every file
          // tile is a mid-to-light grey, so a header darker than all of them
          // (bgPrimary sits below the 58-grey floor) always reads as a header bar
          // rather than blending into the tiles below it. A visible border frames
          // the container so the folder reads as one block.
          upperLabel: { color: textMuted },
          itemStyle: { color: bgPrimary, borderColor: borderDefault, borderWidth: 2 },
          children: node.children.map((c) => {
            const fill = grey(c.total);
            return {
              name: c.name,
              value: c.value,
              fullPath: c.fullPath,
              cursor: "default",
              itemStyle: { color: fill, borderColor: tileInnerBorder, borderWidth: 1 },
              label: { color: contrastText(fill) },
            };
          }),
        };
      }
      const fill = grey(node.total);
      return {
        name: node.name,
        value: node.value,
        fullPath: node.fullPath,
        cursor: "default",
        itemStyle: { color: fill, borderColor: tileInnerBorder, borderWidth: 1 },
        label: { color: contrastText(fill) },
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
          // Click a folder to zoom in; clicking a fully-zoomed file (or a
          // breadcrumb) zooms back out — see onReady. Only folders carry the
          // pointer cursor (set per-node above); files are inert.
          roam: false,
          // Built-in click is disabled and drilling is handled in onReady: with
          // the nested (container-with-header) layout ECharts' own nodeClick only
          // visually scales, so a click handler re-roots via dispatchAction
          // instead — that's what both keeps the nested view and makes the
          // .files-crumbs path meaningful.
          nodeClick: false,
          // ECharts' own breadcrumb is disabled: it can't be hidden at the root
          // without a setOption that reinitialises the series and corrupts the
          // drill state. A Svelte overlay (.files-crumbs) renders the path.
          breadcrumb: { show: false },
          // Clear the title overlay so a zoomed-in folder's name strip
          // (upperLabel) isn't hidden behind it. The 36px title sits at the card's
          // border top, but the canvas starts 20px down (card padding), so the
          // title only intrudes ~16px into the canvas — inset just past that. The
          // crumb overlay floats over the bottom, so a small inset.
          top: 18,
          bottom: 2,
          left: 2,
          right: 2,
          // Directory containers carry a name strip; the languages treemap
          // establishes this upperLabel idiom.
          upperLabel: { show: true, height: 20, fontSize: 11, overflow: "truncate" },
          label: { show: true, fontSize: 11, overflow: "truncate" },
          itemStyle: { color: bgCard, borderColor: bgCard },
          levels: [{ itemStyle: { gapWidth: 4 } }, { itemStyle: { gapWidth: 1 } }],
          data: styled,
        },
      ],
    };
  }

  const headFiles = $derived(
    data.largestFiles?.items.length ? fileTreemap(data.largestFiles, "uncompressed") : null,
  );
  const histFiles = $derived(
    data.diskByPath?.items.length ? fileTreemap(data.diskByPath, "on disk, all history") : null,
  );
  // The option backing the card, picked by the active tab.
  const filesOption = $derived(activeFilesTab === "head" ? headFiles : histFiles);

  // Files treemaps drill by re-rooting (dispatchAction treemapRootToNode), which
  // both preserves the nested container view and changes the view root — so the
  // path can be read straight from the series. After every drill we read the
  // current view root's ancestor chain (a read-only access; unlike a setOption it
  // never corrupts the drill state) and mirror it into filesPath. At the root the
  // chain is just [root], so the overlay and Reset stay hidden.
  let filesChart: EChartsType | undefined;
  type Crumb = { label: string; node: unknown };
  let filesPath = $state<Crumb[]>([]);

  const sameCrumbs = (a: Crumb[], b: Crumb[]): boolean =>
    a.length === b.length && a.every((c, i) => c.node === b[i].node);

  function onReady(chart: EChartsType): void {
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
    // Clicking drills one level toward the tile, then steps back out. From any
    // view, a click re-roots to the clicked tile's ancestor that sits directly
    // under the current view root — so clicking a file inside a folder zooms into
    // the folder first. Once fully zoomed in (the clicked leaf already sits at the
    // view root), the same click steps back out one level. Root-level files have
    // no folder to drill into, so they do nothing.
    chart.on("click", (params: any) => {
      if (params.seriesType !== "treemap") return;
      try {
        const s = series();
        const node = s?.getData?.()?.tree?.getNodeByDataIndex?.(params.dataIndex);
        const viewRoot = s?.getViewRoot?.();
        if (!node || !viewRoot) return;
        if (node.parentNode === viewRoot && !node.children?.length) {
          if (viewRoot.parentNode) zoomFilesTo(viewRoot.parentNode);
          return;
        }
        let target = node;
        while (target.parentNode && target.parentNode !== viewRoot) target = target.parentNode;
        if (target.parentNode === viewRoot) zoomFilesTo(target);
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

  // Re-root the files treemap to a node — a crumb click, or a step in/out from a
  // tile click. dispatchAction is ECharts' own navigation, so it leaves the drill
  // state coherent.
  function zoomFilesTo(node: unknown): void {
    filesChart?.dispatchAction({ type: "treemapRootToNode", seriesIndex: 0, targetNode: node });
  }
</script>

{#if hasFiles && filesOption}
  <div class="card chart-card span-2">
    <div class="chart-title chart-title-opaque">
      Largest files {activeFilesTab === "head" ? "in HEAD" : "in Git history"}
    </div>
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
    <div class="ec ec-tree" use:echart={{ option: filesOption, onReady }}></div>
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

<style>
  /* The files treemap hugs the top edge, so the default translucent + blurred
     title strip would smear the tiles beneath it. Give this card's header a flat
     opaque fill (no gradient fade, no backdrop blur) for a clean divide. */
  .chart-title-opaque {
    background: var(--bg-card);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  /* Tab toggle pinned top-right above the centered title overlay (which is
     pointer-events: none), mirroring the year-toggle button styling. */
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
</style>
