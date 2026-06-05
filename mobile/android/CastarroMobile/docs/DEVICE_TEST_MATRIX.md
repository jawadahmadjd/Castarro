# Device Test Matrix

Required manual checks before Android MVP release:

- Wi-Fi streaming to YouTube Live.
- Mobile-data streaming to YouTube Live.
- Low-signal or network-loss recovery.
- App backgrounding during active streaming.
- Screen lock during active streaming.
- Low-battery behavior while the foreground service is running.
- Unsupported video rejection.
- Wrong stream key rejection.
- YouTube Auto Start and Auto Stop behavior in manual-key mode.

Recommended device spread:

- Android 10 or 11 mid-range device.
- Android 13 or 14 device with notification runtime permission.
- Android 15 target-SDK behavior check.
