// Modular ECharts registration, mirroring the tree-shaking discipline chart.ts
// used: only the series/components this dashboard actually renders are pulled in,
// dropping everything else (graph, sunburst, radar, geo, …) from the bundle.
//
// In use: line (weekly stacked area + contributor sparklines), bar (add/del,
// net-per-commit, hour/dow patterns), pie (commit share), treemap (languages by
// contributor). Add a series here when a new chart needs it.
import * as echarts from "echarts/core";
import { LineChart, BarChart, PieChart, TreemapChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  TreemapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
]);

export { echarts };
