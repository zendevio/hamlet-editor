import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSettingsCopy } from '../scripts/i18n-ratchet.mjs';

const check = (source) => checkSettingsCopy(source, ['settings.selectProfile', 'common.close']);
test('Settings copy ratchet covers expressions, templates, component props and script toasts', () => {
	for (const source of [
		"<span>{profile || 'Select a profile...'}</span>",
		'<span>{`Select ${profile}`}</span>',
		'<DialogContent closeLabel="Close" />',
		'<EmptyState description={"Choose a profile"} />',
		'<Input aria-label="Profile" />',
		'<DialogContent closeLabel="Закрыть" />',
		'<script>toast.error("Could not load profile")</script>',
		'<script>toast("Backup created")</script>',
		"<script>open({ directory: true, title: 'Select save file folder' })</script>",
		"<script>open({ title: `Select ${folder}` })</script>",
		"<script>showPersistentError({ id: 'common.close' }, 'literal detail')</script>",
		"<script>const label = 'Select a profile';</script><p>{label}</p>",
		"<script>let label = $state('Development');</script><p>{label}</p>",
		"{#if true}{@const label = 'Select a profile'}<p>{label}</p>{/if}",
		'<script>toast.error(t("common.close"), { description: `Failed ${path}` })</script>'
	]) assert.throws(() => check(source), /Hardcoded Settings text/);
});
test('Settings copy ratchet allows catalog references, ids, style props and explicit brands', () => {
	check(`<script>toast.error(t('common.close'), { description: String(error) });
		toast(t('common.close'));
		open({ directory: true, title: t('common.close') });
		showPersistentError({ id: 'common.close' }, String(error), 'game-text-load');
		const label = t('common.close');</script>
		{#if true}{@const other = t('common.close')}<p>{other}{label}</p>{/if}
		<DialogContent id="restore-dialog" class="text-sm" closeLabel={t('common.close')}>
			<span>{profile || t('settings.selectProfile')}</span><p>Hamlet Editor</p><p>Steam</p>
		</DialogContent>`);
});
