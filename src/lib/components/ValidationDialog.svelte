<script lang="ts">
	import { describeMessage, t } from '#lib/i18n/index.svelte.js';
	import { formatNumber } from '#lib/i18n/intl.js';
	import Message from '#lib/i18n/Message.svelte';
	import { gameTextLocale } from '#lib/save-labels.js';
	import { validationMessage } from '#lib/validation-messages.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import type { ValidationIssue } from '#lib/validation.js';
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
				{t('validation.title')}
			</Dialog.Title>
			<Dialog.Description>
				{t('validation.counts', { errors: errorCount, errorsText: formatNumber(errorCount), warnings: warningCount, warningsText: formatNumber(warningCount) })}
			</Dialog.Description>
		</Dialog.Header>

		<div class="max-h-64 space-y-2 overflow-y-auto">
			{#each issues as issue, i (i)}
				{@const message = validationMessage(issue)}
				<div class="flex items-start gap-2 rounded border p-2 text-sm">
					{#if issue.severity === 'error'}
						<WarningCircleIcon size={16} class="mt-0.5 shrink-0 text-red-500" />
					{:else}
						<WarningIcon size={16} class="mt-0.5 shrink-0 text-amber-500" />
					{/if}
					<div class="flex-1">
						<div class="flex items-center gap-2">
							<Badge variant="outline" class="text-xs">{describeMessage(issue.category)}</Badge>
							{#if issue.fix}
								<Badge variant="secondary" class="text-xs">{t('validation.autoFixable')}</Badge>
							{/if}
						</div>
						<p class="text-muted-foreground mt-1">
							<Message id={message.id} params={message.params ?? {}}>
								{#snippet emphasis(children)}<span lang={gameTextLocale()}>{@render children()}</span>{/snippet}
								{#snippet code(children)}{@render children()}{/snippet}
								{#snippet link(children)}{@render children()}{/snippet}
							</Message>
						</p>
					</div>
				</div>
			{/each}
		</div>

		<Dialog.Footer class="gap-2">
			<Button variant="ghost" onclick={onCancel}>{t('settings.cancel')}</Button>
			{#if fixableCount > 0}
				<Button variant="outline" onclick={onFixAll}>
					{t('validation.fixCount', { count: fixableCount, countText: formatNumber(fixableCount) })}
				</Button>
			{/if}
			{#if errorCount === 0}
				<Button onclick={onSaveAnyway}>{t('validation.saveAnyway')}</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
