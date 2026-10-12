// Situation DSL. A situation is a card the game master deals to the player at the start of a turn:
// it fires on a condition read from the state and recent history, carries 2-4 options with their
// own cost, odds and effects, and may set flags that gate later situations (chains).
//
// Option shape: { id, label, text, cost:{money,military,political}, odds: base probability or null
// for automatic, reasons:(h)=>[{text,d}], success:(h,m), fail:(h,m), say:{success,fail}, sets:{...},
// default:true marks the fallback picked when the player leaves the card unanswered. }
import { ACTOR_BY_ID } from '../actors.js';
import { THEATER_BY_ID } from '../theaters.js';
import { ACTION_BY_ID, costOf, blocked } from '../../engine/actions.js';
import { evaluate, narrate, clampP, band } from '../../engine/adjudicate.js';
import { isOp, startOp, simulateOp, weeks, opName } from '../../engine/ops.js';
import { W, res, relAdd, infl, tension, rel, homeOf, hitBy, recentOf, deriveWorld } from '../../engine/state.js';

export const C = (money = 0, military = 0, political = 0) => ({ money, military, political });
export const FREE = C();

export const CLASSES = {
  ALL: () => true,
  STATE: (id) => ACTOR_BY_ID[id].kind !== 'nonstate',
  NONSTATE: (id) => ACTOR_BY_ID[id].kind === 'nonstate',
  POWER: (id) => ACTOR_BY_ID[id].kind === 'superpower',
  IMPORTER: (id) => ['turkey', 'egypt', 'eu', 'china', 'lebanon', 'israel', 'syria'].includes(id),
  EXPORTER: (id) => ['saudi', 'russia', 'iran', 'krg'].includes(id),
};
export const appliesTo = (def, id) => (Array.isArray(def.who) ? def.who.includes(id) : CLASSES[def.who](id));

const matches = (pattern, value) => pattern == null || (Array.isArray(pattern) ? pattern.includes(value) : pattern === value);

// Helpers bound to (state, player). Situations read the world through these and mutate through the
// lower-case mutators, so the same code runs on the live state and on AI lookahead clones.
export function makeHelpers(s, p) {
  const home = homeOf(p);
  const live = (id) => !!s.actors[id] && !s.actors[id].collapsed;
  const h = {
    s, p, w: s.world, me: s.actors[p], turn: s.turn, home, kind: ACTOR_BY_ID[p].kind,
    A: (id) => s.actors[id], T: (t) => s.theaters[t],
    infOf: (t, id = p) => s.theaters[t]?.infl[id] || 0,
    relOf: (a, b = p) => rel(s, a, b),
    name: (id) => ACTOR_BY_ID[id]?.name ?? THEATER_BY_ID[id]?.name ?? id,
    short: (id) => ACTOR_BY_ID[id]?.short ?? THEATER_BY_ID[id]?.label ?? THEATER_BY_ID[id]?.name ?? id,
    alive: live,
    recent: (within = 1) => recentOf(s, within),
    did: (actor, action, target, within = 1) => recentOf(s, within).some((r) => r.kind === 'action' && r.ok && matches(actor, r.actor) && matches(action, r.action) && matches(target, r.target)),
    tried: (actor, action, target, within = 1) => recentOf(s, within).some((r) => r.kind === 'action' && matches(actor, r.actor) && matches(action, r.action) && matches(target, r.target)),
    find: (actor, action, target, within = 1) => recentOf(s, within).find((r) => r.kind === 'action' && r.ok && matches(actor, r.actor) && matches(action, r.action) && matches(target, r.target)),
    hit: (within = 1) => hitBy(s, p, within),
    event: (id, within = 1) => recentOf(s, within).some((r) => r.kind === 'event' && matches(id, r.id)),
    chose: (sit, opt, within = 99) => recentOf(s, within).some((r) => r.kind === 'situation' && r.id === sit && matches(opt, r.option)),
    flag: (k) => s.flags[k],
    allies: (min = 50) => Object.keys(s.actors).filter((id) => id !== p && live(id) && rel(s, p, id) >= min),
    enemies: (max = -50) => Object.keys(s.actors).filter((id) => id !== p && live(id) && rel(s, p, id) <= max),
    patron: () => ['us', 'china', 'russia', 'eu', 'saudi', 'iran', 'turkey'].filter((id) => id !== p && live(id) && rel(s, p, id) >= 40).sort((a, b) => rel(s, p, b) - rel(s, p, a))[0] ?? null,
    // mutators
    W: (k, d) => { W(s, k, d); deriveWorld(s); },
    res: (id, delta) => res(s, id, delta),
    rel: (a, b, d) => relAdd(s, a, b, d),
    inf: (t, id, d) => infl(s, t, id, d),
    tension: (t, d) => tension(s, t, d),
    set: (k, v = true) => { s.flags[k] = v; },
    act: (actionId, target, m = 1, actor = p) => { ACTION_BY_ID[actionId].success(s, actor, target, m); deriveWorld(s); },
    actFail: (actionId, target, m = 1, actor = p) => { ACTION_BY_ID[actionId].fail(s, actor, target, m); deriveWorld(s); },
  };
  return h;
}

// Build an option from a catalogue action taken by the player, optionally with a bonus and overrides.
// An option built from an operation starts it (no roll now; the odds shown are for its completion),
// and previews what it would do if it went to plan.
export function fromAction(h, actionId, target, o = {}) {
  const act = ACTION_BY_ID[actionId];
  let mods = [];
  try { mods = act.mods(h.s, h.p, target) ?? []; } catch { mods = []; }
  const mult = o.costMult ?? 1;
  const base = costOf(act, 0);
  const reasons = [...mods];
  if (o.bonus) reasons.push({ text: o.why ?? 'Circumstances favour it', d: o.bonus });
  const common = {
    id: o.id ?? `${actionId}${target ? ':' + target : ''}`,
    label: o.label ?? act.name,
    cost: { money: Math.ceil(base.money * mult), military: Math.ceil(base.military * mult), political: Math.ceil(base.political * mult) },
    sets: o.sets, default: o.default, action: actionId, target,
  };
  if (!isOp(act)) return {
    ...common, text: o.text ?? act.desc, odds: act.base, reasons, blocked: blocked(h.s, h.p, act, target),
    success: (h2, m) => { act.success(h2.s, h2.p, target, m); o.success?.(h2, m); },
    fail: (h2, m) => { act.fail(h2.s, h2.p, target, m); o.fail?.(h2, m); },
    say: { success: o.say?.success ?? narrate(actionId, h.p, target, true), fail: o.say?.fail ?? narrate(actionId, h.p, target, false) },
  };
  const dur = act.duration ?? 1;
  const pOp = clampP(act.base + reasons.reduce((n, r) => n + r.d, 0));
  const phase = act.op === 'deploy' ? 'arrives' : act.op === 'project' ? 'completes' : 'under way';
  return {
    ...common, text: `${o.text ?? act.desc} ${act.op === 'sustained' && dur <= 1 ? 'Runs fortnight after fortnight until stood down.' : `Takes ${weeks(dur)}.`}`,
    odds: null, reasons: [], op: act.op, eta: dur, lock: act.lock ?? 0, upkeep: act.upkeep?.money ?? 0, blocked: blocked(h.s, h.p, act, target), opOdds: { p: pOp, band: band(pOp), reasons },
    success: (h2, m) => { startOp(h2.s, h2.p, actionId, target, 0, { bonus: o.bonus ?? 0, source: 'card' }); o.success?.(h2, m); },
    fail: () => {},
    preview: (h2, m) => { simulateOp(h2.s, h2.p, actionId, target, 0, 'success'); o.success?.(h2, m); },
    say: { success: `${h.name(h.p)} launched ${opName(act)}${target ? ` (${h.name(target)})` : ''}: ${phase}${act.op === 'sustained' && dur <= 1 ? '' : ` in ${weeks(dur)}`}.`, fail: '' },
  };
}

// Plain option with sensible defaults.
export function opt(o) {
  return { cost: FREE, odds: null, reasons: [], success: () => {}, fail: () => {}, say: { success: '', fail: '' }, ...o };
}

export const evalP = (h, actionId, target) => { try { return evaluate(h.s, h.p, actionId, target).p; } catch { return 0.5; } };
