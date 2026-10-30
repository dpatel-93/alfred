// Draws build/icon.png (512 px, transparent) from the floating brain itself, so the app
// icon always matches the widget. Uses the Playwright install the dashboard tests use.
//   node scripts/make-icon.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, '..', '..', 'brain', 'package.json'));
const { chromium } = require('playwright');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await page.goto(`${pathToFileURL(path.join(HERE, '..', 'widget.html')).href}?size=512&still=1`);
await page.locator('#brain').screenshot({ path: path.join(HERE, '..', 'build', 'icon.png'), omitBackground: true });
await browser.close();
console.log('wrote build/icon.png');
