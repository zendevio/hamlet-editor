<script lang="ts">
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
		BUILDING_DISPLAY_NAMES,
		ACTIVITY_DISPLAY_NAMES,
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

	let displayName = $derived(BUILDING_DISPLAY_NAMES[buildingName] ?? buildingName);
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
			? `${upgradeGroup.purchasedCount}/${upgradeGroup.totalCount}`
			: null
	);

	function handleRelease(hero: TreatmentHero) {
		releaseHeroFromTreatment(hero.guid);
	}

	function getActivityDisplayName(activity: string): string {
		return ACTIVITY_DISPLAY_NAMES[activity] ?? activity;
	}

	let treatmentSlots = $derived(
		isTreatmentBuilding ? getTreatmentSlots(buildingName as TreatmentBuildingName) : []
	);
</script>

<Card class="min-w-0">
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
						<CardTitle class="truncate text-base" title={displayName}>{displayName}</CardTitle>
					</div>
					<div class="flex min-w-0 flex-wrap items-center gap-2">
						{#if isTreatmentBuilding && treatmentHeroes.length > 0}
							<Badge variant="secondary">
								{treatmentHeroes.length} in treatment
							</Badge>
						{/if}
						{#if upgradeProgress}
							<Badge variant="outline">
								Upgrades: {upgradeProgress}
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
						<h4 class="text-sm font-medium text-muted-foreground">Activity Slots</h4>
						<div class="grid gap-2">
							{#each activities as activity (activity)}
								{#each treatmentSlots.filter((slot) => slot.activityType === activity) as slot (slot.slotIndex)}
									{@const hero = treatmentHeroes.find((hero) => hero.activityType === activity && hero.slotIndex === slot.slotIndex)}
									<div
										class="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded border px-3 py-2"
									>
										<div class="flex min-w-0 flex-1 flex-wrap items-center gap-3">
											<Badge variant="outline" class="h-auto min-h-5 max-w-full whitespace-normal break-words text-xs">
												{getActivityDisplayName(activity)} {Number(slot.slotIndex) + 1}
											</Badge>
											{#if hero}
												<div class="flex min-w-0 flex-wrap items-center gap-2">
													<UserCircleIcon
														size={18}
														class="shrink-0 text-muted-foreground"
													/>
													<span class="min-w-0 truncate text-sm font-medium" title={hero.name}>{hero.name}</span>
													<span class="min-w-0 truncate text-xs text-muted-foreground" title={hero.classDisplayName}>
														{hero.classDisplayName}
													</span>
												</div>
											{:else}
												<span class="text-sm text-muted-foreground italic">
													Empty
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
												Release
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
