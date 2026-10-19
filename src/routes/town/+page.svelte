<script lang="ts">
	import { readDistricts } from '#lib/districts.js';
	import { snakeToTitle } from '#lib/utils.js';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import BuildingCard from '#lib/components/town/BuildingCard.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import {
		Card,
		CardContent
	} from '#lib/components/ui/card/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import {
		getSaveData,
		loadMockData,
		getHeroesInBuilding,
		getBuildingUpgrades,
		getUnknownUpgrades,
		setDistrictBuilt,
		TREATMENT_BUILDINGS,
		DISTRICT_DISPLAY_NAMES,
		type BuildingUpgradeGroup
	} from '#lib/stores/save-data.svelte.js';

	const saveData = getSaveData();

	// Derive building upgrade groups
	let upgradeGroups = $derived(getBuildingUpgrades());
	let unknownUpgrades = $derived(getUnknownUpgrades());

	// Derive treatment heroes for each building
	let abbeyHeroes = $derived(getHeroesInBuilding('abbey'));
	let tavernHeroes = $derived(getHeroesInBuilding('tavern'));
	let sanitariumHeroes = $derived(getHeroesInBuilding('sanitarium'));

	// Helper to get upgrade group for a building
	function getUpgradeGroup(buildingName: string): BuildingUpgradeGroup | null {
		return upgradeGroups.find((g) => g.buildingName === buildingName) ?? null;
	}

	// Collect all building names that have upgrade data, including treatment buildings
	let allBuildingNames = $derived.by(() => {
		const names = new Set<string>();
		// Always show treatment buildings first
		for (const b of TREATMENT_BUILDINGS) {
			names.add(b);
		}
		// Add all buildings that have upgrades
		for (const group of upgradeGroups) {
			names.add(group.buildingName);
		}
		return Array.from(names);
	});

	// Split into treatment and non-treatment buildings
	let treatmentBuildings = $derived(
		allBuildingNames.filter((n) =>
			(TREATMENT_BUILDINGS as readonly string[]).includes(n)
		)
	);
	let otherBuildings = $derived(
		allBuildingNames.filter(
			(n) => !(TREATMENT_BUILDINGS as readonly string[]).includes(n)
		)
	);

	function getTreatmentHeroes(buildingName: string) {
		switch (buildingName) {
			case 'abbey':
				return abbeyHeroes;
			case 'tavern':
				return tavernHeroes;
			case 'sanitarium':
				return sanitariumHeroes;
			default:
				return [];
		}
	}

	let districts = $derived(readDistricts(saveData.town));

	function handleDistrictToggle(districtId: string, checked: boolean) {
		setDistrictBuilt(districtId, checked);
	}
</script>

{#if !saveData.isLoaded}
	<div class="flex flex-col items-center gap-4">
		<EmptyState
			title="No profile loaded"
			description="Load a save profile to view and edit town buildings, upgrades, and treatment slots."
		/>
		{#if import.meta.env.DEV}
			<Button variant="outline" size="sm" onclick={loadMockData}>
				Load Mock Data (Dev)
			</Button>
		{/if}
	</div>
{:else if !saveData.town && !saveData.upgrades}
	<EmptyState
		title="No town data"
		description="The loaded profile does not contain town or upgrade data. The files may be missing or corrupted."
	/>
{:else}
	<ScrollArea class="h-[calc(100vh-4rem)]">
		<div class="space-y-8 p-6">
			<!-- Treatment Buildings Section -->
			<section>
				<div class="mb-4 flex items-center gap-2">
					<h2 class="text-lg font-semibold">Treatment Buildings</h2>
					<Badge variant="secondary" class="text-xs">
						{abbeyHeroes.length + tavernHeroes.length + sanitariumHeroes.length} heroes in treatment
					</Badge>
				</div>
				<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{#each treatmentBuildings as buildingName (buildingName)}
						<BuildingCard
							{buildingName}
							upgradeGroup={getUpgradeGroup(buildingName)}
							treatmentHeroes={getTreatmentHeroes(buildingName)}
						/>
					{/each}
				</div>
			</section>

			<Separator />

			<!-- Building Upgrades Section -->
			<section>
				<h2 class="mb-4 text-lg font-semibold">Building Upgrades</h2>
				<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{#each otherBuildings as buildingName (buildingName)}
						<BuildingCard
							{buildingName}
							upgradeGroup={getUpgradeGroup(buildingName)}
						/>
					{/each}
				</div>
				{#if otherBuildings.length === 0}
					<p class="text-sm text-muted-foreground italic">
						No building upgrade data loaded. Upgrade data comes from persist.upgrades.json.
					</p>
				{/if}
			</section>

			{#if unknownUpgrades.length > 0}
				<section class="space-y-2">
					<h2 class="text-lg font-semibold">Unknown / Modded Upgrades</h2>
					<p class="text-xs text-muted-foreground">These raw identifiers are preserved and cannot be edited without matching game data.</p>
					{#each unknownUpgrades as purchase}
						<p class="text-sm tabular-nums">{purchase.tree_id} · Hero / instance {purchase.instance_number} · Tier {purchase.requirement_code} · {purchase.is_purchased ? 'Purchased' : 'Not purchased'}</p>
					{/each}
				</section>
			{/if}

			{#if districts.length > 0}
			<Separator />

			<!-- Districts Section (Crimson Court DLC) -->
			<section>
				<div class="mb-4 flex items-center gap-2">
					<h2 class="text-lg font-semibold">Districts</h2>
					<Badge variant="outline" class="text-xs">Crimson Court DLC</Badge>
				</div>
				<p class="mb-4 text-xs text-muted-foreground">
					Existing districts from this save. Toggle to mark a district as built or not built.
				</p>
				<div class="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
					{#each districts as district (district.id)}
						<Card class="p-0">
							<CardContent class="flex items-center justify-between px-4 py-3">
								<span class="text-sm font-medium">
									{DISTRICT_DISPLAY_NAMES[district.id] ?? snakeToTitle(district.id)}
								</span>
								<div class="flex items-center gap-2">
									<span class="text-xs text-muted-foreground">
										{district.built ? 'Built' : 'Not Built'}
									</span>
									<Switch
										size="sm"
										checked={district.built}
										onCheckedChange={(checked) => handleDistrictToggle(district.id, checked)}
									/>
								</div>
							</CardContent>
						</Card>
					{/each}
				</div>
			</section>
		{/if}
		</div>
	</ScrollArea>
{/if}
