# Android Streaming Backend Decision

Decision: Castarro Mobile MVP uses a bundled Android FFmpeg native wrapper built with LGPL-compatible options.

Implementation: the Android app packages `com.moizhassan.ffmpeg:ffmpeg-kit-16kb:6.1.1` from Maven Central and executes the copy/remux command through FFmpegKit's native Android runtime instead of launching a device `ffmpeg` shell executable. This removes the missing-binary/runtime-PATH failure mode on phones.

The app-side streaming contract is the desktop-compatible copy/remux command:

```text
ffmpeg -hide_banner -nostdin -re -i VIDEO_PATH -c copy -f flv rtmps://SERVER/STREAM_KEY
```

Release builds must keep the exact FFmpeg source, configure flags, binary provenance, and license notices in this file before Play Store distribution. The current Android package declares LGPL-3.0 licensing and points to `https://github.com/moizhassankh/ffmpeg-kit-android-16KB` as its source/provenance. GPL-only codecs or GPL build flags are not part of the MVP packaging plan.

The Kotlin app owns foreground-service lifecycle, command construction, log parsing, reconnect policy, session history, and encrypted stream-key references. FFmpegKit owns demuxing, real-time pacing, FLV muxing, and RTMP/RTMPS transport. The app records a failed stream session if the native runtime cannot start, rather than crashing the service.
