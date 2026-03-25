<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import HeroList from '$lib/components/heroes/HeroList.svelte';
	import HeroDetail from '$lib/components/heroes/HeroDetail.svelte';
	import BatchToolbar from '$lib/components/heroes/BatchToolbar.svelte';
	import { ResizablePane, ResizablePaneGroup, ResizableHandle } from '$lib/components/ui/resizable';
	import {
		getSaveData,
		getHeroes,
		loadMockData,
		type HeroSummary
	} from '$lib/stores/save-data.svelte';
	import { Button } from '$lib/components/ui/button';

	const saveData = getSaveData();

	let selectedGuids = $state(new Set<string>());
	let activeGuid = $state<string | null>(null);

	let heroes = $derived(getHeroes());

	let activeHero = $derived<HeroSummary | null>(
		activeGuid ? heroes.find((h) => h.guid === activeGuid) ?? null : null
	);

	let selectedHeroes = $derived(heroes.filter((h) => selectedGuids.has(h.guid)));
	let showBatchPanel = $derived(selectedGuids.size > 1);

	function handleDismiss() {
		// After dismiss, clear active selection
		if (activeGuid) {
			const next = new Set(selectedGuids);
			next.delete(activeGuid);
			selectedGuids = next;
		}
		activeGuid = null;
	}
</script>

{#if !saveData.isLoaded}
	<div class="flex flex-col items-center gap-4">
		<EmptyState
			title="No profile loaded"
			description="Open Settings to configure your save file location, then select a profile to begin editing."
		/>
		<Button variant="outline" size="sm" onclick={loadMockData}>
			Load Mock Data (Dev)
		</Button>
	</div>
{:else}
	<div class="flex h-[calc(100vh-4rem)] flex-col">
		<!-- Batch Toolbar -->
		<BatchToolbar {selectedHeroes} totalCount={heroes.length} />

		<!-- Master-Detail Layout -->
		<ResizablePaneGroup direction="horizontal" class="flex-1">
			<!-- Hero List Pane -->
			<ResizablePane defaultSize={40} minSize={30}>
				<HeroList {heroes} bind:selectedGuids bind:activeGuid />
			</ResizablePane>

			<ResizableHandle withHandle />

			<!-- Detail Pane -->
			<ResizablePane defaultSize={60} minSize={30}>
				{#if showBatchPanel}
					<!-- Batch Summary -->
					<div class="flex h-full flex-col items-center justify-center p-6">
						<p class="text-muted-foreground mb-4 text-sm font-medium">
							{selectedGuids.size} heroes selected
						</p>
						<div class="flex max-w-md flex-wrap gap-2">
							{#each selectedHeroes as hero (hero.guid)}
								<div class="bg-muted flex items-center gap-2 px-2 py-1 text-xs">
									<span class="h-2 w-2 rounded-full {hero.statusDotClass}"></span>
									<span>{hero.name}</span>
									<span class="text-muted-foreground">Lv {hero.resolveLevel}</span>
								</div>
							{/each}
						</div>
						<p class="text-muted-foreground mt-4 text-xs">
							Use the toolbar above to apply batch operations.
						</p>
					</div>
				{:else if activeHero}
					<HeroDetail hero={activeHero} onDismiss={handleDismiss} />
				{:else}
					<div class="flex h-full items-center justify-center">
						<p class="text-muted-foreground text-sm">Select a hero to edit</p>
					</div>
				{/if}
			</ResizablePane>
		</ResizablePaneGroup>
	</div>
{/if}
