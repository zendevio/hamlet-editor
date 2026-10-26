<script lang="ts">
	import { t, describeMessage, type MessageDescriptor } from '#lib/i18n/index.svelte.js';
	import { commitChangedValue } from '#lib/control-events.js';
	import { validateHeroName } from '#lib/input-validation.js';
	import { WALLET_MAX } from '#lib/estate.js';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import IntegerInput from '#lib/components/IntegerInput.svelte';
	import WalletCard from '#lib/components/estate/WalletCard.svelte';
	import TrinketCard from '#lib/components/estate/TrinketCard.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import CurrencyDollarIcon from 'phosphor-svelte/lib/CurrencyDollarIcon';
	import ScrollIcon from 'phosphor-svelte/lib/ScrollIcon';
	import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
	import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
	import ShieldIcon from 'phosphor-svelte/lib/ShieldIcon';
	import DiamondIcon from 'phosphor-svelte/lib/DiamondIcon';
	import DropIcon from 'phosphor-svelte/lib/DropIcon';
	import EnvelopeIcon from 'phosphor-svelte/lib/EnvelopeIcon';
	import WrenchIcon from 'phosphor-svelte/lib/WrenchIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import { catalogueTrinket } from '#lib/trinkets.js';
	import TrinketPicker from '#lib/components/heroes/TrinketPicker.svelte';
	import { getSaveData, markDirty, setWalletAmount, setEstateItemAmount, setEstateName, getDlcFlags, loadMockData, getHeroes } from '#lib/stores/save-data.svelte.js';
	import { gameTextLocale, currencyName, currencyNameLang, estateItemName, trinketName, trinketEnglishName } from '#lib/save-labels.js';
	import { formatNumber, compareNames, compareIds } from '#lib/i18n/intl.js';
	import { matchesSearch } from '#lib/search.js';
	import { getSettings } from '#lib/stores/settings.svelte.js';
	import GameAssetIcon from '#lib/components/GameAssetIcon.svelte';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import type { WalletEntry, TrinketEntry, EstateItem } from '#lib/types/save-data.js';

	// ----- Props / State -----

	const saveData = getSaveData();
	const dlcFlags = getDlcFlags();
	const settings = getSettings();

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
	let estateNameError = $state<MessageDescriptor | null>(null);
	let estateNameAtStart = '';

	$effect(() => {
		if (!estateNameEditing) {
			estateNameValue = saveData.game?.base_root?.estatename ?? '';
		}
	});

	function handleEstateNameBlur() {
		if (!estateNameEditing) return;
		const current = saveData.game?.base_root?.estatename ?? '';
		if (current !== estateNameAtStart) {
			estateNameEditing = false;
			return;
		}
		if (estateNameValue === estateNameAtStart) {
			estateNameError = null;
			estateNameEditing = false;
			return;
		}
		const parsed = validateHeroName(estateNameValue);
		estateNameError = parsed.error ?? null;
		if (parsed.error !== undefined) return;
		commitChangedValue(current, parsed.value, (name) => {
			estateNameError = setEstateName(name) ?? null;
		});
		if (!estateNameError) estateNameEditing = false;
	}

	function handleEstateNameKeydown(e: KeyboardEvent) {
		if (e.isComposing || e.keyCode === 229) return;
		if (e.key === 'Enter') {
			(e.target as HTMLElement)?.blur();
		}
		if (e.key === 'Escape') {
			estateNameValue = saveData.game?.base_root?.estatename ?? '';
			estateNameError = null;
			estateNameEditing = false;
			(e.target as HTMLElement)?.blur();
		}
	}

	// DLC flags: prefer GameInstall detection (set during setup), fall back to
	// save-data heuristics. Both paths are handled inside getDlcFlags().
	let hasCrimsonCourt = $derived(dlcFlags.hasCrimsonCourt);
	let hasColorOfMadness = $derived(dlcFlags.hasColorOfMadness);

	// Count of trinkets equipped on heroes across all heroes in the roster
	let equippedTrinketCount = $derived(getHeroes().reduce((count, h) => count + Object.keys(h.trinkets ?? {}).length, 0));

	// Add Trinket picker state
	let trinketSearch = $state('');

	// ----- Derived data -----

	const walletCurrencies = [
		{ type: 'gold', icon: CurrencyDollarIcon, asset: 'shared/estate/currency.gold.large_icon.png' },
		{ type: 'bust', icon: ScrollIcon, asset: 'shared/estate/currency.bust.icon.png' },
		{ type: 'portrait', icon: ImageIcon, asset: 'shared/estate/currency.portrait.icon.png' },
		{ type: 'deed', icon: FileTextIcon, asset: 'shared/estate/currency.deed.icon.png' },
		{ type: 'crest', icon: ShieldIcon, asset: 'shared/estate/currency.crest.icon.png' }
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
		return Object.entries(estateData.trinkets.items).map(([key, item]) => ({ ...item, key })).sort((a, b) =>
			compareNames(trinketName(a.id), a.id, trinketName(b.id), b.id, gameTextLocale()) ||
			compareIds(a.key, b.key));
	});

	/** Filtered trinkets based on search query. */
	let filteredTrinkets = $derived(
		trinketSearch.trim().length === 0
			? trinkets
			: trinkets.filter((item) => matchesSearch(trinketSearch, trinketName(item.id), trinketEnglishName(item.id), item.id))
	);

	/** Estate items (invitations and blood). */
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
	 * Blood vials: uses explicit ID lookup, NOT type filtering.
	 * Blood has type "estate", not "estate_currency".
	 */
	let bloodAmount = $derived(
		estateItems.find((i) => i.id === 'the_blood')?.amount ?? 0
	);

	/** Blueprint count (CC DLC). */
	let blueprintCount = $derived(
		walletAmounts?.['blueprint'] ?? 0
	);

	// ----- Handlers -----

	function handleRemoveTrinket(trinketId: string) {
		if (!estateData || !saveData.estate) return;
		const entries = Object.entries(estateData.trinkets.items);
		const match = entries.find(([, item]) => item.id === trinketId);
		if (match) {
			delete saveData.estate.base_root.trinkets.items[match[0]];
			markDirty('persist.estate.json');
		}
	}

	function handleTrinketSelected(trinketId: string) {
		if (!estateData || !saveData.estate || !trinketId) return;
		const existingKeys = Object.keys(estateData.trinkets.items).map(Number).filter((n) => !isNaN(n));
		const nextKey = existingKeys.length > 0 ? Math.max(...existingKeys) + 1 : 0;
		saveData.estate.base_root.trinkets.items[String(nextKey)] = catalogueTrinket(trinketId, saveData.estate.base_root.trinkets.items);
		markDirty('persist.estate.json');
	}

</script>

{#if !saveData.isLoaded}
	<div class="flex flex-col items-center gap-4">
		<EmptyState
			title={t('shell.noProfile')}
			description={t('estate.noProfileHelp')}
		/>
		{#if import.meta.env.DEV}
			<Button variant="outline" size="sm" onclick={loadMockData}>
				{t('heroes.loadMock')}
			</Button>
		{/if}
	</div>
{:else if !estateData}
	<EmptyState
		title={t('estate.noData')}
		description={t('estate.noDataHelp')}
	/>
{:else}
	<ScrollArea class="h-full">
	<div data-testid="estate-page" class="space-y-8 p-6">
		<!-- D6: Estate Name + Endless Mode -->
		<section>
			<div class="flex items-start gap-6">
				<div class="flex-1">
					<h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
						{t('estate.name')}
					</h2>
					<div class="max-w-sm">
						<Input
							bind:value={estateNameValue}
							onfocus={() => { estateNameAtStart = saveData.game?.base_root?.estatename ?? ''; estateNameEditing = true; }}
							onblur={handleEstateNameBlur}
							onkeydown={handleEstateNameKeydown}
							placeholder={t('estate.namePlaceholder')}
							aria-label={t('estate.name')}
							aria-invalid={!!estateNameError}
							class="h-9 text-sm"
						/>
						{#if estateNameError}<p class="mt-1 text-xs text-destructive">{describeMessage(estateNameError)}</p>{/if}
					</div>
				</div>
				{#if hasColorOfMadness && estateData?.endless_wave_highscore !== undefined}
					<div>
						<h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
							{t('estate.endless')}
						</h2>
						<div class="flex items-center gap-2">
							<span class="text-sm text-muted-foreground">{t('estate.highscore')}</span>
							<Badge variant="outline" class="tabular-nums">{formatNumber(estateData.endless_wave_highscore)}</Badge>
						</div>
					</div>
				{/if}
			</div>
		</section>

		<!-- Wallet Section -->
		<section>
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
				{t('estate.wallet')}
			</h2>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
				{#each walletCurrencies as currency}
					<WalletCard
						name={currencyName(currency.type)}
						nameLang={currencyNameLang(currency.type)}
						value={walletAmounts?.[currency.type] ?? 0}
						icon={currency.icon}
						gamePath={settings.gamePath}
						gameAssetPath={currency.asset}
						onchange={(v) => setWalletAmount(currency.type, v)}
					/>
				{/each}
				{#if hasColorOfMadness}
					<WalletCard
						name={currencyName('shard')}
						value={shardAmount}
						icon={DiamondIcon}
						gamePath={settings.gamePath}
						gameAssetPath="shared/estate/currency.shard.icon.png"
						onchange={(v) => setWalletAmount('shard', v)}
					/>
				{/if}
			</div>
		</section>

		<!-- Estate Currencies Section (Crimson Court DLC) -->
		{#if hasCrimsonCourt}
			<section>
				<h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
					{t('estate.currencies')}
				</h2>
				<Card.Root>
					<Card.Content class="pt-0">
						<div class="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
							<!-- Invitations -->
							<div class="space-y-2">
								<div class="flex h-6 items-center gap-2">
									<GameAssetIcon gamePath={settings.gamePath} relativePath="dlc/580100_crimson_court/features/crimson_court/panels/icons_equip/estate_currency/inv_estate_currency+crimson_court_invitation_A.png" alt={t('estate.invitations')} class="h-10 w-auto">
										{#snippet fallback()}<EnvelopeIcon class="text-muted-foreground size-10" />{/snippet}
									</GameAssetIcon>
									<span class="text-sm font-medium">{t('estate.invitations')}</span>
								</div>
								<div class="grid grid-cols-3 gap-2">
									<div class="space-y-1">
										<label lang={gameTextLocale()} for="inv-a" class="text-xs text-muted-foreground">{estateItemName('crimson_court_invitation_A')}</label>
										<IntegerInput lang={gameTextLocale()} id="inv-a" label={estateItemName('crimson_court_invitation_A')} value={invitationA} class="h-8 tabular-nums"
										onchange={(value) => setEstateItemAmount('crimson_court_invitation_A', value)} />
									</div>
									<div class="space-y-1">
										<label lang={gameTextLocale()} for="inv-b" class="text-xs text-muted-foreground">{estateItemName('crimson_court_invitation_B')}</label>
										<IntegerInput lang={gameTextLocale()} id="inv-b" label={estateItemName('crimson_court_invitation_B')} value={invitationB} class="h-8 tabular-nums"
										onchange={(value) => setEstateItemAmount('crimson_court_invitation_B', value)} />
									</div>
									<div class="space-y-1">
										<label lang={gameTextLocale()} for="inv-c" class="text-xs text-muted-foreground">{estateItemName('crimson_court_invitation_C')}</label>
										<IntegerInput lang={gameTextLocale()} id="inv-c" label={estateItemName('crimson_court_invitation_C')} value={invitationC} class="h-8 tabular-nums"
										onchange={(value) => setEstateItemAmount('crimson_court_invitation_C', value)} />
									</div>
								</div>
							</div>

							<!-- Blood Vials -->
							<div class="space-y-2">
								<div lang={gameTextLocale()} class="flex h-6 items-center gap-2">
									<GameAssetIcon gamePath={settings.gamePath} relativePath="dlc/580100_crimson_court/features/crimson_court/panels/icons_equip/estate/inv_estate+the_blood.png" alt={estateItemName('the_blood')} class="h-10 w-auto">
										{#snippet fallback()}<DropIcon class="text-muted-foreground size-10" />{/snippet}
									</GameAssetIcon>
									<span class="text-sm font-medium" lang={gameTextLocale()}>{estateItemName('the_blood')}</span>
								</div>
								<div class="space-y-1">
									<label for="blood-amount" class="text-xs text-muted-foreground">{t('estate.amount')}</label>
									<IntegerInput id="blood-amount" label={t('estate.amountFor', { name: estateItemName('the_blood') })} value={bloodAmount} class="h-8 tabular-nums"
										onchange={(value) => setEstateItemAmount('the_blood', value)} />
								</div>
							</div>

							<!-- Blueprints -->
							<div class="space-y-2">
								<div lang={gameTextLocale()} class="flex h-6 items-center gap-2">
									<GameAssetIcon gamePath={settings.gamePath} relativePath="dlc/580100_crimson_court/features/districts/shared/estate/currency.blueprint.icon.png" alt={currencyName('blueprint')} class="h-10 w-auto">
										{#snippet fallback()}<WrenchIcon class="text-muted-foreground size-10" />{/snippet}
									</GameAssetIcon>
									<span class="text-sm font-medium" lang={gameTextLocale()}>{currencyName('blueprint')}</span>
								</div>
								<div class="space-y-1">
									<label for="blueprint-amount" class="text-xs text-muted-foreground">{t('estate.amount')}</label>
									<IntegerInput id="blueprint-amount" max={WALLET_MAX} label={t('estate.amountFor', { name: currencyName('blueprint') })} value={blueprintCount} class="h-8 tabular-nums"
										onchange={(value) => setWalletAmount('blueprint', value)} />
								</div>
							</div>
						</div>
					</Card.Content>
				</Card.Root>
			</section>
		{/if}

		<!-- Trinket Storage Section -->
		<section>
			<div class="mb-4 flex items-center justify-between gap-3">
				<h2 class="shrink-0 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
					{t('estate.storage')}
				</h2>
				<div class="flex items-center gap-2">
					{#if equippedTrinketCount > 0}
						<Badge variant="outline" class="text-xs font-normal">
							{t('estate.equipped', { count: equippedTrinketCount, countText: formatNumber(equippedTrinketCount) })}
						</Badge>
					{/if}
					<TrinketPicker onselect={handleTrinketSelected} placeholder={t('estate.addTrinket')} />
					<div class="relative">
						<MagnifyingGlassIcon
							class="text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2"
							size={14}
						/>
						<Input
							placeholder={t('estate.searchStorage')}
							aria-label={t('estate.searchStorage')}
							bind:value={trinketSearch}
							class="h-7 w-48 pl-7 text-xs"
						/>
					</div>
				</div>
			</div>

			{#if trinkets.length === 0}
				<Card.Root>
					<Card.Content class="pt-0">
						<div class="flex min-h-30 flex-col items-center justify-center gap-3 text-center">
							<p class="text-sm text-muted-foreground">{t('estate.noTrinkets')}</p>
							<p class="text-xs text-muted-foreground/70">
								{t('estate.noTrinketsHelp')}
							</p>
						</div>
					</Card.Content>
				</Card.Root>
			{:else}
				<ScrollArea class="h-67.5">
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 pr-3">
						{#each filteredTrinkets as trinket (trinket.key)}
							<TrinketCard
								id={trinket.id}
								type={trinket.type}
								gamePath={settings.gamePath}
								onremove={handleRemoveTrinket}
							/>
						{/each}
					</div>
					{#if filteredTrinkets.length === 0 && trinkets.length > 0}
						<p class="py-8 text-center text-sm text-muted-foreground">{t('estate.noMatches')}</p>
					{/if}
				</ScrollArea>
			{/if}
		</section>
	</div>
	</ScrollArea>
{/if}
