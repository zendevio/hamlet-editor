<script lang="ts">
	import { commitChangedValue } from '#lib/control-events.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { toast } from 'svelte-sonner';
	import { snakeToTitle, stripDsonPrefix } from '#lib/utils.js';
	import {
		type BuildingUpgradeGroup,
		type UpgradePurchase,
		toggleUpgrade
	} from '#lib/stores/save-data.svelte.js';

	let {
		group
	}: {
		group: BuildingUpgradeGroup;
	} = $props();

	// Group upgrades by their upgrade key (the part after the building name dot)
	let upgradesByKey = $derived.by(() => {
		const map: Record<string, UpgradePurchase[]> = {};
		for (const upgrade of group.upgrades) {
			const treeId = stripDsonPrefix(upgrade.tree_id);
			const dotIndex = treeId.indexOf('.');
			const key = dotIndex >= 0 ? treeId.substring(dotIndex + 1) : treeId;
			if (!map[key]) map[key] = [];
			map[key].push(upgrade);
		}
		// Sort each group by requirement_code
		for (const key of Object.keys(map)) {
			map[key].sort((a, b) => a.requirement_code.localeCompare(b.requirement_code));
		}
		return map;
	});

	/** Purchased tiers above this one, which the store turns off together with it. */
	function higherPurchased(purchase: UpgradePurchase): UpgradePurchase[] {
		const treeId = stripDsonPrefix(purchase.tree_id);
		const dotIndex = treeId.indexOf('.');
		const key = dotIndex >= 0 ? treeId.substring(dotIndex + 1) : treeId;
		return (upgradesByKey[key] ?? []).filter(
			(s) => s.requirement_code > purchase.requirement_code && s.is_purchased
		);
	}

	function handleToggle(purchase: UpgradePurchase) {
		const cascaded = purchase.is_purchased ? higherPurchased(purchase) : [];
		toggleUpgrade(purchase);
		// Only report the cascade when the store actually applied it.
		if (cascaded.length > 0 && cascaded.every((s) => !s.is_purchased)) {
			toast.info(
				`Also turned off ${cascaded.length === 1 ? 'tier' : 'tiers'} ${cascaded.map((s) => s.requirement_code).join(', ')}, which need tier ${purchase.requirement_code}.`
			);
		}
	}
</script>

<div class="space-y-3">
	<h4 class="text-sm font-medium text-muted-foreground">Upgrades</h4>

	{#each Object.entries(upgradesByKey) as [key, upgrades] (key)}
		<div class="space-y-1.5">
			<p class="text-xs font-medium text-muted-foreground/80">{snakeToTitle(key)}</p>
			<div class="flex flex-wrap gap-3">
				{#each upgrades as purchase (purchase.tree_id + purchase.requirement_code)}
					<div class="flex items-center gap-2">
						<Switch
							checked={purchase.is_purchased}
							size="sm"
							onCheckedChange={(checked) => commitChangedValue(purchase.is_purchased, checked, () => handleToggle(purchase))}
						/>
						<span class="text-xs text-muted-foreground">
							Tier {purchase.requirement_code}
						</span>
					</div>
				{/each}
			</div>
		</div>
	{/each}
</div>
