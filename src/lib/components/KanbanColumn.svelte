<script lang="ts">
  import KanbanCard, { type KanbanCardData } from './KanbanCard.svelte';
  import type { AdaptedStatus } from '$lib/types';

  let {
    title,
    status,
    cards,
    onDragStart,
    onDrop,
    accentClass
  }: {
    title: string;
    status: AdaptedStatus;
    cards: KanbanCardData[];
    onDragStart: (card: KanbanCardData) => void;
    onDrop: (targetStatus: AdaptedStatus) => void;
    accentClass: string;
  } = $props();

  let dragOver = $state(false);

  function handleDragOver(e: DragEvent) {
    // Must preventDefault to allow drop
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dragOver = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    onDrop(status);
  }
</script>

<div
  class="flex flex-col min-w-0 bg-gray-50 rounded-lg border border-gray-200"
  class:ring-2={dragOver}
  class:ring-indigo-400={dragOver}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  role="list"
  aria-label={title}
>
  <div class="flex items-center justify-between px-3 py-2 border-b border-gray-200 {accentClass}">
    <h2 class="font-semibold text-sm">{title}</h2>
    <span class="text-xs bg-white/70 rounded-full px-2 py-0.5">{cards.length}</span>
  </div>
  <div class="flex flex-col gap-2 p-2 min-h-[200px] overflow-y-auto">
    {#each cards as card (card.draftId + '/' + card.platform)}
      <KanbanCard {card} {onDragStart} />
    {/each}
    {#if cards.length === 0}
      <div class="text-center text-xs text-gray-400 py-6 border border-dashed border-gray-200 rounded">
        Empty
      </div>
    {/if}
  </div>
</div>
