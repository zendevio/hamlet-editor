<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import WalletCard from '$lib/components/estate/WalletCard.svelte';
	import TrinketCard from '$lib/components/estate/TrinketCard.svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import CurrencyDollarIcon from 'phosphor-svelte/lib/CurrencyDollarIcon';
	import ScrollIcon from 'phosphor-svelte/lib/ScrollIcon';
	import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
	import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
	import ShieldIcon from 'phosphor-svelte/lib/ShieldIcon';
	import DiamondIcon from 'phosphor-svelte/lib/DiamondIcon';
	import DropIcon from 'phosphor-svelte/lib/DropIcon';
	import EnvelopeIcon from 'phosphor-svelte/lib/EnvelopeIcon';
	import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import TrinketPicker from '$lib/components/heroes/TrinketPicker.svelte';
import { getSaveData, markDirty, setEstateName } from '$lib/stores/save-data.svelte';
	import type { WalletEntry, TrinketEntry, EstateItem } from '$lib/types/save-data';

	// ----- Props / State -----

	const saveData = getSaveData();

	// estateData reads from the shared store's estate field.
	// The base_root is unwrapped to match the local EstateData shape expected by the UI.
	let estateData = $derived(
		saveData.estate
			? (saveData.estate.base_root as {
					wallet: Record<string, WalletEntry>;
					trinkets: { items: Record<string, TrinketEntry> };
					estate_items: { items: Record<string, EstateItem> };
					endless_wave_highscore?: number;
				})
			: null
	);

	// D6: Estate name
	let estateNameValue = $state('');
	let estateNameEditing = $state(false);

	$effect(() => {
		if (!estateNameEditing) {
			estateNameValue = saveData.game?.base_root?.estatename ?? '';
		}
	});

	function handleEstateNameBlur() {
		const trimmed = estateNameValue.trim();
		if (trimmed && trimmed !== (saveData.game?.base_root?.estatename ?? '')) {
			setEstateName(trimmed);
		}
		estateNameEditing = false;
	}

	function handleEstateNameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			(e.target as HTMLElement)?.blur();
		}
		if (e.key === 'Escape') {
			estateNameValue = saveData.game?.base_root?.estatename ?? '';
			estateNameEditing = false;
		}
	}

	// DLC flags derived from save data content.
	// hasCrimsonCourt: true if any hero has a disease_vampire_* quirk OR estate_items has a crimson_court_invitation_*.
	let hasCrimsonCourt = $derived.by(() => {
		if (!estateData) return false;
		// Check estate_items for any crimson_court_invitation_*
		for (const item of Object.values(estateData.estate_items.items) as EstateItem[]) {
			if (item.id?.startsWith('crimson_court_invitation_')) return true;
		}
		// Check heroes for disease_vampire_* quirks
		if (saveData.roster) {
			for (const entry of Object.values(saveData.roster.base_root.heroes)) {
				const quirks = entry.hero_file_data.raw_data.base_root.quirks;
				for (const quirkId of Object.keys(quirks)) {
					if (quirkId.startsWith('disease_vampire_')) return true;
				}
			}
		}
		return false;
	});
	// hasColorOfMadness: true if wallet contains type "shard" OR endless_wave_highscore exists.
	let hasColorOfMadness = $derived.by(() => {
		if (!estateData) return false;
		for (const entry of Object.values(estateData.wallet)) {
			if (entry.type === 'shard') return true;
		}
		return estateData.endless_wave_highscore !== undefined && estateData.endless_wave_highscore !== null;
	});

	// Count of trinkets equipped on heroes (from roster data, wired later)
	let equippedTrinketCount = $state(0);

	// Add Trinket picker state
	let showTrinketPicker = $state(false);

	// ----- Derived data -----

	const walletCurrencies = [
		{ type: 'gold', name: 'Gold', icon: CurrencyDollarIcon },
		{ type: 'bust', name: 'Busts', icon: ScrollIcon },
		{ type: 'portrait', name: 'Portraits', icon: ImageIcon },
		{ type: 'deed', name: 'Deeds', icon: FileTextIcon },
		{ type: 'crest', name: 'Crests', icon: ShieldIcon }
	] as const;

	/** Wallet amounts keyed by currency type. */
	let walletAmounts = $derived.by(() => {
		if (!estateData) return null;
		const map: Record<string, number> = {};
		for (const entry of Object.values(estateData.wallet)) {
			map[entry.type] = entry.amount;
		}
		return map;
	});

	/** Shard amount (CoM DLC only). */
	let shardAmount = $derived(walletAmounts?.['shard'] ?? 0);

	/** Trinkets in estate storage. */
	let trinkets = $derived.by(() => {
		if (!estateData) return [];
		return Object.values(estateData.trinkets.items);
	});

	/** Estate items (invitations, blood, blueprints). */
	let estateItems = $derived.by(() => {
		if (!estateData) return [];
		return Object.values(estateData.estate_items.items);
	});

	/** Invitation counts: A (Baron), B (Viscount), C (Countess). */
	let invitationA = $derived(
		estateItems.find((i) => i.id === 'crimson_court_invitation_A')?.amount ?? 0
	);
	let invitationB = $derived(
		estateItems.find((i) => i.id === 'crimson_court_invitation_B')?.amount ?? 0
	);
	let invitationC = $derived(
		estateItems.find((i) => i.id === 'crimson_court_invitation_C')?.amount ?? 0
	);

	/**
	 * Blood vials — uses explicit ID lookup, NOT type filtering.
	 * Blood has type "estate", not "estate_currency".
	 */
	let bloodAmount = $derived(
		estateItems.find((i) => i.id === 'the_blood')?.amount ?? 0
	);

	/** Blueprint count (CC DLC). */
	let blueprintCount = $derived(
		estateItems.filter((i) => i.type === 'blueprint').reduce((sum, i) => sum + i.amount, 0)
	);

	// ----- Handlers -----

	function handleWalletChange(type: string, newValue: number) {
		if (!estateData || !saveData.estate) return;
		for (const [key, entry] of Object.entries(estateData.wallet)) {
			if (entry.type === type) {
				saveData.estate.base_root.wallet[key].amount = newValue;
				markDirty('persist.estate.json');
				break;
			}
		}
	}

	function handleRemoveTrinket(trinketId: string) {
		if (!estateData || !saveData.estate) return;
		const entries = Object.entries(estateData.trinkets.items);
		const match = entries.find(([, item]) => item.id === trinketId);
		if (match) {
			delete saveData.estate.base_root.trinkets.items[match[0]];
			markDirty('persist.estate.json');
		}
	}

	function handleAddTrinket() {
		showTrinketPicker = true;
	}

	function handleTrinketSelected(trinketId: string) {
		if (!estateData || !saveData.estate || !trinketId) return;
		const existingKeys = Object.keys(estateData.trinkets.items).map(Number).filter((n) => !isNaN(n));
		const nextKey = existingKeys.length > 0 ? Math.max(...existingKeys) + 1 : 0;
		saveData.estate.base_root.trinkets.items[String(nextKey)] = {
			id: trinketId,
			type: 'trinket',
			amount: 1
		};
		markDirty('persist.estate.json');
		showTrinketPicker = false;
	}

	/** Update an estate_item amount by its ID key. */
	function handleEstateItemChange(itemId: string, newValue: number) {
		if (!estateData || !saveData.estate) return;
		for (const [key, item] of Object.entries(estateData.estate_items.items) as [string, EstateItem][]) {
			if (item.id === itemId) {
				(saveData.estate.base_root.estate_items.items[key] as EstateItem).amount = newValue;
				markDirty('persist.estate.json');
				return;
			}
		}
	}

	/** Update total blueprint count by distributing the delta across blueprint entries. */
	function handleBlueprintChange(newValue: number) {
		if (!estateData || !saveData.estate) return;
		const bpEntries = (Object.entries(estateData.estate_items.items) as [string, EstateItem][])
			.filter(([, item]) => item.type === 'blueprint');
		if (bpEntries.length === 0) return;
		// Distribute evenly: put all into the first entry for simplicity
		for (const [key] of bpEntries) {
			(saveData.estate.base_root.estate_items.items[key] as EstateItem).amount = 0;
		}
		(saveData.estate.base_root.estate_items.items[bpEntries[0][0]] as EstateItem).amount = newValue;
		markDirty('persist.estate.json');
	}
</script>

{#if !estateData}
	<EmptyState
		title="No profile loaded"
		description="Load a save profile to view and edit your estate — wallet, trinkets, and currencies."
	/>
{:else}
	<div class="space-y-8">
		<!-- D6: Estate Name Section -->
		<section>
			<h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
				Estate Name
			</h2>
			<div class="max-w-sm space-y-1">
				<Input
					bind:value={estateNameValue}
					onfocus={() => (estateNameEditing = true)}
					onblur={handleEstateNameBlur}
					onkeydown={handleEstateNameKeydown}
					placeholder="Enter estate name..."
					class="h-9 text-sm"
				/>
				<p class="text-[10px] text-muted-foreground">
					{new TextEncoder().encode(estateNameValue).length} bytes
				</p>
			</div>
		</section>

		<!-- Wallet Section -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
				Wallet
			</h2>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
				{#each walletCurrencies as currency}
					<WalletCard
						name={currency.name}
						value={walletAmounts?.[currency.type] ?? 0}
						icon={currency.icon}
						onchange={(v) => handleWalletChange(currency.type, v)}
					/>
				{/each}
				{#if hasColorOfMadness}
					<WalletCard
						name="Shards"
						value={shardAmount}
						icon={DiamondIcon}
						onchange={(v) => handleWalletChange('shard', v)}
					/>
				{/if}
			</div>
		</section>

		<!-- Estate Currencies Section (Crimson Court DLC) -->
		{#if hasCrimsonCourt}
			<section>
				<h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
					Estate Currencies
				</h2>
				<Card.Root>
					<Card.Content class="pt-0">
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
							<!-- Invitations -->
							<div class="space-y-2">
								<div class="flex items-center gap-2">
									<EnvelopeIcon size={16} class="text-muted-foreground" />
									<span class="text-sm font-medium">Invitations</span>
								</div>
								<div class="grid grid-cols-3 gap-2">
									<div class="space-y-1">
										<label for="inv-a" class="text-xs text-muted-foreground">A (Baron)</label>
										<Input id="inv-a" type="number" min="0" value={String(invitationA)} class="h-8 tabular-nums"
											onchange={(e) => handleEstateItemChange('crimson_court_invitation_A', Number((e.target as HTMLInputElement).value))} />
									</div>
									<div class="space-y-1">
										<label for="inv-b" class="text-xs text-muted-foreground">B (Viscount)</label>
										<Input id="inv-b" type="number" min="0" value={String(invitationB)} class="h-8 tabular-nums"
											onchange={(e) => handleEstateItemChange('crimson_court_invitation_B', Number((e.target as HTMLInputElement).value))} />
									</div>
									<div class="space-y-1">
										<label for="inv-c" class="text-xs text-muted-foreground">C (Countess)</label>
										<Input id="inv-c" type="number" min="0" value={String(invitationC)} class="h-8 tabular-nums"
											onchange={(e) => handleEstateItemChange('crimson_court_invitation_C', Number((e.target as HTMLInputElement).value))} />
									</div>
								</div>
							</div>

							<!-- Blood Vials -->
							<div class="space-y-2">
								<div class="flex items-center gap-2">
									<DropIcon size={16} class="text-muted-foreground" />
									<span class="text-sm font-medium">Blood</span>
								</div>
								<div class="space-y-1">
									<Input type="number" min="0" value={String(bloodAmount)} class="h-8 tabular-nums"
										onchange={(e) => handleEstateItemChange('the_blood', Number((e.target as HTMLInputElement).value))} />
									<p class="text-[10px] text-muted-foreground/70">
										type: "estate" (not "estate_currency")
									</p>
								</div>
							</div>

							<!-- Blueprints -->
							<div class="space-y-2">
								<div class="flex items-center gap-2">
									<WrenchIcon size={16} class="text-muted-foreground" />
									<span class="text-sm font-medium">Blueprints</span>
								</div>
								<div class="space-y-1">
									<Input type="number" min="0" value={String(blueprintCount)} class="h-8 tabular-nums"
										onchange={(e) => handleBlueprintChange(Number((e.target as HTMLInputElement).value))} />
								</div>
							</div>
						</div>
					</Card.Content>
				</Card.Root>
			</section>
		{/if}

		<!-- Trinket Storage Section -->
		<section>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
					Trinket Storage
				</h2>
				{#if equippedTrinketCount > 0}
					<Badge variant="outline" class="text-xs font-normal">
						{equippedTrinketCount} trinket{equippedTrinketCount !== 1 ? 's' : ''} equipped on heroes
					</Badge>
				{/if}
			</div>

			{#if trinkets.length === 0}
				<Card.Root>
					<Card.Content class="pt-0">
						<div class="flex min-h-30 flex-col items-center justify-center gap-3 text-center">
							<p class="text-sm text-muted-foreground">No trinkets in storage</p>
							<p class="text-xs text-muted-foreground/70">
								Trinkets unequipped from heroes or added via the button below will appear here.
							</p>
							<Button variant="outline" size="sm" onclick={handleAddTrinket}>
								<PlusIcon size={14} />
								Add Trinket
							</Button>
						</div>
					</Card.Content>
				</Card.Root>
			{:else}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
					{#each trinkets as trinket (trinket.id)}
						<TrinketCard
							id={trinket.id}
							type={trinket.type}
							onremove={handleRemoveTrinket}
						/>
					{/each}
				</div>
				<div class="mt-3">
					<Button variant="outline" size="sm" onclick={handleAddTrinket}>
						<PlusIcon size={14} />
						Add Trinket
					</Button>
				</div>
			{/if}

			{#if showTrinketPicker}
				<div class="mt-3 max-w-xs">
					<TrinketPicker onselect={handleTrinketSelected} />
				</div>
			{/if}
		</section>
	</div>
{/if}
