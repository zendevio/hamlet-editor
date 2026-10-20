# Hamlet Editor

A cross-platform visual save game editor for Darkest Dungeon 1.

Built with Tauri 2 + SvelteKit + Rust.

## Features

- Hero editing: stats, stress, quirks, trinkets, resolve level, and more
- Estate management: gold, busts, deeds, portraits, and other resources
- Town buildings: upgrades for Sanitarium, Blacksmith, Guild, and others
- Raid editing: party reorder, torchlight, scout chance, inventory (active raid only)
- Automatic backups before save, with manual backup support
- Auto-detection of Darkest Dungeon save locations
- Multi-profile support (switch between Steam profiles)

## Requirements

- Darkest Dungeon 1 installed (Steam or GOG)
- The game must be closed before saving changes

## Steam Cloud

If Steam Cloud sync is enabled for Darkest Dungeon, Steam can overwrite your
edited saves with the cloud copy, or report a sync conflict that leads to a
corrupted campaign. Before editing, either turn off Steam Cloud for the game
(in your Steam Library, right-click Darkest Dungeon, choose Properties, then on
the General tab turn off "Keep game saves in the Steam Cloud") or fully close
Steam while you edit and save. The editor does not detect cloud sync for you.

**Restoring backups:** For Steam-managed profiles, quit Steam completely before
restoring a backup that adds or removes save files. The running client caches
file sizes and can prevent the restored campaign from loading. Overwrite-only
restores and normal saves are unaffected by this restriction.

## Installing (unsigned builds)

Download from [this repository's Releases page](https://github.com/zendevio/hamlet-editor/releases) and check the SHA-256 shown next to the file. Builds have no paid code-signing certificates. macOS bundles use an ad-hoc signature and are not notarized, so first-launch warnings are expected.

### Windows (10/11, x64)

- Use `hamlet-editor_1.0.0_windows_x64-setup.exe` for per-user installation without admin rights, or `hamlet-editor_1.0.0_windows_x64.msi`.
- Your browser may warn that the file is not commonly downloaded. Choose **Keep** (Edge: **... > Keep > Show more > Keep anyway**).
- If SmartScreen shows **Windows protected your PC**, click **More info**, then **Run anyway**.
- If Smart App Control is on, Windows 11 may block the unsigned installer outright, with no per-app override. The app can only be installed where Smart App Control is off.
- The installer downloads WebView2 if it is missing, which needs internet access.

### macOS (11 or later, Intel and Apple Silicon)

1. Open `hamlet-editor_1.0.0_darwin_universal.dmg` and drag **Hamlet Editor** to Applications.
2. Open it once. If macOS cannot verify the developer, dismiss the warning with **Done** or **OK**.
3. Open **System Settings > Privacy & Security**, scroll to Security, click **Open Anyway** next to Hamlet Editor, authenticate if prompted, then click **Open**. On macOS 11/12, use **System Preferences > Security & Privacy > General**. On macOS 15 and later, use these settings instead of relying on Control-click > Open.
4. If the verified download still says the app **is damaged and can't be opened**, remove its download quarantine flag and try again:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/Hamlet Editor.app"
   ```

The ad-hoc signature supports Apple Silicon execution; it does not identify a verified developer or bypass Gatekeeper. See [Apple's first-launch instructions](https://support.apple.com/en-us/102445).

### Linux (x86_64)

- AppImage: `chmod +x hamlet-editor_1.0.0_linux_amd64.AppImage`, then run `./hamlet-editor_1.0.0_linux_amd64.AppImage`. On Ubuntu 24.04+, install FUSE 2 with `sudo apt install libfuse2t64`, or run the AppImage with `--appimage-extract-and-run`.
- Debian/Ubuntu: `sudo apt install ./hamlet-editor_1.0.0_linux_amd64.deb`.
- Fedora: `sudo dnf install ./hamlet-editor_1.0.0_linux_x86_64.rpm`. On openSUSE, use `sudo zypper install ./hamlet-editor_1.0.0_linux_x86_64.rpm`.
- If the window is blank on an NVIDIA/Wayland setup, try `WEBKIT_DISABLE_DMABUF_RENDERER=1 ./hamlet-editor_1.0.0_linux_amd64.AppImage`.
- Steam Deck: install and run the AppImage in Desktop Mode.

Linux installers target Ubuntu 22.04's glibc 2.35 baseline. Other distributions also need compatible WebKitGTK 4.1 libraries for native packages.

## Development

```sh
pnpm install
pnpm tauri dev
```

## Building

```sh
pnpm tauri build
```

## Credits

- [robojumper](https://github.com/robojumper) for [ddsavelib](https://github.com/robojumper/DarkestDungeonSaveEditor/tree/master/rust/ddsaveedit/ddsavelib) and [DDSaveEditor](https://github.com/robojumper/DarkestDungeonSaveEditor) (MIT)
- Hamlet Editor is an unofficial fan tool and is not affiliated with, endorsed by, or associated with Red Hook Studios. Darkest Dungeon is a registered trademark of Red Hook Studios Inc.

## License

MIT. See [third-party notices](THIRD_PARTY_NOTICES.md) for included code and documentation.
