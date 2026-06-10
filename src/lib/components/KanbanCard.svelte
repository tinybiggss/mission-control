<script lang="ts">
  import type { AdaptedStatus } from '$lib/types';

  export interface KanbanCardData {
    draftId: string;
    platform: string;
    status: AdaptedStatus;
    scheduled_date: string;
    character_count: number;
    source_signal: string;
    pillar: string;
    source_score: number;
  }

  let {
    card,
    onDragStart
  }: {
    card: KanbanCardData;
    onDragStart: (card: KanbanCardData) => void;
  } = $props();

  const platformLabel = $derived(card.platform.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));

  function handleDragStart(e: DragEvent) {
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `${card.draftId}/${card.platform}`);
    }
    onDragStart(card);
  }
</script>

<div
  class="bg-white border border-gray-200 rounded-md p-3 shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing"
  draggable="true"
  ondragstart={handleDragStart}
  data-card-id="{card.draftId}/{card.platform}"
  role="listitem"
  aria-label="{platformLabel}: {card.source_signal}"
>
  <div class="text-xs font-medium text-gray-500 uppercase tracking-wide">{platformLabel}</div>
  <div class="font-semibold text-sm text-gray-900 mt-1 leading-snug line-clamp-3">
    {card.source_signal}
  </div>
  <div class="flex items-center gap-2 mt-2 text-xs text-gray-500 flex-wrap">
    <span class="px-1.5 py-0.5 bg-gray-100 rounded">{card.pillar}</span>
    <span>• {card.character_count} chars</span>
    {#if card.scheduled_date}
      <span class="text-indigo-700 font-medium">• 📅 {card.scheduled_date}</span>
    {/if}
  </div>
</div>
