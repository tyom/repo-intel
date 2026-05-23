<script lang="ts">
  // Commit share as a pie, one slice per contributor plus an "Others" remainder
  // when the top-N don't cover every commit. Slices are named by the (unique)
  // email so duplicate display names don't collapse; the HTML ChartLegend beside
  // it drives selection and slice highlight via the chart's hidden legend.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { echart } from "$lib/actions";
  import { escapeHtml } from "$lib/format";
  import type { AuthorPopover } from "$lib/popovers";
  import { buildContribLegend, buildNameByEmail, type LegendItem } from "$lib/chart-helpers";
  import { createLegendSelection } from "$lib/chart-legend.svelte";
  import { bgCard, borderDefault, clr, textMuted, textPrimary } from "$lib/theme";
  import type { RepoData } from "$types";
  import type { EChartsCoreOption } from "echarts/core";
  import ChartLegend from "$components/ChartLegend.svelte";

  let { data, authorPopover }: { data: RepoData; authorPopover: AuthorPopover | undefined } =
    $props();

  const nameByEmail = $derived(buildNameByEmail(data.contributors));
  const dispName = (email: string): string => nameByEmail.get(email) ?? email;
  const contribLegend = $derived(buildContribLegend(data.contributors));

  // Commits not covered by the top-N contributors → the pie's "Others" slice.
  // Single source of truth so the slice and its legend row can't drift apart.
  const othersCommits = $derived(
    data.totals.commits - data.contributors.reduce((acc, c) => acc + c.commits, 0),
  );
  // The legend mirrors the slices: contributors plus the "Others" remainder
  // (idx -1 → no popover) when the top-N don't cover every commit.
  const pieLegend = $derived<LegendItem[]>(
    othersCommits > 0
      ? [...contribLegend, { key: "Others", name: "Others", color: borderDefault, idx: -1 }]
      : contribLegend,
  );

  // Legend selection + slice highlight on row hover (the pie wires onEmphasize).
  const legend = createLegendSelection();

  const option = $derived.by<EChartsCoreOption>(() => {
    const pieSlices = [
      ...data.contributors.map((c, i) => ({
        name: c.email,
        value: c.commits,
        itemStyle: { color: clr(i) },
      })),
      // Only show "Others" when the top-N don't cover every commit; otherwise
      // it's a 0-value slice cluttering the legend.
      ...(othersCommits > 0
        ? [{ name: "Others", value: othersCommits, itemStyle: { color: borderDefault } }]
        : []),
    ];
    return {
      // Slices are named by email (unique); map back for the tooltip. "Others"
      // isn't an email, so dispName falls through to it unchanged.
      tooltip: {
        trigger: "item",
        formatter: (p: any) => `${escapeHtml(dispName(p.name))}: ${p.value} (${p.percent}%)`,
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
          // Hovering a legend row highlights the matching slice (see highlight),
          // which scales it out a touch; scaleSize is the radial nudge in px.
          emphasis: { scale: true, scaleSize: 8 },
        },
      ],
    };
  });
</script>

<div class="card chart-card">
  <div class="chart-title">Commit share</div>
  <div class="pie-body">
    <div class="ec ec-pie" use:echart={{ option, onReady: legend.onReady }}></div>
    <ChartLegend
      items={pieLegend}
      selected={legend.selected}
      layout="col"
      onToggle={legend.toggle}
      onReset={legend.reset}
      onEmphasize={legend.highlight}
      {authorPopover}
    />
  </div>
</div>

<style>
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
</style>
