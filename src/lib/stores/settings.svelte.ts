import { decodeError } from '#lib/errors.js';
import { invoke } from '@tauri-apps/api/core';
import { GAME_TEXT_LOCALES } from '#lib/data/game-text-languages.js';
import { setEditorLocale } from '#lib/i18n/index.svelte.js';
import type { MessageDescriptor } from '#lib/i18n/index.svelte.js';
import { createBootstrap } from '#lib/i18n/bootstrap.js';
import { createDetectionSequence, emptyEvidence, isGameLanguage, resolveEditor, resolveGameText, type LanguageEvidence, type Resolution } from '#lib/i18n/language-resolution.js';
import { createSettingsWriter, defaultSettings, startupMigrationPatch, migrateSettings, type Patch, type Settings } from './settings-core.js';
import type { GameInstall } from '#lib/api/detect.js';
import { resetGameData } from './game-data.svelte.js';

let settings = $state(defaultSettings());
// Keep the last complete snapshot, tagged with its installation, during refresh.
let evidence = $state<{ path: string | null; value: LanguageEvidence }>({ path: null, value: emptyEvidence() });
let pendingEditor = $state<Resolution | undefined>();
let ready = $state(false);
let persistenceFailed = $state(false);
type StartupNotice = MessageDescriptor & { detail?: string; error?: unknown };
let startupNotices = $state<StartupNotice[]>([]);
let startupElapsedMs = $state(0);
let launchFallback = $state(false);
let editor = $derived(launchFallback ? { language: 'english' as const, source: 'startup-fallback' as const } : settings.editorLanguage === 'system' && pendingEditor ? pendingEditor : resolveEditor(settings.editorLanguage, evidence.value));
let gameText = $derived(resolveGameText(settings.gameTextMode, settings.gameTextLanguage, editor.language, evidence.value));
let requestedGameLanguage = $derived(gameText.language);
const sequence = createDetectionSequence();
let storePromise: Promise<import('@tauri-apps/plugin-store').LazyStore> | undefined;
function getStore() {
	return storePromise ??= import('@tauri-apps/plugin-store').then(({ LazyStore }) => new LazyStore('settings.json', { autoSave: false }));
}
let hasSaved = false;
const writer = createSettingsWriter(getStore, () => {
	persistenceFailed = true;
	if (!hasSaved) storePromise = undefined;
}, () => { hasSaved = true; persistenceFailed = false; });
function update(patch: Patch) { writer.write(patch); }
function applyLocale() { setEditorLocale(GAME_TEXT_LOCALES[editor.language]); }

// Plugin-store 2.5 silently ignores initial JSON read errors. The Rust read
// validates the file instead, before this launch ever enables the single writer.
interface SettingsRead { status: 'ok' | 'missing' | 'corrupt' | 'io_error'; values: Record<string, unknown>; folder: string; fingerprint: { size: number; hash: string } | null; error?: unknown; detail?: string }
let validatedRead: { raw: Record<string, unknown>; loaded: Settings; notice?: MessageDescriptor } | undefined;
let readFailure: StartupNotice | undefined;
const bootstrap = createBootstrap(async (signal, deadline) => {
	const expired = () => signal.aborted || performance.now() >= deadline;
	let result: SettingsRead;
	let notice: MessageDescriptor | undefined;
	try {
		result = await invoke<SettingsRead>('read_settings');
		if (expired()) throw new Error('Startup deadline elapsed');
		if (result.status === 'io_error') throw result.error ?? { code: 'settings_io', params: { folder: result.folder }, detail: result.detail };
		if (result.status === 'corrupt') {
			if (!result.fingerprint) throw new Error('Corrupt settings fingerprint missing');
			const copy = await invoke<string>('recover_corrupt_settings', { fingerprint: result.fingerprint });
			notice = { id: 'startup.settingsRecovered', params: { folder: result.folder, copy } };
		}
	} catch (error) {
		if (!expired()) {
			const decoded = decodeError(error);
			const folder = decoded.params.folder;
			readFailure = {
				...(folder ? { id: 'startup.settingsUnreadable' as const, params: { folder } }
					: { id: 'startup.settingsReadFailed' as const }),
				detail: decoded.detail, error
			};
		}
		throw error;
	}
	if (expired()) {
		// Recovery was accepted on time, but its reply may arrive after startup.
		// The file has already moved, so always report the kept copy; a late
		// recovery never enables writes.
		if (notice) startupNotices.push(notice);
		throw new Error('Startup deadline elapsed');
	}
	const raw = result.values;
	const loaded = migrateSettings(raw, (key) => console.warn(`Invalid setting ignored: ${key}`));
	validatedRead = { raw, loaded, notice };
	const detected = await invoke<LanguageEvidence>('collect_language_evidence', { gamePath: loaded.gamePath });
	return { raw, loaded, detected };
});
let initialization: Promise<void> | undefined;
export function initializeSettings(): Promise<void> {
	return initialization ??= bootstrap().then((result) => {
		startupElapsedMs = result.elapsedMs;
		// Preserve a successfully read setup even when only detection times out.
		if (validatedRead) {
			const { raw, loaded, notice } = validatedRead;
			settings = loaded;
			writer.enable();
			if (notice) startupNotices.push(notice);
			const changed = startupMigrationPatch(raw);
			if (Object.keys(changed).length) update(changed);
		}
		if (result.status === 'ok') {
			evidence = { path: result.value.loaded.gamePath, value: result.value.detected };
		} else {
			sequence.cancel();
			launchFallback = !validatedRead || settings.editorLanguage === 'system';
			startupNotices.push(validatedRead ? { id: launchFallback ? 'startup.languageFallback' : 'startup.gameTextFallback' }
				: readFailure ?? { id: 'startup.settingsTimeout' });
		}
		validatedRead = undefined;
		applyLocale();
		ready = true;
	});
}

export async function refreshLanguageEvidence(): Promise<void> {
	const request = sequence.next();
	const path = settings.gamePath;
	try {
		const detected = await invoke<LanguageEvidence>('collect_language_evidence', { gamePath: path });
		if (!sequence.isCurrent(request) || path !== settings.gamePath) return;
		evidence = { path, value: detected };
	} catch {
		if (!sequence.isCurrent(request) || path !== settings.gamePath) return;
		if (path !== evidence.path) evidence = { path, value: {
			os_locales: evidence.value.os_locales,
			game_options: { status: 'unreadable', value: null },
			steam_manifest: { status: 'unreadable', value: null }
		} };
	}
	pendingEditor = undefined;
	// Resolvers take current modes, so an intervening manual choice always wins.
	applyLocale();
}
export function getSettings() {
	return {
		get ready() { return ready; },
		get startupNotice() { return startupNotices.length > 0; },
		get startupNotices() { return startupNotices; },
		get languageEvidencePath() { return evidence.path; },
		get startupElapsedMs() { return startupElapsedMs; },
		get persistenceFailed() { return persistenceFailed; },
		get editorLanguage() { return settings.editorLanguage; },
		get editorResolution() { return editor; },
		get gameTextMode() { return settings.gameTextMode; },
		get gameTextChoice() { return settings.gameTextMode === 'explicit' ? settings.gameTextLanguage! : settings.gameTextMode; },
		get gameTextLanguage() { return requestedGameLanguage; },
		get gameTextResolution() { return gameText; },
		get gamePath() { return settings.gamePath; },
		get savePath() { return settings.savePath; },
		get profileId() { return settings.profileId; },
		get autoBackup() { return settings.autoBackup; },
		get isSetupComplete() { return settings.isSetupComplete; },
		get gameInstall() { return settings.gameInstall; }
	};
}
export function setEditorLanguage(language: string) {
	if (language !== 'system' && !isGameLanguage(language)) return;
	pendingEditor = language === 'system' && evidence.path === null ? { ...editor } : undefined;
	settings.editorLanguage = language;
	launchFallback = false;
	applyLocale();
	update({ editorLanguage: language });
	if (language === 'system') void refreshLanguageEvidence();
}
export function setGameTextLanguage(choice: string) {
	if (choice === 'match-game' || choice === 'same-as-editor') {
		settings.gameTextMode = choice;
		settings.gameTextLanguage = undefined;
	} else if (isGameLanguage(choice)) {
		settings.gameTextMode = 'explicit';
		settings.gameTextLanguage = choice;
	} else return;
	update({ gameTextMode: settings.gameTextMode, gameTextLanguage: settings.gameTextLanguage });
}
export function setGamePath(path: string) {
	settings.gamePath = path;
	update({ gamePath: path });
	if (ready) void refreshLanguageEvidence();
}
export function setSavePath(path: string) { settings.savePath = path; update({ savePath: path }); }
export function setProfileId(id: string) { settings.profileId = id; update({ profileId: id }); }
export function setAutoBackup(enabled: boolean) { settings.autoBackup = enabled; update({ autoBackup: enabled }); }
export function completeSetup() { settings.isSetupComplete = true; update({ isSetupComplete: true }); }
export function setGameInstall(install: GameInstall) { settings.gameInstall = install; update({ gameInstall: install }); }
export function resetSetup() {
	const editorLanguage = settings.editorLanguage;
	settings = { ...defaultSettings(), editorLanguage };
	resetGameData();
	update({ ...settings, gameTextLanguage: undefined });
	if (ready) void refreshLanguageEvidence();
}
