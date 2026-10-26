<!-- NOTE: This list renders all heroes without virtual scrolling.
     For typical DD1 rosters (< 30 heroes), this performs well.
     Virtual scrolling can be added later if needed for heavily modded games. -->
<script lang="ts">
	import { mergeProps } from 'bits-ui';
	import { t } from '#lib/i18n/index.svelte.js';
	import { formatNumber, compareNames } from '#lib/i18n/intl.js';
	import { heroClassEnglishName, heroStatusLabel, heroClassName, gameTextLocale } from '#lib/save-labels.js';
	import { matchesSearch } from '#lib/search.js';
	import { sortHeroes } from '#lib/hero-order.js';

	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '#lib/components/ui/select/index.js';
	import { Tooltip, TooltipContent, TooltipTrigger } from '#lib/components/ui/tooltip/index.js';
	import SkullIcon from 'phosphor-svelte/lib/SkullIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import FunnelSimpleIcon from 'phosphor-svelte/lib/FunnelSimpleIcon';
	import GameAssetImage from '#lib/components/GameAssetImage.svelte';
	import { getSettings } from '#lib/stores/settings.svelte.js';
	import { getPortraitPath } from '#lib/utils.js';
	import type { HeroSummary } from '#lib/stores/save-data.svelte.js';
	import { STATUS_MAP } from '#lib/stores/save-data.svelte.js';

	const settings = getSettings();

	let {
		heroes,
		selectedGuids = $bindable(new Set<string>()),
		activeGuid = $bindable<string | null>(null)
	}: {
		heroes: HeroSummary[];
		selectedGuids: Set<string>;
		activeGuid: string | null;
	} = $props();

	// ── Filters & Sort ──
	let searchQuery = $state('');
	let sortBy = $state<string>('name');
	let statusFilter = $state<Set<number>>(new Set());
	let classFilter = $state<Set<string>>(new Set());
	let showFilters = $state(false);

	// Available classes from current hero data
	let availableClasses = $derived(
		[...new Set(heroes.map((h) => h.heroClass))].sort((a, b) => compareNames(heroClassName(a), a, heroClassName(b), b, gameTextLocale()))
	);

	// Available statuses from current hero data
	let availableStatuses = $derived(
		[...new Set(heroes.map((h) => h.status))].sort()
	);

	// ── Filtering ──
	let filteredHeroes = $derived.by(() => {
		let result = heroes;

		// Text search
		if (searchQuery.trim()) {
			result = result.filter((h) => matchesSearch(searchQuery, h.name, heroClassName(h.heroClass), heroClassEnglishName(h.heroClass), h.heroClass));
		}

		// Status filter
		if (statusFilter.size > 0) {
			result = result.filter((h) => statusFilter.has(h.status));
		}

		// Class filter
		if (classFilter.size > 0) {
			result = result.filter((h) => classFilter.has(h.heroClass));
		}

		return result;
	});

	// ── Sorting ──
	let sortedHeroes = $derived(sortHeroes(filteredHeroes, sortBy));

	// ── Selection ──
	let allVisibleSelected = $derived(
		sortedHeroes.length > 0 && sortedHeroes.every((h) => selectedGuids.has(h.guid))
	);

	function toggleSelectAll() {
		if (allVisibleSelected) {
			selectedGuids = new Set();
		} else {
			selectedGuids = new Set(sortedHeroes.map((h) => h.guid));
		}
	}

	function toggleSelect(guid: string) {
		const next = new Set(selectedGuids);
		if (next.has(guid)) {
			next.delete(guid);
		} else {
			next.add(guid);
		}
		selectedGuids = next;
	}

	function selectHero(guid: string) {
		activeGuid = guid;
	}

	function toggleStatusFilter(status: number) {
		const next = new Set(statusFilter);
		if (next.has(status)) {
			next.delete(status);
		} else {
			next.add(status);
		}
		statusFilter = next;
	}

	function toggleClassFilter(cls: string) {
		const next = new Set(classFilter);
		if (next.has(cls)) {
			next.delete(cls);
		} else {
			next.add(cls);
		}
		classFilter = next;
	}

	function clearFilters() {
		searchQuery = '';
		statusFilter = new Set();
		classFilter = new Set();
	}

	let hasActiveFilters = $derived(
		searchQuery.trim().length > 0 || statusFilter.size > 0 || classFilter.size > 0
	);
</script>

<div class="flex h-full min-h-0 flex-col">
	<!-- Search & Controls: in a short pane the open filters scroll instead of
	     squeezing the hero list below out of view. -->
	<div class="flex min-h-0 flex-col gap-2 overflow-y-auto border-b p-3">
		<!-- Wraps in a narrow pane; the minimum widths keep search and sort readable. -->
		<div class="flex flex-wrap items-center gap-2">
			<div class="relative min-w-32 flex-2">
				<MagnifyingGlassIcon
					class="text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2"
					size={14}
				/>
				<Input
					placeholder={t('heroes.searchHeroes')}
					bind:value={searchQuery}
					class="h-8 pl-7 text-xs"
					aria-label={t('heroes.searchHeroesByNameOrClass')}
				/>
			</div>
			<Tooltip>
				<TooltipTrigger>
					{#snippet child({ props })}
						<Button {...mergeProps(props, { onclick: () => (showFilters = !showFilters) })}
							variant={showFilters ? 'secondary' : 'ghost'}
							size="sm"
							class="h-8 w-8 p-0"
							aria-label={t('heroes.toggleFilters')}
							aria-expanded={showFilters}
						>
							<FunnelSimpleIcon size={14} />
						</Button>
					{/snippet}
				</TooltipTrigger>
				<TooltipContent>{t('heroes.toggleFilters')}</TooltipContent>
			</Tooltip>
			<Select type="single" bind:value={sortBy}>
				<SelectTrigger class="h-8 min-w-fit flex-1 text-xs">
					<span class="text-xs truncate">{t('heroes.sort', { sort: sortBy })}</span>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="name">{t('heroes.name')}</SelectItem>
					<SelectItem value="status">{t('heroes.status')}</SelectItem>
					<SelectItem value="class">{t('heroes.class')}</SelectItem>
					<SelectItem value="level">{t('heroes.level')}</SelectItem>
					<SelectItem value="hp">{t('heroes.hp')}</SelectItem>
					<SelectItem value="stress">{t('heroes.stress')}</SelectItem>
				</SelectContent>
			</Select>
		</div>

		{#if showFilters}
			<div class="flex flex-col gap-2">
				<!-- Status filter -->
				<div class="flex flex-wrap gap-1">
					<span class="text-muted-foreground mr-1 self-center text-[10px] uppercase tracking-wider">{t('heroes.statusFilter')}</span>
					{#each availableStatuses as status}
						{@const info = STATUS_MAP[status]}
						<button
							class="inline-flex h-6 cursor-pointer items-center gap-1 rounded-none border px-2 text-[11px] transition-colors {statusFilter.has(
								status
							)
								? 'border-foreground/30 bg-foreground/10'
								: 'border-transparent hover:bg-muted'}"
							aria-pressed={statusFilter.has(status)}
							onclick={() => toggleStatusFilter(status)}
						>
							<span class="h-2 w-2 rounded-full {info?.dotClass ?? 'bg-gray-400'}"></span>
							{heroStatusLabel(status)}
						</button>
					{/each}
				</div>

				<!-- Class filter -->
				<div class="flex flex-wrap gap-1">
					<span class="text-muted-foreground mr-1 self-center text-[10px] uppercase tracking-wider">{t('heroes.classFilter')}</span>
					{#each availableClasses as cls}
						<button
							class="inline-flex h-6 cursor-pointer items-center gap-1 rounded-none border px-2 text-[11px] transition-colors {classFilter.has(
								cls
							)
								? 'border-foreground/30 bg-foreground/10'
								: 'border-transparent hover:bg-muted'}"
							aria-pressed={classFilter.has(cls)}
							onclick={() => toggleClassFilter(cls)}
						>
							<span lang={gameTextLocale()}>{heroClassName(cls)}</span>
						</button>
					{/each}
				</div>

				{#if hasActiveFilters}
					<Button variant="ghost" size="sm" class="h-6 self-start text-xs" onclick={clearFilters}>
						{t('heroes.clearFiltersInline')}
					</Button>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Select All -->
	<div class="flex items-center gap-2 border-b px-3 py-1.5">
		<Checkbox
			checked={allVisibleSelected}
			onCheckedChange={toggleSelectAll}
			class="h-3.5 w-3.5"
		/>
		<span class="text-muted-foreground text-[11px]">
			{t('heroes.selected', { countText: formatNumber(selectedGuids.size), totalText: formatNumber(heroes.length) })}
			{#if filteredHeroes.length !== heroes.length}
				<span class="text-muted-foreground/60">{t('heroes.shown', { countText: formatNumber(sortedHeroes.length) })}</span>
			{/if}
		</span>
	</div>

	<!-- Hero List -->
	<ScrollArea class="min-h-32 flex-1">
		{#if sortedHeroes.length === 0}
			<div class="flex flex-col items-center justify-center gap-2 py-12">
				<p class="text-muted-foreground text-sm">{t('heroes.noHeroesMatchYourFilters')}</p>
				{#if hasActiveFilters}
					<Button variant="outline" size="sm" onclick={clearFilters}>{t('heroes.clearFilters')}</Button>
				{/if}
			</div>
		{:else}
			<div class="flex flex-col">
				{#each sortedHeroes as hero (hero.guid)}
					{@const isActive = activeGuid === hero.guid}
					{@const isSelected = selectedGuids.has(hero.guid)}
					{@const isDead = hero.status === 3}
					<div
						class="group flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors
							{isActive ? 'bg-accent' : 'hover:bg-muted/50'}
							{isDead ? 'opacity-60' : ''}"
						data-testid={`hero-row-${hero.guid}`}
					>
						<Checkbox
							checked={isSelected}
							onCheckedChange={() => toggleSelect(hero.guid)}
							aria-label={hero.name}
							class="h-3.5 w-3.5"
						/>
						<button
							type="button"
							class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
							onclick={() => selectHero(hero.guid)}
						>
							<!-- Portrait -->
							<div class="relative size-12 shrink-0 overflow-hidden {isDead ? 'opacity-50' : ''}">
								{#if isDead}
									<div class="bg-muted flex size-12 items-center justify-center">
										<SkullIcon size={18} class="text-muted-foreground" />
									</div>
								{:else}
									<GameAssetImage
										gamePath={settings.gamePath}
										relativePath={getPortraitPath(hero.heroClass)}
										alt=""
										class="size-12 object-cover"
									/>
								{/if}
							</div>

							<!-- Name + Level. The block truncates the inline class line, which keeps
							     its line box: truncate on an inline span has no effect. -->
							<div class="min-w-0 flex-1 truncate">
								<div class="flex items-center gap-1.5">
									<span class="truncate text-sm font-medium {isDead ? 'line-through' : ''}" title={hero.name}>
										{hero.name}
									</span>
									<Badge variant="outline" class="h-4 shrink-0 px-1 text-[10px]">
										{t('heroes.levelShort', { levelText: formatNumber(hero.resolveLevel) })}
									</Badge>
								</div>
								<span lang={gameTextLocale()} class="text-muted-foreground text-xs" title={heroClassName(hero.heroClass)}>{heroClassName(hero.heroClass)}</span>
							</div>

							<!-- Status dot -->
							<span class="h-2 w-2 shrink-0 rounded-full {hero.statusDotClass}"></span>
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</ScrollArea>
</div>
