<script lang="ts">
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';

	let {
		open = $bindable(false),
		onSaveAndClose,
		onDiscardAndClose,
		onCancel,
		saveLabel = 'Save and Close',
		discardLabel = 'Discard and Close',
		allowSave = true
	}: {
		open?: boolean;
		onSaveAndClose: () => void;
		onDiscardAndClose: () => void;
		onCancel: () => void;
		saveLabel?: string;
		discardLabel?: string;
		allowSave?: boolean;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<WarningIcon size={20} class="text-amber-500" />
				Unsaved Changes
			</Dialog.Title>
			<Dialog.Description>
				You have unsaved changes. What would you like to do?
			</Dialog.Description>
		</Dialog.Header>

		<Dialog.Footer class="flex-col gap-2 sm:flex-row">
			<Button variant="ghost" onclick={onCancel}>Cancel</Button>
			<Button variant="destructive" onclick={onDiscardAndClose}>
				{discardLabel}
			</Button>
			{#if allowSave}
				<Button onclick={onSaveAndClose}>
					{saveLabel}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
