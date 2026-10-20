<script lang="ts">
	import { commitChangedValue } from '#lib/control-events.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import {
		Tooltip,
		TooltipContent,
		TooltipTrigger
	} from '#lib/components/ui/tooltip/index.js';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
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

	function hasCascadeRisk(purchase: UpgradePurchase): boolean {
		if (!purchase.is_purchased) return false;
		const treeId = stripDsonPrefix(purchase.tree_id);
		const dotIndex = treeId.indexOf('.');
		const key = dotIndex >= 0 ? treeId.substring(dotIndex + 1) : treeId;
		const siblings = upgradesByKey[key] ?? [];
		// Check if any higher-tier upgrade is purchased
		return siblings.some(
			(s) => s.requirement_code > purchase.requirement_code && s.is_purchased
		);
	}

	function handleToggle(purchase: UpgradePurchase) {
		toggleUpgrade(purchase);
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
						{#if purchase.is_purchased && hasCascadeRisk(purchase)}
							<Tooltip>
								<TooltipTrigger>
									<WarningIcon size={14} class="text-amber-500" />
								</TooltipTrigger>
								<TooltipContent>
									<p class="max-w-xs text-xs">
										Reverting this upgrade will also revert all higher-tier upgrades
										in the same tree to maintain consistency.
									</p>
								</TooltipContent>
							</Tooltip>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/each}
</div>
