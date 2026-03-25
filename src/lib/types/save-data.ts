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
