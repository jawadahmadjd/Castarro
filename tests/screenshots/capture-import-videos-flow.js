const { chromium } = require("playwright");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const PORT = 8765;
const URL = `http://127.0.0.1:${PORT}`;
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.join(ROOT, "tests", "screenshots", `import-videos-flow-${STAMP}`);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function request(endpoint, method = "GET", body = null) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${URL}${endpoint}`,
      {
        method,
        headers: data
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
            return;
          }
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            resolve(raw);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(4000, () => req.destroy(new Error("request timeout")));
    if (data) req.write(data);
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

function makeConfig() {
  const ffmpeg = path.join(ROOT, "desktop", "resources", "ffmpeg", "ffmpeg.exe");
  const ffprobe = path.join(ROOT, "desktop", "resources", "ffmpeg", "ffprobe.exe");
  return {
    defaults: {
      ffmpeg_path: fs.existsSync(ffmpeg) ? ffmpeg : "ffmpeg",
      ffprobe_path: fs.existsSync(ffprobe) ? ffprobe : "ffprobe",
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
        name: "Demo Live",
        enabled: true,
        stream_key_env: "YT_DEMO_LIVE_KEY",
        raw_playlist: [],
        playlist: [],
        cloud_playlist: [],
        youtube_auto_start: true,
        youtube_auto_stop: true,
        youtube_dual_stream: true,
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
  fs.mkdirSync(path.join(tempRoot, "Go Live", "Demo Live"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "Raw Videos", "Demo Live"), { recursive: true });
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

async function preparePage(page) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#channelWorkspaceRail:not(.hidden)", { timeout: 15000 });
  await page.evaluate(() => {
    setWorkspaceSelectedChannel("Demo Live");
    syncActiveSettingsChannelFromWorkspace(false);
    state.youtubeExpandedCards = {
      ...(state.youtubeExpandedCards || {}),
      "youtube-videos-Demo Live": true,
    };
    state.youtubeStatus = {
      connected: false,
      connected_count: 0,
      accounts: [],
      has_client_credentials: false,
    };
    state.normalizedFilesByChannel["Demo Live"] = [];
    state.workspace.activeRoute = "youtube";
    renderChannelWorkspace(state.status || {});
    renderYoutubeSettingsPanel(state.configData || defaultConfigData());
  });
  await page.waitForSelector(".selected-live-videos[open]", { timeout: 15000 });
  await page.locator(".selected-live-videos").scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
}

async function setImportState(page, progress, files = []) {
  await page.evaluate(({ progressState, fileItems }) => {
    const channel = state.configData.channels.find((item) => item.name === "Demo Live");
    if (channel) {
      channel.playlist = fileItems.map((item) => item.path);
    }
    state.normalizedFilesByChannel["Demo Live"] = fileItems;
    state.liveUploadBusyChannel = progressState ? "Demo Live" : "";
    state.liveImportProgress = progressState;
    const payload = state.status || {};
    renderStatus(payload);
    renderWorkspaceHeader(payload, (payload.channels || []).find((item) => item.name === "Demo Live") || channel);
    renderYoutubeSettingsPanel(state.configData || defaultConfigData());
  }, { progressState: progress, fileItems: files });
  await page.waitForSelector(".selected-live-videos[open]", { timeout: 15000 });
  await page.locator(".selected-live-videos").scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
}

async function capture(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

async function captureFlow(page) {
  await preparePage(page);
  await capture(page, "01-before-import");

  await setImportState(page, {
    channel: "Demo Live",
    current: 0,
    total: 4,
    fileName: "opening-loop.mp4",
    action: "Copying",
  });
  await capture(page, "02-copying-1-of-4");

  await setImportState(page, {
    channel: "Demo Live",
    current: 1,
    total: 4,
    fileName: "midroll-clean.mp4",
    action: "Copying",
  });
  await capture(page, "03-copying-2-of-4-start-disabled");

  const copiedFiles = [
    { name: "opening-loop.mp4", path: "Go Live/Demo Live/opening-loop.mp4", duration_seconds: 3661, exists: true },
    { name: "midroll-clean.mp4", path: "Go Live/Demo Live/midroll-clean.mp4", duration_seconds: 1844, exists: true },
    { name: "teaching-block.mp4", path: "Go Live/Demo Live/teaching-block.mp4", duration_seconds: 2760, exists: true },
    { name: "closing-screen.mp4", path: "Go Live/Demo Live/closing-screen.mp4", duration_seconds: 615, exists: true },
  ];
  await setImportState(page, null, copiedFiles);
  await page.evaluate(() => {
    toast("Copied 4 videos to Go Live / Demo Live.");
  });
  await capture(page, "04-after-copy-complete");

  const originalFiles = [
    { name: "playlist-01.mp4", path: "D:\\User Videos\\Going Live\\playlist-01.mp4", duration_seconds: 1200, exists: true },
    { name: "playlist-02.mp4", path: "D:\\User Videos\\Going Live\\playlist-02.mp4", duration_seconds: 1320, exists: true },
    { name: "playlist-03.mp4", path: "D:\\User Videos\\Going Live\\playlist-03.mp4", duration_seconds: 1450, exists: true },
  ];
  await setImportState(page, {
    channel: "Demo Live",
    current: 0,
    total: 3,
    fileName: "playlist-01.mp4",
    action: "Adding",
  }, originalFiles);
  await capture(page, "05-same-folder-original-paths");
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "castarro-import-flow-"));
  writeFixtureData(tempRoot);
  const server = startServer(tempRoot);
  const stderr = [];
  server.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await captureFlow(page);
    await browser.close();
    console.log(`import videos flow screenshots: ${OUT_DIR}`);
  } finally {
    await stopServer(server);
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    } catch (error) {
      console.warn(`Could not remove temp capture root ${tempRoot}: ${error.message}`);
    }
    if (stderr.length) {
      fs.writeFileSync(path.join(OUT_DIR, "server.stderr.log"), stderr.join(""), "utf8");
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
