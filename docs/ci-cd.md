# CI/CD Pipeline & Dependabot

## Overview

- **PR/Push CI**: Lightweight checks (svelte-check, cargo clippy, cargo test, cargo fmt) on Linux only
- **Release**: Tag-triggered (`v*`) cross-platform builds via `tauri-action@v1`, draft → build → publish
- **Dependabot**: Weekly updates for npm, Cargo, and GitHub Actions with grouping
- **Security Audit**: Weekly `cargo audit` + `pnpm audit`

## Design Decisions

### Runners
- **Linux**: `ubuntu-22.04` (pinned, not `latest`) — older glibc = broader .deb/.AppImage compatibility
- **macOS**: `macos-latest` — universal binary (Intel + Apple Silicon) via `--target universal-apple-darwin`
- **Windows**: `windows-latest`

### Why Not Full Tauri Build on PRs?
Full builds take 30-45 min across 3 platforms. `cargo clippy` + `cargo test` + `pnpm check` + `pnpm build` catches 99% of issues in under 5 minutes. Reserve full builds for release tags.

### Unsigned Builds
No code signing certificates. Users bypass Gatekeeper/SmartScreen manually. macOS users run `xattr -cr "/Applications/Hamlet Editor.app"`. Release notes should include bypass instructions per platform.

### macOS Universal Binary
Single DMG for Intel + Apple Silicon. Size penalty is negligible for a save editor. Simpler release page (one macOS download).

### Dependabot vs Renovate
Dependabot is simpler, built into GitHub, and supports all our ecosystems (pnpm, Cargo, Actions). Sufficient for a single-repo open-source project.

### Draft Release Workflow
Three-phase: (1) create draft with changelog, (2) build all platforms in parallel, (3) publish only after all succeed. Prevents releasing with missing platform artifacts.

## Required Repository Settings

- **Actions permissions**: "Read and write permissions" for `GITHUB_TOKEN` (Settings → Actions → General)
- **Branch protection on `main`**: Require `frontend` and `rust` CI jobs to pass
- **No secrets needed** for unsigned builds — `GITHUB_TOKEN` is automatic

## Artifacts

Naming follows `tauri.conf.json` app name + version:
- **Windows**: `Hamlet Editor_x.y.z_x64-setup.exe` (NSIS), `Hamlet Editor_x.y.z_x64_en-US.msi`
- **macOS**: `Hamlet Editor_x.y.z_universal.dmg`
- **Linux**: `hamlet-editor_x.y.z_amd64.deb`, `hamlet-editor_x.y.z_amd64.AppImage`

## Caching Strategy

- **Rust**: `swatinem/rust-cache@v2` with `workspaces: './src-tauri -> target'`
- **pnpm**: `actions/setup-node@v4` with `cache: 'pnpm'`
- Keys based on lockfiles + OS + Rust version

## Files

- `.github/workflows/ci.yml` — PR/push checks
- `.github/workflows/release.yml` — tag-triggered release builds
- `.github/workflows/audit.yml` — security auditing
- `.github/dependabot.yml` — dependency updates
- `cliff.toml` — changelog generation config
