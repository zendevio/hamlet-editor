<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "#lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="card-header"
	class={cn(
		"flex flex-col gap-1.5 px-6 has-data-[slot=card-action]:flex-row has-data-[slot=card-action]:items-center has-data-[slot=card-action]:justify-between",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
