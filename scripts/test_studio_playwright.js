const { chromium } = require("playwright");
const path = require("path");

async function test() {
  const userDataDir = "C:\\Users\\Jawad Ahmad\\AppData\\Local\\Google\\Chrome\\User Data";
  console.log("Launching Playwright persistent context with Profile 1...");
  
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chrome",
    headless: true,
    args: [
      "--profile-directory=Profile 1",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const page = await context.newPage();
  console.log("Navigating to https://studio.youtube.com/video/Mm6NyaQq4-E/livestreaming ...");
  await page.goto("https://studio.youtube.com/video/Mm6NyaQq4-E/livestreaming", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);

  console.log("Current URL:", page.url());
  console.log("Page Title:", await page.title());

  await page.screenshot({ path: "test_studio_shot.png" });
  await context.close();
  console.log("Saved test_studio_shot.png successfully!");
}

test().catch(console.error);
