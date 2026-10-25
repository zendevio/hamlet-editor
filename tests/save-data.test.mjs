import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const server = await createServer({
	configFile: false,
	cacheDir: 'node_modules/.vite/save-data-tests',
	plugins: [svelte({ configFile: false })],
	resolve: { alias: { '#lib': fileURLToPath(new URL('../src/lib', import.meta.url)) } },
	server: { middlewareMode: true, watch: null, ws: false },
	appType: 'custom',
	logLevel: 'error'
});
after(() => server.close());
const store = await server.ssrLoadModule('/src/lib/stores/save-data.svelte.ts');
const { runPreSaveValidation } = await server.ssrLoadModule('/src/lib/validation.ts');
const { createMockRoster } = await server.ssrLoadModule('/src/lib/data/mock.ts');
const { buildingDisplayName } = await server.ssrLoadModule('/src/lib/save-labels.ts');
const { withCurrentProfile } = await server.ssrLoadModule('/src/lib/profiles.ts');

function slot(hero, extra = {}) {
	return { hero, visitsRemaining: hero ? 1 : 0, resident_occupied: -1, is_side_effect_result: false, ...extra };
}
function fixture() {
	const template = Object.values(createMockRoster().base_root.heroes)[0];
	const heroes = {};
	for (const guid of ['1', '48', '34']) {
		const entry = structuredClone(template);
		Object.assign(entry.hero_file_data.raw_data.base_root, {
			'roster.status': 2, 'roster.building_name': '',
			'roster.before_on_start_town_visit_status': 2, weapon_rank: 0, armour_rank: 0
		});
		heroes[guid] = entry;
	}
	store.loadRoster({ base_root: { heroes } });
	store.loadTown({ base_root: { buildings: {
		sanitarium: { activities: {
			treatment: {
				0: slot(1), 1: slot(48, { is_side_effect_result: true }), 2: slot(34),
				quirk_treatment: {
					1: { negative_quirk: { quirk_treatment: 'witness', quirk_treatment_action: 2, extra: 17 } }
				}
			},
			disease_treatment: { 0: slot(0), quirk_treatment: { 0: {} } }
		} },
		abbey: { activities: { prayer: { 2: slot(0, { resident_occupied: 1 }) } } }
	} } });
}
function treatmentIssues() {
	return runPreSaveValidation().filter((issue) => issue.category.id === 'validation.category.treatment');
}
beforeEach(() => { store.resetSaveData(); fixture(); });

test('town slots retain all three occupants, activity, and numeric slot positions', () => {
	assert.deepEqual(store.getHeroesInBuilding('sanitarium').map(({ guid, activityType, slotIndex }) => ({ guid, activityType, slotIndex })), [
		{ guid: '1', activityType: 'treatment', slotIndex: '0' },
		{ guid: '48', activityType: 'treatment', slotIndex: '1' },
		{ guid: '34', activityType: 'treatment', slotIndex: '2' }
	]);
	assert.equal(store.getTreatmentSlots('sanitarium').length, 4);
	assert.deepEqual(treatmentIssues(), []);
});

test('release clears only the matching visit and pending actions and dirties both files', () => {
	store.releaseHeroFromTreatment('48');
	const activity = store.getSaveData().town.base_root.buildings.sanitarium.activities.treatment;
	assert.deepEqual(activity[1], slot(0));
	assert.deepEqual(activity.quirk_treatment[1].negative_quirk, {
		quirk_treatment: '', quirk_treatment_action: 0, extra: 17
	});
	assert.equal(activity[0].hero, 1);
	assert.equal(activity[2].hero, 34);
	assert.equal(store.getSaveData().town.base_root.buildings.abbey.activities.prayer[2].resident_occupied, 1);
	const raw = store.getHeroRawData('48');
	assert.equal(raw['roster.status'], 0);
	assert.equal(raw['roster.before_on_start_town_visit_status'], 0);
	assert.equal(raw['roster.building_name'], '');
	assert.deepEqual(Object.keys(store.getDirtyData()).sort(), ['persist.roster.json', 'persist.town.json']);
	assert.deepEqual(treatmentIssues(), []);
});

test('validation releases a treatment-status hero with no town slot', () => {
	store.getSaveData().town.base_root.buildings.sanitarium.activities.treatment[1].hero = 0;
	const issues = treatmentIssues();
	assert.equal(issues.length, 1);
	issues[0].fix();
	assert.equal(store.getHeroRawData('48')['roster.status'], 0);
	assert.equal(store.getSaveData().dirtyFiles.has('persist.roster.json'), true);
	assert.deepEqual(treatmentIssues(), []);
});

test('validation clears duplicate and stale town references without reviving a dead hero', () => {
	store.getHeroRawData('48')['roster.status'] = 3;
	store.getSaveData().town.base_root.buildings.abbey.activities.prayer[2] = slot(48);
	const issues = treatmentIssues();
	assert.equal(issues.length, 1);
	issues[0].fix();
	assert.equal(store.getHeroRawData('48')['roster.status'], 3);
	assert.equal(store.getTreatmentSlots().some(({ slot }) => slot.hero === 48), false);
	assert.deepEqual(treatmentIssues(), []);
});

test('orphan slot references can be cleared without a roster entry', () => {
	store.getSaveData().town.base_root.buildings.sanitarium.activities.disease_treatment[0] = slot(999);
	const issues = treatmentIssues();
	assert.equal(issues.length, 1);
	issues[0].fix();
	assert.equal(store.getSaveData().town.base_root.buildings.sanitarium.activities.disease_treatment[0].hero, 0);
	assert.deepEqual(treatmentIssues(), []);
});

test('missing town data never offers a destructive treatment auto-fix', () => {
	const roster = structuredClone(store.getSaveData().roster);
	store.resetSaveData();
	store.loadRoster(roster);
	const issues = treatmentIssues();
	assert.equal(issues.length, 1);
	assert.equal(issues[0].fix, undefined);
});

test('upgrades group actual camping_trainer purchases', () => {
	store.loadUpgrades({ base_root: { purchases: {
		0: { instance_number: 0, tree_id: '###camping_trainer.cost', requirement_code: 'a', is_purchased: true }
	} } });
	const groups = store.getBuildingUpgrades();
	assert.equal(groups.length, 1);
	assert.equal(buildingDisplayName(groups[0].buildingName), 'Survivalist');
});

test('current profile survives empty detection and is not duplicated when detected', () => {
	const current = withCurrentProfile([], '/manual/profile_0', 'profile_0', true);
	assert.equal(current[0].profile_id, 'profile_0');
	assert.equal(current[0].has_active_raid, true);
	assert.deepEqual(withCurrentProfile(current, '/manual/profile_0', 'profile_0', false), current);
	assert.deepEqual(withCurrentProfile([], '', '', false), []);
});
