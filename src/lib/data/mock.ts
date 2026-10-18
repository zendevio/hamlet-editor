/**
 * Mock data helpers for UI development and testing.
 *
 * Extracted from save-data.svelte.ts to keep the store lean.
 */

import type {
	HeroEntry,
	HeroQuirk,
	RosterData,
	EstateData,
	TownData,
	UpgradesData
} from '#lib/types/save-data.js';
import { RESOLVE_XP_THRESHOLDS } from '#lib/data/constants.js';

export function createMockHero(
	name: string,
	heroClass: string,
	status: number,
	level: number,
	currentHp: number,
	stress: number,
	weaponRank: number,
	armourRank: number,
	buildingName: string = ''
): HeroEntry {
	const quirks: Record<string, HeroQuirk> = {};
	// Add some example quirks
	const positiveQuirks = ['quick_reflexes', 'natural_swing', 'tough', 'eagle_eye', 'hard_skinned'];
	const negativeQuirks = ['nervous', 'fear_of_beast', 'kleptomaniac', 'thin_blooded', 'slow_reflexes'];
	const numPositive = Math.floor(Math.random() * 4) + 1;
	const numNegative = Math.floor(Math.random() * 3) + 1;

	for (let i = 0; i < numPositive; i++) {
		quirks[positiveQuirks[i]] = {
			is_locked: i === 0, // lock first one
			is_new: false,
			mission_count: Math.floor(Math.random() * 10),
			replaces_quirk: 0,
			replaces_quirk_viewed: false,
			evolution_duration_remaining: 0
		};
	}
	for (let i = 0; i < numNegative; i++) {
		quirks[negativeQuirks[i]] = {
			is_locked: false,
			is_new: false,
			mission_count: Math.floor(Math.random() * 10),
			replaces_quirk: 0,
			replaces_quirk_viewed: false,
			evolution_duration_remaining: 0
		};
	}

	return {
		hero_file_data: {
			raw_data: {
				base_root: {
					'roster.status': status,
					'roster.before_on_start_town_visit_status': status === 2 ? 0 : status,
					'roster.building_name': buildingName,
					actor: {
						name,
						current_hp: currentHp,
						colour_variation: 0,
						stunned: 0,
						combat_ready: false,
						damage_source_data: '###none',
						buff_group: {},
						buff_group_next_guid: 0,
						actor_dot: {}
					},
					heroClass,
					resolveXp: RESOLVE_XP_THRESHOLDS[level],
					m_Stress: stress,
					visited_deaths_door: status === 3,
					is_death_heart_attack_completed: false,
					has_had_heart_attack: false,
					deaths_door_enter_effect_round_cooldown: 0,
					weapon_rank: weaponRank,
					armour_rank: armourRank,
					affliction_type_id: stress >= 100 ? 'paranoid' : '',
					affliction_severity: stress >= 100 ? 1 : 0,
					virtue_type_id: '',
					backer_hero: false,
					enemies_killed: Math.floor(Math.random() * 50),
					steps_taken: Math.floor(Math.random() * 200),
					provisions_consumed: Math.floor(Math.random() * 100),
					dd_test_survived: 0,
					number_of_successful_darkest_dungeon_quests: 0,
					is_from_town_event: false,
					quirks,
					skills: {
						selected_combat_skills: {},
						selected_camping_skills: {}
					},
					trinkets: { items: {} },
					dungeon_history: []
				}
			}
		}
	};
}

export function createMockRoster(): RosterData {
	return {
		base_root: {
			version: 513,
			nextGuid: 110,
			dismissed_hero_count: 1,
			last_party: { last_party_guids: [96, 42, 7, 55] },
			heroes: {
				'96': createMockHero('Reynauld', 'crusader', 0, 4, 47, 12, 3, 3),
				'42': createMockHero('Dismas', 'highwayman', 0, 3, 35, 45, 2, 2),
				'7': createMockHero('Junia', 'vestal', 1, 5, 42, 0, 4, 4),
				'55': createMockHero('Sarmenti', 'jester', 2, 2, 15, 120, 2, 2, 'tavern'),
				'12': createMockHero('Barristan', 'man_at_arms', 2, 3, 42, 30, 3, 3, 'abbey'),
				'23': createMockHero('Paracelsus', 'plague_doctor', 0, 4, 34, 5, 3, 3),
				'34': createMockHero('Audrey', 'grave_robber', 2, 1, 24, 67, 1, 1, 'sanitarium'),
				'45': createMockHero('Bigby', 'bounty_hunter', 3, 6, 0, 0, 4, 4),
				'56': createMockHero('Boudica', 'hellion', 0, 3, 36, 88, 2, 2),
				'67': createMockHero('Tardif', 'bounty_hunter', 0, 0, 26, 0, 0, 0),
				'78': createMockHero('Damian', 'leper', 4, 2, 0, 0, 2, 2),
				'89': createMockHero('Missandei', 'occultist', 2, 4, 30, 15, 3, 3, 'abbey')
			}
		}
	};
}

export function createMockUpgrades(): UpgradesData {
	return {
		base_root: {
			purchases: {
				'0': { instance_number: 0, tree_id: '###sanitarium.cost', requirement_code: 'a', is_purchased: true },
				'1': { instance_number: 0, tree_id: '###sanitarium.slot', requirement_code: 'a', is_purchased: true },
				'2': { instance_number: 0, tree_id: '###sanitarium.slot', requirement_code: 'b', is_purchased: false },
				'3': { instance_number: 0, tree_id: '###tavern.cost', requirement_code: 'a', is_purchased: true },
				'4': { instance_number: 0, tree_id: '###tavern.cost', requirement_code: 'b', is_purchased: true },
				'5': { instance_number: 0, tree_id: '###tavern.slot', requirement_code: 'a', is_purchased: true },
				'6': { instance_number: 0, tree_id: '###abbey.cost', requirement_code: 'a', is_purchased: true },
				'7': { instance_number: 0, tree_id: '###abbey.slot', requirement_code: 'a', is_purchased: false },
				'8': { instance_number: 0, tree_id: '###blacksmith.cost', requirement_code: 'a', is_purchased: true },
				'9': { instance_number: 0, tree_id: '###blacksmith.cost', requirement_code: 'b', is_purchased: true },
				'10': { instance_number: 0, tree_id: '###blacksmith.cost', requirement_code: 'c', is_purchased: false },
				'11': { instance_number: 0, tree_id: '###guild.cost', requirement_code: 'a', is_purchased: true },
				'12': { instance_number: 0, tree_id: '###guild.cost', requirement_code: 'b', is_purchased: false },
				'13': { instance_number: 0, tree_id: '###stage_coach.size', requirement_code: 'a', is_purchased: true },
				'14': { instance_number: 0, tree_id: '###stage_coach.size', requirement_code: 'b', is_purchased: true },
				'15': { instance_number: 0, tree_id: '###stage_coach.roster_size', requirement_code: 'a', is_purchased: true },
				'16': { instance_number: 0, tree_id: '###survivalist.cost', requirement_code: 'a', is_purchased: true },
				'17': { instance_number: 0, tree_id: '###nomad_wagon.cost', requirement_code: 'a', is_purchased: true },
				'18': { instance_number: 0, tree_id: '###nomad_wagon.cost', requirement_code: 'b', is_purchased: false },
				'19': { instance_number: 96, tree_id: '###crusader.smite', requirement_code: '1', is_purchased: true },
				'20': { instance_number: 96, tree_id: '###crusader.stand_tall', requirement_code: '1', is_purchased: true }
			}
		}
	};
}

export function createMockEstate(): EstateData {
	return {
		base_root: {
			wallet: {
				'0': { amount: 12500, type: 'gold' },
				'1': { amount: 4, type: 'bust' },
				'2': { amount: 2, type: 'portrait' },
				'3': { amount: 6, type: 'deed' },
				'4': { amount: 3, type: 'crest' }
			},
			trinkets: { items: {} },
			estate_items: { items: {} },
			endless_wave_highscore: 0,
			tampering: {},
			darkest_dungeon_trinket_unlocks: {}
		}
	};
}

export function createMockTown(): TownData {
	return {
		base_root: {
			buildings: {}
		}
	};
}
