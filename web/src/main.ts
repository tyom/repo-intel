import "./styles/app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { loadData } from "./data";

async function bootstrap() {
  const data = await loadData();
  mount(App, {
    target: document.getElementById("app")!,
    props: { data },
  });
}

bootstrap();
