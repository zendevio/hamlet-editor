<script lang="ts">
	import { parseInteger } from '#lib/input-validation.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '#lib/components/ui/select/index.js';
	import { Tooltip, TooltipContent, TooltipTrigger } from '#lib/components/ui/tooltip/index.js';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import BrainIcon from 'phosphor-svelte/lib/BrainIcon';
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import type { HeroSummary } from '#lib/stores/save-data.svelte.js';
	import {
		healHeroToMax,
		setHeroStress,
		setHeroLevel,
		getRevivalBlockReason,
		RESOLVE_LEVEL_NAMES
	} from '#lib/stores/save-data.svelte.js';

	let {
		selectedHeroes,
		totalCount
	}: {
		selectedHeroes: HeroSummary[];
		totalCount: number;
	} = $props();

	let allDead = $derived(
		selectedHeroes.length > 0 && selectedHeroes.every((h) => h.status === 3)
	);

	function handleHealAll() {
		for (const hero of selectedHeroes) {
			if (hero.status !== 3) {
				healHeroToMax(hero.guid);
			}
		}
	}

	function handleClearStress() {
		for (const hero of selectedHeroes) {
			setHeroStress(hero.guid, 0);
		}
	}

	function handleSetLevel(value: string) {
		const parsed = parseInteger(value, 0, 6);
		if (parsed.error !== undefined) return;
		const level = parsed.value;
		for (const hero of selectedHeroes) {
			setHeroLevel(hero.guid, level);
		}
	}

</script>

<div class="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
	<span class="text-muted-foreground shrink-0 text-[11px] font-medium">
		{selectedHeroes.length} of {totalCount} selected
	</span>

	{#if selectedHeroes.length > 0}
		<Separator orientation="vertical" class="mx-1 h-4" />

		<!-- Heal All -->
		<Tooltip>
			<TooltipTrigger>
				<Button variant="outline" size="sm" class="h-7 gap-1.5 text-[11px]" onclick={handleHealAll}>
					<HeartIcon size={12} class="text-red-500" />
					Heal All
				</Button>
			</TooltipTrigger>
			<TooltipContent>Raise HP to the class base max, keeping higher HP (skips dead heroes)</TooltipContent>
		</Tooltip>

		<!-- Clear Stress -->
		<Tooltip>
			<TooltipTrigger>
				<Button
					variant="outline"
					size="sm"
					class="h-7 gap-1.5 text-[11px]"
					onclick={handleClearStress}
				>
					<BrainIcon size={12} class="text-yellow-500" />
					Clear Stress
				</Button>
			</TooltipTrigger>
			<TooltipContent>Set stress to 0 for all selected heroes</TooltipContent>
		</Tooltip>

		<!-- Set Level -->
		<Select type="single" onValueChange={handleSetLevel}>
			<SelectTrigger class="h-7 w-30 text-[11px]">
				<div class="flex items-center gap-1">
					<ArrowUpIcon size={12} />
					<span>Set Level</span>
				</div>
			</SelectTrigger>
			<SelectContent>
				{#each Array(7) as _, i}
					<SelectItem value={String(i)}>
						Lv {i} — {RESOLVE_LEVEL_NAMES[i]}
					</SelectItem>
				{/each}
			</SelectContent>
		</Select>

		<!-- Revive (only if all selected are dead) -->
		{#if allDead}
			<Tooltip>
				<TooltipTrigger>
					<Button
						variant="outline"
						size="sm"
						class="h-7 gap-1.5 text-[11px]"
						disabled
					>
						<HeartIcon size={12} class="text-green-500" />
						Revive
					</Button>
				</TooltipTrigger>
				<TooltipContent>{getRevivalBlockReason()}</TooltipContent>
			</Tooltip>
		{/if}
	{/if}
</div>
