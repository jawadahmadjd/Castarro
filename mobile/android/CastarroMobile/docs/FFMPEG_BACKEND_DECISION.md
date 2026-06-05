# Android Streaming Backend Decision

Decision: Castarro Mobile MVP uses a bundled Android FFmpeg executable or native wrapper built with LGPL-compatible options.

The app-side streaming contract is the desktop-compatible copy/remux command:

```text
ffmpeg -hide_banner -nostdin -re -i VIDEO_PATH -c copy -f flv rtmps://SERVER/STREAM_KEY
```

Release builds must document the exact FFmpeg source, configure flags, binary provenance, and license notices before Play Store distribution. GPL-only codecs or GPL build flags are not part of the MVP packaging plan.

The Kotlin app owns foreground-service lifecycle, command construction, log parsing, reconnect policy, session history, and encrypted stream-key references. The selected FFmpeg distribution owns demuxing, real-time pacing, FLV muxing, and RTMP/RTMPS transport.
