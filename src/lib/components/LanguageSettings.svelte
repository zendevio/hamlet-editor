<script lang="ts">
	import { t, type MessageKey } from '#lib/i18n/index.svelte.js';
	import { GAME_TEXT_LANGUAGES } from '#lib/data/game-text-languages.js';
	import { getSettings, setEditorLanguage, setGameTextLanguage } from '#lib/stores/settings.svelte.js';
	import { getGameTextState } from '#lib/stores/game-text.svelte.js';
	import { availableGameTextLanguages } from '#lib/api/names.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import type { LanguageSource } from '#lib/i18n/language-resolution.js';
	const settings = getSettings();
	const gameText = getGameTextState();
	const sourceKeys = {
		system: 'settings.languageSource.system', game: 'settings.languageSource.game',
		'game-settings': 'settings.languageSource.game-settings', steam: 'settings.languageSource.steam',
		'editor-fallback': 'settings.languageSource.editor-fallback', editor: 'settings.languageSource.editor',
		choice: 'settings.languageSource.choice', english: 'settings.languageSource.english',
		'startup-fallback': 'settings.languageSource.startup-fallback'
	} as const satisfies Record<LanguageSource, MessageKey>;
	let available = $state<string[]>([]);
	let loading = $state(false);
	let failed = $state(false);
	let checked = $state(false);
	$effect(() => {
		const path = settings.gamePath;
		let current = true;
		loading = Boolean(path);
		failed = false;
		checked = false;
		available = [];
		if (path) availableGameTextLanguages(path).then((languages) => {
			if (current) { available = languages; checked = true; }
		}).catch(() => { if (current) failed = true; }).finally(() => { if (current) loading = false; });
		return () => { current = false; };
	});
</script>

<Card>
	<CardHeader>
		<CardTitle class="text-sm">{t('settings.editorLanguage')}</CardTitle>
		<CardDescription>{t('settings.editorLanguageHelp')}</CardDescription>
	</CardHeader>
	<CardContent class="space-y-2">
		<label for="editor-language" class="sr-only">{t('settings.editorLanguage')}</label>
		<select id="editor-language" class="bg-background border px-3 py-2 text-sm" value={settings.editorLanguage} onchange={(event) => setEditorLanguage(event.currentTarget.value)}>
			<option value="system">{t('settings.system')}</option>
			{#each Object.entries(GAME_TEXT_LANGUAGES) as [language, name]}<option value={language}>{name}</option>{/each}
		</select>
		<p data-testid="editor-language-source" class="text-xs text-muted-foreground">{t('settings.resolvedLanguage', { language: GAME_TEXT_LANGUAGES[settings.editorResolution.language], source: t(sourceKeys[settings.editorResolution.source]) })}</p>
	</CardContent>
</Card>
<Card>
	<CardHeader>
		<CardTitle class="text-sm">{t('settings.gameLanguage')}</CardTitle>
		<CardDescription>{t('settings.gameLanguageHelp')}</CardDescription>
	</CardHeader>
	<CardContent class="space-y-2">
		<label for="game-text-language" class="sr-only">{t('settings.gameLanguage')}</label>
		<select id="game-text-language" class="bg-background border px-3 py-2 text-sm" value={settings.gameTextChoice} onchange={(event) => setGameTextLanguage(event.currentTarget.value)}>
			<option value="match-game">{t('settings.matchGame')}</option>
			<option value="same-as-editor">{t('settings.sameAsEditor')}</option>
			{#each Object.entries(GAME_TEXT_LANGUAGES) as [language, name]}<option value={language}>{name}{checked && !available.includes(language) ? t('settings.unavailable') : ''}</option>{/each}
		</select>
		<p data-testid="game-text-language-source" class="text-xs text-muted-foreground">{t('settings.resolvedLanguage', { language: GAME_TEXT_LANGUAGES[settings.gameTextLanguage], source: t(sourceKeys[settings.gameTextResolution.source]) })}</p>
		{#if gameText.error}
			<p role="alert" data-testid="game-text-error">{t('settings.gameTextFailed', { requested: GAME_TEXT_LANGUAGES[gameText.requestedLanguage], effective: GAME_TEXT_LANGUAGES[gameText.effectiveLanguage] })}</p>
			<pre class="whitespace-pre-wrap break-all text-xs" data-testid="game-text-diagnostic">{gameText.errorDetail}</pre>
		{/if}
		{#if loading}
			<p class="text-xs text-muted-foreground" role="status">{t('settings.languagesLoading')}</p>
		{:else if failed}
			<p class="text-xs text-muted-foreground" role="status">{t('settings.languagesFailed')}</p>
		{:else if checked && !available.includes(settings.gameTextLanguage)}
			<p class="text-xs text-muted-foreground" role="status">{t('settings.languageUnavailable')}</p>
		{/if}
	</CardContent>
</Card>
{#if settings.persistenceFailed}<p role="alert">{t('settings.persistenceFailed')}</p>{/if}
