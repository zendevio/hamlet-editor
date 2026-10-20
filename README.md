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

**Restoring backups:** For Steam-managed profiles, quit Steam completely before restoring a backup that adds
or removes save files. The running client caches file sizes and can prevent the
restored campaign from loading. Overwrite-only restores and normal saves are
unaffected by this restriction.

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

- [robojumper](https://github.com/robojumper) for [ddsavelib](https://github.com/robojumper/ddsavelib) and [DDSaveEditor](https://github.com/robojumper/DarkestDungeonSaveEditor) (MIT)
- Hamlet Editor is an unofficial fan tool and is not affiliated with, endorsed by, or associated with Red Hook Studios. Darkest Dungeon is a registered trademark of Red Hook Studios Inc.

## License

MIT
