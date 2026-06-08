# Castarro Mobile Android

Native Android MVP scaffold for Castarro's mobile copy-mode streaming app.

## Scope

- Android-first.
- Prerecorded video files only.
- No camera permission.
- No microphone permission.
- Manual RTMPS stream profiles.
- YouTube account/OAuth mode for creating Live events directly on mobile.
- Copy-mode promise mirrors desktop: `-re -i video.mp4 -c copy -f flv rtmps://...`.

## Project Stack

- Kotlin.
- Jetpack Compose.
- Material 3.
- Room.
- DataStore.
- AndroidX Security Crypto for stream-key references.
- Google Play Services Authorization for YouTube account consent.
- Foreground service boundary for active streaming.

## Product Decisions Still Required

- Google OAuth consent-screen verification and production publishing review.

## Product Decisions Made

- MVP scope is Android-first, prerecorded-file-only, and copy/remux-only.
- MVP excludes camera, microphone, and live capture.
- Mobile YouTube account mode creates a Live broadcast and stream, binds them, and stores the generated stream name encrypted on device.
- Mobile streaming backend targets an LGPL-compatible Android FFmpeg executable or native wrapper. See `docs/FFMPEG_BACKEND_DECISION.md`.

## Shared Core

The Android app should consume contracts from `../../../shared/castarro-core` for fixtures, schemas, design tokens, and shared feature flags. UI layout remains Android-native and should have its own acceptance screenshots.

## Release Docs

- `docs/PERMISSIONS.md`
- `docs/PLAY_STORE_PRIVACY_DECLARATIONS.md`
- `docs/APK_SMOKE_TEST_CHECKLIST.md`
- `docs/DEVICE_TEST_MATRIX.md`
- `docs/IOS_FEASIBILITY_NOTES.md`

## GitHub Release APKs

The main release workflow builds a signed release APK and uploads it to the same GitHub Release as the Windows installer:

- `Castarro-Android-X.Y.Z.apk`
- `Castarro-Android-X.Y.Z.apk.sha256`

Required repository secrets:

```text
CASTARRO_ANDROID_KEYSTORE_BASE64
CASTARRO_ANDROID_KEYSTORE_PASSWORD
CASTARRO_ANDROID_KEY_ALIAS
CASTARRO_ANDROID_KEY_PASSWORD
```

Generate the release keystore once with `keytool`, store it outside the repository, and convert that file to base64 for `CASTARRO_ANDROID_KEYSTORE_BASE64`.

Keep the real keystore and `keystore.properties` outside git. The same release key must be reused for every GitHub APK release so Android users can update over an existing install.
