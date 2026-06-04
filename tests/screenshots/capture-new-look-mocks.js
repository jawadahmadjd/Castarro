const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.resolve(__dirname, "..", "..");
const mockPath = path.join(root, "design-mocks", "new-look-mocks.html");
const outputRoot = path.join(__dirname, "New Look");

const looks = [
  "control-room-pro",
  "clean-broadcast-studio",
  "global-dashboard-inspector",
];

const pages = [
  "dashboard",
  "folders",
  "normalize",
  "youtube",
  "live-history",
  "troubleshooting",
];

const viewports = [
  { suffix: "desktop", width: 1440, height: 1100, fullPage: true },
  { suffix: "mobile-dashboard", width: 390, height: 1200, fullPage: true, page: "dashboard" },
];

async function capture() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const baseUrl = pathToFileURL(mockPath).href;

  for (const look of looks) {
    const lookDir = path.join(outputRoot, look);
    fs.mkdirSync(lookDir, { recursive: true });

    for (const screen of pages) {
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.goto(`${baseUrl}?look=${look}&page=${screen}`);
      await page.screenshot({
        path: path.join(lookDir, `${screen}-desktop.png`),
        fullPage: true,
      });
    }

    const mobile = viewports[1];
    await page.setViewportSize({ width: mobile.width, height: mobile.height });
    await page.goto(`${baseUrl}?look=${look}&page=${mobile.page}`);
    await page.screenshot({
      path: path.join(lookDir, `${mobile.suffix}.png`),
      fullPage: true,
    });
  }

  await browser.close();
}

capture().catch((error) => {
  console.error(error);
  process.exit(1);
});
