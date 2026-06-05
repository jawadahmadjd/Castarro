# Push Automation (`python push`)

This repo now has a root-level script named `push` that automates release preparation.

## What `python push` does

1. Runs local desktop preflight (`npm run icon`, `npm run bundle:runtime`, `npm run dist`, `npm run smoke:packaged`) and mobile preflight (`npm run verify:mobile`) unless skipped.
2. Bumps `package.json` version (and `package-lock.json`).
3. Commits and pushes the current branch.

After push to `main`, GitHub Actions (`.github/workflows/release-windows.yml`) takes over:

- checks if tag `v<version>` already exists
- detects whether Windows signing secrets are configured
- builds installer + `latest.yml`
- builds signed Android release APK + SHA256 checksum when Android signing secrets are configured
- verifies installer Authenticode signature (when signing is enabled)
- publishes GitHub release assets for Windows, plus Android when signing secrets are configured
- users receive app update via auto-updater

## Important project-specific behavior

Unlike the Animal Channel repo flow, this script does **not** create/push tags locally.
Your workflow creates and pushes release tags itself after a successful build.

`python push` does not run installer smoke by default, because that check installs/uninstalls Castarro and requires the already-installed app to be closed. This keeps live streams running while local build/package checks still run.

Use `--with-installer-smoke` only when you intentionally want the full local installer test and Castarro is closed. On Windows, that mode sets `CASTARRO_INSTALLER_SMOKE_ROOT=C:\tmp` automatically when the variable is not already set, then performs a writable-path preflight check.

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

Run the full installer smoke too:

```powershell
python push --with-installer-smoke
```

Only stage version files:

```powershell
python push --no-stage-all
```
