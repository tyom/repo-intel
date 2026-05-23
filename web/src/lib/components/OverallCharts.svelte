<script lang="ts">
  // The repo-wide chart grid. Each card is a self-contained component owning its
  // own ECharts option, ready handler, and interactions (the ContributorCard /
  // PatternCard convention); this file is just the layout and prop pass-through.
  // The Languages and Largest-files cards self-guard their own visibility (no
  // language mix / no file payload on the remote GraphQL path), so they're always
  // listed here and simply render nothing when they have no data.
  import type { AuthorPopover } from "$lib/popovers";
  import type { RepoData } from "$types";
  import WeeklyCommitsCard from "$components/WeeklyCommitsCard.svelte";
  import CommitShareCard from "$components/CommitShareCard.svelte";
  import ChurnCard from "$components/ChurnCard.svelte";
  import CommitStyleCard from "$components/CommitStyleCard.svelte";
  import LanguagesCard from "$components/LanguagesCard.svelte";
  import LargestFilesCard from "$components/LargestFilesCard.svelte";

  let { data, authorPopover }: { data: RepoData; authorPopover: AuthorPopover | undefined } =
    $props();
</script>

<div class="grid-2">
  <WeeklyCommitsCard {data} {authorPopover} />
  <CommitShareCard {data} {authorPopover} />
  <ChurnCard {data} {authorPopover} />
  <CommitStyleCard {data} />
  <LanguagesCard {data} {authorPopover} />
  <LargestFilesCard {data} />
</div>
