<script lang="ts">
	import { t, describeMessage } from '#lib/i18n/index.svelte.js';
	import { formatNumber, compareNames } from '#lib/i18n/intl.js';
	import { trinketName, trinketEnglishName, gameTextLocale } from '#lib/save-labels.js';
	import { matchesSearch } from '#lib/search.js';
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
	import { trinketEquipBlockReason, inventoryTrinkets, type TrinketSource } from '#lib/trinkets.js';
	import { getSaveData } from '#lib/stores/save-data.svelte.js';
	import { getGameData } from '#lib/stores/game-data.svelte.js';

	// ── Static trinket list (from docs/game-data.md), fallback only ──

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
		otherIds = [],
		disabled = false,
		placeholder,
		onselect
	}: {
		value?: string;
		heroClass?: string;
		otherIds?: string[];
		disabled?: boolean;
		placeholder?: string;
		onselect?: (trinketId: string, source: TrinketSource) => void;
	} = $props();

	let open = $state(false);
	let search = $state('');

	const gameData = getGameData();

	const saveData = getSaveData();

	function blockedReason(id: string) {
		return !heroClass || id === value ? null : trinketEquipBlockReason(id, heroClass, gameData.trinkets, otherIds);
	}

	let inventory = $derived(inventoryTrinkets(saveData.estate)
		.sort((a, b) => compareNames(trinketName(a.id), a.id, trinketName(b.id), b.id, gameTextLocale())));
	let catalogue = $derived((gameData.trinkets.length > 0
		? gameData.trinkets.map((entry) => entry.id)
		: [...ANCESTOR_TRINKETS, ...BOSS_DROP_TRINKETS, ...CORE_STACKABLE_TRINKETS])
		.sort((a, b) => compareNames(trinketName(a), a, trinketName(b), b, gameTextLocale())));
	let filteredInventory = $derived(inventory.filter(({ id }) => matchesSearch(search, id, trinketName(id), trinketEnglishName(id))));
	let filteredCatalogue = $derived(catalogue.filter((id) => matchesSearch(search, id, trinketName(id), trinketEnglishName(id))));
	let showUnequip = $derived(!!value && matchesSearch(search, 'unequip', t('heroes.unequipToInventory')));

	$effect(() => { if (!open) search = ''; });

	function handleSelect(id: string, source: TrinketSource) {
		open = false;
		if (!disabled && (!id || !blockedReason(id))) onselect?.(id, source);
	}
</script>

<Popover bind:open>
	<PopoverTrigger {disabled}>
		{#snippet child({ props })}
			<Button
				variant="outline"
				role="combobox"
				data-testid="trinket-picker-trigger"
				aria-expanded={open}
				class="h-8 w-full justify-between text-xs font-normal"
				{...props}
				{disabled}
			>
				<span class="truncate {value ? '' : 'text-muted-foreground'}">
					{#if value}<span lang={gameTextLocale()}>{trinketName(value)}</span>{:else}{placeholder ?? t('heroes.selectTrinket')}{/if}
				</span>
				<CaretUpDownIcon size={14} class="ml-2 shrink-0 text-muted-foreground" />
			</Button>
		{/snippet}
	</PopoverTrigger>
	<PopoverContent data-testid="trinket-picker" class="w-72 max-h-(--bits-popover-content-available-height) p-0" align="start">
		<Command shouldFilter={false} class="min-h-0">
			<CommandInput bind:value={search} placeholder={t('heroes.searchTrinkets')} class="h-8 text-xs" />
			<CommandList class="max-h-64 min-h-0">
				<CommandEmpty>{t('heroes.noTrinketFound')}</CommandEmpty>

				{#if heroClass}
					{#if showUnequip}
						<CommandGroup>
							<CommandItem value="unequip" onSelect={() => handleSelect('', 'inventory')} class="text-xs">
								{t('heroes.unequipToInventory')}
							</CommandItem>
						</CommandGroup>
					{/if}
					{#if filteredInventory.length}
					<CommandGroup value="inventory" heading={t('heroes.inventoryHeading')}>
						{#each filteredInventory as trinket (trinket.id)}
							<CommandItem value={`inventory:${trinket.id}`} disabled={!!blockedReason(trinket.id)} onSelect={() => handleSelect(trinket.id, 'inventory')} class="text-xs">
								{@const reason = blockedReason(trinket.id)}
								<span><span lang={gameTextLocale()}>{trinketName(trinket.id)}</span>{trinket.amount > 1 ? ` (${formatNumber(trinket.amount)})` : ''}{#if reason}<small class="block">{describeMessage(reason)}</small>{/if}</span>
							</CommandItem>
						{/each}
					</CommandGroup>
					{/if}
				{/if}
				{#if filteredCatalogue.length}
				<CommandGroup value="catalogue" heading={t('heroes.catalogueHeading')}>
					{#each filteredCatalogue as id (id)}
						<CommandItem value={`catalogue:${id}`} disabled={!!blockedReason(id)} onSelect={() => handleSelect(id, 'catalogue')} class="text-xs">
							{@const reason = blockedReason(id)}
							<span><span lang={gameTextLocale()}>{trinketName(id)}</span>{#if reason}<small class="block">{describeMessage(reason)}</small>{/if}</span>
						</CommandItem>
					{/each}
				</CommandGroup>
				{/if}
			</CommandList>
		</Command>
	</PopoverContent>
</Popover>
