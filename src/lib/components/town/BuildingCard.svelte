<script lang="ts">
	import { heroClassName, gameTextLocale, buildingDisplayName, activityDisplayName } from '#lib/save-labels.js';

	import Message from '#lib/i18n/Message.svelte';
	import { t } from '#lib/i18n/index.svelte.js';
	import { formatNumber } from '#lib/i18n/intl.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import {
		Card,
		CardContent,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.js';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '#lib/components/ui/collapsible/index.js';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import UserCircleIcon from 'phosphor-svelte/lib/UserCircleIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import {
		BUILDING_ACTIVITIES,
		TREATMENT_BUILDINGS,
		type TreatmentBuildingName,
		type TreatmentHero,
		type BuildingUpgradeGroup,
		getTreatmentSlots,
		releaseHeroFromTreatment
	} from '#lib/stores/save-data.svelte.js';
	import UpgradeTree from './UpgradeTree.svelte';

	let {
		buildingName,
		upgradeGroup,
		treatmentHeroes = []
	}: {
		buildingName: string;
		upgradeGroup: BuildingUpgradeGroup | null;
		treatmentHeroes?: TreatmentHero[];
	} = $props();

	let isOpen = $state(false);

	let displayName = $derived(buildingDisplayName(buildingName));
	let isTreatmentBuilding = $derived(
		TREATMENT_BUILDINGS.includes(buildingName as TreatmentBuildingName)
	);
	let activities = $derived(
		isTreatmentBuilding
			? BUILDING_ACTIVITIES[buildingName as TreatmentBuildingName]
			: []
	);
	let upgradeProgress = $derived(
		upgradeGroup
			? t('town.upgradeProgress', { purchasedText: formatNumber(upgradeGroup.purchasedCount), totalText: formatNumber(upgradeGroup.totalCount) })
			: null
	);

	function handleRelease(hero: TreatmentHero) {
		releaseHeroFromTreatment(hero.guid);
	}

	let treatmentSlots = $derived(
		isTreatmentBuilding ? getTreatmentSlots(buildingName as TreatmentBuildingName) : []
	);
</script>

<Card data-testid="building-{buildingName}" class="min-w-0">
	<Collapsible class="min-w-0" bind:open={isOpen}>
		<CollapsibleTrigger class="min-w-0 w-full text-left">
			<CardHeader class="cursor-pointer select-none">
				<div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
					<div class="flex min-w-0 items-center gap-2">
						{#if isOpen}
							<CaretDownIcon size={16} class="shrink-0 text-muted-foreground" />
						{:else}
							<CaretRightIcon size={16} class="shrink-0 text-muted-foreground" />
						{/if}
						<CardTitle lang={gameTextLocale()} class="truncate text-base" title={displayName}>{displayName}</CardTitle>
					</div>
					<div class="flex min-w-0 flex-wrap items-center gap-2">
						{#if isTreatmentBuilding && treatmentHeroes.length > 0}
							<Badge variant="secondary">
								{t('town.inTreatment', { count: treatmentHeroes.length, countText: formatNumber(treatmentHeroes.length) })}
							</Badge>
						{/if}
						{#if upgradeProgress}
							<Badge variant="outline">
								{upgradeProgress}
							</Badge>
						{/if}
					</div>
				</div>
			</CardHeader>
		</CollapsibleTrigger>

		<CollapsibleContent>
			<CardContent class="min-w-0 space-y-4">
				<!-- Treatment Slots -->
				{#if isTreatmentBuilding}
					<div class="space-y-2">
						<h4 class="text-sm font-medium text-muted-foreground">{t('town.activitySlots')}</h4>
						<div class="grid gap-2">
							{#each activities as activity (activity)}
								{#each treatmentSlots.filter((slot) => slot.activityType === activity) as slot (slot.slotIndex)}
									{@const hero = treatmentHeroes.find((hero) => hero.activityType === activity && hero.slotIndex === slot.slotIndex)}
									<div
										class="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded border px-3 py-2"
									>
										<!-- An 8rem minimum moves a long Release label to its own line instead of squeezing
										     the slot label; overflow-wrap:anywhere breaks one long game word inside the badge. -->
										<div class="flex min-w-32 flex-1 flex-wrap items-center gap-3">
											<Badge variant="outline" class="h-auto min-h-5 max-w-full whitespace-normal text-xs [overflow-wrap:anywhere]">
												<Message id="town.activitySlot" params={{ name: activityDisplayName(activity), slotText: formatNumber(Number(slot.slotIndex) + 1) }}>
													{#snippet code(children)}{@render children()}{/snippet}
													{#snippet link(children)}{@render children()}{/snippet}
													{#snippet emphasis(children)}<span lang={gameTextLocale()}>{@render children()}</span>{/snippet}
												</Message>
											</Badge>
											{#if hero}
												<div class="flex min-w-0 flex-wrap items-center gap-2">
													<UserCircleIcon
														size={18}
														class="shrink-0 text-muted-foreground"
													/>
													<span class="min-w-0 truncate text-sm font-medium" title={hero.name}>{hero.name}</span>
													<span lang={gameTextLocale()} class="min-w-0 truncate text-xs text-muted-foreground" title={heroClassName(hero.heroClass)}>
														{heroClassName(hero.heroClass)}
													</span>
												</div>
											{:else}
												<span class="text-sm text-muted-foreground italic">
													{t('town.emptySlot')}
												</span>
											{/if}
										</div>
										{#if hero}
											<Button
												variant="ghost"
												size="sm"
												class="h-7 shrink-0 gap-1 text-xs"
												onclick={() => handleRelease(hero)}
											>
												<SignOutIcon size={14} />
												{t('town.release')}
											</Button>
										{/if}
									</div>
								{/each}
							{/each}
						</div>
					</div>
				{/if}

				<!-- Upgrade Tree -->
				{#if upgradeGroup}
					<UpgradeTree group={upgradeGroup} />
				{/if}
			</CardContent>
		</CollapsibleContent>
	</Collapsible>
</Card>
