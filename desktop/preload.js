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
  selectFolder(options = {}) {
    return ipcRenderer.invoke("desktop:select-folder", options);
  },
  requestQuit() {
    return ipcRenderer.invoke("desktop:request-quit");
  }
});
