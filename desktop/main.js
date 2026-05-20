const { app, BrowserWindow, Menu, Tray, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const HEALTHCHECK_TIMEOUT_MS = 30000;
const HEALTHCHECK_INTERVAL_MS = 500;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PRODUCT_NAME = "Castarro";
const LEGACY_PRODUCT_NAME = ["FFmpeg", "Live", "Streaming"].join(" ");

let mainWindow = null;
let tray = null;
let backend = null;
let backendPort = null;
let backendUrl = null;
let isQuitting = false;
let legacyDataRoot = null;
let updateCheckTimer = null;

function configureUserDataPath() {
  const configured = process.env.STREAM_DESKTOP_USER_DATA_DIR;
  const base = process.env.LOCALAPPDATA || app.getPath("appData");
  const target = configured || path.join(base, PRODUCT_NAME);
  legacyDataRoot = configured ? null : path.join(base, LEGACY_PRODUCT_NAME, "data");
  app.setPath("userData", target);
}

configureUserDataPath();

function diagnosticLog(message, error = null) {
  try {
    let dir = path.join(process.cwd(), "logs");
    try {
      dir = path.join(app.getPath("userData"), "logs");
    } catch (_error) {
      // Fall back to the launch directory below.
    }
    const detail = error ? ` ${error.stack || error.message || error}` : "";
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, "electron-main.log"), `[${new Date().toISOString()}] ${message}${detail}\n`);
    } catch (_error) {
      const fallback = path.join(process.cwd(), "logs");
      fs.mkdirSync(fallback, { recursive: true });
      fs.appendFileSync(path.join(fallback, "electron-main.log"), `[${new Date().toISOString()}] ${message}${detail}\n`);
    }
  } catch (_error) {
    // Diagnostics must never become the startup problem.
  }
}

diagnosticLog("main loaded");

process.on("uncaughtException", (error) => {
  diagnosticLog("uncaughtException", error);
});

process.on("unhandledRejection", (error) => {
  diagnosticLog("unhandledRejection", error);
});

const gotLock = app.requestSingleInstanceLock();
diagnosticLog(`single instance lock ${gotLock}`);
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function appRoot() {
  return app.getAppPath();
}

function resourcesRoot() {
  return process.resourcesPath || appRoot();
}

function codeRoot() {
  if (!app.isPackaged) return appRoot();
  const unpackedAsarRoot = path.join(resourcesRoot(), "app.asar.unpacked");
  if (fs.existsSync(unpackedAsarRoot)) return unpackedAsarRoot;
  return appRoot();
}

function userDataRoot() {
  return app.getPath("userData");
}

function dataRoot() {
  return path.join(userDataRoot(), "data");
}

function logRoot() {
  return path.join(userDataRoot(), "logs");
}

function executableName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function bundledPythonPath() {
  const configured = process.env.STREAM_PYTHON;
  if (configured) return configured;
  const exe = executableName("python");
  const bundled = firstExisting([
    path.join(resourcesRoot(), "python", exe),
    path.join(codeRoot(), "desktop", "resources", "python", exe)
  ]);
  if (bundled) return bundled;
  return app.isPackaged ? null : "python";
}

function bundledToolPath(name) {
  const exe = executableName(name);
  return firstExisting([
    path.join(resourcesRoot(), "ffmpeg", exe),
    path.join(codeRoot(), "desktop", "resources", "ffmpeg", exe)
  ]);
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 8765;
      server.close(() => resolve(port));
    });
  });
}

function requestStatus(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${url}/api/status`, (response) => {
      response.resume();
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
        resolve();
      } else {
        reject(new Error(`Backend returned HTTP ${response.statusCode}`));
      }
    });
    request.on("error", reject);
    request.setTimeout(2000, () => {
      request.destroy(new Error("Backend healthcheck timed out."));
    });
  });
}

async function waitForBackend(url) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < HEALTHCHECK_TIMEOUT_MS) {
    try {
      await requestStatus(url);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, HEALTHCHECK_INTERVAL_MS));
    }
  }
  throw lastError || new Error("Backend did not become ready.");
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadingHtml(title, message) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font: 14px Segoe UI, sans-serif; color: #1f2937; background: #f8fafc; display: grid; min-height: 100vh; place-items: center; }
    main { width: min(560px, calc(100vw - 48px)); }
    h1 { font-size: 24px; margin: 0 0 10px; }
    p { line-height: 1.5; margin: 0 0 12px; }
    code { background: #e5e7eb; border-radius: 4px; padding: 2px 5px; }
  </style>
</head>
<body>
  <main>
    <h1>${htmlEscape(title)}</h1>
    <p>${htmlEscape(message)}</p>
  </main>
</body>
</html>`;
}

function showLoading(message) {
  if (!mainWindow) return;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml("Starting", message))}`);
}

function showError(error) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const message = `${error.message}\n\nLogs: ${logRoot()}\nData: ${dataRoot()}`;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml("Startup Failed", message))}`);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(appRoot(), "desktop", "preload.js")
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (backendUrl && url.startsWith(backendUrl)) return;
    if (url.startsWith("data:text/html")) return;
    event.preventDefault();
  });
  mainWindow.on("closed", () => {
    diagnosticLog("main window closed");
    mainWindow = null;
  });
}

function createMenu() {
  const template = [
    {
      label: "App",
      submenu: [
        { label: "Reload UI", click: () => backendUrl && mainWindow && mainWindow.loadURL(backendUrl) },
        { label: "Open Data Folder", click: () => shell.openPath(dataRoot()) },
        { label: "Open Logs Folder", click: () => shell.openPath(logRoot()) },
        { type: "separator" },
        { label: "Quit", role: "quit" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const iconPath = firstExisting([
    path.join(codeRoot(), "desktop", "assets", "icon.ico"),
    path.join(resourcesRoot(), "icon.ico")
  ]);
  if (!iconPath) return;
  tray = new Tray(iconPath);
  tray.setToolTip(PRODUCT_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show", click: () => mainWindow && mainWindow.show() },
    { label: "Open Data Folder", click: () => shell.openPath(dataRoot()) },
    { label: "Open Logs Folder", click: () => shell.openPath(logRoot()) },
    { type: "separator" },
    { label: "Quit", role: "quit" }
  ]));
}

function configureAutoUpdates() {
  if (!app.isPackaged || process.env.STREAM_DISABLE_AUTO_UPDATE === "1" || process.env.STREAM_HEADLESS_SMOKE === "1") {
    diagnosticLog("auto updates skipped");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => diagnosticLog("checking for update"));
  autoUpdater.on("update-available", (info) => diagnosticLog(`update available ${info.version || ""}`));
  autoUpdater.on("update-not-available", (info) => diagnosticLog(`update not available ${info.version || ""}`));
  autoUpdater.on("download-progress", (progress) => {
    diagnosticLog(`update download ${Math.round(progress.percent || 0)}%`);
  });
  autoUpdater.on("update-downloaded", (info) => {
    diagnosticLog(`update downloaded ${info.version || ""}; will install when app quits`);
  });
  autoUpdater.on("error", (error) => diagnosticLog("auto update failed", error));

  const check = () => {
    autoUpdater.checkForUpdates().catch((error) => diagnosticLog("update check failed", error));
  };
  setTimeout(check, 15000);
  updateCheckTimer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  updateCheckTimer.unref();
}

function writePidFile(pid) {
  fs.writeFileSync(path.join(dataRoot(), "backend.pid"), `${pid}\n`, "utf8");
}

function removePidFile() {
  fs.rmSync(path.join(dataRoot(), "backend.pid"), { force: true });
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch (_error) {
      // Process already exited.
    }
  }
}

function startBackend(port) {
  diagnosticLog(`starting backend on ${port}`);
  const python = bundledPythonPath();
  if (!python) {
    throw new Error("Bundled Python runtime was not found. Put python.exe under desktop/resources/python before building.");
  }

  mkdirp(dataRoot());
  mkdirp(logRoot());

  const scriptPath = path.join(codeRoot(), "scripts", "web_ui.py");
  const outLog = fs.openSync(path.join(logRoot(), "backend.out.log"), "a");
  const errLog = fs.openSync(path.join(logRoot(), "backend.err.log"), "a");
  const ffmpegPath = bundledToolPath("ffmpeg");
  const ffprobePath = bundledToolPath("ffprobe");
  const ffmpegDir = ffmpegPath ? path.dirname(ffmpegPath) : "";
  const scriptsDir = path.join(codeRoot(), "scripts");
  const packagedSeedRoot = app.isPackaged ? path.join(resourcesRoot(), "seed-data") : codeRoot();
  const legacyRoot = process.env.STREAM_LEGACY_ROOT
    || (legacyDataRoot && fs.existsSync(legacyDataRoot) ? legacyDataRoot : packagedSeedRoot);

  const env = {
    ...process.env,
    STREAM_UI_PORT: String(port),
    STREAM_APP_CODE_DIR: codeRoot(),
    STREAM_APP_DATA_DIR: dataRoot(),
    STREAM_WEB_ROOT: path.join(codeRoot(), "web"),
    STREAM_LEGACY_ROOT: legacyRoot,
    PYTHONPATH: process.env.PYTHONPATH ? `${scriptsDir}${path.delimiter}${process.env.PYTHONPATH}` : scriptsDir,
    PATH: ffmpegDir ? `${ffmpegDir}${path.delimiter}${process.env.PATH || ""}` : process.env.PATH
  };
  if (ffmpegPath) env.STREAM_FFMPEG_PATH = ffmpegPath;
  if (ffprobePath) env.STREAM_FFPROBE_PATH = ffprobePath;

  diagnosticLog(`backend python ${python}`);
  diagnosticLog(`backend script ${scriptPath}`);
  diagnosticLog(`backend cwd ${dataRoot()}`);
  diagnosticLog(`backend code root ${codeRoot()}`);
  backend = spawn(python, [scriptPath], {
    cwd: dataRoot(),
    env,
    stdio: ["ignore", outLog, errLog],
    windowsHide: true
  });

  diagnosticLog(`backend pid ${backend.pid}`);
  backend.on("error", (error) => {
    diagnosticLog("backend spawn error", error);
  });
  writePidFile(backend.pid);
  backend.on("exit", (code, signal) => {
    diagnosticLog(`backend exit code=${code} signal=${signal}`);
    removePidFile();
    backend = null;
    if (!isQuitting) {
      showError(new Error(`Backend exited unexpectedly (${code ?? signal}).`));
    }
  });
}

function stopBackend() {
  if (!backend) return;
  const pid = backend.pid;
  backend.kill();
  setTimeout(() => {
    if (backend) killProcessTree(pid);
  }, 2500).unref();
}

async function boot() {
  diagnosticLog("boot begin");
  if (process.env.STREAM_HEADLESS_SMOKE === "1") {
    backendPort = await findOpenPort();
    backendUrl = `http://127.0.0.1:${backendPort}`;
    diagnosticLog(`backend url ${backendUrl}`);
    startBackend(backendPort);
    await waitForBackend(backendUrl);
    diagnosticLog("backend healthy");
    fs.writeFileSync(
      path.join(userDataRoot(), "packaged-smoke-ok.json"),
      JSON.stringify({ ok: true, backendUrl, dataRoot: dataRoot() }, null, 2) + "\n",
      "utf8"
    );
    stopBackend();
    app.exit(0);
    return;
  }

  createMainWindow();
  createMenu();
  createTray();
  showLoading("Preparing Castarro...");

  backendPort = await findOpenPort();
  backendUrl = `http://127.0.0.1:${backendPort}`;
  diagnosticLog(`backend url ${backendUrl}`);
  startBackend(backendPort);
  await waitForBackend(backendUrl);
  diagnosticLog("backend healthy");
  await mainWindow.loadURL(backendUrl);
}

app.whenReady().then(() => {
  app.setName(PRODUCT_NAME);
  app.setAppUserModelId("com.jawadahmad.castarro");
  diagnosticLog("app ready");
  configureAutoUpdates();
  boot().catch((error) => {
    diagnosticLog("boot failed", error);
    showError(error);
  });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    boot().catch((error) => showError(error));
  }
});

app.on("before-quit", () => {
  diagnosticLog("before quit");
  isQuitting = true;
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  stopBackend();
});

app.on("window-all-closed", () => {
  diagnosticLog("window all closed");
  if (process.platform !== "darwin") app.quit();
});
