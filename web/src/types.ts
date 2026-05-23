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
}

export interface Totals {
  commits: number;
  /** Merge commits, additive to `commits` (not included in it); absent on the remote GraphQL path. */
  merges?: number;
  added: number;
  deleted: number;
  contributors: number;
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

export interface FileSize {
  path: string;
  bytes: number;
}

// Payload for the file-size sunbursts: the largest paths plus the summed
// remainder. Null when unavailable (the remote GraphQL path fetches no tree).
export interface FileSizes {
  items: FileSize[];
  otherBytes: number;
  otherCount: number;
}

export interface RepoData {
  repoName: string;
  githubBaseUrl: string | null;
  defaultBranch: string;
  branchCount: number | null;
  repoSizeKb: number;
  fileCount: number | null;
  largestFiles: FileSizes | null;
  diskByPath: FileSizes | null;
  dateRange: DateRange;
  /** ISO timestamp of the latest commit (HEAD), for the "updated N ago" note. */
  lastCommit?: string;
  /** ISO timestamp of when this report was generated. */
  generatedAt?: string;
  /** GitHub social counts; absent for non-GitHub or unreachable repos. */
  stars?: number | null;
  watchers?: number | null;
  forks?: number | null;
  totals: Totals;
  contributors: Contributor[];
  weeks: string[];
  weeklyData: Record<string, number[]>;
  dailyData: Record<string, Record<string, number>>;
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
