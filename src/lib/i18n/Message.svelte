<script lang="ts" generics="K extends MessageKey">
	import type { Snippet } from 'svelte';
	import { richMessage, type MessageKey, type MessageParams } from './index.svelte.js';
	import RichParts from './RichParts.svelte';

	let { id, params, emphasis, code, link }: {
		id: K;
		params: MessageParams[K];
		emphasis: Snippet<[Snippet]>;
		code: Snippet<[Snippet]>;
		link: Snippet<[Snippet]>;
	} = $props();
	let parts = $derived(richMessage(id, params));
</script>

<RichParts {parts} {emphasis} {code} {link} />
