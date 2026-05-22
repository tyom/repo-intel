// Modular ECharts registration, mirroring the tree-shaking discipline chart.ts
// used: only the series/components this dashboard actually renders are pulled in,
// dropping everything else (graph, sunburst, radar, geo, …) from the bundle.
//
// In use: line (weekly stacked area + contributor sparklines), bar (add/del,
// net-per-commit), pie (commit share), treemap (languages by contributor),
// scatter (commit-pattern punch cards). Add a series here when a new chart
// needs it.
import * as echarts from "echarts/core";
import { LineChart, BarChart, PieChart, TreemapChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// Chart titles are CSS overlays (.chart-title), not ECharts `title:` options, so
// TitleComponent is deliberately not registered.
echarts.use([
  LineChart,
  BarChart,
  PieChart,
  TreemapChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

export { echarts };
