<script lang="ts">
  // Languages by contributor as a two-level treemap (contributor → their language
  // mix), laid out like ECharts' "treemap-show-parent": each contributor is a
  // container with a name-header strip in the contributor's colour (clr(i)), and
  // the languages are tiles inside carrying their own brand colour (l.color).
  // Hovering a contributor's name strip opens the same author popover the timeline
  // lanes and churn axis use.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { echart } from "$lib/actions";
  import type { AuthorPopover } from "$lib/popovers";
  import { tileInnerBorder } from "$lib/chart-helpers";
  import { bgCard, clr, contrastText } from "$lib/theme";
  import type { RepoData } from "$types";
  import type { EChartsCoreOption, EChartsType } from "echarts/core";

  let { data, authorPopover }: { data: RepoData; authorPopover: AuthorPopover | undefined } =
    $props();

  // Hide the card entirely when no contributor has a language mix, rather than
  // rendering an empty treemap.
  const hasLangData = $derived(data.contributors.some((c) => c.languages?.length > 0));

  // ECharts' treemap view forces a pointer cursor on every node (and on the root
  // background) and ignores series.cursor, so override it to the default after
  // each render — `finished` fires on the initial draw and on every redraw/resize.
  // zrender exposes no public per-node cursor API, so we reach into the display
  // list; guard the private access so a future ECharts bump degrades to a stray
  // pointer cursor instead of throwing and breaking the treemap mount.
  function onReady(chart: EChartsType): void {
    const useDefaultCursor = (): void => {
      const list = (chart.getZr() as any)?.storage?.getDisplayList?.();
      if (!list) return;
      for (const el of list) el.cursor = "default";
    };
    chart.on("finished", useDefaultCursor);
    useDefaultCursor();

    // Only the contributor containers carry an `idx` (the language tiles don't),
    // so hovering a leaf tile hides the popover. We anchor a zero-size rect at the
    // cursor, exactly as ChurnCard does for its canvas-rendered axis labels.
    //
    // The header strip is several zrender elements (the container rect + its text
    // label), so a naive re-anchor on every `mouseover` makes the popover jump as
    // the cursor crosses element boundaries within one strip. We therefore key on
    // the contributor `idx` and only (re)anchor when it actually changes — moving
    // around inside one section is a no-op, which keeps the popover still.
    let shownIdx = -1;
    chart.on("mouseover", (p: any) => {
      const idx = p.data?.idx;
      if (idx == null) {
        // A language tile, the gap, or the root — i.e. we've left the name region.
        if (shownIdx !== -1) {
          authorPopover?.hide();
          shownIdx = -1;
        }
        return;
      }
      if (idx === shownIdx) return;
      const ev = p.event?.event as MouseEvent | undefined;
      if (!ev) return;
      shownIdx = idx;
      const x = ev.clientX;
      const y = ev.clientY;
      const rect = { left: x, right: x, top: y, bottom: y, width: 0, height: 0, x, y } as DOMRect;
      authorPopover?.show(idx, { getBoundingClientRect: () => rect } as Element);
    });
    // Leaving the chart entirely (between cards, off the canvas) closes the popover;
    // mouseout per-element would fire mid-strip and re-trigger the jump above.
    chart.getZr().on("globalout", () => {
      if (shownIdx !== -1) {
        authorPopover?.hide();
        shownIdx = -1;
      }
    });
  }

  const option = $derived.by<EChartsCoreOption>(() => ({
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
        data: data.contributors.map((c, i) => {
          const base = clr(i);
          const langs = [...c.languages].sort((a, b) => b.pct - a.pct);
          return {
            name: c.name,
            // `idx` lets the hover handler resolve this person for the author
            // popover — which carries their commit share, so the header strip
            // stays a plain (often-truncation-prone) name.
            idx: i,
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
  }));
</script>

{#if hasLangData}
  <div class="card chart-card span-2">
    <div class="chart-title">Languages by contributor</div>
    <div class="ec ec-tree" use:echart={{ option, onReady }}></div>
  </div>
{/if}
