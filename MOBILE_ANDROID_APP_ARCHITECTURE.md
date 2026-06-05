# Castarro Mobile Android Architecture

## TODO List
- [x] Phase 0: Product decisions
  - [x] Confirm Android-first MVP scope: prerecorded video file to YouTube Live by copy/remux streaming only.
  - [x] Confirm no camera, microphone, or live capture features in MVP.
  - [x] Choose license strategy for the mobile streaming backend: LGPL-compatible Android FFmpeg executable or native wrapper. See `mobile/android/CastarroMobile/docs/FFMPEG_BACKEND_DECISION.md`.
  - [x] Decide whether the first release supports manual RTMP/RTMPS keys only or includes YouTube OAuth: first release is manual RTMP/RTMPS only.
- [x] Phase 1: Shared Castarro Core
  - [x] Create `shared/castarro-core/` for cross-platform contracts used by desktop and mobile.
  - [x] Add versioned JSON schemas for channels, videos, stream profiles, compatibility reports, YouTube profiles, and stream sessions.
  - [x] Add shared compatibility fixtures for ready videos and blocked videos.
  - [x] Add shared design tokens for color, radius, spacing, typography, and status tones.
  - [x] Add a small contract test runner so desktop and Android validate the same examples.
  - [x] Define a feature flag manifest that marks each feature as `shared`, `desktopOnly`, or `mobileOnly`.
- [x] Phase 2: Android Studio project setup
  - [x] Create native Android project under `mobile/android/CastarroMobile`.
  - [x] Use Kotlin, Jetpack Compose, Material 3, Room, DataStore, and a foreground streaming service.
  - [x] Add CI build task for debug APK.
  - [x] Add app signing placeholders without committing secrets.
- [x] Phase 3: Local video workflow
  - [x] Add file picker through Android Storage Access Framework.
  - [x] Persist selected files as app-managed `VideoAsset` records.
  - [x] Validate H.264/AAC/MP4 compatibility before allowing live streaming.
  - [x] Read shared compatibility rules and messages from `shared/castarro-core/` where possible.
  - [x] Show clear `Ready` or `Needs desktop prep` status.
- [x] Phase 4: Manual YouTube stream setup
  - [x] Add RTMPS server URL and stream key profile.
  - [x] Store stream keys encrypted.
  - [x] Use the shared `StreamProfile` schema for manual and YouTube account destinations.
  - [x] Build start/stop controls using a foreground service.
  - [x] Surface upload speed, elapsed time, file progress, and reconnect status in the service/session contract.
- [x] Phase 5: Streaming engine
  - [x] Implement copy-mode file streaming with real-time pacing through the FFmpeg process boundary.
  - [x] Mirror the desktop command behavior: `-re -i video.mp4 -c copy -f flv rtmps://...`.
  - [x] Capture process logs and convert common FFmpeg errors into user-friendly messages.
  - [x] Add loop playlist support after single-file streaming is stable.
- [ ] Phase 6: YouTube account mode (deferred by manual-key MVP decision)
  - [ ] Add Google OAuth.
  - [ ] Create or select YouTube Live broadcasts.
  - [ ] Fetch ingestion endpoint and stream name automatically.
  - [x] Bind mobile stream profiles to Castarro channels.
- [x] Phase 7: Reliability
  - [x] Add network-loss detection and reconnect policy.
  - [x] Keep the foreground notification accurate during streaming.
  - [x] Add session history and crash-safe stream cleanup.
  - [x] Save session history in the shared `StreamSession` shape so desktop and mobile can later display each other's sessions.
  - [ ] Test on mobile data, Wi-Fi, low battery, app backgrounding, and screen lock. See `mobile/android/CastarroMobile/docs/DEVICE_TEST_MATRIX.md`.
- [x] Phase 8: Release readiness
  - [x] Add Play Store privacy declarations.
  - [x] Document required permissions.
  - [x] Add APK smoke-test checklist.
  - [x] Prepare iOS feasibility notes after Android MVP proves the streaming engine.

---

## 1. Product Goal

Build an Android-first Castarro mobile app that lets users stream a prerecorded, already-compatible video file to YouTube Live from their phone using mobile data or Wi-Fi.

The mobile app is not a camera broadcaster. It does not need camera or microphone access. It is a portable copy-mode streaming tool:

```text
Phone video file
  -> compatibility check
  -> real-time copy/remux stream
  -> YouTube RTMP/RTMPS ingest
```

The desktop product currently centers on:

```powershell
ffmpeg -re -i video.mp4 -c copy -f flv rtmp://a.rtmp.youtube.com/live2/YOUR_STREAM_KEY
```

The mobile architecture should preserve that mental model. If a video is not suitable for copy-mode streaming, the app should reject it clearly instead of silently transcoding.

## 2. Android-First Recommendation

Use Android Studio with native Kotlin for the MVP.

Recommended stack:

- Kotlin
- Jetpack Compose for UI
- Material 3 as the base component system
- Custom Castarro theme tokens based on the current desktop UI
- Room for local session/channel/video records
- DataStore for lightweight preferences
- Encrypted storage for stream keys and OAuth tokens
- Foreground service for active streaming
- WorkManager only for non-live maintenance tasks

Flutter can remain a later option for shared UI, but the streaming engine should stay native or native-library-backed. A pure Dart streaming engine is not the right risk profile for RTMP/RTMPS copy-mode media delivery.

## 3. Permissions

MVP permissions should stay minimal:

- `INTERNET`
- Foreground service permission/type appropriate for long-running upload/streaming work
- Notification permission where Android requires it

Avoid:

- `CAMERA`
- `RECORD_AUDIO`
- Broad storage permissions

Use Android's Storage Access Framework for video selection. The app should request access to the selected file only, then either stream from the granted URI or import the file into app-private storage when the streaming backend requires a normal filesystem path.

## 4. High-Level Architecture

```text
Castarro Mobile

UI Layer
  Compose screens, navigation, theme, user actions

Domain Layer
  Use cases, validation rules, stream readiness, session state

Data Layer
  Room database, DataStore settings, encrypted secrets, YouTube API client

Streaming Layer
  FFmpeg/libav process wrapper or native streaming engine
  Foreground service
  Log parser
  Reconnect supervisor

Platform Layer
  File picker, notifications, network monitor, wake locks when required
```

## 5. Shared Core Balance

The desktop and mobile apps should share product behavior without forcing the same UI or the same runtime implementation everywhere.

Recommended rule:

```text
Shared feature brain, separate device-native hands.
```

That means shared contracts and rules should live in one place, while desktop UI, Android UI, desktop FFmpeg process handling, and Android foreground-service streaming remain independently implemented.

### 5.1 What Should Stay Shared

These should be linked across desktop and mobile:

- Channel data shape
- Stream profile data shape
- Video compatibility rules and user-facing validation messages
- YouTube account/broadcast concepts
- Session history shape
- Stream status names
- Error categories
- Design tokens
- Feature flags
- Test fixtures
- API/contract documentation

When a shared feature changes, both apps should receive the new contract and run the same fixture tests.

Examples:

- A new compatibility check for keyframe interval.
- A new YouTube Auto Start/Stop status.
- A new session history field.
- A new stream destination mode.
- A new status tone such as `reconnecting`.

### 5.2 What Should Stay Separate

These should not be automatically linked:

- Desktop layout
- Mobile layout
- Desktop-specific Electron shell behavior
- Android foreground notification behavior
- Android Storage Access Framework behavior
- Desktop folder picker behavior
- Desktop preview panel behavior
- Mobile touch-first navigation
- Native streaming process supervision details

Desktop can use a wide channel-first control room. Mobile should use a compact touch-first setup flow. They should feel like the same product, but they should not be forced into the same layout.

### 5.3 Shared Core Folder

Create this folder before the Android app grows too far:

```text
shared/castarro-core/
  README.md
  manifest.json
  schemas/
    channel.schema.json
    video-asset.schema.json
    stream-profile.schema.json
    compatibility-report.schema.json
    youtube-profile.schema.json
    stream-session.schema.json
  fixtures/
    compatibility/
      ready-h264-aac-1080p30.json
      blocked-hevc.json
      blocked-opus-audio.json
    stream-profiles/
      manual-rtmps.json
      youtube-account.json
  design-tokens/
    castarro.tokens.json
  feature-flags/
    features.json
  tests/
    contract-cases.json
```

Start with JSON schemas and fixtures because they are language-neutral and easy for both desktop Python/JavaScript and Android Kotlin to consume.

### 5.4 Feature Flag Manifest

Use a small manifest to keep the balance explicit.

Example:

```json
{
  "features": [
    {
      "id": "manual_rtmps_streaming",
      "scope": "shared",
      "desktop": true,
      "android": true,
      "ios": false
    },
    {
      "id": "desktop_folder_normalization",
      "scope": "desktopOnly",
      "desktop": true,
      "android": false,
      "ios": false
    },
    {
      "id": "android_foreground_stream_notification",
      "scope": "mobileOnly",
      "desktop": false,
      "android": true,
      "ios": false
    }
  ]
}
```

Rules:

- `shared`: same behavior, same contract, separate UI implementation allowed.
- `desktopOnly`: desktop feature that mobile should not inherit automatically.
- `mobileOnly`: mobile feature that desktop should not inherit automatically.

### 5.5 Design Token Sharing

Desktop CSS and Android Compose should both consume the same design intent:

```json
{
  "color": {
    "background": "#F4F0E8",
    "surface": "#FFFAF0",
    "navigationDark": "#2F2414",
    "gold": "#D99A32",
    "green": "#2F7A55",
    "danger": "#A9493D"
  },
  "radius": {
    "tool": 8
  },
  "statusTone": {
    "ready": "green",
    "warning": "gold",
    "blocked": "danger",
    "live": "green",
    "reconnecting": "gold"
  }
}
```

The token file can drive:

- Desktop CSS variables.
- Android Compose color/theme objects.
- Static design mocks.

Layout should still be implemented separately for each platform.

### 5.6 Immediate Implementation Checklist

Use this checklist before starting the Android Studio project:

  - [x] Add `shared/castarro-core/README.md` explaining linked vs separate feature rules.
  - [x] Add `shared/castarro-core/manifest.json` with core version and supported platforms.
  - [x] Add first schema files for `Channel`, `VideoAsset`, `StreamProfile`, `CompatibilityReport`, and `StreamSession`.
  - [x] Add compatibility fixtures for ready H.264/AAC and blocked HEVC examples.
  - [x] Add `castarro.tokens.json` using the current desktop shell palette.
  - [x] Add `features.json` with `shared`, `desktopOnly`, and `mobileOnly` examples.
  - [x] Add a desktop-side validation script that checks fixtures against schemas.
  - [x] Add a future Android task to load the same fixtures in Kotlin tests.
  - [x] Document that shared features require contract updates before UI work begins.
  - [x] Document that UI changes require separate desktop and mobile acceptance screenshots.

### 5.7 Acceptance Criteria For Shared Core

This shared-core strategy is ready when:

1. A shared feature can be described once in `shared/castarro-core/`.
2. Desktop and Android can both validate the same example data.
3. Design colors and status tones come from one token source.
4. Feature scope is explicit as `shared`, `desktopOnly`, or `mobileOnly`.
5. A desktop UI change does not accidentally become a mobile layout requirement.
6. A mobile-only behavior does not add unnecessary complexity to the desktop app.

## 6. Suggested Project Layout

```text
mobile/android/CastarroMobile/
  app/
    build.gradle.kts
    src/main/
      AndroidManifest.xml
      java/com/castarro/mobile/
        CastarroApp.kt
        MainActivity.kt

        ui/
          theme/
            CastarroColors.kt
            CastarroTheme.kt
            CastarroTypography.kt
          navigation/
            AppNavGraph.kt
            CastarroDestination.kt
          screens/
            DashboardScreen.kt
            VideoLibraryScreen.kt
            YoutubeScreen.kt
            LiveMonitorScreen.kt
            HistoryScreen.kt
            SettingsScreen.kt
          components/
            ChannelHeader.kt
            ReadinessCard.kt
            StreamActionBar.kt
            VideoAssetRow.kt
            StatusBand.kt

        domain/
          model/
            CastarroChannel.kt
            VideoAsset.kt
            StreamProfile.kt
            StreamSession.kt
            CompatibilityReport.kt
            YoutubeBroadcast.kt
          usecase/
            PickVideoUseCase.kt
            ValidateVideoUseCase.kt
            StartStreamUseCase.kt
            StopStreamUseCase.kt
            CreateYoutubeBroadcastUseCase.kt
            SaveStreamProfileUseCase.kt

        data/
          db/
            CastarroDatabase.kt
            ChannelDao.kt
            VideoAssetDao.kt
            StreamSessionDao.kt
          preferences/
            AppPreferences.kt
          secrets/
            SecretStore.kt
          youtube/
            YoutubeAuthRepository.kt
            YoutubeLiveRepository.kt
          files/
            VideoImportRepository.kt

        streaming/
          StreamForegroundService.kt
          StreamController.kt
          StreamCommandBuilder.kt
          StreamProcessRunner.kt
          StreamLogParser.kt
          StreamReconnectPolicy.kt
          VideoCompatibilityProbe.kt

        platform/
          FilePickerLauncher.kt
          NetworkMonitor.kt
          NotificationFactory.kt
```

## 7. Core Data Models

### `CastarroChannel`

Represents a Castarro channel profile.

Important fields:

- `id`
- `displayName`
- `avatarUri`
- `defaultStreamProfileId`
- `youtubeAccountId`
- `createdAt`
- `updatedAt`

### `VideoAsset`

Represents a selected phone video.

Important fields:

- `id`
- `displayName`
- `sourceUri`
- `localPath`
- `durationMs`
- `sizeBytes`
- `videoCodec`
- `audioCodec`
- `width`
- `height`
- `fps`
- `audioSampleRate`
- `compatibilityStatus`
- `compatibilityMessage`

### `StreamProfile`

Represents where and how the file will stream.

Important fields:

- `id`
- `channelId`
- `videoAssetId`
- `mode`: `manualKey` or `youtubeAccount`
- `rtmpServerUrl`
- `streamKeySecretRef`
- `youtubeBroadcastId`
- `loopEnabled`
- `restartOnExit`
- `createdAt`
- `updatedAt`

### `StreamSession`

Represents one live attempt.

Important fields:

- `id`
- `channelId`
- `videoAssetId`
- `startedAt`
- `endedAt`
- `status`
- `exitCode`
- `bytesUploaded`
- `averageBitrate`
- `failureReason`
- `logPath`

### `CompatibilityReport`

Represents copy-mode readiness.

Important fields:

- `isReady`
- `videoCodec`
- `audioCodec`
- `container`
- `warnings`
- `blockingIssues`
- `recommendedFix`

## 8. Streaming Engine Strategy

### MVP Recommendation

Use a native FFmpeg process or custom FFmpeg/libav build for Android, supervised by Kotlin.

Why:

- It preserves the desktop behavior.
- It proves the product fastest.
- It keeps copy-mode logic simple.
- It avoids writing an RTMP muxer from scratch.

Example command shape:

```text
ffmpeg -hide_banner -nostdin -re -i /app/video.mp4 -c copy -f flv rtmps://a.rtmps.youtube.com/live2/STREAM_KEY
```

Add later:

```text
-stream_loop -1
```

when the mobile playlist/loop feature is ready.

### Important Licensing Decision

Before implementation, decide whether the mobile app can ship:

- LGPL FFmpeg build only
- GPL FFmpeg build
- Commercial SDK
- Custom native implementation

The decision affects Play Store distribution, source disclosure obligations, and which codecs/protocols are available.

### Avoid For MVP

Do not build the first MVP around Android `MediaCodec` alone. `MediaCodec` is useful for encoding/decoding, but this product's problem is file packet reading, real-time pacing, FLV/RTMP muxing, RTMPS networking, reconnect supervision, and user-safe error handling.

## 9. Copy-Mode Compatibility Rules

The app should allow streaming only when the selected file is compatible with YouTube RTMP/RTMPS copy-mode delivery.

Minimum MVP rules:

- Container: MP4/MOV that the engine can read reliably
- Video: H.264
- Audio: AAC
- Pixel format: compatible with YouTube Live expectations
- Resolution/FPS/bitrate: within selected YouTube Live profile
- Audio sample rate: preferably 48 kHz
- Keyframe interval: suitable for live streaming

Blocking examples:

- HEVC video for RTMP copy-mode
- VP9/AV1 video for RTMP copy-mode
- MP3/Opus audio for RTMP copy-mode
- Variable or broken timestamps that break live pacing
- Unsupported container

User-facing result:

```text
Ready to stream
```

or:

```text
Needs desktop prep
Open Castarro Desktop and normalize this video first.
```

## 10. User Flows

### 9.1 Manual Key MVP

```text
Open app
  -> choose channel
  -> select video
  -> app validates file
  -> enter YouTube RTMPS URL and stream key
  -> app shows Ready
  -> tap Go Live
  -> foreground service starts
  -> monitor status
  -> tap Stop
```

### 9.2 YouTube Account Mode

```text
Open YouTube screen
  -> connect Google account
  -> create or select broadcast
  -> app receives ingestion URL + stream name
  -> app fills stream profile
  -> tap Go Live
```

### 9.3 Error Recovery

```text
Network drops
  -> foreground service marks Reconnecting
  -> retry with backoff
  -> preserve session log
  -> show final result when retry limit is reached
```

## 11. Foreground Service

Active streaming must run in a foreground service so the user can leave the screen without silently killing the stream.

Foreground notification should show:

- Channel name
- Video name
- Live/connecting/reconnecting/stopped
- Elapsed time
- Stop action

The service owns:

- Stream process lifetime
- Log collection
- Reconnect loop
- Session state updates
- Cleanup on stop/crash

The UI observes service state through a repository flow.

## 12. Local Database

Use Room for:

- Channels
- Videos
- Stream profiles
- Stream sessions
- YouTube broadcast cache

Use DataStore for:

- Last selected channel
- Preferred privacy
- Default loop setting
- Last used bitrate/resolution label

Use encrypted storage for:

- Stream keys
- OAuth refresh tokens
- Sensitive account identifiers when needed

## 13. YouTube Integration

The app should support two modes.

### Manual Mode

Best for MVP:

- User enters RTMP/RTMPS server URL.
- User enters stream key.
- App stores the stream key securely.
- App does not need Google verification immediately.

### Account Mode

More polished:

- User signs in with Google.
- App creates or lists broadcasts.
- App creates or binds live streams.
- App uses returned ingestion info to fill the stream profile.

The UI should keep manual mode available even after account mode exists. It is simpler for power users and helpful during OAuth review delays.

## 14. Mobile UI Information Architecture

Use one selected channel as the working context, matching the current desktop channel-first direction.

Recommended navigation:

```text
Top app bar
  Castarro
  active channel selector
  live status

Bottom navigation
  Home
  Video
  YouTube
  History

Primary actions
  Go Live
  Stop
```

Screens:

- `Home`: readiness, selected video, selected destination, live action
- `Video`: file picker, compatibility report, selected videos
- `YouTube`: manual stream key, account connection, schedule/import
- `History`: recent sessions and logs
- `Settings`: secondary screen opened from top menu

## 15. API Surface Inside The App

Internal Kotlin interfaces:

```kotlin
interface VideoRepository {
    fun observeVideos(channelId: String): Flow<List<VideoAsset>>
    suspend fun importVideo(uri: Uri): VideoAsset
    suspend fun validate(videoId: String): CompatibilityReport
}

interface StreamRepository {
    fun observeActiveSession(channelId: String): Flow<StreamSession?>
    suspend fun start(profileId: String)
    suspend fun stop(channelId: String)
}

interface YoutubeRepository {
    fun observeAccounts(): Flow<List<YoutubeAccount>>
    suspend fun connectAccount()
    suspend fun createBroadcast(request: CreateBroadcastRequest): YoutubeBroadcast
}
```

## 16. Testing Strategy

Unit tests:

- Compatibility rules
- Stream command builder
- Reconnect policy
- Log parser
- Secret reference handling

Instrumentation tests:

- File picker/import flow with test media
- Foreground service start/stop
- Notification stop action
- Room migrations

Manual device tests:

- Wi-Fi stream
- Mobile data stream
- Screen locked during stream
- App in background
- Network drop/reconnect
- Low battery warning
- Unsupported video rejection
- Wrong stream key
- YouTube Auto Start/Stop behavior

## 17. Acceptance Criteria

The Android MVP is ready when:

1. The app streams a selected compatible MP4 to YouTube Live without camera or mic access.
2. The app rejects incompatible files before going live.
3. The stream runs from a foreground service.
4. The user can stop the stream from both the app and notification.
5. Stream key storage is encrypted.
6. The UI clearly shows selected video, selected destination, readiness, elapsed time, and errors.
7. Session history records each stream attempt.
8. The app behavior matches Castarro Desktop's copy-mode promise.
