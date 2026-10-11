// Ad-hoc capture through the real page: node tests/peek.mjs '/?play=us&dev=1' out.png ["js to run first"] [waitMs]
import { chromium } from 'playwright';
import { serve } from './server.mjs';
const { srv, url } = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(url + (process.argv[2] ?? '/'));
await page.waitForTimeout(700);
if (process.argv[4]) { await page.evaluate(process.argv[4]); await page.waitForTimeout(+(process.argv[5] ?? 1500)); }
await page.screenshot({ path: '/home/user/geopolitical/test-output/' + (process.argv[3] ?? 'peek.png') });
console.log('errors', errs);
await browser.close(); srv.close();
