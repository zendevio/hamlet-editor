<script lang="ts">
	import { sliderControl } from '#lib/control-events.js';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PartySlot from '#lib/components/raid/PartySlot.svelte';
	import RaidInfoCard from '#lib/components/raid/RaidInfoCard.svelte';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import IntegerInput from '#lib/components/IntegerInput.svelte';
	import { Slider } from '#lib/components/ui/slider/index.js';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
	import BackpackIcon from 'phosphor-svelte/lib/BackpackIcon';
	import {
		getSaveData,
		getHeroes,
		CLASS_DISPLAY_NAMES,
		setRaidTorchlight,
		setRaidHungerBuffer,
		setRaidItemAmount,
		abandonRaid,
		swapPartyPositions
	} from '#lib/stores/save-data.svelte.js';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import { abandonRaidBlockReason } from '#lib/raid.js';
	import { stripDsonPrefix } from '#lib/utils.js';
	import type { RaidData, InventoryItem } from '#lib/types/save-data.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDownIcon';
	import SkullIcon from 'phosphor-svelte/lib/SkullIcon';
	import { toast } from 'svelte-sonner';
	import { createBackup } from '#lib/api/backup.js';
	import { getSettings } from '#lib/stores/settings.svelte.js';

	// ── Constants ──

	const DIFFICULTY_LABELS: Record<number, string> = {
		1: 'Apprentice',
		3: 'Veteran',
		5: 'Champion'
	};

	const LENGTH_LABELS: Record<number, string> = {
		1: 'Short',
		2: 'Medium',
		3: 'Long'
	};

	const DUNGEON_LABELS: Record<string, string> = {
		ruins: 'Ruins',
		weald: 'Weald',
		cove: 'Cove',
		warrens: 'Warrens',
		darkestdungeon: 'Darkest Dungeon',
		farmstead: 'Farmstead',
		courtyard: 'Courtyard'
	};

	// ── State ──

	const saveData = getSaveData();

	// Abandon raid dialog
	let abandonDialogOpen = $state(false);
	let abandonConfirmChecked = $state(false);

	/** Raid data from persist.raid.json — sourced from the shared save-data store. */
	let raidData = $derived(saveData.raid as RaidData | null);
	let abandonBlockedReason = $derived(saveData.game ? abandonRaidBlockReason(saveData.game) : null);

	/** Whether persist.game.json reports inraid: true — sourced from the shared save-data store. */
	let gameInRaid = $derived(saveData.gameInRaid);

	// ── Derived ──

	let raidFileExists = $derived(raidData !== null);
	let isInconsistent = $derived(raidFileExists !== gameInRaid);

	let raidInstance = $derived(raidData?.base_root.raid_instance ?? null);
	let party = $derived(raidData?.base_root.party ?? null);
	let heroes = $derived(getHeroes());

	let dungeonLabel = $derived(
		raidInstance ? (DUNGEON_LABELS[raidInstance.dungeon] ?? raidInstance.dungeon) : ''
	);

	let difficultyLabel = $derived(
		raidInstance
			? `${DIFFICULTY_LABELS[raidInstance.difficulty] ?? 'Unknown'} (${raidInstance.difficulty})`
			: ''
	);

	let lengthLabel = $derived(
		raidInstance ? (LENGTH_LABELS[raidInstance.length] ?? `${raidInstance.length}`) : ''
	);

	let goalDisplay = $derived(
		raidInstance ? raidInstance.goal_ids.map((g) => stripDsonPrefix(g)).join(', ') : ''
	);

	let locationDisplay = $derived(raidData?.base_root.in_area ?? '');
	let inBattle = $derived(raidData?.base_root.inbattle ?? false);

	/** Root torchlight is decoded as a float by the codec. */
	let torchlightValue = $derived(raidData?.base_root.torchlight ?? 0);

	let hungerBufferValue = $derived(party?.hunger_room_buffer ?? 0);

	/** Map hero GUIDs from party order to HeroSummary for display. */
	let partyHeroes = $derived.by(() => {
		if (!party) return [];
		return party.heroes.map((guid, index) => {
			const hero = heroes.find((h) => h.guid === String(guid));
			return {
				position: index + 1,
				guid,
				name: hero?.name ?? null,
				heroClass: hero?.heroClass ?? null,
				classDisplayName: hero
					? (CLASS_DISPLAY_NAMES[hero.heroClass] ?? hero.heroClass)
					: null
			};
		});
	});

	/** Inventory items as a flat array. */
	let inventoryItems = $derived.by(() => {
		if (!party) return [];
		return Object.entries(party.inventory.items).map(([key, item]) => ({
			key,
			...(item as InventoryItem)
		}));
	});

	// ── Handlers ──

	async function handleCreateBackup() {
		const settings = getSettings();
		if (!settings.savePath) return;
		try {
			await createBackup(settings.savePath);
			toast.success('Backup created');
		} catch (err) {
			toast.error('Backup failed', { description: String(err) });
		}
	}

	function openAbandonDialog() {
		abandonConfirmChecked = false;
		abandonDialogOpen = true;
	}

	function handleAbandonRaid() {
		const reason = abandonRaid();
		if (reason) { toast.error(reason); return; }
		abandonDialogOpen = false;
		toast.success('Raid abandoned', {
			description: 'Party returned to town and raid pointer cleared. Save to apply changes.'
		});
	}
</script>

<!-- No raid, no inconsistency — show empty state -->
{#if !raidFileExists && !gameInRaid}
	<EmptyState
		title="No active raid"
		description="Start a dungeon in-game to see raid data here. Raid editing is available only during an active expedition."
	/>

<!-- Inconsistent state — raid file exists but inraid disagrees (or vice versa) -->
{:else if isInconsistent}
	<div class="mx-auto max-w-2xl space-y-4 p-6">
		<Alert.Root class="border-amber-500/50 bg-amber-500/5">
			<WarningIcon size={16} class="text-amber-500" />
			<Alert.Title class="text-amber-700 dark:text-amber-400">
				Raid State Inconsistent
			</Alert.Title>
			<Alert.Description class="text-amber-600 dark:text-amber-400/80">
				{#if raidFileExists && !gameInRaid}
					persist.raid.json exists but <code class="text-xs">inraid</code> is
					<code class="text-xs">false</code> in persist.game.json.
				{:else}
					persist.game.json reports <code class="text-xs">inraid: true</code> but
					persist.raid.json was not found.
				{/if}
				Backup recommended before editing.
			</Alert.Description>
			<Alert.Action>
				<Button variant="outline" size="sm" onclick={handleCreateBackup}>
					Create Backup Now
				</Button>
			</Alert.Action>
		</Alert.Root>
	</div>

<!-- Active raid — full view -->
{:else}
	<ScrollArea class="h-full">
	<div class="space-y-6 p-6">
		<!-- Warning Banner (always visible, not dismissable) -->
		<Alert.Root class="border-amber-500/50 bg-amber-500/5">
			<WarningIcon size={16} class="text-amber-500" />
			<Alert.Title class="text-amber-700 dark:text-amber-400">
				High-Risk Editing
			</Alert.Title>
			<Alert.Description class="text-amber-600 dark:text-amber-400/80">
				Editing during a raid is high-risk. Changes must remain consistent across
				persist.raid.json and persist.roster.json. Incorrect edits may corrupt your save.
			</Alert.Description>
			<Alert.Action>
				<Button variant="outline" size="sm" onclick={handleCreateBackup}>
					Create Backup Now
				</Button>
			</Alert.Action>
		</Alert.Root>

		<!-- Raid Info Section -->
		<section>
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
					Raid Info
				</h2>
				<Button variant="destructive" size="sm" class="gap-1.5 text-xs" disabled={!!abandonBlockedReason} onclick={openAbandonDialog}>
					<SkullIcon size={14} />
					Abandon Raid
				</Button>
			</div>
			{#if abandonBlockedReason}<p class="mb-3 text-xs text-muted-foreground">{abandonBlockedReason}</p>{/if}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
				<RaidInfoCard label="Dungeon" value={dungeonLabel || 'Unknown'} />
				<RaidInfoCard label="Difficulty" value={difficultyLabel || 'Unknown'} />
				<RaidInfoCard label="Length" value={lengthLabel || 'Unknown'} />
				<RaidInfoCard label="Quest Type" value={raidInstance?.type ?? 'Unknown'} />
				<RaidInfoCard label="Location" value={String(locationDisplay || 'Unknown')} />
				<RaidInfoCard label="In Battle" value={inBattle ? 'Yes' : 'No'} />
			</div>
			{#if goalDisplay}
				<div class="mt-3 flex items-center gap-2">
					<span class="text-xs font-medium text-muted-foreground">Goals:</span>
					{#each (raidInstance?.goal_ids ?? []) as goalId}
						<Badge variant="outline" class="text-[11px] font-normal">
							{stripDsonPrefix(goalId)}
						</Badge>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Party Section -->
		<section>
			<div class="mb-3 flex items-center gap-2">
				<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
					Party
				</h2>
				<span class="text-[10px] text-muted-foreground/70">
					Left-to-right = positions 1-4 (index 0 = back rank)
				</span>
			</div>
			<div class="flex gap-3">
				{#each partyHeroes as slot, index (slot.guid)}
					<div class="flex flex-col items-center gap-1">
						<PartySlot
							position={slot.position}
							heroName={slot.name}
							heroClass={slot.classDisplayName}
						/>
						<!-- Arrow buttons are the intentional reorder UX for party positions.
						     svelte-dnd-action was considered but has Svelte 5 compatibility issues.
						     Arrow buttons are simpler, accessible, and sufficient for a 4-slot party. -->
						<div class="flex gap-1">
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6"
								disabled={index === 0}
								onclick={() => swapPartyPositions(index - 1, index)}
								aria-label="Move left"
							>
								<ArrowUpIcon size={12} class="-rotate-90" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6"
								disabled={index === partyHeroes.length - 1}
								onclick={() => swapPartyPositions(index, index + 1)}
								aria-label="Move right"
							>
								<ArrowDownIcon size={12} class="-rotate-90" />
							</Button>
						</div>
					</div>
				{/each}
				<!-- Fill empty slots up to 4 -->
				{#each Array(Math.max(0, 4 - partyHeroes.length)) as _, i}
					<PartySlot
						position={partyHeroes.length + i + 1}
						heroName={null}
						heroClass={null}
					/>
				{/each}
			</div>
			<p class="mt-2 text-[10px] text-muted-foreground/70">
				Use arrow buttons to reorder heroes within the party.
			</p>
		</section>

		<!-- Raid Parameters Section -->
		<section>
			<h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
				Raid Parameters
			</h2>
			<Card.Root>
				<Card.Content class="pt-0">
					<div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
						<!-- Torchlight Slider -->
						<div class="space-y-2">
							<div class="flex items-center justify-between">
								<label for="torchlight" class="text-xs font-medium">
									Torchlight
								</label>
								<span class="text-xs tabular-nums text-muted-foreground">
									{torchlightValue.toFixed(1)}
								</span>
							</div>
							<Slider
								type="single"
								{...sliderControl(torchlightValue, { min: 0, max: 100, step: 0.5 }, setRaidTorchlight)}
							/>
							<p class="text-[10px] text-muted-foreground/70">
								Light level from 0 to 100.
							</p>
						</div>

						<!-- Hunger Room Buffer -->
						<div class="space-y-2">
							<label for="hunger-buffer" class="text-xs font-medium">
								Hunger Room Buffer
							</label>
							<IntegerInput id="hunger-buffer" label="Hunger room buffer" value={hungerBufferValue}
								onchange={setRaidHungerBuffer} class="h-8 tabular-nums" />
							<p class="text-[10px] text-muted-foreground/70">
								Integer. Rooms until next hunger check.
							</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>
		</section>

		<!-- Raid Inventory Section -->
		<section>
			<div class="mb-3 flex items-center gap-2">
				<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
					Inventory
				</h2>
				{#if inventoryItems.length > 0}
					<Badge variant="outline" class="text-[10px] font-normal">
						{inventoryItems.length} item{inventoryItems.length !== 1 ? 's' : ''}
					</Badge>
				{/if}
			</div>
			{#if inventoryItems.length === 0}
				<Card.Root>
					<Card.Content class="pt-0">
						<div class="flex min-h-20 items-center justify-center">
							<p class="text-sm text-muted-foreground">No items in raid inventory</p>
						</div>
					</Card.Content>
				</Card.Root>
			{:else}
				{#if abandonBlockedReason}<p class="mb-3 text-xs text-muted-foreground">{abandonBlockedReason}</p>{/if}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
					{#each inventoryItems as item (item.key)}
						<Card.Root class="gap-2 p-3">
							<div class="flex items-center gap-2">
								<BackpackIcon size={14} class="shrink-0 text-muted-foreground" />
								<span class="truncate text-xs font-medium">{item.id}</span>
							</div>
							<div class="flex items-center gap-2">
								<Badge variant="outline" class="text-[10px] font-normal">
									{item.type}
								</Badge>
								<IntegerInput label={`${item.id} amount`} value={item.amount}
									onchange={(value) => setRaidItemAmount(item.key, value)} class="h-6 w-24 text-xs tabular-nums" />
							</div>
						</Card.Root>
					{/each}
				</div>
			{/if}
		</section>
	</div>
	</ScrollArea>
{/if}

<!-- ═══════ Abandon Raid Confirmation Dialog ═══════ -->
<Dialog.Root bind:open={abandonDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-sm text-destructive">
				<SkullIcon size={18} />
				Abandon Raid
			</Dialog.Title>
			<Dialog.Description>
				This returns living expedition heroes to town, clears the raid pointer and deletes the raid save when you Save. Discard restores the expedition before saving.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-3">
			<div class="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-3">
				<WarningIcon size={14} class="mt-0.5 shrink-0 text-amber-500" />
				<p class="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
					Abandoning a raid will remove the party from the dungeon. All living heroes marked as on an expedition will have their town status restored. Create a backup before proceeding.
				</p>
			</div>

			<label class="flex items-center gap-2">
				<Checkbox bind:checked={abandonConfirmChecked} />
				<span class="text-[11px]">I understand this will abandon the active raid</span>
			</label>
		</div>

		<Dialog.Footer class="flex-row justify-end gap-2 sm:justify-end">
			<Button variant="outline" size="sm" onclick={() => (abandonDialogOpen = false)}>
				Cancel
			</Button>
			<Button
				variant="destructive"
				size="sm"
				disabled={!abandonConfirmChecked}
				onclick={handleAbandonRaid}
			>
				<SkullIcon size={14} class="mr-1" />
				Abandon Raid
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
