import "./styles/app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { loadData } from "./data";

async function bootstrap() {
  try {
    const data = await loadData();
    mount(App, {
      target: document.getElementById("app")!,
      props: { data },
    });
  } catch (err) {
    console.error("Failed to load dashboard data:", err);
    const target = document.getElementById("app");
    if (target) {
      target.textContent = "Failed to load dashboard data. See the browser console for details.";
    }
  }
}

bootstrap();
