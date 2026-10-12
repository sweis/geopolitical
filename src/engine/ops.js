// Operations: actions that take more than a fortnight. An operation commits forces for its duration and
// costs upkeep every turn. Three kinds:
//   project   – prepares for `duration` turns, then resolves once (talks, build-ups, a nuclear dash);
//   sustained – runs turn after turn (a roll and the per-turn effect each turn) for up to `maxTurns`
//               turns or until stood down (escorts, interdiction, a ground campaign);
//   deploy    – arrives after `duration` turns and stays on station, granting a posture that other
//               actions need or benefit from, until stood down (a carrier surge, an ISF contingent).
// Preparing operations are visible to everyone (a carrier at sea is not a secret), so rivals can act
// before they land; fragile ones are delayed or cancelled when their site is hit.
import { ACTION_BY_ID, COMMIT } from './actions.js';
import { ACTOR_BY_ID } from '../data/actors.js';
import { THEATER_BY_ID } from '../data/theaters.js';
import { res, deriveWorld, homeOf, HOSTILE_ACTIONS } from './state.js';
import { evaluate, applyOutcome, rollFor } from './adjudicate.js';
import { FORCE } from './consequences.js';

export const isOp = (act) => !!act?.op;
export const weeks = (turns) => `${turns * 2} weeks`;
const NAME = (id) => ACTOR_BY_ID[id]?.name ?? THEATER_BY_ID[id]?.name ?? id;
const tgt = (t) => (t ? ` (${NAME(t)})` : '');
// How an operation reads in prose ("launched a ground campaign", "stood down its convoy operation").
export const opName = (act) => act.gerund ?? act.name.toLowerCase();

export const liveOps = (s, a = null) => s.ops.filter((o) => (o.status === 'preparing' || o.status === 'active') && (!a || o.actor === a));
export const hasPosture = (s, a, name) => s.ops.some((o) => o.actor === a && o.status === 'active' && ACTION_BY_ID[o.action].posture === name);
export const opAt = (s, a, act, target) => (act.at ? act.at(s, a, target) : target && s.theaters[target] ? target : homeOf(a));

// Start an operation (the caller has paid the action's cost). `bonus` shifts its rolls (card bonuses and
// lobbying), `stakes` is what it would do to everyone (for intelligence and rivals' threat assessments).
export function startOp(s, a, actionId, target, commit = 0, { bonus = 0, args = [], stakes = null, source = 'initiative' } = {}) {
  const act = ACTION_BY_ID[actionId];
  const dur = act.duration ?? 1;
  const op = {
    id: `${a}:${actionId}:${target ?? ''}:${s.turn}`, actor: a, action: actionId, target: target ?? null, commit, kind: act.op, source,
    start: s.turn, duration: dur, turnsLeft: dur, maxTurns: act.maxTurns ?? 0, ran: 0, status: 'preparing',
    lock: act.lock ?? 0, upkeep: act.upkeep?.money ?? 0, bonus: bonus + args.reduce((n, x) => n + x.d, 0), stakes, stalled: false, at: opAt(s, a, act, target), endTurn: null,
  };
  s.ops.push(op);
  return op;
}

export function findOp(s, id) { return s.ops.find((o) => o.id === id); }

function finish(s, op, status, report, text) {
  op.status = status; op.endTurn = s.turn;
  const act = ACTION_BY_ID[op.action];
  if ((status === 'stood_down' || status === 'done' || status === 'failed') && act.onEnd && (op.kind !== 'project')) { try { act.onEnd(s, op.actor, op.target, op); } catch { /* content error */ } deriveWorld(s); }
  report?.({ kind: 'op', phase: status, actor: op.actor, action: op.action, target: op.target, op: op.id, at: op.at, ok: status === 'done', outcome: 'auto', text });
  s.log.push({ turn: s.turn, kind: 'op', text, actor: op.actor });
}

export function standDown(s, op, report) {
  const act = ACTION_BY_ID[op.action];
  finish(s, op, 'stood_down', report, `${NAME(op.actor)} stood down its ${opName(act)}${tgt(op.target)}.`);
}

// One execution of an operation's effect (a project completing, or one turn of a sustained operation).
function execute(s, op, report, mult = 1) {
  const a = op.actor, act = ACTION_BY_ID[op.action];
  const ev = evaluate(s, a, op.action, op.target, op.commit, op.bonus ? [{ d: op.bonus }] : []);
  const { roll, outcome, ok } = rollFor(s, ev.p);
  const before = report?.snap?.();
  applyOutcome(s, a, op.action, op.target, outcome, mult);
  let text = (ok ? act.say.success : act.say.fail).replace('{a}', NAME(a)).replace('{t}', op.target ? NAME(op.target) : '');
  if (outcome === 'crit') text += ' An exceptional result.';
  if (outcome === 'blowback') text += ' It backfired badly.';
  const r = { kind: 'action', actor: a, action: op.action, target: op.target, commit: op.commit, p: ev.p, band: ev.band, roll, outcome, ok, text, op: op.id, at: op.at, mods: ev.mods, args: [] };
  s.recent.push({ turn: s.turn, kind: 'action', actor: a, action: op.action, target: op.target, ok, outcome, text });
  s.log.push({ turn: s.turn, kind: ok ? 'success' : 'fail', text, actor: a, p: ev.p, roll });
  report?.(r, before);
  return ok;
}

// Successful hostile actions this turn against the operation's site, its actor or its actor's home.
function hitsOn(s, op) {
  const home = homeOf(op.actor);
  return s.recent.filter((r) => r.turn === s.turn && r.kind === 'action' && r.ok && r.actor !== op.actor && HOSTILE_ACTIONS.has(r.action) && (r.target === op.at || r.target === op.actor || (home && r.target === home)));
}

// Advance every live operation by one turn. Returns the actors that used force through an operation.
// `report` (optional) receives result records for the briefing; `report.snap` snapshots the player's position.
export function tickOps(s, report = null) {
  const forced = new Set();
  for (const op of s.ops) {
    if (op.status !== 'preparing' && op.status !== 'active') continue;
    const a = op.actor, act = ACTION_BY_ID[op.action];
    if (s.actors[a].collapsed) { finish(s, op, 'stood_down', report, `${NAME(a)}'s ${opName(act)} ended with its collapse.`); continue; }
    if (op.upkeep && op.start !== s.turn) {
      if (s.actors[a].money >= op.upkeep) res(s, a, { money: -op.upkeep });
      else if (op.kind === 'project') { op.stalled = true; report?.({ kind: 'op', phase: 'stalled', actor: a, action: op.action, target: op.target, op: op.id, at: op.at, ok: false, outcome: 'auto', text: `${NAME(a)}'s ${opName(act)} stalled for lack of funds.` }); continue; }
      else { finish(s, op, 'stood_down', report, `${NAME(a)} could no longer fund its ${opName(act)}${tgt(op.target)}.`); continue; }
    }
    op.stalled = false;
    if (op.status === 'preparing') {
      if (act.fragile) {
        const hits = hitsOn(s, op);
        if (hits.length) {
          const big = hits.some((r) => r.action === 'massiveBombing' || r.action === 'offensive');
          if (act.fragile === 'cancel' && big) { try { act.fail(s, a, op.target, 1); } catch { /* content error */ } deriveWorld(s); finish(s, op, 'failed', report, `${NAME(a)}'s ${opName(act)} was wrecked by the attacks on ${NAME(op.at)}.`); continue; }
          op.turnsLeft += big ? 2 : 1;
          report?.({ kind: 'op', phase: 'disrupted', actor: a, action: op.action, target: op.target, op: op.id, at: op.at, ok: false, outcome: 'auto', text: `${NAME(a)}'s ${opName(act)} was set back ${weeks(big ? 2 : 1)} by the attacks on ${NAME(op.at)}.` });
          s.log.push({ turn: s.turn, kind: 'op', text: `${NAME(a)}'s ${opName(act)} was set back by attacks on ${NAME(op.at)}.`, actor: a });
          continue;
        }
      }
      op.turnsLeft -= 1;
      if (op.turnsLeft > 0) continue;
      if (op.kind === 'project') {
        const ok = execute(s, op, report);
        if (FORCE.has(op.action)) forced.add(a);
        finish(s, op, ok ? 'done' : 'failed', null, '');
        continue;
      }
      op.status = 'active';
      if (op.kind === 'deploy') {
        const before = report?.snap?.();
        try { act.success(s, a, op.target, 1); } catch { /* content error */ }
        deriveWorld(s);
        const text = act.say.success.replace('{a}', NAME(a)).replace('{t}', op.target ? NAME(op.target) : '');
        s.recent.push({ turn: s.turn, kind: 'action', actor: a, action: op.action, target: op.target, ok: true, outcome: 'auto', text });
        s.log.push({ turn: s.turn, kind: 'success', text, actor: a });
        report?.({ kind: 'op', phase: 'arrived', actor: a, action: op.action, target: op.target, op: op.id, at: op.at, ok: true, outcome: 'auto', text }, before);
        continue;
      }
    }
    if (op.kind === 'sustained') {
      execute(s, op, report, act.perTurn ?? 1);
      if (FORCE.has(op.action)) forced.add(a);
      op.ran += 1;
      if (op.maxTurns && op.ran >= op.maxTurns) finish(s, op, 'done', report, `${NAME(a)}'s ${opName(act)}${tgt(op.target)} ran its course.`);
    }
  }
  s.ops = s.ops.filter((o) => o.status === 'preparing' || o.status === 'active' || (o.endTurn ?? 0) >= s.turn - 4);
  return forced;
}

// What an operation would do if it went as planned, applied at once on a clone (AI lookahead and effect
// previews). Sustained operations are assumed to run `runs` turns; a failure is one failed turn.
export function simulateOp(c, a, actionId, target, commit = 0, outcome = 'success', runs = 3) {
  const act = ACTION_BY_ID[actionId];
  const dur = act.duration ?? 1;
  const up = act.upkeep?.money ?? 0;
  if (up) res(c, a, { money: -up * (act.op === 'deploy' ? dur + 3 : act.op === 'sustained' ? dur + runs - 1 : dur) });
  const ok = outcome === 'success' || outcome === 'crit';
  if (act.op === 'sustained') { const n = ok ? runs : 1; for (let i = 0; i < n; i++) applyOutcome(c, a, actionId, target, outcome, act.perTurn ?? 1); }
  else applyOutcome(c, a, actionId, target, outcome);
}

// A readable status line for an operation.
export function opStatus(s, op) {
  const act = ACTION_BY_ID[op.action];
  if (op.status === 'preparing') return `${op.stalled ? 'stalled · ' : ''}${op.kind === 'deploy' ? 'arrives' : op.kind === 'project' ? 'completes' : 'begins'} in ${weeks(op.turnsLeft)}`;
  if (op.status === 'active') return op.kind === 'deploy' ? `on station since turn ${op.start + op.duration}` : `running · turn ${op.ran + 1}${op.maxTurns ? ` of ${op.maxTurns}` : ''}`;
  return op.status.replace('_', ' ');
}
export const COMMIT_LABELS = COMMIT.map((c) => c.label);
