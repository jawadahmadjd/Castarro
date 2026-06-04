const state = {
  config: "config.ready.json",
  status: null,
  configData: null,
  workspace: {
    selectedChannelName: "",
    lastSelectedByTab: {},
    channelCache: {},
    activeRoute: "overview",
    channelSearch: "",
    editingChannelName: "",
    editingChannelPicture: "",
    editingChannelImage: null,
    editingChannelPictureType: "image/png",
    editingChannelCrop: { x: 0, y: 0 },
    editingChannelDrag: null,
    loading: { channelSwitch: false, module: null },
  },
  activeTab: "control",
  settingsTab: "folders",
  rawFilesByChannel: {},
  normalizedFilesByChannel: {},
  rawFilesAutoRefreshBusy: false,
  rawFilesAutoRefreshLastAt: 0,
  activeSettingsChannelIndex: 0,
  channelDeleteDialog: { index: -1, name: "" },
  removedChannelUndo: null,
  hadRunningSettingsTask: false,
  expandedTaskLogs: {},
  previewChannel: "",
  previewUrl: "",
  previewHls: null,
  appVersion: null,
  updateStatus: null,
  youtubeStatus: null,
  youtubeBroadcasts: [],
  youtubeKeyChecks: null,
  youtubeStatusLoading: false,
  youtubeActionBusy: "",
  youtubeActionMessage: "",
  youtubeActionStatus: "idle",
  youtubeActionAt: "",
  youtubeSelectedAccountId: "",
  youtubeImportedBroadcastId: "",
  youtubeScheduleDraft: null,
  activityFilter: "all",
  localActivityEvents: [],
  activityRenderedItems: [],
  settingsLiveHistory: {
    sessions: [],
    filter: "last_28",
    menuOpen: false,
    calendarOpen: false,
    customStart: "",
    customEnd: "",
    pendingStart: "",
    pendingEnd: "",
    selectingCustomEnd: false,
  },
};

const $ = (id) => document.getElementById(id);
const desktopBridge = () => (window.desktopShell && typeof window.desktopShell === "object" ? window.desktopShell : null);
const ACTIVITY_STREAM_SPLIT_KEY = "castarro.activityStreamSplitRatio.v1";
const WORKSPACE_SELECTED_CHANNEL_KEY = "castarro.workspace.selectedChannel.v1";
const DASHBOARD_CACHE_KEY = "castarro.dashboard.frontPage.v1";
const YOUTUBE_STATUS_CACHE_KEY = "castarro.youtube.status.v1";
const WORKSPACE_ROUTES = ["overview", "folders", "encoder", "youtube", "history", "troubleshoot"];
const routeToSettingsTab = {
  folders: "folders",
  encoder: "normalize",
  youtube: "youtube",
  history: "liveHistory",
  troubleshoot: "troubleshooting",
};

const defaultLiveProfile = () => ({
  mode: "copy",
  video_encoder: "libx264",
  preset: "veryfast",
  profile: "high",
  pixel_format: "yuv420p",
  width: 1920,
  height: 1080,
  fps: 30,
  video_bitrate: "6800k",
  minrate: "6800k",
  maxrate: "6800k",
  bufsize: "13600k",
  gop_seconds: 2,
  audio_codec: "aac",
  audio_bitrate: "128k",
  audio_sample_rate: 44100,
  audio_channels: 2,
});

const defaultYoutubeSettings = () => ({
  client_id: "",
  client_secret: "",
  oauth_client_type: "desktop",
  use_pkce: true,
  redirect_uri: "http://127.0.0.1:8765/oauth2redirect",
  tokens_file: ".runtime/youtube_tokens.json",
  accounts: [],
  default_account_id: "",
  default_privacy_status: "unlisted",
  default_auto_start: true,
  default_auto_stop: true,
});

const defaultConfigData = () => ({
  defaults: {
    ffmpeg_path: "ffmpeg",
    ffprobe_path: "ffprobe",
    rtmp_base: "rtmp://a.rtmp.youtube.com/live2",
    log_dir: "logs",
    runtime_dir: ".runtime",
    raw_dir: "Raw Videos",
    normalized_dir: "Go Live",
    normalized_playlist_dir: "playlists",
    restart_delay_seconds: 10,
  },
  normalize_profile: {
    width: 1920,
    height: 1080,
    fps: 30,
    video_encoder: "libx264",
    rate_control: "vbr",
    video_bitrate: "6000k",
    video_minrate: "4500k",
    video_maxrate: "6800k",
    video_bufsize: "12000k",
    audio_bitrate: "160k",
    audio_sample_rate: 48000,
    x264_preset: "medium",
    x264_profile: "high",
  },
  live_profile: defaultLiveProfile(),
  youtube: defaultYoutubeSettings(),
  ui: {
    channel_workspace_enabled: true,
    legacy_tabs_enabled: false,
  },
  channels: [],
});

const defaultChannel = (index) => ({
  name: `channel_${index}`,
  enabled: true,
  stream_key_env: `YT_CHANNEL_${index}_KEY`,
  raw_playlist: [`Raw Videos/channel_${index}/video-001.mp4`],
  playlist: [],
  normalize_profile: {
    width: 1920,
    height: 1080,
    fps: 30,
    video_encoder: "libx264",
    rate_control: "vbr",
    video_bitrate: "6000k",
    video_minrate: "4500k",
    video_maxrate: "6800k",
    video_bufsize: "12000k",
    audio_bitrate: "160k",
    audio_sample_rate: 48000,
    x264_preset: "medium",
    x264_profile: "high",
  },
  live_profile: defaultLiveProfile(),
  youtube_auto_start: true,
  youtube_auto_stop: true,
  youtube_account_id: "",
  youtube_studio_url: "",
  youtube_broadcast_id: "",
  youtube_stream_id: "",
  loop: true,
  restart_on_exit: true,
});

function normalizeAccountId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

function defaultAccountTokensFile(accountId) {
  const safe = normalizeAccountId(accountId) || "account";
  return `.runtime/youtube_tokens_${safe}.json`;
}

function normalizedYoutubeAccounts(config) {
  const youtube = { ...defaultYoutubeSettings(), ...(config?.youtube || {}) };
  const raw = Array.isArray(youtube.accounts) ? youtube.accounts : [];
  const deduped = new Map();
  raw.forEach((item) => {
    const id = normalizeAccountId(item?.id || item?.account_id || "");
    if (!id || deduped.has(id)) return;
    deduped.set(id, {
      id,
      label: String(item?.label || item?.name || id).trim() || id,
      tokens_file: String(item?.tokens_file || "").trim() || defaultAccountTokensFile(id),
      channel_id: String(item?.channel_id || "").trim(),
      channel_title: String(item?.channel_title || "").trim(),
      channel_handle: String(item?.channel_handle || "").trim(),
      subscriber_count: String(item?.subscriber_count || "").trim(),
      hidden_subscriber_count: Boolean(item?.hidden_subscriber_count),
      expected_channel_name: String(item?.expected_channel_name || "").trim(),
      last_connected_at: String(item?.last_connected_at || "").trim(),
    });
  });
  if (!deduped.size) {
    const legacyTokens = String(youtube.tokens_file || "").trim();
    if (legacyTokens) {
      deduped.set("default", {
        id: "default",
        label: "Default account",
        tokens_file: legacyTokens,
        channel_id: "",
        channel_title: "",
        channel_handle: "",
        subscriber_count: "",
        hidden_subscriber_count: false,
        expected_channel_name: "",
        last_connected_at: "",
      });
    }
  }
  return Array.from(deduped.values());
}

function workspaceStorageKey() {
  return `${WORKSPACE_SELECTED_CHANNEL_KEY}:${state.config || "config.json"}`;
}

function youtubeStatusStorageKey() {
  return `${YOUTUBE_STATUS_CACHE_KEY}:${state.config || "config.json"}`;
}

function isChannelWorkspaceEnabled() {
  return Boolean(state.configData?.ui?.channel_workspace_enabled);
}

function areLegacyTabsEnabled() {
  return false;
}

function enabledChannels(payload) {
  const channels = Array.isArray(payload?.channels) ? payload.channels : [];
  return channels.filter((channel) => channel?.enabled !== false);
}

function getSelectedChannel(config, selectedChannelName) {
  const channels = Array.isArray(config?.channels) ? config.channels : [];
  if (!channels.length) return null;
  const matched = channels.find((channel) => String(channel?.name || "") === String(selectedChannelName || ""));
  if (matched) return matched;
  return channels.find((channel) => channel?.enabled !== false) || channels[0];
}

function getLinkedAccountForChannel(status, channel) {
  const accountId = normalizeAccountId(channel?.youtube_account_id || "");
  const accounts = Array.isArray(status?.accounts) ? status.accounts : [];
  if (accountId) {
    const account = accounts.find((item) => normalizeAccountId(item?.id || "") === accountId);
    if (account) {
      return {
        ...account,
        id: accountId,
        fallback: false,
      };
    }
    return {
      id: accountId,
      label: accountId,
      connected: false,
      fallback: false,
    };
  }
  return null;
}

function getSelectedWorkspaceChannel(config) {
  return getSelectedChannel(config || defaultConfigData(), state.workspace.selectedChannelName);
}

function selectedWorkspaceChannelName() {
  return String(state.workspace.selectedChannelName || "").trim();
}

function taskChannelName(task) {
  return String(task?.channel || task?.progress?.channel || "").trim();
}

function eventChannelName(event) {
  return String(event?.channel_name || "").trim();
}

function findReusableYoutubeAccountForChannel(accounts, channelName) {
  const expected = String(channelName || "").trim();
  if (!expected) return null;
  return accounts.find((item) => String(item?.expected_channel_name || "").trim() === expected)
    || accounts.find((item) => String(item?.label || "").trim() === expected)
    || null;
}

function syncYoutubeSelectedAccountFromChannel(config) {
  const channel = getSelectedWorkspaceChannel(config || state.configData || defaultConfigData());
  const accountId = normalizeAccountId(channel?.youtube_account_id || "");
  state.youtubeSelectedAccountId = accountId;
  return accountId;
}

function youtubeAccountDisplayName(account) {
  if (!account) return "";
  const slot = String(account.label || account.id || "").trim();
  const channelTitle = String(account.channel_title || "").trim();
  const channelHandle = String(account.channel_handle || "").trim();
  const youtubeName = channelTitle || channelHandle;
  if (slot && youtubeName && slot !== youtubeName) {
    return `${slot} / ${youtubeName}`;
  }
  return youtubeName || slot || "Unnamed account";
}

function youtubeSubscriberText(account) {
  if (!account) return "";
  if (account.hidden_subscriber_count) return "Subscribers hidden";
  const raw = String(account.subscriber_count || "").trim();
  if (!raw) return "";
  const count = Number(raw);
  if (!Number.isFinite(count)) return "";
  const formatted = new Intl.NumberFormat(undefined, {
    notation: count >= 1000 ? "compact" : "standard",
    maximumFractionDigits: count >= 1000 ? 1 : 0,
  }).format(count);
  return `${formatted} subscribers`;
}

function getChannelTasks(tasks, channelName) {
  const list = Array.isArray(tasks) ? tasks : [];
  if (!channelName) return [];
  return list.filter((task) => taskChannelName(task) === String(channelName));
}

function getChannelStreams(streams, channelName) {
  if (!channelName) return null;
  return streams?.[channelName] || null;
}

function getChannelEvents(events, channelName) {
  const list = Array.isArray(events) ? events : [];
  if (!channelName) return [];
  return list.filter((event) => eventChannelName(event) === String(channelName));
}

function setWorkspaceSelectedChannel(channelName) {
  state.workspace.selectedChannelName = String(channelName || "");
  try {
    window.localStorage.setItem(workspaceStorageKey(), state.workspace.selectedChannelName);
  } catch {
    // Ignore storage write failures in restricted contexts.
  }
}

function readWorkspaceSelectedChannel() {
  try {
    return String(window.localStorage.getItem(workspaceStorageKey()) || "");
  } catch {
    return "";
  }
}

function ensureWorkspaceChannelSelection(payload) {
  const channels = Array.isArray(payload?.channels) ? payload.channels : [];
  if (!channels.length) {
    state.workspace.selectedChannelName = "";
    return;
  }
  const preferred = state.workspace.selectedChannelName || readWorkspaceSelectedChannel();
  const selected = getSelectedChannel({ channels }, preferred);
  if (!selected) {
    state.workspace.selectedChannelName = "";
    return;
  }
  if (state.workspace.selectedChannelName !== selected.name) {
    setWorkspaceSelectedChannel(selected.name);
  }
}

function syncActiveSettingsChannelFromWorkspace(render = false) {
  const config = state.configData || defaultConfigData();
  const channels = Array.isArray(config.channels) ? config.channels : [];
  if (!channels.length) return;
  const targetName = String(state.workspace.selectedChannelName || "").trim();
  if (!targetName) return;
  const index = channels.findIndex((channel) => String(channel?.name || "") === targetName);
  if (index < 0) return;
  state.activeSettingsChannelIndex = index;
  if (render) {
    renderSettingsForms();
  }
}

function makeRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function logLocalActivityEvent(eventType, message, details = {}, status = "info") {
  const event = {
    id: `local-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    event_type: eventType,
    channel_name: details.channel || details.channel_name || "",
    created_at: new Date().toISOString(),
    details: { ...details, status, local: true, message },
  };
  state.localActivityEvents.unshift(event);
  if (state.localActivityEvents.length > 80) {
    state.localActivityEvents.length = 80;
  }
  if ($("tasks")) {
    renderTasks(state.status?.tasks || [], state.status?.activity_events || []);
  }
}

function channelNameFromApiRequest(path, options = {}) {
  try {
    const url = new URL(String(path || ""), window.location.origin);
    const queryChannel = String(url.searchParams.get("channel") || "").trim();
    if (queryChannel) return queryChannel;
  } catch {
    // Keep logging best-effort; malformed local paths should not hide the original error.
  }
  try {
    const body = typeof options.body === "string" ? JSON.parse(options.body) : null;
    const bodyChannel = String(body?.channel || "").trim();
    if (bodyChannel) return bodyChannel;
  } catch {
    // Ignore non-JSON bodies.
  }
  return "";
}

async function api(path, options = {}) {
  const {
    action = "",
    headers: customHeaders = {},
    ...fetchOptions
  } = options;
  const requestId = makeRequestId();
  let response;
  try {
    response = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
        ...(action ? { "X-Client-Action": action } : {}),
        ...customHeaders,
      },
      ...fetchOptions,
    });
  } catch (error) {
    const channelName = channelNameFromApiRequest(path, fetchOptions);
    logLocalActivityEvent(
      "api_request",
      `Network error while calling ${path}`,
      { path, request_id: requestId, client_action: action, channel_name: channelName, error: String(error?.message || error) },
      "error"
    );
    throw error;
  }
  const responseRequestId = String(response.headers.get("X-Request-ID") || requestId);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    payload.__request_id = responseRequestId;
  }
  if (!response.ok) {
    const message = payload?.error || payload || response.statusText;
    const channelName = channelNameFromApiRequest(path, fetchOptions);
    logLocalActivityEvent(
      "api_request",
      `API request failed: ${path}`,
      {
        path,
        request_id: responseRequestId,
        client_action: action,
        channel_name: channelName,
        status_code: response.status,
        error_message: String(message || ""),
      },
      "error"
    );
    throw new Error(`${message} [Request ID: ${responseRequestId}]`);
  }
  return payload;
}

async function refresh() {
  const payload = await api(`/api/status?config=${encodeURIComponent(state.config)}`);
  const visiblePayload = applyPendingChannelRemovalToStatus(payload);
  state.status = visiblePayload;

  const previousConfig = state.config;
  if (!visiblePayload.configs.includes(state.config)) {
    state.config = visiblePayload.configs.includes("config.json") ? "config.json" : visiblePayload.configs[0] || "config.json";
  }
  if (previousConfig !== state.config) {
    hydrateYoutubeStatusFromCache(true);
  } else if (!state.youtubeStatus) {
    hydrateYoutubeStatusFromCache();
  }

  renderConfigSelect(visiblePayload.configs);
  state.appVersion = visiblePayload.app_version || state.appVersion;
  renderAppVersion();
  ensureWorkspaceChannelSelection(visiblePayload);
  renderStatus(visiblePayload);
  renderChannels(visiblePayload);
  renderChannelWorkspace(visiblePayload);
  renderPreview(visiblePayload.streams);
  renderLiveHistory(visiblePayload.stream_history || []);
  renderTasks(visiblePayload.tasks, visiblePayload.activity_events || []);
  renderLogs(visiblePayload.streams);
  const runningSettingsTask = visiblePayload.tasks.some((task) => ["normalize", "validate", "test-stream"].includes(task.name) && task.running);
  if (state.activeTab === "settings" && (runningSettingsTask || state.hadRunningSettingsTask)) {
    renderSettingsForms();
  }
  state.hadRunningSettingsTask = runningSettingsTask;
  renderUpdateBanner();
  writeDashboardCache(payload);
  markBootReady();
}

function applyPendingChannelRemovalToStatus(payload) {
  const removedName = String(state.removedChannelUndo?.channel?.name || "").trim();
  if (!removedName || !payload || typeof payload !== "object") return payload;

  const channels = Array.isArray(payload.channels)
    ? payload.channels.filter((channel) => String(channel?.name || "").trim() !== removedName)
    : [];
  const streams = { ...(payload.streams || {}) };
  delete streams[removedName];
  const tasks = Array.isArray(payload.tasks)
    ? payload.tasks.filter((task) => String(task?.channel || task?.progress?.channel || "").trim() !== removedName)
    : [];

  return {
    ...payload,
    channels,
    streams,
    tasks,
  };
}

function markBootReady() {
  document.body.classList.remove("boot-loading");
}

function readDashboardCache() {
  try {
    const text = window.localStorage.getItem(DASHBOARD_CACHE_KEY);
    if (!text) return null;
    const cached = JSON.parse(text);
    if (!cached || typeof cached !== "object" || !cached.payload) return null;
    return cached.payload;
  } catch {
    return null;
  }
}

function writeDashboardCache(payload) {
  if (!payload || typeof payload !== "object") return;
  const slimPayload = {
    ...payload,
    tasks: [],
    activity_events: [],
  };
  try {
    window.localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
      saved_at: new Date().toISOString(),
      payload: slimPayload,
    }));
  } catch {
    // Ignore cache quota/storage failures; this only improves first paint.
  }
}

function readYoutubeStatusCache() {
  try {
    const text = window.localStorage.getItem(youtubeStatusStorageKey());
    if (!text) return null;
    const cached = JSON.parse(text);
    const payload = cached?.payload;
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.accounts)) return null;
    return payload;
  } catch {
    return null;
  }
}

function writeYoutubeStatusCache(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.accounts)) return;
  try {
    window.localStorage.setItem(youtubeStatusStorageKey(), JSON.stringify({
      saved_at: new Date().toISOString(),
      payload,
    }));
  } catch {
    // Ignore cache quota/storage failures; this only improves first paint.
  }
}

function hydrateYoutubeStatusFromCache(clearOnMiss = false) {
  const payload = readYoutubeStatusCache();
  if (!payload) {
    if (clearOnMiss) {
      state.youtubeStatus = null;
    }
    return false;
  }
  state.youtubeStatus = payload;
  return true;
}

function renderCachedDashboard() {
  const payload = readDashboardCache();
  if (!payload) return false;
  state.status = payload;
  if (!state.configData) {
    state.configData = defaultConfigData();
  }
  if (payload.config) {
    state.config = payload.config;
  }
  hydrateYoutubeStatusFromCache();
  ensureWorkspaceChannelSelection(payload);
  renderConfigSelect(payload.configs || []);
  state.appVersion = payload.app_version || state.appVersion;
  renderAppVersion();
  renderStatus(payload);
  renderChannels(payload);
  renderChannelWorkspace(payload);
  renderPreview(payload.streams || {});
  renderLiveHistory(payload.stream_history || []);
  renderTasks([], []);
  renderLogs(payload.streams || {});
  markBootReady();
  return true;
}

async function initDesktopIntegration() {
  const bridge = desktopBridge();
  const closeUiButton = $("closeUiOnly");
  const stopAndExitButton = $("stopAndExit");
  const canCloseUi = typeof bridge?.requestQuit === "function";
  const canStopAndExit = typeof bridge?.requestStopStreamsAndExit === "function";
  if (closeUiButton) closeUiButton.hidden = !canCloseUi;
  if (stopAndExitButton) stopAndExitButton.hidden = !canStopAndExit;
  if (!bridge) return;

  if (typeof bridge.getUpdateStatus === "function") {
    try {
      state.updateStatus = await bridge.getUpdateStatus();
      renderUpdateBanner();
    } catch (_error) {
      // Keep UI usable if desktop bridge is unavailable.
    }
  }

  if (typeof bridge.getAppVersion === "function") {
    try {
      const version = await bridge.getAppVersion();
      if (version) {
        state.appVersion = version;
        renderAppVersion();
      }
    } catch (_error) {
      // Keep UI usable if desktop bridge is unavailable.
    }
  }

  if (typeof bridge.onUpdateStatus === "function") {
    bridge.onUpdateStatus((payload) => {
      state.updateStatus = payload || null;
      renderUpdateBanner();
    });
  }
}

function renderAppVersion() {
  const node = $("appVersionLabel");
  if (!node) return;
  const version = String(state.appVersion || "").trim();
  node.textContent = version ? `v${version}` : "v-";
}

async function closeUiOnly() {
  const bridge = desktopBridge();
  if (!bridge || typeof bridge.requestQuit !== "function") {
    toast("Desktop close action is unavailable.");
    return;
  }
  await bridge.requestQuit();
}

async function stopStreamsAndExit() {
  const bridge = desktopBridge();
  if (!bridge || typeof bridge.requestStopStreamsAndExit !== "function") {
    toast("Stop and exit action is unavailable.");
    return;
  }
  const response = await bridge.requestStopStreamsAndExit();
  if (!response?.ok) {
    toast("Could not stop streams and exit.");
  }
}

function renderUpdateBanner() {
  const banner = $("updateBanner");
  const textNode = $("updateBannerText");
  const restartButton = $("restartToUpdate");
  if (!banner || !textNode) return;

  const update = state.updateStatus || {};
  const status = String(update.status || "idle");
  const version = update.version ? ` ${update.version}` : "";
  const percent = Number.isFinite(update.percent) ? Math.max(0, Math.min(100, Math.round(update.percent))) : 0;

  let show = false;
  let ready = false;
  let hasError = false;
  let message = "";

  if (status === "available") {
    show = true;
    message = `Update${version} is available. Downloading in the background.`;
  } else if (status === "downloading") {
    show = true;
    message = `Update${version} is downloading in the background (${percent}%).`;
  } else if (status === "downloaded") {
    show = true;
    ready = true;
    message = `Update${version} is ready and will install automatically on your next restart.`;
  } else if (status === "error") {
    show = true;
    hasError = true;
    message = `Update check failed${update.message ? `: ${update.message}` : "."}`;
  }

  if (!show) {
    banner.classList.add("hidden");
    banner.classList.remove("ready", "error");
    if (restartButton) restartButton.hidden = true;
    return;
  }

  banner.classList.remove("hidden");
  banner.classList.toggle("ready", ready);
  banner.classList.toggle("error", hasError);
  textNode.textContent = message;
  if (restartButton) {
    restartButton.hidden = !ready || typeof desktopBridge()?.requestQuit !== "function";
  }
}

function renderConfigSelect(configs) {
  const select = $("configSelect");
  if (!select) return;
  const existing = new Set(configs);
  if (!existing.has(state.config)) configs = [state.config, ...configs];
  select.innerHTML = configs.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  select.value = state.config;
}

function renderStatus(payload) {
  const running = Object.values(payload.streams).filter((stream) => stream.running).length;
  const taskRunning = payload.tasks.some((task) => task.running);

  $("serverState").textContent = payload.config_exists ? `${running} live stream${running === 1 ? "" : "s"}` : "Config needed";
  const startAllButton = $("startAll");
  if (startAllButton) {
    const anyRunning = running > 0;
    startAllButton.textContent = anyRunning ? "Stop all streams" : "Start All Streams";
    startAllButton.classList.toggle("success", !anyRunning);
    startAllButton.classList.toggle("danger", anyRunning);
    startAllButton.setAttribute("aria-label", anyRunning ? "Stop all streams" : "Start All Streams");
  }
  $("taskState").textContent = taskRunning ? "Working" : "Idle";
  $("channelCount").textContent = `${payload.channels.length} channel${payload.channels.length === 1 ? "" : "s"}`;
  const activeConfigLabel = $("activeConfigLabel");
  if (activeConfigLabel) {
    activeConfigLabel.textContent = payload.config_exists ? payload.config : "Create a config in Settings";
  }

  const notice = $("autoNotice");
  if (!payload.config_exists) {
    notice.textContent = "Create a config in Settings, then prepare each channel from Normalize to YouTube before starting streams.";
    notice.className = "command-notice warn";
  } else {
    notice.textContent = "Start all streams after videos are normalized and every enabled channel has a YouTube account or manual stream key ready.";
    notice.className = "command-notice";
  }

  const verifyNode = $("workspaceGlobalVerifySummary");
  if (verifyNode) {
    const checks = Array.isArray(state.youtubeKeyChecks?.checks) ? state.youtubeKeyChecks.checks : [];
    if (!checks.length) {
      verifyNode.textContent = "Global verify summary: not run yet.";
      verifyNode.className = "badge";
    } else {
      const enforceable = checks.filter((item) => String(item?.status || "") !== "missing_account");
      const matched = enforceable.filter((item) => Boolean(item?.ok)).length;
      verifyNode.textContent = `Global verify: ${matched}/${enforceable.length || 0} mapped channels matched`;
      verifyNode.className = enforceable.length && matched === enforceable.length ? "badge live" : "badge warn";
    }
  }
}

function renderChannels(payload) {
  const legacyPanel = $("legacyChannelsPanel");
  const workspacePanel = $("channelWorkspacePanel");
  const workspaceRail = $("channelWorkspaceRail");
  const workspaceEnabled = isChannelWorkspaceEnabled();
  if (legacyPanel) {
    legacyPanel.classList.toggle("hidden", workspaceEnabled || !areLegacyTabsEnabled());
  }
  if (workspacePanel) {
    workspacePanel.classList.toggle("hidden", !workspaceEnabled);
  }
  if (workspaceRail) {
    const hasChannels = Array.isArray(payload?.channels) && payload.channels.length > 0;
    const showRail = Boolean(payload?.config_exists) && hasChannels;
    workspaceRail.classList.toggle("hidden", !showRail);
  }
  if (!payload.config_exists) {
    const channelsNode = $("channels");
    if (channelsNode) {
      channelsNode.innerHTML = `<div class="card">No config found yet. Open <strong>Settings</strong> and create one to begin.</div>`;
    }
    return;
  }

  const channelsNode = $("channels");
  if (!channelsNode) return;
  channelsNode.innerHTML = payload.channels.map((channel) => {
    const stream = payload.streams[channel.name];
    const live = stream?.running;
    const key = streamKeyLabel(channel);
    const autoReady = channel.youtube_auto_start && channel.youtube_auto_stop;
    const autoText = autoReady ? "YouTube auto on" : "YouTube auto needs check";
    const studio = channel.youtube_studio_url ? `<a class="studio-link" href="${escapeHtml(channel.youtube_studio_url)}" target="_blank">Open Studio</a>` : "";
    return `
      <article class="card">
        <div class="card-head">
          <div class="channel-name">${escapeHtml(channel.name)}</div>
          <span class="badge ${live ? "live" : ""}">${live ? "Live" : channel.enabled ? "Ready" : "Disabled"}</span>
        </div>
        <div class="meta">${channel.raw_playlist_count || 0} raw item${channel.raw_playlist_count === 1 ? "" : "s"} - ${channel.normalized_count || 0} normalized item${channel.normalized_count === 1 ? "" : "s"} - ${channel.playlist_count} playlist override${channel.playlist_count === 1 ? "" : "s"} - ${escapeHtml(key)}</div>
        <div class="meta">
          <span class="badge ${autoReady ? "live" : "warn"}">${escapeHtml(autoText)}</span>
          ${studio}
        </div>
        <div class="mini-actions">
          <button class="pill success" onclick="startStream('${escapeJs(channel.name)}')">Start</button>
          <button class="pill" onclick="startTask('test-stream', '${escapeJs(channel.name)}', false)">Test Stream</button>
          <button class="pill danger" onclick="stopStream('${escapeJs(channel.name)}')">Stop</button>
          <button class="pill ghost" onclick="showTab('settings')">Settings</button>
        </div>
      </article>
    `;
  }).join("");
}

function normalizeWorkspaceRoute(routeName) {
  const route = String(routeName || "overview").trim();
  const aliases = {
    control: "overview",
    dashboard: "overview",
    normalize: "encoder",
    live: "youtube",
    liveHistory: "history",
    troubleshooting: "troubleshoot",
  };
  const normalized = aliases[route] || route;
  return WORKSPACE_ROUTES.includes(normalized) ? normalized : "overview";
}

function workspaceRouteLabel(routeName) {
  return {
    overview: "Overview",
    folders: "Folders",
    encoder: "Encoder",
    youtube: "YouTube",
    history: "History",
    troubleshoot: "Troubleshoot",
  }[normalizeWorkspaceRoute(routeName)] || "Overview";
}

function getChannelHealthViewModel(channel, payload) {
  const channelName = String(channel?.name || "").trim();
  const stream = getChannelStreams(payload?.streams || {}, channelName);
  const linked = getLinkedAccountForChannel(state.youtubeStatus, channel);
  const checks = Array.isArray(state.youtubeKeyChecks?.checks) ? state.youtubeKeyChecks.checks : [];
  const check = checks.find((item) => String(item?.channel || "") === channelName);
  const connected = Boolean(linked?.connected);
  const mapped = Boolean(normalizeAccountId(channel?.youtube_account_id || ""));
  const streamRunning = Boolean(stream?.running);
  const rawCount = Number(channel?.raw_playlist_count || (Array.isArray(channel?.raw_playlist) ? channel.raw_playlist.length : 0));
  const normalizedCount = Number(channel?.normalized_count || 0);
  const hasManualKey = Boolean(String(channel?.stream_key_env || "").trim());
  const ready = Boolean(channel?.enabled !== false && (mapped || hasManualKey) && rawCount >= 0);
  return {
    name: channelName,
    enabled: channel?.enabled !== false,
    connected,
    mapped,
    ready,
    streamRunning,
    streamState: streamRunning ? "Live" : "Idle",
    verificationState: check ? (check.ok ? "Verified" : "Needs review") : "Not verified",
    linkedAccountLabel: linked?.label || linked?.id || (mapped ? normalizeAccountId(channel?.youtube_account_id || "") : "Not linked"),
    hasManualKey,
    rawCount,
    normalizedCount,
    statusTone: streamRunning || connected ? "live" : ready ? "" : "warn",
  };
}

function getChannelReadinessViewModel(channel, payload) {
  const health = getChannelHealthViewModel(channel, payload);
  const defaults = state.configData?.defaults || {};
  return [
    {
      label: "YouTube account",
      value: health.mapped ? health.linkedAccountLabel : "Not linked",
      status: health.connected ? "Connected" : health.mapped ? "Reconnect" : "Link account",
      tone: health.connected ? "live" : "warn",
      routeTarget: "youtube",
    },
    {
      label: "Stream key",
      value: health.hasManualKey ? streamKeyLabel(channel) : "Missing",
      status: health.hasManualKey ? "Present" : "Needed",
      tone: health.hasManualKey ? "" : "warn",
      routeTarget: "youtube",
    },
    {
      label: "Encoder preset",
      value: `${channel?.normalize_profile?.width || state.configData?.normalize_profile?.width || 1920}p source profile`,
      status: "Ready",
      tone: "",
      routeTarget: "encoder",
    },
    {
      label: "Folders",
      value: `${defaults.raw_dir || "Raw Videos"} -> ${defaults.normalized_dir || "Go Live"}`,
      status: "Configured",
      tone: "",
      routeTarget: "folders",
    },
  ];
}

function getRecentActivityViewModel(channelName, payload) {
  const sessions = Array.isArray(payload?.stream_history) ? payload.stream_history : [];
  const events = getChannelEvents(payload?.activity_events || [], channelName);
  const tasks = getChannelTasks(payload?.tasks || [], channelName);
  const latestSession = sessions.find((session) => String(session?.channel_name || "") === channelName);
  const items = [];
  if (latestSession) {
    items.push({
      title: latestSession.is_active ? "Live session in progress" : "Latest live session",
      detail: `${formatSessionDateParts(latestSession.started_at).date} | ${durationText(sessionDurationSeconds(latestSession))}`,
    });
  }
  tasks.slice(0, 2).forEach((task) => {
    items.push({
      title: taskTitle(task.name),
      detail: task.running ? "Running now" : Number(task.returncode) === 0 ? "Finished successfully" : "Needs review",
    });
  });
  events.slice(0, 2).forEach((event) => {
    items.push({
      title: String(event?.event_type || "Activity").replaceAll("_", " "),
      detail: formatIsoTimestamp(event?.created_at),
    });
  });
  return items.slice(0, 4);
}

function renderWorkspaceChannelList(payload) {
  const list = $("workspaceChannelList");
  if (!list) return;
  const channels = Array.isArray(payload?.channels) ? payload.channels : [];
  const searchText = String(state.workspace.channelSearch || "").trim().toLowerCase();
  const countBadge = $("workspaceChannelCountBadge");
  if (countBadge) {
    countBadge.textContent = `${channels.length} channel${channels.length === 1 ? "" : "s"}`;
  }
  if (!channels.length) {
    list.innerHTML = `<div class="meta">No channels configured yet.</div>`;
    return;
  }

  const current = getSelectedChannel({ channels }, state.workspace.selectedChannelName);
  if (current && current.name !== state.workspace.selectedChannelName) {
    setWorkspaceSelectedChannel(current.name);
  }
  const checks = Array.isArray(state.youtubeKeyChecks?.checks) ? state.youtubeKeyChecks.checks : [];
  const visibleChannels = channels.filter((channel) => {
    if (!searchText) return true;
    return String(channel?.name || "").toLowerCase().includes(searchText);
  });
  if (!visibleChannels.length) {
    list.innerHTML = `<div class="meta">No channels match that search.</div>`;
    return;
  }
  list.innerHTML = visibleChannels.map((statusChannel) => {
    const channel = channelWithConfigVisuals(statusChannel);
    const channelName = String(channel?.name || "").trim();
    const stream = payload?.streams?.[channel.name];
    const linked = getLinkedAccountForChannel(state.youtubeStatus, channel);
    const isConnected = Boolean(linked?.connected);
    const connectionText = isConnected ? "Connected" : "Disconnected";
    const connectionClass = isConnected ? "badge live" : "badge warn";
    const liveText = stream?.running ? "Live" : "Ready";
    const liveClass = stream?.running ? "badge live" : "badge";
    const logoText = channelLogoText(channel);
    const pictureSrc = channelPictureSrc(channel);
    const check = checks.find((item) => String(item?.channel || "") === String(channel.name));
    const hasMismatch = check && !check.ok;
    const isSelected = state.workspace.selectedChannelName === channel.name;
    const cardClass = [
      "workspace-channel-item",
      isSelected ? "active" : "",
      hasMismatch ? "has-warning" : "",
    ].join(" ").trim();
    const nameLength = channelName.length;
    let titleSizeClass = "size-md";
    if (nameLength >= 24) {
      titleSizeClass = "size-xs";
    } else if (nameLength >= 19) {
      titleSizeClass = "size-sm";
    }
    return `
      <div class="workspace-channel-card ${isSelected ? "is-active" : ""} ${hasMismatch ? "has-warning" : ""}" data-channel-name="${escapeAttr(channel.name)}">
      <button class="${cardClass}" type="button" onclick="switchWorkspaceChannel('${escapeJs(channel.name)}')" ${isSelected ? 'aria-current="true"' : ""}>
        <span class="workspace-channel-logo" aria-hidden="true">${pictureSrc ? `<img src="${escapeAttr(pictureSrc)}" alt="">` : escapeHtml(logoText)}</span>
        <div class="workspace-channel-body">
          <div class="workspace-channel-item-head">
            <span class="channel-name workspace-channel-title ${titleSizeClass}" title="${escapeAttr(channelName)}">${escapeHtml(channelName)}</span>
          </div>
          <div class="workspace-channel-item-meta">
            <span class="sidebar-status-dot ${isConnected ? "is-connected" : ""}" aria-hidden="true"></span>
            <span>${escapeHtml(connectionText)} · ${escapeHtml(liveText)}</span>
          </div>
        </div>
      </button>
        <button class="workspace-channel-edit-button" type="button" onclick="openWorkspaceChannelEdit('${escapeJs(channel.name)}')" aria-label="Edit ${escapeAttr(channelName)}">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
          </svg>
        </button>
      </div>
    `;
  }).join("");
}

function channelLogoText(channel) {
  const icon = String(channel?.icon || "").trim();
  if (icon) return Array.from(icon).slice(0, 2).join("");
  return String(channel?.name || "?").trim().charAt(0).toUpperCase() || "?";
}

function channelWithConfigVisuals(channel) {
  const channelName = String(channel?.name || "").trim();
  const configChannels = Array.isArray(state.configData?.channels) ? state.configData.channels : [];
  const configChannel = configChannels.find((item) => String(item?.name || "").trim() === channelName);
  if (!configChannel) return channel;
  return {
    ...channel,
    icon: configChannel.icon || channel?.icon,
    picture: configChannel.picture || configChannel.picture_data_url || channel?.picture,
  };
}

function channelPictureSrc(channel) {
  const picture = String(channel?.picture || channel?.picture_data_url || "").trim();
  if (!picture) return "";
  if (picture.startsWith("data:image/") || picture.startsWith("http://") || picture.startsWith("https://")) {
    return picture;
  }
  return "";
}

function openWorkspaceChannelEdit(channelName) {
  const targetName = String(channelName || "").trim();
  const channels = Array.isArray(state.configData?.channels) ? state.configData.channels : [];
  const channel = channels.find((item) => String(item?.name || "").trim() === targetName);
  if (!channel) {
    toast(`Unknown channel: ${targetName}`);
    return;
  }
  state.workspace.editingChannelName = targetName;
  state.workspace.editingChannelPicture = channelPictureSrc(channel);
  state.workspace.editingChannelImage = null;
  state.workspace.editingChannelPictureType = state.workspace.editingChannelPicture.startsWith("data:image/png") ? "image/png" : "image/jpeg";
  state.workspace.editingChannelCrop = { x: 0, y: 0 };
  state.workspace.editingChannelDrag = null;
  const nameInput = $("workspaceChannelEditName");
  const fileInput = $("workspaceChannelEditPicture");
  const title = $("workspaceChannelEditTitle");
  if (title) title.textContent = `Edit ${targetName}`;
  if (nameInput) nameInput.value = targetName;
  if (fileInput) fileInput.value = "";
  syncWorkspaceChannelEditPreview();
  $("workspaceChannelEditDialog")?.classList.remove("hidden");
  window.setTimeout(() => $("workspaceChannelEditName")?.focus(), 0);
}

function closeWorkspaceChannelEdit() {
  state.workspace.editingChannelName = "";
  state.workspace.editingChannelPicture = "";
  state.workspace.editingChannelImage = null;
  state.workspace.editingChannelCrop = { x: 0, y: 0 };
  state.workspace.editingChannelDrag = null;
  $("workspaceChannelEditDialog")?.classList.add("hidden");
}

function handleWorkspaceChannelEditKey(event, channelName) {
  if (event.key === "Escape") {
    closeWorkspaceChannelEdit();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    saveWorkspaceChannelEdit(channelName).catch((error) => toast(error.message));
  }
}

function syncWorkspaceChannelEditPreview() {
  const preview = $("workspaceChannelPicturePreview");
  if (!preview) return;
  const picture = state.workspace.editingChannelImage
    ? String(state.workspace.editingChannelPicture || renderWorkspaceChannelCroppedPicture())
    : String(state.workspace.editingChannelPicture || "").trim();
  const name = String($("workspaceChannelEditName")?.value || state.workspace.editingChannelName || "?").trim();
  preview.classList.toggle("is-draggable", Boolean(state.workspace.editingChannelImage));
  if (picture) {
    preview.innerHTML = `<img src="${escapeAttr(picture)}" alt="">`;
  } else {
    preview.textContent = name.charAt(0).toUpperCase() || "?";
  }
}

function loadWorkspaceChannelImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || "").startsWith("image/")) {
      reject(new Error("Choose an image file for the channel picture."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Could not load the selected image."));
      image.onload = () => {
        const isPng = String(file.type || "").toLowerCase() === "image/png"
          || String(file.name || "").toLowerCase().endsWith(".png");
        resolve({
          src: String(reader.result || ""),
          image,
          width: image.naturalWidth || image.width || 1,
          height: image.naturalHeight || image.height || 1,
          type: isPng ? "image/png" : "image/jpeg",
        });
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function cropBoundsForImage(imageState, outputSize = 256) {
  const width = Number(imageState?.width || 1);
  const height = Number(imageState?.height || 1);
  const scale = Math.max(outputSize / width, outputSize / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  return {
    drawWidth,
    drawHeight,
    maxX: Math.max(0, (drawWidth - outputSize) / 2),
    maxY: Math.max(0, (drawHeight - outputSize) / 2),
  };
}

function clampWorkspaceChannelCrop() {
  const imageState = state.workspace.editingChannelImage;
  if (!imageState) return;
  const bounds = cropBoundsForImage(imageState);
  const crop = state.workspace.editingChannelCrop || { x: 0, y: 0 };
  state.workspace.editingChannelCrop = {
    x: Math.max(-bounds.maxX, Math.min(bounds.maxX, Number(crop.x || 0))),
    y: Math.max(-bounds.maxY, Math.min(bounds.maxY, Number(crop.y || 0))),
  };
}

function renderWorkspaceChannelCroppedPicture() {
  const imageState = state.workspace.editingChannelImage;
  if (!imageState) return String(state.workspace.editingChannelPicture || "");
  clampWorkspaceChannelCrop();
  const outputSize = 256;
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d");
  const outputType = state.workspace.editingChannelPictureType === "image/png" ? "image/png" : "image/jpeg";
  if (outputType !== "image/png") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, outputSize, outputSize);
  }
  const bounds = cropBoundsForImage(imageState, outputSize);
  const crop = state.workspace.editingChannelCrop || { x: 0, y: 0 };
  const drawX = (outputSize - bounds.drawWidth) / 2 + Number(crop.x || 0);
  const drawY = (outputSize - bounds.drawHeight) / 2 + Number(crop.y || 0);
  context.drawImage(imageState.image, drawX, drawY, bounds.drawWidth, bounds.drawHeight);
  return outputType === "image/png"
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", 0.9);
}

async function handleWorkspaceChannelPictureChange(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const imageState = await loadWorkspaceChannelImage(file);
  state.workspace.editingChannelImage = imageState;
  state.workspace.editingChannelPictureType = imageState.type;
  state.workspace.editingChannelCrop = { x: 0, y: 0 };
  state.workspace.editingChannelPicture = renderWorkspaceChannelCroppedPicture();
  syncWorkspaceChannelEditPreview();
}

function clearWorkspaceChannelPicture() {
  state.workspace.editingChannelPicture = "";
  state.workspace.editingChannelImage = null;
  state.workspace.editingChannelCrop = { x: 0, y: 0 };
  const fileInput = $("workspaceChannelEditPicture");
  if (fileInput) fileInput.value = "";
  syncWorkspaceChannelEditPreview();
}

function startWorkspaceChannelPictureDrag(event) {
  if (!state.workspace.editingChannelImage) return;
  event.preventDefault();
  const preview = $("workspaceChannelPicturePreview");
  const rect = preview?.getBoundingClientRect();
  if (!rect?.width) return;
  state.workspace.editingChannelDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    cropX: Number(state.workspace.editingChannelCrop?.x || 0),
    cropY: Number(state.workspace.editingChannelCrop?.y || 0),
    pixelsPerPreviewPixel: 256 / rect.width,
  };
  preview?.setPointerCapture?.(event.pointerId);
}

function moveWorkspaceChannelPictureDrag(event) {
  const drag = state.workspace.editingChannelDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const scale = Number(drag.pixelsPerPreviewPixel || 1);
  state.workspace.editingChannelCrop = {
    x: Number(drag.cropX || 0) + (event.clientX - drag.startX) * scale,
    y: Number(drag.cropY || 0) + (event.clientY - drag.startY) * scale,
  };
  state.workspace.editingChannelPicture = renderWorkspaceChannelCroppedPicture();
  syncWorkspaceChannelEditPreview();
}

function stopWorkspaceChannelPictureDrag(event) {
  const drag = state.workspace.editingChannelDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  state.workspace.editingChannelDrag = null;
  $("workspaceChannelPicturePreview")?.releasePointerCapture?.(event.pointerId);
}

async function saveWorkspaceChannelEdit(channelName = "") {
  const oldName = String(channelName || state.workspace.editingChannelName || "").trim();
  const nameInput = $("workspaceChannelEditName");
  const nextName = String(nameInput?.value || "").trim();
  const nextPicture = String(
    state.workspace.editingChannelImage
      ? renderWorkspaceChannelCroppedPicture()
      : state.workspace.editingChannelPicture || ""
  ).trim();
  if (!oldName) throw new Error("Select a channel to edit.");
  if (!nextName) throw new Error("Channel name is required.");

  const data = collectSettingsData();
  const channels = Array.isArray(data.channels) ? data.channels : [];
  const channelIndex = channels.findIndex((channel) => String(channel?.name || "").trim() === oldName);
  if (channelIndex < 0) throw new Error(`Unknown channel: ${oldName}`);
  const duplicate = channels.some((channel, index) => (
    index !== channelIndex && String(channel?.name || "").trim() === nextName
  ));
  if (duplicate) throw new Error(`A channel named "${nextName}" already exists.`);

  channels[channelIndex].name = nextName;
  if (nextPicture) {
    channels[channelIndex].picture = nextPicture;
  } else {
    delete channels[channelIndex].picture;
    delete channels[channelIndex].picture_data_url;
  }
  data.channels = channels;

  if (state.workspace.selectedChannelName === oldName) {
    setWorkspaceSelectedChannel(nextName);
  }
  state.workspace.editingChannelName = "";
  state.workspace.editingChannelPicture = "";
  state.workspace.editingChannelImage = null;
  state.workspace.editingChannelCrop = { x: 0, y: 0 };
  state.workspace.editingChannelDrag = null;
  $("workspaceChannelEditDialog")?.classList.add("hidden");
  state.configData = data;
  syncConfigEditor();
  renderWorkspaceChannelList(state.status || {});
  await saveConfigData(data);
  toast("Channel updated.");
}

function renderWorkspaceHeader(payload, channel) {
  const route = normalizeWorkspaceRoute(state.workspace.activeRoute);
  const routeLabel = workspaceRouteLabel(route);
  const channelName = String(channel?.name || "No channel selected").trim();
  const title = route === "overview" ? channelName : `${channelName} / ${routeLabel}`;
  const breadcrumb = channel ? `Channel / ${channelName}` : "Channel / None";
  const subtitles = {
    overview: "Controls and status for this channel only.",
    folders: "Folder paths used by this selected channel.",
    encoder: "Source videos and encoder profile for this channel.",
    youtube: "Account, broadcast, stream key, and scheduling for this channel.",
    history: "Recorded live sessions for this channel.",
    troubleshoot: "Activity and stream logs for this channel.",
  };
  const breadcrumbNode = $("workspaceBreadcrumb");
  const titleNode = $("workspacePageTitle");
  const legacyNameNode = $("workspaceChannelName");
  const subtitleNode = $("workspacePageSubtitle");
  const actionsNode = $("workspaceHeaderActions");
  if (breadcrumbNode) breadcrumbNode.textContent = route === "overview" ? breadcrumb : `${channelName} / ${routeLabel}`;
  if (titleNode) titleNode.textContent = title;
  if (legacyNameNode) legacyNameNode.textContent = channelName;
  if (subtitleNode) subtitleNode.textContent = subtitles[route] || subtitles.overview;
  if (!actionsNode) return;
  if (!channel) {
    actionsNode.innerHTML = `<button class="pill primary" type="button" onclick="addChannel()">Add Channel</button>`;
    return;
  }
  const escapedName = escapeJs(channel.name);
  const saveButton = route === "overview" ? "" : `<button class="pill primary" type="button" onclick="saveSettings().catch((error) => toast(error.message))">Save settings</button>`;
  actionsNode.innerHTML = `
    <button class="pill ghost" type="button" onclick="verifyYoutubeChannelKeys('${escapedName}').catch((error) => toast(error.message))">Verify channel</button>
    <button class="pill success" type="button" onclick="startStream('${escapedName}').catch((error) => toast(error.message))">Start Stream</button>
    <button class="pill danger" type="button" onclick="stopStream('${escapedName}').catch((error) => toast(error.message))">Stop Stream</button>
    ${saveButton}
  `;
}

function renderWorkspaceStatusBand(payload, channel) {
  const connectionNode = $("workspaceStatusConnection");
  const readinessNode = $("workspaceStatusReadiness");
  const streamNode = $("workspaceStatusStream");
  const accountNode = $("workspaceStatusAccount");
  if (!connectionNode || !readinessNode || !streamNode || !accountNode) return;
  if (!channel) {
    connectionNode.textContent = "No channel";
    readinessNode.textContent = "Select channel";
    streamNode.textContent = "Idle";
    accountNode.textContent = "Not linked";
    return;
  }
  const health = getChannelHealthViewModel(channel, payload);
  connectionNode.textContent = health.connected ? "Connected" : health.mapped ? "Reconnect account" : "Not linked";
  readinessNode.textContent = health.ready ? "Ready" : "Needs setup";
  streamNode.textContent = health.streamState;
  accountNode.textContent = health.linkedAccountLabel;
}

function renderChannelTools() {
  const activeRoute = normalizeWorkspaceRoute(state.workspace.activeRoute);
  document.querySelectorAll("[data-route]").forEach((node) => {
    const route = normalizeWorkspaceRoute(node.dataset.route);
    node.classList.toggle("active", route === activeRoute);
    if (route === activeRoute) {
      node.setAttribute("aria-current", "page");
    } else {
      node.removeAttribute("aria-current");
    }
  });
}

function renderOverviewPanels(payload, channel) {
  const readinessNode = $("workspaceReadinessPanel");
  const activityNode = $("workspaceRecentActivityPanel");
  if (!channel) {
    if (readinessNode) readinessNode.innerHTML = `<div class="notice warn">Select a channel to see readiness.</div>`;
    if (activityNode) activityNode.innerHTML = `<div class="live-history-empty">Select a channel to view activity.</div>`;
    return;
  }
  if (readinessNode) {
    const rows = getChannelReadinessViewModel(channel, payload);
    readinessNode.innerHTML = `
      <div class="section-head compact">
        <div>
          <h2>Channel Readiness</h2>
          <p class="helper">Key setup checks for ${escapeHtml(channel.name)}.</p>
        </div>
      </div>
      <div class="readiness-list">
        ${rows.map((row) => `
          <button class="readiness-row" type="button" onclick="setWorkspaceRoute('${escapeJs(row.routeTarget)}')">
            <span>
              <strong>${escapeHtml(row.label)}</strong>
              <small>${escapeHtml(row.value)}</small>
            </span>
            <span class="badge ${escapeAttr(row.tone)}">${escapeHtml(row.status)}</span>
          </button>
        `).join("")}
      </div>
    `;
  }
  if (activityNode) {
    const items = getRecentActivityViewModel(channel.name, payload);
    activityNode.innerHTML = items.length
      ? items.map((item) => `
        <div class="activity-preview-row">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.detail)}</span>
        </div>
      `).join("")
      : `<div class="live-history-empty">No recent activity for ${escapeHtml(channel.name)} yet.</div>`;
  }
}

function applyLegacyTabView(tab) {
  state.activeTab = tab;
  $("tabControl")?.classList.toggle("active", tab === "control");
  $("tabSettings")?.classList.toggle("active", tab === "settings");
  $("viewControl")?.classList.toggle("active", tab === "control");
  $("viewSettings")?.classList.toggle("active", tab === "settings");
}

function applySettingsSection(tab) {
  $("settingsFoldersTab")?.classList.toggle("active", tab === "folders");
  $("settingsNormalizeTab")?.classList.toggle("active", tab === "normalize");
  $("settingsYoutubeTab")?.classList.toggle("active", tab === "youtube");
  $("settingsLiveHistoryTab")?.classList.toggle("active", tab === "liveHistory");
  $("settingsTroubleshootingTab")?.classList.toggle("active", tab === "troubleshooting");
  $("settingsFoldersView")?.classList.toggle("active", tab === "folders");
  $("settingsNormalizeView")?.classList.toggle("active", tab === "normalize");
  $("settingsYoutubeView")?.classList.toggle("active", tab === "youtube");
  $("settingsLiveHistoryView")?.classList.toggle("active", tab === "liveHistory");
  $("settingsTroubleshootingView")?.classList.toggle("active", tab === "troubleshooting");
}

function renderWorkspaceRoute(payload, routeName) {
  const route = normalizeWorkspaceRoute(routeName);
  const selected = getSelectedChannel({ channels: payload?.channels || [] }, state.workspace.selectedChannelName);
  renderChannelTools();
  if (route === "overview") {
    applyLegacyTabView("control");
    renderOverviewPanels(payload, selected);
    renderLiveHistory(payload?.stream_history || []);
    renderPreview(payload?.streams || {});
    return;
  }
  const settingsTab = routeToSettingsTab[route] || "folders";
  applyLegacyTabView("settings");
  state.settingsTab = settingsTab;
  applySettingsSection(settingsTab);
  syncActiveSettingsChannelFromWorkspace(false);
  if (settingsTab !== "troubleshooting") {
    renderSettingsForms();
  }
  if (settingsTab === "liveHistory") {
    renderSettingsLiveHistory();
  }
  if (settingsTab === "troubleshooting") {
    renderTasks(payload?.tasks || [], payload?.activity_events || []);
    renderLogs(payload?.streams || {});
  }
}

function renderChannelWorkspace(payload) {
  renderWorkspaceChannelList(payload);
  renderChannelTools();
  const selected = getSelectedChannel({ channels: payload.channels || [] }, state.workspace.selectedChannelName);
  renderWorkspaceHeader(payload, selected);
  renderWorkspaceStatusBand(payload, selected);
  renderWorkspaceRoute(payload, state.workspace.activeRoute);
}

async function refreshChannelContext(channelName) {
  const config = state.configData || defaultConfigData();
  const channel = (config.channels || []).find((item) => String(item?.name || "") === String(channelName || ""));
  if (!channel?.name) return;
  state.workspace.loading.channelSwitch = true;
  state.workspace.loading.module = "workspace";
  try {
    await Promise.all([
      loadRawFilesForChannel(channel),
      loadNormalizedFilesForChannel(channel),
      refreshYoutubeStatus(),
    ]);
    if (state.youtubeStatus?.connected) {
      await verifyYoutubeChannelKeys(channel.name);
      await refreshYoutubeBroadcasts(true);
    }
  } catch (error) {
    toast(error.message);
  } finally {
    state.workspace.loading.channelSwitch = false;
    state.workspace.loading.module = null;
    renderChannelWorkspace(state.status || {});
  }
}

function switchWorkspaceChannel(channelName) {
  const selected = String(channelName || "").trim();
  if (!selected || selected === state.workspace.selectedChannelName) return;
  setWorkspaceSelectedChannel(selected);
  syncActiveSettingsChannelFromWorkspace(false);
  syncYoutubeSelectedAccountFromChannel(state.configData || defaultConfigData());
  state.youtubeBroadcasts = [];
  renderChannelWorkspace(state.status || {});
  renderLiveHistory(state.status?.stream_history || []);
  if (state.activeTab === "settings" && state.settingsTab === "troubleshooting") {
    renderTasks(state.status?.tasks || [], state.status?.activity_events || []);
    renderLogs(state.status?.streams || {});
  }
  if (state.activeTab === "settings" && state.settingsTab === "liveHistory") {
    state.settingsLiveHistory.sessions = [];
    renderSettingsLiveHistory();
    fetchSettingsLiveHistory().catch((error) => toast(error.message));
  }
  refreshChannelContext(selected).catch((error) => toast(error.message));
}

function openSettingsForWorkspace(tabName, channelName = "") {
  const config = state.configData || defaultConfigData();
  const targetTabName = tabName === "live" ? "youtube" : tabName;
  const targetName = String(channelName || state.workspace.selectedChannelName || "").trim();
  const index = (config.channels || []).findIndex((channel) => String(channel?.name || "") === targetName);
  if (index >= 0) {
    state.activeSettingsChannelIndex = index;
    setWorkspaceSelectedChannel(targetName);
    syncYoutubeSelectedAccountFromChannel(config);
  }
  const route = {
    folders: "folders",
    normalize: "encoder",
    youtube: "youtube",
    liveHistory: "history",
    troubleshooting: "troubleshoot",
  }[targetTabName] || "encoder";
  state.workspace.activeRoute = route;
  applyLegacyTabView("settings");
  state.settingsTab = targetTabName;
  applySettingsSection(targetTabName);
  renderSettingsForms();
  renderChannelWorkspace(state.status || {});
}

function openWorkspaceRoute(routeName) {
  const selected = String(state.workspace.selectedChannelName || "").trim();
  if (!selected) {
    toast("Select a channel first.");
    return;
  }
  setWorkspaceRoute(routeName);
}

function runRouteSideEffects(routeName) {
  if (routeName === "history") {
    fetchSettingsLiveHistory().catch((error) => toast(error.message));
  }
  if (routeName === "encoder") {
    refreshActiveRawFiles({ force: true }).catch((error) => toast(error.message));
  }
  if (routeName === "youtube") {
    refreshYoutubeStatus()
      .then(() => {
        if (!state.youtubeStatus?.connected) {
          state.youtubeBroadcasts = [];
          state.youtubeKeyChecks = null;
          renderYoutubeSettingsPanel(state.configData || defaultConfigData());
          return null;
        }
        const selectedChannel = String(state.workspace.selectedChannelName || "").trim();
        return refreshYoutubeBroadcasts(Boolean(selectedChannel))
          .then(() => verifyYoutubeChannelKeys(selectedChannel));
      })
      .catch((error) => toast(error.message));
  }
}

function setWorkspaceRoute(routeName) {
  const route = normalizeWorkspaceRoute(routeName);
  state.workspace.activeRoute = route;
  syncActiveSettingsChannelFromWorkspace(false);
  syncYoutubeSelectedAccountFromChannel(state.configData || defaultConfigData());
  renderChannelWorkspace(state.status || {});
  runRouteSideEffects(route);
}

function streamKeyLabel(channel) {
  const envFieldValue = channel.stream_key_env || "";
  if (channel.stream_key_env && channel.stream_key_env_has_value) {
    return `key env: ${channel.stream_key_env} (set)`;
  }
  if (looksLikeDirectStreamKey(envFieldValue)) {
    return `direct key: ${maskSecret(envFieldValue)}`;
  }
  if (envFieldValue) {
    return `key env: ${channel.stream_key_env} (not set)`;
  }
  return "stream key missing";
}

function maskSecret(value) {
  if (!value) return "";
  const text = String(value);
  if (text.length <= 3) return "***";
  return `********${text.slice(-3)}`;
}

function looksLikeDirectStreamKey(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_-]{6,}$/.test(text) && text.includes("-");
}

function renderTasks(tasks, events = []) {
  const container = $("tasks");
  if (!container) return;
  const selectedChannel = selectedWorkspaceChannelName();

  const hadExisting = container.childElementCount > 0;
  const panelScroll = {
    top: container.scrollTop,
    left: container.scrollLeft,
    topPinned: isNearTop(container),
  };
  const scrollState = captureLogScrolls("#tasks pre[data-log-id]");

  const taskList = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => selectedChannel && taskChannelName(task) === selectedChannel);
  const backendEvents = Array.isArray(events) ? events : [];
  const localEvents = Array.isArray(state.localActivityEvents) ? state.localActivityEvents : [];
  const eventList = [...localEvents, ...backendEvents]
    .filter((event) => selectedChannel && eventChannelName(event) === selectedChannel);

  const runOrder = buildRunOrder(taskList);
  const items = [
    ...taskList.map((task) => ({
      kind: "task",
      ts: Number(task.started_at) || 0,
      failed: !task.running && Number(task.returncode) !== 0,
      category: "tasks",
      task,
    })),
    ...eventList.map((event) => classifyActivityEvent(event)),
  ].sort((a, b) => {
    if (a.ts !== b.ts) return b.ts - a.ts;
    return a.kind === b.kind ? 0 : a.kind === "task" ? -1 : 1;
  });

  const counts = {
    all: items.length,
    tasks: items.filter((item) => item.category === "tasks").length,
    api: items.filter((item) => item.category === "api").length,
    errors: items.filter((item) => item.failed).length,
  };
  renderActivityFilterChips(counts);

  const filtered = items.filter((item) => activityItemVisible(item));
  if (!selectedChannel) {
    container.innerHTML = `<div class="task">Select a channel to view troubleshooting activity.</div>`;
    state.activityRenderedItems = [];
    return;
  }
  if (!items.length) {
    container.innerHTML = `<div class="task">No activity yet for ${escapeHtml(selectedChannel)}. Normalize, validate, schedule, or verify this channel to see output here.</div>`;
    state.activityRenderedItems = [];
    return;
  }

  container.innerHTML = `
    <article class="task activity-unified">
      <div class="activity-unified-head">
        <div class="task-title-main">
          <span>Execution Timeline</span>
          <span class="task-subtitle">${escapeHtml(selectedChannel)} | ${escapeHtml(activityFilterLabel())}</span>
        </div>
        <div class="row wrap">
          <span class="badge">${escapeHtml(`${filtered.length} shown`)}</span>
        </div>
      </div>
      <div class="task-meta">
        <span>${escapeHtml(`${counts.all} ${selectedChannel} entries`)}</span>
        <span>Newest to oldest</span>
      </div>
      <div class="activity-stream">
        ${filtered.length
    ? filtered.map((item) => item.kind === "task"
      ? taskActivityEntryMarkup(item.task, runOrder)
      : appEventEntryMarkup(item.event)).join("")
    : `<div class="task-summary">No entries match this filter.</div>`}
      </div>
    </article>
  `;

  restoreLogScrolls("#tasks pre[data-log-id]", scrollState);
  state.activityRenderedItems = filtered;
  if (hadExisting && panelScroll.topPinned) {
    container.scrollTop = 0;
  } else {
    container.scrollTop = panelScroll.top;
    container.scrollLeft = panelScroll.left;
  }
}

function classifyActivityEvent(event) {
  const details = event?.details && typeof event.details === "object" ? event.details : {};
  const eventType = String(event?.event_type || "");
  const isApi = eventType === "api_request";
  const outcome = String(details.outcome || "").toLowerCase();
  const statusCode = Number(details.status_code);
  const statusText = String(details.status || "").toLowerCase();
  const failed = isApi
    ? (outcome && outcome !== "success") || (Number.isFinite(statusCode) && statusCode >= 400)
    : statusText === "error";
  return {
    kind: "event",
    ts: parseIsoToUnixSeconds(event.created_at),
    failed,
    category: isApi ? "api" : "events",
    event,
  };
}

function activityItemVisible(item) {
  const filter = String(state.activityFilter || "all");
  if (filter === "tasks") return item.category === "tasks";
  if (filter === "api") return item.category === "api";
  if (filter === "errors") return item.failed;
  return true;
}

function setActivityFilter(filter) {
  const next = ["all", "tasks", "api", "errors"].includes(filter) ? filter : "all";
  state.activityFilter = next;
  renderTasks(state.status?.tasks || [], state.status?.activity_events || []);
}

function activityFilterLabel() {
  const filter = String(state.activityFilter || "all");
  if (filter === "tasks") return "Tasks only";
  if (filter === "api") return "API requests only";
  if (filter === "errors") return "Errors only";
  return "All entries";
}

function renderActivityFilterChips(counts) {
  const entries = [
    { id: "activityFilterAll", key: "all", label: "All" },
    { id: "activityFilterTasks", key: "tasks", label: "Tasks" },
    { id: "activityFilterApi", key: "api", label: "API" },
    { id: "activityFilterErrors", key: "errors", label: "Errors" },
  ];
  entries.forEach((entry) => {
    const node = $(entry.id);
    if (!node) return;
    node.classList.toggle("active", state.activityFilter === entry.key);
    node.textContent = `${entry.label} (${Number(counts?.[entry.key] || 0)})`;
  });
}

function taskActivityEntryMarkup(task, runOrder) {
  const channel = taskChannelName(task) || "Unknown channel";
  const label = task.running ? "Running" : `Exit ${task.returncode}`;
  const lines = task.lines.length ? task.lines.join("\n") : "Waiting for output...";
  const logId = `task-${task.id}`;
  const expanded = task.running || !!state.expandedTaskLogs[task.id];
  const videoLines = extractVideoLines(task.lines || []);
  const headsUpLines = extractHeadsUpLines(task.lines || []);
  const started = formatTimestamp(task.started_at);
  const globalRun = runOrder.global[task.id] || "?";
  const channelRun = runOrder.channelAction[task.id] || "?";
  const summary = task.progress?.message || (task.running ? "Working..." : "Finished");
  const badgeClass = task.running ? "live" : Number(task.returncode) === 0 ? "" : "warn";
  return `
    <div class="activity-entry task-entry">
      <div class="activity-entry-head">
        <div>
          <div class="activity-entry-title">${escapeHtml(taskTitle(task.name))}</div>
          <div class="task-subtitle">${escapeHtml(channel)}</div>
        </div>
        <div class="row wrap">
          <span class="badge ${badgeClass}">${escapeHtml(label)}</span>
          <button class="pill ghost small" type="button" onclick="toggleTaskLog('${escapeJs(task.id)}')">${expanded ? "Hide" : "Show"} log</button>
          <button class="pill ghost small" type="button" onclick="copyLog('${escapeJs(logId)}')">Copy</button>
        </div>
      </div>
      <div class="activity-entry-meta">
        <span>Run #${escapeHtml(String(globalRun))}</span>
        <span>${escapeHtml(channel)} run #${escapeHtml(String(channelRun))}</span>
        <span>${escapeHtml(started)}</span>
      </div>
      ${headsUpLines.length ? `
        <div class="task-headsup">
          <span class="badge warn">Name conflict handled</span>
          <div class="task-headsup-text">${escapeHtml(headsUpLines[headsUpLines.length - 1])}</div>
        </div>
      ` : ""}
      <div class="activity-entry-summary">${escapeHtml(summary)}</div>
      ${videoLines.length ? `<div class="task-videos">${videoLines.slice(0, 2).map((line) => `<div class="task-video-line">${escapeHtml(line)}</div>`).join("")}</div>` : ""}
      <pre class="${expanded ? "" : "collapsed"}" data-log-id="${escapeAttr(logId)}">${escapeHtml(lines)}</pre>
    </div>
  `;
}

function appEventEntryMarkup(event) {
  const eventType = String(event?.event_type || "event");
  const eventId = String(event?.id || `${eventType}-${event?.created_at || ""}`);
  const channel = eventChannelName(event) || "Unknown channel";
  const created = formatIsoTimestamp(event?.created_at);
  const details = event?.details && typeof event.details === "object" ? event.details : {};
  if (eventType === "api_request") {
    const method = String(details.method || "").toUpperCase();
    const path = String(details.path || "");
    const action = String(details.client_action || "").trim();
    const statusCode = Number(details.status_code);
    const durationMs = Number(details.duration_ms);
    const requestId = String(details.request_id || "").trim();
    const errorMessage = String(details.error_message || "").trim();
    const errorTraceback = String(details.error_traceback || "").trim();
    const outcome = String(details.outcome || "").trim().toLowerCase();
    const statusText = String(details.status || "").trim().toLowerCase();
    const failed = (outcome && outcome !== "success")
      || (Number.isFinite(statusCode) && statusCode >= 400)
      || statusText === "error";
    const summary = `${method || "API"} ${path}`.trim();
    const metaParts = [];
    if (Number.isFinite(statusCode)) metaParts.push(`Status ${statusCode}`);
    if (Number.isFinite(durationMs)) metaParts.push(`${durationMs} ms`);
    if (action) metaParts.push(action);
    if (requestId) metaParts.push(`Request ${requestId}`);
    return `
      <div class="activity-entry api-entry">
        <div class="activity-entry-head">
          <div>
            <div class="activity-entry-title">API Request</div>
            <div class="task-subtitle">${escapeHtml(channel)}</div>
          </div>
          <div class="row wrap">
            <span class="badge ${failed ? "warn" : "live"}">${failed ? "Failed" : "Success"}</span>
          </div>
        </div>
        <div class="activity-entry-meta">
          <span>${escapeHtml(created)}</span>
          ${metaParts.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}
        </div>
        <div class="activity-entry-summary">${escapeHtml(summary || "API request")}</div>
        ${errorMessage ? `<pre data-log-id="${escapeAttr(`event-${eventId}-error`)}">${escapeHtml(errorMessage)}</pre>` : ""}
        ${errorTraceback ? `<pre data-log-id="${escapeAttr(`event-${eventId}-trace`)}">${escapeHtml(errorTraceback)}</pre>` : ""}
      </div>
    `;
  }

  const detailSummary = Object.keys(details || {}).length
    ? JSON.stringify(details, null, 2)
    : "No details";
  const statusText = String(details.status || "").toLowerCase();
  const failed = statusText === "error";
  const badgeLabel = failed ? "Failed" : "Event";
  return `
    <div class="activity-entry generic-event-entry">
      <div class="activity-entry-head">
        <div>
          <div class="activity-entry-title">${escapeHtml(eventType.replaceAll("_", " "))}</div>
          <div class="task-subtitle">${escapeHtml(channel)}</div>
        </div>
        <div class="row wrap">
          <span class="badge ${failed ? "warn" : ""}">${escapeHtml(badgeLabel)}</span>
        </div>
      </div>
      <div class="activity-entry-meta">
        <span>${escapeHtml(created)}</span>
      </div>
      <pre data-log-id="${escapeAttr(`event-${eventId}-details`)}">${escapeHtml(detailSummary)}</pre>
    </div>
  `;
}

function buildRunOrder(tasks) {
  const chronological = [...tasks].sort((a, b) => {
    const aTime = Number(a.started_at) || 0;
    const bTime = Number(b.started_at) || 0;
    if (aTime !== bTime) return aTime - bTime;
    return String(a.id).localeCompare(String(b.id));
  });

  const global = {};
  const channelAction = {};
  const counters = {};
  chronological.forEach((task, index) => {
    global[task.id] = index + 1;
    const channel = taskChannelName(task) || "Unknown channel";
    const key = `${task.name}|${channel}`;
    counters[key] = (counters[key] || 0) + 1;
    channelAction[task.id] = counters[key];
  });

  return { global, channelAction };
}

function extractVideoLines(lines) {
  return (lines || [])
    .filter((line) => line.startsWith("VIDEO "))
    .map((line) => {
      const match = line.match(/path=(.+)$/);
      if (!match) return line;
      const path = match[1];
      return line.replace(path, shortPath(path));
    });
}

function extractHeadsUpLines(lines) {
  return (lines || []).filter((line) => line.startsWith("HEADS-UP "));
}

function shortPath(pathText) {
  const normalized = String(pathText).replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `.../${parts.slice(-2).join("/")}`;
}

function taskTitle(name) {
  if (name === "test-stream") return "Test Stream";
  if (name === "normalize") return "Normalize";
  if (name === "validate") return "Validate";
  return name;
}

function formatTimestamp(unixSeconds) {
  const value = Number(unixSeconds);
  if (!Number.isFinite(value) || value <= 0) return "Start time unavailable";
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return "Start time unavailable";
  return `Started ${date.toLocaleString()}`;
}

function parseIsoToUnixSeconds(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return 0;
  return Math.floor(ms / 1000);
}

function formatIsoTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return "Time unavailable";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return `At ${date.toLocaleString()}`;
}

function parseIsoDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatSessionDateParts(value) {
  const date = parseIsoDate(value);
  if (!date) {
    return { date: "Time unavailable", time: "" };
  }
  return {
    date: date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
}

function sessionDurationSeconds(session, nowMs = Date.now()) {
  const start = parseIsoDate(session?.started_at);
  if (!start) return 0;
  const stopped = parseIsoDate(session?.stopped_at);
  const isLive = Boolean(session?.is_active);
  const endMs = stopped ? stopped.getTime() : isLive ? nowMs : start.getTime();
  return Math.max(0, Math.floor((endMs - start.getTime()) / 1000));
}

function durationParts(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return { hours, minutes, seconds };
}

function durationText(totalSeconds) {
  const { hours, minutes, seconds } = durationParts(totalSeconds);
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (hours || minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

function durationChip(totalSeconds, isLive = false) {
  const { hours, minutes, seconds } = durationParts(totalSeconds);
  const hourMarkup = hours ? `${hours}<span class="unit">h</span>` : "";
  const minuteMarkup = hours || minutes ? `${minutes}<span class="unit">m</span>` : "";
  return `
    <div class="duration-chip ${isLive ? "live" : ""}">
      ${hourMarkup} ${minuteMarkup} ${seconds}<span class="unit">s</span>
    </div>
  `;
}

function renderLiveHistory(sessions) {
  const list = $("liveHistoryList");
  const count = $("liveHistoryCount");
  const total = $("liveHistoryTotal");
  if (!list || !count || !total) return;

  const selectedChannel = selectedWorkspaceChannelName();
  const items = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => !selectedChannel || String(session?.channel_name || "") === selectedChannel);
  count.textContent = `${items.length} session${items.length === 1 ? "" : "s"}`;

  if (!selectedChannel) {
    total.textContent = "Total 0s";
    list.innerHTML = `<div class="live-history-empty">Select a channel to view live history.</div>`;
    return;
  }

  if (!items.length) {
    total.textContent = "Total 0s";
    list.innerHTML = `<div class="live-history-empty">No live sessions recorded for ${escapeHtml(selectedChannel)} yet.</div>`;
    return;
  }

  const nowMs = Date.now();
  const totalSeconds = items.reduce((sum, item) => sum + sessionDurationSeconds(item, nowMs), 0);
  total.textContent = `Total ${durationText(totalSeconds)}`;

  const rows = items.map((session) => {
    const isLive = Boolean(session?.is_active);
    const started = formatSessionDateParts(session?.started_at);
    const stopped = isLive
      ? { date: "In progress", time: "Recording now" }
      : String(session?.stopped_at || "").trim()
        ? formatSessionDateParts(session?.stopped_at)
        : { date: "End unavailable", time: "" };
    const durationSeconds = sessionDurationSeconds(session, nowMs);
    const title = String(session?.live_title || session?.channel_name || "Untitled live");
    const channelName = String(session?.channel_name || "Unknown channel");
    return `
      <div class="live-history-row ${isLive ? "current" : ""}">
        <div class="live-history-title">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(channelName)}</span>
        </div>
        <div class="live-history-time">
          <strong>${escapeHtml(started.date)}</strong>
          ${started.time ? `<span>${escapeHtml(started.time)}</span>` : ""}
        </div>
        <div class="live-history-time">
          <strong>${escapeHtml(stopped.date)}</strong>
          ${stopped.time ? `<span>${escapeHtml(stopped.time)}</span>` : ""}
        </div>
        ${durationChip(durationSeconds, isLive)}
      </div>
    `;
  }).join("");

  list.innerHTML = `
    <div class="live-history-head">
      <span>Live title</span>
      <span>Started</span>
      <span>Ended</span>
      <span>Duration</span>
    </div>
    ${rows}
  `;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromLocalKey(key) {
  const match = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addLocalDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function shortDateInputLabel(key) {
  const date = dateFromLocalKey(key);
  if (!date) return "";
  return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`;
}

function longDateLabel(key) {
  const date = dateFromLocalKey(key);
  if (!date) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function monthLabel(date) {
  return date.toLocaleDateString("en-US", { month: "long" });
}

function selectedHistoryRange() {
  const filter = String(state.settingsLiveHistory.filter || "last_28");
  const today = startOfLocalDay(new Date());
  const lastCompleteDay = addLocalDays(today, -1);
  if (filter.startsWith("last_")) {
    const days = Number(filter.replace("last_", ""));
    if (Number.isFinite(days) && days > 0) {
      return {
        start: startOfLocalDay(addLocalDays(lastCompleteDay, -(days - 1))),
        end: endOfLocalDay(lastCompleteDay),
      };
    }
  }
  if (filter === "lifetime") {
    return { start: null, end: null };
  }
  if (filter.startsWith("year_")) {
    const year = Number(filter.replace("year_", ""));
    if (Number.isFinite(year)) {
      return {
        start: new Date(year, 0, 1, 0, 0, 0, 0),
        end: new Date(year, 11, 31, 23, 59, 59, 999),
      };
    }
  }
  if (filter.startsWith("month_")) {
    const monthStart = dateFromLocalKey(filter.replace("month_", ""));
    if (monthStart) {
      return {
        start: startOfLocalDay(monthStart),
        end: new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999),
      };
    }
  }
  if (filter === "custom") {
    const start = dateFromLocalKey(state.settingsLiveHistory.customStart);
    const end = dateFromLocalKey(state.settingsLiveHistory.customEnd);
    if (start && end) {
      return {
        start: startOfLocalDay(start <= end ? start : end),
        end: endOfLocalDay(start <= end ? end : start),
      };
    }
  }
  return {
    start: startOfLocalDay(addLocalDays(lastCompleteDay, -27)),
    end: endOfLocalDay(lastCompleteDay),
  };
}

function historyDateMenuGroups() {
  const today = new Date();
  const currentYear = today.getFullYear();
  const recentMonths = Array.from({ length: 3 }, (_item, index) => {
    const date = new Date(currentYear, today.getMonth() - 1 - index, 1);
    return {
      key: `month_${localDateKey(date)}`,
      label: monthLabel(date),
    };
  });
  return [
    [
      { key: "last_7", label: "Last 7 days" },
      { key: "last_28", label: "Last 28 days" },
      { key: "last_90", label: "Last 90 days" },
      { key: "last_365", label: "Last 365 days" },
      { key: "lifetime", label: "Lifetime" },
    ],
    [
      { key: `year_${currentYear}`, label: String(currentYear) },
      { key: `year_${currentYear - 1}`, label: String(currentYear - 1) },
    ],
    recentMonths,
    [{ key: "custom", label: "Custom" }],
  ];
}

function historyFilterLabel(key = state.settingsLiveHistory.filter) {
  const groups = historyDateMenuGroups();
  const found = groups.flat().find((item) => item.key === key);
  if (found && key !== "custom") return found.label;
  if (key === "custom" && state.settingsLiveHistory.customStart && state.settingsLiveHistory.customEnd) {
    return `${shortDateInputLabel(state.settingsLiveHistory.customStart)} - ${longDateLabel(state.settingsLiveHistory.customEnd)}`;
  }
  return "Custom";
}

async function fetchSettingsLiveHistory() {
  const channel = selectedWorkspaceChannelName();
  if (!channel) {
    state.settingsLiveHistory.sessions = [];
    renderSettingsLiveHistory();
    return;
  }
  const payload = await api(`/api/stream-history?config=${encodeURIComponent(state.config)}&channel=${encodeURIComponent(channel)}`);
  state.settingsLiveHistory.sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  renderSettingsLiveHistory();
}

function setHistoryFilter(filter) {
  if (filter === "custom") {
    const range = selectedHistoryRange();
    state.settingsLiveHistory.pendingStart = state.settingsLiveHistory.customStart
      || localDateKey(range.start || addLocalDays(new Date(), -27));
    state.settingsLiveHistory.pendingEnd = state.settingsLiveHistory.customEnd
      || localDateKey(range.end || new Date());
    state.settingsLiveHistory.selectingCustomEnd = false;
    state.settingsLiveHistory.menuOpen = false;
    state.settingsLiveHistory.calendarOpen = true;
    renderSettingsLiveHistory();
    return;
  }
  state.settingsLiveHistory.filter = filter;
  state.settingsLiveHistory.menuOpen = false;
  state.settingsLiveHistory.calendarOpen = false;
  renderSettingsLiveHistory();
}

function toggleHistoryDateMenu() {
  const nextOpen = !state.settingsLiveHistory.menuOpen;
  state.settingsLiveHistory.menuOpen = nextOpen;
  if (nextOpen) {
    state.settingsLiveHistory.calendarOpen = false;
  }
  renderSettingsLiveHistory();
}

function selectHistoryCalendarDay(key) {
  const selected = dateFromLocalKey(key);
  if (!selected) return;
  const history = state.settingsLiveHistory;
  if (!history.pendingStart || !history.selectingCustomEnd) {
    history.pendingStart = key;
    history.pendingEnd = key;
    history.selectingCustomEnd = true;
  } else {
    history.pendingEnd = key;
    history.selectingCustomEnd = false;
  }
  renderSettingsLiveHistory();
}

function applyHistoryCustomRange() {
  const start = dateFromLocalKey(state.settingsLiveHistory.pendingStart);
  const end = dateFromLocalKey(state.settingsLiveHistory.pendingEnd);
  if (!start || !end) return;
  state.settingsLiveHistory.customStart = localDateKey(start <= end ? start : end);
  state.settingsLiveHistory.customEnd = localDateKey(start <= end ? end : start);
  state.settingsLiveHistory.filter = "custom";
  state.settingsLiveHistory.calendarOpen = false;
  state.settingsLiveHistory.selectingCustomEnd = false;
  renderSettingsLiveHistory();
}

function closeHistoryCustomRange() {
  state.settingsLiveHistory.calendarOpen = false;
  state.settingsLiveHistory.selectingCustomEnd = false;
  renderSettingsLiveHistory();
}

function renderHistoryDateMenu() {
  const menu = $("settingsLiveHistoryDateMenu");
  if (!menu) return;
  const activeFilter = state.settingsLiveHistory.filter;
  menu.classList.toggle("hidden", !state.settingsLiveHistory.menuOpen);
  menu.innerHTML = historyDateMenuGroups().map((group) => `
    <div class="history-date-menu-section">
      ${group.map((item) => `
        <button
          class="history-menu-item ${item.key === activeFilter ? "active" : ""}"
          type="button"
          role="menuitem"
          onclick="event.stopPropagation(); setHistoryFilter('${escapeJs(item.key)}')"
        >${escapeHtml(item.label)}</button>
      `).join("")}
    </div>
  `).join("");
}

function renderHistoryCalendar() {
  const calendar = $("settingsLiveHistoryCalendar");
  if (!calendar) return;
  const history = state.settingsLiveHistory;
  calendar.classList.toggle("hidden", !history.calendarOpen);
  if (!history.calendarOpen) {
    calendar.innerHTML = "";
    return;
  }

  const startDate = dateFromLocalKey(history.pendingStart) || addLocalDays(new Date(), -27);
  const endDate = dateFromLocalKey(history.pendingEnd) || new Date();
  const orderedStart = startDate <= endDate ? startDate : endDate;
  const orderedEnd = startDate <= endDate ? endDate : startDate;
  const viewDate = new Date(orderedEnd.getFullYear(), orderedEnd.getMonth(), 1);
  const firstWeekday = viewDate.getDay();
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push(`<button class="history-calendar-day" type="button" disabled></button>`);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const cellDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    const key = localDateKey(cellDate);
    const inRange = cellDate >= startOfLocalDay(orderedStart) && cellDate <= startOfLocalDay(orderedEnd);
    const isStart = key === localDateKey(orderedStart);
    const isEnd = key === localDateKey(orderedEnd);
    cells.push(`
      <button
        class="history-calendar-day ${inRange ? "in-range" : ""} ${isStart ? "range-start" : ""} ${isEnd ? "range-end" : ""}"
        type="button"
        onclick="event.stopPropagation(); selectHistoryCalendarDay('${escapeJs(key)}')"
      >${day}</button>
    `);
  }

  const selectedDays = Math.max(1, Math.round((endOfLocalDay(orderedEnd).getTime() - startOfLocalDay(orderedStart).getTime()) / 86400000) + 1);
  calendar.innerHTML = `
    <div class="history-calendar-fields">
      <input class="history-date-input" value="${escapeAttr(shortDateInputLabel(localDateKey(orderedStart)))}" readonly>
      <span class="history-date-separator">-</span>
      <input class="history-date-input" value="${escapeAttr(longDateLabel(localDateKey(orderedEnd)))}" readonly>
    </div>
    <div class="history-range-count">${selectedDays} day${selectedDays === 1 ? "" : "s"} selected</div>
    <div class="history-calendar-weekdays">
      <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
    </div>
    <div class="history-calendar-month">
      <span>${escapeHtml(viewDate.toLocaleDateString("en-US", { month: "short", year: "numeric" }))}</span>
    </div>
    <div class="history-calendar-grid">${cells.join("")}</div>
    <div class="history-calendar-actions">
      <button class="pill ghost small" type="button" onclick="event.stopPropagation(); closeHistoryCustomRange()">Cancel</button>
      <button class="pill primary small" type="button" onclick="event.stopPropagation(); applyHistoryCustomRange()">Apply</button>
    </div>
  `;
}

function settingsHistoryStatus(session) {
  if (session?.is_active || String(session?.status || "").toLowerCase() === "running") {
    return { label: "Live", className: "live" };
  }
  const code = Number(session?.returncode);
  if (Number.isFinite(code) && code !== 0) {
    return { label: "Failed", className: "warn" };
  }
  return { label: "Completed", className: "live" };
}

function renderSettingsLiveHistory() {
  const table = $("settingsLiveHistoryTable");
  const summary = $("settingsLiveHistorySummary");
  const button = $("settingsLiveHistoryRangeButton");
  if (!table || !summary || !button) return;

  const selectedChannel = selectedWorkspaceChannelName();
  button.textContent = historyFilterLabel();
  button.setAttribute("aria-expanded", state.settingsLiveHistory.menuOpen ? "true" : "false");
  renderHistoryDateMenu();
  renderHistoryCalendar();

  if (!selectedChannel) {
    summary.innerHTML = `
      <span class="badge">0 sessions</span>
      <span class="badge live">Total 0s</span>
      <span class="badge">0 completed</span>
      <span class="badge warn">0 failed</span>
    `;
    table.innerHTML = `<div class="live-history-empty">Select a channel to view live history.</div>`;
    return;
  }

  const search = String($("settingsLiveHistorySearch")?.value || "").trim().toLowerCase();
  const range = selectedHistoryRange();
  const sessions = (Array.isArray(state.settingsLiveHistory.sessions) ? state.settingsLiveHistory.sessions : [])
    .filter((session) => {
      const started = parseIsoDate(session?.started_at);
      if (!started) return false;
      if (range.start && started < range.start) return false;
      if (range.end && started > range.end) return false;
      if (!search) return true;
      const haystack = `${session?.live_title || ""} ${session?.channel_name || ""} ${session?.status || ""}`.toLowerCase();
      return haystack.includes(search);
    });

  const nowMs = Date.now();
  const totalSeconds = sessions.reduce((sum, item) => sum + sessionDurationSeconds(item, nowMs), 0);
  const completed = sessions.filter((session) => settingsHistoryStatus(session).label === "Completed").length;
  const failed = sessions.filter((session) => settingsHistoryStatus(session).label === "Failed").length;
  summary.innerHTML = `
    <span class="badge">${sessions.length} session${sessions.length === 1 ? "" : "s"}</span>
    <span class="badge live">Total ${escapeHtml(durationText(totalSeconds))}</span>
    <span class="badge">${completed} completed</span>
    <span class="badge warn">${failed} failed</span>
  `;

  if (!sessions.length) {
    table.innerHTML = `<div class="live-history-empty">No live sessions found for ${escapeHtml(selectedChannel)} with this filter.</div>`;
    return;
  }

  const rows = sessions.map((session) => {
    const started = formatSessionDateParts(session?.started_at);
    const status = settingsHistoryStatus(session);
    const isLive = status.label === "Live";
    const durationSeconds = sessionDurationSeconds(session, nowMs);
    const title = String(session?.live_title || session?.channel_name || "Untitled live");
    const channelName = String(session?.channel_name || "Unknown channel");
    return `
      <div class="settings-history-row ${isLive ? "current" : ""}">
        <div class="settings-history-date">
          <strong>${escapeHtml(started.date)}</strong>
          ${started.time ? `<span>${escapeHtml(started.time)}</span>` : ""}
        </div>
        <div class="settings-history-primary">
          <strong>${escapeHtml(channelName)}</strong>
          <span>${escapeHtml(session?.config_name || state.config || "")}</span>
        </div>
        <div class="settings-history-primary">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(isLive ? "Streaming now" : "Stored session")}</span>
        </div>
        <div>${durationChip(durationSeconds, isLive)}</div>
        <span class="badge ${escapeAttr(status.className)} settings-history-status">${escapeHtml(status.label)}</span>
      </div>
    `;
  }).join("");

  table.innerHTML = `
    <div class="settings-history-head">
      <span>Started</span>
      <span>Channel</span>
      <span>Live title</span>
      <span>Duration</span>
      <span>Status</span>
    </div>
    ${rows}
  `;
}

function toggleTaskLog(taskId) {
  state.expandedTaskLogs[taskId] = !state.expandedTaskLogs[taskId];
  renderTasks(state.status?.tasks || [], state.status?.activity_events || []);
}

function renderLogs(streams) {
  const pre = $("streamLogs");
  if (!pre) return;
  const selectedChannel = selectedWorkspaceChannelName();
  const entries = Object.values(streams || {})
    .filter((stream) => selectedChannel && String(stream?.name || "") === selectedChannel);
  const wasAtBottom = isNearBottom(pre);
  const scrollTop = pre.scrollTop;
  const scrollLeft = pre.scrollLeft;
  if (!selectedChannel) {
    pre.textContent = "Select a channel to view stream logs.";
    return;
  }
  if (!entries.length) {
    pre.textContent = `No stream logs for ${selectedChannel} yet.`;
    return;
  }
  pre.textContent = entries.map((stream) => {
    const status = stream.running ? "RUNNING" : `EXITED ${stream.returncode}`;
    return `[${stream.name}] ${status} pid=${stream.pid}\n${stream.log_tail || "No log output yet."}`;
  }).join("\n\n");
  pre.scrollTop = wasAtBottom ? pre.scrollHeight : scrollTop;
  pre.scrollLeft = scrollLeft;
}

function renderPreview(streams) {
  const select = $("previewChannelSelect");
  const badge = $("previewStatus");
  const video = $("programPreview");
  const empty = $("previewEmpty");
  const warning = $("previewWarning");
  if (!select || !badge || !video || !empty || !warning) return;

  const running = Object.values(streams || {})
    .filter((stream) => stream.running && stream.preview_url);

  if (!running.length) {
    select.innerHTML = `<option value="">No live channels</option>`;
    select.disabled = true;
    badge.textContent = "Idle";
    badge.className = "badge";
    empty.textContent = "Start a stream to see live preview here.";
    empty.style.display = "grid";
    warning.textContent = "";
    warning.classList.add("hidden");
    detachPreviewPlayer();
    state.previewChannel = "";
    return;
  }

  select.disabled = false;
  select.innerHTML = running
    .map((stream) => `<option value="${escapeAttr(stream.name)}">${escapeHtml(stream.name)}</option>`)
    .join("");

  const hasSelection = running.some((stream) => stream.name === state.previewChannel);
  if (!hasSelection) {
    state.previewChannel = running[0].name;
  }
  select.value = state.previewChannel;

  const selected = running.find((stream) => stream.name === state.previewChannel) || running[0];
  if (!selected) return;
  if (selected.name !== state.previewChannel) {
    state.previewChannel = selected.name;
    select.value = selected.name;
  }

  const buffering = !selected.preview_ready;
  badge.textContent = buffering ? "Buffering" : "Live";
  badge.className = `badge ${buffering ? "" : "live"}`;
  empty.textContent = buffering ? "Preview is warming up..." : "";
  empty.style.display = buffering ? "grid" : "none";
  const previewWarningText = String(selected.preview_warning || "").trim();
  if (previewWarningText) {
    warning.textContent = previewWarningText;
    warning.classList.remove("hidden");
  } else {
    warning.textContent = "";
    warning.classList.add("hidden");
  }
  attachPreviewPlayer(selected.preview_url);
}

function attachPreviewPlayer(url) {
  const video = $("programPreview");
  if (!video || !url) return;
  if (state.previewUrl === url) return;

  detachPreviewPlayer();
  state.previewUrl = url;
  const cacheBusted = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = cacheBusted;
    video.play().catch(() => {});
    return;
  }

  if (window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({
      liveSyncDurationCount: 3,
      maxLiveSyncPlaybackRate: 1.25,
      enableWorker: true,
    });
    hls.loadSource(cacheBusted);
    hls.attachMedia(video);
    state.previewHls = hls;
    video.play().catch(() => {});
    return;
  }

  $("previewEmpty").textContent = "HLS playback is not supported in this browser.";
  $("previewEmpty").style.display = "grid";
}

function detachPreviewPlayer() {
  const video = $("programPreview");
  if (state.previewHls) {
    state.previewHls.destroy();
    state.previewHls = null;
  }
  state.previewUrl = "";
  if (video) {
    video.removeAttribute("src");
    video.load();
  }
}

function captureLogScrolls(selector) {
  const positions = {};
  document.querySelectorAll(selector).forEach((pre) => {
    positions[pre.dataset.logId] = {
      top: pre.scrollTop,
      left: pre.scrollLeft,
    };
  });
  return positions;
}

function restoreLogScrolls(selector, positions) {
  document.querySelectorAll(selector).forEach((pre) => {
    const position = positions[pre.dataset.logId];
    if (!position) return;
    pre.scrollTop = position.top;
    pre.scrollLeft = position.left;
  });
}

function isNearBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 12;
}

function isNearTop(element) {
  return element.scrollTop < 12;
}

function initActivityStreamSplitter() {
  const grid = $("activityStreamGrid");
  const splitter = $("activityStreamSplitter");
  if (!grid || !splitter) return;

  const splitterWidth = 8;
  const minLeft = 360;
  const minRight = 280;
  let dragging = false;
  let activePointerId = null;
  let dragFrame = null;

  const gridColumnGap = () => {
    const styles = window.getComputedStyle(grid);
    const gap = Number.parseFloat(styles.columnGap || styles.gap || "0");
    return Number.isFinite(gap) ? gap : 0;
  };

  const availableTrackWidth = (gridWidth = grid.getBoundingClientRect().width) => (
    Math.max(0, gridWidth - splitterWidth - (gridColumnGap() * 2))
  );

  const applyByRatio = (ratio) => {
    const normalized = Number(ratio);
    if (!Number.isFinite(normalized) || normalized <= 0 || normalized >= 1) return;
    const total = availableTrackWidth();
    if (total < (minLeft + minRight)) return;
    const nextLeft = Math.round(total * normalized);
    const clampedLeft = Math.min(Math.max(nextLeft, minLeft), total - minRight);
    const right = total - clampedLeft;
    grid.style.gridTemplateColumns = `${clampedLeft}px ${splitterWidth}px ${right}px`;
  };

  const saveCurrentRatio = () => {
    const left = $("activityPanel")?.getBoundingClientRect().width;
    const right = $("streamLogsPanel")?.getBoundingClientRect().width;
    if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return;
    const ratio = left / (left + right);
    try {
      localStorage.setItem(ACTIVITY_STREAM_SPLIT_KEY, String(ratio));
    } catch (_error) {
      // Ignore storage failures.
    }
  };

  const applyByPointerX = (clientX) => {
    const frame = dragFrame || {
      left: grid.getBoundingClientRect().left,
      total: availableTrackWidth(),
    };
    const total = frame.total;
    if (total < (minLeft + minRight)) return;
    const rawLeft = clientX - frame.left - (splitterWidth / 2);
    const left = Math.min(Math.max(rawLeft, minLeft), total - minRight);
    const right = total - left;
    grid.style.gridTemplateColumns = `${Math.round(left)}px ${splitterWidth}px ${Math.round(right)}px`;
  };

  splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = grid.getBoundingClientRect();
    const total = availableTrackWidth(rect.width);
    if (total < (minLeft + minRight)) return;
    dragging = true;
    activePointerId = event.pointerId;
    dragFrame = { left: rect.left, total };
    splitter.classList.add("dragging");
    splitter.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  splitter.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== activePointerId) return;
    applyByPointerX(event.clientX);
  });

  const stopDragging = (event) => {
    if (!dragging) return;
    if (event && activePointerId !== null && event.pointerId !== activePointerId) return;
    dragging = false;
    splitter.classList.remove("dragging");
    if (activePointerId !== null) {
      try {
        splitter.releasePointerCapture(activePointerId);
      } catch (_error) {
        // Ignore capture release errors.
      }
    }
    activePointerId = null;
    dragFrame = null;
    saveCurrentRatio();
  };

  splitter.addEventListener("pointerup", stopDragging);
  splitter.addEventListener("pointercancel", stopDragging);
  splitter.addEventListener("lostpointercapture", () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove("dragging");
    activePointerId = null;
    dragFrame = null;
    saveCurrentRatio();
  });

  splitter.addEventListener("keydown", (event) => {
    const leftRect = $("activityPanel")?.getBoundingClientRect();
    const rightRect = $("streamLogsPanel")?.getBoundingClientRect();
    if (!leftRect || !rightRect) return;
    const total = availableTrackWidth();
    if (total < (minLeft + minRight)) return;
    const step = event.shiftKey ? 48 : 24;
    let nextLeft = leftRect.width;
    if (event.key === "ArrowLeft") nextLeft -= step;
    else if (event.key === "ArrowRight") nextLeft += step;
    else return;
    event.preventDefault();
    const clampedLeft = Math.min(Math.max(nextLeft, minLeft), total - minRight);
    const right = total - clampedLeft;
    grid.style.gridTemplateColumns = `${Math.round(clampedLeft)}px ${splitterWidth}px ${Math.round(right)}px`;
    saveCurrentRatio();
  });

  window.addEventListener("resize", () => {
    if (window.matchMedia("(max-width: 780px)").matches) return;
    let savedRatio = null;
    try {
      savedRatio = localStorage.getItem(ACTIVITY_STREAM_SPLIT_KEY);
    } catch (_error) {
      savedRatio = null;
    }
    if (savedRatio) {
      applyByRatio(Number(savedRatio));
    }
  });

  if (!window.matchMedia("(max-width: 780px)").matches) {
    let savedRatio = null;
    try {
      savedRatio = localStorage.getItem(ACTIVITY_STREAM_SPLIT_KEY);
    } catch (_error) {
      savedRatio = null;
    }
    if (savedRatio) applyByRatio(Number(savedRatio));
  }
}

async function copyActivityLogs() {
  const items = Array.isArray(state.activityRenderedItems) ? state.activityRenderedItems : [];
  const selectedChannel = selectedWorkspaceChannelName();
  if (!items.length) {
    toast("No activity logs to copy.");
    return;
  }
  const lines = [];
  lines.push(`Activity export (${new Date().toLocaleString()})`);
  lines.push(`Channel: ${selectedChannel || "none"}`);
  lines.push(`Filter: ${activityFilterLabel()}`);
  lines.push("");
  items.forEach((item, index) => {
    if (item.kind === "task") {
      lines.push(formatTaskForExport(item.task, index + 1));
      return;
    }
    lines.push(formatEventForExport(item.event, index + 1));
  });
  await copyText(lines.join("\n"));
  toast(`Copied ${items.length} activity entries.`);
}

async function clearActivityLogs() {
  const selectedChannel = selectedWorkspaceChannelName();
  if (!selectedChannel) {
    toast("Select a channel to clear activity logs.");
    return;
  }
  const statusTaskCount = (Array.isArray(state.status?.tasks) ? state.status.tasks : [])
    .filter((task) => taskChannelName(task) === selectedChannel).length;
  const statusEventCount = (Array.isArray(state.status?.activity_events) ? state.status.activity_events : [])
    .filter((event) => eventChannelName(event) === selectedChannel).length;
  const localEventCount = (Array.isArray(state.localActivityEvents) ? state.localActivityEvents : [])
    .filter((event) => eventChannelName(event) === selectedChannel).length;
  const total = statusTaskCount + statusEventCount + localEventCount;
  if (!total) {
    toast(`No activity logs to clear for ${selectedChannel}.`);
    return;
  }

  const confirmed = window.confirm(
    `Clear activity logs for ${selectedChannel} now?\nRunning tasks will stay visible.`
  );
  if (!confirmed) return;

  await api("/api/activity/clear", {
    method: "POST",
    body: JSON.stringify({
      config: state.config,
      channel: selectedChannel,
      preserve_running_tasks: true,
    }),
    action: "activity.clear",
  });
  state.localActivityEvents = state.localActivityEvents
    .filter((event) => eventChannelName(event) !== selectedChannel);
  state.expandedTaskLogs = {};
  await refresh();
  toast(`Activity logs cleared for ${selectedChannel}.`);
}

function formatTaskForExport(task, n) {
  const channel = taskChannelName(task) || "Unknown channel";
  const status = task.running ? "running" : Number(task.returncode) === 0 ? "success" : `failed (${task.returncode})`;
  const started = formatTimestamp(task.started_at);
  const header = `[${n}] TASK ${taskTitle(task.name)} | channel=${channel} | status=${status} | ${started}`;
  const summary = task.progress?.message || "";
  const logText = (task.lines || []).join("\n").trim();
  return `${header}\nsummary: ${summary || "n/a"}\n${logText || "no log output"}\n`;
}

function formatEventForExport(event, n) {
  const eventType = String(event?.event_type || "event");
  const channel = eventChannelName(event) || "Unknown channel";
  const created = formatIsoTimestamp(event?.created_at);
  const details = event?.details && typeof event.details === "object" ? event.details : {};
  const compactDetails = JSON.stringify(details, null, 2);
  const header = `[${n}] EVENT ${eventType} | channel=${channel} | ${created}`;
  return `${header}\n${compactDetails}\n`;
}

async function copyLog(logId) {
  const pre = Array.from(document.querySelectorAll("[data-log-id]"))
    .find((element) => element.dataset.logId === logId);
  if (!pre) return;
  await copyText(pre.textContent || "");
  toast("Log copied.");
}

async function copyStreamLogs() {
  await copyText($("streamLogs").textContent || "");
  toast("Stream logs copied.");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function loadConfigText() {
  try {
    const requestId = makeRequestId();
    const response = await fetch(`/api/config?config=${encodeURIComponent(state.config)}`, {
      headers: {
        "X-Request-ID": requestId,
        "X-Client-Action": "config.load",
      },
    });
    const responseRequestId = String(response.headers.get("X-Request-ID") || requestId);
    const text = response.ok ? await response.text() : "";
    $("configEditor").value = text;
    state.configData = text ? JSON.parse(text) : defaultConfigData();
    normalizeConfigShape();
    renderSettingsForms();
    renderWorkspaceChannelList(state.status || {});
    await loadRawFiles();
    await loadNormalizedFiles();
    if (!response.ok) {
      throw new Error(`Could not load config. [Request ID: ${responseRequestId}]`);
    }
  } catch (error) {
    state.configData = defaultConfigData();
    renderSettingsForms();
    toast(error.message);
  }
}

function normalizeConfigShape() {
  const config = state.configData || defaultConfigData();
  config.defaults = { ...defaultConfigData().defaults, ...(config.defaults || {}) };
  config.defaults.raw_dir = config.defaults.raw_dir || "Raw Videos";
  config.defaults.normalized_dir = config.defaults.normalized_dir || "Go Live";
  config.normalize_profile = { ...defaultConfigData().normalize_profile, ...(config.normalize_profile || {}) };
  config.live_profile = { ...defaultLiveProfile(), ...(config.live_profile || {}) };
  config.youtube = { ...defaultYoutubeSettings(), ...(config.youtube || {}) };
  config.youtube.accounts = normalizedYoutubeAccounts(config);
  config.youtube.default_account_id = normalizeAccountId(config.youtube.default_account_id || "");
  if (!config.youtube.default_account_id && config.youtube.accounts.length) {
    config.youtube.default_account_id = config.youtube.accounts[0].id;
  }
  config.ui = { ...defaultConfigData().ui, ...(config.ui || {}) };
  config.ui.channel_workspace_enabled = true;
  config.ui.legacy_tabs_enabled = false;
  config.channels = Array.isArray(config.channels) ? config.channels : [];
  config.channels.forEach((channel) => {
    if (!Array.isArray(channel.raw_playlist)) {
      channel.raw_playlist = Array.isArray(channel.playlist) ? channel.playlist : [];
    }
    if (!Array.isArray(channel.playlist)) {
      channel.playlist = [];
    }
    channel.normalize_profile = {
      ...config.normalize_profile,
      ...(channel.normalize_profile || {}),
    };
    channel.live_profile = {
      ...config.live_profile,
      ...(channel.live_profile || {}),
      mode: "copy",
    };
    channel.youtube_account_id = normalizeAccountId(channel.youtube_account_id || "");
    channel.youtube_broadcast_id = String(channel.youtube_broadcast_id || "");
    channel.youtube_stream_id = String(channel.youtube_stream_id || "");
  });
  state.configData = config;
}

async function loadRawFiles() {
  const config = state.configData || defaultConfigData();
  const channels = config.channels || [];
  state.rawFilesByChannel = {};
  await Promise.all(channels.map(async (channel) => {
    if (!channel.name) return;
    const payload = await api(`/api/raw-files?config=${encodeURIComponent(state.config)}&channel=${encodeURIComponent(channel.name)}`, {
      action: "raw.list",
    });
    state.rawFilesByChannel[channel.name] = payload.files || [];
  }));
  renderSettingsForms();
}

async function loadNormalizedFiles() {
  const config = state.configData || defaultConfigData();
  const channels = config.channels || [];
  state.normalizedFilesByChannel = {};
  await Promise.all(channels.map(async (channel) => {
    if (!channel.name) return;
    const payload = await api(`/api/normalized-files?config=${encodeURIComponent(state.config)}&channel=${encodeURIComponent(channel.name)}`, {
      action: "normalized.list",
    });
    state.normalizedFilesByChannel[channel.name] = payload.files || [];
  }));
  renderSettingsForms();
}

async function loadRawFilesForChannel(channel) {
  if (!channel?.name) return [];
  const payload = await api(`/api/raw-files?config=${encodeURIComponent(state.config)}&channel=${encodeURIComponent(channel.name)}`, {
    action: "raw.list",
  });
  state.rawFilesByChannel[channel.name] = payload.files || [];
  return state.rawFilesByChannel[channel.name];
}

function rawFilesSignature(files) {
  return (Array.isArray(files) ? files : [])
    .map((file) => `${String(file?.path || "")}|${String(file?.name || "")}`)
    .sort()
    .join("\n");
}

async function refreshActiveRawFiles({ force = false } = {}) {
  if (state.activeTab !== "settings" || state.settingsTab !== "normalize") return;
  const now = Date.now();
  if (!force && now - Number(state.rawFilesAutoRefreshLastAt || 0) < 1500) return;
  if (state.rawFilesAutoRefreshBusy) return;

  const config = state.configData || defaultConfigData();
  const index = selectedSettingsChannelIndex(config);
  const channel = config.channels?.[index];
  if (!channel?.name) return;

  state.rawFilesAutoRefreshBusy = true;
  state.rawFilesAutoRefreshLastAt = now;
  try {
    const previous = state.rawFilesByChannel[channel.name] || [];
    const next = await loadRawFilesForChannel(channel);
    if (force || rawFilesSignature(previous) !== rawFilesSignature(next)) {
      state.configData = collectSettingsData();
      renderSettingsForms();
    }
  } finally {
    state.rawFilesAutoRefreshBusy = false;
  }
}

async function loadNormalizedFilesForChannel(channel) {
  if (!channel?.name) return [];
  const payload = await api(`/api/normalized-files?config=${encodeURIComponent(state.config)}&channel=${encodeURIComponent(channel.name)}`, {
    action: "normalized.list",
  });
  state.normalizedFilesByChannel[channel.name] = payload.files || [];
  return state.normalizedFilesByChannel[channel.name];
}

function renderSettingsForms() {
  const config = state.configData || defaultConfigData();
  config.defaults = config.defaults || {};
  config.normalize_profile = config.normalize_profile || {};
  config.youtube = { ...defaultYoutubeSettings(), ...(config.youtube || {}) };
  config.youtube.accounts = normalizedYoutubeAccounts(config);
  config.youtube.default_account_id = normalizeAccountId(config.youtube.default_account_id || "");
  if (!config.youtube.default_account_id && config.youtube.accounts.length) {
    config.youtube.default_account_id = config.youtube.accounts[0].id;
  }
  config.ui = { channel_workspace_enabled: true, legacy_tabs_enabled: false, ...(config.ui || {}) };
  config.channels = Array.isArray(config.channels) ? config.channels : [];
  config.channels.forEach((channel) => {
    channel.youtube_account_id = normalizeAccountId(channel.youtube_account_id || "");
  });
  if ($("removeChannelNormalize")) {
    $("removeChannelNormalize").disabled = !config.channels.length;
  }
  renderRemovedChannelUndo();
  $("folderSettingsFields").innerHTML = folderSettingsMarkup(config.defaults);

  const activeNormalizeIndex = selectedSettingsChannelIndex(config);
  $("normalizationChannels").innerHTML = activeNormalizeIndex >= 0
    ? normalizationCard(config.channels[activeNormalizeIndex], activeNormalizeIndex)
    : `<div class="card">No channels yet. Click <strong>Add Channel</strong> to create one.</div>`;

  renderYoutubeSettingsPanel(config);
}

function renderRemovedChannelUndo() {
  const notice = $("removedChannelUndo");
  if (!notice) return;

  const undo = state.removedChannelUndo;
  if (!undo?.channel?.name) {
    notice.classList.add("hidden");
    return;
  }

  const text = $("removedChannelUndoText");
  if (text) {
    text.textContent = `Removed ${undo.channel.name}.`;
  }
  notice.classList.remove("hidden");
}

function selectedSettingsChannelIndex(config) {
  const channels = Array.isArray(config?.channels) ? config.channels : [];
  if (!channels.length) return -1;
  const selectedName = String(state.workspace.selectedChannelName || "").trim();
  const selectedIndex = channels.findIndex((channel) => String(channel?.name || "") === selectedName);
  if (selectedIndex >= 0) {
    state.activeSettingsChannelIndex = selectedIndex;
    return selectedIndex;
  }
  return Math.max(0, Math.min(state.activeSettingsChannelIndex || 0, channels.length - 1));
}

function textInput(name, label, value) {
  return `
    <label>
      ${escapeHtml(label)}
      <input type="text" data-default-field="${escapeHtml(name)}" value="${escapeAttr(value)}">
    </label>
  `;
}

function numberInput(name, label, value) {
  return `
    <label>
      ${escapeHtml(label)}
      <input type="number" data-profile-field="${escapeHtml(name)}" value="${escapeAttr(value)}">
    </label>
  `;
}

function defaultNumberInput(name, label, value) {
  return `
    <label>
      ${escapeHtml(label)}
      <input type="number" data-default-field="${escapeHtml(name)}" value="${escapeAttr(value)}">
    </label>
  `;
}

function folderSettingsMarkup(defaults) {
  return [
    folderSettingCard(
      "raw_dir",
      "Raw Videos Folder",
      defaults.raw_dir || "Raw Videos",
      "Source videos are read from here before normalization."
    ),
    folderSettingCard(
      "normalized_dir",
      "Go Live Videos Folder",
      defaults.normalized_dir || "Go Live",
      "Normalized files are written here and used for streaming playlists."
    ),
    folderSettingCard(
      "log_dir",
      "Logs Folder",
      defaults.log_dir || "logs",
      "FFmpeg and app logs are stored here for troubleshooting."
    ),
  ].join("");
}

function folderSettingCard(fieldName, title, value, helper) {
  const canBrowse = supportsDesktopFolderPicker();
  return `
    <article class="folder-field">
      <div class="folder-field-head">
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="row wrap">
        <label>
          Path
          <input type="text" data-default-field="${escapeHtml(fieldName)}" value="${escapeAttr(value)}">
          <span class="setting-note">${escapeHtml(helper)}</span>
        </label>
        <button class="pill ghost" type="button" onclick="browseDefaultFolder('${escapeJs(fieldName)}').catch((error) => toast(error.message))" ${canBrowse ? "" : "disabled"}>Browse</button>
      </div>
      <div class="meta">${canBrowse ? "Pick any local folder. Save settings to apply." : "Desktop folder picker is unavailable in this browser. Enter the path manually and save settings."}</div>
    </article>
  `;
}

function supportsDesktopFolderPicker() {
  return typeof desktopBridge()?.selectFolder === "function";
}

async function browseDefaultFolder(fieldName) {
  const bridge = desktopBridge();
  if (!bridge || typeof bridge.selectFolder !== "function") {
    toast("Folder picker is unavailable in this browser.");
    return;
  }
  const input = Array.from(document.querySelectorAll("[data-default-field]"))
    .find((node) => node.dataset.defaultField === fieldName);
  if (!input) return;
  const picked = await bridge.selectFolder({ defaultPath: input.value || undefined });
  if (!picked || picked.canceled || !picked.path) return;
  input.value = picked.path;
  toast("Folder selected. Save settings to apply.");
}

function hasYoutubeCredentialsConfigured(youtube) {
  const mode = String(youtube?.oauth_client_type || "desktop").toLowerCase();
  const clientId = String(youtube?.client_id || "").trim();
  const clientSecret = String(youtube?.client_secret || "").trim();
  if (!clientId) return false;
  if (mode === "web" && !clientSecret) return false;
  return true;
}

function showYoutubeOwnerSetupInUi() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return params.get("owner") === "1";
  } catch {
    return false;
  }
}

function isoToDatetimeLocal(value) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function youtubeBroadcastDurationMinutes(item) {
  const start = new Date(String(item?.scheduled_start_time || ""));
  const end = new Date(String(item?.scheduled_end_time || ""));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return 120;
  }
  return Math.max(15, Math.round((end.getTime() - start.getTime()) / 60000));
}

function youtubeScheduleDraftFromBroadcast(item) {
  return {
    title: String(item?.title || "").trim(),
    description: String(item?.description || ""),
    startLocal: isoToDatetimeLocal(item?.scheduled_start_time || ""),
    durationMinutes: youtubeBroadcastDurationMinutes(item),
    privacyStatus: String(item?.privacy_status || "unlisted").trim().toLowerCase() || "unlisted",
  };
}

function selectedImportedYoutubeBroadcast() {
  const broadcasts = Array.isArray(state.youtubeBroadcasts) ? state.youtubeBroadcasts : [];
  const importedId = String(state.youtubeImportedBroadcastId || "").trim();
  if (!importedId) return null;
  return broadcasts.find((item) => String(item?.id || "") === importedId) || null;
}

function syncYoutubeScheduleDraftFromForm() {
  state.youtubeScheduleDraft = {
    title: String($("youtubeScheduleTitle")?.value || ""),
    description: String($("youtubeScheduleDescription")?.value || ""),
    startLocal: String($("youtubeScheduleStart")?.value || ""),
    durationMinutes: Number($("youtubeScheduleDuration")?.value || 120),
    privacyStatus: String($("youtubeSchedulePrivacy")?.value || "unlisted"),
  };
}

function importYoutubeBroadcastSettings(broadcastId) {
  const broadcasts = Array.isArray(state.youtubeBroadcasts) ? state.youtubeBroadcasts : [];
  const item = broadcasts.find((candidate) => String(candidate?.id || "") === String(broadcastId || ""));
  if (!item) {
    toast("Could not find that YouTube broadcast.");
    return;
  }
  state.youtubeImportedBroadcastId = String(item.id || "");
  state.youtubeScheduleDraft = youtubeScheduleDraftFromBroadcast(item);
  renderYoutubeSettingsPanel(state.configData || defaultConfigData());
  toast("YouTube broadcast settings loaded.");
}

function youtubeSettingValue(value, fallback = "Unknown") {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return text;
}

function youtubeBooleanText(value) {
  if (value === true) return "On";
  if (value === false) return "Off";
  return "Unknown";
}

function youtubeThumbnailUrl(item) {
  const direct = String(item?.thumbnail_url || "").trim();
  if (direct) return direct;
  const thumbnails = item?.thumbnails && typeof item.thumbnails === "object" ? item.thumbnails : {};
  for (const key of ["maxres", "standard", "high", "medium", "default"]) {
    const url = String(thumbnails?.[key]?.url || "").trim();
    if (url) return url;
  }
  return "";
}

function youtubeBroadcastSettingsMarkup(item) {
  if (!item) return "";
  const thumbnailUrl = youtubeThumbnailUrl(item);
  const stream = item.stream && typeof item.stream === "object" ? item.stream : {};
  const details = [
    `Privacy: ${youtubeSettingValue(item.privacy_status)}`,
    `Lifecycle: ${youtubeSettingValue(item.life_cycle_status)}`,
    `Auto start: ${youtubeBooleanText(item.auto_start)}`,
    `Auto stop: ${youtubeBooleanText(item.auto_stop)}`,
    `DVR: ${youtubeBooleanText(item.enable_dvr)}`,
    `Record: ${youtubeBooleanText(item.record_from_start)}`,
    `Latency: ${youtubeSettingValue(item.latency_preference)}`,
    `Projection: ${youtubeSettingValue(item.projection)}`,
  ];
  const streamDetails = [
    stream.title ? `Stream: ${stream.title}` : "",
    item.stream_name ? `Key: ${maskSecret(item.stream_name)}` : "",
    item.stream_resolution || item.stream_frame_rate ? `Input: ${[item.stream_resolution, item.stream_frame_rate].filter(Boolean).join(" / ")}` : "",
    item.primary_ingestion_address ? `Primary: ${item.primary_ingestion_address}` : "",
    item.backup_ingestion_address ? `Backup: ${item.backup_ingestion_address}` : "",
  ].filter(Boolean);
  return `
    <div class="youtube-import-preview">
      ${thumbnailUrl ? `<img class="youtube-import-thumb" src="${escapeAttr(thumbnailUrl)}" alt="">` : `<div class="youtube-import-thumb missing">No thumbnail</div>`}
      <div class="youtube-import-details">
        <div class="youtube-broadcast-title">${escapeHtml(item.title || "Untitled")}</div>
        <div class="meta">${escapeHtml(item.scheduled_start_time || "No start time")}</div>
        <div class="row wrap">
          ${details.map((detail) => `<span class="badge">${escapeHtml(detail)}</span>`).join("")}
        </div>
        ${streamDetails.length ? `<div class="youtube-stream-details">${streamDetails.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("")}</div>` : `<div class="meta">No bound stream details returned yet.</div>`}
      </div>
    </div>
  `;
}

function renderYoutubeSettingsPanel(config) {
  const container = $("youtubeSettingsPanel");
  if (!container) return;

  const youtube = { ...defaultYoutubeSettings(), ...(config.youtube || {}) };
  const status = state.youtubeStatus || {};
  const statusAccounts = Array.isArray(status.accounts) ? status.accounts : [];
  const configuredAccounts = normalizedYoutubeAccounts(config);
  const mergedAccountsMap = new Map();
  configuredAccounts.forEach((item) => {
    mergedAccountsMap.set(item.id, { ...item });
  });
  statusAccounts.forEach((item) => {
    const id = normalizeAccountId(item.id || "");
    if (!id) return;
    const existing = mergedAccountsMap.get(id) || { id, label: id, tokens_file: defaultAccountTokensFile(id) };
    mergedAccountsMap.set(id, { ...existing, ...item, id });
  });
  const accounts = Array.from(mergedAccountsMap.values());
  const connectedCount = Number(status.connected_count || accounts.filter((item) => item.connected).length || 0);
  const previousScheduleChannel = String(state.workspace.selectedChannelName || "").trim();
  const selectedChannelName = previousScheduleChannel || "";
  const selectedChannelIndex = (config.channels || []).findIndex((channel) => String(channel?.name || "") === selectedChannelName);
  const selectedChannel = selectedChannelIndex >= 0 ? config.channels[selectedChannelIndex] : null;
  const linkedAccountId = normalizeAccountId(selectedChannel?.youtube_account_id || "");
  if (linkedAccountId && accounts.some((item) => item.id === linkedAccountId)) {
    state.youtubeSelectedAccountId = linkedAccountId;
  } else if (selectedChannelName) {
    state.youtubeSelectedAccountId = "";
  } else if (!state.youtubeSelectedAccountId || !accounts.some((item) => item.id === state.youtubeSelectedAccountId)) {
    const fallbackAccount = accounts.find((item) => item.connected) || accounts.find((item) => item.wrong_account || item.has_token) || accounts[0] || null;
    state.youtubeSelectedAccountId = normalizeAccountId(status.default_account_id || "") || normalizeAccountId(fallbackAccount?.id || "");
  }
  let selectedAccount = accounts.find((item) => item.id === state.youtubeSelectedAccountId) || null;
  if (selectedChannelName && !linkedAccountId) {
    selectedAccount = null;
  }
  const ownerSetupVisible = showYoutubeOwnerSetupInUi();
  const actionBusy = String(state.youtubeActionBusy || "").trim();
  const actionStatus = String(state.youtubeActionStatus || "idle");
  const actionMessage = String(state.youtubeActionMessage || "").trim();
  const credentialsReady = Boolean(
    status.has_client_credentials
    || hasYoutubeCredentialsConfigured(youtube)
  );
  const selectedYoutubeName = String(selectedAccount?.channel_title || selectedAccount?.channel_handle || "").trim();
  const expectedYoutubeName = String(selectedAccount?.expected_channel_name || selectedChannelName || selectedChannel?.name || "").trim();
  const connectionName = selectedAccount?.wrong_account
    ? `${expectedYoutubeName || selectedAccount.label || "Selected channel"} / ${selectedYoutubeName || "Wrong account"}`
    : selectedAccount?.connected
      ? (selectedYoutubeName || selectedAccount.label || expectedYoutubeName || "Connected channel")
      : (expectedYoutubeName || selectedAccount?.label || "Selected channel");
  const connectionStatusText = selectedAccount?.wrong_account
    ? "Wrong"
    : selectedAccount?.connected
      ? "Connected"
      : "Disconnected";
  const connectionStatusClass = selectedAccount?.connected
    ? "badge live"
    : "badge warn";
  const connectHasToken = Boolean(selectedAccount?.connected || selectedAccount?.wrong_account || selectedAccount?.has_token);
  const connectButtonText = connectHasToken ? "Disconnect" : "Connect";
  const connectButtonClass = connectHasToken ? "pill danger" : "pill primary";
  const connectButtonAction = connectHasToken
    ? "disconnectYoutube().catch((error) => toast(error.message))"
    : "connectYoutube().catch((error) => toast(error.message))";
  const connectButtonDisabled = actionBusy || (!connectHasToken && !credentialsReady) ? "disabled" : "";
  const connectionMessage = selectedAccount?.wrong_account
    ? String(selectedAccount.message || "Connected YouTube account does not match this Castarro channel.")
    : selectedAccount?.connected
      ? "YouTube account is connected for this channel."
      : "No YouTube account is connected for this channel.";
  const subscriberText = youtubeSubscriberText(selectedAccount);
  const connectionMetaText = [connectionMessage, subscriberText].filter(Boolean).join(" | ");
  const broadcasts = Array.isArray(state.youtubeBroadcasts) ? state.youtubeBroadcasts : [];
  const keyChecks = state.youtubeKeyChecks && Array.isArray(state.youtubeKeyChecks.checks)
    ? state.youtubeKeyChecks
    : null;
  const visibleKeyChecks = keyChecks
    ? {
      ...keyChecks,
      checks: Array.isArray(keyChecks.checks)
        ? keyChecks.checks.filter((item) => !selectedChannelName || String(item?.channel || "") === selectedChannelName)
        : [],
    }
    : null;
  const now = new Date();
  now.setMinutes(now.getMinutes() + 15 - (now.getMinutes() % 15), 0, 0);
  const defaultLocalTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const disabledBase = connectedCount > 0 && !actionBusy;
  const actionText = actionMessage || (connectedCount > 0
    ? "No YouTube action run yet in this session."
    : "Connect YouTube first, then run schedule/refresh/verify actions.");
  const actionNoticeClass = actionStatus === "error" ? "notice warn" : "notice";
  const scheduleButtonText = actionBusy === "schedule" ? "Creating..." : "Schedule Stream";
  const useExistingButtonText = actionBusy === "adopt" ? "Using..." : "Use Existing Broadcast";
  const refreshButtonText = actionBusy === "refresh" ? "Refreshing..." : "Refresh Broadcasts";
  const defaultPrivacy = ["private", "unlisted", "public"].includes(String(youtube.default_privacy_status || "").toLowerCase())
    ? String(youtube.default_privacy_status || "").toLowerCase()
    : "unlisted";
  const scheduleDraft = state.youtubeScheduleDraft && typeof state.youtubeScheduleDraft === "object" ? state.youtubeScheduleDraft : {};
  const importedBroadcast = selectedImportedYoutubeBroadcast();
  const importedBroadcastId = String(importedBroadcast?.id || "");
  const scheduleTitleValue = String(scheduleDraft.title || "");
  const scheduleStartValue = String(scheduleDraft.startLocal || "") || defaultLocalTime;
  const scheduleDurationValue = Number.isFinite(Number(scheduleDraft.durationMinutes)) ? Math.max(15, Math.round(Number(scheduleDraft.durationMinutes))) : 120;
  const schedulePrivacyValue = ["private", "unlisted", "public"].includes(String(scheduleDraft.privacyStatus || "").toLowerCase())
    ? String(scheduleDraft.privacyStatus || "").toLowerCase()
    : defaultPrivacy;
  const scheduleDescriptionValue = String(scheduleDraft.description || "");
  const linkedAccount = accounts.find((item) => item.id === linkedAccountId) || null;
  let scheduleGuardReason = "";
  if (!selectedChannelName) {
    scheduleGuardReason = "Pick a channel to schedule.";
  } else if (!linkedAccountId) {
    scheduleGuardReason = "Link a YouTube account to this channel first.";
  } else if (linkedAccountId && !linkedAccount?.connected) {
    scheduleGuardReason = "Linked account is not connected.";
  }
  const disabledSchedule = disabledBase && !scheduleGuardReason ? "" : "disabled";
  const keyCheckSummary = "Run verification to confirm this channel's stream key matches its linked account.";
  const activeLiveIndex = selectedSettingsChannelIndex(config);
  const liveSettingsMarkup = activeLiveIndex >= 0
    ? liveChannelCard(config.channels[activeLiveIndex], activeLiveIndex, accounts, defaultPrivacy)
    : `<div class="nested-card">No channels yet. Click <strong>Add Channel</strong> to create one.</div>`;

  container.innerHTML = `
    <div class="youtube-page-stack">
      <section class="nested-card youtube-connect-card">
        <div class="section-head compact">
          <div>
            <h3>Connect</h3>
            <p class="helper">Connect the account for the selected channel. Castarro checks the YouTube channel name before saving it.</p>
          </div>
        </div>
        <div class="youtube-connection-summary">
          <div class="youtube-connection-name">
            <strong class="${selectedAccount?.wrong_account ? "wrong" : ""}">${escapeHtml(connectionName)}</strong>
            <span class="meta">${escapeHtml(connectionMetaText)}</span>
          </div>
          <span class="${connectionStatusClass}">${escapeHtml(connectionStatusText)}</span>
          <button class="${connectButtonClass}" type="button" onclick="${connectButtonAction}" ${connectButtonDisabled}>${escapeHtml(connectButtonText)}</button>
        </div>
        ${credentialsReady ? "" : `<div class="notice warn">YouTube owner credentials are not configured yet.</div>`}
      </section>

      <div class="youtube-layout">
        <section class="nested-card youtube-schedule-card">
          <div class="section-head compact">
            <div>
              <h3>Schedule Broadcast</h3>
              <p class="helper">Create a YouTube event + stream key, or load settings from an existing YouTube broadcast.</p>
            </div>
          </div>
          ${broadcasts.length ? `
            <div class="youtube-import-box">
              <label>
                Fetch from YouTube
                <select id="youtubeBroadcastImport" onchange="importYoutubeBroadcastSettings(this.value)" ${actionBusy ? "disabled" : ""}>
                  <option value="">Choose an existing broadcast</option>
                  ${broadcasts.map((item) => `<option value="${escapeAttr(item.id || "")}" ${String(item.id || "") === importedBroadcastId ? "selected" : ""}>${escapeHtml(item.title || "Untitled")} (${escapeHtml(item.privacy_status || "unknown")})</option>`).join("")}
                </select>
              </label>
              ${importedBroadcast ? youtubeBroadcastSettingsMarkup(importedBroadcast) : `<div class="meta">Pick a broadcast to preview and copy its available YouTube settings into this form.</div>`}
            </div>
          ` : `<div class="notice">Refresh broadcasts to fetch title, description, thumbnail, privacy, auto-start/stop, DVR, latency, and stream details from active or upcoming YouTube broadcasts.</div>`}
          <div class="form-grid youtube-schedule-form">
            <label>
              Title
              <input id="youtubeScheduleTitle" type="text" value="${escapeAttr(scheduleTitleValue)}" placeholder="Live Event Title" oninput="syncYoutubeScheduleDraftFromForm()" ${disabledSchedule}>
            </label>
            <label>
              Start time
              <input id="youtubeScheduleStart" type="datetime-local" value="${escapeAttr(scheduleStartValue)}" onchange="syncYoutubeScheduleDraftFromForm()" ${disabledSchedule}>
            </label>
            <label>
              Duration (minutes)
              <input id="youtubeScheduleDuration" type="number" value="${escapeAttr(scheduleDurationValue)}" min="15" step="5" onchange="syncYoutubeScheduleDraftFromForm()" ${disabledSchedule}>
            </label>
            <label>
              Privacy
              <select id="youtubeSchedulePrivacy" onchange="syncYoutubeScheduleDraftFromForm()" ${disabledSchedule}>
                ${["private", "unlisted", "public"].map((privacy) => `<option value="${privacy}" ${privacy === schedulePrivacyValue ? "selected" : ""}>${privacy}</option>`).join("")}
              </select>
            </label>
            <label class="youtube-description">
              Description
              <textarea id="youtubeScheduleDescription" rows="4" placeholder="Optional broadcast description" oninput="syncYoutubeScheduleDraftFromForm()" ${disabledSchedule}>${escapeHtml(scheduleDescriptionValue)}</textarea>
            </label>
            <label class="youtube-description">
              Thumbnail
              <input id="youtubeScheduleThumbnail" type="file" accept="image/jpeg,image/png,image/gif,image/bmp" ${disabledSchedule}>
              <span class="setting-note">${importedBroadcast && youtubeThumbnailUrl(importedBroadcast) ? "Fetched thumbnail is shown above. Choose a local file only if you want to replace it." : "Optional. JPG, PNG, GIF, or BMP up to 2 MB."}</span>
            </label>
          </div>
          ${scheduleGuardReason ? `<div class="notice warn">Guard: ${escapeHtml(scheduleGuardReason)} | Channel: ${escapeHtml(selectedChannelName || "none")} | Account: ${escapeHtml(linkedAccount?.label || linkedAccountId || "none")}</div>` : ""}
          <div class="row wrap">
            ${importedBroadcast?.stream_name ? `<button class="pill primary" type="button" onclick="useExistingYoutubeBroadcast().catch((error) => toast(error.message))" ${disabledSchedule}>${escapeHtml(useExistingButtonText)}</button>` : ""}
            <button class="pill success" type="button" onclick="scheduleYoutubeBroadcast().catch((error) => toast(error.message))" ${disabledSchedule}>${scheduleButtonText}</button>
            <button class="pill ghost" type="button" onclick="refreshYoutubeBroadcasts(true).catch((error) => toast(error.message))" ${disabledSchedule}>${refreshButtonText}</button>
          </div>
          <div class="${actionNoticeClass}">${escapeHtml(actionText)}</div>
          ${(!visibleKeyChecks || !visibleKeyChecks.checks.length) && !actionMessage ? `<div class="notice warn">${escapeHtml(keyCheckSummary)}</div>` : ""}
          ${visibleKeyChecks && visibleKeyChecks.checks.length ? `
            <div class="youtube-broadcast-list">
              ${visibleKeyChecks.checks.map((item) => {
                const accountSubscriberText = youtubeSubscriberText({
                  subscriber_count: item.account_subscriber_count,
                  hidden_subscriber_count: item.account_hidden_subscriber_count,
                });
                const accountBadge = [item.account_label ? `Account: ${item.account_label}` : "", accountSubscriberText].filter(Boolean).join(" | ");
                return `
                <article class="youtube-broadcast-item">
                  <div class="youtube-broadcast-title">${escapeHtml(item.channel || "Unnamed channel")}</div>
                  <div class="meta">${escapeHtml(item.message || "")}</div>
                  <div class="row wrap">
                    <span class="badge ${item.ok ? "live" : "warn"}">${item.ok ? "Matched" : "Mismatch"}</span>
                    ${accountBadge ? `<span class="badge">${escapeHtml(accountBadge)}</span>` : ""}
                    ${item.stream_key_suffix ? `<span class="badge">Key ends: ${escapeHtml(item.stream_key_suffix)}</span>` : ""}
                    ${item.match_source ? `<span class="badge">${escapeHtml(item.match_source)}</span>` : ""}
                  </div>
                </article>
              `;}).join("")}
            </div>
          ` : ""}
        </section>

        <div class="youtube-side-stack">
          <div class="channel-settings-list" id="channelSettings">
            ${liveSettingsMarkup}
          </div>

          ${ownerSetupVisible ? `
          <section class="nested-card owner-only">
            <div class="section-head compact">
              <div>
                <h3>Owner Setup</h3>
                <p class="helper">Visible only in owner mode (?owner=1). End users do not need this.</p>
              </div>
              <span class="badge">Owner mode</span>
            </div>
            <div class="form-grid">
              <label>
                OAuth Client Type
                <select data-youtube-field="oauth_client_type">
                  <option value="desktop" ${(youtube.oauth_client_type || "desktop") === "desktop" ? "selected" : ""}>Desktop app (Recommended)</option>
                  <option value="web" ${(youtube.oauth_client_type || "desktop") === "web" ? "selected" : ""}>Web application</option>
                </select>
              </label>
              <label>
                OAuth Client ID
                <input type="text" data-youtube-field="client_id" value="${escapeAttr(youtube.client_id || "")}" placeholder="Paste Google OAuth Client ID">
              </label>
              <label>
                OAuth Client Secret
                <input type="password" data-youtube-field="client_secret" value="${escapeAttr(youtube.client_secret || "")}" placeholder="Paste Google OAuth Client Secret">
                <span class="setting-note">Desktop app mode can work without this. Web mode requires this.</span>
              </label>
              <label>
                Redirect URI
                <input type="text" data-youtube-field="redirect_uri" value="${escapeAttr(youtube.redirect_uri || defaultYoutubeSettings().redirect_uri)}" placeholder="http://127.0.0.1:8765/oauth2redirect">
              </label>
              <label>
                Tokens file
                <input type="text" data-youtube-field="tokens_file" value="${escapeAttr(youtube.tokens_file || ".runtime/youtube_tokens.json")}">
              </label>
              <div class="switch-row">
                <label class="switch">
                  <input type="checkbox" data-youtube-field="use_pkce" ${youtube.use_pkce !== false ? "checked" : ""}>
                  <span>Use PKCE (Recommended)</span>
                </label>
              </div>
            </div>
          </section>
          ` : ""}
        </div>
      </div>

    <section class="nested-card">
      <div class="section-head compact">
        <div>
          <h3>YouTube Broadcasts</h3>
          <p class="helper">Active and upcoming events from the selected YouTube account.</p>
        </div>
      </div>
      <div class="youtube-broadcast-list">
        ${broadcasts.length
          ? broadcasts.map((item) => {
            const thumbnailUrl = youtubeThumbnailUrl(item);
            const details = [
              item.auto_start !== "" ? `Auto start: ${youtubeBooleanText(item.auto_start)}` : "",
              item.auto_stop !== "" ? `Auto stop: ${youtubeBooleanText(item.auto_stop)}` : "",
              item.enable_dvr !== "" ? `DVR: ${youtubeBooleanText(item.enable_dvr)}` : "",
              item.latency_preference ? `Latency: ${item.latency_preference}` : "",
              item.has_backup_ingestion ? "Backup ingest available" : "",
            ].filter(Boolean);
            return `
            <article class="youtube-broadcast-item">
              <div class="youtube-broadcast-card-body">
                ${thumbnailUrl ? `<img class="youtube-broadcast-thumb" src="${escapeAttr(thumbnailUrl)}" alt="">` : ""}
                <div class="youtube-broadcast-card-copy">
                  <div class="youtube-broadcast-title">${escapeHtml(item.title || "Untitled")}</div>
                  <div class="meta">${escapeHtml(item.scheduled_start_time || "No start time")} - ${escapeHtml(item.privacy_status || "unknown")} - ${escapeHtml(item.life_cycle_status || "unknown")}</div>
                  <div class="row wrap">
                    ${details.map((detail) => `<span class="badge">${escapeHtml(detail)}</span>`).join("")}
                    ${item.stream_name ? `<span class="badge">Key: ${escapeHtml(maskSecret(item.stream_name))}</span>` : ""}
                  </div>
                </div>
              </div>
              <div class="row wrap">
                <button class="pill small" type="button" onclick="importYoutubeBroadcastSettings('${escapeJs(item.id || "")}')" ${actionBusy ? "disabled" : ""}>Use Settings</button>
                ${item.studio_url ? `<a class="studio-link" href="${escapeAttr(item.studio_url)}" target="_blank">Open Studio</a>` : ""}
              </div>
            </article>
          `;}).join("")
          : `<div class="meta">No active or upcoming broadcasts found.</div>`
        }
      </div>
    </section>
    </div>
  `;
}

async function refreshYoutubeStatus() {
  state.youtubeStatusLoading = true;
  try {
    const payload = await api(`/api/youtube/status?config=${encodeURIComponent(state.config)}`, { action: "youtube.status" });
    state.youtubeStatus = payload || null;
    writeYoutubeStatusCache(state.youtubeStatus);
    const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
    const linkedAccountId = syncYoutubeSelectedAccountFromChannel(state.configData || defaultConfigData());
    if (!linkedAccountId && !state.workspace.selectedChannelName && (!state.youtubeSelectedAccountId || !accounts.some((item) => normalizeAccountId(item.id || "") === state.youtubeSelectedAccountId))) {
      state.youtubeSelectedAccountId = normalizeAccountId(payload?.default_account_id || "") || normalizeAccountId(accounts[0]?.id || "");
    }
    if (!state.youtubeStatus?.connected) {
      state.youtubeKeyChecks = null;
    }
  } finally {
    state.youtubeStatusLoading = false;
    renderYoutubeSettingsPanel(state.configData || defaultConfigData());
    if (state.status) {
      renderChannelWorkspace(state.status);
    }
  }
}

function setYoutubeAction(status, message, busyAction = "") {
  const normalizedStatus = status || "idle";
  const text = String(message || "").trim();
  if (text && normalizedStatus !== "idle") {
    logLocalActivityEvent(
      "youtube_action",
      text,
      { action: String(busyAction || state.youtubeActionBusy || ""), status: normalizedStatus },
      normalizedStatus === "error" ? "error" : normalizedStatus === "success" ? "success" : "info"
    );
  }
  state.youtubeActionStatus = status || "idle";
  state.youtubeActionMessage = String(message || "");
  state.youtubeActionBusy = String(busyAction || "");
  state.youtubeActionAt = new Date().toLocaleTimeString();
  renderYoutubeSettingsPanel(state.configData || defaultConfigData());
  renderTasks(state.status?.tasks || [], state.status?.activity_events || []);
}

async function refreshYoutubeBroadcasts(useLinkedChannel = false) {
  try {
    let accountId = state.youtubeSelectedAccountId;
    if (useLinkedChannel) {
      const config = state.configData || defaultConfigData();
      const channelName = String(state.workspace.selectedChannelName || "").trim();
      const channel = (config.channels || []).find((item) => String(item?.name || "").trim() === channelName);
      accountId = normalizeAccountId(channel?.youtube_account_id || "");
      if (!accountId) {
        state.youtubeBroadcasts = [];
        renderYoutubeSettingsPanel(config);
        return;
      }
    }
    setYoutubeAction("loading", "Refreshing broadcasts from YouTube...", "refresh");
    const query = accountId ? `&account=${encodeURIComponent(accountId)}` : "";
    const payload = await api(`/api/youtube/broadcasts?config=${encodeURIComponent(state.config)}${query}`, { action: "youtube.broadcasts.refresh" });
    state.youtubeBroadcasts = payload.broadcasts || [];
    if (payload.account_id) {
      state.youtubeSelectedAccountId = normalizeAccountId(payload.account_id);
    }
    const selectedStillExists = state.youtubeBroadcasts.some((item) => String(item?.id || "") === String(state.youtubeImportedBroadcastId || ""));
    if (!selectedStillExists) {
      state.youtubeImportedBroadcastId = "";
    }
    if (state.youtubeBroadcasts.length === 1) {
      const [onlyBroadcast] = state.youtubeBroadcasts;
      state.youtubeImportedBroadcastId = String(onlyBroadcast?.id || "");
      state.youtubeScheduleDraft = youtubeScheduleDraftFromBroadcast(onlyBroadcast);
      setYoutubeAction("success", "Broadcast list refreshed (1 item) and loaded into the form.");
    } else if (state.youtubeBroadcasts.length > 1) {
      setYoutubeAction("success", `Broadcast list refreshed (${state.youtubeBroadcasts.length} item(s)). Choose one from Fetch from YouTube.`);
    } else {
      state.youtubeScheduleDraft = null;
      setYoutubeAction("success", "Broadcast list refreshed (0 item(s)). No active or upcoming YouTube broadcasts were found for this linked account.");
    }
  } catch (error) {
    setYoutubeAction("error", error.message || "Could not refresh broadcasts.");
    throw error;
  }
}

async function connectYoutube() {
  const data = collectSettingsData();
  await saveConfigData(data);
  const accounts = normalizedYoutubeAccounts(data);
  const channelName = String(
    state.workspace.selectedChannelName
    || ""
  ).trim();
  const selectedChannel = (data.channels || []).find((item) => String(item?.name || "").trim() === channelName) || null;
  const reusableForChannel = findReusableYoutubeAccountForChannel(accounts, channelName);
  let accountId = "";
  if (channelName) {
    accountId = normalizeAccountId(selectedChannel?.youtube_account_id || reusableForChannel?.id || "");
  } else {
    accountId = normalizeAccountId(state.youtubeSelectedAccountId || data.youtube?.default_account_id || accounts[0]?.id || "");
  }
  let selectedAccount = accountId ? (accounts.find((item) => item.id === accountId) || null) : null;
  if (!channelName && !selectedAccount) {
    selectedAccount = accounts[0] || null;
    accountId = normalizeAccountId(selectedAccount?.id || "");
  }
  const query = new URLSearchParams({ config: state.config });
  if (accountId) {
    query.set("account", accountId);
  }
  if (channelName) {
    query.set("channel", channelName);
  }
  if (selectedAccount?.label || selectedChannel?.name) {
    query.set("label", selectedChannel?.name || selectedAccount?.label || "");
  }
  const payload = await api(`/api/youtube/auth/start?${query.toString()}`, { action: "youtube.connect.start" });
  if (payload?.account_id) {
    state.youtubeSelectedAccountId = normalizeAccountId(payload.account_id);
  }
  const popup = window.open(payload.url, "youtubeConnect", "popup=yes,width=780,height=840");
  if (!popup) {
    throw new Error("Popup blocked. Please allow popups and try again.");
  }
  toast("Complete the Google sign-in in the popup window.");
}

async function disconnectYoutube() {
  const config = state.configData || defaultConfigData();
  const accounts = normalizedYoutubeAccounts(config);
  const channelName = String(state.workspace.selectedChannelName || "").trim();
  const selectedChannel = (config.channels || []).find((item) => String(item?.name || "").trim() === channelName) || null;
  const accountId = normalizeAccountId(selectedChannel?.youtube_account_id || (!channelName ? state.youtubeSelectedAccountId || config.youtube?.default_account_id || accounts[0]?.id || "" : ""));
  if (!accountId) {
    throw new Error(channelName ? "This channel is not linked to a YouTube account." : "No YouTube account is selected.");
  }
  await api("/api/youtube/disconnect", {
    method: "POST",
    body: JSON.stringify({ config: state.config, account: accountId }),
    action: "youtube.disconnect",
  });
  state.youtubeStatus = null;
  state.youtubeBroadcasts = [];
  state.youtubeKeyChecks = null;
  state.youtubeActionBusy = "";
  state.youtubeActionMessage = "";
  state.youtubeActionStatus = "idle";
  state.youtubeActionAt = "";
  await refreshYoutubeStatus();
  renderYoutubeSettingsPanel(state.configData || defaultConfigData());
  toast("YouTube account disconnected.");
}

async function verifyYoutubeChannelKeys(channelName = "") {
  setYoutubeAction("loading", "Verifying channel stream keys against each channel's linked YouTube account...", "verify");
  try {
    const query = channelName ? `&channel=${encodeURIComponent(channelName)}` : "";
    const payload = await api(`/api/youtube/verify-channel-keys?config=${encodeURIComponent(state.config)}${query}`, {
      action: "youtube.verify_channel_keys",
    });
    state.youtubeKeyChecks = payload || null;
    renderYoutubeSettingsPanel(state.configData || defaultConfigData());
    const checks = Array.isArray(payload?.checks) ? payload.checks : [];
    const enforceable = checks.filter((item) => String(item?.status || "") !== "missing_account");
    const checked = enforceable.length;
    const matched = enforceable.filter((item) => Boolean(item?.ok)).length;
    if (!checked) {
      setYoutubeAction("success", "No linked account mappings to verify yet.");
      return;
    }
    if (matched === checked) {
      setYoutubeAction("success", `Verification passed (${matched}/${checked} channel(s) matched).`);
      toast(`YouTube check passed: ${matched}/${checked} channel(s) matched.`);
    } else {
      setYoutubeAction("error", `Verification found mismatches (${matched}/${checked} channel(s) matched).`);
      toast(`YouTube check found mismatches: ${matched}/${checked} channel(s) matched.`);
    }
  } catch (error) {
    setYoutubeAction("error", error.message || "Verification failed.");
    throw error;
  }
}

function parseScheduleDateIso(inputId) {
  const value = String($(inputId)?.value || "").trim();
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

async function scheduleYoutubeBroadcast() {
  const channelName = String(state.workspace.selectedChannelName || "").trim();
  const title = String($("youtubeScheduleTitle")?.value || "").trim();
  const description = String($("youtubeScheduleDescription")?.value || "").trim();
  const startIso = parseScheduleDateIso("youtubeScheduleStart");
  const durationMinutes = Number($("youtubeScheduleDuration")?.value || 120);
  const privacyStatus = String($("youtubeSchedulePrivacy")?.value || "unlisted").trim();
  const thumbnailFile = $("youtubeScheduleThumbnail")?.files?.[0] || null;
  const config = state.configData || defaultConfigData();
  const youtube = { ...defaultYoutubeSettings(), ...(config.youtube || {}) };
  const autoStart = youtube.default_auto_start !== false;
  const autoStop = youtube.default_auto_stop !== false;
  const channel = (config.channels || []).find((item) => String(item?.name || "").trim() === channelName);
  let linkedAccountId = normalizeAccountId(channel?.youtube_account_id || "");
  const statusAccounts = Array.isArray(state.youtubeStatus?.accounts) ? state.youtubeStatus.accounts : [];
  const linkedAccount = statusAccounts.find((item) => normalizeAccountId(item?.id || "") === linkedAccountId);

  if (!channelName) {
    logLocalActivityEvent("ui_validation", "Pick a Castarro channel first.", { action: "youtube.schedule" }, "error");
    throw new Error("Pick a Castarro channel first.");
  }
  if (!linkedAccountId) {
    logLocalActivityEvent("ui_validation", "Link a YouTube account for this Castarro channel first.", { action: "youtube.schedule", channel: channelName }, "error");
    throw new Error("Link a YouTube account for this Castarro channel first.");
  }
  if (!linkedAccount?.connected) {
    logLocalActivityEvent("ui_validation", "The linked YouTube account is not connected.", { action: "youtube.schedule", channel: channelName, account: linkedAccountId }, "error");
    throw new Error(`Linked YouTube account "${linkedAccountId}" is not connected.`);
  }
  if (!title) {
    logLocalActivityEvent("ui_validation", "Broadcast title is required.", { action: "youtube.schedule", channel: channelName }, "error");
    throw new Error("Broadcast title is required.");
  }
  if (!startIso) {
    logLocalActivityEvent("ui_validation", "Set a valid start time.", { action: "youtube.schedule", channel: channelName }, "error");
    throw new Error("Set a valid start time.");
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes < 15) {
    logLocalActivityEvent("ui_validation", "Duration must be at least 15 minutes.", { action: "youtube.schedule", channel: channelName }, "error");
    throw new Error("Duration must be at least 15 minutes.");
  }

  const confirmation = window.confirm(
    `Confirm schedule?\nChannel: ${channelName}\nSchedules on YouTube account: ${linkedAccount?.label || linkedAccountId}`
  );
  if (!confirmation) {
    return;
  }

  const end = new Date(startIso);
  end.setMinutes(end.getMinutes() + Math.round(durationMinutes));

  setYoutubeAction("loading", "Creating schedule and stream key on YouTube...", "schedule");
  try {
    const payload = await api("/api/youtube/schedule", {
      method: "POST",
      body: JSON.stringify({
        config: state.config,
        channel: channelName,
        title,
        description,
        privacy_status: privacyStatus,
        auto_start: autoStart,
        auto_stop: autoStop,
        scheduled_start_time: startIso,
        scheduled_end_time: end.toISOString(),
        account_id: linkedAccountId,
      }),
      action: "youtube.schedule",
    });

    const streamName = payload?.stream?.stream_name || "";
    const broadcastId = String(payload?.broadcast?.id || "");
    let thumbnailMessage = "";
    if (thumbnailFile && broadcastId) {
      try {
        await uploadYoutubeThumbnail(thumbnailFile, broadcastId, linkedAccountId);
        thumbnailMessage = " Thumbnail uploaded.";
      } catch (error) {
        thumbnailMessage = ` Thumbnail upload failed: ${error.message || "unknown error"}`;
        toast(thumbnailMessage.trim());
      }
    }
    await refresh();
    await loadConfigText();
    await refreshYoutubeStatus();
    await refreshYoutubeBroadcasts(true);
    await verifyYoutubeChannelKeys(channelName);
    setYoutubeAction(
      "success",
      streamName
        ? `Schedule created on ${payload?.account_label || linkedAccountId} and key assigned (key ends with ${streamName.slice(-4)}).${thumbnailMessage}`
        : `Schedule created on ${payload?.account_label || linkedAccountId}.${thumbnailMessage}`
    );
    toast(streamName ? `YouTube schedule created on ${payload?.account_label || linkedAccountId}. Stream key ends with ${streamName.slice(-4)}.` : `YouTube schedule created on ${payload?.account_label || linkedAccountId}.`);
  } catch (error) {
    setYoutubeAction("error", error.message || "Could not create schedule.");
    throw error;
  }
}

async function useExistingYoutubeBroadcast() {
  const channelName = String(state.workspace.selectedChannelName || "").trim();
  const importedBroadcast = selectedImportedYoutubeBroadcast();
  const config = state.configData || defaultConfigData();
  const channel = (config.channels || []).find((item) => String(item?.name || "").trim() === channelName);
  const linkedAccountId = normalizeAccountId(channel?.youtube_account_id || "");

  if (!channelName) {
    throw new Error("Pick a Castarro channel first.");
  }
  if (!linkedAccountId) {
    throw new Error("Link a YouTube account for this Castarro channel first.");
  }
  if (!importedBroadcast?.id) {
    throw new Error("Choose an existing YouTube broadcast first.");
  }
  if (!importedBroadcast?.stream_name) {
    throw new Error("That YouTube broadcast does not have a bound stream key yet.");
  }

  const confirmation = window.confirm(
    `Use existing YouTube broadcast?\nChannel: ${channelName}\nBroadcast: ${importedBroadcast.title || importedBroadcast.id}`
  );
  if (!confirmation) {
    return;
  }

  setYoutubeAction("loading", "Using existing YouTube broadcast and stream key...", "adopt");
  try {
    const payload = await api("/api/youtube/use-broadcast", {
      method: "POST",
      body: JSON.stringify({
        config: state.config,
        channel: channelName,
        broadcast_id: importedBroadcast.id,
        account_id: linkedAccountId,
      }),
      action: "youtube.use_existing_broadcast",
    });
    await refresh();
    await loadConfigText();
    await refreshYoutubeStatus();
    await refreshYoutubeBroadcasts(true);
    await verifyYoutubeChannelKeys(channelName);
    setYoutubeAction(
      "success",
      `Existing broadcast linked on ${payload?.account_label || linkedAccountId}; key ends with ${payload?.stream_key_suffix || maskSecret(importedBroadcast.stream_name).slice(-4)}.`
    );
    toast("Existing YouTube broadcast linked to this Castarro channel.");
  } catch (error) {
    setYoutubeAction("error", error.message || "Could not use existing YouTube broadcast.");
    throw error;
  }
}

async function uploadYoutubeThumbnail(file, broadcastId, accountId) {
  if (!file || !broadcastId || !accountId) return null;
  const requestId = makeRequestId();
  const query = new URLSearchParams({
    config: state.config,
    account: accountId,
    broadcast: broadcastId,
    filename: file.name || "thumbnail",
  });
  const response = await fetch(`/api/youtube/thumbnail?${query.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Request-ID": requestId,
      "X-Client-Action": "youtube.thumbnail.upload",
    },
    body: file,
  });
  const responseRequestId = String(response.headers.get("X-Request-ID") || requestId);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${payload.error || "Thumbnail upload failed."} [Request ID: ${responseRequestId}]`);
  }
  return payload;
}

function normalizationCard(channel, index) {
  const selected = Array.isArray(channel.raw_playlist) ? channel.raw_playlist : [];
  const files = state.rawFilesByChannel[channel.name] || [];
  const selectedSet = new Set(selected);
  const task = taskForChannel(channel.name);
  const normalizeProfile = { ...defaultConfigData().normalize_profile, ...(channel.normalize_profile || {}) };
  const encoder = normalizeProfile.video_encoder || "libx264";
  const rateControl = normalizeProfile.rate_control === "cbr" ? "cbr" : "vbr";
  const isCbr = rateControl === "cbr";
  const presetOptions = presetOptionsForEncoder(encoder);
  const preset = presetOptions.includes(normalizeProfile.x264_preset)
    ? normalizeProfile.x264_preset
    : presetOptions[0];
  const fileOptions = files.length
    ? files.map((file) => `
        <label class="file-option">
          <input type="checkbox" data-raw-file="${escapeAttr(file.path)}" ${selectedSet.has(file.path) ? "checked" : ""} onchange="syncRawSelection(${index})">
          <span>${escapeHtml(file.path)}</span>
        </label>
      `).join("")
    : `<div class="meta">No videos found yet in Raw Videos/${escapeHtml(channel.name || "")}. Add videos here or copy files into that folder; the list updates automatically when you return to this view.</div>`;

  return `
    <div class="channel-settings selected-normalize-settings" data-index="${index}" data-channel-name="${escapeAttr(channel.name || "")}">
      <div class="section-head compact">
        <div>
          <h3>${escapeHtml(channel.name || `channel_${index + 1}`)}</h3>
          <p class="helper">Encoding only the selected channel from the Channels rail.</p>
        </div>
        <span class="badge">${selected.length} selected</span>
      </div>
      <div class="row wrap">
        <input class="hidden-file" id="upload-${index}" type="file" multiple accept="video/*" onchange="uploadRawVideos(${index}, this.files).catch((error) => toast(error.message))">
        <button class="pill primary" type="button" onclick="document.getElementById('upload-${index}').click()">Add Videos</button>
        <button class="pill success" type="button" onclick="startSettingsTask('normalize', ${index})">Encode</button>
      </div>
      ${task ? taskProgressMarkup(task) : ""}
      <div class="file-picker">
        <div class="file-list">${fileOptions}</div>
        <div class="meta">If an encoded file name already exists, a new version like <code>-v2</code> is created and a heads-up appears in Activity.</div>
      </div>
      <div>
        <h3>Encoder Profile</h3>
        <div class="form-grid">
          ${normalizeInput(index, "width", "Width", normalizeProfile.width ?? 1920, "number")}
          ${normalizeInput(index, "height", "Height", normalizeProfile.height ?? 1080, "number")}
          ${normalizeInput(index, "fps", "FPS", normalizeProfile.fps ?? 30, "number")}
          ${normalizeSelect(index, "video_encoder", "Video encoder", encoder, ["libx264", "h264_nvenc", "h264_amf", "h264_qsv"], `syncEncoderPreset(${index}, this.value)`)}
          ${normalizeSelect(index, "x264_preset", "Encoding preset", preset, presetOptions, "", encoder)}
          ${normalizeSelect(index, "rate_control", "Rate control", rateControl, ["vbr", "cbr"], `syncNormalizeRateControl(${index}, this.value)`)}
          ${normalizeInput(index, "video_bitrate", "Video bitrate", normalizeProfile.video_bitrate || "6000k")}
          ${normalizeInput(index, "video_bufsize", "Video buffer size", normalizeProfile.video_bufsize || "12000k")}
          ${normalizeInput(index, "audio_bitrate", "Audio bitrate", normalizeProfile.audio_bitrate || "160k")}
          ${normalizeInput(index, "audio_sample_rate", "Audio sample rate", normalizeProfile.audio_sample_rate ?? 48000, "number")}
        </div>
        <p class="setting-note normalize-encoder-note">Video encoder is the processing engine your PC uses; encoding preset is how hard that engine works: faster uses less PC power, slower gives better picture quality.</p>
        <div class="normalize-rate-panels">
          <section class="normalize-rate-panel ${isCbr ? "" : "active"}" data-normalize-rate-panel="vbr">
            <h4>VBR Controls</h4>
            <div class="form-grid">
              ${normalizeInput(index, "video_minrate", "Min video bitrate", normalizeProfile.video_minrate || "4500k")}
              ${normalizeInput(index, "video_maxrate", "Max video bitrate", normalizeProfile.video_maxrate || "6800k")}
            </div>
          </section>
          <section class="normalize-rate-panel ${isCbr ? "active" : ""}" data-normalize-rate-panel="cbr">
            <h4>CBR Controls</h4>
            <p class="setting-note">CBR uses one constant bitrate: <code>video_bitrate</code>. Min and max are forced to the same value automatically.</p>
          </section>
        </div>
        <div class="meta" data-normalize-rate-status>${isCbr ? "CBR mode is enabled for this channel." : "VBR mode is enabled for this channel."}</div>
      </div>
    </div>
  `;
}

function taskForChannel(channelName) {
  const tasks = state.status?.tasks || [];
  return tasks.find((task) => (
    task.channel === channelName
    && ["normalize", "validate", "test-stream"].includes(task.name)
    && task.running
  )) || tasks.find((task) => (
    task.channel === channelName
    && ["normalize", "validate", "test-stream"].includes(task.name)
  ));
}

function taskProgressMarkup(task) {
  const progress = task.progress || {};
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const action = task.name === "normalize" ? "Encoding" : task.name === "validate" ? "Validating" : "Testing stream";
  const status = task.running ? action : task.returncode === 0 ? "Finished" : "Failed";
  const total = Number(progress.total) || 0;
  const current = Number(progress.current) || 0;
  const countText = total ? `${Math.min(current || 1, total)} of ${total}` : "Starting";
  const message = progress.message || "Starting...";
  return `
    <div class="progress-card ${task.running ? "running" : task.returncode === 0 ? "done" : "failed"}">
      <div class="progress-head">
        <span>${escapeHtml(status)}</span>
        <span>${escapeHtml(countText)} - ${percent}%</span>
      </div>
      <div class="progress-track" aria-label="${escapeAttr(status)} progress">
        <div class="progress-fill" style="width: ${percent}%"></div>
      </div>
      <div class="progress-message">${escapeHtml(message)}</div>
      ${task.running ? `<button class="pill danger small" type="button" onclick="stopTask('${escapeJs(task.id)}')">Stop ${escapeHtml(task.name)}</button>` : ""}
    </div>
  `;
}

function normalizeInput(index, name, label, value, type = "text") {
  return `
    <label>
      ${escapeHtml(label)}
      <input type="${type}" data-normalize-index="${index}" data-normalize-field="${escapeHtml(name)}" value="${escapeAttr(value)}">
    </label>
  `;
}

function presetOptionsForEncoder(encoder) {
  if (encoder === "h264_nvenc") {
    return ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
  }
  if (encoder === "h264_amf") {
    return ["balanced", "speed", "quality"];
  }
  if (encoder === "h264_qsv") {
    return ["medium", "veryfast", "faster", "fast", "slow"];
  }
  return ["medium", "veryfast", "faster", "fast", "slow", "slower"];
}

function presetLabelForEncoder(encoder, preset) {
  if (encoder === "h264_nvenc") {
    const nvencLabels = {
      p1: "P1: Fastest (Lowest Quality)",
      p2: "P2: Faster (Lower Quality)",
      p3: "P3: Fast (Low Quality)",
      p4: "P4: Medium (Medium Quality)",
      p5: "P5: Slow (Good Quality)",
      p6: "P6: Slower (Better Quality)",
      p7: "P7: Slowest (Best Quality)",
    };
    return nvencLabels[preset] || String(preset).toUpperCase();
  }
  return String(preset);
}

function videoEncoderLabel(encoder) {
  const labels = {
    libx264: "libx264: CPU Software (Most Compatible, Higher CPU Use)",
    h264_nvenc: "h264_nvenc: NVIDIA GPU (Low CPU, Fast Hardware Encode)",
    h264_amf: "h264_amf: AMD GPU (Low CPU, Fast Hardware Encode)",
    h264_qsv: "h264_qsv: Intel Quick Sync (Low CPU, Hardware Encode)",
  };
  return labels[encoder] || String(encoder);
}

function normalizeSelect(index, name, label, value, options, onchange = "", presetLabelEncoder = "") {
  const optionSet = new Set([...options, value].filter(Boolean));
  return `
    <label>
      ${escapeHtml(label)}
      <select data-normalize-index="${index}" data-normalize-field="${escapeHtml(name)}" ${onchange ? `onchange="${escapeAttr(onchange)}"` : ""}>
        ${Array.from(optionSet).map((option) => {
          let display = option;
          if (name === "x264_preset") {
            display = presetLabelForEncoder(presetLabelEncoder, option);
          } else if (name === "video_encoder") {
            display = videoEncoderLabel(option);
          }
          return `<option value="${escapeAttr(option)}" ${option === value ? "selected" : ""}>${escapeHtml(display)}</option>`;
        }).join("")}
      </select>
    </label>
  `;
}

function syncEncoderPreset(index, encoder) {
  const card = document.querySelector(`#normalizationChannels [data-index="${index}"]`);
  if (!card) return;
  const presetSelect = card.querySelector('[data-normalize-field="x264_preset"]');
  if (!presetSelect) return;
  const options = presetOptionsForEncoder(encoder);
  const current = presetSelect.value;
  const nextValue = options.includes(current) ? current : options[0];
  presetSelect.innerHTML = options
    .map((option) => {
      const display = presetLabelForEncoder(encoder, option);
      return `<option value="${escapeAttr(option)}" ${option === nextValue ? "selected" : ""}>${escapeHtml(display)}</option>`;
    })
    .join("");

  const config = state.configData || defaultConfigData();
  if (config.channels?.[index]) {
    config.channels[index].normalize_profile = {
      ...(config.channels[index].normalize_profile || {}),
      video_encoder: encoder,
      x264_preset: nextValue,
    };
    state.configData = config;
    $("configEditor").value = JSON.stringify(config, null, 2) + "\n";
  }
}

function syncNormalizeRateControl(index, modeValue) {
  const card = document.querySelector(`#normalizationChannels [data-index="${index}"]`);
  if (!card) return;
  const mode = String(modeValue || "vbr").toLowerCase() === "cbr" ? "cbr" : "vbr";

  card.querySelectorAll("[data-normalize-rate-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.normalizeRatePanel === mode);
  });
  const rateStatus = card.querySelector("[data-normalize-rate-status]");
  if (rateStatus) {
    rateStatus.textContent = mode === "cbr"
      ? "CBR mode is enabled for this channel."
      : "VBR mode is enabled for this channel.";
  }

  const config = state.configData || defaultConfigData();
  if (config.channels?.[index]) {
    config.channels[index].normalize_profile = {
      ...defaultConfigData().normalize_profile,
      ...(config.channels[index].normalize_profile || {}),
      rate_control: mode,
    };
    state.configData = config;
    $("configEditor").value = JSON.stringify(config, null, 2) + "\n";
  }
}

function liveChannelCard(channel, index, _accounts = [], defaultPrivacy = "unlisted") {
  const selected = Array.isArray(channel.playlist) ? channel.playlist : [];
  const files = state.normalizedFilesByChannel[channel.name] || [];
  const selectedSet = new Set(selected);
  const fileOptions = files.length
    ? files.map((file) => liveVideoOption(file, index, channel.name || "", selectedSet)).join("")
    : `<div class="meta">No normalized videos found yet in Go Live/${escapeHtml(channel.name || "")}. Normalize videos first, then click Refresh.</div>`;
  return `
    <div class="channel-settings selected-live-settings" data-index="${index}" data-channel-name="${escapeAttr(channel.name || "")}">
      <div class="nested-card">
        <div class="section-head compact">
          <div>
            <h3>${escapeHtml(channel.name || "Channel")}</h3>
            <p class="helper">Channel-scoped YouTube setup, stream key, and live playlist.</p>
          </div>
        </div>
        <div class="live-youtube-settings">
          <div class="section-head compact">
            <div>
              <h4>YouTube setup</h4>
              <p class="helper">Set scheduling defaults, stream key, Studio URL, and stream behavior.</p>
            </div>
          </div>
          <div class="form-grid">
            <label class="youtube-privacy-field">
              Default privacy
              <select data-youtube-field="default_privacy_status">
                ${["private", "unlisted", "public"].map((privacy) => `<option value="${privacy}" ${privacy === defaultPrivacy ? "selected" : ""}>${privacy}</option>`).join("")}
              </select>
            </label>
            <label>
              Manual stream key
              <input type="text" data-youtube-channel-index="${index}" data-youtube-channel-field="stream_key_env" value="${escapeAttr(channel.stream_key_env || "")}" placeholder="Paste stream key or environment variable name">
              <span class="setting-note">Used when you are not creating the stream key through YouTube scheduling.</span>
            </label>
            <label>
              YouTube Studio URL
              <input type="text" data-youtube-channel-index="${index}" data-youtube-channel-field="youtube_studio_url" value="${escapeAttr(channel.youtube_studio_url || "")}" placeholder="Auto-filled after scheduling when available">
            </label>
          </div>
          <div class="switch-row">
            ${checkboxInput("loop", "Loop playlist", channel.loop !== false)}
            ${checkboxInput("restart_on_exit", "Restart if stream exits", channel.restart_on_exit !== false)}
            <label class="switch">
              <input type="checkbox" data-youtube-channel-index="${index}" data-youtube-channel-field="youtube_auto_start" ${channel.youtube_auto_start ? "checked" : ""}>
              <span>YouTube Auto Start confirmed</span>
            </label>
            <label class="switch">
              <input type="checkbox" data-youtube-channel-index="${index}" data-youtube-channel-field="youtube_auto_stop" ${channel.youtube_auto_stop ? "checked" : ""}>
              <span>YouTube Auto Stop confirmed</span>
            </label>
          </div>
        </div>
      </div>
      <div class="nested-card live-videos-card">
        <div class="section-head compact">
          <div>
            <h3>Videos</h3>
            <p class="helper">Choose the exact normalized videos to go live with. Clear all to use the whole channel folder.</p>
          </div>
          <div class="row wrap">
            <button class="pill ghost small" type="button" onclick="selectAllLiveFiles(${index})">Select All</button>
            <button class="pill ghost small" type="button" onclick="clearLiveFiles(${index})">Clear</button>
            <button class="pill ghost small" type="button" onclick="refreshLiveFiles(${index}).catch((error) => toast(error.message))">Refresh</button>
          </div>
        </div>
        <div class="file-list live-video-list">${fileOptions}</div>
      </div>
    </div>
  `;
}

function liveVideoOption(file, index, channelName, selectedSet) {
  const path = String(file?.path || "");
  const name = String(file?.name || path.split(/[\\/]/).pop() || path);
  const thumbnailQuery = new URLSearchParams({
    config: state.config,
    channel: channelName,
    path,
  });
  return `
    <label class="file-option live-video-option">
      <input type="checkbox" data-live-file="${escapeAttr(path)}" ${selectedSet.has(path) ? "checked" : ""} onchange="syncLiveSelection(${index})">
      <img class="video-thumb" src="/api/video-thumbnail?${thumbnailQuery.toString()}" alt="" loading="lazy" onerror="this.classList.add('missing')">
      <span class="video-option-text">
        <span class="video-option-name">${escapeHtml(name)}</span>
        <span class="video-option-path">${escapeHtml(path)}</span>
      </span>
    </label>
  `;
}

function channelInput(name, label, value, type = "text", hint = "") {
  return `
    <label>
      ${escapeHtml(label)}
      <input type="${type}" data-channel-field="${escapeHtml(name)}" value="${escapeAttr(value)}">
      ${hint ? `<span class="field-hint">${escapeHtml(hint)}</span>` : ""}
    </label>
  `;
}

function liveInput(name, label, value, type = "text", hint = "") {
  return `
    <label>
      ${escapeHtml(label)}
      <input type="${type}" data-live-profile-field="${escapeHtml(name)}" value="${escapeAttr(value)}">
      ${hint ? `<span class="setting-note">${escapeHtml(hint)}</span>` : ""}
    </label>
  `;
}

function liveSelect(name, label, value, options, hint = "", onchange = "") {
  const optionSet = new Set([...options, value].filter(Boolean));
  return `
    <label>
      ${escapeHtml(label)}
      <select data-live-profile-field="${escapeHtml(name)}" ${onchange ? `onchange="${escapeAttr(onchange)}"` : ""}>
        ${Array.from(optionSet).map((option) => {
          const display = name === "video_encoder" ? videoEncoderLabel(option) : option;
          return `<option value="${escapeAttr(option)}" ${option === value ? "selected" : ""}>${escapeHtml(display)}</option>`;
        }).join("")}
      </select>
      ${hint ? `<span class="setting-note">${escapeHtml(hint)}</span>` : ""}
    </label>
  `;
}

function checkboxInput(name, label, checked) {
  return `
    <label class="switch">
      <input type="checkbox" data-channel-field="${escapeHtml(name)}" ${checked ? "checked" : ""}>
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function syncRawSelection(index) {
  const card = document.querySelector(`#normalizationChannels [data-index="${index}"]`);
  if (!card) return;
  const selected = Array.from(card.querySelectorAll("[data-raw-file]:checked")).map((input) => input.dataset.rawFile);
  const config = state.configData || defaultConfigData();
  if (config.channels?.[index]) {
    config.channels[index].raw_playlist = selected;
    state.configData = config;
    $("configEditor").value = JSON.stringify(config, null, 2) + "\n";
  }
}

function syncLiveSelection(index) {
  const card = document.querySelector(`#channelSettings [data-index="${index}"]`);
  if (!card) return;
  const selected = Array.from(card.querySelectorAll("[data-live-file]:checked")).map((input) => input.dataset.liveFile);
  const config = state.configData || defaultConfigData();
  if (config.channels?.[index]) {
    config.channels[index].playlist = selected;
    state.configData = config;
    $("configEditor").value = JSON.stringify(config, null, 2) + "\n";
  }
}

function syncLiveMode(index, modeValue) {
  const card = document.querySelector(`#channelSettings [data-index="${index}"]`);
  if (!card) return;
  const mode = String(modeValue || "copy").toLowerCase() === "transcode" ? "transcode" : "copy";

  card.querySelectorAll("[data-live-mode-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.liveModePanel === mode);
  });
  const modeStatus = card.querySelector("[data-live-mode-status]");
  if (modeStatus) {
    modeStatus.textContent = mode === "transcode"
      ? "Transcode mode is enabled for this channel."
      : "Copy mode is enabled for this channel.";
  }

  const config = state.configData || defaultConfigData();
  if (config.channels?.[index]) {
    config.channels[index].live_profile = {
      ...defaultLiveProfile(),
      ...(config.channels[index].live_profile || {}),
      mode,
    };
    state.configData = config;
    $("configEditor").value = JSON.stringify(config, null, 2) + "\n";
  }
}

function selectAllLiveFiles(index) {
  const card = document.querySelector(`#channelSettings [data-index="${index}"]`);
  if (!card) return;
  card.querySelectorAll("[data-live-file]").forEach((input) => {
    input.checked = true;
  });
  syncLiveSelection(index);
}

function clearLiveFiles(index) {
  const card = document.querySelector(`#channelSettings [data-index="${index}"]`);
  if (!card) return;
  card.querySelectorAll("[data-live-file]").forEach((input) => {
    input.checked = false;
  });
  syncLiveSelection(index);
}

async function refreshLiveFiles(index) {
  const config = collectSettingsData();
  const channel = config.channels[index];
  if (!channel || !channel.name) {
    toast("Save a channel name before refreshing videos.");
    return;
  }
  state.activeSettingsChannelIndex = index;
  await saveConfigData(config);
  await loadNormalizedFilesForChannel(channel);
  renderSettingsForms();
}

async function uploadRawVideos(index, files) {
  if (!files || !files.length) return;
  state.activeSettingsChannelIndex = index;
  const config = collectSettingsData();
  const channel = config.channels[index];
  if (!channel || !channel.name) {
    toast("Save a channel name before adding videos.");
    return;
  }

  await saveConfigData(config);

  const saved = [];
  for (const file of Array.from(files)) {
    toast(`Adding ${file.name}...`);
    const url = `/api/raw-files/upload?config=${encodeURIComponent(state.config)}&channel=${encodeURIComponent(channel.name)}&filename=${encodeURIComponent(file.name)}`;
    const requestId = makeRequestId();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Request-ID": requestId,
        "X-Client-Action": "raw.upload",
      },
      body: file,
    });
    const responseRequestId = String(response.headers.get("X-Request-ID") || requestId);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`${payload.error || "Upload failed."} [Request ID: ${responseRequestId}]`);
    }
    saved.push(payload.saved);
    state.rawFilesByChannel[channel.name] = payload.files || [];
  }

  await loadRawFilesForChannel(channel);
  channel.raw_playlist = (state.rawFilesByChannel[channel.name] || []).map((file) => file.path);
  state.configData.channels[index].raw_playlist = channel.raw_playlist;
  $("configEditor").value = JSON.stringify(config, null, 2) + "\n";
  renderSettingsForms();
  toast(`Added ${saved.length} video${saved.length === 1 ? "" : "s"} to ${channel.name}.`);
}

function collectSettingsData() {
  const config = structuredClone(state.configData || defaultConfigData());
  config.defaults = config.defaults || {};
  config.normalize_profile = config.normalize_profile || {};
  config.youtube = { ...defaultYoutubeSettings(), ...(config.youtube || {}) };
  config.youtube.accounts = normalizedYoutubeAccounts(config);
  config.ui = { ...defaultConfigData().ui, ...(config.ui || {}) };
  config.ui.channel_workspace_enabled = true;
  config.ui.legacy_tabs_enabled = false;

  document.querySelectorAll("[data-default-field]").forEach((input) => {
    config.defaults[input.dataset.defaultField] = coerceValue(input.value, input.type);
  });

  document.querySelectorAll("[data-youtube-field]").forEach((input) => {
    const field = input.dataset.youtubeField;
    if (input.type === "checkbox") {
      config.youtube[field] = input.checked;
    } else {
      config.youtube[field] = input.value;
    }
  });

  config.youtube.default_account_id = normalizeAccountId(config.youtube.default_account_id || "");

  const existingChannels = Array.isArray(config.channels) ? config.channels : [];
  const nextChannels = existingChannels.map((existingChannel) => ({
    ...existingChannel,
    live_profile: {
      ...defaultLiveProfile(),
      ...(existingChannel.live_profile || {}),
      mode: "copy",
    },
    normalize_profile: {
      ...(existingChannel.normalize_profile || {}),
    },
  }));

  document.querySelectorAll("#channelSettings .channel-settings").forEach((card) => {
    const index = Number(card.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const existingChannel = nextChannels[index] || {};
    const cardChannelName = String(card.dataset.channelName || "").trim();
    const existingChannelName = String(existingChannel?.name || "").trim();
    if (!existingChannelName || (cardChannelName && cardChannelName !== existingChannelName)) return;
    const channel = { ...existingChannel };
    card.querySelectorAll("[data-channel-field]").forEach((input) => {
      const field = input.dataset.channelField;
      if (input.type === "checkbox") {
        channel[field] = input.checked;
      } else if (input.value !== "") {
        channel[field] = input.value;
      }
    });

    channel.live_profile = { ...defaultLiveProfile(), ...(existingChannel.live_profile || {}), mode: "copy" };
    card.querySelectorAll("[data-live-profile-field]").forEach((input) => {
      channel.live_profile[input.dataset.liveProfileField] = coerceValue(input.value, input.type);
    });
    channel.live_profile.mode = "copy";

    const checkedRawFiles = Array.from(
      document.querySelectorAll(`#normalizationChannels [data-index="${index}"] [data-raw-file]:checked`)
    ).map((input) => input.dataset.rawFile);
    const rawFileInputs = document.querySelectorAll(`#normalizationChannels [data-index="${index}"] [data-raw-file]`);
    const existingRawPlaylist = Array.isArray(config.channels?.[index]?.raw_playlist)
      ? config.channels[index].raw_playlist
      : [];
    channel.raw_playlist = rawFileInputs.length ? checkedRawFiles : existingRawPlaylist;

    channel.normalize_profile = { ...(existingChannel.normalize_profile || {}) };
    document.querySelectorAll(`[data-normalize-index="${index}"]`).forEach((input) => {
      channel.normalize_profile[input.dataset.normalizeField] = coerceValue(input.value, input.type);
    });
    channel.normalize_profile.x264_profile = config.normalize_profile?.x264_profile || "high";

    const checkedLiveFiles = Array.from(
      document.querySelectorAll(`#channelSettings [data-index="${index}"] [data-live-file]:checked`)
    ).map((input) => input.dataset.liveFile);
    const liveFileInputs = document.querySelectorAll(`#channelSettings [data-index="${index}"] [data-live-file]`);
    const existingPlaylist = Array.isArray(config.channels?.[index]?.playlist)
      ? config.channels[index].playlist
      : [];
    channel.playlist = liveFileInputs.length ? checkedLiveFiles : existingPlaylist;
    channel.youtube_broadcast_id = String(existingChannel.youtube_broadcast_id || "");
    channel.youtube_stream_id = String(existingChannel.youtube_stream_id || "");
    channel.youtube_account_id = normalizeAccountId(channel.youtube_account_id || existingChannel.youtube_account_id || "");
    if (typeof existingChannel.stream_key_env === "string" && !channel.stream_key_env) {
      channel.stream_key_env = existingChannel.stream_key_env;
    }
    if (typeof existingChannel.youtube_studio_url === "string" && !channel.youtube_studio_url) {
      channel.youtube_studio_url = existingChannel.youtube_studio_url;
    }
    if (typeof channel.youtube_auto_start !== "boolean") {
      channel.youtube_auto_start = Boolean(existingChannel.youtube_auto_start);
    }
    if (typeof channel.youtube_auto_stop !== "boolean") {
      channel.youtube_auto_stop = Boolean(existingChannel.youtube_auto_stop);
    }
    if (typeof existingChannel.stream_key === "string" && !channel.stream_key) {
      channel.stream_key = existingChannel.stream_key;
    }

    nextChannels[index] = channel;
  });
  config.channels = nextChannels;

  document.querySelectorAll("[data-youtube-channel-field]").forEach((input) => {
    const index = Number(input.dataset.youtubeChannelIndex);
    const field = input.dataset.youtubeChannelField;
    if (!Number.isInteger(index) || !field || !config.channels?.[index]) return;
    const card = input.closest(".channel-settings");
    const cardChannelName = String(card?.dataset.channelName || "").trim();
    const existingChannelName = String(config.channels[index]?.name || "").trim();
    if (cardChannelName && cardChannelName !== existingChannelName) return;
    if (input.type === "checkbox") {
      config.channels[index][field] = input.checked;
    } else {
      config.channels[index][field] = input.value;
    }
  });

  config.channels.forEach((channel) => {
    channel.youtube_account_id = normalizeAccountId(channel.youtube_account_id || "");
  });

  return config;
}

function coerceValue(value, type) {
  if (type === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  return value;
}

function looksLikeRtmpUrl(value) {
  const text = String(value || "").trim().toLowerCase();
  return text.startsWith("rtmp://") || text.startsWith("rtmps://");
}

function validateConfigData(data) {
  const channels = Array.isArray(data?.channels) ? data.channels : [];
  for (const channel of channels) {
    const channelName = String(channel?.name || "Unnamed channel").trim() || "Unnamed channel";
    const fieldValue = String(channel?.stream_key_env || "").trim();
    if (fieldValue && looksLikeRtmpUrl(fieldValue)) {
      throw new Error(
        `Channel "${channelName}": do not paste full RTMP URL in "Manual stream key". `
        + "Paste only the stream key."
      );
    }
  }
}

function trimStreamKeyFields(data) {
  const channels = Array.isArray(data?.channels) ? data.channels : [];
  for (const channel of channels) {
    if (!channel || typeof channel !== "object") continue;
    if (typeof channel.stream_key_env === "string") {
      channel.stream_key_env = channel.stream_key_env.trim();
    }
    if (typeof channel.stream_key === "string") {
      channel.stream_key = channel.stream_key.trim();
    }
  }
}

async function createConfig() {
  await api("/api/config/create", {
    method: "POST",
    body: JSON.stringify({ config: "config.json" }),
    action: "config.create",
  });
  state.config = "config.json";
  await refresh();
  await loadConfigText();
  showTab("settings");
}

async function saveSettings() {
  const data = collectSettingsData();
  await saveConfigData(data);
  toast("Settings saved.");
}

async function saveConfigData(data) {
  trimStreamKeyFields(data);
  validateConfigData(data);
  await api("/api/config/save", {
    method: "POST",
    body: JSON.stringify({ config: state.config, text: JSON.stringify(data, null, 2) }),
    action: "config.save",
  });
  state.configData = data;
  normalizeConfigShape();
  $("configEditor").value = JSON.stringify(state.configData, null, 2) + "\n";
  renderSettingsForms();
  await refresh();
  await loadRawFiles();
  await loadNormalizedFiles();
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function syncConfigEditor() {
  if ($("configEditor")) {
    $("configEditor").value = JSON.stringify(state.configData || defaultConfigData(), null, 2) + "\n";
  }
}

function addChannel() {
  const config = state.configData || defaultConfigData();
  config.channels = Array.isArray(config.channels) ? config.channels : [];
  config.channels.push(defaultChannel(config.channels.length + 1));
  state.activeSettingsChannelIndex = config.channels.length - 1;
  setWorkspaceSelectedChannel(config.channels[state.activeSettingsChannelIndex]?.name || "");
  state.configData = config;
  state.removedChannelUndo = null;
  syncConfigEditor();
  showTab("settings");
  showSettingsTab("normalize");
  renderSettingsForms();
}

function openChannelDeleteDialog(index) {
  const config = state.configData || defaultConfigData();
  const channel = config.channels?.[index];
  const channelName = String(channel?.name || "").trim();
  if (!channelName) {
    toast("Select a named channel before removing it.");
    return;
  }

  state.channelDeleteDialog = { index, name: channelName };
  const nameNode = $("deleteChannelName");
  const input = $("deleteChannelNameInput");
  const confirmButton = $("confirmDeleteChannel");
  if (nameNode) nameNode.textContent = channelName;
  if (input) input.value = "";
  if (confirmButton) confirmButton.disabled = true;
  $("deleteChannelDialog")?.classList.remove("hidden");
  window.setTimeout(() => input?.focus(), 0);
}

function closeChannelDeleteDialog() {
  state.channelDeleteDialog = { index: -1, name: "" };
  $("deleteChannelDialog")?.classList.add("hidden");
}

function syncChannelDeleteConsent() {
  const input = $("deleteChannelNameInput");
  const confirmButton = $("confirmDeleteChannel");
  if (!input || !confirmButton) return;
  confirmButton.disabled = input.value.trim() !== state.channelDeleteDialog.name;
}

async function removeChannel(index, { confirmed = false } = {}) {
  if (!confirmed) {
    openChannelDeleteDialog(index);
    return;
  }

  const config = collectSettingsData();
  const removed = config.channels?.[index];
  if (!removed) return;
  const previousConfig = clonePlain(config);
  const previousSelectedChannelName = state.workspace.selectedChannelName;
  config.channels = (config.channels || []).filter((_channel, currentIndex) => currentIndex !== index);
  state.activeSettingsChannelIndex = Math.max(0, Math.min(index, config.channels.length - 1));
  if (removed && removed.name === state.workspace.selectedChannelName) {
    setWorkspaceSelectedChannel(config.channels[state.activeSettingsChannelIndex]?.name || "");
  }
  state.configData = config;
  state.removedChannelUndo = {
    channel: clonePlain(removed),
    index,
    previousSelectedChannelName,
  };
  syncConfigEditor();
  renderSettingsForms();
  if (state.status) {
    state.status = applyPendingChannelRemovalToStatus(state.status);
    ensureWorkspaceChannelSelection(state.status);
    renderStatus(state.status);
    renderChannels(state.status);
    renderChannelWorkspace(state.status);
  }
  toast(`Removing ${removed.name}...`);
  try {
    await saveConfigData(config);
    toast(`Removed ${removed.name}. Use Undo in Video Encoder to restore it.`);
  } catch (error) {
    state.configData = previousConfig;
    state.removedChannelUndo = null;
    setWorkspaceSelectedChannel(previousSelectedChannelName);
    syncConfigEditor();
    renderSettingsForms();
    throw error;
  }
}

async function confirmChannelDelete() {
  const { index, name } = state.channelDeleteDialog;
  const input = $("deleteChannelNameInput");
  if (input?.value.trim() !== name) return;
  const confirmButton = $("confirmDeleteChannel");
  if (confirmButton) {
    confirmButton.disabled = true;
    confirmButton.textContent = "Removing...";
  }
  closeChannelDeleteDialog();
  try {
    await removeChannel(index, { confirmed: true });
  } finally {
    if (confirmButton) {
      confirmButton.textContent = "Remove Channel";
    }
  }
}

async function undoRemoveChannel() {
  const undo = state.removedChannelUndo;
  if (!undo?.channel) {
    toast("No removed channel to undo.");
    return;
  }

  const config = collectSettingsData();
  config.channels = Array.isArray(config.channels) ? config.channels : [];
  const restoredName = String(undo.channel.name || "").trim();
  if (restoredName && config.channels.some((channel) => String(channel?.name || "").trim() === restoredName)) {
    toast(`A channel named ${restoredName} already exists.`);
    state.removedChannelUndo = null;
    renderRemovedChannelUndo();
    return;
  }

  const insertAt = Math.max(0, Math.min(Number(undo.index) || 0, config.channels.length));
  config.channels.splice(insertAt, 0, clonePlain(undo.channel));
  const previousUndo = clonePlain(undo);
  state.configData = config;
  state.activeSettingsChannelIndex = insertAt;
  setWorkspaceSelectedChannel(restoredName || undo.previousSelectedChannelName || config.channels[insertAt]?.name || "");
  state.removedChannelUndo = null;
  syncConfigEditor();
  showTab("settings");
  showSettingsTab("normalize");
  renderSettingsForms();
  toast(`Restoring ${restoredName || "channel"}...`);
  try {
    await saveConfigData(config);
    toast(`Restored ${restoredName || "channel"}.`);
  } catch (error) {
    config.channels.splice(insertAt, 1);
    state.configData = config;
    state.removedChannelUndo = previousUndo;
    syncConfigEditor();
    renderSettingsForms();
    throw error;
  }
}

function removeActiveSettingsChannel() {
  const config = state.configData || defaultConfigData();
  if (!Array.isArray(config.channels) || !config.channels.length) return;
  removeChannel(selectedSettingsChannelIndex(config));
}

async function startSettingsTask(action, index) {
  const data = collectSettingsData();
  const channel = data.channels?.[index];
  if (!channel?.name) {
    toast("Save a channel name before running this task.");
    return;
  }

  state.activeSettingsChannelIndex = index;
  await saveConfigData(data);
  await startTask(action, channel.name, false);
}

async function startTask(action, channel = null, showControl = true) {
  await api("/api/task/start", {
    method: "POST",
    body: JSON.stringify({ config: state.config, action, channel }),
    action: `task.start.${action || "unknown"}`,
  });
  if (showControl) {
    showTab("control");
  }
  await refresh();
}

async function stopTask(taskId) {
  await api("/api/task/stop", {
    method: "POST",
    body: JSON.stringify({ config: state.config, task_id: taskId }),
    action: "task.stop",
  });
  await refresh();
}

async function startStream(channel = null) {
  await api("/api/stream/start", {
    method: "POST",
    body: JSON.stringify({ config: state.config, channel }),
    action: channel ? "stream.start.channel" : "stream.start.all",
  });
  showTab("control");
  await refresh();
}

async function stopStream(channel = null) {
  await api("/api/stream/stop", {
    method: "POST",
    body: JSON.stringify({ config: state.config, channel }),
    action: channel ? "stream.stop.channel" : "stream.stop.all",
  });
  await refresh();
}

function showTab(tab) {
  state.workspace.lastSelectedByTab[tab] = state.workspace.selectedChannelName || "";
  if (tab === "control") {
    state.workspace.activeRoute = "overview";
  } else if (tab === "settings" && state.workspace.activeRoute === "overview") {
    state.workspace.activeRoute = normalizeWorkspaceRoute(Object.entries(routeToSettingsTab)
      .find((entry) => entry[1] === state.settingsTab)?.[0] || "folders");
  }
  if (tab === "settings") {
    syncActiveSettingsChannelFromWorkspace(true);
  }
  applyLegacyTabView(tab);
  renderChannelTools();
}

function showSettingsTab(tab) {
  tab = tab === "live" ? "youtube" : tab;
  state.settingsTab = tab;
  const route = Object.entries(routeToSettingsTab).find((entry) => entry[1] === tab)?.[0];
  if (route) {
    state.workspace.activeRoute = route;
  }
  applyLegacyTabView("settings");
  applySettingsSection(tab);
  renderChannelTools();
  if (tab === "liveHistory") {
    renderSettingsLiveHistory();
    fetchSettingsLiveHistory().catch((error) => toast(error.message));
  }
  if (tab === "normalize") {
    refreshActiveRawFiles({ force: true }).catch((error) => toast(error.message));
  }
  if (tab === "youtube") {
    refreshYoutubeStatus()
      .then(() => {
        if (!state.youtubeStatus?.connected) {
          state.youtubeBroadcasts = [];
          state.youtubeKeyChecks = null;
          renderYoutubeSettingsPanel(state.configData || defaultConfigData());
          return;
        }
        const selectedChannel = String(state.workspace.selectedChannelName || "").trim();
        return refreshYoutubeBroadcasts(Boolean(selectedChannel))
          .then(() => verifyYoutubeChannelKeys(selectedChannel));
      })
      .catch((error) => toast(error.message));
  }
}

function toast(message) {
  $("serverState").textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function escapeJs(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

$("tabControl").addEventListener("click", () => showTab("control"));
$("tabSettings").addEventListener("click", () => showTab("settings"));
$("settingsFoldersTab").addEventListener("click", () => showSettingsTab("folders"));
$("settingsNormalizeTab").addEventListener("click", () => showSettingsTab("normalize"));
if ($("settingsLiveHistoryTab")) {
  $("settingsLiveHistoryTab").addEventListener("click", () => showSettingsTab("liveHistory"));
}
if ($("settingsTroubleshootingTab")) {
  $("settingsTroubleshootingTab").addEventListener("click", () => showSettingsTab("troubleshooting"));
}
if ($("activityFilterAll")) $("activityFilterAll").addEventListener("click", () => setActivityFilter("all"));
if ($("activityFilterTasks")) $("activityFilterTasks").addEventListener("click", () => setActivityFilter("tasks"));
if ($("activityFilterApi")) $("activityFilterApi").addEventListener("click", () => setActivityFilter("api"));
if ($("activityFilterErrors")) $("activityFilterErrors").addEventListener("click", () => setActivityFilter("errors"));
if ($("settingsYoutubeTab")) {
  $("settingsYoutubeTab").addEventListener("click", () => showSettingsTab("youtube"));
}
if ($("settingsLiveHistoryRangeButton")) {
  $("settingsLiveHistoryRangeButton").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleHistoryDateMenu();
  });
}
if ($("settingsLiveHistorySearch")) {
  $("settingsLiveHistorySearch").addEventListener("input", renderSettingsLiveHistory);
}
document.addEventListener("click", (event) => {
  const target = event.target;
  const withinFilter = target instanceof Element && target.closest(".history-filter-wrap");
  if (withinFilter) return;
  if (state.settingsLiveHistory.menuOpen || state.settingsLiveHistory.calendarOpen) {
    state.settingsLiveHistory.menuOpen = false;
    state.settingsLiveHistory.calendarOpen = false;
    renderSettingsLiveHistory();
  }
});
document.addEventListener("pointermove", moveWorkspaceChannelPictureDrag);
document.addEventListener("pointerup", stopWorkspaceChannelPictureDrag);
document.addEventListener("pointercancel", stopWorkspaceChannelPictureDrag);
window.addEventListener("focus", () => {
  refreshActiveRawFiles().catch((error) => toast(error.message));
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshActiveRawFiles().catch((error) => toast(error.message));
  }
});

if ($("configSelect")) {
  $("configSelect").addEventListener("change", async (event) => {
    state.config = event.target.value;
    hydrateYoutubeStatusFromCache(true);
    await refresh();
    await loadConfigText();
    refreshYoutubeStatus().catch((error) => toast(error.message));
  });
}

if ($("createConfig")) {
  $("createConfig").addEventListener("click", () => createConfig().catch((error) => toast(error.message)));
}
if ($("reload")) {
  $("reload").addEventListener("click", () => refresh().then(loadConfigText).catch((error) => toast(error.message)));
}
$("saveSettings").addEventListener("click", () => saveSettings().catch((error) => toast(error.message)));
if ($("addChannelRail")) {
  $("addChannelRail").addEventListener("click", addChannel);
}
if ($("workspaceChannelSearch")) {
  $("workspaceChannelSearch").addEventListener("input", (event) => {
    state.workspace.channelSearch = event.target.value || "";
    renderWorkspaceChannelList(state.status || {});
  });
}
document.querySelectorAll("[data-route]").forEach((button) => {
  button.addEventListener("click", () => setWorkspaceRoute(button.dataset.route));
});
if ($("removeChannelNormalize")) {
  $("removeChannelNormalize").addEventListener("click", removeActiveSettingsChannel);
}
if ($("deleteChannelNameInput")) {
  $("deleteChannelNameInput").addEventListener("input", syncChannelDeleteConsent);
  $("deleteChannelNameInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !$("confirmDeleteChannel")?.disabled) {
      confirmChannelDelete().catch((error) => toast(error.message));
    }
  });
}
if ($("cancelDeleteChannel")) {
  $("cancelDeleteChannel").addEventListener("click", closeChannelDeleteDialog);
}
if ($("confirmDeleteChannel")) {
  $("confirmDeleteChannel").addEventListener("click", () => confirmChannelDelete().catch((error) => toast(error.message)));
}
if ($("cancelWorkspaceChannelEdit")) {
  $("cancelWorkspaceChannelEdit").addEventListener("click", closeWorkspaceChannelEdit);
}
if ($("saveWorkspaceChannelEditButton")) {
  $("saveWorkspaceChannelEditButton").addEventListener("click", () => saveWorkspaceChannelEdit().catch((error) => toast(error.message)));
}
if ($("workspaceChannelEditDialog")) {
  $("workspaceChannelEditDialog").addEventListener("click", (event) => {
    if (event.target === $("workspaceChannelEditDialog")) {
      closeWorkspaceChannelEdit();
    }
  });
}
if ($("deleteChannelDialog")) {
  $("deleteChannelDialog").addEventListener("click", (event) => {
    if (event.target === $("deleteChannelDialog")) {
      closeChannelDeleteDialog();
    }
  });
}
if ($("undoRemoveChannel")) {
  $("undoRemoveChannel").addEventListener("click", () => undoRemoveChannel().catch((error) => toast(error.message)));
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("workspaceChannelEditDialog")?.classList.contains("hidden")) {
    closeWorkspaceChannelEdit();
  }
  if (event.key === "Escape" && !$("deleteChannelDialog")?.classList.contains("hidden")) {
    closeChannelDeleteDialog();
  }
});
if ($("startAll")) {
  $("startAll").addEventListener("click", () => {
    const streams = state.status?.streams || {};
    const anyRunning = Object.values(streams).some((stream) => stream?.running);
    const action = anyRunning ? stopStream : startStream;
    action().catch((error) => toast(error.message));
  });
}
if ($("stopAll")) {
  $("stopAll").addEventListener("click", () => stopStream().catch((error) => toast(error.message)));
}
if ($("workspaceVerifyAll")) {
  $("workspaceVerifyAll").addEventListener("click", () => {
    verifyYoutubeChannelKeys().catch((error) => toast(error.message));
  });
}
if ($("railOpenDashboard")) {
  $("railOpenDashboard").addEventListener("click", () => openWorkspaceRoute("control"));
}
if ($("railOpenNormalize")) {
  $("railOpenNormalize").addEventListener("click", () => openWorkspaceRoute("normalize"));
}
if ($("railOpenLive")) {
  $("railOpenLive").addEventListener("click", () => openWorkspaceRoute("live"));
}
if ($("railOpenYoutube")) {
  $("railOpenYoutube").addEventListener("click", () => openWorkspaceRoute("youtube"));
}
if ($("previewChannelSelect")) {
  $("previewChannelSelect").addEventListener("change", (event) => {
    state.previewChannel = event.target.value;
    renderPreview(state.status?.streams || {});
  });
}
if ($("restartToUpdate")) {
  $("restartToUpdate").addEventListener("click", async () => {
    const bridge = desktopBridge();
    if (!bridge || typeof bridge.requestRestartToUpdate !== "function") return;
    try {
      await bridge.requestRestartToUpdate();
    } catch (error) {
      toast(error.message);
    }
  });
}
if ($("closeUiOnly")) {
  $("closeUiOnly").addEventListener("click", () => closeUiOnly().catch((error) => toast(error.message)));
}
if ($("stopAndExit")) {
  $("stopAndExit").addEventListener("click", () => stopStreamsAndExit().catch((error) => toast(error.message)));
}

function isTrustedYoutubeAuthOrigin(origin) {
  if (origin === window.location.origin) return true;
  try {
    const incoming = new URL(origin);
    const current = new URL(window.location.href);
    const redirectUri = String((state.configData || {}).youtube?.redirect_uri || defaultYoutubeSettings().redirect_uri || "");
    const redirect = redirectUri ? new URL(redirectUri) : null;
    if (redirect && incoming.origin === redirect.origin) return true;
    const localHosts = new Set(["127.0.0.1", "localhost"]);
    return localHosts.has(incoming.hostname)
      && localHosts.has(current.hostname)
      && incoming.port === current.port;
  } catch {
    return false;
  }
}

window.addEventListener("message", (event) => {
  const payload = event.data || {};
  if (payload.type !== "youtube-auth") return;
  if (!isTrustedYoutubeAuthOrigin(event.origin)) return;
  if (payload.status === "ok") {
    loadConfigText()
      .then(() => refreshYoutubeStatus())
      .then(() => refresh())
      .then(() => refreshYoutubeBroadcasts(true))
      .then(() => {
        const subscriberText = youtubeSubscriberText(payload);
        const connectedName = payload.channel_title
          ? `Connected to ${payload.channel_title}${subscriberText ? ` (${subscriberText})` : ""}.`
          : "YouTube account connected.";
        setYoutubeAction("success", connectedName);
        toast(connectedName);
      })
      .catch((error) => toast(error.message));
    return;
  }
  if (payload.status === "error") {
    if (payload.account_id) {
      state.youtubeSelectedAccountId = normalizeAccountId(payload.account_id);
    }
    setYoutubeAction("error", payload.message || "YouTube connection failed.");
    loadConfigText()
      .then(() => refreshYoutubeStatus())
      .then(() => refresh())
      .catch(() => {});
    toast(payload.message || "YouTube connection failed.");
  }
});

showSettingsTab(state.settingsTab);
initActivityStreamSplitter();
initDesktopIntegration().catch(() => {});
renderCachedDashboard();
refresh()
  .then(loadConfigText)
  .then(() => {
    hydrateYoutubeStatusFromCache(true);
    if (state.status) {
      renderChannelWorkspace(state.status);
    }
    return refreshYoutubeStatus();
  })
  .catch((error) => {
    markBootReady();
    toast(error.message);
  });
setInterval(() => refresh().catch((error) => toast(error.message)), 2500);
