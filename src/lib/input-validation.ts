/** DSON integer amounts use a signed 32-bit value. */
export const I32_MAX = 2147483647;

export type NumberResult = { value: number; error?: never } | { error: string; value?: never };

/** Validate the entire input before conversion; never truncate or coerce blanks/null. */
export function parseInteger(input: unknown, min = 0, max = I32_MAX): NumberResult {
	if (
		(typeof input !== 'number' && typeof input !== 'string') ||
		(typeof input === 'string' && !/^-?\d+$/.test(input.trim()))
	) return { error: `Enter a whole number from ${min} to ${max}.` };
	const value = typeof input === 'number' ? input : Number(input.trim());
	if (!Number.isSafeInteger(value) || value < min || value > max) {
		return { error: `Enter a whole number from ${min} to ${max}.` };
	}
	return { value };
}

export function validTorchlight(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

/** Editor limit, matching the existing estate-name limit; counted as Unicode code points. */
export const HERO_NAME_MAX_LENGTH = 32;

export function validateHeroName(input: string): { value: string; error?: never } | { error: string; value?: never } {
	// Test before trimming so leading/trailing control characters cannot slip through.
	if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(input)) {
		return { error: 'Names cannot contain control or invisible formatting characters.' };
	}
	const value = input.trim();
	if (value.startsWith('###')) return { error: 'Names cannot start with ### because it is reserved for save identifiers.' };
	if (!value || [...value].length > HERO_NAME_MAX_LENGTH) {
		return { error: `Enter a name from 1 to ${HERO_NAME_MAX_LENGTH} characters.` };
	}
	return { value };
}
