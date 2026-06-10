<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import DraftCard from '$lib/components/DraftCard.svelte';
  import FilterBar from '$lib/components/FilterBar.svelte';
  import ToastMessage from '$lib/components/ToastMessage.svelte';
  import { filterGroups } from '$lib/grouping';
  import type { FilterState, AdaptedStatus } from '$lib/types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let filter = $state<FilterState>({ status: 'pending-approval', platform: 'all', pillar: 'all', scoreMin: null, scoreMax: null });
  let toast = $state<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);

  const filteredGroups = $derived(filterGroups(data.groups, filter));

  function showToast(message: string, type: 'info' | 'success' | 'error' = 'info') {
    toast = { message, type };
    setTimeout(() => (toast = null), 3000);
  }

  async function handleStatusChange(
    draftId: string,
    platform: string,
    newStatus: AdaptedStatus,
    reason?: string
  ) {
    const payload: { status: AdaptedStatus; reason?: string } = { status: newStatus };
    if (reason) payload.reason = reason;
    const res = await fetch(`/api/adapted/${encodeURIComponent(draftId)}/${encodeURIComponent(platform)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({ message: res.statusText }))).message || res.statusText;
      showToast(`Failed to update status: ${msg}`, 'error');
      return;
    }
    showToast(`Marked ${platform} as ${newStatus}`, 'success');
    await invalidateAll();
  }

  async function handleContentChange(draftId: string, platform: string, newBody: string) {
    const res = await fetch(`/api/adapted/${encodeURIComponent(draftId)}/${encodeURIComponent(platform)}/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newBody })
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({ message: res.statusText }))).message || res.statusText;
      throw new Error(msg);
    }
    showToast(`Saved changes to ${platform}`, 'success');
    await invalidateAll();
  }

  async function handleBulkApprove(draftId: string) {
    const group = data.groups.find((g) => g.draft.id === draftId);
    if (!group) return;

    const pending = group.versions.filter((v) => v.status === 'pending-approval');
    if (pending.length === 0) return;

    const results = await Promise.allSettled(
      pending.map((v) =>
        fetch(`/api/adapted/${encodeURIComponent(draftId)}/${encodeURIComponent(v.platform)}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'approved' })
        }).then((r) => {
          if (!r.ok) throw new Error(`${v.platform} failed`);
          return r;
        })
      )
    );
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length === 0) {
      showToast(`Approved all ${pending.length} platforms for this draft`, 'success');
    } else {
      showToast(`Approved ${pending.length - failures.length} of ${pending.length}; ${failures.length} failed`, 'error');
    }
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>Corvus Dashboard — Approval Queue</title>
</svelte:head>

<FilterBar
  filter={filter}
  platforms={data.platforms}
  pillars={data.pillars}
  scoreBounds={data.scoreBounds}
  counts={data.counts}
  onFilterChange={(next) => (filter = next)}
/>

{#if filteredGroups.length === 0}
  <div class="text-center py-16 text-gray-500">
    <p class="text-lg mb-2">Nothing to review here.</p>
    <p class="text-sm">Try changing the filter, or wait for Corvus to drop new drafts.</p>
  </div>
{:else}
  <div class="space-y-6">
    {#each filteredGroups as group (group.draft.id)}
      <DraftCard
        {group}
        onStatusChange={handleStatusChange}
        onContentChange={handleContentChange}
        onBulkApprove={handleBulkApprove}
      />
    {/each}
  </div>
{/if}

{#if toast}
  <ToastMessage message={toast.message} type={toast.type} onDismiss={() => (toast = null)} />
{/if}
