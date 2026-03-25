<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import { page } from '$app/state';
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
	import UsersThree from 'phosphor-svelte/lib/UsersThree';
	import Bank from 'phosphor-svelte/lib/Bank';
	import Buildings from 'phosphor-svelte/lib/Buildings';
	import Compass from 'phosphor-svelte/lib/Compass';
	import Gear from 'phosphor-svelte/lib/Gear';
	import FloppyDisk from 'phosphor-svelte/lib/FloppyDisk';
	import Archive from 'phosphor-svelte/lib/Archive';
	import Moon from 'phosphor-svelte/lib/Moon';
	import Sun from 'phosphor-svelte/lib/Sun';
	import SetupWizard from '$lib/components/SetupWizard.svelte';
	import { getSettings } from '$lib/stores/settings.svelte';

	let { children } = $props();

	const settings = getSettings();
	let showSetupWizard = $derived(!settings.isSetupComplete);

	const navItems = [
		{ href: '/heroes', label: 'Heroes', icon: UsersThree },
		{ href: '/estate', label: 'Estate', icon: Bank },
		{ href: '/town', label: 'Town', icon: Buildings },
		{ href: '/raid', label: 'Raid', icon: Compass },
		{ href: '/settings', label: 'Settings', icon: Gear }
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

<ModeWatcher />
<Toaster />
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
		</SidebarHeader>

		<SidebarContent>
			<SidebarGroup>
				<SidebarGroupContent>
					<SidebarMenu>
						{#each navItems as item}
							<SidebarMenuItem>
								<SidebarMenuButton isActive={currentPath === item.href}>
									{#snippet child({ props })}
										<a href={item.href} {...props}>
											<item.icon size={20} />
											<span>{item.label}</span>
										</a>
									{/snippet}
								</SidebarMenuButton>
							</SidebarMenuItem>
						{/each}
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>
		</SidebarContent>

		<SidebarFooter>
			<div class="flex items-center justify-between px-2">
				<Tooltip>
					<TooltipTrigger>
						<Button variant="ghost" size="icon" onclick={toggleMode}>
							<Sun class="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
							<Moon class="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
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

			<div class="ml-auto flex items-center gap-2">
				<Tooltip>
					<TooltipTrigger>
						<Button variant="outline" size="sm" disabled>
							<FloppyDisk size={16} class="mr-1" />
							Save
						</Button>
					</TooltipTrigger>
					<TooltipContent>No profile loaded</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger>
						<Button variant="ghost" size="sm" disabled>
							<Archive size={16} class="mr-1" />
							Backup
						</Button>
					</TooltipTrigger>
					<TooltipContent>No profile loaded</TooltipContent>
				</Tooltip>
			</div>
		</header>

		<main class="flex-1 overflow-auto p-4">
			{@render children()}
		</main>
	</SidebarInset>
</SidebarProvider>
