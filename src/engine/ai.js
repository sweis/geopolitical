// Non-player actors. Each one scores every affordable (action, target, commit) by expected change in
// its own utility, using one-ply lookahead on a cloned state, then samples with a softmax.
// The same lookahead drives the debate: actors argue for actions that help them and against those that hurt.
import { ACTIONS, ACTION_BY_ID, canUse, affordable, COMMIT, costOf, blocked } from './actions.js';
import { isOp, simulateOp } from './ops.js';
import { ACTOR_BY_ID } from '../data/actors.js';
import { goalScore } from './goals.js';
import { simClone as clone } from './state.js';
import { evaluate, payCost, applyOutcome, clampP } from './adjudicate.js';
import { rand, pick } from './rng.js';
import { hitBy, homeOf, rel, alive } from './state.js';

// Search settings. rollouts=0 is the one-ply AI (fast: sims and tests); the browser enables rollouts so
// each actor tests its top candidates a few turns ahead against everyone else's policies.
// k: candidates per actor; rollouts × horizon: simulated games per candidate and their length;
// temperature: softmax over one-ply gains; rolloutTemperature: softmax over rollout utilities (a wider
// scale, since those include everyone's replies); iterations: re-run with the improved opponents' policies.
// anchor/clamp: rollout results adjust the one-ply gain by anchor × (value − mean), the difference clamped
// to ±clamp utility points, so a few chaotic rollouts nudge a strategy rather than hijack it.
export const AI_CONFIG = { k: 4, rollouts: 0, horizon: 2, iterations: 1, temperature: 0.6, rolloutTemperature: 1.5, anchor: 0.25, clamp: 4, modelSize: 10 };
export function setAIConfig(o) { Object.assign(AI_CONFIG, o); return AI_CONFIG; }
const GRUDGE_BONUS = 2.5;
export const ARGUE_THRESHOLD = 1.0;
const MAX_ARGS_PER_ACTOR = 2;
const MAX_SIDE_PER_DECL = 3;

// Goal score plus a small value on holding resources, so actors do not burn everything on marginal moves.
export function utility(s, id) {
  const a = s.actors[id];
  if (a.collapsed) return -50;
  return goalScore(ACTOR_BY_ID[id], s) + 0.04 * Math.min(a.money, 60) + 0.05 * a.military + 0.25 * Math.min(a.political, 12) + 0.08 * a.stability;
}

export function candidates(s, a) {
  const out = [];
  for (const act of ACTIONS) {
    if (!canUse(act, a)) continue;
    for (const target of act.targets(s, a)) {
      if (blocked(s, a, act, target)) continue;
      for (let c = 0; c < COMMIT.length; c++) if (affordable(s, a, act, c)) out.push({ action: act.id, target, commit: c });
    }
  }
  return out;
}

// The state after an action's outcome: instant actions apply at once, operations as if they went to plan.
export function outcomeState(s, a, actionId, target, commit, outcome) {
  const c = clone(s);
  payCost(c, a, actionId, commit);
  if (isOp(ACTION_BY_ID[actionId])) simulateOp(c, a, actionId, target, commit, outcome);
  else applyOutcome(c, a, actionId, target, outcome);
  return c;
}
// Operations pay off later and tie forces up meanwhile: discount by duration, and charge for the lock.
const OP_DISCOUNT = 0.92;
export const discountOf = (act) => (isOp(act) ? OP_DISCOUNT ** (act.duration ?? 1) : 1);
export const lockCostOf = (act) => (isOp(act) && act.lock ? 0.03 * act.lock * Math.min(6, (act.duration ?? 1) + 2) : 0);

export function expectedGain(s, a, cand, base = utility(s, a)) {
  const act = ACTION_BY_ID[cand.action];
  const { p } = evaluate(s, a, cand.action, cand.target, cand.commit);
  const win = outcomeState(s, a, cand.action, cand.target, cand.commit, 'success');
  const lose = outcomeState(s, a, cand.action, cand.target, cand.commit, 'fail');
  return discountOf(act) * (p * utility(win, a) + (1 - p) * utility(lose, a) - base) - lockCostOf(act);
}

// A rival's operation under way that would hurt this actor makes hitting its site worth more:
// strike the dash before it completes, the staging area before the campaign.
function opThreatBonus(s, a, c) {
  const act = ACTION_BY_ID[c.action];
  if (act.cat !== 'military' && act.cat !== 'covert') return 0;
  let bonus = 0;
  for (const op of s.ops) {
    if (op.status !== 'preparing' || op.actor === a || !op.stakes) continue;
    const harm = -(op.stakes[a] ?? 0);
    if (harm < 1.5 || rel(s, a, op.actor) > -40) continue;
    if (c.target === op.at || c.target === op.actor) bonus = Math.max(bonus, Math.min(4, harm));
  }
  return bonus;
}

// Actors who hit this one last turn. Retaliation gets a bonus so consequences follow the player around.
export function grudges(s, a) {
  return [...new Set(hitBy(s, a, 1).map((r) => r.actor))];
}
function grudgeBonus(s, a, c) {
  const act = ACTION_BY_ID[c.action];
  // Lesson of Libya: a regime whose nuclear sites were just bombed is likelier to dash for the bomb.
  if (a === 'iran' && c.action === 'nuclearDash' && hitBy(s, a, 1).some((r) => r.target === 'nuclearSites' || r.target === 'tehran')) return 3;
  if (act.cat !== 'military' && act.cat !== 'covert') return 0;
  // Solidarity: partners of a struck actor (relations >= 60) lean toward hitting the attacker too.
  for (const id of Object.keys(s.actors)) {
    if (id === a || rel(s, a, id) < 60) continue;
    for (const g of grudges(s, id)) {
      if (g === a) continue;
      const t = s.theaters[c.target];
      if (c.target === g || (t && (homeOf(g) === c.target || (t.infl[g] || 0) >= 30))) return GRUDGE_BONUS * 0.6;
    }
  }
  for (const g of grudges(s, a)) {
    if (c.target === g) return GRUDGE_BONUS;
    const t = s.theaters[c.target];
    if (t && (homeOf(g) === c.target || (t.infl[g] || 0) >= 30)) return GRUDGE_BONUS;
  }
  return 0;
}

// Flags set by situations bend AI behaviour: a restrained ally, a truce, an open channel.
function flagBias(s, a, c) {
  const act = ACTION_BY_ID[c.action];
  const hostile = act.cat === 'military' || act.cat === 'covert';
  if (!hostile) return 0;
  let bias = 0;
  if (a === 'israel' && s.flags.israel_restrained >= s.turn - 2 && ['tehran', 'nuclearSites'].includes(c.target)) bias -= 4;
  const t = s.theaters[c.target];
  for (const [k, v] of Object.entries(s.flags)) {
    if (typeof v !== 'number' || v < s.turn - 3) continue;
    const m = /^(truce|talks):([^:]+):([^:]+)$/.exec(k);
    if (!m) continue;
    const other = m[2] === a ? m[3] : m[3] === a ? m[2] : null;
    if (!other) continue;
    if (c.target === other || (t && (homeOf(other) === c.target || (t.infl[other] || 0) >= 30))) bias -= m[1] === 'truce' ? 3 : 2;
  }
  return bias;
}

// Balance of threat: when the player is running away with the game, hostile actors turn on them.
function leaderBias(s, a, c) {
  const p = s.player;
  if (!p || p === a || s.actors[p].collapsed) return 0;
  const lead = goalScore(ACTOR_BY_ID[p], s) - 65;
  if (lead <= 0 || rel(s, a, p) > -30) return 0;
  const act = ACTION_BY_ID[c.action];
  if (act.cat !== 'military' && act.cat !== 'covert' && act.cat !== 'economic') return 0;
  const t = s.theaters[c.target];
  const hits = c.target === p || (t && (homeOf(p) === c.target || (t.infl[p] || 0) >= 25));
  return hits ? Math.min(4, lead / 6) : 0;
}

// ── one-ply scoring that records what each move does, so rollouts can re-score moves on later boards ──
const RES4 = ['money', 'military', 'political', 'stability'];
// Sparse difference between two states in everything utilities and goals read.
export function diffOf(s, after) {
  const world = {}, actors = {}, infl = {}, relD = {};
  for (const k in s.world) { const d = after.world[k] - s.world[k]; if (d) world[k] = d; }
  for (const id in s.actors) {
    const a = s.actors[id], b = after.actors[id]; let o = null;
    for (const k of RES4) { const d = b[k] - a[k]; if (d) (o ??= {})[k] = d; }
    if (b.collapsed !== a.collapsed) (o ??= {}).collapsed = b.collapsed;
    if (o) actors[id] = o;
  }
  for (const t in s.theaters) {
    const a = s.theaters[t].infl, b = after.theaters[t].infl; let o = null;
    for (const id in b) { const d = (b[id] || 0) - (a[id] || 0); if (d) (o ??= {})[id] = d; }
    for (const id in a) if (!(id in b) && a[id]) (o ??= {})[id] = -a[id];
    if (o) infl[t] = o;
  }
  for (const k in after.rel) { const d = (after.rel[k] || 0) - (s.rel[k] || 0); if (d) relD[k] = d; }
  return { world, actors, infl, rel: relD };
}
// What each actor's utility reads beyond world tracks and its own resources: influence maps and
// relations only when one of its goals does (read off the getters' source once).
const NEEDS = {};
function needsOf(id) {
  if (!NEEDS[id]) {
    let infl = false, relN = false, others = false;
    for (const g of ACTOR_BY_ID[id].goals) { const src = g.get.toString(); if (src.includes('theaters')) infl = true; if (src.includes('rel(')) relN = true; if (g.get.actor && g.get.actor !== id) others = true; if (!g.get.world && !g.get.actor && !g.get.theater && src.includes('actors')) others = true; }
    NEEDS[id] = { infl, rel: relN, others };
  }
  return NEEDS[id];
}
// A cheap read-only view of `s` with a diff applied (plus an extra cost for the actor), for utility().
// Only the parts the actor's utility reads are overlaid.
export function overlay(s, diff, id, extra = null) {
  const need = needsOf(id);
  const world = { ...s.world }; for (const k in diff.world) world[k] += diff.world[k];
  const actors = { ...s.actors };
  const own = diff.actors[id];
  if (own || extra) { const o = { ...s.actors[id] }; if (own) for (const k in own) o[k] = k === 'collapsed' ? own[k] : o[k] + own[k]; if (extra) { o.money -= extra.money || 0; o.military -= extra.military || 0; o.political -= extra.political || 0; } actors[id] = o; }
  if (need.others) for (const aid in diff.actors) { if (aid === id) continue; const o = { ...s.actors[aid] }, d = diff.actors[aid]; for (const k in d) o[k] = k === 'collapsed' ? d[k] : o[k] + d[k]; actors[aid] = o; }
  let theaters = s.theaters;
  if (need.infl) for (const t in diff.infl) { if (theaters === s.theaters) theaters = { ...s.theaters }; const d = diff.infl[t], io = { ...s.theaters[t].infl }; for (const k in d) io[k] = (io[k] || 0) + d[k]; theaters[t] = { ...s.theaters[t], infl: io }; }
  let relm = s.rel;
  if (need.rel) for (const k in diff.rel) { if (relm === s.rel) relm = { ...s.rel }; relm[k] = (relm[k] || 0) + diff.rel[k]; }
  return { world, actors, theaters, rel: relm, flags: s.flags, turn: s.turn, player: s.player };
}
const NO_DIFF = { world: {}, actors: {}, infl: {}, rel: {} };
const HOLD_ENTRY = { action: 'hold', target: null, commit: 0, cat: 'domestic', win: NO_DIFF, lose: NO_DIFF, extra: null };

// Every affordable (action, target) scored by one-ply lookahead at commit 0; the higher commitment
// levels are scored in closed form from the same two outcomes (their extra cost and odds bonus).
export function scoreCandidates(s, a) {
  const base = utility(s, a);
  const out = [];
  for (const act of ACTIONS) {
    if (!canUse(act, a) || !affordable(s, a, act, 0)) continue;
    const cost0 = costOf(act, 0);
    const disc = discountOf(act), opp = lockCostOf(act);
    for (const target of act.targets(s, a)) {
      if (blocked(s, a, act, target)) continue;
      const c0 = { action: act.id, target, commit: 0 };
      const { p } = evaluate(s, a, act.id, target, 0);
      const win = outcomeState(s, a, act.id, target, 0, 'success');
      const lose = outcomeState(s, a, act.id, target, 0, 'fail');
      const uw = utility(win, a), ul = utility(lose, a);
      const bias = grudgeBonus(s, a, c0) + flagBias(s, a, c0) + leaderBias(s, a, c0) + opThreatBonus(s, a, c0);
      const dw = diffOf(s, win), dl = diffOf(s, lose);
      out.push({ action: act.id, target, commit: 0, cost: cost0, p, ev: disc * (p * uw + (1 - p) * ul - base) - opp + bias, win: dw, lose: dl, extra: null, cat: act.cat, disc, opp });
      for (let k = 1; k < COMMIT.length; k++) {
        if (!affordable(s, a, act, k)) continue;
        const ck = costOf(act, k);
        const extra = { money: ck.money - cost0.money, military: ck.military - cost0.military, political: ck.political - cost0.political };
        const pk = clampP(p + COMMIT[k].bonus);
        const ev = disc * (pk * utility(overlay(s, dw, a, extra), a) + (1 - pk) * utility(overlay(s, dl, a, extra), a) - base) - opp + bias;
        out.push({ action: act.id, target, commit: k, cost: ck, p: pk, ev, win: dw, lose: dl, extra, cat: act.cat, disc, opp });
      }
    }
  }
  return out;
}
const byEv = (x, y) => y.ev - x.ev;
// One entry per (action, target): the best commitment level. Commit variants of one move are not
// distinct strategies, and keeping them would crowd out real alternatives.
function dedupe(sorted) {
  const seen = new Set();
  return sorted.filter((c) => { const key = `${c.action}|${c.target}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
export function softmax(top, temperature) {
  if (!top.length) return [];
  const wts = top.map((c) => Math.exp((c.ev - top[0].ev) / temperature));
  const z = wts.reduce((n, w) => n + w, 0);
  return top.map((c, i) => ({ action: c.action, target: c.target, commit: c.commit, ev: +c.ev.toFixed(2), w: wts[i] / z }));
}

// Top-k candidates with softmax weights: the actor's mixed strategy before any lookahead.
export function rootPolicy(s, a, k = AI_CONFIG.k, scored = scoreCandidates(s, a)) {
  return softmax(dedupe([...scored].sort(byEv)).slice(0, k), AI_CONFIG.temperature);
}

// The rollout model: the actor's best moves (plus the best of each category, and holding) with their
// recorded effects, re-scored against whatever board a rollout reaches.
function rolloutModel(scored, n = AI_CONFIG.modelSize) {
  const sorted = dedupe([...scored].sort(byEv));
  const out = sorted.slice(0, n);
  for (const cat of ['military', 'diplomatic', 'economic', 'covert', 'domestic']) { const best = sorted.find((c) => c.cat === cat); if (best && !out.includes(best)) out.push(best); }
  return out.map((c) => ({ action: c.action, target: c.target, commit: c.commit, cat: c.cat, win: c.win, lose: c.lose, extra: c.extra, disc: c.disc, opp: c.opp })).concat([HOLD_ENTRY]);
}

// Everyone's mixed strategy and rollout model for this board.
export function rootPlan(s, k = AI_CONFIG.k) {
  const policies = {}, model = {};
  for (const id of alive(s)) { const scored = scoreCandidates(s, id); policies[id] = rootPolicy(s, id, k, scored); model[id] = rolloutModel(scored); }
  return { turn: s.turn, policies, model };
}

// A policy for a later board, from the recorded model: each move's effects are applied to the current
// board in a cheap overlay (no cloning), with current odds, grudges and flags. Validity of targets is
// left to the sampler. This is what makes simulated actors adapt as the game moves on.
export function fastPolicy(c, a, entries, k = AI_CONFIG.k) {
  if (!entries?.length) return [];
  const base = utility(c, a);
  const scored = [];
  for (const e of entries) {
    let ev = 0;
    if (e.action !== 'hold') {
      const act = ACTION_BY_ID[e.action];
      if (!affordable(c, a, act, e.commit) || blocked(c, a, act, e.target)) continue;
      let p; try { p = evaluate(c, a, e.action, e.target, e.commit).p; } catch { continue; }
      ev = (e.disc ?? 1) * (p * utility(overlay(c, e.win, a, e.extra), a) + (1 - p) * utility(overlay(c, e.lose, a, e.extra), a) - base) - (e.opp ?? 0) + grudgeBonus(c, a, e) + flagBias(c, a, e) + leaderBias(c, a, e) + opThreatBonus(c, a, e);
    }
    scored.push({ action: e.action, target: e.target, commit: e.commit, ev });
  }
  return softmax(scored.sort(byEv).slice(0, k), AI_CONFIG.temperature);
}

// Sample a move from a policy (the actor's mixed strategy). Deterministic given the state's RNG.
export function sampleMove(s, policy) {
  if (!policy?.length) return null;
  let r = rand(s) * policy.reduce((n, x) => n + x.w, 0);
  for (const x of policy) { r -= x.w; if (r <= 0) return x; }
  return policy[policy.length - 1];
}

export function chooseAction(s, a) {
  return sampleMove(s, rootPolicy(s, a, 6));
}
// Public shape of a policy for the state/UI: probabilities rounded, values kept.
export const packPolicy = (pol) => pol.map((x) => ({ action: x.action, target: x.target, commit: x.commit, w: +x.w.toFixed(4), ev: x.ev, value: x.value ?? null }));

// How much each actor gains (positive) or loses if this declaration succeeds.
export function stakes(s, decl) {
  const after = outcomeState(s, decl.actor, decl.action, decl.target, decl.commit, 'success');
  const out = {};
  for (const id of Object.keys(s.actors)) if (id !== decl.actor && !s.actors[id].collapsed) out[id] = utility(after, id) - utility(s, id);
  return out;
}

export const argWeight = (id) => (ACTOR_BY_ID[id].kind === 'superpower' ? 0.07 : ACTOR_BY_ID[id].kind === 'state' ? 0.05 : 0.03);

const LINES = {
  oppose: {
    military: ['{b} warns of uncontrolled escalation', '{b} threatens retaliation', '{b} moves assets to interfere', '{b} leaks the plan to the target'],
    diplomatic: ['{b} lobbies hard against it', '{b} refuses to sign on', '{b} sets impossible preconditions'],
    economic: ['{b} pressures partners to block it', '{b} threatens counter-measures'],
    covert: ['{b} tips off the target', '{b} exposes the operation in the press'],
    domestic: ['{b} funds the opposition', '{b} amplifies dissent'],
  },
  support: {
    military: ['{b} lends ISR and logistics', '{b} provides overflight and basing', '{b} shares targeting intelligence'],
    diplomatic: ['{b} publicly backs the initiative', '{b} brings its partners on board', '{b} offers guarantees'],
    economic: ['{b} co-finances the effort', '{b} opens its markets to help'],
    covert: ['{b} shares intelligence', '{b} provides cover'],
    domestic: ['{b} sends a message of solidarity', '{b} sends money'],
  },
};
export function argText(s, by, stance, actionId) {
  const cat = ACTION_BY_ID[actionId].cat;
  return pick(s, LINES[stance > 0 ? 'support' : 'oppose'][cat]).replace('{b}', ACTOR_BY_ID[by].name);
}

// Political capital an actor must keep to pay for its own declared action.
export function reserved(s, id) {
  const d = s.declared[id];
  return d ? costOf(ACTION_BY_ID[d.action], d.commit).political : 0;
}

// AI actors spend political capital arguing on declarations they care about most. With spend=false
// the same plan is returned without touching state (used to preview the opposition a move will meet).
export function planArgs(s, decls, skip = null, spend = true) {
  const triples = [];
  decls.forEach((d, i) => {
    d.stakes = stakes(s, d);
    for (const [b, delta] of Object.entries(d.stakes)) {
      if (b === skip || Math.abs(delta) < ARGUE_THRESHOLD) continue;
      triples.push({ i, b, delta });
    }
  });
  triples.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const used = { ...(s.argUsed || {}) };
  const planned = [];
  for (const { i, b, delta } of triples) {
    const d = decls[i];
    const stance = delta > 0 ? 1 : -1;
    if ((used[b] || 0) >= MAX_ARGS_PER_ACTOR || s.actors[b].political - reserved(s, b) < 1) continue;
    if (d.args.filter((x) => x.stance === stance).length + planned.filter((x) => x.i === i && x.stance === stance).length >= MAX_SIDE_PER_DECL) continue;
    used[b] = (used[b] || 0) + 1;
    const arg = { by: b, stance, d: stance * argWeight(b), text: spend ? argText(s, b, stance, d.action) : '' };
    planned.push({ i, ...arg });
    if (spend) { s.actors[b].political -= 1; d.args.push(arg); }
  }
  if (spend) s.argUsed = used;
  return planned;
}
export const aiArguments = (s, decls, skip = null) => planArgs(s, decls, skip, true);
