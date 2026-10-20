# CI/CD and releases

## Checks

Pushes to `main` and pull requests run frontend checking, building and tests, plus Rust formatting, strict Clippy and tests. The vendored save codec has explicit formatting, Clippy and test steps as a workspace member and app path dependency. Codec Clippy runs from `src-tauri` with `--locked -p ddsavelib`, using the same app Cargo.lock as the shipped dependency graph. Rust is pinned to 1.99.1 in `src-tauri/rust-toolchain.toml` and in Actions; the declared 1.95 minimum is not independently tested. pnpm 12.14.0 is pinned in `package.json`, and Node 24 comes from `.node-version`.

Weekly security checks run `cargo audit` and full `pnpm audit`, including frontend libraries compiled from dev dependencies. cargo-audit is installed from a checksum-verified prebuilt release through the pinned install action, with source-install fallback disabled. GitHub disables scheduled workflows in public repositories after 60 days without activity; check that the schedule remains enabled.

Dependabot checks npm, Cargo and SHA-pinned GitHub Actions weekly. Action pins have version comments. Checkout never persists Git credentials. CI and audit have read-only repository tokens; the release workflow starts with no permissions. Draft creation and installer upload jobs receive `contents: write`; dry-run builds receive only `contents: read`. No signing secrets are needed.

## Before the first release

1. Push `main` only and wait for CI. Avoid `--tags` and `--follow-tags`: local pre-release tags contain old workflows, and pushing more than three tags together can suppress tag events.
2. Run **Actions > Release > Run workflow** on `main`. This builds Windows, macOS and Linux installers as workflow artifacts without creating or publishing a release. Each artifact ZIP contains the original Tauri filename; custom release names are applied only to GitHub release assets.
3. Download and test the Windows setup/MSI, universal macOS DMG on Apple Silicon, and Linux AppImage/native packages on real systems. Verify ad-hoc signing and first launch on a clean Mac. The README contains installation instructions. If hardened runtime prevents the ad-hoc app from launching, investigate `bundle.macOS.hardenedRuntime: false` and repeat the dry run before tagging.
4. Add `.github/release-notes/v1.0.0.md` with curated public release notes before tagging. For later versions, use `.github/release-notes/<tag>.md`. The draft body comes from this file. Create `v1.0.0` on the tested commit and push **only** `git push origin v1.0.0`. Tag, npm, Cargo and Tauri versions must agree. Tags are filtered to version-like names and validated before any draft is created. A version with a prerelease suffix is marked as a prerelease; MSI also requires an explicit numeric `bundle.windows.wix.version` for such versions.
5. Wait for all installer jobs to succeed. Check that every expected asset is present, inspect the curated release notes, and test the installers downloaded from the draft. Publish the draft manually from GitHub's Releases page. The workflow never auto-publishes.

Release runs are serialized per ref and have job timeouts. Use **Re-run failed jobs** so the original draft ID is retained; a full rerun can create another draft. Never publish a partial draft. Only CI-produced artifacts should be published.

## Repository settings

- Keep **Settings > Actions > General > Workflow permissions** at **Read repository contents**. Workflows request the write access they need explicitly.
- Require actions to be pinned to a full-length commit SHA in the Actions policy, where the repository or organization exposes this setting.
- Protect `main` with the **Frontend checks** and **Rust checks** status checks.
- No paid signing certificates, notarization secrets, updater keys or automatic publishing are configured.

## Runners and compatibility

- Linux: `ubuntu-22.04`, keeping a glibc 2.35 baseline for AppImage/deb compatibility. Both CI and release builds install WebKitGTK 4.1, AppIndicator, librsvg, patchelf and xdg-utils.
- macOS: `macos-26`, with `aarch64-apple-darwin` and `x86_64-apple-darwin` targets and a universal build. Minimum macOS is 11.0. Bundles use the ad-hoc identity `-`; Gatekeeper still requires first-launch approval because there is no Developer ID or notarization.
- Windows: `windows-2025`, x64 MSI and per-user NSIS installers. SmartScreen and Smart App Control may restrict these unsigned installers. The MSI upgrade code is committed so later product-name changes do not break upgrades.

Ubuntu 22.04 hosted runners are deprecated and retire on 2027-04-17, with brownouts starting 2027-03-23. Move before March 2027. An Ubuntu 24.04 runner raises the glibc floor to 2.39 and loses Ubuntu 22.04/Debian 12 AppImage compatibility; use a compatible container build if that support is retained. See the [runner retirement notice](https://github.com/actions/runner-images/issues/14254).

## Release asset names

The action uses `hamlet-editor_[version]_[platform]_[arch][setup][ext]`. For 1.0.0 the public asset names are:

| Platform | Asset |
| --- | --- |
| Windows NSIS | `hamlet-editor_1.0.0_windows_x64-setup.exe` |
| Windows MSI | `hamlet-editor_1.0.0_windows_x64.msi` |
| macOS DMG | `hamlet-editor_1.0.0_darwin_universal.dmg` |
| macOS app archive | `hamlet-editor_1.0.0_darwin_universal.app.tar.gz` |
| Linux AppImage | `hamlet-editor_1.0.0_linux_amd64.AppImage` |
| Linux deb | `hamlet-editor_1.0.0_linux_amd64.deb` |
| Linux rpm | `hamlet-editor_1.0.0_linux_x86_64.rpm` |

These names follow the pinned action's documented placeholders and architecture mapping. Confirm them against the first draft before publication. No updater signatures or `latest.json` are expected. License and third-party notice files are included under the installed resources' `licenses` directory.

GitHub shows SHA-256 digests for release assets. Build provenance attestations are not configured for 1.0.0; do not claim attestation verification is available.

## Application data

The application identifier for the first public release is `io.github.zendevio.hamlet-editor`.

| OS | Settings and backups |
| --- | --- |
| macOS | `~/Library/Application Support/io.github.zendevio.hamlet-editor/` |
| Windows | Settings: `%APPDATA%\io.github.zendevio.hamlet-editor\settings.json`; backups: `%LOCALAPPDATA%\io.github.zendevio.hamlet-editor\backups\` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/io.github.zendevio.hamlet-editor/` |

## Caching and local builds

`Swatinem/rust-cache` v2.9.2 caches the app target directory by its lockfile, OS and toolchain. `actions/setup-node` v7.1.0 caches the pnpm store. Tag-scoped Rust caches are generally cold for later tags, which is acceptable.

Locally built Rust binaries can contain home-directory paths in panic locations. To remap them for a local release build on macOS/Linux:

```sh
RUSTFLAGS="--remap-path-prefix=$HOME=~" pnpm tauri build
```

Publish only artifacts built by CI, which contain runner paths instead of local user paths. Frontend builds emit no source maps.

## Configuration

- `.github/workflows/ci.yml`: PR/push checks.
- `.github/workflows/release.yml`: tag validation, draft creation and manual dry-run entry point.
- `.github/workflows/build.yml`: shared installer matrix for tags and dry runs.
- `.github/workflows/audit.yml`: security audits.
- `.github/dependabot.yml`: dependency updates.
- `.github/scripts/release-version.mjs`: tag/version and prerelease MSI guard.
- `.github/release-notes/<tag>.md`: curated public release body.

## Regenerating bundled dependency licenses

After dependency changes, run `pnpm install --frozen-lockfile` and `cargo fetch --locked` in `src-tauri`, then run `python3 .github/scripts/generate-licenses.py` from the repository root. The generator runs Cargo metadata offline with the app lockfile and reads the installed pnpm graph. It deliberately includes platform-neutral npm build tools and all Cargo targets as a conservative superset of shipped dependencies. Commit `THIRD_PARTY_LICENSES.md` with the dependency changes. No license tool is downloaded during generation.

Package archive license/copyright/notice files with text or documentation extensions are retained verbatim; source, test and vendor subtrees are excluded. Native npm packages restricted by OS or CPU are excluded so the installed host does not change the notice set. Accepted texts are retained, with identical texts deduplicated. Packages without archive license files retain metadata attribution and refer to the complete canonical texts in `.github/scripts/license-texts/`, copied from cached upstream package distributions. Check new license expressions and add any new required canonical text before regeneration. The generated file includes JetBrains Mono's full OFL-1.1 text and is bundled under `licenses/` with the other notices. Inspect this directory in each downloaded installer before publication.
