# Fast Push Automation (`python push`)

This repo has a root-level script named `push` optimized for fast execution (~2–3 seconds).

## What `python push` does

1. Bumps `package.json` version (and `package-lock.json`) instantly using fast native JSON processing.
2. Checks git remote to prevent tag conflicts.
3. Commits and pushes the current branch.

Heavy packaging, electron installer builds, runtime zipping, packaged smoke tests, and Android builds are delegated to **GitHub Actions CI** on `main`, keeping `python push` lightning fast.

After push to `main`, GitHub Actions (`.github/workflows/release-windows.yml`) automatically takes over:

- checks if tag `v<version>` already exists
- detects whether Windows signing secrets are configured
- bundles Python & FFmpeg runtimes and builds Windows installer + `latest.yml`
- builds signed Android release APK when Android signing secrets are configured
- verifies installer signature and runs packaged/installer smoke tests on CI
- creates release tag and publishes GitHub release assets
- users receive app update via auto-updater

## Important project-specific behavior

This script does **not** create/push tags locally. GitHub Actions creates and pushes release tags automatically after a successful CI build.

Local preflight build checks and smoke tests are **skipped by default** to minimize execution time to seconds. If you want to run heavy local preflight checks before pushing, pass `--with-build-check`.

## Common commands

Fast release push (default digit-cycle patch bump, finishes in ~2 seconds):

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

Dry run (previews version and actions in 0.3 seconds):

```powershell
python push --dry-run
```

Run heavy local preflight build checks before pushing:

```powershell
python push --with-build-check
```

Only stage version files:

```powershell
python push --no-stage-all
```

