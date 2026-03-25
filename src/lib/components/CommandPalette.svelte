<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		CommandDialog,
		CommandInput,
		CommandList,
		CommandEmpty,
		CommandGroup,
		CommandItem,
		CommandShortcut
	} from '$lib/components/ui/command';
	import {
		getHeroes,
		getSaveData,
		BUILDING_DISPLAY_NAMES
	} from '$lib/stores/save-data.svelte';
	import UsersThreeIcon from 'phosphor-svelte/lib/UsersThreeIcon';
	import BuildingsIcon from 'phosphor-svelte/lib/BuildingsIcon';
	import BankIcon from 'phosphor-svelte/lib/BankIcon';
	import FloppyDiskIcon from 'phosphor-svelte/lib/FloppyDiskIcon';
	import ArchiveIcon from 'phosphor-svelte/lib/ArchiveIcon';
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import type { Component } from 'svelte';

	let open = $state(false);
	let searchValue = $state('');

	const saveData = getSaveData();

	// Keyboard shortcut handler
	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
			e.preventDefault();
			open = !open;
		}
	}

	// Build search results
	let heroResults = $derived.by(() => {
		if (!saveData.isLoaded) return [];
		const heroes = getHeroes();
		const q = searchValue.toLowerCase();
		if (!q) return heroes.slice(0, 10);
		return heroes.filter(
			(h) =>
				h.name.toLowerCase().includes(q) ||
				h.heroClass.toLowerCase().includes(q) ||
				h.classDisplayName.toLowerCase().includes(q)
		);
	});

	let buildingResults = $derived.by(() => {
		const q = searchValue.toLowerCase();
		const buildings = Object.entries(BUILDING_DISPLAY_NAMES);
		if (!q) return buildings.slice(0, 5);
		return buildings.filter(
			([id, name]) => name.toLowerCase().includes(q) || id.toLowerCase().includes(q)
		);
	});

	let trinketResults = $derived.by(() => {
		if (!saveData.isLoaded || !saveData.estate) return [];
		const q = searchValue.toLowerCase();
		if (!q) return [];
		const items = Object.values(saveData.estate.base_root.trinkets.items) as { id: string; type?: string }[];
		return items
			.filter((item) => item.id && item.id.toLowerCase().includes(q))
			.slice(0, 10);
	});

	let quirkResults = $derived.by(() => {
		if (!saveData.isLoaded) return [];
		const heroes = getHeroes();
		const q = searchValue.toLowerCase();
		if (!q) return [];
		const results: { heroName: string; heroGuid: string; quirkId: string }[] = [];
		for (const hero of heroes) {
			for (const quirkId of Object.keys(hero.quirks)) {
				if (quirkId.toLowerCase().includes(q)) {
					results.push({ heroName: hero.name, heroGuid: hero.guid, quirkId });
				}
			}
		}
		return results.slice(0, 10);
	});

	interface ActionResult {
		label: string;
		shortcut: string;
		icon: Component<{ size?: number; class?: string }>;
		action: () => void;
	}

	let actionResults = $derived.by((): ActionResult[] => {
		const q = searchValue.toLowerCase();
		const actions: ActionResult[] = [
			{
				label: 'Save Changes',
				shortcut: '\u2318S',
				icon: FloppyDiskIcon,
				action: () => {
					open = false;
					window.dispatchEvent(new CustomEvent('hamlet:save'));
				}
			},
			{
				label: 'Create Backup',
				shortcut: '\u2318B',
				icon: ArchiveIcon,
				action: () => {
					open = false;
					window.dispatchEvent(new CustomEvent('hamlet:backup'));
				}
			},
			{
				label: 'Discard Changes',
				shortcut: '\u2318\u21E7Z',
				icon: ArrowCounterClockwiseIcon,
				action: () => {
					open = false;
					window.dispatchEvent(new CustomEvent('hamlet:discard'));
				}
			}
		];
		if (!q) return actions;
		return actions.filter((a) => a.label.toLowerCase().includes(q));
	});

	function navigateToHero(guid: string) {
		open = false;
		goto(`/heroes?select=${guid}`);
	}

	function navigateToBuilding(_id: string) {
		open = false;
		goto('/town');
	}

	function navigateToEstate() {
		open = false;
		goto('/estate');
	}

</script>

<svelte:window onkeydown={handleKeydown} />

<CommandDialog bind:open bind:value={searchValue} title="Command Palette" description="Search heroes, buildings, quirks, and actions">
	<CommandInput placeholder="Search heroes, quirks, buildings, actions..." />
	<CommandList>
		<CommandEmpty>No results found.</CommandEmpty>

		{#if actionResults.length > 0}
			<CommandGroup heading="Actions">
				{#each actionResults as action (action.label)}
					<CommandItem onSelect={action.action}>
						<action.icon size={16} class="mr-2 shrink-0" />
						<span>{action.label}</span>
						<CommandShortcut>{action.shortcut}</CommandShortcut>
					</CommandItem>
				{/each}
			</CommandGroup>
		{/if}

		{#if heroResults.length > 0}
			<CommandGroup heading="Heroes">
				{#each heroResults as hero (hero.guid)}
					<CommandItem onSelect={() => navigateToHero(hero.guid)}>
						<UsersThreeIcon size={16} class="mr-2 shrink-0" />
						<span>{hero.name}</span>
						<span class="text-muted-foreground ml-2 text-xs">{hero.classDisplayName} Lv{hero.resolveLevel}</span>
					</CommandItem>
				{/each}
			</CommandGroup>
		{/if}

		{#if quirkResults.length > 0}
			<CommandGroup heading="Quirks">
				{#each quirkResults as result (result.heroGuid + result.quirkId)}
					<CommandItem onSelect={() => navigateToHero(result.heroGuid)}>
						<UsersThreeIcon size={16} class="mr-2 shrink-0" />
						<span class="font-mono text-xs">{result.quirkId}</span>
						<span class="text-muted-foreground ml-2 text-xs">on {result.heroName}</span>
					</CommandItem>
				{/each}
			</CommandGroup>
		{/if}

		{#if trinketResults.length > 0}
			<CommandGroup heading="Estate Trinkets">
				{#each trinketResults as trinket (trinket.id)}
					<CommandItem onSelect={navigateToEstate}>
						<BankIcon size={16} class="mr-2 shrink-0" />
						<span class="font-mono text-xs">{trinket.id}</span>
						<span class="text-muted-foreground ml-2 text-xs">in storage</span>
					</CommandItem>
				{/each}
			</CommandGroup>
		{/if}

		{#if buildingResults.length > 0}
			<CommandGroup heading="Buildings">
				{#each buildingResults as [id, name] (id)}
					<CommandItem onSelect={() => navigateToBuilding(id)}>
						<BuildingsIcon size={16} class="mr-2 shrink-0" />
						<span>{name}</span>
					</CommandItem>
				{/each}
			</CommandGroup>
		{/if}
	</CommandList>
</CommandDialog>
