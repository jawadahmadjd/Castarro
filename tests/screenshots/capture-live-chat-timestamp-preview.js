const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "tests", "screenshots", "live-chat-timestamp-preview.png");
const cssHref = `file:///${path.join(ROOT, "web", "ui-master.css").replace(/\\/g, "/")}`;

function message({ name, time, badge = "", text, initials }) {
  const badgeMarkup = badge ? `<span class="badge">${badge}</span>` : "";
  return `
    <article class="youtube-chat-message">
      <div class="youtube-chat-avatar missing" aria-hidden="true">${initials}</div>
      <div class="youtube-chat-message-body">
        <div class="youtube-chat-message-head">
          <strong>${name}</strong>
          <time class="youtube-chat-time">${time}</time>
          ${badgeMarkup}
        </div>
        <div class="youtube-chat-message-text">${text}</div>
      </div>
    </article>
  `;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 520, height: 760 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <link rel="stylesheet" href="${cssHref}">
        <style>
          body { margin: 0; padding: 18px; background: var(--bg); }
          .youtube-chat-avatar.missing {
            display: grid;
            place-items: center;
            color: var(--muted);
            font-size: 0.72rem;
            font-weight: 900;
          }
        </style>
      </head>
      <body>
        <aside class="youtube-chat-side-panel">
          <div class="youtube-chat-side-panel-head">
            <div>
              <h2>Comments & Live Chat</h2>
              <span class="meta">Friday night stream</span>
            </div>
            <span class="badge live">Live Chat</span>
          </div>
          <div class="youtube-chat-side-panel-body">
            <div class="youtube-chat-toolbar">
              <span class="badge">4 loaded</span>
              <span class="badge">Refresh 5s</span>
              <button class="pill small ghost icon-only" type="button" title="Refresh" aria-label="Refresh">
                <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M21 12a9 9 0 0 1-15 6.7"></path>
                  <path d="M3 12a9 9 0 0 1 15-6.7"></path>
                  <path d="M18 3v4h-4"></path>
                  <path d="M6 21v-4h4"></path>
                </svg>
              </button>
            </div>
            <div class="youtube-chat-list" aria-live="polite">
              ${message({ name: "Ayesha Khan", time: "1:23 pm", text: "Audio is clean now, thanks!", initials: "AK" })}
              ${message({ name: "Castarro", time: "1:24 pm", badge: "Owner", text: "Great, keeping this setting for the rest of the stream.", initials: "C" })}
              ${message({ name: "M. Hassan", time: "1:27 pm", badge: "Member", text: "Can you show the encoder screen after this clip?", initials: "MH" })}
              ${message({ name: "Nora", time: "1:31 pm", text: "The small timestamp is perfect. It does not crowd the message.", initials: "N" })}
            </div>
            <div class="youtube-chat-reply">
              <textarea rows="3" placeholder="Reply in live chat"></textarea>
              <button class="pill primary icon-only" type="button" title="Send reply" aria-label="Send reply">
                <svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m22 2-7 20-4-9-9-4Z"></path>
                  <path d="M22 2 11 13"></path>
                </svg>
              </button>
            </div>
          </div>
        </aside>
      </body>
    </html>`);
  await page.screenshot({ path: OUT, fullPage: true });
  await browser.close();
  console.log(OUT);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
