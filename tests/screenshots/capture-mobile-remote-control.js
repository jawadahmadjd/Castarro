const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..", "..");
const mockPath = path.join(ROOT, "design-mocks", "mobile-remote-control.html");
const outDir = path.join(ROOT, "tests", "screenshots");

async function capture() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 920 } });
  try {
    await page.goto(pathToFileURL(mockPath).href);
    await page.screenshot({
      path: path.join(outDir, "mobile-remote-control-mock.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}

capture().catch((error) => {
  console.error(error);
  process.exit(1);
});
