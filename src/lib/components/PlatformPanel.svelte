<script lang="ts">
  import type { AdaptedVersion, AdaptedStatus } from '$lib/types';
  import StatusBadge from './StatusBadge.svelte';
  import InlineEditor from './InlineEditor.svelte';

  let {
    version,
    onStatusChange,
    onContentChange
  }: {
    version: AdaptedVersion;
    onStatusChange: (draftId: string, platform: string, newStatus: AdaptedStatus) => Promise<void>;
    onContentChange: (draftId: string, platform: string, newBody: string) => Promise<void>;
  } = $props();

  let editing = $state(false);
  let busy = $state(false);

  async function doStatus(status: AdaptedStatus) {
    busy = true;
    try {
      await onStatusChange(version.draftId, version.platform, status);
    } finally {
      busy = false;
    }
  }

  async function doSaveContent(newBody: string) {
    await onContentChange(version.draftId, version.platform, newBody);
    editing = false;
  }

  const platformLabel = version.platform.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
</script>

<div class="border border-gray-200 rounded-lg p-4 bg-white">
  <div class="flex items-start justify-between gap-4 mb-3">
    <div>
      <h3 class="font-semibold text-lg">{platformLabel}</h3>
      <div class="text-xs text-gray-500 flex gap-3 mt-1">
        <span>{version.character_count} chars</span>
        {#if version.visual_required}
          <span>• Needs visual</span>
        {/if}
        {#if version.subreddit}
          <span>• r/{version.subreddit}</span>
        {/if}
      </div>
    </div>
    <StatusBadge status={version.status} />
  </div>

  {#if editing}
    <InlineEditor
      initialContent={version.body}
      onSave={doSaveContent}
      onCancel={() => (editing = false)}
    />
  {:else}
    <pre class="whitespace-pre-wrap text-sm bg-gray-50 p-3 rounded border border-gray-100 max-h-64 overflow-y-auto font-sans">{version.body}</pre>

    <div class="flex gap-2 mt-3">
      {#if version.status === 'pending-approval'}
        <button
          class="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
          onclick={() => doStatus('approved')}
          disabled={busy}
        >
          ✓ Approve
        </button>
        <button
          class="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
          onclick={() => doStatus('rejected')}
          disabled={busy}
        >
          ✕ Reject
        </button>
      {:else if version.status === 'approved' || version.status === 'rejected'}
        <button
          class="px-3 py-1.5 bg-gray-200 text-gray-800 rounded text-sm hover:bg-gray-300 disabled:opacity-50"
          onclick={() => doStatus('pending-approval')}
          disabled={busy}
        >
          ↺ Reset to Pending
        </button>
      {/if}

      <button
        class="px-3 py-1.5 bg-blue-100 text-blue-800 rounded text-sm hover:bg-blue-200"
        onclick={() => (editing = true)}
      >
        ✎ Edit
      </button>

      <button
        class="px-3 py-1.5 bg-gray-100 text-gray-800 rounded text-sm hover:bg-gray-200 ml-auto"
        disabled
        title="Phase 2d: Discord thread integration"
      >
        💬 Discuss
      </button>
    </div>
  {/if}
</div>
