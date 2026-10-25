import { isGameLanguage, type EditorLanguage, type GameLanguage, type GameTextMode } from '#lib/i18n/language-resolution.js';
import type { GameInstall } from '#lib/api/detect.js';

export interface Settings {
	gamePath: string;
	savePath: string;
	profileId: string;
	autoBackup: boolean;
	isSetupComplete: boolean;
	gameInstall: GameInstall | null;
	editorLanguage: EditorLanguage;
	gameTextMode: GameTextMode;
	gameTextLanguage?: GameLanguage;
}
export const defaultSettings = (): Settings => ({
	gamePath: '', savePath: '', profileId: '', autoBackup: false, isSetupComplete: false,
	gameInstall: null, editorLanguage: 'system', gameTextMode: 'match-game'
});
export type Patch = Record<string, unknown>;
export function migrateSettings(raw: Record<string, unknown>, invalid: (key: string) => void = () => {}): Settings {
	const result = defaultSettings();
	for (const key of ['gamePath', 'savePath', 'profileId'] as const) {
		if (typeof raw[key] === 'string') result[key] = raw[key];
		else if (Object.hasOwn(raw, key)) invalid(key);
	}
	for (const key of ['autoBackup', 'isSetupComplete'] as const) {
		if (typeof raw[key] === 'boolean') result[key] = raw[key];
		else if (Object.hasOwn(raw, key)) invalid(key);
	}
	const install = raw.gameInstall as Partial<GameInstall> | null;
	if (install && typeof install === 'object' && typeof install.path === 'string' &&
		['Steam', 'Gog', 'Manual'].includes(install.source ?? '') &&
		['has_crimson_court', 'has_shieldbreaker', 'has_color_of_madness', 'has_musketeer', 'has_mods'].every((key) => typeof (install as Record<string, unknown>)[key] === 'boolean')) {
		result.gameInstall = install as GameInstall;
	} else if (raw.gameInstall != null) invalid('gameInstall');
	if (raw.editorLanguage === 'system' || isGameLanguage(raw.editorLanguage)) result.editorLanguage = raw.editorLanguage;
	else if (Object.hasOwn(raw, 'editorLanguage')) invalid('editorLanguage');
	const explicit = isGameLanguage(raw.gameTextLanguage) ? raw.gameTextLanguage : undefined;
	if (Object.hasOwn(raw, 'gameTextLanguage') && !explicit) invalid('gameTextLanguage');
	const mode = raw.gameTextMode;
	if (mode === 'match-game' || mode === 'same-as-editor' || mode === 'explicit') result.gameTextMode = mode;
	else {
		if (Object.hasOwn(raw, 'gameTextMode')) invalid('gameTextMode');
		if (explicit) result.gameTextMode = 'explicit';
	}
	if (result.gameTextMode === 'explicit') {
		if (explicit) result.gameTextLanguage = explicit;
		else result.gameTextMode = 'match-game';
	}
	return result;
}
/** Only Phase A compatibility changes belong on disk without a user choice. */
export function startupMigrationPatch(raw: Record<string, unknown>): Patch {
	if (!Object.hasOwn(raw, 'gameTextMode') && isGameLanguage(raw.gameTextLanguage)) return { gameTextMode: 'explicit' };
	if ((raw.gameTextMode === 'match-game' || raw.gameTextMode === 'same-as-editor') && Object.hasOwn(raw, 'gameTextLanguage')) return { gameTextLanguage: undefined };
	return {};
}
export interface WritableStore {
	set(key: string, value: unknown): Promise<unknown>;
	delete(key: string): Promise<unknown>;
	save(): Promise<unknown>;
}

/** One writer serializes batches. Pending keys coalesce; revisions cannot overtake. */
export function createSettingsWriter(store: () => Promise<WritableStore>, failed: (error: unknown) => void, saved: () => void = () => {}) {
	let revision = 0;
	let persistedRevision = 0;
	let pending: Patch = {};
	let running: Promise<void> | undefined;
	let enabled = false;
	function drain(): Promise<void> {
		if (running) return running;
		let failedAtRevision: number | undefined;
		running = Promise.resolve().then(async () => {
			while (Object.keys(pending).length) {
				const patch = pending;
				const current = revision;
				pending = {};
				try {
					const target = await store();
					for (const [key, value] of Object.entries(patch)) {
						if (value === undefined) await target.delete(key);
						else await target.set(key, value);
					}
					await target.save();
					persistedRevision = current;
					saved();
				} catch (error) {
					// Retain failed keys for the next user write, with newer values winning.
					pending = { ...patch, ...pending };
					failed(error);
					failedAtRevision = current;
					if (revision === current) break;
				}
			}
		}).finally(() => {
			running = undefined;
			if (Object.keys(pending).length && failedAtRevision !== revision) void drain();
		});
		return running;
	}
	return {
		enable() { enabled = true; },
		write(patch: Patch) {
			revision++;
			if (!enabled) { failed(new Error('Settings could not be read')); return; }
			pending = { ...pending, ...patch };
			void drain();
		},
		flush: () => running ?? Promise.resolve(),
		get revision() { return revision; },
		get persistedRevision() { return persistedRevision; }
	};
}
