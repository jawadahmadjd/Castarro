# Castarro Mobile UI/UX Skin

## Design Goal

Create a mobile version of Castarro that feels like the same product as the current desktop app, but simpler and touch-first.

The desktop UI already has a strong direction:

- Dark brown navigation
- Warm paper surfaces
- Gold primary actions
- Green success/live actions
- Red stop/danger actions
- 8px operational radius
- Channel-first workflow
- Readiness checks before live streaming

The mobile app should keep that identity while reducing the screen to one clear decision:

```text
Is this channel ready to go live?
```

## Core UX Principles

- Keep the selected channel visible at all times.
- Never ask for camera or microphone permissions.
- Treat video compatibility as a first-class readiness item.
- Make `Go Live` impossible until the selected file and destination are ready.
- Keep stream keys hidden by default.
- Use plain user language: `Ready`, `Needs desktop prep`, `Disconnected`, `Live`, `Reconnecting`.
- Keep the main action reachable near the bottom of the screen.
- Use session history to build confidence after every stream.

## Mobile Navigation

Recommended bottom navigation:

```text
Home | Video | YouTube | History
```

Secondary settings can live behind a top-right menu.

Reason:

- The workflow is short.
- Users on mobile need fewer screens than desktop.
- The key route order matches the live setup sequence.

## Screen 1: Home

Purpose:

- Show whether the selected channel can go live now.

Main areas:

- Top app bar: Castarro, channel selector, live count
- Status band: Video, YouTube, Stream
- Selected video card
- Destination card
- Readiness checklist
- Sticky action bar: `Go Live` or `Stop`

Primary states:

- `Ready to go live`
- `Select a video`
- `Connect YouTube`
- `Needs desktop prep`
- `Live`
- `Reconnecting`

## Screen 2: Video

Purpose:

- Select a prerecorded phone video and validate it for copy-mode streaming.

Main areas:

- File picker action
- Selected video list
- Compatibility report
- Recommended fix for blocked files

Compatibility card examples:

```text
Ready
H.264 video, AAC audio, 1080p30
```

```text
Needs desktop prep
HEVC video cannot be sent with RTMP copy mode.
```

## Screen 3: YouTube

Purpose:

- Configure manual RTMPS stream key or connect YouTube account.

Main areas:

- Manual stream profile
- Hidden stream key field with reveal/copy controls
- YouTube account connection
- Broadcast/schedule section after OAuth
- Auto Start/Stop confirmation

MVP layout should show manual key mode first. Account mode can be a second section.

## Screen 4: Live Monitor

This can be part of Home while live.

Main areas:

- Live timer
- Upload speed
- File progress
- Destination
- Stream logs collapsed behind `Details`
- Stop action

Avoid a heavy log-first interface. Logs are for troubleshooting, not the normal live experience.

## Screen 5: History

Purpose:

- Show recent stream attempts by channel.

Main areas:

- Session rows
- Result status
- Duration
- Video name
- Destination
- Error summary when failed

## Visual Tokens

Use these as the Android Compose theme source.

```text
Background:       #F4F0E8
Surface:          #FFFAF0
Surface Soft:     #FBF2DF
Navigation Dark:  #2F2414
Navigation Soft:  #4B3821
Ink:              #2A241B
Muted:            #766B59
Line:             #E2D5BF
Gold:             #D99A32
Gold Soft:        #F4DFAD
Green:            #2F7A55
Teal Dark:        #1E3430
Danger:           #A9493D
Warning:          #C97926
Radius:           8dp
```

The mobile palette should not become beige-only. Use the dark navigation/header, green live states, gold actions, and red stop/error states to keep hierarchy strong.

## Typography

Recommended:

- App title: 22sp, bold
- Screen title: 24sp, bold
- Card title: 16sp, semibold
- Body: 14sp
- Metadata: 12sp, semibold
- Button text: 14sp, bold

No viewport-scaled type. No negative letter spacing.

## Component Set

### Top App Bar

Contents:

- Castarro
- Version or live count chip
- Channel selector
- Overflow/settings action

### Channel Selector

Touch-first selector:

- Avatar/initial
- Channel name
- Status text
- Opens bottom sheet with search and channel list

### Status Band

Three compact readiness cells:

- Video
- YouTube
- Stream

Use this instead of many small badges.

### Readiness Card

Rows:

- Video file
- Copy-mode compatibility
- YouTube destination
- Auto Start/Stop

Each row should have:

- Label
- Short value
- Tone badge
- Optional route tap

### Stream Action Bar

Sticky bottom action:

- `Go Live` when ready
- `Stop` when live
- Disabled `Go Live` with reason when blocked

### Video Asset Row

Contents:

- 16:9 thumbnail
- File name
- Duration
- Compatibility badge

### Secret Field

Contents:

- Masked value
- Reveal action
- Paste action
- Clear action

Never show a stream key in a history row or normal summary.

## Motion

Use subtle motion only:

- Screen transition: short fade/slide
- Live status pulse: very subtle
- Progress bar: linear progress

Respect reduced-motion settings.

## Accessibility

Requirements:

- All interactive targets at least 48dp tall.
- Color is never the only status signal.
- Stop action always has text.
- Stream key reveal is explicit.
- Live notification has a stop action.
- Bottom nav labels remain visible.

## Copy Guidelines

Preferred labels:

- `Go Live`
- `Stop`
- `Ready`
- `Needs desktop prep`
- `Connect YouTube`
- `Manual stream key`
- `Mobile data`
- `Reconnecting`
- `Session saved`

Avoid:

- `Transcode`
- `Camera`
- `Mic`
- `OBS`
- Long technical command text in the normal UI

## Static Mock

A static mobile skin mock has been added at:

```text
design-mocks/mobile-app-skin.html
```

It is intentionally plain HTML/CSS so it can be opened quickly and compared with the existing desktop screenshots.

