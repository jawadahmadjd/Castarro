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
    alertsMenuOpen: false,
    loading: { channelSwitch: false, module: null },
  },
  activeTab: "control",
  settingsTab: "normalize",
  rawFilesByChannel: {},
  normalizedFilesByChannel: {},
  rawFilesAutoRefreshBusy: false,
  rawFilesAutoRefreshLastAt: 0,
  settingsRenderPausedUntil: 0,
  settingsAutosaveTimer: null,
  settingsAutosaveBusy: false,
  settingsAutosaveQueued: false,
  settingsAutosaveLastSignature: "",
  settingsAutosaveLastAt: 0,
  normalizeFileListScroll: {},
  activeSettingsChannelIndex: 0,
  liveVideoDrag: null,
  channelDeleteDialog: { index: -1, name: "" },
  removedChannelUndo: null,
  hadRunningSettingsTask: false,
  expandedTaskLogs: {},
  previewEnabled: true,
  previewRequestInFlight: "",
  previewStopInFlight: false,
  previewUrl: "",
  previewHls: null,
  appVersion: null,
  updateStatus: null,
  usageMetrics: null,
  youtubeStatus: null,
  storageStatus: null,
  youtubeBroadcasts: [],
  youtubeKeyChecks: null,
  youtubeAutoVerifyInFlightKey: "",
  youtubeAutoVerifyLastKey: "",
  youtubeAutoVerifyLastAt: 0,
  youtubeStatusLoading: false,
  youtubeBroadcastsLoading: false,
  youtubeBroadcastsLoadedKey: "",
  youtubeBroadcastsFailedKey: "",
  youtubeBroadcastsLoadError: "",
  youtubeActionBusy: "",
  youtubeActionMessage: "",
  youtubeActionStatus: "idle",
  youtubeActionAt: "",
  youtubeExpandedCards: {},
  youtubeSelectedAccountId: "",
  youtubeImportedBroadcastId: "",
  youtubeScheduleDraft: null,
  storageConnectBusyProviderId: "",
  cloudBrowser: {
    open: false,
    channelIndex: -1,
    providerId: "",
    folderId: "root",
    folderName: "Google Drive",
    parentId: "",
    items: [],
    loading: false,
    error: "",
    addingFileId: "",
  },
  localActivityEvents: [],
  activityRenderedItems: [],
  activityExportedSignature: "",
  deliveredAlertIds: [],
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
  syncStatus: null,
  syncPairing: null,
};

const $ = (id) => document.getElementById(id);
const desktopBridge = () => (window.desktopShell && typeof window.desktopShell === "object" ? window.desktopShell : null);
const ACTIVITY_STREAM_SPLIT_KEY = "castarro.activityStreamSplitRatio.v1";
const WORKSPACE_SELECTED_CHANNEL_KEY = "castarro.workspace.selectedChannel.v1";
const DASHBOARD_CACHE_KEY = "castarro.dashboard.frontPage.v1";
const YOUTUBE_STATUS_CACHE_KEY = "castarro.youtube.status.v1";
const PREVIEW_ENABLED_KEY = "castarro.preview.enabled.v1";
const WORKSPACE_ROUTES = ["overview", "encoder", "youtube", "history", "troubleshoot"];
const SCHEDULE_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const routeToSettingsTab = {
  encoder: "normalize",
  youtube: "youtube",
  history: "liveHistory",
  troubleshoot: "troubleshooting",
};

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  if (unitIndex === 0) return `${Math.round(amount)} ${units[unitIndex]}`;
  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unitIndex]}`;
}

function formatCpuUsage(value) {
  const percent = Math.max(0, Number(value) || 0);
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function formatFps(value) {
  const fps = Number(value);
  if (!Number.isFinite(fps) || fps < 0) return "Unavailable";
  return `${fps >= 10 ? fps.toFixed(1) : fps.toFixed(2)} fps`;
}

function formatSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed < 0) return "Unavailable";
  return `${speed.toFixed(2)}x`;
}

function formatBitrate(value) {
  const bps = Number(value);
  if (!Number.isFinite(bps) || bps <= 0) return "Unavailable";
  const units = ["bps", "Kbps", "Mbps", "Gbps"];
  let amount = bps;
  let unitIndex = 0;
  while (amount >= 1000 && unitIndex < units.length - 1) {
    amount /= 1000;
    unitIndex += 1;
  }
  const decimals = amount >= 10 || unitIndex === 0 ? 1 : 2;
  return `${amount.toFixed(decimals)} ${units[unitIndex]}`;
}

function usageProcessPids(payload) {
  return Object.values(payload?.streams || {})
    .map((stream) => Number(stream?.pid))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
}

function renderUsageMetrics(payload = state.status) {
  const cpuNode = $("workspaceUsageCpu");
  const gpuNode = $("workspaceUsageGpu");
  const ramNode = $("workspaceUsageRam");
  const dataNode = $("workspaceUsageData");
  const metrics = state.usageMetrics || {};
  const usage = payload?.usage || {};
  if (cpuNode) {
    cpuNode.textContent = Number.isFinite(Number(metrics.cpuPercent)) ? formatCpuUsage(metrics.cpuPercent) : "Unavailable";
  }
  if (gpuNode) {
    gpuNode.textContent =
      metrics.gpuStatus === "unavailable" || !Number.isFinite(Number(metrics.gpuPercent))
        ? "Unavailable"
        : formatCpuUsage(metrics.gpuPercent);
    gpuNode.title = metrics.gpuDetail || "";
  }
  if (ramNode) {
    ramNode.textContent = Number.isFinite(Number(metrics.memoryBytes)) ? formatBytes(metrics.memoryBytes) : "Unavailable";
  }
  if (dataNode) {
    dataNode.textContent = formatBytes(usage.stream_transfer_today_bytes || 0);
  }
}

async function refreshUsageMetrics(payload) {
  const bridge = desktopBridge();
  if (!bridge || typeof bridge.getUsageMetrics !== "function") {
    state.usageMetrics = null;
    renderUsageMetrics(payload);
    return;
  }
  try {
    state.usageMetrics = await bridge.getUsageMetrics({ pids: usageProcessPids(payload) });
  } catch {
    state.usageMetrics = null;
  }
  renderUsageMetrics(payload);
}

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

const defaultStorageProviderOauth = () => ({
  client_id: "",
  client_secret: "",
  redirect_uri: "http://127.0.0.1:8765/oauth2redirect",
  oauth_client_type: "desktop",
  use_pkce: true,
  scopes: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
});

const defaultStorageProvider = () => ({
  id: "google-drive-main",
  type: "googleDrive",
  display_name: "Google Drive",
  auth_mode: "oauth",
  tokens_file: ".runtime/google_drive_tokens_google-drive-main.json",
  account_email: "",
  status: "",
  oauth: defaultStorageProviderOauth(),
});

const defaultStorageSettings = () => ({
  providers: [defaultStorageProvider()],
  source_proxy: {
    host: "127.0.0.1",
    port: 8876,
    cache_dir: ".runtime/cloud-cache",
    startup_buffer_mb: 64,
    max_cache_mb: 2048,
    spool_before_start: false,
  },
});

const defaultAlertSettings = () => ({
  desktop_notifications_enabled: true,
  mobile_notifications_enabled: true,
  cooldown_seconds: 300,
  rules: {
    stream_stopped: true,
    poor_connection: true,
    scheduler_started: true,
    scheduler_stopped: true,
  },
});

const defaultSchedulerSettings = () => ({
  enabled: false,
  timezone: "local",
  poll_seconds: 20,
  channels: [],
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
  storage: defaultStorageSettings(),
  alerts: defaultAlertSettings(),
  scheduler: defaultSchedulerSettings(),
  ui: {
    channel_workspace_enabled: true,
    legacy_tabs_enabled: false,
  },
  channels: [],
});

function normalizedStorageProviders(config) {
  const storage = { ...defaultStorageSettings(), ...(config?.storage || {}) };
  const raw = Array.isArray(storage.providers) ? storage.providers : defaultStorageSettings().providers;
  return raw.map((provider, index) => {
    const fallback = index === 0 ? defaultStorageProvider() : {
      ...defaultStorageProvider(),
      id: String(provider?.id || `storage-${index + 1}`).trim() || `storage-${index + 1}`,
      display_name: String(provider?.display_name || provider?.displayName || `Storage ${index + 1}`).trim() || `Storage ${index + 1}`,
      type: String(provider?.type || "googleDrive").trim() || "googleDrive",
      tokens_file: String(provider?.tokens_file || provider?.tokensFile || "").trim() || `.runtime/storage_tokens_${index + 1}.json`,
    };
    return {
      ...fallback,
      ...(provider || {}),
      oauth: {
        ...defaultStorageProviderOauth(),
        ...((provider && typeof provider.oauth === "object") ? provider.oauth : {}),
      },
    };
  });
}

const defaultChannel = (index) => ({
  name: `channel_${index}`,
  enabled: true,
  stream_key_env: `YT_CHANNEL_${index}_KEY`,
  raw_playlist: [`Raw Videos/channel_${index}/video-001.mp4`],
  playlist: [],
  cloud_playlist: [],
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

function readPreviewEnabled() {
  try {
    const saved = window.localStorage.getItem(PREVIEW_ENABLED_KEY);
    if (saved === null) return true;
    return saved !== "false";
  } catch {
    return true;
  }
}

function writePreviewEnabled(value) {
  state.previewEnabled = value !== false;
  try {
    window.localStorage.setItem(PREVIEW_ENABLED_KEY, state.previewEnabled ? "true" : "false");
  } catch {
    // Ignore storage failures; preview can still work for this session.
  }
}

function isOverviewVisible() {
  return state.activeTab === "control" && normalizeWorkspaceRoute(state.workspace.activeRoute) === "overview";
}

function runningPreviewCandidates(streams = state.status?.streams || {}) {
  return Object.values(streams || {}).filter((stream) => stream?.running);
}

function selectedPreviewChannelName(streams = state.status?.streams || {}) {
  const running = runningPreviewCandidates(streams);
  if (!running.length) return "";
  const selectedWorkspaceChannel = String(state.workspace.selectedChannelName || "").trim();
  if (selectedWorkspaceChannel && running.some((stream) => stream.name === selectedWorkspaceChannel)) {
    return selectedWorkspaceChannel;
  }
  return running[0].name;
}

async function requestPreviewStart(channelName) {
  const target = String(channelName || "").trim();
  if (!target || state.previewRequestInFlight === target) return;
  state.previewRequestInFlight = target;
  state.previewStopInFlight = false;
  try {
    await api("/api/preview/start", {
      method: "POST",
      action: "preview.start",
      body: JSON.stringify({ config: state.config, channel: target }),
    });
  } finally {
    if (state.previewRequestInFlight === target) {
      state.previewRequestInFlight = "";
    }
  }
}

async function requestPreviewStop(channelName = "") {
  if (state.previewStopInFlight) return;
  state.previewStopInFlight = true;
  const target = String(channelName || "").trim();
  try {
    await api("/api/preview/stop", {
      method: "POST",
      action: "preview.stop",
      body: JSON.stringify({ config: state.config, ...(target ? { channel: target } : {}) }),
    });
  } finally {
    state.previewStopInFlight = false;
    if (!target || state.previewRequestInFlight === target) {
      state.previewRequestInFlight = "";
    }
  }
}

function syncPreviewLifecycle(streams = state.status?.streams || {}) {
  const previewState = state.status?.preview || {};
  const previewChannel = String(previewState.channel || "").trim();
  const desiredChannel = selectedPreviewChannelName(streams);
  const shouldRunPreview = Boolean(state.previewEnabled && isOverviewVisible() && desiredChannel);

  if (!shouldRunPreview) {
    detachPreviewPlayer();
    if (previewChannel) {
      requestPreviewStop(previewChannel).catch((error) => toast(error.message));
    }
    return;
  }

  if (previewChannel === desiredChannel && previewState.running) return;
  requestPreviewStart(desiredChannel).catch((error) => toast(error.message));
}

function isChannelWorkspaceEnabled() {
  return Boolean(state.configData?.ui?.channel_workspace_enabled);
}

state.previewEnabled = readPreviewEnabled();

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

function workspaceRecentAlerts(payload = state.status) {
  const selectedChannel = selectedWorkspaceChannelName();
  const recent = Array.isArray(payload?.alerts?.recent) ? payload.alerts.recent : [];
  return recent.filter((item) => {
    const channel = String(item?.channel_name || "").trim();
    return !selectedChannel || !channel || channel === selectedChannel;
  }).slice(0, 4);
}

function rerenderWorkspaceHeader(payload = state.status || {}) {
  const selected = getSelectedChannel({ channels: payload?.channels || [] }, state.workspace.selectedChannelName);
  renderWorkspaceHeader(payload || {}, selected);
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
  const hadStatus = Boolean(state.status);
  state.status = visiblePayload;
  state.storageStatus = visiblePayload.storage || state.storageStatus;
  if (hadStatus) {
    deliverDesktopAlerts(visiblePayload);
  } else {
    rememberDeliveredAlertIds((visiblePayload?.alerts?.recent || []).map((item) => Number(item?.id || 0)));
  }

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
  renderUsageMetrics(visiblePayload);
  refreshUsageMetrics(visiblePayload).catch(() => {});
  refreshSyncStatus().catch(() => {});
  renderPreview(visiblePayload.streams);
  syncPreviewLifecycle(visiblePayload.streams);
  renderLiveHistory(visiblePayload.stream_history || []);
  renderTasks(visiblePayload.tasks, visiblePayload.activity_events || []);
  renderLogs(visiblePayload.streams);
  const runningSettingsTask = visiblePayload.tasks.some((task) => ["normalize", "validate", "test-stream"].includes(task.name) && task.running);
  if (state.activeTab === "settings" && (runningSettingsTask || state.hadRunningSettingsTask)) {
    renderSettingsFormsUnlessPaused();
  }
  if (!runningSettingsTask && state.hadRunningSettingsTask) {
    loadNormalizedFiles()
      .then(() => renderYoutubeSettingsPanel(state.configData || defaultConfigData()))
      .catch((error) => toast(error.message));
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
  syncPreviewLifecycle(payload.streams || {});
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

  $("serverState").textContent = payload.config_exists ? `${running} live stream${running === 1 ? "" : "s"}` : "Config needed";
  const startAllButton = $("startAll");
  if (startAllButton) {
    const anyRunning = running > 0;
    startAllButton.textContent = anyRunning ? "Stop all streams" : "Start All Streams";
    startAllButton.classList.toggle("success", !anyRunning);
    startAllButton.classList.toggle("danger", anyRunning);
    startAllButton.setAttribute("aria-label", anyRunning ? "Stop all streams" : "Start All Streams");
  }
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
      verifyNode.textContent = "YouTube key check: pending.";
      verifyNode.className = "badge";
    } else {
      const enforceable = checks.filter((item) => String(item?.status || "") !== "missing_account");
      const matched = enforceable.filter((item) => Boolean(item?.ok)).length;
      verifyNode.textContent = `YouTube key check: ${matched}/${enforceable.length || 0} mapped channels matched`;
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
    const streamAction = live ? "stopStream" : "startStream";
    const streamButtonClass = live ? "pill danger" : "pill success";
    const streamButtonLabel = live ? "Stop" : "Start";
    return `
      <article class="card">
        <div class="card-head">
          <div class="channel-name">${escapeHtml(channel.name)}</div>
          <span class="badge ${live ? "live" : ""}">${live ? "Live" : channel.enabled ? "Ready" : "Disabled"}</span>
        </div>
        <div class="meta">${channel.raw_playlist_count || 0} raw item${channel.raw_playlist_count === 1 ? "" : "s"} - ${channel.normalized_count || 0} normalized item${channel.normalized_count === 1 ? "" : "s"} - ${channel.cloud_playlist_count || 0} cloud item${channel.cloud_playlist_count === 1 ? "" : "s"} - ${channel.playlist_count} playlist override${channel.playlist_count === 1 ? "" : "s"} - ${escapeHtml(key)}</div>
        <div class="meta">
          <span class="badge ${autoReady ? "live" : "warn"}">${escapeHtml(autoText)}</span>
          ${studio}
        </div>
        <div class="mini-actions">
          <button class="${streamButtonClass}" onclick="${streamAction}('${escapeJs(channel.name)}')">${streamButtonLabel}</button>
          <button class="pill" onclick="startTask('test-stream', '${escapeJs(channel.name)}', false)">Test Stream</button>
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
    folders: "encoder",
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
            <span>${escapeHtml(connectionText)}  -  ${escapeHtml(liveText)}</span>
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
    encoder: "Source videos and encoder profile for this channel.",
    youtube: "Go live, schedule broadcasts, manage stream keys, and choose videos for this channel.",
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
    state.workspace.alertsMenuOpen = false;
    actionsNode.innerHTML = `<button class="pill primary" type="button" onclick="addChannel()">Add Channel</button>`;
    return;
  }
  const escapedName = escapeJs(channel.name);
  const stream = payload?.streams?.[channel.name] || null;
  const streamRunning = Boolean(stream?.running);
  const streamAction = streamRunning ? "stopStream" : "startStream";
  const streamButtonClass = streamRunning ? "pill danger" : "pill success";
  const streamButtonLabel = streamRunning ? "Stop Stream" : "Start Stream";
  const alerts = workspaceRecentAlerts(payload);
  const hasDangerAlerts = alerts.some((item) => String(item?.severity || "") === "danger");
  const alertBadgeClass = hasDangerAlerts ? "badge warn" : alerts.length ? "badge" : "badge live";
  const alertSummary = `${alerts.length} notification${alerts.length === 1 ? "" : "s"}`;
  actionsNode.innerHTML = `
    <div class="workspace-header-controls">
      <div class="workspace-alerts-menu">
        <button
          class="pill ghost icon-only workspace-alerts-toggle"
          type="button"
          title="Notifications"
          aria-label="Notifications"
          aria-haspopup="dialog"
          aria-expanded="${state.workspace.alertsMenuOpen ? "true" : "false"}"
          onclick="event.stopPropagation(); toggleWorkspaceAlertsMenu()"
        >
          <span aria-hidden="true">&#128276;</span>
          ${alerts.length ? `<span class="workspace-alerts-count ${hasDangerAlerts ? "warn" : ""}">${alerts.length}</span>` : ""}
        </button>
        <div class="workspace-alerts-popover ${state.workspace.alertsMenuOpen ? "" : "hidden"}" id="workspaceAlertsPopover" aria-label="Latest notifications">
          <div class="workspace-alerts-popover-head">
            <strong>Notifications</strong>
            <span class="${alertBadgeClass}">${escapeHtml(alertSummary)}</span>
          </div>
          ${alerts.length
            ? `<div class="workspace-alerts-feed">${alerts.map((item) => `
                <article class="workspace-alert-item ${escapeAttr(item.severity || "info")}">
                  <div class="workspace-alert-item-head">
                    <strong>${escapeHtml(item.title || "Alert")}</strong>
                    <span class="helper">${escapeHtml(formatDateTime(item.created_at || ""))}</span>
                  </div>
                  <p>${escapeHtml(item.message || "")}</p>
                </article>
              `).join("")}</div>`
            : `<p class="helper">No recent alerts for this workspace.</p>`}
        </div>
      </div>
      <button class="${streamButtonClass}" type="button" onclick="${streamAction}('${escapedName}').catch((error) => toast(error.message))">${streamButtonLabel}</button>
    </div>
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
  const metricsNode = $("workspaceLiveMetricsPanel");
  if (!channel) {
    if (readinessNode) readinessNode.innerHTML = `<div class="notice warn">Select a channel to see readiness.</div>`;
    if (metricsNode) metricsNode.innerHTML = `<div class="notice warn">Select a channel to inspect live stream frame delivery.</div>`;
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
  if (metricsNode) {
    const stream = payload?.streams?.[channel.name] || null;
    const stats = stream?.stream_stats || {};
    const targetFps = Number(stats.target_fps);
    const outputFps = Number(stats.output_fps);
    const badgeTone = ["success", "warn", "danger"].includes(String(stats.health_tone || "")) ? stats.health_tone : "";
    const badgeLabel = String(stats.health_label || (stream?.running ? "Collecting" : "Idle"));
    const outputLabel = Number.isFinite(outputFps)
      ? `${formatFps(outputFps)}${Number.isFinite(targetFps) ? ` / ${formatFps(targetFps)} target` : ""}`
      : stream?.running
        ? "Collecting live FPS"
        : "Idle";
    const realtimeSpeed = Number.isFinite(Number(stats.speed)) ? formatSpeed(stats.speed) : stream?.running ? "Collecting" : "Idle";
    const bitrateLabel = Number.isFinite(Number(stats.average_bitrate_bps))
      ? formatBitrate(stats.average_bitrate_bps)
      : stream?.running
        ? "Unavailable"
        : "Idle";
    const sentDataLabel = Number.isFinite(Number(stats.total_size_bytes)) && Number(stats.total_size_bytes) > 0
      ? formatBytes(stats.total_size_bytes)
      : stream?.running
        ? "Collecting"
        : "0 B";
    const dropFrames = Number.isFinite(Number(stats.drop_frames)) ? Number(stats.drop_frames) : 0;
    const dupFrames = Number.isFinite(Number(stats.dup_frames)) ? Number(stats.dup_frames) : 0;
    metricsNode.innerHTML = `
      <div class="workspace-inline-stats ${stream?.running ? "" : "idle"}">
        <span class="workspace-inline-stat">
          <span class="field-hint">Health</span>
          <strong class="${badgeTone === "danger" ? "text-danger" : badgeTone === "warn" ? "text-warn" : ""}">${escapeHtml(badgeLabel)}</strong>
        </span>
        <span class="workspace-inline-stat">
          <span class="field-hint">FPS</span>
          <strong>${escapeHtml(outputLabel)}</strong>
        </span>
        <span class="workspace-inline-stat">
          <span class="field-hint">Speed</span>
          <strong>${escapeHtml(realtimeSpeed)}</strong>
        </span>
        <span class="workspace-inline-stat">
          <span class="field-hint">Bitrate</span>
          <strong>${escapeHtml(bitrateLabel)}</strong>
        </span>
        <span class="workspace-inline-stat">
          <span class="field-hint">Sent</span>
          <strong>${escapeHtml(sentDataLabel)}</strong>
        </span>
        <span class="workspace-inline-stat workspace-inline-stat-message ${stream?.running ? "" : "workspace-inline-stat-wide"}">
          <span class="field-hint">${stream?.running ? "Frames" : "Live Feed"}</span>
          <strong>${escapeHtml(stream?.running ? `${dropFrames} drop / ${dupFrames} dup` : "Start the stream to watch live delivery stats.")}</strong>
        </span>
      </div>
    `;
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
  $("settingsNormalizeTab")?.classList.toggle("active", tab === "normalize");
  $("settingsStorageTab")?.classList.toggle("active", tab === "storage");
  $("settingsYoutubeTab")?.classList.toggle("active", tab === "youtube");
  $("settingsAutomationTab")?.classList.toggle("active", tab === "automation");
  $("settingsLiveHistoryTab")?.classList.toggle("active", tab === "liveHistory");
  $("settingsTroubleshootingTab")?.classList.toggle("active", tab === "troubleshooting");
  $("settingsNormalizeView")?.classList.toggle("active", tab === "normalize");
  $("settingsStorageView")?.classList.toggle("active", tab === "storage");
  $("settingsYoutubeView")?.classList.toggle("active", tab === "youtube");
  $("settingsAutomationView")?.classList.toggle("active", tab === "automation");
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
    syncPreviewLifecycle(payload?.streams || {});
    return;
  }
  detachPreviewPlayer();
  syncPreviewLifecycle(payload?.streams || {});
  const settingsTab = routeToSettingsTab[route] || "normalize";
  applyLegacyTabView("settings");
  state.settingsTab = settingsTab;
  applySettingsSection(settingsTab);
  syncActiveSettingsChannelFromWorkspace(false);
  if (settingsTab !== "troubleshooting") {
    renderSettingsFormsUnlessPaused();
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

function settingsFormInteractionActive() {
  const active = document.activeElement;
  if (!(active instanceof Element)) return false;
  return Boolean(active.closest("#viewSettings input, #viewSettings select, #viewSettings textarea"));
}

function pauseSettingsRender(durationMs = 1200) {
  state.settingsRenderPausedUntil = Math.max(
    Number(state.settingsRenderPausedUntil) || 0,
    Date.now() + durationMs
  );
}

function shouldDeferSettingsRender() {
  if (state.activeTab !== "settings") return false;
  return settingsFormInteractionActive() || Date.now() < Number(state.settingsRenderPausedUntil || 0);
}

function renderSettingsFormsUnlessPaused() {
  if (shouldDeferSettingsRender()) return false;
  renderSettingsForms();
  return true;
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
      await autoVerifySelectedYoutubeChannel({ channelName: channel.name });
      await refreshYoutubeBroadcasts(true, { silent: true });
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
  state.youtubeBroadcastsLoadedKey = "";
  state.youtubeBroadcastsFailedKey = "";
  state.youtubeBroadcastsLoadError = "";
  state.youtubeImportedBroadcastId = "";
  state.youtubeScheduleDraft = null;
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
          state.youtubeBroadcastsLoadedKey = "";
          state.youtubeBroadcastsFailedKey = "";
          state.youtubeBroadcastsLoadError = "";
          state.youtubeKeyChecks = null;
          renderYoutubeSettingsPanel(state.configData || defaultConfigData());
          return null;
        }
        const selectedChannel = String(state.workspace.selectedChannelName || "").trim();
        return refreshYoutubeBroadcasts(Boolean(selectedChannel), { silent: true })
          .then(() => autoVerifySelectedYoutubeChannel({ channelName: selectedChannel }));
      })
      .catch((error) => toast(error.message));
  }
}

function setWorkspaceRoute(routeName) {
  const route = normalizeWorkspaceRoute(routeName);
  state.workspace.activeRoute = route;
  state.settingsRenderPausedUntil = 0;
  document.activeElement?.blur?.();
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
  const runOrder = buildRunOrder(taskList);
  const items = buildActivityItems(selectedChannel, tasks, events);

  updateActivityExportButton(items);
  if (!selectedChannel) {
    container.innerHTML = `<div class="task">Select a channel to view troubleshooting activity.</div>`;
    state.activityRenderedItems = [];
    return;
  }
  if (!items.length) {
    container.innerHTML = `<div class="task">No activity yet for ${escapeHtml(selectedChannel)}. Normalize, validate, schedule, or connect YouTube to see output here.</div>`;
    state.activityRenderedItems = [];
    return;
  }

  container.innerHTML = `
    <article class="task activity-unified">
      <div class="activity-unified-head">
        <div class="task-title-main">
          <span>Execution Timeline</span>
        </div>
        <div class="row wrap">
          <span class="badge">${escapeHtml(`${items.length} shown`)}</span>
        </div>
      </div>
      <div class="task-meta">
        <span>${escapeHtml(`${items.length} ${selectedChannel} entries`)}</span>
        <span>Newest to oldest</span>
      </div>
      <div class="activity-stream">
        ${items.map((item) => item.kind === "task"
      ? taskActivityEntryMarkup(item.task, runOrder)
      : appEventEntryMarkup(item.event)).join("")}
      </div>
    </article>
  `;

  restoreLogScrolls("#tasks pre[data-log-id]", scrollState);
  state.activityRenderedItems = items;
  if (hadExisting && panelScroll.topPinned) {
    container.scrollTop = 0;
  } else {
    container.scrollTop = panelScroll.top;
    container.scrollLeft = panelScroll.left;
  }
}

function buildActivityItems(channelName, tasks = state.status?.tasks || [], events = state.status?.activity_events || []) {
  const selectedChannel = String(channelName || "").trim();
  const taskList = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => selectedChannel && taskChannelName(task) === selectedChannel);
  const backendEvents = Array.isArray(events) ? events : [];
  const localEvents = Array.isArray(state.localActivityEvents) ? state.localActivityEvents : [];
  const eventList = [...localEvents, ...backendEvents]
    .filter((event) => selectedChannel && eventChannelName(event) === selectedChannel);

  return [
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

function activityExportSignature(items) {
  return JSON.stringify((Array.isArray(items) ? items : []).map((item) => {
    if (item.kind === "task") {
      const task = item.task || {};
      return [
        "task",
        task.id,
        task.name,
        taskChannelName(task),
        task.running,
        task.returncode,
        task.started_at,
        task.finished_at,
        task.progress?.message || "",
        Array.isArray(task.lines) ? task.lines.join("\n") : "",
      ];
    }
    const event = item.event || {};
    return [
      "event",
      event.id,
      event.event_type,
      eventChannelName(event),
      event.created_at,
      JSON.stringify(event.details || {}),
    ];
  }));
}

function updateActivityExportButton(items = buildActivityItems(selectedWorkspaceChannelName())) {
  const button = $("exportActivityLogsButton");
  if (!button) return;
  const signature = activityExportSignature(items);
  const exported = Boolean(signature && state.activityExportedSignature === signature);
  button.classList.toggle("success", exported);
  button.classList.toggle("ghost", !exported);
  button.title = exported ? "Activity Logs Exported" : "Export Activity Logs";
  button.setAttribute("aria-label", button.title);
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
    .filter((session) => !selectedChannel || String(session?.channel_name || "") === selectedChannel)
    .sort((a, b) => {
      const aTime = parseIsoDate(a?.started_at)?.getTime() || 0;
      const bTime = parseIsoDate(b?.started_at)?.getTime() || 0;
      return bTime - aTime;
    });
  const previewItems = items.slice(0, 5);
  count.textContent = `${previewItems.length} session${previewItems.length === 1 ? "" : "s"}`;

  if (!selectedChannel) {
    total.textContent = "Total 0s";
    list.innerHTML = `<div class="live-history-empty">Select a channel to view live history.</div>`;
    return;
  }

  if (!previewItems.length) {
    total.textContent = "Total 0s";
    list.innerHTML = `<div class="live-history-empty">No live sessions recorded for ${escapeHtml(selectedChannel)} yet.</div>`;
    return;
  }

  const nowMs = Date.now();
  const totalSeconds = previewItems.reduce((sum, item) => sum + sessionDurationSeconds(item, nowMs), 0);
  total.textContent = `Total ${durationText(totalSeconds)}`;

  const rows = previewItems.map((session) => {
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
      <button class="live-history-row ${isLive ? "current" : ""}" type="button" onclick="setWorkspaceRoute('history')" aria-label="Open History for ${escapeAttr(title)}">
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
      </button>
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
  const toggle = $("previewEnabledToggle");
  const badge = $("previewStatus");
  const video = $("programPreview");
  const empty = $("previewEmpty");
  const warning = $("previewWarning");
  if (!toggle || !badge || !video || !empty || !warning) return;

  const running = runningPreviewCandidates(streams);
  toggle.checked = state.previewEnabled;

  if (!running.length) {
    badge.textContent = "Idle";
    badge.className = "badge";
    empty.textContent = "Start the selected channel to see live preview here.";
    empty.style.display = "grid";
    warning.textContent = "";
    warning.classList.add("hidden");
    detachPreviewPlayer();
    return;
  }

  const selectedName = selectedPreviewChannelName(streams);
  const selected = running.find((stream) => stream.name === selectedName) || running[0];
  if (!selected) return;

  if (!state.previewEnabled) {
    badge.textContent = "Off";
    badge.className = "badge";
    empty.textContent = "Preview is turned off.";
    empty.style.display = "grid";
    warning.textContent = "";
    warning.classList.add("hidden");
    detachPreviewPlayer();
    return;
  }

  if (!isOverviewVisible()) {
    badge.textContent = "Paused";
    badge.className = "badge";
    empty.textContent = "Open Overview to start the live preview.";
    empty.style.display = "grid";
    warning.textContent = "";
    warning.classList.add("hidden");
    detachPreviewPlayer();
    return;
  }

  const previewActive = Boolean(selected.preview_url);
  const buffering = previewActive && !selected.preview_ready;
  const previewWarningText = String(selected.preview_warning || "").trim();
  if (!previewActive) {
    badge.textContent = "Starting";
    badge.className = "badge";
    empty.textContent = `Preview is warming up for ${selected.name}...`;
    empty.style.display = "grid";
    if (previewWarningText) {
      warning.textContent = previewWarningText;
      warning.classList.remove("hidden");
    } else {
      warning.textContent = "";
      warning.classList.add("hidden");
    }
    detachPreviewPlayer();
    return;
  }

  badge.textContent = buffering ? "Buffering" : "Live";
  badge.className = `badge ${buffering ? "" : "live"}`;
  empty.textContent = buffering ? "Preview is warming up..." : "";
  empty.style.display = buffering ? "grid" : "none";
  if (previewWarningText) {
    warning.textContent = previewWarningText;
    warning.classList.remove("hidden");
  } else {
    warning.textContent = "";
    warning.classList.add("hidden");
  }
  if (buffering) {
    detachPreviewPlayer();
    return;
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

function activityExportText(items, selectedChannel) {
  const lines = [];
  const tasks = items.filter((item) => item.kind === "task").map((item) => item.task);
  const runOrder = buildRunOrder(tasks);
  lines.push(`Castarro activity export (${new Date().toLocaleString()})`);
  lines.push(`Config: ${state.config}`);
  lines.push(`Channel: ${selectedChannel || "none"}`);
  lines.push(`Entries: ${items.length}`);
  lines.push("");
  items.forEach((item, index) => {
    if (item.kind === "task") {
      lines.push(formatTaskForExport(item.task, index + 1, runOrder));
      return;
    }
    lines.push(formatEventForExport(item.event, index + 1));
  });
  return lines.join("\n");
}

function activityExportFilename(channelName) {
  const channelPart = String(channelName || "all-channels")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "channel";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `castarro-activity-${channelPart}-${stamp}.txt`;
}

async function exportActivityLogs() {
  const selectedChannel = selectedWorkspaceChannelName();
  if (!selectedChannel) {
    toast("Select a channel to export activity logs.");
    return;
  }
  const items = buildActivityItems(selectedChannel);
  if (!items.length) {
    toast(`No activity logs to export for ${selectedChannel}.`);
    return;
  }
  const text = activityExportText(items, selectedChannel);
  const filename = activityExportFilename(selectedChannel);
  const bridge = desktopBridge();
  if (bridge && typeof bridge.exportTextToDownloads === "function") {
    const result = await bridge.exportTextToDownloads({ filename, text });
    state.activityExportedSignature = activityExportSignature(items);
    updateActivityExportButton(items);
    toast(`Exported ${items.length} activity entries to ${result?.path || "Downloads"}.`);
    return;
  }

  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  state.activityExportedSignature = activityExportSignature(items);
  updateActivityExportButton(items);
  toast(`Exported ${items.length} activity entries.`);
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
    state.settingsAutosaveLastSignature = JSON.stringify(state.configData);
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
  config.storage = { ...defaultStorageSettings(), ...(config.storage || {}) };
  config.alerts = {
    ...defaultAlertSettings(),
    ...(config.alerts || {}),
    rules: {
      ...defaultAlertSettings().rules,
      ...((config.alerts && config.alerts.rules) || {}),
    },
  };
  config.scheduler = {
    ...defaultSchedulerSettings(),
    ...(config.scheduler || {}),
  };
  config.storage.source_proxy = {
    ...defaultStorageSettings().source_proxy,
    ...(config.storage.source_proxy || {}),
  };
  config.storage.providers = normalizedStorageProviders(config);
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
    if (!Array.isArray(channel.cloud_playlist)) {
      channel.cloud_playlist = [];
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
      renderSettingsFormsUnlessPaused();
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

function normalizeFileListScrollKey(card) {
  const channelName = String(card?.dataset?.channelName || "").trim();
  const index = String(card?.dataset?.index || "").trim();
  return channelName || index || "active";
}

function rememberNormalizeFileListScroll() {
  document.querySelectorAll("#normalizationChannels .selected-normalize-settings").forEach((card) => {
    const list = card.querySelector(".file-picker .file-list");
    if (!list) return;
    state.normalizeFileListScroll[normalizeFileListScrollKey(card)] = Number(list.scrollTop) || 0;
  });
}

function restoreNormalizeFileListScroll() {
  document.querySelectorAll("#normalizationChannels .selected-normalize-settings").forEach((card) => {
    const list = card.querySelector(".file-picker .file-list");
    if (!list) return;
    const scrollTop = Number(state.normalizeFileListScroll[normalizeFileListScrollKey(card)]) || 0;
    if (scrollTop > 0) {
      list.scrollTop = scrollTop;
    }
  });
}

function renderSettingsForms() {
  rememberNormalizeFileListScroll();
  const config = state.configData || defaultConfigData();
  config.defaults = config.defaults || {};
  config.normalize_profile = config.normalize_profile || {};
  config.youtube = { ...defaultYoutubeSettings(), ...(config.youtube || {}) };
  config.storage = { ...defaultStorageSettings(), ...(config.storage || {}) };
  config.alerts = {
    ...defaultAlertSettings(),
    ...(config.alerts || {}),
    rules: {
      ...defaultAlertSettings().rules,
      ...((config.alerts && config.alerts.rules) || {}),
    },
  };
  config.scheduler = {
    ...defaultSchedulerSettings(),
    ...(config.scheduler || {}),
  };
  config.storage.source_proxy = {
    ...defaultStorageSettings().source_proxy,
    ...(config.storage.source_proxy || {}),
  };
  config.storage.providers = normalizedStorageProviders(config);
  config.youtube.accounts = normalizedYoutubeAccounts(config);
  config.youtube.default_account_id = normalizeAccountId(config.youtube.default_account_id || "");
  if (!config.youtube.default_account_id && config.youtube.accounts.length) {
    config.youtube.default_account_id = config.youtube.accounts[0].id;
  }
  config.ui = { channel_workspace_enabled: true, legacy_tabs_enabled: false, ...(config.ui || {}) };
  config.channels = Array.isArray(config.channels) ? config.channels : [];
  config.channels.forEach((channel) => {
    channel.youtube_account_id = normalizeAccountId(channel.youtube_account_id || "");
    if (!Array.isArray(channel.cloud_playlist)) {
      channel.cloud_playlist = [];
    }
  });
  if ($("removeChannelNormalize")) {
    $("removeChannelNormalize").disabled = !config.channels.length;
  }
  renderRemovedChannelUndo();
  if ($("folderSettingsFields")) {
    $("folderSettingsFields").innerHTML = folderSettingsMarkup(config.defaults);
  }
  renderStorageSettingsPanel(config);
  renderAutomationSettingsPanel(config);

  const activeNormalizeIndex = selectedSettingsChannelIndex(config);
  $("normalizationChannels").innerHTML = activeNormalizeIndex >= 0
    ? normalizationCard(config.channels[activeNormalizeIndex], activeNormalizeIndex)
    : `<div class="card">No channels yet. Click <strong>Add Channel</strong> to create one.</div>`;
  restoreNormalizeFileListScroll();
  window.requestAnimationFrame(restoreNormalizeFileListScroll);

  renderYoutubeSettingsPanel(config);
}

function renderStorageSettingsPanel(config = state.configData || defaultConfigData()) {
  const container = $("storageSettingsPanel");
  if (!container) return;
  const storage = { ...defaultStorageSettings(), ...(config.storage || {}) };
  const proxy = { ...defaultStorageSettings().source_proxy, ...(storage.source_proxy || {}) };
  const providers = normalizedStorageProviders(config);
  const statusProviders = Array.isArray(state.storageStatus?.providers) ? state.storageStatus.providers : [];
  const statusById = new Map(statusProviders.map((item) => [String(item.id || ""), item]));
  const providerMarkup = providers.length
    ? providers.map((provider) => {
        const id = String(provider.id || "").trim();
        const oauth = { ...defaultStorageProviderOauth(), ...(provider.oauth || {}) };
        const status = statusById.get(id) || provider;
        const connected = Boolean(status.connected || status.status === "connected");
        const statusLabel = connected ? "Connected" : (status.status || "Disconnected");
        const tokenText = status.tokens_present ? "Token stored" : "No token";
        const connectBusy = state.storageConnectBusyProviderId === id;
        const connectLabel = connected ? "Reconnect Google Drive" : "Connect Google Drive";
        return `
          <section class="channel-settings storage-provider-card">
            <div class="section-head compact">
              <div>
                <h3>${escapeHtml(provider.display_name || provider.displayName || id || "Storage provider")}</h3>
                <p class="helper">${escapeHtml(provider.type || "storage")} - ${escapeHtml(tokenText)}</p>
              </div>
              <span class="badge ${connected ? "ok" : "warn"}">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="form-grid">
              <label>
                <span class="field-hint">Provider ID</span>
                <input value="${escapeAttr(id)}" readonly>
              </label>
              <label>
                <span class="field-hint">Account</span>
                <input value="${escapeAttr(status.account_email || provider.account_email || "")}" readonly placeholder="Not connected">
              </label>
              <label>
                <span class="field-hint">Token file</span>
                <input value="${escapeAttr(provider.tokens_file || "")}" readonly>
              </label>
              <label>
                <span class="field-hint">Google client ID</span>
                <input data-storage-provider-index="${escapeAttr(String(providers.indexOf(provider)))}" data-storage-provider-oauth-field="client_id" value="${escapeAttr(oauth.client_id || "")}" placeholder="Desktop OAuth client ID">
              </label>
              <label>
                <span class="field-hint">Client secret</span>
                <input data-storage-provider-index="${escapeAttr(String(providers.indexOf(provider)))}" data-storage-provider-oauth-field="client_secret" value="${escapeAttr(oauth.client_secret || "")}" placeholder="Optional for desktop OAuth">
              </label>
              <label>
                <span class="field-hint">Redirect URI</span>
                <input data-storage-provider-index="${escapeAttr(String(providers.indexOf(provider)))}" data-storage-provider-oauth-field="redirect_uri" value="${escapeAttr(oauth.redirect_uri || defaultStorageProviderOauth().redirect_uri)}" placeholder="http://127.0.0.1:8765/oauth2redirect">
              </label>
              <label>
                <span class="field-hint">OAuth client type</span>
                <select data-storage-provider-index="${escapeAttr(String(providers.indexOf(provider)))}" data-storage-provider-oauth-field="oauth_client_type">
                  <option value="desktop" ${String(oauth.oauth_client_type || "desktop") === "desktop" ? "selected" : ""}>Desktop app (Recommended)</option>
                  <option value="web" ${String(oauth.oauth_client_type || "desktop") === "web" ? "selected" : ""}>Web application</option>
                </select>
              </label>
              <label class="checkbox">
                <input type="checkbox" data-storage-provider-index="${escapeAttr(String(providers.indexOf(provider)))}" data-storage-provider-oauth-field="use_pkce" ${oauth.use_pkce !== false ? "checked" : ""}>
                <span>Use PKCE</span>
              </label>
            </div>
            ${status.message ? `<div class="meta">${escapeHtml(status.message)}</div>` : ""}
            <div class="row wrap">
              <button class="pill" type="button" onclick="connectStorageProvider('${escapeJs(id)}').catch((error) => toast(error.message))" ${connectBusy ? "disabled" : ""}>${escapeHtml(connectBusy ? "Opening..." : connectLabel)}</button>
              <button class="pill ghost" type="button" onclick="disconnectStorageProvider('${escapeJs(id)}')" ${connected || status.tokens_present ? "" : "disabled"}>Disconnect</button>
            </div>
          </section>
        `;
      }).join("")
    : `<div class="notice warn">No storage providers are configured.</div>`;

  container.innerHTML = `
    <div class="channel-settings-list">
      ${providerMarkup}
      <section class="channel-settings">
        <div class="section-head compact">
          <div>
            <h3>Source Proxy Cache</h3>
            <p class="helper">Localhost proxy settings used when FFmpeg reads cloud videos.</p>
          </div>
        </div>
        <div class="form-grid">
          <label>
            <span class="field-hint">Host</span>
            <input data-storage-proxy-field="host" value="${escapeAttr(proxy.host || "127.0.0.1")}">
          </label>
          <label>
            <span class="field-hint">Port</span>
            <input type="number" min="1" max="65535" data-storage-proxy-field="port" value="${escapeAttr(proxy.port || 8876)}">
          </label>
          <label>
            <span class="field-hint">Cache folder</span>
            <input data-storage-proxy-field="cache_dir" value="${escapeAttr(proxy.cache_dir || ".runtime/cloud-cache")}">
          </label>
          <label>
            <span class="field-hint">Startup buffer MB</span>
            <input type="number" min="0" data-storage-proxy-field="startup_buffer_mb" value="${escapeAttr(proxy.startup_buffer_mb ?? 64)}">
          </label>
          <label>
            <span class="field-hint">Max cache MB</span>
            <input type="number" min="0" data-storage-proxy-field="max_cache_mb" value="${escapeAttr(proxy.max_cache_mb ?? 2048)}">
          </label>
          <label class="checkbox">
            <input type="checkbox" data-storage-proxy-field="spool_before_start" ${proxy.spool_before_start ? "checked" : ""}>
            <span>Spool before start</span>
          </label>
        </div>
      </section>
    </div>
  `;
}

async function refreshStorageStatus() {
  const payload = await api(`/api/storage/status?config=${encodeURIComponent(state.config)}`, {
    action: "storage.status",
  });
  state.storageStatus = payload;
  renderStorageSettingsPanel(state.configData || defaultConfigData());
  return payload;
}

async function waitForStorageExternalAuth(providerId) {
  const normalizedProviderId = String(providerId || "").trim();
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120000) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    const payload = await refreshStorageStatus();
    const providers = Array.isArray(payload?.providers) ? payload.providers : [];
    const provider = providers.find((item) => String(item?.id || "").trim() === normalizedProviderId) || null;
    if (provider?.connected || provider?.status === "connected") {
      return true;
    }
    if (provider?.status === "expired" || provider?.status === "error") {
      throw new Error(provider.message || "Google Drive connection failed.");
    }
  }
  return false;
}

async function connectStorageProvider(providerId) {
  const bridge = desktopBridge();
  const openExternal = bridge && typeof bridge.openExternal === "function" ? bridge.openExternal.bind(bridge) : null;
  const popup = openExternal ? null : window.open("about:blank", "storageConnect", "popup=yes,width=780,height=840");
  if (!openExternal) {
    if (!popup) {
      throw new Error("Popup blocked. Please allow popups and try again.");
    }
    try {
      popup.document.title = "Google Drive Connection";
      popup.document.body.innerHTML = `
        <main style="font-family: Segoe UI, Tahoma, sans-serif; padding: 24px;">
          <h1 style="font-size: 18px; margin: 0 0 8px;">Opening Google Drive sign-in...</h1>
          <p style="margin: 0; color: #555;">You can continue in this window once Google sign-in loads.</p>
        </main>
      `;
    } catch {
      // Ignore restricted popup document writes.
    }
  }

  state.storageConnectBusyProviderId = providerId;
  renderStorageSettingsPanel(state.configData || defaultConfigData());
  try {
    const data = collectSettingsData();
    await saveConfigData(data);
    const query = new URLSearchParams({ config: state.config, provider: providerId });
    const payload = await api(`/api/storage/auth/start?${query.toString()}`, { action: "storage.connect.start" });
    if (openExternal) {
      await openExternal(payload.url);
      toast("Complete the Google sign-in in your browser.");
      waitForStorageExternalAuth(providerId).then((completed) => {
        if (!completed) {
          toast("Google Drive sign-in is still pending. Return here after completing it in your browser.");
          return;
        }
        refreshStorageStatus()
          .then(() => loadConfigText())
          .then(() => toast("Google Drive connected."))
          .catch((error) => toast(error.message));
      }).catch((error) => {
        toast(error.message || "Google Drive connection refresh failed.");
      });
    } else {
      popup.location.href = payload.url;
      toast("Complete the Google sign-in in the popup window.");
    }
  } catch (error) {
    if (popup) {
      try {
        popup.close();
      } catch {
        // Ignore popup close failures.
      }
    }
    throw error;
  } finally {
    state.storageConnectBusyProviderId = "";
    renderStorageSettingsPanel(state.configData || defaultConfigData());
  }
}

async function disconnectStorageProvider(providerId) {
  const payload = await api("/api/storage/disconnect", {
    method: "POST",
    body: JSON.stringify({ config: state.config, provider: providerId }),
    action: "storage.disconnect",
  });
  state.storageStatus = null;
  await refreshStorageStatus();
  toast(`${payload?.provider?.display_name || "Storage provider"} disconnected.`);
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
      resolvedFolderPath(defaults.raw_dir || "Raw Videos"),
      "Source videos are read from here before normalization."
    ),
    folderSettingCard(
      "normalized_dir",
      "Go Live Videos Folder",
      resolvedFolderPath(defaults.normalized_dir || "Go Live"),
      "Normalized files are written here and used for streaming playlists."
    ),
    folderSettingCard(
      "log_dir",
      "Logs Folder",
      resolvedFolderPath(defaults.log_dir || "logs"),
      "FFmpeg and app logs are stored here for troubleshooting."
    ),
  ].join("");
}

function isAbsolutePath(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z]:[\\/]/.test(text) || text.startsWith("\\\\") || text.startsWith("/");
}

function resolvedFolderPath(value) {
  const text = String(value || "").trim();
  if (!text || isAbsolutePath(text)) return text;
  const root = String(state.status?.root || "").trim();
  if (!root) return text;
  const separator = root.includes("\\") ? "\\" : "/";
  const cleaned = text.replace(/^[.][\\/]+/, "").replace(/^[\\/]+/, "");
  return `${root.replace(/[\\/]+$/, "")}${separator}${cleaned}`;
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
      <div class="meta">${canBrowse ? "Pick any local folder. Changes save automatically." : "Desktop folder picker is unavailable in this browser. Enter the path manually; changes save automatically."}</div>
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
  const picked = await bridge.selectFolder({ defaultPath: resolvedFolderPath(input.value) || undefined });
  if (!picked || picked.canceled || !picked.path) return;
  input.value = picked.path;
  syncDefaultControlToState(input);
  scheduleSettingsAutosave(200);
  pauseSettingsRender(1000);
  toast("Folder selected. Settings will save automatically.");
}

async function chooseEncodeOutputFolder(config) {
  const bridge = desktopBridge();
  const defaults = config.defaults || {};
  const current = resolvedFolderPath(defaults.normalized_dir || "Go Live");
  if (!bridge || typeof bridge.selectFolder !== "function") {
    toast(`Encoded videos will be saved to ${current || "Go Live"}.`);
    return current || defaults.normalized_dir || "Go Live";
  }
  const picked = await bridge.selectFolder({
    title: "Choose encoded videos output folder",
    defaultPath: current || undefined,
  });
  if (!picked || picked.canceled || !picked.path) {
    return "";
  }
  return String(picked.path || "").trim();
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
  const startLocal = isoToDatetimeLocal(item?.scheduled_start_time || "");
  const durationMinutes = youtubeBroadcastDurationMinutes(item);
  return {
    title: String(item?.title || "").trim(),
    description: String(item?.description || ""),
    startLocal,
    endLocal: isoToDatetimeLocal(item?.scheduled_end_time || "") || addMinutesToDatetimeLocal(startLocal, durationMinutes),
    durationMinutes,
    privacyStatus: String(item?.privacy_status || "unlisted").trim().toLowerCase() || "unlisted",
  };
}

function selectedImportedYoutubeBroadcast() {
  const broadcasts = Array.isArray(state.youtubeBroadcasts) ? state.youtubeBroadcasts : [];
  const importedId = String(state.youtubeImportedBroadcastId || "").trim();
  if (!importedId) return null;
  return broadcasts.find((item) => String(item?.id || "") === importedId) || null;
}

function youtubeBroadcastFetchKey(accountId) {
  const id = normalizeAccountId(accountId || "");
  return id ? `${state.config}:${id}` : "";
}

function queueYoutubeBroadcastRefresh(useLinkedChannel = false, accountId = "") {
  const key = youtubeBroadcastFetchKey(accountId || state.youtubeSelectedAccountId);
  if (
    !key
    || state.youtubeBroadcastsLoading
    || state.youtubeBroadcastsLoadedKey === key
    || state.youtubeBroadcastsFailedKey === key
  ) return;
  state.youtubeBroadcastsLoadedKey = key;
  window.setTimeout(() => {
    refreshYoutubeBroadcasts(useLinkedChannel, { silent: true }).catch((error) => toast(error.message));
  }, 0);
}

function syncYoutubeScheduleDraftFromForm() {
  const startLocal = String($("youtubeScheduleStart")?.value || "");
  const endLocal = String($("youtubeScheduleEnd")?.value || "");
  state.youtubeScheduleDraft = {
    title: String($("youtubeScheduleTitle")?.value || ""),
    description: String($("youtubeScheduleDescription")?.value || ""),
    startLocal,
    endLocal,
    durationMinutes: durationMinutesBetweenLocalInputs(startLocal, endLocal) || Number(state.youtubeScheduleDraft?.durationMinutes || 120),
    privacyStatus: String($("youtubeSchedulePrivacy")?.value || "unlisted"),
  };
}

function addMinutesToDatetimeLocal(value, minutes) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() + Math.max(15, Math.round(Number(minutes) || 120)));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function durationMinutesBetweenLocalInputs(startValue, endValue) {
  const start = new Date(String(startValue || ""));
  const end = new Date(String(endValue || ""));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;
  return Math.round((end.getTime() - start.getTime()) / 60000);
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

function isYoutubeCardExpanded(key, defaultOpen = false) {
  if (!key) return Boolean(defaultOpen);
  const current = state.youtubeExpandedCards?.[key];
  return typeof current === "boolean" ? current : Boolean(defaultOpen);
}

function setYoutubeCardExpanded(key, open) {
  if (!key) return;
  state.youtubeExpandedCards = {
    ...(state.youtubeExpandedCards || {}),
    [key]: Boolean(open),
  };
}

function youtubeCollapsibleCard({
  key,
  title,
  helper = "",
  body = "",
  extraClass = "",
  attributes = "",
  defaultOpen = false,
  summaryMetaHtml = "",
  summaryBadgeHtml = "",
} = {}) {
  const open = isYoutubeCardExpanded(key, defaultOpen);
  const cardClass = `nested-card youtube-collapsible-card ${extraClass}`.trim();
  return `
    <details class="${cardClass}" ${attributes} ${open ? "open" : ""} ontoggle="setYoutubeCardExpanded('${escapeJs(key || "")}', this.open)">
      <summary class="youtube-card-summary">
        <div class="youtube-card-summary-copy">
          <h3>${escapeHtml(title || "Card")}</h3>
          ${helper ? `<p class="helper">${escapeHtml(helper)}</p>` : ""}
          ${summaryMetaHtml ? `<div class="youtube-card-summary-meta">${summaryMetaHtml}</div>` : ""}
        </div>
        <div class="youtube-card-summary-side">
          ${summaryBadgeHtml || ""}
          <span class="youtube-card-summary-toggle" aria-hidden="true"></span>
        </div>
      </summary>
      <div class="youtube-card-content">
        ${body}
      </div>
    </details>
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
  const futureBroadcasts = broadcasts.filter((item) => {
    const start = new Date(String(item?.scheduled_start_time || ""));
    return !Number.isNaN(start.getTime()) && start.getTime() > Date.now();
  });
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
  const defaultPrivacy = ["private", "unlisted", "public"].includes(String(youtube.default_privacy_status || "").toLowerCase())
    ? String(youtube.default_privacy_status || "").toLowerCase()
    : "unlisted";
  const scheduleDraft = state.youtubeScheduleDraft && typeof state.youtubeScheduleDraft === "object" ? state.youtubeScheduleDraft : {};
  const importedBroadcast = selectedImportedYoutubeBroadcast();
  const importedBroadcastId = String(importedBroadcast?.id || "");
  const scheduleTitleValue = String(scheduleDraft.title || "");
  const scheduleStartValue = String(scheduleDraft.startLocal || "") || defaultLocalTime;
  const scheduleDurationValue = Number.isFinite(Number(scheduleDraft.durationMinutes)) ? Math.max(15, Math.round(Number(scheduleDraft.durationMinutes))) : 120;
  const scheduleEndValue = String(scheduleDraft.endLocal || "") || addMinutesToDatetimeLocal(scheduleStartValue, scheduleDurationValue);
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
  if (!scheduleGuardReason && !actionBusy && selectedAccount?.connected) {
    queueYoutubeBroadcastRefresh(Boolean(selectedChannelName), linkedAccountId || selectedAccount.id);
  }
  const scheduleButtonText = actionBusy === "adopt"
    ? "Using..."
    : actionBusy === "schedule"
      ? "Creating..."
      : importedBroadcast?.id
        ? "Use Selected Broadcast"
        : "Schedule Stream";
  const keyCheckSummary = "Run verification to confirm this channel's stream key matches its linked account.";
  const selectedKeyCheck = visibleKeyChecks?.checks?.[0] || null;
  const verificationStatusText = selectedKeyCheck
    ? (selectedKeyCheck.ok ? "Stream key matched" : "Stream key mismatch")
    : "Stream key not verified";
  const verificationStatusClass = selectedKeyCheck?.ok ? "badge live" : "badge warn";
  const verificationSubscriberText = selectedKeyCheck
    ? youtubeSubscriberText({
      subscriber_count: selectedKeyCheck.account_subscriber_count,
      hidden_subscriber_count: selectedKeyCheck.account_hidden_subscriber_count,
    })
    : "";
  const verificationAccountBadge = selectedKeyCheck
    ? [selectedKeyCheck.account_label ? `Account: ${selectedKeyCheck.account_label}` : "", verificationSubscriberText].filter(Boolean).join(" | ")
    : "";
  const activeLiveIndex = selectedSettingsChannelIndex(config);
  const activeLiveChannel = activeLiveIndex >= 0 ? config.channels[activeLiveIndex] : null;
  const streamSettingsMarkup = activeLiveIndex >= 0
    ? streamSettingsCard(config.channels[activeLiveIndex], activeLiveIndex)
    : `<section class="nested-card">No channels yet. Click <strong>Add Channel</strong> to create one.</section>`;
  const videosMarkup = activeLiveIndex >= 0
    ? liveVideosCard(config.channels[activeLiveIndex], activeLiveIndex)
    : `<div class="nested-card">No channels yet. Click <strong>Add Channel</strong> to create one.</div>`;
  const selectedStream = selectedChannelName ? state.status?.streams?.[selectedChannelName] : null;
  const selectedStreamRunning = Boolean(selectedStream?.running);
  const storageProviders = Array.isArray(state.storageStatus?.providers) ? state.storageStatus.providers : [];
  const storageById = new Map(storageProviders.map((item) => [String(item.id || ""), item]));
  const selectedCloud = selectedCloudVideos(activeLiveChannel);
  const selectedUsesCloud = Boolean(selectedCloud.length && !(Array.isArray(activeLiveChannel?.playlist) && activeLiveChannel.playlist.length));
  const blockedCloudItem = selectedUsesCloud
    ? selectedCloud.find((item) => cloudVideoCompatibilityStatus(item) !== "ready")
    : null;
  const disconnectedCloudItem = selectedUsesCloud
    ? selectedCloud.find((item) => {
        const providerStatus = storageById.get(cloudVideoProviderId(item));
        return providerStatus && !(providerStatus.connected || providerStatus.status === "connected");
      })
    : null;
  const streamStartDisabledReason = selectedStreamRunning
    ? ""
    : (!selectedChannelName
      ? "Pick a channel to start."
      : (disconnectedCloudItem
        ? "Reconnect Google Drive before starting this cloud playlist."
        : (blockedCloudItem
          ? cloudVideoCompatibilityMessage(blockedCloudItem) || "A selected cloud video is not ready."
          : "")));

  container.innerHTML = `
    <div class="youtube-page-stack">
      ${youtubeCollapsibleCard({
        key: "youtube-account",
        title: "YouTube Account",
        helper: "Connection and stream-key match for the selected channel.",
        extraClass: "youtube-connect-card",
        summaryMetaHtml: `<span class="meta">${escapeHtml(connectionName)}</span>`,
        summaryBadgeHtml: `<span class="${connectionStatusClass}">${escapeHtml(connectionStatusText)}</span>`,
        body: `
          <div class="youtube-connection-summary">
            <div class="youtube-connection-name">
              <strong class="${selectedAccount?.wrong_account ? "wrong" : ""}">${escapeHtml(connectionName)}</strong>
              <span class="meta">${escapeHtml(connectionMetaText)}</span>
              <div class="row wrap youtube-connection-badges">
                <span class="${verificationStatusClass}">${escapeHtml(verificationStatusText)}</span>
                ${verificationAccountBadge ? `<span class="badge">${escapeHtml(verificationAccountBadge)}</span>` : ""}
                ${selectedKeyCheck?.stream_key_suffix ? `<span class="badge">Key ends: ${escapeHtml(selectedKeyCheck.stream_key_suffix)}</span>` : ""}
                ${selectedKeyCheck?.match_source ? `<span class="badge">${escapeHtml(selectedKeyCheck.match_source)}</span>` : ""}
              </div>
              ${selectedKeyCheck?.message ? `<span class="meta">${escapeHtml(selectedKeyCheck.message)}</span>` : (!selectedKeyCheck ? `<span class="meta">${escapeHtml(keyCheckSummary)}</span>` : "")}
            </div>
            <span class="${connectionStatusClass}">${escapeHtml(connectionStatusText)}</span>
            <button class="${connectButtonClass}" type="button" onclick="${connectButtonAction}" ${connectButtonDisabled}>${escapeHtml(connectButtonText)}</button>
          </div>
          ${credentialsReady ? "" : `<div class="notice warn">YouTube owner credentials are not configured yet.</div>`}
        `,
      })}

      ${youtubeCollapsibleCard({
        key: "youtube-go-live",
        title: "Live Settings",
        helper: "Broadcast details shared by live starts and scheduled YouTube broadcasts.",
        extraClass: "youtube-go-live-card",
        summaryMetaHtml: `<span class="meta">${escapeHtml(scheduleTitleValue || selectedChannelName || "No live title yet")}</span>`,
        summaryBadgeHtml: `<span class="badge ${selectedStreamRunning ? "live" : ""}">${escapeHtml(selectedStreamRunning ? "Live" : "Details")}</span>`,
        body: `
          ${streamStartDisabledReason ? `<div class="notice warn">${escapeHtml(streamStartDisabledReason)}</div>` : ""}
          <div class="form-grid youtube-go-live-form">
            <label>
              Title
              <input id="youtubeScheduleTitle" type="text" value="${escapeAttr(scheduleTitleValue)}" placeholder="Live Event Title" oninput="syncYoutubeScheduleDraftFromForm()" ${disabledSchedule}>
            </label>
            <label>
              Privacy
              <select id="youtubeSchedulePrivacy" data-youtube-field="default_privacy_status" onchange="syncYoutubeScheduleDraftFromForm()" ${disabledSchedule}>
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
              <span class="setting-note">${importedBroadcast && youtubeThumbnailUrl(importedBroadcast) ? "Fetched thumbnail is shown below. Choose a local file only if you want to replace it." : "Optional. JPG, PNG, GIF, or BMP up to 2 MB."}</span>
            </label>
          </div>
        `,
      })}

      <div class="channel-settings-list" id="channelSettings">
        ${streamSettingsMarkup}
      </div>

      <div class="channel-settings-list">
        ${videosMarkup}
      </div>

      ${youtubeCollapsibleCard({
        key: "youtube-schedule",
        title: "Schedule Stream",
        helper: "Choose a start/end time or use a future YouTube broadcast that already exists.",
        extraClass: "youtube-schedule-card",
        summaryMetaHtml: `<span class="meta">${escapeHtml(importedBroadcast?.title || scheduleStartValue || "No schedule selected")}</span>`,
        summaryBadgeHtml: scheduleGuardReason
          ? `<span class="badge warn">Blocked</span>`
          : `<span class="badge live">${escapeHtml(scheduleButtonText)}</span>`,
        body: `
          ${broadcasts.length ? `
            <div class="youtube-import-box">
              <label>
                Choose existing broadcast
                <select id="youtubeBroadcastImport" onchange="importYoutubeBroadcastSettings(this.value)" ${actionBusy ? "disabled" : ""}>
                  <option value="">Choose an existing broadcast</option>
                  ${broadcasts.map((item) => `<option value="${escapeAttr(item.id || "")}" ${String(item.id || "") === importedBroadcastId ? "selected" : ""}>${escapeHtml(item.title || "Untitled")} (${escapeHtml(item.privacy_status || "unknown")})</option>`).join("")}
                </select>
              </label>
              ${importedBroadcast ? youtubeBroadcastSettingsMarkup(importedBroadcast) : `<div class="meta">Pick a broadcast to preview and copy its available YouTube settings into the Live Settings and Schedule Stream fields.</div>`}
            </div>
          ` : state.youtubeBroadcastsLoading
            ? `<div class="notice">Checking YouTube for active or upcoming broadcasts...</div>`
            : state.youtubeBroadcastsLoadError
              ? `<div class="notice warn">${escapeHtml(state.youtubeBroadcastsLoadError)}</div>`
              : `<div class="notice">No active or upcoming YouTube broadcasts were found for this linked account.</div>`}
          <div class="form-grid youtube-schedule-form">
            <label>
              Start time
              <input id="youtubeScheduleStart" type="datetime-local" value="${escapeAttr(scheduleStartValue)}" onchange="syncYoutubeScheduleDraftFromForm()" ${disabledSchedule}>
            </label>
            <label>
              End time
              <input id="youtubeScheduleEnd" type="datetime-local" value="${escapeAttr(scheduleEndValue)}" onchange="syncYoutubeScheduleDraftFromForm()" ${disabledSchedule}>
            </label>
          </div>
          ${scheduleGuardReason ? `<div class="notice warn">Guard: ${escapeHtml(scheduleGuardReason)} | Channel: ${escapeHtml(selectedChannelName || "none")} | Account: ${escapeHtml(linkedAccount?.label || linkedAccountId || "none")}</div>` : ""}
          <div class="row wrap">
            <button class="pill success" type="button" onclick="scheduleOrUseYoutubeBroadcast().catch((error) => toast(error.message))" ${disabledSchedule}>${escapeHtml(scheduleButtonText)}</button>
          </div>
        `,
      })}

      ${ownerSetupVisible ? youtubeCollapsibleCard({
        key: "youtube-owner-setup",
        title: "Owner Setup",
        helper: "Visible only in owner mode (?owner=1). End users do not need this.",
        extraClass: "owner-only",
        summaryBadgeHtml: `<span class="badge">Owner mode</span>`,
        body: `
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
        `,
      }) : ""}

      ${youtubeCollapsibleCard({
        key: "youtube-upcoming-streams",
        title: "Upcoming Streams",
        helper: "Future broadcasts from the selected YouTube account.",
        extraClass: "youtube-scheduled-streams-card",
        summaryMetaHtml: `<span class="meta">${escapeHtml(futureBroadcasts.length ? `${futureBroadcasts.length} stream${futureBroadcasts.length === 1 ? "" : "s"} queued` : "No upcoming streams found")}</span>`,
        summaryBadgeHtml: `<span class="badge">${escapeHtml(String(futureBroadcasts.length))}</span>`,
        body: `
          <div class="youtube-broadcast-list">
            ${futureBroadcasts.length
              ? futureBroadcasts.map((item) => {
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
                `;
              }).join("")
              : `<div class="meta">No upcoming streams found.</div>`
            }
          </div>
        `,
      })}
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
    autoVerifySelectedYoutubeChannel().catch((error) => {
      logLocalActivityEvent(
        "youtube_verify_auto",
        error.message || "Automatic YouTube stream-key verification failed.",
        { channel: state.workspace.selectedChannelName || "" },
        "error"
      );
    });
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

async function refreshYoutubeBroadcasts(useLinkedChannel = false, options = {}) {
  const silent = Boolean(options.silent);
  let resolvedAccountId = "";
  try {
    let accountId = state.youtubeSelectedAccountId;
    if (useLinkedChannel) {
      const config = state.configData || defaultConfigData();
      const channelName = String(state.workspace.selectedChannelName || "").trim();
      const channel = (config.channels || []).find((item) => String(item?.name || "").trim() === channelName);
      accountId = normalizeAccountId(channel?.youtube_account_id || "");
      if (!accountId) {
        state.youtubeBroadcasts = [];
        state.youtubeBroadcastsLoadedKey = "";
        state.youtubeBroadcastsFailedKey = "";
        state.youtubeBroadcastsLoadError = "";
        state.youtubeBroadcastsLoading = false;
        renderYoutubeSettingsPanel(config);
        return;
      }
    }
    resolvedAccountId = normalizeAccountId(accountId || "");
    if (silent) {
      state.youtubeBroadcastsLoading = true;
      state.youtubeBroadcastsLoadError = "";
      state.youtubeBroadcastsFailedKey = "";
      renderYoutubeSettingsPanel(state.configData || defaultConfigData());
    } else {
      setYoutubeAction("loading", "Refreshing broadcasts from YouTube...", "refresh");
    }
    const query = accountId ? `&account=${encodeURIComponent(accountId)}` : "";
    const payload = await api(`/api/youtube/broadcasts?config=${encodeURIComponent(state.config)}${query}`, { action: "youtube.broadcasts.refresh" });
    state.youtubeBroadcasts = payload.broadcasts || [];
    if (payload.account_id) {
      state.youtubeSelectedAccountId = normalizeAccountId(payload.account_id);
      resolvedAccountId = state.youtubeSelectedAccountId;
    }
    state.youtubeBroadcastsLoadedKey = youtubeBroadcastFetchKey(resolvedAccountId);
    state.youtubeBroadcastsFailedKey = "";
    state.youtubeBroadcastsLoadError = "";
    const selectedImportId = String(state.youtubeImportedBroadcastId || "");
    const selectedStillExists = selectedImportId
      && state.youtubeBroadcasts.some((item) => String(item?.id || "") === selectedImportId);
    if (selectedImportId && !selectedStillExists) {
      state.youtubeImportedBroadcastId = "";
      state.youtubeScheduleDraft = null;
    }
    if (state.youtubeBroadcasts.length === 1) {
      const [onlyBroadcast] = state.youtubeBroadcasts;
      if (!silent) {
        state.youtubeImportedBroadcastId = String(onlyBroadcast?.id || "");
        state.youtubeScheduleDraft = youtubeScheduleDraftFromBroadcast(onlyBroadcast);
        setYoutubeAction("success", "Broadcast list refreshed (1 item) and loaded into the form.");
      }
    } else if (state.youtubeBroadcasts.length > 1) {
      if (!silent) {
        setYoutubeAction("success", `Broadcast list refreshed (${state.youtubeBroadcasts.length} item(s)). Choose one from the existing broadcast list.`);
      }
    } else {
      if (!silent) {
        state.youtubeScheduleDraft = null;
      }
      if (!silent) {
        setYoutubeAction("success", "Broadcast list refreshed (0 item(s)). No active or upcoming YouTube broadcasts were found for this linked account.");
      }
    }
  } catch (error) {
    state.youtubeBroadcastsLoadedKey = "";
    state.youtubeBroadcastsFailedKey = youtubeBroadcastFetchKey(resolvedAccountId);
    state.youtubeBroadcastsLoadError = error.message || "Could not refresh broadcasts.";
    if (!silent) {
      setYoutubeAction("error", state.youtubeBroadcastsLoadError);
    }
    throw error;
  } finally {
    state.youtubeBroadcastsLoading = false;
    if (silent) {
      renderYoutubeSettingsPanel(state.configData || defaultConfigData());
    }
  }
}

async function waitForYoutubeExternalAuth(accountId = "") {
  const normalizedAccountId = normalizeAccountId(accountId || "");
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120000) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    await loadConfigText();
    await refreshYoutubeStatus();
    const accounts = Array.isArray(state.youtubeStatus?.accounts) ? state.youtubeStatus.accounts : [];
    const account = accounts.find((item) => normalizeAccountId(item?.id || "") === normalizedAccountId) || null;
    if (!normalizedAccountId && state.youtubeStatus?.connected) {
      await refresh();
      await refreshYoutubeBroadcasts(true, { silent: true });
      setYoutubeAction("success", "YouTube account connected.");
      return true;
    }
    if (account?.connected || account?.wrong_account) {
      await refresh();
      await refreshYoutubeBroadcasts(true, { silent: true });
      if (account.wrong_account) {
        setYoutubeAction("error", account.message || "Connected YouTube account does not match this Castarro channel.");
      } else {
        const subscriberText = youtubeSubscriberText(account);
        const connectedName = account.channel_title
          ? `Connected to ${account.channel_title}${subscriberText ? ` (${subscriberText})` : ""}.`
          : "YouTube account connected.";
        setYoutubeAction("success", connectedName);
        toast(connectedName);
      }
      return true;
    }
  }
  return false;
}

async function connectYoutube() {
  const bridge = desktopBridge();
  const openExternal = bridge && typeof bridge.openExternal === "function" ? bridge.openExternal.bind(bridge) : null;
  const popup = openExternal ? null : window.open("about:blank", "youtubeConnect", "popup=yes,width=780,height=840");
  if (!openExternal) {
    if (!popup) {
      throw new Error("Popup blocked. Please allow popups and try again.");
    }
    try {
      popup.document.title = "YouTube Connection";
      popup.document.body.innerHTML = `
        <main style="font-family: Segoe UI, Tahoma, sans-serif; padding: 24px;">
          <h1 style="font-size: 18px; margin: 0 0 8px;">Opening YouTube sign-in...</h1>
          <p style="margin: 0; color: #555;">You can continue in this window once Google sign-in loads.</p>
        </main>
      `;
    } catch {
      // Some browsers restrict about:blank document writes; navigation below still works.
    }
  }
  const data = collectSettingsData();
  try {
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
    if (openExternal) {
      await openExternal(payload.url);
      setYoutubeAction("loading", "Complete Google sign-in in your browser, then return to Castarro.", "connect");
      waitForYoutubeExternalAuth(payload.account_id || accountId).then((completed) => {
        if (!completed) {
          setYoutubeAction("idle", "");
          toast("YouTube sign-in is still pending. Return here after completing it in your browser.");
        }
      }).catch((error) => {
        setYoutubeAction("error", error.message || "YouTube connection refresh failed.");
        toast(error.message || "YouTube connection refresh failed.");
      });
    } else {
      popup.location.href = payload.url;
    }
  } catch (error) {
    if (popup) {
      try {
        popup.close();
      } catch {
        // Ignore popup close failures.
      }
    }
    throw error;
  }
  toast(openExternal ? "Complete the Google sign-in in your browser." : "Complete the Google sign-in in the popup window.");
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
  state.youtubeBroadcastsLoadedKey = "";
  state.youtubeBroadcastsFailedKey = "";
  state.youtubeBroadcastsLoadError = "";
  state.youtubeKeyChecks = null;
  state.youtubeActionBusy = "";
  state.youtubeActionMessage = "";
  state.youtubeActionStatus = "idle";
  state.youtubeActionAt = "";
  await refreshYoutubeStatus();
  renderYoutubeSettingsPanel(state.configData || defaultConfigData());
  toast("YouTube account disconnected.");
}

async function verifyYoutubeChannelKeys(channelName = "", options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) {
    setYoutubeAction("loading", "Verifying channel stream keys against each channel's linked YouTube account...", "verify");
  }
  try {
    const query = channelName ? `&channel=${encodeURIComponent(channelName)}` : "";
    const payload = await api(`/api/youtube/verify-channel-keys?config=${encodeURIComponent(state.config)}${query}`, {
      action: "youtube.verify_channel_keys",
    });
    state.youtubeKeyChecks = payload || null;
    renderYoutubeSettingsPanel(state.configData || defaultConfigData());
    if (silent) {
      return;
    }
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
    if (!silent) {
      setYoutubeAction("error", error.message || "Verification failed.");
    }
    throw error;
  }
}

function youtubeAutoVerifySignature(channelName, channel, linkedAccount) {
  return [
    state.config,
    channelName,
    normalizeAccountId(channel?.youtube_account_id || ""),
    String(channel?.stream_key || "").trim(),
    String(channel?.stream_key_env || "").trim(),
    String(channel?.youtube_stream_id || "").trim(),
    String(channel?.youtube_broadcast_id || "").trim(),
    String(linkedAccount?.expires_at || ""),
  ].join("|");
}

function hasYoutubeKeyCheckForChannel(channelName) {
  const checks = Array.isArray(state.youtubeKeyChecks?.checks) ? state.youtubeKeyChecks.checks : [];
  return checks.some((item) => String(item?.channel || "") === String(channelName || ""));
}

async function autoVerifySelectedYoutubeChannel(options = {}) {
  const force = Boolean(options.force);
  const channelName = String(options.channelName || state.workspace.selectedChannelName || "").trim();
  if (!channelName) return false;
  const config = state.configData || defaultConfigData();
  const channel = (config.channels || []).find((item) => String(item?.name || "").trim() === channelName);
  if (!channel) return false;

  const linkedAccountId = normalizeAccountId(channel.youtube_account_id || "");
  if (!linkedAccountId) return false;
  const accounts = Array.isArray(state.youtubeStatus?.accounts) ? state.youtubeStatus.accounts : [];
  const linkedAccount = accounts.find((item) => normalizeAccountId(item?.id || "") === linkedAccountId);
  if (!linkedAccount?.connected) return false;

  const signature = youtubeAutoVerifySignature(channelName, channel, linkedAccount);
  if (state.youtubeAutoVerifyInFlightKey === signature) return false;
  if (!force && state.youtubeAutoVerifyLastKey === signature && hasYoutubeKeyCheckForChannel(channelName)) return false;

  state.youtubeAutoVerifyInFlightKey = signature;
  try {
    await verifyYoutubeChannelKeys(channelName, { silent: true });
    state.youtubeAutoVerifyLastKey = signature;
    state.youtubeAutoVerifyLastAt = Date.now();
    return true;
  } finally {
    if (state.youtubeAutoVerifyInFlightKey === signature) {
      state.youtubeAutoVerifyInFlightKey = "";
    }
  }
}

function parseScheduleDateIso(inputId) {
  const value = String($(inputId)?.value || "").trim();
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

async function scheduleOrUseYoutubeBroadcast() {
  const importedBroadcast = selectedImportedYoutubeBroadcast();
  if (importedBroadcast?.id) {
    return useExistingYoutubeBroadcast();
  }
  return scheduleYoutubeBroadcast();
}

async function scheduleYoutubeBroadcast() {
  const channelName = String(state.workspace.selectedChannelName || "").trim();
  const title = String($("youtubeScheduleTitle")?.value || "").trim();
  const description = String($("youtubeScheduleDescription")?.value || "").trim();
  const startIso = parseScheduleDateIso("youtubeScheduleStart");
  const endIso = parseScheduleDateIso("youtubeScheduleEnd");
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
  if (!endIso) {
    logLocalActivityEvent("ui_validation", "Set a valid end time.", { action: "youtube.schedule", channel: channelName }, "error");
    throw new Error("Set a valid end time.");
  }
  const startDate = new Date(startIso);
  const end = new Date(endIso);
  const durationMinutes = Math.round((end.getTime() - startDate.getTime()) / 60000);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 15) {
    logLocalActivityEvent("ui_validation", "End time must be at least 15 minutes after start time.", { action: "youtube.schedule", channel: channelName }, "error");
    throw new Error("End time must be at least 15 minutes after start time.");
  }

  const confirmation = window.confirm(
    `Confirm schedule?\nChannel: ${channelName}\nSchedules on YouTube account: ${linkedAccount?.label || linkedAccountId}`
  );
  if (!confirmation) {
    return;
  }

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
    await refreshYoutubeBroadcasts(true, { silent: true });
    await autoVerifySelectedYoutubeChannel({ channelName, force: true });
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
    await refreshYoutubeBroadcasts(true, { silent: true });
    await autoVerifySelectedYoutubeChannel({ channelName, force: true });
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
  const completedCount = completedRawFileCount(selected, task);
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
          ${selectedSet.has(file.path) ? `<button class="file-remove-button" type="button" title="Remove from encoding" aria-label="Remove ${escapeAttr(file.path)} from encoding" onclick="event.preventDefault(); event.stopPropagation(); removeRawSelection(${index}, '${escapeJs(file.path)}')">x</button>` : ""}
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
      ${task ? taskProgressMarkup(task, index, completedCount) : ""}
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
        <div class="normalize-rate-panels">
          <section class="normalize-rate-panel ${isCbr ? "" : "active"}" data-normalize-rate-panel="vbr">
            <h4>VBR Controls</h4>
            <div class="form-grid">
              ${normalizeInput(index, "video_minrate", "Min video bitrate", normalizeProfile.video_minrate || "4500k")}
              ${normalizeInput(index, "video_maxrate", "Max video bitrate", normalizeProfile.video_maxrate || "6800k")}
            </div>
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

function completedRawFileCount(selected, task) {
  if (!task || task.name !== "normalize" || !selected.length) return 0;

  const progress = task.progress || {};
  const current = Math.max(0, Number(progress.current) || 0);
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  return task.returncode === 0 && !task.running
    ? selected.length
    : Math.max(0, Math.min(selected.length, current - (percent >= 100 ? 0 : 1)));
}

function completedRawFileSet(channel, task) {
  const selected = Array.isArray(channel?.raw_playlist) ? channel.raw_playlist : [];
  return new Set(selected.slice(0, completedRawFileCount(selected, task)));
}

function taskProgressMarkup(task, index = -1, completedCount = 0) {
  const progress = task.progress || {};
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const action = task.name === "normalize" ? "Encoding" : task.name === "validate" ? "Validating" : "Testing stream";
  const stopped = Boolean(task.stopped_by_user);
  const status = task.running ? action : task.returncode === 0 ? "Finished" : stopped ? "Stopped" : "Failed";
  const total = Number(progress.total) || 0;
  const current = Number(progress.current) || 0;
  const countText = total ? `${Math.min(current || 1, total)} of ${total}` : "Starting";
  const message = stopped ? "Stopped" : progress.message || "Starting...";
  const canResume = stopped && task.name === "normalize" && index >= 0 && total && completedCount < total;
  const cardState = task.running ? "running" : task.returncode === 0 ? "done" : stopped ? "stopped" : "failed";
  return `
    <div class="progress-card ${cardState}">
      <div class="progress-head">
        <span>${escapeHtml(status)}</span>
        <span>${escapeHtml(countText)} - ${percent}%</span>
      </div>
      <div class="progress-track" aria-label="${escapeAttr(status)} progress">
        <div class="progress-fill" style="width: ${percent}%"></div>
      </div>
      <div class="progress-message">${escapeHtml(message)}</div>
      <div class="progress-actions">
        ${task.running ? `<button class="pill danger small" type="button" onclick="stopTask('${escapeJs(task.id)}')">${escapeHtml(stopTaskLabel(task.name))}</button>` : ""}
        ${canResume ? `<button class="pill success small" type="button" onclick="resumeSettingsTask('normalize', ${index}, ${completedCount + 1})">Resume</button>` : ""}
      </div>
    </div>
  `;
}

function stopTaskLabel(name) {
  if (name === "normalize") return "Stop Encoding";
  return `Stop ${name}`;
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

function syncNormalizeControlToState(control) {
  if (!control?.dataset) return;
  const index = Number(control.dataset.normalizeIndex);
  const field = control.dataset.normalizeField;
  if (!Number.isInteger(index) || !field) return;

  if (field === "video_encoder") {
    syncEncoderPreset(index, control.value);
    return;
  }
  if (field === "rate_control") {
    syncNormalizeRateControl(index, control.value);
    return;
  }

  const config = state.configData || defaultConfigData();
  if (!config.channels?.[index]) return;
  config.channels[index].normalize_profile = {
    ...(config.channels[index].normalize_profile || {}),
    [field]: coerceValue(control.value, control.type),
  };
  state.configData = config;
  syncConfigEditor();
}

function syncDefaultControlToState(control) {
  if (!control?.dataset?.defaultField) return;
  const config = state.configData || defaultConfigData();
  config.defaults = config.defaults || {};
  config.defaults[control.dataset.defaultField] = coerceValue(control.value, control.type);
  state.configData = config;
  syncConfigEditor();
}

function syncProfileControlToState(control) {
  if (!control?.dataset?.profileField) return;
  const config = state.configData || defaultConfigData();
  config.normalize_profile = config.normalize_profile || {};
  config.normalize_profile[control.dataset.profileField] = coerceValue(control.value, control.type);
  state.configData = config;
  syncConfigEditor();
}

function streamSettingsCard(channel, index) {
  return youtubeCollapsibleCard({
    key: `youtube-stream-settings-${channel.name || index}`,
    title: "Stream Settings",
    helper: `Stream key, Studio URL, and stream behavior for ${channel.name || "this channel"}.`,
    extraClass: "youtube-stream-settings-card channel-settings selected-live-settings",
    attributes: `data-index="${index}" data-channel-name="${escapeAttr(channel.name || "")}"`,
    summaryMetaHtml: `<span class="meta">${escapeHtml(channel.name || "No channel selected")}</span>`,
    body: `
      <div class="form-grid">
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
    `,
  });
}

function selectedCloudVideos(channel) {
  return Array.isArray(channel?.cloud_playlist) ? channel.cloud_playlist : [];
}

function cloudVideoProviderId(item) {
  return String(item?.provider_id || item?.providerId || "").trim();
}

function cloudVideoFileId(item) {
  return String(item?.file_id || item?.provider_file_id || item?.providerFileId || "").trim();
}

function cloudVideoDisplayName(item) {
  return String(item?.display_name || item?.displayName || cloudVideoFileId(item) || "Cloud video").trim() || "Cloud video";
}

function cloudVideoCompatibilityStatus(item) {
  return String(item?.compatibility_status || item?.compatibilityStatus || "unknown").trim() || "unknown";
}

function cloudVideoCompatibilityMessage(item) {
  return String(item?.compatibility_message || item?.compatibilityMessage || "").trim();
}

function formatOptionalBytes(value) {
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes > 0 ? formatBytes(bytes) : "";
}

function cloudVideosSection(channel, index) {
  const providers = normalizedStorageProviders(state.configData || defaultConfigData())
    .filter((provider) => String(provider?.type || "") === "googleDrive");
  const statusProviders = Array.isArray(state.storageStatus?.providers) ? state.storageStatus.providers : [];
  const statusById = new Map(statusProviders.map((item) => [String(item.id || ""), item]));
  const selectedItems = selectedCloudVideos(channel);
  const browser = state.cloudBrowser;
  const activeBrowser = browser.open && browser.channelIndex === index;
  const activeProviderId = activeBrowser
    ? String(browser.providerId || "")
    : String(selectedItems[0]?.provider_id || selectedItems[0]?.providerId || providers[0]?.id || "");
  const activeStatus = statusById.get(activeProviderId) || null;
  const activeConnected = Boolean(activeStatus?.connected || activeStatus?.status === "connected");
  const providerSelect = providers.length
    ? `
        <select onchange="setCloudBrowserProvider(${index}, this.value)">
          ${providers.map((provider) => {
            const providerId = String(provider.id || "");
            const providerStatus = statusById.get(providerId) || provider;
            const connected = Boolean(providerStatus?.connected || providerStatus?.status === "connected");
            return `<option value="${escapeAttr(providerId)}" ${providerId === activeProviderId ? "selected" : ""}>${escapeHtml(provider.display_name || providerId)}${connected ? "" : " (Disconnected)"}</option>`;
          }).join("")}
        </select>
      `
    : `<span class="meta">No Google Drive provider is configured.</span>`;
  const selectedMarkup = selectedItems.length
    ? selectedItems.map((item) => {
        const providerId = cloudVideoProviderId(item);
        const fileId = cloudVideoFileId(item);
        const status = cloudVideoCompatibilityStatus(item);
        const badgeClass = status === "ready" ? "badge ok" : status === "needsDesktopPrep" ? "badge warn" : "badge warn";
        const sizeText = formatOptionalBytes(item?.size_bytes ?? item?.sizeBytes);
        const metaParts = [
          String(item?.mime_type || item?.mimeType || "").trim(),
          sizeText,
        ].filter(Boolean);
        return `
          <div class="file-option cloud-video-option">
            <span class="video-option-text">
              <span class="video-option-name">${escapeHtml(cloudVideoDisplayName(item))}</span>
              <span class="video-option-path">${escapeHtml(metaParts.join(" - ") || providerId)}</span>
              ${cloudVideoCompatibilityMessage(item) ? `<span class="meta">${escapeHtml(cloudVideoCompatibilityMessage(item))}</span>` : ""}
            </span>
            <span class="${badgeClass}">${escapeHtml(status)}</span>
            <button class="file-remove-button live-video-remove-button" type="button" title="Remove cloud video" aria-label="Remove ${escapeAttr(cloudVideoDisplayName(item))}" onclick="removeCloudVideo(${index}, '${escapeJs(providerId)}', '${escapeJs(fileId)}').catch((error) => toast(error.message))">x</button>
          </div>
        `;
      }).join("")
    : `<div class="meta">No cloud videos selected yet for this channel.</div>`;
  const browserItems = activeBrowser
    ? (
      browser.loading
        ? `<div class="meta">Loading Google Drive files...</div>`
        : browser.error
          ? `<div class="notice warn">${escapeHtml(browser.error)}</div>`
          : (Array.isArray(browser.items) && browser.items.length
            ? browser.items.map((item) => {
                const kind = String(item?.kind || "");
                const id = String(item?.id || "");
                const name = String(item?.name || id || "Untitled");
                if (kind === "folder") {
                  return `
                    <div class="file-option cloud-video-option">
                      <span class="video-option-text">
                        <span class="video-option-name">${escapeHtml(name)}</span>
                        <span class="video-option-path">Folder</span>
                      </span>
                      <button class="pill ghost" type="button" onclick="browseCloudFolder(${index}, '${escapeJs(id)}').catch((error) => toast(error.message))">Open</button>
                    </div>
                  `;
                }
                const sizeText = formatOptionalBytes(item?.sizeBytes);
                const disabled = !activeConnected || browser.addingFileId === id || item?.canDownload === false;
                return `
                  <div class="file-option cloud-video-option">
                    <span class="video-option-text">
                      <span class="video-option-name">${escapeHtml(name)}</span>
                      <span class="video-option-path">${escapeHtml([String(item?.mimeType || "").trim(), sizeText].filter(Boolean).join(" - "))}</span>
                    </span>
                    <button class="pill" type="button" ${disabled ? "disabled" : ""} onclick="addCloudVideo(${index}, '${escapeJs(activeProviderId)}', '${escapeJs(id)}').catch((error) => toast(error.message))">${escapeHtml(browser.addingFileId === id ? "Adding..." : "Add")}</button>
                  </div>
                `;
              }).join("")
            : `<div class="meta">No folders or video files found here.</div>`)
    )
    : "";
  const localOverrideNote = Array.isArray(channel?.playlist) && channel.playlist.length
    ? `<div class="notice warn">This channel has a local playlist override. Clear the local videos list if you want the selected cloud videos to be used instead.</div>`
    : `<div class="meta">When cloud videos are selected, Castarro uses them instead of the Go Live folder for this channel.</div>`;
  return youtubeCollapsibleCard({
    key: `youtube-cloud-videos-${channel.name || index}`,
    title: "Cloud Videos",
    helper: "Browse Google Drive and add copy-ready videos for direct streaming.",
    extraClass: "live-videos-card channel-settings",
    attributes: `data-index="${index}" data-channel-name="${escapeAttr(channel.name || "")}"`,
    summaryMetaHtml: `<span class="meta">${escapeHtml(selectedItems.length ? `${selectedItems.length} cloud video${selectedItems.length === 1 ? "" : "s"} selected` : "No cloud videos selected yet")}</span>`,
    body: `
      <div class="row wrap">
        ${providerSelect}
        <button class="pill" type="button" onclick="${activeConnected ? `toggleCloudBrowser(${index})` : `connectStorageProvider('${escapeJs(activeProviderId)}').catch((error) => toast(error.message))`}" ${activeProviderId ? "" : "disabled"}>${escapeHtml(activeConnected ? (activeBrowser ? "Hide Drive Browser" : "Browse Google Drive") : "Connect Google Drive")}</button>
      </div>
      ${activeStatus?.message ? `<div class="meta">${escapeHtml(activeStatus.message)}</div>` : ""}
      ${localOverrideNote}
      <div class="file-picker">
        <div class="file-list">${selectedMarkup}</div>
      </div>
      ${activeBrowser ? `
        <div class="file-picker">
          <div class="row wrap">
            <span class="badge">${escapeHtml(browser.folderName || "Google Drive")}</span>
            ${browser.parentId ? `<button class="pill ghost" type="button" onclick="browseCloudFolder(${index}, '${escapeJs(browser.parentId)}').catch((error) => toast(error.message))">Up One Folder</button>` : ""}
          </div>
          <div class="file-list">${browserItems}</div>
        </div>
      ` : ""}
    `,
  });
}

function liveVideosCard(channel, index) {
  const files = orderedLiveFilesForDisplay(channel, state.normalizedFilesByChannel[channel.name] || [])
    .filter((file) => !isActiveEncodingOutput(channel.name || "", file));
  const fileOptions = files.length
    ? files.map((file) => liveVideoOption(file, index, channel.name || "")).join("")
    : `<div class="meta">No normalized videos found yet in Go Live/${escapeHtml(channel.name || "")}. Normalize videos first.</div>`;
  return `
    <div class="channel-settings-stack">
      ${youtubeCollapsibleCard({
        key: `youtube-videos-${channel.name || index}`,
        title: "Videos",
        helper: "Drag normalized videos into the live order. Remove anything you do not want to stream.",
        extraClass: "live-videos-card channel-settings selected-live-videos",
        attributes: `data-index="${index}" data-channel-name="${escapeAttr(channel.name || "")}"`,
        summaryMetaHtml: `<span class="meta">${escapeHtml(files.length ? `${files.length} normalized video${files.length === 1 ? "" : "s"} ready` : "No normalized videos found yet")}</span>`,
        body: `<div class="file-list live-video-list" data-live-video-list>${fileOptions}</div>`,
      })}
      ${cloudVideosSection(channel, index)}
    </div>
  `;
}

function liveVideoOption(file, index, channelName) {
  const path = String(file?.path || "");
  const name = String(file?.name || path.split(/[\\/]/).pop() || path);
  const thumbnailQuery = new URLSearchParams({
    config: state.config,
    channel: channelName,
    path,
  });
  return `
    <div class="file-option live-video-option" data-live-video-option data-live-file-path="${escapeAttr(path)}">
      <button class="live-video-drag-handle" type="button" title="Drag to reorder" aria-label="Drag ${escapeAttr(name)} to reorder" onpointerdown="startLiveVideoDrag(event, ${index})" onmousedown="startLiveVideoDrag(event, ${index})">
        <span aria-hidden="true">::</span>
      </button>
      <img class="video-thumb" src="/api/video-thumbnail?${thumbnailQuery.toString()}" alt="" loading="lazy" onerror="this.classList.add('missing')">
      <span class="video-option-text">
        <span class="video-option-name">${escapeHtml(name)}</span>
        <span class="video-option-path">${escapeHtml(path)}</span>
      </span>
      <button class="file-remove-button live-video-remove-button" type="button" title="Remove from Videos list" aria-label="Remove ${escapeAttr(name)} from Videos list" onclick="event.preventDefault(); event.stopPropagation(); removeLiveVideoEntry(${index}, '${escapeJs(path)}')">x</button>
    </div>
  `;
}

function orderedLiveFilesForDisplay(channel, files) {
  const playlist = Array.isArray(channel?.playlist)
    ? channel.playlist.map((item) => String(item || "")).filter(Boolean)
    : [];
  if (!playlist.length) return files;

  const byPath = new Map();
  files.forEach((file) => {
    const path = String(file?.path || "");
    if (path && !byPath.has(path)) byPath.set(path, file);
  });

  const ordered = [];
  const seen = new Set();
  playlist.forEach((path) => {
    if (seen.has(path)) return;
    seen.add(path);
    ordered.push(byPath.get(path) || {
      name: path.split(/[\\/]/).pop() || path,
      path,
      folder: path.split(/[\\/]/).slice(0, -1).join("/") || "",
      exists: false,
    });
  });
  files.forEach((file) => {
    const path = String(file?.path || "");
    if (!path || seen.has(path)) return;
    seen.add(path);
    ordered.push(file);
  });
  return ordered;
}

function isActiveEncodingOutput(channelName, file) {
  const path = String(file?.path || "");
  const name = String(file?.name || path.split(/[\\/]/).pop() || "");
  if (!path && !name) return false;
  const tasks = state.status?.tasks || [];
  return tasks.some((task) => {
    if (!task?.running || task.name !== "normalize") return false;
    const taskChannel = String(task.channel || task.progress?.channel || "");
    if (taskChannel !== String(channelName || "")) return false;
    const message = String(task.progress?.message || "");
    const outputName = message.includes(" -> ") ? message.split(" -> ").pop().trim() : "";
    return outputName && (outputName === name || path.endsWith(`/${outputName}`) || path.endsWith(`\\${outputName}`));
  });
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

function removeRawSelection(index, rawFile) {
  const config = state.configData || defaultConfigData();
  if (!config.channels?.[index]) return;
  const selected = Array.isArray(config.channels[index].raw_playlist) ? config.channels[index].raw_playlist : [];
  config.channels[index].raw_playlist = selected.filter((item) => item !== rawFile);
  const channelName = String(config.channels[index].name || "");
  if (channelName && Array.isArray(state.rawFilesByChannel[channelName])) {
    state.rawFilesByChannel[channelName] = state.rawFilesByChannel[channelName].filter((file) => file?.path !== rawFile);
  }
  state.configData = config;
  $("configEditor").value = JSON.stringify(config, null, 2) + "\n";
  renderSettingsForms();
}

function syncLiveSelection(index) {
  const card = liveVideosCardForIndex(index);
  if (!card) return;
  const selected = liveVideoPathsFromCard(card);
  const config = state.configData || defaultConfigData();
  if (config.channels?.[index]) {
    config.channels[index].playlist = selected;
    state.configData = config;
    $("configEditor").value = JSON.stringify(config, null, 2) + "\n";
  }
}

function liveVideosCardForIndex(index) {
  return document.querySelector(`#channelSettings .selected-live-videos[data-index="${index}"]`);
}

function liveVideoPathsFromCard(card) {
  return Array.from(card?.querySelectorAll("[data-live-video-option]") || [])
    .map((item) => item.dataset.liveFilePath)
    .filter(Boolean);
}

function removeLiveVideoEntry(index, liveFile) {
  const config = state.configData || defaultConfigData();
  if (!config.channels?.[index]) return;
  const channelName = String(config.channels[index].name || "");
  const visiblePaths = liveVideoPathsFromCard(liveVideosCardForIndex(index));
  const fallbackPaths = Array.isArray(state.normalizedFilesByChannel[channelName])
    ? state.normalizedFilesByChannel[channelName].map((file) => String(file?.path || "")).filter(Boolean)
    : [];
  const currentPaths = (visiblePaths.length ? visiblePaths : fallbackPaths);
  config.channels[index].playlist = currentPaths.filter((item) => item !== liveFile);
  if (channelName && Array.isArray(state.normalizedFilesByChannel[channelName])) {
    state.normalizedFilesByChannel[channelName] = state.normalizedFilesByChannel[channelName]
      .filter((file) => file?.path !== liveFile);
  }
  state.configData = config;
  $("configEditor").value = JSON.stringify(config, null, 2) + "\n";
  scheduleSettingsAutosave?.(200);
  renderSettingsForms();
}

async function loadCloudBrowser(index, providerId, folderId = "root") {
  if (!providerId) {
    throw new Error("Choose a Google Drive provider first.");
  }
  state.cloudBrowser = {
    ...state.cloudBrowser,
    open: true,
    channelIndex: index,
    providerId,
    folderId,
    loading: true,
    error: "",
  };
  renderSettingsFormsUnlessPaused();
  try {
    const query = new URLSearchParams({
      config: state.config,
      provider: providerId,
      folder: folderId,
    });
    const payload = await api(`/api/storage/files?${query.toString()}`, { action: "storage.files" });
    state.cloudBrowser = {
      ...state.cloudBrowser,
      open: true,
      channelIndex: index,
      providerId,
      folderId: String(payload?.folder?.id || folderId || "root"),
      folderName: String(payload?.folder?.name || "Google Drive"),
      parentId: String(payload?.folder?.parent_id || payload?.folder?.parentId || ""),
      items: Array.isArray(payload?.items) ? payload.items : [],
      loading: false,
      error: payload?.ok === false ? String(payload?.message || "Could not load Google Drive files.") : "",
    };
  } catch (error) {
    state.cloudBrowser = {
      ...state.cloudBrowser,
      open: true,
      channelIndex: index,
      providerId,
      folderId,
      items: [],
      loading: false,
      error: error.message || "Could not load Google Drive files.",
    };
    throw error;
  } finally {
    renderSettingsFormsUnlessPaused();
  }
}

function toggleCloudBrowser(index) {
  const config = state.configData || defaultConfigData();
  const providers = normalizedStorageProviders(config).filter((provider) => String(provider?.type || "") === "googleDrive");
  const providerId = String(state.cloudBrowser.providerId || providers[0]?.id || "").trim();
  if (!providerId) {
    toast("Configure a Google Drive provider in Storage settings first.");
    return;
  }
  if (state.cloudBrowser.open && state.cloudBrowser.channelIndex === index) {
    state.cloudBrowser = {
      ...state.cloudBrowser,
      open: false,
      channelIndex: -1,
      items: [],
      error: "",
    };
    renderSettingsForms();
    return;
  }
  loadCloudBrowser(index, providerId, "root").catch((error) => toast(error.message));
}

function setCloudBrowserProvider(index, providerId) {
  state.cloudBrowser = {
    ...state.cloudBrowser,
    providerId,
    channelIndex: index,
  };
  renderSettingsFormsUnlessPaused();
  if (state.cloudBrowser.open && state.cloudBrowser.channelIndex === index) {
    loadCloudBrowser(index, providerId, "root").catch((error) => toast(error.message));
  }
}

async function browseCloudFolder(index, folderId) {
  const providerId = String(state.cloudBrowser.providerId || "").trim();
  if (!providerId) {
    throw new Error("Choose a Google Drive provider first.");
  }
  await loadCloudBrowser(index, providerId, folderId || "root");
}

async function addCloudVideo(index, providerId, fileId) {
  state.cloudBrowser = {
    ...state.cloudBrowser,
    addingFileId: fileId,
  };
  renderSettingsFormsUnlessPaused();
  try {
    const payload = await api("/api/storage/video/prepare", {
      method: "POST",
      action: "storage.video.prepare",
      body: JSON.stringify({
        config: state.config,
        provider: providerId,
        file_id: fileId,
      }),
    });
    const item = payload?.item;
    if (!item) {
      throw new Error("Google Drive did not return a prepared cloud video item.");
    }
    const config = collectSettingsData();
    const channel = config.channels?.[index];
    if (!channel) {
      throw new Error("Channel was not found.");
    }
    const current = Array.isArray(channel.cloud_playlist) ? channel.cloud_playlist : [];
    const next = current.filter((entry) => !(
      cloudVideoProviderId(entry) === providerId
      && cloudVideoFileId(entry) === fileId
    ));
    next.push(item);
    channel.cloud_playlist = next;
    state.configData = config;
    syncConfigEditor();
    await saveConfigData(config, { render: false, refresh: false, reloadFiles: false });
    renderSettingsForms();
    toast(`Added ${cloudVideoDisplayName(item)} from Google Drive.`);
  } finally {
    state.cloudBrowser = {
      ...state.cloudBrowser,
      addingFileId: "",
    };
    renderSettingsFormsUnlessPaused();
  }
}

async function removeCloudVideo(index, providerId, fileId) {
  const config = collectSettingsData();
  const channel = config.channels?.[index];
  if (!channel) return;
  const current = Array.isArray(channel.cloud_playlist) ? channel.cloud_playlist : [];
  channel.cloud_playlist = current.filter((entry) => !(
    cloudVideoProviderId(entry) === providerId
    && cloudVideoFileId(entry) === fileId
  ));
  state.configData = config;
  syncConfigEditor();
  await saveConfigData(config, { render: false, refresh: false, reloadFiles: false });
  renderSettingsForms();
}

function startLiveVideoDrag(event, index) {
  if (state.liveVideoDrag) return;
  if (event.button !== undefined && event.button !== 0) return;
  const item = event.currentTarget?.closest("[data-live-video-option]");
  const list = item?.closest("[data-live-video-list]");
  if (!item || !list) return;

  event.preventDefault();
  event.stopPropagation();

  const items = Array.from(list.querySelectorAll("[data-live-video-option]"));
  const originalIndex = items.indexOf(item);
  if (originalIndex < 0) return;

  const rects = items.map((node) => node.getBoundingClientRect());
  const draggedRect = rects[originalIndex];
  const nextRect = rects[originalIndex + 1];
  const previousRect = rects[originalIndex - 1];
  const gapAfter = nextRect ? Math.max(0, nextRect.top - draggedRect.bottom) : 0;
  const gapBefore = previousRect ? Math.max(0, draggedRect.top - previousRect.bottom) : 0;

  state.liveVideoDrag = {
    index,
    pointerId: liveVideoDragPointerId(event),
    list,
    item,
    items,
    rects,
    originalIndex,
    currentIndex: originalIndex,
    startY: event.clientY,
    shiftDistance: draggedRect.height + Math.max(gapAfter, gapBefore, 8),
  };

  list.classList.add("is-dragging");
  item.classList.add("is-dragging");
  item.style.transform = "translateY(0px)";
  if (typeof event.pointerId === "number") {
    item.setPointerCapture?.(event.pointerId);
  }
  window.addEventListener("pointermove", moveLiveVideoDrag);
  window.addEventListener("pointerup", endLiveVideoDrag);
  window.addEventListener("pointercancel", cancelLiveVideoDrag);
  window.addEventListener("mousemove", moveLiveVideoDrag);
  window.addEventListener("mouseup", endLiveVideoDrag);
}

function moveLiveVideoDrag(event) {
  const drag = state.liveVideoDrag;
  if (!drag || !liveVideoDragEventMatches(drag, event)) return;
  event.preventDefault();
  updateLiveVideoDragPosition(drag, event.clientY);
}

function updateLiveVideoDragPosition(drag, clientY) {
  const deltaY = clientY - drag.startY;
  let targetIndex = drag.originalIndex;
  drag.rects.forEach((rect, rectIndex) => {
    if (rectIndex === drag.originalIndex) return;
    if (deltaY > 0 && rectIndex > drag.originalIndex && clientY > rect.top) {
      targetIndex = rectIndex;
    } else if (deltaY < 0 && rectIndex < drag.originalIndex && clientY < rect.bottom) {
      targetIndex = rectIndex;
    }
  });

  drag.currentIndex = Math.max(0, Math.min(drag.items.length - 1, targetIndex));
  drag.item.style.transform = `translateY(${deltaY}px)`;
  drag.items.forEach((node, nodeIndex) => {
    if (node === drag.item) return;
    let offset = 0;
    if (drag.currentIndex > drag.originalIndex && nodeIndex > drag.originalIndex && nodeIndex <= drag.currentIndex) {
      offset = -drag.shiftDistance;
    } else if (drag.currentIndex < drag.originalIndex && nodeIndex >= drag.currentIndex && nodeIndex < drag.originalIndex) {
      offset = drag.shiftDistance;
    }
    node.style.transform = offset ? `translateY(${offset}px)` : "";
  });
}

function endLiveVideoDrag(event) {
  const drag = state.liveVideoDrag;
  if (!drag || !liveVideoDragEventMatches(drag, event)) return;
  updateLiveVideoDragPosition(drag, event.clientY);
  finishLiveVideoDrag(true);
}

function cancelLiveVideoDrag(event) {
  const drag = state.liveVideoDrag;
  if (!drag || !liveVideoDragEventMatches(drag, event)) return;
  finishLiveVideoDrag(false);
}

function liveVideoDragPointerId(event) {
  return event.pointerId ?? "mouse";
}

function liveVideoDragEventMatches(drag, event) {
  const eventId = liveVideoDragPointerId(event);
  return drag.pointerId === eventId || (eventId === "mouse" && typeof drag.pointerId === "number");
}

function finishLiveVideoDrag(applyOrder) {
  const drag = state.liveVideoDrag;
  if (!drag) return;

  window.removeEventListener("pointermove", moveLiveVideoDrag);
  window.removeEventListener("pointerup", endLiveVideoDrag);
  window.removeEventListener("pointercancel", cancelLiveVideoDrag);
  window.removeEventListener("mousemove", moveLiveVideoDrag);
  window.removeEventListener("mouseup", endLiveVideoDrag);

  const orderedItems = drag.items.slice();
  if (applyOrder && drag.currentIndex !== drag.originalIndex) {
    const [moved] = orderedItems.splice(drag.originalIndex, 1);
    orderedItems.splice(drag.currentIndex, 0, moved);
    orderedItems.forEach((node) => drag.list.appendChild(node));
  }

  drag.items.forEach((node) => {
    node.style.transform = "";
    node.classList.remove("is-dragging");
  });
  drag.list.classList.remove("is-dragging");
  state.liveVideoDrag = null;

  if (applyOrder) {
    syncLiveVideoOrder(drag.index, orderedItems);
  }
}

function syncLiveVideoOrder(index, orderedItems = null) {
  const card = liveVideosCardForIndex(index);
  if (!card && !Array.isArray(orderedItems)) return;
  const optionItems = Array.isArray(orderedItems)
    ? orderedItems
    : Array.from(card.querySelectorAll("[data-live-video-option]"));
  const orderedPaths = optionItems
    .map((item) => item.dataset.liveFilePath)
    .filter(Boolean);
  const config = state.configData || defaultConfigData();
  if (!config.channels?.[index]) return;
  const channelName = String(config.channels[index].name || "");

  config.channels[index].playlist = orderedPaths;
  if (channelName && Array.isArray(state.normalizedFilesByChannel[channelName])) {
    const byPath = new Map(state.normalizedFilesByChannel[channelName].map((file) => [String(file?.path || ""), file]));
    const reordered = orderedPaths.map((path) => byPath.get(path)).filter(Boolean);
    state.normalizedFilesByChannel[channelName].forEach((file) => {
      const path = String(file?.path || "");
      if (path && !orderedPaths.includes(path)) reordered.push(file);
    });
    state.normalizedFilesByChannel[channelName] = reordered;
  }

  state.configData = config;
  $("configEditor").value = JSON.stringify(config, null, 2) + "\n";
  scheduleSettingsAutosave?.(200);
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
  const card = liveVideosCardForIndex(index);
  if (!card) return;
  card.querySelectorAll("[data-live-file]").forEach((input) => {
    input.checked = true;
  });
  syncLiveSelection(index);
}

function clearLiveFiles(index) {
  const card = liveVideosCardForIndex(index);
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
  config.storage = { ...defaultStorageSettings(), ...(config.storage || {}) };
  config.storage.source_proxy = {
    ...defaultStorageSettings().source_proxy,
    ...(config.storage.source_proxy || {}),
  };
  config.storage.providers = normalizedStorageProviders(config);
  config.ui = { ...defaultConfigData().ui, ...(config.ui || {}) };
  config.ui.channel_workspace_enabled = true;
  config.ui.legacy_tabs_enabled = false;

  document.querySelectorAll("[data-default-field]").forEach((input) => {
    config.defaults[input.dataset.defaultField] = coerceValue(input.value, input.type);
  });

  document.querySelectorAll("[data-profile-field]").forEach((input) => {
    config.normalize_profile[input.dataset.profileField] = coerceValue(input.value, input.type);
  });

  document.querySelectorAll("[data-youtube-field]").forEach((input) => {
    const field = input.dataset.youtubeField;
    if (input.type === "checkbox") {
      config.youtube[field] = input.checked;
    } else {
      config.youtube[field] = input.value;
    }
  });

  document.querySelectorAll("[data-storage-proxy-field]").forEach((input) => {
    const field = input.dataset.storageProxyField;
    config.storage.source_proxy[field] = input.type === "checkbox"
      ? input.checked
      : coerceValue(input.value, input.type);
  });

  document.querySelectorAll("[data-storage-provider-oauth-field]").forEach((input) => {
    const index = Number(input.dataset.storageProviderIndex);
    const field = input.dataset.storageProviderOauthField;
    if (!Number.isInteger(index) || index < 0 || !field || !config.storage.providers?.[index]) return;
    const provider = config.storage.providers[index];
    provider.oauth = { ...defaultStorageProviderOauth(), ...(provider.oauth || {}) };
    provider.oauth[field] = input.type === "checkbox"
      ? input.checked
      : input.value;
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
    channel.cloud_playlist = Array.isArray(existingChannel.cloud_playlist) ? existingChannel.cloud_playlist : [];
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
    if (!Array.isArray(channel.cloud_playlist)) {
      channel.cloud_playlist = [];
    }
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
  await refreshYoutubeStatus();
  await autoVerifySelectedYoutubeChannel({ force: true });
  toast("Settings saved.");
}

function settingsAutosaveTargetChanged(target) {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return false;
  if (!target.closest("#viewSettings")) return false;
  if (target.type === "file") return false;
  return Boolean(target.matches([
    "[data-default-field]",
    "[data-profile-field]",
    "[data-youtube-field]",
    "[data-storage-proxy-field]",
    "[data-storage-provider-oauth-field]",
    "[data-normalize-index][data-normalize-field]",
    "[data-channel-field]",
    "[data-live-profile-field]",
    "[data-youtube-channel-index][data-youtube-channel-field]",
    "[data-raw-file]",
    "[data-live-file]",
  ].join(",")));
}

function scheduleSettingsAutosave(delayMs = 900) {
  window.clearTimeout(state.settingsAutosaveTimer);
  state.settingsAutosaveTimer = window.setTimeout(() => {
    autosaveSettings().catch((error) => {
      toast(`Autosave failed: ${error.message}`);
    });
  }, delayMs);
}

async function autosaveSettings() {
  if (state.settingsAutosaveBusy) {
    state.settingsAutosaveQueued = true;
    return;
  }
  const data = collectSettingsData();
  const signature = JSON.stringify(data);
  if (signature === state.settingsAutosaveLastSignature) return;

  state.settingsAutosaveBusy = true;
  state.settingsAutosaveQueued = false;
  try {
    await saveConfigData(data, { render: false, refresh: false, reloadFiles: false });
    state.settingsAutosaveLastSignature = JSON.stringify(state.configData || data);
    state.settingsAutosaveLastAt = Date.now();
    await autoVerifySelectedYoutubeChannel({ force: true });
    toast("Settings saved automatically.");
  } finally {
    state.settingsAutosaveBusy = false;
    if (state.settingsAutosaveQueued) {
      scheduleSettingsAutosave(250);
    }
  }
}

async function flushSettingsAutosave() {
  if (state.settingsAutosaveTimer) {
    window.clearTimeout(state.settingsAutosaveTimer);
    state.settingsAutosaveTimer = null;
    await autosaveSettings();
  }
  while (state.settingsAutosaveBusy) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  if (state.settingsAutosaveQueued) {
    state.settingsAutosaveQueued = false;
    await autosaveSettings();
  }
}

async function saveConfigData(data, options = {}) {
  const render = options.render !== false;
  const refreshStatus = options.refresh !== false;
  const reloadFiles = options.reloadFiles !== false;
  trimStreamKeyFields(data);
  validateConfigData(data);
  await api("/api/config/save", {
    method: "POST",
    body: JSON.stringify({ config: state.config, text: JSON.stringify(data, null, 2) }),
    action: "config.save",
  });
  state.configData = data;
  normalizeConfigShape();
  state.settingsAutosaveLastSignature = JSON.stringify(state.configData);
  $("configEditor").value = JSON.stringify(state.configData, null, 2) + "\n";
  if (render) {
    renderSettingsForms();
  } else {
    renderSettingsFormsUnlessPaused();
  }
  if (refreshStatus) {
    await refresh();
  }
  if (reloadFiles) {
    await loadRawFiles();
    await loadNormalizedFiles();
  }
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

async function startSettingsTask(action, index, { startIndex = 1, chooseOutputFolder = true } = {}) {
  const data = collectSettingsData();
  const channel = data.channels?.[index];
  if (!channel?.name) {
    toast("Save a channel name before running this task.");
    return;
  }

  state.activeSettingsChannelIndex = index;
  if (action === "normalize" && chooseOutputFolder) {
    const outputFolder = await chooseEncodeOutputFolder(data);
    if (!outputFolder) {
      toast("Encoding canceled.");
      return;
    }
    data.defaults = data.defaults || {};
    data.defaults.normalized_dir = outputFolder;
    state.configData = data;
    syncConfigEditor();
  }
  await saveConfigData(data);
  await startTask(action, channel.name, false, startIndex);
}

async function resumeSettingsTask(action, index, startIndex) {
  await startSettingsTask(action, index, {
    startIndex: Math.max(1, Number(startIndex) || 1),
    chooseOutputFolder: false,
  });
}

async function startTask(action, channel = null, showControl = true, startIndex = 1) {
  await flushSettingsAutosave();
  const body = { config: state.config, action, channel };
  if (startIndex > 1) {
    body.start_index = startIndex;
  }
  await api("/api/task/start", {
    method: "POST",
    body: JSON.stringify(body),
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
  await flushSettingsAutosave();
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
      .find((entry) => entry[1] === state.settingsTab)?.[0] || "encoder");
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
          state.youtubeBroadcastsLoadedKey = "";
          state.youtubeBroadcastsFailedKey = "";
          state.youtubeBroadcastsLoadError = "";
          state.youtubeKeyChecks = null;
          renderYoutubeSettingsPanel(state.configData || defaultConfigData());
          return;
        }
        const selectedChannel = String(state.workspace.selectedChannelName || "").trim();
        return refreshYoutubeBroadcasts(Boolean(selectedChannel), { silent: true })
          .then(() => autoVerifySelectedYoutubeChannel({ channelName: selectedChannel }));
      })
      .catch((error) => toast(error.message));
  }
  if (tab === "storage") {
    refreshStorageStatus().catch((error) => toast(error.message));
  }
}

async function refreshSyncStatus() {
  const payload = await api("/api/sync/status", { action: "sync.status" });
  state.syncStatus = payload;
  renderSyncPanel();
  return payload;
}

function renderSyncPanel() {
  const status = state.syncStatus || {};
  const panel = $("workspaceSyncPanel");
  const devices = Array.isArray(status.devices) ? status.devices : [];
  if (!panel) return;
  if (devices.length) {
    state.syncPairing = null;
  }
  panel.innerHTML = devices.length
    ? `
        <div class="workspace-sync-compact">
          ${devices.map((device) => `
            <div class="workspace-sync-row">
              <strong class="workspace-sync-device">${escapeHtml(device.deviceName || "Paired phone")}</strong>
              <button class="pill ghost small" type="button" onclick="disconnectSyncDevice('${escapeJs(device.id || "")}').catch((error) => toast(error.message))">Disconnect</button>
            </div>
          `).join("")}
        </div>
      `
    : `
        <div class="workspace-sync-empty">
          <div class="workspace-sync-row">
            <span class="badge warn">Not Synced</span>
            <button class="pill primary" type="button" onclick="startSyncPairing().catch((error) => toast(error.message))">Create QR pairing</button>
          </div>
          ${state.syncPairing
            ? `<div class="sync-pairing-box" id="syncPairingBox">
                <canvas id="syncQrCanvas" width="220" height="220" aria-label="Castarro pairing QR code"></canvas>
                <p class="helper">Scan this QR from the Castarro mobile app.</p>
              </div>`
            : `<p class="helper">Pair this desktop with a mobile device on the same network.</p>`}
        </div>
      `;
  if (!devices.length) {
    renderSyncPairing();
  }
}

async function disconnectSyncDevice(deviceId) {
  const payload = await api("/api/sync/device/disconnect", {
    method: "POST",
    action: "sync.device.disconnect",
    body: JSON.stringify({ deviceId }),
  });
  state.syncStatus = payload;
  renderSyncPanel();
  toast("Device disconnected.");
}

function selectedSchedulerChannelName(config = state.configData || defaultConfigData()) {
  return String(
    state.workspace.selectedChannelName
    || config.channels?.[selectedSettingsChannelIndex(config)]?.name
    || config.channels?.[0]?.name
    || ""
  ).trim();
}

function findSchedulerChannelEntry(config, channelName) {
  const scheduler = { ...defaultSchedulerSettings(), ...(config?.scheduler || {}) };
  const channels = Array.isArray(scheduler.channels) ? scheduler.channels : [];
  return channels.find((item) => String(item?.channel || "").trim() === String(channelName || "").trim()) || null;
}

function ensureSchedulerChannelEntry(config, channelName) {
  const scheduler = config.scheduler = {
    ...defaultSchedulerSettings(),
    ...(config.scheduler || {}),
    channels: Array.isArray(config?.scheduler?.channels) ? [...config.scheduler.channels] : [],
  };
  let entry = scheduler.channels.find((item) => String(item?.channel || "").trim() === String(channelName || "").trim());
  if (!entry) {
    entry = {
      channel: channelName,
      enabled: false,
      start_time: "09:00",
      stop_time: "17:00",
      days: [...SCHEDULE_DAYS],
    };
    scheduler.channels.push(entry);
  }
  entry.days = Array.isArray(entry.days) ? entry.days : [...SCHEDULE_DAYS];
  return entry;
}

function updateAlertToggle(key, value) {
  normalizeConfigShape();
  const alerts = state.configData.alerts = {
    ...defaultAlertSettings(),
    ...(state.configData.alerts || {}),
    rules: {
      ...defaultAlertSettings().rules,
      ...((state.configData.alerts && state.configData.alerts.rules) || {}),
    },
  };
  if (key.startsWith("rules.")) {
    alerts.rules[key.slice(6)] = Boolean(value);
  } else {
    alerts[key] = typeof alerts[key] === "number" ? Math.max(30, Number(value) || 300) : Boolean(value);
  }
  renderAutomationSettingsPanel(state.configData);
  scheduleSettingsAutosave(200);
}

function updateSchedulerSetting(key, value) {
  normalizeConfigShape();
  const scheduler = state.configData.scheduler = {
    ...defaultSchedulerSettings(),
    ...(state.configData.scheduler || {}),
    channels: Array.isArray(state.configData?.scheduler?.channels) ? [...state.configData.scheduler.channels] : [],
  };
  if (key === "enabled") {
    scheduler.enabled = Boolean(value);
  } else if (key === "poll_seconds") {
    scheduler.poll_seconds = Math.max(10, Number(value) || 20);
  }
  renderAutomationSettingsPanel(state.configData);
  scheduleSettingsAutosave(200);
}

function updateChannelSchedulerSetting(field, value) {
  normalizeConfigShape();
  const channelName = selectedSchedulerChannelName(state.configData);
  if (!channelName) return;
  const entry = ensureSchedulerChannelEntry(state.configData, channelName);
  if (field === "enabled") {
    entry.enabled = Boolean(value);
  } else if (field === "start_time" || field === "stop_time") {
    entry[field] = String(value || "");
  }
  renderAutomationSettingsPanel(state.configData);
  scheduleSettingsAutosave(200);
}

function toggleChannelSchedulerDay(day, checked) {
  normalizeConfigShape();
  const channelName = selectedSchedulerChannelName(state.configData);
  if (!channelName) return;
  const entry = ensureSchedulerChannelEntry(state.configData, channelName);
  const current = new Set(Array.isArray(entry.days) ? entry.days : []);
  if (checked) {
    current.add(day);
  } else {
    current.delete(day);
  }
  entry.days = SCHEDULE_DAYS.filter((item) => current.has(item));
  renderAutomationSettingsPanel(state.configData);
  scheduleSettingsAutosave(200);
}

function toggleWorkspaceAlertsMenu() {
  state.workspace.alertsMenuOpen = !state.workspace.alertsMenuOpen;
  rerenderWorkspaceHeader();
}

function closeWorkspaceAlertsMenu() {
  if (!state.workspace.alertsMenuOpen) return;
  state.workspace.alertsMenuOpen = false;
  rerenderWorkspaceHeader();
}

async function showDesktopAlertNotification(alert) {
  const title = String(alert?.title || "Castarro alert");
  const body = String(alert?.message || "");
  const bridge = desktopBridge();
  if (bridge && typeof bridge.showNotification === "function") {
    await bridge.showNotification({ title, body });
    return;
  }
  if ("Notification" in window) {
    if (Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        return;
      }
    }
    if (Notification.permission === "granted") {
      new Notification(title, { body });
    }
  }
}

function rememberDeliveredAlertIds(nextIds) {
  state.deliveredAlertIds = Array.from(new Set([...(state.deliveredAlertIds || []), ...nextIds])).slice(-40);
}

function deliverDesktopAlerts(payload = state.status) {
  const alerts = payload?.alerts || {};
  const recent = Array.isArray(alerts.recent) ? alerts.recent : [];
  const enabled = alerts.desktop_notifications_enabled !== false;
  if (!enabled || !recent.length) return;
  const seen = new Set(state.deliveredAlertIds || []);
  const fresh = recent
    .filter((item) => item?.desktop_enabled !== false && !seen.has(Number(item?.id || 0)))
    .sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));
  if (!fresh.length) return;
  rememberDeliveredAlertIds(fresh.map((item) => Number(item?.id || 0)));
  fresh.forEach((item) => {
    showDesktopAlertNotification(item).catch(() => {});
  });
}

function renderAutomationSettingsPanel(config = state.configData || defaultConfigData()) {
  const container = $("automationSettingsPanel");
  if (!container) return;
  const alerts = {
    ...defaultAlertSettings(),
    ...(config.alerts || {}),
    rules: {
      ...defaultAlertSettings().rules,
      ...((config.alerts && config.alerts.rules) || {}),
    },
  };
  const scheduler = {
    ...defaultSchedulerSettings(),
    ...(config.scheduler || {}),
  };
  const channelName = selectedSchedulerChannelName(config);
  const channelEntry = findSchedulerChannelEntry(config, channelName) || {
    channel: channelName,
    enabled: false,
    start_time: "09:00",
    stop_time: "17:00",
    days: [...SCHEDULE_DAYS],
  };
  const schedulerStatus = Array.isArray(state.status?.scheduler?.channels)
    ? state.status.scheduler.channels.find((item) => String(item?.channel || "") === channelName)
    : null;
  container.innerHTML = `
    <div class="automation-grid">
      <section class="automation-card">
        <div>
          <h3>Alerts and notifications</h3>
          <p class="helper">Choose which major events should surface on desktop and paired phones.</p>
        </div>
        <div class="automation-toggle-grid">
          <div class="automation-toggle">
            <label><input type="checkbox" ${alerts.desktop_notifications_enabled ? "checked" : ""} onchange="updateAlertToggle('desktop_notifications_enabled', this.checked)"> Desktop system notifications</label>
            <span class="helper">Uses the desktop shell to surface critical stream alerts outside the app window.</span>
          </div>
          <div class="automation-toggle">
            <label><input type="checkbox" ${alerts.mobile_notifications_enabled ? "checked" : ""} onchange="updateAlertToggle('mobile_notifications_enabled', this.checked)"> Mobile remote notifications</label>
            <span class="helper">Paired phones can surface new desktop alerts while remote monitoring is active.</span>
          </div>
          <div class="automation-toggle">
            <label><input type="checkbox" ${alerts.rules.stream_stopped ? "checked" : ""} onchange="updateAlertToggle('rules.stream_stopped', this.checked)"> Unexpected stream stop</label>
            <span class="helper">Warn when FFmpeg exits unexpectedly.</span>
          </div>
          <div class="automation-toggle">
            <label><input type="checkbox" ${alerts.rules.poor_connection ? "checked" : ""} onchange="updateAlertToggle('rules.poor_connection', this.checked)"> Poor connection</label>
            <span class="helper">Warn when live delivery falls behind or drops frames.</span>
          </div>
          <div class="automation-toggle">
            <label><input type="checkbox" ${alerts.rules.scheduler_started ? "checked" : ""} onchange="updateAlertToggle('rules.scheduler_started', this.checked)"> Scheduler started stream</label>
            <span class="helper">Confirm when a daily schedule starts a channel.</span>
          </div>
          <div class="automation-toggle">
            <label><input type="checkbox" ${alerts.rules.scheduler_stopped ? "checked" : ""} onchange="updateAlertToggle('rules.scheduler_stopped', this.checked)"> Scheduler stopped stream</label>
            <span class="helper">Confirm when a daily schedule ends a channel.</span>
          </div>
        </div>
      </section>
      <section class="automation-card">
        <div>
          <h3>Programming scheduler</h3>
          <p class="helper">Daily local-time windows for automatic stream start and stop.</p>
        </div>
        <div class="schedule-grid">
          <label>
            <span class="field-hint">Enable scheduler</span>
            <input type="checkbox" ${scheduler.enabled ? "checked" : ""} onchange="updateSchedulerSetting('enabled', this.checked)">
          </label>
          <label>
            <span class="field-hint">Poll every</span>
            <input type="number" min="10" step="5" value="${escapeAttr(String(scheduler.poll_seconds || 20))}" onchange="updateSchedulerSetting('poll_seconds', this.value)">
          </label>
          <div>
            <span class="field-hint">Timezone</span>
            <div>${escapeHtml(state.status?.scheduler?.timezone_label || "Local timezone")}</div>
          </div>
        </div>
        ${channelName ? `
          <div class="automation-toggle">
            <strong>${escapeHtml(channelName)}</strong>
            <span class="helper">${schedulerStatus?.in_window ? "Currently inside the scheduled window." : "Currently outside the scheduled window."} ${schedulerStatus?.next_start_at ? `Next start ${escapeHtml(formatDateTime(schedulerStatus.next_start_at))}.` : ""} ${schedulerStatus?.next_stop_at ? `Next stop ${escapeHtml(formatDateTime(schedulerStatus.next_stop_at))}.` : ""}</span>
          </div>
          <div class="schedule-grid">
            <label>
              <span class="field-hint">Enable for channel</span>
              <input type="checkbox" ${channelEntry.enabled ? "checked" : ""} onchange="updateChannelSchedulerSetting('enabled', this.checked)">
            </label>
            <label>
              <span class="field-hint">Start time</span>
              <input type="time" value="${escapeAttr(channelEntry.start_time || "09:00")}" onchange="updateChannelSchedulerSetting('start_time', this.value)">
            </label>
            <label>
              <span class="field-hint">Stop time</span>
              <input type="time" value="${escapeAttr(channelEntry.stop_time || "17:00")}" onchange="updateChannelSchedulerSetting('stop_time', this.value)">
            </label>
          </div>
          <div class="schedule-days">
            ${SCHEDULE_DAYS.map((day) => `
              <label>
                <input type="checkbox" ${Array.isArray(channelEntry.days) && channelEntry.days.includes(day) ? "checked" : ""} onchange="toggleChannelSchedulerDay('${day}', this.checked)">
                ${escapeHtml(day.toUpperCase())}
              </label>
            `).join("")}
          </div>
        ` : `<p class="helper">Create or select a channel to configure its daily schedule.</p>`}
      </section>
    </div>
  `;
}

async function startSyncPairing() {
  const payload = await api("/api/sync/pairing/start", {
    method: "POST",
    action: "sync.pairing.start",
    body: JSON.stringify({
      config: state.config,
      includeVideos: true,
    }),
  });
  state.syncPairing = payload.pairing || null;
  renderSyncPanel();
  toast("Pairing QR is ready.");
}

function renderSyncPairing() {
  const pairing = state.syncPairing;
  const box = $("syncPairingBox");
  if (!box) return;
  if (!pairing) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  const canvas = $("syncQrCanvas");
  const value = pairing.pairingUri || pairing.pairingUrl || "";
  if (canvas && window.qrcode && value) {
    drawPairingQr(canvas, value);
  }
}

function drawPairingQr(canvas, value) {
  const qr = window.qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const context = canvas.getContext("2d");
  const count = qr.getModuleCount();
  const size = canvas.width;
  const margin = 10;
  const moduleSize = Math.floor((size - margin * 2) / count);
  const qrSize = moduleSize * count;
  const offset = Math.floor((size - qrSize) / 2);
  context.fillStyle = "#FFFAF0";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#2F2414";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        context.fillRect(offset + col * moduleSize, offset + row * moduleSize, moduleSize, moduleSize);
      }
    }
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

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

$("tabControl").addEventListener("click", () => showTab("control"));
$("tabSettings").addEventListener("click", () => showTab("settings"));
$("settingsNormalizeTab").addEventListener("click", () => showSettingsTab("normalize"));
if ($("settingsStorageTab")) {
  $("settingsStorageTab").addEventListener("click", () => showSettingsTab("storage"));
}
if ($("settingsLiveHistoryTab")) {
  $("settingsLiveHistoryTab").addEventListener("click", () => showSettingsTab("liveHistory"));
}
if ($("settingsTroubleshootingTab")) {
  $("settingsTroubleshootingTab").addEventListener("click", () => showSettingsTab("troubleshooting"));
}
if ($("settingsYoutubeTab")) {
  $("settingsYoutubeTab").addEventListener("click", () => showSettingsTab("youtube"));
}
if ($("settingsAutomationTab")) {
  $("settingsAutomationTab").addEventListener("click", () => showSettingsTab("automation"));
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
  const withinAlertsMenu = target instanceof Element && target.closest(".workspace-alerts-menu");
  if (!withinAlertsMenu) {
    closeWorkspaceAlertsMenu();
  }
  const withinFilter = target instanceof Element && target.closest(".history-filter-wrap");
  if (withinFilter) return;
  if (state.settingsLiveHistory.menuOpen || state.settingsLiveHistory.calendarOpen) {
    state.settingsLiveHistory.menuOpen = false;
    state.settingsLiveHistory.calendarOpen = false;
    renderSettingsLiveHistory();
  }
});
document.addEventListener("focusin", (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest("#viewSettings input, #viewSettings select, #viewSettings textarea")) {
    pauseSettingsRender(3000);
  }
});
document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (target instanceof Element && target.closest("#viewSettings input, #viewSettings select, #viewSettings textarea")) {
    pauseSettingsRender(3000);
  }
});
document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
  if (!target.closest("#viewSettings")) return;
  pauseSettingsRender(3000);
  if (target.matches("[data-normalize-index][data-normalize-field]")) {
    syncNormalizeControlToState(target);
  } else if (target.matches("[data-default-field]")) {
    syncDefaultControlToState(target);
  } else if (target.matches("[data-profile-field]")) {
    syncProfileControlToState(target);
  }
  if (settingsAutosaveTargetChanged(target)) {
    scheduleSettingsAutosave(900);
  }
});
document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
  if (!target.closest("#viewSettings")) return;
  pauseSettingsRender(3000);
  if (target.matches("[data-normalize-index][data-normalize-field]")) {
    syncNormalizeControlToState(target);
  } else if (target.matches("[data-default-field]")) {
    syncDefaultControlToState(target);
  } else if (target.matches("[data-profile-field]")) {
    syncProfileControlToState(target);
  }
  if (settingsAutosaveTargetChanged(target)) {
    scheduleSettingsAutosave(200);
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
    state.youtubeBroadcasts = [];
    state.youtubeBroadcastsLoadedKey = "";
    state.youtubeBroadcastsFailedKey = "";
    state.youtubeBroadcastsLoadError = "";
    state.youtubeImportedBroadcastId = "";
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
if ($("saveSettings")) {
  $("saveSettings").addEventListener("click", () => saveSettings().catch((error) => toast(error.message)));
}
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
if ($("previewEnabledToggle")) {
  $("previewEnabledToggle").addEventListener("change", (event) => {
    writePreviewEnabled(Boolean(event.target.checked));
    renderPreview(state.status?.streams || {});
    syncPreviewLifecycle(state.status?.streams || {});
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

function isTrustedGoogleAuthOrigin(origin) {
  if (origin === window.location.origin) return true;
  try {
    const incoming = new URL(origin);
    const current = new URL(window.location.href);
    const redirectCandidates = [
      String((state.configData || {}).youtube?.redirect_uri || defaultYoutubeSettings().redirect_uri || ""),
      ...normalizedStorageProviders(state.configData || defaultConfigData()).map((provider) => String(provider?.oauth?.redirect_uri || "")),
    ].filter(Boolean);
    if (redirectCandidates.some((redirectUri) => {
      try {
        return new URL(redirectUri).origin === incoming.origin;
      } catch {
        return false;
      }
    })) {
      return true;
    }
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
  if (!isTrustedGoogleAuthOrigin(event.origin)) return;
  if (payload.type === "storage-auth") {
    refreshStorageStatus()
      .then(() => loadConfigText())
      .then(() => {
        const accountLabel = String(payload.account_email || payload.account_name || "").trim();
        const message = payload.status === "ok"
          ? `${payload.display_name || "Google Drive"} connected${accountLabel ? ` as ${accountLabel}` : ""}.`
          : (payload.message || "Google Drive connection failed.");
        toast(message);
      })
      .catch((error) => toast(error.message));
    return;
  }
  if (payload.type !== "youtube-auth") return;
  if (payload.status === "ok") {
    loadConfigText()
      .then(() => refreshYoutubeStatus())
      .then(() => refresh())
      .then(() => refreshYoutubeBroadcasts(true, { silent: true }))
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

applySettingsSection(state.settingsTab);
applyLegacyTabView("control");
renderChannelTools();
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
  .then(() => refreshStorageStatus())
  .catch((error) => {
    markBootReady();
    toast(error.message);
  });
setInterval(() => refresh().catch((error) => toast(error.message)), 2500);

