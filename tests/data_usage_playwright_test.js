const assert = require("node:assert/strict");
const { spawn, execSync } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright");

const PORT = 8779;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

function seedDatabase() {
  const python = process.platform === "win32" ? "python" : "python3";
  execSync(`${python} tests/seed_data_usage.py`, { cwd: path.join(__dirname, "..") });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const python = process.platform === "win32" ? "python" : "python3";
    const serverProc = spawn(python, [
      path.join(__dirname, "..", "scripts", "web_ui.py")
    ], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, STREAM_UI_PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let started = false;
    serverProc.stdout.on("data", (data) => {
      const output = data.toString();
      if (!started && (output.includes("Castarro UI running") || output.includes("Serving Web UI"))) {
        started = true;
        resolve(serverProc);
      }
    });

    serverProc.stderr.on("data", (data) => {
      const output = data.toString();
      if (!started && (output.includes("Castarro UI running") || output.includes("Serving Web UI"))) {
        started = true;
        resolve(serverProc);
      }
    });

    serverProc.on("error", (err) => {
      if (!started) reject(err);
    });

    setTimeout(() => {
      if (!started) {
        resolve(serverProc);
      }
    }, 4000);
  });
}

(async () => {
  console.log("1. Seeding test data usage records in stream_control.db...");
  seedDatabase();

  console.log("2. Starting local web UI server on port " + PORT + "...");
  const serverProc = await startServer();

  let browser;
  try {
    console.log("3. Launching Playwright Chromium...");
    browser = await chromium.launch({ headless: true });
    const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    console.log("Using timezone for browser context:", userTz);
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: userTz });
    const page = await context.newPage();

    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => console.log("PAGE CONSOLE:", msg.type(), msg.text()));
    page.on("response", async (res) => {
      if (res.url().includes("data-usage")) {
        console.log("API RESPONSE:", res.url(), "->", await res.text());
      }
    });

    console.log("4. Navigating to " + SERVER_URL + "...");
    await page.goto(SERVER_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    console.log("Active state.config in page:", await page.evaluate(() => window.state?.config));

    console.log("5. Opening Data Usage Tracker modal...");
    const [resp1] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/data-usage")),
      page.locator("#workspaceUsageTodayItem, #workspaceUsageMonthItem, [onclick*='openDataUsageModal']").first().click(),
    ]);

    const modal = page.locator("#dataUsageModal");
    await modal.waitFor({ state: "visible" });

    const totalBytesText = await page.locator("#dataUsageTotalBytes").innerText();
    console.log("Initial Total Data Used:", totalBytesText);
    assert.notEqual(totalBytesText, "Error", "Total Data Used should not be Error");

    const channelListText = await page.locator("#dataUsageChannelList").innerText();
    console.log("Initial Channel Breakdown:\n" + channelListText);
    assert(!channelListText.includes("Failed to fetch"), "Channel breakdown should not have Failed to fetch error");
    assert(!channelListText.includes("Error"), "Channel breakdown should not have Error");

    const dailyListText = await page.locator("#dataUsageDailyList").innerText();
    console.log("Initial Daily Usage:\n" + dailyListText);
    assert(!dailyListText.includes("Error"), "Daily list should not have Error");

    // Test Preset Buttons: 'Today'
    console.log("6. Testing 'Today' preset button...");
    const [resp2] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/data-usage")),
      page.locator("button:has-text('Today')").first().click(),
    ]);

    const todayTotal = await page.locator("#dataUsageTotalBytes").innerText();
    const todaySessions = await page.locator("#dataUsageSessionCount").innerText();
    console.log("Today Preset -> Total:", todayTotal, "| Sessions:", todaySessions);
    assert.equal(todaySessions, "2", "Today should have 2 sessions seeded");
    assert(todayTotal.includes("150"), `Today total should be 150.0 MB, got ${todayTotal}`);

    // Test Preset Buttons: 'Last 7 Days'
    console.log("7. Testing 'Last 7 Days' preset button...");
    const [resp3] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/data-usage")),
      page.locator("button:has-text('Last 7 Days')").first().click(),
    ]);

    const sevenDayTotal = await page.locator("#dataUsageTotalBytes").innerText();
    const sevenDaySessions = await page.locator("#dataUsageSessionCount").innerText();
    console.log("Last 7 Days Preset -> Total:", sevenDayTotal, "| Sessions:", sevenDaySessions);
    assert.equal(sevenDaySessions, "4", "Last 7 days should have 4 sessions seeded");
    assert(sevenDayTotal.includes("650"), `7 Days total should be 650.0 MB, got ${sevenDayTotal}`);

    // Test Custom Calendar Inputs
    console.log("8. Testing Custom Calendar Filter Inputs...");
    const startDateInput = page.locator("#dataUsageStartDate");
    const endDateInput = page.locator("#dataUsageEndDate");

    const nowObj = new Date();
    const todayISO = nowObj.toISOString().split("T")[0];
    await startDateInput.fill(todayISO);
    await endDateInput.fill(todayISO);

    const [resp4] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/data-usage")),
      page.locator("button:has-text('Query Usage')").first().click(),
    ]);

    const customTotal = await page.locator("#dataUsageTotalBytes").innerText();
    console.log("Custom Today Query -> Total:", customTotal);
    assert.notEqual(customTotal, "Error", "Custom Query should not result in Error");
    assert(customTotal.includes("150"), `Custom Today total should be 150.0 MB, got ${customTotal}`);

    // Take verification screenshot of open modal
    await page.screenshot({ path: "tests/data-usage-modal-verified.png" });
    console.log("Screenshot saved to tests/data-usage-modal-verified.png");

    assert.equal(pageErrors.length, 0, "No uncaught JS errors should occur: " + pageErrors.join(", "));
    console.log("✅ ALL PLAYWRIGHT DATA USAGE TESTS PASSED SUCCESSFULLY!");

  } finally {
    if (browser) await browser.close();
    if (serverProc) serverProc.kill();
  }
})().catch((err) => {
  console.error("❌ Playwright Test Failed:", err);
  process.exit(1);
});
