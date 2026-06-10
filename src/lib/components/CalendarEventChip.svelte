<script lang="ts" module>
  export interface CalendarEventData {
    draftId: string;
    platform: string;
    status: 'scheduled' | 'published';
    scheduled_date: string;
    source_signal: string;
    pillar: string;
    character_count: number;
  }
</script>

<script lang="ts">
  interface Props {
    event: CalendarEventData;
    compact?: boolean;
    onDragStart?: (e: CalendarEventData) => void;
    onClick?: (e: CalendarEventData) => void;
  }

  let { event, compact = false, onDragStart, onClick }: Props = $props();

  const platformStyle: Record<string, string> = {
    linkedin: 'bg-blue-100 text-blue-800 border-blue-300',
    'x-twitter': 'bg-gray-900 text-white border-gray-900',
    x: 'bg-gray-900 text-white border-gray-900',
    bluesky: 'bg-sky-100 text-sky-800 border-sky-300',
    threads: 'bg-purple-100 text-purple-800 border-purple-300',
    reddit: 'bg-orange-100 text-orange-800 border-orange-300',
    substack: 'bg-amber-100 text-amber-800 border-amber-300'
  };

  const cls = $derived(platformStyle[event.platform] ?? 'bg-gray-100 text-gray-800 border-gray-300');

  function handleDragStart(e: DragEvent) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(
      'application/x-corvus-event',
      JSON.stringify({ draftId: event.draftId, platform: event.platform })
    );
    onDragStart?.(event);
  }
</script>

<button
  type="button"
  draggable="true"
  ondragstart={handleDragStart}
  onclick={() => onClick?.(event)}
  class="w-full text-left border rounded px-1.5 py-0.5 truncate cursor-grab active:cursor-grabbing hover:ring-2 hover:ring-offset-1 hover:ring-indigo-400 {cls} {event.status === 'published' ? 'opacity-60' : ''}"
  class:text-xs={compact}
  class:text-sm={!compact}
  title="{event.platform} — {event.source_signal}"
>
  <span class="font-medium uppercase tracking-wide">{event.platform}</span>
  {#if !compact}
    <span class="ml-1 opacity-80">— {event.source_signal}</span>
  {/if}
</button>
