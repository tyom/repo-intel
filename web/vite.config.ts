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

// vite-plugin-singlefile inlines JS and CSS but never image assets, so the
// favicon would ship as a sibling hashed PNG the dashboard can't reach — the
// generated file is opened over file:// from /tmp, with no network guarantee.
// Fold the favicon into the single file as a base64 data URI: read its bytes
// straight from the bundle (no fs), rewrite the <link> href, and drop the now-
// orphaned asset. enforce:"post" so it runs after singlefile's own output.
function inlineFavicon(): Plugin {
  return {
    name: "repo-intel:inline-favicon",
    enforce: "post",
    generateBundle(_options, bundle) {
      const fav = Object.values(bundle).find(
        (c) => c.type === "asset" && /favicon.*\.png$/.test(c.fileName),
      );
      const html = Object.values(bundle).find(
        (c) => c.type === "asset" && c.fileName.endsWith(".html"),
      );
      if (fav?.type !== "asset" || html?.type !== "asset" || typeof html.source !== "string") {
        return;
      }
      const bytes =
        typeof fav.source === "string" ? new TextEncoder().encode(fav.source) : fav.source;
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const dataUri = `data:image/png;base64,${btoa(binary)}`;
      html.source = html.source.replace(new RegExp(`\\.?/${fav.fileName}`), dataUri);
      delete bundle[fav.fileName];
    },
  };
}

// Path aliases (mirrored in tsconfig.json's paths) for nicer imports:
//   $types        → src/types.ts
//   $lib/*        → src/lib/*
//   $components/* → src/lib/components/*
// Resolved against this config's location via import.meta.url so no @types/node
// is needed (avoiding fileURLToPath keeps the dep out of svelte-check's scope).
// Decode percent-escapes (e.g. spaces) and strip the leading slash that
// file-URL pathnames prepend before a Windows drive letter (/C:/… → C:/…).
const abs = (p: string) => {
  const path = decodeURIComponent(new URL(p, import.meta.url).pathname);
  return /^\/[a-zA-Z]:/.test(path) ? path.slice(1) : path;
};

export default defineConfig({
  plugins: [svelte(), viteSingleFile(), injectionMarker(), inlineFavicon()],
  resolve: {
    alias: {
      $components: abs("./src/lib/components"),
      $lib: abs("./src/lib"),
      $types: abs("./src/types.ts"),
    },
  },
});
