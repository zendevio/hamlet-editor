<script lang="ts">
	import ErrorMessage from './ErrorMessage.svelte';
	import { describeMessage, type MessageDescriptor } from './index.svelte.js';
	let { descriptor, detail, error, hasError = false }: { descriptor?: MessageDescriptor; detail?: string; error?: unknown; hasError?: boolean } = $props();
</script>

<div role="alert" class="space-y-1">
	{#if descriptor}<p class="font-medium">{describeMessage(descriptor)}</p>{/if}
	{#if hasError}<ErrorMessage {error} />{/if}
	{#if detail}<p class="break-all text-xs whitespace-pre-wrap select-text">{detail}</p>{/if}
</div>
