// Ad-hoc capture: node tests/peek.mjs '/?play=us&dev=1' out.png
import { chromium } from 'playwright';
import { serve } from './server.mjs';
const { srv, url } = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(url + (process.argv[2] ?? '/'));
await page.waitForTimeout(800);
await page.screenshot({ path: '/home/user/geopolitical/test-output/' + (process.argv[3] ?? 'peek.png') });
console.log('errors', errs);
await browser.close(); srv.close();
