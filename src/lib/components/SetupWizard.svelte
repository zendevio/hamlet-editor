<script lang="ts">
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import {
		setGamePath,
		setSavePath,
		setProfileId,
		completeSetup
	} from '$lib/stores/settings.svelte';
	import {
		detectGameInstallations,
		detectSaveLocations,
		type GameInstall,
		type SaveLocation
	} from '$lib/api/detect';
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

	// Step 1 — Game Installation
	let gameInstalls = $state<GameInstall[]>([]);
	let selectedGameInstall = $state<GameInstall | null>(null);
	let gameDetectRan = $state(false);

	// Step 2 — Save Locations
	let saveLocations = $state<SaveLocation[]>([]);
	let selectedSave = $state<SaveLocation | null>(null);
	let saveDetectRan = $state(false);

	// ── Derived ──

	let canAdvanceFromStep1 = $derived(selectedGameInstall !== null);
	let canAdvanceFromStep2 = $derived(selectedSave !== null);

	let isSteamCloudSave = $derived(
		selectedSave !== null && selectedSave.source === 'Steam'
	);

	let dlcTags = $derived.by(() => {
		if (!selectedGameInstall) return [];
		const tags: string[] = [];
		if (selectedGameInstall.has_crimson_court) tags.push('Crimson Court');
		if (selectedGameInstall.has_shieldbreaker) tags.push('Shieldbreaker');
		if (selectedGameInstall.has_color_of_madness) tags.push('Color of Madness');
		if (selectedGameInstall.has_musketeer) tags.push('Musketeer');
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
			const selected = await open({ directory: true, title: 'Select Darkest Dungeon installation folder' });
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
			const selected = await open({ directory: true, title: 'Select save file folder' });
			if (selected && typeof selected === 'string') {
				const fakeLoc: SaveLocation = {
					path: selected,
					source: 'Manual',
					steam_user_id: null,
					profile_id: selected.split('/').pop() ?? selected.split('\\').pop() ?? 'manual',
					has_active_raid: false,
					week_number: null
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
		completeSetup();
	}

	function sourceLabel(source: string): string {
		switch (source) {
			case 'Steam':
				return 'Steam';
			case 'Gog':
				return 'GOG';
			case 'Epic':
				return 'Epic';
			default:
				return 'Manual';
		}
	}

	function formatWeek(week: number | null): string {
		if (week === null) return 'Unknown week';
		return `Week ${week}`;
	}
</script>

<Dialog open={true}>
	<DialogContent
		class="sm:max-w-lg overflow-hidden"
		showCloseButton={false}
		onInteractOutside={(e) => e.preventDefault()}
		onEscapeKeydown={(e) => e.preventDefault()}
	>
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
					{s}
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
					Game Installation Path
				</DialogTitle>
				<DialogDescription class="break-words">
					Locate your Darkest Dungeon installation so the editor can read game data, icons, and
					detect installed DLCs.
				</DialogDescription>
			</DialogHeader>

			<div class="space-y-3">
				{#if !gameDetectRan}
					<Button onclick={detectGamePaths} disabled={detecting} class="w-full">
						{#if detecting}
							<SpinnerIcon size={16} class="mr-2 animate-spin" />
							Detecting...
						{:else}
							<MagnifyingGlassIcon size={16} class="mr-2" />
							Auto-detect Game Installation
						{/if}
					</Button>
				{:else if gameInstalls.length === 0}
					<div
						class="flex items-start gap-2 border border-border bg-muted/50 p-3 text-xs text-muted-foreground"
					>
						<WarningIcon size={16} class="mt-0.5 shrink-0 text-amber-500" />
						<div>
							<p class="font-medium text-foreground">No installations found</p>
							<p class="mt-1">
								Use "Browse..." to manually select your Darkest Dungeon folder, or try
								auto-detect again.
							</p>
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
							Retry
						</Button>
						<Button variant="outline" onclick={browseGamePath} class="flex-1">
							<FolderOpenIcon size={16} class="mr-2" />
							Browse...
						</Button>
					</div>
				{:else}
					<div class="space-y-2">
						{#each gameInstalls as install}
							{@const isSelected = selectedGameInstall === install}
							<button
								type="button"
								class="w-full border p-3 text-left transition-colors
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
										<span class="text-xs font-medium">{sourceLabel(install.source)}</span>
									</div>
									{#if install.has_mods}
										<Badge variant="outline" class="text-[10px]">Modded</Badge>
									{/if}
								</div>
								<p class="mt-1 truncate text-[11px] text-muted-foreground">{install.path}</p>
								{#if isSelected}
									<div class="mt-2 flex flex-wrap gap-1">
										{#if install.has_crimson_court}
											<Badge variant="secondary" class="text-[10px]">Crimson Court</Badge>
										{/if}
										{#if install.has_shieldbreaker}
											<Badge variant="secondary" class="text-[10px]">Shieldbreaker</Badge>
										{/if}
										{#if install.has_color_of_madness}
											<Badge variant="secondary" class="text-[10px]">Color of Madness</Badge>
										{/if}
										{#if install.has_musketeer}
											<Badge variant="secondary" class="text-[10px]">Musketeer</Badge>
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
						Re-detect
					</Button>
				{/if}
			</div>

			<DialogFooter>
				<Button onclick={nextStep} disabled={!canAdvanceFromStep1}>
					Next
					<ArrowRightIcon size={16} class="ml-1" />
				</Button>
			</DialogFooter>

			<!-- Step 2: Save File Location -->
		{:else if step === 2}
			<DialogHeader>
				<DialogTitle class="flex items-center gap-2">
					<FolderOpenIcon size={20} />
					Save File Location
				</DialogTitle>
				<DialogDescription class="break-words">
					Select a save profile to edit. Each profile is a separate campaign playthrough.
				</DialogDescription>
			</DialogHeader>

			<div class="space-y-3">
				{#if !saveDetectRan}
					<Button onclick={detectSavePaths} disabled={detecting} class="w-full">
						{#if detecting}
							<SpinnerIcon size={16} class="mr-2 animate-spin" />
							Detecting...
						{:else}
							<MagnifyingGlassIcon size={16} class="mr-2" />
							Auto-detect Save Files
						{/if}
					</Button>
				{:else if saveLocations.length === 0}
					<div
						class="flex items-start gap-2 border border-border bg-muted/50 p-3 text-xs text-muted-foreground"
					>
						<WarningIcon size={16} class="mt-0.5 shrink-0 text-amber-500" />
						<div>
							<p class="font-medium text-foreground">No save files found</p>
							<p class="mt-1">
								Make sure you have launched Darkest Dungeon at least once. Use "Browse..." to
								manually select your save folder.
							</p>
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
							Retry
						</Button>
						<Button variant="outline" onclick={browseSavePath} class="flex-1">
							<FolderOpenIcon size={16} class="mr-2" />
							Browse...
						</Button>
					</div>
				{:else}
					{#if isSteamCloudSave}
						<div
							class="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-3 text-xs"
						>
							<WarningIcon size={16} class="mt-0.5 shrink-0 text-amber-500" />
							<p class="text-amber-700 dark:text-amber-400">
								Steam Cloud sync detected. Disable cloud sync for Darkest Dungeon or close Steam
								before saving to avoid conflicts.
							</p>
						</div>
					{/if}

					<div class="max-h-48 space-y-2 overflow-y-auto">
						{#each saveLocations as loc}
							{@const isSelected = selectedSave === loc}
							<button
								type="button"
								class="w-full border p-3 text-left transition-colors
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
											>{sourceLabel(loc.source)}</Badge
										>
									</div>
									<div class="flex items-center gap-2">
										{#if loc.has_active_raid}
											<Badge variant="destructive" class="text-[10px]">
												<SwordIcon size={10} class="mr-0.5" />
												In Raid
											</Badge>
										{/if}
										<span class="text-[11px] text-muted-foreground"
											>{formatWeek(loc.week_number)}</span
										>
									</div>
								</div>
								<p class="mt-1 truncate text-[11px] text-muted-foreground">{loc.path}</p>
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
						Re-detect
					</Button>
				{/if}
			</div>

			<DialogFooter class="flex-row justify-between sm:justify-between">
				<Button variant="outline" onclick={prevStep}>
					<ArrowLeftIcon size={16} class="mr-1" />
					Back
				</Button>
				<Button onclick={nextStep} disabled={!canAdvanceFromStep2}>
					Next
					<ArrowRightIcon size={16} class="ml-1" />
				</Button>
			</DialogFooter>

			<!-- Step 3: Confirmation -->
		{:else}
			<DialogHeader>
				<DialogTitle class="flex items-center gap-2">
					<CheckCircleIcon size={20} />
					Confirmation
				</DialogTitle>
				<DialogDescription class="break-words">
					Review your selections and open the profile to start editing.
				</DialogDescription>
			</DialogHeader>

			<div class="space-y-4">
				<!-- Game Install Summary -->
				<div class="space-y-1">
					<p class="text-xs font-medium text-muted-foreground">Game Installation</p>
					<div class="border border-border bg-muted/30 p-3 overflow-x-hidden">
						<div class="flex items-center gap-2">
							<CheckCircleIcon
								size={14}
								weight="fill"
								class="shrink-0 text-green-600 dark:text-green-400"
							/>
							<span class="text-xs font-medium"
								>{sourceLabel(selectedGameInstall?.source ?? 'Manual')}</span
							>
						</div>
						<p class="mt-1 truncate text-[11px] text-muted-foreground">
							{selectedGameInstall?.path}
						</p>
						{#if dlcTags.length > 0}
							<div class="mt-2 flex flex-wrap gap-1">
								{#each dlcTags as tag}
									<Badge variant="secondary" class="text-[10px]">{tag}</Badge>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- Save Profile Summary -->
				<div class="space-y-1">
					<p class="text-xs font-medium text-muted-foreground">Save Profile</p>
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
									>{sourceLabel(selectedSave?.source ?? 'Manual')}</Badge
								>
							</div>
							{#if selectedSave?.has_active_raid}
								<Badge variant="destructive" class="text-[10px]">
									<SwordIcon size={10} class="mr-0.5" />
									In Raid
								</Badge>
							{/if}
						</div>
						<p class="mt-1 truncate text-[11px] text-muted-foreground">
							{selectedSave?.path}
						</p>
						<p class="mt-1 text-[11px] text-muted-foreground">
							{formatWeek(selectedSave?.week_number ?? null)}
						</p>
					</div>
				</div>
			</div>

			<DialogFooter class="flex-row justify-between sm:justify-between">
				<Button variant="outline" onclick={prevStep}>
					<ArrowLeftIcon size={16} class="mr-1" />
					Back
				</Button>
				<Button onclick={finish}>
					<GameControllerIcon size={16} class="mr-1" />
					Open Profile
				</Button>
			</DialogFooter>
		{/if}
	</DialogContent>
</Dialog>
