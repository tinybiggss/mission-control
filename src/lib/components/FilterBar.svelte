<script lang="ts">
  import type { FilterState } from '$lib/types';

  let {
    filter,
    platforms,
    counts,
    onFilterChange
  }: {
    filter: FilterState;
    platforms: string[];
    counts: { all: number; pending: number; approved: number; rejected: number };
    onFilterChange: (next: FilterState) => void;
  } = $props();

  function setStatus(status: FilterState['status']) {
    onFilterChange({ ...filter, status });
  }

  function setPlatform(event: Event) {
    const target = event.target as HTMLSelectElement;
    onFilterChange({ ...filter, platform: target.value });
  }

  const statusChips: Array<{ id: FilterState['status']; label: string; count: number }> = $derived([
    { id: 'all', label: 'All', count: counts.all },
    { id: 'pending-approval', label: 'Pending', count: counts.pending },
    { id: 'approved', label: 'Approved', count: counts.approved },
    { id: 'rejected', label: 'Rejected', count: counts.rejected }
  ]);
</script>

<div class="flex flex-wrap items-center gap-3 mb-6 p-4 bg-white border border-gray-200 rounded-lg">
  <div class="flex gap-2">
    {#each statusChips as chip (chip.id)}
      <button
        class="px-3 py-1.5 rounded text-sm font-medium transition {filter.status === chip.id ? 'bg-rt-green text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}"
        onclick={() => setStatus(chip.id)}
      >
        {chip.label} <span class="ml-1 opacity-75">({chip.count})</span>
      </button>
    {/each}
  </div>

  <div class="ml-auto flex items-center gap-2">
    <label for="platform-select" class="text-sm text-gray-600">Platform:</label>
    <select
      id="platform-select"
      class="border border-gray-300 rounded px-2 py-1 text-sm"
      value={filter.platform}
      onchange={setPlatform}
    >
      <option value="all">All platforms</option>
      {#each platforms as p (p)}
        <option value={p}>{p}</option>
      {/each}
    </select>
  </div>
</div>
