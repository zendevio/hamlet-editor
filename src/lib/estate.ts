import { parseInteger } from '#lib/input-validation.js';
import type { EstateData, EstateItem, WalletEntry } from '#lib/types/save-data.js';

export const ESTATE_ITEM_TYPES: Record<string, string> = {
	crimson_court_invitation_A: 'estate_currency',
	crimson_court_invitation_B: 'estate_currency',
	crimson_court_invitation_C: 'estate_currency',
	the_blood: 'estate'
};
// Editor cap leaves over one billion of i32 headroom for subsequent game income.
export const WALLET_MAX = 999_999_999;
const WALLET_TYPES = new Set(['gold', 'bust', 'portrait', 'deed', 'crest', 'shard', 'memory', 'blueprint']);

function nextItemKey(items: Record<string, unknown>): string {
	let key = 0;
	while (Object.hasOwn(items, String(key))) key++;
	return String(key);
}

export function updateWallet(estate: EstateData, type: string, input: unknown): boolean {
	const parsed = parseInteger(input, 0, WALLET_MAX);
	if (parsed.error !== undefined || !WALLET_TYPES.has(type)) return false;
	const wallet = estate.base_root.wallet;
	const entry: WalletEntry | undefined = Object.values(wallet).find((item) => item.type === type);
	if (entry) {
		if (entry.amount === parsed.value) return false;
		entry.amount = parsed.value;
	} else {
		wallet[nextItemKey(wallet)] = { type, amount: parsed.value };
	}
	return true;
}

export function updateEstateItem(estate: EstateData, id: string, input: unknown): boolean {
	const parsed = parseInteger(input);
	const type = ESTATE_ITEM_TYPES[id];
	if (parsed.error !== undefined || !type) return false;
	const items = estate.base_root.estate_items.items;
	const entry = Object.values(items).find((item) => (item as EstateItem).id === id) as EstateItem | undefined;
	if (entry) {
		if (entry.amount === parsed.value) return false;
		entry.amount = parsed.value;
	} else {
		items[nextItemKey(items)] = { id, type, amount: parsed.value };
	}
	return true;
}
