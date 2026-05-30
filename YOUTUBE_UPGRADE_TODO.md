# YouTube Integration Upgrade TODO

- [x] Add a dedicated `YouTube` tab inside `Settings` and merge Live channel settings into it.
- [x] Add YouTube OAuth settings fields (Client ID, Client Secret, Redirect URI, token file path).
- [x] Add `Connect to YouTube`, `Refresh`, and `Disconnect` actions in UI.
- [x] Implement backend OAuth flow (start URL, callback, token persistence, token refresh).
- [x] Add endpoint to read YouTube connection/account status.
- [x] Add endpoint to list upcoming YouTube broadcasts.
- [x] Add UI panel to schedule a new YouTube live broadcast.
- [x] Implement backend broadcast creation + stream creation + bind flow via YouTube API.
- [x] Auto-apply created YouTube stream key to selected Castarro channel.
- [x] Save broadcast metadata (`youtube_broadcast_id`, `youtube_stream_id`, `youtube_studio_url`) per channel.
- [x] Add desktop OAuth mode with PKCE and optional client secret support.
- [x] Add loopback redirect compatibility route (`/oauth2redirect`) for desktop credential flow.
- [x] Split YouTube settings into user-facing connect/schedule controls and owner-only OAuth setup.
- [x] Keep legacy configs working by normalizing missing `youtube` config shape.
- [x] Document simple setup/use instructions in README.
