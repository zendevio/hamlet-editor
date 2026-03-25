<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
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
	} from '$lib/components/ui/sidebar';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { Badge } from '$lib/components/ui/badge';
	import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip';
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
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import SetupWizard from '$lib/components/SetupWizard.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import ValidationDialog from '$lib/components/ValidationDialog.svelte';
	import UnsavedChangesDialog from '$lib/components/UnsavedChangesDialog.svelte';
	import DiscardConfirmDialog from '$lib/components/DiscardConfirmDialog.svelte';
	import { getSettings } from '$lib/stores/settings.svelte';
	import {
		getSaveData,
		hasDirtyFiles,
		getDirtyData,
		clearAllDirty,
		discardAllChanges,
		loadProfileFromBackend,
		getHeroes,
		CLASS_DISPLAY_NAMES
	} from '$lib/stores/save-data.svelte';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '$lib/components/ui/select';
	import { isGameRunning } from '$lib/api/detect';
	import { saveProfile } from '$lib/api/save';
	import { createBackup } from '$lib/api/backup';
	import { runPreSaveValidation, type ValidationIssue } from '$lib/validation';

	let { children } = $props();

	const settings = getSettings();
	const saveData = getSaveData();
	let showSetupWizard = $derived(!settings.isSetupComplete);

	// ── Game Running Detection ──

	let gameRunning = $state(false);
	let gameDetectionUncertain = $state(false);
	let isSaving = $state(false);
	let isProfileLoading = $state(false);

	// ── Profile Loading ──

	// When setup completes (or was already complete on startup), load the profile.
	$effect(() => {
		if (settings.isSetupComplete && !saveData.isLoaded && !isProfileLoading) {
			isProfileLoading = true;
			loadProfileFromBackend(settings.savePath)
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

		async function poll() {
			if (cancelled) return;
			try {
				const result = await isGameRunning();
				if (!cancelled) {
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
	let saveDisabled = $derived(!saveData.isLoaded || isGameBlocking || !isDirty || isSaving);

	// C1: Steam Cloud warning
	let isSteamCloud = $derived(settings.savePath.includes('/userdata/'));

	// C2: Modded content detection
	let hasModdedContent = $derived.by(() => {
		if (!saveData.isLoaded) return false;
		const heroes = getHeroes();
		return heroes.some((h) => !(h.heroClass in CLASS_DISPLAY_NAMES));
	});

	// C3: Raid status badges
	let raidActive = $derived(saveData.raid !== null && saveData.gameInRaid);
	let raidInconsistent = $derived(
		(saveData.raid !== null) !== saveData.gameInRaid
	);

	// C7: Last backup timestamp
	let lastBackupTime = $state<Date | null>(null);

	let saveTooltip = $derived.by(() => {
		if (!saveData.isLoaded) return 'No profile loaded';
		if (gameRunning) return 'DD Running — close the game before saving';
		if (gameDetectionUncertain) return 'Unable to detect game status — save blocked as precaution';
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

	// ── Window Close Handler ──

	onMount(() => {
		let unlisten: (() => void) | undefined;

		async function setup() {
			try {
				const { getCurrentWindow } = await import('@tauri-apps/api/window');
				const currentWindow = getCurrentWindow();
				unlisten = await currentWindow.onCloseRequested(async (event) => {
					if (hasDirtyFiles()) {
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

		// Listen for custom events from CommandPalette
		function handleSaveEvent() {
			handleSave();
		}
		function handleDiscardEvent() {
			showDiscardDialog = true;
		}
		function handleBackupEvent() {
			handleBackup();
		}

		window.addEventListener('hamlet:save', handleSaveEvent);
		window.addEventListener('hamlet:discard', handleDiscardEvent);
		window.addEventListener('hamlet:backup', handleBackupEvent);

		return () => {
			unlisten?.();
			window.removeEventListener('hamlet:save', handleSaveEvent);
			window.removeEventListener('hamlet:discard', handleDiscardEvent);
			window.removeEventListener('hamlet:backup', handleBackupEvent);
		};
	});

	// ── Keyboard Shortcuts ──

	function handleKeydown(e: KeyboardEvent) {
		// Ctrl/Cmd+S: Save
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			if (!saveDisabled) handleSave();
		}
		// Ctrl/Cmd+Shift+Z: Discard
		if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') {
			e.preventDefault();
			if (isDirty) showDiscardDialog = true;
		}
		// Ctrl/Cmd+B: Backup
		if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
			e.preventDefault();
			handleBackup();
		}
	}

	// ── Save Flow ──

	async function handleSave() {
		if (saveDisabled) return;

		// Run pre-save validation
		const issues = runPreSaveValidation();
		if (issues.length > 0) {
			validationIssues = issues;
			showValidation = true;
			return;
		}

		await executeSave();
	}

	async function executeSave() {
		isSaving = true;
		try {
			// C6: Auto-backup before saving if enabled
			if (settings.autoBackup && settings.savePath) {
				try {
					await createBackup(settings.savePath);
					lastBackupTime = new Date();
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					toast.error(`Auto-backup failed: ${message}`);
					// Don't abort the save — backup failure is non-fatal
				}
			}
			const dirtyData = getDirtyData();
			await saveProfile(settings.savePath, dirtyData);
			clearAllDirty();
			toast.success('Saved successfully');
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			toast.error(`Save failed: ${message}`);
		} finally {
			isSaving = false;
		}
	}

	function handleValidationFixAll() {
		for (const issue of validationIssues) {
			if (issue.fix) issue.fix();
		}
		showValidation = false;
		// Re-run validation after fixes
		const remaining = runPreSaveValidation();
		if (remaining.length > 0) {
			validationIssues = remaining;
			showValidation = true;
		} else {
			executeSave();
		}
	}

	function handleValidationSaveAnyway() {
		showValidation = false;
		executeSave();
	}

	function handleValidationCancel() {
		showValidation = false;
	}

	// ── Discard Flow ──

	function handleDiscard() {
		discardAllChanges();
		showDiscardDialog = false;
		toast.info('All changes discarded');
	}

	// ── Close Flow ──

	async function handleSaveAndClose() {
		showCloseDialog = false;
		isSaving = true;
		try {
			const dirtyData = getDirtyData();
			await saveProfile(settings.savePath, dirtyData);
			clearAllDirty();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			toast.error(`Save failed: ${message}`);
			isSaving = false;
			return;
		}
		isSaving = false;
		// Now close the window
		try {
			const { getCurrentWindow } = await import('@tauri-apps/api/window');
			await getCurrentWindow().close();
		} catch {
			// Not in Tauri environment
		}
	}

	async function handleDiscardAndClose() {
		showCloseDialog = false;
		discardAllChanges();
		try {
			const { getCurrentWindow } = await import('@tauri-apps/api/window');
			await getCurrentWindow().close();
		} catch {
			// Not in Tauri environment
		}
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

	// ── Navigation ──

	const navItems = [
		{ href: '/heroes', label: 'Heroes', icon: UsersThreeIcon, isRaid: false },
		{ href: '/estate', label: 'Estate', icon: BankIcon, isRaid: false },
		{ href: '/town', label: 'Town', icon: BuildingsIcon, isRaid: false },
		{ href: '/raid', label: 'Raid', icon: CompassIcon, isRaid: true },
		{ href: '/settings', label: 'Settings', icon: GearIcon, isRaid: false }
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
<CommandPalette />
<ValidationDialog
	bind:open={showValidation}
	issues={validationIssues}
	onFixAll={handleValidationFixAll}
	onSaveAnyway={handleValidationSaveAnyway}
	onCancel={handleValidationCancel}
/>
<UnsavedChangesDialog
	bind:open={showCloseDialog}
	onSaveAndClose={handleSaveAndClose}
	onDiscardAndClose={handleDiscardAndClose}
	onCancel={handleCancelClose}
/>
<DiscardConfirmDialog
	bind:open={showDiscardDialog}
	onConfirm={handleDiscard}
	onCancel={() => (showDiscardDialog = false)}
/>
<svelte:head><link rel="icon" href={favicon} /></svelte:head>

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
					<Select type="single" value={settings.profileId} disabled>
						<SelectTrigger class="h-7 text-xs">
							<span class="text-xs">Profile: {settings.profileId}</span>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={settings.profileId}>{settings.profileId}</SelectItem>
						</SelectContent>
					</Select>
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
										class={saveData.raid === null ? 'opacity-50' : ''}
									>
										{#snippet child({ props })}
											<a href={item.href} {...props} class:pointer-events-none={saveData.raid === null}>
												<span class="relative inline-flex">
													<item.icon size={20} />
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
												<item.icon size={20} />
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
				<span class="text-xs text-muted-foreground">v0.0.1</span>
			</div>
		</SidebarFooter>

		<SidebarRail />
	</Sidebar>

	<SidebarInset>
		<header class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
			<SidebarTrigger class="-ml-1" />
			<Separator orientation="vertical" class="mr-2 h-4" />
			<h1 class="text-sm font-semibold">{viewTitle}</h1>

			<!-- Search trigger -->
			<Tooltip>
				<TooltipTrigger>
					<Button
						variant="ghost"
						size="sm"
						class="text-muted-foreground ml-1 gap-1"
						onclick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
					>
						<MagnifyingGlassIcon size={16} />
						<span class="text-xs">Search</span>
						<kbd class="bg-muted text-muted-foreground pointer-events-none ml-1 inline-flex h-5 items-center gap-0.5 rounded border px-1.5 font-mono text-[10px] font-medium">
							<span class="text-xs">{navigator?.platform?.includes('Mac') ? '\u2318' : 'Ctrl+'}</span>K
						</kbd>
					</Button>
				</TooltipTrigger>
				<TooltipContent>Search (Ctrl/Cmd+K)</TooltipContent>
			</Tooltip>

			<div class="ml-auto flex items-center gap-2">
				<!-- Game Running Badge -->
				{#if gameRunning}
					<Badge variant="destructive" class="gap-1">
						<span class="h-2 w-2 animate-pulse rounded-full bg-red-400"></span>
						DD Running — Save Blocked
					</Badge>
				{:else if gameDetectionUncertain}
					<Badge variant="outline" class="gap-1 border-amber-500 text-amber-600 dark:text-amber-400">
						<span class="h-2 w-2 animate-pulse rounded-full bg-amber-500"></span>
						Game Status Unknown — Save Blocked
					</Badge>
				{/if}

				<!-- C1: Steam Cloud warning -->
				{#if isSteamCloud}
					<Badge variant="outline" class="gap-1 border-amber-500 text-amber-600 dark:text-amber-400">
						<span class="h-2 w-2 rounded-full bg-amber-500"></span>
						Steam Cloud Active
					</Badge>
				{/if}

				<!-- C2: Modded content -->
				{#if hasModdedContent}
					<Badge variant="outline" class="gap-1 border-amber-500 text-amber-600 dark:text-amber-400">
						<span class="h-2 w-2 rounded-full bg-amber-500"></span>
						Modded Content
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
							aria-label={isDirty ? 'Unsaved changes — Save all changes' : 'Save'}
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

		<main class="flex-1 overflow-auto p-4">
			{#if isProfileLoading}
				<div class="flex h-full items-center justify-center gap-3 text-muted-foreground">
					<CircleNotchIcon size={20} class="animate-spin" />
					<span class="text-sm">Loading profile...</span>
				</div>
			{:else}
				{@render children()}
			{/if}
		</main>
	</SidebarInset>
</SidebarProvider>
