import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const server = await createServer({
	configFile: false,
	cacheDir: 'node_modules/.vite/frontend-safety-tests',
	plugins: [svelte({ configFile: false })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false },
	appType: 'custom', logLevel: 'error'
});
after(() => server.close());
const load = (name) => server.ssrLoadModule(`/src/lib/${name}.ts`);
const store = await load('stores/save-data.svelte');
const inputs = await load('input-validation');
const estate = await load('estate');
const raid = await load('raid');
const districts = await load('districts');
const safety = await load('hero-safety');
const { createSaveWorkflow, createUnsavedGuard } = await load('save-workflow');
const reference = JSON.parse(await readFile(new URL('./fixtures/safety-reference.json', import.meta.url), 'utf8'));
let fixture;
beforeEach(() => {
	fixture = structuredClone(reference);
	store.resetSaveData();
	for (const [name, value] of Object.entries(fixture)) {
		const method = `load${name[0].toUpperCase()}${name.slice(1)}`;
		if (typeof store[method] === 'function') store[method](value);
	}
});
const invalidAmounts = ['', ' ', null, undefined, NaN, Infinity, -1, '-1', 1.5, '1.5', '1abc', '1e3', '0x10', 2147483648, {}, true];

test('one integer parser rejects coercion, truncation, nonfinite and i32 overflow', () => {
	for (const value of invalidAmounts) assert.ok(inputs.parseInteger(value).error, String(value));
	for (const value of [0, 2147483647, ' 42 ']) assert.equal(inputs.parseInteger(value).value, Number(value));
	assert.ok(inputs.parseInteger(0, 1).error);
	assert.ok(inputs.parseInteger(7, 0, 6).error);
});

test('hero names trim, accept Unicode and reject controls, blank and over 32 characters', () => {
	assert.equal(inputs.validateHeroName('  Réynauld  ').value, 'Réynauld');
	assert.equal(inputs.validateHeroName('勇'.repeat(32)).value.length, 32);
	assert.equal([...inputs.validateHeroName('😀'.repeat(32)).value].length, 32);
	for (const name of ['', '  ', 'x'.repeat(33), 'bad\0name', 'bad\nname', '\tname', 'a\u007fb', 'a\u0085b', 'a\u200bb', 'a\u2028b']) {
		assert.ok(inputs.validateHeroName(name).error, JSON.stringify(name));
	}
	const original = store.getHeroRawData('34').actor.name;
	assert.ok(store.setHeroName('34', 'bad\0name'));
	assert.equal(store.getHeroRawData('34').actor.name, original);
	assert.equal(store.hasDirtyFiles(), false);
	assert.equal(store.setHeroName('34', '  New Name '), null);
	assert.equal(store.getHeroRawData('34').actor.name, 'New Name');
});

test('wallet creates missing types and blueprints use wallet, preserving other entries', () => {
	const root = fixture.estate.base_root;
	assert.equal(root.wallet['7'].type, 'blueprint');
	assert.equal(root.wallet['7'].amount, 1);
	const beforeItems = structuredClone(root.estate_items);
	assert.equal(estate.updateWallet(fixture.estate, 'blueprint', 9), true);
	assert.equal(root.wallet['7'].amount, 9);
	assert.deepEqual(root.estate_items, beforeItems);
	delete root.wallet['0'];
	assert.equal(estate.updateWallet(fixture.estate, 'gold', 2147483647), true);
	assert.equal(Object.values(root.wallet).find((v) => v.type === 'gold').amount, 2147483647);
	assert.equal(estate.updateWallet(fixture.estate, 'unknown', 7), false);
});

test('estate creates invitations A and C and blood with verified item types without overwriting B', () => {
	for (const [id, type] of Object.entries(estate.ESTATE_ITEM_TYPES)) {
		const data = structuredClone(fixture.estate);
		for (const [key, value] of Object.entries(data.base_root.estate_items.items)) {
			if (value.id === id) delete data.base_root.estate_items.items[key];
		}
		assert.equal(estate.updateEstateItem(data, id, 12), true);
		const item = Object.values(data.base_root.estate_items.items).find((v) => v.id === id);
		assert.deepEqual(item, { id, type, amount: 12 });
	}
	assert.equal(estate.updateEstateItem(fixture.estate, 'blueprint', 9), false);
});

test('invalid currency, item, raid and hero values never mutate or mark dirty', () => {
	const before = JSON.stringify(store.getSaveData().roster);
	const estateBefore = JSON.stringify(store.getSaveData().estate);
	const raidBefore = JSON.stringify(store.getSaveData().raid);
	for (const value of invalidAmounts) {
		store.setWalletAmount('gold', value);
		store.setEstateItemAmount('the_blood', value);
		store.setRaidHungerBuffer(value);
		store.setRaidItemAmount('0', value);
		store.setHeroHp('34', value);
		store.setHeroStress('34', value);
		store.setHeroLevel('34', value);
		store.setHeroWeaponRank('34', value);
		store.setHeroArmourRank('34', value);
		store.setHeroStatus('34', value);
	}
	assert.equal(JSON.stringify(store.getSaveData().roster), before);
	assert.equal(JSON.stringify(store.getSaveData().estate), estateBefore);
	assert.equal(JSON.stringify(store.getSaveData().raid), raidBefore);
	assert.equal(store.hasDirtyFiles(), false);
});

test('raid updates verified root torchlight and party hunger, leaving inventory structure untouched', () => {
	const { base_root: root } = fixture.raid;
	assert.equal(root.torchlight, 100);
	assert.equal(root.party.hunger_room_buffer, -12);
	assert.equal('scoutChance_all' in root.party, false);
	assert.equal(raid.updateTorchlight(fixture.raid, 75.5), true);
	assert.equal(root.torchlight, 75.5);
	for (const value of [NaN, null, '75', -1, 101, Infinity]) assert.equal(raid.updateTorchlight(fixture.raid, value), false);
	assert.equal(raid.updateHungerBuffer(fixture.raid, 3), true);
	assert.equal(root.party.hunger_room_buffer, 3);
	assert.equal('torchlight' in root.party, false);
	assert.equal('hunger_room_buffer' in root.party.inventory, false);
	assert.equal(raid.updateRaidAmount(fixture.raid, '0', 2147483647), true);
	assert.equal(root.party.inventory.items['0'].amount, 2147483647);
	assert.equal(raid.updateRaidAmount(fixture.raid, 'missing', 1), false);
	store.swapPartyPositions(NaN, 1);
	assert.equal(store.hasDirtyFiles(), false);
});

test('abandon clears game pointers, returns living party to town, releases treatment and schedules deletion; discard restores all', () => {
	fixture.game.base_root.inraid = true;
	store.loadGame(fixture.game);
	store.setGameInRaid(true);
	store.getHeroRawData('96')['roster.status'] = 3;
	store.getHeroRawData('96').actor.current_hp = 0;
	const before = structuredClone({ game: fixture.game, roster: fixture.roster, raid: fixture.raid, town: fixture.town });
	store.loadRoster(fixture.roster);
	assert.equal(store.abandonRaid(), null);
	const data = store.getDirtyData();
	assert.deepEqual(data._deleted, ['persist.raid.json']);
	assert.equal(data['persist.game.json'].base_root.inraid, false);
	assert.equal(data['persist.game.json'].base_root.raid_save, '');
	assert.equal(data['persist.game.json'].base_root.raiddungeon, 'none');
	for (const guid of ['1', '34', '48']) {
		const hero = store.getHeroRawData(guid);
		assert.equal(hero['roster.status'], 0);
		assert.equal(hero['roster.before_on_start_town_visit_status'], 0);
		assert.equal(hero['roster.building_name'], '');
	}
	assert.equal(store.getHeroRawData('96')['roster.status'], 3);
	assert.equal(store.getSaveData().raid, null);
	assert.equal(data['persist.raid.json'], undefined);
	assert.equal(store.getTreatmentSlots().some(({ slot }) => [1,34,48,96].includes(slot.hero)), false);
	store.discardAllChanges();
	for (const key of ['game','raid','roster','town']) assert.deepEqual(store.getSaveData()[key], before[key]);
	assert.equal(store.getSaveData().gameInRaid, true);
	assert.equal(store.hasDirtyFiles(), false);
});

test('abandon refuses incomplete data and no-op setters never dirty unchanged files', () => {
	store.setWalletAmount('gold', fixture.estate.base_root.wallet['0'].amount);
	store.setRaidTorchlight(100);
	store.setDistrictBuilt('bank', false);
	assert.equal(store.hasDirtyFiles(), false);
	store.resetSaveData();
	assert.match(store.abandonRaid(), /must be loaded/);
	assert.deepEqual(store.getDirtyData(), {});
});

test('districts enumerate saved keys and built state, preserve buffs and never invent entries', () => {
	const saved = districts.readDistricts(fixture.town);
	assert.equal(saved.length, 16);
	assert.equal(saved.filter((v) => v.built).length, 4);
	assert.equal(saved.find((v) => v.id === 'geologic_studyhall').built, true);
	const buffs = structuredClone(fixture.town.base_root.districts.buildings.granary.buffs);
	assert.equal(districts.updateDistrict(fixture.town, 'granary', true), true);
	assert.deepEqual(fixture.town.base_root.districts.buildings.granary.buffs, buffs);
	assert.equal(districts.updateDistrict(fixture.town, 'district_bank', true), false);
	assert.equal('district_bank' in fixture.town.base_root.districts.buildings, false);
	assert.deepEqual(districts.readDistricts(null), []);
});

function unreferenced() {
	const root = store.getHeroRawData('34');
	root['roster.status'] = 0; root['roster.building_name'] = '';
	store.loadTown({ base_root: { buildings: {} } });
	store.loadRaid({ base_root: { party: { heroes: [] } } });
	store.loadUpgrades({ base_root: { purchases: {} } });
	store.loadGame({ base_root: { inraid: false } });
	store.loadCampaignLog({ base_root: {} });
	store.loadProgression({ base_root: {} });
	store.getSaveData().roster.base_root.last_party.last_party_guids = [];
}

test('dismiss blocks treatment, current party, last party, upgrade, campaign and progression references without any changes', () => {
	assert.match(store.dismissHero('34'), /treatment/);
	unreferenced();
	const cases = [
		[() => { store.getSaveData().raid.base_root.party.heroes = [34]; }, /raid party/],
		[() => { store.getSaveData().roster.base_root.last_party.last_party_guids = [34]; }, /last party/],
		[() => { store.getSaveData().upgrades.base_root.purchases['0'] = { instance_number: 34 }; }, /upgrade/],
		[() => { store.loadCampaignLog({ base_root: { chapters: { 1: { heroes: { 0: { guid: 34 } } } } } }); }, /Other save/],
		[() => { store.loadProgression({ base_root: { completed_plot_quests_data: { 0: { heroes: { 0: { guid: 34, survived: false } } } } } }); }, /Other save/]
	];
	for (const [setup, pattern] of cases) {
		unreferenced(); setup();
		const before = JSON.stringify(store.getSaveData().roster);
		assert.match(store.dismissHero('34'), pattern);
		assert.equal(JSON.stringify(store.getSaveData().roster), before);
		assert.equal(store.hasDirtyFiles(), false);
	}
});

test('dismiss succeeds only for an unreferenced hero and increments a valid counter', () => {
	unreferenced();
	const count = store.getSaveData().roster.base_root.dismissed_hero_count;
	assert.equal(store.dismissHero('34'), null);
	assert.equal(store.getHeroRawData('34'), null);
	assert.equal(store.getSaveData().roster.base_root.dismissed_hero_count, count + 1);
	assert.deepEqual([...store.getSaveData().dirtyFiles], ['persist.roster.json']);
});

test('unverified revival is blocked in town and raid with no writes, including generic status transition', () => {
	assert.equal(fixture.progression.base_root.completed_plot_quests_data['2'].heroes['3'].survived, false);
	const hero = store.getHeroRawData('34');
	hero['roster.status'] = 3;
	for (const active of [false, true]) {
		store.setGameInRaid(active);
		assert.match(store.reviveHero('34'), /unverified|unavailable/);
		store.setHeroStatus('34', 0);
		assert.equal(hero['roster.status'], 3);
		assert.deepEqual(store.getDirtyData(), {});
	}
});

test('curse states never appear in add picker or add through store; changing one existing stage preserves metadata', () => {
	const hero = store.getHeroRawData('34');
	for (const id of Object.keys(hero.quirks).filter(safety.isCurseQuirk)) delete hero.quirks[id];
	const quirk = { is_locked: true, mission_count: 7 };
	for (const id of safety.CURSE_STATES) {
		assert.equal(safety.canPickQuirk(id), false);
		store.addHeroQuirk('34', id, quirk);
		assert.equal(safety.changeCurseState(hero, id), false);
	}
	assert.equal(store.hasDirtyFiles(), false);
	hero.quirks.disease_vampire_passive = quirk;
	store.setHeroCurseState('34', 'disease_vampire_crave');
	assert.deepEqual(Object.keys(hero.quirks).filter(safety.isCurseQuirk), ['disease_vampire_crave']);
	assert.deepEqual(hero.quirks.disease_vampire_crave, quirk);
	hero.quirks.disease_vampire_wasting = quirk;
	assert.equal(safety.changeCurseState(hero, 'disease_vampire_blood_lust'), false);
});

test('living HP cannot be zero; dead HP can, and invalid status/ranks/level do not mutate', () => {
	store.setHeroHp('34', 0);
	assert.ok(store.getHeroRawData('34').actor.current_hp >= 1);
	assert.equal(store.hasDirtyFiles(), false);
	store.setHeroHp('34', 1);
	assert.equal(store.getHeroRawData('34').actor.current_hp, 1);
	store.getHeroRawData('34')['roster.status'] = 3;
	store.setHeroHp('34', 0);
	assert.equal(store.getHeroRawData('34').actor.current_hp, 0);
});

function workflow(overrides = {}) {
	const calls = [];
	let issues = [];
	const options = {
		blocked: () => null, validate: () => issues,
		confirm: async () => 'cancel',
		backup: async () => { calls.push('backup'); },
		write: async () => { calls.push('write'); },
		saved: () => { calls.push('saved'); },
		failed: (error) => { calls.push(String(error)); },
		busy: (value) => { calls.push(`busy:${value}`); },
		...overrides
	};
	return { calls, setIssues: (value) => { issues = value; }, save: createSaveWorkflow(options) };
}

test('Save & Close continuation follows the same validation, fixes and backup as normal Save', async () => {
	const w = workflow({ confirm: async () => 'fix' });
	w.setIssues([{ severity: 'error', fix: () => { w.calls.push('fix'); w.setIssues([]); } }]);
	if (await w.save()) w.calls.push('close');
	assert.deepEqual(w.calls, ['busy:true', 'fix', 'backup', 'write', 'saved', 'busy:false', 'close']);
});

test('cancel, blocking errors, failed backup/save and changed path never continue or clear dirty data', async () => {
	for (const kind of ['cancel', 'error', 'backup', 'write', 'path', 'game-after-backup']) {
		let confirmations = 0;
		let blocked = kind === 'path';
		const w = workflow({
			blocked: () => blocked ? 'Paths changed or game running' : null,
			confirm: async () => ++confirmations === 1 && kind === 'error' ? 'save' : 'cancel',
			backup: async () => {
				if (kind === 'backup') throw new Error('Backup failed');
				if (kind === 'game-after-backup') blocked = true;
			},
			write: async () => { if (kind === 'write') throw new Error('Write failed'); }
		});
		if (['cancel', 'error'].includes(kind)) w.setIssues([{ severity: 'error' }]);
		if (await w.save()) w.calls.push('close');
		assert.equal(w.calls.includes('saved'), false, kind);
		assert.equal(w.calls.includes('close'), false, kind);
	}
});

test('warning-only Save Anyway is allowed and concurrent saves cannot duplicate a write', async () => {
	let finishBackup;
	const w = workflow({ confirm: async () => 'save', backup: () => new Promise((resolve) => { finishBackup = resolve; }) });
	w.setIssues([{ severity: 'warning' }]);
	const first = w.save();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(await w.save(), false);
	finishBackup();
	assert.equal(await first, true);
	assert.equal(w.calls.filter((v) => v === 'write').length, 1);
});

test('profile and path guard handles Save, Discard, Cancel, failed saves and clean changes before mutation', async () => {
	for (const choice of ['save', 'discard', 'cancel', 'failed', 'clean']) {
		const calls = [];
		const request = createUnsavedGuard({
			hasChanges: () => choice !== 'clean',
			choose: async () => choice === 'failed' ? 'save' : choice,
			save: async () => { calls.push('save-old-profile'); return choice !== 'failed'; },
			discard: () => { calls.push('discard'); }
		});
		await request(async () => { calls.push('change-path-and-load'); });
		assert.deepEqual(calls, {
			save: ['save-old-profile', 'change-path-and-load'], discard: ['discard', 'change-path-and-load'],
			cancel: [], failed: ['save-old-profile'], clean: ['change-path-and-load']
		}[choice]);
	}
});

test('dismiss refuses missing reference files, town slots despite available status, and references from another hero', () => {
	unreferenced();
	store.loadTown({ base_root: { buildings: { abbey: { activities: { prayer: { 0: { hero: 34 } } } } } } });
	assert.match(store.dismissHero('34'), /treatment/);
	unreferenced();
	store.getHeroRawData('1').actor.buff_group = { 0: { source_guid: 34 } };
	assert.match(store.dismissHero('34'), /Other save/);
	assert.equal(store.hasDirtyFiles(), false);
	const roster = store.getSaveData().roster;
	store.resetSaveData(); store.loadRoster(roster);
	assert.match(store.dismissHero('34'), /reference data is missing/);
	assert.equal(store.hasDirtyFiles(), false);
});

test('validation gear repairs mark roster dirty so a pending Save includes them', async () => {
	const { runPreSaveValidation } = await load('validation');
	store.getHeroRawData('34').resolveXp = 0;
	store.getHeroRawData('34').weapon_rank = 4;
	store.getHeroRawData('34').armour_rank = 4;
	const issues = runPreSaveValidation().filter((issue) => issue.category === 'Gear Rank');
	assert.ok(issues.length >= 2);
	for (const issue of issues) issue.fix();
	assert.equal(store.getSaveData().dirtyFiles.has('persist.roster.json'), true);
	assert.equal(store.getHeroRawData('34').weapon_rank, 0);
	assert.equal(store.getHeroRawData('34').armour_rank, 0);
});

test('a pending profile decision cannot be replaced by a second path change', async () => {
	let decide;
	const calls = [];
	const request = createUnsavedGuard({
		hasChanges: () => true,
		choose: () => new Promise((resolve) => { decide = resolve; }),
		save: async () => true, discard: () => calls.push('discard')
	});
	const first = request(async () => calls.push('first'));
	assert.equal(await request(async () => calls.push('second')), false);
	decide('cancel');
	assert.equal(await first, false);
	assert.deepEqual(calls, []);
});
