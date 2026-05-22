import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";

const MARKER = "/*__DATA_INJECTION__*/";

// Guarantees the data-injection marker survives into the final single-file HTML,
// regardless of how the minifier treats a comment-only <script>. repo-intel.py
// replaces this marker with `window.__DATA__ = {...};` at dashboard-generation
// time. It must be a plain (non-module) <script> in <head> so it runs *before*
// the deferred app module that reads window.__DATA__.
function injectionMarker(): Plugin {
  return {
    name: "repo-intel:injection-marker",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        if (html.includes(MARKER)) return html;
        return html.replace(/<head>/i, `<head>\n<script>${MARKER}</script>`);
      },
    },
  };
}

export default defineConfig({
  plugins: [svelte(), viteSingleFile(), injectionMarker()],
});
