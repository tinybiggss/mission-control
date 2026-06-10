<script lang="ts">
  import '../app.css';
  import favicon from '$lib/assets/favicon.svg';
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';

  let { children } = $props();

  const navItems = [
    { href: '/', label: 'Queue' },
    { href: '/kanban', label: 'Kanban' },
    { href: '/calendar', label: 'Calendar' },
    { href: '/schedule', label: 'Cadence' }
  ];

  let scheduling = $state(false);
  let publishing = $state(false);
  let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);

  function showToast(message: string, type: 'success' | 'error') {
    toast = { message, type };
    setTimeout(() => (toast = null), 4000);
  }

  async function runScheduler() {
    scheduling = true;
    try {
      const res = await fetch('/api/schedule/run', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.message || 'Scheduler failed', 'error'); return; }
      const n = (data.scheduled ?? []).length;
      showToast(n > 0 ? `Scheduled ${n} post${n === 1 ? '' : 's'}` : 'Nothing new to schedule', 'success');
      await invalidateAll();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      scheduling = false;
    }
  }

  async function runPublisher() {
    publishing = true;
    try {
      const res = await fetch('/api/publish/run', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.message || 'Publisher failed', 'error'); return; }
      const ok = (data.published ?? []).length;
      const fail = (data.failed ?? []).length;
      const skip = (data.skipped ?? []).length;
      if (ok === 0 && fail === 0) {
        showToast(skip > 0 ? `Nothing to publish today (${skip} platform${skip === 1 ? '' : 's'} not yet supported)` : 'Nothing scheduled for today', 'success');
      } else {
        const parts = [];
        if (ok > 0) parts.push(`Published ${ok}`);
        if (fail > 0) parts.push(`${fail} failed`);
        showToast(parts.join(' · '), fail > 0 ? 'error' : 'success');
      }
      await invalidateAll();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      publishing = false;
    }
  }

  const btnClass = 'px-3 py-1.5 rounded text-sm font-medium bg-white/15 hover:bg-white/25 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-1.5';
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen">
  <header class="bg-rt-green text-white px-6 py-4">
    <div class="flex items-center gap-6 flex-wrap">
      <div>
        <h1 class="text-xl font-semibold">Corvus Dashboard</h1>
        <p class="text-sm opacity-80">Content pipeline control</p>
      </div>
      <nav class="flex gap-1">
        {#each navItems as item (item.href)}
          {@const active = page.url.pathname === item.href}
          <a
            href={item.href}
            class="px-3 py-1.5 rounded text-sm font-medium {active ? 'bg-white/20' : 'hover:bg-white/10'}"
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </a>
        {/each}
      </nav>
      <div class="ml-auto flex items-center gap-2">
        <button onclick={runScheduler} disabled={scheduling || publishing} class={btnClass} aria-label="Run content scheduler">
          {#if scheduling}
            <span class="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
            Scheduling…
          {:else}
            ⟳ Schedule Now
          {/if}
        </button>
        <button onclick={runPublisher} disabled={publishing || scheduling} class={btnClass} aria-label="Publish today's scheduled posts">
          {#if publishing}
            <span class="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
            Publishing…
          {:else}
            ↑ Publish Now
          {/if}
        </button>
      </div>
    </div>
  </header>

  {#if toast}
    <div
      class="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium {toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}"
      role="status"
    >
      {toast.message}
    </div>
  {/if}

  <main class="p-6 max-w-7xl mx-auto">
    {@render children()}
  </main>
</div>
