<script lang="ts">
	import { describeMessage, type MessageDescriptor } from '#lib/i18n/index.svelte.js';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';

	let {
		status = { id: 'common.loading' }
	}: {
		status?: MessageDescriptor;
	} = $props();
</script>

<!-- Full-screen semi-transparent overlay with centered spinner and status text.
     data-slot marks it as the blocking overlay for the H1 overflow detector. -->
<div
	data-slot="loading-overlay"
	class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
	role="status"
	aria-live="polite"
	aria-label={describeMessage(status)}
>
	<div class="flex flex-col items-center gap-3">
		<CircleNotchIcon size={32} class="animate-spin text-muted-foreground" />
		<p class="text-sm text-muted-foreground">{describeMessage(status)}</p>
	</div>
</div>
