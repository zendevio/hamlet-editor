/**
 * Settings store — persists game/save paths and profile selection.
 *
 * Uses Svelte 5 runes for reactive state. Persistence via tauri-plugin-store
 * (LazyStore). Falls back gracefully in dev/browser environments.
 */

import type { GameInstall } from '#lib/api/detect.js';
import { resetGameData } from '#lib/stores/game-data.svelte.js';

// ── Persistence helpers ──

const STORE_FILE = 'settings.json';

async function getStore() {
	try {
		const { LazyStore } = await import('@tauri-apps/plugin-store');
		return new LazyStore(STORE_FILE);
	} catch {
		return null;
	}
}

async function persistAll() {
	try {
		const store = await getStore();
		if (!store) return;
		await store.set('gamePath', gamePath);
		await store.set('savePath', savePath);
		await store.set('profileId', profileId);
		await store.set('autoBackup', autoBackup);
		await store.set('isSetupComplete', isSetupComplete);
		await store.set('gameInstall', gameInstall);
		await store.save();
	} catch {
		// Silently ignore persistence errors — they're non-fatal
	}
}

// ── Reactive State ──

let gamePath = $state<string>('');
let savePath = $state<string>('');
let profileId = $state<string>('');
let autoBackup = $state(false);
let isSetupComplete = $state(false);
let gameInstall = $state<GameInstall | null>(null);

// ── Init: load persisted settings ──

(async () => {
	try {
		const store = await getStore();
		if (!store) return;
		const savedGamePath = await store.get<string>('gamePath');
		const savedSavePath = await store.get<string>('savePath');
		const savedProfileId = await store.get<string>('profileId');
		const savedAutoBackup = await store.get<boolean>('autoBackup');
		const savedIsSetupComplete = await store.get<boolean>('isSetupComplete');
		const savedGameInstall = await store.get<GameInstall>('gameInstall');

		if (savedGamePath != null) gamePath = savedGamePath;
		if (savedSavePath != null) savePath = savedSavePath;
		if (savedProfileId != null) profileId = savedProfileId;
		if (savedAutoBackup != null) autoBackup = savedAutoBackup;
		if (savedIsSetupComplete != null) isSetupComplete = savedIsSetupComplete;
		if (savedGameInstall != null) gameInstall = savedGameInstall;
	} catch {
		// Silently ignore — store not available in dev/browser mode
	}
})();

// ── Public API ──

export function getSettings() {
	return {
		get gamePath() {
			return gamePath;
		},
		get savePath() {
			return savePath;
		},
		get profileId() {
			return profileId;
		},
		get autoBackup() {
			return autoBackup;
		},
		get isSetupComplete() {
			return isSetupComplete;
		},
		get gameInstall() {
			return gameInstall;
		}
	};
}

export function setGamePath(path: string) {
	gamePath = path;
	persistAll();
}

export function setSavePath(path: string) {
	savePath = path;
	persistAll();
}

export function setProfileId(id: string) {
	profileId = id;
	persistAll();
}

export function setAutoBackup(enabled: boolean) {
	autoBackup = enabled;
	persistAll();
}

export function completeSetup() {
	isSetupComplete = true;
	persistAll();
}

export function setGameInstall(install: GameInstall) {
	gameInstall = install;
	persistAll();
}

export function resetSetup() {
	gamePath = '';
	savePath = '';
	profileId = '';
	autoBackup = false;
	isSetupComplete = false;
	gameInstall = null;
	resetGameData();
	persistAll();
}
