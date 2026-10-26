<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.js';
	import { trinketName, gameTextLocale } from '#lib/save-labels.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { getTrinketIconPath } from '#lib/utils.js';
	import GameAssetIcon from '#lib/components/GameAssetIcon.svelte';

	let {
		id,
		type = 'trinket',
		gamePath,
		onremove
	}: {
		id: string;
		type?: string;
		gamePath?: string;
		onremove?: (id: string) => void;
	} = $props();

	let displayName = $derived(trinketName(id));
</script>

<Card.Root data-testid="estate-trinket-{id}" class="group relative p-2 gap-2">
	<div class="flex items-start justify-between gap-2">
		<div class="flex items-center gap-2 min-w-0">
			<!-- Trinket icon -->
			{#if gamePath}
				<GameAssetIcon
					{gamePath}
					relativePath={getTrinketIconPath(id)}
					alt={displayName}
					class="size-16 shrink-0 object-contain"
				>
					{#snippet fallback()}
						<div
							class="flex size-16 shrink-0 items-center justify-center rounded-sm bg-muted text-xs font-bold text-muted-foreground"
						>
							{t('estate.trinketInitial')}
						</div>
					{/snippet}
				</GameAssetIcon>
			{:else}
				<div
					class="flex size-16 shrink-0 items-center justify-center rounded-sm bg-muted text-xs font-bold text-muted-foreground"
				>
					{t('estate.trinketInitial')}
				</div>
			{/if}
			<div class="min-w-0">
				<p lang={gameTextLocale()} class="truncate text-sm font-medium" title={id}>{displayName}</p>
				<p class="truncate text-xs text-muted-foreground">{id}</p>
			</div>
		</div>
		<Button
			variant="ghost"
			size="icon-xs"
			class="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
			onclick={() => onremove?.(id)}
			title={t('estate.removeTrinket')}
			aria-label={t('estate.removeTrinketAction', { name: displayName })}
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
