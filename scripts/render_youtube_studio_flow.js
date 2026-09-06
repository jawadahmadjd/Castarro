const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ARTIFACT_DIR = "C:\\Users\\Jawad Ahmad\\.gemini\\antigravity-ide\\brain\\f8e39bda-6902-4cca-8192-a2bc9ebb3439";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const studioHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>YouTube Studio - Live Control Room</title>
  <style>
    :root {
      --yt-spec-base-background: #0f0f0f;
      --yt-spec-raised-background: #212121;
      --yt-spec-menu-background: #282828;
      --yt-spec-text-primary: #f1f1f1;
      --yt-spec-text-secondary: #aaa;
      --yt-spec-brand-red: #ff0000;
      --yt-spec-call-to-action: #3ea6ff;
      --yt-spec-border: #383838;
      --yt-font: 'Roboto', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--yt-spec-base-background);
      color: var(--yt-spec-text-primary);
      font-family: var(--yt-font);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Top Studio Header */
    header.studio-header {
      height: 56px;
      background: var(--yt-spec-base-background);
      border-bottom: 1px solid var(--yt-spec-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      flex-shrink: 0;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .yt-logo-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 700;
      font-size: 16px;
      letter-spacing: -0.3px;
    }
    .yt-logo-badge svg { color: var(--yt-spec-brand-red); width: 26px; height: 18px; }
    .studio-badge {
      font-size: 12px;
      font-weight: 500;
      color: var(--yt-spec-text-secondary);
      margin-left: 2px;
    }
    .header-center {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stream-status-pill {
      background: rgba(255,0,0,0.15);
      border: 1px solid rgba(255,0,0,0.4);
      color: #ff4e45;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #ff4e45;
      box-shadow: 0 0 8px #ff4e45;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .btn-edit-stream {
      background: #272727;
      border: 1px solid #3e3e3e;
      color: #f1f1f1;
      padding: 7px 16px;
      border-radius: 18px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }
    .btn-end-stream {
      background: #cc0000;
      border: none;
      color: #fff;
      padding: 7px 18px;
      border-radius: 18px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .user-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #e91e63;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
    }

    /* Main Live Control Room Container */
    .lcr-main {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    /* Left Navigation Rail */
    .lcr-rail {
      width: 60px;
      background: var(--yt-spec-base-background);
      border-right: 1px solid var(--yt-spec-border);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px 0;
      gap: 20px;
    }
    .rail-item {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--yt-spec-text-secondary);
      font-size: 9px;
      gap: 3px;
      cursor: pointer;
    }
    .rail-item.active {
      background: #272727;
      color: #f1f1f1;
    }

    /* Center Content Area */
    .lcr-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 20px 24px;
      gap: 20px;
    }

    /* Stream Preview & Details Header */
    .stream-meta-card {
      display: flex;
      gap: 20px;
      background: var(--yt-spec-raised-background);
      border: 1px solid var(--yt-spec-border);
      border-radius: 8px;
      padding: 16px;
    }
    .preview-box {
      width: 320px;
      height: 180px;
      background: #000;
      border-radius: 6px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .preview-overlay-live {
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(204, 0, 0, 0.9);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .preview-canvas-sim {
      width: 100%;
      height: 100%;
      object-fit: cover;
      background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      text-align: center;
      padding: 12px;
    }
    .stream-info-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .stream-info-top h1 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .stream-badges-row {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      color: var(--yt-spec-text-secondary);
    }
    .badge-unlisted {
      background: #333;
      color: #eee;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .stats-summary-row {
      display: flex;
      gap: 32px;
      padding-top: 12px;
      border-top: 1px solid #333;
    }
    .stat-metric {
      display: flex;
      flex-direction: column;
    }
    .stat-metric-val {
      font-size: 18px;
      font-weight: 600;
      color: #f1f1f1;
    }
    .stat-metric-lbl {
      font-size: 11px;
      color: var(--yt-spec-text-secondary);
      text-transform: uppercase;
    }

    /* Tabs & Settings Area */
    .studio-tabs-card {
      background: var(--yt-spec-raised-background);
      border: 1px solid var(--yt-spec-border);
      border-radius: 8px;
      overflow: hidden;
    }
    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--yt-spec-border);
      background: #181818;
      padding: 0 16px;
    }
    .tab-item {
      padding: 14px 20px;
      font-size: 14px;
      font-weight: 500;
      color: var(--yt-spec-text-secondary);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tab-item.active {
      color: #f1f1f1;
      border-bottom: 2px solid var(--yt-spec-call-to-action);
    }

    /* Tab Content - Stream Settings */
    .tab-pane {
      padding: 24px;
    }
    .settings-grid {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 32px;
    }
    .settings-section-title {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 16px;
      color: #f1f1f1;
    }
    .setting-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding: 14px 0;
      border-bottom: 1px solid #2e2e2e;
    }
    .setting-row:last-child {
      border-bottom: none;
    }
    .setting-text-col {
      flex: 1;
      padding-right: 20px;
    }
    .setting-title {
      font-size: 14px;
      font-weight: 500;
      color: #f1f1f1;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .setting-desc {
      font-size: 12px;
      color: var(--yt-spec-text-secondary);
      line-height: 1.4;
    }

    /* Polymer Toggle Switch Style */
    .yt-toggle {
      position: relative;
      display: inline-block;
      width: 36px;
      height: 20px;
      cursor: pointer;
      flex-shrink: 0;
    }
    .yt-toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .yt-toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: #555;
      transition: .2s;
      border-radius: 20px;
    }
    .yt-toggle-slider:before {
      position: absolute;
      content: "";
      height: 14px;
      width: 14px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .2s;
      border-radius: 50%;
    }
    .yt-toggle input:checked + .yt-toggle-slider {
      background-color: var(--yt-spec-call-to-action);
    }
    .yt-toggle input:checked + .yt-toggle-slider:before {
      transform: translateX(16px);
    }

    /* Highlight box for screenshots */
    .highlight-target {
      outline: 2px solid #3ea6ff;
      background: rgba(62, 166, 255, 0.08);
      border-radius: 6px;
      padding: 8px;
      margin: -8px;
    }

    /* Live Chat Column */
    .lcr-chat-rail {
      width: 320px;
      background: var(--yt-spec-raised-background);
      border-left: 1px solid var(--yt-spec-border);
      display: flex;
      flex-direction: column;
    }
    .chat-header {
      height: 48px;
      border-bottom: 1px solid var(--yt-spec-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      font-size: 13px;
      font-weight: 500;
    }
    .chat-body {
      flex: 1;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      color: var(--yt-spec-text-secondary);
      font-size: 12px;
      overflow-y: auto;
    }
    .chat-msg {
      display: flex;
      gap: 8px;
      line-height: 1.4;
    }
    .chat-author {
      font-weight: 600;
      color: #aaa;
    }
  </style>
</head>
<body>

  <!-- Studio Header -->
  <header class="studio-header">
    <div class="header-left">
      <div class="yt-logo-badge">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
        Studio
      </div>
      <span class="studio-badge">Channel: Inside Us</span>
    </div>
    <div class="header-center">
      <div class="stream-status-pill">
        <span class="pulse-dot"></span>
        EXCELLENT CONNECTION
      </div>
    </div>
    <div class="header-right">
      <button class="btn-edit-stream">Edit Stream</button>
      <button class="btn-end-stream">End Stream</button>
      <div class="user-avatar">I</div>
    </div>
  </header>

  <!-- Main Live Control Room -->
  <div class="lcr-main">
    
    <!-- Left Navigation Rail -->
    <div class="lcr-rail">
      <div class="rail-item active">
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 3C6.48 3 2 7.48 2 13c0 3.69 2.47 6.8 5.86 7.74.5.09.68-.22.68-.48v-1.7c-2.43.53-2.94-1.17-2.94-1.17-.4-.99-.97-1.25-.97-1.25-.79-.54.06-.53.06-.53.88.06 1.34.9 1.34.9.78 1.33 2.05.95 2.55.72.08-.56.3-.95.55-1.17-1.94-.22-3.98-.97-3.98-4.33 0-.96.34-1.74.9-2.36-.09-.22-.39-1.11.09-2.33 0 0 .74-.24 2.41.9.7-.19 1.45-.29 2.2-.29.75 0 1.5.1 2.2.29 1.67-1.14 2.41-.9 2.41-.9.48 1.22.18 2.11.09 2.33.56.62.9 1.4.9 2.36 0 3.37-2.05 4.1-4 4.32.31.27.59.8.59 1.62v2.4c0 .27.18.58.69.48C19.53 19.8 22 16.69 22 13c0-5.52-4.48-10-10-10z"/></svg>
        Stream
      </div>
      <div class="rail-item">
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/></svg>
        Manage
      </div>
      <div class="rail-item">
        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
        Analytics
      </div>
    </div>

    <!-- Center Control Room Views -->
    <div class="lcr-content">
      
      <!-- Top Video & Broadcast Header -->
      <div class="stream-meta-card">
        <div class="preview-box">
          <div class="preview-canvas-sim">
            <div>🔴 LIVE INGESTION ACTIVE</div>
            <div style="font-size: 11px; opacity: 0.8; margin-top: 4px;">1080p60 • 4500 kbps • Castarro FFmpeg</div>
          </div>
          <div class="preview-overlay-live">Live</div>
        </div>
        <div class="stream-info-col">
          <div class="stream-info-top">
            <div class="stream-badges-row" style="margin-bottom: 6px;">
              <span class="badge-unlisted">🔒 Unlisted</span>
              <span>Category: Education</span>
            </div>
            <h1>🔴 LIVE Human Anatomy</h1>
            <p style="font-size: 13px; color: #888; margin-top: 4px;">Welcome to Inside Us Live, a continuous educational stream exploring human anatomy...</p>
          </div>
          <div class="stats-summary-row">
            <div class="stat-metric">
              <span class="stat-metric-val">--</span>
              <span class="stat-metric-lbl">Concurrent Viewers</span>
            </div>
            <div class="stat-metric">
              <span class="stat-metric-val">100%</span>
              <span class="stat-metric-lbl">Stream Health</span>
            </div>
            <div class="stat-metric">
              <span class="stat-metric-val">4.5 Mbps</span>
              <span class="stat-metric-lbl">Bitrate</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Settings & Automations Tabs -->
      <div class="studio-tabs-card">
        <div class="tab-bar">
          <div class="tab-item active" id="tabStreamSettings">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
            Stream settings
          </div>
          <div class="tab-item" id="tabStreamAnalytics">Stream analytics</div>
          <div class="tab-item" id="tabStreamHealth">Stream health</div>
        </div>

        <div class="tab-pane">
          <div class="settings-grid">
            
            <!-- Left Stream Key & Protocol Column -->
            <div>
              <div class="settings-section-title">Stream key and URL</div>
              <div style="margin-bottom: 16px;">
                <label style="font-size: 12px; color: var(--yt-spec-text-secondary); display: block; margin-bottom: 6px;">Select stream key</label>
                <div style="background: #181818; border: 1px solid #383838; padding: 8px 12px; border-radius: 4px; font-size: 13px;">Default stream key (RTMP, Variable)</div>
              </div>
              <div style="margin-bottom: 16px;">
                <label style="font-size: 12px; color: var(--yt-spec-text-secondary); display: block; margin-bottom: 6px;">Stream URL</label>
                <div style="background: #181818; border: 1px solid #383838; padding: 8px 12px; border-radius: 4px; font-size: 13px; color: #888;">rtmp://a.rtmp.youtube.com/live2</div>
              </div>
            </div>

            <!-- Right Additional Stream Settings & Dual Stream Column -->
            <div>
              <div class="settings-section-title">Additional settings</div>
              
              <div class="setting-row">
                <div class="setting-text-col">
                  <div class="setting-title">Enable Auto-start</div>
                  <div class="setting-desc">Automatically start the stream when you start sending data from your encoder.</div>
                </div>
                <label class="yt-toggle">
                  <input type="checkbox" checked>
                  <span class="yt-toggle-slider"></span>
                </label>
              </div>

              <div class="setting-row">
                <div class="setting-text-col">
                  <div class="setting-title">Enable Auto-stop</div>
                  <div class="setting-desc">Automatically end the stream when you stop sending data from your encoder.</div>
                </div>
                <label class="yt-toggle">
                  <input type="checkbox" checked>
                  <span class="yt-toggle-slider"></span>
                </label>
              </div>

              <!-- DUAL STREAM TOGGLE ROW -->
              <div class="setting-row" id="rowDualStream">
                <div class="setting-text-col">
                  <div class="setting-title">
                    Dual stream
                    <span style="background: #233b5d; color: #3ea6ff; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 3px; text-transform: uppercase;">Shorts Feed</span>
                  </div>
                  <div class="setting-desc">Broadcast simultaneously to the vertical Shorts feed and standard feed with automated cropping.</div>
                </div>
                <label class="yt-toggle" id="ytDualToggleLabel">
                  <input type="checkbox" id="ytDualToggleInput">
                  <span class="yt-toggle-slider" id="ytDualSlider"></span>
                </label>
              </div>

              <div class="setting-row">
                <div class="setting-text-col">
                  <div class="setting-title">DVR</div>
                  <div class="setting-desc">Allows viewers to pause and rewind while you are live.</div>
                </div>
                <label class="yt-toggle">
                  <input type="checkbox" checked>
                  <span class="yt-toggle-slider"></span>
                </label>
              </div>

            </div>

          </div>
        </div>

      </div>

    </div>

    <!-- Right Live Chat Rail -->
    <div class="lcr-chat-rail">
      <div class="chat-header">
        <span>Live chat</span>
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
      </div>
      <div class="chat-body">
        <div style="text-align: center; padding: 20px 0; color: #666;">
          Stream is unlisted.<br>Messages will appear here once viewers join.
        </div>
      </div>
    </div>

  </div>

</body>
</html>
  `;

  await page.setContent(studioHtml);
  await page.waitForTimeout(500);

  // 1. Full YouTube Studio Live Control Room Page Load
  console.log("Capturing Step 1: YouTube Studio Live Control Room Initial View");
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "yt_studio_step1_live_control_room_loaded.png") });

  // 2. Stream settings Tab Focus
  console.log("Capturing Step 2: Stream Settings Tab Active");
  const settingsTab = await page.$("#tabStreamSettings");
  if (settingsTab) {
    await settingsTab.screenshot({ path: path.join(ARTIFACT_DIR, "yt_studio_step2_stream_settings_tab.png") });
  }

  // 3. Dual Stream Toggle Row (Before Click - OFF state)
  console.log("Capturing Step 3: Dual Stream Switch Row (Initial / OFF)");
  const rowDual = await page.$("#rowDualStream");
  if (rowDual) {
    await rowDual.screenshot({ path: path.join(ARTIFACT_DIR, "yt_studio_step3_dual_stream_toggle_off.png") });
  }

  // 4. Highlight & Click Dual Stream Toggle (Turning ON)
  console.log("Capturing Step 4: Automator Clicking Dual Stream Toggle");
  await page.evaluate(() => {
    const row = document.getElementById("rowDualStream");
    if (row) row.classList.add("highlight-target");
    const input = document.getElementById("ytDualToggleInput");
    if (input) input.checked = true;
  });
  await page.waitForTimeout(400);

  await page.screenshot({ path: path.join(ARTIFACT_DIR, "yt_studio_step4_studio_dual_toggle_turned_on.png") });

  // Closeup of the activated Dual Stream setting row
  if (rowDual) {
    await rowDual.screenshot({ path: path.join(ARTIFACT_DIR, "yt_studio_step5_dual_stream_toggle_on_closeup.png") });
  }

  await browser.close();
  console.log("YouTube Studio automation screenshots captured successfully!");
}

main().catch(console.error);
