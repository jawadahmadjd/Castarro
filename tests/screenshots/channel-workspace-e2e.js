const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "tests", "screenshots");
const PORT = "8786";
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
      accounts: [
        { id: "acct-a", label: "Account A", tokens_file: ".runtime/a.json" },
        { id: "acct-b", label: "Account B", tokens_file: ".runtime/b.json" },
      ],
      default_account_id: "",
      default_privacy_status: "unlisted",
      default_auto_start: true,
      default_auto_stop: true,
    },
    channels: [
      {
        name: "A",
        enabled: true,
        stream_key_env: "YT_CHANNEL_A_KEY",
        raw_playlist: ["Raw Videos/A/video-a.mp4"],
        playlist: [],
        youtube_auto_start: true,
        youtube_auto_stop: true,
        youtube_account_id: "acct-a",
        youtube_studio_url: "",
        youtube_broadcast_id: "",
        youtube_stream_id: "",
        loop: true,
        restart_on_exit: true,
      },
      {
        name: "B",
        enabled: true,
        stream_key_env: "YT_CHANNEL_B_KEY",
        raw_playlist: ["Raw Videos/B/video-b.mp4"],
        playlist: [],
        youtube_auto_start: true,
        youtube_auto_stop: true,
        youtube_account_id: "acct-b",
        youtube_studio_url: "",
        youtube_broadcast_id: "",
        youtube_stream_id: "",
        loop: true,
        restart_on_exit: true,
      },
      {
        name: "C",
        enabled: true,
        stream_key_env: "YT_CHANNEL_C_KEY",
        raw_playlist: ["Raw Videos/C/video-c.mp4"],
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
  const configPath = path.join(tempRoot, "config.ready.json");
  fs.writeFileSync(configPath, JSON.stringify(makeConfig(), null, 2) + "\n", "utf8");
  for (const name of ["A", "B", "C"]) {
    const rawDir = path.join(tempRoot, "Raw Videos", name);
    const goLiveDir = path.join(tempRoot, "Go Live", name);
    fs.mkdirSync(rawDir, { recursive: true });
    fs.mkdirSync(goLiveDir, { recursive: true });
    fs.writeFileSync(path.join(rawDir, `video-${name.toLowerCase()}.mp4`), Buffer.from("fixture", "utf8"));
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

async function captureScreenshots(page) {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#channelWorkspaceRail:not(.hidden)");
  await page.screenshot({ path: path.join(OUT_DIR, "workspace-control.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, "workspace-control-320.png"), fullPage: true });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, "workspace-control-768.png"), fullPage: true });
  await page.setViewportSize({ width: 1490, height: 900 });

  await page.locator("#railOpenEncoder").click();
  await page.waitForSelector("#settingsNormalizeView.active");
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, "workspace-normalize.png"), fullPage: true });

  await page.locator("#railOpenYoutube").click();
  await page.waitForSelector("#settingsYoutubeView.active");
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, "workspace-live.png"), fullPage: true });

  await page.locator("#railOpenYoutube").click();
  await page.waitForSelector("#settingsYoutubeView.active");
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, "workspace-youtube.png"), fullPage: true });
}

async function runUiChecks(page) {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#channelWorkspaceRail:not(.hidden)");

  await page.locator('#channelWorkspaceRail [data-channel-name="B"]').click();
  await page.waitForTimeout(400);
  const activeRailLabel = await page.locator("#channelWorkspaceRail .workspace-channel-item.active .channel-name").innerText();
  assert.equal(activeRailLabel.trim(), "B");

  await page.locator("#railOpenYoutube").click();
  await page.waitForSelector("#settingsYoutubeView.active");
  assert.equal(await page.locator("#youtubeAccountSlot").count(), 0);
  assert.equal(await page.locator("#youtubeNewAccountLabel").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Add Slot" }).count(), 0);
  assert.equal(await page.locator("#youtubeScheduleChannel").count(), 0);
  assert.equal(await page.locator("#youtubeScheduleThumbnail").count(), 1);
  assert.equal(await page.locator(".youtube-connection-summary").count(), 1);
  assert.equal(await page.locator(".youtube-account-row").count(), 0);
  await page.evaluate(() => {
    state.youtubeStatus = {
      connected: true,
      connected_count: 1,
      has_client_credentials: true,
      accounts: [
        {
          id: "acct-a",
          label: "Account A",
          connected: true,
          channel_title: "A",
          channel_handle: "@a",
          expected_channel_name: "A",
          message: "Connected.",
        },
        {
          id: "acct-b",
          label: "Account B",
          connected: false,
          wrong_account: true,
          channel_title: "Wrong Channel",
          channel_handle: "@wrong",
          expected_channel_name: "B",
          message: "Connected YouTube channel 'Wrong Channel' does not look like Castarro channel 'B'.",
        },
      ],
      default_account_id: "acct-a",
    };
    renderYoutubeSettingsPanel(state.configData);
    renderChannelWorkspace(state.status);
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, "workspace-youtube-account-states.png"), fullPage: true });
  assert.equal(await page.locator(".youtube-connection-summary").count(), 1);
  assert.equal(await page.locator(".youtube-account-row").count(), 0);
  await page.getByText("B / Wrong Channel").waitFor();
  await page.locator(".youtube-connection-summary .badge", { hasText: "Wrong" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Disconnect", exact: true }).isEnabled(), true);
  const railConnection = await page.locator('#channelWorkspaceRail [data-channel-name="B"] .workspace-channel-item-meta').innerText();
  assert.match(railConnection, /Disconnected/);

  await page.evaluate(() => {
    setWorkspaceSelectedChannel("C");
    renderYoutubeSettingsPanel(state.configData);
    renderChannelWorkspace(state.status);
  });
  await page.waitForTimeout(250);
  await page.locator(".youtube-connection-summary strong", { hasText: "C" }).waitFor();
  await page.locator(".youtube-connection-summary .badge", { hasText: "Disconnected" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Connect", exact: true }).isEnabled(), true);
  const unlinkedSummary = await page.locator(".youtube-connection-summary").innerText();
  assert.doesNotMatch(unlinkedSummary, /Account A/);
  const authStartPath = await page.evaluate(async () => {
    const originalApi = api;
    const originalOpen = window.open;
    const calls = [];
    api = async (path, options = {}) => {
      calls.push({ path, action: options.action || "" });
      if (String(path).startsWith("/api/config/save")) return { ok: true };
      if (String(path).startsWith("/api/status")) return state.status;
      if (String(path).startsWith("/api/raw-files")) return { files: [] };
      if (String(path).startsWith("/api/normalized-files")) return { files: [] };
      if (String(path).startsWith("/api/youtube/auth/start")) {
        return { ok: true, account_id: "account-3", url: "http://127.0.0.1/mock-auth" };
      }
      return {};
    };
    window.open = () => ({ closed: false });
    state.youtubeSelectedAccountId = "acct-a";
    try {
      await connectYoutube();
    } finally {
      api = originalApi;
      window.open = originalOpen;
    }
    return calls.find((item) => item.path.startsWith("/api/youtube/auth/start"))?.path || "";
  });
  const authStartUrl = new global.URL(`http://local${authStartPath}`);
  assert.equal(authStartUrl.searchParams.get("channel"), "C");
  assert.equal(authStartUrl.searchParams.has("account"), false);

  await page.evaluate(() => {
    setWorkspaceSelectedChannel("A");
    renderYoutubeSettingsPanel(state.configData);
    renderChannelWorkspace(state.status);
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, "workspace-youtube-connected-state.png"), fullPage: true });
  await page.locator(".youtube-connection-summary .badge", { hasText: "Connected" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Disconnect", exact: true }).isEnabled(), true);

  await page.evaluate(() => {
    setWorkspaceSelectedChannel("B");
    renderYoutubeSettingsPanel(state.configData);
    renderChannelWorkspace(state.status);
  });
  await page.waitForTimeout(250);

  await page.locator("#railOpenYoutube").click();
  await page.waitForSelector("#settingsYoutubeView.active");
  await page.waitForSelector("#channelSettings .selected-live-settings");
  assert.equal(await page.locator("#channelSettings .channel-settings").count(), 1);
  assert.equal(await page.locator("#channelSettings details.channel-settings").count(), 0);
  const selectedLiveCard = await page.locator("#channelSettings .selected-live-settings h3").first().innerText();
  assert.equal(selectedLiveCard.trim(), "B");

  await page.locator("#railOpenDashboard").click();
  await page.waitForSelector("#viewControl.active");
  const headerText = await page.locator("#workspacePageTitle").innerText();
  assert.equal(headerText.trim(), "B");
}

async function runApiChecks() {
  const status = await request("/api/status?config=config.ready.json");
  assert.equal(status.config_exists, true);
  assert.equal(Array.isArray(status.channels), true);
  assert.equal(status.channels.length, 3);

  const verifySingle = await request("/api/youtube/verify-channel-keys?config=config.ready.json&channel=C");
  assert.equal(verifySingle.channel, "C");
  assert.equal(Array.isArray(verifySingle.checks), true);
  assert.equal(verifySingle.checks.length, 1);
  assert.equal(Boolean(verifySingle.checks[0].guard_reason), true);

  let scheduleBlocked = false;
  try {
    await request("/api/youtube/schedule", "POST", {
      config: "config.ready.json",
      channel: "C",
      title: "Guard Test",
      description: "",
      privacy_status: "unlisted",
      scheduled_start_time: "2030-01-01T00:00:00Z",
      scheduled_end_time: "2030-01-01T01:00:00Z",
      auto_start: true,
      auto_stop: true,
    });
  } catch (error) {
    scheduleBlocked = (error.statusCode === 400);
  }
  assert.equal(scheduleBlocked, true, "unlinked + disconnected schedule should be blocked with 400");
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "castarro-workspace-e2e-"));
  writeFixtureData(tempRoot);

  const server = startServer(tempRoot);
  const stderr = [];
  server.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1490, height: 900 } });
    const page = await context.newPage();
    await captureScreenshots(page);
    await runUiChecks(page);
    await runApiChecks();
    await browser.close();
    console.log("channel-workspace-e2e: PASS");
  } finally {
    await stopServer(server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (stderr.length) {
      fs.writeFileSync(path.join(OUT_DIR, "workspace-e2e.stderr.log"), stderr.join(""), "utf8");
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
