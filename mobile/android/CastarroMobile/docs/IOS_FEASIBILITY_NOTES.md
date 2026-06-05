# iOS Feasibility Notes

iOS remains a post-Android-MVP investigation.

Open questions:

- Whether an LGPL-compatible FFmpeg packaging strategy is acceptable for App Store distribution.
- Whether background upload/streaming limits can support long-running RTMP/RTMPS file streaming.
- Whether the app needs ReplayKit, AVFoundation, or a commercial SDK despite not being a camera broadcaster.
- How stream keys and OAuth refresh tokens should map to Keychain.
- Whether iOS can preserve the same copy-mode promise without silent transcoding.

Do not start iOS implementation until the Android MVP proves copy-mode streaming reliability on real devices.
