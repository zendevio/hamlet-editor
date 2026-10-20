<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, setContext } from 'svelte';
	import { createSaveWorkflow, createUnsavedGuard, createGameStoppedObserver, createProfileReload, createWindowCloseGuard, profileSaveBlockReason, DATA_CHANGE_CONTEXT, type ValidationChoice, type UnsavedChoice, type RequestDataChange } from '#lib/save-workflow.js';
	import {
		SidebarProvider,
		Sidebar,
		SidebarContent,
		SidebarFooter,
		SidebarHeader,
		SidebarMenu,
		SidebarMenuItem,
		SidebarMenuButton,
		SidebarGroup,
		SidebarGroupContent,
		SidebarRail,
		SidebarTrigger,
		SidebarInset
	} from '#lib/components/ui/sidebar/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Tooltip, TooltipContent, TooltipTrigger } from '#lib/components/ui/tooltip/index.js';
	import { toggleMode } from 'mode-watcher';
	import UsersThreeIcon from 'phosphor-svelte/lib/UsersThreeIcon';
	import BankIcon from 'phosphor-svelte/lib/BankIcon';
	import BuildingsIcon from 'phosphor-svelte/lib/BuildingsIcon';
	import CompassIcon from 'phosphor-svelte/lib/CompassIcon';
	import GearIcon from 'phosphor-svelte/lib/GearIcon';
	import FloppyDiskIcon from 'phosphor-svelte/lib/FloppyDiskIcon';
	import ArchiveIcon from 'phosphor-svelte/lib/ArchiveIcon';
	import MoonIcon from 'phosphor-svelte/lib/MoonIcon';
	import SunIcon from 'phosphor-svelte/lib/SunIcon';
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import InfoIcon from 'phosphor-svelte/lib/InfoIcon';
	import SetupWizard from '#lib/components/SetupWizard.svelte';
	import ValidationDialog from '#lib/components/ValidationDialog.svelte';
	import UnsavedChangesDialog from '#lib/components/UnsavedChangesDialog.svelte';
	import DiscardConfirmDialog from '#lib/components/DiscardConfirmDialog.svelte';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription
	} from '#lib/components/ui/dialog/index.js';
	import LoadingScreen from '#lib/components/LoadingScreen.svelte';
	import GameAssetIcon from '#lib/components/GameAssetIcon.svelte';
	import { getSettings, setSavePath, setProfileId } from '#lib/stores/settings.svelte.js';
	import {
		getSaveData,
		hasDirtyFiles,
		getDirtyData,
		clearAllDirty,
		markProfileStale,
		getUnknownUpgrades,
		discardAllChanges,
		loadProfileFromBackend,
		getHeroes,
		CLASS_DISPLAY_NAMES
	} from '#lib/stores/save-data.svelte.js';
	import { setNameTable, setQuirks, setTrinkets, setClassStats, setClassSkills, setRosterCapacityRules } from '#lib/stores/game-data.svelte.js';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '#lib/components/ui/select/index.js';
	import { isGameRunning, detectSaveLocations, type SaveLocation } from '#lib/api/detect.js';
	import { saveProfile } from '#lib/api/save.js';
	import { createBackup } from '#lib/api/backup.js';
	import { ensureNameTable, loadLocalization } from '#lib/api/names.js';
	import { loadQuirkLibrary, loadTrinketLibrary, loadClassStats, loadClassSkills, loadRosterCapacityRules } from '#lib/api/gamedata.js';
	import { scanModDirectories } from '#lib/api/mods.js';
	import { runPreSaveValidation, type ValidationIssue } from '#lib/validation.js';

	let { children } = $props();

	let appVersion = $state('dev');

	const settings = getSettings();
	const saveData = getSaveData();
	let showSetupWizard = $derived(!settings.isSetupComplete);

	// ── Game Running Detection ──

	let gameRunning = $state(false);
	let gameDetectionUncertain = $state(false);
	let isSaving = $state(false);
	let isProfileLoading = $state(false);
	let attemptedProfile = $state('');
	let modCount = $state<number | null>(null);

	// ── Profile Selector ──

	// Detected save locations — populated once on first successful setup.
	let sidebarSaveLocations = $state<SaveLocation[]>([]);

	/** Switch to a different profile from the sidebar selector. */
	async function handleSidebarProfileChange(newProfilePath: string) {
		if (newProfilePath === settings.savePath || isProfileLoading) return;
		const loc = sidebarSaveLocations.find((l) => l.path === newProfilePath);
		if (!loc) return;

		await requestDataChange(async () => {
			setSavePath(loc.path);
			setProfileId(loc.profile_id);

			isProfileLoading = true;
			try {
				await loadProfileFromBackend(loc.path);
				if (settings.gamePath) {
					await initGameData(settings.gamePath);
				}
				toast.success('Profile loaded', { description: `Switched to ${loc.profile_id}` });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				toast.error(`Failed to switch profile: ${message}`);
			} finally {
				isProfileLoading = false;
			}
		});
	}

	// ── Profile Loading ──

	// ── Name table + localization + mod-scan pipeline ──

	async function initGameData(gamePath: string) {
		// 1. Generate name table from game files and push to Rust state.
		await ensureNameTable(gamePath);

		// 2. Load localization strings and store in the frontend game-data store.
		const locData = await loadLocalization(gamePath);
		setNameTable(locData);

		// 3. Load quirk, trinket, class stats, and class skills definitions from game files.
		const [quirkDefs, trinketDefs, statsDefs, skillsDefs, capacityRules] = await Promise.all([
			loadQuirkLibrary(gamePath),
			loadTrinketLibrary(gamePath),
			loadClassStats(gamePath),
			loadClassSkills(gamePath),
			loadRosterCapacityRules(gamePath)
		]);
		setQuirks(quirkDefs);
		setTrinkets(trinketDefs);
		setClassStats(statsDefs);
		setClassSkills(skillsDefs);
		setRosterCapacityRules(capacityRules, gamePath);

		// 4. Scan mod directories and surface the count.
		const mods = await scanModDirectories(gamePath);
		modCount = mods.length;
		if (mods.length > 0) {
			toast.info(`${mods.length} mod${mods.length === 1 ? '' : 's'} detected`);
		}
	}

	// When setup completes (or was already complete on startup), load the profile,
	// with the shared name-table barrier, then load localization and game libraries.
	// Also detect save locations to populate the sidebar profile selector.
	$effect(() => {
		const profileKey = `${settings.savePath}\0${settings.gamePath}`;
		if (!settings.isSetupComplete) attemptedProfile = '';
		if (
			settings.isSetupComplete && !saveData.isLoaded && !saveData.isLoading &&
			!isProfileLoading && attemptedProfile !== profileKey
		) {
			attemptedProfile = profileKey;
			isProfileLoading = true;
			// Detect all available save locations so the sidebar selector is populated.
			detectSaveLocations()
				.then((locs) => {
					sidebarSaveLocations = locs;
				})
				.catch(() => {
					// Non-fatal — sidebar selector will show current profile only
				});

			loadProfileFromBackend(settings.savePath)
				.then(() => {
					if (settings.gamePath) {
						return initGameData(settings.gamePath);
					}
				})
				.catch((err) => {
					const message = err instanceof Error ? err.message : String(err);
					toast.error(`Failed to load profile: ${message}`);
				})
				.finally(() => {
					isProfileLoading = false;
				});
		}
	});

	// Poll game running status every 5 seconds
	$effect(() => {
		let cancelled = false;
		const observeGameStatus = createGameStoppedObserver(markProfileStale);

		async function poll() {
			if (cancelled) return;
			try {
				const result = await isGameRunning();
				if (!cancelled) {
					observeGameStatus(result);
					gameRunning = result.running;
					gameDetectionUncertain = result.uncertain;
				}
			} catch {
				if (!cancelled) {
					gameRunning = false;
					gameDetectionUncertain = true;
				}
			}
		}

		poll();
		const interval = setInterval(poll, 5000);

		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	});

	// ── Derived State ──

	let isDirty = $derived(hasDirtyFiles());
	let isGameBlocking = $derived(gameRunning || gameDetectionUncertain);
	let saveDisabled = $derived(
		!saveData.isLoaded || saveData.isLoading ||
		saveData.profilePath !== settings.savePath || saveData.gamePath !== settings.gamePath ||
		isGameBlocking || saveData.isStale || !isDirty || isSaving
	);

	// C2: Modded content detection
	let hasModdedContent = $derived.by(() => {
		if (!saveData.isLoaded) return false;
		const heroes = getHeroes();
		return getUnknownUpgrades().length > 0 || heroes.some((h) => !(h.heroClass in CLASS_DISPLAY_NAMES));
	});

	// C3: Raid status badges
	let raidActive = $derived(saveData.raid !== null && saveData.gameInRaid);
	let raidInconsistent = $derived(
		saveData.gameInRaid && saveData.raid === null
	);

	// C7: Last backup timestamp
	let lastBackupTime = $state<Date | null>(null);

	let saveTooltip = $derived.by(() => {
		if (saveData.isLoading) return 'Loading profile...';
		if (!saveData.isLoaded) return 'No profile loaded';
		if (saveData.profilePath !== settings.savePath || saveData.gamePath !== settings.gamePath) {
			return 'Paths changed. Reload the profile before saving.';
		}
		if (saveData.isStale) return 'Save files may have changed. Reload the profile before saving.';
		if (gameRunning) return 'DD Running. Close the game before saving.';
		if (gameDetectionUncertain) return 'Unable to detect game status. Save blocked as precaution.';
		if (isSaving) return 'Saving...';
		if (!isDirty) return 'No unsaved changes';
		return 'Save all changes';
	});

	// ── Validation Dialog ──

	let showValidation = $state(false);
	let validationIssues = $state<ValidationIssue[]>([]);

	// ── Discard Dialog ──

	let showDiscardDialog = $state(false);

	// ── Unsaved Changes on Close Dialog ──

	let showCloseDialog = $state(false);
	const windowClose = createWindowCloseGuard(hasDirtyFiles);

	// ── Window Close Handler ──

	onMount(() => {
		// Fetch app version from Tauri (fire-and-forget; falls back to 'dev' in browser)
		import('@tauri-apps/api/app').then(({ getVersion }) =>
			getVersion().then((v) => { appVersion = 'v' + v; })
		).catch(() => { appVersion = 'dev'; });

		let unlisten: (() => void) | undefined;

		async function setup() {
			try {
				const { getCurrentWindow } = await import('@tauri-apps/api/window');
				const currentWindow = getCurrentWindow();
				unlisten = await currentWindow.onCloseRequested(async (event) => {
					if (windowClose.shouldConfirm()) {
						event.preventDefault();
						showCloseDialog = true;
						// Wait for user decision via the dialog callbacks
					}
					// If no dirty files, let the window close normally
				});
			} catch {
				// Not in Tauri environment (dev mode in browser), skip
			}
		}

		setup();

		return () => {
			unlisten?.();
		};
	});

	// ── Keyboard Shortcuts ──

	function handleKeydown(e: KeyboardEvent) {
		const mod = e.metaKey || e.ctrlKey;

		// Ctrl/Cmd+S: Save
		if (mod && e.key === 's') {
			e.preventDefault();
			if (!saveDisabled) handleSave();
		}
		// Ctrl/Cmd+Shift+Z: Discard
		if (mod && e.shiftKey && e.key === 'z') {
			e.preventDefault();
			if (isDirty) showDiscardDialog = true;
		}
		// Ctrl/Cmd+B: Backup
		if (mod && e.key === 'b') {
			e.preventDefault();
			handleBackup();
		}
		// Ctrl/Cmd+H: Navigate to /heroes
		if (mod && e.key === 'h') {
			e.preventDefault();
			goto('/heroes');
		}
		// Ctrl/Cmd+E: Navigate to /estate
		if (mod && e.key === 'e') {
			e.preventDefault();
			goto('/estate');
		}
		// Ctrl/Cmd+T: Navigate to /town
		if (mod && e.key === 't') {
			e.preventDefault();
			goto('/town');
		}
		// Ctrl/Cmd+D: Navigate to /raid (only if raid is available)
		if (mod && e.key === 'd') {
			e.preventDefault();
			if (saveData.gameInRaid) {
				goto('/raid');
			}
		}
		// Ctrl/Cmd+,: Navigate to /settings
		if (mod && e.key === ',') {
			e.preventDefault();
			goto('/settings');
		}

		// Ctrl/Cmd+R: Prevent WebView reload. e.preventDefault() intercepts it
		// before the WebView acts on it — no Tauri config changes needed.
		if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
			e.preventDefault();
			// Ctrl+R reserved — no action (prevents WebView reload)
		}
	}

	// ── Save Flow ──

	function saveBlockReason(): string | null {
		return profileSaveBlockReason(saveData, settings, {
			isProfileLoading, gameRunning, gameDetectionUncertain, hasChanges: hasDirtyFiles()
		});
	}

	let resolveValidation: ((choice: ValidationChoice) => void) | null = null;
	const saveChanges = createSaveWorkflow({
		blocked: saveBlockReason,
		validate: runPreSaveValidation,
		confirm: (issues: ValidationIssue[]) => new Promise<ValidationChoice>((resolve) => {
			validationIssues = issues;
			resolveValidation = resolve;
			showValidation = true;
		}),
		backup: async () => {
			if (settings.autoBackup) {
				await createBackup(settings.savePath);
				lastBackupTime = new Date();
			}
		},
		write: async () => {
			await saveProfile(settings.savePath, getDirtyData(), saveData.nameTableVersion);
		},
		saved: () => { clearAllDirty(); toast.success('Saved successfully'); },
		failed: (error) => {
			if (String(error).includes('Save files changed on disk')) markProfileStale();
			toast.error(`Save failed: ${String(error)}`);
		},
		busy: (value) => { isSaving = value; }
	});

	async function handleSave() {
		if (!saveDisabled) await saveChanges();
	}

	function finishValidation(choice: ValidationChoice) {
		const resolve = resolveValidation;
		resolveValidation = null;
		showValidation = false;
		resolve?.(choice);
	}

	// Dismissal via Escape or the dialog close button is also Cancel.
	$effect(() => {
		if (!showValidation && resolveValidation) finishValidation('cancel');
	});

	let showChangeDialog = $state(false);
	let changeCanSave = $state(true);
	let resolveUnsaved: ((choice: UnsavedChoice) => void) | null = null;
	const guardChanges = createUnsavedGuard({
		hasChanges: hasDirtyFiles,
		canSave: () => !saveData.isStale,
		choose: (canSave) => new Promise<UnsavedChoice>((resolve) => {
			changeCanSave = canSave;
			resolveUnsaved = resolve;
			showChangeDialog = true;
		}),
		save: saveChanges,
		discard: discardAllChanges
	});
	const requestDataChange: RequestDataChange = async (action, preflight) => {
		if (isSaving || saveData.isLoading || isProfileLoading) return false;
		return guardChanges(action, preflight);
	};
	setContext(DATA_CHANGE_CONTEXT, requestDataChange);

	const reloadProfile = createProfileReload({
		requestDataChange, profilePath: () => settings.savePath,
		load: loadProfileFromBackend,
		failed: (error) => toast.error(`Reload failed: ${String(error)}`)
	});

	function finishUnsaved(choice: UnsavedChoice) {
		const resolve = resolveUnsaved;
		resolveUnsaved = null;
		showChangeDialog = false;
		resolve?.(choice);
	}

	$effect(() => {
		if (!showChangeDialog && resolveUnsaved) finishUnsaved('cancel');
	});

	// ── Discard Flow ──

	function handleDiscard() {
		if (isSaving) return;
		discardAllChanges();
		showDiscardDialog = false;
		toast.info('All changes discarded');
	}

	// ── Close Flow ──

	async function handleSaveAndClose() {
		showCloseDialog = false;
		try {
			await windowClose.closeAfter(saveChanges, closeWindow);
		} catch {
			// Not in Tauri environment
		}
	}

	async function handleDiscardAndClose() {
		if (isSaving) return;
		showCloseDialog = false;
		try {
			await windowClose.closeAfter(() => {
				discardAllChanges();
				return true;
			}, closeWindow);
		} catch {
			// Not in Tauri environment
		}
	}

	async function closeWindow() {
		const { getCurrentWindow } = await import('@tauri-apps/api/window');
		await getCurrentWindow().close();
	}

	function handleCancelClose() {
		showCloseDialog = false;
	}

	// ── Backup ──

	async function handleBackup() {
		if (!settings.savePath) {
			toast.error('No profile loaded');
			return;
		}
		try {
			await createBackup(settings.savePath);
			lastBackupTime = new Date();
			toast.success('Backup created');
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			toast.error(`Backup failed: ${message}`);
		}
	}

	// ── About Dialog ──

	let showAbout = $state(false);

	// ── Navigation ──

	const navItems = [
		{ href: '/heroes', label: 'Heroes', icon: UsersThreeIcon, isRaid: false, asset: 'campaign/town/buildings/stage_coach/stage_coach.upgraded_recruits.icon.png' },
		{ href: '/estate', label: 'Estate', icon: BankIcon, isRaid: false, asset: 'campaign/town/realm_inventory/realm_inventory.icon.png' },
		{ href: '/town', label: 'Town', icon: BuildingsIcon, isRaid: false, asset: 'campaign/town/activity_log/activity_log.icon.png' },
		{ href: '/raid', label: 'Raid', icon: CompassIcon, isRaid: true, asset: 'campaign/town/quest_select/quest_select.icon.png' },
		{ href: '/settings', label: 'Settings', icon: GearIcon, isRaid: false, asset: 'campaign/town/town_event/town_event.icon.png' }
	];

	const viewTitles: Record<string, string> = {
		'/heroes': 'Heroes',
		'/estate': 'Estate',
		'/town': 'Town',
		'/raid': 'Raid',
		'/settings': 'Settings'
	};

	let currentPath = $derived(page.url.pathname);
	let viewTitle = $derived(viewTitles[currentPath] ?? 'Hamlet Editor');
</script>

<svelte:window onkeydown={handleKeydown} />

<ModeWatcher />
<Toaster />
<ValidationDialog
	bind:open={showValidation}
	issues={validationIssues}
	onFixAll={() => finishValidation('fix')}
	onSaveAnyway={() => finishValidation('save')}
	onCancel={() => finishValidation('cancel')}
/>
<UnsavedChangesDialog
	bind:open={showCloseDialog}
	allowSave={!saveData.isStale}
	onSaveAndClose={handleSaveAndClose}
	onDiscardAndClose={handleDiscardAndClose}
	onCancel={handleCancelClose}
/>
<UnsavedChangesDialog
	bind:open={showChangeDialog}
	allowSave={changeCanSave && !saveData.isStale}
	saveLabel="Save"
	discardLabel="Discard"
	onSaveAndClose={() => finishUnsaved('save')}
	onDiscardAndClose={() => finishUnsaved('discard')}
	onCancel={() => finishUnsaved('cancel')}
/>
<DiscardConfirmDialog
	bind:open={showDiscardDialog}
	onConfirm={handleDiscard}
	onCancel={() => (showDiscardDialog = false)}
/>
<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<Dialog bind:open={showAbout}>
	<DialogContent class="sm:max-w-sm">
		<DialogHeader>
			<DialogTitle>Hamlet Editor</DialogTitle>
			<DialogDescription>{appVersion}</DialogDescription>
		</DialogHeader>
		<div class="space-y-3 text-sm text-muted-foreground">
			<p>A save editor for <em>Darkest Dungeon</em>.</p>
			<p class="text-xs leading-relaxed border border-border bg-muted/30 p-3">
				Hamlet Editor is an unofficial fan tool and is not affiliated with, endorsed by, or
				associated with Red Hook Studios. <em>Darkest Dungeon</em> is a registered trademark of
				Red Hook Studios Inc. Use at your own risk. Always back up your save files before editing.
			</p>
		</div>
	</DialogContent>
</Dialog>

{#if showSetupWizard}
	<SetupWizard />
{/if}

<SidebarProvider>
	<Sidebar>
		<SidebarHeader>
			<div class="flex items-center gap-2 px-2 py-1">
				<span class="text-lg font-bold tracking-tight">Hamlet Editor</span>
			</div>
			<!-- C5: Profile selector -->
			{#if settings.isSetupComplete && settings.profileId}
				<div class="px-2 pb-1">
					{#if sidebarSaveLocations.length > 1}
						<Select
							type="single"
							value={settings.savePath}
							disabled={isProfileLoading}
							onValueChange={handleSidebarProfileChange}
						>
							<SelectTrigger class="h-7 text-xs">
								<span class="text-xs">Profile: {settings.profileId}</span>
							</SelectTrigger>
							<SelectContent>
								{#each sidebarSaveLocations as loc (loc.path)}
									<SelectItem value={loc.path}>{loc.profile_id} · {loc.steam_user_id ?? loc.path}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
					{:else}
						<!-- Single profile or locations not yet detected — static display -->
						<div class="h-7 flex items-center px-3 text-xs text-muted-foreground border border-border bg-muted/20 rounded-sm">
							Profile: {settings.profileId}
						</div>
					{/if}
				</div>
			{/if}
		</SidebarHeader>

		<SidebarContent>
			<SidebarGroup>
				<SidebarGroupContent>
					<SidebarMenu>
						{#each navItems as item}
							<SidebarMenuItem>
								{#if item.isRaid}
									<!-- C4: Raid nav with conditional indicator/dim -->
									<SidebarMenuButton
										isActive={currentPath === item.href}
										class={!saveData.gameInRaid ? 'opacity-50' : ''}
									>
										{#snippet child({ props })}
											<a href={item.href} {...props} class:pointer-events-none={!saveData.gameInRaid} aria-disabled={!saveData.gameInRaid} tabindex={saveData.gameInRaid ? undefined : -1}>
												<span class="relative inline-flex">
													<GameAssetIcon gamePath={settings.gamePath} relativePath={item.asset} alt={item.label} class="size-10">
														{#snippet fallback()}<item.icon class="size-10" />{/snippet}
													</GameAssetIcon>
													{#if raidActive}
														<span class="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-500"></span>
													{/if}
												</span>
												<span>{item.label}</span>
											</a>
										{/snippet}
									</SidebarMenuButton>
								{:else}
									<SidebarMenuButton isActive={currentPath === item.href}>
										{#snippet child({ props })}
											<a href={item.href} {...props}>
												<GameAssetIcon gamePath={settings.gamePath} relativePath={item.asset} alt={item.label} class="size-10">
													{#snippet fallback()}<item.icon class="size-10" />{/snippet}
												</GameAssetIcon>
												<span>{item.label}</span>
											</a>
										{/snippet}
									</SidebarMenuButton>
								{/if}
							</SidebarMenuItem>
						{/each}
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>
		</SidebarContent>

		<SidebarFooter>
			<!-- C7: Last backup timestamp -->
			{#if lastBackupTime}
				<div class="px-2 pt-1">
					<span class="text-xs text-muted-foreground">
						Last backup: {lastBackupTime.toLocaleTimeString()}
					</span>
				</div>
			{/if}
			<div class="flex items-center justify-between px-2">
				<Tooltip>
					<TooltipTrigger>
						<Button variant="ghost" size="icon" onclick={toggleMode}>
							<SunIcon class="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
							<MoonIcon class="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
							<span class="sr-only">Toggle theme</span>
						</Button>
					</TooltipTrigger>
					<TooltipContent>Toggle dark/light mode</TooltipContent>
				</Tooltip>
				<div class="flex items-center gap-1">
					<Tooltip>
						<TooltipTrigger>
							<Button variant="ghost" size="icon" onclick={() => (showAbout = true)}>
								<InfoIcon class="h-4 w-4" />
								<span class="sr-only">About</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent>About Hamlet Editor</TooltipContent>
					</Tooltip>
					<span class="text-xs text-muted-foreground">{appVersion}</span>
				</div>
			</div>
		</SidebarFooter>

		<SidebarRail />
	</Sidebar>

	<SidebarInset>
		<header class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
			<SidebarTrigger class="-ml-1" />
			<Separator orientation="vertical" class="mr-2 h-4" />
			<h1 class="text-sm font-semibold">{viewTitle}</h1>

			<div class="ml-auto flex items-center gap-2">
				<!-- Game Running Badge -->
				{#if gameRunning}
					<Badge variant="destructive" class="gap-1">
						<span class="h-2 w-2 animate-pulse rounded-full bg-red-400"></span>
						DD Running: Save Blocked
					</Badge>
				{:else if gameDetectionUncertain}
					<Badge variant="outline" class="gap-1 border-amber-500 text-amber-600 dark:text-amber-400">
						<span class="h-2 w-2 animate-pulse rounded-full bg-amber-500"></span>
						Game Status Unknown: Save Blocked
					</Badge>
				{/if}

				{#if saveData.isStale}
					<Badge variant="outline">Profile stale: Reload required</Badge>
					<Button variant="outline" size="sm" disabled={isSaving || saveData.isLoading || isGameBlocking} onclick={reloadProfile}>Reload</Button>
				{/if}

				<!-- C2: Modded content -->
				{#if hasModdedContent}
					<Badge variant="outline" class="gap-1 border-amber-500 text-amber-600 dark:text-amber-400">
						<span class="h-2 w-2 rounded-full bg-amber-500"></span>
						Modded Content
					</Badge>
				{/if}

				<!-- Mod count badge -->
				{#if modCount !== null && modCount > 0}
					<Badge variant="outline" class="gap-1">
						{modCount} mod{modCount === 1 ? '' : 's'}
					</Badge>
				{/if}

				<!-- C3: Raid status -->
				{#if raidActive}
					<Badge variant="outline" class="gap-1 border-amber-500 text-amber-600 dark:text-amber-400">
						<span class="h-2 w-2 rounded-full bg-amber-500"></span>
						Raid Active
					</Badge>
				{:else if raidInconsistent}
					<Badge variant="outline" class="gap-1 border-amber-500 text-amber-600 dark:text-amber-400">
						<span class="h-2 w-2 animate-pulse rounded-full bg-amber-500"></span>
						Raid State Inconsistent
					</Badge>
				{/if}

				<!-- Discard Button -->
				{#if isDirty}
					<Tooltip>
						<TooltipTrigger>
							<Button
								variant="ghost"
								size="sm"
								disabled={isSaving}
								onclick={() => (showDiscardDialog = true)}
							>
								<ArrowCounterClockwiseIcon size={16} class="mr-1" />
								Discard
							</Button>
						</TooltipTrigger>
						<TooltipContent>Discard all unsaved changes (Ctrl/Cmd+Shift+Z)</TooltipContent>
					</Tooltip>
				{/if}

				<!-- Save Button -->
				<Tooltip>
					<TooltipTrigger>
						<Button
							variant="outline"
							size="sm"
							disabled={saveDisabled}
							onclick={handleSave}
							class="relative"
							aria-label={isDirty ? 'Unsaved changes. Save all changes.' : 'Save'}
						>
							{#if isSaving}
								<CircleNotchIcon size={16} class="mr-1 animate-spin" />
								Saving...
							{:else}
								<FloppyDiskIcon size={16} class="mr-1" />
								Save
							{/if}
							<!-- Orange dot for unsaved changes -->
							{#if isDirty && !isSaving}
								<span
									class="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-orange-500"
									aria-label="Unsaved changes"
								></span>
							{/if}
						</Button>
					</TooltipTrigger>
					<TooltipContent>{saveTooltip}</TooltipContent>
				</Tooltip>

				<!-- Backup Button -->
				<Tooltip>
					<TooltipTrigger>
						<Button
							variant="ghost"
							size="sm"
							disabled={!saveData.isLoaded}
							onclick={handleBackup}
						>
							<ArchiveIcon size={16} class="mr-1" />
							Backup
						</Button>
					</TooltipTrigger>
					<TooltipContent>{saveData.isLoaded ? 'Create manual backup (Ctrl/Cmd+B)' : 'No profile loaded'}</TooltipContent>
				</Tooltip>
			</div>
		</header>

		<main inert={isSaving} class="min-h-0 flex-1 overflow-hidden p-4">
			{@render children()}
		</main>
	</SidebarInset>
</SidebarProvider>

{#if isProfileLoading}
	<LoadingScreen status="Loading profile..." />
{/if}
