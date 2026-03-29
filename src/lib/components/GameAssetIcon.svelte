<script lang="ts">
	import { loadGameAsset } from '$lib/api/assets';
	import type { Snippet } from 'svelte';

	interface Props {
		gamePath: string;
		relativePath: string;
		alt?: string;
		class?: string;
		fallback: Snippet;
	}

	let { gamePath, relativePath, alt = '', class: className = '', fallback }: Props = $props();

	const urlCache = new Map<string, string>();

	let src = $state('');
	let loaded = $state(false);

	async function loadAsset(path: string, relative: string): Promise<void> {
		const cacheKey = `${path}::${relative}`;
		const cached = urlCache.get(cacheKey);

		if (cached !== undefined) {
			src = cached;
			loaded = !!cached;
			return;
		}

		loaded = false;
		const url = await loadGameAsset(path, relative);
		urlCache.set(cacheKey, url);
		src = url;
		loaded = !!url;
	}

	$effect(() => {
		loadAsset(gamePath, relativePath);
	});
</script>

{#if loaded}
	<img {src} {alt} class={className} />
{:else}
	{@render fallback()}
{/if}
