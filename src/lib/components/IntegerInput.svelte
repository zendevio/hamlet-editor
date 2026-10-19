<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.js';
	import { I32_MAX, parseInteger } from '#lib/input-validation.js';

	let { value, onchange, min = 0, max = I32_MAX, id, label, class: className = '' }: {
		value: number;
		onchange: (value: number) => void;
		min?: number;
		max?: number;
		id?: string;
		label: string;
		class?: string;
	} = $props();
	let error = $state('');

	function commit(event: Event) {
		const parsed = parseInteger((event.target as HTMLInputElement).value, min, max);
		error = parsed.error ?? '';
		if (parsed.error === undefined) onchange(parsed.value);
	}
</script>

<Input {id} aria-label={label} aria-invalid={!!error} type="number" {min} {max} step="1"
	value={String(value)} onchange={commit} class={className} />
{#if error}<p role="alert" class="text-xs text-destructive">{error}</p>{/if}
