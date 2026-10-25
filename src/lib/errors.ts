import type { MessageDescriptor } from './i18n/messages.generated.js';

/** Shared by logic and renderers; values stay untranslated until render. */
export type { MessageDescriptor } from './i18n/messages.generated.js';
export type ErrorParams = Readonly<Record<string, string | number>>;

export const errorContracts = {
	io_error: { id: 'error.io_error', params: [] },
	lock_failed: { id: 'error.lock_failed', params: [] },
	profile_invalid: { id: 'error.profile_invalid', params: ["path"] },
	not_directory: { id: 'error.not_directory', params: ["path"] },
	directory_read: { id: 'error.directory_read', params: ["path"] },
	directory_entry: { id: 'error.directory_entry', params: [] },
	file_read: { id: 'error.file_read', params: ["path"] },
	save_inspect: { id: 'error.save_inspect', params: [] },
	path_inspect: { id: 'error.path_inspect', params: ["path"] },
	symlink_save: { id: 'error.symlink_save', params: ["path"] },
	save_fingerprint: { id: 'error.save_fingerprint', params: ["path"] },
	dson_decode: { id: 'error.dson_decode', params: [] },
	core_save_decode: { id: 'error.core_save_decode', params: ["name"] },
	save_encode: { id: 'error.save_encode', params: ["name"] },
	upgrade_ambiguous: { id: 'error.upgrade_ambiguous', params: ["previous", "name"] },
	upgrade_tree_missing: { id: 'error.upgrade_tree_missing', params: [] },
	upgrade_hash_invalid: { id: 'error.upgrade_hash_invalid', params: [] },
	upgrade_unresolved: { id: 'error.upgrade_unresolved', params: [] },
	upgrade_unknown: { id: 'error.upgrade_unknown', params: ["name"] },
	names_not_loaded: { id: 'error.names_not_loaded', params: [] },
	names_changed: { id: 'error.names_changed', params: [] },
	profile_not_loaded_with_names: { id: 'error.profile_not_loaded_with_names', params: [] },
	save_changed_during_load: { id: 'error.save_changed_during_load', params: [] },
	save_stale: { id: 'error.save_stale', params: [] },
	profile_data_invalid: { id: 'error.profile_data_invalid', params: [] },
	save_filename_invalid: { id: 'error.save_filename_invalid', params: ["name"] },
	save_not_decoded: { id: 'error.save_not_decoded', params: ["name"] },
	save_create_refused: { id: 'error.save_create_refused', params: ["name"] },
	relative_path_invalid: { id: 'error.relative_path_invalid', params: ["path"] },
	save_path_symlink: { id: 'error.save_path_symlink', params: ["path"] },
	save_target_invalid: { id: 'error.save_target_invalid', params: ["path"] },
	save_parent_invalid: { id: 'error.save_parent_invalid', params: ["path"] },
	transaction_conflict: { id: 'error.transaction_conflict', params: ["path"] },
	transaction_stage: { id: 'error.transaction_stage', params: [] },
	transaction_io: { id: 'error.transaction_io', params: ["path"] },
	transaction_rollback: { id: 'error.transaction_rollback', params: ["recoveryPath"] },
	profile_id_invalid: { id: 'error.profile_id_invalid', params: [] },
	app_data_path: { id: 'error.app_data_path', params: [] },
	backup_empty: { id: 'error.backup_empty', params: [] },
	backup_manifest_encode: { id: 'error.backup_manifest_encode', params: [] },
	backups_create: { id: 'error.backups_create', params: [] },
	backup_create: { id: 'error.backup_create', params: ["path"] },
	backup_rollback: { id: 'error.backup_rollback', params: ["recoveryPath"] },
	backup_incomplete: { id: 'error.backup_incomplete', params: ["path"] },
	backups_read: { id: 'error.backups_read', params: [] },
	steam_restore_blocked: { id: 'error.steam_restore_blocked', params: [] },
	game_backup_empty: { id: 'error.game_backup_empty', params: [] },
	backup_wrong_profile: { id: 'error.backup_wrong_profile', params: [] },
	legacy_backup_wrong_profile: { id: 'error.legacy_backup_wrong_profile', params: [] },
	backup_manifest_mismatch: { id: 'error.backup_manifest_mismatch', params: [] },
	restore_backup_empty: { id: 'error.restore_backup_empty', params: [] },
	backups_open: { id: 'error.backups_open', params: ["path"] },
	backup_manifest_invalid: { id: 'error.backup_manifest_invalid', params: [] },
	backup_manifest_read: { id: 'error.backup_manifest_read', params: [] },
	backup_symlink: { id: 'error.backup_symlink', params: ["path"] },
	game_running: { id: 'error.game_running', params: [] },
	game_data_missing: { id: 'error.game_data_missing', params: ["path"] },
	game_language_unknown: { id: 'error.game_language_unknown', params: ["language"] },
	names_empty: { id: 'error.names_empty', params: [] },
	asset_missing: { id: 'error.asset_missing', params: ["path", "gamePath"] },
	game_path_invalid: { id: 'error.game_path_invalid', params: ["path"] },
	asset_path_invalid: { id: 'error.asset_path_invalid', params: [] },
	asset_read: { id: 'error.asset_read', params: ["path"] },
	game_data_read: { id: 'error.game_data_read', params: ["path"] },
	game_data_parse: { id: 'error.game_data_parse', params: ["path"] },
	roster_capacity_missing: { id: 'error.roster_capacity_missing', params: [] },
	roster_capacity_unsupported: { id: 'error.roster_capacity_unsupported', params: [] },
	mods_read: { id: 'error.mods_read', params: ["path"] },
	workshop_read: { id: 'error.workshop_read', params: ["path"] },
	language_evidence_failed: { id: 'error.language_evidence_failed', params: [] },
	menu_locale_unknown: { id: 'error.menu_locale_unknown', params: ["locale"] },
	menu_update_failed: { id: 'error.menu_update_failed', params: [] },
	settings_io: { id: 'error.settings_io', params: ["folder"] },
	settings_deadline: { id: 'error.settings_deadline', params: [] },
	settings_size: { id: 'error.settings_size', params: [] },
	settings_changed: { id: 'error.settings_changed', params: [] },
	settings_fingerprint: { id: 'error.settings_fingerprint', params: [] },
	settings_live: { id: 'error.settings_live', params: [] },
	profile_not_loaded: { id: 'error.profile_not_loaded', params: [] },
	profile_paths_changed: { id: 'error.profile_paths_changed', params: [] },
	profile_stale: { id: 'error.profile_stale', params: [] },
	save_game_running: { id: 'error.save_game_running', params: [] },
	game_detection_uncertain: { id: 'error.game_detection_uncertain', params: [] },
	save_no_changes: { id: 'error.save_no_changes', params: [] },
	game_install_required: { id: 'error.game_install_required', params: [] },
	names_install_empty: { id: 'error.names_install_empty', params: [] },
	unexpected: { id: 'error.unexpected', params: [] },
} as const;
export type ErrorCode = keyof typeof errorContracts;
export interface DecodedError {
	code: string | null;
	params: ErrorParams;
	detail: string;
}
export interface ErrorDescription {
	message: MessageDescriptor;
	detail: string;
	recovery: MessageDescriptor[];
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object';
}
function raw(value: unknown): string {
	try {
		if (typeof value === 'string') return value;
		if (value instanceof Error) return String(value);
		return JSON.stringify(value) ?? String(value);
	} catch { return ''; }
}

function params(value: unknown): ErrorParams {
	if (!record(value) || Array.isArray(value)) return {};
	return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string | number] =>
		typeof entry[1] === 'string' || (typeof entry[1] === 'number' && Number.isFinite(entry[1]))));
}

/** Older backends, nested IPC rejections and malformed values remain displayable.
 * No English diagnostic is interpreted as a protocol code.
 */
export function decodeError(value: unknown): DecodedError {
	const seen = new Set<unknown>();
	function decode(value: unknown, depth: number): DecodedError {
		const fallback = { code: null, params: {}, detail: raw(value) };
		if (depth > 8 || seen.has(value)) return fallback;
		seen.add(value);
		if (typeof value === 'string') {
			try {
				const parsed: unknown = JSON.parse(value);
				if (record(parsed)) return decode(parsed, depth + 1);
			} catch { /* Legacy plain strings are raw diagnostics. */ }
			return fallback;
		}
		if (!record(value)) return fallback;
		if (typeof value.code === 'string' && value.code.trim()) {
			return { code: value.code, params: params(value.params),
				detail: typeof value.detail === 'string' ? value.detail : value.detail == null ? '' : raw(value) };
		}
		// Logic modules throw descriptors rather than Error(English text).
		if (typeof value.id === 'string' && value.id.startsWith('error.')) {
			return { code: value.id.slice(6), params: params(value.params), detail: '' };
		}
		for (const key of ['error', 'cause', 'data', 'message']) {
			if (value[key] === undefined || value[key] === value) continue;
			const nested = decode(value[key], depth + 1);
			if (nested.code) {
				const outer = typeof value.detail === 'string' ? value.detail : '';
				return { ...nested, detail: outer && outer !== nested.detail ? [outer, nested.detail].filter(Boolean).join('\n') : nested.detail };
			}
		}
		if (typeof value.detail === 'string' && !value.code) {
			return { code: null, params: typeof value.folder === 'string' ? { folder: value.folder } : {}, detail: value.detail };
		}
		return fallback;
	}
	try { return decode(value, 0); }
	catch { return { code: null, params: {}, detail: '' }; }
}

/** One mapping owns every protocol error. A missing contract uses safe generic copy. */
export function describeError(value: unknown): ErrorDescription {
	const decoded = decodeError(value);
	const contract = decoded.code && Object.hasOwn(errorContracts, decoded.code)
		? errorContracts[decoded.code as ErrorCode] : undefined;
	const valid = contract && contract.params.every((key) => Object.hasOwn(decoded.params, key) &&
		(typeof decoded.params[key] !== 'string' || decoded.params[key].trim().length > 0));
	const recovery: MessageDescriptor[] = [];
	if (typeof decoded.params.recoveryPath === 'string' && decoded.params.recoveryPath.trim() &&
		(!valid || !(contract.params as readonly string[]).includes('recoveryPath'))) {
		recovery.push({ id: 'error.recovery_files', params: { recoveryPath: decoded.params.recoveryPath } });
	}
	if (typeof decoded.params.backupPath === 'string') {
		recovery.push({ id: 'error.safety_backup', params: { backupPath: decoded.params.backupPath } });
	}
	if (typeof decoded.params.saveFile === 'string') {
		recovery.push({ id: 'error.saveFile', params: { path: decoded.params.saveFile } });
	}
	return {
		message: valid ? { id: contract.id, ...(contract.params.length ? { params: decoded.params } : {}) } as MessageDescriptor
			: { id: 'error.unexpected' },
		detail: valid ? decoded.detail : [decoded.detail, Object.keys(decoded.params).length ? raw(decoded.params) : '']
			.filter(Boolean).join('\n') || raw(value),
		recovery
	};
}

export function isStaleSaveError(value: unknown): boolean {
	return decodeError(value).code === 'save_stale';
}
