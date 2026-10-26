<script lang="ts">
	import { mergeProps } from 'bits-ui';
	import { t } from '#lib/i18n/index.svelte.js';
	import { formatNumber } from '#lib/i18n/intl.js';
	import ResolveLabel from './ResolveLabel.svelte';
	import { parseInteger } from '#lib/input-validation.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '#lib/components/ui/select/index.js';
	import { Tooltip, TooltipContent, TooltipTrigger } from '#lib/components/ui/tooltip/index.js';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import BrainIcon from 'phosphor-svelte/lib/BrainIcon';
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import RevivalWizard from './RevivalWizard.svelte';
	import type { HeroSummary } from '#lib/stores/save-data.svelte.js';
	import {
		healHeroToMax,
		setHeroStress,
		setHeroLevel
	} from '#lib/stores/save-data.svelte.js';

	let {
		selectedHeroes,
		totalCount
	}: {
		selectedHeroes: HeroSummary[];
		totalCount: number;
	} = $props();

	let revivalOpen = $state(false);

	let allDead = $derived(
		selectedHeroes.length > 0 && selectedHeroes.every((h) => h.status === 3)
	);

	function handleHealAll() {
		for (const hero of selectedHeroes) {
			if (hero.status !== 3) {
				healHeroToMax(hero.guid);
			}
		}
	}

	function handleClearStress() {
		for (const hero of selectedHeroes) {
			setHeroStress(hero.guid, 0);
		}
	}

	function handleSetLevel(value: string) {
		const parsed = parseInteger(value, 0, 6);
		if (parsed.error !== undefined) return;
		const level = parsed.value;
		for (const hero of selectedHeroes) {
			setHeroLevel(hero.guid, level);
		}
	}

</script>

<!-- Wraps so every batch action stays reachable in a narrow window or a longer language. -->
<div class="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
	<span class="text-muted-foreground shrink-0 text-[11px] font-medium">
		{t('heroes.selected', { countText: formatNumber(selectedHeroes.length), totalText: formatNumber(totalCount) })}
	</span>

	{#if selectedHeroes.length > 0}
		<!-- Stretch to the separator's own flex line: the built-in h-full would take
		     the whole wrapped toolbar height and push the second line out of the toolbar. -->
		<Separator orientation="vertical" class="mx-1 self-stretch data-[orientation=vertical]:h-auto" />

		<!-- Heal All -->
		<Tooltip>
			<TooltipTrigger>
				{#snippet child({ props })}
					<Button {...mergeProps(props, { onclick: handleHealAll })} variant="outline" size="sm" class="h-7 gap-1.5 text-[11px]">
						<HeartIcon size={12} class="text-red-500" />
						{t('heroes.healAll')}
					</Button>
				{/snippet}
			</TooltipTrigger>
			<TooltipContent>{t('heroes.healAllHelp')}</TooltipContent>
		</Tooltip>

		<!-- Clear Stress -->
		<Tooltip>
			<TooltipTrigger>
				{#snippet child({ props })}
					<Button {...mergeProps(props, { onclick: handleClearStress })}
						variant="outline"
						size="sm"
						class="h-7 gap-1.5 text-[11px]"
					>
						<BrainIcon size={12} class="text-yellow-500" />
						{t('heroes.clearStress')}
					</Button>
				{/snippet}
			</TooltipTrigger>
			<TooltipContent>{t('heroes.clearStressHelp')}</TooltipContent>
		</Tooltip>

		<!-- Set Level -->
		<Select type="single" onValueChange={handleSetLevel}>
			<SelectTrigger class="h-7 w-30 text-[11px]">
				<div class="flex items-center gap-1">
					<ArrowUpIcon size={12} />
					<span>{t('heroes.setLevel')}</span>
				</div>
			</SelectTrigger>
			<SelectContent>
				{#each Array(7) as _, i}
					<SelectItem value={String(i)}>
						<ResolveLabel level={i} />
					</SelectItem>
				{/each}
			</SelectContent>
		</Select>

		<!-- Revive (only if all selected are dead) -->
		{#if allDead}
			<Tooltip>
				<TooltipTrigger>
					{#snippet child({ props })}
						<Button {...mergeProps(props, { onclick: () => (revivalOpen = true) })}
							variant="outline"
							size="sm"
							class="h-7 gap-1.5 text-[11px]"
						>
							<HeartIcon size={12} class="text-green-500" />
							{t('heroes.revive')}
						</Button>
					{/snippet}
				</TooltipTrigger>
				<TooltipContent>{t('heroes.reviveHelp')}</TooltipContent>
			</Tooltip>
		{/if}
	{/if}
</div>

<RevivalWizard heroes={selectedHeroes} bind:open={revivalOpen} />
