// Page header (title + subtitle), the timeline section heading, and the
// repo-wide Technologies section. Ported verbatim from template.html.
import type { RepoData } from "../types";
import { colorAdded, colorDeleted } from "./theme";
import { escapeHtml, fmt, fmtSize, fmtTimelineDuration, langBarHtml } from "./format";

export function renderHeader(D: RepoData): void {
  const { contributors, totals } = D;

  const baseMatch = (D.githubBaseUrl || "").match(/\/\/[^/]+\/([^/]+\/[^/]+?)\/?$/);
  const titleText = baseMatch ? baseMatch[1] : D.repoName;
  document.title = titleText ? `${titleText} · Repo Intel` : "Repo Intel";
  const titleEl = document.getElementById("title");
  if (titleEl) {
    if (D.githubBaseUrl) {
      const a = document.createElement("a");
      a.href = D.githubBaseUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = titleText;
      titleEl.appendChild(a);
    } else {
      titleEl.textContent = titleText;
    }
  }

  const totalContribCount =
    totals && typeof totals.contributors === "number" ? totals.contributors : contributors.length;
  const subtitleNetHtml =
    totals.net! > 0
      ? `<span style="color:${colorAdded}">+${fmt(totals.net!)}</span>`
      : totals.net! < 0
        ? `<span style="color:${colorDeleted}">${fmt(totals.net!)}</span>`
        : fmt(totals.net!);
  const sizeStr = fmtSize(D.repoSizeKb);
  const subtitleEl = document.getElementById("subtitle");
  if (subtitleEl) {
    subtitleEl.innerHTML = `${D.dateRange.start} — ${D.dateRange.end} · ${fmt(totals.commits)} commits · <span style="color:${colorAdded}">+${fmt(totals.added)}</span> <span style="color:${colorDeleted}">-${fmt(totals.deleted)}</span> (net ${subtitleNetHtml}) · ${fmt(totalContribCount)} contributor${totalContribCount === 1 ? "" : "s"}${sizeStr ? ` · ${sizeStr}` : ""}`;
  }

  const timelineHeadingEl = document.querySelector(".timeline-h");
  if (timelineHeadingEl) {
    const dur = fmtTimelineDuration(D.dateRange.start, D.dateRange.end);
    if (dur) timelineHeadingEl.textContent = `Commit timeline: ${dur}`;
  }
}

// Repo-wide Technologies section: language bar + frameworks grouped by language.
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
