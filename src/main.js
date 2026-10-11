// App controller: owns the game state and UI state, wires DOM events to engine calls, renders.
import { ACTOR_BY_ID } from './data/actors.js';
import { ACTION_BY_ID } from './engine/actions.js';
import { newGame, declare, openDebate, argue, resolveTurn, nextTurn, autoTurn } from './engine/game.js';
import { createMap, renderMap, drawArcs, flash } from './ui/mapView.js';
import * as P from './ui/panels.js';
import { installDev } from './dev/dev.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

export const app = {
  s: null,
  ui: { tab: 'command', cat: 'all', action: null, target: undefined, commit: 0, selectedTheater: null, targetable: new Set(), startPick: 'us' },
  metrics: { lastTurnMs: 0, renders: 0 },
  errors: [],
  map: null,
};

function resetUi() {
  Object.assign(app.ui, { action: null, target: undefined, commit: 0, targetable: new Set() });
}

export function startGame(player, seed = +(params.get('seed') ?? Date.now() % 100000)) {
  app.s = newGame({ seed, player });
  resetUi();
  app.ui.tab = 'command';
  app.map.highlightHome(player);
  drawArcs(app.map, [], player);
  closeModal();
  render();
}

// ── rendering ──
export function render() {
  const s = app.s, ui = app.ui;
  app.metrics.renders++;
  $('#clock').textContent = P.clockHtml(s);
  $('#indicators').innerHTML = P.indicatorsHtml(s);
  $('#actorCard').innerHTML = P.actorCardHtml(s);
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === ui.tab);
  const panel = $('#panel');
  const scroll = panel.scrollTop;
  panel.innerHTML = ui.tab === 'command' ? P.commandHtml(s, ui) : ui.tab === 'goals' ? P.goalsHtml(s) : ui.tab === 'intel' ? P.intelHtml(s, ui) : P.logHtml(s);
  panel.scrollTop = scroll;
  ui.targetable = new Set();
  if (s.phase === 'declare' && ui.action && ACTION_BY_ID[ui.action].target === 'theater')
    for (const t of ACTION_BY_ID[ui.action].targets(s, s.player)) ui.targetable.add(t);
  renderMap(app.map, s, ui);
  const latest = s.news.at(-1)?.text ?? s.log.at(-1)?.text ?? '';
  $('#tickerText').textContent = latest;
}

function openModal(html) { const m = $('#modal'); m.innerHTML = html; m.hidden = false; m.scrollTop = 0; }
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
export function showStart() { openModal(P.startHtml(newGame({ seed: 1, player: null }), app.ui.startPick)); }

// ── actions ──
function pickAction(id) {
  const s = app.s;
  app.ui.action = id; app.ui.commit = 0;
  const t = ACTION_BY_ID[id].targets(s, s.player);
  app.ui.target = t.length === 1 ? t[0] : undefined;
  render();
  $('#panel').scrollTop = 0;
}

function doDeclare() {
  const s = app.s, ui = app.ui;
  declare(s, s.player, ui.action, ui.target, ui.commit);
  busy(() => { openDebate(s); render(); });
}

function doResolve() {
  const s = app.s;
  busy(() => {
    resolveTurn(s);
    drawArcs(app.map, s.results, s.player);
    for (const n of s.news) if (n.at) flash(app.map, n.at);
    render();
    $('#panel').scrollTop = 0;
  });
}

function doNext() {
  nextTurn(app.s);
  resetUi();
  drawArcs(app.map, [], app.s.player);
  render();
  $('#panel').scrollTop = 0;
}

// Long AI computations: let the button state paint first.
function busy(fn) {
  document.body.style.cursor = 'progress';
  for (const b of document.querySelectorAll('#panel button.primary')) { b.disabled = true; b.textContent = 'Adjudicating…'; }
  setTimeout(() => {
    const t0 = performance.now();
    try { fn(); } finally { app.metrics.lastTurnMs = Math.round(performance.now() - t0); document.body.style.cursor = ''; }
  }, 16);
}

export function autoStep() {
  const t0 = performance.now();
  autoTurn(app.s);
  app.metrics.lastTurnMs = Math.round(performance.now() - t0);
  drawArcs(app.map, app.s.results, app.s.player);
  render();
}

function onPanelClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const { act, id } = b.dataset, ui = app.ui, s = app.s;
  switch (act) {
    case 'cat': ui.cat = id; render(); break;
    case 'action': pickAction(id); break;
    case 'target': ui.target = id === 'null' ? null : id; if (ACTION_BY_ID[ui.action].target === 'theater') ui.selectedTheater = id; render(); break;
    case 'commit': ui.commit = +id; render(); break;
    case 'declare': doDeclare(); break;
    case 'argue': argue(s, id, +b.dataset.stance); render(); break;
    case 'resolve': doResolve(); break;
    case 'next': doNext(); break;
    case 'showEnd': openModal(P.endHtml(s)); break;
  }
}

function onModalClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  if (act === 'pick') { app.ui.startPick = id; showStart(); }
  if (act === 'begin') startGame(id);
  if (act === 'closeModal') closeModal();
  if (act === 'newGame') showStart();
}

function onTheaterClick(id) {
  const s = app.s, ui = app.ui;
  if (s.phase === 'declare' && ui.targetable.has(id)) { ui.target = id; ui.selectedTheater = id; ui.tab = 'command'; }
  else { ui.selectedTheater = id; ui.tab = 'intel'; }
  render();
}

function onTheaterHover(id, ev) {
  const tip = $('#tooltip');
  if (!id) { tip.hidden = true; return; }
  const t = app.s.theaters[id];
  const top = Object.entries(t.infl).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, v]) => `${P.esc(ACTOR_BY_ID[a].short)} ${Math.round(v)}`).join(' · ');
  tip.innerHTML = `<h4>${P.esc(app.map.nodes[id] && document.querySelector(`[data-id="${id}"] .lbl`)?.textContent)}</h4><div>Tension <b class="mono">${Math.round(t.tension)}</b></div><div class="muted">${top}</div>${app.ui.targetable.has(id) ? '<div style="color:var(--amber)">Click to target</div>' : ''}`;
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
  $('#modal').addEventListener('click', onModalClick);
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { app.ui.tab = b.dataset.tab; render(); } });
  $('#btnHelp').addEventListener('click', () => openModal(P.helpHtml()));
  for (const b of document.querySelectorAll('[data-cam]')) b.addEventListener('click', () => app.map.setCam(b.dataset.cam, app.s.player));

  const play = params.get('play');
  const seed = +(params.get('seed') ?? 1);
  app.s = newGame({ seed, player: play && play !== 'observer' ? play : 'us' });
  render();
  if (play) startGame(play === 'observer' ? null : play, seed);
  else showStart();
  if (params.get('cam')) app.map.setCam(params.get('cam'), app.s.player);
  if (params.has('dev')) installDev(app, { startGame, render, autoStep, showStart });
}

boot();
