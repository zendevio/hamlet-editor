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
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import CaretRight from 'phosphor-svelte/lib/CaretRight';
	import Heart from 'phosphor-svelte/lib/Heart';
	import Brain from 'phosphor-svelte/lib/Brain';
	import Skull from 'phosphor-svelte/lib/Skull';
	import Lock from 'phosphor-svelte/lib/Lock';
	import LockOpen from 'phosphor-svelte/lib/LockOpen';
	import X from 'phosphor-svelte/lib/X';
	import Plus from 'phosphor-svelte/lib/Plus';
	import ArrowCounterClockwise from 'phosphor-svelte/lib/ArrowCounterClockwise';
	import Pencil from 'phosphor-svelte/lib/Pencil';
	import Trash from 'phosphor-svelte/lib/Trash';
	import type { HeroSummary, HeroQuirk } from '$lib/stores/save-data.svelte';
	import {
		getMaxHp,
		maxGearRank,
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
		RESOLVE_LEVEL_NAMES,
		RESOLVE_XP_THRESHOLDS
	} from '$lib/stores/save-data.svelte';
	import { isPositiveQuirk, isDiseaseQuirk, getAllQuirks } from '$lib/data/quirks';
	import RevivalWizard from './RevivalWizard.svelte';

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
	let equipmentOpen = $state(false);
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

	// ── Dismiss confirmation ──
	let dismissConfirmChecked = $state(false);

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

	function quirkDisplayName(id: string): string {
		return id
			.split('_')
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' ');
	}

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

	function handleLevelChange(value: string) {
		const level = parseInt(value);
		if (!isNaN(level)) {
			setHeroLevel(hero.guid, level);
			// Also constrain gear to max for the new level
			const newMaxGear = maxGearRank(level);
			if (hero.weaponRank > newMaxGear) setHeroWeaponRank(hero.guid, newMaxGear);
			if (hero.armourRank > newMaxGear) setHeroArmourRank(hero.guid, newMaxGear);
		}
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

	function handleDismiss() {
		dismissHero(hero.guid);
		dismissConfirmChecked = false;
		onDismiss?.();
	}

	function handleRevert() {
		revertHero(hero.guid);
	}
</script>

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
						<Skull size={28} class="text-muted-foreground" />
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
						<ArrowCounterClockwise size={12} />
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
					<CaretDown size={14} class="text-muted-foreground" />
				{:else}
					<CaretRight size={14} class="text-muted-foreground" />
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
								<Pencil
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
					</div>
				</div>
			</CollapsibleContent>
		</Collapsible>

		<Separator />

		<!-- ═══════ Vitals Section ═══════ -->
		<Collapsible bind:open={vitalsOpen}>
			<CollapsibleTrigger class="flex w-full items-center gap-2 py-1">
				{#if vitalsOpen}
					<CaretDown size={14} class="text-muted-foreground" />
				{:else}
					<CaretRight size={14} class="text-muted-foreground" />
				{/if}
				<span class="text-xs font-semibold uppercase tracking-wider">Vitals</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div class="mt-2 space-y-4">
					<!-- HP -->
					<div>
						<div class="mb-2 flex items-center justify-between">
							<div class="flex items-center gap-1.5">
								<Heart size={14} class="text-red-500" />
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
								<Brain size={14} class="text-yellow-500" />
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
								<span>{hero.afflictionTypeId ? quirkDisplayName(hero.afflictionTypeId) : 'None'}</span>
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
					<CaretDown size={14} class="text-muted-foreground" />
				{:else}
					<CaretRight size={14} class="text-muted-foreground" />
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
								<div
									class="flex items-center gap-1 rounded-none border border-green-500/20 bg-green-500/5 px-2 py-1"
								>
									<button
										class="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
										onclick={() => toggleQuirkLock(hero.guid, id)}
										title={quirk.is_locked ? 'Unlock quirk' : 'Lock quirk'}
									>
										{#if quirk.is_locked}
											<Lock size={11} class="text-yellow-500" />
										{:else}
											<LockOpen size={11} />
										{/if}
									</button>
									<span class="flex-1 truncate text-[11px]">{quirkDisplayName(id)}</span>
									<button
										class="cursor-pointer text-muted-foreground transition-colors hover:text-red-500"
										onclick={() => removeHeroQuirk(hero.guid, id)}
										title="Remove quirk"
									>
										<X size={11} />
									</button>
								</div>
							{/each}
						</div>
						{#if canAddPositive}
							<Button
								variant="ghost"
								size="sm"
								class="mt-1 h-6 w-full text-[11px]"
								onclick={() => openQuirkPicker('positive')}
							>
								<Plus size={11} class="mr-1" />
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
									<div
										class="flex items-center gap-1 rounded-none border border-amber-500/20 bg-amber-500/10 px-2 py-1"
									>
										<button
											class="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
											onclick={() => toggleQuirkLock(hero.guid, id)}
											title={quirk.is_locked ? 'Unlock quirk' : 'Lock quirk'}
										>
											{#if quirk.is_locked}
												<Lock size={11} class="text-yellow-500" />
											{:else}
												<LockOpen size={11} />
											{/if}
										</button>
										<span class="flex-1 truncate text-[11px]">{quirkDisplayName(id)}</span>
										<button
											class="cursor-pointer text-muted-foreground transition-colors hover:text-red-500"
											onclick={() => removeHeroQuirk(hero.guid, id)}
											title="Remove quirk"
										>
											<X size={11} />
										</button>
									</div>
								{/each}
							</div>
						{/if}

						<!-- Negative (non-disease) -->
						<div class="space-y-1 {diseaseQuirks.length > 0 ? 'mt-2' : ''}">
							{#each negativeQuirks as [id, quirk] (id)}
								<div
									class="flex items-center gap-1 rounded-none border border-red-500/20 bg-red-500/5 px-2 py-1"
								>
									<button
										class="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
										onclick={() => toggleQuirkLock(hero.guid, id)}
										title={quirk.is_locked ? 'Unlock quirk' : 'Lock quirk'}
									>
										{#if quirk.is_locked}
											<Lock size={11} class="text-yellow-500" />
										{:else}
											<LockOpen size={11} />
										{/if}
									</button>
									<span class="flex-1 truncate text-[11px]">{quirkDisplayName(id)}</span>
									<button
										class="cursor-pointer text-muted-foreground transition-colors hover:text-red-500"
										onclick={() => removeHeroQuirk(hero.guid, id)}
										title="Remove quirk"
									>
										<X size={11} />
									</button>
								</div>
							{/each}
						</div>
						{#if canAddNegative}
							<Button
								variant="ghost"
								size="sm"
								class="mt-1 h-6 w-full text-[11px]"
								onclick={() => openQuirkPicker('negative')}
							>
								<Plus size={11} class="mr-1" />
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
							>
								<X size={14} />
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

		<!-- ═══════ Equipment Section ═══════ -->
		<Collapsible bind:open={equipmentOpen}>
			<CollapsibleTrigger class="flex w-full items-center gap-2 py-1">
				{#if equipmentOpen}
					<CaretDown size={14} class="text-muted-foreground" />
				{:else}
					<CaretRight size={14} class="text-muted-foreground" />
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
				</div>
			</CollapsibleContent>
		</Collapsible>

		<Separator />

		<!-- ═══════ Actions Section ═══════ -->
		<Collapsible bind:open={actionsOpen}>
			<CollapsibleTrigger class="flex w-full items-center gap-2 py-1">
				{#if actionsOpen}
					<CaretDown size={14} class="text-muted-foreground" />
				{:else}
					<CaretRight size={14} class="text-muted-foreground" />
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
							<Heart size={14} class="text-green-500" />
							Revive Hero
						</Button>
						<p class="text-muted-foreground text-[10px]">
							Opens the Revival Wizard to restore this hero across all required save files.
						</p>
					{/if}

					<!-- Dismiss Hero -->
					<div class="rounded-none border border-red-500/20 p-3">
						<p class="mb-2 text-xs font-medium text-red-600 dark:text-red-400">Dismiss Hero</p>
						<p class="text-muted-foreground mb-2 text-[11px]">
							Permanently remove {hero.name} from the roster. This cannot be undone after saving.
						</p>
						<label class="mb-2 flex items-center gap-2">
							<input
								type="checkbox"
								bind:checked={dismissConfirmChecked}
								class="h-3.5 w-3.5"
							/>
							<span class="text-[11px]">
								I understand this hero will be permanently removed from the roster
							</span>
						</label>
						<Button
							variant="destructive"
							size="sm"
							class="w-full gap-2 text-xs"
							disabled={!dismissConfirmChecked}
							onclick={handleDismiss}
						>
							<Trash size={14} />
							Dismiss {hero.name}
						</Button>
					</div>
				</div>
			</CollapsibleContent>
		</Collapsible>
	</div>
</ScrollArea>

<!-- Revival Wizard (rendered outside ScrollArea to avoid z-index issues) -->
{#if isDead}
	<RevivalWizard {hero} bind:open={revivalWizardOpen} />
{/if}
