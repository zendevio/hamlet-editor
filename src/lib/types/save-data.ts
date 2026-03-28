/**
 * Shared save-data types used across multiple pages and components.
 *
 * These were extracted from individual page files to avoid duplication.
 * They mirror the JSON structures decoded by the Rust backend.
 */

// ── Estate Types ──

export interface WalletEntry {
	amount: number;
	type: string;
}

export interface TrinketEntry {
	id: string;
	type: string;
	amount: number;
}

export interface EstateItem {
	id: string;
	type: string;
	amount: number;
}

// ── Raid Types ──

export interface InventoryItem {
	id: string;
	type: string;
	amount: number;
}

export interface RaidInstance {
	id: string;
	is_plot_quest: boolean;
	type: string;
	dungeon: string;
	difficulty: number;
	length: number;
	goal_ids: string[];
	completion_reward: {
		resolve_xp: number;
		items_definition: {
			system_config_type: string;
			items: Record<string, unknown>;
		};
	};
}

export interface RaidParty {
	heroes: number[];
	start_heroes_size: number;
	/** IMPORTANT: torchlight is a Float in DSON. Always write as float (75.0, not 75). */
	torchlight: number;
	'IsMovingLeft()': boolean;
	retreat_room: string;
	scoutChance_all: number;
	scoutModifier_all: number;
	inventory: {
		system_config_type: string;
		items: Record<string, InventoryItem>;
		hunger_room_buffer: number;
	};
}

export interface RaidData {
	base_root: {
		raid_instance: RaidInstance;
		in_area: string;
		areatile: string;
		last_room_id: string;
		in_doorway: boolean;
		start_elapsed_time: number;
		inbattle: boolean;
		stat_database: Record<string, unknown>;
		raid_finish_quirk_monster_class_ids: unknown[];
		party: RaidParty;
	};
}

// ── Hero Types ──

export interface HeroQuirk {
	is_locked: boolean;
	is_new: boolean;
	mission_count: number;
	replaces_quirk: number;
	replaces_quirk_viewed: boolean;
	evolution_duration_remaining: number;
}

export interface HeroActor {
	name: string;
	current_hp: number;
	colour_variation: number;
	stunned: number;
	combat_ready: boolean;
	damage_source_data: string;
	buff_group: Record<string, unknown>;
	buff_group_next_guid: number;
	actor_dot: Record<string, unknown>;
}

export interface HeroBaseRoot {
	'roster.status': number;
	'roster.before_on_start_town_visit_status': number;
	'roster.building_name': string;
	actor: HeroActor;
	heroClass: string;
	resolveXp: number;
	m_Stress: number;
	visited_deaths_door: boolean;
	is_death_heart_attack_completed: boolean;
	has_had_heart_attack: boolean;
	deaths_door_enter_effect_round_cooldown: number;
	weapon_rank: number;
	armour_rank: number;
	affliction_type_id: string;
	affliction_severity: number;
	virtue_type_id: string;
	backer_hero: boolean;
	enemies_killed: number;
	steps_taken: number;
	provisions_consumed: number;
	dd_test_survived: number;
	number_of_successful_darkest_dungeon_quests: number;
	is_from_town_event: boolean;
	quirks: Record<string, HeroQuirk>;
	skills: {
		selected_combat_skills: Record<string, number>;
		selected_camping_skills: Record<string, number>;
	};
	trinkets: { items: Record<string, unknown> };
	dungeon_history: unknown[];
}

export interface HeroEntry {
	hero_file_data: {
		raw_data: {
			base_root: HeroBaseRoot;
		};
	};
}

export interface RosterData {
	base_root: {
		version: number;
		nextGuid: number;
		dismissed_hero_count: number;
		last_party: {
			last_party_guids: number[];
		};
		heroes: Record<string, HeroEntry>;
	};
}

export interface EstateData {
	base_root: {
		wallet: Record<string, { amount: number; type: string }>;
		trinkets: { items: Record<string, unknown> };
		estate_items: { items: Record<string, unknown> };
		endless_wave_highscore: number;
		tampering: Record<string, unknown>;
		darkest_dungeon_trinket_unlocks: Record<string, unknown>;
	};
}

export interface GameData {
	base_root: {
		estatename: string;
		inraid: boolean;
		game_mode: string;
		[key: string]: unknown;
	};
}

// ── Town & Upgrade Types ──

export interface UpgradePurchase {
	instance_number: number;
	tree_id: string;
	requirement_code: string;
	is_purchased: boolean;
}

export interface UpgradesData {
	base_root: {
		purchases: Record<string, UpgradePurchase>;
	};
}

export interface TownBuildingSlot {
	hero_guid: number;
	activity_type: string;
}

export interface TownBuilding {
	slots: Record<string, TownBuildingSlot>;
}

export interface TownDistrict {
	built: boolean;
}

export interface TownDistricts {
	buildings: Record<string, TownDistrict>;
}

export interface TownData {
	base_root: {
		buildings: Record<string, TownBuilding>;
		/** Color of Madness districts (only present when DLC is active). */
		districts?: TownDistricts;
	};
}

// ── Hero Summary & Derived Types ──

/** Flat list of heroes with their GUIDs for easy iteration. */
export interface HeroSummary {
	guid: string;
	name: string;
	heroClass: string;
	classDisplayName: string;
	resolveLevel: number;
	resolveXp: number;
	currentHp: number;
	maxHp: number;
	stress: number;
	status: number;
	statusLabel: string;
	statusDotClass: string;
	weaponRank: number;
	armourRank: number;
	afflictionTypeId: string;
	virtueTypeId: string;
	visitedDeathsDoor: boolean;
	buildingName: string;
	quirks: Record<string, HeroQuirk>;
	selectedCombatSkills: Record<string, number>;
	selectedCampingSkills: Record<string, number>;
	trinkets: Record<string, unknown>;
}

/** Hero currently occupying a treatment building slot. */
export interface TreatmentHero {
	guid: string;
	name: string;
	heroClass: string;
	classDisplayName: string;
	buildingName: string;
	activityType: string;
}

export interface BuildingUpgradeGroup {
	buildingName: string;
	displayName: string;
	upgrades: UpgradePurchase[];
	purchasedCount: number;
	totalCount: number;
}

// ── Save Filename Union ──

/** Valid save filenames managed by the store. */
export type SaveFileName =
	| 'persist.roster.json'
	| 'persist.estate.json'
	| 'persist.town.json'
	| 'persist.upgrades.json'
	| 'persist.raid.json'
	| 'persist.game.json'
	| 'persist.campaign_log.json'
	| 'persist.progression.json';
