const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopShell", {
  packaged: true,
  onUpdateStatus(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:update-status", listener);
    return () => ipcRenderer.removeListener("desktop:update-status", listener);
  },
  getUpdateStatus() {
    return ipcRenderer.invoke("desktop:get-update-status");
  },
  getAppVersion() {
    return ipcRenderer.invoke("desktop:get-app-version");
  },
  getUsageMetrics(payload = {}) {
    return ipcRenderer.invoke("desktop:get-usage-metrics", payload);
  },
  selectFolder(options = {}) {
    return ipcRenderer.invoke("desktop:select-folder", options);
  },
  openExternal(url) {
    return ipcRenderer.invoke("desktop:open-external", url);
  },
  exportTextToDownloads(payload = {}) {
    return ipcRenderer.invoke("desktop:export-text-downloads", payload);
  },
  requestQuit() {
    return ipcRenderer.invoke("desktop:request-quit");
  },
  requestStopStreamsAndExit() {
    return ipcRenderer.invoke("desktop:request-stop-streams-and-exit");
  },
  requestRestartToUpdate() {
    return ipcRenderer.invoke("desktop:request-restart-to-update");
  }
});
