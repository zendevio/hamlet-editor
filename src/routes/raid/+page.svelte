<script lang="ts">
	import { t, describeMessage } from '#lib/i18n/index.svelte.js';
	import Message from '#lib/i18n/Message.svelte';
	import { formatList, formatNumber } from '#lib/i18n/intl.js';
	import { heroClassName, dungeonName, dungeonNameLang, raidDifficultyName, raidDifficultyLang, raidLengthName, raidLengthLang, gameTextLocale } from '#lib/save-labels.js';
	import { sliderControl, sliderValueLabel } from '#lib/control-events.js';
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
		setRaidTorchlight,
		setRaidHungerBuffer,
		setRaidItemAmount,
		abandonRaid,
		swapPartyPositions
	} from '#lib/stores/save-data.svelte.js';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import { abandonRaidBlockReason, abandonRaidInventory, raidItemLabel } from '#lib/raid.js';
	import { stripDsonPrefix } from '#lib/utils.js';
	import type { RaidData, InventoryItem } from '#lib/types/save-data.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import ArrowDownIcon from 'phosphor-svelte/lib/ArrowDownIcon';
	import SkullIcon from 'phosphor-svelte/lib/SkullIcon';
	import { showError, showMessageError } from '#lib/i18n/notifications.js';
	import { toast } from 'svelte-sonner';
	import { createBackup } from '#lib/api/backup.js';
	import { getSettings } from '#lib/stores/settings.svelte.js';

	// ── State ──

	const saveData = getSaveData();

	// Abandon raid dialog
	let abandonDialogOpen = $state(false);
	let abandonConfirmChecked = $state(false);

	/** Raid data from persist.raid.json; sourced from the shared save-data store. */
	let raidData = $derived(saveData.raid as RaidData | null);
	let abandonBlockedReason = $derived(abandonRaidBlockReason(saveData.game, raidData, saveData.roster, saveData.estate));

	/** Whether persist.game.json reports inraid: true; sourced from the shared save-data store. */
	let gameInRaid = $derived(saveData.gameInRaid);

	// ── Derived ──

	let raidFileExists = $derived(raidData !== null);
	let isInconsistent = $derived(gameInRaid && !raidFileExists);
	let abandonInventory = $derived(abandonRaidInventory(raidData));

	let raidInstance = $derived(raidData?.base_root.raid_instance ?? null);
	let party = $derived(raidData?.base_root.party ?? null);
	let heroes = $derived(getHeroes());

	let dungeonLabel = $derived(raidInstance ? dungeonName(raidInstance.dungeon) : '');
	let difficultyLabel = $derived(raidInstance ? raidDifficultyName(raidInstance.difficulty) : '');
	let lengthLabel = $derived(raidInstance ? raidLengthName(raidInstance.length) : '');
	let goalDisplay = $derived(formatList(raidInstance?.goal_ids.map(stripDsonPrefix) ?? []));

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
					? heroClassName(hero.heroClass)
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
			toast.success(t('settings.backupCreated'));
		} catch (err) {
			showError(err, { id: 'error.backupFailed' });
		}
	}

	function openAbandonDialog() {
		abandonConfirmChecked = false;
		abandonDialogOpen = true;
	}

	function handleAbandonRaid() {
		const reason = abandonRaid();
		if (reason) { showMessageError(reason); return; }
		abandonDialogOpen = false;
		toast.success(t('raid.abandoned'), {
			description: t('raid.abandonedDescription')
		});
	}
</script>

<!-- No raid, no inconsistency; show empty state -->
{#if !gameInRaid}
	<EmptyState
		title={t('raid.emptyTitle')}
		description={t('raid.emptyDescription')}
	/>

<!-- Inconsistent state; raid file exists but inraid disagrees (or vice versa) -->
{:else if isInconsistent}
	<div class="mx-auto max-w-2xl space-y-4 p-6">
		<!-- Narrow alerts put the action below the text: the corner slot reserves only 72px. -->
		<div class="@container">
		<Alert.Root class="border-amber-500/50 bg-amber-500/5 @max-lg:pr-2.5">
			<WarningIcon size={16} class="text-amber-500" />
			<Alert.Title class="text-amber-700 dark:text-amber-400">{t('raid.inconsistentTitle')}</Alert.Title>
			<Alert.Description class="text-amber-600 dark:text-amber-400/80">
				<Message id="raid.inconsistent" params={{}}>
					{#snippet code(children)}<code class="text-xs">{@render children()}</code>{/snippet}
					{#snippet emphasis(children)}<em>{@render children()}</em>{/snippet}
					{#snippet link(children)}<span>{@render children()}</span>{/snippet}
				</Message>
			</Alert.Description>
			<Alert.Action class="@max-lg:static @max-lg:col-start-2 @max-lg:mt-1.5">
				<Button variant="outline" size="sm" onclick={handleCreateBackup}>{t('raid.backup')}</Button>
			</Alert.Action>
		</Alert.Root>
		</div>
	</div>

<!-- Active raid; full view -->
{:else}
	<ScrollArea class="h-full" data-testid="raid-page">
	<div class="space-y-6 p-6">
		<!-- Warning Banner (always visible, not dismissable). Narrow banners put the
		     action below the text: the corner slot reserves only 72px. -->
		<div class="@container">
		<Alert.Root class="border-amber-500/50 bg-amber-500/5 @max-lg:pr-2.5">
			<WarningIcon size={16} class="text-amber-500" />
			<Alert.Title class="text-amber-700 dark:text-amber-400">{t('raid.riskTitle')}</Alert.Title>
			<Alert.Description class="text-amber-600 dark:text-amber-400/80">{t('raid.risk')}</Alert.Description>
			<Alert.Action class="@max-lg:static @max-lg:col-start-2 @max-lg:mt-1.5">
				<Button variant="outline" size="sm" onclick={handleCreateBackup}>{t('raid.backup')}</Button>
			</Alert.Action>
		</Alert.Root>
		</div>

		<!-- Raid Info Section -->
		<section>
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('raid.info')}</h2>
				<Button variant="destructive" size="sm" class="gap-1.5 text-xs" disabled={!!abandonBlockedReason} onclick={openAbandonDialog}>
					<SkullIcon size={14} />
					{t('raid.abandon')}
				</Button>
			</div>
			{#if abandonBlockedReason}<p data-testid="raid-safety-refusal" class="mb-3 text-xs text-muted-foreground">{describeMessage(abandonBlockedReason)}</p>{/if}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
				<RaidInfoCard label={t('raid.dungeon')} valueLang={dungeonLabel && raidInstance ? dungeonNameLang(raidInstance.dungeon) : undefined} value={dungeonLabel || t('raid.unknown')} />
				<RaidInfoCard label={t('raid.difficulty')} valueLang={difficultyLabel && raidInstance ? raidDifficultyLang(raidInstance.difficulty) : undefined} value={difficultyLabel || t('raid.unknown')} />
				<RaidInfoCard label={t('raid.length')} valueLang={lengthLabel && raidInstance ? raidLengthLang(raidInstance.length) : undefined} value={lengthLabel || t('raid.unknown')} />
				<RaidInfoCard label={t('raid.questType')} value={raidInstance?.type ?? t('raid.unknown')} />
				<RaidInfoCard label={t('raid.location')} value={String(locationDisplay || t('raid.unknown'))} />
				<RaidInfoCard label={t('raid.inBattle')} value={inBattle ? t('raid.yes') : t('raid.no')} />
			</div>
			{#if goalDisplay}
				<div class="mt-3 flex items-center gap-2">
					<span class="text-xs font-medium text-muted-foreground">{t('raid.goals')}</span>
					<Badge variant="outline" class="text-[11px] font-normal">{goalDisplay}</Badge>
				</div>
			{/if}
		</section>

		<!-- Party Section -->
		<section>
			<div class="mb-3 flex items-center gap-2">
				<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('raid.party')}</h2>
				<span class="text-[10px] text-muted-foreground/70">{t('raid.partyPositions')}</span>
			</div>
			<div class="flex flex-wrap gap-3">
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
								aria-label={t('raid.moveLeft')}
							>
								<ArrowUpIcon size={12} class="-rotate-90" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6"
								disabled={index === partyHeroes.length - 1}
								onclick={() => swapPartyPositions(index, index + 1)}
								aria-label={t('raid.moveRight')}
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
			<p class="mt-2 text-[10px] text-muted-foreground/70">{t('raid.reorderHint')}</p>
		</section>

		<!-- Raid Parameters Section -->
		<section>
			<h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('raid.parameters')}</h2>
			<Card.Root>
				<Card.Content class="pt-0">
					<div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
						<!-- Torchlight Slider -->
						<div class="space-y-2">
							<div class="flex items-center justify-between">
								<label for="torchlight" class="text-xs font-medium">{t('raid.torchlight')}</label>
								<span class="text-xs tabular-nums text-muted-foreground">
									{sliderValueLabel(torchlightValue, { min: 0, max: 100, step: 0.5 })}
								</span>
							</div>
							<Slider
								type="single"
								{...sliderControl(torchlightValue, { min: 0, max: 100, step: 0.5 }, setRaidTorchlight)}
							/>
							<p class="text-[10px] text-muted-foreground/70">{t('raid.lightHint')}</p>
						</div>

						<!-- Hunger Room Buffer -->
						<div class="space-y-2">
							<label for="hunger-buffer" class="text-xs font-medium">{t('raid.hungerBuffer')}</label>
							<IntegerInput id="hunger-buffer" label={t('raid.hungerInput')} value={hungerBufferValue}
								onchange={setRaidHungerBuffer} class="h-8 tabular-nums" />
							<p class="text-[10px] text-muted-foreground/70">{t('raid.hungerHint')}</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>
		</section>

		<!-- Raid Inventory Section -->
		<section>
			<div class="mb-3 flex items-center gap-2">
				<h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t('raid.inventory')}</h2>
				{#if inventoryItems.length > 0}
					<Badge variant="outline" class="text-[10px] font-normal">
						{t('raid.itemCount', { count: inventoryItems.length, countText: formatNumber(inventoryItems.length) })}
					</Badge>
				{/if}
			</div>
			{#if inventoryItems.length === 0}
				<Card.Root>
					<Card.Content class="pt-0">
						<div class="flex min-h-20 items-center justify-center">
							<p class="text-sm text-muted-foreground">{t('raid.emptyInventory')}</p>
						</div>
					</Card.Content>
				</Card.Root>
			{:else}
				{#if abandonBlockedReason}<p class="mb-3 text-xs text-muted-foreground">{describeMessage(abandonBlockedReason)}</p>{/if}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
					{#each inventoryItems as item (item.key)}
						<Card.Root class="min-w-0 gap-2 p-3">
							<div class="flex items-center gap-2">
								<BackpackIcon size={14} class="shrink-0 text-muted-foreground" />
								<span class="truncate text-xs font-medium" title={raidItemLabel(item)} lang={gameTextLocale()}>{raidItemLabel(item)}</span>
							</div>
							<div class="flex flex-wrap items-center gap-2">
								<Badge variant="outline" class="text-[10px] font-normal">
									{item.type}
								</Badge>
								<IntegerInput label={t('estate.amountFor', { name: raidItemLabel(item) })} value={item.amount}
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
				{t('raid.abandon')}
			</Dialog.Title>
			<Dialog.Description>{t('raid.abandonDescription')}</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-3">
			<div class="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-3">
				<WarningIcon size={14} class="mt-0.5 shrink-0 text-amber-500" />
				<p class="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">{t('raid.abandonWarning')}</p>
			</div>

			<p class="text-xs">{t('raid.returnedTrinkets', { count: abandonInventory.returnedTrinkets, countText: formatNumber(abandonInventory.returnedTrinkets) })}</p>
			<ul class="list-disc pl-5 text-xs">
				{#each abandonInventory.lost as item}
					<li><Message id="raid.lostItem" params={{ name: raidItemLabel(item), amount: formatNumber(item.amount) }}>
						{#snippet emphasis(children)}<span lang={gameTextLocale()}>{@render children()}</span>{/snippet}
						{#snippet code(children)}<code>{@render children()}</code>{/snippet}
						{#snippet link(children)}<span>{@render children()}</span>{/snippet}
					</Message></li>
				{:else}
					<li>{t('raid.noLoot')}</li>
				{/each}
			</ul>
			<label class="flex items-center gap-2">
				<Checkbox bind:checked={abandonConfirmChecked} />
				<span class="text-[11px]">{t('raid.confirm')}</span>
			</label>
		</div>

		<Dialog.Footer class="flex-row flex-wrap justify-end gap-2 sm:justify-end">
			<Button variant="outline" size="sm" onclick={() => (abandonDialogOpen = false)}>{t('raid.cancel')}</Button>
			<Button
				variant="destructive"
				size="sm"
				disabled={!abandonConfirmChecked || !!abandonBlockedReason}
				onclick={handleAbandonRaid}
			>
				<SkullIcon size={14} class="mr-1" />
				{t('raid.abandon')}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
