const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "tests", "screenshots");
const PORT = "8787";
const URL = `http://127.0.0.1:${PORT}`;

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
      rate_control: "cbr",
      video_bitrate: "6000k",
      video_minrate: "4500k",
      video_maxrate: "6800k",
      video_bufsize: "12000k",
      audio_bitrate: "160k",
      audio_sample_rate: 48000,
      x264_preset: "medium",
      x264_profile: "high",
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
      scopes: [],
      default_privacy_status: "unlisted",
      default_auto_start: true,
      default_auto_stop: true,
    },
    channels: [
      {
        name: "Encoder Test",
        enabled: true,
        stream_key_env: "YT_ENCODER_TEST_KEY",
        raw_playlist: [
          "Raw Videos/Encoder Test/video-01.mp4",
          "Raw Videos/Encoder Test/video-02.mp4",
          "Raw Videos/Encoder Test/video-03.mp4",
        ],
        playlist: [],
        youtube_auto_start: true,
        youtube_auto_stop: true,
        youtube_account_id: "",
        youtube_studio_url: "",
        youtube_broadcast_id: "",
        youtube_stream_id: "",
        loop: true,
        restart_on_exit: true,
        live_profile: {
          mode: "adaptive",
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
        },
      },
    ],
  };
}

function writeFixtureData(tempRoot) {
  fs.writeFileSync(path.join(tempRoot, "config.ready.json"), JSON.stringify(makeConfig(), null, 2) + "\n", "utf8");
  const rawDir = path.join(tempRoot, "Raw Videos", "Encoder Test");
  fs.mkdirSync(rawDir, { recursive: true });
  for (let index = 1; index <= 5; index += 1) {
    fs.writeFileSync(path.join(rawDir, `video-${String(index).padStart(2, "0")}.mp4`), Buffer.from("fixture", "utf8"));
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

async function removeTempRoot(tempRoot) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 9) {
        console.warn(`Temp cleanup skipped for ${tempRoot}: ${error.message}`);
        return;
      }
      await wait(800);
    }
  }
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "castarro-encoder-ui-"));
  writeFixtureData(tempRoot);
  const server = startServer(tempRoot);
  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const browser = await chromium.launch();
  try {
    await waitForServer();
    const page = await browser.newPage({ viewport: { width: 920, height: 720 } });
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.waitForSelector("#channelWorkspaceRail:not(.hidden)");
    await page.evaluate(() => {
      applyLegacyTabView("settings");
      state.settingsTab = "youtube";
      state.workspace.selectedChannelName = "Encoder Test";
      state.youtubeExpandedCards = { ...(state.youtubeExpandedCards || {}), "youtube-encoder-Encoder Test": true };
      applySettingsSection("youtube");
      renderYoutubeSettingsPanel(state.configData || defaultConfigData());
    });
    await page.waitForSelector("#settingsYoutubeView.active");
    const encoderCard = page.locator(".youtube-encoder-card").first();
    await encoderCard.waitFor();
    await page.waitForSelector(".youtube-encoder-card[open] [data-adaptive-card] .adaptive-rung");
    assert.equal(await page.locator(".youtube-encoder-card [data-adaptive-card] .adaptive-rung").count(), 3);
    assert.equal(await page.locator(".youtube-encoder-card [data-adaptive-card]").getByText("Auto switch").count(), 1);
    assert.equal(await page.locator('.youtube-encoder-card [data-adaptive-card] input[value="6800k"]').count(), 1);
    await page.screenshot({ path: path.join(OUT_DIR, "encoder-card-adaptive-ladder.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 820 });
    await page.evaluate(() => {
      state.workspace.selectedChannelName = "Encoder Test";
      state.youtubeExpandedCards = { ...(state.youtubeExpandedCards || {}), "youtube-encoder-Encoder Test": true };
      renderYoutubeSettingsPanel(state.configData || defaultConfigData());
    });
    await page.waitForSelector(".youtube-encoder-card[open] [data-adaptive-card] .adaptive-rung");
    assert.equal(await page.locator('.youtube-encoder-card [data-adaptive-card] select[data-live-profile-field="mode"]').inputValue(), "adaptive");
    await page.screenshot({ path: path.join(OUT_DIR, "encoder-card-adaptive-ladder-mobile.png"), fullPage: true });
    await page.close();
  } finally {
    await browser.close().catch(() => {});
    await stopServer(server);
    await removeTempRoot(tempRoot);
  }

  if (server.exitCode && server.exitCode !== 0) {
    throw new Error(`Server exited with ${server.exitCode}: ${stderr}`);
  }
}

run().then(
  () => {
    console.log("capture-encoder-updates: PASS");
  },
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);
