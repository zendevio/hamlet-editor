<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.js';
	import { compareNames, formatNumber } from '#lib/i18n/intl.js';
	import { gameTextLocale, buildingDisplayName, districtName } from '#lib/save-labels.js';
	import { commitChangedValue } from '#lib/control-events.js';
	import { readDistricts } from '#lib/districts.js';
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
		return Array.from(names).sort((a, b) => compareNames(buildingDisplayName(a), a, buildingDisplayName(b), b, gameTextLocale()));
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

	let districts = $derived(readDistricts(saveData.town).sort((a, b) => compareNames(districtName(a.id), a.id, districtName(b.id), b.id, gameTextLocale())));

	function handleDistrictToggle(districtId: string, checked: boolean) {
		setDistrictBuilt(districtId, checked);
	}
</script>

{#if !saveData.isLoaded}
	<div class="flex flex-col items-center gap-4">
		<EmptyState
			title={t('shell.noProfile')}
			description={t('town.noProfileHelp')}
		/>
		{#if import.meta.env.DEV}
			<Button variant="outline" size="sm" onclick={loadMockData}>
				{t('heroes.loadMock')}
			</Button>
		{/if}
	</div>
{:else if !saveData.town && !saveData.upgrades}
	<EmptyState
		title={t('town.noData')}
		description={t('town.noDataHelp')}
	/>
{:else}
	<ScrollArea class="h-[calc(100vh-4rem)]">
		<div data-testid="town-page" class="min-w-0 space-y-8 p-6">
			<!-- Treatment Buildings Section -->
			<section>
				<div class="mb-4 flex flex-wrap items-center gap-2">
					<h2 class="text-lg font-semibold">{t('town.treatmentBuildings')}</h2>
					<Badge variant="secondary" class="text-xs">
						{t('town.treatmentCount', { count: abbeyHeroes.length + tavernHeroes.length + sanitariumHeroes.length, countText: formatNumber(abbeyHeroes.length + tavernHeroes.length + sanitariumHeroes.length) })}
					</Badge>
				</div>
				<div class="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
				<h2 class="mb-4 text-lg font-semibold">{t('town.buildingUpgrades')}</h2>
				<div class="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
					{#each otherBuildings as buildingName (buildingName)}
						<BuildingCard
							{buildingName}
							upgradeGroup={getUpgradeGroup(buildingName)}
						/>
					{/each}
				</div>
				{#if otherBuildings.length === 0}
					<p class="text-sm text-muted-foreground italic">
						{t('town.noUpgrades')}
					</p>
				{/if}
			</section>

			{#if unknownUpgrades.length > 0}
				<section class="space-y-2">
					<h2 class="text-lg font-semibold">{t('town.unknownUpgrades')}</h2>
					<p class="text-xs text-muted-foreground">{t('town.unknownUpgradesHelp')}</p>
					{#each unknownUpgrades as purchase}
						<p class="text-sm tabular-nums">{t('town.unknownUpgrade', { tree: String(purchase.tree_id), instance: String(purchase.instance_number), tier: purchase.requirement_code, purchased: purchase.is_purchased ? 'yes' : 'no' })}</p>
					{/each}
				</section>
			{/if}

			{#if districts.length > 0}
			<Separator />

			<!-- Districts Section -->
			<section>
				<div class="mb-4 flex flex-wrap items-center gap-2">
					<h2 class="text-lg font-semibold">{t('town.districts')}</h2>
				</div>
				<p class="mb-4 text-xs text-muted-foreground">
					{t('town.districtsHelp')}
				</p>
				<div class="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
					{#each districts as district (district.id)}
						<Card data-testid="district-{district.id}" class="p-0">
							<CardContent class="flex items-center justify-between px-4 py-3">
								<span lang={gameTextLocale()} class="text-sm font-medium">
									{districtName(district.id)}
								</span>
								<div class="flex items-center gap-2">
									<span class="text-xs text-muted-foreground">
										{district.built ? t('town.built') : t('town.notBuilt')}
									</span>
									<Switch
										size="sm"
										aria-label={t('town.toggleDistrict', { name: districtName(district.id) })}
										checked={district.built}
										onCheckedChange={(checked) => commitChangedValue(district.built, checked, (value) => handleDistrictToggle(district.id, value))}
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
