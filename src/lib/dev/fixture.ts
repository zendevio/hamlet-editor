import { createMockRoster, createMockEstate, createMockTown, createMockUpgrades } from '#lib/data/mock.js';

/** Existing dev data, made deterministic for independent mounted runs. */
export function createHarnessProfile() {
	const random = Math.random;
	let seed = 417;
	Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
	try {
		const fixture = {
			'persist.game.json': { base_root: { estatename: 'H1 Estate', inraid: false } },
			'persist.roster.json': createMockRoster(),
			'persist.estate.json': createMockEstate(),
			'persist.town.json': createMockTown(),
			'persist.upgrades.json': createMockUpgrades()
		};
		fixture['persist.estate.json'].base_root.trinkets.items = {
			'0': { id: 'h1_trinket_a', type: 'trinket', amount: 1 },
			'1': { id: 'h1_trinket_b', type: 'trinket', amount: 1 }
		};
		const hero = Object.values(fixture['persist.roster.json'].base_root.heroes)[0];
		hero.hero_file_data.raw_data.base_root.heroClass = 'unknown_mod_class';
		fixture['persist.upgrades.json'].base_root.purchases['21'] = {
			instance_number: 0, tree_id: '###unknown_mod_upgrade', requirement_code: 'opaque', is_purchased: true
		};
		return fixture;
	} finally { Math.random = random; }
}

export function applyFixtureEdits(store: Pick<typeof import('#lib/stores/save-data.svelte.js'), 'getHeroes' | 'setHeroName' | 'addHeroQuirk'>) {
	const hero = store.getHeroes()[0];
	store.setHeroName(hero.guid, 'Backups');
	store.addHeroQuirk(hero.guid, 'unknown_mod_quirk', {
		is_locked: true, is_new: false, mission_count: 0,
		replaces_quirk: 0, replaces_quirk_viewed: false, evolution_duration_remaining: 0
	});
}
