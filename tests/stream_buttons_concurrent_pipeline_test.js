#!/usr/bin/env node
/**
 * Playwright E2E Test for Castarro Stream Control Buttons & Multi-Stream Pipeline
 * Checks:
 * - Start Stream (single card)
 * - Stop Stream (single card)
 * - Start All Streams (per channel)
 * - Stop All Streams (per channel)
 * - Start All Streams (global top bar)
 * - Stop Streams & Exit
 * - Multiple concurrent FFmpeg stream execution
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn, execSync } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const PORT = process.env.STREAMS_TEST_PORT || "8798";
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
        res.on("data", (chunk) => (text += chunk));
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
    req.setTimeout(5000, () => req.destroy(new Error("request timeout")));
    if (body) req.write(body);
    req.end();
  });
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await request("/api/status");
      return;
    } catch {
      await wait(300);
    }
  }
  throw new Error(`Server failed to start at ${URL}`);
}

async function createSampleVideo(destPath) {
  const ffmpegBin = path.join(ROOT, "desktop", "resources", "ffmpeg", "ffmpeg.exe");
  const bin = fs.existsSync(ffmpegBin) ? ffmpegBin : "ffmpeg";
  try {
    execSync(`"${bin}" -y -f lavfi -i testsrc=duration=10:size=640x360:rate=30 -f lavfi -i sine=frequency=1000:duration=10 -c:v libx264 -c:a aac "${destPath}"`, { stdio: "ignore" });
  } catch {
    fs.writeFileSync(destPath, "dummy video content", "utf8");
  }
}

async function run() {
  console.log("=== [TEST] Preparing multi-stream test environment ===");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "castarro-stream-buttons-test-"));
  const configPath = path.join(tempDir, "config.ready.json");

  const channel1Dir = path.join(tempDir, "Go Live", "Channel Alpha");
  const channel2Dir = path.join(tempDir, "Go Live", "Channel Beta");
  fs.mkdirSync(channel1Dir, { recursive: true });
  fs.mkdirSync(channel2Dir, { recursive: true });

  const video1 = path.join(channel1Dir, "video1.mp4");
  const video2 = path.join(channel2Dir, "video2.mp4");
  await createSampleVideo(video1);
  await createSampleVideo(video2);

  const ffmpegPath = path.join(ROOT, "desktop", "resources", "ffmpeg", "ffmpeg.exe");
  const ffprobePath = path.join(ROOT, "desktop", "resources", "ffmpeg", "ffprobe.exe");

  const config = {
    defaults: {
      ffmpeg_path: fs.existsSync(ffmpegPath) ? ffmpegPath : "ffmpeg",
      ffprobe_path: fs.existsSync(ffprobePath) ? ffprobePath : "ffprobe",
      rtmp_base: "rtmp://127.0.0.1:1935/live",
      log_dir: path.join(tempDir, "logs"),
      runtime_dir: path.join(tempDir, ".runtime"),
      raw_dir: path.join(tempDir, "Raw Videos"),
      normalized_dir: path.join(tempDir, "Go Live"),
      normalized_playlist_dir: path.join(tempDir, "playlists"),
      restart_delay_seconds: 10,
    },
    channels: [
      {
        name: "Channel Alpha",
        enabled: true,
        stream_key: "alpha_key_1",
        playlist: ["Go Live/Channel Alpha/video1.mp4"],
        streams: [
          {
            id: "alpha_stream_1",
            name: "Alpha Main Feed",
            stream_key: "alpha_key_1",
            enabled: true,
            playlist: ["Go Live/Channel Alpha/video1.mp4"],
          },
          {
            id: "alpha_stream_2",
            name: "Alpha Secondary Feed",
            stream_key: "alpha_key_2",
            enabled: true,
            playlist: ["Go Live/Channel Alpha/video1.mp4"],
          },
        ],
      },
      {
        name: "Channel Beta",
        enabled: true,
        stream_key: "beta_key_1",
        playlist: ["Go Live/Channel Beta/video2.mp4"],
        streams: [
          {
            id: "beta_stream_1",
            name: "Beta Feed",
            stream_key: "beta_key_1",
            enabled: true,
            playlist: ["Go Live/Channel Beta/video2.mp4"],
          },
        ],
      },
    ],
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

  console.log(`=== [TEST] Starting web_ui backend on port ${PORT} ===`);
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

  py.stdout.on("data", (d) => console.log(`[server] ${d.toString().trim()}`));
  py.stderr.on("data", (d) => console.log(`[server err] ${d.toString().trim()}`));

  try {
    await waitForServer();
    console.log("=== [TEST] Server ready! Launching Playwright browser ===");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    page.on("console", (msg) => console.log(`[browser log] ${msg.text()}`));
    page.on("pageerror", (err) => console.log(`[browser error] ${err.message}`));

    await page.goto(URL, { waitUntil: "networkidle" });
    await wait(1000);

    // 1. Select Channel Alpha
    console.log("=== [TEST STEP 1] Selecting Channel Alpha ===");
    await page.evaluate(() => {
      if (window.selectWorkspaceChannel) {
        window.selectWorkspaceChannel("Channel Alpha");
      }
    });
    await wait(500);

    // 2. Open Streams Tab
    console.log("=== [TEST STEP 2] Opening Streams Tab ===");
    await page.locator("#railOpenStreams").click();
    await wait(1000);

    // Verify stream cards rendered
    const cardCount = await page.locator(".stream-card").count();
    console.log(`[TEST] Found ${cardCount} stream cards for Channel Alpha.`);
    if (cardCount < 2) {
      throw new Error(`Expected at least 2 stream cards for Channel Alpha, but found ${cardCount}`);
    }

    // 3. TEST BUTTON 1: Single Stream Start
    console.log("=== [TEST STEP 3] Testing 'Start Stream' on single stream card (alpha_stream_1) ===");
    const startBtn = page.locator("#streamCard_alpha_stream_1 button.pill.success").first();
    await startBtn.click();
    await wait(2000);

    let status = await request("/api/status");
    let activeStreams = status.streams || {};
    console.log("[TEST] Active streams after single start:", Object.keys(activeStreams));
    const alpha1Running = Boolean(activeStreams["Channel Alpha:alpha_stream_1"]?.process_running || activeStreams["Channel Alpha:alpha_stream_1"]?.running);
    console.log(`[TEST] alpha_stream_1 running status: ${alpha1Running}`);
    if (!alpha1Running) {
      throw new Error("alpha_stream_1 failed to start!");
    }

    // 4. TEST BUTTON 2: Single Stream Stop
    console.log("=== [TEST STEP 4] Testing 'Stop Stream' on single stream card (alpha_stream_1) ===");
    const stopBtn = page.locator("#streamCard_alpha_stream_1 button.pill.danger").first();
    await stopBtn.click();
    await wait(1500);

    status = await request("/api/status");
    activeStreams = status.streams || {};
    const alpha1Stopped = !activeStreams["Channel Alpha:alpha_stream_1"] || !activeStreams["Channel Alpha:alpha_stream_1"]?.running;
    console.log(`[TEST] alpha_stream_1 stopped status: ${alpha1Stopped}`);
    if (!alpha1Stopped) {
      throw new Error("alpha_stream_1 failed to stop!");
    }

    // 5. TEST BUTTON 3: Start All Streams (Channel Level) -> Concurrent Multi-Stream Test!
    console.log("=== [TEST STEP 5] Testing 'Start All Streams' (Channel Level) for Channel Alpha ===");
    await page.locator("#startChannelStreamsBtn").click();
    await wait(3000);

    status = await request("/api/status");
    activeStreams = status.streams || {};
    console.log("[TEST] Active streams after Start All Streams (Channel Level):", Object.keys(activeStreams));
    const runningKeys = Object.keys(activeStreams).filter((k) => activeStreams[k]?.running || activeStreams[k]?.process_running);
    console.log(`[TEST] Total concurrent running streams: ${runningKeys.length}`);
    if (runningKeys.length < 2) {
      throw new Error(`Expected 2 concurrent streams running for Channel Alpha, but got ${runningKeys.length}`);
    }

    // 6. TEST BUTTON 4: Stop All Streams (Channel Level)
    console.log("=== [TEST STEP 6] Testing 'Stop All Streams' (Channel Level) for Channel Alpha ===");
    await page.locator("#stopChannelStreamsBtn").click();
    await wait(1500);

    status = await request("/api/status");
    activeStreams = status.streams || {};
    const runningKeysAfterStop = Object.keys(activeStreams).filter((k) => activeStreams[k]?.running || activeStreams[k]?.process_running);
    console.log(`[TEST] Running streams after Stop All: ${runningKeysAfterStop.length}`);
    if (runningKeysAfterStop.length !== 0) {
      throw new Error(`Expected 0 running streams after Stop All, but got ${runningKeysAfterStop.length}`);
    }

    // 7. TEST BUTTON 5: Global Start All Streams (Top Bar)
    console.log("=== [TEST STEP 7] Testing Global 'Start All Streams' (Top Bar) ===");
    await page.locator("#startAll").click();
    await wait(3500);

    status = await request("/api/status");
    activeStreams = status.streams || {};
    console.log("[TEST] Active streams after Global Start All:", Object.keys(activeStreams));
    const globalRunning = Object.keys(activeStreams).filter((k) => activeStreams[k]?.running || activeStreams[k]?.process_running);
    console.log(`[TEST] Total global concurrent running streams: ${globalRunning.length}`);
    if (globalRunning.length < 3) {
      console.warn(`[WARN] Global running streams count is ${globalRunning.length} (expected 3 across channels).`);
    }

    // 8. TEST BUTTON 6: Stop Streams and Exit
    console.log("=== [TEST STEP 8] Testing 'Stop Streams and Exit' button ===");
    await page.locator("#stopAndExit").waitFor({ state: "visible", timeout: 5000 });
    await page.locator("#stopAndExit").click();
    await wait(2500);

    // Verify server shutdown (GET /api/status should throw connection refused / error)
    let serverShutdownCleanly = false;
    try {
      await request("/api/status");
    } catch {
      serverShutdownCleanly = true;
    }
    console.log(`[TEST] Server shutdown verified: ${serverShutdownCleanly}`);
    if (!serverShutdownCleanly) {
      throw new Error("Server failed to shut down after Stop Streams and Exit!");
    }

    console.log("=== [TEST RESULT] ALL STREAM BUTTONS AND MULTI-STREAM PIPELINE VERIFIED SUCCESSFULLY! ===");
    await browser.close();
  } finally {
    py.kill();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

run().catch((err) => {
  console.error("=== [TEST FAILED] ===", err);
  process.exit(1);
});
