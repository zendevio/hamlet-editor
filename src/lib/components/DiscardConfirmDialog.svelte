<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';

	let {
		open = $bindable(false),
		onConfirm,
		onCancel
	}: {
		open?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<ArrowCounterClockwiseIcon size={20} />
				{t('discard.title')}
			</Dialog.Title>
			<Dialog.Description>
				{t('discard.description')}
			</Dialog.Description>
		</Dialog.Header>

		<Dialog.Footer>
			<Button variant="ghost" onclick={onCancel}>{t('settings.cancel')}</Button>
			<Button variant="destructive" onclick={onConfirm}>
				{t('discard.confirm')}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
