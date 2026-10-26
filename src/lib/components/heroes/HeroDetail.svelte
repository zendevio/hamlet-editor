<script lang="ts">
	import { mergeProps } from 'bits-ui';
	import { showMessageError } from '#lib/i18n/notifications.js';
	import { describeMessage, t, getEditorLocale, type MessageDescriptor } from '#lib/i18n/index.svelte.js';
	import Message from '#lib/i18n/Message.svelte';
	import ResolveLabel from './ResolveLabel.svelte';
	import { formatNumber, compareNames } from '#lib/i18n/intl.js';
	import { heroClassName, heroStatusLabel, gameTextLocale, combatSkillName, campingSkillName, trinketName, afflictionName, vampireStateName, VIRTUES } from '#lib/save-labels.js';

	import { commitChangedValue, sliderControl, sliderValueLabel, sliderNumberLabel, hpSliderMax } from '#lib/control-events.js';
	import { parseInteger, validateHeroName } from '#lib/input-validation.js';
	import { canPickQuirk, CURSE_STATES } from '#lib/hero-safety.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { Slider } from '#lib/components/ui/slider/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '#lib/components/ui/select/index.js';
	import { Tooltip, TooltipContent, TooltipTrigger } from '#lib/components/ui/tooltip/index.js';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '#lib/components/ui/dialog/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
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
	import GameAssetImage from '#lib/components/GameAssetImage.svelte';
	import GameAssetIcon from '#lib/components/GameAssetIcon.svelte';
	import { getSettings } from '#lib/stores/settings.svelte.js';
	import { getPortraitPath } from '#lib/utils.js';
	import type { HeroSummary, HeroQuirk } from '#lib/stores/save-data.svelte.js';
	import {
		getMaxHp,
		getHeroRawData,
		getSavedHeroHp,
		setHeroHp,
		setHeroStress,
		setHeroName,
		setHeroLevel,
		setHeroWeaponRank,
		setHeroArmourRank,
		setHeroAffliction,
		setHeroDeathsDoor,
		healHeroToMax,
		dismissHero,
		removeHeroQuirk,
		toggleQuirkLock,
		addHeroQuirk,
		revertHero,
		setHeroTrinket,
		getDlcFlags,
		getSaveData,
		getDismissBlockReason,
		setHeroCurseState
	} from '#lib/stores/save-data.svelte.js';
	import { isPositiveQuirk, isDiseaseQuirk, getAllQuirks, quirkName, quirkDescription, matchesQuirkSearch } from '#lib/data/quirks.js';
	import RevivalWizard from './RevivalWizard.svelte';
	import TrinketPicker from './TrinketPicker.svelte';
	import { getAvailableCombatSkills, getAvailableCampingSkills } from '#lib/stores/game-data.svelte.js';
	import { toggleCombatSkill, toggleCampingSkill } from '#lib/stores/save-data.svelte.js';

	let {
		hero,
		onDismiss
	}: {
		hero: HeroSummary;
		onDismiss?: () => void;
	} = $props();

	const saveData = getSaveData();
	const settings = getSettings();
	const dlcFlags = getDlcFlags();

	// ── Quirk picker ──
	let showQuirkPicker = $state(false);
	let quirkPickerCategory = $state<'positive' | 'negative'>('positive');
	let quirkSearch = $state('');

	// ── Name editing ──
	let editingName = $state(false);
	let nameValue = $state('');
	let nameError = $state<MessageDescriptor | null>(null);
	let nameAtStart = '';
	let nameHeroGuid = '';

	// ── Revival wizard ──
	let revivalWizardOpen = $state(false);

	// ── Dismiss dialog ──
	let dismissDialogOpen = $state(false);
	let dismissConfirmChecked = $state(false);

	// ── Derived ──
	let isDead = $derived(hero.status === 3);
	let dismissReason = $derived(getDismissBlockReason(hero.guid));
	let resolveLevel = $derived(hero.resolveLevel);
	let maxHp = $derived(getMaxHp(hero.heroClass, hero.armourRank));
	let hpMax = $derived(hpSliderMax(maxHp, hero.currentHp, getSavedHeroHp(hero.guid)));

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
	const VAMPIRE_QUIRK_IDS = CURSE_STATES;
	const afflictionIds = ['paranoid', 'depressed', 'selfish', 'abusive', 'fearful', 'irrational', 'masochistic', 'berserk', 'color_madness', ...VIRTUES];

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

	// Abomination has a fixed skill set; no toggling allowed
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
	let allQuirks = $derived(getAllQuirks());
	let filteredPickerQuirks = $derived.by(() => {
		const existingIds = new Set(Object.keys(hero.quirks));
		const q = quirkSearch;
		return allQuirks.filter((quirk) => {
			if (existingIds.has(quirk.id) || !canPickQuirk(quirk.id)) return false;
			if (quirkPickerCategory === 'positive' && quirk.category !== 'positive') return false;
			if (quirkPickerCategory === 'negative' && quirk.category === 'positive') return false;
			if (!matchesQuirkSearch(quirk.id, quirk.displayName, q))
				return false;
			return true;
		}).sort((a, b) => compareNames(a.displayName, a.id, b.displayName, b.id, gameTextLocale()));
	});

	function startEditName() {
		nameError = null;
		nameValue = hero.name;
		nameAtStart = hero.name;
		nameHeroGuid = hero.guid;
		editingName = true;
	}

	function saveName() {
		if (!editingName) return;
		if (hero.guid !== nameHeroGuid || hero.name !== nameAtStart) {
			editingName = false;
			return;
		}
		if (nameValue === nameAtStart) {
			editingName = false;
			return;
		}
		const parsed = validateHeroName(nameValue);
		nameError = parsed.error ?? null;
		if (parsed.error !== undefined) return;
		commitChangedValue(hero.name, parsed.value, (name) => {
			nameError = setHeroName(hero.guid, name) ?? null;
		});
		if (!nameError) editingName = false;
	}

	function handleNameKeydown(e: KeyboardEvent) {
		if (e.isComposing || e.keyCode === 229) return;
		if (e.key === 'Enter') saveName();
		if (e.key === 'Escape') {
			editingName = false;
		}
	}

	function handleLevelChange(value: string) {
		if (value === String(resolveLevel)) return;
		const parsed = parseInteger(value, 0, 6);
		if (parsed.error !== undefined) return;
		setHeroLevel(hero.guid, parsed.value);
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
		commitChangedValue(vampireQuirkId ?? '', newStateId, (id) => setHeroCurseState(hero.guid, id));
	}

	function handleTrinketSelect(slot: '0' | '1', trinketId: string, source: 'inventory' | 'catalogue' = 'catalogue') {
		const reason = setHeroTrinket(hero.guid, slot, trinketId, source);
		if (reason) showMessageError(reason);
	}

	// D8: Dismiss confirmation dialog
	function handleDismissConfirm() {
		const reason = dismissHero(hero.guid);
		if (reason) { showMessageError(reason); return; }
		dismissConfirmChecked = false;
		dismissDialogOpen = false;
		onDismiss?.();
	}

	function handleRevert() {
		const reason = revertHero(hero.guid);
		if (reason) showMessageError(reason);
	}
</script>

{#snippet quirkRow(id: string, quirk: HeroQuirk, colorClass: string)}
	<div
		title={quirkDescription(id) ? `${quirkDescription(id)} (${id})` : id}
		class="flex items-center gap-1 rounded-none border px-2 py-1 {colorClass}"
	>
		<button
			type="button"
			class="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
			onclick={() => toggleQuirkLock(hero.guid, id)}
			title={quirk.is_locked ? t('heroes.unlockQuirkTitle') : t('heroes.lockQuirkTitle')}
			aria-label={t('heroes.lockQuirk', { locked: quirk.is_locked ? 'yes' : 'no', name: quirkName(id) })}
		>
			{#if quirk.is_locked}
				<LockIcon size={11} class="text-yellow-500" />
			{:else}
				<LockOpenIcon size={11} />
			{/if}
		</button>
		<span lang={gameTextLocale()} class="flex-1 truncate text-[11px]">{quirkName(id)}</span>
		<button
			type="button"
			class="cursor-pointer text-muted-foreground transition-colors hover:text-red-500"
			onclick={() => removeHeroQuirk(hero.guid, id)}
			title={t('heroes.removeQuirk')}
			aria-label={t('heroes.removeQuirkAction', { name: quirkName(id) })}
		>
			<XIcon size={11} />
		</button>
	</div>
{/snippet}

<ScrollArea class="h-full">
	<!-- A size container: two-column rows stack when the detail pane is narrow
	     (the 800x600 minimum window or a dragged splitter), whatever the window width. -->
	<div data-testid="hero-detail" class="@container space-y-4 p-4">
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
						alt={t('heroes.portrait', { name: hero.name })}
						class="h-full w-full object-cover"
					/>
				{/if}
			</div>
			<!-- Info -->
			<div class="flex min-w-0 flex-1 flex-col justify-center gap-1">
				<div class="flex flex-wrap items-center justify-between gap-x-2">
					{#if editingName}
						<Input
							bind:value={nameValue}
							aria-label={t('heroes.heroName')}
							aria-invalid={!!nameError}
							onblur={saveName}
							onkeydown={handleNameKeydown}
							class="h-7 text-sm font-medium"
							autofocus
						/>
						{#if nameError}<p role="alert" class="text-xs text-destructive">{describeMessage(nameError)}</p>{/if}
					{:else}
						<button
							type="button"
							class="group flex min-w-0 cursor-pointer items-center gap-1 rounded-none border border-transparent px-1 py-0.5 text-sm font-medium transition-colors hover:border-border hover:bg-muted/50"
							onclick={startEditName}
						>
							<span class="truncate" title={hero.name}>{hero.name}</span>
							<PencilIcon
								size={12}
								class="text-muted-foreground shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
							/>
						</button>
					{/if}
					<Tooltip>
						<TooltipTrigger>
							{#snippet child({ props })}
								<Button {...mergeProps(props, { onclick: handleRevert })} variant="ghost" size="sm" class="h-7 shrink-0 gap-1 text-xs">
									<ArrowCounterClockwiseIcon size={12} />
									{t('heroes.reset')}
								</Button>
							{/snippet}
						</TooltipTrigger>
						<TooltipContent>{t('heroes.resetHelp')}</TooltipContent>
					</Tooltip>
				</div>
				<div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1 text-xs text-muted-foreground">
					<div class="flex min-w-0 flex-wrap items-center gap-x-2">
						<span lang={gameTextLocale()}>{heroClassName(hero.heroClass)}</span>
						<span class="h-2 w-2 shrink-0 rounded-full {hero.statusDotClass}"></span>
						<span class="{isDead ? 'text-red-500' : ''}">{heroStatusLabel(hero.status)}</span>
					</div>
					<Select type="single" value={String(resolveLevel)} onValueChange={(v: string) => handleLevelChange(v)}>
						<SelectTrigger class="h-6 w-auto text-xs">
							<span class="truncate"><ResolveLabel level={resolveLevel} /></span>
						</SelectTrigger>
						<SelectContent>
							{#each Array(7) as _, i}
								<SelectItem value={String(i)}>
									<ResolveLabel level={i} xp />
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
				<span class="shrink-0 text-xs font-semibold uppercase tracking-wider">{t('heroes.vitals')}</span>
				<Separator class="flex-1" />
			</div>
			<div class="mt-2 space-y-4">
					<div class="flex flex-col gap-4 @md:flex-row">
						<!-- HP -->
						<div class="flex-1">
							<div class="mb-1 flex items-center justify-between">
								<div class="flex items-center gap-1.5">
									<GameAssetIcon
										gamePath={settings.gamePath}
										relativePath="raid/skill_attributes/skill_attribute_heal.png"
										alt={t('heroes.hp')}
										class="size-3.5"
									>
										{#snippet fallback()}<HeartIcon size={14} class="text-red-500" />{/snippet}
									</GameAssetIcon>
									<span class="text-[11px] font-medium">{t('heroes.hp')}</span>
								</div>
								<span
									class="text-xs font-mono {hero.currentHp < maxHp * 0.5
										? 'text-red-500 font-bold'
										: 'text-muted-foreground'}"
								>
									{sliderValueLabel(hero.currentHp, { min: isDead ? 0 : 1, max: hpMax, step: 1 })} / {sliderNumberLabel(hpMax)}
								</span>
							</div>
							<Slider
								{...sliderControl(hero.currentHp, { min: isDead ? 0 : 1, max: hpMax, step: 1 }, (value) => setHeroHp(hero.guid, value))}
								type="single"
							/>
							<Button
								variant="outline"
								size="sm"
								class="mt-1.5 h-6 w-full text-[11px]"
								title={t('heroes.healHelp')}
								onclick={() => healHeroToMax(hero.guid)}
								disabled={hero.currentHp >= maxHp}
							>
								{t('heroes.healToMax')}
							</Button>
						</div>

						<!-- Stress -->
						<div class="flex-1">
							<div class="mb-1 flex items-center justify-between">
								<div class="flex items-center gap-1.5">
									<GameAssetIcon
										gamePath={settings.gamePath}
										relativePath="raid/skill_attributes/skill_attribute_stress.png"
										alt={t('heroes.stress')}
										class="size-3.5"
									>
										{#snippet fallback()}<BrainIcon size={14} class="text-yellow-500" />{/snippet}
									</GameAssetIcon>
									<span class="text-[11px] font-medium">{t('heroes.stress')}</span>
								</div>
								<span
									class="text-xs font-mono {hero.stress >= 100
										? 'text-red-500 font-bold'
										: 'text-muted-foreground'}"
								>
									{sliderValueLabel(hero.stress, { min: 0, max: 200, step: 1 })} / {formatNumber(200)}
								</span>
							</div>
							<Slider
								{...sliderControl(hero.stress, { min: 0, max: 200, step: 1 }, (value) => setHeroStress(hero.guid, value))}
								type="single"
							/>
							<Button
								variant="outline"
								size="sm"
								class="mt-1.5 h-6 w-full text-[11px]"
								onclick={() => setHeroStress(hero.guid, 0)}
								disabled={hero.stress === 0}
							>
								{t('heroes.clearStress')}
							</Button>
							{#if hero.stress >= 100}
								<p class="text-destructive mt-1 text-[11px]">
									<Message id="heroes.afflictionThreshold" params={{ name: hero.afflictionTypeId ? afflictionName(hero.afflictionTypeId) : t('heroes.noneSet') }}>
										{#snippet emphasis(children)}<span lang={hero.afflictionTypeId ? gameTextLocale() : getEditorLocale()}>{@render children()}</span>{/snippet}
										{#snippet code(children)}{@render children()}{/snippet}
										{#snippet link(children)}{@render children()}{/snippet}
									</Message>
								</p>
							{/if}
						</div>
					</div>

					<!-- Affliction / Virtue and Deaths Door
					     Both `affliction_type_id` and `visited_deaths_door` are stored in
					     persist.roster.json under each hero's base_root (hamlet state).
					     They persist across raids and are NOT in persist.raid.json.
					     Changes here are written to persist.roster.json. -->

					<div class="flex flex-col gap-4 @md:flex-row">
						<!-- Affliction -->
						<div class="flex-1">
							<div class="mb-1 flex items-center justify-between">
								<span class="text-[11px] font-medium">{t('heroes.afflictionVirtue')}</span>
								{#if hero.afflictionTypeId || hero.virtueTypeId}
									<Button
										variant="ghost"
										size="sm"
										class="h-5 text-[10px]"
										onclick={() => setHeroAffliction(hero.guid, '')}
									>
										{t('heroes.clear')}
									</Button>
								{/if}
							</div>
							<Select
								type="single"
								value={hero.virtueTypeId || hero.afflictionTypeId || '_none'}
								onValueChange={(v: string) => commitChangedValue(hero.virtueTypeId || hero.afflictionTypeId || '_none', v, (id) => setHeroAffliction(hero.guid, id === '_none' ? '' : id))}
							>
								<SelectTrigger class="h-8 text-xs">
									<span>{#if hero.virtueTypeId || hero.afflictionTypeId}<span lang={gameTextLocale()}>{afflictionName(hero.virtueTypeId || hero.afflictionTypeId)}</span>{:else}{t('heroes.none')}{/if}</span>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="_none">{t('heroes.none')}</SelectItem>
									{#each afflictionIds.filter((id) => id !== 'color_madness' || dlcFlags.hasColorOfMadness) as id (id)}
										<SelectItem value={id}>
											<Message id="heroes.afflictionOption" params={{ name: afflictionName(id), kind: VIRTUES.includes(id) ? 'virtue' : id }}>
												{#snippet code(children)}{@render children()}{/snippet}
												{#snippet link(children)}{@render children()}{/snippet}
												{#snippet emphasis(children)}<span lang={gameTextLocale()}>{@render children()}</span>{/snippet}
											</Message>
										</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>

						<!-- Deaths Door -->
						<div class="flex-1">
							<div class="mb-1 flex flex-wrap items-center justify-between gap-x-2">
								<span class="text-[11px] font-medium">{t('heroes.deathsDoor')}</span>
								<Tooltip>
									<TooltipTrigger>
										<span class="text-muted-foreground text-[10px]">{t('heroes.historicalFlag')}</span>
									</TooltipTrigger>
									<TooltipContent class="max-w-60">
										{t('heroes.deathsDoorHelp')}
									</TooltipContent>
								</Tooltip>
							</div>
							<div class="flex h-8 items-center justify-between rounded-none border px-2">
								<span class="text-xs text-muted-foreground">{hero.visitedDeathsDoor ? t('heroes.visited') : t('heroes.never')}</span>
								<Switch
									checked={hero.visitedDeathsDoor}
									onCheckedChange={(checked) => commitChangedValue(hero.visitedDeathsDoor, checked, (value) => setHeroDeathsDoor(hero.guid, value))}
								/>
							</div>
						</div>
					</div>
			</div>
		</div>

		<!-- ═══════ Quirks Section ═══════ -->
		<div>
			<div class="flex items-center gap-2 py-1">
				<span class="shrink-0 text-xs font-semibold uppercase tracking-wider">{t('heroes.quirks')}</span>
				<Separator class="flex-1" />
			</div>
			<div class="mt-2 grid grid-cols-1 gap-4 @md:grid-cols-2">
					<!-- Positive Column -->
					<div>
						<div class="mb-2 flex items-center justify-between">
							<span class="text-[11px] font-medium text-green-600 dark:text-green-400">
								{t('heroes.positiveCount', { countText: formatNumber(positiveQuirks.length) })}
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
								{t('heroes.addPositive')}
							</Button>
						{/if}
					</div>

					<!-- Negative + Disease Column -->
					<div>
						<div class="mb-2 flex items-center justify-between">
							<span class="text-[11px] font-medium text-red-600 dark:text-red-400">
								{t('heroes.negativeCount', { countText: formatNumber(negativeCount) })}
							</span>
						</div>

						<!-- Diseases -->
						{#if diseaseQuirks.length > 0}
							<div class="mb-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
								{t('heroes.diseases')}
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
								{t('heroes.addNegative')}
							</Button>
						{/if}
						<p class="text-muted-foreground mt-2 text-[10px]">
							{t('heroes.diseaseLimitHelp')}
						</p>
					</div>
				</div>

				<!-- Quirk Picker Overlay -->
				{#if showQuirkPicker}
					<div data-testid="quirk-picker" class="mt-3 rounded-none border p-2">
						<div class="mb-2 flex items-center justify-between">
							<span class="text-[11px] font-medium">
								{t('heroes.addQuirk', { category: quirkPickerCategory })}
							</span>
							<button
								type="button"
								class="text-muted-foreground cursor-pointer hover:text-foreground"
								onclick={() => (showQuirkPicker = false)}
								aria-label={t('heroes.closeQuirkPicker')}
							>
								<XIcon size={14} />
							</button>
						</div>
						<Input
							placeholder={t('heroes.searchQuirks')}
							bind:value={quirkSearch}
							class="mb-2 h-7 text-xs"
							autofocus
						/>
						<div class="max-h-50 overflow-y-auto">
							{#each filteredPickerQuirks.slice(0, 50) as quirk (quirk.id)}
								<button
									type="button"
									class="flex w-full cursor-pointer items-start gap-2 px-2 py-1 text-left text-[11px] transition-colors hover:bg-muted"
									onclick={() => pickQuirk(quirk.id)}
								>
									<span
										class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full {quirk.category === 'positive'
											? 'bg-green-500'
											: quirk.category === 'disease'
												? 'bg-amber-500'
												: 'bg-red-500'}"
									></span>
									<span class="min-w-0 flex-1 [overflow-wrap:anywhere]">
										<span lang={gameTextLocale()}>{quirk.displayName}</span>
										<span class="text-muted-foreground/50 text-[10px]">{quirk.id}</span>
										{#if quirk.description}
											<span class="text-muted-foreground line-clamp-2 block text-[10px] leading-snug" lang={gameTextLocale()} title={quirk.description}>{quirk.description}</span>
										{/if}
									</span>
								</button>
							{/each}
							{#if filteredPickerQuirks.length === 0}
								<p class="text-muted-foreground py-2 text-center text-[11px]">{t('heroes.noQuirksFound')}</p>
							{/if}
						</div>
					</div>
				{/if}
		</div>

		<!-- ═══════ D1: Skills Section ═══════ -->
		<div>
			<div class="flex items-center gap-2 py-1">
				<span class="shrink-0 text-xs font-semibold uppercase tracking-wider">{t('heroes.skills')}</span>
				<Separator class="flex-1" />
			</div>
			<div class="mt-2 space-y-3">
					<!-- Combat Skills -->
					<div>
						<span class="text-muted-foreground mb-1 block text-[11px] font-medium">
							{t('heroes.combatCount', { countText: formatNumber(combatSkillIds.length), limited: availableCombat.length > 0 && !isAbomination ? 'yes' : 'no', maxText: formatNumber(MAX_COMBAT_SKILLS) })}
						</span>
						{#if availableCombat.length > 0}
							{#if isAbomination}
								<div class="grid grid-cols-2 gap-0.5 xl:grid-cols-4">
									{#each availableCombat as skillId (skillId)}
										<div class="flex items-center gap-2 px-2 py-1 text-[11px] opacity-60">
											<span class="h-2 w-2 rounded-full bg-orange-400 shrink-0 ring-1 ring-orange-400"></span>
											<span lang={gameTextLocale()} class="truncate font-mono" title={combatSkillName(hero.heroClass, skillId)}>{combatSkillName(hero.heroClass, skillId)}</span>
										</div>
									{/each}
								</div>
								<p class="text-muted-foreground mt-1 text-[10px]">{t('heroes.fixedSkillSet')}</p>
							{:else}
								<div class="grid grid-cols-2 gap-0.5 xl:grid-cols-4">
									{#each availableCombat as skillId (skillId)}
										{@const isSelected = combatSkillIds.includes(skillId)}
										{@const disableOn = !isSelected && combatSkillIds.length >= MAX_COMBAT_SKILLS}
										{@const disableOff = isSelected && combatSkillIds.length <= 1}
										<Tooltip>
											<TooltipTrigger>
												{#snippet child({ props })}
													<button {...mergeProps(props, { onclick: () => handleToggleCombat(skillId) })}
														type="button"
														class="flex w-full items-center gap-2 rounded-none px-2 py-1 text-left text-[11px] transition-colors
															{isSelected ? 'bg-orange-500/10 hover:bg-orange-500/20' : 'hover:bg-muted'}
															{(disableOn || disableOff) ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}"
														aria-disabled={disableOn || disableOff}
														aria-pressed={isSelected}
														aria-label={t('heroes.skillAction', { selected: isSelected ? 'yes' : 'no', name: combatSkillName(hero.heroClass, skillId) })}
													>
														{#if isSelected}
															<span class="h-2 w-2 rounded-full bg-orange-400 shrink-0 ring-1 ring-orange-400"></span>
														{:else}
															<span class="h-2 w-2 rounded-full border border-orange-400 shrink-0"></span>
														{/if}
														<span lang={gameTextLocale()} class="truncate font-mono" title={combatSkillName(hero.heroClass, skillId)}>{combatSkillName(hero.heroClass, skillId)}</span>
													</button>
												{/snippet}
											</TooltipTrigger>
											<TooltipContent>
												{#if disableOn}
													{t('heroes.combatLimit')}
												{:else if disableOff}
													{t('heroes.combatMinimum')}
												{:else if isSelected}
													{t('heroes.clickToDeselect')}
												{:else}
													{t('heroes.clickToSelect')}
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
											<span lang={gameTextLocale()} class="truncate font-mono" title={combatSkillName(hero.heroClass, skillId)}>{combatSkillName(hero.heroClass, skillId)}</span>
										</div>
									{/each}
								</div>
							{:else}
								<p class="text-muted-foreground text-[11px]">{t('heroes.noCombatSkillsSelected')}</p>
							{/if}
							<p class="text-muted-foreground/60 text-[10px]">
								{t('heroes.skillsReadOnly')}
							</p>
						{/if}
					</div>

					<!-- Camping Skills -->
					<div>
						<span class="text-muted-foreground mb-1 block text-[11px] font-medium">
							{t('heroes.campingCount', { countText: formatNumber(campingSkillIds.length) })}
						</span>
						{#if availableCamping.length > 0}
							<div class="grid grid-cols-2 gap-0.5 xl:grid-cols-4">
								{#each availableCamping as skillId (skillId)}
									{@const isSelected = campingSkillIds.includes(skillId)}
									<Tooltip>
										<TooltipTrigger>
											{#snippet child({ props })}
												<button {...mergeProps(props, { onclick: () => handleToggleCamping(skillId) })}
													type="button"
													class="flex w-full items-center gap-2 rounded-none px-2 py-1 text-left text-[11px] transition-colors cursor-pointer
														{isSelected ? 'bg-blue-500/10 hover:bg-blue-500/20' : 'hover:bg-muted'}"
													aria-pressed={isSelected}
													aria-label={t('heroes.skillAction', { selected: isSelected ? 'yes' : 'no', name: campingSkillName(skillId) })}
												>
													{#if isSelected}
														<span class="h-2 w-2 rounded-full bg-blue-400 shrink-0 ring-1 ring-blue-400"></span>
													{:else}
														<span class="h-2 w-2 rounded-full border border-blue-400 shrink-0"></span>
													{/if}
													<span lang={gameTextLocale()} class="truncate font-mono" title={campingSkillName(skillId)}>{campingSkillName(skillId)}</span>
												</button>
											{/snippet}
										</TooltipTrigger>
										<TooltipContent>
											{#if isSelected}{t('heroes.clickToDeselect')}{:else}{t('heroes.clickToSelect')}{/if}
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
											<span lang={gameTextLocale()} class="truncate font-mono" title={campingSkillName(skillId)}>{campingSkillName(skillId)}</span>
										</div>
									{/each}
								</div>
							{:else}
								<p class="text-muted-foreground text-[11px]">{t('heroes.noCampingSkillsSelected')}</p>
							{/if}
							<p class="text-muted-foreground/60 text-[10px]">
								{t('heroes.skillsReadOnly')}
							</p>
						{/if}
					</div>
			</div>
		</div>

		<!-- ═══════ Equipment Section ═══════ -->
		<div>
			<div class="flex items-center gap-2 py-1">
				<span class="shrink-0 text-xs font-semibold uppercase tracking-wider">{t('heroes.equipment')}</span>
				<Separator class="flex-1" />
			</div>
			<div class="mt-2 space-y-3">
					<div class="flex flex-col gap-4 @md:flex-row">
						<!-- Weapon Rank -->
						<div class="flex-1">
							<span class="text-muted-foreground mb-1 block text-[11px]">
								{t('heroes.weaponMax4')}
							</span>
							<Select
								type="single"
								value={String(hero.weaponRank)}
								onValueChange={(v: string) => { const parsed = parseInteger(v, 0, 4); if (parsed.error === undefined) commitChangedValue(hero.weaponRank, parsed.value, (rank) => setHeroWeaponRank(hero.guid, rank)); }}
							>
								<SelectTrigger class="h-8 text-xs">
									<span>{t('heroes.rank', { rankText: formatNumber(hero.weaponRank) })}</span>
								</SelectTrigger>
								<SelectContent>
									{#each Array(5) as _, i}
										<SelectItem value={String(i)}>{t('heroes.rank', { rankText: formatNumber(i) })}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>

						<!-- Armour Rank -->
						<div class="flex-1">
							<span class="text-muted-foreground mb-1 block text-[11px]">
								{t('heroes.armourMax4')}
							</span>
							<Select
								type="single"
								value={String(hero.armourRank)}
								onValueChange={(v: string) => { const parsed = parseInteger(v, 0, 4); if (parsed.error === undefined) commitChangedValue(hero.armourRank, parsed.value, (rank) => setHeroArmourRank(hero.guid, rank)); }}
							>
								<SelectTrigger class="h-8 text-xs">
									<span>{t('heroes.rank', { rankText: formatNumber(hero.armourRank) })}</span>
								</SelectTrigger>
								<SelectContent>
									{#each Array(5) as _, i}
										<SelectItem value={String(i)}>{t('heroes.rank', { rankText: formatNumber(i) })}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
							<p class="text-muted-foreground mt-1 text-[10px]">
								{t('heroes.baseHp', { hpText: formatNumber(maxHp) })}
							</p>
						</div>
					</div>

					<!-- D3: Trinket Slots -->
					<div>
						<span class="text-muted-foreground mb-1 block text-[11px] font-medium">{t('heroes.trinkets')}</span>
						<div class="grid grid-cols-1 gap-2 @md:grid-cols-2">
							<!-- Slot 0 -->
							<div>
								<span class="text-muted-foreground mb-1 block text-[10px]">{t('heroes.slot1')}</span>
								<div class="rounded-none border px-2 py-1.5 text-[11px] {trinketSlot0?.id ? '' : 'text-muted-foreground'}">
									{#if trinketSlot0?.id}
										<span lang={gameTextLocale()} class="font-mono">{trinketName(trinketSlot0.id)}</span>
									{:else}
										<span class="italic">{t('heroes.empty')}</span>
									{/if}
								</div>
								<TrinketPicker
									value={trinketSlot0?.id ?? ''}
									otherIds={trinketSlot1?.id ? [trinketSlot1.id] : []}
									heroClass={hero.heroClass}
									disabled={isDead}
									onselect={(id, source) => handleTrinketSelect('0', id, source)}
								/>
							</div>
							<!-- Slot 1 -->
							<div>
								<span class="text-muted-foreground mb-1 block text-[10px]">{t('heroes.slot2')}</span>
								<div class="rounded-none border px-2 py-1.5 text-[11px] {trinketSlot1?.id ? '' : 'text-muted-foreground'}">
									{#if trinketSlot1?.id}
										<span lang={gameTextLocale()} class="font-mono">{trinketName(trinketSlot1.id)}</span>
									{:else}
										<span class="italic">{t('heroes.empty')}</span>
									{/if}
								</div>
								<TrinketPicker
									value={trinketSlot1?.id ?? ''}
									otherIds={trinketSlot0?.id ? [trinketSlot0.id] : []}
									heroClass={hero.heroClass}
									disabled={isDead}
									onselect={(id, source) => handleTrinketSelect('1', id, source)}
								/>
							</div>
						</div>
						{#if isDead}<p class="text-muted-foreground mt-1 text-[10px]">{t('heroes.trinketsDeadHelp')}</p>{/if}
					</div>
			</div>
		</div>

		<!-- D2: Blood Curse Section (visible only if Crimson Court DLC is installed AND hero has disease_vampire_* quirk) -->
		{#if dlcFlags.hasCrimsonCourt && hasBloodCurse}
			<div>
				<div class="flex items-center gap-2 py-1">
					<DropIcon size={14} class="shrink-0 text-red-500" />
					<span class="shrink-0 text-xs font-semibold uppercase tracking-wider">{t('heroes.bloodCurse')}</span>
					<Separator class="flex-1" />
					{#if vampireQuirkId}
						<Badge variant="outline" class="shrink-0 h-4 text-[10px] text-red-600 dark:text-red-400">
							{vampireStateName(vampireQuirkId)}
						</Badge>
					{/if}
				</div>
				<div class="mt-2 space-y-2">
						<div>
							<span class="text-muted-foreground mb-1 block text-[11px]">{t('heroes.currentState')}</span>
							<Select
								type="single"
								value={vampireQuirkId ?? ''}
								onValueChange={(v: string) => handleBloodCurseChange(v)}
							>
								<SelectTrigger class="h-8 text-xs">
									<span>{#if vampireQuirkId}{vampireStateName(vampireQuirkId)}{:else}{t('heroes.unknown')}{/if}</span>
								</SelectTrigger>
								<SelectContent>
									{#each VAMPIRE_QUIRK_IDS as id (id)}
										<SelectItem value={id}>{vampireStateName(id)}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
						<p class="text-muted-foreground text-[10px]">
							{t('heroes.curseHelp')}
						</p>
					</div>
			</div>
		{/if}

		<!-- ═══════ Actions Section ═══════ -->
		<div>
			<div class="flex items-center gap-2 py-1">
				<span class="shrink-0 text-xs font-semibold uppercase tracking-wider">{t('heroes.actions')}</span>
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
							{t('heroes.reviveHero')}
						</Button>
						<p class="text-muted-foreground text-[10px]">
							{t('heroes.reviveConsequences')}
						</p>
					{/if}

					<!-- D8: Dismiss Hero : triggers AlertDialog -->
					<div class="rounded-none border border-red-500/20 p-3">
						<p class="mb-2 text-xs font-medium text-red-600 dark:text-red-400">{t('heroes.dismissHero')}</p>
						<p class="text-muted-foreground mb-2 text-[11px]">
							{t('heroes.dismissDescription', { name: hero.name })}
						</p>
						<Button
							variant="destructive"
							size="sm"
							class="w-full gap-2 text-xs"
							disabled={!!dismissReason}
							onclick={() => (dismissDialogOpen = true)}
						>
							<TrashIcon size={14} />
							{t('heroes.dismissName', { name: hero.name })}
						</Button>
						{#if dismissReason}<p class="mt-2 text-xs text-destructive">{describeMessage(dismissReason)}</p>{/if}
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
				{t('heroes.dismissQuestion', { name: hero.name })}
			</DialogTitle>
			<DialogDescription>
				{t('heroes.dismissDialogHelp')}
			</DialogDescription>
		</DialogHeader>
		<div class="space-y-3 py-2">
			<label class="flex cursor-pointer items-start gap-2">
				<Checkbox bind:checked={dismissConfirmChecked} class="mt-0.5" />
				<span class="text-[11px] leading-relaxed">
					{t('heroes.dismissConfirm')}
				</span>
			</label>
		</div>
		<DialogFooter class="gap-2 sm:justify-end">
			<Button
				variant="outline"
				size="sm"
				onclick={() => { dismissDialogOpen = false; dismissConfirmChecked = false; }}
			>
				{t('heroes.cancel')}
			</Button>
			<Button
				variant="destructive"
				size="sm"
				disabled={!dismissConfirmChecked || !!dismissReason}
				onclick={handleDismissConfirm}
				class="gap-1"
			>
				<TrashIcon size={14} />
				{t('heroes.dismiss')}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Revival Wizard (rendered outside ScrollArea to avoid z-index issues) -->
{#if isDead}
	<RevivalWizard heroes={[hero]} bind:open={revivalWizardOpen} />
{/if}
