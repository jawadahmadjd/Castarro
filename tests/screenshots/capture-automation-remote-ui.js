const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const PORT = process.env.AUTOMATION_UI_PORT || "8796";
const URL = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(ROOT, "tests", "screenshots");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(pathname, method = "GET", payload = null) {
  return new Promise((resolve, reject) => {
    const body = payload ? Buffer.from(JSON.stringify(payload), "utf8") : null;
    const req = http.request(
      `${URL}${pathname}`,
      {
        method,
        headers: body
          ? {
              "Content-Type": "application/json",
              "Content-Length": String(body.length),
            }
          : {},
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          try {
            resolve(text ? JSON.parse(text) : {});
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(4000, () => req.destroy(new Error("request timeout")));
    if (body) req.write(body);
    req.end();
  });
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await request("/api/status");
      return;
    } catch {
      await wait(300);
    }
  }
  throw new Error(`Server did not start at ${URL}`);
}

function makeConfig() {
  return {
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
    live_profile: {
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
    },
    alerts: {
      desktop_notifications_enabled: true,
      mobile_notifications_enabled: true,
      cooldown_seconds: 300,
      rules: {
        stream_stopped: true,
        poor_connection: true,
        scheduler_started: true,
        scheduler_stopped: true,
      },
    },
    scheduler: {
      enabled: true,
      timezone: "local",
      poll_seconds: 20,
      channels: [
        {
          channel: "Inside Us",
          enabled: true,
          start_time: "09:00",
          stop_time: "17:00",
          days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        },
      ],
    },
    youtube: {
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
    },
    storage: {
      providers: [],
      source_proxy: {
        host: "127.0.0.1",
        port: 8876,
        cache_dir: ".runtime/cloud-cache",
        startup_buffer_mb: 64,
        max_cache_mb: 2048,
        spool_before_start: false,
      },
    },
    ui: {
      channel_workspace_enabled: true,
      legacy_tabs_enabled: false,
    },
    channels: [
      {
        name: "Inside Us",
        enabled: true,
        stream_key_env: "YT_INSIDE_US_KEY",
        raw_playlist: ["Raw Videos/Inside Us/episode-1.mp4"],
        playlist: [],
        cloud_playlist: [],
        youtube_auto_start: true,
        youtube_auto_stop: true,
        youtube_account_id: "",
        youtube_studio_url: "",
        youtube_broadcast_id: "",
        youtube_stream_id: "",
        loop: true,
        restart_on_exit: true,
      },
    ],
  };
}

function writeFixtureData(tempRoot) {
  fs.writeFileSync(path.join(tempRoot, "config.ready.json"), JSON.stringify(makeConfig(), null, 2) + "\n", "utf8");
  const rawDir = path.join(tempRoot, "Raw Videos", "Inside Us");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, "episode-1.mp4"), Buffer.from("fixture", "utf8"));
}

function startServer(tempRoot) {
  const env = {
    ...process.env,
    STREAM_UI_PORT: PORT,
    STREAM_APP_DATA_DIR: tempRoot,
    STREAM_APP_CODE_DIR: ROOT,
    STREAM_WEB_ROOT: path.join(ROOT, "web"),
    STREAM_DISABLE_AUTO_UPDATE: "1",
  };
  return spawn("python", ["scripts/web_ui.py"], {
    cwd: ROOT,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try {
    await request("/api/system/shutdown", "POST", { stop_streams: true, stop_tasks: true });
  } catch {
    // best effort
  }
  await wait(800);
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      killer.on("exit", () => resolve());
    });
    return;
  }
  child.kill("SIGTERM");
}

async function seedUiState(page) {
  await page.evaluate(() => {
    state.workspace.selectedChannelName = "Inside Us";
    state.syncStatus = {
      devices: [
        {
          deviceName: "Pixel 9 Pro",
          platform: "android",
          pairedAt: "2026-06-14T09:05:00Z",
          lastSeenAt: "2026-06-14T09:17:00Z",
        },
      ],
      syncServer: {
        host: "192.168.0.15",
        port: 8768,
        running: true,
      },
    };
    state.status = {
      ...state.status,
      channels: [
        {
          name: "Inside Us",
          enabled: true,
          playlist_count: 1,
          cloud_playlist_count: 0,
          normalized_count: 1,
          raw_playlist_count: 1,
          stream_key_env: "YT_INSIDE_US_KEY",
          stream_key_env_has_value: true,
          has_inline_key: false,
          stream_key_masked: "",
          youtube_auto_start: true,
          youtube_auto_stop: true,
          youtube_account_id: "",
          youtube_studio_url: "",
        },
      ],
      streams: {
        "Inside Us": {
          name: "Inside Us",
          pid: 4242,
          running: true,
          returncode: null,
          started_at: Date.now() / 1000,
          log_path: "logs/inside-us.log",
          log_tail: "",
          transferred_bytes: 18874368,
          stream_stats: {
            available: true,
            target_fps: 30,
            output_fps: 28.5,
            speed: 0.95,
            average_bitrate_bps: 5800000,
            total_size_bytes: 18874368,
            drop_frames: 4,
            dup_frames: 0,
            health_tone: "warn",
            health_label: "Watch",
            detail: "Stream is running, but frame delivery is below target or frames are being dropped.",
            youtube_ingest_detail: "These metrics show what FFmpeg is sending from desktop.",
          },
          preview_url: null,
          preview_ready: false,
          preview_warning: null,
        },
      },
      alerts: {
        desktop_notifications_enabled: true,
        mobile_notifications_enabled: true,
        cooldown_seconds: 300,
        recent: [
          {
            id: 91,
            channel_name: "Inside Us",
            severity: "danger",
            title: "Inside Us connection needs attention",
            message: "Stream is running, but frame delivery is below target.",
            created_at: "2026-06-14T09:16:00Z",
            desktop_enabled: true,
            mobile_enabled: true,
          },
          {
            id: 90,
            channel_name: "Inside Us",
            severity: "info",
            title: "Scheduler started Inside Us",
            message: "Daily schedule opened at 9:00 AM.",
            created_at: "2026-06-14T09:00:00Z",
            desktop_enabled: true,
            mobile_enabled: true,
          },
        ],
      },
      scheduler: {
        enabled: true,
        timezone: "local",
        timezone_label: "PKT (+05:00)",
        poll_seconds: 20,
        channels: [
          {
            channel: "Inside Us",
            enabled: true,
            start_time: "09:00",
            stop_time: "17:00",
            days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            in_window: true,
            running: true,
            controlled_run: true,
            last_action: "started",
            next_start_at: "2026-06-15T09:00:00+05:00",
            next_stop_at: "2026-06-14T17:00:00+05:00",
          },
        ],
      },
      stream_history: [
        {
          id: 7,
          channel_name: "Inside Us",
          live_title: "Inside Us",
          status: "running",
          returncode: null,
          transferred_bytes: 18874368,
          started_at: "2026-06-14T09:00:00Z",
          stopped_at: "",
          is_active: true,
        },
      ],
      tasks: [],
      activity_events: [],
      usage: {
        stream_transfer_today_bytes: 18874368,
        active_stream_transfer_bytes: 18874368,
        battery_today: {
          status: "unavailable",
          label: "Unavailable",
          detail: "Unavailable",
        },
      },
    };
    renderSyncPanel();
    renderChannelWorkspace(state.status);
  });
}

async function capture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "castarro-automation-ui-"));
  writeFixtureData(tempRoot);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = startServer(tempRoot);
  const browser = await chromium.launch();
  try {
    await waitForServer();
    const page = await browser.newPage({ viewport: { width: 1480, height: 1100 } });
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.waitForSelector("#channelWorkspaceRail:not(.hidden)");
    await page.waitForTimeout(500);
    await seedUiState(page);
    await page.screenshot({ path: path.join(OUT_DIR, "workspace-alerts-remote.png"), fullPage: true });
    await page.evaluate(() => {
      showTab("settings");
      showSettingsTab("automation");
      renderAutomationSettingsPanel(state.configData || defaultConfigData());
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, "workspace-automation-settings.png"), fullPage: true });
  } finally {
    await browser.close();
    await stopServer(server);
  }
}

capture().catch((error) => {
  console.error(error);
  process.exit(1);
});
