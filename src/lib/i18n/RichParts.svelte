<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { RichPart } from './core.js';
	let { parts, emphasis, code, link }: {
		parts: RichPart[];
		emphasis: Snippet<[Snippet]>;
		code: Snippet<[Snippet]>;
		link: Snippet<[Snippet]>;
	} = $props();
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
