const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const PORT = process.env.STORAGE_UI_PORT || "8794";
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
          let parsed = {};
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            parsed = { raw: text };
          }
          if ((res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300) {
            resolve(parsed);
          } else {
            const err = new Error(parsed.error || `HTTP ${res.statusCode}`);
            err.statusCode = res.statusCode;
            err.payload = parsed;
            reject(err);
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
      providers: [
        {
          id: "google-drive-main",
          type: "googleDrive",
          display_name: "Google Drive",
          auth_mode: "oauth",
          tokens_file: ".runtime/google_drive_tokens_google-drive-main.json",
          account_email: "",
          status: "",
          oauth: {
            client_id: "desktop-client-id.apps.googleusercontent.com",
            client_secret: "",
            redirect_uri: "http://127.0.0.1:8765/oauth2redirect",
            oauth_client_type: "desktop",
            use_pkce: true,
            scopes: [
              "https://www.googleapis.com/auth/drive.readonly",
              "https://www.googleapis.com/auth/userinfo.email",
            ],
          },
        },
      ],
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
        name: "Drive Channel",
        enabled: true,
        stream_key_env: "YT_DRIVE_CHANNEL_KEY",
        raw_playlist: ["Raw Videos/Drive Channel/source.mp4"],
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
  const rawDir = path.join(tempRoot, "Raw Videos", "Drive Channel");
  const goLiveDir = path.join(tempRoot, "Go Live", "Drive Channel");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(goLiveDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, "source.mp4"), Buffer.from("fixture", "utf8"));
  fs.writeFileSync(path.join(goLiveDir, "ready-local.mp4"), Buffer.from("fixture", "utf8"));
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

async function showStorageScreenshot(page) {
  await page.evaluate(async () => {
    showTab("settings");
    showSettingsTab("storage");
    state.storageStatus = {
      ok: true,
      source_proxy: {
        host: "127.0.0.1",
        port: 8876,
        cache_dir: ".runtime/cloud-cache",
        startup_buffer_mb: 64,
        max_cache_mb: 2048,
        spool_before_start: false,
      },
      providers: [
        {
          id: "google-drive-main",
          type: "googleDrive",
          display_name: "Google Drive",
          connected: true,
          status: "connected",
          tokens_present: true,
          account_email: "drive-owner@example.com",
          message: "Connected as drive-owner@example.com.",
        },
      ],
    };
    renderSettingsForms();
  });
  await page.waitForSelector("#storageSettingsPanel .storage-provider-card");
  await page.getByText("Google client ID").waitFor();
  await page.screenshot({ path: path.join(OUT_DIR, "workspace-storage-google-drive.png"), fullPage: true });
}

async function showCloudBrowserScreenshot(page) {
  await page.evaluate(() => {
    setWorkspaceSelectedChannel("Drive Channel");
    state.workspace.selectedChannelName = "Drive Channel";
    const channel = state.configData.channels[0];
    channel.playlist = [];
    channel.cloud_playlist = [
      {
        provider_id: "google-drive-main",
        file_id: "drive-file-ready",
        display_name: "ready-video.mp4",
        mime_type: "video/mp4",
        size_bytes: 734003200,
        compatibility_status: "ready",
        compatibility_message: "Ready to stream",
      },
      {
        provider_id: "google-drive-main",
        file_id: "drive-file-hevc",
        display_name: "hevc-video.mp4",
        mime_type: "video/mp4",
        size_bytes: 524288000,
        compatibility_status: "needsDesktopPrep",
        compatibility_message: "This video is not H.264/AAC and cannot be streamed in copy mode.",
      },
    ];
    state.storageStatus = {
      ok: true,
      source_proxy: {
        host: "127.0.0.1",
        port: 8876,
        cache_dir: ".runtime/cloud-cache",
        startup_buffer_mb: 64,
        max_cache_mb: 2048,
        spool_before_start: false,
      },
      providers: [
        {
          id: "google-drive-main",
          type: "googleDrive",
          display_name: "Google Drive",
          connected: true,
          status: "connected",
          tokens_present: true,
          account_email: "drive-owner@example.com",
          message: "Connected as drive-owner@example.com.",
        },
      ],
    };
    state.cloudBrowser = {
      open: true,
      channelIndex: 0,
      providerId: "google-drive-main",
      folderId: "root",
      folderName: "My Drive",
      parentId: "",
      loading: false,
      error: "",
      addingFileId: "",
      items: [
        { id: "folder-news", name: "News Clips", kind: "folder", canDownload: false },
        { id: "video-ready-2", name: "ready-clip.mp4", kind: "video", mimeType: "video/mp4", sizeBytes: 214748364, canDownload: true },
        { id: "video-raw", name: "raw-hevc.mp4", kind: "video", mimeType: "video/mp4", sizeBytes: 314572800, canDownload: true },
      ],
    };
    showTab("settings");
    showSettingsTab("youtube");
    renderSettingsForms();
  });
  await page.getByRole("heading", { name: "Cloud Videos" }).waitFor();
  await page.getByText("ready-video.mp4").waitFor();
  await page.getByText("hevc-video.mp4").waitFor();
  await page.getByText("Reconnect Google Drive before starting this cloud playlist.").count().catch(() => {});
  await page.screenshot({ path: path.join(OUT_DIR, "workspace-cloud-videos-google-drive.png"), fullPage: true });
}

async function runAssertions(page) {
  await page.getByRole("heading", { name: "Storage" }).count().catch(() => {});
  const clientIdField = page.locator('[data-storage-provider-oauth-field="client_id"]');
  assert.equal(await clientIdField.count() > 0, true);
  const cloudHeading = page.getByRole("heading", { name: "Cloud Videos" });
  assert.equal(await cloudHeading.count() > 0, true);
  const readyItem = page.getByText("ready-video.mp4");
  const blockedItem = page.getByText("hevc-video.mp4");
  assert.equal(await readyItem.count() > 0, true);
  assert.equal(await blockedItem.count() > 0, true);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "castarro-storage-ui-"));
  writeFixtureData(tempRoot);

  const server = startServer(tempRoot);
  const stderr = [];
  server.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1490, height: 940 } });
    const page = await context.newPage();
    await gotoApp(page);
    await showStorageScreenshot(page);
    await showCloudBrowserScreenshot(page);
    await runAssertions(page);
    await browser.close();
    console.log("capture-storage-cloud-ui: PASS");
  } finally {
    await stopServer(server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (stderr.length) {
      fs.writeFileSync(path.join(OUT_DIR, "capture-storage-cloud-ui.stderr.log"), stderr.join(""), "utf8");
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
