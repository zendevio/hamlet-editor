import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import { acceptedKeys, applies, findingKey, INFORMATIONAL_KINDS, type BaselineEntry, type Context, type Finding } from '../../scripts/overflow-baseline-lib.mjs';

export type { BaselineEntry, Finding } from '../../scripts/overflow-baseline-lib.mjs';
/** Kinds that only record designed behaviour. They never fail the gate. */
const informational = new Set(INFORMATIONAL_KINDS);

/**
 * Runs in the browser. Measures what a user can actually see and click:
 * - clipped-text / clipped-control: content cut by an ancestor that cannot scroll on that axis;
 * - truncated-text: an ellipsis or line clamp unless the nearest title holds the full clipped text;
 * - text-spill: text painted outside its own box into the surrounding layout;
 * - text-overlap: two text runs painted on top of each other in the same layer;
 * - occluded-control: a hit test on a visible control lands on an unrelated element
 *   (fixed and sticky boxes included); only the active overlay (open dialog or
 *   floating popover, tooltip, select or menu content) may cover other controls;
 *   A control that scrolls clear of the cover is recorded as informational
 *   occluded-until-scrolled after hit testing it at those scroll positions;
 * - unreachable-control: no hit test on a visible control lands anywhere;
 * - horizontal-scroll / document-horizontal-overflow: content wider than its viewport.
 * The viewport ends every clip chain: it clips fixed content and scrolls the rest
 * only on the axes a user can scroll. Content that no legal scroll position of a
 * scroll container or the document reveals (above or before the scroll origin,
 * or below a document that cannot scroll) counts as clipped.
 * Floating content whose anchor is scrolled out of view follows that anchor and
 * is measured in the samples where the anchor shows. That exemption is only
 * provisional: the sampler measures the restored state with anchorExemption
 * false, so content that did not come back with its anchor is reported there.
 * Scrolling, by the occlusion retry and by the sampler, moves only the axes a
 * user can scroll: never an overflow: hidden or clip axis (on the root, the body
 * or any element), and nothing outside the open overlay while a scroll lock holds.
 * While a modal dialog is open only the dialog and floating content are measured.
 * With markScrollers, the vertical scrollers the sampler steps are marked and listed.
 */
export function measureOverflow(options: { markScrollers?: boolean; anchorExemption?: boolean } = {}) {
	const findings: Finding[] = [];
	const styles = new Map<Element, CSSStyleDeclaration>();
	const css = (element: Element) => {
		let style = styles.get(element);
		if (!style) styles.set(element, style = getComputedStyle(element));
		return style;
	};
	const clips = (value: string) => value === 'hidden' || value === 'clip';
	const scrolls = (value: string) => value === 'auto' || value === 'scroll';

	// Stable keys: nearest data-testid or landmark, the semantic path below it
	// and the element's own name. Generated ids and nth-child positions never
	// appear; an order index is added only among elements that share a key.
	const anchors = '[data-testid], header, main, nav, aside, footer, [role=dialog], [role=alertdialog], [role=listbox], [data-slot=sidebar], [data-slot=popover-content], [data-slot=tooltip-content], [data-sonner-toast]';
	const segment = (element: Element) => {
		const slot = element.getAttribute('data-slot');
		const role = element.getAttribute('role');
		const testid = element.getAttribute('data-testid');
		if (testid) return `[data-testid=${testid}]`;
		if (element.matches('[role=dialog], [role=alertdialog]')) return 'dialog';
		return element.tagName.toLowerCase() + (slot ? `[${slot}]` : '') + (role ? `(${role})` : '');
	};
	const semantic = (element: Element) => element.hasAttribute('data-slot') || element.hasAttribute('role') || /^(BUTTON|A|LABEL|H[1-6]|LI|TR|TH|TD|INPUT|SELECT|TEXTAREA|FIELDSET|LEGEND|DT|DD)$/.test(element.tagName);
	const interactiveSelector = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=checkbox], [role=combobox], [role=switch], [role=slider], [role=option], [role=menuitem], [role=tab]';
	/** Controls are named by their label; other elements only by their own text. */
	const nameOf = (element: Element) => {
		const own = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(' ');
		const raw = element.getAttribute('aria-label') || (element.matches(interactiveSelector) && element instanceof HTMLElement ? element.innerText : own) || '';
		const text = raw.replace(/\s+/g, ' ').trim();
		return text.length > 32 ? `${text.slice(0, 32)}…` : text;
	};
	const structure = new Map<Element, string>();
	const pathOf = (element: Element) => {
		let path = structure.get(element);
		if (path === undefined) {
			const anchor = element.parentElement?.closest(anchors) ?? null;
			const parts: string[] = [];
			for (let current: Element | null = element.parentElement; current && current !== anchor; current = current.parentElement) {
				if (semantic(current)) parts.unshift(segment(current));
			}
			path = element.hasAttribute('data-testid') ? segment(element) : [anchor ? segment(anchor) : 'body', ...parts, segment(element)].join(' > ');
			structure.set(element, path);
		}
		return path;
	};
	const baseKey = (element: Element) => {
		const name = element.hasAttribute('data-testid') ? '' : nameOf(element);
		return pathOf(element) + (name ? ` "${name}"` : '');
	};
	const keyCache = new Map<Element, string>();
	const identify = (element: Element): string => {
		const cached = keyCache.get(element);
		if (cached) return cached;
		const base = baseKey(element);
		// Repeated rows or cards with one key are told apart by their order
		// among elements with that same key only.
		const path = pathOf(element);
		const scope = element.parentElement?.closest(anchors) ?? document.body;
		const peers = Array.from(scope.querySelectorAll(element.tagName)).filter((other) => other === element || (pathOf(other) === path && baseKey(other) === base));
		const key = peers.length > 1 ? `${base} #${peers.indexOf(element) + 1}` : base;
		keyCache.set(element, key);
		return key;
	};
	// Targets (clippers, occluders, overlapped text) give context; their order index is left out.
	const add = (kind: string, element: Element, detail: string, target?: Element) => findings.push({ kind, element: identify(element), ...(target ? { target: target === document.documentElement ? 'viewport' : baseKey(target) } : {}), detail });

	const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
	const hidden = (element: Element) => !!element.closest('[inert], [aria-hidden=true], [data-testid=h1-proof], .sr-only, [data-removed=true]');
	const visible = (element: Element): element is HTMLElement | SVGElement => {
		if (!(element instanceof HTMLElement || element instanceof SVGElement) || hidden(element)) return false;
		const box = element.getBoundingClientRect();
		if (box.width <= 1 || box.height <= 1) return false;
		for (let current: Element | null = element; current; current = current.parentElement) {
			const style = css(current);
			if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
		}
		return true;
	};

	// The active overlay scope: the open dialog, open floating content
	// (popover, tooltip, select, menu) and the blocking loading overlay. Only
	// these cover other controls by design.
	// The app's loading overlay blocks the whole window while a profile loads
	// and is marked as such; it is matched by that marker, never by position.
	const dialogs = Array.from(document.querySelectorAll('[role=dialog][data-state=open], [role=alertdialog][data-state=open]')).filter(visible);
	const modal = dialogs.at(-1);
	const floating = Array.from(document.querySelectorAll('[data-bits-floating-content-wrapper]'));
	const overlays = [...dialogs, ...floating, ...Array.from(document.querySelectorAll('[data-slot=loading-overlay]')).filter(visible)];
	const inOverlay = (element: Element) => overlays.some((overlay) => overlay.contains(element));

	// What a user can scroll (wheel, keys, scrollbar), as opposed to what a
	// script can. The root's overflow, or the body's when the root's is visible on
	// both axes, applies to the viewport; hidden or clip there stops user
	// scrolling on that axis. A scroll lock (bits-ui sets pointer-events: none
	// and overflow: hidden on body) freezes everything outside the open overlay.
	const html = document.documentElement, body = document.body;
	const viewportSource = css(html).overflowX === 'visible' && css(html).overflowY === 'visible' ? body : html;
	const viewportStyle = css(viewportSource);
	const locked = css(body).pointerEvents === 'none';
	const userAxes = (scroller: Element) => {
		if (locked && !inOverlay(scroller)) return { x: false, y: false };
		if (scroller === document.scrollingElement) {
			return { x: !clips(viewportStyle.overflowX) && scroller.scrollWidth > innerWidth + 1, y: !clips(viewportStyle.overflowY) && scroller.scrollHeight > innerHeight + 1 };
		}
		if (scroller === html || (scroller === body && viewportSource === body)) return { x: false, y: false };
		const style = css(scroller);
		return { x: scrolls(style.overflowX) && scroller.scrollWidth > scroller.clientWidth + 1, y: scrolls(style.overflowY) && scroller.scrollHeight > scroller.clientHeight + 1 };
	};
	/** The scroll offsets a scroller can take (negative in right-to-left or reversed boxes), read by scrolling to both ends and back in this task. */
	const ranges = new Map<Element, { minLeft: number; maxLeft: number; minTop: number; maxTop: number }>();
	const scrollRange = (scroller: Element) => {
		let range = ranges.get(scroller);
		if (!range) {
			const top = scroller.scrollTop, left = scroller.scrollLeft;
			scroller.scrollTo({ top: -1e7, left: -1e7, behavior: 'instant' });
			const minTop = scroller.scrollTop, minLeft = scroller.scrollLeft;
			scroller.scrollTo({ top: 1e7, left: 1e7, behavior: 'instant' });
			range = { minTop, minLeft, maxTop: scroller.scrollTop, maxLeft: scroller.scrollLeft };
			scroller.scrollTo({ top, left, behavior: 'instant' });
			ranges.set(scroller, range);
		}
		return range;
	};

	// Paint layers for text overlap: fixed or sticky boxes and floating content
	// are painted above the flow, so text runs are compared within one layer.
	// Hit tests do not use layers; see the active overlay scope below.
	const layerOf = (element: Element): Element => {
		for (let current: Element | null = element; current; current = current.parentElement) {
			if (current.hasAttribute('data-bits-floating-content-wrapper') || ['fixed', 'sticky'].includes(css(current).position)) return current;
		}
		return document.documentElement;
	};

	// The ancestors that clip an element, following the containing-block chain
	// so absolutely and fixed positioned content escapes static ancestors.
	// A scroll axis shows only what its scroller's legal scroll positions reach.
	// A null scroller defers reach to other samples (floating content whose anchor is scrolled away).
	type Clip = { element: Element; left: number; top: number; right: number; bottom: number; x: 'clip' | 'scroll' | 'visible'; y: 'clip' | 'scroll' | 'visible'; scroller: Element | null };
	const clipCache = new Map<Element, Clip[]>();
	const establishesFixedBlock = (style: CSSStyleDeclaration) => style.transform !== 'none' || style.filter !== 'none' || /paint|layout|strict|content/.test(style.contain) || /transform|filter/.test(style.willChange);
	const clippers = (element: Element): Clip[] => {
		const cached = clipCache.get(element);
		if (cached) return cached;
		const result: Clip[] = [];
		let mode = css(element).position;
		const wrapper = element.closest('[data-bits-floating-content-wrapper]');
		for (let parent = element.parentElement; parent; parent = parent.parentElement) {
			const style = css(parent);
			const containing = mode === 'fixed' ? establishesFixedBlock(style) : mode === 'absolute' ? style.position !== 'static' || establishesFixedBlock(style) : true;
			if (!containing) continue;
			const axis = (value: string) => clips(value) ? 'clip' as const : scrolls(value) ? 'scroll' as const : 'visible' as const;
			const x = axis(style.overflowX), y = axis(style.overflowY);
			// The root's overflow, and the body's when propagated, belong to the viewport below.
			const propagated = parent === html || (parent === body && viewportSource === body);
			if (!propagated && (x !== 'visible' || y !== 'visible')) {
				const box = parent.getBoundingClientRect();
				const left = box.left + parent.clientLeft, top = box.top + parent.clientTop;
				result.push({ element: parent, left, top, right: left + parent.clientWidth, bottom: top + parent.clientHeight, x, y, scroller: parent });
			}
			mode = style.position === 'absolute' || style.position === 'fixed' ? style.position : 'static';
		}
		// The viewport closes every chain. Fixed content whose containing block is
		// the viewport never moves with the document, so the viewport clips it.
		// Other content scrolls with the document on each axis a user can scroll
		// (and is sampled at its steps); on a hidden axis the viewport clips it.
		// A scroll lock that hid the body's overflow is measured as unlocked for
		// page content outside the overlay: the same page is measured closed.
		// Floating content (bits-ui, floating-ui autoUpdate) follows its anchor.
		// While that anchor is scrolled out of view the content goes with it, and
		// scrolling the anchor back brings it back: it is measured in the samples
		// where the anchor shows. With the anchor in view the viewport clips it.
		const lockedPage = locked && viewportSource === body && !inOverlay(element);
		const awayWithAnchor = options.anchorExemption !== false && wrapper !== null && anchorHidden(wrapper);
		const viewportAxis = (value: string) => !awayWithAnchor && (mode === 'fixed' || (clips(value) && !lockedPage)) ? 'clip' as const : 'scroll' as const;
		result.push({ element: html, left: 0, top: 0, right: innerWidth, bottom: innerHeight, x: viewportAxis(viewportStyle.overflowX), y: viewportAxis(viewportStyle.overflowY), scroller: awayWithAnchor ? null : document.scrollingElement ?? html });
		clipCache.set(element, result);
		return result;
	};
	/** The anchor of floating content: the element outside it whose aria-controls, aria-describedby or aria-owns names an id inside it. */
	const anchorCache = new Map<Element, boolean>();
	const anchorHidden = (wrapper: Element) => {
		let hiddenAnchor = anchorCache.get(wrapper);
		if (hiddenAnchor === undefined) {
			const ids = new Set([wrapper, ...Array.from(wrapper.querySelectorAll('[id]'))].map((node) => node.id).filter(Boolean));
			const anchor = Array.from(document.querySelectorAll('[aria-controls], [aria-describedby], [aria-owns]')).find((node) => !wrapper.contains(node) &&
				['aria-controls', 'aria-describedby', 'aria-owns'].some((name) => (node.getAttribute(name) ?? '').split(/\s+/).some((id) => ids.has(id))));
			// No known anchor: the content is measured where it is.
			hiddenAnchor = !!anchor && empty(visibleRect(clippers(anchor), anchor.getBoundingClientRect()));
			anchorCache.set(wrapper, hiddenAnchor);
		}
		return hiddenAnchor;
	};
	/** Text is clipped by its own element too, whatever that element's position. */
	const textClippers = (element: Element): Clip[] => {
		const style = css(element);
		if (!clips(style.overflowX) && !clips(style.overflowY) && !scrolls(style.overflowX) && !scrolls(style.overflowY)) return clippers(element);
		const box = element.getBoundingClientRect();
		const left = box.left + element.clientLeft, top = box.top + element.clientTop;
		const axis = (value: string) => clips(value) ? 'clip' as const : scrolls(value) ? 'scroll' as const : 'visible' as const;
		return [{ element, left, top, right: left + element.clientWidth, bottom: top + element.clientHeight, x: axis(style.overflowX), y: axis(style.overflowY), scroller: element }, ...clippers(element)];
	};
	type Rect = { left: number; top: number; right: number; bottom: number };
	const intersect = (a: Rect, b: Rect): Rect => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
	const empty = (rect: Rect) => rect.right - rect.left < 1 || rect.bottom - rect.top < 1;
	/** The part of a rect the user can see at the current scroll positions. */
	const visibleRect = (chain: Clip[], rect: Rect) => chain.reduce((current, clip) => intersect(current, clip), rect);
	/** The first ancestor that permanently cuts the rect, and by how much. */
	const permanentCut = (chain: Clip[], rect: Rect, toleranceX: number, toleranceY: number) => {
		for (const clip of chain) {
			if (clip.right - clip.left < 1 || clip.bottom - clip.top < 1) return null; // collapsed by design
			const cutX = clip.x === 'clip' ? Math.max(clip.left - rect.left, rect.right - clip.right) : 0;
			const cutY = clip.y === 'clip' ? Math.max(clip.top - rect.top, rect.bottom - clip.bottom) : 0;
			if (cutX > toleranceX || cutY > toleranceY) return { clip, cutX: Math.round(Math.max(cutX, 0)), cutY: Math.round(Math.max(cutY, 0)), outOfReach: false };
			const outX = clip.x === 'scroll' && (rect.left < clip.left - toleranceX || rect.right > clip.right + toleranceX);
			const outY = clip.y === 'scroll' && (rect.top < clip.top - toleranceY || rect.bottom > clip.bottom + toleranceY);
			if (outX || outY) {
				// Content outside a scrolling axis is reachable when some legal scroll
				// position shows it (anything beyond the next clip is measured in scroll
				// samples). Content past both ends of the scroll range never shows.
				if (!clip.scroller) return null;
				const range = scrollRange(clip.scroller);
				const scrolledX = clip.scroller.scrollLeft, scrolledY = clip.scroller.scrollTop;
				const reachX = outX ? Math.max(clip.left - (scrolledX - range.minLeft) - rect.left, rect.right - (clip.right + range.maxLeft - scrolledX)) : 0;
				const reachY = outY ? Math.max(clip.top - (scrolledY - range.minTop) - rect.top, rect.bottom - (clip.bottom + range.maxTop - scrolledY)) : 0;
				if (reachX > toleranceX || reachY > toleranceY) return { clip, cutX: Math.round(Math.max(reachX, 0)), cutY: Math.round(Math.max(reachY, 0)), outOfReach: true };
				return null;
			}
		}
		return null;
	};
	const cutDetail = (cut: { cutX: number; cutY: number; outOfReach: boolean }) => `${cut.outOfReach ? 'outside the scrollable area' : 'cut'} by ${cut.cutX}px horizontally and ${cut.cutY}px vertically`;

	const roots = modal ? [modal, ...floating] : [document.body];
	const coveredByOverlay = (hit: Element, control: Element) => overlays.some((overlay) => overlay.contains(hit) && !overlay.contains(control));
	const inScope = (element: Element) => roots.some((root) => root.contains(element));
	const elements = Array.from(document.body.querySelectorAll('*')).filter((element) => inScope(element) && visible(element));
	const interactive = elements.filter((element) => element.matches(interactiveSelector) && css(element).pointerEvents !== 'none');

	// Controls cut by an ancestor that cannot scroll on that axis.
	const clippedControls = new Set<Element>();
	for (const control of interactive) {
		const cut = permanentCut(clippers(control), control.getBoundingClientRect(), 2, 2);
		if (cut) {
			clippedControls.add(control);
			add('clipped-control', control, cutDetail(cut), cut.clip.element);
		}
	}

	// Text runs: clipping, truncation, spill and overlap.
	type Run = { element: HTMLElement; rects: Rect[]; layer: Element };
	const runs: Run[] = [];
	for (const element of elements) {
		if (!(element instanceof HTMLElement) || element.closest('svg, textarea, select, option, script, style')) continue;
		const nodes = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
		if (!nodes.length) continue;
		if (/[\uFFFD\u25A1]/u.test(element.textContent ?? '')) add('possible-missing-glyph', element, 'Explicit replacement or tofu character in text; inspect font rendering.');
		const style = css(element);
		const fontSize = parseFloat(style.fontSize) || 12;
		// Line boxes include the font's full ascent and descent, which can exceed
		// a tight line height without any visible ink being cut.
		const toleranceY = Math.max(4, fontSize * 0.25);
		const rects: Rect[] = [];
		for (const node of nodes) {
			const range = document.createRange();
			range.selectNodeContents(node);
			rects.push(...Array.from(range.getClientRects()).filter((rect) => rect.width > 0.5 && rect.height > 0.5));
		}
		if (!rects.length) continue;
		const control = element.closest(interactiveSelector);
		let reported = false;
		for (const rect of rects) {
			const cut = permanentCut(textClippers(element), rect, 2, toleranceY);
			if (!cut) continue;
			if (control && clippedControls.has(control) && cut.clip.element.contains(control)) { reported = true; break; }
			const clipStyle = css(cut.clip.element);
			const ellipsis = cut.cutX > 0 && clipStyle.textOverflow === 'ellipsis';
			const clamp = cut.cutY > 0 && (clipStyle as CSSStyleDeclaration & { webkitLineClamp?: string }).webkitLineClamp !== undefined && !['none', ''].includes((clipStyle as CSSStyleDeclaration & { webkitLineClamp?: string }).webkitLineClamp!);
			// The nearest title is the one a pointer shows (an empty one hides any
			// ancestor's). It exposes the text only if it holds all of it.
			const title = normalize(element.closest('[title]')?.getAttribute('title') ?? '');
			const titled = !!title && title.includes(normalize(nodes.map((node) => node.textContent).join(' ')));
			const kind = ellipsis || clamp ? (titled ? 'titled-truncation' : 'truncated-text') : 'clipped-text';
			add(kind, element, cutDetail(cut), cut.clip.element);
			reported = true;
			break;
		}
		if (!reported) {
			// Spill: text painted outside its own box, which overflow: visible does not clip.
			let box: Element = element;
			while (css(box).display === 'inline' || css(box).display === 'contents') box = box.parentElement!;
			const own = box.getBoundingClientRect();
			const boxStyle = css(box);
			for (const rect of rects) {
				const spillX = boxStyle.overflowX === 'visible' ? Math.max(own.left - rect.left, rect.right - own.right) : 0;
				const spillY = boxStyle.overflowY === 'visible' ? Math.max(own.top - rect.top, rect.bottom - own.bottom) : 0;
				if (spillX > 2 || spillY > toleranceY) {
					add('text-spill', element, `text extends ${Math.round(Math.max(spillX, 0))}px horizontally and ${Math.round(Math.max(spillY, 0))}px vertically beyond its box`, box === element ? undefined : box);
					break;
				}
			}
		}
		const seen = rects.map((rect) => visibleRect(textClippers(element), rect)).filter((rect) => !empty(rect));
		if (seen.length) runs.push({ element, rects: seen, layer: layerOf(element) });
	}
	for (let index = 0; index < runs.length; index++) {
		const first = runs[index];
		for (const second of runs.slice(index + 1)) {
			if (first.layer !== second.layer || first.element.contains(second.element) || second.element.contains(first.element)) continue;
			const overlap = first.rects.flatMap((a) => second.rects.map((b) => intersect(a, b))).find((rect) => rect.right - rect.left > 2 && rect.bottom - rect.top > 2);
			if (overlap) add('text-overlap', first.element, `text overlaps by ${Math.round(overlap.right - overlap.left)}x${Math.round(overlap.bottom - overlap.top)}px`, second.element);
		}
	}

	// Hit test each visible control at its centre and four inner points. Any
	// unrelated element on top is occlusion, whether in the flow, fixed or
	// sticky, unless it belongs to the active overlay and the control does not.
	type Probe = { skipped: true } | { skipped: false; occluder?: { hit: Element; x: number; y: number }; misses: number; points: number };
	const probe = (control: Element): Probe => {
		const seen = visibleRect(clippers(control), control.getBoundingClientRect());
		if (empty(seen) || seen.right - seen.left < 4 || seen.bottom - seen.top < 4) return { skipped: true };
		const width = seen.right - seen.left, height = seen.bottom - seen.top;
		const points = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].map(([x, y]) => [seen.left + width * x, seen.top + height * y]);
		let misses = 0;
		for (const [x, y] of points) {
			const hit = document.elementFromPoint(x, y);
			if (!hit) { misses++; continue; }
			if (control.contains(hit) || hit.contains(control) || coveredByOverlay(hit, control)) continue;
			return { skipped: false, occluder: { hit, x, y }, misses, points: points.length };
		}
		return { skipped: false, misses, points: points.length };
	};
	/** Ancestors (and the document) a user can scroll, with the axes they can scroll. */
	const scrollersOf = (control: Element) => {
		const result: { element: Element; x: boolean; y: boolean }[] = [];
		for (let parent = control.parentElement; parent && parent !== html; parent = parent.parentElement) {
			const axes = userAxes(parent);
			if (axes.x || axes.y) result.push({ element: parent, ...axes });
		}
		const root = document.scrollingElement;
		const rootAxes = root ? userAxes(root) : { x: false, y: false };
		if (root && (rootAxes.x || rootAxes.y)) result.push({ element: root, ...rootAxes });
		return result;
	};
	/**
	 * Content that scrolls under a box that stays put (a fixed toast, sticky
	 * chrome) is reachable when some scroll position clears it. Measured, not
	 * exempted: the control is scrolled to the start, centre and end of its
	 * scroll containers and hit tested again; every position is then restored.
	 * The restore happens in the same task, before the browser paints.
	 */
	const clearsWhenScrolled = (control: Element) => {
		const scrollers = scrollersOf(control);
		if (!scrollers.length) return null;
		const saved = scrollers.map(({ element }) => [element, element.scrollTop, element.scrollLeft] as const);
		try {
			for (const block of ['start', 'center', 'end'] as const) {
				// Only the axes a user can scroll move (scrollIntoView would also
				// move overflow: hidden ancestors), innermost first.
				for (const { element: scroller, x, y } of scrollers) {
					const isRoot = scroller === document.scrollingElement;
					const outer = scroller.getBoundingClientRect();
					const top = isRoot ? 0 : outer.top + scroller.clientTop, left = isRoot ? 0 : outer.left + scroller.clientLeft;
					const height = isRoot ? innerHeight : scroller.clientHeight, width = isRoot ? innerWidth : scroller.clientWidth;
					const rect = control.getBoundingClientRect();
					const target = block === 'start' ? top : block === 'end' ? top + height - rect.height : top + (height - rect.height) / 2;
					const dx = rect.left < left ? rect.left - left : rect.right > left + width ? rect.right - left - width : 0;
					scroller.scrollBy({ top: y ? rect.top - target : 0, left: x ? dx : 0, behavior: 'instant' });
				}
				clipCache.clear();
				anchorCache.clear();
				const result = probe(control);
				if (!result.skipped && !result.occluder && result.misses < result.points) return block;
			}
			return null;
		} finally {
			for (const [element, top, left] of saved) element.scrollTo({ top, left, behavior: 'instant' });
			clipCache.clear();
			anchorCache.clear();
		}
	};
	for (const control of interactive) {
		if (clippedControls.has(control)) continue;
		const result = probe(control);
		if (result.skipped) continue;
		if (result.occluder) {
			const { hit, x, y } = result.occluder;
			const clears = clearsWhenScrolled(control);
			if (clears) add('occluded-until-scrolled', control, `hit test at ${Math.round(x)},${Math.round(y)} lands on another element; clear when scrolled to the ${clears}`, hit);
			else add('occluded-control', control, `hit test at ${Math.round(x)},${Math.round(y)} lands on another element at every scroll position tried`, hit);
		} else if (result.misses === result.points) add('unreachable-control', control, `no hit test at ${result.points} points lands on any element`);
	}

	// Horizontal scrolling: content wider than a scroll container or the window.
	for (const element of elements) {
		const style = css(element);
		if (!scrolls(style.overflowX) || element.clientWidth < 20) continue;
		const box = element.getBoundingClientRect();
		const right = box.left + element.clientLeft + element.clientWidth;
		let extent = right;
		for (const child of Array.from(element.querySelectorAll('*'))) {
			if (child instanceof HTMLElement && clippers(child)[0]?.element === element && visible(child)) extent = Math.max(extent, child.getBoundingClientRect().right);
		}
		if (extent > right + 2) add('horizontal-scroll', element, `content extends ${Math.round(extent - right)}px beyond a ${element.clientWidth}px viewport`);
	}
	if (document.documentElement.scrollWidth > innerWidth + 2) add('document-horizontal-overflow', document.documentElement, `${document.documentElement.scrollWidth}px document in ${innerWidth}px viewport`);

	// The vertical scrollers the sampler steps: only those a user can scroll.
	const scrollers: { index: number; top: number; left: number; steps: number }[] = [];
	if (options.markScrollers) {
		const root = document.scrollingElement as HTMLElement | null;
		const candidates = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((element) => element !== root &&
			!element.closest('[data-testid=h1-proof], [inert], [aria-hidden=true]') && element.clientHeight > 20 && userAxes(element).y);
		if (root && userAxes(root).y) candidates.push(root);
		candidates.forEach((element, index) => {
			element.dataset.h1OverflowScroll = String(index);
			scrollers.push({ index, top: element.scrollTop, left: element.scrollLeft, steps: Math.ceil(element.scrollHeight / element.clientHeight) });
		});
	}

	const unique = new Map<string, Finding>();
	for (const finding of findings) unique.set(`${finding.kind}|${finding.element}|${finding.target ?? ''}`, unique.get(`${finding.kind}|${finding.element}|${finding.target ?? ''}`) ?? finding);
	return {
		findings: [...unique.values()],
		viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
		language: document.documentElement.lang,
		scope: modal ? 'modal' : 'page',
		scrollers,
		fonts: { status: document.fonts.status, glyphCoverage: 'Only explicit replacement/tofu characters are measurable here. Platform fallback glyph availability needs visual inspection.' }
	};
}

/**
 * Measures a state at its initial position and at every step of each vertical
 * scroll container. Screenshots are written only for samples with gating
 * findings (new or baselined), never attached a second time, unless
 * H1_OVERFLOW_SCREENSHOTS=all asks for a full visual review set.
 * Returns findings that the baseline does not accept.
 */
export async function overflowEvidence(page: Page, info: TestInfo, context: Context, baseline: readonly BaselineEntry[]) {
	// Fonts loaded, finite animations finished and two frames rendered, so
	// components that react to a scroll (select scroll buttons) have settled.
	const settle = () => page.evaluate(async () => {
		await document.fonts.ready;
		await Promise.allSettled(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished));
		await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
	});
	await settle();
	const allShots = process.env.H1_OVERFLOW_SCREENSHOTS === 'all';
	const screenshots: string[] = [];
	const sample = async (position: string, markScrollers = false, anchorExemption = true) => {
		// The detector's own user-scroll rule picks the scrollers to step: an open
		// select, menu or modal locks the page (bits-ui sets pointer-events: none
		// on body), so only containers inside the overlay move then, and a hidden
		// root or body overflow never moves the document.
		const { scrollers, ...measured } = await page.evaluate(measureOverflow, { markScrollers, anchorExemption });
		const result = { position, ...measured };
		if (allShots || result.findings.some((finding) => !informational.has(finding.kind))) {
			const path = info.outputPath(`${context.state}-${position}.png`);
			await page.screenshot({ path, fullPage: true, animations: 'disabled', caret: 'hide' });
			screenshots.push(path.slice(info.outputDir.length + 1));
		}
		return { result, scrollers };
	};
	const initial = await sample('initial', true);
	const samples = [initial.result];
	const scrolls = initial.scrollers;
	try {
		for (const scroll of scrolls) {
			// Step 0 repeats the initial sample unless a prepare step scrolled the container.
			for (let step = scroll.top === 0 ? 1 : 0; step < scroll.steps; step++) {
				await page.locator(`[data-h1-overflow-scroll="${scroll.index}"]`).evaluate((element, index) => { element.scrollTop = index * element.clientHeight; }, step);
				await settle();
				samples.push((await sample(`scroll-${scroll.index}-${step}`)).result);
			}
			await page.locator(`[data-h1-overflow-scroll="${scroll.index}"]`).evaluate((element, saved) => { element.scrollTop = saved.top; element.scrollLeft = saved.left; }, scroll);
		}
	} finally {
		await page.evaluate(() => document.querySelectorAll('[data-h1-overflow-scroll]').forEach((element) => element.removeAttribute('data-h1-overflow-scroll')));
	}
	// The restored state, settled, measured with no anchor exemption. Floating
	// content excused in a sample because its anchor was scrolled away must be
	// back in view now that every scroll position (and with it the anchor) is
	// back; content left stranded is clipped here. Content whose anchor was
	// hidden from the start is also measured where it is.
	await settle();
	samples.push((await sample('restored', false, false)).result);
	const nativeSelects = await page.locator('select').evaluateAll((elements) => elements.map((node) => {
		const element = node as HTMLSelectElement;
		return { id: element.id, value: element.value, options: Array.from(element.options).map((option) => ({ value: option.value, label: option.label })) };
	}));

	const accepted = baseline.filter((entry) => applies(entry, context));
	const acceptedKeysForRun = acceptedKeys(baseline, context);
	const found = new Map<string, Finding & { samples: string[] }>();
	for (const { position, findings } of samples) {
		for (const finding of findings) {
			const key = findingKey(finding);
			const existing = found.get(key);
			if (existing) existing.samples.push(position);
			else found.set(key, { ...finding, samples: [position] });
		}
	}
	const all = [...found.values()];
	const gating = all.filter((finding) => !informational.has(finding.kind));
	const unexpected = gating.filter((finding) => !acceptedKeysForRun.has(findingKey(finding)));
	const stale = accepted.filter((entry) => !found.has(findingKey(entry)));
	const report = {
		...context, gate: { unexpected: unexpected.length, baselined: gating.length - unexpected.length, informational: all.length - gating.length, staleBaseline: stale.length },
		unexpected, baselined: gating.filter((finding) => acceptedKeysForRun.has(findingKey(finding))), informational: all.filter((finding) => informational.has(finding.kind)),
		staleBaseline: stale, screenshots, samples: samples.map(({ findings: _, ...rest }) => rest), nativeSelects, aria: await page.locator('body').ariaSnapshot()
	};
	await writeFile(info.outputPath(`${context.state}.json`), JSON.stringify(report, null, '\t') + '\n');
	for (const entry of stale) info.annotations.push({ type: 'overflow-stale-baseline', description: findingKey(entry) });
	return unexpected;
}
