// Systemic costs of force that every actor pays, applied after an action's own effects:
//   - third parties lose regard for whoever uses force, scaled by how indefensible the target is;
//   - a struck state with a functioning regime rallies a little;
//   - sorties cost the American home front;
//   - continuous operations fatigue a force (tracked per turn in game.js, read by the odds).
import { ACTION_BY_ID } from './actions.js';
import { ACTOR_BY_ID } from '../data/actors.js';
import { THEATER_BY_ID } from '../data/theaters.js';
import { rel, relAdd, res, homeOf, hostiles, W } from './state.js';

export const FORCE = new Set(['strike', 'massiveBombing', 'offensive', 'harass', 'decapitation', 'terror', 'prisonBreak', 'nuclearDash', 'cyber']);
const CAPITALS = new Set(['tehran', 'israelHome', 'riyadh', 'beirut', 'damascus', 'baghdad', 'ankara', 'kurdistan', 'sinai']);
const CIVILIAN = new Set(['gaza', 'northYemen', 'southLebanon', 'westbank', 'beirut', 'damascus', 'tehran']);
// Who complains loudest when force is used.
const SENS = { eu: 1.4, china: 0.9, turkey: 1.1, egypt: 1.0, saudi: 0.7, us: 0.6, russia: 0.5, lebanon: 0.9, syria: 0.7, krg: 0.6, sdf: 0.5, israel: 0.3, iran: 0.3, isis: 0 };

// 0 (nobody minds) … 1 (the world objects).
export function legitimacyCost(actionId, target) {
  switch (actionId) {
    case 'massiveBombing': return target === 'tehran' ? 1 : 0.7;
    case 'strike': return CIVILIAN.has(target) ? 0.7 : CAPITALS.has(target) ? 0.5 : 0.25;
    case 'offensive': return CIVILIAN.has(target) ? 0.8 : 0.4;
    case 'decapitation': return 0.5;
    case 'terror': return 1;
    case 'harass': return 0.5;
    case 'nuclearDash': return 0.8;
    case 'cyber': return 0.2;
    default: return 0;
  }
}

export function victimsOf(s, a, actionId, target) {
  if (ACTOR_BY_ID[target]) return [target];
  if (!THEATER_BY_ID[target]) return [];
  const out = new Set(hostiles(s, a, target));
  const ctrl = THEATER_BY_ID[target].controller;
  if (ctrl !== a && rel(s, a, ctrl) <= -40) out.add(ctrl);
  return [...out].filter((id) => !s.actors[id].collapsed);
}

export function applyConsequences(s, a, actionId, target, outcome) {
  if (!FORCE.has(actionId)) return;
  const ok = outcome === 'crit' || outcome === 'success';
  const victims = victimsOf(s, a, actionId, target);
  const L = legitimacyCost(actionId, target);
  if (L > 0) {
    for (const id of Object.keys(s.actors)) {
      if (id === a || s.actors[id].collapsed || victims.includes(id)) continue;
      if (victims.some((v) => rel(s, id, v) <= -50)) continue; // the victim's enemies do not mind
      const sens = SENS[id] ?? 0.8;
      const ally = rel(s, a, id) >= 50;
      const d = -Math.round(L * 9 * sens * (ally ? 0.6 : 1));
      if (d) relAdd(s, a, id, d);
    }
  }
  // Rally round the flag: bombing a capital hardens a regime that is still standing.
  if (ok && (actionId === 'strike' || actionId === 'massiveBombing'))
    for (const v of victims) if (ACTOR_BY_ID[v].kind !== 'nonstate' && s.actors[v].stability >= 30 && homeOf(v) === target) res(s, v, { stability: 2 });
  // Every American sortie costs at home; every strike in the Iran theater keeps the war hot.
  if (a === 'us') W(s, 'usWarSupport', actionId === 'massiveBombing' ? -2 : -1);
  if (victims.includes('iran') || a === 'iran') W(s, 'warIntensity', 2);
  // Attrition from continuous operations.
  const f = s.fatigue?.[a] ?? 0;
  if (f >= 2) res(s, a, { military: -(f - 1) });
}

// Odds modifiers the game master adds to every evaluation.
export function systemicMods(s, a, actionId) {
  const act = ACTION_BY_ID[actionId];
  const out = [];
  const f = s.fatigue?.[a] ?? 0;
  if (FORCE.has(actionId) && f >= 2) out.push({ text: 'Forces stretched by continuous operations', d: -Math.min(0.2, 0.05 * (f - 1)) });
  if (act.cat === 'diplomatic' && s.flags.blusterBy === a && s.flags.bluster >= s.turn - 2) out.push({ text: 'Recent threats poisoned the channel', d: -0.1 });
  if (act.cat === 'diplomatic' && a === 'us' && s.world.usWarSupport < 25) out.push({ text: 'Negotiating from visible weakness at home', d: -0.05 });
  return out;
}
