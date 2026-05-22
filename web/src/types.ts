// Mirrors the JSON object produced by build_data() in repo-intel.py and injected
// as `window.__DATA__`. Keep this in sync with repo-intel.py:1743-1766.

export interface LanguageStat {
  name: string;
  pct: number;
  color: string;
}

// detect_frameworks() / fetch_remote returns groups by language.
export interface FrameworkGroup {
  language: string;
  color: string;
  names: string[];
}

// enrich_contributor_profiles() attaches this (best-effort, may be absent).
export interface ContributorProfile {
  bio?: string;
  followers?: number;
  following?: number;
  publicRepos?: number;
  location?: string;
  websiteUrl?: string;
}

export interface Contributor {
  name: string;
  email: string;
  login: string;
  commits: number;
  added: number;
  deleted: number;
  activeDays: number;
  first: string;
  last: string;
  busiestDay: string;
  busiestCount: number;
  avatarUrl: string;
  highlight: boolean;
  languages: LanguageStat[];
  profile?: ContributorProfile;
  // Computed client-side after load (see deriveContributor):
  net?: number;
  lc?: number;
  avgPerDay?: number;
}

export interface Totals {
  commits: number;
  added: number;
  deleted: number;
  contributors: number;
  net?: number; // computed client-side
}

export interface DateRange {
  start: string;
  end: string;
}

// Contributions-heatmap view mode: rolling 52-week window ("current") or a
// specific calendar year. Chosen by YearToggles, consumed by Heatmap.
export type Mode = "current" | number;

// Compact per-commit record. `f` is [name, color, fileCount][] of churned langs.
export interface Commit {
  h: string;
  s: string;
  e: string;
  d: string;
  a: number;
  l: number;
  f?: [string, string, number][];
}

export interface Tag {
  name: string;
  oid?: string;
  date?: string;
  message?: string;
}

export interface RepoData {
  repoName: string;
  githubBaseUrl: string | null;
  defaultBranch: string;
  repoSizeKb: number;
  dateRange: DateRange;
  totals: Totals;
  contributors: Contributor[];
  weeks: string[];
  weeklyData: Record<string, number[]>;
  dailyData: Record<string, Record<string, number>>;
  hourlyData: Record<string, number[]>;
  dowData: Record<string, number[]>;
  commits: Commit[];
  tags: Tag[];
  repoLanguages: LanguageStat[];
  repoLanguagesBasis: "size" | "churn";
  frameworks: FrameworkGroup[];
}

declare global {
  interface Window {
    __DATA__?: RepoData;
  }
}
