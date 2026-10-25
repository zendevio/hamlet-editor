<script lang="ts">
	import { describeError } from '#lib/errors.js';
	import { describeMessage, t } from './index.svelte.js';
	let { error, blocked = false }: { error: unknown; blocked?: boolean } = $props();
	let description = $derived(describeError(error));
</script>

<div class="space-y-1">
	<p>{blocked ? t('settings.blockedDiagnostic', { detail: describeMessage(description.message) }) : describeMessage(description.message)}</p>
	{#each description.recovery as recovery}
		<p class="break-all text-xs whitespace-pre-wrap select-text">{describeMessage(recovery)}</p>
	{/each}
	{#if description.detail}
		<p class="break-all text-xs whitespace-pre-wrap select-text">{description.detail}</p>
	{/if}
</div>
