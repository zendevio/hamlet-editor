<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Separator } from '$lib/components/ui/separator';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
	import HeartIcon from 'phosphor-svelte/lib/HeartIcon';
	import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
	import InfoIcon from 'phosphor-svelte/lib/InfoIcon';
	import { reviveHero, type HeroSummary } from '$lib/stores/save-data.svelte';

	let {
		hero,
		open = $bindable(false),
		isRaidActive = false,
		raidPartySize = 0,
		heroWasInParty = false,
		onRevived
	}: {
		hero: HeroSummary;
		open: boolean;
		isRaidActive?: boolean;
		raidPartySize?: number;
		heroWasInParty?: boolean;
		onRevived?: () => void;
	} = $props();

	// ── State ──
	let confirmChecked = $state(false);
	let addToRaidChecked = $state(false);

	// ── Derived ──
	let canAddToRaid = $derived(
		isRaidActive && heroWasInParty && raidPartySize < 4
	);
	let raidPartyFull = $derived(isRaidActive && raidPartySize >= 4);

	// ── Files to modify ──
	let filesToModify = $derived.by(() => {
		const files = [
			{
				name: 'persist.roster.json',
				description: 'Set status to Available (0), HP to 1, stress to 0, clear town visit status'
			},
			{
				name: 'persist.campaign_log.json',
				description: 'Clear died flag in mission event history (not yet implemented)'
			},
			{
				name: 'persist.progression.json',
				description: 'Clear graveyard achievement flag (not yet implemented)'
			}
		];

		if (isRaidActive && addToRaidChecked) {
			files.push({
				name: 'persist.raid.json',
				description: 'Add hero GUID back to raid party'
			});
		}

		return files;
	});

	// ── Actions ──

	function handleRevive() {
		// Perform the roster-level revival
		reviveHero(hero.guid);

		// Note: campaign_log and progression edits will be wired in when
		// those stores are implemented. The reviveHero function currently
		// handles only persist.roster.json mutations.

		// TODO: clearDiedFlag(hero.guid) for campaign_log
		// TODO: clearGraveyardFlag(hero.guid) for progression
		// TODO: if addToRaidChecked, addHeroToRaidParty(hero.guid)

		confirmChecked = false;
		addToRaidChecked = false;
		open = false;
		onRevived?.();
	}

	function handleCancel() {
		confirmChecked = false;
		addToRaidChecked = false;
		open = false;
	}

	// Reset state when dialog opens
	$effect(() => {
		if (open) {
			confirmChecked = false;
			addToRaidChecked = false;
		}
	});
</script>

<Dialog bind:open>
	<DialogContent class="sm:max-w-lg">
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2 text-sm">
				<HeartIcon size={18} weight="fill" class="text-green-500" />
				Revive {hero.name} the {hero.classDisplayName}?
			</DialogTitle>
			<DialogDescription>
				Currently only modifies persist.roster.json. Campaign log and progression clearing will be added in a future update.
			</DialogDescription>
		</DialogHeader>

		<div class="space-y-4">
			<!-- Hero summary -->
			<div class="flex items-center gap-3 border border-border bg-muted/30 p-3">
				<div class="flex h-10 w-10 items-center justify-center bg-muted text-sm font-bold uppercase text-muted-foreground">
					{hero.heroClass.slice(0, 2)}
				</div>
				<div>
					<p class="text-xs font-medium">{hero.name}</p>
					<div class="flex items-center gap-1.5">
						<span class="text-[11px] text-muted-foreground">{hero.classDisplayName}</span>
						<Badge variant="outline" class="h-4 text-[10px]">Lv {hero.resolveLevel}</Badge>
						<Badge variant="destructive" class="h-4 text-[10px]">Dead</Badge>
					</div>
				</div>
			</div>

			<Separator />

			<!-- Files that will be modified -->
			<div class="space-y-2">
				<span class="text-[11px] font-medium text-muted-foreground">Files to be modified</span>
				<div class="space-y-1.5">
					{#each filesToModify as file}
						<div class="flex items-start gap-2 border border-border bg-muted/20 p-2">
							<FileTextIcon size={14} class="mt-0.5 shrink-0 text-muted-foreground" />
							<div>
								<p class="text-[11px] font-medium font-mono">{file.name}</p>
								<p class="text-[10px] text-muted-foreground">{file.description}</p>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Raid option (conditional) -->
			{#if isRaidActive}
				<Separator />
				<div class="space-y-2">
					<div class="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-3">
						<WarningIcon size={14} class="mt-0.5 shrink-0 text-amber-500" />
						<div>
							<p class="text-[11px] font-medium text-amber-700 dark:text-amber-400">
								Raid is active
							</p>
							{#if canAddToRaid}
								<p class="text-[10px] text-amber-700 dark:text-amber-400">
									The hero can optionally be added back to the raid party
									(current party size: {raidPartySize}/4).
								</p>
							{:else if raidPartyFull}
								<p class="text-[10px] text-amber-700 dark:text-amber-400">
									The raid party is already full (4/4). The hero cannot be added to the party.
								</p>
							{:else}
								<p class="text-[10px] text-amber-700 dark:text-amber-400">
									The hero was not in the raid party and cannot be added.
								</p>
							{/if}
						</div>
					</div>

					{#if canAddToRaid}
						<label class="flex items-center gap-2">
							<Checkbox bind:checked={addToRaidChecked} />
							<span class="text-[11px]">Add hero back to raid party</span>
						</label>
					{/if}
				</div>
			{/if}

			<!-- Trinket warning -->
			<div class="flex items-start gap-2 border border-border bg-muted/20 p-3">
				<InfoIcon size={14} class="mt-0.5 shrink-0 text-muted-foreground" />
				<p class="text-[10px] leading-relaxed text-muted-foreground">
					The revived hero will retain their resolve level and quirks but will have lost
					their equipped trinkets (stripped on death). You can re-equip trinkets afterward.
				</p>
			</div>

			<Separator />

			<!-- Confirmation checkbox -->
			<label class="flex items-center gap-2">
				<Checkbox bind:checked={confirmChecked} />
				<span class="text-[11px] font-medium">
					I understand this is a multi-file operation
				</span>
			</label>
		</div>

		<DialogFooter class="flex-row justify-end gap-2 sm:justify-end">
			<Button variant="outline" size="sm" onclick={handleCancel}>
				Cancel
			</Button>
			<Button
				size="sm"
				disabled={!confirmChecked}
				onclick={handleRevive}
				class="gap-1"
			>
				<HeartIcon size={14} weight="fill" />
				Revive
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
