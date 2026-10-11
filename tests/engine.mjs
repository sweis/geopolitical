// Engine checks in Node: content probes over the registries, a scripted player turn through the
// engine API, invariants over full AI games, determinism.
import { ACTORS, ACTOR_BY_ID } from '../src/data/actors.js';
import { THEATERS, THEATER_BY_ID, ANCHORS } from '../src/data/theaters.js';
import { EVENTS, THRESHOLDS } from '../src/data/events.js';
import { MAP_W, MAP_H, project } from '../src/data/map.js';
import { ACTIONS, canUse } from '../src/engine/actions.js';
import { newGame, autoTurn, scores, choose, setInitiative, endTurn, playerMenu, previewInitiative, proposals } from '../src/engine/game.js';
import { evaluate } from '../src/engine/adjudicate.js';
import { SITUATIONS } from '../src/data/situations/index.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log(`FAIL  ${msg}`); } else console.log(`PASS  ${msg}`); };
const finite = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? (() => { throw new Error(`non-finite ${k}`); })() : v));

// ── content probes ──
ok(THEATERS.every((t) => { const [x, y] = project(t.lon, t.lat); return x > 0 && x < MAP_W && y > 0 && y < MAP_H; }), 'every theater projects inside the map');
ok(THEATERS.every((t) => t.adj.every((n) => THEATER_BY_ID[n]?.adj.includes(t.id))), 'theater adjacency is symmetric and resolves');
ok(THEATERS.every((t) => ACTOR_BY_ID[t.controller] && Object.keys(t.infl).every((a) => ACTOR_BY_ID[a])), 'theater controllers and influence keys resolve to actors');
ok(ACTORS.every((a) => a.home === null ? !!ANCHORS[a.id] : !!THEATER_BY_ID[a.home]), 'every actor has a home theater or map anchor');
ok(ACTORS.every((a) => a.goals.length >= 3), 'every actor has at least 3 goals');
ok(ACTIONS.every((x) => x.who === 'ALL' || x.who === 'NONSTATE' || x.who.every((id) => ACTOR_BY_ID[id])), 'every action who-list resolves');
ok(EVENTS.concat(THRESHOLDS).every((e) => THEATER_BY_ID[e.at]), 'every event location resolves to a theater');
ok(SITUATIONS.every((d) => d.id && d.kind && typeof d.when === 'function' && typeof d.options === 'function' && (Array.isArray(d.who) ? d.who.every((id) => ACTOR_BY_ID[id]) : true)), `${SITUATIONS.length} situation definitions are well-formed`);
{
  const s = newGame({ seed: 1, player: null });
  for (const a of ACTORS) {
    const usable = ACTIONS.filter((x) => canUse(x, a.id));
    ok(usable.length >= 6, `${a.id}: ${usable.length} actions available`);
    for (const g of a.goals) { const p = g.progress(s); if (!(p >= 0 && p <= 1)) ok(false, `${a.id} goal ${g.name} progress ${p}`); }
    for (const x of usable) for (const t of x.targets(s, a.id)) {
      if (t !== null && !THEATER_BY_ID[t] && !ACTOR_BY_ID[t]) ok(false, `${x.id} target ${t} does not resolve`);
      const ev = evaluate(s, a.id, x.id, t, 0);
      if (!(ev.p >= 0.05 && ev.p <= 0.95)) ok(false, `${a.id} ${x.id} ${t} p=${ev.p}`);
    }
  }
  ok(true, 'all action targets resolve and probabilities clamp to [0.05, 0.95] at start');
  const start = scores(s);
  ok(ACTORS.every((a) => start[a.id] > 15 && start[a.id] < 75), `starting scores in a playable band: ${ACTORS.map((a) => `${a.id}=${start[a.id].toFixed(0)}`).join(' ')}`);
}

// ── a scripted player turn through the engine API ──
{
  const s = newGame({ seed: 4, player: 'iran' });
  ok(s.phase === 'turn' && s.turn === 1, 'new game opens on turn 1 in the turn phase');
  ok(Object.keys(s.declared).length === ACTORS.length - 1, 'every other actor declared before the player moves');
  ok(s.situations.length >= 1 && s.situations.every((x) => x.options.length >= 2 && x.options.some((o) => o.default)), `situation cards dealt: ${s.situations.map((x) => x.id).join(', ')}`);
  const menu = playerMenu(s);
  ok(menu.some((m) => m.id === 'harass' && m.affordable), 'Iran can attack shipping on turn 1');
  const props = proposals(s);
  ok(props.length >= 3 && props.every((x) => x.band && x.cost), `advisers propose ${props.length} initiatives: ${props.map((x) => x.action).join(', ')}`);
  const pv = previewInitiative(s, 'harass', 'hormuz', 0);
  ok(pv.p >= 0.05 && pv.p <= 0.95 && Array.isArray(pv.args), `initiative preview p=${pv.p} (${pv.band}), expected arguments: ${pv.args.length}`);
  const card = s.situations.find((x) => x.kind !== 'intel');
  const pick = card.options.find((o) => o.affordable && !o.default) ?? card.options[0];
  choose(s, card.id, pick.id);
  setInitiative(s, 'harass', 'hormuz', 0);
  const before = s.world.hormuz;
  endTurn(s);
  ok(s.turn === 2 && s.phase === 'turn', 'endTurn resolves and deals turn 2');
  const b = s.briefing;
  ok(b && b.mine.some((r) => r.kind === 'situation' && r.id === card.id && r.option === pick.id), `briefing records the card answer (${card.id} → ${pick.id})`);
  ok(b.mine.some((r) => r.kind === 'action' && r.action === 'harass'), 'briefing records the initiative');
  ok(b.affecting.length + b.elsewhere.length === ACTORS.length - 1 - (s.actors.iran.collapsed ? 1 : 0) || b.affecting.length + b.elsewhere.length >= 15, `AI results split into affecting (${b.affecting.length}) and elsewhere (${b.elsewhere.length})`);
  ok(b.affecting.length < 8, 'the relevance filter keeps the affecting list short');
  ok(s.recent.some((r) => r.kind === 'action' && r.actor === 'iran'), 'recent history records the resolved action');
  ok(Number.isFinite(s.world.hormuz), `Hormuz moved ${before} → ${s.world.hormuz}`);
  ok(s.history.length === 2, 'one history snapshot per completed turn');
}

// ── full AI games: invariants and determinism ──
function play(seed, player = null) {
  const s = newGame({ seed, player });
  while (s.phase !== 'over') autoTurn(s);
  return s;
}
for (const seed of [1, 2, 3]) {
  const s = play(seed);
  ok(s.turn === s.maxTurns && s.outcome?.result === 'complete', `seed ${seed}: observer game reaches turn ${s.maxTurns}`);
  try { finite(s); ok(true, `seed ${seed}: no NaN/Infinity anywhere in state`); } catch (e) { ok(false, `seed ${seed}: ${e.message}`); }
  ok(Object.values(s.world).every((v) => v >= -25 && v <= 200), `seed ${seed}: world values in range`);
  ok(Object.values(s.actors).every((a) => a.stability >= 0 && a.stability <= 100 && a.military >= 0 && a.money >= 0), `seed ${seed}: actor resources in range`);
  ok(s.history.length === s.maxTurns + 1, `seed ${seed}: one history snapshot per turn`);
}
{
  const a = play(42, 'turkey'), b = play(42, 'turkey');
  ok(JSON.stringify(a) === JSON.stringify(b), 'determinism: same seed replays identically');
  const c = play(43, 'turkey');
  ok(JSON.stringify(a.world) !== JSON.stringify(c.world), 'different seed diverges');
  ok(['victory', 'draw', 'defeat'].includes(a.outcome.result), `player game ends with a verdict (${a.outcome.result}: ${a.outcome.reason})`);
  const fired = new Set(a.recent.map((r) => r.kind === 'situation' && r.id).filter(Boolean));
  ok(a.log.filter((l) => l.kind === 'success' || l.kind === 'fail').length > 0, 'log carries narrated results');
  ok(fired.size >= 1 || a.log.some((l) => l.actor === 'turkey'), 'the AI-played seat answered situation cards');
}

console.log(failures ? `\n${failures} FAILED` : '\nall engine checks passed');
process.exit(failures ? 1 : 0);
