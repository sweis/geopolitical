// Dev hooks (enabled with ?dev=1). Exposed as window.game. Mapping of the generic hook set to a
// turn-based map game:
//   teleport(spot|x,y)   → centre the map camera on a theater id, anchor id, or map coordinate
//   freeze/step/resume   → autoplay control; step(n) plays n full turns synchronously (AI plays your seat)
//   setTimeOfDay(h)      → not applicable (no lighting); returns false. Use setTurn(n) to jump in time.
//   setSeed(n)           → restart the current scenario with seed n (all randomness is seeded)
//   spawn(kind, at)      → fire an event by id (see EVENTS) or 'crisis' (+30 tension) at a theater
//   clearAll()           → zero all theater tension, clear arcs, news and ticker
//   win()/lose()         → force the outcome
//   cam(name)            → named cameras: overview, levant, gulf, hero-close, hud-check
//   getState()           → JSON snapshot for assertions
// Scripted play through the same engine calls the UI uses: choose(situationId, optionId),
// order(action, target, commit), clearOrder(), endTurn(), preview(action, target, commit), proposals().
import { ACTORS } from '../data/actors.js';
import { EVENTS } from '../data/events.js';
import { THEATERS } from '../data/theaters.js';
import { spawnEvent, forceOutcome, scores, choose, setInitiative, clearInitiative, endTurn, previewInitiative, proposals, ordersTotal, thresholds } from '../engine/game.js';
import { goalReport } from '../engine/goals.js';
import { ACTOR_BY_ID } from '../data/actors.js';
import { tension } from '../engine/state.js';
import { drawArcs, flash } from '../ui/mapView.js';

export function installDev(app, { startGame, render, autoStep, showStart, afterTurn }) {
  const params = new URLSearchParams(location.search);
  const autodt = +(params.get('autodt') ?? 1200);
  let timer = null;
  const frame = { last: performance.now(), ms: 0, frames: 0 };

  const rendererString = (() => {
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no-webgl (SVG renderer)';
    } catch { return 'unknown'; }
  })();

  const game = {
    getState() {
      const s = app.s;
      const b = s.briefing;
      return {
        seed: s.seed, turn: s.turn, maxTurns: s.maxTurns, phase: s.phase, player: s.player, outcome: s.outcome,
        world: { ...s.world }, flags: { ...s.flags },
        actors: Object.fromEntries(Object.values(s.actors).map((a) => [a.id, { ...a }])),
        scores: scores(s),
        goals: s.player ? goalReport(ACTOR_BY_ID[s.player], s) : null,
        thresholds: s.player ? thresholds(s, s.player) : null,
        theaters: Object.fromEntries(Object.values(s.theaters).map((t) => [t.id, { tension: t.tension, infl: { ...t.infl } }])),
        declared: Object.values(s.declared).map((d) => ({ actor: d.actor, action: d.action, target: d.target, commit: d.commit, args: d.args.length })),
        situations: s.situations.map((x) => ({ id: x.id, kind: x.kind, title: x.title, at: x.at, choice: x.choice, options: x.options.map((o) => ({ id: o.id, label: o.label, p: o.p, band: o.band, cost: o.cost, affordable: o.affordable, default: o.default })) })),
        orders: { ...s.orders, total: s.player ? ordersTotal(s) : null },
        briefing: b ? { turn: b.turn, mine: b.mine.length, affecting: b.affecting.length, elsewhere: b.elsewhere.length, events: b.events.length, scoreBefore: b.scoreBefore, scoreAfter: b.scoreAfter, mineOutcomes: b.mine.map((r) => ({ kind: r.kind, id: r.id ?? r.action, option: r.option ?? r.target, outcome: r.outcome, roll: r.roll })) } : null,
        results: s.results.map((r) => ({ actor: r.actor, action: r.action, target: r.target, p: r.p, roll: r.roll, outcome: r.outcome })),
        news: s.news.map((n) => n.id), logLength: s.log.length, historyLength: s.history.length, recentLength: s.recent.length,
        ui: { tab: app.ui.tab, action: app.ui.action, target: app.ui.target, commit: app.ui.commit, cam: app.map.cam, modalOpen: !document.getElementById('modal').hidden, overlay: app.ui.overlay },
        perf: { frameMs: +frame.ms.toFixed(2), lastTurnMs: app.metrics.lastTurnMs, renders: app.metrics.renders, domNodes: document.getElementsByTagName('*').length, svgNodes: document.querySelectorAll('#map *').length, drawCalls: null, shaderPrograms: null, renderer: rendererString, contextLost: false },
        errors: [...app.errors], autoplay: !!timer, simTime: s.history.length - 1,
      };
    },
    start(actor = 'us', seed = app.s.seed) { startGame(actor === 'observer' ? null : actor, seed); return game.getState().player; },
    setSeed(n) { startGame(app.s.player, n); return n; },
    teleport(x, y) { return app.map.teleport(typeof x === 'string' ? x : [x, y]); },
    cam(name) { return app.map.setCam(name, app.s.player); },
    freeze() { clearInterval(timer); timer = null; return true; },
    resume() { if (!timer) timer = setInterval(() => { if (app.s.phase === 'over') game.freeze(); else autoStep(); }, autodt); return true; },
    step(n = 1) { for (let i = 0; i < n && app.s.phase !== 'over'; i++) autoStep(); return app.s.turn; },
    setTurn(n) { while (app.s.turn < n && app.s.phase !== 'over') autoStep(); return app.s.turn; },
    setTimeOfDay() { return false; },
    spawn(kind, at) {
      const s = app.s;
      if (kind === 'crisis') { tension(s, at, 30); s.news.push({ id: 'crisis', text: `Crisis erupts in ${at}.`, at }); }
      else spawnEvent(s, kind);
      if (at || s.news.at(-1)?.at) flash(app.map, at ?? s.news.at(-1).at);
      render(); return true;
    },
    clearAll() { for (const t of Object.values(app.s.theaters)) t.tension = 0; app.s.news = []; drawArcs(app.map, [], app.s.player); render(); return true; },
    win() { forceOutcome(app.s, 'victory'); render(); return app.s.outcome; },
    lose() { forceOutcome(app.s, 'defeat'); render(); return app.s.outcome; },
    choose(sit, opt) { choose(app.s, sit, opt); render(); return true; },
    order(action, target = null, commit = 0) { setInitiative(app.s, action, target, commit); render(); return app.s.orders.initiative; },
    clearOrder() { clearInitiative(app.s); render(); return true; },
    endTurn() { endTurn(app.s); afterTurn?.(); render(); return app.s.turn; },
    preview(action, target = null, commit = 0) { return previewInitiative(app.s, action, target, commit); },
    proposals() { return proposals(app.s); },
    showStart,
    registry: { actors: ACTORS.map((a) => a.id), theaters: THEATERS.map((t) => t.id), events: EVENTS.map((e) => e.id), cams: ['overview', 'levant', 'gulf', 'hero-close', 'hud-check'] },
  };
  window.game = game;
  if (params.has('auto')) game.resume();

  // Diagnostics overlay (works on phones: small, fixed, pointer-events none).
  const diag = document.getElementById('diag');
  diag.hidden = false;
  const tick = (now) => {
    const dt = now - frame.last; frame.last = now;
    frame.ms = frame.ms ? frame.ms * 0.9 + dt * 0.1 : dt; frame.frames++;
    if (frame.frames % 15 === 0) {
      const st = game.getState();
      diag.textContent = `frame ${st.perf.frameMs.toFixed(1)}ms  turn-compute ${st.perf.lastTurnMs}ms\nDOM ${st.perf.domNodes}  SVG ${st.perf.svgNodes}  renders ${st.perf.renders}\nGPU ${st.perf.renderer}\nseed ${st.seed}  T${st.turn} ${st.phase}  cam ${st.ui.cam}${timer ? '  AUTO' : ''}\nerrors ${st.errors.length}${st.errors.length ? ': ' + st.errors.at(-1) : ''}`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return game;
}
