<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import XIcon from 'phosphor-svelte/lib/XIcon';

	let {
		id,
		type = 'trinket',
		onremove
	}: {
		id: string;
		type?: string;
		onremove?: (id: string) => void;
	} = $props();

	/** Format raw trinket ID into a readable display name. */
	let displayName = $derived(
		id
			.replace(/_/g, ' ')
			.replace(/\b\w/g, (c) => c.toUpperCase())
	);
</script>

<Card.Root class="group relative p-3 gap-2">
	<div class="flex items-start justify-between gap-2">
		<div class="flex items-center gap-2 min-w-0">
			<!-- Placeholder trinket icon -->
			<div
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-muted text-xs font-bold text-muted-foreground"
			>
				T
			</div>
			<div class="min-w-0">
				<p class="truncate text-sm font-medium" title={id}>{displayName}</p>
				<p class="text-xs text-muted-foreground">{id}</p>
			</div>
		</div>
		<Button
			variant="ghost"
			size="icon-xs"
			class="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
			onclick={() => onremove?.(id)}
			title="Remove trinket"
		>
			<XIcon size={14} />
		</Button>
	</div>
	{#if type && type !== 'trinket'}
		<div class="px-0">
			<Badge variant="outline" class="text-[10px]">{type}</Badge>
		</div>
	{/if}
</Card.Root>
