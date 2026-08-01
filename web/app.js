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
    editingChannelMode: "edit",
    editingChannelName: "",
    editingChannelPicture: "",
    editingChannelImage: null,
    editingChannelPictureType: "image/png",
    editingChannelCrop: { x: 0, y: 0 },
    editingChannelDrag: null,
    alertsMenuOpen: false,
    expandedAlertIds: {},
    readAlertIds: [],
    loading: { channelSwitch: false, module: null },
  },
  onboarding: {
    active: false,
    step: 1,
    skipped: false,
  },
  activeTab: "control",
  settingsTab: "youtube",
  rawFilesByChannel: {},
  normalizedFilesByChannel: {},
  rawFilesAutoRefreshBusy: false,
  rawFilesAutoRefreshLastAt: 0,
  rawUploadBusyChannel: "",
  liveUploadBusyChannel: "",
  liveImportProgress: null,
  liveImportControl: {
    paused: false,
    cancelRequested: false,
  },
  settingsRenderPausedUntil: 0,
  refreshRenderDeferredForSelection: false,
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
  theme: "light",
  appVersion: null,
  backendBaseUrl: "",
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
  youtubeLiveChat: {
    channel: "",
    accountId: "",
    broadcastId: "",
    broadcastTitle: "",
    liveChatId: "",
    messages: [],
    nextPageToken: "",
    pollingIntervalMillis: 5000,
    offlineAt: "",
    loading: false,
    sending: false,
    error: "",
    quotaCooldownUntil: 0,
    loadedKey: "",
    failedKey: "",
    timer: null,
  },
  youtubeLiveChatPanelOpen: false,
  youtubeLiveChatDraft: "",
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
  localNotifications: [],
  activityRenderedItems: [],
  activityExportedSignature: "",
  deliveredAlertIds: [],
  settingsLiveHistory: {
    sessions: [],
    filter: "last_28",
    expandedCommentSessionIds: {},
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
  transferBusy: "",
};

const $ = (id) => document.getElementById(id);
async function fetchApi(path, options = {}) {
  const url = `${state.backendBaseUrl || ""}${path}`;
  const response = await fetch(url, options);
  return await response.json();
}
let youtubeLiveChatPopoutWindow = null;
const desktopBridge = () => (window.desktopShell && typeof window.desktopShell === "object" ? window.desktopShell : null);
const INTERNAL_CONFIG_FILES = new Set([
  "backend-info.json",
  "castarro-transfer-manifest.json",
  "config.example.json",
  "package-lock.json",
  "package.json",
  "stream-cycle-runtime.json",
]);

function isSelectableConfigName(name) {
  const text = String(name || "").trim();
  return Boolean(text && text.endsWith(".json") && !INTERNAL_CONFIG_FILES.has(text));
}

function selectableConfigNames(configs = []) {
  return (Array.isArray(configs) ? configs : []).filter(isSelectableConfigName);
}

function preferredConfigName(configs = []) {
  const names = selectableConfigNames(configs);
  if (names.includes(state.config)) return state.config;
  if (names.includes("config.ready.json")) return "config.ready.json";
  if (names.includes("config.json")) return "config.json";
  return names[0] || "config.ready.json";
}

function normalizeBackendBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function apiBaseUrl() {
  return normalizeBackendBaseUrl(state.backendBaseUrl);
}

function apiRequestUrl(path) {
  const text = String(path || "");
  if (/^https?:\/\//i.test(text)) return text;
  const base = apiBaseUrl();
  if (!base) return text;
  return text.startsWith("/") ? `${base}${text}` : `${base}/${text}`;
}

function apiUrlOrigin() {
  return apiBaseUrl() || window.location.origin;
}

function localAssetUrl(path) {
  return new URL(String(path || "").replace(/^\/+/, ""), window.location.href).href;
}

function liveImportProgressForChannel(channelName) {
  const progress = state.liveImportProgress;
  if (!progress) return null;
  return String(progress.channel || "") === String(channelName || "") ? progress : null;
}

function isLiveImportBusy(channelName = "") {
  if (!state.liveUploadBusyChannel) return false;
  return !channelName || String(state.liveUploadBusyChannel) === String(channelName || "");
}

function resetLiveImportControl() {
  state.liveImportControl = {
    paused: false,
    cancelRequested: false,
  };
}

function liveImportControlState() {
  if (!state.liveImportControl || typeof state.liveImportControl !== "object") {
    resetLiveImportControl();
  }
  return state.liveImportControl;
}

function syncLiveImportProgressFlags() {
  if (!state.liveImportProgress) return;
  const control = liveImportControlState();
  state.liveImportProgress = {
    ...state.liveImportProgress,
    paused: Boolean(control.paused),
    cancelRequested: Boolean(control.cancelRequested),
  };
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function nodeInsideAppShell(node) {
  const root = document.querySelector(".app-shell") || document.body;
  if (!root || !node) return false;
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return Boolean(element && root.contains(element));
}

function activeInputTextSelection() {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return false;
  if (!nodeInsideAppShell(active)) return false;
  const start = Number(active.selectionStart);
  const end = Number(active.selectionEnd);
  return Number.isFinite(start) && Number.isFinite(end) && start !== end;
}

function activeDocumentTextSelection() {
  const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
  if (!selection || selection.isCollapsed || selection.rangeCount <= 0) return false;
  if (!String(selection.toString() || "").trim()) return false;

  const root = document.querySelector(".app-shell") || document.body;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    try {
      if (root && typeof range.intersectsNode === "function" && range.intersectsNode(root)) {
        return true;
      }
    } catch {
      if (nodeInsideAppShell(selection.anchorNode) || nodeInsideAppShell(selection.focusNode)) {
        return true;
      }
    }
  }
  return nodeInsideAppShell(selection.anchorNode) || nodeInsideAppShell(selection.focusNode);
}

function shouldDeferRefreshRenderForSelection() {
  return activeInputTextSelection() || activeDocumentTextSelection();
}

function renderDeferredRefreshAfterSelectionClears() {
  if (!state.refreshRenderDeferredForSelection || shouldDeferRefreshRenderForSelection() || !state.status) return;
  state.refreshRenderDeferredForSelection = false;
  const visibleConfigs = selectableConfigNames(state.status.configs);
  const runningSettingsTask = (state.status.tasks || []).some((task) => ["normalize", "validate", "test-stream"].includes(task.name) && task.running);
  renderRefreshedStatus(state.status, visibleConfigs, runningSettingsTask);
  state.hadRunningSettingsTask = runningSettingsTask;
  renderUpdateBanner();
  writeDashboardCache(state.status);
  markBootReady();
}

function cacheDesktopStartupView(reason = "ui", delayMs = 900) {
  try {
    const bridge = desktopBridge();
    if (typeof bridge?.cacheStartupView !== "function") return;
    const now = Date.now();
    if (reason === "boot-ready" && now - desktopStartupViewRequestLastAt < 10000) return;
    desktopStartupViewRequestLastAt = now;
    bridge.cacheStartupView({ reason, delayMs });
  } catch {
    // Snapshot caching is a polish layer; keep the web UI independent.
  }
}

function uiMasterValue(name, fallback = "") {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function uiMasterNumber(name, fallback) {
  const value = Number.parseFloat(uiMasterValue(name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

function authPopupLoadingHtml(title) {
  return `
        <link rel="stylesheet" href="${escapeAttr(localAssetUrl("ui-master.css"))}">
        <main class="auth-popup-page">
          <h1>${escapeHtml(title)}</h1>
          <p>You can continue in this window once Google sign-in loads.</p>
        </main>
      `;
}

const ACTIVITY_STREAM_SPLIT_KEY = "castarro.activityStreamSplitRatio.v1";
const WORKSPACE_SELECTED_CHANNEL_KEY = "castarro.workspace.selectedChannel.v1";
const WORKSPACE_READ_ALERTS_KEY = "castarro.workspace.readAlerts.v1";
const ONBOARDING_STATE_KEY = "castarro.onboarding.state.v1";
const DASHBOARD_CACHE_KEY = "castarro.dashboard.frontPage.v1";
const YOUTUBE_STATUS_CACHE_KEY = "castarro.youtube.status.v1";
const PREVIEW_ENABLED_KEY = "castarro.preview.enabled.v1";
const THEME_STORAGE_KEY = "castarro.theme.v1";
const STREAM_KEY_PLACEHOLDER = "1234-5678-9012-3456";
const WORKSPACE_ROUTES = ["overview", "youtube", "streams", "history", "troubleshoot", "transfer"];
const SCHEDULE_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
let desktopStartupViewRequestLastAt = 0;
const routeToSettingsTab = {
  youtube: "youtube",
  streams: "streams",
  history: "liveHistory",
  troubleshoot: "troubleshooting",
  transfer: "transfer",
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

function formatFpsValue(value) {
  const fps = Number(value);
  if (!Number.isFinite(fps) || fps < 0) return "Unavailable";
  return fps >= 10 ? fps.toFixed(1) : fps.toFixed(2);
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
  const ramNode = $("workspaceUsageRam");
  const dataTodayNode = $("workspaceUsageData");
  const dataMonthNode = $("workspaceUsageDataMonth");
  const metrics = state.usageMetrics || {};
  const usage = payload?.usage || {};
  if (cpuNode) {
    cpuNode.textContent = Number.isFinite(Number(metrics.cpuPercent)) ? formatCpuUsage(metrics.cpuPercent) : "Unavailable";
  }
  if (ramNode) {
    ramNode.textContent = Number.isFinite(Number(metrics.memoryBytes)) ? formatBytes(metrics.memoryBytes) : "Unavailable";
  }
  if (dataTodayNode) {
    dataTodayNode.textContent = formatBytes(usage.stream_transfer_today_bytes || 0);
  }
  if (dataMonthNode) {
    dataMonthNode.textContent = formatBytes(usage.stream_transfer_month_bytes || 0);
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

function formatDateForInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function openDataUsageModal() {
  const modal = $("dataUsageModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  const startInput = $("dataUsageStartDate");
  const endInput = $("dataUsageEndDate");
  const now = new Date();
  if (startInput && !startInput.value) {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    startInput.value = formatDateForInput(firstDay);
  }
  if (endInput && !endInput.value) {
    endInput.value = formatDateForInput(now);
  }
  fetchCustomDataUsage();
}

function closeDataUsageModal() {
  const modal = $("dataUsageModal");
  if (modal) modal.classList.add("hidden");
}

function setDataUsagePreset(preset) {
  const startInput = $("dataUsageStartDate");
  const endInput = $("dataUsageEndDate");
  if (!startInput || !endInput) return;
  const now = new Date();
  endInput.value = formatDateForInput(now);

  if (preset === 'month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    startInput.value = formatDateForInput(firstDay);
  } else if (preset === 'today') {
    startInput.value = formatDateForInput(now);
  } else if (preset === '7days') {
    const start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    startInput.value = formatDateForInput(start);
  } else if (preset === '30days') {
    const start = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    startInput.value = formatDateForInput(start);
  }

  fetchCustomDataUsage();
}

async function fetchCustomDataUsage() {
  const startVal = $("dataUsageStartDate")?.value || "";
  const endVal = $("dataUsageEndDate")?.value || "";
  const totalNode = $("dataUsageTotalBytes");
  const countNode = $("dataUsageSessionCount");
  const rangeLabel = $("dataUsageRangeLabel");
  const channelList = $("dataUsageChannelList");
  const dailyList = $("dataUsageDailyList");

  if (rangeLabel) {
    rangeLabel.textContent = startVal && endVal ? `${startVal} to ${endVal}` : "Custom Range";
  }

  try {
    const params = new URLSearchParams();
    if (state.config) params.set("config", state.config);
    if (startVal) params.set("start", startVal);
    if (endVal) params.set("end", endVal);

    const res = await fetch(`/api/data-usage?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch data usage");
    const data = await res.json();

    if (totalNode) totalNode.textContent = formatBytes(data.total_bytes || 0);
    if (countNode) countNode.textContent = String(data.session_count || 0);

    if (channelList) {
      if (!data.by_channel || data.by_channel.length === 0) {
        channelList.innerHTML = '<div class="panel-empty">No channel usage recorded.</div>';
      } else {
        channelList.innerHTML = data.by_channel.map(ch => `
          <div class="data-usage-item-row">
            <strong>${escapeHtml(ch.channel_name)}</strong>
            <span>${formatBytes(ch.bytes)} (${ch.session_count} stream${ch.session_count === 1 ? '' : 's'})</span>
          </div>
        `).join("");
      }
    }

    if (dailyList) {
      if (!data.by_day || data.by_day.length === 0) {
        dailyList.innerHTML = '<div class="panel-empty">No daily usage recorded.</div>';
      } else {
        dailyList.innerHTML = data.by_day.map(d => `
          <div class="data-usage-item-row">
            <span>${escapeHtml(d.date)}</span>
            <strong>${formatBytes(d.bytes)}</strong>
          </div>
        `).join("");
      }
    }
  } catch (err) {
    if (totalNode) totalNode.textContent = "Error";
    if (channelList) channelList.innerHTML = `<div class="panel-empty">Error: ${escapeHtml(err.message)}</div>`;
  }
}

window.openDataUsageModal = openDataUsageModal;
window.closeDataUsageModal = closeDataUsageModal;
window.setDataUsagePreset = setDataUsagePreset;
window.fetchCustomDataUsage = fetchCustomDataUsage;

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
  adaptive: {
    auto_switch: true,
    buffer_seconds: 60,
    hls_time: 2,
    active_variant_id: "1080p",
    variants: [
      { id: "1080p", label: "1080p", width: 1920, height: 1080, video_bitrate: "6800k", audio_bitrate: "128k", enabled: true },
      { id: "720p", label: "720p", width: 1280, height: 720, video_bitrate: "3500k", audio_bitrate: "128k", enabled: true },
      { id: "480p", label: "480p", width: 854, height: 480, video_bitrate: "1800k", audio_bitrate: "96k", enabled: true },
    ],
  },
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
  notification_mode: "all",
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

const defaultStreamCycleSettings = () => ({
  enabled: false,
  restart_delay_seconds: 180,
  randomized: false,
  restart_delay_random_minutes: 0,
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
    video_encoder: "auto",
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
  stream_cycles: defaultStreamCycleSettings(),
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
    video_encoder: "auto",
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
  youtube_dual_stream: true,
  youtube_account_id: "",
  youtube_studio_url: "",
  youtube_broadcast_id: "",
  youtube_stream_id: "",
  loop: true,
  restart_on_exit: true,
});

function nextDefaultChannelName(config = state.configData || defaultConfigData()) {
  const channels = Array.isArray(config?.channels) ? config.channels : [];
  const existingNames = new Set(channels.map((channel) => String(channel?.name || "").trim()).filter(Boolean));
  let index = channels.length + 1;
  let name = `channel_${index}`;
  while (existingNames.has(name)) {
    index += 1;
    name = `channel_${index}`;
  }
  return name;
}

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

function onboardingStorageKey() {
  return `${ONBOARDING_STATE_KEY}:${state.config || "config.json"}`;
}

function youtubeStatusStorageKey() {
  return `${YOUTUBE_STATUS_CACHE_KEY}:${state.config || "config.json"}`;
}

function workspaceReadAlertsStorageKey() {
  return `${WORKSPACE_READ_ALERTS_KEY}:${state.config || "config.json"}`;
}

function normalizeNotificationMode(value) {
  return ["all", "critical", "off"].includes(String(value || "")) ? String(value) : "all";
}

function readWorkspaceAlertIds() {
  try {
    const raw = window.localStorage.getItem(workspaceReadAlertsStorageKey());
    const parsed = raw ? JSON.parse(raw) : [];
    state.workspace.readAlertIds = Array.isArray(parsed) ? parsed.map((item) => String(item)).slice(-200) : [];
  } catch {
    state.workspace.readAlertIds = [];
  }
}

function writeWorkspaceAlertIds() {
  state.workspace.readAlertIds = Array.from(new Set(state.workspace.readAlertIds || [])).slice(-200);
  try {
    window.localStorage.setItem(workspaceReadAlertsStorageKey(), JSON.stringify(state.workspace.readAlertIds));
  } catch {
    // Ignore storage failures; unread state can still work for this session.
  }
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

function normalizeTheme(value) {
  return value === "dark" ? "dark" : "light";
}

function readThemePreference() {
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "light";
  }
}

function writeThemePreference(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalizeTheme(theme));
  } catch {
    // Ignore storage failures; the applied theme can still live for this session.
  }
}

function syncThemeToggle() {
  const toggle = $("themeToggle");
  if (!toggle) return;
  const isDark = state.theme === "dark";
  toggle.setAttribute("aria-pressed", isDark ? "true" : "false");
  toggle.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  toggle.title = isDark ? "Switch to light theme" : "Switch to dark theme";
  toggle.dataset.theme = state.theme;
}

function applyTheme(theme, persist = false) {
  state.theme = normalizeTheme(theme);
  document.documentElement.dataset.theme = state.theme;
  if (persist) {
    writeThemePreference(state.theme);
  }
  syncThemeToggle();
}

function toggleThemePreference() {
  applyTheme(state.theme === "dark" ? "light" : "dark", true);
}

function isOverviewVisible() {
  return state.activeTab === "control" && normalizeWorkspaceRoute(state.workspace.activeRoute) === "overview";
}

function runningPreviewCandidates(streams = state.status?.streams || {}) {
  return Object.values(streams || {}).filter((stream) => isStreamCurrentlyRunning(stream));
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
applyTheme(readThemePreference());

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
  const accounts = mergedYoutubeAccounts(state.configData || defaultConfigData(), status);
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

function mergedYoutubeAccounts(config = state.configData || defaultConfigData(), status = state.youtubeStatus) {
  const merged = new Map();
  normalizedYoutubeAccounts(config).forEach((item) => {
    merged.set(item.id, { ...item });
  });
  (Array.isArray(status?.accounts) ? status.accounts : []).forEach((item) => {
    const id = normalizeAccountId(item?.id || "");
    if (!id) return;
    const existing = merged.get(id) || { id, label: id, tokens_file: defaultAccountTokensFile(id) };
    merged.set(id, { ...existing, ...item, id });
  });
  return Array.from(merged.values());
}

function latestStatusChannel(channelName) {
  const name = String(channelName || "").trim();
  if (!name) return null;
  const channels = Array.isArray(state.status?.channels) ? state.status.channels : [];
  return channels.find((channel) => String(channel?.name || "").trim() === name) || null;
}

function channelWithLatestStatus(configChannel, channelName = "") {
  const name = String(channelName || configChannel?.name || "").trim();
  const statusChannel = latestStatusChannel(name);
  if (!configChannel && !statusChannel) return null;
  return {
    ...(configChannel || {}),
    ...(statusChannel || {}),
  };
}

function getSelectedWorkspaceChannel(config) {
  return getSelectedChannel(config || defaultConfigData(), state.workspace.selectedChannelName);
}

function selectedWorkspaceChannelName() {
  return String(state.workspace.selectedChannelName || "").trim();
}

function isGeneratedStreamKeyEnv(value) {
  return /^YT_CHANNEL_\d+_KEY$/i.test(String(value || "").trim());
}

function streamKeyInputValue(channel) {
  const value = String(channel?.stream_key_env || "").trim();
  return isGeneratedStreamKeyEnv(value) ? "" : value;
}

function readOnboardingState() {
  state.onboarding = {
    active: false,
    step: 1,
    skipped: false,
  };
  try {
    const raw = window.localStorage.getItem(onboardingStorageKey());
    if (!raw) return;
    const saved = JSON.parse(raw || "{}");
    if (!saved || typeof saved !== "object") return;
    state.onboarding.active = Boolean(saved.active);
    state.onboarding.step = Math.max(1, Math.min(5, Number(saved.step) || 1));
    state.onboarding.skipped = Boolean(saved.skipped || (!saved.active && Number(saved.step) >= 5));
  } catch {
    // Ignore malformed onboarding state.
  }
}

function writeOnboardingState() {
  try {
    window.localStorage.setItem(onboardingStorageKey(), JSON.stringify({
      active: Boolean(state.onboarding.active),
      step: Math.max(1, Math.min(5, Number(state.onboarding.step) || 1)),
      skipped: Boolean(state.onboarding.skipped),
    }));
  } catch {
    // Ignore storage write failures in restricted contexts.
  }
}

function activateOnboardingStep(step) {
  state.onboarding.active = true;
  state.onboarding.step = Math.max(1, Math.min(5, Number(step) || 1));
  state.onboarding.skipped = false;
  writeOnboardingState();
}

function completeOnboarding() {
  state.onboarding.active = false;
  state.onboarding.step = 5;
  state.onboarding.skipped = true;
  writeOnboardingState();
}

function skipOnboarding() {
  completeOnboarding();
  state.workspace.activeRoute = "overview";
  applyLegacyTabView("control");
  renderChannelWorkspace(state.status || {});
  toast("Onboarding skipped.");
}

function workspaceRecentAlerts(payload = state.status) {
  const selectedChannel = selectedWorkspaceChannelName();
  const recent = Array.isArray(payload?.alerts?.recent) ? payload.alerts.recent : [];
  const backendAlerts = recent.filter((item) => {
    const channel = String(item?.channel_name || "").trim();
    return !selectedChannel || !channel || channel === selectedChannel;
  });
  return [...(state.localNotifications || []), ...backendAlerts]
    .map(normalizeWorkspaceAlert)
    .sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime())
    .slice(0, 20);
}

function normalizeWorkspaceAlert(item = {}) {
  const severity = normalizeWorkspaceAlertSeverity(item?.severity);
  const detail = String(item?.detail || item?.message || item?.title || item?.key || "").trim();
  const message = String(item?.message || detail).trim();
  const title = compactAlertTitle({
    ...item,
    message,
    title: item?.title || message || item?.key || "Notification",
  });
  return {
    ...item,
    title: title || "Notification",
    message: message || title || "Notification",
    detail: detail || message || title || "No additional details were provided for this notification.",
    severity,
  };
}

function normalizeWorkspaceAlertSeverity(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["danger", "error", "critical", "failed", "failure"].includes(text)) return "danger";
  if (["warn", "warning"].includes(text)) return "warn";
  return "info";
}

function workspaceAlertId(item, index = 0) {
  const rawId = String(item?.id || "").trim();
  if (rawId) {
    return `${item?.local ? "local" : "backend"}-${rawId}`;
  }
  return `alert-${index}-${String(item?.created_at || "")}-${String(item?.title || "")}`;
}

function markWorkspaceAlertsRead(alerts) {
  const items = Array.isArray(alerts) ? alerts : [];
  const nextIds = items.map((item, index) => workspaceAlertId(item, index));
  const merged = Array.from(new Set([...(state.workspace.readAlertIds || []), ...nextIds])).slice(-200);
  if (merged.length === (state.workspace.readAlertIds || []).length && merged.every((id, index) => id === state.workspace.readAlertIds[index])) {
    return;
  }
  state.workspace.readAlertIds = merged;
  writeWorkspaceAlertIds();
}

function compactAlertTitle(item) {
  const title = String(item?.title || "").trim();
  if (title && title !== "Update") return title;
  const message = String(item?.message || "").trim();
  if (!message) return "Notification";
  if (/failed to fetch/i.test(message)) {
    const quotedName = message.match(/"([^"]+)"/)?.[1] || "";
    if (/raw video/i.test(message)) return quotedName ? `Raw video failed: ${quotedName}` : "Raw video failed to fetch";
    if (/live video/i.test(message)) return quotedName ? `Live video failed: ${quotedName}` : "Live video failed to fetch";
    if (/thumbnail/i.test(message)) return quotedName ? `Thumbnail failed: ${quotedName}` : "Thumbnail failed to fetch";
    if (/\/api\/status/i.test(message) || /dashboard status/i.test(message)) return "Dashboard status failed to fetch";
    if (/\/api\/config/i.test(message) || /settings/i.test(message)) return "Settings failed to fetch";
    if (/raw/i.test(message) && /file/i.test(message)) return "Raw file list failed to fetch";
    if (/youtube/i.test(message)) return "YouTube data failed to fetch";
    if (/google drive|storage/i.test(message)) return "Storage data failed to fetch";
    return "Request failed to fetch";
  }
  return message.split(/[.!?]\s/)[0].replace(/\.$/, "").slice(0, 88) || "Notification";
}

function alertDetailRows(item) {
  const rows = [];
  const add = (label, value) => {
    const text = String(value || "").trim();
    if (text) rows.push({ label, value: text });
  };
  const message = String(item?.message || "");
  add("Channel", item?.channel_name);
  add("Config", item?.config_name);
  add("Rule", item?.key);
  add("Severity", item?.severity);
  if (item?.local) add("Source", "Local UI");
  if (item?.local) {
    add("Request", message.match(/Request:\s*(.*?)(?:\.\s+(?:Browser|Server|HTTP)|$)/)?.[1]);
    add("Request ID", message.match(/Request ID:\s*([^.\]]+)/)?.[1]);
  }
  if (item?.desktop_enabled === false) add("Desktop notification", "Disabled for this alert");
  if (item?.mobile_enabled === false) add("Mobile notification", "Disabled for this alert");
  return rows;
}

function workspaceAlertCopyText(item) {
  const title = compactAlertTitle(item);
  const detail = String(item?.detail || item?.message || "").trim();
  const created = formatDateTime(item?.created_at || "");
  const rows = alertDetailRows(item);
  const lines = [title || "Notification"];
  if (created) lines.push(`Time: ${created}`);
  if (detail && detail !== title) lines.push(`Detail: ${detail}`);
  rows.forEach((row) => lines.push(`${row.label}: ${row.value}`));
  return lines.join("\n");
}

function workspaceAlertIcon(name) {
  const paths = {
    copy: `
      <rect x="9" y="9" width="10" height="10" rx="2"></rect>
      <path d="M5 15V7a2 2 0 0 1 2-2h8"></path>
    `,
  };
  return `
    <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      ${paths[name] || ""}
    </svg>
  `;
}

function renderWorkspaceAlertItem(item, index) {
  const id = workspaceAlertId(item, index);
  const detailId = `workspace-alert-detail-${index}`;
  const expanded = Boolean(state.workspace.expandedAlertIds?.[id]);
  const title = compactAlertTitle(item);
  const detail = String(item?.detail || item?.message || "").trim();
  const severity = normalizeWorkspaceAlertSeverity(item?.severity);
  const rows = alertDetailRows(item);
  return `
    <article class="workspace-alert-item ${escapeAttr(severity)} ${expanded ? "is-expanded" : ""}" data-alert-id="${escapeAttr(id)}">
      <div class="workspace-alert-row">
        <button
          class="workspace-alert-summary"
          type="button"
          data-alert-id="${escapeAttr(id)}"
          aria-expanded="${expanded ? "true" : "false"}"
          aria-controls="${escapeAttr(detailId)}"
          onclick="toggleWorkspaceAlertItem('${escapeJs(id)}', event)"
        >
          <span class="workspace-alert-summary-main">
            <strong>${escapeHtml(title)}</strong>
          </span>
          <span class="workspace-alert-summary-meta">
            <time>${escapeHtml(formatDateTime(item?.created_at || ""))}</time>
          </span>
          <span class="workspace-alert-chevron" aria-hidden="true">${expanded ? "-" : "+"}</span>
        </button>
        <button
          class="pill ghost small icon-only workspace-alert-copy"
          type="button"
          title="Copy notification"
          aria-label="Copy notification"
          onclick="copyWorkspaceAlert('${escapeJs(id)}', event).catch((error) => toast(error.message))"
        >${workspaceAlertIcon("copy")}</button>
      </div>
      ${expanded ? `
        <div class="workspace-alert-detail" id="${escapeAttr(detailId)}">
          <p>${escapeHtml(detail || "No additional details were provided for this notification.")}</p>
          ${rows.length ? `
            <dl>
              ${rows.map((row) => `
                <div>
                  <dt>${escapeHtml(row.label)}</dt>
                  <dd>${escapeHtml(row.value)}</dd>
                </div>
              `).join("")}
            </dl>
          ` : ""}
        </div>
      ` : ""}
    </article>
  `;
}

function rerenderWorkspaceHeader(payload = state.status || {}) {
  const selected = getSelectedChannel({ channels: payload?.channels || [] }, state.workspace.selectedChannelName);
  renderWorkspaceHeader(payload || {}, selected);
}

function captureWorkspaceAlertsScroll() {
  if (!state.workspace.alertsMenuOpen) return null;
  const feed = document.querySelector("#workspaceAlertsPopover .workspace-alerts-feed");
  if (!feed) return null;
  return {
    scrollTop: Number(feed.scrollTop) || 0,
    scrollHeight: Number(feed.scrollHeight) || 0,
  };
}

function restoreWorkspaceAlertsScroll(snapshot) {
  if (!snapshot || !state.workspace.alertsMenuOpen) return;
  window.requestAnimationFrame(() => {
    const feed = document.querySelector("#workspaceAlertsPopover .workspace-alerts-feed");
    if (!feed) return;
    if (snapshot.scrollTop <= 4) {
      feed.scrollTop = 0;
      return;
    }
    const addedHeight = Math.max(0, (Number(feed.scrollHeight) || 0) - snapshot.scrollHeight);
    const maxScroll = Math.max(0, (Number(feed.scrollHeight) || 0) - (Number(feed.clientHeight) || 0));
    feed.scrollTop = Math.min(maxScroll, snapshot.scrollTop + addedHeight);
  });
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

function isStreamCurrentlyRunning(stream) {
  if (!stream) return false;
  if (Object.prototype.hasOwnProperty.call(stream, "process_running")) {
    return Boolean(stream.process_running);
  }
  return Boolean(stream.running);
}

function isStreamActive(stream) {
  return Boolean(stream?.running || stream?.process_running || stream?.recovering);
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
    const url = new URL(String(path || ""), apiUrlOrigin());
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

function apiRequestLabel(path, action = "") {
  const actionText = String(action || "").replaceAll(".", " ").replaceAll("_", " ").trim();
  if (actionText) return actionText;
  let pathname = "";
  try {
    pathname = new URL(String(path || ""), apiUrlOrigin()).pathname;
  } catch {
    pathname = String(path || "");
  }
  if (pathname === "/api/status") return "dashboard status";
  if (pathname === "/api/config") return "settings config";
  if (pathname.includes("raw")) return "raw video file list";
  if (pathname.includes("normalized")) return "normalized video file list";
  if (pathname.includes("youtube")) return "YouTube data";
  if (pathname.includes("storage") || pathname.includes("cloud")) return "storage data";
  if (pathname.includes("history")) return "live history";
  if (pathname.includes("sync")) return "sync status";
  return pathname.replace(/^\/api\/?/, "").replaceAll("/", " ").trim() || "request";
}

function titleCaseText(value) {
  return String(value || "").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

async function api(path, options = {}) {
  const {
    action = "",
    headers: customHeaders = {},
    ...fetchOptions
  } = options;
  const requestId = makeRequestId();
  let response;
  const requestUrl = apiRequestUrl(path);
  try {
    response = await fetch(requestUrl, {
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
    const label = apiRequestLabel(path, action);
    logLocalActivityEvent(
      "api_request",
      `Network error while calling ${path}`,
      { path, request_id: requestId, client_action: action, channel_name: channelName, error: String(error?.message || error) },
      "error"
    );
    throw new Error(`${titleCaseText(label)} failed to fetch. Request: ${path}. Browser/network error: ${String(error?.message || error)}. Request ID: ${requestId}.`);
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
    const label = apiRequestLabel(path, action);
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
    throw new Error(`${titleCaseText(label)} request failed. Request: ${path}. Server response: ${message}. HTTP status: ${response.status}. Request ID: ${responseRequestId}.`);
  }
  return payload;
}

async function refresh() {
  if (!isSelectableConfigName(state.config)) {
    state.config = "config.ready.json";
  }
  const payload = await api(`/api/status?config=${encodeURIComponent(state.config)}`);
  const visiblePayload = applyPendingChannelRemovalToStatus(payload);
  const visibleConfigs = selectableConfigNames(visiblePayload.configs);
  const hadStatus = Boolean(state.status);
  state.status = visiblePayload;
  state.storageStatus = visiblePayload.storage || state.storageStatus;
  if (hadStatus) {
    deliverDesktopAlerts(visiblePayload);
  } else {
    rememberDeliveredAlertIds((visiblePayload?.alerts?.recent || []).map((item) => Number(item?.id || 0)));
  }

  const previousConfig = state.config;
  state.config = preferredConfigName(visibleConfigs);
  if (previousConfig !== state.config) {
    readWorkspaceAlertIds();
    readOnboardingState();
    hydrateYoutubeStatusFromCache(true);
  } else if (!state.youtubeStatus) {
    hydrateYoutubeStatusFromCache();
  }

  state.appVersion = visiblePayload.app_version || state.appVersion;
  ensureWorkspaceChannelSelection(visiblePayload);
  const runningSettingsTask = visiblePayload.tasks.some((task) => ["normalize", "validate", "test-stream"].includes(task.name) && task.running);

  if (shouldDeferRefreshRenderForSelection()) {
    state.refreshRenderDeferredForSelection = true;
    state.hadRunningSettingsTask = runningSettingsTask;
    return;
  }

  renderRefreshedStatus(visiblePayload, visibleConfigs, runningSettingsTask);
  state.hadRunningSettingsTask = runningSettingsTask;
  renderUpdateBanner();
  writeDashboardCache(payload);
  markBootReady();
}

function renderRefreshedStatus(visiblePayload, visibleConfigs, runningSettingsTask) {
  renderConfigSelect(visibleConfigs);
  renderAppVersion();
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
  if (state.activeTab === "settings" && (runningSettingsTask || state.hadRunningSettingsTask)) {
    renderSettingsFormsUnlessPaused();
  }
  if (!runningSettingsTask && state.hadRunningSettingsTask) {
    loadNormalizedFiles()
      .then(() => renderYoutubeSettingsPanel(state.configData || defaultConfigData()))
      .catch((error) => toast(error.message));
  }
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
  cacheDesktopStartupView("boot-ready", 1000);
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
    return {
      ...payload,
      _cached: true,
      _cached_at: String(cached?.saved_at || ""),
    };
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
  const cachedConfigs = selectableConfigNames(payload.configs);
  if (isSelectableConfigName(payload.config)) {
    state.config = payload.config;
  } else {
    state.config = preferredConfigName(cachedConfigs);
  }
  readOnboardingState();
  state.status = payload;
  if (!state.configData) {
    state.configData = defaultConfigData();
  }
  hydrateYoutubeStatusFromCache();
  ensureWorkspaceChannelSelection(payload);
  renderConfigSelect(cachedConfigs);
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
  const hasChannels = hasWorkspaceChannels(payload);
  const cachedPayloadShowsOnboarding = (!hasChannels && !state.onboarding.skipped) || (hasChannels && state.onboarding.active);
  if (state.onboarding.skipped || cachedPayloadShowsOnboarding) {
    markBootReady();
  }
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

  if (typeof bridge.getBackendUrl === "function") {
    try {
      state.backendBaseUrl = normalizeBackendBaseUrl(await bridge.getBackendUrl());
    } catch (_error) {
      state.backendBaseUrl = "";
    }
  }

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
    message = update.message || `Update${version} is ready. Castarro will restart the UI automatically; live streams will keep running.`;
  } else if (status === "installing") {
    show = true;
    message = update.message || `Installing update${version}. Live streams will keep running.`;
  } else if (status === "backend-pending") {
    show = true;
    message = update.message || `Update${version} is installed. Backend will switch after active streams finish.`;
  } else if (status === "backend-handoff") {
    show = true;
    message = update.message || `Switching backend to update${version}.`;
  } else if (status === "backend-updated") {
    show = true;
    message = update.message || `Backend updated${version}.`;
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
  configs = selectableConfigNames(configs);
  if (!isSelectableConfigName(state.config)) {
    state.config = preferredConfigName(configs);
  }
  const existing = new Set(configs);
  if (!existing.has(state.config)) configs = [state.config, ...configs];
  select.innerHTML = configs.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  select.value = state.config;
}

function renderStatus(payload) {
  const running = Object.values(payload.streams).filter((stream) => isStreamCurrentlyRunning(stream)).length;

  $("serverState").textContent = payload.config_exists ? `${running} live stream${running === 1 ? "" : "s"}` : "Config needed";
  const startAllButton = $("startAll");
  if (startAllButton) {
    const anyRunning = Object.values(payload.streams).some((stream) => isStreamActive(stream));
    const importBusy = isLiveImportBusy();
    startAllButton.textContent = anyRunning ? "Stop all streams" : "Start All Streams";
    startAllButton.classList.toggle("success", !anyRunning);
    startAllButton.classList.toggle("danger", anyRunning);
    startAllButton.setAttribute("aria-label", anyRunning ? "Stop all streams" : "Start All Streams");
    startAllButton.disabled = !anyRunning && importBusy;
    startAllButton.title = !anyRunning && importBusy ? "Wait for video import to finish." : "";
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
    const live = isStreamCurrentlyRunning(stream);
    const importBusy = isLiveImportBusy(channel.name);
    const key = streamKeyLabel(channel);
    const autoReady = channel.youtube_auto_start && channel.youtube_auto_stop;
    const dualReady = channel.youtube_dual_stream !== false;
    const autoText = autoReady && dualReady ? "YouTube ready" : "YouTube needs check";
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
          <span class="badge ${autoReady && dualReady ? "live" : "warn"}">${escapeHtml(autoText)}</span>
          <span class="badge ${dualReady ? "live" : "warn"}">${escapeHtml(dualReady ? "Dual Stream on" : "Dual Stream off")}</span>
          ${studio}
        </div>
        <div class="mini-actions">
          <button class="${streamButtonClass}" ${!live && importBusy ? "disabled title=\"Wait for video import to finish.\"" : ""} onclick="${streamAction}('${escapeJs(channel.name)}')">${streamButtonLabel}</button>
          <button class="pill" onclick="startTask('test-stream', '${escapeJs(channel.name)}', false)">Test Stream</button>
          <button class="pill ghost" onclick="showTab('settings')">Settings</button>
        </div>
      </article>
    `;
  }).join("");
}

function hasWorkspaceChannels(payload) {
  return Array.isArray(payload?.channels) && payload.channels.length > 0;
}

function onboardingStepItems() {
  return [
    { step: 1, label: "Add a channel" },
    { step: 2, label: "Connect YouTube or add a stream key" },
    { step: 3, label: "Prepare or select videos to go live" },
    { step: 4, label: "Adjust your YouTube live settings" },
    { step: 5, label: "Start your first live stream" },
  ];
}

function activeOnboardingStep(payload) {
  return hasWorkspaceChannels(payload)
    ? Math.max(2, Math.min(5, Number(state.onboarding.step) || 2))
    : 1;
}

function renderOnboardingStepList(activeStep, hasChannels) {
  return `
    <div class="first-run-checklist-wrap">
      <ol class="first-run-steps" aria-label="First live stream setup steps">
        ${onboardingStepItems().map((item) => {
          const disabled = !hasChannels && item.step > 1;
          const complete = hasChannels && item.step < activeStep;
          const classes = [
            item.step === activeStep ? "active" : "",
            complete ? "complete" : "",
            disabled ? "disabled" : "",
          ].filter(Boolean).join(" ");
          return `
            <li class="${classes}">
              <button class="first-run-step-button" type="button" onclick="handleOnboardingStepClick(${item.step}).catch((error) => toast(error.message))" ${disabled ? "disabled" : ""}>
                <span class="first-run-step-number">${item.step}</span>
                <span>${escapeHtml(item.label)}</span>
              </button>
            </li>
          `;
        }).join("")}
      </ol>
      <button class="first-run-skip" type="button" onclick="skipOnboarding()">Skip onboarding</button>
    </div>
  `;
}

function renderFirstRunOnboarding(payload) {
  const container = $("firstRunOnboarding");
  if (!container) return;
  const hasChannels = hasWorkspaceChannels(payload);
  const activeStep = activeOnboardingStep(payload);
  container.classList.toggle("setup-guide-card", hasChannels && activeStep > 2);
  container.innerHTML = hasChannels
    ? `
      <div class="first-run-primary">
        <p class="workspace-breadcrumb">First setup</p>
        <h2 id="firstRunTitle">Finish setup</h2>
        <p class="helper">${escapeHtml(selectedWorkspaceChannelName() || "Selected channel")}</p>
      </div>
      ${renderOnboardingStepList(activeStep, true)}
    `
    : `
      <div class="first-run-primary">
        <p class="workspace-breadcrumb">First setup</p>
        <h2 id="firstRunTitle">Create your first channel</h2>
        <p class="helper">A channel keeps your YouTube connection, stream key, videos, live settings, and history together.</p>
        <button class="pill primary first-run-add-channel" id="firstRunAddChannel" type="button" onclick="addChannel()">
          <span class="first-run-add-icon" aria-hidden="true">+</span>
          <span>Add Channel</span>
        </button>
      </div>
      ${renderOnboardingStepList(activeStep, false)}
    `;
}

function syncFirstRunOnboarding(payload) {
  const route = normalizeWorkspaceRoute(state.workspace.activeRoute);
  const transferActive = route === "transfer";
  const hasChannels = hasWorkspaceChannels(payload);
  const activeStep = activeOnboardingStep(payload);
  const showEmptyOnboarding = !transferActive && !hasChannels && !state.onboarding.skipped;
  const showSetupGuide = hasChannels && Boolean(state.onboarding.active);
  const focusOnOnboardingPanel = showEmptyOnboarding || (showSetupGuide && activeStep <= 2);
  if (showSetupGuide) {
    state.workspace.activeRoute = "youtube";
    state.settingsTab = "youtube";
    applySettingsSection("youtube");
  }
  renderFirstRunOnboarding(payload);
  $("firstRunOnboarding")?.classList.toggle("hidden", !(showEmptyOnboarding || showSetupGuide));
  $("workspaceHeader")?.classList.toggle("hidden", showEmptyOnboarding || showSetupGuide);
  $("workspaceStatusBand")?.classList.toggle("hidden", showEmptyOnboarding || showSetupGuide);
  $("viewControl")?.classList.toggle("hidden", showEmptyOnboarding || showSetupGuide);
  $("viewSettings")?.classList.toggle("hidden", focusOnOnboardingPanel);
  $("viewSettings")?.classList.toggle("active", showSetupGuide || state.activeTab === "settings");
  $("firstRunOnboarding")?.setAttribute("aria-hidden", showEmptyOnboarding || showSetupGuide ? "false" : "true");
  document.querySelector(".app-main-inner")?.classList.toggle("setup-guide-active", showSetupGuide && !focusOnOnboardingPanel);
  if (showEmptyOnboarding || showSetupGuide) {
    state.workspace.alertsMenuOpen = false;
  }
  return showEmptyOnboarding;
}

function normalizeWorkspaceRoute(routeName) {
  const route = String(routeName || "overview").trim();
  const aliases = {
    control: "overview",
    dashboard: "overview",
    encoder: "youtube",
    folders: "youtube",
    normalize: "youtube",
    live: "youtube",
    liveHistory: "history",
    troubleshooting: "troubleshoot",
    settings: "transfer",
  };
  const normalized = aliases[route] || route;
  return WORKSPACE_ROUTES.includes(normalized) ? normalized : "overview";
}

function workspaceRouteLabel(routeName) {
  return {
    overview: "Dashboard",
    youtube: "YouTube",
    streams: "Streams",
    history: "History",
    troubleshoot: "Troubleshoot",
    transfer: "Transfer",
  }[normalizeWorkspaceRoute(routeName)] || "Dashboard";
}

function getChannelHealthViewModel(channel, payload) {
  const channelName = String(channel?.name || "").trim();
  const stream = getChannelStreams(payload?.streams || {}, channelName);
  const linked = getLinkedAccountForChannel(state.youtubeStatus, channel);
  const checks = Array.isArray(state.youtubeKeyChecks?.checks) ? state.youtubeKeyChecks.checks : [];
  const check = checks.find((item) => String(item?.channel || "") === channelName);
  const connected = Boolean(linked?.connected);
  const mapped = Boolean(normalizeAccountId(channel?.youtube_account_id || ""));
  const streamRunning = isStreamCurrentlyRunning(stream);
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
      routeTarget: "youtube",
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
    const streamRunning = isStreamCurrentlyRunning(stream);
    const liveText = streamRunning ? "Live" : "Ready";
    const liveClass = streamRunning ? "badge live" : "badge";
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
  state.workspace.editingChannelMode = "edit";
  state.workspace.editingChannelName = targetName;
  state.workspace.editingChannelPicture = channelPictureSrc(channel);
  state.workspace.editingChannelImage = null;
  state.workspace.editingChannelPictureType = state.workspace.editingChannelPicture.startsWith("data:image/png") ? "image/png" : "image/jpeg";
  state.workspace.editingChannelCrop = { x: 0, y: 0 };
  state.workspace.editingChannelDrag = null;
  const nameInput = $("workspaceChannelEditName");
  const fileInput = $("workspaceChannelEditPicture");
  const title = $("workspaceChannelEditTitle");
  const saveButton = $("saveWorkspaceChannelEditButton");
  const deleteButton = $("deleteWorkspaceChannelButton");
  if (title) title.textContent = `Edit ${targetName}`;
  if (saveButton) saveButton.textContent = "Save Changes";
  if (deleteButton) {
    deleteButton.classList.remove("hidden");
    deleteButton.disabled = false;
  }
  if (nameInput) nameInput.value = targetName;
  if (fileInput) fileInput.value = "";
  syncWorkspaceChannelEditPreview();
  $("workspaceChannelEditDialog")?.classList.remove("hidden");
  window.setTimeout(() => $("workspaceChannelEditName")?.focus(), 0);
}

function openWorkspaceChannelCreate() {
  const nextName = nextDefaultChannelName(state.configData || defaultConfigData());
  state.workspace.editingChannelMode = "create";
  state.workspace.editingChannelName = "";
  state.workspace.editingChannelPicture = "";
  state.workspace.editingChannelImage = null;
  state.workspace.editingChannelPictureType = "image/png";
  state.workspace.editingChannelCrop = { x: 0, y: 0 };
  state.workspace.editingChannelDrag = null;
  const nameInput = $("workspaceChannelEditName");
  const fileInput = $("workspaceChannelEditPicture");
  const title = $("workspaceChannelEditTitle");
  const saveButton = $("saveWorkspaceChannelEditButton");
  const deleteButton = $("deleteWorkspaceChannelButton");
  if (title) title.textContent = "Add Channel";
  if (saveButton) saveButton.textContent = "Save Settings";
  if (deleteButton) {
    deleteButton.classList.add("hidden");
    deleteButton.disabled = true;
  }
  if (nameInput) nameInput.value = nextName;
  if (fileInput) fileInput.value = "";
  syncWorkspaceChannelEditPreview();
  $("workspaceChannelEditDialog")?.classList.remove("hidden");
  window.setTimeout(() => {
    const input = $("workspaceChannelEditName");
    input?.focus();
    input?.select?.();
  }, 0);
}

function closeWorkspaceChannelEdit() {
  state.workspace.editingChannelMode = "edit";
  state.workspace.editingChannelName = "";
  state.workspace.editingChannelPicture = "";
  state.workspace.editingChannelImage = null;
  state.workspace.editingChannelPictureType = "image/png";
  state.workspace.editingChannelCrop = { x: 0, y: 0 };
  state.workspace.editingChannelDrag = null;
  const saveButton = $("saveWorkspaceChannelEditButton");
  const deleteButton = $("deleteWorkspaceChannelButton");
  if (saveButton) saveButton.textContent = "Save Changes";
  if (deleteButton) {
    deleteButton.classList.add("hidden");
    deleteButton.disabled = true;
  }
  $("workspaceChannelEditDialog")?.classList.add("hidden");
}

function openWorkspaceChannelDeleteFromEdit() {
  const channelName = String(state.workspace.editingChannelName || "").trim();
  if (!channelName) {
    toast("Select a channel before removing it.");
    return;
  }
  const channels = Array.isArray(state.configData?.channels) ? state.configData.channels : [];
  const channelIndex = channels.findIndex((channel) => String(channel?.name || "").trim() === channelName);
  if (channelIndex < 0) {
    toast(`Unknown channel: ${channelName}`);
    return;
  }
  closeWorkspaceChannelEdit();
  openChannelDeleteDialog(channelIndex);
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
    context.fillStyle = uiMasterValue("--component-canvas-jpeg-fill", "Canvas");
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
  const isCreateMode = state.workspace.editingChannelMode === "create";
  const nameInput = $("workspaceChannelEditName");
  const nextName = String(nameInput?.value || "").trim();
  const nextPicture = String(
    state.workspace.editingChannelImage
      ? renderWorkspaceChannelCroppedPicture()
      : state.workspace.editingChannelPicture || ""
  ).trim();
  if (!isCreateMode && !oldName) throw new Error("Select a channel to edit.");
  if (!nextName) throw new Error("Channel name is required.");

  const data = collectSettingsData();
  const channels = Array.isArray(data.channels) ? data.channels : [];
  const channelIndex = isCreateMode
    ? -1
    : channels.findIndex((channel) => String(channel?.name || "").trim() === oldName);
  if (!isCreateMode && channelIndex < 0) throw new Error(`Unknown channel: ${oldName}`);
  const duplicate = channels.some((channel, index) => (
    (isCreateMode || index !== channelIndex) && String(channel?.name || "").trim() === nextName
  ));
  if (duplicate) throw new Error(`A channel named "${nextName}" already exists.`);

  if (isCreateMode) {
    const channel = defaultChannel(channels.length + 1);
    channel.name = nextName;
    channel.raw_playlist = [`Raw Videos/${nextName}/video-001.mp4`];
    if (nextPicture) {
      channel.picture = nextPicture;
    }
    channels.push(channel);
    state.activeSettingsChannelIndex = channels.length - 1;
    setWorkspaceSelectedChannel(nextName);
  } else {
    channels[channelIndex].name = nextName;
    if (nextPicture) {
      channels[channelIndex].picture = nextPicture;
    } else {
      delete channels[channelIndex].picture;
      delete channels[channelIndex].picture_data_url;
    }
    if (state.workspace.selectedChannelName === oldName) {
      setWorkspaceSelectedChannel(nextName);
    }
  }
  data.channels = channels;
  state.workspace.editingChannelMode = "edit";
  closeWorkspaceChannelEdit();
  state.configData = data;
  syncConfigEditor();
  renderWorkspaceChannelList(state.status || {});
  await saveConfigData(data);
  if (isCreateMode) {
    setWorkspaceSelectedChannel(nextName);
    activateOnboardingStep(2);
    state.workspace.activeRoute = "youtube";
    state.settingsTab = "youtube";
    applyLegacyTabView("settings");
    applySettingsSection("youtube");
    renderChannelWorkspace(state.status || {});
    openOnboardingConnectionDialog();
    toast(`Channel "${nextName}" created.`);
  } else {
    toast("Channel updated.");
  }
}

function renderWorkspaceHeader(payload, channel) {
  const route = normalizeWorkspaceRoute(state.workspace.activeRoute);
  const routeLabel = workspaceRouteLabel(route);
  const channelName = String(channel?.name || "No channel selected").trim();
  const title = route === "transfer" ? "Transfer Package" : route === "overview" ? channelName : `${channelName} / ${routeLabel}`;
  const breadcrumb = channel ? `Channel / ${channelName}` : "Channel / None";
  const subtitles = {
    overview: "Controls and status for this channel only.",
    youtube: "Go live, schedule broadcasts, manage stream keys, and choose videos for this channel.",
    streams: "Manage multiple reusable stream keys, view uptime duration, and control live streams for this channel.",
    history: "Recorded live sessions for this channel.",
    troubleshoot: "Activity and stream logs for this channel.",
    transfer: "Create or import a complete Castarro package for moving this PC setup.",
  };
  const breadcrumbNode = $("workspaceBreadcrumb");
  const titleNode = $("workspacePageTitle");
  const legacyNameNode = $("workspaceChannelName");
  const subtitleNode = $("workspacePageSubtitle");
  const actionsNode = $("workspaceHeaderActions");
  if (breadcrumbNode) breadcrumbNode.textContent = route === "transfer" ? "Settings / Transfer" : route === "overview" ? breadcrumb : `${channelName} / ${routeLabel}`;
  if (titleNode) titleNode.textContent = title;
  if (legacyNameNode) legacyNameNode.textContent = channelName;
  if (subtitleNode) subtitleNode.textContent = subtitles[route] || subtitles.overview;
  if (!actionsNode) return;
  if (route === "transfer") {
    state.workspace.alertsMenuOpen = false;
    actionsNode.innerHTML = "";
    return;
  }
  if (!channel) {
    state.workspace.alertsMenuOpen = false;
    actionsNode.innerHTML = `<button class="pill primary" type="button" onclick="addChannel()">Add Channel</button>`;
    return;
  }
  const alertScrollSnapshot = captureWorkspaceAlertsScroll();
  const escapedName = escapeJs(channel.name);
  const stream = payload?.streams?.[channel.name] || null;
  const streamRunning = isStreamActive(stream);
  const importBusy = isLiveImportBusy(channel.name);
  const streamAction = streamRunning ? "stopStream" : "startStream";
  const streamButtonClass = streamRunning ? "pill danger" : "pill success";
  const streamButtonLabel = streamRunning ? "Stop Stream" : "Start Stream";
  const alerts = workspaceRecentAlerts(payload);
  const hasDangerAlerts = alerts.some((item) => String(item?.severity || "") === "danger");
  if (state.workspace.alertsMenuOpen) {
    markWorkspaceAlertsRead(alerts);
  }
  const readAlertIds = new Set(state.workspace.readAlertIds || []);
  const unreadAlerts = alerts.filter((item, index) => !readAlertIds.has(workspaceAlertId(item, index)));
  const hasUnreadDangerAlerts = unreadAlerts.some((item) => String(item?.severity || "") === "danger");
  const alertBadgeClass = hasDangerAlerts ? "badge warn" : alerts.length ? "badge" : "badge live";
  const alertSummary = `${alerts.length} notification${alerts.length === 1 ? "" : "s"}`;
  actionsNode.innerHTML = `
    <div class="workspace-header-controls">
      <button class="theme-toggle" id="themeToggle" type="button" aria-pressed="false" onclick="toggleThemePreference()" title="Switch theme">
        <span class="theme-toggle-knob" aria-hidden="true">
          <span class="theme-toggle-icon theme-toggle-sun" aria-hidden="true"></span>
          <span class="theme-toggle-icon theme-toggle-moon" aria-hidden="true"></span>
        </span>
      </button>
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
          ${unreadAlerts.length ? `<span class="workspace-alerts-count ${hasUnreadDangerAlerts ? "warn" : ""}">${unreadAlerts.length}</span>` : ""}
        </button>
        <div class="workspace-alerts-popover ${state.workspace.alertsMenuOpen ? "" : "hidden"}" id="workspaceAlertsPopover" aria-label="Notification history">
          <div class="workspace-alerts-popover-head">
            <strong>Notifications</strong>
            <span class="${alertBadgeClass}">${escapeHtml(alertSummary)}</span>
          </div>
          ${alerts.length
            ? `<div class="workspace-alerts-feed">${alerts.map((item, index) => renderWorkspaceAlertItem(item, index)).join("")}</div>`
            : `<p class="helper">No recent alerts for this workspace.</p>`}
        </div>
      </div>
      <button class="${streamButtonClass}" type="button" ${!streamRunning && importBusy ? "disabled title=\"Wait for video import to finish.\"" : ""} onclick="${streamAction}('${escapedName}').catch((error) => toast(error.message))">${streamButtonLabel}</button>
    </div>
  `;
  syncThemeToggle();
  restoreWorkspaceAlertsScroll(alertScrollSnapshot);
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

function syncWorkspaceStatusBandVisibility(routeName = state.workspace.activeRoute) {
  $("workspaceStatusBand")?.classList.toggle("hidden", normalizeWorkspaceRoute(routeName) !== "overview");
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
  if (!channel) {
    if (readinessNode) readinessNode.innerHTML = `<div class="notice warn">Select a channel to see readiness.</div>`;
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
  $("settingsStreamsTab")?.classList.toggle("active", tab === "streams");
  $("settingsAutomationTab")?.classList.toggle("active", tab === "automation");
  $("settingsTransferTab")?.classList.toggle("active", tab === "transfer");
  $("settingsLiveHistoryTab")?.classList.toggle("active", tab === "liveHistory");
  $("settingsTroubleshootingTab")?.classList.toggle("active", tab === "troubleshooting");
  $("settingsNormalizeView")?.classList.toggle("active", tab === "normalize");
  $("settingsStorageView")?.classList.toggle("active", tab === "storage");
  $("settingsYoutubeView")?.classList.toggle("active", tab === "youtube");
  $("settingsStreamsView")?.classList.toggle("active", tab === "streams");
  $("settingsAutomationView")?.classList.toggle("active", tab === "automation");
  $("settingsTransferView")?.classList.toggle("active", tab === "transfer");
  $("settingsLiveHistoryView")?.classList.toggle("active", tab === "liveHistory");
  $("settingsTroubleshootingView")?.classList.toggle("active", tab === "troubleshooting");
}

function renderWorkspaceRoute(payload, routeName) {
  const route = normalizeWorkspaceRoute(routeName);
  const selected = getSelectedChannel({ channels: payload?.channels || [] }, state.workspace.selectedChannelName);
  syncWorkspaceStatusBandVisibility(route);
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
  const settingsTab = routeToSettingsTab[route] || "youtube";
  applyLegacyTabView("settings");
  state.settingsTab = settingsTab;
  applySettingsSection(settingsTab);
  syncActiveSettingsChannelFromWorkspace(false);
  if (settingsTab === "streams") {
    renderWorkspaceStreamsTab(selected?.name || state.workspace.selectedChannelName);
  }
  if (settingsTab !== "troubleshooting" && settingsTab !== "streams") {
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
  if (syncFirstRunOnboarding(payload)) {
    detachPreviewPlayer();
    syncPreviewLifecycle(payload?.streams || {});
    return;
  }
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
  return Boolean(state.rawUploadBusyChannel || state.liveUploadBusyChannel)
    || settingsFormInteractionActive()
    || Date.now() < Number(state.settingsRenderPausedUntil || 0);
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
  const targetTabName = tabName === "live" || tabName === "normalize" ? "youtube" : tabName;
  const targetName = String(channelName || state.workspace.selectedChannelName || "").trim();
  const index = (config.channels || []).findIndex((channel) => String(channel?.name || "") === targetName);
  if (index >= 0) {
    state.activeSettingsChannelIndex = index;
    setWorkspaceSelectedChannel(targetName);
    syncYoutubeSelectedAccountFromChannel(config);
  }
  const route = {
    normalize: "youtube",
    youtube: "youtube",
    liveHistory: "history",
    troubleshooting: "troubleshoot",
  }[targetTabName] || "youtube";
  state.workspace.activeRoute = route;
  applyLegacyTabView("settings");
  state.settingsTab = targetTabName;
  applySettingsSection(targetTabName);
  renderSettingsForms();
  renderChannelWorkspace(state.status || {});
}

function openWorkspaceRoute(routeName) {
  if (normalizeWorkspaceRoute(routeName) === "transfer") {
    setWorkspaceRoute("transfer");
    return;
  }
  const selected = String(state.workspace.selectedChannelName || "").trim();
  if (!selected) {
    toast("Select a channel first.");
    return;
  }
  setWorkspaceRoute(routeName);
}

function selectedConfigChannelIndex(config = state.configData || defaultConfigData()) {
  const channelName = selectedWorkspaceChannelName();
  const channels = Array.isArray(config.channels) ? config.channels : [];
  return channels.findIndex((channel) => String(channel?.name || "") === channelName);
}

function setOnboardingYoutubeStep(step) {
  activateOnboardingStep(step);
  state.workspace.activeRoute = "youtube";
  state.settingsTab = "youtube";
  applyLegacyTabView("settings");
  applySettingsSection("youtube");
  syncActiveSettingsChannelFromWorkspace(false);
  renderChannelWorkspace(state.status || {});
  runRouteSideEffects("youtube");
}

function youtubeLogoMarkup() {
  return `
    <svg class="youtube-button-logo" viewBox="0 0 28 20" aria-hidden="true" focusable="false">
      <rect class="youtube-button-logo-bg" width="28" height="20" rx="5"></rect>
      <path class="youtube-button-logo-play" d="M11 5.5v9l7.5-4.5L11 5.5z"></path>
    </svg>
  `;
}

async function handleOnboardingStepClick(step) {
  const targetStep = Math.max(1, Math.min(5, Number(step) || 1));
  if (targetStep === 1) {
    addChannel();
    return;
  }
  if (!selectedWorkspaceChannelName()) {
    toast("Add a channel first.");
    activateOnboardingStep(1);
    renderChannelWorkspace(state.status || {});
    return;
  }
  if (targetStep === 2) {
    setOnboardingYoutubeStep(2);
    openOnboardingConnectionDialog();
    return;
  }
  if (targetStep === 3 || targetStep === 4) {
    setOnboardingYoutubeStep(targetStep);
    return;
  }
  completeOnboarding();
  state.workspace.activeRoute = "overview";
  applyLegacyTabView("control");
  renderChannelWorkspace(state.status || {});
  await startStream(selectedWorkspaceChannelName());
}

function openOnboardingConnectionDialog() {
  const dialog = $("onboardingConnectionDialog");
  const body = $("onboardingConnectionBody");
  if (!dialog || !body) return;
  const config = state.configData || defaultConfigData();
  const index = selectedConfigChannelIndex(config);
  const channel = index >= 0 ? config.channels[index] : null;
  if (!channel) {
    toast("Add a channel first.");
    return;
  }
  const linked = getLinkedAccountForChannel(state.youtubeStatus, channel);
  const accountText = linked?.connected
    ? (linked.channel_title || linked.channel_handle || linked.label || "Connected")
    : linked?.id
      ? `${linked.label || linked.id} needs reconnect`
      : "No YouTube account connected";
  const connectHasToken = Boolean(linked?.connected || linked?.wrong_account || linked?.has_token);
  const credentialsMissing = youtubeCredentialsMissingConfirmed(config.youtube || {});
  const connectDisabled = !connectHasToken && credentialsMissing;
  body.innerHTML = `
    <div class="onboarding-connection-stack">
      <section class="nested-card onboarding-choice-card">
        <div>
          <h3>Add Stream Key</h3>
          <p class="helper">Paste a manual key when you prefer to use a stream key directly.</p>
        </div>
        <label>
          Manual stream key
          <input id="onboardingStreamKey" type="password" autocomplete="off" spellcheck="false" data-youtube-channel-index="${index}" data-youtube-channel-field="stream_key_env" value="${escapeAttr(streamKeyInputValue(channel))}" placeholder="${STREAM_KEY_PLACEHOLDER}">
        </label>
      </section>
      <div class="onboarding-or-separator" aria-hidden="true"><span>or</span></div>
      <button class="youtube-connect-button" type="button" onclick="connectYoutube().catch((error) => toast(error.message))" ${connectDisabled ? "disabled" : ""} title="${escapeAttr(connectDisabled ? "YouTube owner credentials are not configured yet." : accountText)}">
        ${youtubeLogoMarkup()}
        <span>Connect YouTube Account</span>
      </button>
    </div>
  `;
  dialog.classList.remove("hidden");
  window.setTimeout(() => $("onboardingStreamKey")?.focus(), 0);
}

function closeOnboardingConnectionDialog() {
  $("onboardingConnectionDialog")?.classList.add("hidden");
}

async function saveOnboardingConnectionSettings() {
  await saveSettings();
  closeOnboardingConnectionDialog();
  setOnboardingYoutubeStep(3);
}

function runRouteSideEffects(routeName) {
  if (routeName === "history") {
    fetchSettingsLiveHistory().catch((error) => toast(error.message));
  }
  if (routeName === "youtube") {
    refreshActiveRawFiles({ force: true }).catch((error) => toast(error.message));
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
  cacheDesktopStartupView(`route-${route}`, 900);
}

function streamKeyLabel(channel) {
  const envFieldValue = String(channel?.stream_key_env || "").trim();
  if (channel.stream_key_env && channel.stream_key_env_has_value) {
    return `key env: ${channel.stream_key_env} (set)`;
  }
  if (looksLikeDirectStreamKey(envFieldValue) || (envFieldValue && !looksLikeStreamKeyEnvName(envFieldValue))) {
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

function looksLikeStreamKeyEnvName(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(text) && (text.includes("_") || text === text.toUpperCase());
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

function durationHmsParts(totalSeconds) {
  const { hours, minutes, seconds } = durationParts(totalSeconds);
  return { hours, minutes, seconds };
}

function compactDurationText(totalSeconds) {
  const { hours, minutes, seconds } = durationParts(totalSeconds);
  const secondText = String(seconds).padStart(2, "0");
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${secondText}`;
  return `${minutes}:${secondText}`;
}

function videoDurationSeconds(file) {
  const duration = Number(file?.duration_seconds);
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
}

function totalVideoDurationSeconds(files) {
  return (Array.isArray(files) ? files : []).reduce((total, file) => total + videoDurationSeconds(file), 0);
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
    const commentCount = historySessionCommentCount(session);
    return `
      <button class="live-history-row ${isLive ? "current" : ""}" type="button" onclick="setWorkspaceRoute('history')" aria-label="Open History for ${escapeAttr(title)}">
        <div class="live-history-title">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(channelName)}</span>
          <span>${escapeHtml(commentCount ? `${commentCount} saved comment${commentCount === 1 ? "" : "s"}` : "No saved comments")}</span>
        </div>
        <div class="live-history-time">
          <strong>${escapeHtml(started.date)}</strong>
          ${started.time ? `<span>${escapeHtml(started.time)}</span>` : ""}
        </div>
        <div class="live-history-time">
          <strong>${escapeHtml(stopped.date)}</strong>
          ${stopped.time ? `<span>${escapeHtml(stopped.time)}</span>` : ""}
        </div>
        <div class="live-history-comments">
          <strong>${escapeHtml(commentCount ? String(commentCount) : "0")}</strong>
          <span>${escapeHtml(historyLatestCommentLabel(session))}</span>
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
      <span>Comments</span>
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

function historySessionComments(session) {
  return Array.isArray(session?.recent_comments) ? session.recent_comments : [];
}

function historySessionCommentCount(session) {
  const count = Number(session?.comment_count);
  if (Number.isFinite(count)) return Math.max(0, count);
  return historySessionComments(session).length;
}

const YOUTUBE_EMOJI_SHORTCODE_FALLBACKS = {
  "hand-pink-waving": "\u{1F44B}",
  "person-turquoise-waving": "\u{1F44B}",
  "person-turqouise-waving": "\u{1F44B}",
  "face-red-heart-shape": "\u{1F970}",
  "eyes-pink-heart-shape": "\u{1F60D}",
  "face-fuchsia-poop-shape": "\u{1F4A9}",
  "face-blue-smiling": "\u{1F642}",
  "face-green-smiling": "\u{1F60A}",
  "face-red-droopy-eyes": "\u{1F97A}",
  "face-purple-crying": "\u{1F62D}",
  "eyes-purple-crying": "\u{1F62D}",
  "face-pink-tears": "\u{1F979}",
  "face-fuchsia-wide-eyes": "\u{1F633}",
  "face-blue-wide-eyes": "\u{1F632}",
  "face-purple-wide-eyes": "\u{1F62E}",
  "face-orange-frowning": "\u2639\uFE0F",
  "face-orange-raised-eyebrow": "\u{1F928}",
  "face-fuchsia-tongue-out": "\u{1F61C}",
  "face-orange-biting-nails": "\u{1F62C}",
  "glasses-purple-yellow-diamond": "\u{1F60E}",
  "cat-orange-whistling": "\u{1F63D}",
  "body-blue-raised-arms": "\u{1F64C}",
  "body-pink-dancing": "\u{1F483}",
  "body-turquoise-yoga-pose": "\u{1F9D8}",
  "body-green-covering-eyes": "\u{1F648}",
  "hand-orange-covering-eyes": "\u{1F648}",
  "hand-purple-blue-peace": "\u270C\uFE0F",
  "hand-green-crystal-ball": "\u{1F52E}",
  "face-blue-question-mark": "\u2753",
  "face-blue-covering-eyes": "\u{1F648}",
  "face-turquoise-drinking-coffee": "\u2615",
  "body-green-shirt": "\u{1F455}",
  "trophy-yellow-smiling": "\u{1F3C6}",
  smile: "\u{1F604}",
  joy: "\u{1F602}",
  laughing: "\u{1F606}",
  heart: "\u2764\uFE0F",
  "red-heart": "\u2764\uFE0F",
  fire: "\u{1F525}",
  pray: "\u{1F64F}",
  "folded-hands": "\u{1F64F}",
  folded_hands: "\u{1F64F}",
  "thumbs-up": "\u{1F44D}",
  thumbsup: "\u{1F44D}",
  clap: "\u{1F44F}",
};

function replaceYoutubeEmojiShortcodes(value) {
  return String(value || "").replace(/:([a-z0-9][a-z0-9_+-]*(?:-[a-z0-9_+-]+)*):/gi, (match, name) => {
    return YOUTUBE_EMOJI_SHORTCODE_FALLBACKS[String(name || "").toLowerCase()] || match;
  });
}

function youtubeLiveChatPlainText(message) {
  return replaceYoutubeEmojiShortcodes(message?.display_message || message?.message_text || "");
}

function youtubeLiveChatMessageParts(message) {
  const parts = Array.isArray(message?.message_parts) ? message.message_parts : [];
  return parts.filter((part) => part && typeof part === "object");
}

function youtubeLiveChatMessageHtml(message) {
  const parts = youtubeLiveChatMessageParts(message);
  if (!parts.length) return escapeHtml(youtubeLiveChatPlainText(message));
  return parts.map((part) => {
    const type = String(part?.type || "").toLowerCase();
    const imageUrl = String(part?.image_url || part?.imageUrl || "").trim();
    const text = replaceYoutubeEmojiShortcodes(part?.text || part?.alt || part?.shortcode || "");
    if (type === "emoji" && /^https:\/\//i.test(imageUrl)) {
      const alt = replaceYoutubeEmojiShortcodes(part?.alt || text || "Emoji");
      return `<img class="youtube-chat-emoji" src="${escapeAttr(imageUrl)}" alt="${escapeAttr(alt)}" title="${escapeAttr(alt)}" loading="lazy" decoding="async">`;
    }
    return escapeHtml(text);
  }).join("");
}

function historyCommentText(comment) {
  return youtubeLiveChatPlainText(comment).trim();
}

function historyCommentTimestamp(comment) {
  return comment?.published_at || comment?.sent_at || comment?.received_at || "";
}

function historyLatestCommentLabel(session) {
  const comments = historySessionComments(session);
  if (!comments.length) return "No saved comments";
  const latest = comments[0];
  const author = String(latest?.author_display_name || "Viewer").trim();
  const text = historyCommentText(latest);
  return text ? `${author}: ${text}` : `${author} commented`;
}

function renderHistoryCommentMessages(session) {
  const comments = historySessionComments(session);
  if (!comments.length) {
    return `<div class="history-comments-empty">No comments were saved for this live session.</div>`;
  }
  return comments.map((comment) => {
    const badges = youtubeLiveChatAuthorBadges(comment);
    const timestamp = historyCommentTimestamp(comment);
    return `
      <article class="history-comment-message">
        <div class="history-comment-head">
          <strong>${escapeHtml(comment?.author_display_name || "Viewer")}</strong>
          ${timestamp ? `<time datetime="${escapeAttr(timestamp)}" title="${escapeAttr(formatDateTime(timestamp))}">${escapeHtml(formatLiveChatClockTime(timestamp) || formatDateTime(timestamp))}</time>` : ""}
          ${badges.map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`).join("")}
        </div>
        <p>${youtubeLiveChatMessageHtml(comment) || escapeHtml("Comment text unavailable")}</p>
      </article>
    `;
  }).join("");
}

function toggleSettingsHistoryComments(sessionId) {
  const key = String(sessionId || "");
  if (!key) return;
  state.settingsLiveHistory.expandedCommentSessionIds = {
    ...(state.settingsLiveHistory.expandedCommentSessionIds || {}),
    [key]: !state.settingsLiveHistory.expandedCommentSessionIds?.[key],
  };
  renderSettingsLiveHistory();
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
      <span class="badge">0 comments</span>
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
      const commentText = historySessionComments(session)
        .map((comment) => `${comment?.author_display_name || ""} ${historyCommentText(comment)}`)
        .join(" ");
      const haystack = `${session?.live_title || ""} ${session?.channel_name || ""} ${session?.status || ""} ${commentText}`.toLowerCase();
      return haystack.includes(search);
    });

  const nowMs = Date.now();
  const totalSeconds = sessions.reduce((sum, item) => sum + sessionDurationSeconds(item, nowMs), 0);
  const completed = sessions.filter((session) => settingsHistoryStatus(session).label === "Completed").length;
  const failed = sessions.filter((session) => settingsHistoryStatus(session).label === "Failed").length;
  const commentTotal = sessions.reduce((sum, session) => sum + historySessionCommentCount(session), 0);
  summary.innerHTML = `
    <span class="badge">${sessions.length} session${sessions.length === 1 ? "" : "s"}</span>
    <span class="badge live">Total ${escapeHtml(durationText(totalSeconds))}</span>
    <span class="badge">${completed} completed</span>
    <span class="badge warn">${failed} failed</span>
    <span class="badge">${commentTotal} comment${commentTotal === 1 ? "" : "s"}</span>
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
    const commentCount = historySessionCommentCount(session);
    const comments = historySessionComments(session);
    const expanded = Boolean(state.settingsLiveHistory.expandedCommentSessionIds?.[String(session?.id || "")]);
    return `
      <div class="settings-history-group ${expanded ? "expanded" : ""}">
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
          <div class="settings-history-comments-cell">
            <button
              class="pill ghost small"
              type="button"
              onclick="toggleSettingsHistoryComments('${escapeJs(session?.id || "")}')"
              ${comments.length ? "" : "disabled"}
              aria-expanded="${expanded ? "true" : "false"}"
            >${escapeHtml(commentCount)} comment${commentCount === 1 ? "" : "s"}</button>
            <span>${escapeHtml(historyLatestCommentLabel(session))}</span>
          </div>
          <span class="badge ${escapeAttr(status.className)} settings-history-status">${escapeHtml(status.label)}</span>
        </div>
        ${expanded ? `<div class="settings-history-comments-panel">${renderHistoryCommentMessages(session)}</div>` : ""}
      </div>
    `;
  }).join("");

  table.innerHTML = `
    <div class="settings-history-head">
      <span>Started</span>
      <span>Channel</span>
      <span>Live title</span>
      <span>Duration</span>
      <span>Comments</span>
      <span>Status</span>
    </div>
    ${rows}
  `;
}

function toggleTaskLog(taskId) {
  state.expandedTaskLogs[taskId] = !state.expandedTaskLogs[taskId];
  renderTasks(state.status?.tasks || [], state.status?.activity_events || []);
}

function streamLogSessionHeader(session, fallbackName) {
  const name = String(session?.name || session?.channel_name || fallbackName || "stream");
  const started = formatSessionDateParts(session?.started_at);
  const running = Boolean(session?.running || session?.is_active);
  const rawStatus = String(session?.status || "").trim().toLowerCase();
  const status = running
    ? "RUNNING"
    : rawStatus === "running"
      ? "LAST KNOWN RUNNING"
      : rawStatus
        ? rawStatus.toUpperCase()
        : session?.returncode !== undefined && session?.returncode !== null
          ? `EXITED ${session.returncode}`
          : "SAVED";
  const parts = [`[${name}] ${status}`];
  if (session?.pid) parts.push(`pid=${session.pid}`);
  if (started.date !== "Time unavailable") parts.push(`${started.date} ${started.time}`.trim());
  if (session?.log_path) parts.push(String(session.log_path));
  return parts.join(" | ");
}

function streamLogSessionsForChannel(streams, selectedChannel) {
  const historyByChannel = state.status?.stream_log_history || {};
  const saved = Array.isArray(historyByChannel?.[selectedChannel])
    ? historyByChannel[selectedChannel]
    : [];
  if (saved.length) return saved;
  return Object.values(streams || {})
    .filter((stream) => selectedChannel && String(stream?.name || "") === selectedChannel);
}

function renderLogs(streams) {
  const pre = $("streamLogs");
  if (!pre) return;
  const selectedChannel = selectedWorkspaceChannelName();
  const entries = selectedChannel ? streamLogSessionsForChannel(streams, selectedChannel) : [];
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
    const header = stream.recovering
      ? `[${stream.name}] RECOVERING | pid=${stream.pid || "unknown"}`
      : streamLogSessionHeader(stream, selectedChannel);
    return `${header}\n${stream.log_tail || "No log output yet."}`;
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
    empty.textContent = "Open Dashboard to start the live preview.";
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
  attachPreviewPlayer(apiRequestUrl(selected.preview_url));
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

  const splitterWidth = uiMasterNumber("--component-activity-splitter-width", 8);
  const minLeft = uiMasterNumber("--component-activity-splitter-min-left", 360);
  const minRight = uiMasterNumber("--component-activity-splitter-min-right", 280);
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

async function copyWorkspaceAlert(id, event) {
  if (event && typeof event.stopPropagation === "function") {
    event.stopPropagation();
  }
  const key = String(id || "").trim();
  const alerts = workspaceRecentAlerts(state.status);
  const item = alerts.find((alert, index) => workspaceAlertId(alert, index) === key);
  if (!item) return;
  await copyText(workspaceAlertCopyText(item));
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
  textarea.className = "clipboard-fallback";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function loadConfigText() {
  try {
    const requestId = makeRequestId();
    const path = `/api/config?config=${encodeURIComponent(state.config)}`;
    const requestUrl = apiRequestUrl(path);
    let response;
    try {
      response = await fetch(requestUrl, {
        headers: {
          "X-Request-ID": requestId,
          "X-Client-Action": "config.load",
        },
      });
    } catch (error) {
      throw new Error(`Settings config failed to fetch. Request: ${path}. Browser/network error: ${String(error?.message || error)}. Request ID: ${requestId}.`);
    }
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
      throw new Error(`Settings config request failed. Request: ${path}. HTTP status: ${response.status}. Request ID: ${responseRequestId}.`);
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
    notification_mode: normalizeNotificationMode(config.alerts?.notification_mode),
    rules: {
      ...defaultAlertSettings().rules,
      ...((config.alerts && config.alerts.rules) || {}),
    },
  };
  config.scheduler = {
    ...defaultSchedulerSettings(),
    ...(config.scheduler || {}),
  };
  config.stream_cycles = {
    ...defaultStreamCycleSettings(),
    ...(config.stream_cycles || {}),
    channels: Array.isArray(config.stream_cycles?.channels) ? [...config.stream_cycles.channels] : [],
  };
  if (typeof config.stream_cycles.randomized !== "boolean") {
    config.stream_cycles.randomized = Boolean(config.stream_cycles.restart_delay_randomized);
  }
  if (!Number.isFinite(Number(config.stream_cycles.restart_delay_random_minutes))) {
    const restartMax = Number(config.stream_cycles.restart_delay_max_seconds);
    const restartBase = Number(config.stream_cycles.restart_delay_seconds);
    config.stream_cycles.restart_delay_random_minutes = Number.isFinite(restartMax) && Number.isFinite(restartBase)
      ? Math.max(0, Math.round((restartMax - restartBase) / 60))
      : 0;
  }
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
    };
    const mode = String(channel.live_profile.mode || "copy").toLowerCase();
    channel.live_profile.mode = ["copy", "transcode", "adaptive"].includes(mode) ? mode : "copy";
    channel.live_profile.adaptive = normalizedAdaptiveLiveProfile(channel.live_profile);
    channel.youtube_account_id = normalizeAccountId(channel.youtube_account_id || "");
    channel.youtube_broadcast_id = String(channel.youtube_broadcast_id || "");
    channel.youtube_stream_id = String(channel.youtube_stream_id || "");
    if (typeof channel.youtube_dual_stream !== "boolean") {
      channel.youtube_dual_stream = true;
    }
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
  if (state.activeTab !== "settings" || !["normalize", "youtube"].includes(state.settingsTab)) return;
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
  document.querySelectorAll("#viewSettings .selected-normalize-settings").forEach((card) => {
    const list = card.querySelector(".file-picker .file-list");
    if (!list) return;
    state.normalizeFileListScroll[normalizeFileListScrollKey(card)] = Number(list.scrollTop) || 0;
  });
}

function restoreNormalizeFileListScroll() {
  document.querySelectorAll("#viewSettings .selected-normalize-settings").forEach((card) => {
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
    notification_mode: normalizeNotificationMode(config.alerts?.notification_mode),
    rules: {
      ...defaultAlertSettings().rules,
      ...((config.alerts && config.alerts.rules) || {}),
    },
  };
  config.scheduler = {
    ...defaultSchedulerSettings(),
    ...(config.scheduler || {}),
  };
  config.stream_cycles = {
    ...defaultStreamCycleSettings(),
    ...(config.stream_cycles || {}),
    channels: Array.isArray(config.stream_cycles?.channels) ? [...config.stream_cycles.channels] : [],
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

  renderYoutubeSettingsPanel(config);
  restoreNormalizeFileListScroll();
  window.requestAnimationFrame(restoreNormalizeFileListScroll);
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

function hydrateStorageProviderOauthFromYoutube(config, providerId) {
  const normalizedProviderId = String(providerId || "").trim();
  const youtube = { ...defaultYoutubeSettings(), ...(config?.youtube || {}) };
  const youtubeClientId = String(youtube.client_id || "").trim();
  if (!youtubeClientId || !Array.isArray(config?.storage?.providers)) return false;
  const provider = config.storage.providers.find((item) => String(item?.id || "").trim() === normalizedProviderId);
  if (!provider) return false;
  provider.oauth = { ...defaultStorageProviderOauth(), ...(provider.oauth || {}) };
  if (String(provider.oauth.client_id || "").trim()) return false;
  provider.oauth.client_id = youtubeClientId;
  provider.oauth.client_secret = String(youtube.client_secret || "").trim();
  provider.oauth.oauth_client_type = String(youtube.oauth_client_type || "desktop").trim() === "web" ? "web" : "desktop";
  provider.oauth.use_pkce = youtube.use_pkce !== false;
  return true;
}

function renderStorageConnectState() {
  renderStorageSettingsPanel(state.configData || defaultConfigData());
  renderSettingsFormsUnlessPaused();
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
      popup.document.body.innerHTML = authPopupLoadingHtml("Opening Google Drive sign-in...");
    } catch {
      // Ignore restricted popup document writes.
    }
  }

  state.storageConnectBusyProviderId = providerId;
  renderStorageConnectState();
  try {
    const data = collectSettingsData();
    hydrateStorageProviderOauthFromYoutube(data, providerId);
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
    renderStorageConnectState();
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

function channelSettingsRenderConfig(config) {
  const channels = Array.isArray(config?.channels) ? config.channels : [];
  if (channels.length) return config;
  const statusChannels = Array.isArray(state.status?.channels) ? state.status.channels : [];
  if (!statusChannels.length) return config;
  return {
    ...config,
    channels: statusChannels,
  };
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

function hasFreshYoutubeCredentialStatus() {
  return Boolean(
    state.youtubeStatus
    && typeof state.youtubeStatus === "object"
    && !state.youtubeStatus._cached
    && Object.prototype.hasOwnProperty.call(state.youtubeStatus, "has_client_credentials")
  );
}

function youtubeCredentialsMissingConfirmed(youtube) {
  return Boolean(
    !hasYoutubeCredentialsConfigured(youtube)
    && hasFreshYoutubeCredentialStatus()
    && !state.youtubeStatus?.has_client_credentials
  );
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

function youtubeLiveChatKey(channel = null) {
  const config = state.configData || defaultConfigData();
  const selectedChannelName = String(channel?.name || state.workspace.selectedChannelName || "").trim();
  const selectedChannel = channel || (config.channels || []).find((item) => String(item?.name || "").trim() === selectedChannelName) || null;
  const accountId = normalizeAccountId(selectedChannel?.youtube_account_id || "");
  const broadcastId = String(selectedChannel?.youtube_broadcast_id || "").trim();
  return selectedChannelName && accountId
    ? `${state.config}:${selectedChannelName}:${accountId}:${broadcastId || "auto"}`
    : "";
}

function clearYoutubeLiveChatTimer() {
  if (state.youtubeLiveChat.timer) {
    window.clearTimeout(state.youtubeLiveChat.timer);
    state.youtubeLiveChat.timer = null;
  }
}

function resetYoutubeLiveChat(nextKey = "") {
  clearYoutubeLiveChatTimer();
  state.youtubeLiveChat = {
    ...state.youtubeLiveChat,
    channel: "",
    accountId: "",
    broadcastId: "",
    broadcastTitle: "",
    liveChatId: "",
    messages: [],
    nextPageToken: "",
    pollingIntervalMillis: 5000,
    offlineAt: "",
    loading: false,
    sending: false,
    error: "",
    quotaCooldownUntil: 0,
    loadedKey: nextKey,
    failedKey: "",
    timer: null,
  };
}

function mergeYoutubeLiveChatMessages(messages = []) {
  const existing = Array.isArray(state.youtubeLiveChat.messages) ? state.youtubeLiveChat.messages : [];
  const byId = new Map();
  [...existing, ...messages].forEach((item) => {
    const timestamp = item?.published_at || item?.sent_at || item?.received_at || "";
    const id = String(item?.id || `${timestamp}:${item?.author_display_name || ""}:${item?.display_message || ""}`);
    if (!id) return;
    const previous = byId.get(id);
    byId.set(id, previous ? {
      ...previous,
      ...item,
      sent_at: item?.sent_at || previous?.sent_at || "",
      received_at: item?.received_at || previous?.received_at || "",
    } : item);
  });
  state.youtubeLiveChat.messages = Array.from(byId.values()).slice(-200);
}

function scheduleYoutubeLiveChatPoll() {
  clearYoutubeLiveChatTimer();
  const key = youtubeLiveChatKey();
  if (!key || state.youtubeLiveChat.offlineAt || state.settingsTab !== "youtube") return;
  if (Number(state.youtubeLiveChat.quotaCooldownUntil) > Date.now()) return;
  const interval = Math.max(120000, Math.min(Number(state.youtubeLiveChat.pollingIntervalMillis) || 120000, 120000));
  state.youtubeLiveChat.timer = window.setTimeout(() => {
    refreshYoutubeLiveChat({ silent: true }).catch(() => {});
  }, interval);
}

function queueYoutubeLiveChatRefresh(channel = null) {
  // Temporarily disabled
  return;
}

async function refreshYoutubeLiveChat(options = {}) {
  // Temporarily disabled
  return null;
  const silent = Boolean(options.silent);
  const reset = Boolean(options.reset);
  const config = state.configData || defaultConfigData();
  const channelName = String(state.workspace.selectedChannelName || "").trim();
  const channel = (config.channels || []).find((item) => String(item?.name || "").trim() === channelName) || null;
  const key = youtubeLiveChatKey(channel);
  if (!key || !channelName) {
    resetYoutubeLiveChat();
    return null;
  }
  if (reset || state.youtubeLiveChat.loadedKey !== key) {
    resetYoutubeLiveChat(key);
  }
  clearYoutubeLiveChatTimer();
  state.youtubeLiveChat.loading = true;
  state.youtubeLiveChat.error = "";
  if (!silent) {
    renderYoutubeSettingsPanel(config);
  }
  try {
    const query = new URLSearchParams({ config: state.config, channel: channelName });
    if (!reset && state.youtubeLiveChat.nextPageToken) {
      query.set("pageToken", state.youtubeLiveChat.nextPageToken);
    }
    const payload = await api(`/api/youtube/live-chat?${query.toString()}`, { action: "youtube.live_chat.refresh" });
    if (payload?.quota_cooldown) {
      const retrySeconds = Math.max(60, Number(payload?.retry_after_seconds) || 3600);
      state.youtubeLiveChat.error = String(payload?.error || "YouTube API quota is exhausted. Live chat refresh is paused temporarily.");
      state.youtubeLiveChat.pollingIntervalMillis = retrySeconds * 1000;
      state.youtubeLiveChat.quotaCooldownUntil = Date.now() + (retrySeconds * 1000);
      state.youtubeLiveChat.failedKey = key;
      return payload;
    }
    state.youtubeLiveChat.quotaCooldownUntil = 0;
    if (payload?.live_chat_ended) {
      state.youtubeLiveChat.channel = String(payload?.channel || channelName);
      state.youtubeLiveChat.accountId = normalizeAccountId(payload?.account_id || channel.youtube_account_id || "");
      state.youtubeLiveChat.broadcastId = String(payload?.broadcast_id || channel.youtube_broadcast_id || "");
      state.youtubeLiveChat.broadcastTitle = String(payload?.broadcast_title || "");
      state.youtubeLiveChat.liveChatId = String(payload?.live_chat_id || "");
      state.youtubeLiveChat.nextPageToken = "";
      state.youtubeLiveChat.pollingIntervalMillis = Number(payload?.polling_interval_millis || 60000);
      state.youtubeLiveChat.offlineAt = String(payload?.offline_at || new Date().toISOString());
      state.youtubeLiveChat.error = String(payload?.error || "This YouTube broadcast's live chat has ended.");
      state.youtubeLiveChat.loadedKey = key;
      state.youtubeLiveChat.failedKey = "";
      return payload;
    }
    state.youtubeLiveChat.channel = String(payload?.channel || channelName);
    state.youtubeLiveChat.accountId = normalizeAccountId(payload?.account_id || channel.youtube_account_id || "");
    state.youtubeLiveChat.broadcastId = String(payload?.broadcast_id || channel.youtube_broadcast_id || "");
    state.youtubeLiveChat.broadcastTitle = String(payload?.broadcast_title || "");
    state.youtubeLiveChat.liveChatId = String(payload?.live_chat_id || "");
    state.youtubeLiveChat.nextPageToken = String(payload?.next_page_token || "");
    state.youtubeLiveChat.pollingIntervalMillis = Number(payload?.polling_interval_millis || 5000);
    state.youtubeLiveChat.offlineAt = String(payload?.offline_at || "");
    state.youtubeLiveChat.loadedKey = key;
    state.youtubeLiveChat.failedKey = "";
    if (state.youtubeLiveChat.broadcastId && channel && !String(channel.youtube_broadcast_id || "").trim()) {
      channel.youtube_broadcast_id = state.youtubeLiveChat.broadcastId;
      channel.youtube_broadcast_title = state.youtubeLiveChat.broadcastTitle || channel.youtube_broadcast_title || "";
      channel.youtube_studio_url = String(payload?.broadcast_studio_url || channel.youtube_studio_url || "");
      channel.youtube_stream_id = String(payload?.broadcast_stream_id || channel.youtube_stream_id || "");
      state.youtubeLiveChat.loadedKey = youtubeLiveChatKey(channel) || key;
      syncConfigEditor();
    }
    mergeYoutubeLiveChatMessages(Array.isArray(payload?.messages) ? payload.messages : []);
    return payload;
  } catch (error) {
    state.youtubeLiveChat.error = error.message || "Could not load live chat.";
    state.youtubeLiveChat.failedKey = key;
    throw error;
  } finally {
    state.youtubeLiveChat.loading = false;
    renderYoutubeSettingsPanel(state.configData || defaultConfigData());
    scheduleYoutubeLiveChatPoll();
  }
}

function syncYoutubeLiveChatDraft(source = null) {
  if (source && typeof source.value !== "undefined") {
    state.youtubeLiveChatDraft = String(source.value || "");
    return;
  }
  state.youtubeLiveChatDraft = String(
    $("youtubeLiveChatReplyPanel")?.value
    || $("youtubeLiveChatReply")?.value
    || ""
  );
}

async function sendYoutubeLiveChatMessage(messageOverride = null) {
  if (messageOverride !== null) {
    state.youtubeLiveChatDraft = String(messageOverride || "");
  } else {
    syncYoutubeLiveChatDraft();
  }
  const message = String(state.youtubeLiveChatDraft || "").trim();
  const channelName = String(state.workspace.selectedChannelName || "").trim();
  if (!channelName) throw new Error("Pick a channel before replying.");
  if (!message) throw new Error("Type a reply first.");
  state.youtubeLiveChat.sending = true;
  state.youtubeLiveChat.error = "";
  renderYoutubeSettingsPanel(state.configData || defaultConfigData());
  try {
    const payload = await api("/api/youtube/live-chat/send", {
      method: "POST",
      body: JSON.stringify({ config: state.config, channel: channelName, message }),
      action: "youtube.live_chat.send",
    });
    state.youtubeLiveChatDraft = "";
    if (payload?.message) {
      mergeYoutubeLiveChatMessages([payload.message]);
    }
    await refreshYoutubeLiveChat({ silent: true });
    toast("Reply sent to YouTube live chat.");
  } catch (error) {
    state.youtubeLiveChat.error = error.message || "Could not send reply.";
    throw error;
  } finally {
    state.youtubeLiveChat.sending = false;
    renderYoutubeSettingsPanel(state.configData || defaultConfigData());
  }
}

function youtubeLiveChatAuthorBadges(message) {
  const badges = [];
  if (message?.is_chat_owner) badges.push("Owner");
  if (message?.is_chat_moderator) badges.push("Mod");
  if (message?.is_chat_sponsor) badges.push("Member");
  if (message?.is_verified) badges.push("Verified");
  return badges;
}

function youtubeLiveChatIcon(name) {
  const paths = {
    popout: `
      <path d="M14 3h7v7"></path>
      <path d="m10 14 11-11"></path>
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path>
    `,
    sidebar: `
      <rect x="3" y="4" width="18" height="16" rx="2"></rect>
      <path d="M15 4v16"></path>
      <path d="M18 9h-1"></path>
      <path d="M18 13h-1"></path>
    `,
    refresh: `
      <path d="M21 12a9 9 0 0 1-15 6.7"></path>
      <path d="M3 12a9 9 0 0 1 15-6.7"></path>
      <path d="M18 3v4h-4"></path>
      <path d="M6 21v-4h4"></path>
    `,
    send: `
      <path d="m22 2-7 20-4-9-9-4Z"></path>
      <path d="M22 2 11 13"></path>
    `,
    close: `
      <path d="M18 6 6 18"></path>
      <path d="m6 6 12 12"></path>
    `,
  };
  return `
    <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      ${paths[name] || ""}
    </svg>
  `;
}

function youtubeLiveChatContext(config = state.configData || defaultConfigData()) {
  const channelName = String(state.workspace.selectedChannelName || "").trim();
  const selectedConfigChannel = (config.channels || []).find((item) => String(item?.name || "").trim() === channelName) || null;
  const selectedChannel = channelWithLatestStatus(selectedConfigChannel, channelName);
  const linkedAccountId = normalizeAccountId(selectedChannel?.youtube_account_id || "");
  const accounts = mergedYoutubeAccounts(config, state.youtubeStatus);
  return {
    selectedChannel,
    linkedAccount: accounts.find((item) => item.id === linkedAccountId) || null,
    actionBusy: String(state.youtubeActionBusy || "").trim(),
  };
}

function youtubeLiveChatBodyMarkup(selectedChannel, linkedAccount, actionBusy, options = {}) {
  const channelName = String(selectedChannel?.name || "").trim();
  const linkedAccountConnected = Boolean(linkedAccount?.connected);
  const broadcastId = String(selectedChannel?.youtube_broadcast_id || "").trim();
  const chat = state.youtubeLiveChat || {};
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const replyId = String(options.replyId || "youtubeLiveChatReplyPanel");
  const callPrefix = String(options.callPrefix || "");
  const sendExpression = callPrefix
    ? `${callPrefix}sendYoutubeLiveChatMessage(document.getElementById('${escapeJs(replyId)}')?.value || '').catch((error) => ${callPrefix}toast(error.message))`
    : "sendYoutubeLiveChatMessage().catch((error) => toast(error.message))";
  let guard = "";
  if (!channelName) {
    guard = "Pick a channel to view live chat.";
  } else if (!normalizeAccountId(selectedChannel?.youtube_account_id || "")) {
    guard = "Link a YouTube account to this channel first.";
  } else if (!linkedAccountConnected) {
    guard = "Reconnect the linked YouTube account to read and send live chat.";
  }
  const canSend = !guard && !chat.sending && !actionBusy && !chat.offlineAt;
  const statusText = guard
    ? "Setup"
    : chat.offlineAt
      ? "Offline"
      : chat.loading && !messages.length
        ? "Loading"
        : "Live Chat";
  const messageList = messages.length
    ? messages.map((message) => {
      const badges = youtubeLiveChatAuthorBadges(message);
      const avatar = String(message?.author_profile_image_url || "").trim();
      const timestamp = message?.published_at || message?.sent_at || message?.received_at || "";
      const timeText = formatLiveChatClockTime(timestamp);
      return `
        <article class="youtube-chat-message">
          ${avatar ? `<img class="youtube-chat-avatar" src="${escapeAttr(avatar)}" alt="">` : `<div class="youtube-chat-avatar missing" aria-hidden="true"></div>`}
          <div class="youtube-chat-message-body">
            <div class="youtube-chat-message-head">
              <strong>${escapeHtml(message?.author_display_name || "Viewer")}</strong>
              ${timeText ? `<time class="youtube-chat-time" datetime="${escapeAttr(timestamp)}" title="${escapeAttr(formatDateTime(timestamp))}">${escapeHtml(timeText)}</time>` : ""}
              ${badges.map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`).join("")}
            </div>
            <div class="youtube-chat-message-text">${youtubeLiveChatMessageHtml(message)}</div>
          </div>
        </article>
      `;
    }).join("")
    : `<div class="youtube-chat-empty">${escapeHtml(chat.loading ? "Loading live chat..." : "No live chat messages loaded yet.")}</div>`;
  return `
    ${guard ? `<div class="notice warn">${escapeHtml(guard)}</div>` : ""}
    ${chat.error ? `<div class="notice warn">${escapeHtml(chat.error)}</div>` : ""}
    <div class="youtube-chat-toolbar">
      <span class="badge">${escapeHtml(messages.length ? `${messages.length} loaded` : "0 loaded")}</span>
      ${chat.pollingIntervalMillis ? `<span class="badge">Refresh ${escapeHtml(`${Math.round((Number(chat.pollingIntervalMillis) || 5000) / 1000)}s`)}</span>` : ""}
      ${chat.offlineAt ? `<span class="badge warn">Offline ${escapeHtml(formatDateTime(chat.offlineAt))}</span>` : ""}
      <button class="pill small ghost icon-only" type="button" onclick="${callPrefix}refreshYoutubeLiveChat({ reset: true }).catch((error) => ${callPrefix}toast(error.message))" ${guard || chat.loading ? "disabled" : ""} title="Refresh" aria-label="Refresh">${youtubeLiveChatIcon("refresh")}</button>
    </div>
    <div class="youtube-chat-list" aria-live="polite">
      ${messageList}
    </div>
    <div class="youtube-chat-reply">
      <textarea id="${escapeAttr(replyId)}" rows="3" placeholder="Reply in live chat" oninput="${callPrefix}syncYoutubeLiveChatDraft(this)" ${canSend ? "" : "disabled"}>${escapeHtml(state.youtubeLiveChatDraft || "")}</textarea>
      <button class="pill primary icon-only" type="button" onclick="${sendExpression}" ${canSend ? "" : "disabled"} title="${escapeAttr(chat.sending ? "Sending" : "Send reply")}" aria-label="${escapeAttr(chat.sending ? "Sending" : "Send reply")}">${youtubeLiveChatIcon("send")}</button>
    </div>
  `;
}

function youtubeLiveChatCard(selectedChannel, linkedAccount, actionBusy) {
  const channelName = String(selectedChannel?.name || "").trim();
  const linkedAccountConnected = Boolean(linkedAccount?.connected);
  const broadcastId = String(selectedChannel?.youtube_broadcast_id || "").trim();
  const chat = state.youtubeLiveChat || {};
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  let guard = "";
  if (!channelName) {
    guard = "Pick a channel to view live chat.";
  } else if (!normalizeAccountId(selectedChannel?.youtube_account_id || "")) {
    guard = "Link a YouTube account to this channel first.";
  } else if (!linkedAccountConnected) {
    guard = "Reconnect the linked YouTube account to read and send live chat.";
  }
  const statusText = guard
    ? "Setup"
    : chat.offlineAt
      ? "Offline"
      : chat.loading && !messages.length
        ? "Loading"
        : "Live Chat";
  return youtubeCollapsibleCard({
    key: `youtube-live-chat-${channelName || "none"}`,
    title: "Comments & Live Chat",
    helper: "Read viewer comments and reply as the linked YouTube channel.",
    extraClass: "youtube-live-chat-card",
    defaultOpen: false,
    summaryMetaHtml: `<span class="meta">${escapeHtml(chat.broadcastTitle || selectedChannel?.youtube_studio_url || broadcastId || guard || (linkedAccountConnected ? "Auto-detect active broadcast" : "No broadcast linked"))}</span>`,
    summaryBadgeHtml: `<span class="badge ${!guard && !chat.offlineAt ? "live" : guard ? "warn" : ""}">${escapeHtml(statusText)}</span>`,
    body: `
      <div class="youtube-chat-launch-actions" aria-label="Live chat options">
        <button class="pill icon-only youtube-chat-option" type="button" onclick="openYoutubeLiveChatPopout()" title="Pop out in new window" aria-label="Pop out in new window">
          ${youtubeLiveChatIcon("popout")}
        </button>
        <button class="pill icon-only youtube-chat-option" type="button" onclick="openYoutubeLiveChatSidePanel()" title="Open in right side panel" aria-label="Open in right side panel">
          ${youtubeLiveChatIcon("sidebar")}
        </button>
      </div>
    `,
  });
}

function renderYoutubeLiveChatSidePanel(selectedChannel, linkedAccount, actionBusy) {
  const mount = $("youtubeLiveChatSidePanelMount");
  let panel = $("youtubeLiveChatSidePanel");
  if (!state.youtubeLiveChatPanelOpen || !mount) {
    panel?.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement("aside");
    panel.id = "youtubeLiveChatSidePanel";
    panel.className = "youtube-chat-side-panel";
    panel.setAttribute("aria-label", "YouTube live chat side panel");
  }
  if (panel.parentElement !== mount) {
    mount.appendChild(panel);
  }
  const channelName = String(selectedChannel?.name || state.workspace.selectedChannelName || "").trim();
  panel.innerHTML = `
    <div class="youtube-chat-side-panel-head">
      <div>
        <h2>Comments & Live Chat</h2>
        <p class="helper">${escapeHtml(channelName || "No channel selected")}</p>
      </div>
      <button class="pill ghost icon-only" type="button" onclick="closeYoutubeLiveChatSidePanel()" title="Close" aria-label="Close">
        ${youtubeLiveChatIcon("close")}
      </button>
    </div>
    <div class="youtube-chat-side-panel-body">
      ${youtubeLiveChatBodyMarkup(selectedChannel, linkedAccount, actionBusy, { replyId: "youtubeLiveChatReplyPanel" })}
    </div>
  `;
}

function renderYoutubeLiveChatPopout(selectedChannel, linkedAccount, actionBusy) {
  if (!youtubeLiveChatPopoutWindow || youtubeLiveChatPopoutWindow.closed) return;
  const channelName = String(selectedChannel?.name || state.workspace.selectedChannelName || "").trim();
  const body = youtubeLiveChatBodyMarkup(selectedChannel, linkedAccount, actionBusy, {
    replyId: "youtubeLiveChatReplyPopout",
    callPrefix: "window.opener.",
  });
  const popup = youtubeLiveChatPopoutWindow;
  popup.document.open();
  popup.document.write(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>YouTube Live Chat</title>
        <link rel="stylesheet" href="${escapeAttr(localAssetUrl("ui-master.css"))}">
      </head>
      <body class="youtube-chat-popout-root">
        <main class="youtube-chat-popout">
          <div class="youtube-chat-popout-head">
            <div>
              <h1>Comments & Live Chat</h1>
              <div class="helper">${escapeHtml(channelName || "No channel selected")}</div>
            </div>
            <button class="pill ghost icon-only" type="button" onclick="window.close()" title="Close" aria-label="Close">
              ${youtubeLiveChatIcon("close")}
            </button>
          </div>
          <div class="youtube-chat-popout-body">${body}</div>
        </main>
      </body>
    </html>`);
  popup.document.close();
}

function renderYoutubeLiveChatSurfaces(selectedChannel, linkedAccount, actionBusy) {
  renderYoutubeLiveChatSidePanel(selectedChannel, linkedAccount, actionBusy);
  renderYoutubeLiveChatPopout(selectedChannel, linkedAccount, actionBusy);
}

function openYoutubeLiveChatSidePanel() {
  state.youtubeLiveChatPanelOpen = true;
  const { selectedChannel, linkedAccount, actionBusy } = youtubeLiveChatContext();
  renderYoutubeSettingsPanel(state.configData || defaultConfigData());
  renderYoutubeLiveChatSidePanel(selectedChannel, linkedAccount, actionBusy);
  queueYoutubeLiveChatRefresh(selectedChannel);
}

function closeYoutubeLiveChatSidePanel() {
  state.youtubeLiveChatPanelOpen = false;
  renderYoutubeSettingsPanel(state.configData || defaultConfigData());
}

function openYoutubeLiveChatPopout() {
  if (!youtubeLiveChatPopoutWindow || youtubeLiveChatPopoutWindow.closed) {
    youtubeLiveChatPopoutWindow = window.open("", "youtubeLiveChatPopout", "popup=yes,width=460,height=760");
  }
  if (!youtubeLiveChatPopoutWindow) {
    toast("Could not open the live chat popup window.");
    return;
  }
  const { selectedChannel, linkedAccount, actionBusy } = youtubeLiveChatContext();
  renderYoutubeLiveChatPopout(selectedChannel, linkedAccount, actionBusy);
  youtubeLiveChatPopoutWindow.focus();
  queueYoutubeLiveChatRefresh(selectedChannel);
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

function isOnboardingYoutubeCardFocused(key) {
  if (!state.onboarding.active || !key) return false;
  const step = Number(state.onboarding.step) || 0;
  const text = String(key);
  if (step === 2) {
    return text === "youtube-account" || text.startsWith("youtube-stream-settings-");
  }
  if (step === 3) {
    return text.startsWith("youtube-encoder-")
      || text.startsWith("youtube-videos-")
      || text.startsWith("youtube-cloud-videos-");
  }
  if (step === 4) {
    return text === "youtube-go-live" || text.startsWith("youtube-stream-settings-");
  }
  return false;
}

function isYoutubeCardExpanded(key, defaultOpen = false, autoOpenWhenFocused = true) {
  if (!key) return Boolean(defaultOpen);
  const current = state.youtubeExpandedCards?.[key];
  if (typeof current === "boolean") return current;
  if (autoOpenWhenFocused && isOnboardingYoutubeCardFocused(key)) return true;
  return Boolean(defaultOpen);
}

function setYoutubeCardExpanded(key, open) {
  if (!key) return;
  state.youtubeExpandedCards = {
    ...(state.youtubeExpandedCards || {}),
    [key]: Boolean(open),
  };
}

function youtubeCardMotion() {
  const fallback = { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
    return { duration: 0, easing: fallback.easing };
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--ui-reveal-card").trim();
  const match = raw.match(/^([\d.]+)(ms|s)\s*(.*)$/);
  if (!match) return fallback;
  const duration = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
  return {
    duration: Number.isFinite(duration) ? duration : fallback.duration,
    easing: match[3]?.trim() || fallback.easing,
  };
}

function toggleYoutubeCardExpanded(event, key) {
  event?.preventDefault?.();
  const card = event?.currentTarget?.closest?.(".youtube-collapsible-card");
  const content = card?.querySelector?.(".youtube-card-content");
  if (!card || !content) {
    setYoutubeCardExpanded(key, !isYoutubeCardExpanded(key));
    return;
  }

  const opening = !card.open;
  setYoutubeCardExpanded(key, opening);
  content.getAnimations?.().forEach((animation) => {
    animation.onfinish = null;
    animation.oncancel = null;
    animation.cancel();
  });
  const motion = youtubeCardMotion();
  const finalPaddingTop = uiMasterValue("--space-2", "12px");
  const finalPaddingBottom = uiMasterValue("--space-3", "16px");

  const setContentMotionVars = ({ height, paddingTop, paddingBottom, opacity } = {}) => {
    if (height !== undefined) content.style.setProperty("--youtube-card-content-height", height);
    if (paddingTop !== undefined) content.style.setProperty("--youtube-card-content-padding-top", paddingTop);
    if (paddingBottom !== undefined) content.style.setProperty("--youtube-card-content-padding-bottom", paddingBottom);
    if (opacity !== undefined) content.style.setProperty("--youtube-card-content-opacity", opacity);
  };

  const restoreContentMotionVar = (name, value) => {
    if (value) {
      content.style.setProperty(name, value);
    } else {
      content.style.removeProperty(name);
    }
  };

  const clearAnimationStyles = () => {
    content.style.removeProperty("--youtube-card-content-height");
    content.style.removeProperty("--youtube-card-content-padding-top");
    content.style.removeProperty("--youtube-card-content-padding-bottom");
    content.style.removeProperty("--youtube-card-content-opacity");
  };

  const expandedHeight = () => {
    const previousHeight = content.style.getPropertyValue("--youtube-card-content-height");
    const previousPaddingTop = content.style.getPropertyValue("--youtube-card-content-padding-top");
    const previousPaddingBottom = content.style.getPropertyValue("--youtube-card-content-padding-bottom");
    const previousOpacity = content.style.getPropertyValue("--youtube-card-content-opacity");

    setContentMotionVars({
      height: "auto",
      paddingTop: finalPaddingTop,
      paddingBottom: finalPaddingBottom,
      opacity: "1",
    });
    const height = content.scrollHeight;

    restoreContentMotionVar("--youtube-card-content-height", previousHeight);
    restoreContentMotionVar("--youtube-card-content-padding-top", previousPaddingTop);
    restoreContentMotionVar("--youtube-card-content-padding-bottom", previousPaddingBottom);
    restoreContentMotionVar("--youtube-card-content-opacity", previousOpacity);
    return height;
  };

  card.classList.add("is-animating");
  if (opening) {
    setContentMotionVars({
      height: "0px",
      paddingTop: "0px",
      paddingBottom: "0px",
      opacity: "0",
    });
    card.open = true;
  }

  if (!motion.duration) {
    card.open = opening;
    card.classList.remove("is-animating");
    clearAnimationStyles();
    return;
  }

  const targetHeight = expandedHeight();
  const currentHeight = Math.max(0, Math.round(content.getBoundingClientRect().height || content.offsetHeight || targetHeight));
  const keyframes = opening
    ? [
        { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px" },
        { height: `${targetHeight}px`, opacity: 1, paddingTop: finalPaddingTop, paddingBottom: finalPaddingBottom },
      ]
    : [
        { height: `${currentHeight}px`, opacity: 1, paddingTop: finalPaddingTop, paddingBottom: finalPaddingBottom },
        { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px" },
      ];
  if (!opening) {
    setContentMotionVars({
      height: `${currentHeight}px`,
      paddingTop: finalPaddingTop,
      paddingBottom: finalPaddingBottom,
      opacity: "1",
    });
  }
  const animation = content.animate(keyframes, {
    duration: motion.duration,
    easing: motion.easing,
  });

  animation.onfinish = () => {
    if (!opening) card.open = false;
    card.classList.remove("is-animating");
    clearAnimationStyles();
  };
  animation.oncancel = () => {
    card.classList.remove("is-animating");
    clearAnimationStyles();
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
  autoOpenWhenFocused = true,
  summaryMetaHtml = "",
  summaryBadgeHtml = "",
} = {}) {
  const open = isYoutubeCardExpanded(key, defaultOpen, autoOpenWhenFocused);
  const cardClass = `nested-card youtube-collapsible-card ${extraClass}`.trim();
  return `
    <details class="${cardClass}" ${attributes} ${open ? "open" : ""} ontoggle="setYoutubeCardExpanded('${escapeJs(key || "")}', this.open)">
      <summary class="youtube-card-summary" onclick="toggleYoutubeCardExpanded(event, '${escapeJs(key || "")}')">
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

  config = config || defaultConfigData();
  const channelConfig = channelSettingsRenderConfig(config);
  const youtube = { ...defaultYoutubeSettings(), ...(config.youtube || {}) };
  const status = state.youtubeStatus || {};
  const accounts = mergedYoutubeAccounts(config, status);
  const connectedCount = Number(status.connected_count || accounts.filter((item) => item.connected).length || 0);
  const previousScheduleChannel = String(state.workspace.selectedChannelName || "").trim();
  const selectedChannelName = previousScheduleChannel || "";
  const selectedChannelIndex = (channelConfig.channels || []).findIndex((channel) => String(channel?.name || "") === selectedChannelName);
  const selectedConfigChannel = selectedChannelIndex >= 0 ? channelConfig.channels[selectedChannelIndex] : null;
  const selectedChannel = channelWithLatestStatus(selectedConfigChannel, selectedChannelName);
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
  const credentialsMissing = youtubeCredentialsMissingConfirmed(youtube);
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
  const connectButtonDisabled = actionBusy || (!connectHasToken && credentialsMissing) ? "disabled" : "";
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
  const activeLiveIndex = selectedSettingsChannelIndex(channelConfig);
  const activeLiveChannel = activeLiveIndex >= 0 ? channelConfig.channels[activeLiveIndex] : null;
  const noChannelCard = `<section class="nested-card">No channels yet. Click <strong>Add Channel</strong> to create one.</section>`;
  const streamSettingsMarkup = activeLiveIndex >= 0
    ? streamSettingsCard(channelConfig.channels[activeLiveIndex], activeLiveIndex)
    : noChannelCard;
  const streamCycleMarkup = activeLiveIndex >= 0
    ? streamCycleCard(channelConfig.channels[activeLiveIndex], activeLiveIndex)
    : "";
  const encoderMarkup = activeLiveIndex >= 0
    ? normalizationCard(channelConfig.channels[activeLiveIndex], activeLiveIndex, { variant: "youtube" })
    : "";
  const videosMarkup = activeLiveIndex >= 0
    ? liveVideosCard(channelConfig.channels[activeLiveIndex], activeLiveIndex)
    : "";
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
  const setupGuideStep = state.onboarding.active ? Math.max(2, Math.min(5, Number(state.onboarding.step) || 2)) : 0;
  const showSetupCard = (cardName) => {
    if (!setupGuideStep) return true;
    if (setupGuideStep === 2) return cardName === "account" || cardName === "stream";
    if (setupGuideStep === 3) return cardName === "encoder" || cardName === "videos";
    if (setupGuideStep === 4) return cardName === "live" || cardName === "stream";
    return true;
  };
  if (!setupGuideStep) {
    if (selectedChannel && linkedAccount?.connected) {
      queueYoutubeLiveChatRefresh(selectedChannel);
    } else if (state.youtubeLiveChat.liveChatId || state.youtubeLiveChat.timer || state.youtubeLiveChat.messages.length) {
      resetYoutubeLiveChat();
    }
  }
  const liveChatMarkup = ""; // Temporarily disabled
  const liveChatPanelClass = state.youtubeLiveChatPanelOpen ? " youtube-chat-embedded-open" : "";

  container.innerHTML = `
    <div class="youtube-page-stack${liveChatPanelClass}">
      <div class="youtube-main-stack">
      ${showSetupCard("account") ? youtubeCollapsibleCard({
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
          ${credentialsMissing ? `<div class="notice warn">YouTube owner credentials are not configured yet.</div>` : ""}
        `,
      }) : ""}

      ${showSetupCard("live") ? youtubeCollapsibleCard({
        key: "youtube-go-live",
        title: "Live Settings",
        helper: "Broadcast details for live starts.",
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
      }) : ""}

      <div class="channel-settings-list" id="channelSettings">
        ${showSetupCard("stream") ? streamSettingsMarkup : ""}
        ${showSetupCard("stream") ? streamCycleMarkup : ""}
        ${showSetupCard("encoder") ? encoderMarkup : ""}
        ${videosMarkup && showSetupCard("videos") ? videosMarkup : ""}
      </div>

      ${!setupGuideStep && ownerSetupVisible ? youtubeCollapsibleCard({
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

      ${liveChatMarkup}
      </div>
      <div class="youtube-chat-panel-slot" id="youtubeLiveChatSidePanelMount"></div>
    </div>
  `;
  renderYoutubeLiveChatSurfaces(selectedChannel, linkedAccount, actionBusy);
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
      try {
        await refreshYoutubeBroadcasts(true, { silent: true });
      } catch (error) {
        logLocalActivityEvent(
          "youtube_broadcast_refresh",
          error.message || "Broadcast refresh failed after YouTube connection.",
          { account_id: normalizedAccountId },
          "error"
        );
      }
      setYoutubeAction("success", "YouTube account connected.");
      return true;
    }
    if (account?.connected || account?.wrong_account) {
      await refresh();
      try {
        await refreshYoutubeBroadcasts(true, { silent: true });
      } catch (error) {
        logLocalActivityEvent(
          "youtube_broadcast_refresh",
          error.message || "Broadcast refresh failed after YouTube connection.",
          { account_id: normalizedAccountId },
          "error"
        );
      }
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

async function refreshYoutubeConnectionAfterReturn() {
  if (state.youtubeActionBusy !== "connect") return;
  await loadConfigText();
  await refreshYoutubeStatus();
  const accounts = Array.isArray(state.youtubeStatus?.accounts) ? state.youtubeStatus.accounts : [];
  const account = accounts.find((item) => normalizeAccountId(item?.id || "") === state.youtubeSelectedAccountId) || accounts.find((item) => item?.connected) || null;
  if (account?.wrong_account) {
    setYoutubeAction("error", account.message || "Connected YouTube account does not match this Castarro channel.");
    return;
  }
  if (!state.youtubeStatus?.connected) return;
  await refresh();
  try {
    await refreshYoutubeBroadcasts(true, { silent: true });
  } catch (error) {
    logLocalActivityEvent(
      "youtube_broadcast_refresh",
      error.message || "Broadcast refresh failed after YouTube connection.",
      { account_id: state.youtubeSelectedAccountId || "" },
      "error"
    );
  }
  const subscriberText = youtubeSubscriberText(account || state.youtubeStatus);
  const connectedName = account?.channel_title
    ? `Connected to ${account.channel_title}${subscriberText ? ` (${subscriberText})` : ""}.`
    : "YouTube account connected.";
  setYoutubeAction("success", connectedName);
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
      popup.document.body.innerHTML = authPopupLoadingHtml("Opening YouTube sign-in...");
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
  const selectedConfigChannel = (config.channels || []).find((item) => String(item?.name || "").trim() === channelName) || null;
  const selectedChannel = channelWithLatestStatus(selectedConfigChannel, channelName);
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
  const configChannel = (config.channels || []).find((item) => String(item?.name || "").trim() === channelName);
  const channel = channelWithLatestStatus(configChannel, channelName);
  let linkedAccountId = normalizeAccountId(channel?.youtube_account_id || "");
  const accounts = mergedYoutubeAccounts(config, state.youtubeStatus);
  const linkedAccount = accounts.find((item) => normalizeAccountId(item?.id || "") === linkedAccountId);

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
    `Confirm schedule?\nChannel: ${channelName}\nSchedules on YouTube account: ${linkedAccount?.label || linkedAccountId}\nDual Stream: ${channel?.youtube_dual_stream !== false ? "marked on in Castarro" : "marked off in Castarro"}`
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
  const configChannel = (config.channels || []).find((item) => String(item?.name || "").trim() === channelName);
  const channel = channelWithLatestStatus(configChannel, channelName);
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
  const path = `/api/youtube/thumbnail?${query.toString()}`;
  const requestUrl = apiRequestUrl(path);
  let response;
  try {
    response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Request-ID": requestId,
        "X-Client-Action": "youtube.thumbnail.upload",
      },
      body: file,
    });
  } catch (error) {
    throw new Error(`YouTube thumbnail "${file.name || "thumbnail"}" failed to fetch. Request: ${path}. Browser/network error: ${String(error?.message || error)}. Request ID: ${requestId}.`);
  }
  const responseRequestId = String(response.headers.get("X-Request-ID") || requestId);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`YouTube thumbnail upload failed for "${file.name || "thumbnail"}". Server response: ${payload.error || "Thumbnail upload failed."}. Request ID: ${responseRequestId}.`);
  }
  return payload;
}

function normalizationCard(channel, index, { variant = "normalize" } = {}) {
  const isYoutubeVariant = variant === "youtube";
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
  const uploadId = `${isYoutubeVariant ? "youtube-upload" : "upload"}-${index}`;
  const fileOptions = files.length
    ? files.map((file) => `
        <label class="file-option">
          <input type="checkbox" data-raw-file="${escapeAttr(file.path)}" ${selectedSet.has(file.path) ? "checked" : ""} onchange="syncRawSelection(${index}, this)">
          <span>${escapeHtml(file.path)}</span>
          ${selectedSet.has(file.path) ? `<button class="file-remove-button" type="button" title="Remove from encoding" aria-label="Remove ${escapeAttr(file.path)} from encoding" onclick="event.preventDefault(); event.stopPropagation(); removeRawSelection(${index}, '${escapeJs(file.path)}')">x</button>` : ""}
        </label>
      `).join("")
    : `<div class="meta">No videos found yet in Raw Videos/${escapeHtml(channel.name || "")}. Add videos here or copy files into that folder; the list updates automatically when you return to this view.</div>`;

  const body = `
      ${isYoutubeVariant ? "" : `<div class="section-head compact">
        <div>
          <h3>${escapeHtml(channel.name || `channel_${index + 1}`)}</h3>
          <p class="helper">Encoding only the selected channel from the Channels rail.</p>
        </div>
        <span class="badge">${selected.length} selected</span>
      </div>`}
      <div class="row wrap">
        <input class="hidden-file" id="${escapeAttr(uploadId)}" type="file" multiple accept="video/*" onchange="uploadRawVideos(${index}, this.files).catch((error) => toast(error.message)); this.value = '';">
        <button class="pill primary" type="button" ${state.rawUploadBusyChannel === channel.name ? "disabled" : ""} onclick="selectRawVideos(${index}, '${escapeJs(uploadId)}').catch((error) => toast(error.message))">${escapeHtml(state.rawUploadBusyChannel === channel.name ? "Adding..." : "Add Videos")}</button>
        <button class="pill success" type="button" onclick="startSettingsTask('normalize', ${index})">${isYoutubeVariant ? "Encode Videos" : "Encode"}</button>
        ${isYoutubeVariant ? `<button class="pill ghost" type="button" onclick="startSettingsTask('renditions', ${index}, { chooseOutputFolder: false })">Encode Lower Res</button>` : ""}
      </div>
      ${task ? taskProgressMarkup(task, index, completedCount) : ""}
      <div class="file-picker">
        <div class="file-list">${fileOptions}</div>
        <div class="meta">If an encoded file name already exists, a new version like <code>-v2</code> is created and a heads-up appears in Activity.</div>
      </div>
      <div>
        <h3>Source Encode</h3>
        <div class="form-grid">
          ${normalizeInput(index, "width", "Width", normalizeProfile.width ?? 1920, "number")}
          ${normalizeInput(index, "height", "Height", normalizeProfile.height ?? 1080, "number")}
          ${normalizeInput(index, "fps", "FPS", normalizeProfile.fps ?? 30, "number")}
          ${normalizeSelect(index, "video_encoder", "Video encoder", encoder, ["auto", "auto_hardware", "h264_nvenc", "h264_qsv", "h264_amf", "libx264"], `syncEncoderPreset(${index}, this.value, this)`)}
          ${normalizeSelect(index, "x264_preset", "Encoding preset", preset, presetOptions, "", encoder)}
          ${normalizeSelect(index, "rate_control", "Rate control", rateControl, ["vbr", "cbr"], `syncNormalizeRateControl(${index}, this.value, this)`)}
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
      ${isYoutubeVariant ? adaptiveLadderSection(channel, index) : ""}
  `;

  if (isYoutubeVariant) {
    return youtubeCollapsibleCard({
      key: `youtube-encoder-${channel.name || index}`,
      title: "Encoder",
      helper: "Prepare videos and control live output encoding for this channel.",
      extraClass: "youtube-encoder-card channel-settings selected-normalize-settings",
      attributes: `data-normalize-card data-index="${index}" data-channel-name="${escapeAttr(channel.name || "")}"`,
      summaryMetaHtml: `<span class="meta">${escapeHtml(channel.name || "No channel selected")}</span>`,
      summaryBadgeHtml: `<span class="badge">${selected.length} selected</span>`,
      autoOpenWhenFocused: false,
      body,
    });
  }

  return `
    <div class="channel-settings selected-normalize-settings" data-normalize-card data-index="${index}" data-channel-name="${escapeAttr(channel.name || "")}">
      ${body}
    </div>
  `;
}

function taskForChannel(channelName) {
  const tasks = state.status?.tasks || [];
  return tasks.find((task) => (
    task.channel === channelName
    && ["normalize", "renditions", "validate", "test-stream"].includes(task.name)
    && task.running
  )) || tasks.find((task) => (
    task.channel === channelName
    && ["normalize", "renditions", "validate", "test-stream"].includes(task.name)
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
  const action = task.name === "normalize"
    ? "Encoding"
    : task.name === "renditions"
      ? "Encoding lower resolutions"
      : task.name === "validate" ? "Validating" : "Testing stream";
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
        <div class="progress-fill" style="--progress-fill-width: ${percent}%"></div>
      </div>
      <div class="progress-message">${escapeHtml(message)}</div>
      <div class="progress-actions">
        ${task.running ? `<button class="pill danger small" type="button" onclick="stopTask('${escapeJs(task.id)}')">${escapeHtml(stopTaskLabel(task.name))}</button>` : ""}
        ${canResume ? `<button class="pill success small" type="button" onclick="resumeSettingsTask('normalize', ${index}, ${completedCount + 1})">Resume</button>` : ""}
      </div>
    </div>
  `;
}

function liveImportProgressMarkup(progress) {
  const total = Math.max(0, Number(progress?.total) || 0);
  const current = Math.max(0, Number(progress?.current) || 0);
  const percent = total ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0;
  const action = String(progress?.action || "Copying");
  const fileName = String(progress?.fileName || "");
  const status = total ? `${action} ${Math.min(current + 1, total)} of ${total}` : action;
  const paused = Boolean(progress?.paused);
  const cancelRequested = Boolean(progress?.cancelRequested);
  const message = cancelRequested
    ? "Canceling after current file..."
    : paused
      ? `Paused${fileName ? `: ${fileName}` : ""}`
      : fileName ? `${status}: ${fileName}` : status;
  const showControls = action.toLowerCase() === "copying";
  return `
    <div class="progress-card running live-import-progress">
      <div class="progress-head">
        <span>${escapeHtml(status)}</span>
        <span>${escapeHtml(`${percent}%`)}</span>
      </div>
      <div class="progress-track" aria-label="Video import progress">
        <div class="progress-fill" style="--progress-fill-width: ${percent}%"></div>
      </div>
      <div class="progress-message">${escapeHtml(message)}</div>
      ${showControls ? `
        <div class="progress-actions live-import-actions">
          <button class="pill small" type="button" onclick="toggleLiveImportPause()" ${cancelRequested ? "disabled" : ""}>${escapeHtml(paused ? "Resume" : "Pause")}</button>
          <button class="pill danger small" type="button" onclick="cancelLiveImport()" ${cancelRequested ? "disabled" : ""}>Cancel</button>
        </div>
      ` : ""}
    </div>
  `;
}

function toggleLiveImportPause() {
  if (!isLiveImportBusy()) return;
  const control = liveImportControlState();
  if (control.cancelRequested) return;
  control.paused = !control.paused;
  syncLiveImportProgressFlags();
  toast(control.paused ? "Video import paused." : "Video import resumed.");
  renderSettingsForms();
}

function cancelLiveImport() {
  if (!isLiveImportBusy()) return;
  const control = liveImportControlState();
  control.cancelRequested = true;
  control.paused = false;
  syncLiveImportProgressFlags();
  toast("Canceling import after the current file.");
  renderSettingsForms();
}

async function waitForLiveImportResume() {
  const control = liveImportControlState();
  while (control.paused && !control.cancelRequested) {
    syncLiveImportProgressFlags();
    renderSettingsForms();
    await delay(250);
  }
  return !control.cancelRequested;
}

function stopTaskLabel(name) {
  if (name === "normalize") return "Stop Encoding";
  if (name === "renditions") return "Stop Lower Res";
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
  if (encoder === "auto" || encoder === "auto_hardware") {
    return ["medium"];
  }
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
    auto: "Auto: Best Available (GPU First, CPU If Needed)",
    auto_hardware: "Auto GPU Only: NVIDIA, Intel, or AMD",
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

function normalizeCardForIndex(index, source = null) {
  const sourceCard = source?.closest?.("[data-normalize-card]");
  if (sourceCard && Number(sourceCard.dataset.index) === Number(index)) {
    return sourceCard;
  }
  const roots = state.settingsTab === "youtube"
    ? ["#channelSettings", "#normalizationChannels"]
    : ["#normalizationChannels", "#channelSettings"];
  for (const root of roots) {
    const card = document.querySelector(`${root} [data-normalize-card][data-index="${index}"]`);
    if (card) return card;
  }
  return document.querySelector(`[data-normalize-card][data-index="${index}"]`);
}

function syncEncoderPreset(index, encoder, source = null) {
  const card = normalizeCardForIndex(index, source);
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

function syncNormalizeRateControl(index, modeValue, source = null) {
  const card = normalizeCardForIndex(index, source);
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
    syncEncoderPreset(index, control.value, control);
    return;
  }
  if (field === "rate_control") {
    syncNormalizeRateControl(index, control.value, control);
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
          <input type="password" autocomplete="off" spellcheck="false" data-youtube-channel-index="${index}" data-youtube-channel-field="stream_key_env" value="${escapeAttr(streamKeyInputValue(channel))}" placeholder="${STREAM_KEY_PLACEHOLDER}">
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
        <label class="switch">
          <input type="checkbox" data-youtube-channel-index="${index}" data-youtube-channel-field="youtube_dual_stream" ${channel.youtube_dual_stream !== false ? "checked" : ""}>
          <span>Dual Stream confirmed</span>
        </label>
      </div>
      <div class="notice">
        YouTube Studio currently owns the Shorts Dual Stream crop toggle. Keep this checked after enabling it in Studio so Castarro shows this channel as ready.
      </div>
    `,
  });
}

function streamCycleCard(channel, index) {
  const config = state.configData || defaultConfigData();
  const cycles = {
    ...defaultStreamCycleSettings(),
    ...(config.stream_cycles || {}),
  };
  const channelName = String(channel?.name || "").trim();
  const entry = findStreamCycleChannelEntry(config, channelName) || {
    channel: channelName,
    enabled: false,
    duration_seconds: 12 * 60 * 60,
  };
  const durationSeconds = streamCycleEntryDurationSeconds(entry);
  const rawCooldownSeconds = Number(cycles.restart_delay_seconds ?? 180);
  const cooldownSeconds = Number.isFinite(rawCooldownSeconds) ? Math.max(0, Math.round(rawCooldownSeconds)) : 180;
  const durationRandomFallback = Math.max(0, Number(entry.duration_max_seconds) - durationSeconds);
  const cooldownRandomFallback = Math.max(0, Number(cycles.restart_delay_max_seconds) - cooldownSeconds);
  const durationRandomMinutes = streamCycleRandomMinutes(entry, "duration_random_minutes", durationRandomFallback);
  const cooldownRandomMinutes = streamCycleRandomMinutes(cycles, "restart_delay_random_minutes", cooldownRandomFallback);
  const cycleStatus = Array.isArray(state.status?.stream_cycles?.channels)
    ? state.status.stream_cycles.channels.find((item) => String(item?.channel || "") === channelName)
    : null;
  const active = Boolean(cycles.enabled && entry.enabled);
  const statusText = cycleStatus?.running
    ? `${durationText(cycleStatus.elapsed_seconds || 0)} elapsed`
    : cycleStatus?.phase === "waiting_restart"
      ? "Cooling down"
      : active
        ? "Ready"
        : "Off";
  const statusClass = active ? "badge live" : "badge";
  const actionButtonText = active ? "Disable Stream Loop" : "Enable Stream Loop";
  const actionButtonClass = active ? "pill danger" : "pill success";
  const durationSummary = cycles.randomized ? streamCycleRandomSummary(durationSeconds, durationRandomMinutes) : durationText(durationSeconds);
  const cooldownSummary = cycles.randomized ? streamCycleRandomSummary(cooldownSeconds, cooldownRandomMinutes) : durationText(cooldownSeconds);
  const randomTooltip = `After the end time of your set stream, Castarro will randomly end the stream within a maximum of ${durationRandomMinutes || "n"} minutes.`;

  return youtubeCollapsibleCard({
    key: `youtube-stream-cycle-${channelName || index}`,
    title: "24/7 Stream Loop",
    helper: "Automatically stop this YouTube stream after a duration, cool down, then start it again.",
    extraClass: "youtube-stream-cycle-card channel-settings",
    attributes: `data-index="${index}" data-channel-name="${escapeAttr(channelName)}"`,
    summaryMetaHtml: `<span class="meta">${escapeHtml(active ? `Every ${durationSummary} with ${cooldownSummary} cooldown` : "Automatic restart loop is off")}</span>`,
    summaryBadgeHtml: `<span class="${statusClass}">${escapeHtml(statusText)}</span>`,
    body: `
      <div class="row wrap">
        <button class="${actionButtonClass}" type="button" onclick="toggleStreamCycleForChannel(${index})">${escapeHtml(actionButtonText)}</button>
      </div>
      <label class="switch stream-cycle-randomize">
        <input type="checkbox" ${cycles.randomized ? "checked" : ""} onchange="updateStreamCycleSetting('randomized', this.checked)">
        <span>Randomize stream and cooldown</span>
        ${streamCycleInfoIcon(randomTooltip)}
      </label>
      <div class="stream-cycle-grid">
        <section>
          <span class="field-hint">Run each stream for</span>
          ${streamCycleHmsInputs("duration", durationHmsParts(durationSeconds), "updateChannelStreamCycleDurationFromParts()")}
        </section>
        <section>
          <span class="field-hint">Cooldown before restart</span>
          ${streamCycleHmsInputs("cooldown", durationHmsParts(cooldownSeconds), "updateStreamCycleCooldownFromParts()")}
        </section>
      </div>
      ${cycles.randomized ? `
        <div class="stream-cycle-random-fields">
          <label>
            <span class="field-hint">Stream random duration</span>
            <input type="number" min="0" step="1" value="${escapeAttr(String(durationRandomMinutes))}" onchange="updateChannelStreamCycleSetting('duration_random_minutes', this.value)">
            <span class="setting-note">minutes after the set stream time</span>
          </label>
          <label>
            <span class="field-hint">Cooldown random duration</span>
            <input type="number" min="0" step="1" value="${escapeAttr(String(cooldownRandomMinutes))}" onchange="updateStreamCycleSetting('restart_delay_random_minutes', this.value)">
            <span class="setting-note">minutes added before restart</span>
          </label>
        </div>
      ` : ""}
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
  const connectBusy = !activeConnected && state.storageConnectBusyProviderId === activeProviderId;
  const actionLabel = activeConnected
    ? (activeBrowser ? "Hide Drive Browser" : "Browse Google Drive")
    : (connectBusy ? "Opening..." : "Connect Google Drive");
  const actionDisabled = !activeProviderId || connectBusy;
  const actionHandler = activeConnected
    ? `toggleCloudBrowser(${index})`
    : `connectStorageProvider('${escapeJs(activeProviderId)}').catch((error) => toast(error.message))`;
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
    autoOpenWhenFocused: false,
    body: `
      <div class="row wrap">
        <button class="pill" type="button" onclick="${actionHandler}" ${actionDisabled ? "disabled" : ""}>${escapeHtml(actionLabel)}</button>
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
  const uploadId = `live-upload-${index}`;
  const importProgress = liveImportProgressForChannel(channel.name || "");
  const importBusy = isLiveImportBusy(channel.name || "");
  const totalDuration = totalVideoDurationSeconds(files);
  const summaryText = files.length ? `${files.length} normalized video${files.length === 1 ? "" : "s"} ready` : "No normalized videos found yet";
  const summaryDuration = totalDuration ? `<span class="video-total-duration" title="Total video duration">${escapeHtml(compactDurationText(totalDuration))}</span>` : "";
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
        summaryMetaHtml: `<span class="meta">${escapeHtml(summaryText)}</span>`,
        summaryBadgeHtml: summaryDuration,
        autoOpenWhenFocused: false,
        body: `
          <div class="row wrap">
            <input class="hidden-file" id="${escapeAttr(uploadId)}" type="file" multiple accept="video/*" onchange="uploadLiveVideos(${index}, this.files).catch((error) => toast(error.message)); this.value = '';">
            <button class="pill" type="button" ${importBusy ? "disabled" : ""} onclick="selectLiveVideos(${index}, '${escapeJs(uploadId)}').catch((error) => toast(error.message))">${escapeHtml(importBusy ? "Importing..." : "Import Videos")}</button>
          </div>
          <div class="meta">Encoded videos appear here automatically. Import videos only for files created outside this app.</div>
          ${importProgress ? liveImportProgressMarkup(importProgress) : ""}
          <div class="file-list live-video-list" data-live-video-list>${fileOptions}</div>
        `,
      })}
      ${cloudVideosSection(channel, index)}
    </div>
  `;
}

function liveVideoOption(file, index, channelName) {
  const path = String(file?.path || "");
  const name = String(file?.name || path.split(/[\\/]/).pop() || path);
  const duration = videoDurationSeconds(file);
  const durationBadge = duration ? `<span class="video-duration-badge">${escapeHtml(compactDurationText(duration))}</span>` : "";
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
      <span class="video-thumb-wrap">
        <img class="video-thumb" src="${escapeAttr(apiRequestUrl(`/api/video-thumbnail?${thumbnailQuery.toString()}`))}" alt="" loading="lazy" onerror="this.classList.add('missing')">
        ${durationBadge}
      </span>
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

function normalizedAdaptiveLiveProfile(profile = {}) {
  const defaults = defaultLiveProfile();
  const adaptive = {
    ...defaults.adaptive,
    ...((profile && typeof profile.adaptive === "object") ? profile.adaptive : {}),
  };
  const defaultVariants = defaults.adaptive.variants;
  const rawVariants = Array.isArray(adaptive.variants) ? adaptive.variants : defaultVariants;
  const variants = rawVariants.map((variant, index) => {
    const fallback = defaultVariants[index] || defaultVariants[defaultVariants.length - 1] || {};
    const height = Number(variant?.height ?? fallback.height ?? 720);
    const id = String(variant?.id || `${height || fallback.height || 720}p`).trim();
    return {
      ...fallback,
      ...(variant || {}),
      id,
      label: String(variant?.label || fallback.label || id).trim() || id,
      width: Number(variant?.width ?? fallback.width ?? 1280),
      height: Number.isFinite(height) ? height : Number(fallback.height || 720),
      video_bitrate: String(variant?.video_bitrate || variant?.bitrate || fallback.video_bitrate || "3500k"),
      audio_bitrate: String(variant?.audio_bitrate || fallback.audio_bitrate || profile.audio_bitrate || "128k"),
      enabled: variant?.enabled !== false,
    };
  });
  const activeIds = new Set(variants.filter((variant) => variant.enabled).map((variant) => variant.id));
  if (!activeIds.has(String(adaptive.active_variant_id || ""))) {
    adaptive.active_variant_id = variants.find((variant) => variant.enabled)?.id || variants[0]?.id || "720p";
  }
  adaptive.variants = variants;
  adaptive.auto_switch = adaptive.auto_switch !== false;
  adaptive.buffer_seconds = Math.min(60, Math.max(10, Number(adaptive.buffer_seconds || 60)));
  adaptive.hls_time = Math.min(10, Math.max(1, Number(adaptive.hls_time || 2)));
  return adaptive;
}

function adaptiveLadderSection(channel, index) {
  const profile = { ...defaultLiveProfile(), ...(channel.live_profile || {}) };
  const mode = ["copy", "transcode", "adaptive"].includes(String(profile.mode || "").toLowerCase())
    ? String(profile.mode || "copy").toLowerCase()
    : "copy";
  const adaptive = normalizedAdaptiveLiveProfile(profile);
  const rows = adaptive.variants.map((variant, variantIndex) => `
    <div class="adaptive-rung" data-adaptive-rung="${variantIndex}">
      <label class="adaptive-rung-check" title="Use ${escapeAttr(variant.label)} in adaptive mode">
        <input type="checkbox" data-adaptive-field="enabled" ${variant.enabled ? "checked" : ""} onchange="syncAdaptiveLadder(${index})">
        <span>${escapeHtml(variant.label)}</span>
      </label>
      <input type="number" min="16" step="2" data-adaptive-field="width" value="${escapeAttr(String(variant.width))}" aria-label="${escapeAttr(variant.label)} width" onchange="syncAdaptiveLadder(${index})">
      <input type="number" min="16" step="2" data-adaptive-field="height" value="${escapeAttr(String(variant.height))}" aria-label="${escapeAttr(variant.label)} height" onchange="syncAdaptiveLadder(${index})">
      <input type="text" data-adaptive-field="video_bitrate" value="${escapeAttr(variant.video_bitrate)}" aria-label="${escapeAttr(variant.label)} video bitrate" onchange="syncAdaptiveLadder(${index})">
      <input type="text" data-adaptive-field="audio_bitrate" value="${escapeAttr(variant.audio_bitrate)}" aria-label="${escapeAttr(variant.label)} audio bitrate" onchange="syncAdaptiveLadder(${index})">
    </div>
  `).join("");
  return `
    <section class="encoder-live-output" data-index="${index}" data-channel-name="${escapeAttr(channel.name || "")}" data-adaptive-card>
      <div class="encoder-subsection-head">
        <div>
          <h3>Live Output</h3>
          <p class="helper">Multiple live resolutions, one-minute backup buffer, and automatic recovery switching.</p>
        </div>
        <span class="badge ${mode === "adaptive" ? "live" : ""}">${escapeHtml(mode === "adaptive" ? "Adaptive" : mode === "transcode" ? "Transcode" : "Copy")}</span>
      </div>
      <div class="adaptive-topline">
        <label>
          Mode
          <select data-live-profile-field="mode" onchange="syncLiveMode(${index}, this.value)">
            ${["copy", "transcode", "adaptive"].map((option) => `<option value="${option}" ${option === mode ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
          </select>
        </label>
        <label class="switch adaptive-switch">
          <input type="checkbox" data-adaptive-setting="auto_switch" ${adaptive.auto_switch ? "checked" : ""} onchange="syncAdaptiveLadder(${index})">
          <span>Auto switch</span>
        </label>
        <label>
          Buffer
          <input type="number" min="10" max="60" step="5" data-adaptive-setting="buffer_seconds" value="${escapeAttr(String(adaptive.buffer_seconds))}" onchange="syncAdaptiveLadder(${index})">
        </label>
      </div>
      <div class="adaptive-ladder-head" aria-hidden="true">
        <span>Rung</span><span>W</span><span>H</span><span>Video</span><span>Audio</span>
      </div>
      <div class="adaptive-ladder" data-adaptive-ladder>
        ${rows}
      </div>
      <div class="meta" data-live-mode-status>${mode === "adaptive" ? "Adaptive mode is enabled for this channel." : mode === "transcode" ? "Transcode mode is enabled for this channel." : "Copy mode is enabled for this channel."}</div>
    </section>
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

function syncRawSelection(index, source = null) {
  const card = normalizeCardForIndex(index, source);
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
    throw new Error("Configure Google Drive in Storage settings first.");
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

async function browseCloudFolder(index, folderId) {
  const providerId = String(state.cloudBrowser.providerId || "").trim();
  if (!providerId) {
    throw new Error("Configure Google Drive in Storage settings first.");
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
  const card = document.querySelector(`#channelSettings [data-adaptive-card][data-index="${index}"]`)
    || document.querySelector(`#channelSettings [data-index="${index}"]`);
  if (!card) return;
  const rawMode = String(modeValue || "copy").toLowerCase();
  const mode = ["copy", "transcode", "adaptive"].includes(rawMode) ? rawMode : "copy";

  card.querySelectorAll("[data-live-mode-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.liveModePanel === mode);
  });
  const modeStatus = card.querySelector("[data-live-mode-status]");
  if (modeStatus) {
    modeStatus.textContent = mode === "adaptive"
      ? "Adaptive mode is enabled for this channel."
      : mode === "transcode"
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

function collectAdaptiveLadderFromCard(card, existingProfile = {}) {
  const adaptive = normalizedAdaptiveLiveProfile(existingProfile);
  card?.querySelectorAll("[data-adaptive-setting]").forEach((input) => {
    const field = input.dataset.adaptiveSetting;
    adaptive[field] = input.type === "checkbox" ? input.checked : coerceValue(input.value, input.type);
  });
  const variants = [];
  card?.querySelectorAll("[data-adaptive-rung]").forEach((row, index) => {
    const existing = adaptive.variants[index] || {};
    const variant = { ...existing };
    row.querySelectorAll("[data-adaptive-field]").forEach((input) => {
      const field = input.dataset.adaptiveField;
      variant[field] = input.type === "checkbox" ? input.checked : coerceValue(input.value, input.type);
    });
    const height = Number(variant.height || existing.height || 720);
    variant.id = String(existing.id || `${height}p`);
    variant.label = String(existing.label || `${height}p`);
    variants.push(variant);
  });
  if (variants.length) adaptive.variants = variants;
  const enabled = adaptive.variants.filter((variant) => variant.enabled !== false);
  if (!enabled.some((variant) => variant.id === adaptive.active_variant_id)) {
    adaptive.active_variant_id = enabled[0]?.id || adaptive.variants[0]?.id || "720p";
  }
  adaptive.buffer_seconds = Math.min(60, Math.max(10, Number(adaptive.buffer_seconds || 60)));
  return adaptive;
}

function syncAdaptiveLadder(index) {
  const config = state.configData || defaultConfigData();
  if (!config.channels?.[index]) return;
  const card = document.querySelector(`#channelSettings [data-adaptive-card][data-index="${index}"]`);
  const liveProfile = {
    ...defaultLiveProfile(),
    ...(config.channels[index].live_profile || {}),
  };
  liveProfile.adaptive = collectAdaptiveLadderFromCard(card, liveProfile);
  config.channels[index].live_profile = liveProfile;
  state.configData = config;
  syncConfigEditor();
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

async function selectRawVideos(index, inputId) {
  const bridge = desktopBridge();
  if (!bridge || typeof bridge.selectVideos !== "function") {
    const input = $(inputId);
    input?.click();
    return;
  }

  const config = collectSettingsData();
  const channel = config.channels[index];
  if (!channel || !channel.name) {
    toast("Save a channel name before adding videos.");
    return;
  }

  const picked = await bridge.selectVideos({
    title: `Add videos to ${channel.name}`,
    defaultPath: resolvedFolderPath(config.defaults?.raw_dir || "Raw Videos") || undefined,
  });
  const paths = Array.isArray(picked?.paths) ? picked.paths.filter(Boolean) : [];
  if (!picked || picked.canceled || !paths.length) return;
  await importRawVideoPaths(index, paths);
}

async function importRawVideoPaths(index, paths) {
  if (!Array.isArray(paths) || !paths.length) return;
  state.activeSettingsChannelIndex = index;
  const config = collectSettingsData();
  const channel = config.channels[index];
  if (!channel || !channel.name) {
    toast("Save a channel name before adding videos.");
    return;
  }

  state.rawUploadBusyChannel = channel.name;
  pauseSettingsRender(60000);
  try {
    await saveConfigData(config, { render: false, refresh: false, reloadFiles: false });
    toast(`Adding ${paths.length} video${paths.length === 1 ? "" : "s"}...`);
    const payload = await api("/api/raw-files/import", {
      method: "POST",
      action: "raw.import",
      body: JSON.stringify({
        config: state.config,
        channel: channel.name,
        paths,
      }),
    });
    const saved = Array.isArray(payload.saved)
      ? payload.saved.map((item) => item?.path || item).filter(Boolean)
      : [];
    state.rawFilesByChannel[channel.name] = payload.files || state.rawFilesByChannel[channel.name] || [];

    const rawFiles = await loadRawFilesForChannel(channel);
    const rawPaths = rawFiles.map((file) => file.path).filter(Boolean);
    const currentPlaylist = Array.isArray(state.configData.channels?.[index]?.raw_playlist)
      ? state.configData.channels[index].raw_playlist
      : [];
    state.configData.channels[index].raw_playlist = Array.from(new Set([...currentPlaylist, ...saved, ...rawPaths]));
    await saveConfigData(state.configData, { render: false, refresh: false, reloadFiles: false });
    toast(`Added ${saved.length} video${saved.length === 1 ? "" : "s"} to ${channel.name}.`);
  } finally {
    state.rawUploadBusyChannel = "";
    state.settingsRenderPausedUntil = 0;
    syncConfigEditor();
    renderSettingsForms();
  }
}

function localPathParent(path) {
  const text = String(path || "");
  const index = Math.max(text.lastIndexOf("\\"), text.lastIndexOf("/"));
  return index >= 0 ? text.slice(0, index) : "";
}

function allPathsShareParent(paths) {
  const parents = (paths || [])
    .map((path) => localPathParent(path).trim().toLowerCase())
    .filter(Boolean);
  return parents.length > 0 && parents.every((parent) => parent === parents[0]);
}

async function selectLiveVideos(index, inputId) {
  const bridge = desktopBridge();
  if (!bridge || typeof bridge.selectVideos !== "function") {
    const input = $(inputId);
    input?.click();
    return;
  }

  const config = collectSettingsData();
  const channel = config.channels[index];
  if (!channel || !channel.name) {
    toast("Save a channel name before importing videos.");
    return;
  }

  const picked = await bridge.selectVideos({
    title: `Import videos for ${channel.name}`,
    defaultPath: resolvedFolderPath(config.defaults?.normalized_dir || "Go Live") || undefined,
  });
  const paths = Array.isArray(picked?.paths) ? picked.paths.filter(Boolean) : [];
  if (!picked || picked.canceled || !paths.length) return;
  await importLiveVideoPaths(index, paths);
}

async function importLiveVideoPaths(index, paths) {
  if (!Array.isArray(paths) || !paths.length) return;
  state.activeSettingsChannelIndex = index;
  const config = collectSettingsData();
  const channel = config.channels[index];
  if (!channel || !channel.name) {
    toast("Save a channel name before importing videos.");
    return;
  }

  const useOriginals = allPathsShareParent(paths);
  const actionLabel = useOriginals ? "Adding" : "Copying";
  const saved = [];
  resetLiveImportControl();
  state.liveUploadBusyChannel = channel.name;
  state.liveImportProgress = {
    channel: channel.name,
    current: 0,
    total: paths.length,
    fileName: String(paths[0] || "").split(/[\\/]/).pop() || String(paths[0] || "video"),
    action: actionLabel,
    paused: false,
    cancelRequested: false,
  };
  pauseSettingsRender(60000);
  renderSettingsForms();
  try {
    await saveConfigData(config, { render: false, refresh: false, reloadFiles: false });

    for (let itemIndex = 0; itemIndex < paths.length; itemIndex += 1) {
      if (liveImportControlState().cancelRequested) break;
      if (!await waitForLiveImportResume()) break;
      const sourcePath = String(paths[itemIndex] || "");
      const fileName = sourcePath.split(/[\\/]/).pop() || sourcePath || "video";
      state.liveImportProgress = {
        channel: channel.name,
        current: itemIndex,
        total: paths.length,
        fileName,
        action: actionLabel,
        paused: Boolean(liveImportControlState().paused),
        cancelRequested: Boolean(liveImportControlState().cancelRequested),
      };
      renderSettingsForms();
      toast(`${actionLabel} ${itemIndex + 1} of ${paths.length}: ${fileName}`);
      if (!await waitForLiveImportResume()) break;
      const payload = await api("/api/normalized-files/import", {
        method: "POST",
        action: "normalized.import",
        body: JSON.stringify({
          config: state.config,
          channel: channel.name,
          paths: [sourcePath],
          useOriginals,
        }),
      });
      const imported = Array.isArray(payload.saved)
        ? payload.saved.map((item) => item?.path || item).filter(Boolean)
        : [];
      saved.push(...imported);
      state.normalizedFilesByChannel[channel.name] = payload.files || state.normalizedFilesByChannel[channel.name] || [];
      if (liveImportControlState().cancelRequested) break;
    }

    await loadNormalizedFilesForChannel(channel);
    const liveFiles = state.normalizedFilesByChannel[channel.name] || [];
    const livePaths = liveFiles.map((file) => file.path).filter(Boolean);
    const currentPlaylist = Array.isArray(state.configData.channels?.[index]?.playlist)
      ? state.configData.channels[index].playlist
      : [];
    state.configData.channels[index].playlist = Array.from(new Set([...currentPlaylist, ...saved, ...livePaths]));
    await saveConfigData(state.configData, { render: false, refresh: false, reloadFiles: false });
    if (liveImportControlState().cancelRequested) {
      toast(`Canceled import for ${channel.name}. ${saved.length} video${saved.length === 1 ? "" : "s"} kept.`);
    } else if (useOriginals) {
      toast(`Added ${saved.length} video${saved.length === 1 ? "" : "s"} from original folder to ${channel.name}.`);
    } else {
      toast(`Copied ${saved.length} video${saved.length === 1 ? "" : "s"} to Go Live / ${channel.name}.`);
    }
  } finally {
    state.liveUploadBusyChannel = "";
    state.liveImportProgress = null;
    resetLiveImportControl();
    state.settingsRenderPausedUntil = 0;
    syncConfigEditor();
    renderSettingsForms();
  }
}

async function uploadRawVideos(index, files) {
  const selectedFiles = Array.from(files || []);
  if (!selectedFiles.length) return;
  state.activeSettingsChannelIndex = index;
  const config = collectSettingsData();
  const channel = config.channels[index];
  if (!channel || !channel.name) {
    toast("Save a channel name before adding videos.");
    return;
  }

  state.rawUploadBusyChannel = channel.name;
  pauseSettingsRender(60000);
  const saved = [];
  try {
    await saveConfigData(config, { render: false, refresh: false, reloadFiles: false });

    for (const file of selectedFiles) {
      toast(`Adding ${file.name}...`);
      const url = `/api/raw-files/upload?config=${encodeURIComponent(state.config)}&channel=${encodeURIComponent(channel.name)}&filename=${encodeURIComponent(file.name)}`;
      const requestUrl = apiRequestUrl(url);
      const requestId = makeRequestId();
      let response;
      try {
        response = await fetch(requestUrl, {
          method: "POST",
          headers: {
            "X-Request-ID": requestId,
            "X-Client-Action": "raw.upload",
          },
          body: file,
        });
      } catch (error) {
        throw new Error(`Raw video "${file.name}" failed to fetch for ${channel.name}. Request: ${url}. Browser/network error: ${String(error?.message || error)}. Request ID: ${requestId}.`);
      }
      const responseRequestId = String(response.headers.get("X-Request-ID") || requestId);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`Raw video upload failed for "${file.name}" on ${channel.name}. Server response: ${payload.error || "Upload failed."}. Request ID: ${responseRequestId}.`);
      }
      if (payload.saved?.path) {
        saved.push(payload.saved.path);
      } else if (payload.saved) {
        saved.push(payload.saved);
      }
      state.rawFilesByChannel[channel.name] = payload.files || state.rawFilesByChannel[channel.name] || [];
    }

    const rawFiles = await loadRawFilesForChannel(channel);
    const rawPaths = rawFiles.map((file) => file.path).filter(Boolean);
    const currentPlaylist = Array.isArray(state.configData.channels?.[index]?.raw_playlist)
      ? state.configData.channels[index].raw_playlist
      : [];
    state.configData.channels[index].raw_playlist = Array.from(new Set([...currentPlaylist, ...saved, ...rawPaths]));
    await saveConfigData(state.configData, { render: false, refresh: false, reloadFiles: false });
    toast(`Added ${saved.length} video${saved.length === 1 ? "" : "s"} to ${channel.name}.`);
  } finally {
    state.rawUploadBusyChannel = "";
    state.settingsRenderPausedUntil = 0;
    syncConfigEditor();
    renderSettingsForms();
  }
}

async function uploadLiveVideos(index, files) {
  const selectedFiles = Array.from(files || []);
  if (!selectedFiles.length) return;
  state.activeSettingsChannelIndex = index;
  const config = collectSettingsData();
  const channel = config.channels[index];
  if (!channel || !channel.name) {
    toast("Save a channel name before importing videos.");
    return;
  }

  resetLiveImportControl();
  state.liveUploadBusyChannel = channel.name;
  state.liveImportProgress = {
    channel: channel.name,
    current: 0,
    total: selectedFiles.length,
    fileName: selectedFiles[0]?.name || "video",
    action: "Copying",
    paused: false,
    cancelRequested: false,
  };
  pauseSettingsRender(60000);
  renderSettingsForms();
  const saved = [];
  try {
    await saveConfigData(config, { render: false, refresh: false, reloadFiles: false });

    for (let itemIndex = 0; itemIndex < selectedFiles.length; itemIndex += 1) {
      if (liveImportControlState().cancelRequested) break;
      if (!await waitForLiveImportResume()) break;
      const file = selectedFiles[itemIndex];
      state.liveImportProgress = {
        channel: channel.name,
        current: itemIndex,
        total: selectedFiles.length,
        fileName: file.name,
        action: "Copying",
        paused: Boolean(liveImportControlState().paused),
        cancelRequested: Boolean(liveImportControlState().cancelRequested),
      };
      renderSettingsForms();
      toast(`Copying ${itemIndex + 1} of ${selectedFiles.length}: ${file.name}`);
      if (!await waitForLiveImportResume()) break;
      const url = `/api/normalized-files/upload?config=${encodeURIComponent(state.config)}&channel=${encodeURIComponent(channel.name)}&filename=${encodeURIComponent(file.name)}`;
      const requestUrl = apiRequestUrl(url);
      const requestId = makeRequestId();
      let response;
      try {
        response = await fetch(requestUrl, {
          method: "POST",
          headers: {
            "X-Request-ID": requestId,
            "X-Client-Action": "normalized.upload",
          },
          body: file,
        });
      } catch (error) {
        throw new Error(`Live video "${file.name}" failed to fetch for ${channel.name}. Request: ${url}. Browser/network error: ${String(error?.message || error)}. Request ID: ${requestId}.`);
      }
      const responseRequestId = String(response.headers.get("X-Request-ID") || requestId);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`Live video import failed for "${file.name}" on ${channel.name}. Server response: ${payload.error || "Import failed."}. Request ID: ${responseRequestId}.`);
      }
      if (payload.saved?.path) {
        saved.push(payload.saved.path);
      }
      state.normalizedFilesByChannel[channel.name] = payload.files || state.normalizedFilesByChannel[channel.name] || [];
      if (liveImportControlState().cancelRequested) break;
    }

    await loadNormalizedFilesForChannel(channel);
    const liveFiles = state.normalizedFilesByChannel[channel.name] || [];
    const livePaths = liveFiles.map((file) => file.path).filter(Boolean);
    const currentPlaylist = Array.isArray(state.configData.channels?.[index]?.playlist)
      ? state.configData.channels[index].playlist
      : [];
    state.configData.channels[index].playlist = Array.from(new Set([...currentPlaylist, ...saved, ...livePaths]));
    await saveConfigData(state.configData, { render: false, refresh: false, reloadFiles: false });
    if (liveImportControlState().cancelRequested) {
      toast(`Canceled import for ${channel.name}. ${saved.length} video${saved.length === 1 ? "" : "s"} kept.`);
    } else {
      toast(`Copied ${saved.length} video${saved.length === 1 ? "" : "s"} to Go Live / ${channel.name}.`);
    }
  } finally {
    state.liveUploadBusyChannel = "";
    state.liveImportProgress = null;
    resetLiveImportControl();
    state.settingsRenderPausedUntil = 0;
    syncConfigEditor();
    renderSettingsForms();
  }
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
      adaptive: normalizedAdaptiveLiveProfile(existingChannel.live_profile || {}),
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

    channel.live_profile = {
      ...defaultLiveProfile(),
      ...(existingChannel.live_profile || {}),
      adaptive: normalizedAdaptiveLiveProfile(existingChannel.live_profile || {}),
    };
    card.querySelectorAll("[data-live-profile-field]").forEach((input) => {
      channel.live_profile[input.dataset.liveProfileField] = coerceValue(input.value, input.type);
    });
    const mode = String(channel.live_profile.mode || "copy").toLowerCase();
    channel.live_profile.mode = ["copy", "transcode", "adaptive"].includes(mode) ? mode : "copy";
    const adaptiveCard = document.querySelector(`#channelSettings [data-adaptive-card][data-index="${index}"]`);
    if (adaptiveCard) {
      channel.live_profile.adaptive = collectAdaptiveLadderFromCard(adaptiveCard, channel.live_profile);
    }

    const normalizeCard = normalizeCardForIndex(index, card);
    const checkedRawFiles = normalizeCard
      ? Array.from(normalizeCard.querySelectorAll("[data-raw-file]:checked")).map((input) => input.dataset.rawFile)
      : [];
    const rawFileInputs = normalizeCard ? normalizeCard.querySelectorAll("[data-raw-file]") : [];
    const existingRawPlaylist = Array.isArray(config.channels?.[index]?.raw_playlist)
      ? config.channels[index].raw_playlist
      : [];
    channel.raw_playlist = rawFileInputs.length ? checkedRawFiles : existingRawPlaylist;

    channel.normalize_profile = { ...(existingChannel.normalize_profile || {}) };
    normalizeCard?.querySelectorAll(`[data-normalize-index="${index}"]`).forEach((input) => {
      channel.normalize_profile[input.dataset.normalizeField] = coerceValue(input.value, input.type);
    });
    channel.normalize_profile.x264_profile = config.normalize_profile?.x264_profile || "high";

    const liveVideoCard = liveVideosCardForIndex(index);
    const orderedLiveFiles = liveVideoPathsFromCard(liveVideoCard);
    const checkedLiveFiles = Array.from(
      document.querySelectorAll(`#channelSettings [data-index="${index}"] [data-live-file]:checked`)
    ).map((input) => input.dataset.liveFile);
    const liveFileInputs = document.querySelectorAll(`#channelSettings [data-index="${index}"] [data-live-file]`);
    const existingPlaylist = Array.isArray(config.channels?.[index]?.playlist)
      ? config.channels[index].playlist
      : [];
    channel.playlist = liveVideoCard ? orderedLiveFiles : liveFileInputs.length ? checkedLiveFiles : existingPlaylist;
    channel.cloud_playlist = Array.isArray(existingChannel.cloud_playlist) ? existingChannel.cloud_playlist : [];
    channel.youtube_broadcast_id = String(existingChannel.youtube_broadcast_id || "");
    channel.youtube_stream_id = String(existingChannel.youtube_stream_id || "");
    channel.youtube_account_id = normalizeAccountId(channel.youtube_account_id || existingChannel.youtube_account_id || "");
    if (
      typeof existingChannel.stream_key_env === "string"
      && !channel.stream_key_env
      && !isGeneratedStreamKeyEnv(existingChannel.stream_key_env)
    ) {
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
    if (typeof channel.youtube_dual_stream !== "boolean") {
      channel.youtube_dual_stream = typeof existingChannel.youtube_dual_stream === "boolean"
        ? existingChannel.youtube_dual_stream
        : true;
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
    if (typeof channel.youtube_dual_stream !== "boolean") {
      channel.youtube_dual_stream = true;
    }
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
    "[data-adaptive-setting]",
    "[data-adaptive-field]",
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
  openWorkspaceChannelCreate();
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
    toast(`Removed ${removed.name}. Use Undo in YouTube to restore it.`);
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
  showSettingsTab("youtube");
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
  if (action === "renditions") {
    syncAdaptiveLadder(index);
  }
  const data = collectSettingsData();
  const channel = data.channels?.[index];
  if (!channel?.name) {
    toast("Save a channel name before running this task.");
    return;
  }

  state.activeSettingsChannelIndex = index;
  let selectedOutputFolder = "";
  if (action === "normalize" && chooseOutputFolder) {
    const outputFolder = await chooseEncodeOutputFolder(data);
    if (!outputFolder) {
      toast("Encoding canceled.");
      return;
    }
    selectedOutputFolder = outputFolder;
    data.defaults = data.defaults || {};
    data.defaults.normalized_dir = outputFolder;
    state.configData = data;
    syncConfigEditor();
  }
  await saveConfigData(data);
  if (selectedOutputFolder) {
    toast(`Encoding will save inside ${selectedOutputFolder}\\${channel.name}.`);
  }
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
  if (isLiveImportBusy(channel || "")) {
    const busyChannel = state.liveUploadBusyChannel || "the selected channel";
    toast(`Wait for video import to finish for ${busyChannel}.`);
    return;
  }
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
      .find((entry) => entry[1] === state.settingsTab)?.[0] || "youtube");
  }
  if (tab === "settings") {
    syncActiveSettingsChannelFromWorkspace(true);
  }
  applyLegacyTabView(tab);
  renderChannelTools();
  cacheDesktopStartupView(`tab-${tab}`, 900);
}

function showSettingsTab(tab) {
  tab = tab === "live" || tab === "normalize" ? "youtube" : tab;
  state.settingsTab = tab;
  const route = Object.entries(routeToSettingsTab).find((entry) => entry[1] === tab)?.[0];
  if (route) {
    state.workspace.activeRoute = route;
  }
  applyLegacyTabView("settings");
  applySettingsSection(tab);
  renderChannelTools();
  cacheDesktopStartupView(`settings-${tab}`, 900);
  if (tab === "liveHistory") {
    renderSettingsLiveHistory();
    fetchSettingsLiveHistory().catch((error) => toast(error.message));
  }
  if (tab === "youtube") {
    refreshActiveRawFiles({ force: true }).catch((error) => toast(error.message));
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
  const panel = $("workspaceSyncPanel");
  if (!panel) return;
  panel.style.display = "none";
  return;
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

function findStreamCycleChannelEntry(config, channelName) {
  const cycles = { ...defaultStreamCycleSettings(), ...(config?.stream_cycles || {}) };
  const channels = Array.isArray(cycles.channels) ? cycles.channels : [];
  return channels.find((item) => String(item?.channel || "").trim() === String(channelName || "").trim()) || null;
}

function streamCycleEntryDurationSeconds(entry) {
  const rawSeconds = Number(entry?.duration_seconds);
  if (Number.isFinite(rawSeconds) && rawSeconds > 0) {
    return Math.max(1, Math.round(rawSeconds));
  }
  const rawMinutes = Number(entry?.duration_minutes);
  if (Number.isFinite(rawMinutes) && rawMinutes > 0) {
    return Math.max(1, Math.round(rawMinutes * 60));
  }
  return 12 * 60 * 60;
}

function streamCycleRandomMinutes(source, field, fallbackSeconds = 0) {
  if (Number.isFinite(Number(source?.[field]))) {
    return Math.max(0, Math.round(Number(source[field]) || 0));
  }
  return Math.max(0, Math.round((Number(fallbackSeconds) || 0) / 60));
}

function streamCycleRandomSummary(baseSeconds, randomMinutes) {
  const baseText = durationText(baseSeconds);
  const minutes = Math.max(0, Math.round(Number(randomMinutes) || 0));
  if (!minutes) return baseText;
  return `${baseText} + up to ${minutes}m`;
}

function streamCycleInfoIcon(text) {
  return `<span class="stream-cycle-info" aria-label="${escapeAttr(text)}" title="${escapeAttr(text)}">i</span>`;
}

function streamCycleHmsInputs(kind, parts, onChange, disabled = false) {
  const safeParts = {
    hours: Math.max(0, Math.floor(Number(parts?.hours) || 0)),
    minutes: Math.max(0, Math.floor(Number(parts?.minutes) || 0)),
    seconds: Math.max(0, Math.floor(Number(parts?.seconds) || 0)),
  };
  const fields = [
    { part: "hours", label: "H", title: "Hours", value: safeParts.hours },
    { part: "minutes", label: "M", title: "Minutes", value: safeParts.minutes },
    { part: "seconds", label: "S", title: "Seconds", value: safeParts.seconds },
  ];
  return `
    <div class="stream-cycle-hms" data-stream-cycle-group="${escapeAttr(kind)}">
      ${fields.map((field) => `
        <label title="${escapeAttr(field.title)}">
          <span>${escapeHtml(field.label)}</span>
          <input type="number" min="0" ${field.part === "hours" ? "" : "max=\"59\""} step="1" value="${escapeAttr(String(field.value))}" data-stream-cycle-kind="${escapeAttr(kind)}" data-stream-cycle-part="${escapeAttr(field.part)}" onchange="${escapeAttr(onChange)}" ${disabled ? "disabled" : ""}>
        </label>
      `).join("")}
    </div>
  `;
}

function readStreamCycleHmsSeconds(kind, fallbackSeconds = 0) {
  const values = { hours: 0, minutes: 0, seconds: 0 };
  document.querySelectorAll("[data-stream-cycle-kind][data-stream-cycle-part]").forEach((input) => {
    if (input.dataset.streamCycleKind !== kind) return;
    const part = input.dataset.streamCyclePart;
    if (!(part in values)) return;
    const number = Math.max(0, Math.floor(Number(input.value) || 0));
    values[part] = number;
  });
  const total = (values.hours * 3600) + (values.minutes * 60) + values.seconds;
  return total > 0 ? total : Math.max(0, Math.round(Number(fallbackSeconds) || 0));
}

function renderStreamCycleSettingsPanels() {
  renderYoutubeSettingsPanel(state.configData || defaultConfigData());
  renderAutomationSettingsPanel(state.configData || defaultConfigData());
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

function ensureStreamCycleChannelEntry(config, channelName) {
  const cycles = config.stream_cycles = {
    ...defaultStreamCycleSettings(),
    ...(config.stream_cycles || {}),
    channels: Array.isArray(config?.stream_cycles?.channels) ? [...config.stream_cycles.channels] : [],
  };
  let entry = cycles.channels.find((item) => String(item?.channel || "").trim() === String(channelName || "").trim());
  if (!entry) {
    entry = {
      channel: channelName,
      enabled: false,
      duration_seconds: 12 * 60 * 60,
      duration_random_minutes: 0,
    };
    cycles.channels.push(entry);
  }
  entry.duration_seconds = streamCycleEntryDurationSeconds(entry);
  if (!Number.isFinite(Number(entry.duration_random_minutes))) {
    const previousMax = Number(entry.duration_max_seconds);
    entry.duration_random_minutes = Number.isFinite(previousMax) ? Math.max(0, Math.round((previousMax - entry.duration_seconds) / 60)) : 0;
  }
  entry.duration_random_minutes = Math.max(0, Math.round(Number(entry.duration_random_minutes) || 0));
  return entry;
}

function updateAlertToggle(key, value) {
  normalizeConfigShape();
  const alerts = state.configData.alerts = {
    ...defaultAlertSettings(),
    ...(state.configData.alerts || {}),
    notification_mode: normalizeNotificationMode(state.configData.alerts?.notification_mode),
    rules: {
      ...defaultAlertSettings().rules,
      ...((state.configData.alerts && state.configData.alerts.rules) || {}),
    },
  };
  if (key.startsWith("rules.")) {
    alerts.rules[key.slice(6)] = Boolean(value);
  } else if (key === "notification_mode") {
    alerts.notification_mode = normalizeNotificationMode(value);
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

function updateStreamCycleSetting(key, value) {
  normalizeConfigShape();
  const cycles = state.configData.stream_cycles = {
    ...defaultStreamCycleSettings(),
    ...(state.configData.stream_cycles || {}),
    channels: Array.isArray(state.configData?.stream_cycles?.channels) ? [...state.configData.stream_cycles.channels] : [],
  };
  if (key === "enabled") {
    cycles.enabled = Boolean(value);
  } else if (key === "restart_delay_seconds") {
    cycles.restart_delay_seconds = Math.max(0, Number(value) || 0);
  } else if (key === "randomized") {
    cycles.randomized = Boolean(value);
  } else if (key === "restart_delay_random_minutes") {
    cycles.restart_delay_random_minutes = Math.max(0, Math.round(Number(value) || 0));
  }
  renderStreamCycleSettingsPanels();
  scheduleSettingsAutosave(200);
}

function updateStreamCycleCooldownFromParts() {
  const seconds = readStreamCycleHmsSeconds("cooldown", 180);
  updateStreamCycleSetting("restart_delay_seconds", seconds);
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

function updateChannelStreamCycleSetting(field, value) {
  normalizeConfigShape();
  const channelName = selectedSchedulerChannelName(state.configData);
  if (!channelName) return;
  const entry = ensureStreamCycleChannelEntry(state.configData, channelName);
  if (field === "enabled") {
    entry.enabled = Boolean(value);
  } else if (field === "duration_hours") {
    const hours = Math.max(1 / 60, Number(value) || 12);
    entry.duration_seconds = Math.round(hours * 60 * 60);
  } else if (field === "duration_seconds") {
    entry.duration_seconds = Math.max(1, Math.round(Number(value) || 1));
  } else if (field === "duration_random_minutes") {
    entry.duration_random_minutes = Math.max(0, Math.round(Number(value) || 0));
  }
  renderStreamCycleSettingsPanels();
  scheduleSettingsAutosave(200);
}

function updateChannelStreamCycleDurationFromParts() {
  const seconds = readStreamCycleHmsSeconds("duration", 12 * 60 * 60);
  updateChannelStreamCycleSetting("duration_seconds", seconds);
}

function toggleStreamCycleForChannel(index) {
  normalizeConfigShape();
  const config = state.configData || defaultConfigData();
  const channel = config.channels?.[index];
  const channelName = String(channel?.name || "").trim();
  if (!channelName) {
    toast("Select a channel first.");
    return;
  }
  const entry = ensureStreamCycleChannelEntry(config, channelName);
  const cycles = config.stream_cycles;
  const nextEnabled = !(cycles.enabled && entry.enabled);
  entry.enabled = nextEnabled;
  if (nextEnabled) {
    cycles.enabled = true;
  } else if (!cycles.channels.some((item) => item?.enabled)) {
    cycles.enabled = false;
  }
  state.configData = config;
  syncConfigEditor();
  renderStreamCycleSettingsPanels();
  scheduleSettingsAutosave(200);
  toast(nextEnabled ? "Stream loop enabled for this channel." : "Stream loop disabled for this channel.");
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
  if (state.workspace.alertsMenuOpen) {
    markWorkspaceAlertsRead(workspaceRecentAlerts(state.status));
  }
  rerenderWorkspaceHeader();
}

function toggleWorkspaceAlertItem(id, event) {
  if (event && typeof event.stopPropagation === "function") {
    event.stopPropagation();
  }
  const key = String(id || "").trim();
  if (!key) return;
  const expanded = !state.workspace.expandedAlertIds?.[key];
  state.workspace.expandedAlertIds = {
    ...(state.workspace.expandedAlertIds || {}),
    [key]: expanded,
  };
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

function alertAllowedByNotificationMode(mode, alert) {
  const normalized = normalizeNotificationMode(mode);
  if (normalized === "off") return false;
  if (normalized === "critical") return String(alert?.severity || "").toLowerCase() === "danger";
  return true;
}

function rememberDeliveredAlertIds(nextIds) {
  state.deliveredAlertIds = Array.from(new Set([...(state.deliveredAlertIds || []), ...nextIds])).slice(-40);
}

function deliverDesktopAlerts(payload = state.status) {
  const alerts = payload?.alerts || {};
  const recent = Array.isArray(alerts.recent) ? alerts.recent : [];
  const enabled = alerts.desktop_notifications_enabled !== false;
  if (!enabled || !recent.length) return;
  const notificationMode = normalizeNotificationMode(alerts.notification_mode);
  const seen = new Set(state.deliveredAlertIds || []);
  const fresh = recent
    .filter((item) => item?.desktop_enabled !== false && alertAllowedByNotificationMode(notificationMode, item) && !seen.has(Number(item?.id || 0)))
    .sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));
  if (!fresh.length) return;
  rememberDeliveredAlertIds(fresh.map((item) => Number(item?.id || 0)));
  fresh.forEach((item) => {
    showDesktopAlertNotification(item).catch(() => {});
  });
}

function localNotificationTitle(message) {
  const text = String(message || "").trim();
  if (!text) return "Notification";
  if (/failed to fetch/i.test(text)) return compactAlertTitle({ title: "", message: text });
  if (/autosave failed/i.test(text)) return "Settings autosave failed";
  if (/failed/i.test(text)) return text.split(":")[0].slice(0, 88) || "Action failed";
  if (/update/i.test(text)) return "Update";
  return text.split(/[.!?]\s/)[0].replace(/\.$/, "").slice(0, 88) || "Notification";
}

function renderAutomationSettingsPanel(config = state.configData || defaultConfigData()) {
  const container = $("automationSettingsPanel");
  if (!container) return;
  const alerts = {
    ...defaultAlertSettings(),
    ...(config.alerts || {}),
    notification_mode: normalizeNotificationMode(config.alerts?.notification_mode),
    rules: {
      ...defaultAlertSettings().rules,
      ...((config.alerts && config.alerts.rules) || {}),
    },
  };
  const scheduler = {
    ...defaultSchedulerSettings(),
    ...(config.scheduler || {}),
  };
  const cycles = {
    ...defaultStreamCycleSettings(),
    ...(config.stream_cycles || {}),
  };
  const channelName = selectedSchedulerChannelName(config);
  const channelEntry = findSchedulerChannelEntry(config, channelName) || {
    channel: channelName,
    enabled: false,
    start_time: "09:00",
    stop_time: "17:00",
    days: [...SCHEDULE_DAYS],
  };
  const cycleEntry = findStreamCycleChannelEntry(config, channelName) || {
    channel: channelName,
    enabled: false,
    duration_seconds: 12 * 60 * 60,
  };
  const cycleDurationSeconds = streamCycleEntryDurationSeconds(cycleEntry);
  const cycleDurationHours = Math.round((cycleDurationSeconds / 3600) * 100) / 100;
  const rawCycleCooldownSeconds = Number(cycles.restart_delay_seconds ?? 180);
  const cycleCooldownSeconds = Number.isFinite(rawCycleCooldownSeconds) ? Math.max(0, Math.round(rawCycleCooldownSeconds)) : 180;
  const cycleDurationRandomFallback = Math.max(0, Number(cycleEntry.duration_max_seconds) - cycleDurationSeconds);
  const cycleCooldownRandomFallback = Math.max(0, Number(cycles.restart_delay_max_seconds) - cycleCooldownSeconds);
  const cycleDurationRandomMinutes = streamCycleRandomMinutes(cycleEntry, "duration_random_minutes", cycleDurationRandomFallback);
  const cycleCooldownRandomMinutes = streamCycleRandomMinutes(cycles, "restart_delay_random_minutes", cycleCooldownRandomFallback);
  const cycleRandomTooltip = `After the end time of your set stream, Castarro will randomly end the stream within a maximum of ${cycleDurationRandomMinutes || "n"} minutes.`;
  const schedulerStatus = Array.isArray(state.status?.scheduler?.channels)
    ? state.status.scheduler.channels.find((item) => String(item?.channel || "") === channelName)
    : null;
  const cycleStatus = Array.isArray(state.status?.stream_cycles?.channels)
    ? state.status.stream_cycles.channels.find((item) => String(item?.channel || "") === channelName)
    : null;
  container.innerHTML = `
    <div class="automation-grid">
      <section class="automation-card">
        <div>
          <h3>Alerts and notifications</h3>
          <p class="helper">Choose which major events should surface on desktop and paired phones.</p>
        </div>
        <div class="automation-toggle-grid">
          <div class="automation-toggle automation-toggle-wide">
            <label for="notificationMode">Notification delivery</label>
            <select id="notificationMode" onchange="updateAlertToggle('notification_mode', this.value)">
              <option value="all" ${alerts.notification_mode === "all" ? "selected" : ""}>All enabled alerts</option>
              <option value="critical" ${alerts.notification_mode === "critical" ? "selected" : ""}>Critical only</option>
              <option value="off" ${alerts.notification_mode === "off" ? "selected" : ""}>Off</option>
            </select>
            <span class="helper">Controls desktop and paired-phone notifications while keeping in-app history available.</span>
          </div>
          <div class="automation-toggle">
            <label><input type="checkbox" ${alerts.desktop_notifications_enabled ? "checked" : ""} onchange="updateAlertToggle('desktop_notifications_enabled', this.checked)"> Desktop system notifications</label>
            <span class="helper">Uses the desktop shell to surface critical stream alerts outside the app window.</span>
          </div>
          <div class="automation-toggle hidden">
            <label><input type="checkbox" disabled> Mobile remote notifications</label>
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
      <section class="automation-card">
        <div>
          <h3>Stream cycle restart</h3>
          <p class="helper">End a running stream after a fixed duration, then start a fresh FFmpeg session in a loop.</p>
        </div>
        <div class="schedule-grid">
          <label>
            <span class="field-hint">Enable cycle restart</span>
            <input type="checkbox" ${cycles.enabled ? "checked" : ""} onchange="updateStreamCycleSetting('enabled', this.checked)">
          </label>
          <label>
            <span class="field-hint">Cooldown seconds</span>
            <input type="number" min="0" step="30" value="${escapeAttr(String(cycleCooldownSeconds))}" onchange="updateStreamCycleSetting('restart_delay_seconds', this.value)">
          </label>
          <div>
            <span class="field-hint">Status</span>
            <div>${escapeHtml(cycleStatus?.phase || "idle")}</div>
          </div>
        </div>
        ${channelName ? `
          <div class="automation-toggle">
            <strong>${escapeHtml(channelName)}</strong>
            <span class="helper">${cycleStatus?.running ? `${escapeHtml(durationText(cycleStatus.elapsed_seconds || 0))} elapsed.` : "Not currently running."} ${cycleStatus?.next_cycle_at ? `Next cycle ${escapeHtml(formatDateTime(cycleStatus.next_cycle_at))}.` : ""} ${cycleStatus?.remaining_seconds ? `${escapeHtml(durationText(cycleStatus.remaining_seconds))} remaining.` : ""}</span>
          </div>
          <div class="schedule-grid">
            <label>
              <span class="field-hint">Enable for channel</span>
              <input type="checkbox" ${cycleEntry.enabled ? "checked" : ""} onchange="updateChannelStreamCycleSetting('enabled', this.checked)">
            </label>
            <label>
              <span class="field-hint">Duration hours</span>
              <input type="number" min="0.02" step="0.25" value="${escapeAttr(String(cycleDurationHours))}" onchange="updateChannelStreamCycleSetting('duration_hours', this.value)">
            </label>
            <div>
              <span class="field-hint">Configured duration</span>
              <div>${escapeHtml(cycles.randomized ? streamCycleRandomSummary(cycleDurationSeconds, cycleDurationRandomMinutes) : durationText(cycleDurationSeconds))}</div>
            </div>
          </div>
          <label class="switch stream-cycle-randomize">
            <input type="checkbox" ${cycles.randomized ? "checked" : ""} onchange="updateStreamCycleSetting('randomized', this.checked)">
            <span>Randomize stream and cooldown</span>
            ${streamCycleInfoIcon(cycleRandomTooltip)}
          </label>
          ${cycles.randomized ? `
            <div class="stream-cycle-random-fields">
              <label>
                <span class="field-hint">Stream random duration</span>
                <input type="number" min="0" step="1" value="${escapeAttr(String(cycleDurationRandomMinutes))}" onchange="updateChannelStreamCycleSetting('duration_random_minutes', this.value)">
                <span class="setting-note">minutes after the set stream time</span>
              </label>
              <label>
                <span class="field-hint">Cooldown random duration</span>
                <input type="number" min="0" step="1" value="${escapeAttr(String(cycleCooldownRandomMinutes))}" onchange="updateStreamCycleSetting('restart_delay_random_minutes', this.value)">
                <span class="setting-note">minutes added before restart</span>
              </label>
            </div>
          ` : ""}
        ` : `<p class="helper">Create or select a channel to configure cycle restarts.</p>`}
      </section>
    </div>
  `;
}

function setTransferPackageStatus(message = "", tone = "") {
  const node = $("transferPackageStatus");
  if (!node) return;
  const text = String(message || "").trim();
  node.className = `notice transfer-package-status${tone ? ` ${tone}` : ""}${text ? "" : " hidden"}`;
  node.innerHTML = text;
}

function updateTransferButtons() {
  const exporting = state.transferBusy === "export";
  const importing = state.transferBusy === "import";
  const exportButton = $("exportTransferPackage");
  const importButton = $("importTransferPackage");
  if (exportButton) {
    exportButton.disabled = Boolean(state.transferBusy);
    exportButton.textContent = exporting ? "Creating..." : "Create Package";
  }
  if (importButton) {
    importButton.disabled = Boolean(state.transferBusy);
    importButton.textContent = importing ? "Importing..." : "Import Package";
  }
}

async function pickTransferFolder(title, fallbackMessage) {
  const bridge = desktopBridge();
  if (bridge && typeof bridge.selectFolder === "function") {
    const picked = await bridge.selectFolder({ title });
    if (picked?.canceled || !picked?.path) return "";
    return String(picked.path || "");
  }

  const value = window.prompt(fallbackMessage || `${title}\n\nPaste the full folder path:`, "");
  return String(value || "").trim();
}

async function exportTransferPackage() {
  if (state.transferBusy) return;
  const destination = await pickTransferFolder(
    "Choose where to create the Castarro transfer package",
    "Desktop folder picker is not available in this browser window.\n\nPaste the full folder path where Castarro should create the package:"
  );
  if (!destination) return;
  state.transferBusy = "export";
  updateTransferButtons();
  setTransferPackageStatus("Creating transfer package. Large video folders can take a while.");
  try {
    await flushSettingsAutosave();
    const payload = await api("/api/transfer/export", {
      method: "POST",
      action: "transfer.export",
      body: JSON.stringify({
        config: state.config,
        destination,
      }),
    });
    setTransferPackageStatus(`
      <strong>Package created.</strong>
      <div>${escapeHtml(payload.fileCount || 0)} files, ${escapeHtml(formatBytes(payload.totalBytes || 0))}</div>
      <div><span class="field-hint">Folder</span> ${escapeHtml(payload.packagePath || "")}</div>
    `);
    toast("Transfer package created.");
  } catch (error) {
    setTransferPackageStatus(`<strong>Package export failed.</strong><div>${escapeHtml(error.message || String(error))}</div>`, "warn");
    throw error;
  } finally {
    state.transferBusy = "";
    updateTransferButtons();
  }
}

async function importTransferPackage() {
  if (state.transferBusy) return;
  const packagePath = await pickTransferFolder(
    "Select a Castarro transfer package folder",
    "Desktop folder picker is not available in this browser window.\n\nPaste the full path to the Castarro transfer package folder:"
  );
  if (!packagePath) return;
  const confirmed = window.confirm(
    "Import this Castarro transfer package now?\n\nCurrent channels, settings, videos, tokens, and history on this PC will be backed up first, then replaced by the package."
  );
  if (!confirmed) return;

  state.transferBusy = "import";
  updateTransferButtons();
  setTransferPackageStatus("Importing transfer package. Keep Castarro open until this finishes.");
  try {
    const payload = await api("/api/transfer/import", {
      method: "POST",
      action: "transfer.import",
      body: JSON.stringify({
        config: state.config,
        packagePath,
      }),
    });
    state.configData = null;
    state.rawFilesByChannel = {};
    state.normalizedFilesByChannel = {};
    state.youtubeStatus = null;
    state.storageStatus = null;
    hydrateYoutubeStatusFromCache(true);
    await refresh();
    await loadConfigText();
    setTransferPackageStatus(`
      <strong>Package imported.</strong>
      <div>${escapeHtml(payload.fileCount || 0)} files, ${escapeHtml(formatBytes(payload.totalBytes || 0))}</div>
      <div><span class="field-hint">Imported</span> ${escapeHtml((payload.imported || []).join(", ") || "data")}</div>
      <div><span class="field-hint">Backup</span> ${escapeHtml(payload.backupPath || "")}</div>
    `);
    toast("Transfer package imported.");
  } catch (error) {
    setTransferPackageStatus(`<strong>Package import failed.</strong><div>${escapeHtml(error.message || String(error))}</div>`, "warn");
    throw error;
  } finally {
    state.transferBusy = "";
    updateTransferButtons();
  }
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
  const margin = uiMasterNumber("--component-qr-margin", 10);
  const moduleSize = Math.floor((size - margin * 2) / count);
  const qrSize = moduleSize * count;
  const offset = Math.floor((size - qrSize) / 2);
  context.fillStyle = uiMasterValue("--component-qr-background", "Canvas");
  context.fillRect(0, 0, size, size);
  context.fillStyle = uiMasterValue("--component-qr-foreground", "CanvasText");
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        context.fillRect(offset + col * moduleSize, offset + row * moduleSize, moduleSize, moduleSize);
      }
    }
  }
}

function toast(message) {
  const text = String(message || "").trim();
  if (!text) return;
  state.localNotifications = [
    {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: localNotificationTitle(text),
      message: text,
      detail: text,
      severity: "info",
      created_at: new Date().toISOString(),
      local: true,
    },
    ...(state.localNotifications || []),
  ].slice(0, 20);
  rerenderWorkspaceHeader();
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

function formatLiveChatClockTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).toLowerCase();
}

$("tabControl").addEventListener("click", () => showTab("control"));
$("tabSettings").addEventListener("click", () => showTab("settings"));
if ($("settingsNormalizeTab")) {
  $("settingsNormalizeTab").addEventListener("click", () => showSettingsTab("normalize"));
}
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
if ($("settingsTransferTab")) {
  $("settingsTransferTab").addEventListener("click", () => showSettingsTab("transfer"));
}
if ($("exportTransferPackage")) {
  $("exportTransferPackage").addEventListener("click", () => exportTransferPackage().catch((error) => toast(error.message)));
}
if ($("importTransferPackage")) {
  $("importTransferPackage").addEventListener("click", () => importTransferPackage().catch((error) => toast(error.message)));
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
document.addEventListener("selectionchange", () => {
  window.setTimeout(renderDeferredRefreshAfterSelectionClears, 0);
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
  refreshYoutubeConnectionAfterReturn().catch((error) => toast(error.message));
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshActiveRawFiles().catch((error) => toast(error.message));
    refreshYoutubeConnectionAfterReturn().catch((error) => toast(error.message));
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
if ($("firstRunAddChannel")) {
  $("firstRunAddChannel").addEventListener("click", addChannel);
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
if ($("deleteWorkspaceChannelButton")) {
  $("deleteWorkspaceChannelButton").addEventListener("click", openWorkspaceChannelDeleteFromEdit);
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
if ($("onboardingConnectionDialog")) {
  $("onboardingConnectionDialog").addEventListener("click", (event) => {
    if (event.target === $("onboardingConnectionDialog")) {
      closeOnboardingConnectionDialog();
    }
  });
}
if ($("cancelOnboardingConnection")) {
  $("cancelOnboardingConnection").addEventListener("click", closeOnboardingConnectionDialog);
}
if ($("saveOnboardingConnection")) {
  $("saveOnboardingConnection").addEventListener("click", () => saveOnboardingConnectionSettings().catch((error) => toast(error.message)));
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
  if (event.key === "Escape" && !$("onboardingConnectionDialog")?.classList.contains("hidden")) {
    closeOnboardingConnectionDialog();
  }
});
if ($("startAll")) {
  $("startAll").addEventListener("click", () => {
    const streams = state.status?.streams || {};
    const anyRunning = Object.values(streams).some((stream) => isStreamActive(stream));
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
if ($("railOpenTransfer")) {
  $("railOpenTransfer").addEventListener("click", () => openWorkspaceRoute("transfer"));
}
if ($("previewEnabledToggle")) {
  $("previewEnabledToggle").addEventListener("change", (event) => {
    writePreviewEnabled(Boolean(event.target.checked));
    renderPreview(state.status?.streams || {});
    syncPreviewLifecycle(state.status?.streams || {});
  });
}
if ($("themeToggle")) {
  $("themeToggle").addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark", true);
  });
  syncThemeToggle();
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
    const backendBase = apiBaseUrl();
    if (backendBase && incoming.origin === new URL(backendBase).origin) return true;
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

let streamKeyMaskedState = {};
let streamCardExpandedState = {};

function toggleStreamKeyMask(streamId) {
  streamKeyMaskedState[streamId] = !streamKeyMaskedState[streamId];
  const input = document.getElementById(`streamKeyInput_${streamId}`);
  const btn = document.getElementById(`streamKeyToggleBtn_${streamId}`);
  if (input) {
    input.type = streamKeyMaskedState[streamId] ? "text" : "password";
  }
  if (btn) {
    btn.textContent = streamKeyMaskedState[streamId] ? "Hide" : "Show";
  }
}

function toggleStreamCardExpand(streamId) {
  streamCardExpandedState[streamId] = !streamCardExpandedState[streamId];
  const body = document.getElementById(`streamCardBody_${streamId}`);
  const toggleBtn = document.getElementById(`streamExpandToggleBtn_${streamId}`);
  if (body) {
    body.classList.toggle("hidden", !streamCardExpandedState[streamId]);
  }
  if (toggleBtn) {
    toggleBtn.classList.toggle("expanded", Boolean(streamCardExpandedState[streamId]));
  }
}

async function refreshChannelStreamStats(channelName) {
  const targetChannel = channelName || state.workspace.selectedChannelName;
  if (!targetChannel) return;
  try {
    toast("Refreshing stream stats from YouTube...", "info");
    const response = await fetchApi("/api/channel/streams/refresh-stats", {
      method: "POST",
      body: JSON.stringify({
        config: state.config || "config.ready.json",
        channel: targetChannel,
      }),
    });
    if (response?.ok) {
      toast("Stream stats updated!", "success");
      renderWorkspaceStreamsTab(targetChannel, response.streams);
    } else {
      toast("Failed to refresh stats: " + (response?.error || "Unknown error"), "danger");
    }
  } catch (err) {
    toast("Error refreshing stats: " + err.message, "danger");
  }
}

async function renderWorkspaceStreamsTab(channelName, cachedStreamsData = null) {
  const container = $("streamsGrid");
  if (!container) return;
  if (!channelName) {
    container.innerHTML = `<div class="panel-empty">Please select a channel to manage its streams.</div>`;
    return;
  }

  try {
    let streams = cachedStreamsData;
    if (!streams) {
      const cfg = state.config || "config.ready.json";
      const data = await fetchApi(`/api/channel/streams?config=${encodeURIComponent(cfg)}&channel=${encodeURIComponent(channelName)}`);
      if (!data || !data.ok) {
        container.innerHTML = `<div class="notice danger">Failed to load streams for ${escapeHtml(channelName)}</div>`;
        return;
      }
      streams = Array.isArray(data.streams) ? data.streams : [];
    }

    if (!streams.length) {
      container.innerHTML = `
        <div class="streams-empty-state">
          <p class="helper">No stream keys configured for this channel yet.</p>
          <button class="pill primary" type="button" onclick="openAddStreamModal('${escapeJs(channelName)}')">+ Add First Stream Key</button>
        </div>
      `;
      return;
    }

    container.innerHTML = streams.map((s) => {
      const isRunning = Boolean(s.is_running || s.status === "running");
      const isExpanded = Boolean(streamCardExpandedState[s.id]);
      const statusBadge = isRunning
        ? `<span class="badge live pulse">● RUNNING</span>`
        : `<span class="badge">STOPPED</span>`;
      
      const durationBadge = isRunning
        ? `<span class="badge duration-badge" title="Stream Uptime">⏱ ${escapeHtml(s.duration_formatted || "00:00:00")}</span>`
        : `<span class="badge duration-badge text-muted">⏱ --:--:--</span>`;

      const viewerBadge = (s.concurrent_viewers !== null && s.concurrent_viewers !== undefined)
        ? `<span class="badge viewers-badge" title="Live Concurrent Viewers">👥 ${s.concurrent_viewers.toLocaleString()} viewers</span>`
        : `<span class="badge viewers-badge text-muted" title="Click 'Refresh Stats' to query YouTube API">👥 Viewers: --</span>`;

      const totalViewsBadge = (s.total_views !== null && s.total_views !== undefined)
        ? `<span class="badge views-badge" title="Total Broadcast Views">👁 ${s.total_views.toLocaleString()} views</span>`
        : `<span class="badge views-badge text-muted" title="Click 'Refresh Stats' to query YouTube API">👁 Views: --</span>`;

      const avgDurationBadge = s.avg_view_duration
        ? `<span class="badge duration-badge" title="Average View Duration">⏱ Avg: ${escapeHtml(s.avg_view_duration)}</span>`
        : `<span class="badge duration-badge text-muted" title="Click 'Refresh Stats' to query YouTube API">⏱ Avg: --</span>`;

      const masked = !streamKeyMaskedState[s.id];
      const keyVal = s.stream_key || s.stream_key_env || "";
      const streamPlaylist = Array.isArray(s.playlist) ? s.playlist.join(", ") : "";

      const actionBtn = isRunning
        ? `<button class="pill danger" type="button" onclick="stopSingleStream('${escapeJs(channelName)}', '${escapeJs(s.id)}')">Stop Stream</button>`
        : `<button class="pill success" type="button" onclick="startSingleStream('${escapeJs(channelName)}', '${escapeJs(s.id)}')">Start Stream</button>`;

      return `
        <div class="stream-card ${isRunning ? "active-stream" : ""}" id="streamCard_${escapeHtml(s.id)}">
          <div class="stream-card-header" onclick="toggleStreamCardExpand('${escapeJs(s.id)}')">
            <div class="stream-card-left">
              <button
                id="streamExpandToggleBtn_${escapeHtml(s.id)}"
                class="stream-expand-toggle ${isExpanded ? "expanded" : ""}"
                type="button"
                aria-label="Toggle stream card details"
              >
                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
              </button>
              <div class="stream-card-info">
                <h3 class="stream-title">${escapeHtml(s.name || "Stream")}</h3>
                <div class="stream-badges">
                  ${statusBadge}
                  ${durationBadge}
                  ${viewerBadge}
                  ${totalViewsBadge}
                  ${avgDurationBadge}
                </div>
              </div>
            </div>
            <div class="stream-card-actions" onclick="event.stopPropagation()">
              ${actionBtn}
              <button class="pill ghost icon-only danger" type="button" onclick="deleteStreamFromChannel('${escapeJs(channelName)}', '${escapeJs(s.id)}')" title="Delete Stream">🗑</button>
            </div>
          </div>
          <div class="stream-card-body ${isExpanded ? "" : "hidden"}" id="streamCardBody_${escapeHtml(s.id)}">
            <div class="field-group">
              <label class="field-label" for="streamKeyInput_${escapeHtml(s.id)}">Stream Key</label>
              <div class="stream-key-input-group">
                <input
                  id="streamKeyInput_${escapeHtml(s.id)}"
                  type="${masked ? "password" : "text"}"
                  class="field-input stream-key-field"
                  value="${escapeHtml(keyVal)}"
                  onchange="updateStreamKeyInline('${escapeJs(channelName)}', '${escapeJs(s.id)}', this.value)"
                  placeholder="Paste YouTube Stream Key (e.g. xxxx-xxxx-xxxx-xxxx)"
                />
                <button
                  id="streamKeyToggleBtn_${escapeHtml(s.id)}"
                  class="pill ghost small"
                  type="button"
                  onclick="toggleStreamKeyMask('${escapeJs(s.id)}')"
                >${masked ? "Show" : "Hide"}</button>
              </div>
            </div>
            <div class="field-group stream-video-field-group">
              <div class="field-label-row">
                <label class="field-label" for="streamVideoInput_${escapeHtml(s.id)}">Specific Video / Playlist for this Stream (Optional)</label>
                <button class="pill ghost small" type="button" onclick="openStreamVideoPickerModal('${escapeJs(channelName)}', '${escapeJs(s.id)}')">📁 Import / Select Videos</button>
              </div>
              <input
                id="streamVideoInput_${escapeHtml(s.id)}"
                type="text"
                class="field-input"
                value="${escapeHtml(streamPlaylist)}"
                onchange="updateStreamPlaylistInline('${escapeJs(channelName)}', '${escapeJs(s.id)}', this.value)"
                placeholder="Leave blank for channel default, or select videos via Import button"
              />
            </div>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    container.innerHTML = `<div class="notice danger">Error loading streams: ${escapeHtml(err.message)}</div>`;
  }
}

async function updateStreamPlaylistInline(channelName, streamId, rawText) {
  try {
    const data = await fetchApi(`/api/channel/streams?config=${encodeURIComponent(state.config)}&channel=${encodeURIComponent(channelName)}`);
    if (!data || !data.ok) return;
    const streams = Array.isArray(data.streams) ? data.streams : [];
    const target = streams.find((s) => String(s.id) === String(streamId));
    if (target) {
      const items = String(rawText || "").split(",").map((t) => t.trim()).filter(Boolean);
      target.playlist = items;
      await fetchApi("/api/channel/streams/save", {
        method: "POST",
        body: JSON.stringify({
          config: state.config,
          channel: channelName,
          streams: streams
        })
      });
      toast("Stream-specific playlist updated.", "success");
    }
  } catch (err) {
    toast("Failed to update stream playlist: " + err.message, "danger");
  }
}

let activePickerStreamTarget = { channelName: "", streamId: "" };

async function openStreamVideoPickerModal(channelName, streamId) {
  activePickerStreamTarget = { channelName, streamId };
  const modal = $("streamVideoPickerModal");
  const listContainer = $("streamVideoPickerList");
  if (!modal || !listContainer) return;

  modal.classList.remove("hidden");
  listContainer.innerHTML = `<div class="panel-empty">Loading channel videos...</div>`;

  try {
    const cfg = state.config || "config.ready.json";
    const data = await fetchApi(`/api/normalized-files?config=${encodeURIComponent(cfg)}&channel=${encodeURIComponent(channelName)}`);
    const files = Array.isArray(data?.files) ? data.files : [];
    
    const currentInputValue = ($(`streamVideoInput_${streamId}`)?.value || "").trim();
    const currentSelectedList = currentInputValue.split(",").map((s) => s.trim()).filter(Boolean);

    if (!files.length) {
      listContainer.innerHTML = `
        <div class="streams-empty-state">
          <p class="helper">No normalized video files found in Go Live/${escapeHtml(channelName)}.</p>
          <p class="helper">Upload or normalize videos in the Dashboard tab first.</p>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = `
      <div class="stream-video-picker-grid">
        ${files.map((file, idx) => {
          const fileName = file.split(/[/\\]/).pop();
          const isChecked = currentSelectedList.includes(file) || currentSelectedList.includes(fileName);
          return `
            <label class="picker-file-item" for="pickerFile_${idx}">
              <input
                id="pickerFile_${idx}"
                type="checkbox"
                class="picker-checkbox"
                value="${escapeHtml(file)}"
                ${isChecked ? "checked" : ""}
              />
              <span class="picker-file-name" title="${escapeHtml(file)}">${escapeHtml(fileName)}</span>
            </label>
          `;
        }).join("")}
      </div>
    `;
  } catch (err) {
    listContainer.innerHTML = `<div class="notice danger">Error loading videos: ${escapeHtml(err.message)}</div>`;
  }
}

function closeStreamVideoPickerModal() {
  const modal = $("streamVideoPickerModal");
  if (modal) modal.classList.add("hidden");
}

async function confirmStreamVideoPickerSelection() {
  const { channelName, streamId } = activePickerStreamTarget;
  if (!channelName || !streamId) {
    closeStreamVideoPickerModal();
    return;
  }

  const checkboxes = document.querySelectorAll("#streamVideoPickerList .picker-checkbox:checked");
  const selectedFiles = Array.from(checkboxes).map((cb) => cb.value);
  
  const input = $(`streamVideoInput_${streamId}`);
  if (input) {
    input.value = selectedFiles.join(", ");
  }

  await updateStreamPlaylistInline(channelName, streamId, selectedFiles.join(", "));
  closeStreamVideoPickerModal();
}

async function startSingleStream(channelName, streamId) {
  try {
    toast(`Starting stream...`);
    const response = await fetchApi("/api/stream/start", {
      method: "POST",
      body: JSON.stringify({
        config: state.config,
        channel: channelName,
        stream_id: streamId
      })
    });
    if (response?.error) {
      toast("Failed to start stream: " + response.error, "danger");
    } else {
      toast("Stream started successfully!", "success");
      await refresh();
      renderWorkspaceStreamsTab(channelName);
    }
  } catch (err) {
    toast("Error starting stream: " + err.message, "danger");
  }
}

async function stopSingleStream(channelName, streamId) {
  try {
    toast(`Stopping stream...`);
    const response = await fetchApi("/api/stream/stop", {
      method: "POST",
      body: JSON.stringify({
        config: state.config,
        channel: channelName,
        stream_id: streamId
      })
    });
    if (response?.error) {
      toast("Failed to stop stream: " + response.error, "danger");
    } else {
      toast("Stream stopped.", "info");
      await refresh();
      renderWorkspaceStreamsTab(channelName);
    }
  } catch (err) {
    toast("Error stopping stream: " + err.message, "danger");
  }
}

async function openAddStreamModal(channelName) {
  const targetChannel = channelName || state.workspace.selectedChannelName;
  if (!targetChannel) {
    toast("Please select a channel first.", "warn");
    return;
  }
  const streamName = prompt("Enter a name for this new stream (e.g. Gaming Stream, Music Feed, Stream 2):", "Stream 2");
  if (!streamName || !streamName.trim()) return;
  const streamKey = prompt("Paste the YouTube Stream Key for this stream:", "");
  if (streamKey === null) return;

  try {
    const response = await fetchApi("/api/channel/streams/add", {
      method: "POST",
      body: JSON.stringify({
        config: state.config,
        channel: targetChannel,
        name: streamName.trim(),
        stream_key: (streamKey || "").trim()
      })
    });
    if (response?.error) {
      toast("Failed to add stream: " + response.error, "danger");
    } else {
      toast(`Stream "${streamName}" added!`, "success");
      await refresh();
      renderWorkspaceStreamsTab(targetChannel);
    }
  } catch (err) {
    toast("Error adding stream: " + err.message, "danger");
  }
}

async function deleteStreamFromChannel(channelName, streamId) {
  if (!confirm("Are you sure you want to delete this stream from the channel?")) return;
  try {
    const response = await fetchApi("/api/channel/streams/delete", {
      method: "POST",
      body: JSON.stringify({
        config: state.config,
        channel: channelName,
        stream_id: streamId
      })
    });
    if (response?.error) {
      toast("Failed to delete stream: " + response.error, "danger");
    } else {
      toast("Stream deleted.", "info");
      await refresh();
      renderWorkspaceStreamsTab(channelName);
    }
  } catch (err) {
    toast("Error deleting stream: " + err.message, "danger");
  }
}

async function updateStreamKeyInline(channelName, streamId, newKey) {
  try {
    const data = await fetchApi(`/api/channel/streams?config=${encodeURIComponent(state.config)}&channel=${encodeURIComponent(channelName)}`);
    if (!data || !data.ok) return;
    const streams = Array.isArray(data.streams) ? data.streams : [];
    const target = streams.find((s) => String(s.id) === String(streamId));
    if (target) {
      target.stream_key = (newKey || "").trim();
      await fetchApi("/api/channel/streams/save", {
        method: "POST",
        body: JSON.stringify({
          config: state.config,
          channel: channelName,
          streams: streams
        })
      });
      toast("Stream key updated.", "success");
    }
  } catch (err) {
    toast("Failed to update stream key: " + err.message, "danger");
  }
}

readOnboardingState();
readWorkspaceAlertIds();
applySettingsSection(state.settingsTab);
applyLegacyTabView("control");
renderChannelTools();
initActivityStreamSplitter();
renderCachedDashboard();
initDesktopIntegration()
  .catch(() => {})
  .then(() => refresh())
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

