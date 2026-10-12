// The game master: turns an argued action into a probability, rolls, and applies the outcome.
// Rolls are never shown to the player; the UI narrates outcomes. They stay in state for tests.
import { ACTION_BY_ID, COMMIT, costOf, targetName } from './actions.js';
import { ACTOR_BY_ID } from '../data/actors.js';
import { res, deriveWorld } from './state.js';
import { d100 } from './rng.js';
import { applyConsequences, systemicMods } from './consequences.js';

export const P_MIN = 0.05, P_MAX = 0.95, DEBATE_CAP = 0.25;

const BANDS = [
  [0.9, 'Almost certain'], [0.75, 'Very likely'], [0.6, 'Likely'], [0.4, 'Even chance'],
  [0.25, 'Unlikely'], [0.1, 'Very unlikely'], [0, 'Remote'],
];
export const band = (p) => BANDS.find(([t]) => p >= t)[1];
export const clampP = (p) => Math.max(P_MIN, Math.min(P_MAX, p));

export function evaluate(s, a, actionId, target, commit = 0, args = []) {
  const act = ACTION_BY_ID[actionId];
  const mods = [...act.mods(s, a, target), ...systemicMods(s, a, actionId)];
  const modSum = mods.reduce((n, m) => n + m.d, 0);
  const commitBonus = COMMIT[commit].bonus;
  let debate = args.reduce((n, x) => n + x.d, 0);
  debate = Math.max(-DEBATE_CAP, Math.min(DEBATE_CAP, debate));
  const raw = act.base + modSum + commitBonus + debate;
  const p = clampP(raw);
  return { p: +p.toFixed(3), base: act.base, mods, commitBonus, debate: +debate.toFixed(3), band: band(p) };
}

export function payCost(s, a, actionId, commit) {
  const c = costOf(ACTION_BY_ID[actionId], commit);
  res(s, a, { money: -c.money, military: -c.military, political: -c.political });
}

// Apply an outcome without rolling (used by AI lookahead and by resolve()).
export function applyOutcome(s, a, actionId, target, outcome, mult = 1) {
  const act = ACTION_BY_ID[actionId];
  if (outcome === 'crit') act.success(s, a, target, 1.5 * mult);
  else if (outcome === 'success') act.success(s, a, target, mult);
  else if (outcome === 'blowback') act.fail(s, a, target, 1.5 * mult);
  else act.fail(s, a, target, mult);
  applyConsequences(s, a, actionId, target, outcome);
  deriveWorld(s);
}

export function narrate(actionId, a, target, ok) {
  const act = ACTION_BY_ID[actionId];
  return act.say[ok ? 'success' : 'fail'].replace('{a}', ACTOR_BY_ID[a].name).replace('{t}', target ? targetName(target) : '');
}

// Roll d100 under p*100. The bottom fifth of the success band is exceptional; 96+ on a failure is blowback.
export function rollFor(s, p) {
  const roll = d100(s);
  const pct = Math.round(p * 100);
  let outcome;
  if (roll <= pct) outcome = roll <= Math.max(1, Math.round(pct * 0.2)) ? 'crit' : 'success';
  else outcome = roll >= 96 ? 'blowback' : 'fail';
  return { roll, outcome, ok: outcome === 'crit' || outcome === 'success' };
}

export function resolve(s, decl) {
  const { actor: a, action, target, commit, args } = decl;
  const ev = evaluate(s, a, action, target, commit, args);
  const { roll, outcome, ok } = rollFor(s, ev.p);
  applyOutcome(s, a, action, target, outcome);
  let text = narrate(action, a, target, ok);
  if (outcome === 'crit') text += ' An exceptional result.';
  if (outcome === 'blowback') text += ' It backfired badly.';
  return { kind: 'action', actor: a, action, target, commit, p: ev.p, band: ev.band, roll, outcome, ok, text, mods: ev.mods, debate: ev.debate, args };
}
