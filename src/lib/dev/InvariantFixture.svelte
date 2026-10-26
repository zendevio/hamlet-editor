<script lang="ts">
	import { getEditorLocale } from '#lib/i18n/index.svelte.js';
	import LanguageSettings from '#lib/components/LanguageSettings.svelte';
	import RichParts from '#lib/i18n/RichParts.svelte';
	import { createTranslator } from '#lib/i18n/core.js';
	import proofCatalogs from './rich-fixture.json';
	import { getHeroes } from '#lib/stores/save-data.svelte.js';
	import { getGameTextState } from '#lib/stores/game-text.svelte.js';
	import { localize } from '#lib/stores/game-data.svelte.js';
	const translator = createTranslator(proofCatalogs);
	let { showLanguageControls }: { showLanguageControls: boolean } = $props();
	let richParts = $derived(translator.format(getEditorLocale(), 'rich', { name: '<img src=x onerror=alert(1)>' }));

	// Mounted invariant state remains independent of committed save values.
	let selected = $state('');
	let draft = $state('');
	let heroes = $derived(getHeroes());
	const gameText = getGameTextState();
</script>

<aside data-testid="h1-proof" class="space-y-2 border p-2">
	{#if showLanguageControls}<LanguageSettings />{/if}
	<label>Harness selected hero
		<select aria-label="Harness selected hero" bind:value={selected}>
			<option value="">Select</option>
			{#each heroes as hero}<option value={hero.guid}>{hero.name}</option>{/each}
		</select>
	</label>
	<label>Harness uncommitted name<input aria-label="Harness uncommitted name" bind:value={draft} /></label>
	<p data-testid="rich-proof">
		<RichParts parts={richParts}>
			{#snippet emphasis(children)}<em>{@render children()}</em>{/snippet}
			{#snippet code(children)}<code>{@render children()}</code>{/snippet}
			{#snippet link(children)}<a href="https://github.com/zendevio/hamlet-editor">{@render children()}</a>{/snippet}
		</RichParts>
	</p>
	<p data-testid="game-name-pair" lang={gameText.effectiveLocale}>{localize('hero_class_name_crusader')} | {localize('hero_class_name_vestal')}</p>
	<p data-testid="unknown-id">{localize('unknown_mod_id')}</p>
</aside>
