<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Separator } from '$lib/components/ui/separator';
	import { Slider } from '$lib/components/ui/slider';
	import { Switch } from '$lib/components/ui/switch';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '$lib/components/ui/select';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '$lib/components/ui/collapsible';
	import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import BrainIcon from 'phosphor-svelte/lib/BrainIcon';
	import SkullIcon from 'phosphor-svelte/lib/SkullIcon';
	import LockIcon from 'phosphor-svelte/lib/LockIcon';
	import LockOpenIcon from 'phosphor-svelte/lib/LockOpenIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import PencilIcon from 'phosphor-svelte/lib/PencilIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import DropIcon from 'phosphor-svelte/lib/DropIcon';
	import type { HeroSummary, HeroQuirk } from '$lib/stores/save-data.svelte';
	import {
		getMaxHp,
		maxGearRank,
		getHeroRawData,
		setHeroHp,
		setHeroStress,
		setHeroName,
		setHeroLevel,
		setHeroWeaponRank,
		setHeroArmourRank,
		setHeroAffliction,
		setHeroDeathsDoor,
		healHeroToMax,
		reviveHero,
		dismissHero,
		removeHeroQuirk,
		toggleQuirkLock,
		addHeroQuirk,
		revertHero,
		markDirty,
		RESOLVE_LEVEL_NAMES,
		RESOLVE_XP_THRESHOLDS
	} from '$lib/stores/save-data.svelte';
	import { isPositiveQuirk, isDiseaseQuirk, getAllQuirks } from '$lib/data/quirks';
	import { snakeToTitle } from '$lib/utils';
	import RevivalWizard from './RevivalWizard.svelte';
	import TrinketPicker from './TrinketPicker.svelte';

	let {
		hero,
		onDismiss
	}: {
		hero: HeroSummary;
		onDismiss?: () => void;
	} = $props();

	// ── Section open states ──
	let identityOpen = $state(true);
	let vitalsOpen = $state(true);
	let quirksOpen = $state(false);
	let skillsOpen = $state(false);
	let equipmentOpen = $state(false);
	let bloodCurseOpen = $state(false);
	let actionsOpen = $state(true);

	// ── Quirk picker ──
	let showQuirkPicker = $state(false);
	let quirkPickerCategory = $state<'positive' | 'negative'>('positive');
	let quirkSearch = $state('');

	// ── Name editing ──
	let editingName = $state(false);
	let nameValue = $state('');

	// ── Revival wizard ──
	let revivalWizardOpen = $state(false);

	// ── Dismiss dialog ──
	let dismissDialogOpen = $state(false);
	let dismissConfirmChecked = $state(false);

	// ── Level change gear confirmation ──
	let pendingLevel = $state<number | null>(null);
	let pendingMaxGear = $state(0);

	// ── Derived ──
	let isDead = $derived(hero.status === 3);
	let resolveLevel = $derived(hero.resolveLevel);
	let maxGear = $derived(maxGearRank(resolveLevel));
	let maxHp = $derived(getMaxHp(hero.heroClass, hero.armourRank));

	let positiveQuirks = $derived(
		Object.entries(hero.quirks).filter(([id]) => isPositiveQuirk(id))
	);
	let negativeQuirks = $derived(
		Object.entries(hero.quirks).filter(([id]) => !isPositiveQuirk(id) && !isDiseaseQuirk(id))
	);
	let diseaseQuirks = $derived(
		Object.entries(hero.quirks).filter(([id]) => isDiseaseQuirk(id))
	);

	let negativeCount = $derived(negativeQuirks.length + diseaseQuirks.length);
	let canAddPositive = $derived(positiveQuirks.length < 5);
	let canAddNegative = $derived(negativeCount < 5);

	// ── Blood Curse derived ──
	const VAMPIRE_QUIRK_IDS = [
		'disease_vampire_passive',
		'disease_vampire_crave',
		'disease_vampire_wasting',
		'disease_vampire_blood_lust'
	] as const;
	const VAMPIRE_STATE_LABELS: Record<string, string> = {
		disease_vampire_passive: 'Sated',
		disease_vampire_crave: 'Craving',
		disease_vampire_wasting: 'Wasting',
		disease_vampire_blood_lust: 'Blood Lust'
	};

	let vampireQuirkId = $derived(
		Object.keys(hero.quirks).find((id) => id.startsWith('disease_vampire_')) ?? null
	);
	let hasBloodCurse = $derived(vampireQuirkId !== null);

	// ── Skills derived ──
	let combatSkillIds = $derived(Object.keys(hero.selectedCombatSkills));
	let campingSkillIds = $derived(Object.keys(hero.selectedCampingSkills));

	// ── Trinket slots derived ──
	let trinketSlot0 = $derived(
		hero.trinkets['0'] as { id?: string } | undefined
	);
	let trinketSlot1 = $derived(
		hero.trinkets['1'] as { id?: string } | undefined
	);

	// All quirks for the picker, filtered
	let allQuirks = getAllQuirks();
	let filteredPickerQuirks = $derived.by(() => {
		const existingIds = new Set(Object.keys(hero.quirks));
		const q = quirkSearch.trim().toLowerCase();
		return allQuirks.filter((quirk) => {
			if (existingIds.has(quirk.id)) return false;
			if (quirkPickerCategory === 'positive' && quirk.category !== 'positive') return false;
			if (quirkPickerCategory === 'negative' && quirk.category === 'positive') return false;
			if (q && !quirk.displayName.toLowerCase().includes(q) && !quirk.id.includes(q))
				return false;
			return true;
		});
	});

	function startEditName() {
		nameValue = hero.name;
		editingName = true;
	}

	function saveName() {
		if (nameValue.trim()) {
			setHeroName(hero.guid, nameValue.trim());
		}
		editingName = false;
	}

	function handleNameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') saveName();
		if (e.key === 'Escape') {
			editingName = false;
		}
	}

	// D7: Level change with inline gear confirmation
	function handleLevelChange(value: string) {
		const level = parseInt(value);
		if (isNaN(level)) return;

		setHeroLevel(hero.guid, level);

		const newMaxGear = maxGearRank(level);
		// Constrain if current ranks exceed the new max
		if (hero.weaponRank > newMaxGear) setHeroWeaponRank(hero.guid, newMaxGear);
		if (hero.armourRank > newMaxGear) setHeroArmourRank(hero.guid, newMaxGear);

		// Show inline gear-match prompt if both ranks are below the new max
		if (hero.weaponRank < newMaxGear || hero.armourRank < newMaxGear) {
			pendingLevel = level;
			pendingMaxGear = newMaxGear;
		}
	}

	function confirmGearMatch() {
		if (pendingLevel === null) return;
		setHeroWeaponRank(hero.guid, pendingMaxGear);
		setHeroArmourRank(hero.guid, pendingMaxGear);
		pendingLevel = null;
	}

	function declineGearMatch() {
		pendingLevel = null;
	}

	function handleHpSlider(value: number) {
		setHeroHp(hero.guid, value);
	}

	function handleStressSlider(value: number) {
		setHeroStress(hero.guid, value);
	}

	function openQuirkPicker(category: 'positive' | 'negative') {
		quirkPickerCategory = category;
		quirkSearch = '';
		showQuirkPicker = true;
	}

	function pickQuirk(quirkId: string) {
		const newQuirk: HeroQuirk = {
			is_locked: false,
			is_new: true,
			mission_count: 0,
			replaces_quirk: 0,
			replaces_quirk_viewed: false,
			evolution_duration_remaining: 0
		};
		addHeroQuirk(hero.guid, quirkId, newQuirk);
		showQuirkPicker = false;
	}

	// D2: Blood Curse state change
	function handleBloodCurseChange(newStateId: string) {
		if (!vampireQuirkId) return;
		// Remove old vampire quirk
		removeHeroQuirk(hero.guid, vampireQuirkId);
		// Add new vampire quirk
		const newQuirk: HeroQuirk = {
			is_locked: false,
			is_new: false,
			mission_count: 0,
			replaces_quirk: 0,
			replaces_quirk_viewed: false,
			evolution_duration_remaining: 0
		};
		addHeroQuirk(hero.guid, newStateId, newQuirk);
	}

	// D3: Trinket slot equip via TrinketPicker
	function handleTrinketSelect(slot: '0' | '1', trinketId: string) {
		const raw = getHeroRawData(hero.guid);
		if (!raw) return;
		if (trinketId) {
			raw.trinkets.items[slot] = { id: trinketId, type: 'trinket', amount: 1 };
		} else {
			delete raw.trinkets.items[slot];
		}
		markDirty('persist.roster.json');
	}

	// D8: Dismiss confirmation dialog
	function handleDismissConfirm() {
		dismissHero(hero.guid);
		dismissConfirmChecked = false;
		dismissDialogOpen = false;
		onDismiss?.();
	}

	function handleRevert() {
		revertHero(hero.guid);
	}
</script>

{#snippet quirkRow(id: string, quirk: HeroQuirk, colorClass: string)}
	<div
		class="flex items-center gap-1 rounded-none border px-2 py-1 {colorClass}"
	>
		<button
			class="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
			onclick={() => toggleQuirkLock(hero.guid, id)}
			title={quirk.is_locked ? 'Unlock quirk' : 'Lock quirk'}
			aria-label={quirk.is_locked ? `Unlock ${snakeToTitle(id)}` : `Lock ${snakeToTitle(id)}`}
		>
			{#if quirk.is_locked}
				<LockIcon size={11} class="text-yellow-500" />
			{:else}
				<LockOpenIcon size={11} />
			{/if}
		</button>
		<span class="flex-1 truncate text-[11px]">{snakeToTitle(id)}</span>
		<button
			class="cursor-pointer text-muted-foreground transition-colors hover:text-red-500"
			onclick={() => removeHeroQuirk(hero.guid, id)}
			title="Remove quirk"
			aria-label="Remove {snakeToTitle(id)}"
		>
			<XIcon size={11} />
		</button>
	</div>
{/snippet}

<ScrollArea class="h-full">
	<div class="space-y-4 p-4">
		<!-- Header -->
		<div class="flex items-start justify-between">
			<div class="flex items-center gap-3">
				<!-- Portrait placeholder -->
				<div
					class="bg-muted flex h-16 w-16 items-center justify-center text-lg uppercase {isDead
						? 'opacity-50'
						: ''}"
				>
					{#if isDead}
						<SkullIcon size={28} class="text-muted-foreground" />
					{:else}
						<span class="text-muted-foreground font-bold">
							{hero.heroClass.slice(0, 2)}
						</span>
					{/if}
				</div>
				<div>
					<!-- Status badge -->
					<div class="mb-1 flex items-center gap-1.5">
						<span class="h-2 w-2 rounded-full {hero.statusDotClass}"></span>
						<span class="text-xs font-medium {isDead ? 'text-red-500' : 'text-muted-foreground'}">
							{hero.statusLabel}
						</span>
					</div>
					<div class="text-muted-foreground text-xs">{hero.classDisplayName}</div>
				</div>
			</div>
			<Tooltip>
				<TooltipTrigger>
					<Button variant="ghost" size="sm" class="h-7 gap-1 text-xs" onclick={handleRevert}>
						<ArrowCounterClockwiseIcon size={12} />
						Reset
					</Button>
				</TooltipTrigger>
				<TooltipContent>Revert all unsaved changes for this hero</TooltipContent>
			</Tooltip>
		</div>

		<Separator />

		<!-- ═══════ Identity Section ═══════ -->
		<Collapsible bind:open={identityOpen}>
			<CollapsibleTrigger class="flex w-full items-center gap-2 py-1">
				{#if identityOpen}
					<CaretDownIcon size={14} class="text-muted-foreground" />
				{:else}
					<CaretRightIcon size={14} class="text-muted-foreground" />
				{/if}
				<span class="text-xs font-semibold uppercase tracking-wider">Identity</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div class="mt-2 space-y-3">
					<!-- Name -->
					<div>
						<span class="text-muted-foreground mb-1 block text-[11px]">Name</span>
						{#if editingName}
							<Input
								bind:value={nameValue}
								onblur={saveName}
								onkeydown={handleNameKeydown}
								class="h-8 text-sm"
								autofocus
							/>
						{:else}
							<button
								class="group flex w-full cursor-pointer items-center gap-2 rounded-none border border-transparent px-2 py-1 text-sm font-medium transition-colors hover:border-border hover:bg-muted/50"
								onclick={startEditName}
							>
								<span class="flex-1 text-left">{hero.name}</span>
								<PencilIcon
									size={12}
									class="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
								/>
							</button>
						{/if}
					</div>

					<!-- Class (read-only) -->
					<div>
						<span class="text-muted-foreground mb-1 block text-[11px]">Class</span>
						<div class="flex items-center gap-2 px-2 py-1 text-sm">
							<span>{hero.classDisplayName}</span>
							<Tooltip>
								<TooltipTrigger>
									<Badge variant="outline" class="h-4 text-[10px]">{hero.heroClass}</Badge>
								</TooltipTrigger>
								<TooltipContent>Internal class ID</TooltipContent>
							</Tooltip>
						</div>
					</div>

					<!-- Resolve Level -->
					<div>
						<span class="text-muted-foreground mb-1 block text-[11px]">Resolve Level</span>
						<Select type="single" value={String(resolveLevel)} onValueChange={(v: string) => handleLevelChange(v)}>
							<SelectTrigger class="h-8 w-full text-xs">
								<span>Lv {resolveLevel} — {RESOLVE_LEVEL_NAMES[resolveLevel]}</span>
							</SelectTrigger>
							<SelectContent>
								{#each Array(7) as _, i}
									<SelectItem value={String(i)}>
										Lv {i} — {RESOLVE_LEVEL_NAMES[i]} (XP: {RESOLVE_XP_THRESHOLDS[i]})
									</SelectItem>
								{/each}
							</SelectContent>
						</Select>
						<!-- D7: Inline gear match confirmation -->
						{#if pendingLevel !== null}
							<div class="mt-2 rounded-none border border-amber-500/30 bg-amber-500/5 p-2 text-[11px]">
								<p class="mb-1.5 font-medium text-amber-700 dark:text-amber-400">
									Update weapon &amp; armour rank to {pendingMaxGear}?
								</p>
								<div class="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										class="h-6 flex-1 text-[11px]"
										onclick={confirmGearMatch}
									>
										Yes
									</Button>
									<Button
										variant="ghost"
										size="sm"
										class="h-6 flex-1 text-[11px]"
										onclick={declineGearMatch}
									>
										No
									</Button>
								</div>
							</div>
						{/if}
					</div>
				</div>
			</CollapsibleContent>
		</Collapsible>

		<Separator />

		<!-- ═══════ Vitals Section ═══════ -->
		<Collapsible bind:open={vitalsOpen}>
			<CollapsibleTrigger class="flex w-full items-center gap-2 py-1">
				{#if vitalsOpen}
					<CaretDownIcon size={14} class="text-muted-foreground" />
				{:else}
					<CaretRightIcon size={14} class="text-muted-foreground" />
				{/if}
				<span class="text-xs font-semibold uppercase tracking-wider">Vitals</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div class="mt-2 space-y-4">
					<!-- HP -->
					<div>
						<div class="mb-2 flex items-center justify-between">
							<div class="flex items-center gap-1.5">
								<HeartIcon size={14} class="text-red-500" />
								<span class="text-[11px] font-medium">HP</span>
							</div>
							<div class="flex items-center gap-2">
								<span
									class="text-xs font-mono {hero.currentHp < maxHp * 0.5
										? 'text-red-500 font-bold'
										: 'text-muted-foreground'}"
								>
									{hero.currentHp} / {maxHp}
								</span>
								<Button
									variant="outline"
									size="sm"
									class="h-6 text-[11px]"
									onclick={() => healHeroToMax(hero.guid)}
									disabled={hero.currentHp >= maxHp}
								>
									Heal to Max
								</Button>
							</div>
						</div>
						<Slider
							value={hero.currentHp}
							max={maxHp}
							min={0}
							step={1}
							type="single"
							onValueChange={(v) => handleHpSlider(v)}
						/>
					</div>

					<!-- Stress -->
					<div>
						<div class="mb-2 flex items-center justify-between">
							<div class="flex items-center gap-1.5">
								<BrainIcon size={14} class="text-yellow-500" />
								<span class="text-[11px] font-medium">Stress</span>
							</div>
							<div class="flex items-center gap-2">
								<span
									class="text-xs font-mono {hero.stress >= 100
										? 'text-red-500 font-bold'
										: 'text-muted-foreground'}"
								>
									{hero.stress} / 200
								</span>
								<Button
									variant="outline"
									size="sm"
									class="h-6 text-[11px]"
									onclick={() => setHeroStress(hero.guid, 0)}
									disabled={hero.stress === 0}
								>
									Clear
								</Button>
							</div>
						</div>
						<Slider
							value={hero.stress}
							max={200}
							min={0}
							step={1}
							type="single"
							onValueChange={(v) => handleStressSlider(v)}
						/>
						{#if hero.stress >= 100}
							<p class="text-destructive mt-1 text-[11px]">
								Affliction threshold reached ({hero.afflictionTypeId || 'none set'})
							</p>
						{/if}
					</div>

					<!-- Affliction -->
					<div>
						<div class="mb-1 flex items-center justify-between">
							<span class="text-[11px] font-medium">Affliction / Virtue</span>
							{#if hero.afflictionTypeId}
								<Button
									variant="ghost"
									size="sm"
									class="h-5 text-[10px]"
									onclick={() => setHeroAffliction(hero.guid, '')}
								>
									Clear
								</Button>
							{/if}
						</div>
						<Select
							type="single"
							value={hero.afflictionTypeId || '_none'}
							onValueChange={(v: string) => setHeroAffliction(hero.guid, v === '_none' ? '' : v)}
						>
							<SelectTrigger class="h-8 text-xs">
								<span>{hero.afflictionTypeId ? snakeToTitle(hero.afflictionTypeId) : 'None'}</span>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="_none">None</SelectItem>
								<SelectItem value="paranoid">Paranoid</SelectItem>
								<SelectItem value="hopeless">Hopeless</SelectItem>
								<SelectItem value="selfish">Selfish</SelectItem>
								<SelectItem value="abusive">Abusive</SelectItem>
								<SelectItem value="fearful">Fearful</SelectItem>
								<SelectItem value="irrational">Irrational</SelectItem>
								<SelectItem value="masochistic">Masochistic</SelectItem>
								<SelectItem value="rapturous">Rapturous (Virtue)</SelectItem>
								<SelectItem value="courageous">Courageous (Virtue)</SelectItem>
								<SelectItem value="focused">Focused (Virtue)</SelectItem>
								<SelectItem value="powerful">Powerful (Virtue)</SelectItem>
								<SelectItem value="vigorous">Vigorous (Virtue)</SelectItem>
								<SelectItem value="stalwart">Stalwart (Virtue)</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<!-- Deaths Door -->
					<div class="bg-muted/30 flex items-center justify-between rounded-none p-2">
						<div>
							<span class="text-[11px] font-medium">Death's Door Visited</span>
							<Tooltip>
								<TooltipTrigger>
									<p class="text-muted-foreground text-[10px]">Historical flag only</p>
								</TooltipTrigger>
								<TooltipContent class="max-w-60">
									Indicates this hero has previously reached Death's Door. Does not directly affect
									current gameplay state.
								</TooltipContent>
							</Tooltip>
						</div>
						<Switch
							checked={hero.visitedDeathsDoor}
							onCheckedChange={(checked) => setHeroDeathsDoor(hero.guid, checked)}
						/>
					</div>
				</div>
			</CollapsibleContent>
		</Collapsible>

		<Separator />

		<!-- ═══════ Quirks Section ═══════ -->
		<Collapsible bind:open={quirksOpen}>
			<CollapsibleTrigger class="flex w-full items-center gap-2 py-1">
				{#if quirksOpen}
					<CaretDownIcon size={14} class="text-muted-foreground" />
				{:else}
					<CaretRightIcon size={14} class="text-muted-foreground" />
				{/if}
				<span class="text-xs font-semibold uppercase tracking-wider">Quirks</span>
				<Badge variant="outline" class="ml-auto h-4 text-[10px]">
					{positiveQuirks.length}+ / {negativeCount}-
				</Badge>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div class="mt-2 grid grid-cols-2 gap-4">
					<!-- Positive Column -->
					<div>
						<div class="mb-2 flex items-center justify-between">
							<span class="text-[11px] font-medium text-green-600 dark:text-green-400">
								Positive ({positiveQuirks.length}/5)
							</span>
						</div>
						<div class="space-y-1">
							{#each positiveQuirks as [id, quirk] (id)}
								{@render quirkRow(id, quirk, 'border-green-500/20 bg-green-500/5')}
							{/each}
						</div>
						{#if canAddPositive}
							<Button
								variant="ghost"
								size="sm"
								class="mt-1 h-6 w-full text-[11px]"
								onclick={() => openQuirkPicker('positive')}
							>
								<PlusIcon size={11} class="mr-1" />
								Add Positive
							</Button>
						{/if}
					</div>

					<!-- Negative + Disease Column -->
					<div>
						<div class="mb-2 flex items-center justify-between">
							<span class="text-[11px] font-medium text-red-600 dark:text-red-400">
								Negative ({negativeCount}/5)
							</span>
						</div>

						<!-- Diseases -->
						{#if diseaseQuirks.length > 0}
							<div class="mb-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
								Diseases
							</div>
							<div class="space-y-1">
								{#each diseaseQuirks as [id, quirk] (id)}
									{@render quirkRow(id, quirk, 'border-amber-500/20 bg-amber-500/10')}
								{/each}
							</div>
						{/if}

						<!-- Negative (non-disease) -->
						<div class="space-y-1 {diseaseQuirks.length > 0 ? 'mt-2' : ''}">
							{#each negativeQuirks as [id, quirk] (id)}
								{@render quirkRow(id, quirk, 'border-red-500/20 bg-red-500/5')}
							{/each}
						</div>
						{#if canAddNegative}
							<Button
								variant="ghost"
								size="sm"
								class="mt-1 h-6 w-full text-[11px]"
								onclick={() => openQuirkPicker('negative')}
							>
								<PlusIcon size={11} class="mr-1" />
								Add Negative
							</Button>
						{/if}
						<p class="text-muted-foreground mt-2 text-[10px]">
							Diseases count toward the 5-quirk limit.
						</p>
					</div>
				</div>

				<!-- Quirk Picker Overlay -->
				{#if showQuirkPicker}
					<div class="mt-3 rounded-none border p-2">
						<div class="mb-2 flex items-center justify-between">
							<span class="text-[11px] font-medium">
								Add {quirkPickerCategory === 'positive' ? 'Positive' : 'Negative/Disease'} Quirk
							</span>
							<button
								class="text-muted-foreground cursor-pointer hover:text-foreground"
								onclick={() => (showQuirkPicker = false)}
								aria-label="Close quirk picker"
							>
								<XIcon size={14} />
							</button>
						</div>
						<Input
							placeholder="Search quirks..."
							bind:value={quirkSearch}
							class="mb-2 h-7 text-xs"
							autofocus
						/>
						<div class="max-h-50 overflow-y-auto">
							{#each filteredPickerQuirks.slice(0, 50) as quirk (quirk.id)}
								<button
									class="flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left text-[11px] transition-colors hover:bg-muted"
									onclick={() => pickQuirk(quirk.id)}
								>
									<span
										class="h-1.5 w-1.5 rounded-full {quirk.category === 'positive'
											? 'bg-green-500'
											: quirk.category === 'disease'
												? 'bg-amber-500'
												: 'bg-red-500'}"
									></span>
									<span>{quirk.displayName}</span>
									<span class="text-muted-foreground/50 text-[10px]">{quirk.id}</span>
								</button>
							{/each}
							{#if filteredPickerQuirks.length === 0}
								<p class="text-muted-foreground py-2 text-center text-[11px]">No quirks found</p>
							{/if}
						</div>
					</div>
				{/if}
			</CollapsibleContent>
		</Collapsible>

		<Separator />

		<!-- ═══════ D1: Skills Section ═══════ -->
		<Collapsible bind:open={skillsOpen}>
			<CollapsibleTrigger class="flex w-full items-center gap-2 py-1">
				{#if skillsOpen}
					<CaretDownIcon size={14} class="text-muted-foreground" />
				{:else}
					<CaretRightIcon size={14} class="text-muted-foreground" />
				{/if}
				<span class="text-xs font-semibold uppercase tracking-wider">Skills</span>
				<Badge variant="outline" class="ml-auto h-4 text-[10px]">
					{combatSkillIds.length}C / {campingSkillIds.length}K
				</Badge>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div class="mt-2 space-y-3">
					<!-- Combat Skills -->
					<div>
						<span class="text-muted-foreground mb-1 block text-[11px] font-medium">
							Combat Skills ({combatSkillIds.length})
						</span>
						{#if combatSkillIds.length > 0}
							<div class="space-y-0.5">
								{#each combatSkillIds as skillId (skillId)}
									<div class="flex items-center gap-2 px-2 py-1 text-[11px]">
										<span class="h-1.5 w-1.5 rounded-full bg-orange-400 shrink-0"></span>
										<span class="font-mono">{skillId}</span>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-muted-foreground text-[11px]">No combat skills selected.</p>
						{/if}
					</div>

					<!-- Camping Skills -->
					<div>
						<span class="text-muted-foreground mb-1 block text-[11px] font-medium">
							Camping Skills ({campingSkillIds.length})
						</span>
						{#if campingSkillIds.length > 0}
							<div class="space-y-0.5">
								{#each campingSkillIds as skillId (skillId)}
									<div class="flex items-center gap-2 px-2 py-1 text-[11px]">
										<span class="h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0"></span>
										<span class="font-mono">{skillId}</span>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-muted-foreground text-[11px]">No camping skills selected.</p>
						{/if}
					</div>
					<p class="text-muted-foreground/60 text-[10px]">
						Read-only — skill editing requires game data to be loaded.
					</p>
				</div>
			</CollapsibleContent>
		</Collapsible>

		<Separator />

		<!-- ═══════ Equipment Section ═══════ -->
		<Collapsible bind:open={equipmentOpen}>
			<CollapsibleTrigger class="flex w-full items-center gap-2 py-1">
				{#if equipmentOpen}
					<CaretDownIcon size={14} class="text-muted-foreground" />
				{:else}
					<CaretRightIcon size={14} class="text-muted-foreground" />
				{/if}
				<span class="text-xs font-semibold uppercase tracking-wider">Equipment</span>
				<Badge variant="outline" class="ml-auto h-4 text-[10px]">
					W{hero.weaponRank} / A{hero.armourRank}
				</Badge>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div class="mt-2 space-y-3">
					<!-- Weapon Rank -->
					<div>
						<span class="text-muted-foreground mb-1 block text-[11px]">
							Weapon Rank (max: {maxGear})
						</span>
						<Select
							type="single"
							value={String(hero.weaponRank)}
							onValueChange={(v: string) => setHeroWeaponRank(hero.guid, parseInt(v))}
						>
							<SelectTrigger class="h-8 text-xs">
								<span>Rank {hero.weaponRank}</span>
							</SelectTrigger>
							<SelectContent>
								{#each Array(maxGear + 1) as _, i}
									<SelectItem value={String(i)}>Rank {i}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
					</div>

					<!-- Armour Rank -->
					<div>
						<span class="text-muted-foreground mb-1 block text-[11px]">
							Armour Rank (max: {maxGear})
						</span>
						<Select
							type="single"
							value={String(hero.armourRank)}
							onValueChange={(v: string) => setHeroArmourRank(hero.guid, parseInt(v))}
						>
							<SelectTrigger class="h-8 text-xs">
								<span>Rank {hero.armourRank}</span>
							</SelectTrigger>
							<SelectContent>
								{#each Array(maxGear + 1) as _, i}
									<SelectItem value={String(i)}>Rank {i}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
						<p class="text-muted-foreground mt-1 text-[10px]">
							Max HP at current armour rank: {maxHp}
						</p>
					</div>

					<!-- D3: Trinket Slots -->
					<div>
						<span class="text-muted-foreground mb-1 block text-[11px] font-medium">Trinkets</span>
						<div class="grid grid-cols-2 gap-2">
							<!-- Slot 0 -->
							<div>
								<span class="text-muted-foreground mb-1 block text-[10px]">Slot 1</span>
								<div class="rounded-none border px-2 py-1.5 text-[11px] {trinketSlot0?.id ? '' : 'text-muted-foreground'}">
									{#if trinketSlot0?.id}
										<span class="font-mono">{trinketSlot0.id}</span>
									{:else}
										<span class="italic">Empty</span>
									{/if}
								</div>
								<TrinketPicker
									value={trinketSlot0?.id ?? ''}
									onselect={(id) => handleTrinketSelect('0', id)}
								/>
							</div>
							<!-- Slot 1 -->
							<div>
								<span class="text-muted-foreground mb-1 block text-[10px]">Slot 2</span>
								<div class="rounded-none border px-2 py-1.5 text-[11px] {trinketSlot1?.id ? '' : 'text-muted-foreground'}">
									{#if trinketSlot1?.id}
										<span class="font-mono">{trinketSlot1.id}</span>
									{:else}
										<span class="italic">Empty</span>
									{/if}
								</div>
								<TrinketPicker
									value={trinketSlot1?.id ?? ''}
									onselect={(id) => handleTrinketSelect('1', id)}
								/>
							</div>
						</div>
					</div>
				</div>
			</CollapsibleContent>
		</Collapsible>

		<!-- D2: Blood Curse Section (visible only if hero has disease_vampire_* quirk) -->
		{#if hasBloodCurse}
			<Separator />
			<Collapsible bind:open={bloodCurseOpen}>
				<CollapsibleTrigger class="flex w-full items-center gap-2 py-1">
					{#if bloodCurseOpen}
						<CaretDownIcon size={14} class="text-muted-foreground" />
					{:else}
						<CaretRightIcon size={14} class="text-muted-foreground" />
					{/if}
					<DropIcon size={14} class="text-red-500" />
					<span class="text-xs font-semibold uppercase tracking-wider">Blood Curse</span>
					{#if vampireQuirkId}
						<Badge variant="outline" class="ml-auto h-4 text-[10px] text-red-600 dark:text-red-400">
							{VAMPIRE_STATE_LABELS[vampireQuirkId] ?? vampireQuirkId}
						</Badge>
					{/if}
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div class="mt-2 space-y-2">
						<div>
							<span class="text-muted-foreground mb-1 block text-[11px]">Current State</span>
							<Select
								type="single"
								value={vampireQuirkId ?? ''}
								onValueChange={(v: string) => handleBloodCurseChange(v)}
							>
								<SelectTrigger class="h-8 text-xs">
									<span>{vampireQuirkId ? VAMPIRE_STATE_LABELS[vampireQuirkId] : 'Unknown'}</span>
								</SelectTrigger>
								<SelectContent>
									{#each VAMPIRE_QUIRK_IDS as id (id)}
										<SelectItem value={id}>{VAMPIRE_STATE_LABELS[id]}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
						<p class="text-muted-foreground text-[10px]">
							Only one Blood Curse state can be active at a time. Changing state replaces the current quirk.
						</p>
					</div>
				</CollapsibleContent>
			</Collapsible>
		{/if}

		<Separator />

		<!-- ═══════ Actions Section ═══════ -->
		<Collapsible bind:open={actionsOpen}>
			<CollapsibleTrigger class="flex w-full items-center gap-2 py-1">
				{#if actionsOpen}
					<CaretDownIcon size={14} class="text-muted-foreground" />
				{:else}
					<CaretRightIcon size={14} class="text-muted-foreground" />
				{/if}
				<span class="text-xs font-semibold uppercase tracking-wider">Actions</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div class="mt-2 space-y-2">
					{#if isDead}
						<Button
							variant="outline"
							size="sm"
							class="w-full justify-start gap-2 text-xs"
							onclick={() => (revivalWizardOpen = true)}
						>
							<HeartIcon size={14} class="text-green-500" />
							Revive Hero
						</Button>
						<p class="text-muted-foreground text-[10px]">
							Opens the Revival Wizard to restore this hero across all required save files.
						</p>
					{/if}

					<!-- D8: Dismiss Hero — triggers AlertDialog -->
					<div class="rounded-none border border-red-500/20 p-3">
						<p class="mb-2 text-xs font-medium text-red-600 dark:text-red-400">Dismiss Hero</p>
						<p class="text-muted-foreground mb-2 text-[11px]">
							Permanently remove {hero.name} from the roster. This cannot be undone after saving.
						</p>
						<Button
							variant="destructive"
							size="sm"
							class="w-full gap-2 text-xs"
							onclick={() => (dismissDialogOpen = true)}
						>
							<TrashIcon size={14} />
							Dismiss {hero.name}
						</Button>
					</div>
				</div>
			</CollapsibleContent>
		</Collapsible>
	</div>
</ScrollArea>

<!-- D8: Dismiss confirmation dialog (outside ScrollArea) -->
<Dialog bind:open={dismissDialogOpen}>
	<DialogContent class="sm:max-w-sm">
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2 text-sm">
				<TrashIcon size={16} class="text-destructive" />
				Dismiss {hero.name}?
			</DialogTitle>
			<DialogDescription>
				This will permanently remove the hero from your roster.
			</DialogDescription>
		</DialogHeader>
		<div class="space-y-3 py-2">
			<label class="flex cursor-pointer items-start gap-2">
				<Checkbox bind:checked={dismissConfirmChecked} class="mt-0.5" />
				<span class="text-[11px] leading-relaxed">
					I understand this cannot be undone.
				</span>
			</label>
		</div>
		<DialogFooter class="gap-2 sm:justify-end">
			<Button
				variant="outline"
				size="sm"
				onclick={() => { dismissDialogOpen = false; dismissConfirmChecked = false; }}
			>
				Cancel
			</Button>
			<Button
				variant="destructive"
				size="sm"
				disabled={!dismissConfirmChecked}
				onclick={handleDismissConfirm}
				class="gap-1"
			>
				<TrashIcon size={14} />
				Dismiss
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Revival Wizard (rendered outside ScrollArea to avoid z-index issues) -->
{#if isDead}
	<RevivalWizard {hero} bind:open={revivalWizardOpen} />
{/if}
