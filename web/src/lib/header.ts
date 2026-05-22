// Repo-wide Technologies section: language bar + frameworks grouped by language.
// (The page title/subtitle and timeline heading moved to components/Header.svelte
// and App.svelte; this module now only renders the Technologies section.)
import type { RepoData } from "../types";
import { escapeHtml, langBarHtml } from "./format";

export function renderTech(D: RepoData): void {
  const section = document.getElementById("tech");
  if (!section) return;
  section.hidden = false;
  const repoLangs = D.repoLanguages || [];
  const frameworks = D.frameworks || [];

  const langEl = document.getElementById("techLanguages");
  if (langEl) {
    const langLabel = D.repoLanguagesBasis === "size" ? "Languages by code size" : "Languages by lines changed";
    langEl.innerHTML = repoLangs.length
      ? `<div class="tech-bar-label">${langLabel}</div>` + langBarHtml(repoLangs, { legend: true, repoBase: D.githubBaseUrl })
      : `<div class="tech-bar-label">Languages</div>` +
        `<div class="tech-empty">Couldn't load language data from the GitHub API for this repo.</div>`;
  }

  const fwEl = document.getElementById("techFrameworks");
  if (fwEl) {
    fwEl.innerHTML =
      `<div class="tech-bar-label">Frameworks &amp; tools</div>` +
      (frameworks.length
        ? `<div class="frameworks">` +
          frameworks
            .map(
              (g) =>
                `<div class="fw-group">` +
                `<span class="fw-lang"><span class="lang-dot" style="background:${g.color}"></span>${escapeHtml(g.language)}</span>` +
                `<span class="fw-items">${g.names.map(escapeHtml).join(", ")}</span>` +
                `</div>`,
            )
            .join("") +
          `</div>`
        : `<div class="tech-empty">No known frameworks detected in the repo's dependency manifests.</div>`);
  }
}
