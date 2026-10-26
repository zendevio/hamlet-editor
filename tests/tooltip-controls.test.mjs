import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'svelte/compiler';

// Follow rendered snippets as transparent nodes. A trigger with a child snippet
// delegates its element; a default trigger renders its own button.
const buttonExports = {
	button: ['Root', 'Button'], checkbox: ['Root', 'Checkbox'], switch: ['Root', 'Switch'],
	tooltip: ['Trigger', 'TooltipTrigger'], select: ['Trigger', 'SelectTrigger'],
	popover: ['Trigger', 'PopoverTrigger'], dialog: ['Trigger', 'DialogTrigger', 'Close', 'DialogClose'],
	'dropdown-menu': ['Trigger', 'DropdownMenuTrigger'], collapsible: ['Trigger', 'CollapsibleTrigger'],
	sheet: ['Trigger', 'SheetTrigger', 'Close', 'SheetClose'],
	'input-group': ['Button', 'InputGroupButton'],
	sidebar: ['MenuButton', 'SidebarMenuButton', 'Trigger', 'SidebarTrigger', 'Rail', 'SidebarRail',
		'GroupAction', 'SidebarGroupAction', 'MenuAction', 'SidebarMenuAction']
};

function nestedButtons(source) {
	const failures = [];
	const controls = new Set(['button', ...Object.values(buttonExports).flat().filter((name) => !['Root', 'Trigger', 'Close', 'Rail', 'MenuButton', 'MenuAction', 'GroupAction'].includes(name))]);
	const ast = parse(source, { modern: true });
	for (const node of ast.instance?.content?.body ?? []) {
		if (node.type !== 'ImportDeclaration') continue;
		const directory = node.source.value.match(/\/ui\/([^/]+)\/index\.js$/)?.[1];
		const exports = buttonExports[directory] ?? [];
		for (const specifier of node.specifiers) {
			if (specifier.type === 'ImportNamespaceSpecifier') {
				for (const name of exports) controls.add(`${specifier.local.name}.${name}`);
			} else if (exports.includes(specifier.imported?.name)) controls.add(specifier.local.name);
		}
	}
	function visit(node, ancestor = false, snippets = new Map(), active = new Set()) {
		if (!node || typeof node !== 'object') return;
		if (node.type === 'Fragment') {
			const scope = new Map(snippets);
			for (const child of node.nodes) if (child.type === 'SnippetBlock') scope.set(child.expression.name, child);
			for (const child of node.nodes) if (child.type !== 'SnippetBlock') visit(child, ancestor, scope, active);
			return;
		}
		if (node.type === 'RenderTag') {
			const call = node.expression.type === 'ChainExpression' ? node.expression.expression : node.expression;
			const snippet = snippets.get(call.callee?.name);
			if (snippet && !active.has(snippet)) visit(snippet.body, ancestor, snippets, new Set([...active, snippet]));
			return;
		}
		const passedSnippets = node.type === 'Component' ? node.fragment?.nodes?.filter((child) => child.type === 'SnippetBlock') ?? [] : [];
		const customChild = passedSnippets.some((child) => child.expression.name === 'child');
		const button = controls.has(node.name) && !customChild;
		if (button && ancestor) failures.push(node.start);
		for (const child of passedSnippets) visit(child.body, ancestor || button, snippets, active);
		for (const [key, value] of Object.entries(node)) {
			if (['attributes', 'expression', 'instance', 'module', 'css'].includes(key)) continue;
			if (Array.isArray(value)) value.forEach((child) => visit(child, ancestor || button, snippets, active));
			else if (value && typeof value === 'object') visit(value, ancestor || button, snippets, active);
		}
	}
	visit(ast.fragment);
	return failures;
}

test('button wrappers and rendered snippet definitions retain their button ancestry', () => {
	for (const control of ['SidebarMenuButton', 'SidebarTrigger', 'SidebarMenuAction', 'SidebarGroupAction', 'SidebarRail', 'InputGroupButton', 'SheetTrigger']) {
		assert.equal(nestedButtons(`<button><${control} /></button>`).length, 1, control);
		assert.equal(nestedButtons(`<${control}><Button>Bad</Button></${control}>`).length, 1, control);
	}
	assert.equal(nestedButtons('<script>import * as Sidebar from "#lib/components/ui/sidebar/index.js";</script><button><Sidebar.MenuButton /></button>').length, 1);
	assert.equal(nestedButtons('<script>import { SidebarTrigger as Toggle } from "#lib/components/ui/sidebar/index.js";</script><button><Toggle /></button>').length, 1);
	assert.equal(nestedButtons('<button><Button href={undefined}>Bad</Button></button>').length, 1);
	for (const source of [
		'{#snippet action()}<Button>Bad</Button>{/snippet}<button>{@render action()}</button>',
		'{#snippet action()}<Checkbox />{/snippet}<TooltipTrigger>{@render action()}</TooltipTrigger>',
		'{#snippet first()}{@render second()}{/snippet}{#snippet second()}<SidebarTrigger />{/snippet}<Button>{@render first()}</Button>',
		'<button>{#snippet local()}<Button />{/snippet}{@render local()}</button>',
		'{#snippet action()}<Button />{/snippet}<Button>{@render action?.()}</Button>'
	]) assert.equal(nestedButtons(source).length, 1, source);
	assert.equal(nestedButtons('{#snippet unused()}<Button />{/snippet}<button>Good</button>').length, 0);
	assert.equal(nestedButtons('{#snippet action()}<Button>Good</Button>{/snippet}<TooltipTrigger>{#snippet child({ props })}{@render action()}{/snippet}</TooltipTrigger>').length, 0);
});

test('all app controls avoid nested buttons, including UI button wrappers and rendered snippets', async () => {
	assert.equal(nestedButtons('<TooltipTrigger><Button>Bad</Button></TooltipTrigger>').length, 1);
	assert.equal(nestedButtons('<button><Button>Bad</Button></button>').length, 1);
	assert.equal(nestedButtons('<button><Checkbox /></button>').length, 1);
	assert.equal(nestedButtons('<TooltipTrigger>{#snippet child({ props })}<Button {...props}>Good</Button>{/snippet}</TooltipTrigger>').length, 0);
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
			if (entry.isDirectory()) await visit(file);
			else if (entry.name.endsWith('.svelte')) assert.deepEqual(nestedButtons(await readFile(file, 'utf8')), [], file.pathname);
		}
	}
	await visit(new URL('../src/', import.meta.url));
});
