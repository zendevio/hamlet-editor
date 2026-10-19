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
const { runPreSaveValidation } = await load('validation');
const inputs = await load('input-validation');
const estate = await load('estate');
const raid = await load('raid');
const districts = await load('districts');
const safety = await load('hero-safety');
const { createSaveWorkflow, createUnsavedGuard, createGameStoppedObserver } = await load('save-workflow');
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
	for (const name of ['', '  ', 'x'.repeat(33), 'bad\0name', 'bad\nname', '\tname', 'a\u007fb', 'a\u0085b', 'a\u200bb', 'a\u2028b', '###Reynauld', '  ###Estate']) {
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
	assert.equal(estate.updateWallet(fixture.estate, 'gold', estate.WALLET_MAX), true);
	assert.equal(Object.values(root.wallet).find((v) => v.type === 'gold').amount, estate.WALLET_MAX);
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
	assert.deepEqual(Object.entries(fixture.roster.base_root.heroes).filter(([, h]) => h.hero_file_data.raw_data.base_root['roster.before_on_start_town_visit_status'] === 1).map(([guid]) => Number(guid)).sort((a,b) => a-b), [...fixture.raid.base_root.party.heroes].sort((a,b) => a-b));
	fixture.game.base_root.inraid = true;
	fixture.game.base_root.raid_save = '';
	// Expedition status can exist outside party.heroes; this injected hero is not in the raid list.
	fixture.roster.base_root.heroes['44'] = structuredClone(fixture.roster.base_root.heroes['96']);
	fixture.roster.base_root.heroes['44'].hero_file_data.raw_data.base_root['roster.status'] = 1;
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
	for (const guid of ['1', '34', '48', '44']) {
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

const estateTrinketsReference = JSON.parse(await readFile(new URL('./fixtures/estate-trinkets-reference.json', import.meta.url), 'utf8'));
const dismissReference = JSON.parse(await readFile(new URL('./fixtures/dismiss-reference.json', import.meta.url), 'utf8'));
function loadDismissReference() {
	store.resetSaveData();
	store.loadEstate({ base_root: { ...structuredClone(reference.estate.base_root), trinkets: { items: structuredClone(estateTrinketsReference) } } });
	for (const [name, value] of Object.entries(structuredClone(dismissReference))) {
		store[`load${name[0].toUpperCase()}${name.slice(1)}`](value);
	}
}

test('dismiss uses real profile purchases and history, removes live references and supports discard', () => {
	loadDismissReference();
	const data = store.getSaveData();
	assert.equal(Object.keys(data.roster.base_root.heroes).length, 29);
	assert.equal(data.roster.base_root.heroes['36'], undefined);
	assert.equal(Object.values(data.upgrades.base_root.purchases).filter((p) => p.instance_number === 36).length, 0);
	assert.equal((JSON.stringify(data.campaignLog).match(/"guid":36/g) ?? []).length, 4);
	assert.ok(JSON.stringify(data.campaignLog).includes('"guid":44,'));
	const history = JSON.stringify([data.campaignLog, data.progression]);
	// GUID 44 is available, with real upgrade purchases and historical references.
	assert.ok(Object.values(data.upgrades.base_root.purchases).some((p) => p.instance_number === 44));
	const count = data.roster.base_root.dismissed_hero_count;
	const otherPurchases = Object.values(data.upgrades.base_root.purchases).filter((p) => p.instance_number !== 44);
	assert.equal(store.dismissHero('44'), null);
	assert.equal(store.getHeroRawData('44'), null);
	assert.equal(data.roster.base_root.dismissed_hero_count, count + 1);
	assert.deepEqual(Object.values(data.upgrades.base_root.purchases), otherPurchases);
	assert.deepEqual(Object.keys(data.upgrades.base_root.purchases), otherPurchases.map((_, index) => String(index)));
	assert.equal(JSON.stringify([data.campaignLog, data.progression]), history);
	assert.deepEqual(new Set(data.dirtyFiles), new Set(['persist.roster.json', 'persist.upgrades.json']));
	store.discardAllChanges();
	assert.deepEqual(data.roster, dismissReference.roster);
	assert.deepEqual(data.upgrades, dismissReference.upgrades);
});

test('dismiss cleans a real last-party vector after treatment release and blocks live state', () => {
	loadDismissReference();
	assert.match(store.dismissHero('34'), /treatment/);
	store.releaseHeroFromTreatment('34');
	store.clearAllDirty();
	assert.equal(store.dismissHero('34'), null);
	assert.deepEqual(store.getSaveData().roster.base_root.last_party.last_party_guids, [1, 48, -1, -1]);
	assert.deepEqual(store.getSaveData().campaignLog, dismissReference.campaignLog);
	assert.deepEqual(store.getSaveData().progression, dismissReference.progression);
	for (const mode of ['party', 'status', 'raid', 'shape']) {
		loadDismissReference();
		const data = store.getSaveData();
		if (mode === 'party') store.loadRaid(structuredClone(reference.raid));
		if (mode === 'status') store.getHeroRawData('96')['roster.status'] = 1;
		if (mode === 'raid') data.game.base_root.inraid = true;
		if (mode === 'shape') data.roster.base_root.last_party.last_party_guids = {};
		const before = JSON.stringify([data.roster, data.upgrades, data.town]);
		assert.match(store.dismissHero('96'), /raid party|during a raid|unsupported shape/);
		assert.equal(JSON.stringify([data.roster, data.upgrades, data.town]), before);
		assert.equal(store.hasDirtyFiles(), false);
	}
});

test('unverified revival is blocked in town and raid with no writes, including generic status transition', () => {
	assert.equal(fixture.progression.base_root.completed_plot_quests_data['2'].heroes['3'].survived, false);
	const hero = store.getHeroRawData('34');
	hero['roster.status'] = 3;
	for (const active of [false, true]) {
		store.setGameInRaid(active);
		assert.match(store.getRevivalBlockReason(), /unverified|unavailable/);
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

test('dismiss refuses missing live data and treatment slots despite available status', () => {
	loadDismissReference();
	store.getHeroRawData('34')['roster.status'] = 0;
	store.getHeroRawData('34')['roster.building_name'] = '';
	assert.match(store.dismissHero('34'), /treatment/);
	const roster = store.getSaveData().roster;
	store.resetSaveData(); store.loadRoster(roster);
	assert.match(store.dismissHero('96'), /reference data is missing/);
	assert.equal(store.hasDirtyFiles(), false);
});

test('reference level-one heroes keep their higher gear through all automatic fixes', () => {
	loadDismissReference();
	const expected = { Pevrel: 3, Poussin: 3, Gueron: 2, Jubert: 2 };
	for (const [name, rank] of Object.entries(expected)) {
		const hero = store.getHeroes().find((hero) => hero.name === name);
		assert.ok(hero, name);
		assert.equal(hero.resolveLevel, 1, name);
		assert.equal(hero.weaponRank, rank, name);
		assert.equal(hero.armourRank, rank, name);
	}
	const issues = runPreSaveValidation();
	assert.equal(issues.some((issue) => issue.category === 'Gear Rank'), false);
	for (const issue of issues) issue.fix?.();
	for (const [name, rank] of Object.entries(expected)) {
		const hero = store.getHeroes().find((hero) => hero.name === name);
		assert.equal(hero.weaponRank, rank, name);
		assert.equal(hero.armourRank, rank, name);
	}
});

test('all valid gear ranks survive validation and automatic fixes at every hero level', () => {
	const raw = store.getHeroRawData('34');
	for (let level = 0; level <= 6; level++) {
		for (let rank = 0; rank <= 4; rank++) {
			raw.weapon_rank = rank;
			raw.armour_rank = 4 - rank;
			store.setHeroLevel('34', level);
			assert.equal(raw.weapon_rank, rank);
			assert.equal(raw.armour_rank, 4 - rank);
			const issues = runPreSaveValidation();
			assert.equal(issues.some((issue) => issue.category === 'Gear Rank'), false);
			for (const issue of issues) issue.fix?.();
			assert.equal(raw.weapon_rank, rank);
			assert.equal(raw.armour_rank, 4 - rank);
		}
	}
});

test('gear validation rejects invalid indices without destructive automatic fixes', () => {
	const raw = store.getHeroRawData('34');
	for (const rank of [-1, 5, 1.5, NaN, Infinity]) {
		raw.weapon_rank = rank;
		raw.armour_rank = rank;
		const issues = runPreSaveValidation().filter((issue) => issue.category === 'Gear Rank');
		assert.equal(issues.length, 2);
		assert.ok(issues.every((issue) => issue.severity === 'error' && !issue.fix));
		assert.equal(raw.weapon_rank, rank);
		assert.equal(raw.armour_rank, rank);
	}
});

test('gear setters accept the complete range at level zero and reject indices outside it', () => {
	store.setHeroLevel('34', 0);
	for (let rank = 0; rank <= 4; rank++) {
		store.setHeroWeaponRank('34', rank);
		store.setHeroArmourRank('34', rank);
		assert.equal(store.getHeroRawData('34').weapon_rank, rank);
		assert.equal(store.getHeroRawData('34').armour_rank, rank);
	}
	for (const rank of [-1, 5, 1.5, NaN, Infinity]) {
		store.setHeroWeaponRank('34', rank);
		store.setHeroArmourRank('34', rank);
		assert.equal(store.getHeroRawData('34').weapon_rank, 4);
		assert.equal(store.getHeroRawData('34').armour_rank, 4);
	}
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

test('plot raid abandonment is blocked without mutations, including pure data helper', () => {
	const before = JSON.stringify([fixture.game, fixture.raid, fixture.roster, fixture.town]);
	assert.match(store.abandonRaid(), /plot and Courtyard/);
	assert.equal(raid.abandonRaidData(fixture.game, fixture.raid, fixture.roster, fixture.town).size, 0);
	assert.equal(JSON.stringify([fixture.game, fixture.raid, fixture.roster, fixture.town]), before);
	assert.deepEqual(store.getDirtyData(), {});
});

test('estate names share hero validation and invalid input never dirties game data', () => {
	const before = fixture.game.base_root.estatename;
	for (const name of ['###estate', '  ###estate', 'bad\nname', '', 'x'.repeat(33)]) {
		assert.ok(store.setEstateName(name));
		assert.equal(store.getSaveData().game.base_root.estatename, before);
		assert.equal(store.hasDirtyFiles(), false);
	}
	assert.equal(store.setEstateName('  Estate  '), null);
	assert.equal(store.getSaveData().game.base_root.estatename, 'Estate');
});

test('wallet cap leaves income headroom and rejects overflow without mutation', () => {
	for (const value of [estate.WALLET_MAX + 1, 2147483647]) {
		store.setWalletAmount('gold', value);
		assert.equal(store.hasDirtyFiles(), false);
	}
	store.setWalletAmount('gold', estate.WALLET_MAX);
	assert.equal(store.getSaveData().estate.base_root.wallet['0'].amount, estate.WALLET_MAX);
});

test('numeric upgrade hashes are visible raw and cannot be toggled', () => {
	const unknown = { instance_number: 0, tree_id: -123456789, requirement_code: 'a', is_purchased: true };
	const heroUnknown = { ...unknown, instance_number: 44 };
	store.loadUpgrades({ base_root: { purchases: { 0: unknown, 1: heroUnknown } } });
	assert.equal(store.stripDsonPrefix(unknown.tree_id), '-123456789');
	assert.equal(store.getUnknownUpgrades().length, 2);
	assert.deepEqual(store.getBuildingUpgrades(), []);
	store.toggleUpgrade(unknown); store.toggleUpgrade(heroUnknown);
	assert.equal(unknown.is_purchased, true);
	assert.equal(store.hasDirtyFiles(), false);
});

test('game polls mark a loaded profile stale on confirmed running-to-stopped transitions', () => {
	store.loadMockData();
	const observe = createGameStoppedObserver(store.markProfileStale);
	observe({ running: false, uncertain: false });
	assert.equal(store.getSaveData().isStale, false);
	observe({ running: true, uncertain: false });
	observe({ running: false, uncertain: true });
	assert.equal(store.getSaveData().isStale, false);
	observe({ running: false, uncertain: false });
	assert.equal(store.getSaveData().isStale, true);
});


test('dismiss returns every equipped trinket to verified estate entries and discard restores both files', () => {
    loadDismissReference();
    const data = store.getSaveData();
    const items = data.estate.base_root.trinkets.items;
    const before = structuredClone(items);
    const equipped = [structuredClone(items['0']), structuredClone(items['1'])];
    store.getHeroRawData('44').trinkets.items = { 0: equipped[0], 1: equipped[1] };
    store.clearAllDirty();
    const next = Math.max(...Object.keys(items).map(Number)) + 1;
    assert.equal(store.dismissHero('44'), null);
    assert.deepEqual(items[String(next)], equipped[0]);
    assert.deepEqual(items[String(next + 1)], equipped[1]);
    assert.deepEqual(Object.fromEntries(Object.entries(items).slice(0, Object.keys(before).length)), before);
    assert.ok(data.dirtyFiles.has('persist.estate.json'));
    store.discardAllChanges();
    assert.deepEqual(data.estate.base_root.trinkets.items, before);
    assert.deepEqual(Object.values(store.getHeroRawData('44').trinkets.items), equipped);
});

test('dismiss blocks unsupported equipment without mutations and retains the final roster hero', () => {
    loadDismissReference();
    store.getHeroRawData('44').trinkets.items = { 0: { id: 'unverified' } };
    let before = JSON.stringify(store.getSaveData().roster);
    assert.match(store.dismissHero('44'), /Unequip trinkets first/);
    assert.equal(JSON.stringify(store.getSaveData().roster), before);
    assert.equal(store.hasDirtyFiles(), false);
    loadDismissReference();
    const data = store.getSaveData();
    data.roster.base_root.heroes = { 44: data.roster.base_root.heroes['44'] };
    before = JSON.stringify(data.roster);
    assert.match(store.dismissHero('44'), /at least 1 hero/);
    assert.equal(JSON.stringify(data.roster), before);
    assert.equal(store.hasDirtyFiles(), false);
});
