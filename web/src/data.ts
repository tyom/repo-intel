import type { RepoData } from "$types";

// In a built dashboard, repo-intel.py injects `window.__DATA__` via a plain
// <script> in <head> that runs before this module. In `bun run dev` there is no
// injection, so fall back to the mock fixture for HMR development.
export async function loadData(): Promise<RepoData> {
  if (window.__DATA__) return window.__DATA__;
  const res = await fetch("/mock-data.json");
  if (!res.ok) {
    throw new Error(`No window.__DATA__ and failed to load mock-data.json (HTTP ${res.status}).`);
  }
  return (await res.json()) as RepoData;
}
