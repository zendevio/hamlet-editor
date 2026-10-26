<script lang="ts">
	import { mergeProps } from 'bits-ui';
	import ErrorMessage from '#lib/i18n/ErrorMessage.svelte';
	import Message from '#lib/i18n/Message.svelte';
	import LanguageSettings from '#lib/components/LanguageSettings.svelte';
	import { getEditorLocale, t } from '#lib/i18n/index.svelte.js';
	import { formatDate, formatNumber } from '#lib/i18n/intl.js';
	import { showError } from '#lib/i18n/notifications.js';
	import { commitChangedValue } from '#lib/control-events.js';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '#lib/components/ui/select/index.js';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '#lib/components/ui/dialog/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import { ScrollArea } from '#lib/components/ui/scroll-area/index.js';
	import { Tooltip, TooltipContent, TooltipTrigger } from '#lib/components/ui/tooltip/index.js';
	import {
		getSettings,
		setGamePath,
		setSavePath,
		setProfileId,
		setAutoBackup
	} from '#lib/stores/settings.svelte.js';
	import { runRestore, isRestoreBlocked, restoreOutcome } from '#lib/restore-workflow.js';
	import { withCurrentProfile } from '#lib/profiles.js';
	import { getSaveData, loadProfileFromBackend } from '#lib/stores/save-data.svelte.js';
	import {
		detectGameInstallations,
		detectSaveLocations,
		type GameInstall,
		type SaveLocation
	} from '#lib/api/detect.js';
	import {
		createBackup,
		listBackups,
		openBackupFolder,
		checkRestore,
		type RestoreCheck,
		restoreBackup,
		restoreGameBackup,
		type BackupEntry
	} from '#lib/api/backup.js';
	import { toggleMode, mode } from 'mode-watcher';
	import { toast } from 'svelte-sonner';
	import { onMount, getContext } from 'svelte';
	import { DATA_CHANGE_CONTEXT, type RequestDataChange } from '#lib/save-workflow.js';

	// Phosphor icons
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import XCircleIcon from 'phosphor-svelte/lib/XCircleIcon';
	import SpinnerIcon from 'phosphor-svelte/lib/SpinnerIcon';
	import ArchiveIcon from 'phosphor-svelte/lib/ArchiveIcon';
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import ClockIcon from 'phosphor-svelte/lib/ClockIcon';
	import SunIcon from 'phosphor-svelte/lib/SunIcon';
	import MoonIcon from 'phosphor-svelte/lib/MoonIcon';
	import InfoIcon from 'phosphor-svelte/lib/InfoIcon';
	import GithubLogoIcon from 'phosphor-svelte/lib/GithubLogoIcon';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';

	// ── State ──

	const requestDataChange = getContext<RequestDataChange>(DATA_CHANGE_CONTEXT);
	const settings = getSettings();
	const saveData = getSaveData();
	let appVersion = $state<string | null>(null);

	onMount(async () => {
		detectingSaves = true;
		try {
			saveLocations = await detectSaveLocations();
		} finally {
			detectingSaves = false;
		}
		try {
			const { getVersion } = await import('@tauri-apps/api/app');
			appVersion = 'v' + await getVersion();
		} catch {
			// Not in Tauri runtime (browser dev mode)
			appVersion = null;
		}
	});

	// Path detection
	let detectingGame = $state(false);
	let detectingSaves = $state(false);
	let gameInstalls = $state<GameInstall[]>([]);
	let saveLocations = $state<SaveLocation[]>([]);
	let gamePathValid = $state<boolean | null>(null);
	let savePathValid = $state<boolean | null>(null);

	// Backups
	let backups = $state<BackupEntry[]>([]);
	let loadingBackups = $state(false);
	let creatingBackup = $state(false);
	let restoringBackup = $state<string | null>(null);

	// Restore confirmation dialog
	let restoreDialogOpen = $state(false);
	let restoreTarget = $state<BackupEntry | null>(null);
	let restoreConfirmChecked = $state(false);

	// Restore game backup dialog
	let restoreGameBackupDialogOpen = $state(false);
	let restoreGameBackupConfirmChecked = $state(false);
	let restoringGameBackup = $state(false);

	// ── Derived ──

	let availableSaveLocations = $derived(
		withCurrentProfile(saveLocations, settings.savePath, settings.profileId, saveData.gameInRaid)
	);
	let profileOptions = $derived.by(() => {
		return availableSaveLocations.map((loc) => ({
			id: loc.path,
			label: t('shell.profileOption', { profile: loc.profile_id || t('profiles.current'), location: loc.steam_user_id ?? loc.path }),
			hasRaid: loc.has_active_raid,
			source: loc.source
		}));
	});

	// mode.current is reactive (Svelte 5 box pattern from mode-watcher)

	// ── Actions: Path Detection ──

	async function autoDetectGame() {
		if (detectingGame) return;
		detectingGame = true;
		gamePathValid = null;
		try {
			gameInstalls = await detectGameInstallations();
			if (gameInstalls.length > 0) {
				if (!await changeGamePath(gameInstalls[0].path)) return;
				gamePathValid = true;
				toast.success(t('settings.gameDetected'), {
					description: gameInstalls[0].path
				});
			} else {
				gamePathValid = false;
				toast.error(t('settings.noGame'), {
					description: t('settings.browseHelp')
				});
			}
		} catch {
			gamePathValid = false;
			toast.error(t('settings.detectionFailed'));
		} finally {
			detectingGame = false;
		}
	}

	async function autoDetectSaves() {
		if (detectingSaves) return;
		detectingSaves = true;
		savePathValid = null;
		try {
			saveLocations = await detectSaveLocations();
			if (saveLocations.length > 0) {
				const current = saveLocations.find((loc) => loc.path === settings.savePath) ?? saveLocations[0];
				await handleProfileChange(current.path);
				savePathValid = true;
				toast.success(t('settings.savesDetected'), {
					description: t('settings.profilesFound', { count: saveLocations.length })
				});
			} else {
				savePathValid = false;
				toast.error(t('settings.noSaves'), {
					description: t('settings.browseHelp')
				});
			}
		} catch {
			savePathValid = false;
			toast.error(t('settings.detectionFailed'));
		} finally {
			detectingSaves = false;
		}
	}

	async function handleBrowseGame() {
		try {
			const { open } = await import('@tauri-apps/plugin-dialog');
			const selected = await open({ directory: true, title: t('settings.gamePanel') });
			if (selected && typeof selected === 'string') {
				if (!await changeGamePath(selected)) return;
				gamePathValid = null;
			}
		} catch (err) {
			showError(err, { id: 'settings.gameLoadFailed' });
		}
	}

	async function handleBrowseSave() {
		try {
			const { open } = await import('@tauri-apps/plugin-dialog');
			const selected = await open({ directory: true, title: t('settings.savePanel') });
			if (selected && typeof selected === 'string') {
				if (!await changeProfilePath(selected, selected.split(/[\\/]/).filter(Boolean).at(-1) ?? '')) return;
				savePathValid = null;
			}
		} catch (err) {
			showError(err, { id: 'settings.profileLoadFailed' });
		}
	}

	async function changeGamePath(path: string): Promise<boolean> {
		if (path === settings.gamePath) return true;
		return requestDataChange(async () => {
			setGamePath(path);
			if (settings.savePath) await loadProfileFromBackend(settings.savePath);
		});
	}

	async function changeProfilePath(path: string, profileId: string): Promise<boolean> {
		if (path === settings.savePath && profileId === settings.profileId) return true;
		return requestDataChange(async () => {
			setSavePath(path);
			setProfileId(profileId);
			await loadProfileFromBackend(path);
		});
	}

	async function handleProfileChange(value: string) {
		if (value === settings.savePath) return;
		const loc = availableSaveLocations.find((l) => l.path === value);
		if (!loc) return;
		try {
			if (await changeProfilePath(loc.path, loc.profile_id)) {
				toast.success(t('settings.profileLoaded'), { description: t('settings.profileSwitched', { profile: loc.profile_id || t('profiles.current') }) });
			}
		} catch (err) {
			showError(err, { id: 'settings.profileFailed' });
		}
	}

	// ── Actions: Backups ──

	async function loadBackupList() {
		if (!settings.savePath) return;
		loadingBackups = true;
		try {
			backups = await listBackups(settings.savePath);
		} catch {
			backups = [];
		} finally {
			loadingBackups = false;
		}
	}

	async function handleCreateBackup() {
		if (!settings.savePath) return;
		creatingBackup = true;
		try {
			await createBackup(settings.savePath);
			toast.success(t('settings.backupCreated'));
			await loadBackupList();
		} catch (err) {
			showError(err, { id: 'settings.backupFailed' });
		} finally {
			creatingBackup = false;
		}
	}

	async function handleOpenBackupFolder() {
		try {
			await openBackupFolder();
		} catch (err) {
			showError(err, { id: 'settings.openBackupFailed' });
		}
	}

	let restoreCheck = $state<RestoreCheck | null>(null);
	let gameRestoreCheck = $state<RestoreCheck | null>(null);
	let checkingRestore = $state(false);

	async function openRestoreDialog(backup: BackupEntry) {
		if (checkingRestore) return;
		checkingRestore = true;
		try {
			restoreCheck = await checkRestore(backup.path, settings.savePath);
		} catch (err) {
			showError(err, { id: 'settings.restoreUnavailable' });
			return;
		} finally {
			checkingRestore = false;
		}
		restoreTarget = backup;
		restoreConfirmChecked = false;
		restoreDialogOpen = true;
	}

	/** Re-run the preflight for an open dialog; a result that arrives after Cancel is dropped. */
	async function recheckRestore(game: boolean) {
		const backupPath = game ? null : restoreTarget?.path;
		if (checkingRestore || backupPath === undefined) return;
		checkingRestore = true;
		try {
			const check = await checkRestore(backupPath, settings.savePath);
			if (game ? !restoreGameBackupDialogOpen : !restoreDialogOpen) return;
			if (game) {
				gameRestoreCheck = check;
				restoreGameBackupConfirmChecked = false;
			} else {
				restoreCheck = check;
				restoreConfirmChecked = false;
			}
		} catch (err) {
			showError(err, { id: 'settings.restoreUnavailable' });
		} finally {
			checkingRestore = false;
		}
	}

	async function handleRestore() {
		if (!restoreTarget || !settings.savePath) return;
		restoringBackup = restoreTarget.path;
		restoreDialogOpen = false;
		try {
			const target = restoreTarget;
			const profilePath = settings.savePath;
			if (!await runRestore({
				check: () => checkRestore(target.path, profilePath),
				checked: (check) => { restoreCheck = check; },
				blocked: () => { restoreDialogOpen = true; },
				requestDataChange,
				restore: () => restoreBackup(target.path, profilePath),
				reload: () => loadProfileFromBackend(profilePath)
			})) return;
			toast.success(t('settings.backupRestored'), {
				description: t('settings.restoredFrom', { timestamp: formatTimestamp(restoreTarget.timestamp) })
			});
			await loadBackupList();
		} catch (err) {
			showError(err, { id: 'settings.restoreFailed' });
		} finally {
			restoringBackup = null;
			if (!restoreDialogOpen) restoreTarget = null;
			restoreConfirmChecked = false;
		}
	}

	async function openRestoreGameBackupDialog() {
		if (checkingRestore) return;
		checkingRestore = true;
		try {
			gameRestoreCheck = await checkRestore(null, settings.savePath);
		} catch (err) {
			showError(err, { id: 'settings.restoreUnavailable' });
			return;
		} finally {
			checkingRestore = false;
		}
		restoreGameBackupConfirmChecked = false;
		restoreGameBackupDialogOpen = true;
	}

	async function handleRestoreGameBackup() {
		if (!settings.savePath) return;
		restoringGameBackup = true;
		restoreGameBackupDialogOpen = false;
		try {
			const profilePath = settings.savePath;
			if (!await runRestore({
				check: () => checkRestore(null, profilePath),
				checked: (check) => { gameRestoreCheck = check; },
				blocked: () => { restoreGameBackupDialogOpen = true; },
				requestDataChange,
				restore: () => restoreGameBackup(profilePath),
				reload: () => loadProfileFromBackend(profilePath)
			})) return;
			toast.success(t('settings.gameBackupRestored'), {
				description: t('settings.gameBackupRestoredHelp')
			});
			await loadBackupList();
		} catch (err) {
			showError(err, { id: 'settings.restoreFailed' });
		} finally {
			restoringGameBackup = false;
			restoreGameBackupConfirmChecked = false;
		}
	}

	// ── Helpers ──

	function formatTimestamp(iso: string): string {
		return formatDate(iso, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	function restoreSummary(check: RestoreCheck | null): string {
		const outcome = restoreOutcome(check);
		return outcome ? t(outcome.id, { ...outcome.params, addsText: formatNumber(outcome.params.adds) }) : '';
	}

	function profileSource(source: string): string {
		const keys: Record<string, 'settings.sourceSteam' | 'settings.sourceGog' | 'settings.sourceEpic' | 'settings.sourceManual'> = { Steam: 'settings.sourceSteam', Gog: 'settings.sourceGog', Epic: 'settings.sourceEpic', Manual: 'settings.sourceManual' };
		return keys[source] ? t(keys[source]) : source;
	}

	// Load backup list on mount if path is set
	$effect(() => {
		if (settings.savePath) {
			loadBackupList();
		}
	});
	// Sizes a readonly path field to its full text. Native field-sizing covers
	// paths where supported; an empty field is always measured against its
	// placeholder because WebKit leaves placeholders out of field-sizing. The
	// parameter carries the value and editor locale so font and text changes
	// trigger a recompute.
	function autosizePath(node: HTMLTextAreaElement, _deps: unknown) {
		const native = CSS.supports('field-sizing', 'content');
		const resize = () => {
			const value = node.value;
			if (native && value !== '') { node.style.height = ''; return; }
			if (value === '') node.value = node.placeholder;
			node.style.height = 'auto';
			node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`;
			if (value === '') node.value = value;
		};
		let width = 0;
		const observer = new ResizeObserver(() => {
			if (node.clientWidth !== width) { width = node.clientWidth; resize(); }
		});
		observer.observe(node);
		const fontsLoaded = () => resize();
		document.fonts?.addEventListener('loadingdone', fontsLoaded);
		queueMicrotask(resize);
		return {
			update(_deps: unknown) { queueMicrotask(resize); },
			destroy() {
				observer.disconnect();
				document.fonts?.removeEventListener('loadingdone', fontsLoaded);
			}
		};
	}
</script>

<!-- Sized from main, not the viewport, so a wrapped header cannot clip the end.
     The extra 1rem keeps the original reach into main's bottom padding. -->
<ScrollArea class="h-[calc(100%+1rem)]">
	<div data-testid="settings-page" class="mx-auto max-w-2xl space-y-6 p-2">

		<LanguageSettings />

		<!-- ═══════ Paths Section ═══════ -->
		<Card>
			<CardHeader>
				<CardTitle class="text-sm">{t('settings.paths')}</CardTitle>
				<CardDescription>{t('settings.pathsHelp')}</CardDescription>
			</CardHeader>
			<CardContent class="space-y-5">
				<!-- Game Installation Path -->
				<div class="space-y-2">
					<span class="text-[11px] font-medium text-muted-foreground">{t('settings.gameInstallation')}</span>
					<div class="flex flex-wrap items-center gap-2">
						<div class="relative min-w-64 flex-1">
							<textarea
								readonly
								rows={1}
								aria-label={t('settings.gameInstallation')}
								data-testid="game-folder-path"
								placeholder={t('settings.gamePathPlaceholder')}
								value={settings.gamePath}
								use:autosizePath={[settings.gamePath, getEditorLocale()]}
								class="block dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-8 w-full min-w-0 resize-none rounded-none border bg-transparent px-2.5 py-1 pr-8 text-xs transition-colors placeholder:text-muted-foreground outline-none focus-visible:ring-1 [field-sizing:content] [overflow-wrap:anywhere] select-text"
							></textarea>
							{#if gamePathValid === true}
								<CheckCircleIcon
									size={16}
									weight="fill"
									class="absolute top-1/2 right-2 -translate-y-1/2 text-green-600 dark:text-green-400"
								/>
							{:else if gamePathValid === false}
								<XCircleIcon
									size={16}
									weight="fill"
									class="absolute top-1/2 right-2 -translate-y-1/2 text-red-500"
								/>
							{/if}
						</div>
						<Tooltip>
							<TooltipTrigger>
								{#snippet child({ props })}
									<Button {...mergeProps(props, { onclick: handleBrowseGame })} data-testid="browse-game"
										variant="outline"
										size="sm"
										class="h-8 gap-1 text-xs"
									>
										<FolderOpenIcon size={14} />
										{t('settings.browse')}
									</Button>
								{/snippet}
							</TooltipTrigger>
							<TooltipContent>{t('settings.browseGameHelp')}</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger>
								{#snippet child({ props })}
									<Button {...mergeProps(props, { onclick: autoDetectGame })} data-testid="detect-game"
										variant="outline"
										size="sm"
										class="h-8 gap-1 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
										aria-disabled={detectingGame}
									>
										{#if detectingGame}
											<SpinnerIcon size={14} class="animate-spin" />
										{:else}
											<MagnifyingGlassIcon size={14} />
										{/if}
										{t('settings.detect')}
									</Button>
								{/snippet}
							</TooltipTrigger>
							<TooltipContent>{t('settings.detectGameHelp')}</TooltipContent>
						</Tooltip>
					</div>
					{#if gamePathValid === false}
						<p class="text-[11px] text-red-500">
							{t('settings.invalidGamePath')}
						</p>
					{/if}
				</div>

				<Separator />

				<!-- Save File Location -->
				<div class="space-y-2">
					<span class="text-[11px] font-medium text-muted-foreground">{t('settings.saveLocation')}</span>
					<div class="flex flex-wrap items-center gap-2">
						<div class="relative min-w-64 flex-1">
							<textarea
								readonly
								rows={1}
								aria-label={t('settings.saveLocation')}
								data-testid="save-folder-path"
								placeholder={t('settings.savePathPlaceholder')}
								value={settings.savePath}
								use:autosizePath={[settings.savePath, getEditorLocale()]}
								class="block dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-8 w-full min-w-0 resize-none rounded-none border bg-transparent px-2.5 py-1 pr-8 text-xs transition-colors placeholder:text-muted-foreground outline-none focus-visible:ring-1 [field-sizing:content] [overflow-wrap:anywhere] select-text"
							></textarea>
							{#if savePathValid === true}
								<CheckCircleIcon
									size={16}
									weight="fill"
									class="absolute top-1/2 right-2 -translate-y-1/2 text-green-600 dark:text-green-400"
								/>
							{:else if savePathValid === false}
								<XCircleIcon
									size={16}
									weight="fill"
									class="absolute top-1/2 right-2 -translate-y-1/2 text-red-500"
								/>
							{/if}
						</div>
						<Tooltip>
							<TooltipTrigger>
								{#snippet child({ props })}
									<Button {...mergeProps(props, { onclick: handleBrowseSave })} data-testid="browse-save"
										variant="outline"
										size="sm"
										class="h-8 gap-1 text-xs"
									>
										<FolderOpenIcon size={14} />
										{t('settings.browse')}
									</Button>
								{/snippet}
							</TooltipTrigger>
							<TooltipContent>{t('settings.browseSaveHelp')}</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger>
								{#snippet child({ props })}
									<Button {...mergeProps(props, { onclick: autoDetectSaves })} data-testid="detect-save"
										variant="outline"
										size="sm"
										class="h-8 gap-1 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
										aria-disabled={detectingSaves}
									>
										{#if detectingSaves}
											<SpinnerIcon size={14} class="animate-spin" />
										{:else}
											<MagnifyingGlassIcon size={14} />
										{/if}
										{t('settings.detect')}
									</Button>
								{/snippet}
							</TooltipTrigger>
							<TooltipContent>{t('settings.detectSaveHelp')}</TooltipContent>
						</Tooltip>
					</div>
					{#if savePathValid === false}
						<p class="text-[11px] text-red-500">
							{t('settings.invalidSavePath')}
						</p>
					{/if}
				</div>

				<Separator />

				<!-- Profile Selector -->
				<div class="space-y-2">
					<span class="text-[11px] font-medium text-muted-foreground">{t('settings.currentProfile')}</span>
					{#if profileOptions.length > 0}
						<Select
							type="single"
							value={settings.savePath}
							onValueChange={(v: string) => handleProfileChange(v)}
						>
							<SelectTrigger aria-label={t('settings.currentProfile')} class="h-8 text-xs">
								<span>{settings.profileId || t(settings.savePath ? 'profiles.current' : 'settings.selectProfile')}</span>
							</SelectTrigger>
							<SelectContent>
								{#each profileOptions as opt}
									<SelectItem value={opt.id}>
										<span class="flex items-center gap-2">
											<span>{opt.label}</span>
											<Badge variant="outline" class="text-[10px]">{profileSource(opt.source)}</Badge>
											{#if opt.hasRaid}
												<Badge variant="destructive" class="text-[10px]">{t('settings.inRaid')}</Badge>
											{/if}
										</span>
									</SelectItem>
								{/each}
							</SelectContent>
						</Select>
					{:else}
						<div class="flex items-center gap-2 border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
							<InfoIcon size={14} class="shrink-0" />
							<span>{t('settings.noProfiles')}</span>
						</div>
					{/if}
				</div>
			</CardContent>
		</Card>

		<!-- ═══════ Backup Section ═══════ -->
		<Card>
			<CardHeader>
				<CardTitle class="text-sm">{t('settings.backups')}</CardTitle>
				<CardDescription>{t('settings.backupsHelp')}</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<!-- Auto-backup toggle -->
				<div class="flex items-center justify-between">
					<div>
						<p class="text-xs font-medium">{t('settings.autoBackup')}</p>
						<p class="text-[11px] text-muted-foreground">
							{t('settings.autoBackupHelp')}
						</p>
					</div>
					<Switch
						aria-label={t('settings.autoBackup')}
						checked={settings.autoBackup}
						onCheckedChange={(checked) => commitChangedValue(settings.autoBackup, checked, setAutoBackup)}
					/>
				</div>

				<Separator />

				<!-- Backup actions -->
				<div class="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						class="gap-1.5 text-xs"
						disabled={!settings.savePath || creatingBackup}
						onclick={handleCreateBackup}
					>
						{#if creatingBackup}
							<SpinnerIcon size={14} class="animate-spin" />
							{t('settings.creating')}
						{:else}
							<ArchiveIcon size={14} />
							{t('settings.createBackup')}
						{/if}
					</Button>
					<Button
						variant="outline"
						size="sm"
						class="gap-1.5 text-xs"
						onclick={handleOpenBackupFolder}
					>
						<FolderOpenIcon size={14} />
						{t('settings.openBackupFolder')}
					</Button>
					<Button
						variant="outline"
						size="sm"
						class="gap-1.5 text-xs"
						disabled={!settings.savePath || restoringGameBackup}
						onclick={openRestoreGameBackupDialog}
					>
						{#if restoringGameBackup}
							<SpinnerIcon size={14} class="animate-spin" />
							{t('settings.restoring')}
						{:else}
							<ArrowCounterClockwiseIcon size={14} />
							{t('settings.restoreGameBackup')}
						{/if}
					</Button>
				</div>

				<Separator />

				<!-- Recent backups list -->
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<span class="text-[11px] font-medium text-muted-foreground">{t('settings.recentBackups')}</span>
						{#if loadingBackups}
							<SpinnerIcon size={12} class="animate-spin text-muted-foreground" />
						{/if}
					</div>

					{#if backups.length === 0 && !loadingBackups}
						<div class="flex items-center gap-2 border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
							<ArchiveIcon size={14} class="shrink-0" />
							<span>{t('settings.noBackups')}</span>
						</div>
					{:else}
						<div class="space-y-1.5">
							{#each backups as backup (backup.path)}
								{@const isRestoring = restoringBackup === backup.path}
								<div class="flex items-center justify-between border border-border bg-muted/20 p-2.5">
									<div class="flex items-center gap-3">
										<ClockIcon size={14} class="shrink-0 text-muted-foreground" />
										<div>
											<p class="text-xs font-medium">
												{formatTimestamp(backup.timestamp)}
											</p>
											<p class="text-[11px] text-muted-foreground">
												{t('settings.backupFiles', { count: backup.file_count, profile: backup.profile_id })}
											</p>
										</div>
									</div>
									<Button
										variant="outline"
										size="sm"
										class="h-7 gap-1 text-[11px]"
										disabled={isRestoring}
										onclick={() => openRestoreDialog(backup)}
									>
										{#if isRestoring}
											<SpinnerIcon size={12} class="animate-spin" />
											{t('settings.restoring')}
										{:else}
											<ArrowCounterClockwiseIcon size={12} />
											{t('settings.restore')}
										{/if}
									</Button>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</CardContent>
		</Card>

		<!-- ═══════ Display Section ═══════ -->
		<Card>
			<CardHeader>
				<CardTitle class="text-sm">{t('settings.display')}</CardTitle>
				<CardDescription>{t('settings.displayHelp')}</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						{#if mode.current === 'dark'}
							<MoonIcon size={16} class="text-muted-foreground" />
						{:else}
							<SunIcon size={16} class="text-muted-foreground" />
						{/if}
						<div>
							<p class="text-xs font-medium">{t('settings.darkMode')}</p>
							<p class="text-[11px] text-muted-foreground">
								{t('settings.darkModeHelp')}
							</p>
						</div>
					</div>
					<Switch
						aria-label={t('settings.darkMode')}
						checked={mode.current === 'dark'}
						onCheckedChange={(checked) => commitChangedValue(mode.current === 'dark', checked, () => toggleMode())}
					/>
				</div>
			</CardContent>
		</Card>

		<!-- ═══════ About Section ═══════ -->
		<Card>
			<CardHeader>
				<CardTitle class="text-sm">{t('settings.about')}</CardTitle>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="flex items-center justify-between">
					<span class="text-xs font-medium">{t('settings.version')}</span>
					<Badge variant="outline" class="text-[11px]">{appVersion ?? t('settings.developmentVersion')}</Badge>
				</div>

				<Separator />

				<div class="space-y-2">
					<div class="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-3">
						<WarningIcon size={16} class="mt-0.5 shrink-0 text-amber-500" />
						<p class="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
							{t('settings.disclaimer')}
						</p>
					</div>
				</div>

				<Separator />

				<div>
					<Message id="settings.repository" params={{}}>
						{#snippet emphasis(children)}<em>{@render children()}</em>{/snippet}
						{#snippet code(children)}<code>{@render children()}</code>{/snippet}
						{#snippet link(children)}
							<Button variant="ghost" size="sm" class="h-7 gap-1.5 text-xs" href="https://github.com/AlinGheorghe/hamlet-editor">
								<GithubLogoIcon size={14} />{@render children()}
							</Button>
						{/snippet}
					</Message>
				</div>
			</CardContent>
		</Card>
	</div>
</ScrollArea>

<!-- ═══════ Restore Confirmation Dialog ═══════ -->
<Dialog bind:open={restoreDialogOpen}>
	<DialogContent closeLabel={t('common.close')} class="sm:max-w-md">
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2 text-sm">
				<ArrowCounterClockwiseIcon size={18} />
				{t('settings.restoreBackup')}
			</DialogTitle>
			<DialogDescription>
				{t('settings.restoreDescription')}
				{restoreSummary(restoreCheck)}
			</DialogDescription>
		</DialogHeader>

		{#if restoreCheck && isRestoreBlocked(restoreCheck)}
			<div role="alert" class="text-sm text-destructive"><ErrorMessage error={restoreCheck.blocked_reason} blocked /></div>
			<Button variant="outline" size="sm" disabled={checkingRestore} onclick={() => recheckRestore(false)}>{t('settings.checkAgain')}</Button>
		{/if}

		{#if restoreTarget}
			<div class="space-y-3">
				<div class="border border-border bg-muted/30 p-3">
					<p class="text-xs font-medium">{formatTimestamp(restoreTarget.timestamp)}</p>
					<p class="text-[11px] text-muted-foreground">
						{t('settings.backupFiles', { count: restoreTarget.file_count, profile: restoreTarget.profile_id })}
					</p>
				</div>

				<div class="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-3">
					<WarningIcon size={14} class="mt-0.5 shrink-0 text-amber-500" />
					<p class="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
						{t('settings.restoreWarning')}
					</p>
				</div>

				<label class="flex items-center gap-2">
					<Checkbox bind:checked={restoreConfirmChecked} />
					<span class="text-[11px]">{t('settings.restoreConfirm')}</span>
				</label>
			</div>
		{/if}

		<DialogFooter class="flex-wrap flex-row justify-end gap-2 sm:justify-end">
			<Button variant="outline" size="sm" onclick={() => (restoreDialogOpen = false)}>
				{t('settings.cancel')}
			</Button>
			<Button
				variant="destructive"
				size="sm"
				disabled={checkingRestore || !restoreConfirmChecked || !restoreCheck || isRestoreBlocked(restoreCheck)}
				onclick={handleRestore}
			>
				<ArrowCounterClockwiseIcon size={14} class="mr-1" />
				{t('settings.restore')}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- ═══════ Restore Game Backup Confirmation Dialog ═══════ -->
<Dialog bind:open={restoreGameBackupDialogOpen}>
	<DialogContent closeLabel={t('common.close')} class="sm:max-w-md">
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2 text-sm">
				<ArrowCounterClockwiseIcon size={18} />
				{t('settings.restoreGameBackup')}
			</DialogTitle>
			<DialogDescription>
				{t('settings.gameRestoreDescription')}
				{restoreSummary(gameRestoreCheck)}
			</DialogDescription>
		</DialogHeader>

		{#if gameRestoreCheck && isRestoreBlocked(gameRestoreCheck)}
			<div role="alert" class="text-sm text-destructive"><ErrorMessage error={gameRestoreCheck.blocked_reason} blocked /></div>
			<Button variant="outline" size="sm" disabled={checkingRestore} onclick={() => recheckRestore(true)}>{t('settings.checkAgain')}</Button>
		{/if}

		<div class="space-y-3">
			<div class="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-3">
				<WarningIcon size={14} class="mt-0.5 shrink-0 text-amber-500" />
				<p class="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
					{t('settings.gameRestoreWarning')}
				</p>
			</div>

			<label class="flex items-center gap-2">
				<Checkbox bind:checked={restoreGameBackupConfirmChecked} />
				<span class="text-[11px]">{t('settings.restoreConfirm')}</span>
			</label>
		</div>

		<DialogFooter class="flex-wrap flex-row justify-end gap-2 sm:justify-end">
			<Button variant="outline" size="sm" onclick={() => (restoreGameBackupDialogOpen = false)}>
				{t('settings.cancel')}
			</Button>
			<Button
				variant="destructive"
				size="sm"
				disabled={checkingRestore || !restoreGameBackupConfirmChecked || !gameRestoreCheck || isRestoreBlocked(gameRestoreCheck)}
				onclick={handleRestoreGameBackup}
			>
				<ArrowCounterClockwiseIcon size={14} class="mr-1" />
				{t('settings.restore')}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
