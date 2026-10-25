<script lang="ts">
	import Message from '#lib/i18n/Message.svelte';
	import { formatNumber } from '#lib/i18n/intl.js';
	import { gameTextLocale, resolveTitle } from '#lib/save-labels.js';
	import { RESOLVE_XP_THRESHOLDS } from '#lib/data/constants.js';
	let { level, xp = false }: { level: number; xp?: boolean } = $props();
</script>

<Message id={xp ? 'heroes.resolveXp' : 'heroes.resolve'} params={{ levelText: formatNumber(level), title: resolveTitle(level), xpText: formatNumber(RESOLVE_XP_THRESHOLDS[level]) }}>
	{#snippet code(children)}{@render children()}{/snippet}
	{#snippet link(children)}{@render children()}{/snippet}
	{#snippet emphasis(children)}<span lang={gameTextLocale()}>{@render children()}</span>{/snippet}
</Message>
