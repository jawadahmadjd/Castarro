const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
  const args = process.argv.slice(2);
  let studioUrl = 'https://studio.youtube.com/video/live/livestreaming';
  let profileDir = path.join(process.cwd(), '.runtime', 'playwright_profile_default');
  let dismissDelay = 12000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--studio-url' && args[i+1]) {
      studioUrl = args[i+1];
    }
    if (args[i] === '--profile-dir' && args[i+1]) {
      profileDir = args[i+1];
    }
    if (args[i] === '--dismiss-delay' && args[i+1]) {
      dismissDelay = parseInt(args[i+1], 10);
    }
  }

  console.log(`[playwright-dismiss] Launching Playwright with profile: ${profileDir}`);
  console.log(`[playwright-dismiss] Target YouTube Studio URL: ${studioUrl}`);

  fs.mkdirSync(profileDir, { recursive: true });

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome', // Use local Chrome browser to reuse Google login state if available
      headless: false,   // Headed browser so Google login works and user can see the action
      viewport: null,
      args: ['--start-maximized']
    });
  } catch (e) {
    console.log(`[playwright-dismiss] Chrome channel failed to launch (${e.message}), falling back to default Chromium...`);
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: null,
      args: ['--start-maximized']
    });
  }

  const page = await context.newPage();
  
  try {
    console.log(`[playwright-dismiss] Navigating to YouTube Studio URL...`);
    await page.goto(studioUrl, { waitUntil: 'load', timeout: 60000 });

    // Check if we are stuck on the login screen
    if (page.url().includes('accounts.google.com')) {
      console.log('[playwright-dismiss] Google account login required. Please complete login in the browser window.');
      // Wait for login to complete (URL changes to studio.youtube.com)
      await page.waitForURL(/studio\.youtube\.com/, { timeout: 300000 });
      console.log('[playwright-dismiss] Login completed. Resuming automation...');
    }

    console.log('[playwright-dismiss] Waiting for "Dismiss" button to appear...');
    // Target any button in the YouTube Studio containing "Dismiss" or "Close" case-insensitively
    const dismissBtn = page.getByRole('button', { name: /dismiss|close/i });
    
    // Wait up to 30 seconds for the end stream dialogue box
    try {
      await dismissBtn.waitFor({ state: 'visible', timeout: 30000 });
      console.log('[playwright-dismiss] Dismiss button is visible. Clicking...');
      await dismissBtn.click();
      console.log(`[playwright-dismiss] Clicked. Waiting ${dismissDelay / 1000} seconds for page to refresh state...`);
      await page.waitForTimeout(dismissDelay);
    } catch (e) {
      console.log('[playwright-dismiss] No "Dismiss" button appeared within 30 seconds. Dialog might already be dismissed.');
    }
  } catch (err) {
    console.error('[playwright-dismiss] Error occurred during browser automation:', err);
  } finally {
    console.log('[playwright-dismiss] Closing browser...');
    await context.close();
  }
}

main().catch(err => {
  console.error('[playwright-dismiss] Fatal error:', err);
  process.exit(1);
});
