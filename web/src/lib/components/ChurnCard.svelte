<script lang="ts">
  // Lines added vs deleted as diverging horizontal bars: deleted extends left of
  // the zero axis, added right, so each person's net balance reads as whichever
  // side is longer. Categories are keyed by the (unique) email; the y-axis labels
  // carry the same author popover (and click-through) the timeline lanes use.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { echart } from "$lib/actions";
  import { authorUrl, escapeHtml } from "$lib/format";
  import type { AuthorPopover } from "$lib/popovers";
  import { buildEmailToOrig, buildNameByEmail, humanContribRows } from "$lib/chart-helpers";
  import { clr, colorAdded, colorDeleted, textMuted } from "$lib/theme";
  import type { RepoData } from "$types";
  import type { EChartsCoreOption, EChartsType } from "echarts/core";

  let { data, authorPopover }: { data: RepoData; authorPopover: AuthorPopover | undefined } =
    $props();

  const nameByEmail = $derived(buildNameByEmail(data.contributors));
  const dispName = (email: string): string => nameByEmail.get(email) ?? email;
  // Email → original contributor index, so the axis-label hover can resolve the
  // right person (and their clr() colour / popover) even after this chart filters
  // bots and re-sorts its own local copy.
  const emailToOrig = $derived(buildEmailToOrig(data.contributors));

  // The y-axis labels carry the same author popover as the timeline lanes.
  // ECharts axis labels are canvas, not DOM, so triggerEvent surfaces one
  // mouseover/mouseout per label with the category value (the unique email); we
  // anchor the popover to the cursor via a synthetic rect, which is all
  // authorPopover.show reads off the element.
  function onReady(c: EChartsType): void {
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

  const option = $derived.by<EChartsCoreOption>(() => {
    // Bots dropped (see humanContribRows), sorted by total churn (added +
    // deleted) so the busiest sit at the top — the yAxis is inverted, since
    // ECharts otherwise draws the first category at the bottom. Categories are
    // keyed by the (unique) email — two people sharing a display name would
    // otherwise collapse — and each row keeps its original index for the axis
    // label's identity colour/dot and the hover popover.
    const addDelRows = humanContribRows(data.contributors).sort(
      (a, b) => b.c.added + b.c.deleted - (a.c.added + a.c.deleted),
    );
    const abs = (v: number) => Math.abs(v).toLocaleString();
    // Force a symmetric x-axis sized to the single largest bar (added or deleted),
    // with ~8% headroom rounded to hundreds. Left to its own devices ECharts scales
    // each direction independently — the bigger added totals stretched the right
    // out while the shorter deleted side stayed tight, so the longest deleted bar's
    // outside label collided with the contributor name in the gutter. A symmetric
    // range with headroom keeps every value label inside the plot, away from the
    // names, and reclaims the dead space on the right.
    const churnPeak = Math.max(1, ...addDelRows.map((r) => Math.max(r.c.added, r.c.deleted)));
    const churnAxisMax = Math.ceil((churnPeak * 1.08) / 100) * 100;
    // One rich-text style per row for its identity-coloured dot; the name shares a
    // single muted style. Keyed by row position (d0, d1, …), which is what the
    // axisLabel formatter receives as its index.
    const dotRich = Object.fromEntries(
      addDelRows.map((r, i) => [`d${i}`, { color: clr(r.origIdx), fontSize: 12 }]),
    );
    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (ps: any) => {
          const arr = Array.isArray(ps) ? ps : [ps];
          const rows = arr
            .map((p: any) => `${p.marker}${p.seriesName}: ${abs(p.value)}`)
            .join("<br>");
          return `${escapeHtml(dispName(arr[0]?.axisValue ?? ""))}<br>${rows}`;
        },
      },
      grid: { left: 124, right: 64, top: 16, bottom: 24 },
      // Deleted lives on the negative side, so strip the minus sign from ticks.
      xAxis: {
        type: "value",
        min: -churnAxisMax,
        max: churnAxisMax,
        axisLabel: { formatter: (v: number) => abs(v) },
      },
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
  });
</script>

<div class="card chart-card">
  <div class="chart-title">
    Lines <span class="title-sq" style="background:{colorAdded}"></span>added vs
    <span class="title-sq" style="background:{colorDeleted}"></span>deleted
  </div>
  <div class="ec ec-churn" use:echart={{ option, onReady }}></div>
</div>

<style>
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
</style>
