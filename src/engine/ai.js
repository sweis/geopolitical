// Non-player actors. Each one scores every affordable (action, target, commit) by expected change in
// its own utility, using one-ply lookahead on a cloned state, then samples with a softmax.
// The same lookahead drives the debate: actors argue for actions that help them and against those that hurt.
import { ACTIONS, ACTION_BY_ID, canUse, affordable, COMMIT, costOf } from './actions.js';
import { ACTOR_BY_ID } from '../data/actors.js';
import { goalScore } from './goals.js';
import { simClone as clone } from './state.js';
import { evaluate, payCost, applyOutcome } from './adjudicate.js';
import { rand, pick } from './rng.js';

const TEMPERATURE = 0.6;
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
      for (let c = 0; c < COMMIT.length; c++) if (affordable(s, a, act, c)) out.push({ action: act.id, target, commit: c });
    }
  }
  return out;
}

export function expectedGain(s, a, cand, base = utility(s, a)) {
  const { p } = evaluate(s, a, cand.action, cand.target, cand.commit);
  const win = clone(s); payCost(win, a, cand.action, cand.commit); applyOutcome(win, a, cand.action, cand.target, 'success');
  const lose = clone(s); payCost(lose, a, cand.action, cand.commit); applyOutcome(lose, a, cand.action, cand.target, 'fail');
  return p * utility(win, a) + (1 - p) * utility(lose, a) - base;
}

export function chooseAction(s, a) {
  const base = utility(s, a);
  const scored = candidates(s, a).map((c) => ({ ...c, ev: expectedGain(s, a, c, base) }));
  if (!scored.length) return null;
  scored.sort((x, y) => y.ev - x.ev);
  const top = scored.slice(0, 6);
  const wts = top.map((c) => Math.exp((c.ev - top[0].ev) / TEMPERATURE));
  let r = rand(s) * wts.reduce((n, w) => n + w, 0);
  for (let i = 0; i < top.length; i++) { r -= wts[i]; if (r <= 0) return top[i]; }
  return top[0];
}

// How much each actor gains (positive) or loses if this declaration succeeds.
export function stakes(s, decl) {
  const after = clone(s);
  payCost(after, decl.actor, decl.action, decl.commit);
  applyOutcome(after, decl.actor, decl.action, decl.target, 'success');
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

// AI actors spend political capital arguing on declarations they care about most.
export function aiArguments(s, decls, skip = null) {
  const triples = [];
  decls.forEach((d, i) => {
    d.stakes = stakes(s, d);
    for (const [b, delta] of Object.entries(d.stakes)) {
      if (b === skip || Math.abs(delta) < ARGUE_THRESHOLD) continue;
      triples.push({ i, b, delta });
    }
  });
  triples.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const used = {};
  for (const { i, b, delta } of triples) {
    const d = decls[i];
    const stance = delta > 0 ? 1 : -1;
    if ((used[b] || 0) >= MAX_ARGS_PER_ACTOR || s.actors[b].political - reserved(s, b) < 1) continue;
    if (d.args.filter((x) => x.stance === stance).length >= MAX_SIDE_PER_DECL) continue;
    s.actors[b].political -= 1;
    used[b] = (used[b] || 0) + 1;
    d.args.push({ by: b, stance, d: stance * argWeight(b), text: argText(s, b, stance, d.action) });
  }
}
