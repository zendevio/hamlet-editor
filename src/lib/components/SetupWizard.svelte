<script lang="ts">
	import { goto } from '$app/navigation';
	import { t } from '#lib/i18n/index.svelte.js';
	import { formatNumber } from '#lib/i18n/intl.js';
	import { dlcName, dlcNameLang } from '#lib/save-labels.js';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import {
		setGamePath,
		setSavePath,
		setProfileId,
		setGameInstall,
		completeSetup
	} from '#lib/stores/settings.svelte.js';
	import {
		detectGameInstallations,
		detectSaveLocations,
		type GameInstall,
		type SaveLocation
	} from '#lib/api/detect.js';
	import GameControllerIcon from 'phosphor-svelte/lib/GameControllerIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
	import SwordIcon from 'phosphor-svelte/lib/SwordIcon';
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import SpinnerIcon from 'phosphor-svelte/lib/SpinnerIcon';

	// ── State ──

	let step = $state(1);
	let detecting = $state(false);

	// Step 1: Game Installation
	let gameInstalls = $state<GameInstall[]>([]);
	let selectedGameInstall = $state<GameInstall | null>(null);
	let gameDetectRan = $state(false);

	// Step 2: Save Locations
	let saveLocations = $state<SaveLocation[]>([]);
	let selectedSave = $state<SaveLocation | null>(null);
	let saveDetectRan = $state(false);

	// ── Derived ──

	let canAdvanceFromStep1 = $derived(selectedGameInstall !== null);
	let canAdvanceFromStep2 = $derived(selectedSave !== null);

	let dlcTags = $derived.by(() => {
		if (!selectedGameInstall) return [];
		const tags: string[] = [];
		if (selectedGameInstall.has_crimson_court) tags.push('crimson_court');
		if (selectedGameInstall.has_shieldbreaker) tags.push('shieldbreaker');
		if (selectedGameInstall.has_color_of_madness) tags.push('color_of_madness');
		if (selectedGameInstall.has_musketeer) tags.push('musketeer');
		return tags;
	});

	// ── Actions ──

	async function detectGamePaths() {
		detecting = true;
		gameDetectRan = true;
		try {
			gameInstalls = await detectGameInstallations();
			if (gameInstalls.length === 1) {
				selectedGameInstall = gameInstalls[0];
			}
		} finally {
			detecting = false;
		}
	}

	async function detectSavePaths() {
		detecting = true;
		saveDetectRan = true;
		try {
			saveLocations = await detectSaveLocations();
			if (saveLocations.length === 1) {
				selectedSave = saveLocations[0];
			}
		} finally {
			detecting = false;
		}
	}

	function selectGameInstall(install: GameInstall) {
		selectedGameInstall = install;
	}

	function selectSaveLocation(loc: SaveLocation) {
		selectedSave = loc;
	}

	function nextStep() {
		if (step < 3) step++;
	}

	function prevStep() {
		if (step > 1) step--;
	}

	async function browseGamePath() {
		try {
			const { open } = await import('@tauri-apps/plugin-dialog');
			const selected = await open({ directory: true, title: t('settings.gamePanel') });
			if (selected && typeof selected === 'string') {
				const fakeInstall: GameInstall = {
					path: selected,
					source: 'Manual',
					has_crimson_court: false,
					has_shieldbreaker: false,
					has_color_of_madness: false,
					has_musketeer: false,
					has_mods: false
				};
				gameInstalls = [fakeInstall, ...gameInstalls.filter((i) => i.path !== selected)];
				selectedGameInstall = fakeInstall;
				gameDetectRan = true;
			}
		} catch {
			// Not in Tauri environment (dev mode in browser), silently ignore
		}
	}

	async function browseSavePath() {
		try {
			const { open } = await import('@tauri-apps/plugin-dialog');
			const selected = await open({ directory: true, title: t('settings.savePanel') });
			if (selected && typeof selected === 'string') {
				const fakeLoc: SaveLocation = {
					path: selected,
					source: 'Manual',
					steam_user_id: null,
					profile_id: selected.split('/').pop() ?? selected.split('\\').pop() ?? 'manual',
					has_active_raid: false
				};
				saveLocations = [fakeLoc, ...saveLocations.filter((l) => l.path !== selected)];
				selectedSave = fakeLoc;
				saveDetectRan = true;
			}
		} catch {
			// Not in Tauri environment (dev mode in browser), silently ignore
		}
	}

	function finish() {
		if (!selectedGameInstall || !selectedSave) return;
		setGamePath(selectedGameInstall.path);
		setSavePath(selectedSave.path);
		setProfileId(selectedSave.profile_id);
		setGameInstall(selectedGameInstall);
		completeSetup();
	}




</script>

<Dialog open={true}>
	<DialogContent
		class="overflow-hidden sm:max-w-lg"
		data-testid="setup-wizard"
		showCloseButton={false}
		onInteractOutside={(e) => e.preventDefault()}
		onEscapeKeydown={(e) => e.preventDefault()}
	>
		<Button variant="outline" onclick={() => goto('/settings')}>{t('settings.openLanguages')}</Button>
		<!-- Step indicator -->
		<div role="list" class="flex items-center justify-center gap-2 pb-2">
			{#each [1, 2, 3] as s}
				<div
					role="listitem"
					aria-current={s === step ? 'step' : undefined}
					class="flex h-7 w-7 items-center justify-center text-xs font-medium transition-colors
					{s === step
						? 'bg-primary text-primary-foreground'
						: s < step
							? 'bg-primary/20 text-primary'
							: 'bg-muted text-muted-foreground'}"
				>
					{formatNumber(s)}
				</div>
				{#if s < 3}
					<div
						class="h-px w-8 transition-colors {s < step ? 'bg-primary' : 'bg-border'}"
					></div>
				{/if}
			{/each}
		</div>

		<!-- Step 1: Game Installation Path -->
		{#if step === 1}
			<DialogHeader>
				<DialogTitle class="flex items-center gap-2">
					<GameControllerIcon size={20} />
					{t('setup.gameTitle')}</DialogTitle>
				<DialogDescription class="wrap-break-word">{t('setup.gameDescription')}</DialogDescription>
			</DialogHeader>

			<div class="space-y-3">
				{#if !gameDetectRan}
					<Button onclick={detectGamePaths} disabled={detecting} class="w-full">
						{#if detecting}
							<SpinnerIcon size={16} class="mr-2 animate-spin" />
							{t('setup.detecting')}
						{:else}
							<MagnifyingGlassIcon size={16} class="mr-2" />
							{t('setup.detectGame')}
						{/if}
					</Button>
				{:else if gameInstalls.length === 0}
					<div
						class="flex items-start gap-2 border border-border bg-muted/50 p-3 text-xs text-muted-foreground"
					>
						<WarningIcon size={16} class="mt-0.5 shrink-0 text-amber-500" />
						<div>
							<p class="font-medium text-foreground">{t('setup.noGame')}</p>
							<p class="mt-1">{t('setup.noGameHelp')}</p>
						</div>
					</div>
					<div class="flex gap-2">
						<Button
							variant="outline"
							onclick={detectGamePaths}
							disabled={detecting}
							class="flex-1"
						>
							<MagnifyingGlassIcon size={16} class="mr-2" />
							{t('setup.retry')}
						</Button>
						<Button variant="outline" onclick={browseGamePath} class="flex-1">
							<FolderOpenIcon size={16} class="mr-2" />
							{t('setup.browse')}
						</Button>
					</div>
				{:else}
					<div class="space-y-2">
						{#each gameInstalls as install}
							{@const isSelected = selectedGameInstall === install}
							<button
								type="button"
								class="w-full min-w-0 border p-3 text-left transition-colors overflow-hidden
								{isSelected
									? 'border-primary bg-primary/5'
									: 'border-border hover:border-primary/50 hover:bg-muted/50'}"
								onclick={() => selectGameInstall(install)}
							>
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										{#if isSelected}
											<CheckCircleIcon
												size={16}
												weight="fill"
												class="shrink-0 text-green-600 dark:text-green-400"
											/>
										{/if}
										<span class="text-xs font-medium">{t('setup.source', { source: install.source })}</span>
									</div>
									{#if install.has_mods}
										<Badge variant="outline" class="text-[10px]">{t('setup.modded')}</Badge>
									{/if}
								</div>
								<p class="mt-1 break-all text-[11px] text-muted-foreground">{install.path}</p>
								{#if isSelected}
									<div class="mt-2 flex flex-wrap gap-1">
										{#if install.has_crimson_court}
											<Badge variant="secondary" class="text-[10px]" lang={dlcNameLang('crimson_court')}>{dlcName('crimson_court', t('setup.dlcName', { dlc: 'crimson_court' }))}</Badge>
										{/if}
										{#if install.has_shieldbreaker}
											<Badge variant="secondary" class="text-[10px]" lang={dlcNameLang('shieldbreaker')}>{dlcName('shieldbreaker', t('setup.dlcName', { dlc: 'shieldbreaker' }))}</Badge>
										{/if}
										{#if install.has_color_of_madness}
											<Badge variant="secondary" class="text-[10px]" lang={dlcNameLang('color_of_madness')}>{dlcName('color_of_madness', t('setup.dlcName', { dlc: 'color_of_madness' }))}</Badge>
										{/if}
										{#if install.has_musketeer}
											<Badge variant="secondary" class="text-[10px]" lang={dlcNameLang('musketeer')}>{dlcName('musketeer', t('setup.dlcName', { dlc: 'musketeer' }))}</Badge>
										{/if}
									</div>
								{/if}
							</button>
						{/each}
					</div>
					<Button
						variant="ghost"
						onclick={detectGamePaths}
						disabled={detecting}
						class="w-full text-xs text-muted-foreground"
					>
						<MagnifyingGlassIcon size={14} class="mr-1" />
						{t('setup.redetect')}
					</Button>
				{/if}
			</div>

			<DialogFooter>
				<Button onclick={nextStep} disabled={!canAdvanceFromStep1}>{t('setup.next')}<ArrowRightIcon size={16} class="ml-1" />
				</Button>
			</DialogFooter>

			<!-- Step 2: Save File Location -->
		{:else if step === 2}
			<DialogHeader>
				<DialogTitle class="flex items-center gap-2">
					<FolderOpenIcon size={20} />
					{t('setup.saveTitle')}</DialogTitle>
				<DialogDescription class="wrap-break-word">{t('setup.saveDescription')}</DialogDescription>
			</DialogHeader>

			<div class="space-y-3">
				<div class="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
					<WarningIcon size={16} class="mt-0.5 shrink-0 text-amber-500" />
					<p class="wrap-break-word text-amber-700 dark:text-amber-400">{t('setup.cloudWarning')}</p>
				</div>

				{#if !saveDetectRan}
					<Button onclick={detectSavePaths} disabled={detecting} class="w-full">
						{#if detecting}
							<SpinnerIcon size={16} class="mr-2 animate-spin" />
							{t('setup.detecting')}
						{:else}
							<MagnifyingGlassIcon size={16} class="mr-2" />
							{t('setup.detectSave')}
						{/if}
					</Button>
				{:else if saveLocations.length === 0}
					<div
						class="flex items-start gap-2 border border-border bg-muted/50 p-3 text-xs text-muted-foreground"
					>
						<WarningIcon size={16} class="mt-0.5 shrink-0 text-amber-500" />
						<div>
							<p class="font-medium text-foreground">{t('setup.noSave')}</p>
							<p class="mt-1">{t('setup.noSaveHelp')}</p>
						</div>
					</div>
					<div class="flex gap-2">
						<Button
							variant="outline"
							onclick={detectSavePaths}
							disabled={detecting}
							class="flex-1"
						>
							<MagnifyingGlassIcon size={16} class="mr-2" />
							{t('setup.retry')}
						</Button>
						<Button variant="outline" onclick={browseSavePath} class="flex-1">
							<FolderOpenIcon size={16} class="mr-2" />
							{t('setup.browse')}
						</Button>
					</div>
				{:else}
					<div class="max-h-48 space-y-2 overflow-y-auto">
						{#each saveLocations as loc}
							{@const isSelected = selectedSave === loc}
							<button
								type="button"
								class="w-full min-w-0 border p-3 text-left transition-colors overflow-hidden
								{isSelected
									? 'border-primary bg-primary/5'
									: 'border-border hover:border-primary/50 hover:bg-muted/50'}"
								onclick={() => selectSaveLocation(loc)}
							>
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										{#if isSelected}
											<CheckCircleIcon
												size={16}
												weight="fill"
												class="shrink-0 text-green-600 dark:text-green-400"
											/>
										{/if}
										<span class="text-xs font-medium">{loc.profile_id}</span>
										<Badge variant="outline" class="text-[10px]"
											>{t('setup.source', { source: loc.source })}</Badge
										>
									</div>
									<div class="flex items-center gap-2">
										{#if loc.has_active_raid}
											<Badge variant="destructive" class="text-[10px]">
												<SwordIcon size={10} class="mr-0.5" />
												{t('setup.inRaid')}</Badge>
										{/if}
									</div>
								</div>
								<p class="mt-1 break-all text-[11px] text-muted-foreground">{loc.path}</p>
							</button>
						{/each}
					</div>

					<Button
						variant="ghost"
						onclick={detectSavePaths}
						disabled={detecting}
						class="w-full text-xs text-muted-foreground"
					>
						<MagnifyingGlassIcon size={14} class="mr-1" />
						{t('setup.redetect')}
					</Button>
				{/if}
			</div>

			<DialogFooter class="flex-row flex-wrap justify-between sm:justify-between">
				<Button variant="outline" onclick={prevStep}>
					<ArrowLeftIcon size={16} class="mr-1" />
					{t('setup.back')}
				</Button>
				<Button onclick={nextStep} disabled={!canAdvanceFromStep2}>{t('setup.next')}<ArrowRightIcon size={16} class="ml-1" />
				</Button>
			</DialogFooter>

			<!-- Step 3: Confirmation -->
		{:else}
			<DialogHeader>
				<DialogTitle class="flex items-center gap-2">
					<CheckCircleIcon size={20} />
					{t('setup.confirmation')}</DialogTitle>
				<DialogDescription class="wrap-break-word">{t('setup.confirmationHelp')}</DialogDescription>
			</DialogHeader>

			<div class="space-y-4">
				<!-- Game Install Summary -->
				<div class="space-y-1">
					<p class="text-xs font-medium text-muted-foreground">{t('setup.gameInstallation')}</p>
					<div class="border border-border bg-muted/30 p-3 overflow-x-hidden">
						<div class="flex items-center gap-2">
							<CheckCircleIcon
								size={14}
								weight="fill"
								class="shrink-0 text-green-600 dark:text-green-400"
							/>
							<span class="text-xs font-medium"
								>{t('setup.source', { source: selectedGameInstall?.source ?? 'Manual' })}</span
							>
						</div>
						<p class="mt-1 break-all text-[11px] text-muted-foreground">
							{selectedGameInstall?.path}
						</p>
						{#if dlcTags.length > 0}
							<div class="mt-2 flex flex-wrap gap-1">
								{#each dlcTags as tag}
									<Badge variant="secondary" class="text-[10px]" lang={dlcNameLang(tag)}>{dlcName(tag, t('setup.dlcName', { dlc: tag }))}</Badge>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- Save Profile Summary -->
				<div class="space-y-1">
					<p class="text-xs font-medium text-muted-foreground">{t('setup.saveProfile')}</p>
					<div class="border border-border bg-muted/30 p-3 overflow-x-hidden">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								<CheckCircleIcon
									size={14}
									weight="fill"
									class="shrink-0 text-green-600 dark:text-green-400"
								/>
								<span class="text-xs font-medium">{selectedSave?.profile_id}</span>
								<Badge variant="outline" class="text-[10px]"
									>{t('setup.source', { source: selectedSave?.source ?? 'Manual' })}</Badge
								>
							</div>
							{#if selectedSave?.has_active_raid}
								<Badge variant="destructive" class="text-[10px]">
									<SwordIcon size={10} class="mr-0.5" />
									{t('setup.inRaid')}</Badge>
							{/if}
						</div>
						<p class="mt-1 break-all text-[11px] text-muted-foreground">
							{selectedSave?.path}
						</p>
					</div>
				</div>
			</div>

			<DialogFooter class="flex-row justify-between sm:justify-between">
				<Button variant="outline" onclick={prevStep}>
					<ArrowLeftIcon size={16} class="mr-1" />
					{t('setup.back')}
				</Button>
				<Button onclick={finish}>
					<GameControllerIcon size={16} class="mr-1" />
					{t('setup.openProfile')}
				</Button>
			</DialogFooter>
		{/if}
	</DialogContent>
</Dialog>
