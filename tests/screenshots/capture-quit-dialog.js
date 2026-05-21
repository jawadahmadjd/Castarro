const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const { _electron: electron } = require("playwright");

const ROOT = process.cwd();
const SCREEN_DIR = path.join(ROOT, "tests", "screenshots");
const CONFIG_NAME = "dialog-test-config.json";
const CONFIG_PATH = path.join(ROOT, CONFIG_NAME);
const OUTPUT_FLV = path.join(SCREEN_DIR, "dialog-live-output.flv");
const DIALOG_SHOT = path.join(SCREEN_DIR, "native-close-guard-dialog.png");
const WINDOW_SHOT = path.join(SCREEN_DIR, "electron-window-before-dialog.png");
const OPENED_SHOT = path.join(SCREEN_DIR, "desktop-opened.png");
const ERROR_SHOT = path.join(SCREEN_DIR, "desktop-error.png");
const DEBUG_LOG = path.join(SCREEN_DIR, "capture-quit-dialog.debug.log");
const SHOT_USER_DATA = path.join(ROOT, ".electron-shot-data");
const SHOT_DATA_ROOT = path.join(SHOT_USER_DATA, "data");
const SHOT_LOG_FILE = path.join(SHOT_USER_DATA, "logs", "electron-main.log");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logStep(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(DEBUG_LOG, line, "utf8");
  console.log(message);
}

async function apiFromElectron(electronApp, baseUrl, endpoint, body = null, method = "POST") {
  return electronApp.evaluate(async ({ net }, { baseUrlInner, endpointInner, bodyInner, methodInner }) => {
    return await new Promise((resolve, reject) => {
      const data = bodyInner == null ? null : JSON.stringify(bodyInner);
      const request = net.request({
        method: methodInner,
        url: `${baseUrlInner}${endpointInner}`,
      });
      if (data) {
        request.setHeader("Content-Type", "application/json");
      }
      request.on("response", (response) => {
        let raw = "";
        response.on("data", (chunk) => {
          raw += chunk.toString("utf8");
        });
        response.on("end", () => {
          let payload = raw;
          try {
            payload = raw ? JSON.parse(raw) : null;
          } catch (_error) {
            // Keep raw payload.
          }
          resolve({
            ok: !!response.statusCode && response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode || 0,
            payload,
          });
        });
      });
      request.on("error", reject);
      request.setTimeout(3000, () => {
        request.destroy(new Error("request timeout"));
      });
      if (data) request.write(data);
      request.end();
    });
  }, {
    baseUrlInner: baseUrl,
    endpointInner: endpoint,
    bodyInner: body,
    methodInner: method,
  });
}

async function getStatus(electronApp, baseUrl, config) {
  const response = await apiFromElectron(electronApp, baseUrl, `/api/status?config=${encodeURIComponent(config)}`, null, "GET");
  if (!response.ok || !response.payload || typeof response.payload !== "object") {
    throw new Error(`Status call failed: ${response.status}`);
  }
  return response.payload;
}

async function waitForBackendBaseUrl(electronApp, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    let url = "";
    try {
      url = await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        return win ? win.webContents.getURL() : "";
      });
    } catch (_error) {
      // App may still be booting; keep polling.
    }

    const match = typeof url === "string" ? url.match(/^http:\/\/127\.0\.0\.1:\d+/) : null;
    if (match) return match[0];

    // Fallback: when window is still on a data: error page, parse backend URL from main log.
    try {
      if (fs.existsSync(SHOT_LOG_FILE)) {
        const tail = fs.readFileSync(SHOT_LOG_FILE, "utf8");
        const lines = tail.trim().split(/\r?\n/).slice(-200);
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          const lineMatch = lines[i].match(/backend url (http:\/\/127\.0\.0\.1:\d+)/);
          if (lineMatch) {
            return lineMatch[1];
          }
        }
      }
    } catch (_error) {
      // Keep polling.
    }
    await wait(500);
  }
  throw new Error("Could not detect backend URL from Electron window.");
}

async function postWithRetries(electronApp, baseUrl, endpoint, body, maxAttempts = 8) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await apiFromElectron(electronApp, baseUrl, endpoint, body, "POST");
      if (result.ok) return result;
      lastError = new Error(`${endpoint} failed with HTTP ${result.status}: ${JSON.stringify(result.payload)}`);
    } catch (error) {
      lastError = error;
    }
    await wait(400);
  }
  throw lastError || new Error(`Failed POST ${endpoint}`);
}

async function waitForApiReady(electronApp, baseUrl, timeoutMs = 60000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await apiFromElectron(electronApp, baseUrl, "/api/status", null, "GET");
      if (status.ok) return;
      lastError = new Error(`status=${status.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }
  throw lastError || new Error("Backend API did not become ready in time.");
}

function captureDesktopPng(targetPath) {
  const cmd = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
    "$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)",
    `$bitmap.Save('${targetPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    "$graphics.Dispose()",
    "$bitmap.Dispose()",
  ].join("; ");

  cp.execFileSync("powershell", ["-NoProfile", "-Command", cmd], { stdio: "inherit" });
}

function sendEnterToDialog() {
  const cmd = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Start-Sleep -Milliseconds 300",
    "[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')",
  ].join("; ");
  cp.execFileSync("powershell", ["-NoProfile", "-Command", cmd], { stdio: "inherit" });
}

function buildConfig() {
  const ffmpeg = path.join(ROOT, "desktop", "resources", "ffmpeg", "ffmpeg.exe");
  const ffprobe = path.join(ROOT, "desktop", "resources", "ffmpeg", "ffprobe.exe");
  const playlistVideo = path.join(ROOT, "Go Live", "Inside Us", "0001-Engaging live.mp4");
  return {
    defaults: {
      ffmpeg_path: ffmpeg,
      ffprobe_path: ffprobe,
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
    channels: [
      {
        name: "dialog_test",
        enabled: true,
        loop: true,
        restart_on_exit: true,
        youtube_auto_start: false,
        youtube_auto_stop: false,
        rtmp_url: OUTPUT_FLV,
        playlist: [playlistVideo],
      },
    ],
  };
}

(async () => {
  fs.writeFileSync(DEBUG_LOG, "", "utf8");
  fs.mkdirSync(SCREEN_DIR, { recursive: true });
  fs.mkdirSync(SHOT_DATA_ROOT, { recursive: true });
  fs.mkdirSync(path.dirname(SHOT_LOG_FILE), { recursive: true });
  logStep(`screenshots dir: ${SCREEN_DIR}`);
  logStep(`user data dir: ${SHOT_USER_DATA}`);

  // Keep the screenshot-run sandbox light; avoid copying huge legacy media into app-data.
  fs.writeFileSync(path.join(SHOT_DATA_ROOT, ".electron-migration-complete"), JSON.stringify({ migrated: [] }, null, 2) + "\n");
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(buildConfig(), null, 2) + "\n", "utf8");

  const env = {
    ...process.env,
    STREAM_DISABLE_AUTO_UPDATE: "1",
    STREAM_DESKTOP_USER_DATA_DIR: SHOT_USER_DATA,
    STREAM_LEGACY_ROOT: SHOT_DATA_ROOT,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  logStep("launching electron...");

  const electronApp = await electron.launch({
    args: [".", "--disable-gpu", "--in-process-gpu", "--disable-software-rasterizer"],
    cwd: ROOT,
    env,
  });
  logStep("electron launched");

  let baseUrl = "";
  let startedStream = false;
  try {
    await electronApp.firstWindow();
    logStep("first window available");
    captureDesktopPng(OPENED_SHOT);
    logStep(`captured: ${OPENED_SHOT}`);

    baseUrl = await waitForBackendBaseUrl(electronApp);
    logStep(`detected backend URL: ${baseUrl}`);
    await waitForApiReady(electronApp, baseUrl);
    logStep("api ready");
    await wait(500);

    // Save config inside backend data root (ROOT=STREAM_APP_DATA_DIR in web_ui.py).
    const configText = JSON.stringify(buildConfig(), null, 2) + "\n";
    await postWithRetries(electronApp, baseUrl, "/api/config/save", { config: CONFIG_NAME, text: configText });
    logStep("config saved");

    await postWithRetries(electronApp, baseUrl, "/api/stream/start", { config: CONFIG_NAME, channel: "dialog_test" });
    startedStream = true;
    logStep("stream start requested");

    let running = false;
    for (let i = 0; i < 20; i += 1) {
      const status = await getStatus(electronApp, baseUrl, CONFIG_NAME);
      const stream = status.streams?.dialog_test;
      if (stream && stream.running) {
        running = true;
        break;
      }
      await wait(500);
    }
    if (!running) {
      throw new Error("dialog_test stream did not reach running state");
    }
    logStep("stream is running");

    captureDesktopPng(WINDOW_SHOT);
    logStep(`captured: ${WINDOW_SHOT}`);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.close();
    });
    logStep("close requested (should trigger guard dialog)");

    await wait(1200);
    captureDesktopPng(DIALOG_SHOT);
    logStep(`captured: ${DIALOG_SHOT}`);
    sendEnterToDialog();
    logStep("dialog dismissed with Enter");

    await wait(800);
    await postWithRetries(electronApp, baseUrl, "/api/stream/stop", { config: CONFIG_NAME, channel: "dialog_test" });
    startedStream = false;
    logStep("stream stopped");
    await wait(500);
  } finally {
    if (startedStream && baseUrl) {
      try {
        await postWithRetries(electronApp, baseUrl, "/api/stream/stop", { config: CONFIG_NAME, channel: "dialog_test" }, 3);
      } catch (_error) {
        // App may already be closed.
      }
    }
    try {
      await electronApp.close();
      logStep("electron closed");
    } catch (_error) {
      // Ignore if app already closed.
    }
  }

  console.log(JSON.stringify({
    dialog: DIALOG_SHOT,
    window: WINDOW_SHOT,
    config: CONFIG_PATH,
  }, null, 2));
})().catch((error) => {
  try {
    captureDesktopPng(ERROR_SHOT);
    logStep(`captured error shot: ${ERROR_SHOT}`);
  } catch (_error) {
    // ignore screenshot failure on crash path
  }
  try {
    logStep(`ERROR: ${error.stack || error.message || error}`);
  } catch (_error) {
    // ignore
  }
  console.error(error);
  process.exit(1);
});
