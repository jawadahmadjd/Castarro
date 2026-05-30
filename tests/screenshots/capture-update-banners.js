const { chromium } = require("playwright");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const OUT_DIR = path.join(process.cwd(), "tests", "screenshots");
const PORT = "8777";
const URL = `http://127.0.0.1:${PORT}`;

const SCENES = [
  {
    name: "update-available",
    status: { status: "available", version: "1.1.0", downloaded: false, percent: 0, message: "" },
  },
  {
    name: "update-downloading",
    status: { status: "downloading", version: "1.1.0", downloaded: false, percent: 64, message: "" },
  },
  {
    name: "update-downloaded",
    status: { status: "downloaded", version: "1.1.0", downloaded: true, percent: 100, message: "Ready" },
  },
  {
    name: "update-error",
    status: { status: "error", version: null, downloaded: false, percent: 0, message: "Network unavailable" },
  },
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(pathname = "/api/status") {
  return new Promise((resolve, reject) => {
    const req = http.get(`${URL}${pathname}`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if ((res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(2000, () => req.destroy(new Error("timeout")));
  });
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await request("/api/status");
      return;
    } catch {
      await wait(500);
    }
  }
  throw new Error(`Server not ready at ${URL}`);
}

function startServer() {
  const env = { ...process.env, STREAM_UI_PORT: PORT };
  const child = spawn("python", ["scripts/web_ui.py"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

  return child;
}

async function stopServer(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    await new Promise((resolve) => killer.on("exit", resolve));
    return;
  }
  child.kill("SIGTERM");
}

async function shot(scene) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1490, height: 900 } });
  await context.addInitScript((status) => {
    window.desktopShell = {
      packaged: true,
      getUpdateStatus: async () => status,
      onUpdateStatus: (callback) => {
        if (typeof callback === "function") {
          setTimeout(() => callback(status), 0);
        }
        return () => {};
      },
      requestQuit: async () => ({ ok: true }),
    };
  }, scene.status);

  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#updateBanner:not(.hidden)", { timeout: 10000 });
  await page.screenshot({ path: path.join(OUT_DIR, `${scene.name}.png`), fullPage: true });
  await browser.close();
}

(async () => {
  const server = startServer();
  try {
    await waitForServer();
    for (const scene of SCENES) {
      await shot(scene);
    }
    console.log(`Saved ${SCENES.length} screenshots to ${OUT_DIR}`);
  } finally {
    await stopServer(server);
  }
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
