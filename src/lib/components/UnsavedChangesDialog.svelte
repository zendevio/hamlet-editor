<script lang="ts">
	import { t, describeMessage, type MessageDescriptor } from '#lib/i18n/index.svelte.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';

	let {
		open = $bindable(false),
		onSaveAndClose,
		onDiscardAndClose,
		onCancel,
		saveLabel = { id: 'unsaved.saveClose' },
		discardLabel = { id: 'unsaved.discardClose' },
		allowSave = true
	}: {
		open?: boolean;
		onSaveAndClose: () => void;
		onDiscardAndClose: () => void;
		onCancel: () => void;
		saveLabel?: MessageDescriptor;
		discardLabel?: MessageDescriptor;
		allowSave?: boolean;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<WarningIcon size={20} class="text-amber-500" />
				{t('unsaved.title')}
			</Dialog.Title>
			<Dialog.Description>
				{t('unsaved.description')}
			</Dialog.Description>
		</Dialog.Header>

		<Dialog.Footer class="flex-col gap-2 sm:flex-row">
			<Button variant="ghost" onclick={onCancel}>{t('settings.cancel')}</Button>
			<Button variant="destructive" onclick={onDiscardAndClose}>
				{describeMessage(discardLabel)}
			</Button>
			{#if allowSave}
				<Button onclick={onSaveAndClose}>
					{describeMessage(saveLabel)}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
