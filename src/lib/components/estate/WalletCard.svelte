<script lang="ts">
	import { t, describeMessage, type MessageDescriptor } from '#lib/i18n/index.svelte.js';
	import { formatNumber } from '#lib/i18n/intl.js';
	import { gameTextLocale } from '#lib/save-labels.js';
	import { commitChangedValue } from '#lib/control-events.js';
	import { parseInteger } from '#lib/input-validation.js';
	import { WALLET_MAX } from '#lib/estate.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import GameAssetIcon from '#lib/components/GameAssetIcon.svelte';
	import type { Component } from 'svelte';

	let {
		name,
		nameLang,
		value = $bindable(0),
		icon: Icon,
		gameAssetPath,
		gamePath,
		onchange
	}: {
		name: string;
		/** Language of name; defaults to the game text language. */
		nameLang?: string;
		value: number;
		icon?: Component<{ size?: number; class?: string }>;
		gameAssetPath?: string;
		gamePath?: string;
		onchange?: (value: number) => void;
	} = $props();

	let error = $state<MessageDescriptor | null>(null);
	let editing = $state(false);
	let editValue = $state('');
	let valueAtStart = 0;
	let inputRef = $state<HTMLInputElement | null>(null);

	function startEdit() {
		error = null;
		editing = true;
		editValue = String(value);
		valueAtStart = value;
		// Focus input on next tick after it renders
		queueMicrotask(() => {
			inputRef?.focus();
			inputRef?.select();
		});
	}

	function confirmEdit() {
		if (!editing) return;
		if (value !== valueAtStart) {
			editing = false;
			return;
		}
		const parsed = parseInteger(editValue, 0, WALLET_MAX);
		error = parsed.error ?? null;
		if (parsed.error !== undefined) return;
		editing = false;
		commitChangedValue(value, parsed.value, (next) => onchange?.(next));
	}

	function cancelEdit() {
		editing = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			confirmEdit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}
</script>

<Card.Root class="p-4 gap-3">
	<div lang={nameLang ?? gameTextLocale()} class="flex items-center gap-2 px-0">
		{#if gameAssetPath && gamePath}
			<GameAssetIcon
				{gamePath}
				relativePath={gameAssetPath}
				alt={name}
				class="size-10"
			>
				{#snippet fallback()}
					{#if Icon}
						<Icon class="text-muted-foreground shrink-0 size-10" />
					{:else}
						<div class="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-bold text-muted-foreground">
							{name.charAt(0).toUpperCase()}
						</div>
					{/if}
				{/snippet}
			</GameAssetIcon>
		{:else if Icon}
			<Icon class="text-muted-foreground shrink-0 size-10" />
		{:else}
			<div
				class="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-bold text-muted-foreground"
			>
				{name.charAt(0).toUpperCase()}
			</div>
		{/if}
		<span class="min-w-0 break-words text-xs font-medium text-muted-foreground">{name}</span>
	</div>
	<div class="px-0">
		{#if editing}
			<Input
				bind:ref={inputRef}
				type="number"
				min="0"
				max={WALLET_MAX}
				step="1"
				lang={nameLang ?? gameTextLocale()}
				aria-label={name}
				aria-invalid={!!error}
				value={editValue}
				oninput={(e) => {
					editValue = (e.target as HTMLInputElement).value;
				}}
				onblur={confirmEdit}
				onkeydown={handleKeydown}
				class="h-8 text-lg font-bold tabular-nums"
			/>
			{#if error}<p role="alert" class="text-xs text-destructive">{describeMessage(error)}</p>{/if}
		{:else}
			<button
				type="button"
				class="w-full cursor-pointer rounded-sm px-2.5 py-1 text-left text-lg font-bold tabular-nums transition-colors hover:bg-muted"
				onclick={startEdit}
				title={t('estate.clickToEdit')}
				aria-label={t('estate.editAmount', { name, amountText: formatNumber(value) })}
			>
				{formatNumber(value)}
			</button>
		{/if}
	</div>
</Card.Root>
