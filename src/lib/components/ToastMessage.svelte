<script lang="ts">
  let {
    message,
    type = 'info',
    onDismiss
  }: {
    message: string;
    type?: 'info' | 'success' | 'error';
    onDismiss: () => void;
  } = $props();

  const styles = {
    info: 'bg-blue-600 text-white',
    success: 'bg-green-600 text-white',
    error: 'bg-red-600 text-white'
  };
</script>

<div class="fixed top-4 right-4 px-4 py-3 rounded shadow-lg z-50 {styles[type]}">
  <div class="flex items-center gap-3">
    <span>{message}</span>
    <button class="text-white/80 hover:text-white" onclick={onDismiss}>✕</button>
  </div>
</div>
