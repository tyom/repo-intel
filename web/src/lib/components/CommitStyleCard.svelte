<script lang="ts">
  // Commit style: how each contributor commits their work. x = how many commits
  // they made; y = the median size (churn = added + deleted) of those commits.
  // Upper-left = commits rarely but dumps a large diff each time; lower-right =
  // commits often and small (steady, incremental). Median (not mean) is the
  // honest "typical commit" — it ignores the one giant merge that would drag a
  // mean upward, so it separates "consistently small" from "small but
  // occasionally huge". Bubble area encodes total lines touched (overall
  // footprint); colour is the person's identity colour (clr).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { echart } from "$lib/actions";
  import { escapeHtml } from "$lib/format";
  import { humanContribRows } from "$lib/chart-helpers";
  import { borderDefault, clr, textMuted, textPrimary } from "$lib/theme";
  import type { RepoData } from "$types";
  import type { EChartsCoreOption } from "echarts/core";

  let { data }: { data: RepoData } = $props();

  const option = $derived.by<EChartsCoreOption>(() => {
    // Both axes are log: commit counts and sizes span orders of magnitude, so a
    // linear scale would crush everyone into one corner.
    // Per-commit churn comes from data.commits (keyed by author email c.e), which
    // holds every commit by the displayed contributors.
    const median = (xs: number[]): number => {
      if (!xs.length) return 0;
      const s = [...xs].sort((a, b) => a - b);
      const m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const churnByEmail = new Map<string, number[]>();
    for (const k of data.commits) {
      const arr = churnByEmail.get(k.e);
      if (arr) arr.push(k.a + k.l);
      else churnByEmail.set(k.e, [k.a + k.l]);
    }
    // Bots dropped — a Renovate/CI account commits nothing like a human and only
    // stretches the axes (see humanContribRows).
    const styleRows = humanContribRows(data.contributors);
    const styleMax = Math.max(1, ...styleRows.map((r) => r.c.added + r.c.deleted));
    // The busiest contributor sits hard against the right edge; flip just their
    // label to the left so the longest name can't clip off the plot.
    const styleMaxCommits = Math.max(0, ...styleRows.map((r) => r.c.commits));
    return {
      tooltip: {
        trigger: "item",
        formatter: (p: any) => {
          const [commits, med, total] = p.value as [number, number, number];
          return (
            `${escapeHtml(p.data.name)}<br>${commits.toLocaleString()} commits` +
            `<br>median ${med.toLocaleString()} lines/commit` +
            `<br>${total.toLocaleString()} lines total`
          );
        },
      },
      grid: { left: 58, right: 20, top: 48, bottom: 46 },
      xAxis: {
        type: "log",
        min: 1,
        name: "commits",
        nameLocation: "middle",
        nameGap: 26,
        nameTextStyle: { color: textMuted, fontSize: 10 },
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { color: borderDefault, opacity: 0.4 } },
      },
      yAxis: {
        type: "log",
        name: "median lines / commit",
        nameLocation: "middle",
        nameGap: 40,
        nameTextStyle: { color: textMuted, fontSize: 10 },
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { color: borderDefault, opacity: 0.4 } },
      },
      series: [
        {
          type: "scatter",
          cursor: "default",
          // value = [commits, median churn, total churn]; total is the 3rd element
          // so symbolSize can read it directly. Log axes reject 0, so the median is
          // floored at 1 — a contributor whose typical commit is empty/merge-only
          // plots on the baseline rather than vanishing.
          data: styleRows.map((r) => {
            const med = median(churnByEmail.get(r.c.email) ?? []);
            const total = r.c.added + r.c.deleted;
            return {
              value: [r.c.commits, Math.max(1, med), total],
              name: r.c.name,
              itemStyle: { color: clr(r.origIdx), opacity: 0.85 },
              label: { position: r.c.commits === styleMaxCommits ? "left" : "right" },
            };
          }),
          symbolSize: (val: number[]) => 8 + 34 * Math.sqrt(val[2] / styleMax),
          // Names are hover-only: with several contributors landing on the same
          // (commits, size) corner, always-on labels pile up and the chart reads as
          // noise. Default state is just the identity-coloured bubbles; hovering one
          // reveals its name (plus the full tooltip). The per-item position above
          // flips the busiest contributor's label left so it can't clip the edge.
          label: {
            show: false,
            position: "right",
            formatter: (p: any) => p.data.name,
            fontSize: 10,
            color: textPrimary,
          },
          emphasis: { focus: "self", scale: 1.15, label: { show: true } },
        },
      ],
    };
  });
</script>

<div class="card chart-card">
  <div class="chart-title">Commit style</div>
  <div class="ec" use:echart={{ option }}></div>
</div>
