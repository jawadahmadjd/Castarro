# Push Automation (`python push`)

This repo now has a root-level script named `push` that automates release preparation.

## What `python push` does

1. Runs local desktop preflight (`npm run release:check`) and mobile preflight (`npm run verify:mobile`) unless skipped.
2. Bumps `package.json` version (and `package-lock.json`).
3. Commits and pushes the current branch.

After push to `main`, GitHub Actions (`.github/workflows/release-windows.yml`) takes over:

- checks if tag `v<version>` already exists
- detects whether Windows signing secrets are configured
- builds installer + `latest.yml`
- builds signed Android release APK + SHA256 checksum
- verifies installer Authenticode signature (when signing is enabled)
- publishes GitHub release assets for Windows and Android
- users receive app update via auto-updater

## Important project-specific behavior

Unlike the Animal Channel repo flow, this script does **not** create/push tags locally.
Your workflow creates and pushes release tags itself after a successful build.

On Windows, `python push` now sets `CASTARRO_INSTALLER_SMOKE_ROOT=C:\tmp` automatically for `release:check` when that variable is not already set. This keeps NSIS installer smoke tests on a no-space path.
It also performs a writable-path preflight check and fails early with a clear message if that path cannot be written.

## Common commands

Patch release (default digit-cycle):

```powershell
python push
```

Minor release:

```powershell
python push --bump minor
```

Use standard semver strategy:

```powershell
python push --version-strategy semver
```

Explicit version:

```powershell
python push --version 1.0.1
```

Dry run:

```powershell
python push --dry-run
```

Skip preflight check:

```powershell
python push --no-build-check
```

Skip only mobile preflight:

```powershell
python push --no-mobile-check
```

Only stage version files:

```powershell
python push --no-stage-all
```
