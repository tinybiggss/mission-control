<script lang="ts">
  import CalendarEventChip, { type CalendarEventData } from './CalendarEventChip.svelte';

  interface Props {
    dateIso: string;
    events: CalendarEventData[];
    inMonth?: boolean;
    isToday?: boolean;
    compact?: boolean;
    onDrop?: (dateIso: string) => void;
    onEventDragStart?: (e: CalendarEventData) => void;
    onEventClick?: (e: CalendarEventData) => void;
  }

  let {
    dateIso,
    events,
    inMonth = true,
    isToday = false,
    compact = false,
    onDrop,
    onEventDragStart,
    onEventClick
  }: Props = $props();

  let dragOver = $state(false);

  function handleDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('application/x-corvus-event')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dragOver = true;
    }
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    onDrop?.(dateIso);
  }

  const dayNum = $derived(Number(dateIso.slice(8, 10)));
</script>

<div
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  role="gridcell"
  tabindex="-1"
  aria-label={dateIso}
  class="border border-gray-200 rounded p-1 flex flex-col gap-1 min-h-0 transition-colors {inMonth
    ? 'bg-white'
    : 'bg-gray-50'} {dragOver ? 'ring-2 ring-indigo-400 bg-indigo-50' : ''}"
  class:h-28={!compact}
  class:h-full={compact}
>
  <div class="flex items-center justify-between shrink-0">
    <span
      class="text-xs font-medium {isToday
        ? 'inline-flex items-center justify-center bg-indigo-600 text-white rounded-full w-5 h-5'
        : inMonth
          ? 'text-gray-700'
          : 'text-gray-400'}"
    >
      {dayNum}
    </span>
    {#if events.length > 0}
      <span class="text-[10px] text-gray-500">{events.length}</span>
    {/if}
  </div>
  <div class="flex flex-col gap-0.5 overflow-y-auto min-h-0">
    {#each events as event (event.draftId + '/' + event.platform)}
      <CalendarEventChip
        {event}
        compact={true}
        onDragStart={onEventDragStart}
        onClick={onEventClick}
      />
    {/each}
  </div>
</div>
