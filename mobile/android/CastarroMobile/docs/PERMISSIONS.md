# Android Permissions

MVP permissions:

- `INTERNET`: upload the RTMP/RTMPS stream.
- `ACCESS_NETWORK_STATE`: detect connection loss and reconnect status.
- `FOREGROUND_SERVICE`: keep active streaming alive while the app is backgrounded.
- `FOREGROUND_SERVICE_DATA_SYNC`: classify the foreground streaming service.
- `POST_NOTIFICATIONS`: show the live-stream notification and Stop action on Android versions that require notification runtime consent.

The app intentionally avoids:

- `CAMERA`
- `RECORD_AUDIO`
- broad external storage permissions

Video selection uses Android Storage Access Framework through `OpenDocument`. The selected file is copied into app-private storage before streaming so the backend can use a normal filesystem path.
