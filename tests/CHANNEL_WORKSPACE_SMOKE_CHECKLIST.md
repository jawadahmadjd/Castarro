# Channel Workspace Smoke Checklist

- [x] Open Control tab and confirm channel workspace panel is visible when `ui.channel_workspace_enabled=true`.
- [x] Switch channel A -> B -> C and verify active header + linked account badge update each time.
- [x] Click `Open Scoped Scheduler` and confirm YouTube schedule channel pre-selects active workspace channel.
- [x] Run backend verify endpoint (`/api/youtube/verify-channel-keys`) for one channel and for all channels.
- [x] Confirm schedule guard blocks unlinked/disconnected channels with `400` and clear reason.
- [x] Confirm legacy `Channels` cards remain visible when `ui.legacy_tabs_enabled=true`.
- [x] Confirm rollback path works by setting `ui.channel_workspace_enabled=false`.
