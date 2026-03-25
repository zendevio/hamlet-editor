import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** Convert a snake_case identifier to Title Case (e.g. "quick_reflexes" -> "Quick Reflexes"). */
export function snakeToTitle(id: string): string {
	return id
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

/** Strip the ### prefix from a DSON identifier (e.g. "###sanitarium.foo" → "sanitarium.foo"). */
export function stripDsonPrefix(id: unknown): string {
	if (typeof id !== 'string') return String(id ?? '');
	return id.replace(/^###/, '');
}

/** DLC hero classes have different base paths than base game heroes. */
const DLC_HERO_PATHS: Record<string, string> = {
	flagellant: 'dlc/580100_crimson_court/features/flagellant/heroes/flagellant',
	shieldbreaker: 'dlc/702540_shieldbreaker/heroes/shieldbreaker',
	musketeer: 'dlc/445700_musketeer/heroes/musketeer'
};

/** Get the relative portrait path for a hero class (handles DLC classes). */
export function getPortraitPath(heroClass: string): string {
	const base = DLC_HERO_PATHS[heroClass] ?? `heroes/${heroClass}`;
	return `${base}/${heroClass}_A/${heroClass}_portrait_roster.png`;
}

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
