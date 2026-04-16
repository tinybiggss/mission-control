<script lang="ts">
  import type { DraftGroup, AdaptedStatus } from '$lib/types';
  import PlatformPanel from './PlatformPanel.svelte';

  let {
    group,
    onStatusChange,
    onContentChange,
    onBulkApprove
  }: {
    group: DraftGroup;
    onStatusChange: (draftId: string, platform: string, newStatus: AdaptedStatus) => Promise<void>;
    onContentChange: (draftId: string, platform: string, newBody: string) => Promise<void>;
    onBulkApprove: (draftId: string) => Promise<void>;
  } = $props();

  let bulkBusy = $state(false);

  async function bulkApprove() {
    bulkBusy = true;
    try {
      await onBulkApprove(group.draft.id);
    } finally {
      bulkBusy = false;
    }
  }

  const pendingCount = $derived(group.versions.filter((v) => v.status === 'pending-approval').length);
</script>

<div class="border-2 border-gray-200 rounded-xl p-5 bg-gray-50">
  <div class="flex items-start justify-between gap-4 mb-4">
    <div class="flex-1">
      <h2 class="text-xl font-bold text-gray-900">{group.draft.source_signal}</h2>
      <div class="text-sm text-gray-600 mt-1 flex gap-3 flex-wrap">
        <span><strong>Pillar:</strong> {group.draft.pillar}</span>
        <span><strong>Score:</strong> {group.draft.source_score}</span>
        <span><strong>Formula:</strong> {group.draft.headline_formula}</span>
      </div>
      <div class="text-xs text-gray-500 mt-1">
        <code>{group.draft.id}</code> • {group.draft.created} • {group.versions.length} platform version{group.versions.length === 1 ? '' : 's'}
      </div>
    </div>

    {#if pendingCount > 0}
      <button
        class="px-4 py-2 bg-rt-green text-white rounded hover:bg-green-800 disabled:opacity-50 text-sm font-medium whitespace-nowrap"
        onclick={bulkApprove}
        disabled={bulkBusy}
      >
        {bulkBusy ? 'Approving…' : `Approve All (${pendingCount})`}
      </button>
    {/if}
  </div>

  <div class="space-y-3">
    {#each group.versions as version (version.id)}
      <PlatformPanel
        {version}
        {onStatusChange}
        {onContentChange}
      />
    {/each}
  </div>
</div>
