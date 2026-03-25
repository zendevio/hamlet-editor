<script lang="ts">
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';

	let {
		status = 'Loading...'
	}: {
		status?: string;
	} = $props();
</script>

<!-- Full-screen semi-transparent overlay with centered spinner and status text -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
	role="status"
	aria-live="polite"
	aria-label={status}
>
	<div class="flex flex-col items-center gap-3">
		<CircleNotchIcon size={32} class="animate-spin text-muted-foreground" />
		<p class="text-sm text-muted-foreground">{status}</p>
	</div>
</div>
