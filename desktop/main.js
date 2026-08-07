const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, Notification } = require("electron");
const { execFile, spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

if (process.platform === "linux") {
  process.env.ELECTRON_DISABLE_SANDBOX = "1";
  if (!process.argv.includes("--no-sandbox")) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch("no-sandbox");
    app.commandLine.appendSwitch("disable-gpu");
    app.commandLine.appendSwitch("disable-software-rasterizer");
    app.commandLine.appendSwitch("ozone-platform-hint", "auto");
    const args = process.argv.slice(1);
    args.push("--no-sandbox");
    app.relaunch({ args });
    app.exit(0);
  } else {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch("no-sandbox");
    app.commandLine.appendSwitch("disable-gpu");
    app.commandLine.appendSwitch("disable-software-rasterizer");
    app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  }
}

const HEALTHCHECK_TIMEOUT_MS = 30000;
const HEALTHCHECK_INTERVAL_MS = 500;
const UPDATE_CHECK_INTERVAL_MS = 60 * 1000;
const AUTO_INSTALL_UPDATE_DELAY_MS = 5000;
const BACKEND_UPDATE_HANDOFF_INTERVAL_MS = 3000;
const TRAY_TOOLTIP_REFRESH_MS = 5000;
const GPU_METRICS_CACHE_MS = 10000;
const STARTUP_SNAPSHOT_MIN_INTERVAL_MS = 15000;
const PRODUCT_NAME = "Castarro";
const LEGACY_PRODUCT_NAME = ["FFmpeg", "Live", "Streaming"].join(" ");
const BACKEND_INFO_FILE = "backend-info.json";
const STARTUP_PAGE_FILE = "startup.html";
const STARTUP_SNAPSHOT_FILE = "startup-snapshot.png";

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
let autoInstallUpdateTimer = null;
let backendUpdateHandoffTimer = null;
let backendUpdateHandoffInFlight = false;
let trayStatusTimer = null;
let lastTrayTooltip = "";
let lastTrayStatusLabel = "";
let startupSnapshotTimer = null;
let startupSnapshotInFlight = false;
let startupSnapshotLastAt = 0;
const externalCpuSamples = new Map();
let gpuMetricsCache = { key: "", sampledAt: 0, ok: false, items: [] };
let gpuMetricsInFlight = null;
const updateState = {
  status: "idle",
  version: null,
  downloaded: false,
  percent: 0,
  message: ""
};
let autoUpdater = null;

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function memoryBytesFromElectronMetric(metric) {
  const memory = metric && typeof metric.memory === "object" ? metric.memory : {};
  const workingSet = safeNumber(memory.workingSetSize || memory.privateBytes || memory.peakWorkingSetSize, 0);
  return Math.max(0, Math.round(workingSet * 1024));
}

function uniquePids(pids) {
  return [...new Set((pids || []).map((pid) => Math.floor(Number(pid))).filter((pid) => pid > 0))];
}

function electronProcessMetrics() {
  try {
    return app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      name: metric.type || "Electron",
      cpuPercent: Math.max(0, safeNumber(metric.cpu?.percentCPUUsage, 0)),
      memoryBytes: memoryBytesFromElectronMetric(metric),
    }));
  } catch (error) {
    diagnosticLog("electron app metrics failed", error);
    return [];
  }
}

function queryWindowsProcesses(pids) {
  const ids = uniquePids(pids);
  if (!ids.length || process.platform !== "win32") return Promise.resolve([]);
  const command = `$ids=@(${ids.join(",")}); Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Json -Compress`;
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", command],
      { windowsHide: true, timeout: 2500, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error || !String(stdout || "").trim()) {
          if (error) diagnosticLog("windows process metrics failed", error);
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const rows = Array.isArray(parsed) ? parsed : [parsed];
          const nowMs = Date.now();
          const cpuCount = Math.max(1, os.cpus()?.length || 1);
          const metrics = rows.map((row) => {
            const pid = Math.floor(safeNumber(row.Id, 0));
            const cpuSeconds = safeNumber(row.CPU, 0);
            const previous = externalCpuSamples.get(pid);
            externalCpuSamples.set(pid, { cpuSeconds, sampledAt: nowMs });
            let cpuPercent = 0;
            if (previous && nowMs > previous.sampledAt && cpuSeconds >= previous.cpuSeconds) {
              const cpuDelta = cpuSeconds - previous.cpuSeconds;
              const wallDelta = (nowMs - previous.sampledAt) / 1000;
              cpuPercent = (cpuDelta / wallDelta / cpuCount) * 100;
            }
            return {
              pid,
              name: String(row.ProcessName || "Process"),
              cpuPercent: Math.max(0, cpuPercent),
              memoryBytes: Math.max(0, Math.round(safeNumber(row.WorkingSet64, 0))),
            };
          });
          resolve(metrics);
        } catch (parseError) {
          diagnosticLog("windows process metrics parse failed", parseError);
          resolve([]);
        }
      },
    );
  });
}

function normalizeGpuSnapshot(parsed) {
  const rawItems = Array.isArray(parsed?.items) ? parsed.items : parsed?.items ? [parsed.items] : [];
  return {
    ok: Boolean(parsed?.ok),
    items: rawItems
      .map((item) => ({
        pid: Math.floor(safeNumber(item?.pid ?? item?.Id, 0)),
        gpuPercent: Math.max(0, safeNumber(item?.gpuPercent ?? item?.GpuPercent, 0)),
      }))
      .filter((item) => item.pid > 0),
  };
}

function queryWindowsGpuUsage(pids) {
  const ids = uniquePids(pids);
  if (!ids.length || process.platform !== "win32") {
    return Promise.resolve({ ok: false, items: [] });
  }
  const key = ids.join(",");
  const nowMs = Date.now();
  if (gpuMetricsCache.key === key && nowMs - gpuMetricsCache.sampledAt < GPU_METRICS_CACHE_MS) {
    return Promise.resolve(gpuMetricsCache);
  }
  if (gpuMetricsInFlight && gpuMetricsInFlight.key === key) {
    return gpuMetricsInFlight.promise;
  }
  const command = `$ids=@(${ids.join(",")}); try { $usage=@{}; Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | ForEach-Object { $name=[string]$_.Name; if($name -match '^pid_(\\d+)_'){ $procId=[int]$matches[1]; if($ids -contains $procId){ $current=0.0; if($usage.ContainsKey($procId)){ $current=[double]$usage[$procId] }; $usage[$procId]=$current+[double]$_.UtilizationPercentage } } }; $items=foreach($streamPid in $ids){ $value=0.0; if($usage.ContainsKey($streamPid)){ $value=[double]$usage[$streamPid] }; [pscustomobject]@{ pid=$streamPid; gpuPercent=[math]::Min(100,[math]::Round($value,1)) } }; [pscustomobject]@{ ok=$true; items=$items } | ConvertTo-Json -Compress -Depth 4 } catch { [pscustomobject]@{ ok=$false; items=@() } | ConvertTo-Json -Compress -Depth 4 }`;
  const promise = new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", command],
      { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error || !String(stdout || "").trim()) {
          if (error) diagnosticLog("windows gpu metrics failed", error);
          resolve({ ok: false, items: [] });
          return;
        }
        try {
          const snapshot = normalizeGpuSnapshot(JSON.parse(stdout));
          if (snapshot.ok) {
            gpuMetricsCache = { key, sampledAt: Date.now(), ...snapshot };
          }
          resolve(snapshot);
        } catch (parseError) {
          diagnosticLog("windows gpu metrics parse failed", parseError);
          resolve({ ok: false, items: [] });
        }
      },
    );
  }).finally(() => {
    if (gpuMetricsInFlight?.key === key) gpuMetricsInFlight = null;
  });
  gpuMetricsInFlight = { key, promise };
  return promise;
}

async function collectUsageMetrics(payload = {}) {
  const streamPids = Array.isArray(payload?.pids) ? payload.pids : [];
  const backendPid = backend?.pid || readBackendInfo()?.pid || null;
  const externalPids = [backendPid, ...streamPids].filter(Boolean);
  const electronMetrics = electronProcessMetrics();
  const externalMetrics = await queryWindowsProcesses(externalPids);
  const processes = [...electronMetrics, ...externalMetrics]
    .filter((item) => item.pid > 0);
  const cpuPercent = processes.reduce((sum, item) => sum + safeNumber(item.cpuPercent, 0), 0);
  const memoryBytes = processes.reduce((sum, item) => sum + safeNumber(item.memoryBytes, 0), 0);
  return {
    cpuPercent,
    memoryBytes,
    processes,
  };
}

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

async function captureStartupSnapshot(reason = "unknown") {
  if (!mainWindow || mainWindow.isDestroyed() || startupSnapshotInFlight) return;
  if (!backendUrl || !mainWindow.webContents.getURL().startsWith(backendUrl)) return;
  const force = String(reason).startsWith("quit");
  if (!force && Date.now() - startupSnapshotLastAt < STARTUP_SNAPSHOT_MIN_INTERVAL_MS) return;
  startupSnapshotInFlight = true;
  try {
    mkdirp(dataRoot());
    const image = await mainWindow.webContents.capturePage();
    const png = image.toPNG();
    if (!png || png.length < 1024) return;
    fs.writeFileSync(startupSnapshotPath(), png);
    startupSnapshotLastAt = Date.now();
    diagnosticLog(`startup snapshot cached reason=${reason} bytes=${png.length}`);
  } catch (error) {
    diagnosticLog("startup snapshot capture failed", error);
  } finally {
    startupSnapshotInFlight = false;
  }
}

function scheduleStartupSnapshot(reason = "unknown", delayMs = 1200) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (startupSnapshotTimer) clearTimeout(startupSnapshotTimer);
  startupSnapshotTimer = setTimeout(() => {
    startupSnapshotTimer = null;
    captureStartupSnapshot(reason).catch((error) => diagnosticLog("startup snapshot scheduled capture failed", error));
  }, Math.max(0, Number(delayMs) || 0));
  startupSnapshotTimer.unref();
}

function publishUpdateState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:update-status", { ...updateState });
}

function setUpdateState(patch) {
  Object.assign(updateState, patch);
  publishUpdateState();
}

function scheduleClearUpdateMessage(delayMs = 15000) {
  setTimeout(() => {
    if (updateState.status === "backend-updated") {
      setUpdateState({
        status: "idle",
        version: null,
        downloaded: false,
        percent: 0,
        message: ""
      });
    }
  }, Math.max(0, Number(delayMs) || 0)).unref();
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

function backendRuntimeBaseRoot() {
  return path.join(dataRoot(), "service-runtimes");
}

function safeRuntimeVersion() {
  return String(app.getVersion() || "dev").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "dev";
}

function backendRuntimeRoot() {
  return path.join(backendRuntimeBaseRoot(), safeRuntimeVersion());
}

function startupPagePath() {
  return path.join(dataRoot(), STARTUP_PAGE_FILE);
}

function startupPageUrl() {
  return pathToFileURL(startupPagePath()).toString();
}

function startupSnapshotPath() {
  return path.join(dataRoot(), STARTUP_SNAPSHOT_FILE);
}

function readStartupSnapshotDataUrl() {
  try {
    const buffer = fs.readFileSync(startupSnapshotPath());
    if (!buffer.length) return "";
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch (_error) {
    return "";
  }
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
      appVersion: String(parsed.appVersion || "").trim(),
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
        appVersion: app.getVersion(),
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

function copyRuntimeEntry(source, target) {
  if (!source || !fs.existsSync(source)) return;
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
}

function prepareBackendRuntime() {
  if (!app.isPackaged) {
    return {
      codeRoot: codeRoot(),
      resourcesRoot: resourcesRoot(),
      seedRoot: process.env.STREAM_LEGACY_ROOT
        || (legacyDataRoot && fs.existsSync(legacyDataRoot) ? legacyDataRoot : codeRoot()),
    };
  }

  const runtimeRoot = backendRuntimeRoot();
  const markerPath = path.join(runtimeRoot, "runtime-ready.json");
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    if (marker?.appVersion === app.getVersion()) {
      copyRuntimeEntry(path.join(resourcesRoot(), "seed-data"), path.join(runtimeRoot, "seed-data"));
      return {
        codeRoot: path.join(runtimeRoot, "app"),
        resourcesRoot: runtimeRoot,
        seedRoot: process.env.STREAM_LEGACY_ROOT
          || (legacyDataRoot && fs.existsSync(legacyDataRoot) ? legacyDataRoot : path.join(runtimeRoot, "seed-data")),
      };
    }
  } catch (_error) {
    // Missing or partial runtime; rebuild it below.
  }

  const tempRoot = `${runtimeRoot}.tmp-${process.pid}`;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  mkdirp(tempRoot);
  mkdirp(path.join(tempRoot, "app"));
  copyRuntimeEntry(path.join(codeRoot(), "scripts"), path.join(tempRoot, "app", "scripts"));
  copyRuntimeEntry(path.join(codeRoot(), "web"), path.join(tempRoot, "app", "web"));
  copyRuntimeEntry(path.join(resourcesRoot(), "python"), path.join(tempRoot, "python"));
  copyRuntimeEntry(path.join(resourcesRoot(), "ffmpeg"), path.join(tempRoot, "ffmpeg"));
  copyRuntimeEntry(path.join(resourcesRoot(), "seed-data"), path.join(tempRoot, "seed-data"));
  for (const filename of ["package.json", "config.example.json", "README.md"]) {
    const source = path.join(codeRoot(), filename);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(tempRoot, "app", filename));
    }
  }
  fs.writeFileSync(
    path.join(tempRoot, "runtime-ready.json"),
    JSON.stringify({ appVersion: app.getVersion(), preparedAt: Date.now() }, null, 2) + "\n",
    "utf8",
  );
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.renameSync(tempRoot, runtimeRoot);
  diagnosticLog(`prepared backend runtime ${runtimeRoot}`);
  return {
    codeRoot: path.join(runtimeRoot, "app"),
    resourcesRoot: runtimeRoot,
    seedRoot: process.env.STREAM_LEGACY_ROOT
      || (legacyDataRoot && fs.existsSync(legacyDataRoot) ? legacyDataRoot : path.join(runtimeRoot, "seed-data")),
  };
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

function bundledPythonPath(root = resourcesRoot(), appCodeRoot = codeRoot()) {
  const configured = process.env.STREAM_PYTHON;
  if (configured) return configured;
  const exe = executableName("python");
  const bundled = firstExisting([
    path.join(root, "python", exe),
    path.join(appCodeRoot, "desktop", "resources", "python", exe)
  ]);
  if (bundled) return bundled;
  if (process.platform === "linux") return "python3";
  return app.isPackaged ? null : "python";
}

function bundledToolPath(name, root = resourcesRoot(), appCodeRoot = codeRoot()) {
  const exe = executableName(name);
  const bundled = firstExisting([
    path.join(root, "ffmpeg", exe),
    path.join(appCodeRoot, "desktop", "resources", "ffmpeg", exe)
  ]);
  if (bundled) return bundled;
  if (process.platform === "linux") return name;
  return null;
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
  return requestBackendStatus(url);
}

async function liveStreamCount() {
  if (!backendUrl) return 0;
  try {
    const payload = await requestBackendStatus(backendUrl);
    return streamCountFromStatus(payload);
  } catch (error) {
    diagnosticLog("live stream status check failed", error);
    return 0;
  }
}

function streamCountFromStatus(payload) {
  if (!payload || typeof payload !== "object" || typeof payload.streams !== "object" || !payload.streams) {
    return 0;
  }
  return Object.values(payload.streams).filter((stream) => {
    if (!stream || typeof stream !== "object") return false;
    if (Object.prototype.hasOwnProperty.call(stream, "process_running")) {
      return Boolean(stream.process_running);
    }
    return Boolean(stream.running);
  }).length;
}

function backendVersionFromStatus(status) {
  return String(status?.app_version || "").trim();
}

function currentAppVersion() {
  return String(app.getVersion() || "").trim();
}

function backendNeedsVersionHandoff(status) {
  const backendVersion = backendVersionFromStatus(status);
  const appVersion = currentAppVersion();
  return Boolean(app.isPackaged && backendVersion && appVersion && backendVersion !== appVersion);
}

function stopBackendUpdateHandoffMonitor() {
  if (backendUpdateHandoffTimer) {
    clearInterval(backendUpdateHandoffTimer);
    backendUpdateHandoffTimer = null;
  }
}

function startBackendUpdateHandoffMonitor(reason = "unknown") {
  if (!app.isPackaged || backendUpdateHandoffTimer) return;
  diagnosticLog(`backend update handoff monitor started reason=${reason}`);
  const tick = () => maybeHandoffIdleBackend("monitor").catch((error) => {
    diagnosticLog("backend update handoff monitor failed", error);
  });
  backendUpdateHandoffTimer = setInterval(tick, BACKEND_UPDATE_HANDOFF_INTERVAL_MS);
  backendUpdateHandoffTimer.unref();
  setTimeout(tick, 500).unref();
}

async function maybeHandoffIdleBackend(reason = "unknown", knownStatus = null) {
  if (!app.isPackaged || !backendUrl || backendUpdateHandoffInFlight || isQuitting) return false;
  backendUpdateHandoffInFlight = true;
  try {
    const status = knownStatus || await requestBackendStatus(backendUrl);
    if (!backendNeedsVersionHandoff(status)) {
      stopBackendUpdateHandoffMonitor();
      return false;
    }

    const runningStreams = streamCountFromStatus(status);
    const backendVersion = backendVersionFromStatus(status);
    const appVersion = currentAppVersion();
    if (runningStreams > 0) {
      diagnosticLog(`backend update handoff deferred old=${backendVersion} new=${appVersion} streams=${runningStreams} reason=${reason}`);
      setUpdateState({
        status: "backend-pending",
        version: appVersion,
        downloaded: false,
        percent: 100,
        message: `App update installed. Backend will switch from ${backendVersion} to ${appVersion} after active streams finish.`,
      });
      startBackendUpdateHandoffMonitor("streams-running");
      return false;
    }

    diagnosticLog(`backend update handoff starting old=${backendVersion} new=${appVersion} reason=${reason}`);
    setUpdateState({
      status: "backend-handoff",
      version: appVersion,
      downloaded: false,
      percent: 100,
      message: `Switching backend from ${backendVersion} to ${appVersion}.`,
    });
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      await showLoading("Updating Castarro service...");
    }
    await requestBackendPost(backendUrl, "/api/system/shutdown", {
      stop_streams: false,
      stop_tasks: true,
    });
    const stopped = await waitForBackendToStop(backendUrl, 12000);
    if (!stopped) {
      diagnosticLog("backend update handoff timed out waiting for old backend to stop");
      startBackendUpdateHandoffMonitor("shutdown-timeout");
      return false;
    }

    backend = null;
    removePidFile();
    backendPort = await findOpenPort();
    backendUrl = `http://127.0.0.1:${backendPort}`;
    diagnosticLog(`backend update handoff new backend url ${backendUrl}`);
    startBackend(backendPort, { persistent: true });
    await waitForBackend(backendUrl);
    diagnosticLog("backend update handoff complete");
    stopBackendUpdateHandoffMonitor();
    setUpdateState({
      status: "backend-updated",
      version: appVersion,
      downloaded: false,
      percent: 100,
      message: `Backend updated to ${appVersion}.`,
    });
    scheduleClearUpdateMessage();
    if (mainWindow && !mainWindow.isDestroyed()) {
      await loadApplicationUi();
    }
    return true;
  } finally {
    backendUpdateHandoffInFlight = false;
  }
}

async function hideUiToTray(source = "unknown") {
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
      detail: "Castarro UI will hide to tray, and your backend/live streams keep running in the background.",
    });
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

async function requestQuit(source = "unknown", mode = "ui-only", options = {}) {
  if (isQuitting || quitRequestInFlight) return false;
  quitRequestInFlight = true;
  diagnosticLog(`quit requested source=${source} mode=${mode}`);
  try {
    await captureStartupSnapshot(`quit-${source}`);
    if (mode === "restart-to-update") {
      quitMode = "ui-only";
      installUpdateOnQuit = Boolean(options.installUpdate) && (updateState.downloaded || updateState.status === "downloaded");
    } else if (mode === "stop-streams-and-exit") {
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
      quitMode = "ui-only";
      installUpdateOnQuit = false;
      await hideUiToTray(source);
      return true;
    }

    isQuitting = true;
    if (installUpdateOnQuit && autoUpdater && typeof autoUpdater.quitAndInstall === "function") {
      // Release lock early so the relaunched app can start while this instance exits.
      app.releaseSingleInstanceLock();
      diagnosticLog("installing downloaded update on quit");
      try {
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.autoRunAppAfterInstall = true;
        autoUpdater.quitAndInstall(true, true);
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
ipcMain.handle("desktop:get-app-version", () => app.getVersion());
ipcMain.handle("desktop:get-backend-url", () => backendUrl || null);
ipcMain.handle("desktop:get-usage-metrics", async (_event, payload) => collectUsageMetrics(payload));
ipcMain.on("desktop:cache-startup-view", (_event, payload = {}) => {
  const reason = String(payload?.reason || "renderer");
  const delayMs = Number(payload?.delayMs ?? 900);
  scheduleStartupSnapshot(reason, delayMs);
});
ipcMain.handle("desktop:show-notification", async (_event, payload) => {
  const title = String(payload?.title || PRODUCT_NAME).trim() || PRODUCT_NAME;
  const body = String(payload?.body || "").trim();
  if (!Notification || typeof Notification.isSupported === "function" && !Notification.isSupported()) {
    return { ok: false, supported: false };
  }
  const notification = new Notification({
    title,
    body,
    silent: false,
  });
  notification.show();
  return { ok: true };
});
ipcMain.handle("desktop:select-folder", async (_event, payload) => {
  const defaultPath = typeof payload?.defaultPath === "string" && payload.defaultPath.trim()
    ? payload.defaultPath.trim()
    : undefined;
  const title = typeof payload?.title === "string" && payload.title.trim()
    ? payload.title.trim()
    : "Select folder";
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title,
    defaultPath,
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths?.length) {
    return { canceled: true, path: null };
  }
  return { canceled: false, path: result.filePaths[0] };
});
ipcMain.handle("desktop:select-videos", async (_event, payload) => {
  const defaultPath = typeof payload?.defaultPath === "string" && payload.defaultPath.trim()
    ? payload.defaultPath.trim()
    : undefined;
  const title = typeof payload?.title === "string" && payload.title.trim()
    ? payload.title.trim()
    : "Select videos";
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title,
    defaultPath,
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Videos", extensions: ["mp4", "m4v", "mov", "flv", "mkv"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths?.length) {
    return { canceled: true, paths: [] };
  }
  return { canceled: false, paths: result.filePaths };
});
ipcMain.handle("desktop:open-external", async (_event, rawUrl) => {
  const url = String(rawUrl || "").trim();
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("External URL is invalid.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only web URLs can be opened externally.");
  }
  await shell.openExternal(parsed.toString());
  return { ok: true };
});
ipcMain.handle("desktop:export-text-downloads", async (_event, payload) => {
  const rawName = String(payload?.filename || "castarro-activity-log.txt").trim();
  const filename = rawName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 140) || "castarro-activity-log.txt";
  const safeFilename = filename.toLowerCase().endsWith(".txt") ? filename : `${filename}.txt`;
  const text = String(payload?.text || "");
  const downloads = app.getPath("downloads");
  mkdirp(downloads);
  const target = path.join(downloads, safeFilename);
  fs.writeFileSync(target, text, "utf8");
  return { ok: true, path: target };
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
  const ok = await requestQuit("renderer-update", "restart-to-update", { installUpdate: true });
  return { ok };
});

async function waitForBackend(url) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < HEALTHCHECK_TIMEOUT_MS) {
    try {
      return await requestStatus(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, HEALTHCHECK_INTERVAL_MS));
    }
  }
  throw lastError || new Error("Backend did not become ready.");
}

async function waitForBackendToStop(url, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await requestBackendStatus(url);
      await new Promise((resolve) => setTimeout(resolve, HEALTHCHECK_INTERVAL_MS));
    } catch (_error) {
      return true;
    }
  }
  return false;
}

async function connectOrStartBackend() {
  const existing = readBackendInfo();
  if (existing?.url) {
    if (isProcessAlive(existing.pid)) {
      try {
        const status = await waitForBackend(existing.url);
        const existingVersion = String(status?.app_version || existing.appVersion || "").trim();
        const currentVersion = String(app.getVersion() || "").trim();
        const runningStreams = streamCountFromStatus(status);
        if (app.isPackaged && existingVersion && currentVersion && existingVersion !== currentVersion && runningStreams === 0) {
          backendPort = existing.port;
          backendUrl = existing.url;
          const handedOff = await maybeHandoffIdleBackend("startup-idle", status);
          if (handedOff) return;
          startBackendUpdateHandoffMonitor("startup-idle-retry");
          diagnosticLog(`connected to idle older backend until handoff can retry old=${existingVersion} new=${currentVersion}`);
          return;
        } else {
          if (app.isPackaged && existingVersion && currentVersion && existingVersion !== currentVersion) {
            diagnosticLog(`connected to older streaming backend old=${existingVersion} new=${currentVersion} streams=${runningStreams}`);
            startBackendUpdateHandoffMonitor("startup-streaming");
          } else {
            stopBackendUpdateHandoffMonitor();
          }
          backendPort = existing.port;
          backendUrl = existing.url;
          diagnosticLog(`connected to existing backend pid=${existing.pid} port=${existing.port}`);
          return;
        }
      } catch (error) {
        diagnosticLog("existing backend did not respond; starting new backend", error);
        removePidFile();
      }
    } else {
      diagnosticLog(`stale backend info found for dead pid ${existing.pid}; removing`);
      removePidFile();
    }
  }

  backendPort = await findOpenPort();
  backendUrl = `http://127.0.0.1:${backendPort}`;
  diagnosticLog(`backend url ${backendUrl}`);
  startBackend(backendPort, { persistent: true });
  await waitForBackend(backendUrl);
  stopBackendUpdateHandoffMonitor();
  diagnosticLog("backend healthy");
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function uiMasterCss() {
  try {
    return fs.readFileSync(path.join(codeRoot(), "web", "ui-master.css"), "utf8");
  } catch (error) {
    diagnosticLog("ui master stylesheet unavailable for startup page", error);
    return "";
  }
}

function loadingHtml(title, message, options = {}) {
  const snapshotDataUrl = options.snapshotDataUrl || "";
  const snapshot = snapshotDataUrl
    ? `<img class="startup-snapshot" src="${htmlEscape(snapshotDataUrl)}" alt="" aria-hidden="true">`
    : "";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${htmlEscape(title)}</title>
  <style>${uiMasterCss()}</style>
</head>
<body class="startup-page">
  ${snapshot}
  <main>
    <svg class="startup-animation" viewBox="0 0 220 160" role="img" aria-label="Castarro is preparing the control room">
      <defs>
        <linearGradient id="startupSignalGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="var(--theme-primary)"></stop>
          <stop offset="100%" stop-color="var(--theme-success)"></stop>
        </linearGradient>
      </defs>
      <path class="startup-orbit startup-orbit-a" d="M45 86c22-44 108-44 130 0"></path>
      <path class="startup-orbit startup-orbit-b" d="M61 95c18-28 80-28 98 0"></path>
      <path class="startup-orbit startup-orbit-c" d="M78 104c13-14 51-14 64 0"></path>
      <rect class="startup-monitor" x="74" y="48" width="72" height="46" rx="8"></rect>
      <path class="startup-play" d="M102 60l24 11-24 11z"></path>
      <path class="startup-scanline" d="M82 58h56"></path>
      <circle class="startup-satellite" cx="110" cy="103" r="6"></circle>
      <path class="startup-stand" d="M110 94v24m-22 0h44"></path>
    </svg>
    <h1>${htmlEscape(title)}</h1>
    <p>${htmlEscape(message)}</p>
  </main>
</body>
</html>`;
}

function loadStartupPage(title, message, options = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve();
  try {
    mkdirp(dataRoot());
    fs.writeFileSync(startupPagePath(), loadingHtml(title, message, options), "utf8");
    return mainWindow.loadFile(startupPagePath());
  } catch (error) {
    diagnosticLog("startup page write failed", error);
    return Promise.reject(error);
  }
}

function showLoading(message) {
  return loadStartupPage("Starting", message, {
    snapshotDataUrl: readStartupSnapshotDataUrl(),
  });
}

function loadApplicationUi() {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve();
  if (app.isPackaged) {
    return mainWindow.loadFile(path.join(codeRoot(), "web", "index.html"));
  }
  return mainWindow.loadURL(backendUrl);
}

function showError(error) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const message = `${error.message}\n\nLogs: ${logRoot()}\nData: ${dataRoot()}`;
  loadStartupPage("Startup Failed", message).catch((loadError) => diagnosticLog("startup error page failed", loadError));
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
      webSecurity: !app.isPackaged,
      preload: path.join(appRoot(), "desktop", "preload.js")
    }
  });

  const revealWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  };
  mainWindow.once("ready-to-show", revealWindow);
  mainWindow.webContents.on("did-finish-load", revealWindow);
  setTimeout(revealWindow, 1200);
  mainWindow.webContents.on("did-finish-load", () => {
    publishUpdateState();
    if (backendUrl && mainWindow.webContents.getURL().startsWith(backendUrl)) {
      scheduleStartupSnapshot("backend-load", 1600);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (backendUrl && url.startsWith(backendUrl)) return;
    if (url.startsWith("data:text/html")) return;
    if (url === startupPageUrl()) return;
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
        { label: "Reload UI", click: () => backendUrl && mainWindow && loadApplicationUi().catch((error) => showError(error)) },
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
    path.join(codeRoot(), "desktop", "assets", "icon.png"),
    path.join(codeRoot(), "desktop", "assets", "icon.ico"),
    path.join(resourcesRoot(), "icon.png"),
    path.join(resourcesRoot(), "icon.ico")
  ]);
  if (!iconPath) return;
  try {
    tray = new Tray(iconPath);
    tray.setToolTip(PRODUCT_NAME);
    tray.setContextMenu(buildTrayMenu(0));

    const refresh = () => refreshTrayPresentation().catch((error) => diagnosticLog("tray status refresh failed", error));
    refresh();
    if (trayStatusTimer) clearInterval(trayStatusTimer);
    trayStatusTimer = setInterval(refresh, TRAY_TOOLTIP_REFRESH_MS);
    trayStatusTimer.unref();
  } catch (error) {
    diagnosticLog("failed to create tray icon", error);
  }
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
    { label: "Show", click: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } },
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

function clearAutoInstallUpdateTimer() {
  if (autoInstallUpdateTimer) {
    clearTimeout(autoInstallUpdateTimer);
    autoInstallUpdateTimer = null;
  }
}

function scheduleAutomaticUpdateInstall(version = null) {
  if (!app.isPackaged || process.env.STREAM_DISABLE_AUTO_UPDATE === "1" || process.env.STREAM_HEADLESS_SMOKE === "1") return;
  clearAutoInstallUpdateTimer();
  autoInstallUpdateTimer = setTimeout(() => {
    autoInstallUpdateTimer = null;
    installDownloadedUpdateAutomatically(version).catch((error) => {
      diagnosticLog("automatic update install failed", error);
      setUpdateState({
        status: "error",
        message: error?.message || String(error || "Automatic update install failed")
      });
    });
  }, AUTO_INSTALL_UPDATE_DELAY_MS);
  autoInstallUpdateTimer.unref();
}

async function installDownloadedUpdateAutomatically(version = null) {
  if (isQuitting || !autoUpdater || !(updateState.downloaded || updateState.status === "downloaded")) return;
  diagnosticLog(`automatic update install starting ${version || ""}`);
  setUpdateState({
    status: "installing",
    version: version || updateState.version || null,
    downloaded: true,
    percent: 100,
    message: "Installing update. Live streams will keep running.",
  });
  await requestQuit("auto-update", "restart-to-update", { installUpdate: true });
}

function isPkexecAvailable() {
  if (process.platform !== "linux") return true;
  if (process.env.APPIMAGE) return true;
  return (
    fs.existsSync("/usr/bin/pkexec") ||
    fs.existsSync("/bin/pkexec") ||
    fs.existsSync("/usr/sbin/pkexec")
  );
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
    diagnosticLog(`update downloaded ${version || ""}; scheduling automatic install`);
    setUpdateState({
      status: "downloaded",
      version,
      downloaded: true,
      percent: 100,
      message: "Update downloaded. Castarro will restart the UI automatically and keep live streams running."
    });
    scheduleAutomaticUpdateInstall(version);
  });
  autoUpdater.on("error", (error) => {
    diagnosticLog("auto update failed", error);
    const rawMsg = error?.message || String(error || "Update error");
    let userMsg = rawMsg;
    if (rawMsg.includes("pkexec") || rawMsg.includes("code 127")) {
      userMsg = "Linux system package 'policykit-1' (pkexec) is missing. Install policykit-1 (`sudo apt install policykit-1`) or update Castarro manually.";
    }
    setUpdateState({
      status: "error",
      message: userMsg
    });
  });

  const check = () => {
    if (process.platform === "linux" && !process.env.APPIMAGE && !isPkexecAvailable()) {
      diagnosticLog("pkexec missing on linux deb installation; skipping automated background update check");
      setUpdateState({
        status: "warning",
        message: "Linux system package 'policykit-1' (pkexec) is missing. Install policykit-1 (`sudo apt install policykit-1`) to enable automated updates."
      });
      return;
    }
    autoUpdater.checkForUpdates().catch((error) => {
      diagnosticLog("update check failed", error);
      const rawMsg = error?.message || String(error || "Update check failed");
      let userMsg = rawMsg;
      if (rawMsg.includes("pkexec") || rawMsg.includes("code 127")) {
        userMsg = "Linux system package 'policykit-1' (pkexec) is missing. Install policykit-1 (`sudo apt install policykit-1`) to enable automated updates.";
      }
      setUpdateState({
        status: "error",
        message: userMsg
      });
    });
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
  const runtime = prepareBackendRuntime();
  const backendCodeRoot = runtime.codeRoot;
  const backendResourcesRoot = runtime.resourcesRoot;
  const python = bundledPythonPath(backendResourcesRoot, backendCodeRoot);
  if (!python) {
    throw new Error("Bundled Python runtime was not found. Put python.exe under desktop/resources/python before building.");
  }

  mkdirp(dataRoot());
  mkdirp(logRoot());

  const scriptPath = path.join(backendCodeRoot, "scripts", "web_ui.py");
  const outLog = fs.openSync(path.join(logRoot(), "backend.out.log"), "a");
  const errLog = fs.openSync(path.join(logRoot(), "backend.err.log"), "a");
  const ffmpegPath = bundledToolPath("ffmpeg", backendResourcesRoot, backendCodeRoot);
  const ffprobePath = bundledToolPath("ffprobe", backendResourcesRoot, backendCodeRoot);
  const ffmpegDir = ffmpegPath ? path.dirname(ffmpegPath) : "";
  const scriptsDir = path.join(backendCodeRoot, "scripts");
  const legacyRoot = process.env.STREAM_LEGACY_ROOT
    || runtime.seedRoot;
  const youtubeOauthSeed = process.env.STREAM_YOUTUBE_OAUTH_SEED || firstExisting([
    path.join(backendResourcesRoot, "seed-data", "youtube.oauth.seed.json"),
    legacyRoot ? path.join(legacyRoot, "youtube.oauth.seed.json") : "",
    path.join(backendCodeRoot, "desktop", "resources", "seed-data", "youtube.oauth.seed.json"),
  ]);

  const env = {
    ...process.env,
    STREAM_UI_PORT: String(port),
    STREAM_APP_CODE_DIR: backendCodeRoot,
    STREAM_APP_DATA_DIR: dataRoot(),
    STREAM_WEB_ROOT: path.join(backendCodeRoot, "web"),
    STREAM_LEGACY_ROOT: legacyRoot,
    PYTHONPATH: process.env.PYTHONPATH ? `${scriptsDir}${path.delimiter}${process.env.PYTHONPATH}` : scriptsDir,
    PATH: ffmpegDir ? `${ffmpegDir}${path.delimiter}${process.env.PATH || ""}` : process.env.PATH
  };
  if (ffmpegPath) env.STREAM_FFMPEG_PATH = ffmpegPath;
  if (ffprobePath) env.STREAM_FFPROBE_PATH = ffprobePath;
  if (youtubeOauthSeed) env.STREAM_YOUTUBE_OAUTH_SEED = youtubeOauthSeed;

  diagnosticLog(`backend python ${python}`);
  diagnosticLog(`backend script ${scriptPath}`);
  diagnosticLog(`backend cwd ${dataRoot()}`);
  diagnosticLog(`backend code root ${backendCodeRoot}`);
  if (youtubeOauthSeed) diagnosticLog(`backend youtube oauth seed ${youtubeOauthSeed}`);
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
  await showLoading("Preparing Castarro...");
  await connectOrStartBackend();
  await loadApplicationUi();
}

function ensureLinuxDesktopShortcut() {
  if (process.platform !== "linux") return;
  try {
    const appImagePath = process.env.APPIMAGE || process.execPath;
    const iconName = "castarro-desktop";
    const desktopFileContent = `[Desktop Entry]
Name=Castarro
Comment=Local multi-channel live streaming dashboard
Exec="${appImagePath}" --no-sandbox %U
Icon=${iconName}
Terminal=false
Type=Application
Categories=AudioVideo;
StartupWMClass=Castarro
`;

    const appsDir = path.join(os.homedir(), ".local", "share", "applications");
    const desktopDir = path.join(os.homedir(), "Desktop");

    fs.mkdirSync(appsDir, { recursive: true });
    const appShortcut = path.join(appsDir, "com.jawadahmad.castarro.desktop");
    if (!fs.existsSync(appShortcut)) {
      fs.writeFileSync(appShortcut, desktopFileContent, { encoding: "utf8", mode: 0o755 });
    }

    if (fs.existsSync(desktopDir)) {
      const desktopShortcut = path.join(desktopDir, "Castarro.desktop");
      if (!fs.existsSync(desktopShortcut)) {
        fs.writeFileSync(desktopShortcut, desktopFileContent, { encoding: "utf8", mode: 0o755 });
      }
    }
  } catch (err) {
    diagnosticLog("linux desktop shortcut setup failed", err);
  }
}

app.whenReady().then(() => {
  app.setName(PRODUCT_NAME);
  app.setAppUserModelId("com.jawadahmad.castarro");
  diagnosticLog("app ready");
  ensureLinuxDesktopShortcut();
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
    loadApplicationUi().catch((error) => showError(error));
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
  clearAutoInstallUpdateTimer();
  stopBackendUpdateHandoffMonitor();
  if (trayStatusTimer) clearInterval(trayStatusTimer);
  if (startupSnapshotTimer) clearTimeout(startupSnapshotTimer);
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
