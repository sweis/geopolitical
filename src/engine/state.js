// Game state creation and mutation helpers. The state is plain JSON (no functions) so it can be
// cloned for AI lookahead, snapshotted by getState(), and replayed from a seed.
import { ACTORS, ACTOR_BY_ID, RELATIONS } from '../data/actors.js';
import { THEATERS } from '../data/theaters.js';
import { WORLD_START } from '../data/world.js';

export const START_DATE = '2026-10-12';
export const DAYS_PER_TURN = 14;
export const MAX_TURNS = 16;

export const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

export function createState({ seed = 1, player = null, maxTurns = MAX_TURNS } = {}) {
  const s = {
    version: 1,
    seed, rng: seed | 0,
    turn: 1, maxTurns, phase: 'turn',
    player,
    world: { ...WORLD_START },
    actors: {}, theaters: {}, rel: {},
    // Per-turn working set: AI declarations, the player's situation cards and orders.
    declared: {}, argUsed: {}, situations: [], orders: { initiative: null },
    // What happened: this turn's results and events, the relevance-filtered briefing, and a short
    // structured memory of recent results that situations and AI grudges read.
    results: [], news: [], briefing: null, recent: [], cool: {},
    log: [], history: [], flags: {},
    outcome: null,
  };
  for (const a of ACTORS) s.actors[a.id] = { id: a.id, ...a.start, collapsed: false };
  for (const t of THEATERS) s.theaters[t.id] = { id: t.id, tension: t.tension, infl: { ...t.infl } };
  for (let i = 0; i < ACTORS.length; i++)
    for (let j = i + 1; j < ACTORS.length; j++) {
      const a = ACTORS[i].id, b = ACTORS[j].id;
      s.rel[relKey(a, b)] = RELATIONS[`${a}|${b}`] ?? RELATIONS[`${b}|${a}`] ?? (a === 'isis' || b === 'isis' ? -80 : 0);
    }
  deriveWorld(s);
  return s;
}

export const clone = (s) => structuredClone(s);

// Fast lookahead copy: only the parts action effects read or write (no log/history).
export function simClone(s) {
  const actors = {}, theaters = {};
  for (const k in s.actors) actors[k] = { ...s.actors[k] };
  for (const k in s.theaters) theaters[k] = { id: k, tension: s.theaters[k].tension, infl: { ...s.theaters[k].infl } };
  return { ...s, world: { ...s.world }, actors, theaters, rel: { ...s.rel }, flags: { ...s.flags }, log: [], history: [], news: [], results: [], declared: s.declared };
}
import { relKey, rel } from './relations.js';
export { relKey, rel };
export function relAdd(s, a, b, d) { if (a !== b) s.rel[relKey(a, b)] = clamp(rel(s, a, b) + d, -100, 100); }

export function dateOf(turn) {
  const d = new Date(START_DATE + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + (turn - 1) * DAYS_PER_TURN);
  return d.toISOString().slice(0, 10);
}

// World variables. oil is derived; everything else is 0-100.
export function W(s, k, d) {
  if (k === 'oilAdj') { s.world.oilAdj = clamp(s.world.oilAdj + d, -25, 25); return; }
  s.world[k] = clamp(s.world[k] + d);
}
export function deriveWorld(s) {
  const w = s.world;
  w.oil = Math.round(66 + (100 - w.hormuz) * 0.42 + (100 - w.redSea) * 0.08 + w.warIntensity * 0.06 + w.oilAdj);
}

// Actor resources. Stability <= 0 means collapse.
export function res(s, id, delta) {
  const a = s.actors[id];
  if (!a) return;
  for (const [k, d] of Object.entries(delta)) {
    if (k === 'money' || k === 'political') a[k] = Math.max(0, Math.round((a[k] + d) * 10) / 10);
    else a[k] = clamp(Math.round((a[k] + d) * 10) / 10);
  }
}

export function tension(s, t, d) { s.theaters[t].tension = clamp(s.theaters[t].tension + d); }
export function infl(s, t, id, d) {
  const m = s.theaters[t].infl;
  m[id] = clamp((m[id] || 0) + d);
  if (m[id] === 0) delete m[id];
}

export const alive = (s) => Object.values(s.actors).filter((a) => !a.collapsed).map((a) => a.id);

// Actors with presence in theater t who are hostile to actor a.
export function hostiles(s, a, t, thr = -40) {
  return Object.entries(s.theaters[t].infl)
    .filter(([id, v]) => id !== a && v >= 10 && rel(s, a, id) <= thr && !s.actors[id]?.collapsed)
    .map(([id]) => id);
}

export const homeOf = (id) => ACTOR_BY_ID[id].home;

// Results from the last `within` completed turns (recent entries carry the turn they resolved in).
export const recentOf = (s, within = 1) => s.recent.filter((r) => r.turn >= s.turn - within && r.turn < s.turn);

// Did a successful hostile action by `by` land on actor `a` (directly, or on its home theater)?
export function hitBy(s, a, within = 1) {
  const home = homeOf(a);
  const out = [];
  for (const r of recentOf(s, within)) {
    if (r.kind !== 'action' || !r.ok || r.actor === a) continue;
    if (!HOSTILE_ACTIONS.has(r.action)) continue;
    if (r.target === a || (home && r.target === home)) out.push(r);
  }
  return out;
}
export const HOSTILE_ACTIONS = new Set(['strike', 'massiveBombing', 'offensive', 'harass', 'decapitation', 'terror', 'prisonBreak', 'cyber', 'infoOps', 'sanctions', 'counterTerror']);
