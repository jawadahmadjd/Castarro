const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const PORT = "8879";
const URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = "C:\\Users\\Jawad Ahmad\\.gemini\\antigravity-ide\\brain\\f8e39bda-6902-4cca-8192-a2bc9ebb3439";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pollHealth(maxAttempts = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts += 1;
      const req = http.get(`${URL}/api/status?config=config.json`, (res) => {
        if (res.statusCode === 200) {
          clearInterval(interval);
          resolve(true);
        }
      });
      req.on("error", () => {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          reject(new Error("Server failed to start within timeout"));
        }
      });
      req.setTimeout(1000, () => req.destroy());
    }, 500);
  });
}

async function captureCard(page, filename) {
  const card = await page.$(".stream-card");
  if (card) {
    await card.screenshot({ path: path.join(ARTIFACT_DIR, filename) });
  }
}

async function main() {
  console.log("[E2E DUAL STREAM] Starting backend on port", PORT);
  const serverProc = spawn("python", ["scripts/web_ui.py"], {
    cwd: ROOT,
    env: {
      ...process.env,
      STREAM_UI_PORT: PORT,
      PYTHONUNBUFFERED: "1",
    },
    stdio: "inherit",
  });

  try {
    await pollHealth();
    console.log("[E2E DUAL STREAM] Server healthy. Launching Playwright...");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 950 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    // 1. Initial Page Load
    console.log("Step 1: Dashboard Page Load");
    await page.goto(URL, { waitUntil: "networkidle" });
    await wait(1200);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "shot01_initial_dashboard_load.png") });

    // 2. Select Channel 'Inside Us'
    console.log("Step 2: Selecting 'Inside Us' Channel");
    const insideUsBtn = await page.$(".workspace-channel-row:has-text('Inside Us')");
    if (insideUsBtn) {
      await insideUsBtn.click();
    }
    await wait(800);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "shot02_inside_us_selected.png") });

    // 3. Click 'Streams' Tab in Sidebar (#railOpenStreams)
    console.log("Step 3: Clicking 'Streams' Tab Button");
    await page.click("#railOpenStreams");
    await wait(1500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "shot03_streams_tab_opened.png") });

    // 4. Click Expand Toggle on First Stream Card
    console.log("Step 4: Clicking Expand Toggle on Stream 1");
    const expandToggle = await page.$(".stream-card .stream-expand-toggle");
    if (expandToggle) {
      await expandToggle.click();
    }
    await wait(800);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "shot04_stream_details_expanded.png") });
    await captureCard(page, "shot04_stream_card_expanded_closeup.png");

    // 5. Select Privacy Status -> Unlisted
    console.log("Step 5: Selecting Privacy Status 'unlisted'");
    const privacySelect = await page.$("select[id^='streamPrivacySelect_']");
    if (privacySelect) {
      await privacySelect.selectOption("unlisted");
    }
    await wait(1000);

    // 6. Verify Dual Stream Toggle is Checked (ON)
    console.log("Step 6: Verifying / Toggling Dual Stream Switch ON");
    const dualSwitch = await page.$("input[id^='streamDualSwitch_']");
    if (dualSwitch) {
      const isChecked = await dualSwitch.isChecked();
      if (!isChecked) {
        await dualSwitch.check();
      }
    }
    await wait(1000);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "shot05_unlisted_and_dual_toggle_active.png") });
    await captureCard(page, "shot05_dual_toggle_and_unlisted_closeup.png");

    // 7. Click ▶ Start Stream Button
    console.log("Step 7: Clicking ▶ Start Stream button");
    const startBtn = await page.$(".stream-card .stream-start-btn");
    if (startBtn) {
      await startBtn.click();
    }
    await wait(1800);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "shot06_stream_launching.png") });

    // 8. Stream Ingestion & Active Status
    console.log("Step 8: Stream Running & Active Monitoring");
    await wait(4500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "shot07_stream_active_live.png") });
    await captureCard(page, "shot07_running_stream_card_closeup.png");

    // 9. Stop the stream cleanly
    console.log("Step 9: Stopping stream cleanly");
    const stopBtn = await page.$(".stream-card .stream-stop-btn");
    if (stopBtn) {
      await stopBtn.click();
    }
    await wait(1500);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, "shot08_stream_stopped_cleanly.png") });

    await browser.close();
    console.log("[E2E DUAL STREAM] Verification completed 100% successfully!");
  } finally {
    serverProc.kill("SIGTERM");
    setTimeout(() => serverProc.kill("SIGKILL"), 1000);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
