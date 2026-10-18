<script lang="ts">
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
				Discard All Changes
			</Dialog.Title>
			<Dialog.Description>
				This will revert all unsaved changes and reload data from disk. This action cannot be undone.
			</Dialog.Description>
		</Dialog.Header>

		<Dialog.Footer>
			<Button variant="ghost" onclick={onCancel}>Cancel</Button>
			<Button variant="destructive" onclick={onConfirm}>
				Discard All Changes
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
