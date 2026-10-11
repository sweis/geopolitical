// The director deals the player's situation cards each turn, ranks initiative proposals, resolves the
// player's choices with hidden rolls, and compiles the relevance-filtered briefing.
import { SITUATIONS, SITUATION_BY_ID, appliesTo, makeHelpers } from '../data/situations/index.js';
import { ACTOR_BY_ID } from '../data/actors.js';
import { THEATER_BY_ID } from '../data/theaters.js';
import { WORLD_LABELS, WORLD_SHORT } from '../data/world.js';
import { ACTION_BY_ID, affordable, canUse, costOf, targetName } from './actions.js';
import { band, clampP, rollFor, evaluate, applyOutcome, payCost } from './adjudicate.js';
import { goalScore, goalKeys } from './goals.js';
import { utility, candidates, expectedGain, argWeight, ARGUE_THRESHOLD } from './ai.js';
import { simClone, res, homeOf, deriveWorld, dateOf } from './state.js';
import { rand } from './rng.js';

// Content errors (a situation's when/options/effects throwing) are swallowed so the game keeps running,
// but recorded here so the content probe (tests/situations.mjs) can surface them.
export const DIRECTOR_ERRORS = [];
const report = (where, id, e) => { if (DIRECTOR_ERRORS.length < 200) DIRECTOR_ERRORS.push({ where, id, message: String(e?.message ?? e) }); };

export const MAX_CARDS = 2;          // crisis/opportunity cards per turn (an intel card may be added)
export const INTEL_THRESHOLD = 1.5;  // utility stake needed before an AI move earns an intel card
const DEFAULT_COOLDOWN = 3;

const str = (v, h) => (typeof v === 'function' ? v(h) : v);
const canAfford = (s, p, c) => { const a = s.actors[p]; return a.money >= (c.money || 0) && a.military >= (c.military || 0) && a.political >= (c.political || 0); };
const payRaw = (s, p, c) => res(s, p, { money: -(c.money || 0), military: -(c.military || 0), political: -(c.political || 0) });
const withIds = (opts) => { opts.forEach((o, i) => { if (o.id == null) o.id = `opt${i}`; }); return opts; };

// The live option objects (with their effect closures) dealt this turn, keyed by game and card, so
// resolution and AI lookahead use exactly the options the player saw even if the state has moved.
const LIVE = new Map();
const liveKey = (s, sitId) => `${s.seed}|${s.player}|${s.turn}|${sitId}`;

// ── expected effects (what a success would do), shown as chips instead of prose ──
// Direction of "good" for each world track from the player's objectives: +1 wants it up, -1 down, 0 neutral.
export function goalDirs(p) {
  const out = {};
  for (const g of ACTOR_BY_ID[p].goals) if (g.get.world) out[g.get.world] = g.dir === '>=' ? 1 : -1;
  return out;
}
const RES_SHORT = { money: '$', military: 'Mil', political: 'PC', stability: 'Stab' };
export function effectChips(s, p, before, after, limit = 4) {
  const dirs = goalDirs(p);
  const chips = [];
  for (const k of Object.keys(WORLD_LABELS)) {
    if (k === 'oilAdj') continue;
    const d = Math.round(after.world[k] - before.world[k]);
    if (Math.abs(d) < 1) continue;
    const dir = dirs[k] ?? (k === 'oil' ? (dirs.oil ?? 0) : 0);
    chips.push({ kind: 'world', key: k, label: WORLD_SHORT[k] ?? k, d, good: dir === 0 ? 0 : Math.sign(d) * dir, unit: k === 'oil' ? '$' : '', w: (dir ? 3 : 1) * Math.abs(d) });
  }
  const a = after.actors[p], b = before.actors[p];
  for (const k of ['stability', 'military', 'money', 'political']) {
    const d = Math.round(a[k] - b[k]);
    if (Math.abs(d) < 1) continue;
    chips.push({ kind: 'res', key: k, label: RES_SHORT[k], d, good: Math.sign(d), unit: k === 'money' ? '$' : '', w: 2 * Math.abs(d) });
  }
  for (const id of Object.keys(after.actors)) {
    if (id === p) continue;
    const d = Math.round((after.rel[[p, id].sort().join('|')] ?? 0) - (before.rel[[p, id].sort().join('|')] ?? 0));
    if (Math.abs(d) < 3) continue;
    chips.push({ kind: 'rel', key: id, label: ACTOR_BY_ID[id].short, actor: id, d, good: Math.sign(d), unit: '', w: Math.abs(d) * 0.6 });
  }
  for (const t of Object.keys(after.theaters)) {
    const d = Math.round((after.theaters[t].infl[p] || 0) - (before.theaters[t].infl[p] || 0));
    if (Math.abs(d) < 3) continue;
    chips.push({ kind: 'infl', key: t, label: `${THEATER_BY_ID[t].label ?? THEATER_BY_ID[t].name} infl`, d, good: Math.sign(d), unit: '', w: Math.abs(d) * 0.8 });
  }
  chips.sort((x, y) => y.w - x.w);
  return chips.slice(0, limit).map(({ w, ...c }) => c);
}
function optionEffects(s, p, o, cost) {
  const c = simClone(s);
  payRaw(c, p, cost);
  const base = simClone(c);
  const h = makeHelpers(c, p);
  try { o.success(h, 1); } catch (e) { report('preview', o.id, e); }
  deriveWorld(c);
  return effectChips(s, p, base, c);
}
export function actionEffects(s, p, action, target) {
  const c = simClone(s);
  payCost(c, p, action, 0);
  const base = simClone(c);
  try { applyOutcome(c, p, action, target, 'success'); } catch (e) { report('preview', action, e); }
  return effectChips(s, p, base, c);
}

// ── dealing cards ──
function materialize(s, p, def, h) {
  const live = withIds(def.options(h));
  LIVE.set(liveKey(s, def.id), live);
  const options = live.map((o) => {
    const reasons = (typeof o.reasons === 'function' ? o.reasons(h) : o.reasons) ?? [];
    const auto = o.odds == null;
    const pFinal = auto ? null : clampP(o.odds + reasons.reduce((n, r) => n + r.d, 0));
    const cost = o.cost ?? { money: 0, military: 0, political: 0 };
    return { id: o.id, label: o.label, text: o.text ?? '', cost, p: pFinal, band: auto ? null : band(pFinal), base: o.odds ?? null,
      reasons: reasons.map((r) => ({ text: r.text, d: +r.d.toFixed(3) })), default: !!o.default, affordable: canAfford(s, p, cost), action: o.action ?? null, target: o.target ?? null,
      icon: o.icon ?? null, effects: optionEffects(s, p, o, cost) };
  });
  if (!options.some((o) => o.default)) options[options.length - 1].default = true;
  const at = str(def.at, h) ?? null;
  return { id: def.id, kind: def.kind, title: str(def.title, h), text: str(def.text, h), at, options, choice: null };
}

export function eligibleSituations(s) {
  const p = s.player;
  const h = makeHelpers(s, p);
  const out = [];
  for (const def of SITUATIONS) {
    if (!appliesTo(def, p)) continue;
    const last = s.cool[def.id];
    if (last != null && (def.once || s.turn - last < (def.cooldown ?? DEFAULT_COOLDOWN))) continue;
    let ok = false;
    try { ok = !!def.when(h); } catch (e) { report('when', def.id, e); ok = false; }
    if (ok) out.push(def);
  }
  return out;
}

export function generateSituations(s) {
  const p = s.player;
  s.situations = [];
  LIVE.clear();
  if (!p || s.actors[p].collapsed) return;
  const eligible = eligibleSituations(s);
  const pickTop = (arr) => {
    if (!arr.length) return null;
    const max = Math.max(...arr.map((d) => d.priority));
    const top = arr.filter((d) => d.priority === max);
    return top[Math.floor(rand(s) * top.length)];
  };
  const crises = eligible.filter((d) => d.kind === 'crisis'), opps = eligible.filter((d) => d.kind === 'opportunity');
  const chosen = [];
  const c = pickTop(crises); if (c) chosen.push(c);
  const o = pickTop(opps); if (o) chosen.push(o);
  if (chosen.length < MAX_CARDS) { const c2 = pickTop(crises.filter((d) => !chosen.includes(d))); if (c2) chosen.push(c2); }
  if (chosen.length < MAX_CARDS) { const o2 = pickTop(opps.filter((d) => !chosen.includes(d))); if (o2) chosen.push(o2); }
  for (const def of chosen) {
    s.cool[def.id] = s.turn;
    const h = makeHelpers(s, p);
    try { def.onFire?.(h); } catch (e) { report('onFire', def.id, e); }
    deriveWorld(s);
    try { s.situations.push(materialize(s, p, def, makeHelpers(s, p))); } catch (e) { report('materialize', def.id, e); }
  }
  const intel = intelCard(s);
  if (intel) s.situations.push(intel);
}

// The one AI declaration that matters most to the player this turn, with lobbying options.
function intelCard(s) {
  const p = s.player;
  let best = null;
  for (const d of Object.values(s.declared)) {
    if (d.actor === p) continue;
    const delta = d.stakes?.[p] ?? 0;
    if (Math.abs(delta) >= INTEL_THRESHOLD && (!best || Math.abs(delta) > Math.abs(best.delta))) best = { d, delta };
  }
  if (!best) return null;
  const { d, delta } = best;
  const act = ACTION_BY_ID[d.action];
  const who = ACTOR_BY_ID[d.actor].name;
  const tgt = d.target ? ` against ${targetName(d.target)}` : '';
  const w = Math.round(argWeight(p) * 100);
  const pc = s.actors[p].political;
  const cost1 = { money: 0, military: 0, political: 1 };
  return {
    id: 'intel', kind: 'intel', actor: d.actor, delta: +delta.toFixed(1),
    title: `Intelligence: ${who} is preparing ${act.name.toLowerCase()}${tgt}`,
    text: `${ACTOR_BY_ID[d.actor].short} sources indicate the move is planned for the coming fortnight. Your analysts judge it would ${delta > 0 ? 'help' : 'hurt'} your position${Math.abs(delta) >= 4 ? ' significantly' : ''}. Lobbying costs 1 political capital and shifts their odds by ${w} points.`,
    at: d.target && THEATER_BY_ID[d.target] ? d.target : homeOf(d.actor),
    options: [
      { id: 'oppose', label: 'Lobby against it', text: 'Pressure, leaks, and a word in the right ears.', cost: cost1, p: null, band: null, base: null, reasons: [], default: false, affordable: pc >= 1, action: null, target: null, icon: 'cross', effects: [{ kind: 'odds', key: d.actor, label: `${ACTOR_BY_ID[d.actor].short} odds`, d: -w, good: delta > 0 ? -1 : 1, unit: '%' }] },
      { id: 'support', label: 'Quietly back it', text: 'Share intelligence and smooth the way.', cost: cost1, p: null, band: null, base: null, reasons: [], default: false, affordable: pc >= 1, action: null, target: null, icon: 'check', effects: [{ kind: 'odds', key: d.actor, label: `${ACTOR_BY_ID[d.actor].short} odds`, d: w, good: delta > 0 ? 1 : -1, unit: '%' }] },
      { id: 'ignore', label: 'Let it play out', text: 'Save your capital.', cost: { money: 0, military: 0, political: 0 }, p: null, band: null, base: null, reasons: [], default: true, affordable: true, action: null, target: null, icon: 'pause', effects: [] },
    ],
    choice: null,
  };
}

// ── proposals: the initiatives advisers put forward this turn ──
export function proposals(s, n = 5) {
  const p = s.player;
  if (!p || s.actors[p].collapsed) return [];
  const base = utility(s, p);
  const def = ACTOR_BY_ID[p];
  // Housekeeping moves stay in the catalogue; proposals are initiatives.
  const HOUSEKEEPING = new Set(['hold', 'withdraw', 'fortify']);
  const scored = candidates(s, p).filter((c) => c.commit === 0 && !HOUSEKEEPING.has(c.action)).map((c) => ({ ...c, ev: expectedGain(s, p, c, base) }));
  const best = {};
  for (const c of scored) if (!best[c.action] || c.ev > best[c.action].ev) best[c.action] = c;
  const list = Object.values(best).sort((a, b) => b.ev - a.ev).slice(0, n);
  return list.map((c) => {
    const ev = evaluate(s, p, c.action, c.target, 0);
    const why = ev.mods.filter((m) => m.d > 0).sort((a, b) => b.d - a.d)[0]?.text ?? null;
    // Which objective moves most if it succeeds.
    const win = simClone(s); payCost(win, p, c.action, 0); applyOutcome(win, p, c.action, c.target, 'success');
    let serves = null, bestGain = 0.02;
    for (const g of def.goals) { const gain = g.progress(win) - g.progress(s); if (gain > bestGain) { bestGain = gain; serves = g.name; } }
    return { action: c.action, target: c.target, name: ACTION_BY_ID[c.action].name, targetName: c.target ? targetName(c.target) : null, cost: costOf(ACTION_BY_ID[c.action], 0), p: ev.p, band: ev.band, ev: +c.ev.toFixed(2), why, serves, effects: actionEffects(s, p, c.action, c.target) };
  });
}

// ── resolving the player's choices ──
export function snapshotFor(s, p) {
  const a = s.actors[p];
  return { world: { ...s.world }, res: { money: a.money, military: a.military, political: a.political, stability: a.stability }, score: goalScore(ACTOR_BY_ID[p], s) };
}
export function impactSince(s, p, before) {
  const a = s.actors[p];
  const dWorld = {};
  for (const k of Object.keys(WORLD_LABELS)) { const d = s.world[k] - before.world[k]; if (Math.abs(d) >= 1) dWorld[k] = Math.round(d); }
  return {
    dScore: +(goalScore(ACTOR_BY_ID[p], s) - before.score).toFixed(2),
    dRes: { money: +(a.money - before.res.money).toFixed(1), military: +(a.military - before.res.military).toFixed(1), political: +(a.political - before.res.political).toFixed(1), stability: +(a.stability - before.res.stability).toFixed(1) },
    dWorld,
  };
}

function liveOptions(s, sit) {
  const cached = LIVE.get(liveKey(s, sit.id));
  if (cached) return cached;
  const def = SITUATION_BY_ID[sit.id];
  try { return withIds(def.options(makeHelpers(s, s.player))); } catch (e) { report('options', sit.id, e); return []; }
}

function liveOption(s, p, sit, optId) {
  const h = makeHelpers(s, p);
  const live = liveOptions(s, sit);
  const idx = sit.options.findIndex((o) => o.id === optId);
  return { h, o: live.find((x) => x.id === optId) ?? live[idx] ?? live.find((x) => x.default) ?? live.at(-1) ?? null };
}

export function resolveSituations(s) {
  const p = s.player, out = [];
  for (const sit of s.situations) {
    let mat = sit.options.find((o) => o.id === sit.choice) ?? sit.options.find((o) => o.default) ?? sit.options.at(-1);
    if (!canAfford(s, p, mat.cost)) mat = sit.options.find((o) => o.default) ?? sit.options.at(-1);
    sit.choice = mat.id;
    if (sit.kind === 'intel') { out.push(resolveIntel(s, sit, mat)); continue; }
    const { h, o } = liveOption(s, p, sit, mat.id);
    if (!o) continue;
    payRaw(s, p, mat.cost);
    const before = snapshotFor(s, p);
    let outcome = 'auto', ok = true, roll = 0;
    if (mat.p != null) ({ outcome, ok, roll } = rollFor(s, mat.p));
    const m = outcome === 'crit' || outcome === 'blowback' ? 1.5 : 1;
    try { if (ok) o.success(h, m); else o.fail(h, m); } catch (e) { report(ok ? 'success' : 'fail', `${sit.id}/${mat.id}`, e); }
    if (o.sets) for (const [k, v] of Object.entries(o.sets)) s.flags[k] = v;
    deriveWorld(s);
    let text = (ok ? o.say?.success : o.say?.fail) || (ok ? `${mat.label}: it worked.` : `${mat.label}: it failed.`);
    if (outcome === 'crit') text += ' Better than anyone expected.';
    if (outcome === 'blowback') text += ' It backfired badly.';
    const r = { kind: 'situation', actor: p, id: sit.id, option: mat.id, title: sit.title, label: mat.label, at: sit.at, p: mat.p, band: mat.band, roll, outcome, ok, text, impact: impactSince(s, p, before) };
    out.push(r);
    s.recent.push({ turn: s.turn, kind: 'situation', actor: p, id: sit.id, option: mat.id, ok, text });
    // An option built from a catalogue action also counts as that action, so chains and grudges see it.
    if (mat.action) s.recent.push({ turn: s.turn, kind: 'action', actor: p, action: mat.action, target: mat.target, ok, outcome, text });
    s.log.push({ turn: s.turn, kind: ok ? 'success' : 'fail', text: `${sit.title} — ${mat.label}. ${text}`, actor: p });
  }
  return out;
}

function resolveIntel(s, sit, mat) {
  const p = s.player;
  const d = s.declared[sit.actor];
  let text = `You let ${ACTOR_BY_ID[sit.actor].name}'s plan play out.`;
  if (mat.id !== 'ignore' && d) {
    payRaw(s, p, mat.cost);
    const stance = mat.id === 'support' ? 1 : -1;
    d.args.push({ by: p, stance, d: stance * argWeight(p), text: `${ACTOR_BY_ID[p].name} ${stance > 0 ? 'backed the move' : 'lobbied against it'}`, player: true });
    text = `You ${stance > 0 ? 'quietly backed' : 'lobbied against'} ${ACTOR_BY_ID[sit.actor].name}'s plan.`;
  }
  return { kind: 'intel', actor: p, id: 'intel', option: mat.id, title: sit.title, label: mat.label, at: sit.at, target: sit.actor, p: null, outcome: 'auto', ok: true, text, impact: null };
}

// ── relevance ──
export function isRelevant(s, p, r) {
  if (!p) return false;
  if (r.actor === p) return true;
  const home = homeOf(p);
  if (r.target === p || (home && r.target === home)) return true;
  if (r.target && s.theaters[r.target] && (s.theaters[r.target].infl[p] || 0) >= 15) return true;
  const i = r.impact;
  if (!i) return false;
  return Math.abs(i.dScore) >= 0.6 || Math.abs(i.dRes.stability) >= 1.5 || Math.abs(i.dRes.military) >= 1.5 || Math.abs(i.dRes.money) >= 2 || Math.abs(i.dRes.political) >= 1;
}

// Chips for what a result changed for the player, restricted to tracks the player cares about.
export function impactLine(s, p, impact) {
  if (!impact) return [];
  const keys = goalKeys(ACTOR_BY_ID[p]).world;
  const dirs = goalDirs(p);
  const out = [];
  for (const [k, d] of Object.entries(impact.dWorld)) if (keys.has(k) || k === 'oil') out.push({ kind: 'world', key: k, label: WORLD_SHORT[k] ?? k, d, good: dirs[k] ? Math.sign(d) * dirs[k] : 0, unit: k === 'oil' ? '$' : '' });
  for (const [k, d] of Object.entries(impact.dRes)) if (Math.abs(d) >= 1) out.push({ kind: 'res', key: k, label: RES_SHORT[k], d: Math.round(d), good: Math.sign(d), unit: k === 'money' ? '$' : '' });
  return out;
}

export function compileBriefing(s, mine, others, events, scoreBefore, worldBefore) {
  const p = s.player;
  if (!p) return { turn: s.turn, date: dateOf(s.turn), mine: [], affecting: [], elsewhere: others, events, scoreBefore: 0, scoreAfter: 0, worldDelta: [] };
  const affecting = others.filter((r) => isRelevant(s, p, r));
  const elsewhere = others.filter((r) => !affecting.includes(r));
  const keys = goalKeys(ACTOR_BY_ID[p]).world;
  const dirs = goalDirs(p);
  const worldDelta = [];
  for (const k of Object.keys(WORLD_LABELS)) {
    if (!keys.has(k) && k !== 'oil') continue;
    const d = Math.round(s.world[k] - worldBefore[k]);
    if (Math.abs(d) >= 2) worldDelta.push({ kind: 'world', key: k, label: WORLD_SHORT[k] ?? k, d, good: dirs[k] ? Math.sign(d) * dirs[k] : 0, unit: k === 'oil' ? '$' : '' });
  }
  return {
    turn: s.turn, date: dateOf(s.turn),
    mine: mine.map((r) => ({ ...r, lines: impactLine(s, p, r.impact) })),
    affecting: affecting.map((r) => ({ ...r, lines: impactLine(s, p, r.impact) })),
    elsewhere: elsewhere.map((r) => ({ actor: r.actor, text: r.text, ok: r.ok })),
    events: events.map((e) => ({ ...e, lines: impactLine(s, p, e.impact), relevant: !!e.impact && (Math.abs(e.impact.dScore) >= 0.6 || Object.keys(e.impact.dWorld).some((k) => keys.has(k))) })),
    scoreBefore: +scoreBefore.toFixed(1), scoreAfter: +goalScore(ACTOR_BY_ID[p], s).toFixed(1), worldDelta,
  };
}

// ── AI playing the player's seat (autoplay, sims) ──
export function chooseOptionAI(s, p, sit) {
  if (sit.kind === 'intel') {
    if (Math.abs(sit.delta) >= 3 && s.actors[p].political >= 2) return sit.delta > 0 ? 'support' : 'oppose';
    return 'ignore';
  }
  const base = utility(s, p);
  const live = liveOptions(s, sit);
  let best = null, bestEv = -Infinity;
  for (const mat of sit.options) {
    if (!canAfford(s, p, mat.cost)) continue;
    const evFor = (ok) => {
      const c = simClone(s);
      payRaw(c, p, mat.cost);
      const h = makeHelpers(c, p);
      const o = live.find((x) => x.id === mat.id);
      if (!o) return base;
      try { if (ok) o.success(h, 1); else o.fail(h, 1); } catch (e) { report(ok ? 'success' : 'fail', `${sit.id}/${mat.id}`, e); }
      deriveWorld(c);
      return utility(c, p);
    };
    const ev = mat.p == null ? evFor(true) - base : mat.p * evFor(true) + (1 - mat.p) * evFor(false) - base;
    if (ev > bestEv) { bestEv = ev; best = mat.id; }
  }
  return best ?? (sit.options.find((o) => o.default) ?? sit.options.at(-1)).id;
}

// Total cost of everything the player has queued this turn.
export function ordersTotal(s) {
  const t = { money: 0, military: 0, political: 0 };
  for (const sit of s.situations) {
    const o = sit.options.find((x) => x.id === sit.choice);
    if (o) { t.money += o.cost.money || 0; t.military += o.cost.military || 0; t.political += o.cost.political || 0; }
  }
  const init = s.orders.initiative;
  if (init) { const c = costOf(ACTION_BY_ID[init.action], init.commit); t.money += c.money; t.military += c.military; t.political += c.political; }
  return t;
}
