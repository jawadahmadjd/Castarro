# Play Store Privacy Declarations

Castarro Mobile MVP is a prerecorded-file streaming tool, not a camera or microphone broadcaster.

Data handled by the app:

- User-selected local video files, copied into app-private storage for streaming.
- Manual YouTube RTMP/RTMPS server URL.
- Manual stream key stored through encrypted Android preferences.
- Connected Google/YouTube account display details after user consent.
- YouTube Live broadcast metadata entered by the user, such as title and privacy status.
- YouTube-generated RTMPS ingest URL and stream name; the stream name is stored through encrypted Android preferences.
- Stream-session history such as status, start/end time, uploaded bytes, bitrate, failure reason, and log path.

Data not collected by the MVP:

- Camera capture.
- Microphone audio.
- Contacts.
- Precise location.
- Advertising identifiers.

Network sharing:

- Video packets and stream credentials are sent only to the user-provided RTMP/RTMPS destination.
- When YouTube account mode is used, OAuth consent is handled by Google Play Services and YouTube Live API requests are sent to Google APIs to create and bind the broadcast and stream.

Before public release, confirm the final FFmpeg package notices, privacy policy URL, notification disclosure, and any crash-reporting or analytics settings actually included in the release build.

Foreground service and battery optimization disclosure:

- Castarro uses a foreground service only during an active live stream.
- The foreground service is declared for RTMP/RTMPS upload (`dataSync`) and prerecorded media stream/playback lifecycle (`mediaPlayback`).
- The persistent notification shows live status and a Stop action.
- Castarro may ask the user to ignore battery optimizations because uninterrupted live streaming is the app's core function and battery optimization can stop the stream during inactivity or Doze.
- Castarro does not request camera or microphone access for the prerecorded-file MVP.
