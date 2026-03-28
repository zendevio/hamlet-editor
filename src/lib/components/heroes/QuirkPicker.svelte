<script lang="ts">
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import {
		Command,
		CommandEmpty,
		CommandGroup,
		CommandInput,
		CommandItem,
		CommandList
	} from '$lib/components/ui/command';
	import { Button } from '$lib/components/ui/button';
	import CaretUpDownIcon from 'phosphor-svelte/lib/CaretUpDownIcon';
	import { getAllQuirks, type QuirkInfo } from '$lib/data/quirks';
	import { snakeToTitle } from '$lib/utils';
	import { getGameData } from '$lib/stores/game-data.svelte';

	let {
		exclude = new Set<string>(),
		onselect
	}: {
		exclude?: Set<string>;
		onselect?: (quirkId: string) => void;
	} = $props();

	let open = $state(false);

	const gameData = getGameData();

	/** Build the full quirk list from game data if loaded, else fall back to hardcoded. */
	let allQuirks = $derived.by((): QuirkInfo[] => {
		if (gameData.quirks.length > 0) {
			return gameData.quirks.map((q) => ({
				id: q.id,
				displayName: snakeToTitle(q.id),
				category: q.is_disease ? 'disease' : q.is_positive ? 'positive' : 'negative'
			}));
		}
		return getAllQuirks();
	});

	let positiveQuirks = $derived(
		allQuirks.filter((q) => q.category === 'positive' && !exclude.has(q.id))
	);
	let negativeQuirks = $derived(
		allQuirks.filter((q) => q.category === 'negative' && !exclude.has(q.id))
	);
	let diseaseQuirks = $derived(
		allQuirks.filter((q) => q.category === 'disease' && !exclude.has(q.id))
	);

	function handleSelect(id: string) {
		open = false;
		onselect?.(id);
	}
</script>

<Popover bind:open>
	<PopoverTrigger>
		{#snippet child({ props })}
			<Button
				variant="outline"
				role="combobox"
				aria-expanded={open}
				class="h-7 w-full justify-between text-xs font-normal"
				{...props}
			>
				<span class="text-muted-foreground">Add quirk...</span>
				<CaretUpDownIcon size={12} class="ml-2 shrink-0 text-muted-foreground" />
			</Button>
		{/snippet}
	</PopoverTrigger>
	<PopoverContent class="w-72 p-0" align="start">
		<Command>
			<CommandInput placeholder="Search quirks..." class="h-8 text-xs" />
			<CommandList class="max-h-72">
				<CommandEmpty>No quirk found.</CommandEmpty>

				{#if positiveQuirks.length > 0}
					<CommandGroup heading="Positive">
						{#each positiveQuirks as quirk (quirk.id)}
							<CommandItem
								value={quirk.id}
								onSelect={() => handleSelect(quirk.id)}
								class="text-xs"
							>
								<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500"></span>
								{quirk.displayName}
								<span class="ml-auto text-[10px] text-muted-foreground/50">{quirk.id}</span>
							</CommandItem>
						{/each}
					</CommandGroup>
				{/if}

				{#if negativeQuirks.length > 0}
					<CommandGroup heading="Negative">
						{#each negativeQuirks as quirk (quirk.id)}
							<CommandItem
								value={quirk.id}
								onSelect={() => handleSelect(quirk.id)}
								class="text-xs"
							>
								<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"></span>
								{quirk.displayName}
								<span class="ml-auto text-[10px] text-muted-foreground/50">{quirk.id}</span>
							</CommandItem>
						{/each}
					</CommandGroup>
				{/if}

				{#if diseaseQuirks.length > 0}
					<CommandGroup heading="Disease">
						{#each diseaseQuirks as quirk (quirk.id)}
							<CommandItem
								value={quirk.id}
								onSelect={() => handleSelect(quirk.id)}
								class="text-xs"
							>
								<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"></span>
								{quirk.displayName}
								<span class="ml-auto text-[10px] text-muted-foreground/50">{quirk.id}</span>
							</CommandItem>
						{/each}
					</CommandGroup>
				{/if}
			</CommandList>
		</Command>
	</PopoverContent>
</Popover>
