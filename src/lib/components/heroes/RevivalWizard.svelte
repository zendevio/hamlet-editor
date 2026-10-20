<script lang="ts">
	import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { getRevivalBlockReason, reviveHeroes } from '#lib/stores/save-data.svelte.js';
	import { toast } from 'svelte-sonner';
	import type { HeroSummary } from '#lib/types/save-data.js';

	let { heroes, open = $bindable(false) }: { heroes: HeroSummary[]; open: boolean } = $props();
	let reason = $derived(getRevivalBlockReason(heroes.length));

	function revive() {
		const error = reviveHeroes(heroes.map((hero) => hero.guid));
		if (error) { toast.error(error); return; }
		open = false;
		toast.success('Revival applied', { description: 'Save to apply changes, or Discard to undo.' });
	}
</script>

<Dialog bind:open>
	<DialogContent class="sm:max-w-lg">
		<DialogHeader>
			<DialogTitle>Revive {heroes.length === 1 ? heroes[0].name : `${heroes.length} heroes`}</DialogTitle>
			<DialogDescription>
				Return to the living roster with full class HP and cleared combat effects. Stress, quirks, skills and campaign history are retained. Skill upgrades lost at death are not restored.
			</DialogDescription>
		</DialogHeader>
		{#if reason}<p class="text-sm text-muted-foreground">{reason}</p>{/if}
		<DialogFooter>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button disabled={!!reason} onclick={revive}>Revive</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
