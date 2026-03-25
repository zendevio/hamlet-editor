<script lang="ts">
	let { title, description }: { title: string; description: string } = $props();
</script>

<div class="flex min-h-100 items-center justify-center">
	<div class="text-center space-y-2">
		<h2 class="text-xl font-semibold text-muted-foreground">{title}</h2>
		<p class="text-sm text-muted-foreground/70">{description}</p>
	</div>
</div>
