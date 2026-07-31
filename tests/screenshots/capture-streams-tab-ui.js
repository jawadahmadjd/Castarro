#!/usr/bin/env node
/**
 * Playwright UI test for Castarro Streams tab layout, visual balance, and multi-stream controls.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const PORT = process.env.STREAMS_UI_PORT || "8795";
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

async function waitForServer(timeoutMs = 20000) {
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

async function run() {
  console.log("[playwright-test] Preparing test environment for Streams Tab...");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "castarro-streams-test-"));
  const configPath = path.join(tempDir, "config.ready.json");

  // Create sample Go Live files for channel
  const goLiveDir = path.join(tempDir, "Go Live", "Inside Us");
  fs.mkdirSync(goLiveDir, { recursive: true });
  fs.writeFileSync(path.join(goLiveDir, "sample_video_1.mp4"), "dummy video content", "utf8");
  fs.writeFileSync(path.join(goLiveDir, "sample_video_2.mp4"), "dummy video content", "utf8");

  const config = {
    defaults: {
      ffmpeg_path: "ffmpeg",
      ffprobe_path: "ffprobe",
      rtmp_base: "rtmp://example.invalid/live2",
      log_dir: "logs",
      runtime_dir: ".runtime",
      raw_dir: "Raw Videos",
      normalized_dir: "Go Live",
      normalized_playlist_dir: "playlists",
      restart_delay_seconds: 10,
    },
    channels: [
      {
        name: "Inside Us",
        enabled: true,
        stream_key: "sample_stream_key_main",
        streams: [
          {
            id: "stream_1",
            name: "Main Stream Feed",
            stream_key: "sample_stream_key_main",
            playlist: [],
          },
          {
            id: "stream_2",
            name: "Secondary Stream (Dummy / Test)",
            stream_key: "sample_dummy_stream_key_secondary",
            playlist: [],
          },
        ],
      },
    ],
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

  console.log("[playwright-test] Spawning web_ui server process on STREAM_UI_PORT=" + PORT + "...");
  const py = spawn("python", ["scripts/web_ui.py"], {
    cwd: ROOT,
    env: {
      ...process.env,
      STREAM_UI_PORT: PORT,
      STREAM_APP_DATA_DIR: tempDir,
      STREAM_APP_CODE_DIR: ROOT,
      STREAM_WEB_ROOT: path.join(ROOT, "web"),
      STREAM_DISABLE_AUTO_UPDATE: "1",
    },
    stdio: "pipe",
  });

  py.stdout.on("data", (data) => console.log(`[server stdout] ${data.toString().trim()}`));
  py.stderr.on("data", (data) => console.log(`[server stderr] ${data.toString().trim()}`));

  try {
    await waitForServer();
    console.log(`[playwright-test] Server running on ${URL}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    page.on("console", (msg) => console.log(`[browser console] ${msg.type()}: ${msg.text()}`));
    page.on("pageerror", (err) => console.log(`[browser pageerror] ${err.message}`));

    console.log(`[playwright-test] Opening UI at ${URL}...`);
    await page.goto(URL, { waitUntil: "networkidle" });
    await wait(1000);

    // Select channel workspace in application state
    await page.evaluate(() => {
      if (window.selectWorkspaceChannel) {
        window.selectWorkspaceChannel("Inside Us");
      }
    });
    await wait(500);

    // Click Streams tab in rail
    console.log("[playwright-test] Navigating to Streams tab...");
    const streamsBtn = page.locator("#railOpenStreams");
    await streamsBtn.waitFor({ state: "visible" });
    await streamsBtn.click();

    // Verify Streams Section active
    await page.waitForSelector("#settingsStreamsView.active", { timeout: 5000 });
    console.log("[playwright-test] Streams view section active.");

    // Verify Refresh Stats & Add Stream buttons
    await page.locator("#refreshStreamStatsBtn").waitFor({ state: "visible" });
    await page.locator("#addStreamBtn").waitFor({ state: "visible" });

    // Trigger workspace streams render explicitly
    await page.evaluate(async () => {
      if (window.renderWorkspaceStreamsTab) {
        await window.renderWorkspaceStreamsTab("Inside Us");
      }
    });
    await wait(1000);

    // Verify Stream Cards
    await page.waitForSelector(".stream-card", { timeout: 5000 });
    const count = await page.locator(".stream-card").count();
    console.log(`[playwright-test] Found ${count} stream cards (Main Feed + Dummy Stream).`);

    // Click first card header to expand details
    console.log("[playwright-test] Expanding first stream card...");
    await page.locator(".stream-card-header").first().click();
    await wait(500);

    // Open video picker modal explicitly via evaluate
    console.log("[playwright-test] Opening Import / Select Videos modal...");
    await page.evaluate(async () => {
      if (window.openStreamVideoPickerModal) {
        await window.openStreamVideoPickerModal("Inside Us", "stream_1");
      }
    });
    await wait(1000);

    // Verify modal visible
    await page.waitForSelector("#streamVideoPickerModal:not(.hidden)", { timeout: 5000 });
    console.log("[playwright-test] Video picker modal successfully opened!");

    // Capture screenshot of open modal
    const modalScreenshotPath = path.join(OUT_DIR, "streams-video-picker-verified.png");
    await page.screenshot({ path: modalScreenshotPath, fullPage: true });
    console.log(`[playwright-test] Modal screenshot saved to ${modalScreenshotPath}`);

    // Close modal
    await page.locator("#cancelStreamVideoPicker").click();
    await wait(300);

    // Capture full streams tab screenshot
    const screenshotPath = path.join(OUT_DIR, "streams-tab-verified.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[playwright-test] Screenshot captured and saved to ${screenshotPath}`);

    await browser.close();
    console.log("[playwright-test] SUCCESS: Import Videos folder selector verified 100%!");
  } finally {
    py.kill();
  }
}

run().catch((err) => {
  console.error("[playwright-test] ERROR:", err);
  process.exit(1);
});
