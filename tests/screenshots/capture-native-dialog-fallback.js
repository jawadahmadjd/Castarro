const { app, dialog } = require("electron");
const path = require("node:path");
const cp = require("node:child_process");

const outPath = path.join(process.cwd(), "tests", "screenshots", "native-close-guard-dialog.png");

function captureDesktop(targetPath) {
  const cmd = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
    "$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)",
    `$bitmap.Save('${targetPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    "$graphics.Dispose()",
    "$bitmap.Dispose()",
  ].join("; ");
  cp.execFileSync("powershell", ["-NoProfile", "-Command", cmd], { stdio: "inherit" });
}

app.whenReady().then(async () => {
  setTimeout(() => {
    try {
      captureDesktop(outPath);
    } catch (error) {
      console.error(error);
    }
  }, 1200);

  await dialog.showMessageBox({
    type: "warning",
    buttons: ["OK"],
    defaultId: 0,
    noLink: true,
    title: "Stop streams before closing",
    message: "1 live stream is still running.",
    detail: "To protect your live broadcast, Castarro cannot close right now.\n\nPlease stop all running streams, then close or restart the app."
  });

  app.quit();
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
