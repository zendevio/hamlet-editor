<script lang="ts">
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import {
		Command,
		CommandEmpty,
		CommandGroup,
		CommandInput,
		CommandItem,
		CommandList
	} from '$lib/components/ui/command';
	import { Button } from '$lib/components/ui/button';
	import CaretUpDownIcon from 'phosphor-svelte/lib/CaretUpDownIcon';
	import { snakeToTitle } from '$lib/utils';
	import { getGameData, localize } from '$lib/stores/game-data.svelte';

	// ── Static trinket list (from docs/game-data.md) — fallback only ──

	const ANCESTOR_TRINKETS = [
		'ancestors_candle',
		'ancestors_pen',
		'ancestors_pistol',
		'ancestors_scroll',
		'ancestors_map',
		'ancestors_coat',
		'ancestors_signet_ring',
		'ancestors_lantern',
		'ancestors_tentacle_idol'
	];

	const BOSS_DROP_TRINKETS = [
		'collector_1',
		'collector_2',
		'collector_3',
		'boss_flesh',
		'boss_prophet',
		'boss_cannon',
		'boss_hag',
		'boss_tassle',
		'boss_wilbur',
		'boss_necromancer',
		'boss_siren',
		'boss_crew'
	];

	const CORE_STACKABLE_TRINKETS = [
		'focus_ring',
		'feather_crystal',
		'legendary_bracer',
		'sun_ring',
		'dazzling_charm',
		'berserk_charm'
	];

	let {
		value = '',
		placeholder = 'Select trinket...',
		onselect
	}: {
		value?: string;
		placeholder?: string;
		onselect?: (trinketId: string) => void;
	} = $props();

	let open = $state(false);

	const gameData = getGameData();

	let gameDataLoaded = $derived(gameData.trinkets.length > 0);

	function trinketDisplayName(id: string): string {
		return localize(`str_inventory_title_trinket${id}`) || snakeToTitle(id);
	}

	let sortedTrinkets = $derived(
		[...gameData.trinkets].sort((a, b) => trinketDisplayName(a.id).localeCompare(trinketDisplayName(b.id)))
	);

	function handleSelect(id: string) {
		open = false;
		onselect?.(id);
	}
</script>

<Popover bind:open>
	<PopoverTrigger>
		{#snippet child({ props })}
			<Button
				variant="outline"
				role="combobox"
				aria-expanded={open}
				class="h-8 w-full justify-between text-xs font-normal"
				{...props}
			>
				<span class="truncate {value ? '' : 'text-muted-foreground'}">
					{value ? localize(`str_inventory_title_trinket${value}`) || snakeToTitle(value) : placeholder}
				</span>
				<CaretUpDownIcon size={14} class="ml-2 shrink-0 text-muted-foreground" />
			</Button>
		{/snippet}
	</PopoverTrigger>
	<PopoverContent class="w-72 p-0" align="start">
		<Command>
			<CommandInput placeholder="Search trinkets..." class="h-8 text-xs" />
			<CommandList class="max-h-64">
				<CommandEmpty>No trinket found.</CommandEmpty>

				{#if gameDataLoaded}
					<CommandGroup heading="All Trinkets">
						{#each sortedTrinkets as trinket (trinket.id)}
							<CommandItem value={trinket.id} onSelect={() => handleSelect(trinket.id)} class="text-xs">
								{trinketDisplayName(trinket.id)}
							</CommandItem>
						{/each}
					</CommandGroup>
				{:else}
					<CommandGroup heading="Ancestor Trinkets">
						{#each [...ANCESTOR_TRINKETS].sort((a, b) => trinketDisplayName(a).localeCompare(trinketDisplayName(b))) as id (id)}
							<CommandItem value={id} onSelect={() => handleSelect(id)} class="text-xs">
								{trinketDisplayName(id)}
							</CommandItem>
						{/each}
					</CommandGroup>

					<CommandGroup heading="Boss Drops">
						{#each [...BOSS_DROP_TRINKETS].sort((a, b) => trinketDisplayName(a).localeCompare(trinketDisplayName(b))) as id (id)}
							<CommandItem value={id} onSelect={() => handleSelect(id)} class="text-xs">
								{trinketDisplayName(id)}
							</CommandItem>
						{/each}
					</CommandGroup>

					<CommandGroup heading="Core Stackable">
						{#each [...CORE_STACKABLE_TRINKETS].sort((a, b) => trinketDisplayName(a).localeCompare(trinketDisplayName(b))) as id (id)}
							<CommandItem value={id} onSelect={() => handleSelect(id)} class="text-xs">
								{trinketDisplayName(id)}
							</CommandItem>
						{/each}
					</CommandGroup>
				{/if}
			</CommandList>
		</Command>
	</PopoverContent>
</Popover>
