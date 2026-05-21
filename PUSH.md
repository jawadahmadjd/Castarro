# Push Automation (`python push`)

This repo now has a root-level script named `push` that automates release preparation.

## What `python push` does

1. Runs local release preflight (`npm run release:check`) unless skipped.
2. Bumps `package.json` version (and `package-lock.json`).
3. Commits and pushes the current branch.

After push to `main`, GitHub Actions (`.github/workflows/release-windows.yml`) takes over:

- checks if tag `v<version>` already exists
- builds installer + `latest.yml`
- publishes GitHub release assets
- users receive app update via auto-updater

## Important project-specific behavior

Unlike the Animal Channel repo flow, this script does **not** create/push tags locally.
Your workflow creates and pushes release tags itself after a successful build.

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

Only stage version files:

```powershell
python push --no-stage-all
```
