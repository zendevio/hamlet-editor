<script lang="ts">
	import { Badge } from '#lib/components/ui/badge/index.js';

	let {
		position,
		heroName,
		heroClass
	}: {
		position: number;
		heroName: string | null;
		heroClass: string | null;
	} = $props();
</script>

<div
	class="flex flex-col items-center gap-2 rounded-sm border p-3 min-w-[120px]"
	role="group"
	aria-label="Party slot {position}: {heroName ?? 'Empty'}"
>
	<!-- Portrait placeholder -->
	<div
		class="flex h-14 w-14 items-center justify-center rounded-sm bg-muted text-muted-foreground"
	>
		{#if heroName}
			<span class="text-lg font-bold">{heroName.charAt(0).toUpperCase()}</span>
		{:else}
			<span class="text-xs">Empty</span>
		{/if}
	</div>

	<!-- Hero info -->
	{#if heroName}
		<div class="flex flex-col items-center gap-0.5 text-center">
			<span class="text-sm font-semibold leading-tight">{heroName}</span>
			{#if heroClass}
				<span class="text-[11px] text-muted-foreground">{heroClass}</span>
			{/if}
		</div>
	{:else}
		<span class="text-xs text-muted-foreground">No hero</span>
	{/if}

	<!-- Position badge -->
	<Badge variant="outline" class="text-[10px] font-normal">
		Pos {position}
	</Badge>
</div>
