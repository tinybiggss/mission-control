<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // Local editable copy of the summaries
  let rows = $state(
    data.summaries.map((s) => ({
      platform: s.platform,
      minGapDays: s.minGapDays,
      maxLookaheadDays: s.maxLookaheadDays,
      scheduledCount: s.scheduledCount,
      nextAvailableSlot: s.nextAvailableSlot
    }))
  );

  let dirty = $derived(
    rows.some(
      (r, i) =>
        r.minGapDays !== data.summaries[i].minGapDays ||
        r.maxLookaheadDays !== data.summaries[i].maxLookaheadDays
    )
  );

  // Build config JSON from editable rows for the hidden form field
  const configJson = $derived(
    JSON.stringify(
      Object.fromEntries(
        rows.map((r) => [
          r.platform,
          { minGapDays: r.minGapDays, maxLookaheadDays: r.maxLookaheadDays }
        ])
      )
    )
  );

  const platformLabels: Record<string, string> = {
    linkedin: 'LinkedIn',
    'x-twitter': 'X / Twitter',
    bluesky: 'Bluesky',
    'substack-notes': 'Substack Notes',
    threads: 'Threads'
  };

  function label(platform: string): string {
    return platformLabels[platform] ?? platform;
  }
</script>

<svelte:head>
  <title>Corvus Dashboard — Schedule Cadence</title>
</svelte:head>

<div class="flex items-center justify-between mb-6">
  <h2 class="text-lg font-semibold">Schedule Cadence</h2>
</div>

{#if form?.saved}
  <div
    class="mb-4 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm"
    role="status"
  >
    Settings saved.
  </div>
{/if}
{#if form?.error}
  <div
    class="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm"
    role="alert"
  >
    {form.error}
  </div>
{/if}

<form method="POST" action="?/save" use:enhance>
  <input type="hidden" name="config" value={configJson} />

  <div class="overflow-x-auto">
    <table class="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
      <thead class="bg-gray-50">
        <tr>
          <th class="text-left px-4 py-3 font-medium text-gray-600">Platform</th>
          <th class="text-center px-4 py-3 font-medium text-gray-600">Min Gap (days)</th>
          <th class="text-center px-4 py-3 font-medium text-gray-600">Lookahead (days)</th>
          <th class="text-center px-4 py-3 font-medium text-gray-600">Scheduled</th>
          <th class="text-left px-4 py-3 font-medium text-gray-600">Next Slot</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row, i (row.platform)}
          <tr class="border-t border-gray-100 hover:bg-gray-50/50">
            <td class="px-4 py-3 font-medium">{label(row.platform)}</td>
            <td class="px-4 py-3 text-center">
              <input
                type="number"
                min="1"
                max="90"
                bind:value={row.minGapDays}
                class="w-20 px-2 py-1 border border-gray-300 rounded text-center text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </td>
            <td class="px-4 py-3 text-center">
              <input
                type="number"
                min="1"
                max="365"
                bind:value={row.maxLookaheadDays}
                class="w-20 px-2 py-1 border border-gray-300 rounded text-center text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </td>
            <td class="px-4 py-3 text-center">
              <span
                class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {row.scheduledCount > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}"
              >
                {row.scheduledCount}
              </span>
            </td>
            <td class="px-4 py-3 text-sm text-gray-600">
              {row.nextAvailableSlot ?? 'No slot available'}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="mt-4 flex justify-end">
    <button
      type="submit"
      disabled={!dirty}
      class="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
    >
      Save Changes
    </button>
  </div>
</form>
