# Android Permissions

MVP permissions:

- `INTERNET`: upload the RTMP/RTMPS stream.
- `ACCESS_NETWORK_STATE`: detect connection loss and reconnect status.
- `FOREGROUND_SERVICE`: keep active streaming alive while the app is backgrounded.
- `FOREGROUND_SERVICE_DATA_SYNC`: classify the RTMP/RTMPS upload side of the active streaming service.
- `FOREGROUND_SERVICE_MEDIA_PLAYBACK`: classify the prerecorded media playback/preview side of the active streaming service.
- `POST_NOTIFICATIONS`: show the live-stream notification and Stop action on Android versions that require notification runtime consent.
- `WAKE_LOCK`: hold a partial wake lock only while FFmpeg is actively streaming so screen sleep does not suspend the live upload.
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`: let the user exempt Castarro when battery optimization would stop the core live-streaming function.

## Stream-Kill Risk Tracking

The app tracks and warns about these live-stream risks while Castarro is running:

- Battery optimization is not exempted.
- Battery saver is enabled.
- Live notification permission is disabled.
- Required foreground service declarations are unavailable.
- Android places the app in a restricted or rare app standby bucket.
- Device manufacturer battery controls are likely to add extra restrictions.
- The user force-stops the app.
- The user stops the foreground service or live notification.

Force-stop is a special case: Android immediately stops the process, so Castarro cannot show a warning after the action has already happened. The app warns before streaming and in Settings that force-stop will end the stream.

YouTube account connection uses Google Play Services Authorization and the YouTube Live API over `INTERNET`; it does not add camera, microphone, contacts, location, or broad storage permissions.

The app intentionally avoids:

- `CAMERA`
- `RECORD_AUDIO`
- broad external storage permissions

Video selection uses Android Storage Access Framework through `OpenDocument`. The selected file is copied into app-private storage before streaming so the backend can use a normal filesystem path.
