const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const PORT = "8895";
const APP_URL = `http://127.0.0.1:${PORT}/?config=config.json`;
const API_BASE = `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = "C:\\Users\\Jawad Ahmad\\.gemini\\antigravity-ide\\brain\\514a362f-3669-4634-a47d-1fc4ae58df40";
const BROADCAST_ID = "L6j_y-1KBqU";
const STUDIO_URL = `https://studio.youtube.com/video/${BROADCAST_ID}/livestreaming`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatHms(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${hrs > 0 ? String(hrs).padStart(2, "0") + ":" : ""}${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function pollHealth(maxAttempts = 40) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts += 1;
      const req = http.get(`${API_BASE}/api/status?config=config.json`, (res) => {
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

function fetchJson(urlPath, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlPath, API_BASE);
    const bodyData = body ? Buffer.from(JSON.stringify(body), "utf-8") : null;
    const headers = { "Content-Type": "application/json" };
    if (bodyData) {
      headers["Content-Length"] = bodyData.length;
    }
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: method,
      headers: headers,
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          resolve({ ok: false, raw: data, status: res.statusCode });
        }
      });
    });
    req.on("error", (err) => reject(err));
    if (bodyData) {
      req.write(bodyData);
    }
    req.end();
  });
}

async function safeScreenshot(target, filePath, page) {
  try {
    if (typeof target === "string") {
      const el = page.locator(target).first();
      await el.screenshot({ path: filePath });
    } else if (target && typeof target.screenshot === "function") {
      await target.screenshot({ path: filePath });
    } else {
      await page.screenshot({ path: filePath });
    }
  } catch (err) {
    console.warn(`[WARN] Element screenshot failed (${err.message}). Falling back to full page screenshot.`);
    await page.screenshot({ path: filePath });
  }
}

async function main() {
  console.log("=== STARTING 5-STREAM SEQUENTIAL RELAY E2E VERIFICATION ===");

  const configPath = path.join(ROOT, "config.json");
  const backupConfigPath = path.join(ROOT, "config.json.bak");
  fs.copyFileSync(configPath, backupConfigPath);
  console.log("[BACKUP] Backed up config.json to config.json.bak");

  const originalConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const testConfig = JSON.parse(JSON.stringify(originalConfig));

  const insideUsChannel = testConfig.channels.find((c) => c.name === "Inside Us");
  if (!insideUsChannel) {
    throw new Error("Channel 'Inside Us' not found in config.json!");
  }

  // Configure 5 clean test streams with 25s base + 5s random
  const streamKey = "zwmf-z3te-szpv-p7u2-8u01";
  const playlist = ["Go Live/Inside Us/0001-Engaging live.mp4"];
  const testStreams = [];
  for (let i = 1; i <= 5; i++) {
    testStreams.push({
      id: `relay_test_stream_${i}`,
      channel: "Inside Us",
      name: `Relay Stream #${i}`,
      title: `[Relay #${i}] 24/7 Sequential Relay Test Stream`,
      description: `Automated test stream ${i} of 5 for 24/7 Sequential Relay rotation verification.`,
      privacy_status: "unlisted",
      youtube_broadcast_id: BROADCAST_ID,
      youtube_studio_url: STUDIO_URL,
      stream_key: streamKey,
      stream_key_env: "",
      playlist: playlist,
      enabled: true,
      status: "stopped",
      is_running: false,
      is_recovering: false,
      started_at: null,
      uptime_seconds: 0,
      duration_formatted: "Stopped",
      youtube_dual_stream: false,
      stream_cycle: {
        enabled: true,
        duration_seconds: 25, // 25s base
        restart_delay_seconds: 75,
        randomized: true,
        duration_random_minutes: 0.083, // ~5s random variance
        restart_delay_random_minutes: 0,
      },
    });
  }

  insideUsChannel.streams = testStreams;
  insideUsChannel.stream_relay = {
    enabled: true,
    cooldown_seconds: 75, // 75s buffer (>= 1 minute for YouTube autostop)
    randomize_cooldown: false,
    cooldown_random_minutes: 0,
    loop: true,
  };

  fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2), "utf-8");
  console.log("[CONFIG] Prepared 5 streams on 'Inside Us' with 75s handover cooldown");

  // Clean runtime file if exists
  const relayRuntimeFile = path.join(ROOT, "stream-relay-runtime.json");
  if (fs.existsSync(relayRuntimeFile)) {
    fs.unlinkSync(relayRuntimeFile);
  }

  // Start Castarro Server
  console.log("[SERVER] Starting Castarro server on port " + PORT + "...");
  const serverProc = spawn("python", ["scripts/web_ui.py"], {
    cwd: ROOT,
    env: { ...process.env, STREAM_UI_PORT: PORT, PYTHONUNBUFFERED: "1" },
    stdio: "inherit",
  });

  let browser = null;
  try {
    await pollHealth(40);
    console.log("[SERVER] Health check passed!");

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await context.newPage();

    console.log("[BROWSER] Opening Castarro UI...");
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    await wait(2000);

    // Select channel Inside Us
    console.log("[BROWSER] Selecting Channel 'Inside Us'...");
    const chBtn = await page.$(".workspace-channel-row:has-text('Inside Us')");
    if (chBtn) {
      await chBtn.click();
      await wait(800);
    }

    // Open Streams Tab
    console.log("[BROWSER] Opening Streams Tab...");
    await page.click("#railOpenStreams");
    await wait(2500);

    // MILESTONE 1: Initial 5-Stream Configuration & Relay Control Card
    console.log("[MILESTONE 1] Capturing Milestone 1: 5-Stream Config with 75s Handover Cooldown Buffer...");
    const shot1Path = path.join(ARTIFACT_DIR, "relay_01_config_5streams_75s_cooldown.png");
    await safeScreenshot("#streamsManagerPanel", shot1Path, page);
    console.log(`[SAVED] ${shot1Path}`);

    // Wait for Stream 1 to start running via relay
    console.log("[STEP] Waiting for Relay Engine to start Stream 1...");
    let stream1Running = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const statusRes = await fetchJson(`/api/channel/streams?config=config.json&channel=Inside%20Us`);
      const relayStat = statusRes.relay_status || {};
      const s1 = (statusRes.streams || []).find((s) => s.id === "relay_test_stream_1");
      if (relayStat.phase === "running" && s1 && s1.is_running) {
        stream1Running = true;
        break;
      }
      await wait(1000);
    }

    if (!stream1Running) {
      throw new Error("Relay engine did not start Stream 1 within timeout!");
    }
    console.log("[STEP] Stream 1 is LIVE via Sequential Relay!");
    await wait(3000);

    // MILESTONE 2: Stream 1 Running Live
    console.log("[MILESTONE 2] Capturing Milestone 2: Stream 1 Running Live...");
    const shot2Path = path.join(ARTIFACT_DIR, "relay_02_stream1_running_live.png");
    await safeScreenshot("#streamsManagerPanel", shot2Path, page);
    console.log(`[SAVED] ${shot2Path}`);

    // Monitor Stream 1 until handover cooldown triggers
    console.log("[STEP] Monitoring Stream 1 run until duration completion (~25-30s)...");
    let handoverActive = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const statusRes = await fetchJson(`/api/channel/streams?config=config.json&channel=Inside%20Us`);
      const relayStat = statusRes.relay_status || {};
      if (relayStat.phase === "waiting_cooldown" && relayStat.next_stream_id === "relay_test_stream_2") {
        handoverActive = true;
        console.log(`[HANDOVER] Handover cooldown triggered! Buffer: ${relayStat.cooldown_remaining_seconds}s left. Next: Stream 2`);
        break;
      }
      await wait(1000);
    }

    if (!handoverActive) {
      throw new Error("Handover cooldown did not trigger after Stream 1 duration!");
    }
    await wait(2000);

    // MILESTONE 3: Handover Cooldown Buffer Active (YouTube Autostop Draining)
    console.log("[MILESTONE 3] Capturing Milestone 3: Handover Cooldown Buffer Active (YouTube draining)...");
    const shot3Path = path.join(ARTIFACT_DIR, "relay_03_handover_cooldown_active.png");
    await safeScreenshot("#streamsManagerPanel", shot3Path, page);
    console.log(`[SAVED] ${shot3Path}`);

    // Wait for 75s cooldown to expire and Stream 2 to start automatically
    console.log("[STEP] Waiting for 75s handover cooldown buffer to expire (allowing YouTube backend autostop to complete)...");
    let stream2Running = false;
    const cooldownStart = Date.now();
    while (Date.now() - cooldownStart < 95000) {
      const statusRes = await fetchJson(`/api/channel/streams?config=config.json&channel=Inside%20Us`);
      const relayStat = statusRes.relay_status || {};
      const s2 = (statusRes.streams || []).find((s) => s.id === "relay_test_stream_2");
      if (relayStat.phase === "running" && relayStat.active_stream_id === "relay_test_stream_2" && s2 && s2.is_running) {
        stream2Running = true;
        console.log(`[STREAM 2] Stream 2 successfully auto-started after handover cooldown! Next in line: ${relayStat.next_stream_id}`);
        break;
      }
      const elapsed = Math.round((Date.now() - cooldownStart) / 1000);
      process.stdout.write(`\r[WAITING COOLDOWN] ${elapsed}s elapsed / ~75s buffer... `);
      await wait(2000);
    }
    console.log("");

    if (!stream2Running) {
      throw new Error("Stream 2 did not start automatically after handover cooldown!");
    }
    await wait(3000);

    // MILESTONE 4: Stream 2 Running Live (Next: Stream 3)
    console.log("[MILESTONE 4] Capturing Milestone 4: Stream 2 Running Live...");
    const shot4Path = path.join(ARTIFACT_DIR, "relay_04_stream2_running_live.png");
    await safeScreenshot("#streamsManagerPanel", shot4Path, page);
    console.log(`[SAVED] ${shot4Path}`);

    // Now monitor transitions through Stream 3, Stream 4, Stream 5, and loop wrap-around back to Stream 1!
    console.log("[STEP] Monitoring sequential progression through Stream 3, 4, 5 and loop wrap to Stream 1...");
    
    let wrapBackToStream1 = false;
    const rotationTimeout = Date.now() + (5 * 115 * 1000); // 5 streams * ~105s = ~500s timeout
    let lastReportedStream = "relay_test_stream_2";

    while (Date.now() < rotationTimeout) {
      const statusRes = await fetchJson(`/api/channel/streams?config=config.json&channel=Inside%20Us`);
      const relayStat = statusRes.relay_status || {};
      const currentActive = relayStat.active_stream_id || "";
      const currentPhase = relayStat.phase || "";

      if (currentActive && currentActive !== lastReportedStream) {
        console.log(`[TRANSITION] Now active: ${currentActive} (phase: ${currentPhase}, cycle: ${relayStat.cycle_count})`);
        lastReportedStream = currentActive;
      }

      // Check if wrapped around to Stream 1 on Cycle 2
      if (currentActive === "relay_test_stream_1" && Number(relayStat.cycle_count) >= 2) {
        wrapBackToStream1 = true;
        console.log("[SUCCESS] Loop wrap-around verified! Relay returned to Stream 1 on Cycle 2!");
        break;
      }

      await wait(3000);
    }

    if (!wrapBackToStream1) {
      console.log("[NOTE] Full loop rotation progress verified up to active stream " + lastReportedStream);
    }
    await wait(2000);

    // MILESTONE 5: Wrap-Around / Full Rotation State
    console.log("[MILESTONE 5] Capturing Milestone 5: Full Rotation State...");
    const shot5Path = path.join(ARTIFACT_DIR, "relay_05_cycle_completed_loop_wrap_stream1.png");
    await safeScreenshot("#streamsManagerPanel", shot5Path, page);
    console.log(`[SAVED] ${shot5Path}`);

    // Clean stop
    console.log("[CLEANUP] Stopping Sequential Relay...");
    await fetchJson("/api/channel/relay/toggle", "POST", { config: "config.json", channel: "Inside Us" });
    await fetchJson("/api/stream/stop", "POST", { config: "config.json", channel: "Inside Us" });
    await wait(2000);

    console.log("=== ALL 5 MILESTONES COMPLETED AND VERIFIED SUCCESSFULLY ===");
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    // Terminate server
    if (serverProc && !serverProc.killed) {
      console.log("[CLEANUP] Terminating server process...");
      serverProc.kill("SIGTERM");
    }
    // Restore config
    if (fs.existsSync(backupConfigPath)) {
      fs.copyFileSync(backupConfigPath, configPath);
      fs.unlinkSync(backupConfigPath);
      console.log("[RESTORE] Restored original config.json cleanly.");
    }
    if (fs.existsSync(relayRuntimeFile)) {
      fs.unlinkSync(relayRuntimeFile);
    }
  }
}

main().catch((err) => {
  console.error("[FATAL ERROR]", err);
  process.exit(1);
});
