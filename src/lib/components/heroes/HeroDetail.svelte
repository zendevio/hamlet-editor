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
	import GameAssetImage from '$lib/components/GameAssetImage.svelte';
	import GameAssetIcon from '$lib/components/GameAssetIcon.svelte';
	import { getSettings } from '$lib/stores/settings.svelte';
	import { getPortraitPath } from '$lib/utils';
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
		RESOLVE_XP_THRESHOLDS,
		getDlcFlags
	} from '$lib/stores/save-data.svelte';
	import { isPositiveQuirk, isDiseaseQuirk, getAllQuirks } from '$lib/data/quirks';
	import { snakeToTitle } from '$lib/utils';
	import RevivalWizard from './RevivalWizard.svelte';
	import TrinketPicker from './TrinketPicker.svelte';
	import { getAvailableCombatSkills, getAvailableCampingSkills } from '$lib/stores/game-data.svelte';
	import { toggleCombatSkill, toggleCampingSkill } from '$lib/stores/save-data.svelte';

	let {
		hero,
		onDismiss
	}: {
		hero: HeroSummary;
		onDismiss?: () => void;
	} = $props();

	const settings = getSettings();
	const dlcFlags = getDlcFlags();

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

	// Available skills from game data (empty when not loaded)
	let availableCombat = $derived(getAvailableCombatSkills(hero.heroClass));
	let availableCamping = $derived(getAvailableCampingSkills(hero.heroClass));

	// Abomination has a fixed skill set — no toggling allowed
	let isAbomination = $derived(hero.heroClass === 'abomination');

	// Max selectable combat skills: 7 for abomination, 4 for all others
	const MAX_COMBAT_SKILLS = 4;

	function canToggleCombatOn(skillId: string): boolean {
		if (isAbomination) return false;
		if (combatSkillIds.includes(skillId)) return true; // already on, toggle-off check is separate
		return combatSkillIds.length < MAX_COMBAT_SKILLS;
	}

	function canToggleCombatOff(skillId: string): boolean {
		if (isAbomination) return false;
		return combatSkillIds.length > 1 && combatSkillIds.includes(skillId);
	}

	function handleToggleCombat(skillId: string) {
		const isSelected = combatSkillIds.includes(skillId);
		if (isSelected) {
			if (!canToggleCombatOff(skillId)) return;
		} else {
			if (!canToggleCombatOn(skillId)) return;
		}
		toggleCombatSkill(hero.guid, skillId);
	}

	function handleToggleCamping(skillId: string) {
		toggleCampingSkill(hero.guid, skillId);
	}

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
			type="button"
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
			type="button"
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
		<div class="flex gap-3">
			<!-- Portrait -->
			<div class="relative h-16 w-16 shrink-0 overflow-hidden {isDead ? 'opacity-50' : ''}">
				{#if isDead}
					<div class="bg-muted flex h-full w-full items-center justify-center">
						<SkullIcon size={28} class="text-muted-foreground" />
					</div>
				{:else}
					<GameAssetImage
						gamePath={settings.gamePath}
						relativePath={getPortraitPath(hero.heroClass)}
						alt="{hero.name} portrait"
						class="h-full w-full object-cover"
					/>
				{/if}
			</div>
			<!-- Info -->
			<div class="flex min-w-0 flex-1 flex-col justify-center gap-1">
				<div class="flex items-center justify-between">
					{#if editingName}
						<Input
							bind:value={nameValue}
							onblur={saveName}
							onkeydown={handleNameKeydown}
							class="h-7 text-sm font-medium"
							autofocus
						/>
					{:else}
						<button
							type="button"
							class="group flex min-w-0 cursor-pointer items-center gap-1 rounded-none border border-transparent px-1 py-0.5 text-sm font-medium transition-colors hover:border-border hover:bg-muted/50"
							onclick={startEditName}
						>
							<span class="truncate">{hero.name}</span>
							<PencilIcon
								size={12}
								class="text-muted-foreground shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
							/>
						</button>
					{/if}
					<Tooltip>
						<TooltipTrigger>
							<Button variant="ghost" size="sm" class="h-7 shrink-0 gap-1 text-xs" onclick={handleRevert}>
								<ArrowCounterClockwiseIcon size={12} />
								Reset
							</Button>
						</TooltipTrigger>
						<TooltipContent>Revert all unsaved changes for this hero</TooltipContent>
					</Tooltip>
				</div>
				<div class="flex items-center justify-between px-1 text-xs text-muted-foreground">
					<div class="flex items-center gap-2">
						<span>{hero.classDisplayName}</span>
						<span class="h-2 w-2 shrink-0 rounded-full {hero.statusDotClass}"></span>
						<span class="{isDead ? 'text-red-500' : ''}">{hero.statusLabel}</span>
					</div>
					<Select type="single" value={String(resolveLevel)} onValueChange={(v: string) => handleLevelChange(v)}>
						<SelectTrigger class="h-6 w-auto text-xs">
							<span class="truncate">Lv {resolveLevel} — {RESOLVE_LEVEL_NAMES[resolveLevel]}</span>
						</SelectTrigger>
						<SelectContent>
							{#each Array(7) as _, i}
								<SelectItem value={String(i)}>
									Lv {i} — {RESOLVE_LEVEL_NAMES[i]} (XP: {RESOLVE_XP_THRESHOLDS[i]})
								</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>
			</div>
		</div>

		<!-- ═══════ Vitals Section ═══════ -->
		<div>
			<div class="flex items-center gap-2 py-1">
				<span class="shrink-0 text-xs font-semibold uppercase tracking-wider">Vitals</span>
				<Separator class="flex-1" />
			</div>
			<!-- D7: Inline gear match confirmation -->
			{#if pendingLevel !== null}
				<div class="rounded-none border border-amber-500/30 bg-amber-500/5 p-2 text-[11px]">
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
			<div class="mt-2 space-y-4">
					<div class="flex gap-4">
						<!-- HP -->
						<div class="flex-1">
							<div class="mb-1 flex items-center justify-between">
								<div class="flex items-center gap-1.5">
									<GameAssetIcon
										gamePath={settings.gamePath}
										relativePath="raid/skill_attributes/skill_attribute_heal.png"
										alt="HP"
										class="size-3.5"
									>
										{#snippet fallback()}<HeartIcon size={14} class="text-red-500" />{/snippet}
									</GameAssetIcon>
									<span class="text-[11px] font-medium">HP</span>
								</div>
								<span
									class="text-xs font-mono {hero.currentHp < maxHp * 0.5
										? 'text-red-500 font-bold'
										: 'text-muted-foreground'}"
								>
									{hero.currentHp} / {maxHp}
								</span>
							</div>
							<Slider
								value={hero.currentHp}
								max={maxHp}
								min={0}
								step={1}
								type="single"
								onValueChange={(v) => handleHpSlider(v)}
							/>
							<Button
								variant="outline"
								size="sm"
								class="mt-1.5 h-6 w-full text-[11px]"
								onclick={() => healHeroToMax(hero.guid)}
								disabled={hero.currentHp >= maxHp}
							>
								Heal to Max
							</Button>
						</div>

						<!-- Stress -->
						<div class="flex-1">
							<div class="mb-1 flex items-center justify-between">
								<div class="flex items-center gap-1.5">
									<GameAssetIcon
										gamePath={settings.gamePath}
										relativePath="raid/skill_attributes/skill_attribute_stress.png"
										alt="Stress"
										class="size-3.5"
									>
										{#snippet fallback()}<BrainIcon size={14} class="text-yellow-500" />{/snippet}
									</GameAssetIcon>
									<span class="text-[11px] font-medium">Stress</span>
								</div>
								<span
									class="text-xs font-mono {hero.stress >= 100
										? 'text-red-500 font-bold'
										: 'text-muted-foreground'}"
								>
									{hero.stress} / 200
								</span>
							</div>
							<Slider
								value={hero.stress}
								max={200}
								min={0}
								step={1}
								type="single"
								onValueChange={(v) => handleStressSlider(v)}
							/>
							<Button
								variant="outline"
								size="sm"
								class="mt-1.5 h-6 w-full text-[11px]"
								onclick={() => setHeroStress(hero.guid, 0)}
								disabled={hero.stress === 0}
							>
								Clear Stress
							</Button>
							{#if hero.stress >= 100}
								<p class="text-destructive mt-1 text-[11px]">
									Affliction threshold reached ({hero.afflictionTypeId || 'none set'})
								</p>
							{/if}
						</div>
					</div>

					<!-- Affliction / Virtue and Deaths Door
					     Both `affliction_type_id` and `visited_deaths_door` are stored in
					     persist.roster.json under each hero's base_root (hamlet state).
					     They persist across raids and are NOT in persist.raid.json.
					     Changes here are written to persist.roster.json. -->

					<div class="flex gap-4">
						<!-- Affliction -->
						<div class="flex-1">
							<div class="mb-1 flex items-center justify-between">
								<span class="text-[11px] font-medium">Affliction / Virtue</span>
								{#if hero.afflictionTypeId || hero.virtueTypeId}
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
								value={hero.virtueTypeId || hero.afflictionTypeId || '_none'}
								onValueChange={(v: string) => setHeroAffliction(hero.guid, v === '_none' ? '' : v)}
							>
								<SelectTrigger class="h-8 text-xs">
									<span>{hero.virtueTypeId ? snakeToTitle(hero.virtueTypeId) : hero.afflictionTypeId ? snakeToTitle(hero.afflictionTypeId) : 'None'}</span>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="_none">None</SelectItem>
									<SelectItem value="paranoid">Paranoid</SelectItem>
									<SelectItem value="depressed">Hopeless</SelectItem>
									<SelectItem value="selfish">Selfish</SelectItem>
									<SelectItem value="abusive">Abusive</SelectItem>
									<SelectItem value="fearful">Fearful</SelectItem>
									<SelectItem value="irrational">Irrational</SelectItem>
									<SelectItem value="masochistic">Masochistic</SelectItem>
									<SelectItem value="berserk">Rapturous (Flagellant)</SelectItem>
									{#if dlcFlags.hasColorOfMadness}
										<SelectItem value="color_madness">Refracted (Color of Madness)</SelectItem>
									{/if}
									<SelectItem value="courageous">Courageous (Virtue)</SelectItem>
									<SelectItem value="focused">Focused (Virtue)</SelectItem>
									<SelectItem value="powerful">Powerful (Virtue)</SelectItem>
									<SelectItem value="vigorous">Vigorous (Virtue)</SelectItem>
									<SelectItem value="stalwart">Stalwart (Virtue)</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<!-- Deaths Door -->
						<div class="flex-1">
							<div class="mb-1 flex items-center justify-between">
								<span class="text-[11px] font-medium">Death's Door</span>
								<Tooltip>
									<TooltipTrigger>
										<span class="text-muted-foreground text-[10px]">Historical flag</span>
									</TooltipTrigger>
									<TooltipContent class="max-w-60">
										Indicates this hero has previously reached Death's Door. Does not directly affect
										current gameplay state.
									</TooltipContent>
								</Tooltip>
							</div>
							<div class="flex h-8 items-center justify-between rounded-none border px-2">
								<span class="text-xs text-muted-foreground">{hero.visitedDeathsDoor ? 'Visited' : 'Never'}</span>
								<Switch
									checked={hero.visitedDeathsDoor}
									onCheckedChange={(checked) => setHeroDeathsDoor(hero.guid, checked)}
								/>
							</div>
						</div>
					</div>
			</div>
		</div>

		<!-- ═══════ Quirks Section ═══════ -->
		<div>
			<div class="flex items-center gap-2 py-1">
				<span class="shrink-0 text-xs font-semibold uppercase tracking-wider">Quirks</span>
				<Separator class="flex-1" />
			</div>
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
								type="button"
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
									type="button"
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
		</div>

		<!-- ═══════ D1: Skills Section ═══════ -->
		<div>
			<div class="flex items-center gap-2 py-1">
				<span class="shrink-0 text-xs font-semibold uppercase tracking-wider">Skills</span>
				<Separator class="flex-1" />
			</div>
			<div class="mt-2 space-y-3">
					<!-- Combat Skills -->
					<div>
						<span class="text-muted-foreground mb-1 block text-[11px] font-medium">
							Combat Skills ({combatSkillIds.length}{availableCombat.length > 0 && !isAbomination ? `/${MAX_COMBAT_SKILLS}` : ''})
						</span>
						{#if availableCombat.length > 0}
							{#if isAbomination}
								<div class="grid grid-cols-2 gap-0.5 xl:grid-cols-4">
									{#each availableCombat as skillId (skillId)}
										<div class="flex items-center gap-2 px-2 py-1 text-[11px] opacity-60">
											<span class="h-2 w-2 rounded-full bg-orange-400 shrink-0 ring-1 ring-orange-400"></span>
											<span class="truncate font-mono">{snakeToTitle(skillId)}</span>
										</div>
									{/each}
								</div>
								<p class="text-muted-foreground mt-1 text-[10px]">Fixed skill set.</p>
							{:else}
								<div class="grid grid-cols-2 gap-0.5 xl:grid-cols-4">
									{#each availableCombat as skillId (skillId)}
										{@const isSelected = combatSkillIds.includes(skillId)}
										{@const disableOn = !isSelected && combatSkillIds.length >= MAX_COMBAT_SKILLS}
										{@const disableOff = isSelected && combatSkillIds.length <= 1}
										<Tooltip>
											<TooltipTrigger class="w-full">
												<button
													type="button"
													class="flex w-full items-center gap-2 rounded-none px-2 py-1 text-left text-[11px] transition-colors
														{isSelected ? 'bg-orange-500/10 hover:bg-orange-500/20' : 'hover:bg-muted'}
														{(disableOn || disableOff) ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}"
													disabled={disableOn || disableOff}
													onclick={() => handleToggleCombat(skillId)}
													aria-pressed={isSelected}
													aria-label="{isSelected ? 'Deselect' : 'Select'} {snakeToTitle(skillId)}"
												>
													{#if isSelected}
														<span class="h-2 w-2 rounded-full bg-orange-400 shrink-0 ring-1 ring-orange-400"></span>
													{:else}
														<span class="h-2 w-2 rounded-full border border-orange-400 shrink-0"></span>
													{/if}
													<span class="truncate font-mono">{snakeToTitle(skillId)}</span>
												</button>
											</TooltipTrigger>
											<TooltipContent>
												{#if disableOn}
													4 combat skills already selected
												{:else if disableOff}
													At least 1 combat skill must remain
												{:else if isSelected}
													Click to deselect
												{:else}
													Click to select
												{/if}
											</TooltipContent>
										</Tooltip>
									{/each}
								</div>
							{/if}
						{:else}
							<!-- Fallback: game data not loaded -->
							{#if combatSkillIds.length > 0}
								<div class="grid grid-cols-2 gap-0.5 xl:grid-cols-4">
									{#each combatSkillIds as skillId (skillId)}
										<div class="flex items-center gap-2 px-2 py-1 text-[11px]">
											<span class="h-1.5 w-1.5 rounded-full bg-orange-400 shrink-0"></span>
											<span class="truncate font-mono">{skillId}</span>
										</div>
									{/each}
								</div>
							{:else}
								<p class="text-muted-foreground text-[11px]">No combat skills selected.</p>
							{/if}
							<p class="text-muted-foreground/60 text-[10px]">
								Read-only. Load game data to enable editing.
							</p>
						{/if}
					</div>

					<!-- Camping Skills -->
					<div>
						<span class="text-muted-foreground mb-1 block text-[11px] font-medium">
							Camping Skills ({campingSkillIds.length})
						</span>
						{#if availableCamping.length > 0}
							<div class="grid grid-cols-2 gap-0.5 xl:grid-cols-4">
								{#each availableCamping as skillId (skillId)}
									{@const isSelected = campingSkillIds.includes(skillId)}
									<Tooltip>
										<TooltipTrigger class="w-full">
											<button
												type="button"
												class="flex w-full items-center gap-2 rounded-none px-2 py-1 text-left text-[11px] transition-colors cursor-pointer
													{isSelected ? 'bg-blue-500/10 hover:bg-blue-500/20' : 'hover:bg-muted'}"
												onclick={() => handleToggleCamping(skillId)}
												aria-pressed={isSelected}
												aria-label="{isSelected ? 'Deselect' : 'Select'} {snakeToTitle(skillId)}"
											>
												{#if isSelected}
													<span class="h-2 w-2 rounded-full bg-blue-400 shrink-0 ring-1 ring-blue-400"></span>
												{:else}
													<span class="h-2 w-2 rounded-full border border-blue-400 shrink-0"></span>
												{/if}
												<span class="truncate font-mono">{snakeToTitle(skillId)}</span>
											</button>
										</TooltipTrigger>
										<TooltipContent>
											{#if isSelected}Click to deselect{:else}Click to select{/if}
										</TooltipContent>
									</Tooltip>
								{/each}
							</div>
						{:else}
							<!-- Fallback: game data not loaded -->
							{#if campingSkillIds.length > 0}
								<div class="grid grid-cols-2 gap-0.5 xl:grid-cols-4">
									{#each campingSkillIds as skillId (skillId)}
										<div class="flex items-center gap-2 px-2 py-1 text-[11px]">
											<span class="h-1.5 w-1.5 rounded-full bg-blue-400 shrink-0"></span>
											<span class="truncate font-mono">{skillId}</span>
										</div>
									{/each}
								</div>
							{:else}
								<p class="text-muted-foreground text-[11px]">No camping skills selected.</p>
							{/if}
							<p class="text-muted-foreground/60 text-[10px]">
								Read-only. Load game data to enable editing.
							</p>
						{/if}
					</div>
			</div>
		</div>

		<!-- ═══════ Equipment Section ═══════ -->
		<div>
			<div class="flex items-center gap-2 py-1">
				<span class="shrink-0 text-xs font-semibold uppercase tracking-wider">Equipment</span>
				<Separator class="flex-1" />
			</div>
			<div class="mt-2 space-y-3">
					<div class="flex gap-4">
						<!-- Weapon Rank -->
						<div class="flex-1">
							<span class="text-muted-foreground mb-1 block text-[11px]">
								Weapon (max: {maxGear})
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
						<div class="flex-1">
							<span class="text-muted-foreground mb-1 block text-[11px]">
								Armour (max: {maxGear})
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
		</div>

		<!-- D2: Blood Curse Section (visible only if Crimson Court DLC is installed AND hero has disease_vampire_* quirk) -->
		{#if dlcFlags.hasCrimsonCourt && hasBloodCurse}
			<div>
				<div class="flex items-center gap-2 py-1">
					<DropIcon size={14} class="shrink-0 text-red-500" />
					<span class="shrink-0 text-xs font-semibold uppercase tracking-wider">Blood Curse</span>
					<Separator class="flex-1" />
					{#if vampireQuirkId}
						<Badge variant="outline" class="shrink-0 h-4 text-[10px] text-red-600 dark:text-red-400">
							{VAMPIRE_STATE_LABELS[vampireQuirkId] ?? vampireQuirkId}
						</Badge>
					{/if}
				</div>
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
			</div>
		{/if}

		<!-- ═══════ Actions Section ═══════ -->
		<div>
			<div class="flex items-center gap-2 py-1">
				<span class="shrink-0 text-xs font-semibold uppercase tracking-wider">Actions</span>
				<Separator class="flex-1" />
			</div>
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
		</div>
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
