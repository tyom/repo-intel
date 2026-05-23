<script lang="ts">
  // The repo-wide ECharts charts: weekly-commits line (stacked area), commit-share
  // pie, lines added-vs-deleted bar, net-lines-per-commit bar, and a languages-by-
  // contributor treemap. The line and pie carry a "Reset" affordance that reappears
  // once the legend hides a series; Reset re-selects every series. Each chart mounts
  // through the `echart` action (div + setOption + auto-resize + dispose).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { echart } from "$lib/actions";
  import { authorUrl, fmtBytes, weekLabel } from "$lib/format";
  import type { AuthorPopover } from "$lib/popovers";
  import {
    bgCard,
    bgPrimary,
    borderDefault,
    clr,
    colorAdded,
    colorDeleted,
    contrastText,
    textMuted,
    textPrimary,
  } from "$lib/theme";
  import type { FileSizes, RepoData } from "$types";
  import type { EChartsCoreOption, EChartsType } from "echarts/core";

  let { data, authorPopover }: { data: RepoData; authorPopover: AuthorPopover | undefined } =
    $props();

  // Contributors are aggregated by email, so one person who committed under
  // several addresses (old work emails, a noreply alias) shows up as several
  // rows that all share one display name. ECharts keys legend selection by the
  // series/slice name, so identical names would collapse into a single legend
  // entry and toggle together. We therefore name every series/slice by its
  // (unique) email under the hood, hide ECharts' own legend, and render our own
  // HTML legend below — plain names, one entry per identity, each with the same
  // author popover the timeline lanes use, so duplicate names are told apart on
  // hover rather than by cluttering the label. `nameByEmail` maps the email back
  // to a display name for tooltips.
  const nameByEmail = $derived(new Map(data.contributors.map((c) => [c.email, c.name] as const)));
  const dispName = (email: string): string => nameByEmail.get(email) ?? email;
  // Email → original contributor index, so the churn chart's axis-label hover can
  // resolve the right person (and their clr() colour / popover) even after that
  // chart filters bots and re-sorts its own local copy.
  const emailToOrig = $derived(new Map(data.contributors.map((c, i) => [c.email, i] as const)));

  // Legend rows for the weekly-commits line and the commit-share pie. The pie
  // gains a non-author "Others" row when the top-N don't cover every commit
  // (see the pie option); it toggles like the rest but has no popover.
  type LegendItem = { key: string; name: string; color: string; idx: number };
  const contribLegend = $derived<LegendItem[]>(
    data.contributors.map((c, i) => ({ key: c.email, name: c.name, color: clr(i), idx: i })),
  );
  // Commits not covered by the top-N contributors → the pie's "Others" slice.
  // Single source of truth so the slice and its legend row can't drift apart.
  const othersCommits = $derived(
    data.totals.commits - data.contributors.reduce((acc, c) => acc + c.commits, 0),
  );
  // The pie's legend mirrors its slices: the contributors plus the "Others"
  // remainder (idx -1 → no popover) when the top-N don't cover every commit.
  const pieLegend = $derived<LegendItem[]>(
    othersCommits > 0
      ? [...contribLegend, { key: "Others", name: "Others", color: borderDefault, idx: -1 }]
      : contribLegend,
  );

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
  // tile. Tiles are monochrome: each one's grey shade encodes its byte size
  // (brighter = larger), so the grey scale reinforces the area cue. Tooltips
  // show the full path + byte size.
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
    // Biggest-first, so the largest tiles lay out first (treemap does the same).
    nodes.sort((a, b) => b.total - a.total);

    // One grey scale across every file tile, so a file's shade is comparable
    // wherever it sits. File sizes are log-skewed, so map on log(bytes), and
    // brighter = larger. Folder headers are deliberately left off this scale
    // (see below) — their area already carries the folder's size.
    // The "N more files" remainder is a sum of many files, not a single file (it
    // has no fullPath), so keep it off the scale — otherwise its large aggregate
    // pins `hi` and washes every real tile toward the dark floor, defeating the
    // size encoding.
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
    // which is exactly the half we need to override; container nodes ignore it
    // and fall back to zrender's default pointer — so a declarative `cursor` per
    // node is enough, no reaching into the display list like the languages chart.
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
          // breadcrumb) zooms back out — see onFilesTreemapReady. Only folders
          // carry the pointer cursor (set per-node above); files are inert.
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
          // Clear the title overlay so a zoomed-in folder's name strip
          // (upperLabel) isn't hidden behind it. The 36px title sits at the
          // card's border top, but the canvas starts 20px down (card padding),
          // so the title only intrudes ~16px into the canvas — inset just past
          // that. The crumb overlay floats over the bottom, so a small inset.
          top: 18,
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

  // Half-transparent dark inner border on the treemap tiles, so each grey tile
  // reads against the gap around it (and the contributor-coloured gaps of the
  // languages treemap, which shares this border).
  const tileInnerBorder = "rgba(0, 0, 0, 0.6)";

  // Our HTML legends drive ECharts' (hidden) legend selection by dispatching
  // legendToggleSelect/legendAllSelect. The chart still owns the source of truth
  // for what's hidden — we mirror its `selected` map back into Svelte state so a
  // legend row dims when its series is off, and the Reset button shows once
  // anything is hidden. Keyed by the series name (the contributor's email, or
  // "Others" on the pie). A missing key means selected (the initial state).
  let timelineSel = $state<Record<string, boolean>>({});
  let pieSel = $state<Record<string, boolean>>({});
  let timelineChart: EChartsType | undefined;
  let pieChart: EChartsType | undefined;

  const isHidden = (sel: Record<string, boolean>, key: string): boolean => sel[key] === false;
  const anyHidden = (sel: Record<string, boolean>): boolean =>
    Object.values(sel).some((v) => v === false);
  const timelineHasHidden = $derived(anyHidden(timelineSel));
  const pieHasHidden = $derived(anyHidden(pieSel));

  function onTimelineReady(c: EChartsType): void {
    timelineChart = c;
    c.on("legendselectchanged", (p: any) => (timelineSel = { ...p.selected }));
  }
  function onPieReady(c: EChartsType): void {
    pieChart = c;
    c.on("legendselectchanged", (p: any) => (pieSel = { ...p.selected }));
  }
  // The churn chart's y-axis labels carry the same author popover as the timeline
  // lanes. ECharts axis labels are canvas, not DOM, so triggerEvent surfaces one
  // mouseover/mouseout per label with the category value (the unique email); we
  // anchor the popover to the cursor via a synthetic rect, which is all
  // authorPopover.show reads off the element.
  function onChurnReady(c: EChartsType): void {
    c.on("mouseover", (p: any) => {
      if (p.componentType !== "yAxis" || p.targetType !== "axisLabel") return;
      const idx = emailToOrig.get(p.value);
      if (idx == null) return;
      // Anchor at the cursor when the native event rode along; otherwise fall
      // back to the label's row centre via the chart geometry (as PatternCard
      // does for its punch-card cells), so the popover lands regardless.
      let x: number, y: number;
      const ev = p.event?.event as MouseEvent | undefined;
      if (ev) {
        x = ev.clientX;
        y = ev.clientY;
      } else {
        const py = c.convertToPixel({ yAxisIndex: 0 }, p.value) as number;
        if (py == null || Number.isNaN(py)) return;
        const dom = c.getDom().getBoundingClientRect();
        x = dom.left + 24;
        y = dom.top + py;
      }
      const rect = { left: x, right: x, top: y, bottom: y, width: 0, height: 0, x, y } as DOMRect;
      authorPopover?.show(idx, { getBoundingClientRect: () => rect } as Element);
    });
    c.on("mouseout", (p: any) => {
      if (p.componentType === "yAxis" && p.targetType === "axisLabel") authorPopover?.hide();
    });
    // triggerEvent gives the labels a pointer cursor, so make them behave like the
    // timeline lane labels: click opens the contributor's commits. Local-only repos
    // have no GitHub base (authorUrl → "#"), so there's nothing to open.
    c.on("click", (p: any) => {
      if (p.componentType !== "yAxis" || p.targetType !== "axisLabel") return;
      const idx = emailToOrig.get(p.value);
      if (idx == null) return;
      const url = authorUrl(data, data.contributors[idx]);
      if (url !== "#") window.open(url, "_blank", "noopener");
    });
  }
  function toggleTimeline(key: string): void {
    timelineChart?.dispatchAction({ type: "legendToggleSelect", name: key });
  }
  function togglePie(key: string): void {
    pieChart?.dispatchAction({ type: "legendToggleSelect", name: key });
  }
  function resetTimeline(): void {
    timelineChart?.dispatchAction({ type: "legendAllSelect" });
    timelineSel = {};
  }
  function resetPie(): void {
    pieChart?.dispatchAction({ type: "legendAllSelect" });
    pieSel = {};
  }
  // Author popover on legend hover, mirroring the timeline lane labels. The
  // "Others" pie row has idx < 0 (no contributor), so it gets no popover.
  function legendEnter(e: MouseEvent, idx: number): void {
    if (idx >= 0) authorPopover?.show(idx, e.currentTarget as Element);
  }
  // Hovering a pie legend row emphasises the matching slice (keyed by email, or
  // "Others"), so it scales out per the series' emphasis config; leaving downplays
  // it. Highlight is addressed by slice name, the same key the legend toggles use.
  function pieHighlight(key: string, on: boolean): void {
    pieChart?.dispatchAction({ type: on ? "highlight" : "downplay", name: key });
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
    // Clicking drills one level toward the tile, then steps back out. From any
    // view, a click re-roots to the clicked tile's ancestor that sits directly
    // under the current view root — so clicking a file inside a folder zooms into
    // the folder first. Once fully zoomed in (the clicked leaf already sits at
    // the view root), the same click steps back out one level. Root-level files
    // have no folder to drill into, so they do nothing.
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

  // Re-root the files treemap to a node — a crumb click, or a step in/out from
  // a tile click. dispatchAction is ECharts' own navigation, so it leaves the
  // drill state coherent.
  function zoomFilesTo(node: unknown): void {
    filesChart?.dispatchAction({ type: "treemapRootToNode", seriesIndex: 0, targetNode: node });
  }

  // All five chart options, derived from data (data is set once at mount, but
  // $derived keeps the reads reactive and avoids capturing only the initial value).
  const opts = $derived.by(() => {
    const { contributors, weeks, weeklyData } = data;

    const timeline: EChartsCoreOption = {
      // Series are named by email (unique), so map back to the display name and
      // drop zero-commit weeks to keep the stacked tooltip readable.
      tooltip: {
        trigger: "axis",
        formatter: (ps: any) => {
          const arr = Array.isArray(ps) ? ps : [ps];
          const head = arr[0]?.axisValueLabel ?? "";
          const rows = arr
            .filter((p: any) => p.value)
            .map((p: any) => `${p.marker}${dispName(p.seriesName)}: ${p.value}`)
            .join("<br>");
          return rows ? (head ? `${head}<br>${rows}` : rows) : head;
        },
      },
      // ECharts' own legend is hidden; the HTML legend below drives selection.
      legend: { show: false },
      // No built-in legend to clear up top now — just the floating title strip.
      grid: { left: 36, right: 14, top: 38, bottom: 34 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: weeks.map(weekLabel),
        axisLabel: { rotate: 35, fontSize: 10 },
      },
      yAxis: { type: "value", min: 0 },
      series: contributors.map((c, i) => ({
        name: c.email,
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

    const pieSlices = [
      ...contributors.map((c, i) => ({
        name: c.email,
        value: c.commits,
        itemStyle: { color: clr(i) },
      })),
      // Only show "Others" when the top-N contributors don't cover every commit;
      // otherwise it's a 0-value slice cluttering the legend.
      ...(othersCommits > 0
        ? [{ name: "Others", value: othersCommits, itemStyle: { color: borderDefault } }]
        : []),
    ];

    const pie: EChartsCoreOption = {
      // Slices are named by email (unique); map back for the tooltip. "Others"
      // isn't an email, so dispName falls through to it unchanged.
      tooltip: {
        trigger: "item",
        formatter: (p: any) => `${dispName(p.name)}: ${p.value} (${p.percent}%)`,
      },
      // ECharts' own legend is hidden; the HTML legend beside it drives selection.
      legend: { show: false },
      series: [
        {
          type: "pie",
          cursor: "default",
          radius: "72%",
          center: ["50%", "52%"],
          data: pieSlices,
          itemStyle: { borderColor: bgCard, borderWidth: 2 },
          // Outside labels carry the name + share. The long tail of tiny slices
          // would only collide into an unreadable fan, so minShowLabelAngle drops
          // the label (and its leader line) for any sector narrower than ~4% of
          // the circle. It's angle-based, so when the legend hides the big slices
          // the survivors widen past the threshold and their labels reappear —
          // unlike a static per-slice flag. hideOverlap prunes any that still
          // touch. Every identity is always present in the legend regardless.
          minShowLabelAngle: 14,
          label: {
            show: true,
            formatter: (p: any) => `{n|${dispName(p.name)}}\n{p|${p.percent}%}`,
            rich: {
              n: { color: textPrimary, fontSize: 12, lineHeight: 16 },
              p: { color: textMuted, fontSize: 11, lineHeight: 14 },
            },
          },
          labelLine: { length: 10, length2: 12 },
          labelLayout: { hideOverlap: true },
          // Hovering a legend row highlights the matching slice (see pieHighlight),
          // which scales it out a touch; scaleSize is the radial nudge in px.
          emphasis: { scale: true, scaleSize: 8 },
        },
      ],
    };

    // Diverging horizontal bars: deleted extends left of the zero axis, added
    // right, so each person's net balance reads as whichever side is longer.
    // Bots (the `[bot]` logins repo-intel.py skips for profiles) are dropped —
    // a Renovate/CI account churning tens of thousands of lines is noise here
    // and only flattens the human contributors' scale. Sorted by total churn
    // (added + deleted) so the busiest sit at the top (yAxis is inverted, since
    // ECharts otherwise draws the first category at the bottom). Local copy: the
    // shared `contributors` is index-keyed for the line/pie colours, so sorting
    // or filtering it in place would corrupt them. Linear scale with per-bar
    // labels keeps even a one-pixel bar legible despite the heavy skew.
    // Rows carry their original contributor index so the axis label can show the
    // person's identity colour (clr) and dot, matching every other chart, and the
    // hover popover can resolve the right person. Categories are keyed by email
    // (unique) — two people sharing a display name would otherwise collapse into
    // one band.
    const addDelRows = contributors
      .map((c, origIdx) => ({ c, origIdx }))
      .filter((r) => !r.c.login.endsWith("[bot]"))
      .sort((a, b) => b.c.added + b.c.deleted - (a.c.added + a.c.deleted));
    const abs = (v: number) => Math.abs(v).toLocaleString();
    // One rich-text style per row for its identity-coloured dot; the name shares a
    // single muted style. Keyed by row position (d0, d1, …), which is what the
    // axisLabel formatter receives as its index.
    const dotRich = Object.fromEntries(
      addDelRows.map((r, i) => [`d${i}`, { color: clr(r.origIdx), fontSize: 12 }]),
    );
    const addDel: EChartsCoreOption = {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (ps: any) => {
          const arr = Array.isArray(ps) ? ps : [ps];
          const rows = arr
            .map((p: any) => `${p.marker}${p.seriesName}: ${abs(p.value)}`)
            .join("<br>");
          return `${dispName(arr[0]?.axisValue ?? "")}<br>${rows}`;
        },
      },
      grid: { left: 120, right: 56, top: 16, bottom: 24 },
      // Deleted lives on the negative side, so strip the minus sign from ticks.
      xAxis: { type: "value", axisLabel: { formatter: (v: number) => abs(v) } },
      yAxis: {
        type: "category",
        inverse: true,
        triggerEvent: true,
        data: addDelRows.map((r) => r.c.email),
        axisLabel: {
          margin: 10,
          formatter: (email: string, i: number) =>
            `{d${i}|●}{n|${nameByEmail.get(email) ?? email}}`,
          rich: {
            ...dotRich,
            n: { color: textMuted, fontSize: 10, padding: [0, 0, 0, 5] },
          },
        },
      },
      series: [
        {
          name: "Added",
          type: "bar",
          stack: "churn",
          cursor: "default",
          data: addDelRows.map((r) => r.c.added),
          itemStyle: { color: colorAdded },
          label: {
            show: true,
            position: "right",
            fontSize: 9,
            color: textMuted,
            textBorderWidth: 0,
            formatter: (p: any) => (p.value ? abs(p.value) : ""),
          },
        },
        {
          name: "Deleted",
          type: "bar",
          stack: "churn",
          cursor: "default",
          // Negated so the bar grows left from zero; tooltip/label/ticks re-abs.
          data: addDelRows.map((r) => -r.c.deleted),
          itemStyle: { color: colorDeleted },
          label: {
            show: true,
            position: "left",
            fontSize: 9,
            color: textMuted,
            textBorderWidth: 0,
            formatter: (p: any) => (p.value ? abs(p.value) : ""),
          },
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
          // Top keeps clearance for the contributor name strips below the title
          // overlay; the other three match the files treemap's edge inset so the
          // two cards share the same outer padding.
          top: 24,
          bottom: 2,
          left: 2,
          right: 2,
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

<!-- One legend entry per identity: a colour swatch + the plain name. Hover
     opens the same author popover the timeline lanes use (so people committing
     under several emails are told apart on hover, not in the label); click
     toggles the matching series via ECharts' hidden legend. -->
{#snippet legendItem(
  item: LegendItem,
  hidden: boolean,
  toggle: (key: string) => void,
  emphasize?: (key: string, on: boolean) => void,
)}
  <button
    type="button"
    class="legend-item"
    class:hidden
    aria-pressed={!hidden}
    onmouseenter={(e) => {
      legendEnter(e, item.idx);
      emphasize?.(item.key, true);
    }}
    onmouseleave={() => {
      authorPopover?.hide();
      emphasize?.(item.key, false);
    }}
    onclick={() => toggle(item.key)}
  >
    <span class="legend-dot" style="background:{item.color}"></span>
    <span class="legend-name">{item.name}</span>
  </button>
{/snippet}

<div class="grid-2">
  <div class="card chart-card chart-resettable" class:has-hidden={timelineHasHidden}>
    <div class="chart-title">Weekly commits (stacked)</div>
    <div class="ec" use:echart={{ option: opts.timeline, onReady: onTimelineReady }}></div>
    <div class="chart-legend chart-legend-row">
      {#each contribLegend as item (item.key)}
        {@render legendItem(item, isHidden(timelineSel, item.key), toggleTimeline)}
      {/each}
    </div>
    <button class="chart-reset-btn" onclick={resetTimeline}>Reset</button>
  </div>
  <div class="card chart-card chart-resettable" class:has-hidden={pieHasHidden}>
    <div class="chart-title">Commit share</div>
    <div class="pie-body">
      <div class="ec ec-pie" use:echart={{ option: opts.pie, onReady: onPieReady }}></div>
      <div class="chart-legend chart-legend-col">
        {#each pieLegend as item (item.key)}
          {@render legendItem(item, isHidden(pieSel, item.key), togglePie, pieHighlight)}
        {/each}
      </div>
    </div>
    <button class="chart-reset-btn" onclick={resetPie}>Reset</button>
  </div>
  <div class="card chart-card">
    <div class="chart-title">
      Lines <span class="title-sq" style="background:{colorAdded}"></span>added vs
      <span class="title-sq" style="background:{colorDeleted}"></span>deleted
    </div>
    <div class="ec ec-churn" use:echart={{ option: opts.addDel, onReady: onChurnReady }}></div>
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
  /* Horizontal diverging bars need a row of vertical space each; give the churn
     chart a little more height than the default so ~10 contributors stay legible. */
  .ec-churn {
    height: 300px;
  }
  /* Small colour keys inline in the churn title, standing in for a legend: green
     for added, red for deleted, beside the words they label. */
  .title-sq {
    display: inline-block;
    width: 9px;
    height: 9px;
    margin: 0 5px 0 9px;
    border-radius: 2px;
    vertical-align: middle;
  }
  .span-2 {
    grid-column: 1 / -1;
  }

  /* The commit-share pie and its legend sit side by side; the pie takes the
     remaining width while the legend column scrolls if there are many people. */
  .pie-body {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .ec-pie {
    flex: 1 1 0;
    min-width: 0;
    width: auto;
    height: 320px;
  }
  .chart-legend-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex-shrink: 0;
    max-width: 45%;
    max-height: 240px;
    overflow-y: auto;
  }
  /* The weekly-commits legend wraps as a centered row beneath the chart. */
  .chart-legend-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 2px 4px;
    margin-top: 6px;
  }
  /* One legend entry: swatch + plain name. Mirrors the timeline lane labels —
     hover opens the author popover, click toggles the series (dimmed when off). */
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    padding: 2px 5px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 0.72rem;
    line-height: 1.3;
    cursor: pointer;

    &:hover {
      color: var(--text-primary);
      background: var(--bg-badge);
    }
    &.hidden {
      opacity: 0.4;
    }
  }
  .legend-dot {
    flex-shrink: 0;
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }
  .legend-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
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
