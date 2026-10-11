// App controller: owns the game state and UI state, wires DOM events to engine calls, renders.
import { ACTOR_BY_ID } from './data/actors.js';
import { ACTION_BY_ID } from './engine/actions.js';
import { newGame, choose, setInitiative, clearInitiative, endTurn, autoTurn, proposals } from './engine/game.js';
import { impactLine } from './engine/director.js';
import { rel } from './engine/state.js';
import { createMap, renderMap, drawArcs, drawHappenings, drawPins, flash } from './ui/mapView.js';
import * as P from './ui/panels.js';
import { iconSheet, actionIcon, optionIcon } from './ui/icons.js';
import { THEATER_BY_ID } from './data/theaters.js';
const short = (id) => ACTOR_BY_ID[id]?.short ?? THEATER_BY_ID[id]?.label ?? THEATER_BY_ID[id]?.name ?? id;
import { installDev } from './dev/dev.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

export const app = {
  s: null,
  ui: { tab: 'command', cat: 'all', action: null, target: undefined, commit: 0, selectedTheater: null, targetable: new Set(), startPick: 'us', showAll: false, why: new Set(), expanded: new Set(), proposals: null, overlay: null, pop: null, hap: {}, top: [] },
  metrics: { lastTurnMs: 0, renders: 0 },
  errors: [],
  map: null,
};

function resetTurnUi() {
  Object.assign(app.ui, { action: null, target: undefined, commit: 0, targetable: new Set(), showAll: false, why: new Set(), expanded: new Set(), proposals: null, pop: null });
}

// Every scroll container back to the top: the page (phones), the main grid, the panel and the modal.
function scrollTop() {
  window.scrollTo(0, 0);
  for (const sel of ['#main', '#panel', '#modal', '#mapwrap']) { const e = $(sel); if (e) e.scrollTop = 0; }
}

export function startGame(player, seed = +(params.get('seed') ?? Date.now() % 100000)) {
  app.s = newGame({ seed, player });
  resetTurnUi();
  app.ui.tab = 'command';
  app.ui.overlay = null;
  app.ui.hap = {}; app.ui.top = [];
  app.map.highlightHome(player);
  drawArcs(app.map, [], player);
  drawHappenings(app.map, {});
  drawPins(app.map, []);
  renderStrip();
  closeModal();
  closePop();
  render();
  scrollTop();
}

// ── rendering ──
export function render() {
  const s = app.s, ui = app.ui;
  app.metrics.renders++;
  if (s.player && s.phase === 'turn' && (!ui.proposals || ui.proposals.turn !== s.turn || ui.proposals.seed !== s.seed)) ui.proposals = { turn: s.turn, seed: s.seed, list: proposals(s) };
  $('#clock').innerHTML = P.statusHtml(s);
  $('#indicators').innerHTML = P.indicatorsHtml(s);
  $('#actorCard').innerHTML = P.actorCardHtml(s);
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === ui.tab);
  const panel = $('#panel');
  const scroll = panel.scrollTop;
  panel.innerHTML = ui.tab === 'command' ? P.commandHtml(s, ui) : ui.tab === 'goals' ? P.goalsHtml(s) : ui.tab === 'intel' ? P.intelHtml(s, ui) : P.logHtml(s);
  panel.scrollTop = scroll;
  ui.targetable = new Set();
  if (s.phase === 'turn' && s.player && ui.action && !s.orders.initiative && ACTION_BY_ID[ui.action].target === 'theater')
    for (const t of ACTION_BY_ID[ui.action].targets(s, s.player)) ui.targetable.add(t);
  const init = s.orders.initiative;
  ui.target = init?.target ?? ui.target;
  const cards = {};
  for (const x of s.situations) if (x.at && !cards[x.at]) cards[x.at] = x.kind;
  renderMap(app.map, s, { ...ui, target: init && s.theaters[init.target] ? init.target : undefined, cards });
  const latest = s.news.at(-1)?.text ?? s.log.at(-1)?.text ?? '';
  $('#tickerText').textContent = latest;
  if (ui.pop) renderPop();
  if (!$('#mapTop')) renderStrip();
}

function openModal(html) { const m = $('#modal'); m.innerHTML = html; m.hidden = false; m.scrollTop = 0; }
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; app.ui.overlay = null; }
export function showStart() { openModal(P.startHtml(newGame({ seed: 1, player: null }), app.ui.startPick)); }
function showBriefing() { app.ui.overlay = 'briefing'; openModal(P.briefingHtml(app.s)); }

// ── happenings: what happened where last turn, for the map glyphs and the popover ──
function buildHappenings() {
  const s = app.s, p = s.player;
  const by = {};
  const add = (t, h) => { if (!t || !s.theaters[t]) return; (by[t] ??= []).push(h); };
  const relevant = new Set((s.briefing?.affecting ?? []).map((r) => r.actor));
  const hostile = (id) => p && id !== p && rel(s, p, id) <= -40;
  for (const r of s.briefing?.mine ?? []) {
    if (r.kind === 'situation' && r.at) add(r.at, { icon: optionIcon({ id: r.option, label: r.label }), cls: r.ok ? 'mine' : 'mine bad', actor: null, text: `${r.label}: ${r.text}`, lines: r.lines, w: 3, title: r.label, score: Math.abs(r.impact?.dScore ?? 0), big: r.outcome === 'crit' || r.outcome === 'blowback' });
  }
  for (const r of s.results) {
    const t = s.theaters[r.target] ? r.target : (ACTOR_BY_ID[r.target]?.home ?? ACTOR_BY_ID[r.actor]?.home);
    if (!t || r.outcome === 'fizzle') continue;
    const mine = r.actor === p;
    const lines = p && r.impact ? impactLine(s, p, r.impact) : [];
    const good = lines.some((l) => l.good > 0) && !lines.some((l) => l.good < 0);
    const bad = lines.some((l) => l.good < 0);
    const cls = mine ? (r.ok ? 'mine' : 'mine bad') : relevant.has(r.actor) ? (bad ? 'bad' : good ? 'good' : 'rel') : 'faint';
    add(t, { icon: actionIcon(r.action), cls, actor: r.actor, text: r.text, lines, w: mine ? 3 : relevant.has(r.actor) ? 2 : hostile(r.actor) ? 1.5 : 1, title: `${ACTION_BY_ID[r.action]?.name ?? r.action}${r.target ? ` · ${P.esc(short(r.target))}` : ''}`, score: Math.abs(r.impact?.dScore ?? 0), big: r.outcome === 'crit' || r.outcome === 'blowback' });
  }
  for (const n of s.news) {
    const lines = p && n.impact ? impactLine(s, p, n.impact) : [];
    add(n.at, { icon: 'bolt', cls: lines.length ? 'event' : 'faint', actor: null, text: n.text, lines, w: lines.length ? 2.5 : 1, title: n.text.length > 60 ? n.text.slice(0, 57).replace(/\s+\S*$/, '') + '…' : n.text, score: Math.abs(n.impact?.dScore ?? 0), big: false });
  }
  for (const list of Object.values(by)) list.sort((a, b) => b.w - a.w);
  return by;
}

// The three happenings that mattered most: by score impact, chip weight, and whether it was yours.
function buildTop(hap) {
  const all = [];
  for (const [theater, items] of Object.entries(hap)) for (const x of items) all.push({ ...x, theater });
  for (const x of all) {
    const moved = (x.score ?? 0) > 0 || (x.lines ?? []).length > 0;
    x.rankW = 4 * (x.score ?? 0) + 0.25 * (x.lines ?? []).reduce((n, l) => n + Math.abs(l.d), 0) + (x.cls.startsWith('mine') && moved ? 2 : 0) + (x.cls === 'faint' ? -1 : 0.5) + (x.big ? 1 : 0);
  }
  all.sort((a, b) => b.rankW - a.rankW);
  return { top: all.slice(0, 3).map((x, i) => ({ ...x, rank: i + 1 })), more: Math.max(0, all.length - 3) };
}

function renderStrip() {
  let e = $('#mapTop');
  if (!e) { e = document.createElement('div'); e.id = 'mapTop'; $('#mapwrap').appendChild(e); e.addEventListener('click', onStripClick); }
  const { top, more } = app.ui.top.length ? app.ui.top[0] : { top: [], more: 0 };
  e.innerHTML = P.topStripHtml(top, more);
  e.hidden = !top.length;
}
function onStripClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'top') { if (b.dataset.id) openPop(b.dataset.id); else showBriefing(); }
  if (b.dataset.act === 'briefing') showBriefing();
}

function afterTurn() {
  const s = app.s;
  drawArcs(app.map, [], s.player); // arcs retired: too small to read; the strip and pins carry the turn
  app.ui.hap = buildHappenings();
  const ranked = buildTop(app.ui.hap);
  app.ui.top = [ranked];
  drawPins(app.map, ranked.top.filter((x) => x.theater).map((x) => ({ theater: x.theater, rank: x.rank })));
  renderStrip();
  drawHappenings(app.map, Object.fromEntries(Object.entries(app.ui.hap).map(([t, items]) => [t, items.filter((x) => x.cls !== 'faint').concat(items.filter((x) => x.cls === 'faint'))])));
  for (const n of s.news) if (n.at) flash(app.map, n.at);
  resetTurnUi();
  closePop();
}

// ── map popover ──
function popEl() {
  let e = $('#mapPop');
  if (!e) { e = document.createElement('div'); e.id = 'mapPop'; e.hidden = true; $('#mapwrap').appendChild(e); e.addEventListener('click', onPopClick); }
  return e;
}
function openPop(tid) { app.ui.pop = tid; app.ui.selectedTheater = tid; renderPop(); }
function closePop() { app.ui.pop = null; const e = $('#mapPop'); if (e) { e.hidden = true; e.innerHTML = ''; } }
function renderPop() {
  const tid = app.ui.pop;
  const e = popEl();
  const pos = app.map.screenPos(tid);
  if (!pos) { closePop(); return; }
  e.innerHTML = P.theaterPopHtml(app.s, tid, app.ui.hap[tid] ?? []);
  e.hidden = false;
  const w = e.offsetWidth, h = e.offsetHeight;
  let x = pos.x + 18, y = pos.y - 20;
  if (x + w > pos.box.w - 8) x = Math.max(8, pos.x - w - 18);
  if (y + h > pos.box.h - 8) y = Math.max(8, pos.box.h - h - 8);
  if (y < 8) y = 8;
  e.style.left = `${x}px`; e.style.top = `${y}px`;
}
function onPopClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  if (act === 'closePop') closePop();
  if (act === 'intel') { app.ui.tab = 'intel'; app.ui.selectedTheater = id; closePop(); render(); }
  if (act === 'gotoCard') { app.ui.tab = 'command'; closePop(); render(); document.querySelector(`.card[data-sit="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
}

// ── orders ──
function pickProposal(action, target) {
  const s = app.s;
  const init = s.orders.initiative;
  if (init && init.action === action && init.target === target) { clearInitiative(s); }
  else { try { setInitiative(s, action, target, 0); } catch (e) { app.errors.push(String(e.message)); } }
  app.ui.action = null;
  render();
}
function pickAction(id) {
  const s = app.s;
  clearInitiative(s);
  app.ui.action = id; app.ui.commit = 0;
  const t = ACTION_BY_ID[id].targets(s, s.player);
  if (t.length === 1) pickTarget(t[0]); else render();
}
function pickTarget(t) {
  const s = app.s, ui = app.ui;
  if (!ui.action) return;
  try { setInitiative(s, ui.action, t, 0); ui.action = null; } catch (e) { app.errors.push(String(e.message)); }
  if (s.theaters[t]) ui.selectedTheater = t;
  render();
}
function setCommit(i) {
  const s = app.s, init = s.orders.initiative;
  if (!init) return;
  try { setInitiative(s, init.action, init.target, i); } catch (e) { app.errors.push(String(e.message)); }
  render();
}

function doEndTurn() {
  const s = app.s;
  busy(() => {
    endTurn(s);
    afterTurn();
    render();
    scrollTop();
    if (s.player) showBriefing();
  });
}

// Long AI computations: let the button state paint first.
function busy(fn) {
  document.body.style.cursor = 'progress';
  for (const b of document.querySelectorAll('#panel button.primary')) { b.disabled = true; b.textContent = 'Two weeks pass…'; }
  setTimeout(() => {
    const t0 = performance.now();
    try { fn(); } finally { app.metrics.lastTurnMs = Math.round(performance.now() - t0); document.body.style.cursor = ''; }
  }, 16);
}

export function autoStep() {
  const t0 = performance.now();
  autoTurn(app.s);
  app.metrics.lastTurnMs = Math.round(performance.now() - t0);
  afterTurn();
  render();
}

function onPanelClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled || b.classList.contains('disabled')) return;
  const { act, id } = b.dataset, ui = app.ui, s = app.s;
  switch (act) {
    case 'choose': { const sit = s.situations.find((x) => x.id === b.dataset.sit); const same = sit && sit.choice === b.dataset.opt; choose(s, b.dataset.sit, same ? null : b.dataset.opt); render(); break; }
    case 'why': if (ui.why.has(id)) ui.why.delete(id); else ui.why.add(id); render(); break;
    case 'more': if (ui.expanded.has(id)) ui.expanded.delete(id); else ui.expanded.add(id); render(); break;
    case 'prop': pickProposal(b.dataset.action, b.dataset.target === '' ? null : b.dataset.target); break;
    case 'toggleAll': ui.showAll = !ui.showAll; ui.action = null; render(); break;
    case 'cat': ui.cat = id; render(); break;
    case 'action': pickAction(id); break;
    case 'target': pickTarget(id === 'null' ? null : id); break;
    case 'commit': setCommit(+id); break;
    case 'noInit': clearInitiative(s); ui.action = null; render(); break;
    case 'endTurn': doEndTurn(); break;
    case 'briefing': showBriefing(); break;
    case 'showEnd': openModal(P.endHtml(s)); break;
  }
}

function onPanelKey(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const b = e.target.closest('[data-act="choose"]');
  if (b) { e.preventDefault(); b.click(); }
}

function onModalClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  if (act === 'pick') { app.ui.startPick = id; showStart(); }
  if (act === 'begin') startGame(id);
  if (act === 'closeModal') closeModal();
  if (act === 'newGame') showStart();
  if (act === 'continue') { closeModal(); if (app.s.phase === 'over') openModal(P.endHtml(app.s)); else { render(); scrollTop(); } }
}

function onTheaterClick(id) {
  const s = app.s, ui = app.ui;
  if (s.phase === 'turn' && ui.action && ui.targetable.has(id)) { ui.tab = 'command'; pickTarget(id); return; }
  if (ui.pop === id) { closePop(); return; }
  ui.selectedTheater = id;
  openPop(id);
}

function onTheaterHover(id, ev) {
  const tip = $('#tooltip');
  if (!id || app.ui.pop === id) { tip.hidden = true; return; }
  const t = app.s.theaters[id];
  const top = Object.entries(t.infl).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, v]) => `${P.esc(ACTOR_BY_ID[a].short)} ${Math.round(v)}`).join(' · ');
  const card = app.s.situations.find((x) => x.at === id);
  const n = (app.ui.hap[id] ?? []).length;
  tip.innerHTML = `<h4>${P.esc(document.querySelector(`[data-id="${id}"] .lbl`)?.textContent)}</h4><div>Tension <b class="mono">${Math.round(t.tension)}</b></div><div class="muted">${top}</div>${card ? `<div style="color:var(--amber)">${P.esc(card.title)}</div>` : ''}${n ? `<div class="muted">${n} ${n === 1 ? 'event' : 'events'} last fortnight · click for details</div>` : ''}${app.ui.targetable.has(id) ? '<div style="color:var(--amber)">Click to target</div>' : ''}`;
  const r = $('#mapwrap').getBoundingClientRect();
  tip.style.left = `${Math.min(ev.clientX - r.left + 14, r.width - 250)}px`;
  tip.style.top = `${ev.clientY - r.top + 14}px`;
  tip.hidden = false;
}

// ── boot ──
function boot() {
  window.addEventListener('error', (e) => app.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => app.errors.push(String(e.reason)));
  document.body.insertAdjacentHTML('afterbegin', iconSheet());
  app.map = createMap($('#map'), { onTheaterClick, onTheaterHover });
  $('#map').addEventListener('click', (e) => { if (!e.target.closest('.th')) closePop(); });
  $('#panel').addEventListener('click', onPanelClick);
  $('#panel').addEventListener('keydown', onPanelKey);
  $('#modal').addEventListener('click', onModalClick);
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { app.ui.tab = b.dataset.tab; render(); } });
  $('#btnHelp').addEventListener('click', () => openModal(P.helpHtml()));
  for (const b of document.querySelectorAll('[data-cam]')) b.addEventListener('click', () => { app.map.setCam(b.dataset.cam, app.s.player); if (app.ui.pop) renderPop(); });
  window.addEventListener('resize', () => { if (app.ui.pop) renderPop(); });

  const play = params.get('play');
  const seed = +(params.get('seed') ?? 1);
  app.s = newGame({ seed, player: play && play !== 'observer' ? play : 'us' });
  app.map.highlightHome(app.s.player);
  render();
  if (play) startGame(play === 'observer' ? null : play, seed);
  else showStart();
  if (params.get('cam')) app.map.setCam(params.get('cam'), app.s.player);
  if (params.has('dev')) installDev(app, { startGame, render, autoStep, showStart, afterTurn });
}

boot();
