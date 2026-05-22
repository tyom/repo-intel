// Explicit Chart.js registration (instead of `chart.js/auto`) so the bundle only
// pulls in the controllers/elements/scales/plugins this dashboard actually uses,
// dropping the unused ones (radar, polar-area, scatter, bubble, etc.).
//
// In use: line (overall weekly + contributor sparklines, with area fill),
// doughnut (commit share), bar (add/del, net-per-commit, hour, dow).
import {
  Chart,
  BarController,
  LineController,
  DoughnutController,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  LinearScale,
  CategoryScale,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

Chart.register(
  BarController,
  LineController,
  DoughnutController,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  LinearScale,
  CategoryScale,
  Title,
  Tooltip,
  Legend,
  Filler,
);

export { Chart };
