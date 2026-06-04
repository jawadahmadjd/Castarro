const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
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
          if ((res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300) {
            resolve(text ? JSON.parse(text) : {});
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${text}`));
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

function writeFixtureData(tempRoot) {
  const config = {
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
    normalize_profile: {},
    live_profile: {},
    youtube: {},
    channels: [
      { name: "Main Channel", enabled: true, stream_key_env: "YT_MAIN_KEY", playlist: [] },
      { name: "Backup Channel", enabled: true, stream_key_env: "YT_BACKUP_KEY", playlist: [] },
    ],
  };
  fs.writeFileSync(path.join(tempRoot, "config.ready.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
}

function startServer(tempRoot) {
  return spawn("python", ["scripts/web_ui.py"], {
    cwd: ROOT,
    env: {
      ...process.env,
      STREAM_UI_PORT: PORT,
      STREAM_APP_DATA_DIR: tempRoot,
      STREAM_APP_CODE_DIR: ROOT,
      STREAM_WEB_ROOT: path.join(ROOT, "web"),
      STREAM_DISABLE_AUTO_UPDATE: "1",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try {
    await request("/api/system/shutdown", "POST", { stop_streams: true, stop_tasks: true });
  } catch {
    // Best effort shutdown.
  }
  await wait(800);
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      killer.on("exit", resolve);
    });
    return;
  }
  child.kill("SIGTERM");
}

async function installHistoryFixture(page) {
  await page.evaluate(() => {
    const base = new Date();
    const iso = (daysAgo, hour, minute = 0, stoppedOffsetMinutes = 95, returncode = 0) => {
      const started = new Date(base.getFullYear(), base.getMonth(), base.getDate() - daysAgo, hour, minute, 0);
      const stopped = new Date(started.getTime() + stoppedOffsetMinutes * 60000);
      return {
        started_at: started.toISOString(),
        stopped_at: stopped.toISOString(),
        returncode,
      };
    };
    state.settingsLiveHistory.sessions = [
      {
        id: 7,
        config_name: "config.ready.json",
        channel_name: "Main Channel",
        live_title: "Sunday Worship Live",
        status: "stopped",
        ...iso(2, 19, 30, 118, 0),
      },
      {
        id: 6,
        config_name: "config.ready.json",
        channel_name: "Backup Channel",
        live_title: "Community Q&A Stream",
        status: "stopped",
        ...iso(5, 21, 0, 74, 0),
      },
      {
        id: 5,
        config_name: "config.ready.json",
        channel_name: "Main Channel",
        live_title: "Product Walkthrough",
        status: "stopped",
        ...iso(11, 16, 15, 46, 1),
      },
      {
        id: 4,
        config_name: "config.ready.json",
        channel_name: "Main Channel",
        live_title: "Weekly Teaching Session",
        status: "stopped",
        ...iso(18, 20, 5, 132, 0),
      },
      {
        id: 3,
        config_name: "config.ready.json",
        channel_name: "Backup Channel",
        live_title: "Member Announcements",
        status: "stopped",
        ...iso(24, 18, 45, 39, 0),
      },
    ];
    renderSettingsLiveHistory();
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "castarro-live-history-shot-"));
  writeFixtureData(tempRoot);

  const server = startServer(tempRoot);
  const stderr = [];
  server.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1490, height: 930 } });
    const page = await context.newPage();
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.locator("#tabSettings").click();
    const historyResponse = page.waitForResponse((response) => response.url().includes("/api/stream-history"));
    await page.locator("#settingsLiveHistoryTab").click();
    await historyResponse;
    await page.waitForSelector("#settingsLiveHistoryView.active");
    await installHistoryFixture(page);
    await page.screenshot({ path: path.join(OUT_DIR, "live-history-settings.png"), fullPage: true });

    await page.locator("#settingsLiveHistoryRangeButton").click();
    await page.waitForSelector("#settingsLiveHistoryDateMenu:not(.hidden)");
    await page.screenshot({ path: path.join(OUT_DIR, "live-history-settings-dropdown.png"), fullPage: true });

    await page.getByRole("menuitem", { name: "Custom" }).click();
    await page.waitForSelector("#settingsLiveHistoryCalendar:not(.hidden)");
    await page.screenshot({ path: path.join(OUT_DIR, "live-history-settings-custom.png"), fullPage: true });

    await page.setViewportSize({ width: 390, height: 980 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT_DIR, "live-history-settings-mobile.png"), fullPage: true });
    await browser.close();
    console.log("capture-live-history-settings: PASS");
  } finally {
    await stopServer(server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (stderr.length) {
      fs.writeFileSync(path.join(OUT_DIR, "live-history-settings.stderr.log"), stderr.join(""), "utf8");
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
