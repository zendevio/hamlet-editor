<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import { toast } from 'svelte-sonner';
	import { mergeProps } from 'bits-ui';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, setContext, tick, type Component } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import Message from '#lib/i18n/Message.svelte';
	import { formatDate, formatNumber } from '#lib/i18n/intl.js';
	import { getEditorLocale, t, describeMessage } from '#lib/i18n/index.svelte.js';
	import { isStaleSaveError, type MessageDescriptor } from '#lib/errors.js';
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
	import { getSettings, initializeSettings, setSavePath, setProfileId } from '#lib/stores/settings.svelte.js';
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
	import { setQuirks, setTrinkets, setClassStats, setClassSkills, setRosterCapacityRules } from '#lib/stores/game-data.svelte.js';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '#lib/components/ui/select/index.js';
	import { isGameRunning, detectSaveLocations, type SaveLocation } from '#lib/api/detect.js';
	import { saveProfile } from '#lib/api/save.js';
	import { createBackup } from '#lib/api/backup.js';
	import { openProjectLink, type ProjectLink } from '#lib/api/links.js';
	import { getGameTextState, requestGameText } from '#lib/stores/game-text.svelte.js';
	import { GAME_TEXT_LANGUAGES } from '#lib/data/game-text-languages.js';
	import { showPersistentError, showError, dismissError } from '#lib/i18n/notifications.js';
	import { ensureNameTable } from '#lib/api/names.js';
	import { loadQuirkLibrary, loadTrinketLibrary, loadClassStats, loadClassSkills, loadRosterCapacityRules } from '#lib/api/gamedata.js';
	import { scanModDirectories } from '#lib/api/mods.js';
	import { runPreSaveValidation, type ValidationIssue } from '#lib/validation.js';

	let { children } = $props();

	let appVersion = $state<string | null>(null);

	const settings = getSettings();
	const saveData = getSaveData();
	let showSetupWizard = $derived(settings.ready && !settings.isSetupComplete && page.url.pathname !== '/settings');
	let HarnessFixture = $state<Component<{ showLanguageControls: boolean }> | null>(null);
	onMount(() => {
		void initializeSettings().then(async () => {
			await tick();
			for (const [index, notice] of settings.startupNotices.entries()) {
				if (notice.error !== undefined) showError(notice.error, notice, `settings-startup-${index}`);
				else showPersistentError(notice, notice.detail, `settings-startup-${index}`);
			}
		});
		if (import.meta.env.DEV && new URL(window.location.href).searchParams.has('h1') && !new URL(window.location.href).searchParams.has('overflow')) {
			void import('#lib/dev/InvariantFixture.svelte').then((module) => { HarnessFixture = module.default; });
		}
	});
	$effect(() => {
		const locale = getEditorLocale();
		document.documentElement.lang = locale;
		document.documentElement.classList.toggle('cjk', ['zh-Hans', 'ja', 'ko'].includes(locale));
		if (settings.ready) void invoke('set_native_menu_language', { locale }).catch((error) => console.warn('Native menu language failed', error));
	});
	$effect(() => {
		if (settings.ready && settings.persistenceFailed) showPersistentError({ id: 'settings.persistenceFailed' }, '', 'settings-persistence');
		else dismissError('settings-persistence');
	});

	// ── Game Running Detection ──

	let gameRunning = $state(false);
	let gameDetectionUncertain = $state(false);
	let isSaving = $state(false);
	let isProfileLoading = $state(false);
	let attemptedProfile = $state('');
	let modCount = $state<number | null>(null);

	// ── Profile Selector ──

	// Detected save locations; populated once on first successful setup.
	let sidebarSaveLocations = $state<SaveLocation[]>([]);

	/** Switch to a different profile from the sidebar selector. */
	async function openLink(event: MouseEvent, link: ProjectLink) {
		event.preventDefault();
		try {
			await openProjectLink(link);
		} catch (err) {
			showError(err, { id: 'error.unexpected' });
		}
	}

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
				toast.success(t('settings.profileLoaded'), { description: t('settings.profileSwitched', { profile: loc.profile_id }) });
			} catch (err) {
				showError(err, { id: 'error.profileSwitchFailed' });
			} finally {
				isProfileLoading = false;
			}
		});
	}

	// ── Profile Loading ──

	// ── Name table + localization + mod-scan pipeline ──

	$effect(() => { if (settings.ready) return requestGameText(settings.gamePath, settings.gameTextLanguage); });
	const gameText = getGameTextState();
	let notifiedGameTextRequest = 0;
	$effect(() => {
		if (!gameText.error) {
			dismissError('game-text-load');
			return;
		}
		if (gameText.failedRequest === notifiedGameTextRequest) return;
		notifiedGameTextRequest = gameText.failedRequest;
		showError(gameText.errorCause, { id: 'settings.gameTextFailed', params: {
			requested: GAME_TEXT_LANGUAGES[gameText.requestedLanguage],
			effective: GAME_TEXT_LANGUAGES[gameText.effectiveLanguage]
		} }, 'game-text-load');
	});

	async function initGameData(gamePath: string) {
		// 1. Generate name table from game files and push to Rust state.
		await ensureNameTable(gamePath);

		// 2. Load quirk, trinket, class stats, and class skills definitions from game files.
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

		// 3. Scan mod directories and surface the count.
		const mods = await scanModDirectories(gamePath);
		modCount = mods.length;
		if (mods.length > 0) {
			toast.info(t('shell.modsDetected', { count: mods.length, countText: formatNumber(mods.length) }));
		}
	}

	// When setup completes (or was already complete on startup), load the profile,
	// with the shared name-table barrier, then load game libraries. Display localization loads independently.
	// Also detect save locations to populate the sidebar profile selector.
	$effect(() => {
		if (!settings.ready) return;
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
					// Non-fatal; sidebar selector will show current profile only
				});

			loadProfileFromBackend(settings.savePath)
				.then(() => {
					if (settings.gamePath) {
						return initGameData(settings.gamePath);
					}
				})
				.catch((err) => {
					showError(err, { id: 'error.profileLoadFailed' });
				})
				.finally(() => {
					isProfileLoading = false;
				});
		}
	});

	// Poll game running status every 5 seconds
	$effect(() => {
		if (!settings.ready) return;
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
	let saveBlocked = $derived(saveBlockReason());
	let saveDisabled = $derived(isSaving || saveBlocked !== null);

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
		if (saveBlocked?.id === 'error.profile_not_loaded') {
			return t(saveData.isLoading || isProfileLoading ? 'shell.loadingProfile' : 'shell.noProfile');
		}
		if (saveBlocked && saveBlocked.id !== 'error.save_no_changes') return describeMessage(saveBlocked);
		if (isSaving) return t('shell.saving');
		return saveBlocked ? describeMessage(saveBlocked) : t('shell.saveAll');
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
		).catch(() => { appVersion = null; });

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
			requestDiscard();
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
		// before the WebView acts on it; no Tauri config changes needed.
		if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
			e.preventDefault();
			// Ctrl+R reserved; no action (prevents WebView reload)
		}
	}

	// ── Save Flow ──

	function saveBlockReason(): MessageDescriptor | null {
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
		saved: () => { clearAllDirty(); toast.success(t('shell.saved')); },
		failed: (error) => {
			if (isStaleSaveError(error)) markProfileStale();
			showError(error, { id: 'error.saveFailed' });
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
		failed: (error) => showError(error, { id: 'error.reloadFailed' })
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

	function requestDiscard() {
		if (isDirty && !isSaving) showDiscardDialog = true;
	}

	function handleDiscard() {
		if (isSaving) return;
		discardAllChanges();
		showDiscardDialog = false;
		toast.info(t('shell.discarded'));
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
		if (!saveData.isLoaded) return;
		if (!settings.savePath) {
			toast.error(t('shell.noProfile'));
			return;
		}
		try {
			await createBackup(settings.savePath);
			lastBackupTime = new Date();
			toast.success(t('settings.backupCreated'));
		} catch (err) {
			showError(err, { id: 'error.backupFailed' });
		}
	}

	// ── About Dialog ──

	let showAbout = $state(false);

	// ── Navigation ──

	const navItems = [
		{ href: '/heroes', label: 'shell.heroes', icon: UsersThreeIcon, isRaid: false, asset: 'campaign/town/buildings/stage_coach/stage_coach.upgraded_recruits.icon.png' },
		{ href: '/estate', label: 'shell.estate', icon: BankIcon, isRaid: false, asset: 'campaign/town/realm_inventory/realm_inventory.icon.png' },
		{ href: '/town', label: 'shell.town', icon: BuildingsIcon, isRaid: false, asset: 'campaign/town/activity_log/activity_log.icon.png' },
		{ href: '/raid', label: 'shell.raid', icon: CompassIcon, isRaid: true, asset: 'campaign/town/quest_select/quest_select.icon.png' },
		{ href: '/settings', label: 'shell.settings', icon: GearIcon, isRaid: false, asset: 'campaign/town/town_event/town_event.icon.png' }
	] as const;

	let currentPath = $derived(page.url.pathname);
	let viewTitle = $derived.by(() => {
		const item = navItems.find((item) => item.href === currentPath);
		return item ? t(item.label) : 'Hamlet Editor';
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<ModeWatcher />
{#if !settings.ready}
	<div data-testid="startup-shell" class="fixed inset-0 bg-background"></div>
{:else}
<Toaster expand visibleToasts={Infinity} />
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
	saveLabel={{ id: 'shell.save' }}
	discardLabel={{ id: 'shell.discard' }}
	onSaveAndClose={() => finishUnsaved('save')}
	onDiscardAndClose={() => finishUnsaved('discard')}
	onCancel={() => finishUnsaved('cancel')}
/>
<DiscardConfirmDialog
	bind:open={showDiscardDialog}
	onConfirm={handleDiscard}
	onCancel={() => (showDiscardDialog = false)}
/>

<Dialog bind:open={showAbout}>
	<DialogContent class="sm:max-w-sm">
		<DialogHeader>
			<DialogTitle>Hamlet Editor</DialogTitle>
			<DialogDescription>{appVersion ?? t('settings.developmentVersion')}</DialogDescription>
		</DialogHeader>
		<div class="space-y-3 text-sm text-muted-foreground">
			<p>
				<Message id="shell.aboutSummary" params={{}}>
					{#snippet emphasis(children)}<em>{@render children()}</em>{/snippet}
					{#snippet code(children)}<code>{@render children()}</code>{/snippet}
					{#snippet link(children)}<span>{@render children()}</span>{/snippet}
				</Message>
			</p>
			<p>
				<Message id="shell.translationDisclosure" params={{}}>
					{#snippet emphasis(children)}<em>{@render children()}</em>{/snippet}
					{#snippet code(children)}<code>{@render children()}</code>{/snippet}
					{#snippet link(children)}<a href="https://github.com/zendevio/hamlet-editor/issues" class="underline" onclick={(event) => openLink(event, 'issues')} onauxclick={(event) => event.button === 1 && openLink(event, 'issues')}>{@render children()}</a>{/snippet}
				</Message>
			</p>
			<p class="text-xs leading-relaxed border border-border bg-muted/30 p-3">
				<Message id="shell.aboutDisclaimer" params={{}}>
					{#snippet emphasis(children)}<em>{@render children()}</em>{/snippet}
					{#snippet code(children)}<code>{@render children()}</code>{/snippet}
					{#snippet link(children)}<span>{@render children()}</span>{/snippet}
				</Message>
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
			{#if settings.isSetupComplete && settings.savePath}
				<div class="px-2 pb-1">
					{#if sidebarSaveLocations.length > 1}
						<Select
							type="single"
							value={settings.savePath}
							disabled={isProfileLoading}
							onValueChange={handleSidebarProfileChange}
						>
							<SelectTrigger class="h-7 text-xs">
								<span class="text-xs">{t('shell.profile', { profile: settings.profileId || t('profiles.current') })}</span>
							</SelectTrigger>
							<SelectContent>
								{#each sidebarSaveLocations as loc (loc.path)}
									<SelectItem value={loc.path}>{t('shell.profileOption', { profile: loc.profile_id || t('profiles.current'), location: loc.steam_user_id ?? loc.path })}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
					{:else}
						<!-- Single profile or locations not yet detected; static display -->
						<div class="h-7 flex items-center px-3 text-xs text-muted-foreground border border-border bg-muted/20 rounded-sm">
							{t('shell.profile', { profile: settings.profileId || t('profiles.current') })}
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
													<GameAssetIcon gamePath={settings.gamePath} relativePath={item.asset} alt={t(item.label)} class="size-10">
														{#snippet fallback()}<item.icon class="size-10" />{/snippet}
													</GameAssetIcon>
													{#if raidActive}
														<span class="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-500"></span>
													{/if}
												</span>
												<span>{t(item.label)}</span>
											</a>
										{/snippet}
									</SidebarMenuButton>
								{:else}
									<SidebarMenuButton isActive={currentPath === item.href}>
										{#snippet child({ props })}
											<a href={item.href} {...props}>
												<GameAssetIcon gamePath={settings.gamePath} relativePath={item.asset} alt={t(item.label)} class="size-10">
													{#snippet fallback()}<item.icon class="size-10" />{/snippet}
												</GameAssetIcon>
												<span>{t(item.label)}</span>
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
						{t('shell.lastBackup', { time: formatDate(lastBackupTime, { hour: 'numeric', minute: '2-digit', second: '2-digit' }) })}
					</span>
				</div>
			{/if}
			<div class="flex items-center justify-between px-2">
				<Tooltip>
					<TooltipTrigger>
						{#snippet child({ props })}
							<Button {...mergeProps(props, { onclick: toggleMode })} variant="ghost" size="icon">
								<SunIcon class="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
								<MoonIcon class="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
								<span class="sr-only">{t('shell.toggleTheme')}</span>
							</Button>
					{/snippet}
					</TooltipTrigger>
					<TooltipContent>{t('shell.toggleThemeHelp')}</TooltipContent>
				</Tooltip>
				<div class="flex items-center gap-1">
					<Tooltip>
						<TooltipTrigger>
							{#snippet child({ props })}
								<Button {...mergeProps(props, { onclick: () => (showAbout = true) })} variant="ghost" size="icon">
									<InfoIcon class="h-4 w-4" />
									<span class="sr-only">{t('settings.about')}</span>
								</Button>
						{/snippet}
						</TooltipTrigger>
						<TooltipContent>{t('shell.aboutHelp')}</TooltipContent>
					</Tooltip>
					<span class="text-xs text-muted-foreground">{appVersion ?? t('settings.developmentVersion')}</span>
				</div>
			</div>
		</SidebarFooter>

		<SidebarRail />
	</Sidebar>

	<SidebarInset>
		<header class="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5">
			<SidebarTrigger class="-ml-1" />
			<!-- Stretch, not h-full: a percentage height inside this wrapping header
			     inflates the first row and pushes wrapped actions below the border. -->
			<Separator orientation="vertical" class="-my-1.5 mr-2 self-stretch data-[orientation=vertical]:h-auto" />
			<h1 class="text-sm font-semibold">{viewTitle}</h1>

			<div class="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
				<!-- Game Running Badge -->
				{#if gameRunning}
					<Badge variant="destructive" class="gap-1">
						<span class="h-2 w-2 animate-pulse rounded-full bg-red-400"></span>
						{t('shell.gameRunning')}
					</Badge>
				{:else if gameDetectionUncertain}
					<Badge variant="outline" class="gap-1 border-amber-500 text-amber-600 dark:text-amber-400">
						<span class="h-2 w-2 animate-pulse rounded-full bg-amber-500"></span>
						{t('shell.gameUnknown')}
					</Badge>
				{/if}

				{#if saveData.isStale}
					<Badge variant="outline">{t('shell.stale')}</Badge>
					<Button variant="outline" size="sm" disabled={isSaving || saveData.isLoading || isGameBlocking} onclick={reloadProfile}>{t('shell.reload')}</Button>
				{/if}

				<!-- C2: Modded content -->
				{#if hasModdedContent}
					<Badge variant="outline" class="gap-1 border-amber-500 text-amber-600 dark:text-amber-400">
						<span class="h-2 w-2 rounded-full bg-amber-500"></span>
						{t('shell.modded')}
					</Badge>
				{/if}

				<!-- Mod count badge -->
				{#if modCount !== null && modCount > 0}
					<Badge variant="outline" class="gap-1">
						{t('shell.mods', { count: modCount, countText: formatNumber(modCount) })}
					</Badge>
				{/if}

				<!-- C3: Raid status -->
				{#if raidActive}
					<Badge variant="outline" class="gap-1 border-amber-500 text-amber-600 dark:text-amber-400">
						<span class="h-2 w-2 rounded-full bg-amber-500"></span>
						{t('shell.raidActive')}
					</Badge>
				{:else if raidInconsistent}
					<Badge variant="outline" class="gap-1 border-amber-500 text-amber-600 dark:text-amber-400">
						<span class="h-2 w-2 animate-pulse rounded-full bg-amber-500"></span>
						{t('shell.raidInconsistent')}
					</Badge>
				{/if}

				<!-- Discard Button -->
				{#if isDirty}
					<Tooltip>
						<TooltipTrigger>
							{#snippet child({ props })}
								<Button {...mergeProps(props, { onclick: requestDiscard })}
									variant="ghost"
									size="sm"
									aria-disabled={isSaving}
									class="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
								>
									<ArrowCounterClockwiseIcon size={16} class="mr-1" />
									{t('shell.discard')}
								</Button>
						{/snippet}
						</TooltipTrigger>
						<TooltipContent>{t('shell.discardHelp')}</TooltipContent>
					</Tooltip>
				{/if}

				<!-- Save Button -->
				<Tooltip>
					<TooltipTrigger>
						{#snippet child({ props })}
							<Button {...mergeProps(props, { onclick: handleSave })}
								variant="outline"
								size="sm"
								aria-disabled={saveDisabled}
								class="relative aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
								aria-label={t(isDirty ? 'shell.dirtySave' : 'shell.save')}
							>
								{#if isSaving}
									<CircleNotchIcon size={16} class="mr-1 animate-spin" />
									{t('shell.saving')}
								{:else}
									<FloppyDiskIcon size={16} class="mr-1" />
									{t('shell.save')}
								{/if}
								<!-- Orange dot for unsaved changes -->
								{#if isDirty && !isSaving}
									<span
										class="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-orange-500"
										aria-label={t('shell.unsaved')}
									></span>
								{/if}
							</Button>
					{/snippet}
					</TooltipTrigger>
					<TooltipContent>{saveTooltip}</TooltipContent>
				</Tooltip>

				<!-- Backup Button -->
				<Tooltip>
					<TooltipTrigger>
						{#snippet child({ props })}
							<Button {...mergeProps(props, { onclick: handleBackup })}
								variant="ghost"
								size="sm"
								aria-disabled={!saveData.isLoaded}
								class="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
							>
								<ArchiveIcon size={16} class="mr-1" />
								{t('shell.backup')}
							</Button>
					{/snippet}
					</TooltipTrigger>
					<TooltipContent>{t(saveData.isLoaded ? 'shell.backupHelp' : 'shell.noProfile')}</TooltipContent>
				</Tooltip>
			</div>
		</header>

		<main inert={isSaving} class="min-h-0 flex-1 overflow-hidden p-4">
			{#if HarnessFixture}<HarnessFixture showLanguageControls={currentPath !== '/settings'} />{/if}
			{@render children()}
		</main>
	</SidebarInset>
</SidebarProvider>

{#if isProfileLoading}
	<LoadingScreen status={{ id: 'shell.loadingProfile' }} />
{/if}

{/if}
