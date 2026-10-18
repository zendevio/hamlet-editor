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

	function getHeroForActivity(activity: string): TreatmentHero | undefined {
		// Match heroes to activities based on order (simplified; real data uses town slots)
		const idx = activities.indexOf(activity);
		return idx >= 0 && idx < treatmentHeroes.length ? treatmentHeroes[idx] : undefined;
	}
</script>

<Card>
	<Collapsible bind:open={isOpen}>
		<CollapsibleTrigger class="w-full text-left">
			<CardHeader class="cursor-pointer select-none">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						{#if isOpen}
							<CaretDownIcon size={16} class="text-muted-foreground" />
						{:else}
							<CaretRightIcon size={16} class="text-muted-foreground" />
						{/if}
						<CardTitle class="text-base">{displayName}</CardTitle>
					</div>
					<div class="flex items-center gap-2">
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
			<CardContent class="space-y-4">
				<!-- Treatment Slots -->
				{#if isTreatmentBuilding}
					<div class="space-y-2">
						<h4 class="text-sm font-medium text-muted-foreground">Activity Slots</h4>
						<div class="grid gap-2">
							{#each activities as activity (activity)}
								{@const hero = getHeroForActivity(activity)}
								<div
									class="flex items-center justify-between rounded border px-3 py-2"
								>
									<div class="flex items-center gap-3">
										<Badge variant="outline" class="text-xs">
											{getActivityDisplayName(activity)}
										</Badge>
										{#if hero}
											<div class="flex items-center gap-2">
												<UserCircleIcon
													size={18}
													class="text-muted-foreground"
												/>
												<span class="text-sm font-medium">{hero.name}</span>
												<span class="text-xs text-muted-foreground">
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
											class="h-7 gap-1 text-xs"
											onclick={() => handleRelease(hero)}
										>
											<SignOutIcon size={14} />
											Release
										</Button>
									{/if}
								</div>
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
