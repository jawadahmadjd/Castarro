const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const HEALTHCHECK_TIMEOUT_MS = 30000;
const HEALTHCHECK_INTERVAL_MS = 500;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TRAY_TOOLTIP_REFRESH_MS = 5000;
const PRODUCT_NAME = "Castarro";
const LEGACY_PRODUCT_NAME = ["FFmpeg", "Live", "Streaming"].join(" ");
const BACKEND_INFO_FILE = "backend-info.json";

let mainWindow = null;
let tray = null;
let backend = null;
let backendPort = null;
let backendUrl = null;
let isQuitting = false;
let quitRequestInFlight = false;
let quitMode = "none";
let appBootstrapped = false;
let installUpdateOnQuit = false;
let legacyDataRoot = null;
let updateCheckTimer = null;
let trayStatusTimer = null;
let lastTrayTooltip = "";
let lastTrayStatusLabel = "";
const updateState = {
  status: "idle",
  version: null,
  downloaded: false,
  percent: 0,
  message: ""
};
let autoUpdater = null;

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

function publishUpdateState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:update-status", { ...updateState });
}

function setUpdateState(patch) {
  Object.assign(updateState, patch);
  publishUpdateState();
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
  if (isQuitting) {
    diagnosticLog("second instance launch ignored while quitting");
    return;
  }
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

function backendInfoPath() {
  return path.join(dataRoot(), BACKEND_INFO_FILE);
}

function readBackendInfo() {
  try {
    const raw = fs.readFileSync(backendInfoPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const port = Number(parsed.port);
    const pid = Number(parsed.pid);
    if (!Number.isFinite(port) || port <= 0) return null;
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return {
      port,
      pid,
      url: `http://127.0.0.1:${port}`,
      startedAt: Number(parsed.startedAt) || null,
    };
  } catch (_error) {
    return null;
  }
}

function writeBackendInfo({ pid, port }) {
  mkdirp(dataRoot());
  fs.writeFileSync(
    backendInfoPath(),
    JSON.stringify(
      {
        pid,
        port,
        startedAt: Date.now(),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function removeBackendInfo() {
  fs.rmSync(backendInfoPath(), { force: true });
}

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
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

function requestBackendStatus(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${url}/api/status`, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("error", reject);
      response.on("end", () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Backend returned HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(new Error(`Backend returned invalid JSON: ${error.message}`));
        }
      });
    });
    request.on("error", reject);
    request.setTimeout(2000, () => {
      request.destroy(new Error("Backend status request timed out."));
    });
  });
}

function requestBackendPost(url, apiPath, payload = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = http.request(
      `${url}${apiPath}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("error", reject);
        response.on("end", () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Backend returned HTTP ${response.statusCode} for ${apiPath}`));
            return;
          }
          try {
            resolve(text ? JSON.parse(text) : {});
          } catch (error) {
            reject(new Error(`Backend returned invalid JSON for ${apiPath}: ${error.message}`));
          }
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(8000, () => {
      request.destroy(new Error(`Backend request timed out for ${apiPath}`));
    });
    request.write(body);
    request.end();
  });
}

async function requestStatus(url) {
  await requestBackendStatus(url);
}

async function liveStreamCount() {
  if (!backendUrl) return 0;
  try {
    const payload = await requestBackendStatus(backendUrl);
    if (!payload || typeof payload !== "object" || typeof payload.streams !== "object" || !payload.streams) {
      return 0;
    }
    return Object.values(payload.streams).filter((stream) => stream && stream.running).length;
  } catch (error) {
    diagnosticLog("live stream status check failed", error);
    return 0;
  }
}

async function requestQuit(source = "unknown", mode = "ui-only", options = {}) {
  if (isQuitting || quitRequestInFlight) return false;
  quitRequestInFlight = true;
  diagnosticLog(`quit requested source=${source} mode=${mode}`);
  try {
    if (mode === "stop-streams-and-exit") {
      if (backendUrl) {
        await requestBackendPost(backendUrl, "/api/stream/stop", { channel: null });
        await requestBackendPost(backendUrl, "/api/system/shutdown", {
          stop_streams: true,
          stop_tasks: true,
        });
      } else {
        diagnosticLog("full-stop requested without backend URL; continuing with app quit");
      }
      quitMode = "full-stop";
      installUpdateOnQuit = Boolean(options.installUpdate) && (updateState.downloaded || updateState.status === "downloaded");
    } else {
      const running = await liveStreamCount();
      if (running > 0 && source === "window-close") {
        const countLabel = running === 1 ? "1 live stream is still running." : `${running} live streams are still running.`;
        await dialog.showMessageBox(mainWindow || undefined, {
          type: "info",
          buttons: ["OK"],
          defaultId: 0,
          noLink: true,
          title: "UI closed, stream continues",
          message: countLabel,
          detail: "Castarro UI will close now, but your backend and live stream keep running in the background.",
        });
      }
      quitMode = "ui-only";
      installUpdateOnQuit = false;
    }

    isQuitting = true;
    if (installUpdateOnQuit && autoUpdater && typeof autoUpdater.quitAndInstall === "function") {
      // Release lock early so the relaunched app can start while this instance exits.
      app.releaseSingleInstanceLock();
      diagnosticLog("installing downloaded update on quit");
      try {
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.autoRunAppAfterInstall = true;
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        diagnosticLog("quitAndInstall failed; falling back to app quit", error);
        app.quit();
      }
    } else {
      app.quit();
    }
    return true;
  } catch (error) {
    diagnosticLog("quit request failed", error);
    await dialog.showMessageBox(mainWindow || undefined, {
      type: "error",
      buttons: ["OK"],
      defaultId: 0,
      noLink: true,
      title: mode === "stop-streams-and-exit" ? "Stop streams and exit failed" : "Close failed",
      message: "Castarro could not complete the requested exit action.",
      detail: error?.message || String(error),
    });
    return false;
  } finally {
    quitRequestInFlight = false;
  }
}

ipcMain.handle("desktop:get-update-status", () => ({ ...updateState }));
ipcMain.handle("desktop:select-folder", async (_event, payload) => {
  const defaultPath = typeof payload?.defaultPath === "string" && payload.defaultPath.trim()
    ? payload.defaultPath.trim()
    : undefined;
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: "Select folder",
    defaultPath,
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths?.length) {
    return { canceled: true, path: null };
  }
  return { canceled: false, path: result.filePaths[0] };
});
ipcMain.handle("desktop:request-quit", async () => {
  const ok = await requestQuit("renderer", "ui-only");
  return { ok };
});
ipcMain.handle("desktop:request-stop-streams-and-exit", async () => {
  const ok = await requestQuit("renderer", "stop-streams-and-exit");
  return { ok };
});
ipcMain.handle("desktop:request-restart-to-update", async () => {
  const ok = await requestQuit("renderer-update", "stop-streams-and-exit", { installUpdate: true });
  return { ok };
});

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

async function connectOrStartBackend() {
  const existing = readBackendInfo();
  if (existing?.url) {
    if (isProcessAlive(existing.pid)) {
      try {
        await waitForBackend(existing.url);
        backendPort = existing.port;
        backendUrl = existing.url;
        diagnosticLog(`connected to existing backend pid=${existing.pid} port=${existing.port}`);
        return;
      } catch (error) {
        diagnosticLog("existing backend did not respond; starting new backend", error);
      }
    } else {
      diagnosticLog(`stale backend info found for dead pid ${existing.pid}; removing`);
    }
    removeBackendInfo();
    removePidFile();
  }

  backendPort = await findOpenPort();
  backendUrl = `http://127.0.0.1:${backendPort}`;
  diagnosticLog(`backend url ${backendUrl}`);
  startBackend(backendPort, { persistent: true });
  await waitForBackend(backendUrl);
  diagnosticLog("backend healthy");
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
  mainWindow.webContents.on("did-finish-load", () => {
    publishUpdateState();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (backendUrl && url.startsWith(backendUrl)) return;
    if (url.startsWith("data:text/html")) return;
    event.preventDefault();
  });
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    requestQuit("window-close", "ui-only").catch((error) => diagnosticLog("window close guard failed", error));
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
        { label: "Close UI (Keep Stream Running)", click: () => requestQuit("menu", "ui-only").catch((error) => diagnosticLog("menu close ui failed", error)) },
        { label: "Stop Streams and Exit", click: () => requestQuit("menu", "stop-streams-and-exit").catch((error) => diagnosticLog("menu full stop failed", error)) }
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
  tray.setContextMenu(buildTrayMenu(0));

  const refresh = () => refreshTrayPresentation().catch((error) => diagnosticLog("tray status refresh failed", error));
  refresh();
  if (trayStatusTimer) clearInterval(trayStatusTimer);
  trayStatusTimer = setInterval(refresh, TRAY_TOOLTIP_REFRESH_MS);
  trayStatusTimer.unref();
}

function trayTooltipText(streamCount) {
  const count = Number.isFinite(streamCount) && streamCount >= 0 ? Math.floor(streamCount) : 0;
  return `${PRODUCT_NAME} - ${count} stream${count === 1 ? "" : "s"} running`;
}

function trayStatusMenuLabel(streamCount) {
  const count = Number.isFinite(streamCount) && streamCount >= 0 ? Math.floor(streamCount) : 0;
  return `Background status: ${count} stream${count === 1 ? "" : "s"} running`;
}

function buildTrayMenu(streamCount) {
  return Menu.buildFromTemplate([
    { label: "Show", click: () => mainWindow && mainWindow.show() },
    { label: trayStatusMenuLabel(streamCount), enabled: false },
    { label: "Open Data Folder", click: () => shell.openPath(dataRoot()) },
    { label: "Open Logs Folder", click: () => shell.openPath(logRoot()) },
    { type: "separator" },
    { label: "Close UI (Keep Stream Running)", click: () => requestQuit("tray", "ui-only").catch((error) => diagnosticLog("tray close ui failed", error)) },
    { label: "Stop Streams and Exit", click: () => requestQuit("tray", "stop-streams-and-exit").catch((error) => diagnosticLog("tray full stop failed", error)) }
  ]);
}

async function refreshTrayPresentation() {
  if (!tray || (typeof tray.isDestroyed === "function" && tray.isDestroyed())) return;
  const running = await liveStreamCount();
  const tooltip = trayTooltipText(running);
  if (tooltip !== lastTrayTooltip) {
    tray.setToolTip(tooltip);
    lastTrayTooltip = tooltip;
  }
  const statusLabel = trayStatusMenuLabel(running);
  if (statusLabel !== lastTrayStatusLabel) {
    tray.setContextMenu(buildTrayMenu(running));
    lastTrayStatusLabel = statusLabel;
  }
}

function configureAutoUpdates() {
  if (!app.isPackaged || process.env.STREAM_DISABLE_AUTO_UPDATE === "1" || process.env.STREAM_HEADLESS_SMOKE === "1") {
    diagnosticLog("auto updates skipped");
    setUpdateState({
      status: "disabled",
      version: null,
      downloaded: false,
      percent: 0,
      message: ""
    });
    return;
  }

  if (!autoUpdater) {
    try {
      ({ autoUpdater } = require("electron-updater"));
    } catch (error) {
      diagnosticLog("auto updater unavailable", error);
      setUpdateState({
        status: "error",
        message: "Auto update module could not be loaded."
      });
      return;
    }
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => {
    diagnosticLog("checking for update");
    setUpdateState({
      status: "checking",
      message: ""
    });
  });
  autoUpdater.on("update-available", (info) => {
    const version = info.version || null;
    diagnosticLog(`update available ${version || ""}`);
    setUpdateState({
      status: "available",
      version,
      downloaded: false,
      percent: 0,
      message: ""
    });
  });
  autoUpdater.on("update-not-available", (info) => {
    diagnosticLog(`update not available ${info.version || ""}`);
    setUpdateState({
      status: "idle",
      version: null,
      downloaded: false,
      percent: 0,
      message: ""
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent || 0);
    diagnosticLog(`update download ${percent}%`);
    setUpdateState({
      status: "downloading",
      percent
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    const version = info.version || null;
    diagnosticLog(`update downloaded ${version || ""}; will install when app quits`);
    setUpdateState({
      status: "downloaded",
      version,
      downloaded: true,
      percent: 100,
      message: "Update downloaded and ready for next restart."
    });
  });
  autoUpdater.on("error", (error) => {
    diagnosticLog("auto update failed", error);
    setUpdateState({
      status: "error",
      message: error?.message || String(error || "Update error")
    });
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((error) => diagnosticLog("update check failed", error));
  };
  setTimeout(check, 15000);
  updateCheckTimer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  updateCheckTimer.unref();
}

function writePidFile(pid, port) {
  fs.writeFileSync(path.join(dataRoot(), "backend.pid"), `${pid}\n`, "utf8");
  writeBackendInfo({ pid, port });
}

function removePidFile() {
  fs.rmSync(path.join(dataRoot(), "backend.pid"), { force: true });
  removeBackendInfo();
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

function startBackend(port, { persistent = true } = {}) {
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
  const child = spawn(python, [scriptPath], {
    cwd: dataRoot(),
    env,
    stdio: ["ignore", outLog, errLog],
    windowsHide: true,
    detached: persistent,
  });
  fs.closeSync(outLog);
  fs.closeSync(errLog);

  diagnosticLog(`backend pid ${child.pid}`);
  child.on("error", (error) => {
    diagnosticLog("backend spawn error", error);
  });
  writePidFile(child.pid, port);
  child.on("exit", (code, signal) => {
    diagnosticLog(`backend exit code=${code} signal=${signal}`);
    removePidFile();
    if (backend && backend.pid === child.pid) {
      backend = null;
    }
    if (!isQuitting) {
      showError(new Error(`Backend exited unexpectedly (${code ?? signal}).`));
    }
  });
  if (persistent) {
    child.unref();
  }
  backend = child;
  return child;
}

function stopBackend() {
  const pid = backend?.pid || readBackendInfo()?.pid;
  if (!pid) return;
  try {
    if (backend) {
      backend.kill();
    } else {
      killProcessTree(pid);
    }
  } catch (_error) {
    killProcessTree(pid);
  }
  setTimeout(() => {
    if (isProcessAlive(pid)) {
      killProcessTree(pid);
    }
  }, 2500).unref();
}

async function boot() {
  diagnosticLog("boot begin");
  if (process.env.STREAM_HEADLESS_SMOKE === "1") {
    backendPort = await findOpenPort();
    backendUrl = `http://127.0.0.1:${backendPort}`;
    diagnosticLog(`backend url ${backendUrl}`);
    startBackend(backendPort, { persistent: false });
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

  if (!appBootstrapped) {
    createMenu();
    createTray();
    appBootstrapped = true;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  showLoading("Preparing Castarro...");
  await connectOrStartBackend();
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
    if (!backendUrl) {
      boot().catch((error) => showError(error));
      return;
    }
    createMainWindow();
    mainWindow.loadURL(backendUrl).catch((error) => showError(error));
  }
});

app.on("before-quit", (event) => {
  if (!isQuitting) {
    event.preventDefault();
    requestQuit("before-quit", "ui-only").catch((error) => diagnosticLog("before-quit guard failed", error));
    return;
  }
  diagnosticLog(`before quit mode=${quitMode}`);
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  if (trayStatusTimer) clearInterval(trayStatusTimer);
  if (quitMode === "full-stop") {
    stopBackend();
  }
});

app.on("window-all-closed", () => {
  diagnosticLog("window all closed");
  if (!isQuitting && process.platform !== "darwin") {
    requestQuit("window-all-closed", "ui-only").catch((error) => diagnosticLog("window-all-closed close failed", error));
  }
});
