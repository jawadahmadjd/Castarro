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
    await page.locator("#railOpenEncoder").click();
    await page.waitForSelector("#settingsNormalizeView.active");
    await page.waitForSelector("#normalizationChannels .selected-normalize-settings");

    assert.equal(await page.getByText("Video encoder is the processing engine").count(), 0);
    assert.equal(await page.getByText("CBR Controls").count(), 0);
    await page.getByText("VBR Controls").waitFor();
    assert.equal(await page.locator(".file-complete-icon").count(), 0);
    assert.equal(await page.locator(".file-remove-button").count(), 3);
    await page.screenshot({ path: path.join(OUT_DIR, "encoder-updates.png"), fullPage: true });

    await page.locator(".file-remove-button").first().click();
    await page.waitForFunction(() => (
      document.querySelector("#normalizationChannels .selected-normalize-settings .badge")?.textContent?.includes("2 selected")
    ));
    assert.equal(await page.locator(".file-remove-button").count(), 2);

    await page.evaluate(() => {
      state.status.tasks.unshift({
        id: "stopped-normalize-fixture",
        name: "normalize",
        channel: "Encoder Test",
        command: "python normalize_media.py",
        running: false,
        returncode: 1,
        stopped_by_user: true,
        started_at: Date.now() / 1000,
        finished_at: Date.now() / 1000,
        lines: ["TASK channel=Encoder Test total=3", "FILE 2/3 encode video-02.mp4 -> 0002-video-02.mp4", "out_time_us=462866667", "Stop requested."],
        progress: {
          action: "normalize",
          channel: "Encoder Test",
          percent: 69,
          file_percent: 69,
          current: 2,
          total: 3,
          status: "failed",
          message: "out_time_us=462866667",
        },
      });
      renderSettingsForms();
    });
    await page.locator(".progress-head span").filter({ hasText: /^Stopped$/ }).waitFor();
    await page.getByRole("button", { name: "Resume" }).waitFor();
    assert.equal(await page.locator(".progress-head span").filter({ hasText: /^Failed$/ }).count(), 0);
    assert.equal(await page.locator(".progress-card").getByText("out_time_us=462866667").count(), 0);
    await page.screenshot({ path: path.join(OUT_DIR, "encoder-stopped-resume.png"), fullPage: true });
    await page.close();
  } finally {
    await browser.close().catch(() => {});
    await stopServer(server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
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
