# APK Smoke-Test Checklist

Use this checklist for every debug or release-candidate APK.

- Install APK on a physical Android device.
- Confirm the app requests no camera or microphone permission.
- Grant notification permission when prompted.
- Select a compatible H.264/AAC MP4 through the system file picker.
- Confirm the selected file is copied into app-private storage and marked `Ready`.
- Select an HEVC, AV1, VP9, Opus, or unsupported-container sample and confirm it is blocked with `Needs desktop prep`.
- Save a manual RTMPS destination and confirm the stream key is not stored in plain Room rows.
- Start a stream to a private/unlisted YouTube Live test event.
- Confirm the foreground notification shows channel, video, status, elapsed time, and Stop action.
- Stop from the app.
- Stop from the notification.
- Lock the screen during a stream and confirm the service keeps running.
- Switch between Wi-Fi and mobile data and confirm reconnect status is visible.
- Enter a wrong stream key and confirm the error message is user-friendly.
- Confirm a session-history row is written for success, stop, and failure.
