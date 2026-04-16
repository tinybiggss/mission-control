<script lang="ts">
  import type { AdaptedStatus } from '$lib/types';
  let { status }: { status: AdaptedStatus } = $props();

  const colors: Record<AdaptedStatus, string> = {
    'pending-approval': 'bg-yellow-100 text-yellow-800 border-yellow-300',
    'approved': 'bg-green-100 text-green-800 border-green-300',
    'rejected': 'bg-red-100 text-red-800 border-red-300',
    'scheduled': 'bg-blue-100 text-blue-800 border-blue-300',
    'published': 'bg-purple-100 text-purple-800 border-purple-300'
  };

  const labels: Record<AdaptedStatus, string> = {
    'pending-approval': 'Pending',
    'approved': 'Approved',
    'rejected': 'Rejected',
    'scheduled': 'Scheduled',
    'published': 'Published'
  };
</script>

<span class="inline-block px-2 py-0.5 text-xs font-medium rounded border {colors[status]}">
  {labels[status]}
</span>
