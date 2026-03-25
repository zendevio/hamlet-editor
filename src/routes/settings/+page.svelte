<script lang="ts">
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import { Separator } from '$lib/components/ui/separator';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '$lib/components/ui/select';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip';
	import {
		getSettings,
		setGamePath,
		setSavePath,
		setProfileId,
		setAutoBackup
	} from '$lib/stores/settings.svelte';
	import {
		detectGameInstallations,
		detectSaveLocations,
		type GameInstall,
		type SaveLocation
	} from '$lib/api/detect';
	import { createBackup, listBackups, restoreBackup, type BackupEntry } from '$lib/api/backup';
	import { toggleMode, mode } from 'mode-watcher';
	import { toast } from 'svelte-sonner';

	// Phosphor icons
	import FolderOpen from 'phosphor-svelte/lib/FolderOpen';
	import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
	import CheckCircle from 'phosphor-svelte/lib/CheckCircle';
	import XCircle from 'phosphor-svelte/lib/XCircle';
	import Spinner from 'phosphor-svelte/lib/Spinner';
	import Archive from 'phosphor-svelte/lib/Archive';
	import ArrowCounterClockwise from 'phosphor-svelte/lib/ArrowCounterClockwise';
	import Clock from 'phosphor-svelte/lib/Clock';
	import Sun from 'phosphor-svelte/lib/Sun';
	import Moon from 'phosphor-svelte/lib/Moon';
	import Info from 'phosphor-svelte/lib/Info';
	import GithubLogo from 'phosphor-svelte/lib/GithubLogo';
	import Warning from 'phosphor-svelte/lib/Warning';

	// ── State ──

	const settings = getSettings();

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

	// ── Derived ──

	let profileOptions = $derived.by(() => {
		return saveLocations.map((loc) => ({
			id: loc.profile_id,
			label: `${loc.profile_id}${loc.week_number !== null ? ` — Week ${loc.week_number}` : ''}`,
			hasRaid: loc.has_active_raid,
			source: loc.source
		}));
	});

	// mode.current is reactive (Svelte 5 box pattern from mode-watcher)

	// ── Actions: Path Detection ──

	async function autoDetectGame() {
		detectingGame = true;
		gamePathValid = null;
		try {
			gameInstalls = await detectGameInstallations();
			if (gameInstalls.length > 0) {
				setGamePath(gameInstalls[0].path);
				gamePathValid = true;
				toast.success('Game installation detected', {
					description: gameInstalls[0].path
				});
			} else {
				gamePathValid = false;
				toast.error('No game installation found', {
					description: 'Use Browse to select manually.'
				});
			}
		} catch {
			gamePathValid = false;
			toast.error('Detection failed');
		} finally {
			detectingGame = false;
		}
	}

	async function autoDetectSaves() {
		detectingSaves = true;
		savePathValid = null;
		try {
			saveLocations = await detectSaveLocations();
			if (saveLocations.length > 0) {
				setSavePath(saveLocations[0].path);
				setProfileId(saveLocations[0].profile_id);
				savePathValid = true;
				toast.success('Save files detected', {
					description: `Found ${saveLocations.length} profile(s).`
				});
			} else {
				savePathValid = false;
				toast.error('No save files found', {
					description: 'Use Browse to select manually.'
				});
			}
		} catch {
			savePathValid = false;
			toast.error('Detection failed');
		} finally {
			detectingSaves = false;
		}
	}

	function handleBrowseGame() {
		// Placeholder: will use Tauri open dialog
		toast.info('Browse not yet implemented', {
			description: 'Tauri file picker will be wired in when the backend is ready.'
		});
	}

	function handleBrowseSave() {
		// Placeholder: will use Tauri open dialog
		toast.info('Browse not yet implemented', {
			description: 'Tauri file picker will be wired in when the backend is ready.'
		});
	}

	function handleProfileChange(value: string) {
		setProfileId(value);
		const loc = saveLocations.find((l) => l.profile_id === value);
		if (loc) {
			setSavePath(loc.path);
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
			toast.success('Backup created');
			await loadBackupList();
		} catch (err) {
			toast.error('Backup failed', {
				description: String(err)
			});
		} finally {
			creatingBackup = false;
		}
	}

	function handleOpenBackupFolder() {
		// Placeholder: will use Tauri shell.open
		toast.info('Open folder not yet implemented', {
			description: 'Will open the system file manager when the backend is ready.'
		});
	}

	function openRestoreDialog(backup: BackupEntry) {
		restoreTarget = backup;
		restoreConfirmChecked = false;
		restoreDialogOpen = true;
	}

	async function handleRestore() {
		if (!restoreTarget || !settings.savePath) return;
		restoringBackup = restoreTarget.path;
		restoreDialogOpen = false;
		try {
			await restoreBackup(restoreTarget.path, settings.savePath);
			toast.success('Backup restored', {
				description: `Restored from ${formatTimestamp(restoreTarget.timestamp)}.`
			});
			await loadBackupList();
		} catch (err) {
			toast.error('Restore failed', {
				description: String(err)
			});
		} finally {
			restoringBackup = null;
			restoreTarget = null;
			restoreConfirmChecked = false;
		}
	}

	// ── Helpers ──

	function formatTimestamp(iso: string): string {
		try {
			const d = new Date(iso);
			return d.toLocaleString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return iso;
		}
	}

	// Load backup list on mount if path is set
	$effect(() => {
		if (settings.savePath) {
			loadBackupList();
		}
	});
</script>

<ScrollArea class="h-[calc(100vh-4rem)]">
	<div class="mx-auto max-w-2xl space-y-6 p-2">

		<!-- ═══════ Paths Section ═══════ -->
		<Card>
			<CardHeader>
				<CardTitle class="text-sm">Paths</CardTitle>
				<CardDescription>Game installation and save file locations.</CardDescription>
			</CardHeader>
			<CardContent class="space-y-5">
				<!-- Game Installation Path -->
				<div class="space-y-2">
					<span class="text-[11px] font-medium text-muted-foreground">Game Installation</span>
					<div class="flex items-center gap-2">
						<div class="relative flex-1">
							<Input
								value={settings.gamePath}
								placeholder="Path to Darkest Dungeon installation..."
								readonly
								class="h-8 pr-8 text-xs"
							/>
							{#if gamePathValid === true}
								<CheckCircle
									size={16}
									weight="fill"
									class="absolute top-1/2 right-2 -translate-y-1/2 text-green-600 dark:text-green-400"
								/>
							{:else if gamePathValid === false}
								<XCircle
									size={16}
									weight="fill"
									class="absolute top-1/2 right-2 -translate-y-1/2 text-red-500"
								/>
							{/if}
						</div>
						<Tooltip>
							<TooltipTrigger>
								<Button
									variant="outline"
									size="sm"
									class="h-8 gap-1 text-xs"
									onclick={handleBrowseGame}
								>
									<FolderOpen size={14} />
									Browse
								</Button>
							</TooltipTrigger>
							<TooltipContent>Select game folder manually</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger>
								<Button
									variant="outline"
									size="sm"
									class="h-8 gap-1 text-xs"
									disabled={detectingGame}
									onclick={autoDetectGame}
								>
									{#if detectingGame}
										<Spinner size={14} class="animate-spin" />
									{:else}
										<MagnifyingGlass size={14} />
									{/if}
									Auto-detect
								</Button>
							</TooltipTrigger>
							<TooltipContent>Scan for Darkest Dungeon installations</TooltipContent>
						</Tooltip>
					</div>
					{#if gamePathValid === false}
						<p class="text-[11px] text-red-500">
							Not a valid Darkest Dungeon installation. Try browsing manually.
						</p>
					{/if}
				</div>

				<Separator />

				<!-- Save File Location -->
				<div class="space-y-2">
					<span class="text-[11px] font-medium text-muted-foreground">Save File Location</span>
					<div class="flex items-center gap-2">
						<div class="relative flex-1">
							<Input
								value={settings.savePath}
								placeholder="Path to save files..."
								readonly
								class="h-8 pr-8 text-xs"
							/>
							{#if savePathValid === true}
								<CheckCircle
									size={16}
									weight="fill"
									class="absolute top-1/2 right-2 -translate-y-1/2 text-green-600 dark:text-green-400"
								/>
							{:else if savePathValid === false}
								<XCircle
									size={16}
									weight="fill"
									class="absolute top-1/2 right-2 -translate-y-1/2 text-red-500"
								/>
							{/if}
						</div>
						<Tooltip>
							<TooltipTrigger>
								<Button
									variant="outline"
									size="sm"
									class="h-8 gap-1 text-xs"
									onclick={handleBrowseSave}
								>
									<FolderOpen size={14} />
									Browse
								</Button>
							</TooltipTrigger>
							<TooltipContent>Select save folder manually</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger>
								<Button
									variant="outline"
									size="sm"
									class="h-8 gap-1 text-xs"
									disabled={detectingSaves}
									onclick={autoDetectSaves}
								>
									{#if detectingSaves}
										<Spinner size={14} class="animate-spin" />
									{:else}
										<MagnifyingGlass size={14} />
									{/if}
									Auto-detect
								</Button>
							</TooltipTrigger>
							<TooltipContent>Scan for Darkest Dungeon save files</TooltipContent>
						</Tooltip>
					</div>
					{#if savePathValid === false}
						<p class="text-[11px] text-red-500">
							No save files found at this location. Required files may be missing.
						</p>
					{/if}
				</div>

				<Separator />

				<!-- Profile Selector -->
				<div class="space-y-2">
					<span class="text-[11px] font-medium text-muted-foreground">Current Profile</span>
					{#if profileOptions.length > 0}
						<Select
							type="single"
							value={settings.profileId}
							onValueChange={(v: string) => handleProfileChange(v)}
						>
							<SelectTrigger class="h-8 text-xs">
								<span>{settings.profileId || 'Select a profile...'}</span>
							</SelectTrigger>
							<SelectContent>
								{#each profileOptions as opt}
									<SelectItem value={opt.id}>
										<span class="flex items-center gap-2">
											<span>{opt.label}</span>
											<Badge variant="outline" class="text-[10px]">{opt.source}</Badge>
											{#if opt.hasRaid}
												<Badge variant="destructive" class="text-[10px]">In Raid</Badge>
											{/if}
										</span>
									</SelectItem>
								{/each}
							</SelectContent>
						</Select>
					{:else}
						<div class="flex items-center gap-2 border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
							<Info size={14} class="shrink-0" />
							<span>No profiles detected. Run auto-detect or browse to a save folder first.</span>
						</div>
					{/if}
				</div>
			</CardContent>
		</Card>

		<!-- ═══════ Backup Section ═══════ -->
		<Card>
			<CardHeader>
				<CardTitle class="text-sm">Backups</CardTitle>
				<CardDescription>Create and manage save file backups.</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<!-- Auto-backup toggle -->
				<div class="flex items-center justify-between">
					<div>
						<p class="text-xs font-medium">Auto-backup before saving</p>
						<p class="text-[11px] text-muted-foreground">
							Automatically create a backup before every save operation.
						</p>
					</div>
					<Switch
						checked={settings.autoBackup}
						onCheckedChange={(checked) => setAutoBackup(checked)}
					/>
				</div>

				<Separator />

				<!-- Backup actions -->
				<div class="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						class="gap-1.5 text-xs"
						disabled={!settings.savePath || creatingBackup}
						onclick={handleCreateBackup}
					>
						{#if creatingBackup}
							<Spinner size={14} class="animate-spin" />
							Creating...
						{:else}
							<Archive size={14} />
							Create Backup Now
						{/if}
					</Button>
					<Button
						variant="outline"
						size="sm"
						class="gap-1.5 text-xs"
						onclick={handleOpenBackupFolder}
					>
						<FolderOpen size={14} />
						Open Backup Folder
					</Button>
				</div>

				<Separator />

				<!-- Recent backups list -->
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<span class="text-[11px] font-medium text-muted-foreground">Recent Backups</span>
						{#if loadingBackups}
							<Spinner size={12} class="animate-spin text-muted-foreground" />
						{/if}
					</div>

					{#if backups.length === 0 && !loadingBackups}
						<div class="flex items-center gap-2 border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
							<Archive size={14} class="shrink-0" />
							<span>No backups found. Create one to get started.</span>
						</div>
					{:else}
						<div class="space-y-1.5">
							{#each backups as backup (backup.path)}
								{@const isRestoring = restoringBackup === backup.path}
								<div class="flex items-center justify-between border border-border bg-muted/20 p-2.5">
									<div class="flex items-center gap-3">
										<Clock size={14} class="shrink-0 text-muted-foreground" />
										<div>
											<p class="text-xs font-medium">
												{formatTimestamp(backup.timestamp)}
											</p>
											<p class="text-[11px] text-muted-foreground">
												{backup.file_count} file{backup.file_count !== 1 ? 's' : ''} — {backup.profile_id}
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
											<Spinner size={12} class="animate-spin" />
											Restoring...
										{:else}
											<ArrowCounterClockwise size={12} />
											Restore
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
				<CardTitle class="text-sm">Display</CardTitle>
				<CardDescription>Appearance preferences.</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						{#if mode.current === 'dark'}
							<Moon size={16} class="text-muted-foreground" />
						{:else}
							<Sun size={16} class="text-muted-foreground" />
						{/if}
						<div>
							<p class="text-xs font-medium">Dark mode</p>
							<p class="text-[11px] text-muted-foreground">
								Toggle between dark and light themes.
							</p>
						</div>
					</div>
					<Switch
						checked={mode.current === 'dark'}
						onCheckedChange={() => toggleMode()}
					/>
				</div>
			</CardContent>
		</Card>

		<!-- ═══════ About Section ═══════ -->
		<Card>
			<CardHeader>
				<CardTitle class="text-sm">About</CardTitle>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="flex items-center justify-between">
					<span class="text-xs font-medium">Version</span>
					<Badge variant="outline" class="text-[11px]">v0.0.1</Badge>
				</div>

				<Separator />

				<div class="space-y-2">
					<div class="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-3">
						<Warning size={16} class="mt-0.5 shrink-0 text-amber-500" />
						<p class="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
							Hamlet Editor is not an official Red Hook Studios product or product modification,
							and Red Hook Studios Inc. is not responsible for changes or damages resulting from
							its use.
						</p>
					</div>
				</div>

				<Separator />

				<div>
					<Button
						variant="ghost"
						size="sm"
						class="h-7 gap-1.5 text-xs"
						href="https://github.com/placeholder/hamlet-editor"
					>
						<GithubLogo size={14} />
						GitHub Repository
					</Button>
				</div>
			</CardContent>
		</Card>
	</div>
</ScrollArea>

<!-- ═══════ Restore Confirmation Dialog ═══════ -->
<Dialog bind:open={restoreDialogOpen}>
	<DialogContent class="sm:max-w-md">
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2 text-sm">
				<ArrowCounterClockwise size={18} />
				Restore Backup
			</DialogTitle>
			<DialogDescription>
				This will replace your current save files with the selected backup.
			</DialogDescription>
		</DialogHeader>

		{#if restoreTarget}
			<div class="space-y-3">
				<div class="border border-border bg-muted/30 p-3">
					<p class="text-xs font-medium">{formatTimestamp(restoreTarget.timestamp)}</p>
					<p class="text-[11px] text-muted-foreground">
						{restoreTarget.file_count} file{restoreTarget.file_count !== 1 ? 's' : ''} — {restoreTarget.profile_id}
					</p>
				</div>

				<div class="flex items-start gap-2 border border-amber-500/30 bg-amber-500/5 p-3">
					<Warning size={14} class="mt-0.5 shrink-0 text-amber-500" />
					<p class="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
						A safety backup of the current state will be created automatically before restoring.
						Any unsaved in-memory edits will be lost.
					</p>
				</div>

				<label class="flex items-center gap-2">
					<Checkbox bind:checked={restoreConfirmChecked} />
					<span class="text-[11px]">I understand this will overwrite current save files</span>
				</label>
			</div>
		{/if}

		<DialogFooter class="flex-row justify-end gap-2 sm:justify-end">
			<Button variant="outline" size="sm" onclick={() => (restoreDialogOpen = false)}>
				Cancel
			</Button>
			<Button
				variant="destructive"
				size="sm"
				disabled={!restoreConfirmChecked}
				onclick={handleRestore}
			>
				<ArrowCounterClockwise size={14} class="mr-1" />
				Restore
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
