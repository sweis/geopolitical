// Turn controller. Phases per turn (matrix-game order):
//   declare  – the player picks an action, target and commitment; the GM shows the odds and reasons.
//   debate   – every other actor declares; actors argue for/against each declaration; the player
//              may argue on the declarations that touch their goals.
//   results  – declarations resolve in random initiative order, then upkeep, events and end checks.
import { ACTORS, ACTOR_BY_ID } from '../data/actors.js';
import { EVENTS, EVENT_BY_ID, SCRIPTED, THRESHOLDS } from '../data/events.js';
import { ACTION_BY_ID, affordable, canUse, ACTIONS } from './actions.js';
import { createState, clamp, deriveWorld, W, res, alive, dateOf, infl } from './state.js';
import { resolve as resolveDecl, evaluate, band, payCost } from './adjudicate.js';
import { chooseAction, aiArguments, argWeight, reserved, ARGUE_THRESHOLD } from './ai.js';
import { goalScore, goalReport } from './goals.js';
import { rand } from './rng.js';

// Victory means materially improving your position: reach VICTORY_FLOOR, gain VICTORY_GAIN points over
// your starting score, and fully meet at least half your objectives. Holding roughly steady is a draw.
export const VICTORY_FLOOR = 60, VICTORY_GAIN = 15, DRAW_SLACK = 5;
export function thresholds(s, id) {
  const start = Math.round(s.history[0]?.scores[id] ?? 0);
  const n = ACTOR_BY_ID[id].goals.length;
  return { start, victory: Math.min(95, Math.max(VICTORY_FLOOR, start + VICTORY_GAIN)), draw: start - DRAW_SLACK, metNeeded: Math.ceil(n / 2) };
}

export function newGame(opts = {}) {
  const s = createState(opts);
  s.log.push({ turn: 1, kind: 'brief', text: `${dateOf(1)} — The war with Iran is in its eighth month. Hormuz is choked, Brent is $${s.world.oil}, and Washington is weighing a new bombing campaign before the midterms.` });
  snapshot(s, 0);
  return s;
}

const log = (s, kind, text, extra = {}) => s.log.push({ turn: s.turn, kind, text, ...extra });

// ── declare ──
export function playerMenu(s) {
  const a = s.player;
  return ACTIONS.filter((act) => canUse(act, a)).map((act) => ({
    id: act.id, name: act.name, cat: act.cat, desc: act.desc, target: act.target, cost: act.cost,
    targets: act.targets(s, a), affordable: affordable(s, a, act, 0),
  }));
}

export function declare(s, actor, action, target, commit = 0) {
  const act = ACTION_BY_ID[action];
  if (!act || !canUse(act, actor)) throw new Error(`${actor} cannot use ${action}`);
  if (!affordable(s, actor, act, commit)) throw new Error(`${actor} cannot afford ${action}`);
  const t = act.targets(s, actor);
  if (!t.includes(target)) throw new Error(`bad target ${target} for ${action}`);
  s.declared[actor] = { actor, action, target, commit, args: [] };
}

// ── debate ──
export function openDebate(s) {
  for (const id of alive(s)) {
    if (s.declared[id]) continue;
    const c = chooseAction(s, id);
    if (c) s.declared[id] = { actor: id, action: c.action, target: c.target, commit: c.commit, args: [] };
  }
  const decls = Object.values(s.declared);
  aiArguments(s, decls, s.player);
  s.debate = [];
  if (s.player && !s.actors[s.player].collapsed) {
    for (const d of decls) {
      if (d.actor === s.player) continue;
      const delta = d.stakes?.[s.player] ?? 0;
      if (Math.abs(delta) >= ARGUE_THRESHOLD) s.debate.push({ actor: d.actor, delta: +delta.toFixed(2), choice: 0 });
    }
    s.debate.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    s.debate = s.debate.slice(0, 5);
  }
  s.phase = 'debate';
}

// stance: +1 support, -1 oppose, 0 abstain. Costs 1 political capital.
export function argue(s, actorOfDecl, stance) {
  const item = s.debate.find((x) => x.actor === actorOfDecl);
  const d = s.declared[actorOfDecl];
  if (!item || !d) throw new Error('no such debate item');
  const me = s.actors[s.player];
  if (item.choice !== 0) { d.args = d.args.filter((x) => x.by !== s.player); me.political += 1; item.choice = 0; }
  if (stance === 0) return;
  if (me.political - reserved(s, s.player) < 1) throw new Error('no spare political capital');
  me.political -= 1;
  item.choice = stance;
  d.args.push({ by: s.player, stance, d: stance * argWeight(s.player), text: `${ACTOR_BY_ID[s.player].name} ${stance > 0 ? 'backs the move' : 'argues against it'}`, player: true });
}

export function preview(s, actor, action, target, commit = 0) {
  return evaluate(s, actor, action, target, commit, s.declared[actor]?.args ?? []);
}

// ── results ──
export function resolveTurn(s) {
  if (s.phase !== 'debate') openDebate(s);
  const order = Object.values(s.declared);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand(s) * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  s.results = [];
  for (const d of order) {
    if (s.actors[d.actor].collapsed) continue;
    const act = ACTION_BY_ID[d.action];
    // State may have shifted since declaration; fizzle if the target is no longer valid or unaffordable.
    if (!act.targets(s, d.actor).includes(d.target) || !affordable(s, d.actor, act, d.commit)) {
      s.results.push({ actor: d.actor, action: d.action, target: d.target, outcome: 'fizzle', ok: false, p: 0, roll: 0, text: `${ACTOR_BY_ID[d.actor].name}'s plan (${act.name}) was overtaken by events.` });
      continue;
    }
    payCost(s, d.actor, d.action, d.commit); // cost is paid at resolution
    const r = resolveDecl(s, d);
    s.results.push(r);
    log(s, r.ok ? 'success' : 'fail', r.text, { actor: d.actor, p: r.p, roll: r.roll });
  }
  upkeep(s);
  checkEnd(s);
  snapshot(s);
  s.phase = s.outcome ? 'over' : 'results';
}

export function nextTurn(s) {
  if (s.phase === 'over') return;
  s.turn += 1;
  s.declared = {}; s.debate = []; s.results = []; s.news = [];
  s.phase = 'declare';
}

// Run one full turn with the AI also playing the player's seat (autoplay / dev step()).
export function autoTurn(s) {
  if (s.phase === 'over') return;
  if (s.phase === 'results') nextTurn(s);
  if (s.phase === 'declare' && s.player && !s.declared[s.player] && !s.actors[s.player].collapsed) {
    const c = chooseAction(s, s.player);
    if (c) declare(s, s.player, c.action, c.target, c.commit);
  }
  if (s.phase === 'declare') openDebate(s);
  resolveTurn(s);
}

// ── upkeep ──
function upkeep(s) {
  const w = s.world;
  for (const def of ACTORS) {
    const a = s.actors[def.id];
    if (a.collapsed) continue;
    a.money = Math.round((a.money + def.income.money * (0.5 + a.stability / 200)) * 10) / 10;
    // Forces regenerate toward their starting strength; growth beyond it takes deliberate action.
    if (a.military < def.start.military) a.military = Math.min(def.start.military, a.military + def.income.military);
    a.political = Math.min(20, a.political + def.income.political);
    if (def.kind === 'nonstate' && a.stability < 30) a.stability += 1; // insurgent resilience
    if (a.stability > 50) a.stability -= a.stability > 70 ? 2 : 1; // cohesion erodes without upkeep
    if (def.home && s.theaters[def.home].tension >= 65) a.stability -= 1; // war at home
  }
  // Oil shock and chokepoint economics.
  if (w.oil >= 100) { res(s, 'eu', { stability: -1 }); res(s, 'china', { money: -2 }); res(s, 'turkey', { stability: -1 }); res(s, 'egypt', { stability: -1 }); W(s, 'usWarSupport', -1); res(s, 'saudi', { money: 3 }); res(s, 'russia', { money: 3 }); }
  if (w.oil <= 80) { res(s, 'eu', { stability: 1 }); res(s, 'russia', { money: -2 }); W(s, 'usWarSupport', 1); }
  if (w.hormuz < 40) { res(s, 'saudi', { money: -2 }); res(s, 'china', { stability: -1 }); }
  if (w.redSea < 40) { res(s, 'egypt', { money: -2, stability: -1 }); }
  if (w.iranSanctions >= 80 && w.warIntensity >= 50) res(s, 'iran', { stability: -1 });
  // Chokepoints: while the war is hot, whoever holds the coast caps traffic. Escorts can push
  // traffic up to the cap; above it, traffic bleeds back. Degrade the coastal force or end the war.
  const capH = w.warIntensity >= 40 ? 100 - 0.8 * (s.theaters.hormuz.infl.iran || 0) : 100;
  if (w.hormuz > capH) W(s, 'hormuz', -Math.min(6, w.hormuz - capH));
  const capR = w.yemenWar >= 30 || w.gazaCeasefire < 50 ? 100 - 0.8 * (s.theaters.babElMandeb.infl.houthis || 0) : 100;
  if (w.redSea > capR) W(s, 'redSea', -Math.min(6, w.redSea - capR));
  s.flags.capHormuz = Math.round(capH); s.flags.capRedSea = Math.round(capR);
  // Gaza.
  // Reconstruction only advances under a durable ceasefire with international presence.
  W(s, 'humanitarian', w.gazaCeasefire < 40 ? -3 : w.gazaCeasefire >= 60 && w.isfDeployed >= 30 ? 1 : -1);
  if (s.actors.pij.military > 12 && !s.actors.pij.collapsed) W(s, 'gazaCeasefire', -1);
  // ISIS thrives on chaos.
  if (s.theaters.badiya.tension + s.theaters.neSyria.tension > 110 || s.actors.sdf.stability < 40) W(s, 'isisStrength', 1);
  if ((s.theaters.neSyria.infl.us || 0) >= 15) W(s, 'isisStrength', -1);
  // Drift.
  W(s, 'warIntensity', -1); W(s, 'yemenWar', -1);
  if (w.oilAdj > 0) W(s, 'oilAdj', -1); else if (w.oilAdj < 0) W(s, 'oilAdj', 1);
  W(s, 'usWarSupport', w.warIntensity >= 50 ? -1 : 1);
  res(s, 'us', { stability: (w.usWarSupport - 40) / 20 });
  if (w.hezbollahDisarm >= 50) res(s, 'lebanon', { stability: 1 });
  for (const t of Object.values(s.theaters)) t.tension = t.tension > 20 ? t.tension - 3 : t.tension;
  deriveWorld(s);
  // Scripted and random events.
  const scripted = SCRIPTED[s.turn];
  if (scripted) fireEvent(s, scripted);
  if (rand(s) < 0.45) {
    const pool = EVENTS.filter((e) => e.cond(s));
    let r = rand(s) * pool.reduce((n, e) => n + e.weight, 0);
    for (const e of pool) { r -= e.weight; if (r <= 0) { fireEvent(s, e); break; } }
  }
  for (const th of THRESHOLDS) if (!s.flags[th.id] && th.when(s)) { s.flags[th.id] = true; fireEvent(s, th); }
  deriveWorld(s);
  // Collapse.
  for (const a of Object.values(s.actors)) {
    if (!a.collapsed && a.stability <= 0) {
      a.collapsed = true;
      for (const t of Object.values(s.theaters)) if (t.infl[a.id]) infl(s, t.id, a.id, -Math.ceil(t.infl[a.id] / 2));
      log(s, 'collapse', `${ACTOR_BY_ID[a.id].name} has collapsed.`);
      s.news.push({ id: 'collapse', text: `${ACTOR_BY_ID[a.id].name} has collapsed.`, at: ACTOR_BY_ID[a.id].home });
    }
  }
}

export function fireEvent(s, e) {
  const text = typeof e.text === 'function' ? e.text(s) : e.text;
  e.apply(s);
  deriveWorld(s);
  s.news.push({ id: e.id, text, at: e.at });
  log(s, 'event', text);
}
export const spawnEvent = (s, id) => fireEvent(s, EVENT_BY_ID[id] ?? THRESHOLDS.find((t) => t.id === id) ?? SCRIPTED[id]);

// ── end ──
export function scores(s) {
  return Object.fromEntries(ACTORS.map((a) => [a.id, +goalScore(a, s).toFixed(1)]));
}

function checkEnd(s) {
  const p = s.player;
  if (!p) { if (s.turn >= s.maxTurns) s.outcome = { result: 'complete', reason: 'Simulation complete.' }; return; }
  const me = s.actors[p];
  if (me.collapsed) { s.outcome = { result: 'defeat', reason: `${ACTOR_BY_ID[p].name} has collapsed.` }; return; }
  const rep = goalReport(ACTOR_BY_ID[p], s);
  if (s.turn >= 3 && rep.every((g) => g.met)) { s.outcome = { result: 'victory', decisive: true, reason: 'Every strategic objective achieved.' }; return; }
  if (s.turn >= s.maxTurns) {
    const sc = goalScore(ACTOR_BY_ID[p], s);
    const th = thresholds(s, p);
    const met = rep.filter((g) => g.met).length;
    const tally = `${met} of ${rep.length} objectives fully met`;
    s.outcome = sc >= th.victory && met >= th.metNeeded ? { result: 'victory', reason: `Score ${sc.toFixed(0)} (needed ${th.victory}); ${tally}.` }
      : sc >= th.draw ? { result: 'draw', reason: `Muddling through: score ${sc.toFixed(0)}, ${tally}. Victory needed ${th.victory} and ${th.metNeeded} objectives.` }
      : { result: 'defeat', reason: `Your position deteriorated: score ${sc.toFixed(0)} (started at ${th.start}); ${tally}.` };
  }
}

export function forceOutcome(s, result) {
  s.outcome = { result, reason: `Forced by dev hook (${result}).` };
  s.phase = 'over';
}

function snapshot(s, turn = s.turn) {
  s.history.push({ turn, date: dateOf(turn + 1), world: { ...s.world }, scores: scores(s) });
}

export { band, dateOf };
