# Channel Workspace Architecture (With Progress TODO)

## TODO Tracker
- [ ] Phase 0: Baseline and safety net
  - [x] Capture current screenshots for Control, Normalize, Live, YouTube tabs
  - [x] Add smoke test checklist for: schedule, start stream, stop stream, verify keys
  - [x] Add feature flag: `ui.channel_workspace_enabled` (default `false`)
- [ ] Phase 1: Information architecture and navigation
  - [x] Add persistent channel switcher (left rail or top selector)
  - [x] Add global overview strip (all channels status)
  - [x] Add active channel header with linked YouTube account badge
- [ ] Phase 2: State architecture refactor (frontend)
  - [x] Introduce `workspace.selectedChannelName`
  - [x] Introduce normalized selectors: selected channel, linked account, channel-scoped tasks/logs
  - [x] Ensure channel switch triggers fresh loads and UI rebind
- [ ] Phase 3: Channel workspace UI composition
  - [x] Build channel-scoped sections: Normalize, Live Output, YouTube Mapping, Schedule, Logs
  - [x] Keep global actions outside workspace: Start All, Stop All, global verify summary
  - [x] Add channel context guard banner before destructive/critical actions
- [ ] Phase 4: Backend/API contract hardening
  - [x] Standardize channel-scoped endpoints to require explicit `channel`
  - [x] Standardize schedule response with `channel`, `account_id`, `account_label`
  - [x] Add server-side guardrails for missing/unlinked channel-account mapping
- [ ] Phase 5: Migration and backward compatibility
  - [x] Auto-migrate old config shape to new shape on load
  - [x] Fallback behavior when only one account exists and channel link is empty
  - [x] Keep legacy tabs accessible behind fallback toggle during transition
- [ ] Phase 6: Test and release hardening
  - [x] Add UI regression checklist per channel switch scenario
  - [x] Add end-to-end schedule tests for channels A/B/C mapped to different accounts
  - [x] Add rollback path to old UI with feature flag
  - [ ] Perform staged rollout: internal -> pilot -> full

---

## 1) Objective
Convert the current tab-centric flow into a channel-centric workspace:
- Select one Castarro channel.
- Perform most actions within that channel context.
- Keep global visibility and bulk controls always available.

Result: reduced confusion, fewer wrong-account schedules, faster operations.

## 2) Non-Negotiable Safety Principles
1. No silent context: every critical action must display active `Castarro channel` and `Linked YouTube account`.
2. Explicit scoping: schedule/verify/test actions must pass explicit channel scope.
3. Global visibility preserved: all-channel health summary remains visible.
4. Backward compatibility: old configs and single-account flows must continue to work.
5. Feature-flag rollout: new UX can be disabled instantly if any regression appears.

## 3) IA (Information Architecture)
### 3.1 Global Layer (always visible)
- Top controls: `Start All`, `Stop All`, global status chips.
- Channel overview strip/list:
  - Channel name
  - Enabled/disabled
  - Linked account
  - Key verification state
  - Stream running state

### 3.2 Channel Workspace Layer (selected channel only)
- Header:
  - Channel name (primary)
  - Linked YouTube account badge
  - Quick actions: `Test Stream`, `Verify This Channel`, `Open Studio`
- Workspace modules:
  1. Normalize (raw selection + profile)
  2. Live Output (playlist + ffmpeg profile)
  3. YouTube Mapping (linked account slot)
  4. Schedule (event creation scoped to linked account)
  5. Channel Logs/Activity

### 3.3 Advanced/Global Layer
- Advanced JSON editor
- Global activity stream
- Global stream logs

## 4) Frontend Architecture
### 4.1 State Model (target)
Add a dedicated workspace slice:
- `workspace.selectedChannelName: string`
- `workspace.lastSelectedByTab: Record<tab, channelName>` (optional)
- `workspace.channelCache: Record<channelName, ChannelViewModel>`
- `workspace.loading: { channelSwitch: boolean, module: string | null }`

Keep existing app state but route render through selectors:
- `getSelectedChannel(config, selectedChannelName)`
- `getLinkedAccountForChannel(status, channel)`
- `getChannelTasks(status.tasks, channelName)`
- `getChannelStreams(status.streams, channelName)`

### 4.2 Rendering Strategy
- Keep a single `renderApp()` entry.
- Split workspace into pure render functions:
  - `renderChannelSwitcher()`
  - `renderGlobalOverview()`
  - `renderChannelWorkspace(channelName)`
  - `renderChannelScheduleCard(channelName)`
- Avoid duplicated data-fetch logic in each card.

### 4.3 Event Flow
1. User switches channel.
2. Set `workspace.selectedChannelName`.
3. Trigger `refreshChannelContext(channelName)`:
   - raw files
   - normalized files
   - key verification for that channel
   - linked account broadcasts (optional prefetch)
4. Re-render workspace.

### 4.4 UX Guards (issue prevention)
- On schedule click:
  - Validate channel selected.
  - Validate linked account present.
  - Validate linked account connected.
  - Show confirmation text:
    - `Channel: X`
    - `Schedules on YouTube account: Y`
- Disable schedule button if any guard fails.

## 5) Backend/API Architecture
### 5.1 Existing endpoints to keep
- `/api/status`
- `/api/raw-files`
- `/api/normalized-files`
- `/api/youtube/status`
- `/api/youtube/verify-channel-keys`
- `/api/youtube/schedule`

### 5.2 Contract hardening
For channel-specific actions require:
- `channel` in request body/query
- Resolve linked account from channel on server
- Reject ambiguous requests with clear 4xx messages

### 5.3 Response normalization
For scheduling and verification include:
- `channel`
- `account_id`
- `account_label`
- `guard_reason` when blocked

### 5.4 Server guardrails
- Reject scheduling if channel has no linked account and more than one connected account exists.
- Require an explicit channel-account mapping; do not auto-fallback to a connected account.
- Keep verification non-fatal for `missing_account` status; fatal only for true mismatches when streaming/scheduling.

## 6) Data and Config Schema
Channel record remains source of truth:
- `channels[].youtube_account_id`
- `channels[].youtube_stream_id`
- `channels[].stream_key_env`

YouTube account registry:
- `youtube.accounts[]`
- `youtube.default_account_id`

Migration rule:
- If legacy `youtube.tokens_file` exists and no accounts:
  - create `default` slot automatically.

## 7) Progressive Implementation Plan
### Step A: Skeleton UX
- Add channel switcher + active channel header.
- Keep old forms but filter-render only selected channel sections.

### Step B: Scoped actions
- Route normalize/live/schedule/verify buttons through selected channel.
- Keep global buttons unchanged.

### Step C: Consistency layer
- Add context chips and confirmation/guard banners everywhere.

### Step D: Cleanup
- Remove duplicated tab-specific channel cards after parity confirmed.

## 8) Testing Strategy (No-Regression Focus)
### 8.1 Functional smoke
1. Single channel: schedule, start, stop still work.
2. Three channels A/B/C with different account mappings:
   - schedule on A -> appears on account A
   - schedule on B -> appears on account B
   - schedule on C -> appears on account C
3. Unlinked channel -> schedule blocked with clear message.

### 8.2 State transition tests
1. Switch channel while polling refresh runs.
2. Switch channel during in-progress task.
3. Re-open settings tab; selected channel persists.

### 8.3 Visual/UX regression
1. Desktop and mobile layout checks.
2. Badge alignment and header consistency checks.
3. No missing/overlapping controls in workspace modules.

### 8.4 Failure-path tests
1. Disconnected linked account.
2. Invalid token for one account but valid others.
3. API timeout during channel switch refresh.

## 9) Rollout and Rollback
### Rollout
1. Ship behind `ui.channel_workspace_enabled = false`.
2. Enable for internal usage.
3. Enable for pilot config/users.
4. Full enable after 1-2 days stable run.

### Rollback
- Toggle feature flag off.
- Old tabs remain operational.
- No data rollback needed because schema remains compatible.

## 10) Implementation Boundaries
In scope:
- UI/UX flow and rendering architecture
- Safe endpoint contract refinements
- Validation/guardrails and migration

Out of scope (for this initiative):
- FFmpeg pipeline behavior changes
- Database schema redesign unrelated to channel context
- OAuth provider changes

## 11) Definition of Done
1. User can select channel once and complete all channel tasks in one workspace.
2. Schedule always executes on selected channel’s linked YouTube account.
3. Global overview + bulk controls remain available and accurate.
4. All smoke tests pass, and feature flag rollback is verified.

---

## Important Note
No architecture can mathematically guarantee zero issues, but this design minimizes risk with:
- explicit scoping,
- strong server-side guards,
- migration fallback,
- staged rollout with instant rollback.
