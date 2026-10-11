// Simulated play on cloned states. Two uses:
//   - policy improvement: each actor tries each of its top candidates in short rollouts in which everyone
//     else plays their own mixed strategy, then re-weights the candidates by where they led (softmax);
//   - forecasts: many games played to the end from the current board (with the player's orders, holding,
//     or with the AI in the player's seat), summarized as score bands, outcome odds and recurring end states.
// Rollouts draw their randomness from seeds derived from the state, so the main game stays replayable and
// the same board with the same orders always yields the same forecast.
import { ACTION_BY_ID, affordable } from './actions.js';
import { simClone, alive, hitBy } from './state.js';
import { resolve as resolveDecl, payCost } from './adjudicate.js';
import { rand } from './rng.js';
import { utility, rootPlan, fastPolicy, AI_CONFIG } from './ai.js';
import { FORCE } from './consequences.js';
import { upkeep, checkEnd, thresholds } from './game.js';
import { generateSituations, resolveSituations, chooseOptionAI, clearLive, goalDirs } from './director.js';
import { goalScore } from './goals.js';
import { ACTORS, ACTOR_BY_ID } from '../data/actors.js';
const ACTOR_INDEX = Object.fromEntries(ACTORS.map((a, i) => [a.id, i]));

// A deterministic seed from the state's RNG position, the turn and a label.
export function derivedSeed(s, label) {
  let h = (s.rng ^ 0x9e3779b9) | 0;
  for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) | 0;
  return (h ^ Math.imul(s.turn, 7919)) | 0;
}

// Common random numbers: a rollout reseeds its RNG at fixed points of every turn from (crn, turn), so
// two rollouts that differ in one move still see the same opponents' draws, rolls and events wherever
// their boards agree. Comparisons between candidates (and between your orders and holding) get far
// less noisy than the rollout count suggests.
const mix = (a, b) => { let h = Math.imul(a ^ 0x85ebca6b, 0xcc9e2d51) ^ Math.imul(b + 0x9e3779b9, 0x1b873593); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return h | 0; };
const reseed = (c, salt) => { if (c.crn != null) c.rng = mix(mix(c.crn, c.turn), salt); };

export function rolloutClone(s, tag, seed) {
  const c = simClone(s);
  c.simTag = tag; c.rng = seed | 0; c.crn = seed | 0;
  c.recent = [...s.recent]; c.history = [...s.history]; c.fatigue = { ...(s.fatigue || {}) }; c.cool = { ...s.cool };
  c.situations = s.situations.map((x) => ({ ...x }));
  c.declared = {}; c.orders = { initiative: s.orders?.initiative ? { ...s.orders.initiative } : null };
  c.log = []; c.news = []; c.results = []; c.briefing = null; c.outcome = s.outcome ?? null;
  c.rolled = [];
  return c;
}

const HOLD = { action: 'hold', target: null, commit: 0 };

// Sample a move from a mixed strategy (weighted list); fall back to the first still-valid entry, then hold.
export function sampleFrom(c, a, policy) {
  if (!policy?.length) return HOLD;
  let r = rand(c) * policy.reduce((n, x) => n + x.w, 0);
  let pick = policy[policy.length - 1];
  for (const x of policy) { r -= x.w; if (r <= 0) { pick = x; break; } }
  const ok = (x) => { const act = ACTION_BY_ID[x.action]; return act && act.targets(c, a).includes(x.target) && affordable(c, a, act, x.commit); };
  if (ok(pick)) return pick;
  for (const x of policy) if (ok(x)) return x;
  return HOLD;
}

function shuffle(c, arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand(c) * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

// One simulated turn. `plan` = { turn, policies, model } from ai.rootPlan (policies possibly improved).
//   player:   'orders' – the player's current card answers and initiative (first turn of a forecast);
//             'hold'   – the dealt cards take their defaults and no initiative;
//             'ai'     – the AI plays the seat (deals cards when `cards`, else ignores them).
//   force:    { actor, move } fixes one actor's move this turn (policy improvement).
//   adaptive: on turns after the plan's, 'all' re-scores every actor's moves on the current board;
//             'reactive' does so only for the forced actor and actors hit last turn (cheaper).
export function rolloutTurn(c, plan, { player = 'ai', cards = true, force = null, adaptive = 'all' } = {}) {
  const p = c.player;
  const used = new Set();
  const root = c.turn === plan.turn;
  const policyFor = (id) => {
    if (root) return plan.policies[id];
    if (adaptive === 'all' || (adaptive === 'reactive' && (id === force?.actor || hitBy(c, id, 1).length))) return fastPolicy(c, id, plan.model[id]);
    return plan.policies[id];
  };
  reseed(c, 1);
  if (p && !c.actors[p].collapsed) {
    if (player === 'ai') {
      if (cards) { if (!c.situations.length) generateSituations(c); for (const sit of c.situations) sit.choice = chooseOptionAI(c, p, sit); }
      else c.situations = [];
    } else if (player === 'hold') for (const sit of c.situations) sit.choice = null;
    if (c.situations.length) {
      const mine = resolveSituations(c);
      for (const r of mine) if (r.kind === 'situation' && r.action && FORCE.has(r.action)) used.add(p);
    }
  }
  const decls = [];
  for (const id of alive(c)) {
    let mv;
    reseed(c, 100 + ACTOR_INDEX[id]);
    if (force && force.actor === id && root) mv = force.move;
    else if (id === p && player === 'orders') mv = c.orders.initiative ?? HOLD;
    else if (id === p && player === 'hold') mv = HOLD;
    else mv = sampleFrom(c, id, policyFor(id));
    decls.push({ actor: id, action: mv.action, target: mv.target, commit: mv.commit ?? 0, args: [] });
  }
  reseed(c, 2);
  shuffle(c, decls);
  for (const d of decls) {
    if (c.actors[d.actor].collapsed) continue;
    const act = ACTION_BY_ID[d.action];
    if (!act || !act.targets(c, d.actor).includes(d.target) || !affordable(c, d.actor, act, d.commit)) continue;
    payCost(c, d.actor, d.action, d.commit);
    reseed(c, 200 + ACTOR_INDEX[d.actor]);
    const r = resolveDecl(c, d);
    c.recent.push({ turn: c.turn, kind: 'action', actor: d.actor, action: d.action, target: d.target, ok: r.ok, outcome: r.outcome, text: r.text });
    if (FORCE.has(d.action)) used.add(d.actor);
  }
  for (const id of Object.keys(c.actors)) c.fatigue[id] = used.has(id) ? (c.fatigue[id] || 0) + 1 : Math.max(0, (c.fatigue[id] || 0) - 1);
  reseed(c, 3);
  upkeep(c);
  checkEnd(c);
  const sc = p ? goalScore(ACTOR_BY_ID[p], c) : 0;
  c.history.push({ turn: c.turn, scores: p ? { [p]: sc } : {}, world: { ...c.world }, progress: p ? ACTOR_BY_ID[p].goals.map((g) => +g.progress(c).toFixed(3)) : null });
  c.rolled.push({ turn: c.turn, score: sc });
  c.recent = c.recent.filter((r) => r.turn >= c.turn - 4);
  if (!c.outcome) { c.turn += 1; c.declared = {}; c.orders = { initiative: null }; c.situations = []; }
}

// Policy improvement by rollout. For each actor and each candidate, play `rollouts` short games in which
// the candidate is forced this turn and everyone (the player included) otherwise samples from the plan's
// strategies (adapting after being hit); re-weight the candidates by the utility they led to.
// Returns the improved policies (the plan is not modified).
// With `anchor` > 0 the rollout result only adjusts the one-ply gain (ev + anchor × (value − mean
// value), softmax at the root temperature); with anchor 0 the rollout values are used alone.
export function improvePolicies(s, plan, { rollouts = AI_CONFIG.rollouts, horizon = AI_CONFIG.horizon, iterations = AI_CONFIG.iterations, temperature = AI_CONFIG.rolloutTemperature, anchor = AI_CONFIG.anchor, clamp = AI_CONFIG.clamp } = {}) {
  if (!rollouts) return plan.policies;
  let cur = plan.policies;
  for (let it = 0; it < iterations; it++) {
    const curPlan = { ...plan, policies: cur };
    const out = {};
    for (const [id, pol] of Object.entries(cur)) {
      if (pol.length < 2) { out[id] = pol; continue; }
      const vals = pol.map((x, i) => {
        let sum = 0;
        for (let m = 0; m < rollouts; m++) {
          const c = rolloutClone(s, `imp|${it}|${id}|${i}|${m}`, derivedSeed(s, `imp|${it}|${id}|${m}`));
          const force = { actor: id, move: x };
          rolloutTurn(c, curPlan, { cards: false, force, adaptive: 'reactive' });
          for (let h = 1; h < horizon && !c.outcome; h++) rolloutTurn(c, curPlan, { cards: false, force, adaptive: 'reactive' });
          sum += utility(c, id);
        }
        return sum / rollouts;
      });
      let w;
      if (anchor > 0) {
        const mean = vals.reduce((n, v) => n + v, 0) / vals.length;
        const adj = pol.map((x, i) => x.ev + anchor * Math.max(-clamp, Math.min(clamp, vals[i] - mean)));
        const best = Math.max(...adj);
        w = adj.map((v) => Math.exp((v - best) / AI_CONFIG.temperature));
      } else {
        const best = Math.max(...vals);
        w = vals.map((v) => Math.exp((v - best) / temperature));
      }
      const z = w.reduce((n, x) => n + x, 0);
      out[id] = pol.map((x, i) => ({ ...x, value: +vals[i].toFixed(2), w: w[i] / z }));
    }
    cur = out;
  }
  return cur;
}

// ── forecasts ──
// Recurring end states. `key`/`dir` say which track the state is about and in which direction, so the UI
// can color each one by whether it serves the player's objectives.
export const END_STATES = [
  { id: 'deal', label: 'US–Iran deal in force', test: (c) => !!c.flags.memorandum2, key: 'warIntensity', dir: -1 },
  { id: 'bomb', label: 'Iran tests a bomb', test: (c) => !!c.flags.iranBomb, key: 'iranNuclear', dir: 1 },
  { id: 'contained', label: 'Iran program contained', test: (c) => c.world.iranNuclear <= 25 && !c.flags.iranBomb, key: 'iranNuclear', dir: -1 },
  { id: 'hotWar', label: 'Iran war still hot', test: (c) => c.world.warIntensity >= 60, key: 'warIntensity', dir: 1 },
  { id: 'coldWar', label: 'Iran war wound down', test: (c) => c.world.warIntensity < 35, key: 'warIntensity', dir: -1 },
  { id: 'hormuzOpen', label: 'Hormuz open', test: (c) => c.world.hormuz >= 70, key: 'hormuz', dir: 1 },
  { id: 'hormuzShut', label: 'Hormuz shut', test: (c) => c.world.hormuz < 40, key: 'hormuz', dir: -1 },
  { id: 'oilHigh', label: 'Brent above $100', test: (c) => c.world.oil > 100, key: 'oil', dir: 1 },
  { id: 'oilLow', label: 'Brent below $85', test: (c) => c.world.oil < 85, key: 'oil', dir: -1 },
  { id: 'gazaHolds', label: 'Gaza truce holds', test: (c) => c.world.gazaCeasefire >= 60, key: 'gazaCeasefire', dir: 1 },
  { id: 'gazaWar', label: 'Gaza war resumes', test: (c) => c.world.gazaCeasefire <= 25, key: 'gazaCeasefire', dir: -1 },
  { id: 'hezbDisarm', label: 'Hezbollah disarming', test: (c) => c.world.hezbollahDisarm >= 50, key: 'hezbollahDisarm', dir: 1 },
  { id: 'usSupportGone', label: 'US war support collapses', test: (c) => c.world.usWarSupport < 25, key: 'usWarSupport', dir: -1 },
  { id: 'iranCollapse', label: 'Iranian regime collapses', test: (c) => c.actors.iran.collapsed || c.actors.iran.stability < 15, key: null, dir: 0, actor: 'iran' },
  { id: 'isis', label: 'ISIS resurgent', test: (c) => c.world.isisStrength >= 60, key: 'isisStrength', dir: 1 },
  { id: 'yemenTruce', label: 'Yemen truce', test: (c) => c.world.yemenWar <= 20, key: 'yemenWar', dir: -1 },
  { id: 'normalize', label: 'Saudi–Israel normalization', test: (c) => c.world.normalization >= 50, key: 'normalization', dir: 1 },
  { id: 'kurdsLose', label: 'Kurdish autonomy ends', test: (c) => c.world.kurdishAutonomy <= 20, key: 'kurdishAutonomy', dir: -1 },
  { id: 'meCollapse', label: 'Your collapse', test: (c) => !!c.player && c.actors[c.player].collapsed, key: null, dir: 0, bad: true },
];

// Compact record of one finished rollout.
function recordRun(c) {
  const p = c.player;
  const def = p ? ACTOR_BY_ID[p] : null;
  const ends = {};
  for (const f of END_STATES) { try { if (f.test(c)) ends[f.id] = true; } catch { /* content error: skip */ } }
  const winners = {};
  for (const id of Object.keys(c.actors)) if (!c.actors[id].collapsed) winners[id] = goalScore(ACTOR_BY_ID[id], c) >= thresholds(c, id).victory;
  return {
    scores: c.rolled.map((x) => x.score), outcome: c.outcome?.result ?? null, decisive: !!c.outcome?.decisive, ends, winners,
    world: { ...c.world }, goals: def ? def.goals.map((g) => ({ v: g.get(c), p: g.progress(c) })) : [], endTurn: c.turn,
  };
}

// A forecast plays `n` games from the state, one per step() so the UI can time-slice it. `player` is the
// first turn's mode ('orders' | 'hold' | 'ai'); later turns are always played by the AI with cards dealt.
export function createForecast(s, plan, { n = 24, horizon = Infinity, player = 'orders', tag = 'fc' } = {}) {
  const H = Math.max(1, Math.min(horizon, s.maxTurns - s.turn + 1));
  const runs = [];
  const fc = {
    n, horizon: H, player, done: 0, runs, plan,
    step() {
      if (fc.done >= n) return false;
      const k = fc.done;
      const t = `${tag}|${player}|${k}`;
      // The seed is shared across player modes, so "your orders" and "holding" are paired comparisons.
      const c = rolloutClone(s, t, derivedSeed(s, `${tag}|${k}`));
      rolloutTurn(c, plan, { player, cards: true });
      for (let h = 1; h < H && !c.outcome; h++) rolloutTurn(c, plan, { player: 'ai', cards: true });
      runs.push(recordRun(c));
      clearLive(t);
      fc.done++;
      return fc.done < n;
    },
    run() { while (fc.step()); return fc.summary(); },
    summary() { return summarize(s, fc); },
  };
  return fc;
}

const quantile = (arr, q) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); const i = (a.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };
const q5 = (vals) => ({ p10: quantile(vals, 0.1), p25: quantile(vals, 0.25), p50: quantile(vals, 0.5), p75: quantile(vals, 0.75), p90: quantile(vals, 0.9) });
const r1 = (x) => +x.toFixed(1);
const r5 = (q) => ({ p10: r1(q.p10), p25: r1(q.p25), p50: r1(q.p50), p75: r1(q.p75), p90: r1(q.p90) });

export function summarize(s, fc) {
  const runs = fc.runs;
  if (!runs.length) return null;
  const p = s.player, def = p ? ACTOR_BY_ID[p] : null;
  const H = fc.horizon, N = runs.length;
  const now = p ? goalScore(def, s) : 0;
  const bands = [{ turn: s.turn - 1, p10: now, p25: now, p50: now, p75: now, p90: now }];
  for (let h = 0; h < H; h++) {
    const vals = runs.map((r) => r.scores[Math.min(h, r.scores.length - 1)]);
    bands.push({ turn: s.turn + h, ...q5(vals) });
  }
  const fin = q5(runs.map((r) => r.scores.at(-1)));
  const count = (f) => runs.filter(f).length / N;
  const outcome = { victory: count((r) => r.outcome === 'victory'), draw: count((r) => r.outcome === 'draw'), defeat: count((r) => r.outcome === 'defeat'), decisive: count((r) => r.decisive), complete: count((r) => !!r.outcome) };
  const dirs = p ? goalDirs(p) : {};
  const ends = END_STATES.map((f) => {
    const pr = count((r) => r.ends[f.id]);
    const good = f.bad ? -1 : f.key && dirs[f.key] ? Math.sign(dirs[f.key] * f.dir) : 0;
    return { id: f.id, label: f.label, p: pr, good };
  }).filter((f) => f.p > 0).sort((a, b) => b.p - a.p);
  const winners = Object.keys(s.actors).map((id) => ({ id, p: count((r) => r.winners[id]) })).filter((w) => w.p > 0).sort((a, b) => b.p - a.p);
  const goals = def ? def.goals.map((g, i) => ({ name: g.name, unit: g.unit, dir: g.dir, thr: g.thr, now: r1(g.get(s)), progressNow: r1(g.progress(s)), value: r5(q5(runs.map((r) => r.goals[i].v))), progress: r5(q5(runs.map((r) => r.goals[i].p))), met: count((r) => r.goals[i].p >= 1) })) : [];
  const means = {};
  for (const k of Object.keys(runs[0].world)) means[k] = r1(runs.reduce((n, r) => n + r.world[k], 0) / N);
  return {
    n: N, horizon: H, endTurn: s.turn + H - 1, player: fc.player, turn: s.turn,
    bands: bands.map((b) => ({ turn: b.turn, ...r5(b) })),
    final: { ...r5(fin), spread: r1(fin.p90 - fin.p10) },
    outcome, ends, winners, goals, means, thresholds: p ? thresholds(s, p) : null,
  };
}

// The plan for the current board: what beginTurn stored, or a fresh one.
export function planOf(s) {
  return s.model && s.policies && Object.keys(s.policies).length ? { turn: s.turn, policies: s.policies, model: s.model } : rootPlan(s);
}
// Convenience: a complete forecast, synchronously (tests, dev hooks, sims).
export function forecast(s, opts = {}) {
  return createForecast(s, opts.plan ?? planOf(s), opts).run();
}
