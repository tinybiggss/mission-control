<script lang="ts">
  import type { FilterState } from '$lib/types';

  let {
    filter,
    platforms,
    pillars,
    scoreBounds,
    counts,
    onFilterChange
  }: {
    filter: FilterState;
    platforms: string[];
    pillars: string[];
    scoreBounds: { min: number; max: number };
    counts: { all: number; pending: number; approved: number; rejected: number };
    onFilterChange: (next: FilterState) => void;
  } = $props();

  function setStatus(status: FilterState['status']) {
    onFilterChange({ ...filter, status });
  }

  function setPlatform(event: Event) {
    onFilterChange({ ...filter, platform: (event.target as HTMLSelectElement).value });
  }

  function setPillar(event: Event) {
    onFilterChange({ ...filter, pillar: (event.target as HTMLSelectElement).value });
  }

  function setScoreMin(event: Event) {
    const raw = (event.target as HTMLInputElement).value;
    onFilterChange({ ...filter, scoreMin: raw === '' ? null : Number(raw) });
  }

  function setScoreMax(event: Event) {
    const raw = (event.target as HTMLInputElement).value;
    onFilterChange({ ...filter, scoreMax: raw === '' ? null : Number(raw) });
  }

  function clearScoreRange() {
    onFilterChange({ ...filter, scoreMin: null, scoreMax: null });
  }

  const hasActiveFilters = $derived(
    filter.pillar !== 'all' || filter.scoreMin !== null || filter.scoreMax !== null
  );

  const statusChips: Array<{ id: FilterState['status']; label: string; count: number }> = $derived([
    { id: 'all', label: 'All', count: counts.all },
    { id: 'pending-approval', label: 'Pending', count: counts.pending },
    { id: 'approved', label: 'Approved', count: counts.approved },
    { id: 'rejected', label: 'Rejected', count: counts.rejected }
  ]);

  const selectClass = 'border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-rt-green';
  const scoreInputClass = 'border border-gray-300 rounded px-2 py-1 text-sm w-16 focus:outline-none focus:ring-2 focus:ring-rt-green';
</script>

<div class="mb-6 p-4 bg-white border border-gray-200 rounded-lg space-y-3">
  <!-- Row 1: status chips -->
  <div class="flex flex-wrap items-center gap-2">
    {#each statusChips as chip (chip.id)}
      <button
        class="px-3 py-1.5 rounded text-sm font-medium transition {filter.status === chip.id
          ? 'bg-rt-green text-white'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}"
        onclick={() => setStatus(chip.id)}
      >
        {chip.label} <span class="ml-1 opacity-75">({chip.count})</span>
      </button>
    {/each}
  </div>

  <!-- Row 2: platform, pillar, score range -->
  <div class="flex flex-wrap items-center gap-4">
    <div class="flex items-center gap-2">
      <label for="platform-select" class="text-sm text-gray-600 shrink-0">Platform:</label>
      <select id="platform-select" class={selectClass} value={filter.platform} onchange={setPlatform}>
        <option value="all">All</option>
        {#each platforms as p (p)}
          <option value={p}>{p}</option>
        {/each}
      </select>
    </div>

    {#if pillars.length > 0}
      <div class="flex items-center gap-2">
        <label for="pillar-select" class="text-sm text-gray-600 shrink-0">Pillar:</label>
        <select id="pillar-select" class={selectClass} value={filter.pillar} onchange={setPillar}>
          <option value="all">All</option>
          {#each pillars as p (p)}
            <option value={p}>{p}</option>
          {/each}
        </select>
      </div>
    {/if}

    <div class="flex items-center gap-2">
      <span class="text-sm text-gray-600 shrink-0">Score:</span>
      <input
        type="number"
        min={scoreBounds.min}
        max={scoreBounds.max}
        step="0.1"
        placeholder={String(scoreBounds.min)}
        value={filter.scoreMin ?? ''}
        oninput={setScoreMin}
        class={scoreInputClass}
        aria-label="Minimum score"
      />
      <span class="text-sm text-gray-400">–</span>
      <input
        type="number"
        min={scoreBounds.min}
        max={scoreBounds.max}
        step="0.1"
        placeholder={String(scoreBounds.max)}
        value={filter.scoreMax ?? ''}
        oninput={setScoreMax}
        class={scoreInputClass}
        aria-label="Maximum score"
      />
    </div>

    {#if hasActiveFilters}
      <button
        onclick={() => onFilterChange({ ...filter, pillar: 'all', scoreMin: null, scoreMax: null })}
        class="text-xs text-gray-500 hover:text-gray-800 underline"
        aria-label="Clear pillar and score filters"
      >
        Clear filters
      </button>
    {/if}

    <!-- Score range visual indicator -->
    {#if scoreBounds.max > scoreBounds.min}
      {@const lo = filter.scoreMin ?? scoreBounds.min}
      {@const hi = filter.scoreMax ?? scoreBounds.max}
      {@const range = scoreBounds.max - scoreBounds.min || 1}
      {@const leftPct = ((lo - scoreBounds.min) / range) * 100}
      {@const widthPct = ((hi - lo) / range) * 100}
      <div class="flex items-center gap-2 ml-auto">
        <span class="text-xs text-gray-400">{scoreBounds.min}</span>
        <div class="relative w-28 h-2 bg-gray-200 rounded-full">
          <div
            class="absolute h-2 bg-rt-green rounded-full"
            style="left: {Math.max(0, leftPct)}%; width: {Math.max(0, Math.min(widthPct, 100 - leftPct))}%"
          ></div>
        </div>
        <span class="text-xs text-gray-400">{scoreBounds.max}</span>
      </div>
    {/if}
  </div>
</div>
