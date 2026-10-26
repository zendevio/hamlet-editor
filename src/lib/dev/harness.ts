import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { createHarnessProfile, applyFixtureEdits } from './fixture.js';
import { GAME_TEXT_LOCALES } from '#lib/data/game-text-languages.js';
import { pseudoMessage } from './pseudo-locale.js';

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

	// ?pseudoNames swaps the short fixture tokens for the real English game names,
	// pseudo-expanded, so overflow states see the longer de/fr/ru/pl game names.
	const pseudoNames = new URL(location.href).searchParams.has('pseudoNames');
	const expandedNames = Object.fromEntries(Object.entries({
		hero_class_name_crusader: 'Crusader', hero_class_name_vestal: 'Vestal',
		str_inventory_title_trinketh1_trinket_a: 'Sun Ring of the Ancestral Crusade', str_inventory_title_trinketh1_trinket_b: 'Cleansing Crystal Pendant',
		str_quirk_name_quick_reflexes: 'Quick Reflexes', str_quirk_name_warrior_of_light: 'Warrior of Light',
		combat_skill_name_crusader_smite: 'Smite', camping_skill_name_encourage: 'Encourage',
		town_name_abbey: 'Abbey', town_name_blacksmith: 'Blacksmith', town_activity_name_prayer: 'Meditation and Prayer',
		'upgrade_tree_name_abbey.prayer': 'Transept', 'upgrade_tree_name_blacksmith.cost': 'Furnace and Anvil',
		str_bank_title: 'Bank of the Hamlet', str_buskers_corner_title: 'Puppet Theatre', str_inventory_title_gold: 'Gold',
		str_inventory_title_heirloombust: 'Bust', tutorial_popup_blueprints_title: 'Blueprint', str_inventory_title_shard: 'Shards',
		str_inventory_title_estate_currencycrimson_court_invitation_A: "Baron's Invitation", str_inventory_title_estate_currencycrimson_court_invitation_B: "Viscount's Invitation",
		str_inventory_title_estate_currencycrimson_court_invitation_C: "Countess' Invitation", str_inventory_title_estatethe_blood: 'The Blood',
		str_dlc_title_crimson_court: 'The Crimson Court', str_dlc_title_shieldbreaker: 'The Shieldbreaker', str_dlc_title_color_of_madness: 'The Color of Madness',
		str_dlc_title_musketeer: 'The Musketeer', dungeon_name_crypts: 'Ruins', town_quest_difficulty_1: 'Apprentice', town_quest_length_2: 'Medium',
		str_inventory_title_supplymedicinal_herbs: 'Medicinal Herbs'
	}).map(([key, name]) => [key, pseudoMessage(name.replaceAll("'", "''"))]));

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
		if (plan?.empty) return command === 'load_localization' ? { table: {}, english: {} } : [];
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
		if (command === 'load_localization') return { table: pseudoNames ? expandedNames : {
			hero_class_name_crusader: `${args.language}:crusader`,
			hero_class_name_vestal: `${args.language}:vestal`,
			str_inventory_title_trinketh1_trinket_a: `${args.language}:trinket-a`,
			str_inventory_title_trinketh1_trinket_b: `${args.language}:trinket-b`,
			str_quirk_name_quick_reflexes: `${args.language}:quick-reflexes`,
			str_quirk_name_warrior_of_light: `${args.language}:warrior-of-light`,
			combat_skill_name_crusader_smite: `${args.language}:smite`,
			camping_skill_name_encourage: `${args.language}:encourage`,
			town_name_abbey: `${args.language}:abbey`,
			town_name_blacksmith: `${args.language}:blacksmith`,
			town_activity_name_prayer: `${args.language}:prayer`,
			'upgrade_tree_name_abbey.prayer': `${args.language}:transept`,
			'upgrade_tree_name_blacksmith.cost': `${args.language}:furnace`,
			str_bank_title: `${args.language}:bank`,
			str_buskers_corner_title: `${args.language}:puppet-theatre`,
			str_inventory_title_gold: `${args.language}:gold`,
			str_inventory_title_heirloombust: `${args.language}:bust`,
			tutorial_popup_blueprints_title: `${args.language}:blueprint`,
			str_inventory_title_shard: `${args.language}:shards`,
			str_inventory_title_estate_currencycrimson_court_invitation_A: `${args.language}:baron-invitation`,
			str_inventory_title_estate_currencycrimson_court_invitation_B: `${args.language}:viscount-invitation`,
			str_inventory_title_estate_currencycrimson_court_invitation_C: `${args.language}:countess-invitation`,
			str_inventory_title_estatethe_blood: `${args.language}:blood`,
			str_dlc_title_crimson_court: `${args.language}:crimson-court`,
			str_dlc_title_shieldbreaker: `${args.language}:shieldbreaker`,
			str_dlc_title_color_of_madness: `${args.language}:color-of-madness`,
			str_dlc_title_musketeer: `${args.language}:musketeer`,
			dungeon_name_crypts: `${args.language}:ruins`,
			town_quest_difficulty_1: `${args.language}:apprentice`,
			town_quest_length_2: `${args.language}:medium`,
			str_inventory_title_supplymedicinal_herbs: `${args.language}:herbs`
		}, english: args.language === 'english' ? null : { str_quirk_name_quick_reflexes: 'english:quick-reflexes',
			str_quirk_name_warrior_of_light: 'Warrior of Light',
			str_inventory_title_trinketh1_trinket_a: 'English Jewel Alpha', str_inventory_title_trinketh1_trinket_b: 'English Jewel Beta' } };
		if (command === 'available_game_text_languages') return Object.keys(GAME_TEXT_LOCALES);
		if (command === 'detect_save_locations') return [
			{ path: '/h1/profile_0', source: 'Manual', steam_user_id: null, profile_id: 'profile_0', has_active_raid: false },
			...(new URL(location.href).searchParams.has('profiles') ? [{ path: '/h1/profile_1', source: 'Steam', steam_user_id: 'h1-user', profile_id: 'profile_1', has_active_raid: true }] : [])
		];
		if (command === 'is_game_running') {
			if (gameStatus === 'uncertain') throw new Error('fixture: game status unavailable');
			return gameStatus;
		}
		if (command === 'check_restore') return { adds: 2, removes: 1, blocked_reason: null };
		if (command === 'list_backups') return [{ path: '/h1/backup', timestamp: '2026-10-25T10:00:00Z', file_count: 22, profile_id: 'profile_0' }];
		if (command === 'load_class_skills') return [{ class_id: 'crusader', combat_skills: ['smite'], camping_skills: ['encourage'] }];
		if (command === 'load_roster_capacity_rules') return null;
		if (['load_quirk_library', 'load_trinket_library', 'load_class_stats', 'scan_mod_directories', 'detect_game_installations'].includes(command)) return [];
		if (command === 'create_backup') return '/h1/backup';
		if (command === 'open_backup_folder') return '/h1/backups';
		if (command === 'open_project_link') return null;
		throw new Error(`H1 unexpected IPC: ${command}`);
	}, { shouldMockEvents: true });

	const store = await import('#lib/stores/save-data.svelte.js');
	const settings = await import('#lib/stores/settings.svelte.js');
	const game = await import('#lib/stores/game-data.svelte.js');
	const text = await import('#lib/stores/game-text.svelte.js');
	const save = await import('#lib/api/save.js');
	window.__h1 = {
		calls, plans,
		async catalog(locale: 'en' | 'fr' | 'de' | 'es' | 'it' | 'pt-BR' | 'pl' | 'cs' | 'ru' | 'zh-Hans' | 'ja' | 'ko' | 'pseudo' | 'ja-pseudo') {
			const { usePseudoLocale } = await import('./catalog-override.js');
			const { setEditorLocale } = await import('#lib/i18n/index.svelte.js');
			// ja-pseudo keeps expanded pseudo text but applies Japanese typography
			// (lang ja and the cjk class: 12 px floor and the CJK font stack).
			setEditorLocale(locale === 'ja-pseudo' ? 'ja' : locale === 'pseudo' ? 'en' : locale);
			await usePseudoLocale(locale === 'pseudo' || locale === 'ja-pseudo');
		},
		blockRaidEstate() { Reflect.deleteProperty(store.getSaveData().estate!.base_root, 'trinkets'); },
		deadHero(ids = ['96']) { for (const id of ids) store.getHeroRawData(id)!['roster.status'] = 3; },
		vampireHero() {
			store.addHeroQuirk('96', 'disease_vampire_passive', {
				is_locked: false, is_new: false, mission_count: 0,
				replaces_quirk: 0, replaces_quirk_viewed: false, evolution_duration_remaining: 0
			});
		},
		longNames() {
			store.setHeroName('96', 'VeryLongHeroName'.repeat(12));
			store.setEstateName('VeryLongEstateName'.repeat(12));
		},
		persistedSettings: () => JSON.parse(JSON.stringify(values)),
		release(id: string) { const resolve = held.get(id); if (!resolve) throw new Error(`No held response: ${id}`); held.delete(id); resolve(); },
		held: () => [...held.keys()],
		edit() { applyFixtureEdits(store); },
		resetProfile: store.resetSaveData,
		loadProfile: store.loadProfileFromBackend,
		gameStatus(status: boolean | 'uncertain') { gameStatus = status; },
		raidData(inconsistent = false) {
			// Opt-in S5 data does not change the shared paired-save fixture.
			const data = store.getSaveData();
			data.game!.base_root.inraid = true;
			store.setGameInRaid(true);
			if (!inconsistent) {
				store.loadRaid({ base_root: {
					raid_instance: { id: 'h1_quest', is_plot_quest: false, type: 'explore', dungeon: 'crypts', difficulty: 1, length: 2,
						goal_ids: ['###goal_a', '###goal_b', 'mod_goal'], completion_reward: { resolve_xp: 2, items_definition: { items: {} } } },
					torchlight: 79.5, in_area: 1234, areatile: 0, last_room_id: 0,
					in_doorway: { area_to: 0, tile_to: 0, implied: false }, start_elapsed_time: 0,
					inbattle: false, stat_database: {}, raid_finish_quirk_monster_class_ids: [],
					party: { heroes: [96, 7], start_heroes_size: 2, 'IsMovingLeft()': false, retreat_room: 0, hunger_room_buffer: 2,
						inventory: { items: { '0': { id: 'medicinal_herbs', type: 'supply', amount: 1234 },
							'1': { id: 'h1_trinket_a', type: 'trinket', amount: 2 }, '2': { id: 'unknown_mod_item', type: 'supply', amount: 1 } } } }
				} });
				for (const id of ['96', '7']) store.getHeroRawData(id)!['roster.status'] = 1;
				store.setRaidHungerBuffer(1234);
			}
			store.markDirty('persist.game.json');
			store.markDirty('persist.roster.json');
		},

		estateTownData() {
			// Only the S4 cases opt into this in-memory fixture. Existing paired saves stay unchanged.
			const data = store.getSaveData();
			data.estate!.base_root.wallet['5'] = { type: 'shard', amount: 1234 };
			data.estate!.base_root.wallet['6'] = { type: 'blueprint', amount: 12 };
			data.estate!.base_root.estate_items.items = {
				'0': { type: 'estate_currency', id: 'crimson_court_invitation_A', amount: 2 },
				'1': { type: 'estate', id: 'the_blood', amount: 15 }
			};
			data.town!.base_root.buildings = { abbey: { activities: { prayer: {
				'0': { hero: 96, visitsRemaining: 1, resident_occupied: 0, is_side_effect_result: false }
			} } } };
			data.town!.base_root.districts = { buildings: {
				bank: { built: true, saved_counter: 17 }, buskers_corner: { built: false }
			} };
			data.upgrades!.base_root.purchases = {
				'0': { instance_number: 0, tree_id: '###abbey.prayer', requirement_code: 'a', is_purchased: true },
				'1': { instance_number: 0, tree_id: '###blacksmith.cost', requirement_code: 'a', is_purchased: true },
				'2': { instance_number: 0, tree_id: '###blacksmith.cost', requirement_code: 'b', is_purchased: true },
				'3': { instance_number: 0, tree_id: '###blacksmith.cost', requirement_code: 'c', is_purchased: true },
				'4': { instance_number: 1234, tree_id: -123456789, requirement_code: 'opaque', is_purchased: true }
			};
			const hero = store.getHeroRawData('96')!;
			hero['roster.status'] = 2;
			hero['roster.building_name'] = 'abbey';
			store.setWalletAmount('gold', 1234567);
			for (const file of ['persist.estate.json', 'persist.town.json', 'persist.upgrades.json', 'persist.roster.json'] as const) store.markDirty(file);
		},
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
			catalog(locale: 'en' | 'fr' | 'de' | 'es' | 'it' | 'pt-BR' | 'pl' | 'cs' | 'ru' | 'zh-Hans' | 'ja' | 'ko' | 'pseudo' | 'ja-pseudo'): Promise<void>;
			blockRaidEstate(): void;
			deadHero(ids?: string[]): void;
			vampireHero(): void;
			longNames(): void;
			persistedSettings(): Record<string, unknown>;
			plans: ResponsePlan[];
			release(id: string): void;
			held(): string[];
			edit(): void;
			resetProfile(): void;
			loadProfile(path: string): Promise<void>;
			gameStatus(status: boolean | 'uncertain'): void;
			raidData(inconsistent?: boolean): void;
			estateTownData(): void;
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
