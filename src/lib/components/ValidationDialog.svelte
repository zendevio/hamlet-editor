<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import type { ValidationIssue } from '$lib/validation';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';

	let {
		open = $bindable(false),
		issues = [],
		onFixAll,
		onSaveAnyway,
		onCancel
	}: {
		open?: boolean;
		issues: ValidationIssue[];
		onFixAll: () => void;
		onSaveAnyway: () => void;
		onCancel: () => void;
	} = $props();

	let fixableCount = $derived(issues.filter((i) => i.fix).length);
	let errorCount = $derived(issues.filter((i) => i.severity === 'error').length);
	let warningCount = $derived(issues.filter((i) => i.severity === 'warning').length);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<WarningIcon size={20} class="text-amber-500" />
				Pre-Save Validation
			</Dialog.Title>
			<Dialog.Description>
				{#if errorCount > 0}
					{errorCount} error{errorCount !== 1 ? 's' : ''} and {warningCount} warning{warningCount !== 1 ? 's' : ''} found.
				{:else}
					{warningCount} warning{warningCount !== 1 ? 's' : ''} found.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<div class="max-h-64 space-y-2 overflow-y-auto">
			{#each issues as issue, i (i)}
				<div class="flex items-start gap-2 rounded border p-2 text-sm">
					{#if issue.severity === 'error'}
						<WarningCircleIcon size={16} class="mt-0.5 shrink-0 text-red-500" />
					{:else}
						<WarningIcon size={16} class="mt-0.5 shrink-0 text-amber-500" />
					{/if}
					<div class="flex-1">
						<div class="flex items-center gap-2">
							<Badge variant="outline" class="text-xs">{issue.category}</Badge>
							{#if issue.fix}
								<Badge variant="secondary" class="text-xs">Auto-fixable</Badge>
							{/if}
						</div>
						<p class="text-muted-foreground mt-1">{issue.message}</p>
					</div>
				</div>
			{/each}
		</div>

		<Dialog.Footer class="gap-2">
			<Button variant="ghost" onclick={onCancel}>Cancel</Button>
			{#if fixableCount > 0}
				<Button variant="outline" onclick={onFixAll}>
					Fix {fixableCount} Issue{fixableCount !== 1 ? 's' : ''} Automatically
				</Button>
			{/if}
			{#if errorCount === 0}
				<Button onclick={onSaveAnyway}>Save Anyway</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
