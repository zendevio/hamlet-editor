import { IntlMessageFormat } from 'intl-messageformat';

type MessageFormatElement = ReturnType<IntlMessageFormat['getAst']>[number];

const plain = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const accented = 'ÁƁÇÐÉƑĜĤÍĴĶĿḾŃÓṔɊŔŠŢÚṼŴẊÝŽáƀçðéƒĝĥíĵķŀḿńóṕɋŕšţúṽŵẋýž';

/** Edit only parser-located literal ranges. ICU tokens and tag boundaries retain
 * their exact source spelling, including quoting, offsets and selector order. */
export function pseudoMessage(message: string): string {
	const ranges: { start: number; end: number }[] = [];
	function visit(nodes: MessageFormatElement[]) {
		for (const node of nodes) {
			if (node.type === 0 && node.location) ranges.push({ start: node.location.start.offset, end: node.location.end.offset });
			if (node.type === 5 || node.type === 6) Object.values(node.options).forEach((option) => visit(option.value));
			if (node.type === 8) visit(node.children);
		}
	}
	visit(new IntlMessageFormat(message, 'en', undefined, { captureLocation: true }).getAst());
	let result = message;
	for (const { start, end } of ranges.sort((a, b) => b.start - a.start)) {
		const raw = message.slice(start, end);
		const letters = [...raw.matchAll(/[A-Za-z]/g)];
		let extra = letters.length ? Math.round(raw.length * 0.4) : 0;
		let remaining = letters.length;
		const expanded = raw.replace(/[A-Za-z]/g, (letter) => {
			const padding = Math.ceil(extra / remaining--);
			extra -= padding;
			return accented[plain.indexOf(letter)].repeat(1 + padding);
		});
		result = result.slice(0, start) + expanded + result.slice(end);
	}
	return `⟦${result}⟧`;
}

export function pseudoCatalog(english: Readonly<Record<string, string>>): Record<string, string> {
	return Object.fromEntries(Object.entries(english).map(([key, message]) => [key, pseudoMessage(message)]));
}
