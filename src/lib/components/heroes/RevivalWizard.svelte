<script lang="ts">
	import { showMessageError } from '#lib/i18n/notifications.js';
	import { describeMessage, t } from '#lib/i18n/index.svelte.js';
	import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { getRevivalBlockReason, reviveHeroes } from '#lib/stores/save-data.svelte.js';
	import { formatNumber } from '#lib/i18n/intl.js';
	import { toast } from 'svelte-sonner';
	import type { HeroSummary } from '#lib/types/save-data.js';

	let { heroes, open = $bindable(false) }: { heroes: HeroSummary[]; open: boolean } = $props();
	let reason = $derived(getRevivalBlockReason(heroes.length));

	function revive() {
		const error = reviveHeroes(heroes.map((hero) => hero.guid));
		if (error) { showMessageError(error); return; }
		open = false;
		toast.success(t('heroes.revivalApplied'), { description: t('heroes.revivalAppliedHelp') });
	}
</script>

<Dialog bind:open>
	<DialogContent class="sm:max-w-lg">
		<DialogHeader>
			<DialogTitle>{t('heroes.reviveTitle', { count: heroes.length, countText: formatNumber(heroes.length), name: heroes[0]?.name ?? '' })}</DialogTitle>
			<DialogDescription>
				{t('heroes.reviveDescription')}
			</DialogDescription>
		</DialogHeader>
		{#if reason}<p class="text-sm text-muted-foreground">{describeMessage(reason)}</p>{/if}
		<DialogFooter>
			<Button variant="outline" onclick={() => (open = false)}>{t('heroes.cancel')}</Button>
			<Button disabled={!!reason} onclick={revive}>{t('heroes.revive')}</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
