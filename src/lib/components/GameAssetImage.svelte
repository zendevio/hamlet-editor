<script lang="ts">
	import { loadGameAsset } from '$lib/api/assets';
	import { Skeleton } from '$lib/components/ui/skeleton';

	interface Props {
		gamePath: string;
		relativePath: string;
		alt?: string;
		class?: string;
	}

	let { gamePath, relativePath, alt = '', class: className = '' }: Props = $props();

	// Module-level URL cache shared across all instances.
	const urlCache = new Map<string, string>();

	type LoadState = 'loading' | 'loaded' | 'error';

	let src = $state('');
	let loadState = $state<LoadState>('loading');

	async function loadAsset(path: string, relative: string): Promise<void> {
		const cacheKey = `${path}::${relative}`;
		const cached = urlCache.get(cacheKey);

		if (cached !== undefined) {
			src = cached;
			loadState = cached ? 'loaded' : 'error';
			return;
		}

		loadState = 'loading';
		const url = await loadGameAsset(path, relative);
		urlCache.set(cacheKey, url);
		src = url;
		loadState = url ? 'loaded' : 'error';
	}

	$effect(() => {
		loadAsset(gamePath, relativePath);
	});
</script>

{#if loadState === 'loading'}
	<Skeleton class={className} />
{:else if loadState === 'loaded'}
	<img {src} {alt} class={className} />
{:else}
	<!-- Placeholder shown when the asset is missing or load failed -->
	<div
		class="bg-muted flex items-center justify-center {className}"
		role="img"
		aria-label={alt || 'Image unavailable'}
	>
		<span class="text-muted-foreground text-xs select-none">?</span>
	</div>
{/if}
