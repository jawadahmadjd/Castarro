const assert = require("node:assert/strict");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1490, height: 768 } });

  await page.goto("http://127.0.0.1:8766");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Activity" }).waitFor();

  await page.evaluate(() => {
    const longLine = "frame=  603 fps=0.0 q=-1.0 Lsize=N/A time=00:00:20.01 bitrate=N/A speed=79.4x elapsed=00:00:00.25 ".repeat(8);
    window.renderTasks([
      {
        id: "layout-check",
        name: "test-stream",
        running: false,
        returncode: 0,
        lines: [
          "TASK channel=Inside Us total=1",
          "FILE 1/1 test local stream for 20s",
          longLine,
        ],
      },
    ]);
  });

  const metrics = await page.evaluate(() => {
    const activity = document.querySelector(".grid > .panel");
    const stream = document.querySelector(".panel.logs");
    const pre = document.querySelector("#tasks pre[data-log-id]");
    const copyButtons = Array.from(document.querySelectorAll("button")).filter((button) => button.textContent.trim() === "Copy");

    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };

    return {
      activity: rect(activity),
      stream: rect(stream),
      pre: rect(pre),
      preClientWidth: pre.clientWidth,
      preScrollWidth: pre.scrollWidth,
      preOverflowX: getComputedStyle(pre).overflowX,
      copyButtonCount: copyButtons.length,
    };
  });

  assert(metrics.copyButtonCount >= 2, "expected Activity and Stream Logs copy buttons");
  assert(metrics.pre.right <= metrics.activity.right + 1, "activity pre escaped its panel");
  assert(metrics.activity.right <= metrics.stream.left - 8, "activity panel overlaps stream logs panel");
  assert.equal(metrics.preOverflowX, "auto");
  assert(metrics.preScrollWidth > metrics.preClientWidth, "long log line should scroll horizontally inside pre");

  await page.screenshot({ path: "tests/log-layout.png", fullPage: true });
  await browser.close();
  console.log(JSON.stringify(metrics, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
