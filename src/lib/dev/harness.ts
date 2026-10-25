import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { createHarnessProfile, applyFixtureEdits } from './fixture.js';
import { GAME_TEXT_LOCALES } from '#lib/data/game-text-languages.js';

export interface ResponsePlan {
	command: string;
	language?: string;
	gamePath?: string;
	delayMs?: number;
	fail?: string | { kind: string; folder: string; detail: string } | { code: string; params: Record<string, string | number>; detail: string | null };
	empty?: boolean;
	hold?: string;
	value?: unknown;
}
export interface IpcCall { command: string; args: Record<string, unknown> }

export async function installHarness() {
	const calls: IpcCall[] = [];
	const plans: ResponsePlan[] = [];
	const held = new Map<string, () => void>();
	let gameStatus: boolean | 'uncertain' = false;
	const values: Record<string, unknown> = {
		gamePath: '/h1/game', savePath: '/h1/profile_0', profileId: 'profile_0',
		autoBackup: false, isSetupComplete: !new URL(location.href).searchParams.has('preSetup'), gameInstall: null, gameTextLanguage: 'english', gameTextMode: 'explicit', editorLanguage: 'system'
	};
	if (new URL(location.href).searchParams.has('longPaths')) {
		values.gamePath = '/h1/' + 'x'.repeat(200) + '/DarkestDungeon';
		values.savePath = '/h1/' + 'y'.repeat(200) + '/profile_0';
	}
	if (new URL(location.href).searchParams.has('emptyPaths')) { values.gamePath = ''; values.savePath = ''; }
	const fixture = createHarnessProfile();
	const startup = new URL(location.href).searchParams.get('startup');
	const profileLoading = new URL(location.href).searchParams.get('profileLoading');
	if (profileLoading === 'read') plans.push({ command: 'load_profile', hold: 'profile-read' });
	if (profileLoading === 'libraries') plans.push({ command: 'load_quirk_library', hold: 'profile-libraries' });
	if (startup === 'hanging-read') plans.push({ command: 'read_settings', hold: 'startup-read' });
	if (startup === 'corrupt' || startup === 'recovery-failed') {
		for (const key of Object.keys(values)) delete values[key];
		plans.push({ command: 'read_settings', value: { status: 'corrupt', values: {}, folder: '/h1/settings', fingerprint: { size: 1, hash: 'fixture' }, detail: '' } });
	}
	if (startup === 'unreadable') plans.push({ command: 'read_settings', value: { status: 'io_error', values: {}, folder: '/h1/settings', fingerprint: null, detail: 'fixture: settings read denied' } });
	if (startup === 'recovery-failed') plans.push({ command: 'recover_corrupt_settings', fail: { kind: 'io_error', folder: '/h1/settings', detail: 'fixture: settings recovery denied' } });
	if (startup === 'manual-timeout') {
		values.editorLanguage = 'german';
		values.gameTextMode = 'match-game';
		delete values.gameTextLanguage;
	}
	if (startup === 'late-detection' || startup === 'manual-timeout') plans.push({ command: 'collect_language_evidence', hold: 'startup-detection' });
	const installed = new URL(location.href).searchParams.get('installed');
	if (installed === 'limited') plans.push({ command: 'available_game_text_languages', hold: 'installed-languages', value: ['english', 'russian'] });
	if (installed === 'failed') plans.push({ command: 'available_game_text_languages', fail: 'fixture language list unavailable' });

	mockWindows('main');
	mockIPC(async (command, input) => {
		const args = (input ?? {}) as Record<string, unknown>;
		// Args can hold Svelte state proxies, which structuredClone rejects.
		calls.push({ command, args: JSON.parse(JSON.stringify(args)) });
		const index = plans.findIndex((plan) => plan.command === command &&
			(!plan.language || plan.language === args.language) && (!plan.gamePath || plan.gamePath === args.gamePath));
		const plan = index < 0 ? undefined : plans.splice(index, 1)[0];
		if (plan?.hold) await new Promise<void>((resolve) => held.set(plan.hold!, resolve));
		if (plan?.delayMs) await new Promise((resolve) => setTimeout(resolve, plan.delayMs));
		if (plan?.fail) throw typeof plan.fail === 'string' ? new Error(plan.fail) : plan.fail;
		if (plan && Object.hasOwn(plan, 'value')) return plan.value;
		if (plan?.empty) return command === 'load_localization' ? {} : [];
		if (command === 'read_settings') return { status: 'ok', values: { ...values }, folder: '/h1/settings', fingerprint: null, detail: '' };
		if (command === 'collect_language_evidence') return {
			os_locales: { status: 'ok', value: new URL(location.href).searchParams.has('automatic') ? ['tr-TR'] : ['en-US'] },
			game_options: { status: 'ok', value: { language: 'russian', path_kind: 'fixture', verified: false } },
			steam_manifest: { status: 'absent', value: null }
		};
		if (command === 'recover_corrupt_settings') return 'settings.json.corrupt-123/settings.json';
		if (command === 'set_native_menu_language') return;
		if (command === 'plugin:store|load') return 1;
		if (command === 'plugin:store|get') return [values[String(args.key)], Object.hasOwn(values, String(args.key))];
		if (command === 'plugin:store|set') { values[String(args.key)] = args.value; return; }
		if (command === 'plugin:store|delete') { delete values[String(args.key)]; return true; }
		if (command === 'plugin:store|save' || command === 'plugin:resources|close') return;
		if (command === 'plugin:app|version') return '1.0.0-h1';
		if (command === 'generate_name_table') return ['stage_coach.rostersize'];
		if (command === 'set_name_table' || command === 'save_profile') return;
		if (command === 'load_profile') return { data: structuredClone(fixture), name_table_version: 17 };
		if (command === 'load_localization') return {
			hero_class_name_crusader: `${args.language}:crusader`,
			hero_class_name_vestal: `${args.language}:vestal`,
			str_inventory_title_trinketh1_trinket_a: `${args.language}:trinket-a`,
			str_inventory_title_trinketh1_trinket_b: `${args.language}:trinket-b`
		};
		if (command === 'available_game_text_languages') return Object.keys(GAME_TEXT_LOCALES);
		if (command === 'detect_save_locations') return [{ path: '/h1/profile_0', source: 'Manual', steam_user_id: null, profile_id: 'profile_0', has_active_raid: false }];
		if (command === 'is_game_running') {
			if (gameStatus === 'uncertain') throw new Error('fixture: game status unavailable');
			return gameStatus;
		}
		if (command === 'check_restore') return { adds: 2, removes: 1, blocked_reason: null };
		if (command === 'list_backups') return [{ path: '/h1/backup', timestamp: '2026-10-25T10:00:00Z', file_count: 22, profile_id: 'profile_0' }];
		if (command === 'load_roster_capacity_rules') return null;
		if (['load_quirk_library', 'load_trinket_library', 'load_class_stats', 'load_class_skills', 'scan_mod_directories', 'detect_game_installations'].includes(command)) return [];
		if (command === 'create_backup') return '/h1/backup';
		if (command === 'open_backup_folder') return '/h1/backups';
		throw new Error(`H1 unexpected IPC: ${command}`);
	}, { shouldMockEvents: true });

	const store = await import('#lib/stores/save-data.svelte.js');
	const settings = await import('#lib/stores/settings.svelte.js');
	const game = await import('#lib/stores/game-data.svelte.js');
	const text = await import('#lib/stores/game-text.svelte.js');
	const save = await import('#lib/api/save.js');
	window.__h1 = {
		calls, plans,
		persistedSettings: () => JSON.parse(JSON.stringify(values)),
		release(id: string) { const resolve = held.get(id); if (!resolve) throw new Error(`No held response: ${id}`); held.delete(id); resolve(); },
		held: () => [...held.keys()],
		edit() { applyFixtureEdits(store); },
		resetProfile: store.resetSaveData,
		loadProfile: store.loadProfileFromBackend,
		gameStatus(status: boolean | 'uncertain') { gameStatus = status; },

		validationCounts(errors: number, warnings: number) {
			for (const { slot } of store.getTreatmentSlots()) slot.hero = 0;
			for (const [index, hero] of store.getHeroes().entries()) {
				const raw = store.getHeroRawData(hero.guid)!;
				raw.weapon_rank = index < errors ? 5 : 0;
				raw.armour_rank = 0;
				raw['roster.status'] = index < warnings ? 2 : 0;
			}
			store.markDirty('persist.roster.json');
			store.markDirty('persist.town.json');
		},
		snapshot() {
			const state = store.getSaveData();
			return JSON.parse(JSON.stringify({ dirty: store.getDirtyData(), dirtyFiles: [...state.dirtyFiles],
				data: { roster: state.roster, estate: state.estate, town: state.town, upgrades: state.upgrades, raid: state.raid, game: state.game, campaignLog: state.campaignLog, progression: state.progression },
				profilePath: state.profilePath, gamePath: state.gamePath, version: state.nameTableVersion,
				heroes: store.getHeroes().map((hero) => ({ id: hero.guid, name: hero.name, heroClass: hero.heroClass })),
				loaded: state.isLoaded, stale: state.isStale }));
		},
		async save() { const state = store.getSaveData(); await save.saveProfile(state.profilePath, store.getDirtyData(), state.nameTableVersion); },
		gameText() { const state = text.getGameTextState(); return { requested: state.requestedLanguage, effective: state.effectiveLanguage, path: state.effectivePath, loading: state.loading, error: state.error, errorDetail: state.errorDetail, failedRequest: state.failedRequest }; },
		gameNames: () => ({ ...game.getGameData().nameTable }),
		localize: game.localize,
		markStale: store.markProfileStale,
		getSettings: () => ({ gamePath: settings.getSettings().gamePath, language: settings.getSettings().gameTextLanguage, editorLanguage: settings.getSettings().editorLanguage, ready: settings.getSettings().ready, startupElapsedMs: settings.getSettings().startupElapsedMs })
	};
}

export type Harness = NonNullable<Window['__h1']>;
declare global {
	interface Window {
		__h1?: {
			calls: IpcCall[];
			persistedSettings(): Record<string, unknown>;
			plans: ResponsePlan[];
			release(id: string): void;
			held(): string[];
			edit(): void;
			resetProfile(): void;
			loadProfile(path: string): Promise<void>;
			gameStatus(status: boolean | 'uncertain'): void;
			validationCounts(errors: number, warnings: number): void;
			snapshot(): { dirty: Record<string, unknown>; data: Record<string, unknown>; dirtyFiles: string[]; profilePath: string; gamePath: string; version: number; heroes: { id: string; name: string; heroClass: string }[]; loaded: boolean; stale: boolean };
			save(): Promise<void>;
			gameText(): { requested: string; effective: string; path: string; loading: boolean; error: boolean; errorDetail: string; failedRequest: number };
			gameNames(): Record<string, string>;
			localize(key: string, fallback?: string): string;
			markStale(): void;
			getSettings(): { gamePath: string; language: string; editorLanguage: string; ready: boolean; startupElapsedMs: number };
		};
	}
}
