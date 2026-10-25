<script lang="ts">
	import { describeMessage, type MessageDescriptor } from './index.svelte.js';
	let { descriptor, detail }: { descriptor: MessageDescriptor; detail?: string } = $props();
</script>

<div role="alert" class="space-y-1">
	<p class="font-medium">{describeMessage(descriptor)}</p>
	{#if detail}<p class="break-all text-xs whitespace-pre-wrap">{detail}</p>{/if}
</div>
