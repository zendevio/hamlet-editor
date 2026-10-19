<script lang="ts">
	import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { revivalBlockReason } from '#lib/hero-safety.js';
	import type { HeroSummary } from '#lib/types/save-data.js';

	let { hero, open = $bindable(false), isRaidActive = false, raidPartySize = 0, heroWasInParty = false }: {
		hero: HeroSummary;
		open: boolean;
		isRaidActive?: boolean;
		raidPartySize?: number;
		heroWasInParty?: boolean;
	} = $props();
</script>

<Dialog bind:open>
	<DialogContent class="sm:max-w-lg">
		<DialogHeader>
			<DialogTitle>Revive {hero.name}</DialogTitle>
			<DialogDescription>{revivalBlockReason(isRaidActive)}</DialogDescription>
		</DialogHeader>
		{#if isRaidActive}
			<p class="text-sm text-muted-foreground">
				Current party: {raidPartySize}/4. {heroWasInParty ? 'This hero is referenced by the raid party.' : 'This hero is outside the raid party.'}
			</p>
		{/if}
		<DialogFooter>
			<Button variant="outline" onclick={() => (open = false)}>Close</Button>
			<Button disabled>Revival unavailable</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
