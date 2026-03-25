<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '$lib/components/ui/select';
	import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip';
	import Skull from 'phosphor-svelte/lib/Skull';
	import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
	import FunnelSimple from 'phosphor-svelte/lib/FunnelSimple';
	import type { HeroSummary } from '$lib/stores/save-data.svelte';
	import {
		STATUS_MAP,
		RESOLVE_LEVEL_NAMES,
		CLASS_DISPLAY_NAMES
	} from '$lib/stores/save-data.svelte';

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
	let sortBy = $state<string>('status');
	let statusFilter = $state<Set<number>>(new Set());
	let classFilter = $state<Set<string>>(new Set());
	let showFilters = $state(false);

	// Available classes from current hero data
	let availableClasses = $derived(
		[...new Set(heroes.map((h) => h.heroClass))].sort()
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
			const q = searchQuery.trim().toLowerCase();
			result = result.filter((h) => h.name.toLowerCase().includes(q));
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
	let sortedHeroes = $derived.by(() => {
		const sorted = [...filteredHeroes];

		switch (sortBy) {
			case 'name':
				sorted.sort((a, b) => a.name.localeCompare(b.name));
				break;
			case 'class':
				sorted.sort((a, b) => a.classDisplayName.localeCompare(b.classDisplayName));
				break;
			case 'level':
				sorted.sort((a, b) => b.resolveLevel - a.resolveLevel || a.name.localeCompare(b.name));
				break;
			case 'hp':
				sorted.sort((a, b) => (a.currentHp / a.maxHp) - (b.currentHp / b.maxHp));
				break;
			case 'stress':
				sorted.sort((a, b) => b.stress - a.stress || a.name.localeCompare(b.name));
				break;
			case 'status':
			default: {
				// Status priority: Available(0), Squad(1), Staffed(2), Gone(4), Dead(3)
				const statusOrder: Record<number, number> = { 0: 0, 1: 1, 2: 2, 4: 3, 3: 4 };
				sorted.sort(
					(a, b) =>
						(statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5) ||
						b.resolveLevel - a.resolveLevel ||
						a.name.localeCompare(b.name)
				);
				break;
			}
		}

		return sorted;
	});

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

<div class="flex h-full flex-col">
	<!-- Search & Controls -->
	<div class="flex flex-col gap-2 border-b p-3">
		<div class="flex items-center gap-2">
			<div class="relative flex-1">
				<MagnifyingGlass
					class="text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2"
					size={14}
				/>
				<Input
					placeholder="Search heroes..."
					bind:value={searchQuery}
					class="h-8 pl-7 text-xs"
				/>
			</div>
			<Tooltip>
				<TooltipTrigger>
					<Button
						variant={showFilters ? 'secondary' : 'ghost'}
						size="sm"
						class="h-8 w-8 p-0"
						onclick={() => (showFilters = !showFilters)}
					>
						<FunnelSimple size={14} />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Toggle filters</TooltipContent>
			</Tooltip>
			<Select type="single" bind:value={sortBy}>
				<SelectTrigger class="h-8 w-27.5 text-xs">
					<span class="text-xs">Sort: {sortBy}</span>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="status">Status</SelectItem>
					<SelectItem value="name">Name</SelectItem>
					<SelectItem value="class">Class</SelectItem>
					<SelectItem value="level">Level</SelectItem>
					<SelectItem value="hp">HP</SelectItem>
					<SelectItem value="stress">Stress</SelectItem>
				</SelectContent>
			</Select>
		</div>

		{#if showFilters}
			<div class="flex flex-col gap-2">
				<!-- Status filter -->
				<div class="flex flex-wrap gap-1">
					<span class="text-muted-foreground mr-1 self-center text-[10px] uppercase tracking-wider">Status:</span>
					{#each availableStatuses as status}
						{@const info = STATUS_MAP[status]}
						<button
							class="inline-flex h-6 cursor-pointer items-center gap-1 rounded-none border px-2 text-[11px] transition-colors {statusFilter.has(
								status
							)
								? 'border-foreground/30 bg-foreground/10'
								: 'border-transparent hover:bg-muted'}"
							onclick={() => toggleStatusFilter(status)}
						>
							<span class="h-2 w-2 rounded-full {info?.dotClass ?? 'bg-gray-400'}"></span>
							{info?.label ?? `Status ${status}`}
						</button>
					{/each}
				</div>

				<!-- Class filter -->
				<div class="flex flex-wrap gap-1">
					<span class="text-muted-foreground mr-1 self-center text-[10px] uppercase tracking-wider">Class:</span>
					{#each availableClasses as cls}
						<button
							class="inline-flex h-6 cursor-pointer items-center gap-1 rounded-none border px-2 text-[11px] transition-colors {classFilter.has(
								cls
							)
								? 'border-foreground/30 bg-foreground/10'
								: 'border-transparent hover:bg-muted'}"
							onclick={() => toggleClassFilter(cls)}
						>
							{CLASS_DISPLAY_NAMES[cls] ?? cls}
						</button>
					{/each}
				</div>

				{#if hasActiveFilters}
					<Button variant="ghost" size="sm" class="h-6 self-start text-xs" onclick={clearFilters}>
						Clear filters
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
			{selectedGuids.size} of {heroes.length} selected
			{#if filteredHeroes.length !== heroes.length}
				<span class="text-muted-foreground/60">({sortedHeroes.length} shown)</span>
			{/if}
		</span>
	</div>

	<!-- Hero List -->
	<ScrollArea class="flex-1">
		{#if sortedHeroes.length === 0}
			<div class="flex flex-col items-center justify-center gap-2 py-12">
				<p class="text-muted-foreground text-sm">No heroes match your filters.</p>
				{#if hasActiveFilters}
					<Button variant="outline" size="sm" onclick={clearFilters}>Clear Filters</Button>
				{/if}
			</div>
		{:else}
			<div class="flex flex-col">
				{#each sortedHeroes as hero (hero.guid)}
					{@const isActive = activeGuid === hero.guid}
					{@const isSelected = selectedGuids.has(hero.guid)}
					{@const isDead = hero.status === 3}
					<button
						class="group flex w-full cursor-pointer items-center gap-3 border-b px-3 py-2.5 text-left transition-colors
							{isActive ? 'bg-accent' : 'hover:bg-muted/50'}
							{isDead ? 'opacity-60' : ''}"
						onclick={() => selectHero(hero.guid)}
					>
						<!-- Checkbox -->
						<div
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => { if (e.key === ' ') e.stopPropagation(); }}
							role="presentation"
						>
							<Checkbox
								checked={isSelected}
								onCheckedChange={() => toggleSelect(hero.guid)}
								class="h-3.5 w-3.5"
							/>
						</div>

						<!-- Portrait placeholder -->
						<div
							class="bg-muted flex h-10 w-10 shrink-0 items-center justify-center text-[10px] uppercase {isDead
								? 'opacity-50'
								: ''}"
						>
							{#if isDead}
								<Skull size={18} class="text-muted-foreground" />
							{:else}
								<span class="text-muted-foreground font-medium">{hero.heroClass.slice(0, 2)}</span>
							{/if}
						</div>

						<!-- Info -->
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate text-sm font-medium {isDead ? 'line-through' : ''}">
									{hero.name}
								</span>
								<Badge variant="outline" class="h-4 shrink-0 px-1 text-[10px]">
									Lv {hero.resolveLevel}
								</Badge>
							</div>
							<div class="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
								<span>{hero.classDisplayName}</span>
								<span class="text-muted-foreground/40">|</span>
								<!-- HP -->
								<span class={hero.currentHp < hero.maxHp * 0.5 ? 'text-red-500' : ''}>
									{hero.currentHp}/{hero.maxHp} HP
								</span>
								<span class="text-muted-foreground/40">|</span>
								<!-- Stress -->
								<span class={hero.stress >= 100 ? 'text-red-500 font-medium' : ''}>
									{hero.stress} stress
								</span>
							</div>
						</div>

						<!-- Status Badge -->
						<div class="flex shrink-0 items-center gap-1.5">
							<span class="h-2 w-2 rounded-full {hero.statusDotClass}"></span>
							<span class="text-muted-foreground text-[11px]">{hero.statusLabel}</span>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</ScrollArea>
</div>
