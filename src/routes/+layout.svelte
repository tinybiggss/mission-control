<script lang="ts">
  import '../app.css';
  import favicon from '$lib/assets/favicon.svg';

  let { children } = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen">
  <header class="bg-rt-green text-white px-6 py-4">
    <h1 class="text-xl font-semibold">Corvus Dashboard</h1>
    <p class="text-sm opacity-80">Content approval queue</p>
  </header>
  <main class="p-6 max-w-7xl mx-auto">
    {@render children()}
  </main>
</div>
