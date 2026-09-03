const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const PORT = "8878";
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
      const req = http.get(`${URL}/api/system/chrome-profiles`, (res) => {
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

async function main() {
  console.log("Starting backend server on port", PORT);
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
    console.log("Server ready! Launching browser...");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    console.log("Navigating to UI...");
    await page.goto(URL, { waitUntil: "networkidle" });
    await wait(1500);

    // 1. Dashboard screenshot
    const dashPath = path.join(ARTIFACT_DIR, "chrome_binding_dashboard.png");
    await page.screenshot({ path: dashPath });

    // 2. Open edit modal
    await page.evaluate(() => {
      const editBtn = document.querySelector(".workspace-channel-edit-button") || document.querySelector("[onclick*='openWorkspaceChannelEdit']");
      if (editBtn) {
        editBtn.click();
      } else if (typeof window.openWorkspaceChannelEdit === "function") {
        const firstChan = (window.state?.configData?.channels?.[0]?.name) || "Inside Us";
        window.openWorkspaceChannelEdit(firstChan);
      }
    });
    await wait(1200);

    // 3. Select Profile 1 in the dropdown
    await page.evaluate(() => {
      const select = document.getElementById("workspaceChannelEditChromeProfile");
      if (select) {
        const targetOption = Array.from(select.options).find(o => o.value === "Profile 1" || o.text.includes("Inside Us"));
        if (targetOption) {
          select.value = targetOption.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    });
    await wait(400);

    // 4. Modal open full screen
    const modalFullPath = path.join(ARTIFACT_DIR, "chrome_binding_modal_open.png");
    await page.screenshot({ path: modalFullPath });

    // 5. Modal closeup
    const modalPanel = await page.$(".modal-panel.channel-edit-modal");
    if (modalPanel) {
      const closeupPath = path.join(ARTIFACT_DIR, "chrome_binding_modal_closeup.png");
      await modalPanel.screenshot({ path: closeupPath });
      console.log("Saved modal closeup to:", closeupPath);
    }

    await browser.close();
    console.log("Done capturing high-res screenshots!");
  } finally {
    serverProc.kill("SIGTERM");
    setTimeout(() => serverProc.kill("SIGKILL"), 1000);
  }
}

main().catch((err) => {
  console.error("Error in capture script:", err);
  process.exit(1);
});
