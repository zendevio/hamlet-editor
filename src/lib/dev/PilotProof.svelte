<script lang="ts">
	import { getEditorLocale, setEditorLocale } from '#lib/i18n/index.svelte.js';
	import { GAME_TEXT_LOCALES } from '#lib/data/game-text-languages.js';
	import { getHeroes } from '#lib/stores/save-data.svelte.js';
	import { getGameTextState } from '#lib/stores/game-text.svelte.js';
	import { localize } from '#lib/stores/game-data.svelte.js';
	import Message from '#lib/i18n/Message.svelte';

	// Temporary dev-only fixture controls, removed by P1b. Selection and a draft
	// name live in this mounted component, separate from committed save data.
	let selected = $state('');
	let draft = $state('');
	let heroes = $derived(getHeroes());
	const gameText = getGameTextState();
</script>

<aside data-testid="h1-proof" class="space-y-2 border p-2">
	<label>Pilot editor locale
		<select aria-label="Pilot editor locale" value={getEditorLocale()} onchange={(event) => setEditorLocale(event.currentTarget.value)}>
			{#each Object.values(GAME_TEXT_LOCALES) as locale}<option value={locale}>{locale}</option>{/each}
		</select>
	</label>
	<label>Pilot selected hero
		<select aria-label="Pilot selected hero" bind:value={selected}>
			<option value="">Select</option>
			{#each heroes as hero}<option value={hero.guid}>{hero.name}</option>{/each}
		</select>
	</label>
	<label>Pilot uncommitted name<input aria-label="Pilot uncommitted name" bind:value={draft} /></label>
	<p data-testid="rich-proof">
		<Message id="pilot.rich" params={{ name: '<img src=x onerror=alert(1)>' }}>
			{#snippet emphasis(children)}<em>{@render children()}</em>{/snippet}
			{#snippet code(children)}<code>{@render children()}</code>{/snippet}
			{#snippet link(children)}<a href="https://github.com/AlinGheorghe/hamlet-editor">{@render children()}</a>{/snippet}
		</Message>
	</p>
	<p data-testid="game-name-pair" lang={gameText.effectiveLocale}>{localize('hero_class_name_crusader')} | {localize('hero_class_name_vestal')}</p>
	<p data-testid="unknown-id">{localize('unknown_mod_id')}</p>
</aside>
