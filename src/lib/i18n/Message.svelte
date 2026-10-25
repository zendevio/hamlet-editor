<script lang="ts" generics="K extends MessageKey">
	import type { Snippet } from 'svelte';
	import { richMessage, type MessageKey, type MessageParams } from './index.svelte.js';
	import type { RichPart } from './core.js';

	let { id, params, emphasis, code, link }: {
		id: K;
		params: MessageParams[K];
		emphasis: Snippet<[Snippet]>;
		code: Snippet<[Snippet]>;
		link: Snippet<[Snippet]>;
	} = $props();
	let parts = $derived(richMessage(id, params));
</script>

{#snippet renderParts(items: RichPart[])}
	{#each items as part}
		{#if typeof part === 'string'}
			{part}
		{:else}
			{#snippet children()}{@render renderParts(part.children)}{/snippet}
			{#if part.tag === 'emphasis'}
				{@render emphasis(children)}
			{:else if part.tag === 'code'}
				{@render code(children)}
			{:else if part.tag === 'link'}
				{@render link(children)}
			{/if}
		{/if}
	{/each}
{/snippet}

{@render renderParts(parts)}
