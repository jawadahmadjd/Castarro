# Channel-First Spacious UI Architecture

## TODO List
- [ ] Phase 0: Baseline safety
  - [ ] Capture current desktop screenshots for Dashboard, Folders, Video Encoder, YouTube, Live History, and Troubleshooting.
  - [ ] Capture current narrow screenshots for the dashboard and one settings section.
  - [ ] Record current behavior for channel switching, save settings, start all, stop all, start channel, stop channel, verify keys, YouTube schedule, activity logs, and live history.
  - [ ] Confirm no backend files are required for this redesign.
- [ ] Phase 1: Navigation shell
  - [ ] Replace the top Dashboard/Settings tab mental model with a persistent left navigation shell.
  - [ ] Keep channel selection always visible in the sidebar.
  - [ ] Move current settings tabs into direct channel tool entries: Folders, Encoder, YouTube, History, Troubleshoot.
  - [ ] Keep all navigation client-side only.
- [ ] Phase 2: Channel-first state binding
  - [ ] Reuse `state.workspace.selectedChannelName` as the only active channel source.
  - [ ] Ensure every page title and action displays or implies the selected channel.
  - [ ] Keep `state.activeSettingsChannelIndex` synchronized from the selected channel for existing form save logic.
  - [ ] Preserve all existing channel-scoped API request payloads.
- [ ] Phase 3: Spacious dashboard composition
  - [ ] Build a calmer Overview page with one wide status band, one dominant preview panel, one readiness panel, and one recent activity panel.
  - [ ] Reduce dense badges in the main content.
  - [ ] Increase panel gaps, padding, and line height for comfortable reading.
  - [ ] Use a content max width so large displays feel spacious without stretching fields too far.
- [ ] Phase 4: Channel tool pages
  - [ ] Recompose Folders from `settingsFoldersView` into a channel-scoped route.
  - [ ] Recompose Video Encoder from `settingsNormalizeView` into a channel-scoped route.
  - [ ] Recompose YouTube from `settingsYoutubeView` into a channel-scoped route.
  - [ ] Recompose Live History from `settingsLiveHistoryView` into a channel-scoped route.
  - [ ] Recompose Troubleshooting from `settingsTroubleshootingView` into a channel-scoped route.
- [ ] Phase 5: Visual system
  - [ ] Introduce warm gold/orange design tokens.
  - [ ] Add compact sidebar channel rows for 10+ channels.
  - [ ] Add spacious main layout utilities.
  - [ ] Remove visual clutter from dense card/table areas without removing data.
- [ ] Phase 6: Verification
  - [ ] Run existing tests.
  - [ ] Run channel workspace contract tests.
  - [ ] Capture after screenshots.
  - [ ] Manually verify no backend behavior changed.
  - [ ] Verify no important controls disappear at 1080p, narrow desktop, and large display widths.

---

## 1. Objective

Redesign Castarro into a spacious, channel-first desktop control room while keeping all backend behavior unchanged.

The user should first choose a channel, then manage everything for that channel:

- Overview
- Folders
- Encoder
- YouTube
- History
- Troubleshooting

Nothing should feel global unless it is truly global. Existing backend endpoints, config format, stream behavior, FFmpeg behavior, YouTube behavior, task behavior, and database behavior must remain unchanged.

## 2. Non-Negotiable Boundaries

### In Scope

- `web/index.html`
- `web/app.js`
- `web/styles.css`
- Optional screenshot/test updates
- Optional frontend-only helper functions
- Optional DOM structure changes that call existing JavaScript actions

### Out of Scope

- No changes to stream manager behavior.
- No changes to FFmpeg commands.
- No changes to YouTube service behavior.
- No changes to database schema.
- No changes to API endpoint names or backend request handling.
- No change to config save semantics.
- No change to channel/account mapping rules.

### Backend Contract Rule

The UI may call existing functions and endpoints, but it must not require new backend behavior.

Examples to preserve:

- `startStream(channel)` still calls `/api/stream/start`.
- `stopStream(channel)` still calls `/api/stream/stop`.
- `startTask(action, channel)` still calls `/api/task/start`.
- `saveSettings()` still saves collected config JSON.
- YouTube verification and scheduling continue to use the existing YouTube frontend functions and API calls.

## 3. Current Frontend Anchors

The redesign should build on these existing files:

- `web/index.html`: current shell, dashboard view, settings view, modal markup.
- `web/app.js`: frontend state, API calls, render functions, form collection, channel actions.
- `web/styles.css`: current visual system and layout rules.

Important current state:

- `state.workspace.selectedChannelName`
- `state.workspace.lastSelectedByTab`
- `state.workspace.channelCache`
- `state.activeTab`
- `state.settingsTab`
- `state.activeSettingsChannelIndex`
- `state.status`
- `state.configData`
- `state.youtubeStatus`
- `state.settingsLiveHistory`

Important current render/action functions:

- `renderWorkspaceChannelList(payload)`
- `renderChannelWorkspace(payload)`
- `openWorkspaceRoute(routeName)`
- `renderTasks(tasks, events)`
- `renderLiveHistory(sessions)`
- `renderSettingsLiveHistory()`
- `renderLogs(streams)`
- `renderPreview(streams)`
- `renderSettingsForms()`
- `renderYoutubeSettingsPanel(config)`
- `showTab(tab)`
- `showSettingsTab(tab)`
- `startStream(channel)`
- `stopStream(channel)`
- `startTask(action, channel, showControl)`
- `saveSettings()`

## 4. New Information Architecture

### 4.1 Primary Model

The UI becomes:

```text
Castarro

Channels
  Search
  Channel list
  Add Channel

Channel Tools
  Overview
  Folders
  Encoder
  YouTube
  History
  Troubleshoot

Main workspace
  Selected channel route content
```

### 4.2 Removed Mental Model

The user should no longer think:

```text
Dashboard -> Settings -> YouTube
```

The user should think:

```text
Inside Us -> YouTube
```

### 4.3 Global Controls

Global controls may remain available, but they must be visually separated from channel controls.

Global:

- Start all streams
- Stop all streams
- Global verify summary
- App/server status
- Update banner
- Close UI only
- Stop streams and exit

Channel-scoped:

- Start selected channel
- Stop selected channel
- Verify selected channel
- Preview selected channel
- Folders for selected channel
- Encoder settings for selected channel
- YouTube mapping/scheduling for selected channel
- History for selected channel
- Troubleshooting/logs for selected channel

## 5. Shell Layout

### 5.1 Desktop Grid

Use a full-height app shell:

```text
┌────────────────────────────┬──────────────────────────────────────────────┐
│ Sidebar                    │ Main workspace                               │
│                            │                                              │
│ Brand/status               │ Page header                                  │
│ Channels/search/list       │ Status band                                  │
│ Add channel                │ Primary content                              │
│ Channel tools              │ Secondary content                            │
│ Global footer/actions      │                                              │
└────────────────────────────┴──────────────────────────────────────────────┘
```

Recommended sizing:

- Sidebar: `280px` at standard desktop.
- Main outer padding: `32px`.
- Main content max width: `1500px` to `1640px`.
- Main content gap: `28px` to `36px`.
- Panel padding: `24px` to `32px`.

The app should not stretch form fields endlessly on 4K displays. The main content can sit inside a max-width container and leave quiet space on the right or center itself.

### 5.2 Sidebar

Sidebar zones:

1. Brand block
2. Global compact status
3. Channel search/list
4. Add channel action
5. Channel tool navigation
6. Optional footer actions/version

Channel list behavior:

- Show 8 to 10 rows comfortably.
- Use a scrollable list when more channels exist.
- Use compact inactive rows.
- Use a stronger selected row.
- Search filters the visible list client-side.
- Keep the tool navigation fixed below the list.

Inactive channel row:

- Initial/avatar
- Channel name
- Small status dot
- Short status text

Selected channel row:

- Gold highlight
- Left accent
- Channel name
- `Connected · Ready` or equivalent status line

Avoid showing multiple large badges on every inactive channel because 10+ channels will feel crowded.

### 5.3 Main Workspace

Every main page uses this structure:

```text
Page header
Status/context band
Primary content
Secondary content
```

Header must include selected channel context:

- Breadcrumb: `CHANNEL / INSIDE US`
- Title: `Inside Us`
- Subtitle: `Controls and status for this channel only.`
- Page actions

For tool pages:

- `Inside Us / Folders`
- `Inside Us / Encoder`
- `Inside Us / YouTube`
- `Inside Us / History`
- `Inside Us / Troubleshoot`

## 6. Route Architecture

This redesign can remain a single-page frontend. No backend router changes are needed.

Add a frontend route field:

```js
state.workspace.activeRoute = "overview";
```

Allowed route names:

- `overview`
- `folders`
- `encoder`
- `youtube`
- `history`
- `troubleshoot`

Map old settings tab names to new route names:

```js
const routeToSettingsTab = {
  folders: "folders",
  encoder: "normalize",
  youtube: "youtube",
  history: "liveHistory",
  troubleshoot: "troubleshooting",
};
```

This preserves the current settings render and save behavior while changing where the navigation lives.

### 6.1 Route Click Flow

1. User clicks a sidebar tool.
2. Set `state.workspace.activeRoute`.
3. Sync old state where needed:
   - `state.activeTab = "settings"` only if existing render code requires it.
   - `state.settingsTab = routeToSettingsTab[route]`.
   - `syncActiveSettingsChannelFromWorkspace(true)`.
4. Render the shell.
5. Trigger existing side effects for special sections:
   - YouTube route refreshes YouTube status/broadcasts.
   - History route fetches channel history.
   - Encoder route refreshes raw files.

### 6.2 Compatibility Layer

Keep `showTab()` and `showSettingsTab()` working during migration, but make sidebar route clicks the preferred UI.

Possible approach:

- Keep old top tabs hidden visually after parity.
- Keep old functions as compatibility wrappers.
- Let `openWorkspaceRoute(routeName)` become the new canonical route action.

## 7. Component Architecture

### 7.1 Shell Components

Suggested render functions:

```js
renderAppShell(payload)
renderSidebar(payload)
renderSidebarBrand(payload)
renderSidebarGlobalStatus(payload)
renderChannelSearch(payload)
renderChannelList(payload)
renderChannelTools(payload)
renderMainWorkspace(payload)
```

These can be introduced gradually. Existing functions can be reused during the transition.

### 7.2 Channel Components

```js
renderCompactChannelRow(channel, viewModel)
renderSelectedChannelRow(channel, viewModel)
renderChannelStatusDot(viewModel)
renderChannelSearchEmpty()
```

Channel row view model should come from selectors, not duplicate backend logic.

### 7.3 Main Workspace Components

```js
renderChannelPageHeader(channel, route)
renderChannelStatusBand(channel, payload)
renderOverviewPage(channel, payload)
renderFoldersPage(channel, config)
renderEncoderPage(channel, config)
renderYoutubePage(channel, config)
renderHistoryPage(channel, payload)
renderTroubleshootPage(channel, payload)
```

### 7.4 Overview Page Components

Overview should be intentionally calm:

```text
Header
Wide status band
Large preview + readiness panel
Recent activity
```

Components:

- `ChannelStatusBand`
- `ProgramPreviewPanel`
- `ChannelReadinessPanel`
- `RecentActivityPanel`

Avoid showing all possible stats as separate small cards.

## 8. Data/View Model Architecture

The UI should use selectors to create display models from existing state.

Existing selectors to preserve/use:

- `getSelectedChannel(config, selectedChannelName)`
- `getLinkedAccountForChannel(status, channel)`
- `getChannelTasks(tasks, channelName)`
- `getChannelStreams(streams, channelName)`
- `getChannelEvents(events, channelName)`

Recommended new frontend-only selectors:

```js
function getChannelHealthViewModel(channel, payload) {}
function getChannelReadinessViewModel(channel, payload, youtubeStatus) {}
function getSidebarChannelViewModels(payload) {}
function getRouteTitle(route, channel) {}
function getRecentActivityViewModel(channelName, payload) {}
```

These selectors must not mutate `state.configData` or `state.status`.

### 8.1 Channel Health View Model

Fields:

- `name`
- `enabled`
- `connected`
- `ready`
- `streamState`
- `verificationState`
- `linkedAccountLabel`
- `hasManualKey`
- `statusTone`

### 8.2 Readiness View Model

Rows:

- YouTube account
- Stream key
- Encoder preset
- Folders

Each row:

- `label`
- `value`
- `status`
- `tone`
- `routeTarget`

## 9. Page Architecture

### 9.1 Overview

Purpose:

- Let the user monitor and control the selected channel.

Content:

- Header with selected channel.
- Channel actions: Verify, Start, Stop.
- Wide status band:
  - Connection
  - Readiness
  - Stream
  - Last verified
- Program Preview.
- Channel Readiness.
- Recent Activity.

Spacing rules:

- Preview panel should dominate.
- Readiness panel should have large rows and minimal badges.
- Activity should be visually secondary.

### 9.2 Folders

Purpose:

- Configure folder paths for the selected channel while preserving current config save behavior.

Content:

- Source/raw videos.
- Normalized output.
- Runtime/logs if currently configurable.
- Folder health/readiness summary if derivable from existing status/config.

Implementation:

- Reuse existing folder fields where possible.
- If current folder defaults are global, label them honestly as inherited/default paths while showing selected channel context.
- Do not create backend validation if it does not exist.

### 9.3 Encoder

Purpose:

- Configure selected channel's source videos and encoder/live profile.

Content:

- Channel name/enabled state.
- Add videos.
- Selected source files.
- Normalize profile.
- Live profile.
- Channel remove action with current confirmation flow.
- Current task/progress for selected channel.

Implementation:

- Reuse `settingsNormalizeView` behavior.
- Keep `startSettingsTask(action, index)`.
- Keep `removeActiveSettingsChannel()` and delete modal behavior.

### 9.4 YouTube

Purpose:

- Manage selected channel's YouTube account, broadcast, stream key, and scheduling.

Content:

- Linked account.
- Connect/reconnect account.
- Account health.
- Broadcast import/schedule.
- Stream key verification.
- YouTube preferences.

Implementation:

- Reuse `renderYoutubeSettingsPanel(config)`.
- Keep existing selected account synchronization:
  - `syncYoutubeSelectedAccountFromChannel(config)`.
- Keep existing verification/scheduling functions.
- Do not change account mapping backend behavior.

### 9.5 History

Purpose:

- Review selected channel live sessions.

Content:

- Search.
- Date filter.
- Summary strip.
- Sessions list/table.

Implementation:

- Reuse `settingsLiveHistory`.
- Reuse `renderSettingsLiveHistory()`.
- Keep fetch behavior unchanged.
- Ensure wording says selected channel only.

### 9.6 Troubleshoot

Purpose:

- Show selected channel activity and logs.

Content:

- Activity filters.
- Activity events.
- Stream logs.
- Copy controls.
- Clear activity logs if currently supported.

Implementation:

- Reuse `renderTasks(tasks, events)`.
- Reuse `renderLogs(streams)`.
- Keep current splitter only if it does not make the layout feel crowded.
- Prefer one spacious stack on normal desktop and a two-panel layout only at wide widths.

## 10. Visual Design System

### 10.1 Tone

Preferred look:

- Warm
- Gold/orange
- Calm
- Spacious
- Operational
- Desktop-app focused

Avoid:

- Crowded badge-heavy UI
- Beige-only palette
- Purple/blue gradients
- Decorative blobs/orbs
- Marketing hero composition
- Nested cards
- Tiny dense tables where a list would read better

### 10.2 Token Direction

Recommended tokens:

```css
:root {
  --ui-bg: #f7f1e5;
  --ui-surface: #fffaf0;
  --ui-surface-soft: #fbf2df;
  --ui-sidebar: #2f2414;
  --ui-sidebar-muted: #a99775;
  --ui-ink: #2a241b;
  --ui-muted: #766b59;
  --ui-line: #e2d5bf;
  --ui-gold: #d99a32;
  --ui-gold-soft: #f4dfad;
  --ui-orange: #c97926;
  --ui-success: #3e7d4f;
  --ui-danger: #a9493d;
  --ui-radius: 8px;
  --ui-shadow-soft: 0 18px 50px rgba(58, 43, 20, 0.09);
}
```

Cards/panels should generally use 8px radius for a more professional tool feel.

### 10.3 Spacing Scale

Use more generous main workspace spacing:

```css
--space-xs: 8px;
--space-sm: 12px;
--space-md: 18px;
--space-lg: 28px;
--space-xl: 40px;
```

Main page:

- Header to status band: `24px`
- Status band to content: `32px`
- Content columns gap: `32px`
- Bottom section gap: `32px`
- Panel padding: `28px`

### 10.4 Typography

Rules:

- No viewport-scaled font sizes.
- No negative letter spacing.
- Compact but readable labels.
- Page titles should be large enough to anchor the page.
- Panel headings should stay modest.
- Buttons should not wrap awkwardly.

Recommended:

- Page title: `32px`
- Section title: `18px`
- Body: `14px` to `15px`
- Helper: `13px`
- Meta labels: `11px` to `12px`

## 11. Layout Responsiveness

### 11.1 1080p Desktop

Target:

- Sidebar visible.
- Main content visible without feeling crowded.
- Preview and readiness can sit side by side.
- Recent Activity visible below.

### 11.2 Large/4K Displays

Target:

- Main content maxes out around `1500px` to `1640px`.
- Increase margins around the workspace.
- Do not stretch text fields and log lines across the whole screen.
- Keep the reading column comfortable.

### 11.3 Narrow Desktop/Tablet

Target:

- Sidebar may become a top drawer or stacked rail only if needed.
- Channel search/list remains accessible.
- Main content becomes one column.
- Start/stop/verify buttons wrap cleanly.

### 11.4 Small Mobile

The app is primarily desktop, but it should not break:

- Sidebar stacks above content.
- Channel tools become horizontal scroll or stacked buttons.
- Preview remains 16:9.
- No overlapping text.

## 12. DOM Migration Plan

### 12.1 Preferred End State

Update `web/index.html` to include:

```html
<main class="app-shell">
  <aside id="appSidebar" class="app-sidebar"></aside>
  <section class="app-main">
    <section id="workspaceHeader"></section>
    <section id="workspaceBody"></section>
  </section>
</main>
```

Keep existing modal markup.

### 12.2 Incremental Safe Approach

Because the existing app has many IDs and event bindings, use an incremental migration:

1. Keep existing IDs for controls that JavaScript expects.
2. Move or duplicate containers only when events are rebound safely.
3. Replace `viewControl` and `viewSettings` visibility with route-driven rendering.
4. Keep old settings section IDs until their render functions are safely moved.
5. Remove old top tabs only after all routes are working.

### 12.3 Existing IDs To Preserve During Migration

Preserve these IDs until their event bindings are replaced:

- `startAll`
- `stopAll`
- `serverState`
- `workspaceGlobalVerifySummary`
- `closeUiOnly`
- `stopAndExit`
- `updateBanner`
- `restartToUpdate`
- `channelWorkspaceList`
- `addChannelRail`
- `programPreview`
- `previewEmpty`
- `previewWarning`
- `liveHistoryList`
- `saveSettings`
- `folderSettingsFields`
- `normalizationChannels`
- `youtubeSettingsPanel`
- `settingsLiveHistorySearch`
- `settingsLiveHistoryRangeButton`
- `settingsLiveHistoryTable`
- `tasks`
- `streamLogs`
- `deleteChannelDialog`

## 13. JavaScript Migration Plan

### 13.1 Add Route State

Add to `state.workspace`:

```js
activeRoute: "overview",
channelSearch: "",
```

### 13.2 Add Route Function

```js
function setWorkspaceRoute(routeName) {
  state.workspace.activeRoute = normalizeWorkspaceRoute(routeName);
  syncActiveSettingsChannelFromWorkspace(false);
  runRouteSideEffects(state.workspace.activeRoute);
  renderChannelWorkspace(state.status || {});
}
```

### 13.3 Add Route Side Effects

```js
function runRouteSideEffects(routeName) {
  if (routeName === "history") {
    fetchSettingsLiveHistory().catch((error) => toast(error.message));
  }
  if (routeName === "encoder") {
    refreshActiveRawFiles({ force: true }).catch((error) => toast(error.message));
  }
  if (routeName === "youtube") {
    refreshYoutubeStatus()
      .then(() => refreshYoutubeBroadcasts(true))
      .catch((error) => toast(error.message));
  }
}
```

Use existing side-effect functions. Do not create new backend behavior.

### 13.4 Rework `renderChannelWorkspace`

Current `renderChannelWorkspace(payload)` should become the central shell renderer:

```js
function renderChannelWorkspace(payload) {
  ensureWorkspaceChannelSelection(payload);
  renderSidebar(payload);
  renderWorkspaceHeader(payload);
  renderWorkspaceRoute(payload, state.workspace.activeRoute);
}
```

During migration, it can continue to call existing section renderers internally.

### 13.5 Preserve Save Flow

Save should continue:

```js
saveSettings()
collectSettingsData()
saveConfigData(data)
```

Do not add separate save behavior per route unless it calls the same existing save path.

## 14. CSS Architecture

Add a new layout layer near the workspace styles:

```css
.app-shell {}
.app-sidebar {}
.app-main {}
.app-main-inner {}
.sidebar-brand {}
.sidebar-status {}
.sidebar-section {}
.sidebar-channel-search {}
.sidebar-channel-list {}
.sidebar-channel-row {}
.sidebar-channel-row.is-active {}
.sidebar-tool-list {}
.sidebar-tool-item {}
.workspace-header {}
.workspace-status-band {}
.workspace-overview-grid {}
.workspace-preview-panel {}
.workspace-readiness-panel {}
.workspace-activity-panel {}
```

### 14.1 Main Workspace Spaciousness

Use:

```css
.app-main-inner {
  width: min(100%, 1560px);
  margin: 0 auto;
  display: grid;
  gap: 32px;
}
```

Use larger gaps instead of adding many borders.

### 14.2 Overview Grid

```css
.workspace-overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 380px);
  gap: 32px;
  align-items: start;
}
```

At narrower widths:

```css
@media (max-width: 1180px) {
  .workspace-overview-grid {
    grid-template-columns: 1fr;
  }
}
```

### 14.3 Channel List Capacity

```css
.sidebar-channel-list {
  max-height: min(42vh, 440px);
  overflow: auto;
}
```

This keeps 10+ channels manageable.

## 15. Accessibility and Usability

Requirements:

- Sidebar nav uses buttons or links with clear active states.
- Active channel row has `aria-current` or equivalent.
- Search input has a visible label or accessible label.
- Buttons have descriptive text, not icons only.
- Status dots are never the only status indicator.
- Keyboard users can tab through channels and tools.
- Focus states are visible in the gold/orange theme.
- Critical actions still show selected channel context.

## 16. Testing Strategy

### 16.1 No-Backend-Change Verification

Before and after:

- Compare API paths called by key actions.
- Confirm request bodies still contain the same `config`, `channel`, and action fields.
- Confirm no Python/backend files changed for this UI-only redesign.

### 16.2 Functional Smoke

Test:

- Select channel A, open Overview.
- Select channel B, open Overview.
- Open Folders, save settings.
- Open Encoder, add/select videos, save.
- Open YouTube, verify channel keys.
- Open History, filter/search.
- Open Troubleshoot, copy logs.
- Start selected channel.
- Stop selected channel.
- Start all streams.
- Stop all streams.

### 16.3 Multi-Channel Regression

Test with at least 10 channels:

- Sidebar remains readable.
- Channel list scrolls independently.
- Channel tools stay reachable.
- Selected channel remains obvious.
- Switching channels updates every page title and scoped content.

### 16.4 Visual Regression

Capture:

- Overview desktop.
- Folders desktop.
- Encoder desktop.
- YouTube desktop.
- History desktop.
- Troubleshoot desktop.
- Overview narrow desktop.
- Overview small mobile fallback.

Check:

- No text overlap.
- No clipped buttons.
- No hidden critical controls.
- Preview is correctly framed.
- Main area has comfortable spacing.

## 17. Acceptance Criteria

The redesign is complete when:

1. The left sidebar shows channel selection and direct channel tools.
2. Current settings tabs are no longer the primary navigation.
3. Every tool page is clearly scoped to the selected channel.
4. 10+ channels remain usable through search and scrolling.
5. The Overview page is visibly calmer than the current dashboard.
6. The main workspace uses generous spacing and a readable max width.
7. Existing backend endpoints and behavior are unchanged.
8. Existing save/start/stop/verify/history/log actions still work.
9. Tests and screenshots confirm no major visual or behavioral regression.

## 18. Recommended Implementation Order

1. Add route state and sidebar route buttons.
2. Restyle the sidebar into the final compact channel-first version.
3. Recompose Overview first because it defines the visual language.
4. Move Folders, Encoder, YouTube, History, and Troubleshoot into route pages one by one.
5. Hide old top tabs after all routes work.
6. Run tests and screenshot checks.
7. Remove unused legacy CSS only after parity is confirmed.

## 19. Final Design Principle

The selected channel is the workspace. The left sidebar chooses the channel and the channel tool. The main area should show fewer things at once, with more room around each thing, so the app feels calm on 1080p and comfortably premium on 4K.
