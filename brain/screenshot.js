const { chromium } = require('playwright');

const SCRATCHPAD = 'C:\\Users\\Owner\\AppData\\Local\\Temp\\claude\\C--Users-Owner\\799a0310-95a7-45ac-99f2-72165ca2ebb2\\scratchpad';
const VIEWPORT = { width: 1600, height: 1000 };

async function takeScreenshots() {
  const browser = await chromium.launch();
  const context = await browser.createContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  try {
    console.log('Navigating to http://localhost:7777...');
    await page.goto('http://localhost:7777', { waitUntil: 'networkidle' });

    // Screenshot 1: Default landing view (wait 3s for animation)
    console.log('Waiting 3s for animation to settle...');
    await page.waitForTimeout(3000);
    const shot1 = `${SCRATCHPAD}\\shot-1.png`;
    await page.screenshot({ path: shot1 });
    console.log(`✓ Saved: ${shot1}`);

    // Screenshot 2: Command Center tab (click top nav)
    console.log('Looking for Command Center tab...');
    const ccButton = await page.locator('button:has-text("Command Center"), [role="button"]:has-text("Command Center"), a:has-text("Command Center")').first();
    const ccButtonCount = await ccButton.count();

    if (ccButtonCount > 0) {
      await ccButton.click();
      await page.waitForTimeout(1000);
      const shot2 = `${SCRATCHPAD}\\shot-2.png`;
      await page.screenshot({ path: shot2 });
      console.log(`✓ Saved: ${shot2}`);
    } else {
      const navButtons = await page.locator('[role="button"], a').all();
      let found = false;
      for (const btn of navButtons) {
        const text = await btn.textContent();
        if (text && text.toLowerCase().includes('command')) {
          await btn.click();
          await page.waitForTimeout(1000);
          const shot2 = `${SCRATCHPAD}\\shot-2.png`;
          await page.screenshot({ path: shot2 });
          console.log(`✓ Saved: ${shot2}`);
          found = true;
          break;
        }
      }
      if (!found) {
        console.log('⚠ Command Center tab not found, taking screenshot of current state');
        const shot2 = `${SCRATCHPAD}\\shot-2.png`;
        await page.screenshot({ path: shot2 });
        console.log(`✓ Saved: ${shot2}`);
      }
    }

    // Screenshot 3: Brain view (default graph view)
    console.log('Looking for Brain tab...');
    const brainButton = await page.locator('button:has-text("Brain"), [role="button"]:has-text("Brain"), a:has-text("Brain")').first();
    const brainButtonCount = await brainButton.count();

    if (brainButtonCount > 0) {
      await brainButton.click();
      await page.waitForTimeout(1500);
      const shot3 = `${SCRATCHPAD}\\shot-3.png`;
      await page.screenshot({ path: shot3 });
      console.log(`✓ Saved: ${shot3}`);
    } else {
      const navButtons = await page.locator('[role="button"], a').all();
      let found = false;
      for (const btn of navButtons) {
        const text = await btn.textContent();
        if (text && text.toLowerCase().includes('brain')) {
          await btn.click();
          await page.waitForTimeout(1500);
          const shot3 = `${SCRATCHPAD}\\shot-3.png`;
          await page.screenshot({ path: shot3 });
          console.log(`✓ Saved: ${shot3}`);
          found = true;
          break;
        }
      }
      if (!found) {
        console.log('⚠ Brain tab not found, taking screenshot of current state');
        const shot3 = `${SCRATCHPAD}\\shot-3.png`;
        await page.screenshot({ path: shot3 });
        console.log(`✓ Saved: ${shot3}`);
      }
    }

    console.log('\n✓ All screenshots saved successfully');

  } catch (err) {
    console.error('Error during screenshot capture:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

takeScreenshots();
