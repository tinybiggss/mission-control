<script lang="ts">
  let {
    initialContent,
    onSave,
    onCancel
  }: {
    initialContent: string;
    onSave: (newContent: string) => Promise<void>;
    onCancel: () => void;
  } = $props();

  let content = $state(initialContent);
  let saving = $state(false);
  let error = $state('');

  async function handleSave() {
    saving = true;
    error = '';
    try {
      await onSave(content);
    } catch (e) {
      error = (e as Error).message;
      saving = false;
    }
  }
</script>

<div class="space-y-2">
  <textarea
    class="w-full min-h-[200px] p-3 border border-gray-300 rounded font-mono text-sm focus:outline-none focus:ring-2 focus:ring-rt-green"
    bind:value={content}
    disabled={saving}
  ></textarea>
  {#if error}
    <p class="text-sm text-red-600">{error}</p>
  {/if}
  <div class="flex gap-2">
    <button
      class="px-4 py-2 bg-rt-green text-white rounded hover:bg-green-800 disabled:opacity-50"
      onclick={handleSave}
      disabled={saving}
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
    <button
      class="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
      onclick={onCancel}
      disabled={saving}
    >
      Cancel
    </button>
  </div>
</div>
