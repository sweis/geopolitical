// Browser tests through the real player path. Writes captures to test-output/.
//   1. cold boot (no flags, fresh context): no console errors, start screen visible, full-window capture
//   2. real mouse play: pick actor → action → click a theater on the map → declare → argue → adjudicate → next
//   3. getState assertions after each phase
//   4. stills sweep over every actor in the registry and every named camera: fail on blank frames
//   5. autoplay soak (~10 s): sim time advances, no console errors
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { serve } from './server.mjs';

const OUT = new URL('../test-output/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

const { srv, url } = await serve();
const browser = await chromium.launch();

async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}
// Blank-frame check on the composited screenshot: mean luma and fraction of pixels that differ from the mode.
async function frameStats(page, path) {
  const buf = await page.screenshot({ path });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, sum2 = 0; const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; sum += l; sum2 += l * l; }
    const mean = sum / n; return { mean, std: Math.sqrt(sum2 / n - mean * mean) };
  }, buf.toString('base64'));
}
// Real mouse input at the element's on-screen centre (scrolling it into view first, as a player would).
const click = async (page, sel) => {
  const loc = page.locator(sel).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 });
  const b = await loc.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

// 1. Cold boot.
{
  const page = await newPage();
  await page.goto(url + '/');
  await page.waitForTimeout(1000);
  const st = await frameStats(page, OUT + 'coldboot.png');
  ok(page.errors.length === 0, `cold boot: no console errors ${JSON.stringify(page.errors)}`);
  ok(await page.locator('#startSheet').isVisible(), 'cold boot: start screen visible');
  ok(st.mean > 5 && st.std > 5, `cold boot frame not blank (luma ${st.mean.toFixed(1)}, std ${st.std.toFixed(1)})`);
  ok(await page.evaluate(() => !('game' in window)), 'cold boot: dev hooks absent without ?dev');
  await page.context().close();
}

// 2–3. Real mouse play with dev hooks for assertions.
{
  const page = await newPage();
  await page.goto(url + '/?dev=1&seed=7');
  await page.waitForTimeout(600);
  await click(page, '[data-act="pick"][data-id="us"]');
  await click(page, '[data-act="begin"]');
  let s = await page.evaluate(() => game.getState());
  ok(s.player === 'us' && s.turn === 1 && s.phase === 'declare' && !s.ui.modalOpen, 'start via mouse: playing US, turn 1, declare phase');
  await click(page, '[data-act="action"][data-id="strike"]');
  await page.waitForTimeout(100);
  // Target by clicking the Hormuz marker on the map (real coordinates).
  await click(page, '#map .th[data-id="hormuz"] .core');
  s = await page.evaluate(() => game.getState());
  ok(s.ui.action === 'strike' && s.ui.target === 'hormuz', `map click targets Hormuz (ui.target=${s.ui.target})`);
  await click(page, '[data-act="commit"][data-id="1"]');
  const pv = await page.evaluate(() => game.preview('strike', 'hormuz', 1));
  ok(pv.p >= 0.05 && pv.p <= 0.95 && pv.mods.length > 0, `preview probability ${pv.p} (${pv.band}) with ${pv.mods.length} reasons`);
  await frameStats(page, OUT + 'declare.png');
  await click(page, '[data-act="declare"]');
  await page.waitForFunction(() => game.getState().phase === 'debate', null, { timeout: 10000 });
  s = await page.evaluate(() => game.getState());
  const alive = Object.values(s.actors).filter((a) => !a.collapsed).length;
  ok(s.declared.length === alive, `debate: all ${alive} live actors declared (${s.declared.length})`);
  if (s.debate.length) {
    const before = s.actors.us.political;
    await click(page, `[data-act="argue"][data-id="${s.debate[0].actor}"][data-stance="-1"]`);
    const after = (await page.evaluate(() => game.getState())).actors.us.political;
    ok(after === before - 1, `arguing costs 1 PC (${before} → ${after})`);
  }
  await frameStats(page, OUT + 'debate.png');
  await click(page, '[data-act="resolve"]');
  await page.waitForFunction(() => game.getState().phase === 'results', null, { timeout: 10000 });
  s = await page.evaluate(() => game.getState());
  ok(s.results.length > 0 && s.results.every((r) => r.outcome === 'fizzle' || (r.p >= 0.05 && r.p <= 0.95 && r.roll >= 1 && r.roll <= 100)), `results: ${s.results.length} adjudications with valid p and d100`);
  ok(s.historyLength === 2 && Number.isFinite(s.scores.us), `history snapshot recorded, score ${s.scores.us}`);
  await page.locator('#panel').evaluate((e) => (e.scrollTop = 0));
  await frameStats(page, OUT + 'results.png');
  await click(page, '[data-act="next"]');
  s = await page.evaluate(() => game.getState());
  ok(s.turn === 2 && s.phase === 'declare' && s.simTime === 1, `next turn: turn ${s.turn}, simTime ${s.simTime}`);
  ok(page.errors.length === 0, `play path: no console errors ${JSON.stringify(page.errors)}`);

  // 4. Stills sweep: every actor in the registry, every named camera.
  const reg = await page.evaluate(() => game.registry);
  for (const actor of reg.actors) {
    await page.evaluate((a) => game.start(a, 11), actor);
    const st = await frameStats(page, OUT + `actor-${actor}.png`);
    ok(st.mean > 5 && st.std > 5, `still: actor ${actor} (luma ${st.mean.toFixed(1)}, std ${st.std.toFixed(1)})`);
  }
  await page.evaluate(() => game.start('iran', 11));
  for (const cam of reg.cams) {
    await page.evaluate((c) => game.cam(c), cam);
    const st = await frameStats(page, OUT + `cam-${cam}.png`);
    ok(st.mean > 5 && st.std > 5, `still: cam ${cam} (luma ${st.mean.toFixed(1)}, std ${st.std.toFixed(1)})`);
  }
  ok(page.errors.length === 0, `sweep: no console errors ${JSON.stringify(page.errors)}`);
  await page.context().close();
}

// 5. Autoplay soak.
{
  const page = await newPage();
  await page.goto(url + '/?dev=1&seed=3&play=saudi&auto=1&autodt=150');
  await page.waitForTimeout(10000);
  const s = await page.evaluate(() => game.getState());
  ok(s.simTime >= 3, `soak: sim advanced ${s.simTime} turns in 10 s (phase ${s.phase})`);
  ok(Object.values(s.world).every(Number.isFinite), 'soak: world values finite');
  ok(page.errors.length === 0 && s.errors.length === 0, `soak: no errors ${JSON.stringify(page.errors.concat(s.errors))}`);
  console.log(`      perf: lastTurnMs=${s.perf.lastTurnMs} frameMs=${s.perf.frameMs} dom=${s.perf.domNodes} svg=${s.perf.svgNodes}`);
  await frameStats(page, OUT + 'soak.png');
  if (s.phase === 'over') {
    await page.evaluate(() => game.freeze());
    await page.evaluate(() => game.cam('overview'));
    await click(page, '[data-act="showEnd"]');
    ok(await page.locator('.verdict').isVisible(), 'end screen opens via mouse after the final turn');
    await frameStats(page, OUT + 'end.png');
  }
  await page.context().close();
}

// 6. Phone viewport.
{
  const page = await newPage({ width: 390, height: 844 });
  await page.goto(url + '/?dev=1&seed=5&play=hezbollah');
  await page.waitForTimeout(600);
  const st = await frameStats(page, OUT + 'phone.png');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(st.std > 5 && overflow <= 0, `phone: renders, no horizontal overflow (${overflow}px)`);
  await page.context().close();
}

await browser.close();
srv.close();
console.log(failures ? `\n${failures} FAILED` : '\nall browser checks passed');
process.exit(failures ? 1 : 0);
