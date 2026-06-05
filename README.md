# Castarro

Castarro streams pre-encoded H.264/AAC videos to YouTube Live without using OBS encoding.

The key command is:

```powershell
ffmpeg -re -i video.mp4 -c copy -f flv rtmp://a.rtmp.youtube.com/live2/YOUR_STREAM_KEY
```

`-c copy` means FFmpeg does not decode and re-encode the video. It only reads the already-compressed packets, paces them in real time with `-re`, and packages them for RTMP.

## Why OBS Re-Encodes

OBS is a live compositor. Even if the source is an H.264 MP4, OBS usually decodes it into frames, mixes it into a scene, then encodes the final scene again for streaming.

For prerecorded videos, that is unnecessary overhead unless you need live cameras, overlays, scene switching, browser sources, or other live production features.

## What This System Does

- Runs one FFmpeg process per channel.
- Uses `-c copy` for near-zero GPU encoding load.
- Supports playlists per channel.
- Loops channels forever by default.
- Restarts streams if FFmpeg exits.
- Writes logs into `logs/`.
- Keeps stream keys out of the config by using environment variables.

## Folder Layout

```text
Raw Videos/            Put source videos here before normalization
Go Live/               Normalized stream-ready MP4 files are written here
logs/                  FFmpeg logs are written here
playlists/             Optional manual concat playlists
scripts/               Python manager and validator
config.example.json    Template config
run.ps1                Windows helper
```

## Web UI

Start the local dashboard:

```powershell
.\run.ps1 ui
```

Then open:

```text
http://127.0.0.1:8765
```

The UI lets you:

- Create `config.json` from the example
- Edit settings through normal UI fields
- Use Advanced JSON only when you want exact manual control
- Select multiple source videos from `Raw Videos/channel_name/`
- Normalize all channels or one channel
- Validate all channels or one channel
- Start and stop all streams or one stream
- Check whether each channel is marked YouTube Auto Start/Stop ready
- Watch task output and stream log tails

The UI has two tabs:

- `Control`: start/stop streams, normalize, validate, and watch activity.
- `Settings`: config file selection plus `Folders`, `Video Encoder`, `YouTube`, and `Troubleshooting` menus.

Inside `Settings`:

- `Folders`: choose exact paths for Raw Videos, Go Live videos, and Logs.
- `Video Encoder`: per-channel Add Videos, selected source files, and encoding profile.
- `YouTube`: live playlist settings, stream keys, account mapping, connect/schedule controls, and Add Channel. OAuth technical fields are hidden from normal users.

Desktop runtime behavior:

- `Close UI Only` keeps backend + active streams running in the background.
- `Stop Streams and Exit` stops streams, shuts down backend, and exits.

It is intentionally lightweight: plain HTML, CSS, JavaScript, and Python standard library only.

## Setup

Copy the example config:

```powershell
Copy-Item config.example.json config.json
```

Put your source videos under `Raw Videos/`, for example:

```text
Raw Videos/channel_1/video-001.mp4
Raw Videos/channel_1/video-002.mp4
Raw Videos/channel_2/video-001.mp4
```

In the UI, open `Settings -> Video Encoder`, open a channel, then click `Add Videos`.

The app copies selected files into:

```text
Raw Videos/channel_name/
```

After upload, their paths are automatically added to that channel's normalization list. You can also click `Refresh Raw Videos` if you copied files into the folder manually.

## YouTube Auto Start/Stop Mode

Castarro uses YouTube's built-in Auto Start and Auto Stop behavior.

You can use this in two ways:

1. Manual: configure stream keys yourself and enable Auto Start/Stop in YouTube Studio.
2. API-driven: connect your Google account in `Settings -> YouTube`, schedule a broadcast, and let Castarro create/bind the YouTube stream and fill the stream key into the selected channel.

For every YouTube broadcast/channel:

1. Open YouTube Studio.
2. Create or edit the live broadcast.
3. Open the stream settings.
4. Turn `Auto-start` on.
5. Turn `Auto-stop` on.
6. Use the correct stream key in this app.
7. In the dashboard, click `Mark Auto ON` for that channel.

### API Connection Quick Setup

1. Open Google Cloud Console and create OAuth credentials (`Desktop app`) for Castarro.
2. Open Castarro in owner mode (`http://127.0.0.1:8765/?owner=1`), then in `Settings -> YouTube` set OAuth Client Type as `Desktop app` and set redirect URI:

```text
http://127.0.0.1:8765/oauth2redirect
```

3. Enable `YouTube Data API v3` in that Google project.
4. Paste OAuth Client ID (and Client Secret if provided) in Castarro.
5. Keep `Use PKCE` enabled.
6. Click `Save settings`.
7. Click `Connect to YouTube` and approve access.
8. Use `Schedule Stream` to create a broadcast and assign its stream key to your selected Castarro channel.

Important:

- `127.0.0.1` is each user's own local machine, so your app does not depend on your PC being online for other users.
- OAuth callback happens only while that user's Castarro app is running locally.
- In normal mode (without `?owner=1`), users only see `Connect to YouTube` and scheduling controls.

After that, the operating flow is:

```text
Dashboard Start
        -> FFmpeg begins sending video
        -> YouTube detects the signal
        -> YouTube starts the live broadcast automatically

Dashboard Stop
        -> FFmpeg stops sending video
        -> YouTube detects signal loss
        -> YouTube ends the broadcast automatically after a short delay
```

If YouTube keeps showing a blank live feed after you stop FFmpeg, check that `Auto-stop` is enabled for that broadcast in YouTube Studio.

## Normalize Once, Stream Many Times

Yes: the best workflow is to filter and encode every video once in the backend, then stream only the normalized files.

That gives you this pipeline:

```text
Premiere/exported source files
        -> one-time FFmpeg normalize/transcode
        -> Go Live/channel_name/*.mp4
        -> live FFmpeg streaming with -c copy
        -> YouTube Live
```

Normalize all enabled channels:

```powershell
.\run.ps1 normalize
```

Normalize one channel:

```powershell
.\run.ps1 normalize -Channel channel_1
```

Force re-encoding if outputs already exist:

```powershell
.\run.ps1 normalize -Channel channel_1 -Force
```

Preview the FFmpeg commands without encoding:

```powershell
.\run.ps1 normalize -DryRun
```

The normalizer writes:

- Normalized MP4 files under `Go Live/channel_name/`
- Normalized concat playlists under `playlists/`
- A ready-to-stream config named `config.ready.json`

After normalization, validate the ready config:

```powershell
.\run.ps1 validate -Config config.ready.json
```

Then stream from normalized files:

```powershell
.\run.ps1 start -Config config.ready.json
```

If a channel has no manual live playlist, the streamer automatically looks inside:

```text
Go Live/channel_name/
```

The default normalization profile creates consistent H.264/AAC files:

- 1920x1080
- 30 FPS
- H.264 high profile
- 6000k video bitrate
- AAC stereo audio
- 48000 Hz audio
- 2-second keyframe interval
- `yuv420p` pixel format

Set YouTube stream keys as environment variables:

```powershell
$env:YT_CHANNEL_1_KEY = "xxxx-xxxx-xxxx-xxxx"
$env:YT_CHANNEL_2_KEY = "yyyy-yyyy-yyyy-yyyy"
```

For permanent Windows user environment variables:

```powershell
[Environment]::SetEnvironmentVariable("YT_CHANNEL_1_KEY", "xxxx-xxxx-xxxx-xxxx", "User")
```

Open a new PowerShell window after setting permanent variables.

## Validate Videos

Before going live:

```powershell
.\run.ps1 validate
```

For one channel:

```powershell
.\run.ps1 validate -Channel channel_1
```

For copy-mode playlists, every file in the same channel should have matching:

- Video codec: H.264
- Audio codec: AAC
- Resolution
- Frame rate
- Pixel format
- Audio sample rate and channel count

If files do not match, FFmpeg may stop, glitch, or YouTube may reject the stream.

## Start Streaming

Start all enabled channels:

```powershell
.\run.ps1 start
```

Start one channel:

```powershell
.\run.ps1 start -Channel channel_1
```

Stop with `Ctrl+C`.

## Print The FFmpeg Command

To inspect what will run:

```powershell
.\run.ps1 print-command -Channel channel_1
```

The stream key is masked by default.

## Recommended Premiere Export Settings

Use one export preset consistently for every video in the same channel:

- Format: H.264 MP4
- Video codec: H.264
- Audio codec: AAC
- Resolution: match your stream, such as 1920x1080
- FPS: constant and consistent, such as 30 or 60
- Keyframe distance: 2 seconds
- Pixel format: yuv420p
- Bitrate: within YouTube Live limits for your resolution

The cleaner and more consistent the exports are, the more reliable `-c copy` streaming becomes.

## Important Limits

This is excellent for prerecorded streams. It is not a replacement for OBS if you need live graphics, live camera switching, dynamic overlays, or real-time scene composition.

If you need overlays without OBS, the stream must usually be re-encoded because the pixels are being changed. There is no free lunch there, sadly; the sandwich demands payment.

## Electron Desktop Packaging

Castarro includes a Windows-first Electron shell in `desktop/`.

Development launch:

```powershell
npm install
npm run electron
```

Release build:

```powershell
npm run dist
```

Before creating the installer, place these runtime files in the resource slots:

```text
desktop/resources/python/python.exe
desktop/resources/python/Lib/...
desktop/resources/ffmpeg/ffmpeg.exe
desktop/resources/ffmpeg/ffprobe.exe
```

You can create those resource files automatically:

```powershell
npm run bundle:runtime
```

The packaged app keeps mutable data outside the install folder under Electron user data:

```text
data/config.json
data/config.ready.json
data/stream_control.db
data/logs/
data/.runtime/
data/Raw Videos/
data/Go Live/
data/playlists/
```

The Electron menu includes `Open Data Folder` and `Open Logs Folder` for backup and troubleshooting. Uninstall is configured to keep app data by default.

Release verification:

```powershell
npm run release:check
```

This builds the Windows installer, smoke-tests the packaged app, then silently installs the generated setup file into a temporary local folder to verify the installed EXE, Start Menu shortcut, Desktop shortcut, and first launch before publishing.

## Windows Code Signing (Anti-Virus Trust)

Unsigned installers are much more likely to be flagged by SmartScreen and antivirus engines.

Local signed build:

```powershell
npm run dist:signed
```

This command fails if signing credentials are missing. If you prefer unsigned releases, use:

```powershell
npm run dist
```

Required environment variables (either pair works):

```text
WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD
or
CSC_LINK + CSC_KEY_PASSWORD
```

GitHub Actions now signs automatically only when those secrets are present. If secrets are missing, the workflow still publishes an unsigned installer and prints a warning.

## Automatic Updates

Castarro checks GitHub Releases for updates when the packaged app starts and then periodically while it is open. Updates are downloaded in the background and installed when the app quits, so users do not need to download a new installer manually.

GitHub Actions publishes Windows + Android releases from `main`. To ship an update:

```powershell
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release 1.0.1"
git push
```

Use `minor` or `major` instead of `patch` when appropriate. The workflow creates a `vX.Y.Z` tag, builds the Windows installer, builds a signed Android release APK, uploads `latest.yml`, and publishes both installers as GitHub Release assets. If the version already has a release, the workflow skips publishing; bump the version before pushing another update.

Android release APK shipment requires these repository secrets:

```text
CASTARRO_ANDROID_KEYSTORE_BASE64
CASTARRO_ANDROID_KEYSTORE_PASSWORD
CASTARRO_ANDROID_KEY_ALIAS
CASTARRO_ANDROID_KEY_PASSWORD
```

Create the release keystore once and keep it private:

```powershell
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -v -keystore castarro-release.jks -alias castarro -keyalg RSA -keysize 2048 -validity 10000
```

Create `CASTARRO_ANDROID_KEYSTORE_BASE64` from the release keystore file:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("castarro-release.jks"))
```

The release workflow fails before tagging if Android signing secrets are missing. This is intentional: release APKs must be signed with the same private key every time so users can install updates over existing Android installs. APK files are published as GitHub Release assets, not committed to git.

Create a release manifest after a build:

```powershell
npm run release
```

To bump the app version and rebuild:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Version 1.0.1
```

If signing variables are missing, the release workflow publishes an unsigned installer (and users may still see browser/SmartScreen warnings).
