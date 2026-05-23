const state = {
  config: "config.ready.json",
  status: null,
  configData: null,
  activeTab: "control",
  settingsTab: "folders",
  rawFilesByChannel: {},
  normalizedFilesByChannel: {},
  activeSettingsChannelIndex: 0,
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
  activityFilter: "all",
  localActivityEvents: [],
  activityRenderedItems: [],
};

const $ = (id) => document.getElementById(id);
const desktopBridge = () => (window.desktopShell && typeof window.desktopShell === "object" ? window.desktopShell : null);
const ACTIVITY_STREAM_SPLIT_KEY = "castarro.activityStreamSplitRatio.v1";

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
        last_connected_at: "",
      });
    }
  }
  return Array.from(deduped.values());
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
    channel_name: details.channel || "",
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
    logLocalActivityEvent(
      "api_request",
      `Network error while calling ${path}`,
      { path, request_id: requestId, client_action: action, error: String(error?.message || error) },
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
    logLocalActivityEvent(
      "api_request",
      `API request failed: ${path}`,
      {
        path,
        request_id: responseRequestId,
        client_action: action,
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
  state.status = payload;

  if (!payload.configs.includes(state.config)) {
    state.config = payload.configs.includes("config.json") ? "config.json" : payload.configs[0] || "config.json";
  }

  renderConfigSelect(payload.configs);
  state.appVersion = payload.app_version || state.appVersion;
  renderAppVersion();
  renderStatus(payload);
  renderChannels(payload);
  renderPreview(payload.streams);
  renderTasks(payload.tasks, payload.activity_events || []);
  renderLogs(payload.streams);
  const runningSettingsTask = payload.tasks.some((task) => ["normalize", "validate", "test-stream"].includes(task.name) && task.running);
  if (state.activeTab === "settings" && (runningSettingsTask || state.hadRunningSettingsTask)) {
    renderSettingsForms();
  }
  state.hadRunningSettingsTask = runningSettingsTask;
  renderUpdateBanner();
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
  const enabledChannels = payload.channels.filter((channel) => channel.enabled).length;
  const autoReady = payload.channels.filter((channel) => channel.enabled && channel.youtube_auto_start && channel.youtube_auto_stop).length;

  $("serverState").textContent = payload.config_exists ? `${running} live stream${running === 1 ? "" : "s"}` : "Config needed";
  $("taskState").textContent = taskRunning ? "Working" : "Idle";
  $("channelCount").textContent = `${payload.channels.length} channel${payload.channels.length === 1 ? "" : "s"}`;
  $("activeConfigLabel").textContent = payload.config_exists ? payload.config : "Create a config in Settings";

  const notice = $("autoNotice");
  if (!payload.config_exists) {
    notice.textContent = "Create a config in Settings, then confirm Auto Start and Auto Stop for each YouTube broadcast.";
    notice.className = "notice warn";
  } else if (enabledChannels && autoReady < enabledChannels) {
    notice.textContent = `${autoReady}/${enabledChannels} enabled channel(s) marked YouTube Auto Start/Stop ready. Confirm these switches in YouTube Studio before streaming.`;
    notice.className = "notice warn";
  } else {
    notice.textContent = "Auto mode ready: start streams here and YouTube should go live automatically; stop streams here and YouTube should auto-end shortly after signal stops.";
    notice.className = "notice";
  }
}

function renderChannels(payload) {
  if (!payload.config_exists) {
    $("channels").innerHTML = `<div class="card">No config found yet. Open <strong>Settings</strong> and create one to begin.</div>`;
    return;
  }

  $("channels").innerHTML = payload.channels.map((channel) => {
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

  const hadExisting = container.childElementCount > 0;
  const panelScroll = {
    top: container.scrollTop,
    left: container.scrollLeft,
    topPinned: isNearTop(container),
  };
  const scrollState = captureLogScrolls("#tasks pre[data-log-id]");

  const taskList = Array.isArray(tasks) ? tasks : [];
  const backendEvents = Array.isArray(events) ? events : [];
  const localEvents = Array.isArray(state.localActivityEvents) ? state.localActivityEvents : [];
  const eventList = [...localEvents, ...backendEvents];

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
  if (!items.length) {
    container.innerHTML = `<div class="task">No activity yet. Normalize, validate, schedule, or verify to see output here.</div>`;
    state.activityRenderedItems = [];
    return;
  }

  container.innerHTML = `
    <article class="task activity-unified">
      <div class="activity-unified-head">
        <div class="task-title-main">
          <span>Execution Timeline</span>
          <span class="task-subtitle">${escapeHtml(activityFilterLabel())}</span>
        </div>
        <div class="row wrap">
          <span class="badge">${escapeHtml(`${filtered.length} shown`)}</span>
        </div>
      </div>
      <div class="task-meta">
        <span>${escapeHtml(`${counts.all} total entries`)}</span>
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
  const channel = task.channel || task.progress?.channel || "Unknown channel";
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
  const channel = String(event?.channel_name || "").trim() || "Global";
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
    const channel = task.channel || task.progress?.channel || "Unknown channel";
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

function toggleTaskLog(taskId) {
  state.expandedTaskLogs[taskId] = !state.expandedTaskLogs[taskId];
  renderTasks(state.status?.tasks || [], state.status?.activity_events || []);
}

function renderLogs(streams) {
  const entries = Object.values(streams);
  const pre = $("streamLogs");
  const wasAtBottom = isNearBottom(pre);
  const scrollTop = pre.scrollTop;
  const scrollLeft = pre.scrollLeft;
  if (!entries.length) {
    pre.textContent = "No stream logs yet.";
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

  const applyByRatio = (ratio) => {
    const normalized = Number(ratio);
    if (!Number.isFinite(normalized) || normalized <= 0 || normalized >= 1) return;
    const total = Math.max(0, grid.clientWidth - splitterWidth);
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
    const rect = grid.getBoundingClientRect();
    const total = Math.max(0, rect.width - splitterWidth);
    if (total < (minLeft + minRight)) return;
    const rawLeft = clientX - rect.left - (splitterWidth / 2);
    const left = Math.min(Math.max(rawLeft, minLeft), total - minRight);
    const right = total - left;
    grid.style.gridTemplateColumns = `${Math.round(left)}px ${splitterWidth}px ${Math.round(right)}px`;
  };

  splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    activePointerId = event.pointerId;
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
    saveCurrentRatio();
  };

  splitter.addEventListener("pointerup", stopDragging);
  splitter.addEventListener("pointercancel", stopDragging);
  splitter.addEventListener("lostpointercapture", () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove("dragging");
    activePointerId = null;
    saveCurrentRatio();
  });

  splitter.addEventListener("keydown", (event) => {
    const leftRect = $("activityPanel")?.getBoundingClientRect();
    const rightRect = $("streamLogsPanel")?.getBoundingClientRect();
    if (!leftRect || !rightRect) return;
    const total = Math.max(0, grid.clientWidth - splitterWidth);
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
  if (!items.length) {
    toast("No activity logs to copy.");
    return;
  }
  const lines = [];
  lines.push(`Activity export (${new Date().toLocaleString()})`);
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

function formatTaskForExport(task, n) {
  const channel = task.channel || task.progress?.channel || "Unknown channel";
  const status = task.running ? "running" : Number(task.returncode) === 0 ? "success" : `failed (${task.returncode})`;
  const started = formatTimestamp(task.started_at);
  const header = `[${n}] TASK ${taskTitle(task.name)} | channel=${channel} | status=${status} | ${started}`;
  const summary = task.progress?.message || "";
  const logText = (task.lines || []).join("\n").trim();
  return `${header}\nsummary: ${summary || "n/a"}\n${logText || "no log output"}\n`;
}

function formatEventForExport(event, n) {
  const eventType = String(event?.event_type || "event");
  const channel = String(event?.channel_name || "").trim() || "Global";
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
  config.channels = Array.isArray(config.channels) ? config.channels : [];
  config.channels.forEach((channel) => {
    channel.youtube_account_id = normalizeAccountId(channel.youtube_account_id || "");
  });
  $("folderSettingsFields").innerHTML = folderSettingsMarkup(config.defaults);

  $("normalizationChannels").innerHTML = config.channels.length
    ? config.channels.map((channel, index) => normalizationCard(channel, index)).join("")
    : `<div class="card">No channels yet. Click <strong>Add Channel</strong> to create one.</div>`;

  $("channelSettings").innerHTML = config.channels.length
    ? config.channels.map((channel, index) => liveChannelCard(channel, index)).join("")
    : `<div class="card">No channels yet. Click <strong>Add Channel</strong> to create one.</div>`;

  renderYoutubeSettingsPanel(config);
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
        <code>defaults.${escapeHtml(fieldName)}</code>
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

function renderYoutubeSettingsPanel(config) {
  const container = $("youtubeSettingsPanel");
  if (!container) return;

  const youtube = { ...defaultYoutubeSettings(), ...(config.youtube || {}) };
  const status = state.youtubeStatus || {};
  const connected = Boolean(status.connected);
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
  if (!state.youtubeSelectedAccountId || !accounts.some((item) => item.id === state.youtubeSelectedAccountId)) {
    state.youtubeSelectedAccountId = accounts[0]?.id || "";
  }
  const selectedAccount = accounts.find((item) => item.id === state.youtubeSelectedAccountId) || null;
  const ownerSetupVisible = showYoutubeOwnerSetupInUi();
  const credentialsReady = Boolean(
    status.has_client_credentials
    || hasYoutubeCredentialsConfigured(youtube)
  );
  const channelTitle = String(selectedAccount?.channel_title || status.channel_title || "").trim();
  const channelHandle = String(selectedAccount?.channel_handle || status.channel_handle || "").trim();
  const accountText = channelTitle
    ? `${channelTitle}${channelHandle ? ` (${channelHandle})` : ""}`
    : connected
      ? "Connected"
      : "Not connected";
  const badgeClass = connectedCount ? "badge live" : credentialsReady ? "badge" : "badge warn";
  const badgeText = connectedCount ? `${connectedCount} Connected` : credentialsReady ? "Ready to connect" : "Credentials needed";
  const broadcasts = Array.isArray(state.youtubeBroadcasts) ? state.youtubeBroadcasts : [];
  const keyChecks = state.youtubeKeyChecks && Array.isArray(state.youtubeKeyChecks.checks)
    ? state.youtubeKeyChecks
    : null;
  const actionBusy = String(state.youtubeActionBusy || "").trim();
  const actionStatus = String(state.youtubeActionStatus || "idle");
  const actionMessage = String(state.youtubeActionMessage || "").trim();
  const actionAt = String(state.youtubeActionAt || "").trim();
  const previousScheduleChannel = String($("youtubeScheduleChannel")?.value || "").trim();
  const channelOptions = (config.channels || []).map((channel) => {
    const name = String(channel?.name || "").trim();
    if (!name) return "";
    const selected = name === previousScheduleChannel ? "selected" : "";
    return `<option value="${escapeAttr(name)}" ${selected}>${escapeHtml(name)}</option>`;
  }).filter(Boolean).join("");
  const accountOptions = accounts.map((item) => {
    const label = item.channel_title
      ? `${item.label} (${item.channel_title})`
      : item.label;
    return `<option value="${escapeAttr(item.id)}" ${item.id === state.youtubeSelectedAccountId ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  const now = new Date();
  now.setMinutes(now.getMinutes() + 15 - (now.getMinutes() % 15), 0, 0);
  const defaultLocalTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const disabledSchedule = connectedCount > 0 && !actionBusy ? "" : "disabled";
  const disabledConnectActions = actionBusy ? "disabled" : "";
  const scheduleStatusText = connectedCount > 0
    ? "Scheduling controls are ready. Scheduling will use the linked account of your selected Castarro channel."
    : "Scheduling controls are disabled until a YouTube account is connected.";
  const actionText = actionMessage || (connectedCount > 0
    ? "No YouTube action run yet in this session."
    : "Connect YouTube first, then run schedule/refresh/verify actions.");
  const actionNoticeClass = actionStatus === "error" ? "notice warn" : "notice";
  const scheduleButtonText = actionBusy === "schedule" ? "Creating..." : "Create Schedule + Stream Key";
  const refreshButtonText = actionBusy === "refresh" ? "Refreshing..." : "Refresh Broadcasts";
  const verifyButtonText = actionBusy === "verify" ? "Verifying..." : "Verify Channel Keys";
  const defaultPrivacy = ["private", "unlisted", "public"].includes(String(youtube.default_privacy_status || "").toLowerCase())
    ? String(youtube.default_privacy_status || "").toLowerCase()
    : "unlisted";
  const selectedChannelName = previousScheduleChannel || "";
  const selectedChannel = (config.channels || []).find((channel) => String(channel?.name || "") === selectedChannelName);
  const linkedAccountId = normalizeAccountId(selectedChannel?.youtube_account_id || "");
  const linkedAccount = accounts.find((item) => item.id === linkedAccountId) || null;
  const linkedAccountText = linkedAccount
    ? linkedAccount.channel_title
      ? `${linkedAccount.label} (${linkedAccount.channel_title})`
      : linkedAccount.label
    : linkedAccountId
      ? linkedAccountId
      : "Not linked";
  let keyCheckSummary = "Run verification to confirm stream keys match each channel's linked account.";
  let keyCheckAllGood = false;
  if (keyChecks) {
    const checks = Array.isArray(keyChecks.checks) ? keyChecks.checks : [];
    const enforceable = checks.filter((item) => String(item?.status || "") !== "missing_account");
    const matched = enforceable.filter((item) => Boolean(item?.ok)).length;
    keyCheckAllGood = enforceable.length > 0 && matched === enforceable.length;
    keyCheckSummary = enforceable.length
      ? `${matched}/${enforceable.length} mapped channel(s) match their linked account.`
      : "No linked account mappings to verify yet.";
  }

  container.innerHTML = `
    <div class="youtube-grid">
      <section class="nested-card">
        <div class="section-head compact">
          <div>
            <h3>Connect</h3>
            <p class="helper">Connect each YouTube account once, then map Castarro channels to account slots.</p>
          </div>
          <span class="${badgeClass}">${escapeHtml(badgeText)}</span>
        </div>
        <div class="form-grid">
          <label>
            Account slot
            <select id="youtubeAccountSlot" ${disabledConnectActions} onchange="selectYoutubeAccountSlot(this.value)">
              ${accountOptions || '<option value="">No slots yet</option>'}
            </select>
          </label>
          <label>
            New slot label
            <input id="youtubeNewAccountLabel" type="text" placeholder="e.g. Inside Us Hindi" ${disabledConnectActions}>
            <span class="setting-note">Use this with Connect when creating a new slot.</span>
          </label>
        </div>
        <div class="switch-row youtube-pref-row">
          <label class="switch">
            <input type="checkbox" data-youtube-field="default_auto_start" ${youtube.default_auto_start ? "checked" : ""}>
            <span>Default Auto Start</span>
          </label>
          <label class="switch">
            <input type="checkbox" data-youtube-field="default_auto_stop" ${youtube.default_auto_stop ? "checked" : ""}>
            <span>Default Auto Stop</span>
          </label>
          <label class="youtube-privacy-field">
            Default privacy
            <select data-youtube-field="default_privacy_status">
              ${["private", "unlisted", "public"].map((privacy) => `<option value="${privacy}" ${privacy === defaultPrivacy ? "selected" : ""}>${privacy}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="row wrap">
          <button class="pill primary" type="button" onclick="connectYoutube().catch((error) => toast(error.message))" ${credentialsReady ? disabledConnectActions : "disabled"}>Connect / Reconnect</button>
          <button class="pill ghost" type="button" onclick="addYoutubeAccountSlot().catch((error) => toast(error.message))" ${disabledConnectActions}>Add Slot</button>
          <button class="pill ghost" type="button" onclick="refreshYoutubeStatus().catch((error) => toast(error.message))" ${disabledConnectActions}>Refresh</button>
          <button class="pill danger" type="button" onclick="disconnectYoutube().catch((error) => toast(error.message))" ${(selectedAccount?.connected) ? disabledConnectActions : "disabled"}>Disconnect Slot</button>
        </div>
        ${credentialsReady ? "" : `<div class="notice warn">YouTube owner credentials are not configured yet.</div>`}
        <div class="meta">Selected slot: ${escapeHtml(selectedAccount?.label || "None")} | Account: ${escapeHtml(accountText)}</div>
        ${accounts.length ? `
        <div class="youtube-broadcast-list">
          ${accounts.map((item) => `
            <article class="youtube-broadcast-item">
              <div class="youtube-broadcast-title">${escapeHtml(item.label || item.id)}</div>
              <div class="meta">${escapeHtml(item.channel_title || "Not connected yet")} ${item.channel_handle ? `(${escapeHtml(item.channel_handle)})` : ""}</div>
              <div class="row wrap">
                <span class="badge ${item.connected ? "live" : "warn"}">${item.connected ? "Connected" : "Disconnected"}</span>
                <span class="badge">slot: ${escapeHtml(item.id)}</span>
              </div>
            </article>
          `).join("")}
        </div>
        ` : `<div class="meta">No account slots yet. Add one, then connect.</div>`}
        ${status.message ? `<div class="notice">${escapeHtml(status.message)}</div>` : ""}
      </section>

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

      <section class="nested-card">
        <div class="section-head compact">
          <div>
            <h3>Schedule Broadcast</h3>
            <p class="helper">Create a YouTube event + stream key, then assign that key to one Castarro channel.</p>
          </div>
        </div>
        <div class="form-grid">
          <label>
            Castarro Channel
            <select id="youtubeScheduleChannel" ${disabledSchedule} onchange="updateYoutubeScheduleLinkHint()">
              <option value="">Pick channel</option>
              ${channelOptions}
            </select>
          </label>
          <label>
            Title
            <input id="youtubeScheduleTitle" type="text" placeholder="Live Event Title" ${disabledSchedule}>
          </label>
          <label>
            Start time
            <input id="youtubeScheduleStart" type="datetime-local" value="${defaultLocalTime}" ${disabledSchedule}>
          </label>
          <label>
            Duration (minutes)
            <input id="youtubeScheduleDuration" type="number" value="120" min="15" step="5" ${disabledSchedule}>
          </label>
          <label>
            Privacy
            <select id="youtubeSchedulePrivacy" ${disabledSchedule}>
              ${["private", "unlisted", "public"].map((privacy) => `<option value="${privacy}" ${privacy === defaultPrivacy ? "selected" : ""}>${privacy}</option>`).join("")}
            </select>
          </label>
          <div class="switch-row youtube-pref-row two-up">
            <label class="switch">
              <input id="youtubeScheduleAutoStart" type="checkbox" ${youtube.default_auto_start ? "checked" : ""} ${disabledSchedule}>
              <span>Auto Start</span>
            </label>
            <label class="switch">
              <input id="youtubeScheduleAutoStop" type="checkbox" ${youtube.default_auto_stop ? "checked" : ""} ${disabledSchedule}>
              <span>Auto Stop</span>
            </label>
          </div>
          <label class="youtube-description">
            Description
            <textarea id="youtubeScheduleDescription" rows="4" placeholder="Optional broadcast description" ${disabledSchedule}></textarea>
          </label>
        </div>
        <div class="notice ${linkedAccount ? "" : "warn"}" id="youtubeScheduleLinkHint">Linked account: ${escapeHtml(linkedAccountText)}</div>
        <div class="row wrap">
          <button class="pill success" type="button" onclick="scheduleYoutubeBroadcast().catch((error) => toast(error.message))" ${disabledSchedule}>${scheduleButtonText}</button>
          <button class="pill ghost" type="button" onclick="refreshYoutubeBroadcasts(true).catch((error) => toast(error.message))" ${disabledSchedule}>${refreshButtonText}</button>
          <button class="pill ghost" type="button" onclick="verifyYoutubeChannelKeys().catch((error) => toast(error.message))" ${disabledSchedule}>${verifyButtonText}</button>
        </div>
        <div class="notice ${connectedCount > 0 ? "" : "warn"}">${escapeHtml(scheduleStatusText)}</div>
        <div class="${actionNoticeClass}">${escapeHtml(actionText)}</div>
        ${actionAt ? `<div class="meta">Last action update: ${escapeHtml(actionAt)}</div>` : ""}
        <div class="notice ${keyChecks && keyCheckAllGood ? "" : "warn"}">${escapeHtml(keyCheckSummary)}</div>
        ${keyChecks ? `
          <div class="youtube-broadcast-list">
            ${keyChecks.checks.map((item) => `
              <article class="youtube-broadcast-item">
                <div class="youtube-broadcast-title">${escapeHtml(item.channel || "Unnamed channel")}</div>
                <div class="meta">${escapeHtml(item.message || "")}</div>
                <div class="row wrap">
                  <span class="badge ${item.ok ? "live" : "warn"}">${item.ok ? "Matched" : "Mismatch"}</span>
                  ${item.account_label ? `<span class="badge">slot: ${escapeHtml(item.account_label)}</span>` : ""}
                  ${item.stream_key_suffix ? `<span class="badge">Key ends: ${escapeHtml(item.stream_key_suffix)}</span>` : ""}
                  ${item.match_source ? `<span class="badge">${escapeHtml(item.match_source)}</span>` : ""}
                </div>
              </article>
            `).join("")}
          </div>
        ` : ""}
      </section>
    </div>

    <section class="nested-card">
      <div class="section-head compact">
        <div>
          <h3>Upcoming Broadcasts</h3>
          <p class="helper">Events from selected account slot.</p>
        </div>
      </div>
      <div class="youtube-broadcast-list">
        ${broadcasts.length
          ? broadcasts.map((item) => `
            <article class="youtube-broadcast-item">
              <div class="youtube-broadcast-title">${escapeHtml(item.title || "Untitled")}</div>
              <div class="meta">${escapeHtml(item.scheduled_start_time || "No start time")} - ${escapeHtml(item.privacy_status || "unknown")} - ${escapeHtml(item.life_cycle_status || "unknown")}</div>
              <div class="row wrap">
                ${item.studio_url ? `<a class="studio-link" href="${escapeHtml(item.studio_url)}" target="_blank">Open Studio</a>` : ""}
                ${item.stream_name ? `<span class="badge">Key: ${escapeHtml(maskSecret(item.stream_name))}</span>` : ""}
              </div>
            </article>
          `).join("")
          : `<div class="meta">No upcoming broadcasts found.</div>`
        }
      </div>
    </section>
  `;
  updateYoutubeScheduleLinkHint();
}

async function refreshYoutubeStatus() {
  state.youtubeStatusLoading = true;
  try {
    const payload = await api(`/api/youtube/status?config=${encodeURIComponent(state.config)}`, { action: "youtube.status" });
    state.youtubeStatus = payload || null;
    const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
    if (!state.youtubeSelectedAccountId || !accounts.some((item) => normalizeAccountId(item.id || "") === state.youtubeSelectedAccountId)) {
      state.youtubeSelectedAccountId = normalizeAccountId(payload?.default_account_id || "") || normalizeAccountId(accounts[0]?.id || "");
    }
    if (!state.youtubeStatus?.connected) {
      state.youtubeKeyChecks = null;
    }
  } finally {
    state.youtubeStatusLoading = false;
    renderYoutubeSettingsPanel(state.configData || defaultConfigData());
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

function selectYoutubeAccountSlot(accountId) {
  state.youtubeSelectedAccountId = normalizeAccountId(accountId || "");
  renderYoutubeSettingsPanel(state.configData || defaultConfigData());
}

async function addYoutubeAccountSlot() {
  const config = state.configData || defaultConfigData();
  config.youtube = { ...defaultYoutubeSettings(), ...(config.youtube || {}) };
  config.youtube.accounts = normalizedYoutubeAccounts(config);
  const labelRaw = String($("youtubeNewAccountLabel")?.value || "").trim();
  if (!labelRaw) {
    throw new Error("Enter a new slot label first.");
  }
  let accountId = normalizeAccountId(labelRaw);
  if (!accountId) {
    throw new Error("New slot label must include letters or numbers.");
  }
  if (config.youtube.accounts.some((item) => item.id === accountId)) {
    throw new Error("This slot already exists.");
  }
  const account = {
    id: accountId,
    label: labelRaw,
    tokens_file: defaultAccountTokensFile(accountId),
    channel_id: "",
    channel_title: "",
    channel_handle: "",
    last_connected_at: "",
  };
  config.youtube.accounts.push(account);
  if (!config.youtube.default_account_id) {
    config.youtube.default_account_id = accountId;
  }
  state.youtubeSelectedAccountId = accountId;
  state.configData = config;
  $("configEditor").value = JSON.stringify(config, null, 2) + "\n";
  renderSettingsForms();
  toast(`Added account slot: ${labelRaw}`);
}

function updateYoutubeScheduleLinkHint() {
  const hint = $("youtubeScheduleLinkHint");
  if (!hint) return;
  const config = state.configData || defaultConfigData();
  const channelName = String($("youtubeScheduleChannel")?.value || "").trim();
  const channel = (config.channels || []).find((item) => String(item?.name || "").trim() === channelName);
  let accountId = normalizeAccountId(channel?.youtube_account_id || "");
  const statusAccounts = Array.isArray(state.youtubeStatus?.accounts) ? state.youtubeStatus.accounts : [];
  if (!accountId && statusAccounts.length === 1) {
    accountId = normalizeAccountId(statusAccounts[0]?.id || "");
  }
  const account = statusAccounts.find((item) => normalizeAccountId(item?.id || "") === accountId)
    || normalizedYoutubeAccounts(config).find((item) => item.id === accountId);
  const text = account
    ? account.channel_title
      ? `${account.label || account.id} (${account.channel_title})`
      : (account.label || account.id)
    : accountId
      ? accountId
      : "Not linked";
  hint.textContent = `Linked account: ${text}`;
  hint.classList.toggle("warn", !accountId || !account || !account.connected);
}

async function refreshYoutubeBroadcasts(useLinkedChannel = false) {
  setYoutubeAction("loading", "Refreshing upcoming broadcasts from YouTube...", "refresh");
  try {
    let accountId = state.youtubeSelectedAccountId;
    if (useLinkedChannel) {
      const config = state.configData || defaultConfigData();
      const channelName = String($("youtubeScheduleChannel")?.value || "").trim();
      const channel = (config.channels || []).find((item) => String(item?.name || "").trim() === channelName);
      accountId = normalizeAccountId(channel?.youtube_account_id || accountId || "");
      if (!accountId) {
        const statusAccounts = Array.isArray(state.youtubeStatus?.accounts) ? state.youtubeStatus.accounts : [];
        if (statusAccounts.length === 1) {
          accountId = normalizeAccountId(statusAccounts[0]?.id || "");
        }
      }
    }
    const query = accountId ? `&account=${encodeURIComponent(accountId)}` : "";
    const payload = await api(`/api/youtube/broadcasts?config=${encodeURIComponent(state.config)}${query}`, { action: "youtube.broadcasts.refresh" });
    state.youtubeBroadcasts = payload.broadcasts || [];
    if (payload.account_id) {
      state.youtubeSelectedAccountId = normalizeAccountId(payload.account_id);
    }
    setYoutubeAction("success", `Broadcast list refreshed (${state.youtubeBroadcasts.length} item(s)).`);
  } catch (error) {
    setYoutubeAction("error", error.message || "Could not refresh broadcasts.");
    throw error;
  }
}

async function connectYoutube() {
  const data = collectSettingsData();
  await saveConfigData(data);
  let accountId = normalizeAccountId($("youtubeAccountSlot")?.value || state.youtubeSelectedAccountId || "");
  const labelInput = String($("youtubeNewAccountLabel")?.value || "").trim();
  if (!accountId && labelInput) {
    accountId = normalizeAccountId(labelInput);
  }
  const query = new URLSearchParams({
    config: state.config,
    account: accountId,
  });
  if (labelInput) {
    query.set("label", labelInput);
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
  const accountId = normalizeAccountId($("youtubeAccountSlot")?.value || state.youtubeSelectedAccountId || "");
  if (!accountId) {
    throw new Error("Pick a YouTube account slot first.");
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
  toast("YouTube account slot disconnected.");
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
  const channelName = String($("youtubeScheduleChannel")?.value || "").trim();
  const title = String($("youtubeScheduleTitle")?.value || "").trim();
  const description = String($("youtubeScheduleDescription")?.value || "").trim();
  const startIso = parseScheduleDateIso("youtubeScheduleStart");
  const durationMinutes = Number($("youtubeScheduleDuration")?.value || 120);
  const privacyStatus = String($("youtubeSchedulePrivacy")?.value || "unlisted").trim();
  const autoStart = Boolean($("youtubeScheduleAutoStart")?.checked);
  const autoStop = Boolean($("youtubeScheduleAutoStop")?.checked);
  const config = state.configData || defaultConfigData();
  const channel = (config.channels || []).find((item) => String(item?.name || "").trim() === channelName);
  let linkedAccountId = normalizeAccountId(channel?.youtube_account_id || "");
  const statusAccounts = Array.isArray(state.youtubeStatus?.accounts) ? state.youtubeStatus.accounts : [];
  if (!linkedAccountId && statusAccounts.length === 1) {
    linkedAccountId = normalizeAccountId(statusAccounts[0]?.id || "");
  }
  const linkedAccount = statusAccounts.find((item) => normalizeAccountId(item?.id || "") === linkedAccountId);

  if (!channelName) {
    logLocalActivityEvent("ui_validation", "Pick a Castarro channel first.", { action: "youtube.schedule" }, "error");
    throw new Error("Pick a Castarro channel first.");
  }
  if (!linkedAccountId) {
    logLocalActivityEvent("ui_validation", "Link a YouTube account slot for this Castarro channel first.", { action: "youtube.schedule", channel: channelName }, "error");
    throw new Error("Link a YouTube account slot for this Castarro channel first.");
  }
  if (!linkedAccount?.connected) {
    logLocalActivityEvent("ui_validation", "The linked YouTube account slot is not connected.", { action: "youtube.schedule", channel: channelName, account: linkedAccountId }, "error");
    throw new Error(`Linked YouTube account slot "${linkedAccountId}" is not connected.`);
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
    await refresh();
    await loadConfigText();
    await refreshYoutubeStatus();
    await refreshYoutubeBroadcasts(true);
    await verifyYoutubeChannelKeys(channelName);
    setYoutubeAction(
      "success",
      streamName
        ? `Schedule created on ${payload?.account_label || linkedAccountId} and key assigned (key ends with ${streamName.slice(-4)}).`
        : `Schedule created on ${payload?.account_label || linkedAccountId}.`
    );
    toast(streamName ? `YouTube schedule created on ${payload?.account_label || linkedAccountId}. Stream key ends with ${streamName.slice(-4)}.` : `YouTube schedule created on ${payload?.account_label || linkedAccountId}.`);
  } catch (error) {
    setYoutubeAction("error", error.message || "Could not create schedule.");
    throw error;
  }
}

function normalizationCard(channel, index) {
  const selected = Array.isArray(channel.raw_playlist) ? channel.raw_playlist : [];
  const files = state.rawFilesByChannel[channel.name] || [];
  const selectedSet = new Set(selected);
  const open = state.activeSettingsChannelIndex === index ? "open" : "";
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
    : `<div class="meta">No videos found yet in Raw Videos/${escapeHtml(channel.name || "")}. Add files there, then click Refresh Raw Videos.</div>`;

  return `
    <details class="card channel-settings" data-index="${index}" ${open}>
      <summary class="channel-summary">
        <span class="channel-name">${escapeHtml(channel.name || `channel_${index + 1}`)}</span>
        <span class="badge">${selected.length} selected</span>
      </summary>
      <div class="channel-body">
        <div class="row wrap">
          <input class="hidden-file" id="upload-${index}" type="file" multiple accept="video/*" onchange="uploadRawVideos(${index}, this.files).catch((error) => toast(error.message))">
          <button class="pill primary" type="button" onclick="document.getElementById('upload-${index}').click()">Add Videos</button>
          <button class="pill success" type="button" onclick="startSettingsTask('normalize', ${index})">Normalize</button>
          <button class="pill" type="button" onclick="startSettingsTask('validate', ${index})">Validate</button>
          <button class="pill ghost" type="button" onclick="loadRawFiles().catch((error) => toast(error.message))">Refresh</button>
          <button class="pill danger small" type="button" onclick="removeChannel(${index})">Remove Channel</button>
        </div>
        ${task ? taskProgressMarkup(task) : ""}
        <div class="file-picker">
          <div class="file-list">${fileOptions}</div>
          <div class="meta">If a normalized file name already exists, a new version like <code>-v2</code> is created and a heads-up appears in Activity.</div>
        </div>
        <div>
          <h3>Normalization Profile</h3>
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
    </details>
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
  const action = task.name === "normalize" ? "Normalizing" : task.name === "validate" ? "Validating" : "Testing stream";
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

function channelYoutubeAccountSelect(selectedId = "") {
  const config = state.configData || defaultConfigData();
  const accounts = normalizedYoutubeAccounts(config);
  const normalizedSelected = normalizeAccountId(selectedId || "");
  const baseOptions = [`<option value="">Pick linked account slot</option>`];
  const options = accounts.map((account) => {
    const label = account.channel_title
      ? `${account.label} (${account.channel_title})`
      : account.label;
    return `<option value="${escapeAttr(account.id)}" ${account.id === normalizedSelected ? "selected" : ""}>${escapeHtml(label)}</option>`;
  });
  return `
    <label>
      Linked YouTube Account
      <select data-channel-field="youtube_account_id">
        ${baseOptions.concat(options).join("")}
      </select>
      <span class="setting-note">This channel will schedule on this linked YouTube account slot.</span>
    </label>
  `;
}

function liveChannelCard(channel, index) {
  const selected = Array.isArray(channel.playlist) ? channel.playlist : [];
  const files = state.normalizedFilesByChannel[channel.name] || [];
  const selectedSet = new Set(selected);
  const profile = { ...defaultLiveProfile(), ...(channel.live_profile || {}) };
  const liveMode = (profile.mode || "copy") === "transcode" ? "transcode" : "copy";
  const isTranscode = liveMode === "transcode";
  const fileOptions = files.length
    ? files.map((file) => `
        <label class="file-option">
          <input type="checkbox" data-live-file="${escapeAttr(file.path)}" ${selectedSet.has(file.path) ? "checked" : ""} onchange="syncLiveSelection(${index})">
          <span>${escapeHtml(file.path)}</span>
        </label>
      `).join("")
    : `<div class="meta">No normalized videos found yet in Go Live/${escapeHtml(channel.name || "")}. Normalize videos first, then click Refresh.</div>`;
  const open = state.activeSettingsChannelIndex === index ? "open" : "";
  return `
    <details class="card channel-settings" data-index="${index}" ${open}>
      <summary class="channel-summary">
        <span class="channel-name">${escapeHtml(channel.name || `channel_${index + 1}`)}</span>
        <span class="badge">${channel.enabled !== false ? "Enabled" : "Disabled"}</span>
      </summary>
      <div class="channel-body">
        <div class="row wrap">
          <button class="pill" type="button" onclick="startSettingsTask('test-stream', ${index})">Test Stream</button>
          <button class="pill danger small" type="button" onclick="removeChannel(${index})">Remove Channel</button>
        </div>
        <div class="form-grid">
          ${channelInput("name", "Channel name", channel.name || "")}
          ${channelInput("stream_key_env", "Stream key", channel.stream_key_env || "", "text", "")}
          ${channelYoutubeAccountSelect(channel.youtube_account_id || "")}
          ${channelInput("youtube_studio_url", "YouTube Studio URL", channel.youtube_studio_url || "")}
        </div>
        <div class="nested-card">
          <div class="section-head compact">
            <div>
              <h3>FFmpeg Output Controls</h3>
              <p class="helper">Copy mode keeps near-zero CPU. Transcode mode applies controlled bitrate/FPS/resolution for YouTube ingest.</p>
            </div>
          </div>
          <div class="form-grid mode-selector-row">
            ${liveSelect("mode", "Output mode", liveMode, ["copy", "transcode"], "Copy = lowest PC load. Transcode = full control over output quality.", `syncLiveMode(${index}, this.value)`)}
          </div>
          <div class="live-mode-panels">
            <section class="live-mode-panel ${isTranscode ? "" : "active"}" data-live-mode-panel="copy">
              <h4>Copy Output</h4>
              <p class="setting-note">FFmpeg forwards normalized media directly with <code>-c copy</code> for minimal CPU usage.</p>
              <div class="mode-output-list">
                <div><strong>Video output:</strong> copied from normalized file</div>
                <div><strong>Audio output:</strong> copied from normalized file</div>
                <div><strong>Resolution/FPS:</strong> inherited from normalized file</div>
                <div><strong>Best for:</strong> stable low-load streaming when files are already normalized</div>
              </div>
            </section>
            <section class="live-mode-panel ${isTranscode ? "active" : ""}" data-live-mode-panel="transcode">
              <h4>Transcode Output</h4>
              <div class="form-grid">
                ${liveSelect("video_encoder", "Video encoder", profile.video_encoder || "libx264", ["libx264", "h264_nvenc", "h264_amf", "h264_qsv"], "Pick the engine your PC handles best. If stream stutters, try another.")}
                ${liveInput("preset", "Preset", profile.preset || "veryfast", "text", "Faster preset = lighter load, softer picture. Slower = sharper picture, heavier load.")}
                ${liveInput("profile", "H.264 profile", profile.profile || "high", "text", "Usually keep High. Change only if a platform/device asks for it.")}
                ${liveInput("pixel_format", "Pixel format", profile.pixel_format || "yuv420p", "text", "Keep yuv420p for broad playback compatibility.")}
                ${liveInput("fps", "FPS", profile.fps ?? 30, "number", "Higher feels smoother but needs more upload and PC power.")}
                ${liveInput("width", "Width", profile.width ?? 1920, "number", "Higher width looks clearer but needs more bitrate.")}
                ${liveInput("height", "Height", profile.height ?? 1080, "number", "Higher height looks clearer but needs more bitrate.")}
                ${liveInput("video_bitrate", "Video bitrate", profile.video_bitrate || "6800k", "text", "Main picture quality knob. Higher = clearer, but uses more internet.")}
                ${liveInput("minrate", "Min rate", profile.minrate || "6800k", "text", "Raise this to keep quality steady and avoid sudden drops.")}
                ${liveInput("maxrate", "Max rate", profile.maxrate || "6800k", "text", "Cap for peaks. Keep near video bitrate for stable streaming.")}
                ${liveInput("bufsize", "Buffer size", profile.bufsize || "13600k", "text", "Bigger buffer smooths spikes; too small can cause bitrate swings.")}
                ${liveInput("gop_seconds", "Keyframe interval (sec)", profile.gop_seconds ?? 2, "number", "How often a full frame is sent. 2 seconds is safest for live.")}
                ${liveInput("audio_codec", "Audio codec", profile.audio_codec || "aac", "text", "AAC is the common safe choice for streaming platforms.")}
                ${liveInput("audio_bitrate", "Audio bitrate", profile.audio_bitrate || "128k", "text", "Higher = cleaner sound; music usually benefits from 160k or more.")}
                ${liveInput("audio_sample_rate", "Audio sample rate", profile.audio_sample_rate ?? 44100, "number", "Use 44100 or 48000 for stable, standard audio.")}
                ${liveInput("audio_channels", "Audio channels", profile.audio_channels ?? 2, "number", "2 = stereo (recommended). 1 = mono and uses less bitrate.")}
              </div>
            </section>
          </div>
          <div class="meta" data-live-mode-status>${isTranscode ? "Transcode mode is enabled for this channel." : "Copy mode is enabled for this channel."}</div>
        </div>
        <div class="live-playlist-picker">
          <div class="section-head compact">
            <span>Live playlist override</span>
            <div class="row wrap">
              <button class="pill ghost small" type="button" onclick="selectAllLiveFiles(${index})">Select All</button>
              <button class="pill ghost small" type="button" onclick="clearLiveFiles(${index})">Clear</button>
              <button class="pill ghost small" type="button" onclick="refreshLiveFiles(${index}).catch((error) => toast(error.message))">Refresh</button>
            </div>
          </div>
          <div class="file-list">${fileOptions}</div>
          <div class="meta">Choose the exact normalized videos to go live with. Clear all to use the whole channel folder.</div>
        </div>
        <div class="switch-row">
          ${checkboxInput("enabled", "Enabled", channel.enabled !== false)}
          ${checkboxInput("loop", "Loop playlist", channel.loop !== false)}
          ${checkboxInput("restart_on_exit", "Restart if stream exits", channel.restart_on_exit !== false)}
          ${checkboxInput("youtube_auto_start", "YouTube Auto Start confirmed", Boolean(channel.youtube_auto_start))}
          ${checkboxInput("youtube_auto_stop", "YouTube Auto Stop confirmed", Boolean(channel.youtube_auto_stop))}
        </div>
      </div>
    </details>
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

  config.channels = Array.from(document.querySelectorAll("#channelSettings .channel-settings")).map((card) => {
    const index = Number(card.dataset.index);
    const channel = {};
    const existingChannel = config.channels?.[index] || {};
    card.querySelectorAll("[data-channel-field]").forEach((input) => {
      const field = input.dataset.channelField;
      if (input.type === "checkbox") {
        channel[field] = input.checked;
      } else if (input.value !== "") {
        channel[field] = input.value;
      }
    });

    channel.live_profile = { ...defaultLiveProfile(), ...(existingChannel.live_profile || {}) };
    card.querySelectorAll("[data-live-profile-field]").forEach((input) => {
      channel.live_profile[input.dataset.liveProfileField] = coerceValue(input.value, input.type);
    });

    const checkedRawFiles = Array.from(
      document.querySelectorAll(`#normalizationChannels [data-index="${index}"] [data-raw-file]:checked`)
    ).map((input) => input.dataset.rawFile);
    const rawFileInputs = document.querySelectorAll(`#normalizationChannels [data-index="${index}"] [data-raw-file]`);
    const existingRawPlaylist = Array.isArray(config.channels?.[index]?.raw_playlist)
      ? config.channels[index].raw_playlist
      : [];
    channel.raw_playlist = rawFileInputs.length ? checkedRawFiles : existingRawPlaylist;

    channel.normalize_profile = {};
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
    if (typeof existingChannel.stream_key === "string" && !channel.stream_key) {
      channel.stream_key = existingChannel.stream_key;
    }

    return channel;
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
        `Channel "${channelName}": do not paste full RTMP URL in "Stream key". `
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

async function saveConfig() {
  const data = JSON.parse($("configEditor").value);
  await saveConfigData(data);
  toast("Advanced JSON saved.");
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

function addChannel() {
  const config = state.configData || defaultConfigData();
  config.channels = Array.isArray(config.channels) ? config.channels : [];
  config.channels.push(defaultChannel(config.channels.length + 1));
  state.activeSettingsChannelIndex = config.channels.length - 1;
  state.configData = config;
  $("configEditor").value = JSON.stringify(config, null, 2) + "\n";
  renderSettingsForms();
}

function removeChannel(index) {
  const config = state.configData || defaultConfigData();
  config.channels = (config.channels || []).filter((_channel, currentIndex) => currentIndex !== index);
  state.activeSettingsChannelIndex = Math.max(0, Math.min(index, config.channels.length - 1));
  state.configData = config;
  $("configEditor").value = JSON.stringify(config, null, 2) + "\n";
  renderSettingsForms();
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
  state.activeTab = tab;
  $("tabControl").classList.toggle("active", tab === "control");
  $("tabSettings").classList.toggle("active", tab === "settings");
  $("viewControl").classList.toggle("active", tab === "control");
  $("viewSettings").classList.toggle("active", tab === "settings");
}

function showSettingsTab(tab) {
  state.settingsTab = tab;
  $("settingsFoldersTab").classList.toggle("active", tab === "folders");
  $("settingsNormalizeTab").classList.toggle("active", tab === "normalize");
  $("settingsLiveTab").classList.toggle("active", tab === "live");
  $("settingsYoutubeTab").classList.toggle("active", tab === "youtube");
  $("settingsFoldersView").classList.toggle("active", tab === "folders");
  $("settingsNormalizeView").classList.toggle("active", tab === "normalize");
  $("settingsLiveView").classList.toggle("active", tab === "live");
  $("settingsYoutubeView").classList.toggle("active", tab === "youtube");
  if (tab === "youtube") {
    refreshYoutubeStatus()
      .then(() => {
        if (!state.youtubeStatus?.connected) {
          state.youtubeBroadcasts = [];
          state.youtubeKeyChecks = null;
          renderYoutubeSettingsPanel(state.configData || defaultConfigData());
          return;
        }
        return refreshYoutubeBroadcasts().then(() => verifyYoutubeChannelKeys());
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
$("settingsLiveTab").addEventListener("click", () => showSettingsTab("live"));
if ($("activityFilterAll")) $("activityFilterAll").addEventListener("click", () => setActivityFilter("all"));
if ($("activityFilterTasks")) $("activityFilterTasks").addEventListener("click", () => setActivityFilter("tasks"));
if ($("activityFilterApi")) $("activityFilterApi").addEventListener("click", () => setActivityFilter("api"));
if ($("activityFilterErrors")) $("activityFilterErrors").addEventListener("click", () => setActivityFilter("errors"));
if ($("settingsYoutubeTab")) {
  $("settingsYoutubeTab").addEventListener("click", () => showSettingsTab("youtube"));
}

if ($("configSelect")) {
  $("configSelect").addEventListener("change", async (event) => {
    state.config = event.target.value;
    await refresh();
    await loadConfigText();
  });
}

if ($("createConfig")) {
  $("createConfig").addEventListener("click", () => createConfig().catch((error) => toast(error.message)));
}
if ($("reload")) {
  $("reload").addEventListener("click", () => refresh().then(loadConfigText).catch((error) => toast(error.message)));
}
$("saveConfig").addEventListener("click", () => saveConfig().catch((error) => toast(error.message)));
$("saveSettings").addEventListener("click", () => saveSettings().catch((error) => toast(error.message)));
$("addChannel").addEventListener("click", addChannel);
$("addChannelNormalize").addEventListener("click", addChannel);
$("refreshRawFiles").addEventListener("click", () => loadRawFiles().catch((error) => toast(error.message)));
$("startAll").addEventListener("click", () => startStream().catch((error) => toast(error.message)));
$("stopAll").addEventListener("click", () => stopStream().catch((error) => toast(error.message)));
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

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  const payload = event.data || {};
  if (payload.type !== "youtube-auth") return;
  if (payload.status === "ok") {
    refreshYoutubeStatus()
      .then(() => refreshYoutubeBroadcasts())
      .then(() => toast("YouTube account connected."))
      .catch((error) => toast(error.message));
    return;
  }
  if (payload.status === "error") {
    toast(payload.message || "YouTube connection failed.");
  }
});

showSettingsTab(state.settingsTab);
initActivityStreamSplitter();
initDesktopIntegration().catch(() => {});
refresh().then(loadConfigText).catch((error) => toast(error.message));
setInterval(() => refresh().catch((error) => toast(error.message)), 2500);
