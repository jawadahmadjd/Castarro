# Play Store Privacy Declarations

Castarro Mobile MVP is a prerecorded-file streaming tool, not a camera or microphone broadcaster.

Data handled by the app:

- User-selected local video files, copied into app-private storage for streaming.
- Manual YouTube RTMP/RTMPS server URL.
- Manual stream key stored through encrypted Android preferences.
- Stream-session history such as status, start/end time, uploaded bytes, bitrate, failure reason, and log path.

Data not collected by the MVP:

- Camera capture.
- Microphone audio.
- Contacts.
- Precise location.
- Advertising identifiers.

Network sharing:

- Video packets and stream credentials are sent only to the user-provided RTMP/RTMPS destination.
- Google OAuth and YouTube account mode are not enabled in the manual-key MVP.

Before public release, confirm the final FFmpeg package notices, privacy policy URL, notification disclosure, and any crash-reporting or analytics settings actually included in the release build.
