# Online Storage Copy-Mode Streaming Architecture

## Goal

Castarro should stream videos stored in Google Drive or another online storage provider to YouTube RTMPS while keeping the live streaming path copy/remux-only.

The live path must preserve the current Castarro promise:

```text
source video packets -> FFmpeg -re -> -c copy -> FLV mux -> YouTube RTMPS
```

No live transcoding, no pixel rendering, no overlays, no OBS-style scene composition.

The online-storage feature changes where FFmpeg reads bytes from. It does not change how FFmpeg sends the stream to YouTube.

## Current App Baseline

Castarro Desktop already has the right streaming foundation:

- `scripts/stream_manager.py` builds the live FFmpeg command.
- The default live profile is `mode: copy`.
- Playlists are generated as concat demuxer files.
- YouTube output URLs are built from `rtmp_base` plus a stream key.
- Electron launches the Python backend and bundles FFmpeg.
- YouTube account scheduling already exists through `scripts/youtube_service.py`.

Castarro Android already mirrors this contract:

- `StreamCommandBuilder.kt` builds a copy/remux command.
- `StreamProcessRunner.kt` executes it through FFmpegKit.
- `VideoImportRepository.kt` imports local videos and marks non-H.264/AAC videos as needing desktop prep.
- Shared schemas in `shared/castarro-core` define video assets, stream profiles, compatibility states, and fixtures.

The new feature should be implemented as a new source layer above the existing FFmpeg command builders.

## Non-Negotiable Copy-Mode Rules

Online videos are streamable only when they are already compatible with YouTube RTMPS copy mode.

Required video shape:

- Container: MP4/MOV that FFmpeg can demux from a seekable or range-readable source.
- Video codec: H.264/AVC.
- Audio codec: AAC.
- Pixel format: normally `yuv420p`.
- Constant, predictable frame rate is strongly preferred.
- Consistent resolution, frame rate, audio sample rate, and channel count across all items in one channel playlist.
- Bitrate must fit the selected YouTube Live profile.

If a file is HEVC, VP9, AV1, ProRes, Opus audio, AC3 audio, variable/incompatible timeline, or mixed badly with other playlist items, the app must block live copy streaming and show:

```text
Open Castarro Desktop and normalize this video first.
```

Normalization remains a separate offline preparation feature. It must not run automatically in the live stream path.

## High-Level Architecture

```text
Desktop UI / Mobile UI
        |
        v
Source Picker
        |
        v
Storage Account + OAuth
        |
        v
Cloud Source Adapter
        |
        v
Local Source Proxy or Cloud Worker Source Proxy
        |
        v
FFmpeg copy/remux command
        |
        v
YouTube RTMPS
```

The source adapter owns storage-specific auth and download behavior. FFmpeg should not know about Google Drive OAuth tokens, refresh tokens, provider APIs, or provider-specific URLs.

## Where The Option Will Reside

The online-storage option should live beside the current local video selection flow, because it is a source choice, not a separate streaming mode.

### Desktop UI Placement

Primary placement:

```text
Dashboard / Channel Workspace
  -> Select Channel
  -> Video Encoder / Videos
  -> Add Videos
      -> From Computer
      -> From Google Drive
      -> From Online URL
```

Secondary placement:

```text
Settings
  -> Storage
      -> Connect Google Drive
      -> Connected Accounts
      -> Cache Settings
      -> Source Health
```

Channel-level display:

```text
Channel Workspace
  -> Current Playlist
      -> Local videos
      -> Cloud videos
      -> Compatibility status
      -> Source speed/readiness
```

Start button behavior:

- If every selected source is copy-compatible, `Start` works normally.
- If a cloud source is still being checked, `Start` is disabled with `Checking source`.
- If a cloud source is incompatible, `Start` is blocked with `Normalize this video first`.
- If Google Drive is disconnected, `Start` is blocked with `Reconnect Google Drive`.

This keeps the user mental model simple:

```text
Choose videos -> Confirm ready -> Start stream
```

The user should not need to think about proxy URLs, OAuth headers, or FFmpeg input details.

### Mobile UI Placement

Primary placement:

```text
Video Library
  -> Source tabs
      -> Device
      -> Google Drive
      -> Online URL
```

Stream setup placement:

```text
Home / Channel
  -> Selected Video
      -> Source: Device or Google Drive
      -> Copy-mode readiness
      -> Start
```

Settings placement:

```text
Settings
  -> Storage Accounts
      -> Connect Google Drive
      -> Disconnect
      -> Cache usage
```

The mobile app should show Google Drive as another source in the video library, not as a different YouTube mode. YouTube setup remains in the existing YouTube screen.

## Provider Abstraction

Add a shared source-provider model:

```text
StorageProvider
  id
  type: googleDrive | dropbox | oneDrive | s3 | directHttp
  displayName
  authMode: oauth | accessKey | publicUrl
  status

CloudVideoAsset
  id
  providerId
  providerFileId
  displayName
  sourceUri
  sizeBytes
  mimeType
  checksum/etag
  durationMs
  compatibilityStatus
  compatibilityMessage
  localPath: null
```

Provider interface:

```text
listFiles(folderId, filters)
getMetadata(fileId)
openReadStream(fileId, rangeStart, rangeEnd)
refreshAuth()
revokeAuth()
```

Google Drive adapter behavior:

- Use Google OAuth.
- Use Drive API metadata for file ID, name, size, MIME type, and download capability.
- Download media through the Drive API, not the public preview URL.
- Support byte ranges.
- Refresh access tokens before expiry.
- Reject native Google Docs/Sheets/Slides assets.
- Reject files where `canDownload` is false.

Direct HTTP adapter behavior:

- Accept HTTPS URLs only by default.
- Require stable `Content-Length`.
- Prefer servers that support `Accept-Ranges`.
- Block signed URLs that expire before the planned stream duration.

S3-compatible adapter behavior:

- Prefer presigned GET URLs generated by the app/backend.
- Validate expiry time.
- Use range reads.

## Desktop Architecture

```text
Electron Shell
  desktop/main.js
        |
        v
Python Backend
  scripts/web_ui.py
  scripts/stream_manager.py
        |
        +--> Storage Account Service
        +--> Google Drive Source Adapter
        +--> Cloud Compatibility Probe
        +--> Local Source Proxy
        +--> FFmpeg Process Manager
        +--> YouTube Service
```

### Desktop Source Flow

```text
1. User connects Google Drive in Castarro Desktop.
2. User chooses "Cloud Video" in the channel video picker.
3. Backend lists Drive videos through the provider adapter.
4. User selects one or more files for a channel.
5. Backend stores cloud asset references in config/db.
6. Backend probes each file through the source proxy.
7. If all files are copy-compatible, channel is marked ready.
8. On Start, backend starts the local source proxy.
9. Backend writes a concat playlist using local proxy URLs.
10. FFmpeg reads proxy URLs and sends `-c copy` to YouTube RTMPS.
```

### Local Source Proxy

Desktop should add a small local HTTP server owned by the Python backend:

```text
http://127.0.0.1:{source_port}/assets/{asset_id}
```

Responsibilities:

- Translate local proxy requests into provider API range requests.
- Add OAuth headers server-side.
- Hide provider tokens from FFmpeg commands and logs.
- Serve `Content-Length`, `Content-Range`, `Accept-Ranges`, and stable response codes.
- Retry provider reads with backoff.
- Keep a short rolling buffer on disk under `.runtime/cloud-cache/`.
- Refuse files whose metadata changes after validation.

The proxy is an input transport. It must never decode, encode, resize, watermark, or rewrite media packets.

### Desktop FFmpeg Command Shape

For a single cloud video:

```text
ffmpeg -hide_banner -nostdin -re \
  -i http://127.0.0.1:PORT/assets/ASSET_ID \
  -map 0:v:0 -map 0:a:0? \
  -c copy \
  -flvflags no_duration_filesize \
  -f flv \
  rtmps://YOUTUBE_INGEST/SIGNAL_KEY
```

For a playlist:

```text
ffmpeg -hide_banner -nostdin -re -stream_loop -1 \
  -protocol_whitelist file,http,https,tcp,tls,crypto \
  -f concat -safe 0 \
  -i .runtime/channel_1.cloud.ffconcat.txt \
  -map 0:v:0 -map 0:a:0? \
  -c copy \
  -flvflags no_duration_filesize \
  -f flv \
  rtmps://YOUTUBE_INGEST/SIGNAL_KEY
```

Generated concat example:

```text
ffconcat version 1.0
file 'http://127.0.0.1:PORT/assets/asset_1'
file 'http://127.0.0.1:PORT/assets/asset_2'
```

If FFmpeg cannot reliably seek a provider-backed MP4 through the proxy, the app should use spool-before-start mode:

```text
cloud file -> .runtime/cloud-cache/{asset_id}.mp4 -> ffmpeg -c copy
```

This is still copy-mode streaming. It uses temporary local caching only to stabilize input reads, not to transcode.

## Desktop Files To Add Or Change

Recommended additions:

```text
scripts/storage_providers.py
scripts/google_drive_provider.py
scripts/cloud_source_proxy.py
scripts/cloud_probe.py
shared/castarro-core/schemas/storage-provider.schema.json
shared/castarro-core/schemas/cloud-video-asset.schema.json
```

Recommended changes:

```text
scripts/stream_manager.py
  Add cloud asset playlist support.
  Add protocol whitelist only when playlist inputs are proxy URLs.
  Keep `-c copy` as the only live output mode for cloud sources.

scripts/web_ui.py
  Add storage account endpoints.
  Add cloud file picker/list endpoints.
  Add cloud compatibility/probe endpoint.
  Start/stop source proxy with stream sessions.

scripts/app_db.py
  Store storage accounts, cloud assets, and cloud playlist entries.

web/app.js
  Add "Cloud Videos" picker under Video Encoder/YouTube channel workspace.
  Show provider connection state.
  Show copy-mode compatibility before Start.

config.example.json
  Add `storage.providers`.
  Add optional channel `cloud_playlist`.
```

Suggested config shape:

```json
{
  "storage": {
    "providers": [
      {
        "id": "google-drive-main",
        "type": "googleDrive",
        "display_name": "Google Drive",
        "tokens_file": ".runtime/google_drive_tokens.json"
      }
    ],
    "source_proxy": {
      "host": "127.0.0.1",
      "port": 8876,
      "cache_dir": ".runtime/cloud-cache",
      "startup_buffer_mb": 64,
      "max_cache_mb": 2048,
      "spool_before_start": false
    }
  },
  "channels": [
    {
      "name": "channel_1",
      "cloud_playlist": [
        {
          "provider_id": "google-drive-main",
          "file_id": "drive-file-id",
          "display_name": "ready-video.mp4"
        }
      ],
      "live_profile": {
        "mode": "copy"
      }
    }
  ]
}
```

## Android Mobile Architecture

The current Android app is local-file copy-mode. Online storage should be added as a source option without changing the FFmpeg output contract.

```text
Compose UI
        |
        v
CastarroMobileViewModel
        |
        v
Video Source Repository
        |
        +--> Local VideoImportRepository
        +--> GoogleDriveVideoRepository
        |
        v
Android Local Source Proxy
        |
        v
StreamCommandBuilder
        |
        v
FFmpegKit StreamProcessRunner
        |
        v
YouTube RTMPS
```

### Android Source Flow

```text
1. User connects Google Drive.
2. User selects a Drive video.
3. App stores provider ID, file ID, display name, size, and compatibility metadata.
4. App probes the video using MediaExtractor only after opening a proxy/cache source.
5. If compatible, app marks it Ready.
6. On Start, Android starts a foreground service.
7. Foreground service starts local source proxy.
8. FFmpegKit reads `http://127.0.0.1:PORT/assets/ASSET_ID`.
9. FFmpegKit pushes `-c copy` to YouTube RTMPS.
```

### Android Local Proxy

Add a lightweight localhost server in the Android foreground service.

Responsibilities:

- Serve provider-backed files to FFmpegKit as local HTTP URLs.
- Own OAuth headers and token refresh.
- Support range reads.
- Maintain a bounded app-cache buffer.
- Stop when the stream session stops.
- Never log bearer tokens or stream keys.

If Android background/network reliability is not good enough for long sessions, add an explicit cloud-worker mode:

```text
Mobile app -> Castarro Cloud Worker -> FFmpeg -c copy -> YouTube RTMPS
```

In that mode the mobile app is a controller. The worker still uses copy/remux only.

## Android Files To Add Or Change

Recommended additions:

```text
mobile/android/CastarroMobile/app/src/main/java/com/castarro/mobile/data/storage/StorageProviderRepository.kt
mobile/android/CastarroMobile/app/src/main/java/com/castarro/mobile/data/storage/GoogleDriveVideoRepository.kt
mobile/android/CastarroMobile/app/src/main/java/com/castarro/mobile/streaming/LocalSourceProxy.kt
mobile/android/CastarroMobile/app/src/main/java/com/castarro/mobile/domain/model/CloudVideoAsset.kt
```

Recommended changes:

```text
VideoImportRepository.kt
  Keep local import behavior.
  Share compatibility language with cloud assets.

StreamCommandBuilder.kt
  Accept source URLs as well as local paths.
  Preserve `-c copy`.
  Add protocol whitelist only when FFmpegKit needs it for localhost HTTP input.

StreamForegroundService.kt
  Start and stop LocalSourceProxy with each stream session.

CastarroDatabase.kt
  Add storage provider and cloud asset tables.

VideoLibraryScreen.kt
  Add Local / Cloud source tabs.

YoutubeScreen.kt and HomeScreen.kt
  Show cloud asset readiness in the same place local readiness is shown.
```

## Shared Core Updates

Update shared contracts first so desktop and mobile stay aligned.

Add:

```text
storage-provider.schema.json
cloud-video-asset.schema.json
fixtures/cloud-video-assets/ready-google-drive-h264-aac.json
fixtures/cloud-video-assets/blocked-google-drive-hevc.json
fixtures/cloud-video-assets/blocked-google-drive-no-range.json
```

Extend `video-asset.schema.json` carefully:

```json
{
  "sourceType": "local | cloud",
  "providerId": "google-drive-main",
  "providerFileId": "drive-file-id",
  "localPath": null,
  "sourceUri": "castarro://cloud/google-drive-main/drive-file-id"
}
```

Readiness states should remain:

```text
ready
needsDesktopPrep
blocked
unknown
```

Cloud-specific blocked messages:

```text
This provider file cannot be downloaded.
This provider does not support reliable range reads for this file.
This video is not H.264/AAC and cannot be streamed in copy mode.
This playlist mixes incompatible stream formats.
This cloud link expires before the planned stream can finish.
```

## Compatibility Probe Strategy

Desktop:

- Use `ffprobe` against the local source proxy URL.
- Prefer range reads so large files are not fully downloaded.
- Compare every playlist item signature.
- Cache the probe result by provider ID, file ID, size, and etag/checksum.

Android:

- Use Android metadata APIs when the provider source can be opened safely.
- Use FFmpegKit/ffprobe if available in the packaged runtime.
- Otherwise mark uncertain files as `unknown` and require desktop validation.

Required probe output:

```text
container
videoCodec
audioCodec
width
height
fps
pixelFormat if available
audioSampleRate
audioChannels
durationMs
sizeBytes
rangeReadable
copyModeStatus
copyModeMessage
```

## Error Handling

Source errors:

- OAuth expired: reconnect provider.
- File removed: remove or replace playlist item.
- Permission revoked: reconnect or pick another file.
- Range unsupported: enable spool-before-start or block.
- Download too slow: warn before starting and stop before YouTube receives an unstable feed.

FFmpeg errors:

- `Invalid data found when processing input`: source proxy or container issue.
- `codec not currently supported in flv`: not copy-mode compatible.
- `401 Unauthorized`: YouTube stream key or account issue.
- `Connection reset`: provider, network, or YouTube transport interruption.

The app should not respond to cloud-source failures by transcoding. It should either retry reading, switch to spool-before-start, or block the session.

## Security

- Store provider refresh tokens using the same secret handling pattern as YouTube tokens.
- Keep provider access tokens out of FFmpeg command lines.
- Keep YouTube stream keys masked in logs.
- Bind local source proxy to `127.0.0.1` only.
- Use unguessable per-session source URLs.
- Expire source URLs when the stream stops.
- Do not expose provider file IDs in public logs unless necessary.

## Recommended Implementation Phases

### Phase 1: Desktop Google Drive MVP

- Add Google Drive OAuth settings.
- Add provider connection endpoints.
- Add Drive file picker/list endpoint.
- Add cloud asset records.
- Add local source proxy with range support.
- Add ffprobe compatibility check through proxy.
- Add cloud playlist support in `stream_manager.py`.
- Start FFmpeg with `-c copy` from proxy URLs.

### Phase 2: Desktop Reliability

- Add rolling cache.
- Add spool-before-start option.
- Add provider speed test before going live.
- Add source health panel and clearer failure messages.
- Add contract tests for cloud source config.

### Phase 3: Android Google Drive

- Add Google Drive sign-in/provider repository.
- Add cloud source tab in the video library.
- Add Android local source proxy.
- Update `StreamCommandBuilder.kt` to accept source URLs.
- Add foreground-service lifecycle for the proxy.
- Add mobile copy-mode compatibility tests.

### Phase 4: Optional Cloud Worker

- Add backend worker for mobile-controlled streams.
- Worker pulls from Drive/S3 and pushes to YouTube with `-c copy`.
- Mobile app starts/stops jobs and watches logs.
- Use this for iOS or unreliable Android long-run environments.

## Implementation TODO List

### 1. Shared Contracts

- [x] Add `storage-provider.schema.json`.
- [x] Add `cloud-video-asset.schema.json`.
- [x] Extend `video-asset.schema.json` with `sourceType`, `providerId`, and `providerFileId`.
- [x] Add ready fixture: Google Drive H.264/AAC MP4.
- [x] Add blocked fixture: Google Drive HEVC video.
- [x] Add blocked fixture: provider file without reliable range support.
- [x] Update desktop/mobile contract tests to read the new fixtures.

### 2. Desktop Storage Settings

- [x] Add `storage.providers` to `config.example.json`.
- [x] Add `storage.source_proxy` settings to `config.example.json`.
- [ ] Add Storage settings section in the desktop UI.
- [ ] Add `Connect Google Drive` action.
- [ ] Add connected account status.
- [ ] Add disconnect/revoke action.
- [x] Store Google Drive tokens under `.runtime/`.

Desktop UI location:

```text
Settings -> Storage
```

### 3. Desktop Cloud Video Picker

- [ ] Add `From Google Drive` option under Add Videos.
- [ ] Add Drive folder/file browser endpoint in `scripts/web_ui.py`.
- [ ] Show video name, size, duration, and MIME type.
- [ ] Add selected Drive files into the current channel playlist.
- [ ] Save cloud playlist entries in config/db.
- [ ] Show source badge: `Google Drive`.

Desktop UI location:

```text
Channel Workspace -> Video Encoder / Videos -> Add Videos -> From Google Drive
```

### 4. Desktop Provider Backend

- [x] Create `scripts/storage_providers.py`.
- [x] Create `scripts/google_drive_provider.py`.
- [ ] Implement OAuth refresh.
- [ ] Implement file metadata fetch.
- [ ] Implement range download.
- [x] Reject non-downloadable Drive files.
- [x] Reject native Google Docs/Sheets/Slides assets.
- [ ] Mask tokens in logs.

### 5. Desktop Source Proxy

- [x] Create `scripts/cloud_source_proxy.py`.
- [x] Bind proxy to `127.0.0.1`.
- [x] Serve `GET /assets/{asset_id}`.
- [x] Support `Range` requests.
- [x] Return correct `Content-Length`, `Content-Range`, and `Accept-Ranges` headers.
- [x] Add retry/backoff for provider reads.
- [ ] Add bounded cache under `.runtime/cloud-cache/`.
- [x] Expire session URLs when stream stops.

### 6. Desktop Compatibility Probe

- [x] Create `scripts/cloud_probe.py`.
- [x] Run `ffprobe` against local proxy URLs.
- [x] Extract codec/container/fps/audio metadata.
- [x] Compare all playlist items for copy-mode compatibility.
- [x] Cache results by provider ID, file ID, size, and etag/checksum.
- [ ] Block incompatible videos before Start.
- [ ] Show `Ready`, `Needs desktop prep`, `Blocked`, or `Unknown`.

Desktop UI location:

```text
Channel Workspace -> Current Playlist -> Compatibility
```

### 7. Desktop Stream Manager

- [x] Add `cloud_playlist` support in `scripts/stream_manager.py`.
- [x] Generate concat playlists with local proxy URLs.
- [x] Add protocol whitelist only for proxy URL playlists.
- [x] Keep output as `-c copy`.
- [x] Do not enable the existing transcode branch for cloud sources.
- [ ] Add spool-before-start fallback for unstable MP4 seek/range behavior.
- [ ] Add source-health logging.

### 8. Desktop UI Readiness

- [ ] Disable `Start` while cloud sources are checking.
- [ ] Disable `Start` when Google Drive auth is expired.
- [ ] Disable `Start` when a file is not copy-compatible.
- [ ] Add source speed/readiness indicator.
- [ ] Add clear action: `Normalize this video first`.
- [ ] Add clear action: `Reconnect Google Drive`.

Desktop UI location:

```text
Dashboard / Channel Workspace -> Start controls
```

### 9. Android Storage Accounts

- [ ] Add Google Drive sign-in flow.
- [ ] Add storage provider repository.
- [ ] Store provider account state securely.
- [ ] Add connected account display.
- [ ] Add disconnect action.

Mobile UI location:

```text
Settings -> Storage Accounts
```

### 10. Android Cloud Video Library

- [ ] Add `Google Drive` tab in `VideoLibraryScreen.kt`.
- [ ] List Drive videos.
- [ ] Add cloud video selection.
- [ ] Save cloud asset metadata in Room.
- [ ] Show source badge: `Google Drive`.
- [ ] Reuse existing compatibility language.

Mobile UI location:

```text
Video Library -> Google Drive
```

### 11. Android Local Source Proxy

- [ ] Add `LocalSourceProxy.kt`.
- [ ] Start proxy from `StreamForegroundService.kt`.
- [ ] Serve Google Drive assets to FFmpegKit through localhost.
- [ ] Support range reads.
- [ ] Add bounded app-cache buffering.
- [ ] Stop proxy when stream stops.
- [ ] Prevent provider tokens from appearing in FFmpeg logs.

### 12. Android Stream Command

- [ ] Update `StreamCommandBuilder.kt` to accept local paths and localhost source URLs.
- [ ] Preserve `-re`.
- [ ] Preserve `-c copy`.
- [ ] Preserve RTMPS output.
- [ ] Add protocol whitelist only if FFmpegKit needs it for localhost HTTP input.
- [ ] Add tests for local file input and cloud URL input.

### 13. Reliability And Fallbacks

- [ ] Add provider speed test before live start.
- [ ] Warn when cloud download speed is below stream bitrate plus safety margin.
- [ ] Add spool-before-start option on desktop.
- [ ] Add mobile warning for long streams from Drive on battery/mobile data.
- [ ] Add optional cloud-worker mode for mobile-controlled streaming.
- [ ] Keep cloud-worker mode copy/remux-only.

### 14. Acceptance Tests

- [ ] Desktop: connect Google Drive.
- [ ] Desktop: select compatible Drive MP4.
- [ ] Desktop: probe marks file `Ready`.
- [ ] Desktop: print FFmpeg command shows localhost proxy input and `-c copy`.
- [ ] Desktop: start stream to manual RTMPS test key.
- [ ] Desktop: incompatible Drive file blocks Start.
- [ ] Android: Google Drive tab appears in Video Library.
- [ ] Android: selected cloud file appears on Home.
- [ ] Android: command builder keeps `-c copy`.
- [ ] Android: foreground service starts/stops source proxy with stream session.

### 15. Documentation

- [ ] Update `README.md` with online-storage source behavior.
- [ ] Document that Drive URLs are not pasted directly into FFmpeg.
- [ ] Document copy-mode requirements.
- [ ] Document that incompatible cloud videos require desktop normalization first.
- [ ] Add troubleshooting entries for Drive auth, missing range support, and slow downloads.

## Final Decision

Yes, Castarro can stream from Google Drive or other online storage to YouTube RTMPS while keeping copy-mode only.

The correct implementation is not:

```text
Paste Drive URL directly into FFmpeg.
```

The correct implementation is:

```text
Provider API + OAuth -> Castarro source proxy/cache -> FFmpeg -re -c copy -> YouTube RTMPS
```

This preserves the current app identity: Castarro is still a lightweight prerecorded live streamer, not a transcoding studio.
