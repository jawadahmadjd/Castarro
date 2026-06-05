const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const PORT = process.env.CHANNEL_FIRST_UI_PORT || "8791";
const URL = `http://127.0.0.1:${PORT}`;
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const LABEL = process.argv[2] || "capture";
const OUT_DIR = path.join(ROOT, "tests", "screenshots", `channel-first-${LABEL}-${STAMP}`);

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
          let parsed = {};
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            parsed = { raw: text };
          }
          if ((res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          }
        });
      }
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
      await wait(350);
    }
  }
  throw new Error(`Server did not start at ${URL}`);
}

function makeChannel(index) {
  const names = [
    "Inside Us",
    "Daily Tech",
    "Noor Studio",
    "Kitchen Live",
    "Study Room",
    "Evening Show",
    "Sports Desk",
    "Kids Corner",
    "City Updates",
    "Faith Stream",
    "Music Hour",
    "Archive Loop",
  ];
  const name = names[index] || `Channel ${index + 1}`;
  const accountId = `acct-${index + 1}`;
  return {
    name,
    enabled: index !== 11,
    stream_key_env: `YT_CHANNEL_${index + 1}_KEY`,
    raw_playlist: [`Raw Videos/${name}/video-${index + 1}.mp4`],
    playlist: index % 3 === 0 ? [`Go Live/${name}/ready-${index + 1}.mp4`] : [],
    youtube_auto_start: true,
    youtube_auto_stop: index % 4 !== 0,
    youtube_account_id: index < 9 ? accountId : "",
    youtube_studio_url: "",
    youtube_broadcast_id: "",
    youtube_stream_id: "",
    loop: true,
    restart_on_exit: true,
  };
}

function makeConfig() {
  const channels = Array.from({ length: 12 }, (_unused, index) => makeChannel(index));
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
    youtube: {
      client_id: "",
      client_secret: "",
      oauth_client_type: "desktop",
      use_pkce: true,
      redirect_uri: "http://127.0.0.1:8765/oauth2redirect",
      tokens_file: ".runtime/youtube_tokens.json",
      accounts: channels.slice(0, 9).map((channel, index) => ({
        id: `acct-${index + 1}`,
        label: `${channel.name} Account`,
        tokens_file: `.runtime/youtube_tokens_${index + 1}.json`,
        expected_channel_name: channel.name,
      })),
      default_account_id: "acct-1",
      default_privacy_status: "unlisted",
      default_auto_start: true,
      default_auto_stop: true,
    },
    ui: {
      channel_workspace_enabled: true,
      legacy_tabs_enabled: false,
    },
    channels,
  };
}

function writeFixtureData(tempRoot) {
  const configPath = path.join(tempRoot, "config.ready.json");
  const config = makeConfig();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  for (const channel of config.channels) {
    const rawDir = path.join(tempRoot, "Raw Videos", channel.name);
    const goLiveDir = path.join(tempRoot, "Go Live", channel.name);
    fs.mkdirSync(rawDir, { recursive: true });
    fs.mkdirSync(goLiveDir, { recursive: true });
    fs.writeFileSync(path.join(rawDir, "video-1.mp4"), Buffer.from("fixture", "utf8"));
    fs.writeFileSync(path.join(goLiveDir, "ready-1.mp4"), Buffer.from("fixture", "utf8"));
  }
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

async function gotoApp(page, width = 1490, height = 940) {
  await page.setViewportSize({ width, height });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#channelWorkspaceRail:not(.hidden), .app-sidebar", { timeout: 15000 });
  await page.waitForTimeout(500);
}

async function openRoute(page, route) {
  await page.evaluate(async (routeName) => {
    if (typeof setWorkspaceRoute === "function") {
      setWorkspaceRoute(routeName);
      return;
    }
    const legacy = {
      overview: () => showTab("control"),
      folders: () => { showTab("settings"); showSettingsTab("folders"); },
      encoder: () => { showTab("settings"); showSettingsTab("normalize"); },
      youtube: () => { showTab("settings"); showSettingsTab("youtube"); },
      history: () => { showTab("settings"); showSettingsTab("liveHistory"); },
      troubleshoot: () => { showTab("settings"); showSettingsTab("troubleshooting"); },
    };
    legacy[routeName]?.();
  }, route);
  await page.waitForTimeout(650);
}

async function capture(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

async function captureAll(page) {
  await gotoApp(page);
  await page.evaluate(() => {
    setWorkspaceSelectedChannel("Inside Us");
    syncActiveSettingsChannelFromWorkspace(false);
    renderChannelWorkspace(state.status || {});
  });
  const routes = [
    ["01-overview-desktop", "overview"],
    ["02-folders-desktop", "folders"],
    ["03-encoder-desktop", "encoder"],
    ["04-youtube-desktop", "youtube"],
    ["05-history-desktop", "history"],
    ["06-troubleshoot-desktop", "troubleshoot"],
  ];
  for (const [name, route] of routes) {
    await openRoute(page, route);
    await capture(page, name);
  }

  await gotoApp(page, 760, 980);
  await openRoute(page, "overview");
  await capture(page, "07-overview-narrow");
  await openRoute(page, "youtube");
  await capture(page, "08-youtube-narrow");

  const report = await page.evaluate(() => {
    const apiCalls = [];
    const originalApi = api;
    api = async (path, options = {}) => {
      apiCalls.push({
        path,
        method: options.method || "GET",
        action: options.action || "",
        body: options.body || "",
      });
      if (String(path).startsWith("/api/stream/start")) return { ok: true };
      if (String(path).startsWith("/api/stream/stop")) return { ok: true };
      if (String(path).startsWith("/api/task/start")) return { ok: true };
      if (String(path).startsWith("/api/youtube/verify-channel-keys")) return { checks: [] };
      if (String(path).startsWith("/api/config/save")) return { ok: true };
      if (String(path).startsWith("/api/status")) return state.status || {};
      if (String(path).startsWith("/api/raw-files")) return { files: [] };
      if (String(path).startsWith("/api/normalized-files")) return { files: [] };
      return {};
    };
    return Promise.resolve()
      .then(() => startStream("Inside Us"))
      .then(() => stopStream("Inside Us"))
      .then(() => startTask("validate", "Inside Us", false))
      .then(() => verifyYoutubeChannelKeys("Inside Us"))
      .then(() => saveSettings())
      .catch((error) => ({ error: String(error?.message || error) }))
      .then((result) => {
        api = originalApi;
        return { result, apiCalls };
      });
  });
  fs.writeFileSync(path.join(OUT_DIR, "behavior-contract.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "castarro-channel-first-"));
  writeFixtureData(tempRoot);
  const server = startServer(tempRoot);
  const stderr = [];
  server.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await captureAll(page);
    await browser.close();
    console.log(`channel-first-ui screenshots: ${OUT_DIR}`);
  } finally {
    await stopServer(server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (stderr.length) {
      fs.writeFileSync(path.join(OUT_DIR, "server.stderr.log"), stderr.join(""), "utf8");
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
