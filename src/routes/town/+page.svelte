<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import BuildingCard from '$lib/components/town/BuildingCard.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent
	} from '$lib/components/ui/card';
	import { Switch } from '$lib/components/ui/switch';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Separator } from '$lib/components/ui/separator';
	import {
		getSaveData,
		loadMockData,
		getHeroesInBuilding,
		getBuildingUpgrades,
		getDlcFlags,
		TREATMENT_BUILDINGS,
		DISTRICT_IDS,
		DISTRICT_DISPLAY_NAMES,
		type BuildingUpgradeGroup
	} from '$lib/stores/save-data.svelte';

	const saveData = getSaveData();
	const dlcFlags = getDlcFlags();
	let hasColorOfMadness = $derived(dlcFlags.hasColorOfMadness);

	// Derive building upgrade groups
	let upgradeGroups = $derived(getBuildingUpgrades());

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

	// Districts (Color of Madness DLC) — placeholder toggle state
	// In real usage, this would come from persist.town.json or a DLC flag check
	let districtStates = $state<Record<string, boolean>>(
		Object.fromEntries(DISTRICT_IDS.map((id) => [id, false]))
	);
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

			{#if hasColorOfMadness}
			<Separator />

			<!-- Districts Section (Color of Madness DLC) -->
			<section>
				<div class="mb-4 flex items-center gap-2">
					<h2 class="text-lg font-semibold">Districts</h2>
					<Badge variant="outline" class="text-xs">Color of Madness DLC</Badge>
				</div>
				<p class="mb-4 text-xs text-muted-foreground">
					Districts are only available with the Color of Madness DLC. Toggle to mark districts as built or not built.
				</p>
				<div class="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
					{#each DISTRICT_IDS as districtId (districtId)}
						<Card class="p-0">
							<CardContent class="flex items-center justify-between px-4 py-3">
								<span class="text-sm font-medium">
									{DISTRICT_DISPLAY_NAMES[districtId] ?? districtId}
								</span>
								<div class="flex items-center gap-2">
									<span class="text-xs text-muted-foreground">
										{districtStates[districtId] ? 'Built' : 'Not Built'}
									</span>
									<Switch
										size="sm"
										checked={districtStates[districtId]}
										onCheckedChange={(checked) => {
											districtStates[districtId] = checked;
										}}
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
