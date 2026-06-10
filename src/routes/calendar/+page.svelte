<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import CalendarDayCell from '$lib/components/CalendarDayCell.svelte';
  import type { CalendarEventData } from '$lib/components/CalendarEventChip.svelte';
  import ToastMessage from '$lib/components/ToastMessage.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type ViewMode = 'month' | 'week';
  let view = $state<ViewMode>('month');
  // Anchor date (any date within the visible range). Stored as YYYY-MM-DD.
  let anchor = $state(todayIso());

  let draggedEvent = $state<CalendarEventData | null>(null);
  let rescheduleTarget = $state<CalendarEventData | null>(null);
  let rescheduleDate = $state(todayIso());
  let toast = $state<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);

  // Index events by date for O(1) lookup per cell.
  const eventsByDate = $derived.by(() => {
    const map = new Map<string, CalendarEventData[]>();
    for (const ev of data.events as CalendarEventData[]) {
      const list = map.get(ev.scheduled_date) ?? [];
      list.push(ev);
      map.set(ev.scheduled_date, list);
    }
    return map;
  });

  const visibleRange = $derived.by(() => (view === 'month' ? monthGrid(anchor) : weekGrid(anchor)));
  const title = $derived.by(() => {
    const d = parseIso(anchor);
    if (view === 'month') {
      return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }
    const week = weekGrid(anchor);
    const start = parseIso(week[0]);
    const end = parseIso(week[6]);
    const sameMonth = start.getMonth() === end.getMonth();
    const startFmt = start.toLocaleString('en-US', { month: 'short', day: 'numeric' });
    const endFmt = end.toLocaleString('en-US', {
      month: sameMonth ? undefined : 'short',
      day: 'numeric',
      year: 'numeric'
    });
    return `${startFmt} – ${endFmt}`;
  });

  function todayIso() {
    return toIso(new Date());
  }

  function toIso(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function parseIso(iso: string) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(iso: string, n: number) {
    const d = parseIso(iso);
    d.setDate(d.getDate() + n);
    return toIso(d);
  }

  function addMonths(iso: string, n: number) {
    const d = parseIso(iso);
    d.setMonth(d.getMonth() + n);
    return toIso(d);
  }

  // 6-week grid starting on Sunday that contains the anchor's month.
  function monthGrid(iso: string): string[] {
    const d = parseIso(iso);
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - first.getDay());
    const cells: string[] = [];
    for (let i = 0; i < 42; i++) {
      const c = new Date(gridStart);
      c.setDate(gridStart.getDate() + i);
      cells.push(toIso(c));
    }
    return cells;
  }

  function weekGrid(iso: string): string[] {
    const d = parseIso(iso);
    const start = new Date(d);
    start.setDate(d.getDate() - d.getDay());
    const cells: string[] = [];
    for (let i = 0; i < 7; i++) {
      const c = new Date(start);
      c.setDate(start.getDate() + i);
      cells.push(toIso(c));
    }
    return cells;
  }

  function showToast(message: string, type: 'info' | 'success' | 'error' = 'info') {
    toast = { message, type };
    setTimeout(() => (toast = null), 3000);
  }

  function step(n: number) {
    anchor = view === 'month' ? addMonths(anchor, n) : addDays(anchor, n * 7);
  }

  function goToday() {
    anchor = todayIso();
  }

  function handleEventDragStart(ev: CalendarEventData) {
    draggedEvent = ev;
  }

  async function handleDrop(dateIso: string) {
    const ev = draggedEvent;
    draggedEvent = null;
    if (!ev) return;
    if (ev.scheduled_date === dateIso) return;
    if (ev.status === 'published') {
      showToast('Cannot reschedule a published post', 'error');
      return;
    }
    await reschedule(ev, dateIso);
  }

  function handleEventClick(ev: CalendarEventData) {
    if (ev.status === 'published') return;
    rescheduleTarget = ev;
    rescheduleDate = ev.scheduled_date || todayIso();
  }

  async function confirmReschedule() {
    const ev = rescheduleTarget;
    if (!ev) return;
    const date = rescheduleDate;
    rescheduleTarget = null;
    await reschedule(ev, date);
  }

  async function reschedule(ev: CalendarEventData, date: string) {
    const res = await fetch(
      `/api/adapted/${encodeURIComponent(ev.draftId)}/${encodeURIComponent(ev.platform)}/schedule`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date })
      }
    );
    if (!res.ok) {
      const msg =
        (await res.json().catch(() => ({ message: res.statusText }))).message || res.statusText;
      showToast(`Reschedule failed: ${msg}`, 'error');
      return;
    }
    showToast(`Moved ${ev.platform} → ${date}`, 'success');
    await invalidateAll();
  }

  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = todayIso();
</script>

<svelte:head>
  <title>Corvus Dashboard — Calendar</title>
</svelte:head>

<div class="flex items-center justify-between flex-wrap gap-3 mb-4">
  <div class="flex items-center gap-2">
    <button
      onclick={() => step(-1)}
      class="px-2 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
      aria-label="Previous"
    >
      ◀
    </button>
    <button
      onclick={goToday}
      class="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
    >
      Today
    </button>
    <button
      onclick={() => step(1)}
      class="px-2 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
      aria-label="Next"
    >
      ▶
    </button>
    <h2 class="text-lg font-semibold ml-2">{title}</h2>
  </div>

  <div class="inline-flex rounded border border-gray-300 overflow-hidden text-sm">
    <button
      onclick={() => (view = 'month')}
      class="px-3 py-1 {view === 'month' ? 'bg-indigo-600 text-white' : 'bg-white hover:bg-gray-50'}"
    >
      Month
    </button>
    <button
      onclick={() => (view = 'week')}
      class="px-3 py-1 {view === 'week' ? 'bg-indigo-600 text-white' : 'bg-white hover:bg-gray-50'}"
    >
      Week
    </button>
  </div>
</div>

<div class="grid grid-cols-7 gap-1 mb-1 text-xs font-medium text-gray-500">
  {#each weekdayLabels as label (label)}
    <div class="px-1">{label}</div>
  {/each}
</div>

{#if view === 'month'}
  {@const anchorMonth = parseIso(anchor).getMonth()}
  <div class="grid grid-cols-7 gap-1">
    {#each visibleRange as dateIso (dateIso)}
      <CalendarDayCell
        {dateIso}
        events={eventsByDate.get(dateIso) ?? []}
        inMonth={parseIso(dateIso).getMonth() === anchorMonth}
        isToday={dateIso === today}
        onDrop={handleDrop}
        onEventDragStart={handleEventDragStart}
        onEventClick={handleEventClick}
      />
    {/each}
  </div>
{:else}
  <div class="grid grid-cols-7 gap-1" style="min-height: 60vh;">
    {#each visibleRange as dateIso (dateIso)}
      <CalendarDayCell
        {dateIso}
        events={eventsByDate.get(dateIso) ?? []}
        isToday={dateIso === today}
        compact={true}
        onDrop={handleDrop}
        onEventDragStart={handleEventDragStart}
        onEventClick={handleEventClick}
      />
    {/each}
  </div>
{/if}

{#if rescheduleTarget}
  <div
    class="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
    role="dialog"
    aria-modal="true"
    aria-labelledby="reschedule-title"
  >
    <div class="bg-white rounded-lg p-6 shadow-xl w-full max-w-md">
      <h3 id="reschedule-title" class="text-lg font-semibold mb-2">Reschedule post</h3>
      <p class="text-sm text-gray-600 mb-4">
        <span class="font-medium">{rescheduleTarget.platform}</span> — {rescheduleTarget.source_signal}
      </p>
      <label class="block text-sm font-medium text-gray-700 mb-1" for="reschedule-date">
        New date
      </label>
      <input
        id="reschedule-date"
        type="date"
        bind:value={rescheduleDate}
        class="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <div class="flex justify-end gap-2 mt-4">
        <button
          onclick={() => (rescheduleTarget = null)}
          class="px-3 py-1.5 bg-gray-100 text-gray-800 rounded hover:bg-gray-200 text-sm"
        >
          Cancel
        </button>
        <button
          onclick={confirmReschedule}
          class="px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm font-medium"
        >
          Reschedule
        </button>
      </div>
    </div>
  </div>
{/if}

{#if toast}
  <ToastMessage message={toast.message} type={toast.type} onDismiss={() => (toast = null)} />
{/if}
