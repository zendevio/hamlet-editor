<script lang="ts">
	import { Popover, PopoverContent, PopoverTrigger } from '#lib/components/ui/popover/index.js';
	import {
		Command,
		CommandEmpty,
		CommandGroup,
		CommandInput,
		CommandItem,
		CommandList
	} from '#lib/components/ui/command/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import CaretUpDownIcon from 'phosphor-svelte/lib/CaretUpDownIcon';
	import { snakeToTitle } from '#lib/utils.js';
	import { canEquipTrinket, inventoryTrinkets, type TrinketSource } from '#lib/trinkets.js';
	import { getSaveData } from '#lib/stores/save-data.svelte.js';
	import { getGameData, localize } from '#lib/stores/game-data.svelte.js';

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
		heroClass = '',
		disabled = false,
		placeholder = 'Select trinket...',
		onselect
	}: {
		value?: string;
		heroClass?: string;
		disabled?: boolean;
		placeholder?: string;
		onselect?: (trinketId: string, source: TrinketSource) => void;
	} = $props();

	let open = $state(false);

	const gameData = getGameData();

	const saveData = getSaveData();

	function trinketDisplayName(id: string): string {
		const key = `str_inventory_title_trinket${id}`;
		const name = localize(key);
		return name === snakeToTitle(key) ? snakeToTitle(id) : name;
	}

	function allowed(id: string) {
		return !heroClass || canEquipTrinket(id, heroClass, gameData.trinkets);
	}

	let inventory = $derived(inventoryTrinkets(saveData.estate).filter((entry) => allowed(entry.id))
		.sort((a, b) => trinketDisplayName(a.id).localeCompare(trinketDisplayName(b.id))));
	let catalogue = $derived((gameData.trinkets.length > 0
		? gameData.trinkets.map((entry) => entry.id)
		: [...ANCESTOR_TRINKETS, ...BOSS_DROP_TRINKETS, ...CORE_STACKABLE_TRINKETS])
		.filter(allowed).sort((a, b) => trinketDisplayName(a).localeCompare(trinketDisplayName(b))));

	function handleSelect(id: string, source: TrinketSource) {
		open = false;
		if (!disabled) onselect?.(id, source);
	}
</script>

<Popover bind:open>
	<PopoverTrigger {disabled}>
		{#snippet child({ props })}
			<Button
				variant="outline"
				role="combobox"
				aria-expanded={open}
				class="h-8 w-full justify-between text-xs font-normal"
				{...props}
				{disabled}
			>
				<span class="truncate {value ? '' : 'text-muted-foreground'}">
					{value ? trinketDisplayName(value) : placeholder}
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

				{#if heroClass}
					{#if value}
						<CommandGroup>
							<CommandItem value="unequip" onSelect={() => handleSelect('', 'inventory')} class="text-xs">
								Unequip to inventory
							</CommandItem>
						</CommandGroup>
					{/if}
					<CommandGroup heading="In your inventory">
						{#each inventory as trinket (trinket.id)}
							<CommandItem value={`inventory ${trinket.id} ${trinketDisplayName(trinket.id)}`} onSelect={() => handleSelect(trinket.id, 'inventory')} class="text-xs">
								{trinketDisplayName(trinket.id)}{trinket.amount > 1 ? ` (${trinket.amount})` : ''}
							</CommandItem>
						{/each}
					</CommandGroup>
				{/if}
				<CommandGroup heading="Add new from catalogue">
					{#each catalogue as id (id)}
						<CommandItem value={`catalogue ${id} ${trinketDisplayName(id)}`} onSelect={() => handleSelect(id, 'catalogue')} class="text-xs">
							{trinketDisplayName(id)}
						</CommandItem>
					{/each}
				</CommandGroup>
			</CommandList>
		</Command>
	</PopoverContent>
</Popover>
