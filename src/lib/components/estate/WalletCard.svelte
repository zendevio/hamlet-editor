<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { Component } from 'svelte';

	let {
		name,
		value = $bindable(0),
		icon: Icon,
		onchange
	}: {
		name: string;
		value: number;
		icon?: Component<{ size?: number; class?: string }>;
		onchange?: (value: number) => void;
	} = $props();

	let editing = $state(false);
	let editValue = $state('');
	let inputRef = $state<HTMLInputElement | null>(null);

	function startEdit() {
		editing = true;
		editValue = String(value);
		// Focus input on next tick after it renders
		queueMicrotask(() => {
			inputRef?.focus();
			inputRef?.select();
		});
	}

	function confirmEdit() {
		const parsed = parseInt(editValue, 10);
		if (!isNaN(parsed) && parsed >= 0) {
			value = parsed;
			onchange?.(parsed);
		}
		editing = false;
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
	<div class="flex items-center gap-2 px-0">
		{#if Icon}
			<Icon size={20} class="text-muted-foreground shrink-0" />
		{:else}
			<div
				class="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-bold text-muted-foreground"
			>
				{name.charAt(0).toUpperCase()}
			</div>
		{/if}
		<span class="text-xs font-medium text-muted-foreground">{name}</span>
	</div>
	<div class="px-0">
		{#if editing}
			<Input
				bind:ref={inputRef}
				type="number"
				min="0"
				value={editValue}
				oninput={(e) => {
					editValue = (e.target as HTMLInputElement).value;
				}}
				onblur={confirmEdit}
				onkeydown={handleKeydown}
				class="h-8 text-lg font-bold tabular-nums"
			/>
		{:else}
			<button
				type="button"
				class="w-full cursor-pointer rounded-sm px-2.5 py-1 text-left text-lg font-bold tabular-nums transition-colors hover:bg-muted"
				onclick={startEdit}
				title="Click to edit"
				aria-label="Edit {name}: {value.toLocaleString()}"
			>
				{value.toLocaleString()}
			</button>
		{/if}
	</div>
</Card.Root>
