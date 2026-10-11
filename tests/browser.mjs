// Browser tests through the real player path. Writes captures to test-output/.
//   1. cold boot (no flags, fresh context): no console errors, start screen visible, full-window capture
//   2. real mouse play: pick actor → answer a situation card → pick a proposal → open the full list,
//      pick an order and click its target on the map → end turn → read the briefing → continue
//   3. getState assertions after each step
//   4. stills sweep over every actor in the registry and every named camera: fail on blank frames
//   5. autoplay soak (~10 s): sim time advances, no console errors
//   6. phone viewport: no horizontal overflow
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
// Blank-frame check on the composited screenshot: mean luma and spread.
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
const state = (page) => page.evaluate(() => game.getState());

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
  let s = await state(page);
  ok(s.player === 'us' && s.turn === 1 && s.phase === 'turn' && !s.ui.modalOpen, 'start via mouse: playing US, turn 1, your move');
  ok(s.situations.length >= 1 && s.situations.every((x) => x.options.length >= 2), `cards dealt: ${s.situations.map((x) => x.id).join(', ')}`);
  ok(s.declared.length === 18, 'every other actor has declared before the player moves');
  // Answer the first card with its first affordable option, by clicking the row.
  const card = s.situations[0];
  const opt = card.options.find((o) => o.affordable);
  await click(page, `.card[data-sit="${card.id}"] [data-act="choose"][data-opt="${opt.id}"]`);
  s = await state(page);
  ok(s.situations[0].choice === opt.id, `card answered by mouse (${card.id} → ${opt.id})`);
  // Pick the first proposal.
  await click(page, '[data-act="prop"]');
  s = await state(page);
  ok(!!s.orders.initiative, `proposal selected as initiative: ${s.orders.initiative?.action} ${s.orders.initiative?.target ?? ''}`);
  // Open the full list, choose air strikes, and target Hormuz by clicking the map marker.
  await click(page, '[data-act="toggleAll"]');
  await click(page, '[data-act="action"][data-id="strike"]');
  s = await state(page);
  ok(s.ui.action === 'strike' && !s.orders.initiative, 'catalogue action selected; waiting for a target');
  await click(page, '#map .th[data-id="hormuz"] .core');
  s = await state(page);
  ok(s.orders.initiative?.action === 'strike' && s.orders.initiative?.target === 'hormuz', `map click set the target (${s.orders.initiative?.target})`);
  await click(page, '[data-act="commit"][data-id="1"]');
  s = await state(page);
  ok(s.orders.initiative?.commit === 1, 'commitment raised to Major effort');
  const pv = await page.evaluate(() => game.preview('strike', 'hormuz', 1));
  ok(pv.p >= 0.05 && pv.p <= 0.95 && pv.band && !/\d/.test(await page.locator('.box.init .odds').innerText()), `odds shown as words only ("${pv.band}")`);
  ok(s.orders.total.money > 0, `orders total computed ($${s.orders.total.money}, ${s.orders.total.military} mil, ${s.orders.total.political} PC)`);
  // Forecasts run in the background: holding, then the current orders.
  await page.waitForFunction(() => { const f = game.getState().forecast; return f.hold && f.orders && !f.running; }, null, { timeout: 30000 });
  s = await state(page);
  ok(s.forecast.hold.n === 20 && s.forecast.orders.n === 20 && s.forecast.hasOrders, `forecasts computed: holding wins ${Math.round(s.forecast.hold.win * 100)}%, with orders ${Math.round(s.forecast.orders.win * 100)}% (${s.forecast.lastMs} ms for ${s.forecast.orders.n} games)`);
  ok((await page.locator('#clock .sb-out .obar').count()) === 1 && /\d+%/.test(await page.locator('#clock .sb-out').innerText()), 'status bar shows the outlook');
  ok(/vs holding/.test(await page.locator('.orders .outlook').innerText()), 'orders bar compares the orders with holding');
  await click(page, '[data-tab="futures"]');
  ok((await page.locator('#panel .fan').count()) >= 1 && (await page.locator('#panel .fend').count()) >= 3 && (await page.locator('#panel .fgoal').count()) === 5, 'futures tab: fan chart, likely end states, objectives at the end');
  await frameStats(page, OUT + 'futures.png');
  await click(page, '[data-tab="intel"]');
  ok((await page.locator('#panel .irow').count()) >= 10, `intel tab: assessed intentions for ${await page.locator('#panel .irow').count()} actors`);
  await click(page, '[data-tab="command"]');
  ok(await page.locator('#clock .sb-score .gauge .tick.win').count() === 1 && await page.locator('#clock .sb-turn .tl i.now').count() === 1, 'status bar: score gauge with victory tick and turn timeline');
  await page.evaluate(() => { document.querySelector('#panel').scrollTop = 400; });
  await frameStats(page, OUT + 'turn.png');
  await click(page, '[data-act="endTurn"]');
  await page.waitForFunction(() => game.getState().turn === 2, null, { timeout: 15000 });
  s = await state(page);
  ok(s.turn === 2 && s.phase === 'turn' && s.simTime === 1, `end turn: now turn ${s.turn}, simTime ${s.simTime}`);
  ok(s.ui.modalOpen && s.ui.overlay === 'briefing', 'briefing overlay opened after the turn');
  ok(s.briefing.mine >= 2 && s.briefing.mineOutcomes.some((r) => r.kind === 'situation' && r.id === card.id && r.option === opt.id), 'briefing records the card answer');
  ok(s.briefing.mineOutcomes.some((r) => r.kind === 'action' && r.id === 'strike'), 'briefing records the initiative');
  ok(s.briefing.affecting + s.briefing.elsewhere >= 15 && s.briefing.affecting <= 8, `relevance filter: ${s.briefing.affecting} affecting, ${s.briefing.elsewhere} elsewhere`);
  const briefText = await page.locator('#modal').innerText();
  ok(!/d100|roll/i.test(briefText), 'briefing shows no dice');
  ok((await page.locator('#modal #outlookLine').count()) === 1, 'briefing carries the outlook line');
  await page.waitForFunction(() => game.getState().forecast.hold, null, { timeout: 30000 });
  ok(/was \d+%/.test(await page.locator('#modal #outlookLine').innerText()), `outlook line updated in place: "${(await page.locator('#modal #outlookLine').innerText()).slice(0, 80)}"`);
  s = await state(page);
  ok(s.forecast.history === 1, 'the outlook under the orders played was recorded');
  await frameStats(page, OUT + 'briefing.png');
  await click(page, '[data-act="continue"]');
  s = await state(page);
  ok(!s.ui.modalOpen && s.situations.length >= 1, `continued to turn 2 with ${s.situations.length} new cards: ${s.situations.map((x) => x.id).join(', ')}`);
  const scrolls = await page.evaluate(() => ({ win: window.scrollY, main: document.querySelector('#main').scrollTop, panel: document.querySelector('#panel').scrollTop }));
  ok(scrolls.win === 0 && scrolls.main === 0 && scrolls.panel === 0, `scrolled to the top after the turn ${JSON.stringify(scrolls)}`);
  const glyphs = await page.locator('#map .hg').count(), arcs = await page.locator('#map .arc').count();
  const pins = await page.locator('#map .pin circle').count(), cards = await page.locator('#mapTop .topcard').count();
  ok(glyphs >= 5 && arcs === 0 && pins >= 1 && pins <= 3 && cards >= 1 && cards <= 3, `map shows last turn: ${glyphs} glyphs, ${pins} numbered pins, ${cards} strip cards, ${arcs} arcs`);
  await click(page, '#mapTop .topcard');
  ok(await page.locator('#mapPop').isVisible(), 'clicking a strip card opens the theater popover');
  await frameStats(page, OUT + 'strip.png');
  await click(page, '#mapPop [data-act="closePop"]');
  const busy = await page.evaluate(() => { const g = document.querySelector('#map .th .hap .hg'); return g?.closest('.th')?.dataset.id ?? null; });
  await click(page, `#map .th[data-id="${busy}"] .core`);
  const pop = page.locator('#mapPop');
  ok(await pop.isVisible() && (await pop.locator('.hrow').count()) >= 1, `clicking ${busy} opens a popover with ${await pop.locator('.hrow').count()} happening rows`);
  await frameStats(page, OUT + 'popover.png');
  await click(page, '#mapPop [data-act="closePop"]');
  ok(!(await pop.isVisible()), 'popover closes');
  ok(page.errors.length === 0, `play path: no console errors ${JSON.stringify(page.errors)}`);

  // 4. Stills sweep: every actor in the registry, every named camera.
  const reg = await page.evaluate(() => game.registry);
  for (const actor of reg.actors) {
    await page.evaluate((a) => game.start(a, 11), actor);
    const st = await frameStats(page, OUT + `actor-${actor}.png`);
    const cards = (await state(page)).situations.length;
    ok(st.mean > 5 && st.std > 5 && cards >= 1, `still: actor ${actor} (luma ${st.mean.toFixed(1)}, std ${st.std.toFixed(1)}, ${cards} cards)`);
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
  const s = await state(page);
  ok(s.simTime >= 3, `soak: sim advanced ${s.simTime} turns in 10 s (phase ${s.phase})`);
  ok(Object.values(s.world).every(Number.isFinite), 'soak: world values finite');
  ok(page.errors.length === 0 && s.errors.length === 0, `soak: no errors ${JSON.stringify(page.errors.concat(s.errors))}`);
  console.log(`      perf: lastTurnMs=${s.perf.lastTurnMs} frameMs=${s.perf.frameMs} dom=${s.perf.domNodes} svg=${s.perf.svgNodes}`);
  await frameStats(page, OUT + 'soak.png');
  if (s.phase === 'over') {
    await page.evaluate(() => { game.freeze(); game.cam('overview'); });
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
