// Turn controller. One player-facing phase per turn:
//   turn  – the director has dealt situation cards (crises, opportunities, an intelligence card) and
//           ranked initiatives; every other actor has already declared its move. The player answers
//           the cards, optionally picks one initiative, and ends the turn.
//   endTurn resolves the player's responses, then all declared moves in random initiative order (rolls
//   are hidden), runs upkeep and events, compiles a briefing of what mattered to the player, and deals
//   the next turn.
import { ACTORS, ACTOR_BY_ID } from '../data/actors.js';
import { EVENTS, EVENT_BY_ID, SCRIPTED, THRESHOLDS } from '../data/events.js';
import { ACTION_BY_ID, affordable, canUse, ACTIONS } from './actions.js';
import { createState, clamp, deriveWorld, W, res, alive, dateOf, infl, homeOf, rel } from './state.js';
import { resolve as resolveDecl, evaluate, band, payCost } from './adjudicate.js';
import { chooseAction, aiArguments, planArgs } from './ai.js';
import { goalScore, goalReport } from './goals.js';
import { generateSituations, resolveSituations, compileBriefing, snapshotFor, impactSince, chooseOptionAI, proposals, ordersTotal } from './director.js';
import { rand } from './rng.js';

// Victory means materially improving your position: reach VICTORY_FLOOR, gain VICTORY_GAIN points over
// your starting score, and fully meet at least half your objectives. Holding roughly steady is a draw.
export const VICTORY_FLOOR = 68, VICTORY_GAIN = 22, DRAW_SLACK = 5;
export function thresholds(s, id) {
  const start = Math.round(s.history[0]?.scores[id] ?? 0);
  const n = ACTOR_BY_ID[id].goals.length;
  return { start, victory: Math.min(95, Math.max(VICTORY_FLOOR, start + VICTORY_GAIN)), draw: start - DRAW_SLACK, metNeeded: Math.ceil(n / 2) };
}

const log = (s, kind, text, extra = {}) => s.log.push({ turn: s.turn, kind, text, ...extra });

export function newGame(opts = {}) {
  const s = createState(opts);
  log(s, 'brief', `${dateOf(1)} — The war with Iran is in its eighth month. Hormuz is choked, Brent is $${s.world.oil}, and Washington is weighing a new bombing campaign before the midterms.`);
  snapshot(s, 0);
  beginTurn(s, true);
  return s;
}

// ── turn start ──
export function beginTurn(s, first = false) {
  if (!first) s.turn += 1;
  s.declared = {}; s.argUsed = {}; s.orders = { initiative: null }; s.results = []; s.news = [];
  for (const id of alive(s)) {
    if (id === s.player) continue;
    const c = chooseAction(s, id);
    if (c) s.declared[id] = { actor: id, action: c.action, target: c.target, commit: c.commit, args: [] };
  }
  aiArguments(s, Object.values(s.declared), s.player); // AI actors argue among themselves; also computes stakes
  generateSituations(s);
  s.phase = 'turn';
}

// ── player orders ──
export function choose(s, sitId, optId) {
  const sit = s.situations.find((x) => x.id === sitId);
  if (!sit) throw new Error(`no situation ${sitId}`);
  if (optId != null && !sit.options.find((o) => o.id === optId)) throw new Error(`no option ${optId}`);
  sit.choice = optId;
}

export function setInitiative(s, action, target = null, commit = 0) {
  const p = s.player;
  const act = ACTION_BY_ID[action];
  if (!act || !canUse(act, p)) throw new Error(`${p} cannot use ${action}`);
  if (!affordable(s, p, act, commit)) throw new Error(`${p} cannot afford ${action}`);
  if (!act.targets(s, p).includes(target)) throw new Error(`bad target ${target} for ${action}`);
  s.orders.initiative = { action, target, commit };
}
export function clearInitiative(s) { s.orders.initiative = null; }

// The full catalogue, for the "all orders" list.
export function playerMenu(s) {
  const a = s.player;
  return ACTIONS.filter((act) => canUse(act, a) && act.id !== 'hold').map((act) => ({
    id: act.id, name: act.name, cat: act.cat, desc: act.desc, target: act.target, cost: act.cost,
    targets: act.targets(s, a), affordable: affordable(s, a, act, 0),
  }));
}

// Odds for an initiative, including the opposition and support it is expected to meet.
export function previewInitiative(s, action, target = null, commit = 0) {
  const p = s.player;
  const decl = { actor: p, action, target, commit, args: [] };
  const planned = planArgs(s, [decl], p, false);
  const ev = evaluate(s, p, action, target, commit, planned);
  return { ...ev, args: planned.map((a) => ({ by: a.by, stance: a.stance })) };
}
export const preview = previewInitiative;
export { proposals, ordersTotal };

// ── turn end ──
function shuffle(s, arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand(s) * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

export function endTurn(s) {
  if (s.phase !== 'turn') return;
  const p = s.player;
  const pdef = p ? ACTOR_BY_ID[p] : null;
  const scoreBefore = p ? goalScore(pdef, s) : 0;
  const worldBefore = { ...s.world };
  s.results = []; s.news = [];
  // 1. The player's responses to the situation cards.
  const mine = p ? resolveSituations(s) : [];
  // 2. The player's initiative joins the declarations.
  if (p && !s.actors[p].collapsed) {
    const init = s.orders.initiative ?? { action: 'hold', target: null, commit: 0 };
    const act = ACTION_BY_ID[init.action];
    if (act.targets(s, p).includes(init.target) && affordable(s, p, act, init.commit)) {
      s.declared[p] = { actor: p, ...init, args: [] };
      planArgs(s, [s.declared[p]], p, true);
    } else {
      mine.push({ kind: 'action', actor: p, action: init.action, target: init.target, outcome: 'fizzle', ok: false, p: 0, roll: 0, text: `${act.name} could no longer be carried out: resources were spent on the crises of the fortnight.`, impact: null });
    }
  }
  // 3. Resolve every declaration in random initiative order.
  const others = [];
  for (const d of shuffle(s, Object.values(s.declared))) {
    if (s.actors[d.actor].collapsed) continue;
    const act = ACTION_BY_ID[d.action];
    if (!act.targets(s, d.actor).includes(d.target) || !affordable(s, d.actor, act, d.commit)) {
      const r = { kind: 'action', actor: d.actor, action: d.action, target: d.target, outcome: 'fizzle', ok: false, p: 0, roll: 0, text: `${ACTOR_BY_ID[d.actor].name}'s plan (${act.name}) was overtaken by events.`, impact: null };
      (d.actor === p ? mine : others).push(r); s.results.push(r);
      continue;
    }
    payCost(s, d.actor, d.action, d.commit);
    const before = p ? snapshotFor(s, p) : null;
    const r = resolveDecl(s, d);
    r.impact = p ? impactSince(s, p, before) : null;
    (d.actor === p ? mine : others).push(r);
    s.results.push(r);
    s.recent.push({ turn: s.turn, kind: 'action', actor: d.actor, action: d.action, target: d.target, ok: r.ok, outcome: r.outcome, text: r.text });
    log(s, r.ok ? 'success' : 'fail', r.text, { actor: d.actor, p: r.p, roll: r.roll });
  }
  // 4. Upkeep, events, collapse, end checks.
  upkeep(s);
  checkEnd(s);
  snapshot(s);
  s.briefing = compileBriefing(s, mine, others, s.news, scoreBefore, worldBefore);
  s.recent = s.recent.filter((r) => r.turn >= s.turn - 4);
  if (s.outcome) s.phase = 'over';
  else beginTurn(s);
}

// Play the current turn with the AI in the player's seat (autoplay / dev step()).
export function autoTurn(s) {
  if (s.phase !== 'turn') return;
  const p = s.player;
  if (p && !s.actors[p].collapsed) {
    for (const sit of s.situations) sit.choice = chooseOptionAI(s, p, sit);
    const c = chooseAction(s, p);
    if (c && c.action !== 'hold') { try { setInitiative(s, c.action, c.target, c.commit); } catch { /* leave as hold */ } }
  }
  endTurn(s);
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
  // Gaza: reconstruction only advances under a durable ceasefire with international presence.
  W(s, 'humanitarian', w.gazaCeasefire < 40 ? -3 : w.gazaCeasefire >= 60 && w.isfDeployed >= 30 ? 1 : -1);
  if (s.actors.pij.military > 12 && !s.actors.pij.collapsed) W(s, 'gazaCeasefire', -1);
  // ISIS thrives on chaos.
  if (s.theaters.badiya.tension + s.theaters.neSyria.tension > 110 || s.actors.sdf.stability < 40) W(s, 'isisStrength', 1);
  if ((s.theaters.neSyria.infl.us || 0) >= 15) W(s, 'isisStrength', -1);
  // Unfinished business: tracks revert unless the underlying problem is dealt with.
  if (w.hamasDisarm < 30 && w.gazaCeasefire > 30) W(s, 'gazaCeasefire', -2);
  if (s.actors.hamas.military >= 20 && !s.actors.hamas.collapsed) W(s, 'hamasDisarm', -1);
  if (s.actors.hezbollah.military >= 35 && !s.actors.hezbollah.collapsed) W(s, 'hezbollahDisarm', -1);
  if (w.westBankAnnex >= 35 || w.humanitarian < 35) W(s, 'normalization', -1);
  if (s.actors.iran.stability >= 40 && w.iranSanctions < 70 && !s.actors.iran.collapsed) W(s, 'iranNuclear', 1);
  if (s.actors.houthis.military >= 35 && rel(s, 'houthis', 'saudi') < 0 && !s.actors.houthis.collapsed) W(s, 'yemenWar', 2);
  if (s.actors.isis.military >= 18 && !s.actors.isis.collapsed) W(s, 'isisStrength', 1);
  if (w.kurdishAutonomy > 50 && s.actors.turkey.military >= 50) W(s, 'kurdishAutonomy', -1);
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
      s.flags[`collapsed:${a.id}`] = s.turn;
      for (const t of Object.values(s.theaters)) if (t.infl[a.id]) infl(s, t.id, a.id, -Math.ceil(t.infl[a.id] / 2));
      const text = `${ACTOR_BY_ID[a.id].name} has collapsed.`;
      log(s, 'collapse', text);
      s.news.push({ id: 'collapse', text, at: ACTOR_BY_ID[a.id].home, impact: null });
      s.recent.push({ turn: s.turn, kind: 'event', id: 'collapse', at: ACTOR_BY_ID[a.id].home, text });
    }
  }
}

export function fireEvent(s, e) {
  const p = s.player;
  const text = typeof e.text === 'function' ? e.text(s) : e.text;
  const before = p ? snapshotFor(s, p) : null;
  e.apply(s);
  deriveWorld(s);
  const impact = p ? impactSince(s, p, before) : null;
  s.news.push({ id: e.id, text, at: e.at, impact });
  s.recent.push({ turn: s.turn, kind: 'event', id: e.id, at: e.at, text });
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
  if (s.turn >= 6 && rep.every((g) => g.met)) { s.outcome = { result: 'victory', decisive: true, reason: 'Every strategic objective achieved.' }; return; }
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
  s.history.push({ turn, date: dateOf(turn + 1), world: { ...s.world }, scores: scores(s), progress: s.player ? ACTOR_BY_ID[s.player].goals.map((g) => +g.progress(s).toFixed(3)) : null });
}

export { band, dateOf };
