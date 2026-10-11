// App controller: owns the game state and UI state, wires DOM events to engine calls, renders.
import { ACTOR_BY_ID } from './data/actors.js';
import { ACTION_BY_ID } from './engine/actions.js';
import { newGame, choose, setInitiative, clearInitiative, endTurn, autoTurn, proposals } from './engine/game.js';
import { isRelevant } from './engine/director.js';
import { createMap, renderMap, drawArcs, flash } from './ui/mapView.js';
import * as P from './ui/panels.js';
import { installDev } from './dev/dev.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

export const app = {
  s: null,
  ui: { tab: 'command', cat: 'all', action: null, target: undefined, commit: 0, selectedTheater: null, targetable: new Set(), startPick: 'us', showAll: false, why: new Set(), proposals: null, overlay: null },
  metrics: { lastTurnMs: 0, renders: 0 },
  errors: [],
  map: null,
};

function resetTurnUi() {
  Object.assign(app.ui, { action: null, target: undefined, commit: 0, targetable: new Set(), showAll: false, why: new Set(), proposals: null });
}

export function startGame(player, seed = +(params.get('seed') ?? Date.now() % 100000)) {
  app.s = newGame({ seed, player });
  resetTurnUi();
  app.ui.tab = 'command';
  app.ui.overlay = null;
  app.map.highlightHome(player);
  drawArcs(app.map, [], player);
  closeModal();
  render();
}

// ── rendering ──
export function render() {
  const s = app.s, ui = app.ui;
  app.metrics.renders++;
  if (s.player && s.phase === 'turn' && (!ui.proposals || ui.proposals.turn !== s.turn || ui.proposals.seed !== s.seed)) ui.proposals = { turn: s.turn, seed: s.seed, list: proposals(s) };
  $('#clock').textContent = P.clockHtml(s);
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
  renderMap(app.map, s, { ...ui, target: init && s.theaters[init.target] ? init.target : undefined, cards: s.situations.map((x) => x.at).filter(Boolean) });
  const latest = s.news.at(-1)?.text ?? s.log.at(-1)?.text ?? '';
  $('#tickerText').textContent = latest;
}

function openModal(html) { const m = $('#modal'); m.innerHTML = html; m.hidden = false; m.scrollTop = 0; }
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; app.ui.overlay = null; }
export function showStart() { openModal(P.startHtml(newGame({ seed: 1, player: null }), app.ui.startPick)); }
function showBriefing() { app.ui.overlay = 'briefing'; openModal(P.briefingHtml(app.s)); }

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

function afterTurn() {
  const s = app.s;
  const relevant = new Set((s.briefing?.affecting ?? []).map((r) => r.actor));
  drawArcs(app.map, s.results, s.player, relevant);
  for (const n of s.news) if (n.at) flash(app.map, n.at);
  resetTurnUi();
}

function doEndTurn() {
  const s = app.s;
  busy(() => {
    endTurn(s);
    afterTurn();
    render();
    $('#panel').scrollTop = 0;
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
  if (act === 'continue') { closeModal(); if (app.s.phase === 'over') openModal(P.endHtml(app.s)); else { render(); $('#panel').scrollTop = 0; } }
}

function onTheaterClick(id) {
  const s = app.s, ui = app.ui;
  if (s.phase === 'turn' && ui.action && ui.targetable.has(id)) { ui.tab = 'command'; pickTarget(id); return; }
  ui.selectedTheater = id; ui.tab = 'intel';
  render();
}

function onTheaterHover(id, ev) {
  const tip = $('#tooltip');
  if (!id) { tip.hidden = true; return; }
  const t = app.s.theaters[id];
  const top = Object.entries(t.infl).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, v]) => `${P.esc(ACTOR_BY_ID[a].short)} ${Math.round(v)}`).join(' · ');
  const card = app.s.situations.find((x) => x.at === id);
  tip.innerHTML = `<h4>${P.esc(document.querySelector(`[data-id="${id}"] .lbl`)?.textContent)}</h4><div>Tension <b class="mono">${Math.round(t.tension)}</b></div><div class="muted">${top}</div>${card ? `<div style="color:var(--amber)">${P.esc(card.title)}</div>` : ''}${app.ui.targetable.has(id) ? '<div style="color:var(--amber)">Click to target</div>' : ''}`;
  const r = $('#mapwrap').getBoundingClientRect();
  tip.style.left = `${Math.min(ev.clientX - r.left + 14, r.width - 250)}px`;
  tip.style.top = `${ev.clientY - r.top + 14}px`;
  tip.hidden = false;
}

// ── boot ──
function boot() {
  window.addEventListener('error', (e) => app.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => app.errors.push(String(e.reason)));
  app.map = createMap($('#map'), { onTheaterClick, onTheaterHover });
  $('#panel').addEventListener('click', onPanelClick);
  $('#panel').addEventListener('keydown', onPanelKey);
  $('#modal').addEventListener('click', onModalClick);
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { app.ui.tab = b.dataset.tab; render(); } });
  $('#btnHelp').addEventListener('click', () => openModal(P.helpHtml()));
  for (const b of document.querySelectorAll('[data-cam]')) b.addEventListener('click', () => app.map.setCam(b.dataset.cam, app.s.player));

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
