<script lang="ts">
	let {
		label,
		value,
		valueLang
	}: {
		label: string;
		value: string;
		valueLang?: string;
	} = $props();
</script>

<div class="flex min-w-0 flex-col gap-1 rounded-sm border px-3 py-2 wrap-anywhere">
	<span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
		{label}
	</span>
	<span class="text-sm font-semibold" lang={valueLang}>{value}</span>
</div>
