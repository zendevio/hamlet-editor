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
export function stripDsonPrefix(id: string): string {
	return id.replace(/^###/, '');
}

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
