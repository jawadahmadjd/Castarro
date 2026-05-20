const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktopShell", {
  packaged: true
});
