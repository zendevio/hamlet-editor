<script lang="ts">
	import { t, tWithLocaleParams } from '#lib/i18n/index.svelte.js';
	import { compareNames, formatList } from '#lib/i18n/intl.js';
	import { gameTextLocale, upgradeTreeName } from '#lib/save-labels.js';
	import { commitChangedValue } from '#lib/control-events.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { toast } from 'svelte-sonner';
	import { stripDsonPrefix } from '#lib/utils.js';
	import {
		type BuildingUpgradeGroup,
		type UpgradePurchase,
		toggleUpgrade
	} from '#lib/stores/save-data.svelte.js';

	let { group }: { group: BuildingUpgradeGroup } = $props();

	// The store orders tiers by requirement code and purchase dictionary id.
	let upgradesByTree = $derived.by(() => {
		const map = new Map<string, { purchase: UpgradePurchase; id: number }[]>();
		for (const [id, purchase] of group.upgrades.entries()) {
			const tree = stripDsonPrefix(purchase.tree_id);
			const entries = map.get(tree) ?? [];
			entries.push({ purchase, id });
			map.set(tree, entries);
		}
		return [...map.entries()].sort(([a], [b]) =>
			compareNames(upgradeTreeName(a), a, upgradeTreeName(b), b, gameTextLocale()));
	});

	/** Purchased tiers above this one, which the store turns off together with it. */
	function higherPurchased(purchase: UpgradePurchase): UpgradePurchase[] {
		const tree = stripDsonPrefix(purchase.tree_id);
		return (upgradesByTree.find(([id]) => id === tree)?.[1] ?? [])
			.map(({ purchase }) => purchase)
			.filter((other) => other.requirement_code > purchase.requirement_code && other.is_purchased);
	}

	function handleToggle(purchase: UpgradePurchase) {
		const cascaded = purchase.is_purchased ? higherPurchased(purchase) : [];
		toggleUpgrade(purchase);
		// Only report the cascade when the store actually applied it.
		if (cascaded.length > 0 && cascaded.every((other) => !other.is_purchased)) {
			toast.info(tWithLocaleParams('town.cascade', (locale) => ({
				count: cascaded.length,
				tiers: formatList(cascaded.map((other) => other.requirement_code), {}, locale),
				requiredTier: purchase.requirement_code
			})));
		}
	}
</script>

<div class="space-y-3">
	<h4 class="text-sm font-medium text-muted-foreground">{t('town.upgrades')}</h4>

	{#each upgradesByTree as [tree, upgrades] (tree)}
		<div class="space-y-1.5">
			<p lang={gameTextLocale()} class="text-xs font-medium text-muted-foreground/80">{upgradeTreeName(tree)}</p>
			<div class="flex flex-wrap gap-3">
				{#each upgrades as { purchase, id } (id)}
					<div class="flex items-center gap-2">
						<Switch
							aria-label={t('town.toggleTier', { name: upgradeTreeName(tree), tier: purchase.requirement_code })}
							checked={purchase.is_purchased}
							size="sm"
							onCheckedChange={(checked) => commitChangedValue(purchase.is_purchased, checked, () => handleToggle(purchase))}
						/>
						<span class="text-xs text-muted-foreground">
							{t('town.tier', { tier: purchase.requirement_code })}
						</span>
					</div>
				{/each}
			</div>
		</div>
	{/each}
</div>
