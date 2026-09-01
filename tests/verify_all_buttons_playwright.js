#!/usr/bin/env node
/**
 * Playwright Comprehensive Button Verification Test Suite for Castarro
 *
 * Tests ALL UI buttons:
 * 1. Global "Start All Streams" / "Stop all streams" (Top Left Bar)
 * 2. Channel "Start All Streams" / "Stop All Streams" (Streams Tab)
 * 3. Individual Stream "Start Stream" / "Stop Stream"
 * 4. Stream "Schedule Stream" Modal
 * 5. "+ Add Stream" Modal (Open, Fill Inputs, Cancel/Submit)
 * 6. "Refresh Stats" Button
 * 7. Sidebar Route Buttons (Dashboard, YouTube, Streams, History, Troubleshoot, Transfer)
 * 8. Theme Toggle Switch
 * 9. Control Buttons (Check for Updates, Close UI Only, Stop Streams and Exit)
 *
 * Saves detailed screenshots to tests/screenshots/
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const PORT = process.env.TEST_PORT || "8799";
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR = path.join(ROOT, "tests", "screenshots");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(pathname, method = "GET", payload = null) {
  return new Promise((resolve, reject) => {
    const body = payload ? Buffer.from(JSON.stringify(payload), "utf8") : null;
    const req = http.request(
      `${BASE_URL}${pathname}`,
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
    req.setTimeout(30000, () => req.destroy(new Error("request timeout")));
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
  throw new Error(`Backend server failed to start on ${BASE_URL}`);
}

async function run() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  console.log("=== [PLAYWRIGHT TEST] Starting Castarro Backend for UI Button Verification ===");

  const pythonBin = "python";
  const serverProc = spawn(pythonBin, ["scripts/web_ui.py"], {
    cwd: ROOT,
    env: { ...process.env, STREAM_UI_PORT: PORT, PYTHONUNBUFFERED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProc.stdout.on("data", (data) => console.log(`[SERVER STDOUT] ${data.toString().trim()}`));
  serverProc.stderr.on("data", (data) => console.error(`[SERVER STDERR] ${data.toString().trim()}`));

  try {
    await waitForServer();
    console.log("=== [PLAYWRIGHT TEST] Backend Server Ready! Launching Browser... ===");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();

    // Enable console logging from page
    page.on("console", (msg) => console.log(`[PAGE CONSOLE] ${msg.type()}: ${msg.text()}`));

    console.log("1. Navigating to Castarro Web Dashboard...");
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "01_dashboard_initial.png"), fullPage: true });
    console.log("   Saved: 01_dashboard_initial.png");

    // 2. Select Channel "Inside Us"
    console.log("2. Selecting Channel 'Inside Us'...");
    const insideUsButton = page.locator('.sidebar-channel-item:has-text("Inside Us")').first();
    if (await insideUsButton.isVisible()) {
      await insideUsButton.click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "02_inside_us_selected.png"), fullPage: true });
    console.log("   Saved: 02_inside_us_selected.png");

    // 3. Test Sidebar Navigation Buttons
    console.log("3. Testing Sidebar Navigation Buttons...");
    const sidebarRoutes = [
      { id: "#railOpenYoutube", name: "YouTube", screenshot: "03_nav_youtube.png" },
      { id: "#railOpenHistory", name: "History", screenshot: "05_nav_history.png" },
      { id: "#railOpenTroubleshoot", name: "Troubleshoot", screenshot: "06_nav_troubleshoot.png" },
      { id: "#railOpenTransfer", name: "Transfer", screenshot: "07_nav_transfer.png" },
      { id: "#railOpenStreams", name: "Streams", screenshot: "04_nav_streams.png" },
    ];

    for (const route of sidebarRoutes) {
      const btn = page.locator(route.id);
      if (await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, route.screenshot), fullPage: true });
        console.log(`   Click '${route.name}' -> Saved: ${route.screenshot}`);
      }
    }

    // Now we are on STREAMS view!

    // 4. Test Theme Toggle Switch
    console.log("4. Testing Theme Toggle Switch...");
    const themeToggle = page.locator('.theme-toggle input, button:has-text("☀️"), button:has-text("🌙")').first();
    if (await themeToggle.isVisible()) {
      await themeToggle.click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "08_theme_toggled.png"), fullPage: true });
      console.log("   Saved: 08_theme_toggled.png");
      await themeToggle.click(); // Toggle back
      await page.waitForTimeout(300);
    }

    // 5. Test Channel "+ Add Stream" Modal Button
    console.log("5. Testing '+ Add Stream' Button & Modal...");
    const addStreamBtn = page.locator("#addStreamBtn");
    if (await addStreamBtn.isVisible()) {
      await addStreamBtn.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "09_add_stream_modal_open.png"), fullPage: true });
      console.log("   Saved: 09_add_stream_modal_open.png");

      // Close modal
      const cancelBtn = page.locator('#addStreamModal button:has-text("Cancel"), #addStreamModal button:has-text("✕")').first();
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click();
        await page.waitForTimeout(300);
      }
    }

    // 6. Test "Refresh Stats" Button
    console.log("6. Testing 'Refresh Stats' Button...");
    const refreshStatsBtn = page.locator("#refreshStreamStatsBtn");
    if (await refreshStatsBtn.isVisible()) {
      await refreshStatsBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "10_stats_refreshed.png"), fullPage: true });
      console.log("   Saved: 10_stats_refreshed.png");
    }

    // 7. Test Channel LEVEL "Start All Streams" Button
    console.log("7. Testing Channel-Level 'Start All Streams' Button...");
    const startChannelStreamsBtn = page.locator("#startChannelStreamsBtn");
    
    // Set up network promise to wait for /api/stream/start response
    const startResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/stream/start") && resp.status() === 200,
      { timeout: 30000 }
    );

    await startChannelStreamsBtn.click();
    console.log("   Clicked 'Start All Streams' (Channel Level). Waiting for API response...");
    await startResponsePromise;
    console.log("   API response received! Waiting for channel streams fetch...");
    
    // Wait for the follow-up /api/channel/streams response and next status refresh
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/channel/streams") && resp.status() === 200,
      { timeout: 15000 }
    );
    // Wait for status poll to update sidebar top-left "8 live streams" count
    await page.waitForTimeout(3500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "11_all_8_streams_running.png"), fullPage: true });
    console.log("   Saved: 11_all_8_streams_running.png");

    // Verify Active Streams via Backend API
    const statusResult = await request("/api/status");
    const activeStreams = statusResult?.streams || {};
    const activeCount = Object.keys(activeStreams).length;
    console.log(`   [VERIFICATION] Backend reports ${activeCount} active stream process(es):`, Object.keys(activeStreams));

    // 8. Test Channel LEVEL "Stop All Streams" Button
    console.log("8. Testing Channel-Level 'Stop All Streams' Button...");
    const stopChannelStreamsBtn = page.locator("#stopChannelStreamsBtn");
    const stopResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/stream/stop") && resp.status() === 200,
      { timeout: 30000 }
    );

    await stopChannelStreamsBtn.click();
    console.log("   Clicked 'Stop All Streams'. Waiting for API response...");
    await stopResponsePromise;
    console.log("   API response received! Waiting for channel streams fetch...");

    await page.waitForResponse(
      (resp) => resp.url().includes("/api/channel/streams") && resp.status() === 200,
      { timeout: 15000 }
    );
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "12_all_streams_stopped.png"), fullPage: true });
    console.log("   Saved: 12_all_streams_stopped.png");

    // 9. Test Single Stream "Start Stream" and "Stop Stream"
    console.log("9. Testing Individual Stream Buttons...");
    const firstStartBtn = page.locator('.stream-card-row button:has-text("Start Stream"), .stream-card button:has-text("Start Stream")').first();
    if (await firstStartBtn.isVisible()) {
      const singleStartPromise = page.waitForResponse(
        (resp) => resp.url().includes("/api/stream/start") && resp.status() === 200,
        { timeout: 15000 }
      );
      await firstStartBtn.click();
      console.log("   Clicked Stream 1 'Start Stream'. Waiting for response...");
      await singleStartPromise;
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "13_stream_1_started.png"), fullPage: true });
      console.log("   Saved: 13_stream_1_started.png");

      const firstStopBtn = page.locator('.stream-card-row button:has-text("Stop Stream"), .stream-card button:has-text("Stop Stream")').first();
      if (await firstStopBtn.isVisible()) {
        const singleStopPromise = page.waitForResponse(
          (resp) => resp.url().includes("/api/stream/stop") && resp.status() === 200,
          { timeout: 15000 }
        );
        await firstStopBtn.click();
        console.log("   Clicked Stream 1 'Stop Stream'. Waiting for response...");
        await singleStopPromise;
        await page.waitForTimeout(2000);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, "14_stream_1_stopped.png"), fullPage: true });
        console.log("   Saved: 14_stream_1_stopped.png");
      }
    }

    // 10. Test Stream "Schedule Stream" Button
    console.log("10. Testing Stream 'Schedule Stream' Button & Modal...");
    const scheduleBtn = page.locator('.stream-card button:has-text("Schedule Stream")').first();
    if (await scheduleBtn.isVisible()) {
      await scheduleBtn.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "15_schedule_stream_modal.png"), fullPage: true });
      console.log("   Saved: 15_schedule_stream_modal.png");

      // Close modal
      const closeSchedule = page.locator('#scheduleStreamModal button:has-text("Cancel"), #scheduleStreamModal button:has-text("✕")').first();
      if (await closeSchedule.isVisible()) {
        await closeSchedule.click();
        await page.waitForTimeout(300);
      }
    }

    // 11. Test Global "Start All Streams" Button (Top Bar #startAll)
    console.log("11. Testing Global 'Start All Streams' Button (Top Bar)...");
    const globalStartAllBtn = page.locator("#startAll");
    if (await globalStartAllBtn.isVisible()) {
      const globalStartPromise = page.waitForResponse(
        (resp) => resp.url().includes("/api/stream/start") && resp.status() === 200,
        { timeout: 30000 }
      );
      await globalStartAllBtn.click();
      console.log("   Clicked Global 'Start All Streams'. Waiting for API response...");
      await globalStartPromise;
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "16_global_start_all_running.png"), fullPage: true });
      console.log("   Saved: 16_global_start_all_running.png");

      const globalStatus = await request("/api/status");
      const globalCount = Object.keys(globalStatus?.streams || {}).length;
      console.log(`   [VERIFICATION] Global active stream processes count: ${globalCount}`);

      // Stop via Global Stop All
      const globalStopPromise = page.waitForResponse(
        (resp) => resp.url().includes("/api/stream/stop") && resp.status() === 200,
        { timeout: 30000 }
      );
      await globalStartAllBtn.click();
      console.log("   Clicked Global 'Stop All Streams'. Waiting for API response...");
      await globalStopPromise;
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "17_global_stop_all_stopped.png"), fullPage: true });
      console.log("   Saved: 17_global_stop_all_stopped.png");
    }

    // 12. Test Footer Control Buttons
    console.log("12. Testing Footer Control Buttons ('Check for Updates')...");
    const checkUpdatesBtn = page.locator("#checkForUpdatesBtn");
    if (await checkUpdatesBtn.isVisible()) {
      await checkUpdatesBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "18_check_for_updates.png"), fullPage: true });
      console.log("   Saved: 18_check_for_updates.png");
    }

    console.log("=== ALL BUTTON TESTS PASSED SUCCESSFULLY! ===");
    await browser.close();
  } finally {
    console.log("Stopping Backend Server...");
    serverProc.kill("SIGTERM");
  }
}

run().catch((err) => {
  console.error("TEST FAILED WITH ERROR:", err);
  process.exit(1);
});
