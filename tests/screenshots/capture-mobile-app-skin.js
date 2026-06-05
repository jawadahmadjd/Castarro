const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.resolve(__dirname, "..", "..");
const mockPath = path.join(root, "design-mocks", "mobile-app-skin.html");
const outputRoot = path.join(__dirname, "mobile-android-architecture");

const captures = [
  { name: "all-screens", width: 1440, height: 1200, fullPage: true },
  { name: "home-mobile", width: 390, height: 900, fullPage: false },
];

async function capture() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const url = pathToFileURL(mockPath).href;

  for (const item of captures) {
    await page.setViewportSize({ width: item.width, height: item.height });
    await page.goto(url);
    await page.screenshot({
      path: path.join(outputRoot, `${item.name}.png`),
      fullPage: item.fullPage,
    });
  }

  await browser.close();
}

capture().catch((error) => {
  console.error(error);
  process.exit(1);
});
