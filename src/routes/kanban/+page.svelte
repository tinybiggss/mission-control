<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import KanbanColumn from '$lib/components/KanbanColumn.svelte';
  import type { KanbanCardData } from '$lib/components/KanbanCard.svelte';
  import ToastMessage from '$lib/components/ToastMessage.svelte';
  import type { AdaptedStatus } from '$lib/types';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Columns, in display order. 'rejected' intentionally omitted from the primary
  // board — shown only in a secondary section below.
  const COLUMNS: { title: string; status: AdaptedStatus; accent: string }[] = [
    { title: 'Draft', status: 'pending-approval', accent: 'bg-gray-100 text-gray-700' },
    { title: 'Approved', status: 'approved', accent: 'bg-green-100 text-green-800' },
    { title: 'Scheduled', status: 'scheduled', accent: 'bg-indigo-100 text-indigo-800' },
    { title: 'Published', status: 'published', accent: 'bg-blue-100 text-blue-800' }
  ];

  let draggedCard = $state<KanbanCardData | null>(null);
  let toast = $state<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);

  // Schedule modal state — opens when a card is dropped on the Scheduled column
  let scheduleTarget = $state<KanbanCardData | null>(null);
  let scheduleDate = $state(todayIso());

  const cardsByStatus = $derived.by(() => {
    const out: Record<AdaptedStatus, KanbanCardData[]> = {
      'pending-approval': [],
      approved: [],
      rejected: [],
      scheduled: [],
      published: []
    };
    for (const card of data.cards) out[card.status].push(card);
    return out;
  });

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function showToast(message: string, type: 'info' | 'success' | 'error' = 'info') {
    toast = { message, type };
    setTimeout(() => (toast = null), 3000);
  }

  function handleDragStart(card: KanbanCardData) {
    draggedCard = card;
  }

  async function handleDrop(targetStatus: AdaptedStatus) {
    const card = draggedCard;
    draggedCard = null;
    if (!card) return;
    if (card.status === targetStatus) return;

    // Scheduled is special: it requires a date. Open the modal instead of a direct call.
    if (targetStatus === 'scheduled') {
      scheduleTarget = card;
      scheduleDate = card.scheduled_date || todayIso();
      return;
    }

    await moveCardStatus(card, targetStatus);
  }

  async function moveCardStatus(card: KanbanCardData, newStatus: AdaptedStatus) {
    const res = await fetch(
      `/api/adapted/${encodeURIComponent(card.draftId)}/${encodeURIComponent(card.platform)}/status`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      }
    );
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({ message: res.statusText }))).message || res.statusText;
      showToast(`Failed to update: ${msg}`, 'error');
      return;
    }
    showToast(`Moved ${card.platform} → ${newStatus}`, 'success');
    await invalidateAll();
  }

  async function confirmSchedule() {
    const card = scheduleTarget;
    if (!card) return;
    const res = await fetch(
      `/api/adapted/${encodeURIComponent(card.draftId)}/${encodeURIComponent(card.platform)}/schedule`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: scheduleDate })
      }
    );
    scheduleTarget = null;
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({ message: res.statusText }))).message || res.statusText;
      showToast(`Schedule failed: ${msg}`, 'error');
      return;
    }
    showToast(`Scheduled ${card.platform} for ${scheduleDate}`, 'success');
    await invalidateAll();
  }

  function cancelSchedule() {
    scheduleTarget = null;
  }
</script>

<svelte:head>
  <title>Corvus Dashboard — Kanban</title>
</svelte:head>

<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
  {#each COLUMNS as col (col.status)}
    <KanbanColumn
      title={col.title}
      status={col.status}
      cards={cardsByStatus[col.status]}
      accentClass={col.accent}
      onDragStart={handleDragStart}
      onDrop={handleDrop}
    />
  {/each}
</div>

{#if cardsByStatus.rejected.length > 0}
  <details class="mt-6">
    <summary class="cursor-pointer text-sm text-gray-600 hover:text-gray-900">
      Rejected ({cardsByStatus.rejected.length})
    </summary>
    <div class="grid grid-cols-1 md:grid-cols-4 gap-2 mt-3">
      {#each cardsByStatus.rejected as card (card.draftId + '/' + card.platform)}
        <div class="bg-red-50 border border-red-200 rounded-md p-3 opacity-80">
          <div class="text-xs font-medium text-red-700 uppercase tracking-wide">{card.platform}</div>
          <div class="text-sm text-gray-800 mt-1">{card.source_signal}</div>
        </div>
      {/each}
    </div>
  </details>
{/if}

{#if scheduleTarget}
  <div
    class="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
    role="dialog"
    aria-modal="true"
    aria-labelledby="schedule-title"
  >
    <div class="bg-white rounded-lg p-6 shadow-xl w-full max-w-md">
      <h3 id="schedule-title" class="text-lg font-semibold mb-2">Schedule post</h3>
      <p class="text-sm text-gray-600 mb-4">
        <span class="font-medium">{scheduleTarget.platform}</span> — {scheduleTarget.source_signal}
      </p>
      <label class="block text-sm font-medium text-gray-700 mb-1" for="schedule-date">
        Post date
      </label>
      <input
        id="schedule-date"
        type="date"
        bind:value={scheduleDate}
        min={todayIso()}
        class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <div class="flex justify-end gap-2 mt-4">
        <button
          onclick={cancelSchedule}
          class="px-3 py-1.5 bg-gray-100 text-gray-800 rounded hover:bg-gray-200 text-sm"
        >
          Cancel
        </button>
        <button
          onclick={confirmSchedule}
          class="px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm font-medium"
        >
          Schedule
        </button>
      </div>
    </div>
  </div>
{/if}

{#if toast}
  <ToastMessage message={toast.message} type={toast.type} onDismiss={() => (toast = null)} />
{/if}
