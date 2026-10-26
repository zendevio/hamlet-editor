<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { t } from '#lib/i18n/index.svelte.js';
	import { formatNumber } from '#lib/i18n/intl.js';
	import { gameTextLocale } from '#lib/save-labels.js';

	let {
		position,
		heroName,
		heroClass
	}: {
		position: number;
		heroName: string | null;
		heroClass: string | null;
	} = $props();
</script>

<div
	class="flex flex-col items-center gap-2 rounded-sm border p-3 min-w-[120px]"
	role="group"
	aria-label={t('raid.partySlot', { position: formatNumber(position), name: heroName ?? t('raid.empty') })}
>
	<!-- Portrait placeholder -->
	<div
		class="flex h-14 w-14 items-center justify-center rounded-sm bg-muted text-muted-foreground"
	>
		{#if heroName}
			<span class="text-lg font-bold">{heroName.charAt(0).toUpperCase()}</span>
		{:else}
			<span class="text-xs">{t('raid.empty')}</span>
		{/if}
	</div>

	<!-- Hero info -->
	{#if heroName}
		<div class="flex flex-col items-center gap-0.5 text-center">
			<span class="text-sm font-semibold leading-tight">{heroName}</span>
			{#if heroClass}
				<span class="text-[11px] text-muted-foreground" lang={gameTextLocale()}>{heroClass}</span>
			{/if}
		</div>
	{:else}
		<span class="text-xs text-muted-foreground">{t('raid.noHero')}</span>
	{/if}

	<!-- Position badge -->
	<Badge variant="outline" class="text-[10px] font-normal">
		{t('raid.position', { position: formatNumber(position) })}
	</Badge>
</div>
