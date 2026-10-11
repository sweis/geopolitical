// Headless AI-vs-AI simulation. Usage: node tests/sim.mjs [games=1] [seed=1] [--verbose]
import { newGame, autoTurn, scores } from '../src/engine/game.js';
import { ACTORS, ACTOR_BY_ID } from '../src/data/actors.js';
import { goalReport } from '../src/engine/goals.js';
const goalAgg = {};

const games = +(process.argv[2] ?? 1), seed0 = +(process.argv[3] ?? 1), verbose = process.argv.includes('--verbose');
const agg = {}; const worldEnd = {}; const actionCounts = {};
const t0 = performance.now();
for (let g = 0; g < games; g++) {
  const s = newGame({ seed: seed0 + g, player: null });
  for (const [k, v] of Object.entries(scores(s))) (agg[k + ':start'] ??= []).push(v);
  while (s.phase !== 'over') {
    autoTurn(s);
    for (const r of s.results) actionCounts[r.action] = (actionCounts[r.action] || 0) + 1;
    if (verbose) {
      console.log(`T${s.turn} oil=$${s.world.oil} hormuz=${s.world.hormuz} redSea=${s.world.redSea} nuke=${s.world.iranNuclear} war=${s.world.warIntensity} gaza=${s.world.gazaCeasefire} isis=${s.world.isisStrength}`);
      for (const r of s.results) console.log(`   ${r.outcome.padEnd(8)} p=${r.p} roll=${r.roll} ${r.text}`);
      for (const n of s.news) console.log(`   EVENT ${n.text}`);
    }
  }
  for (const a of ACTORS) for (const g of goalReport(a, s)) (goalAgg[a.id + ' / ' + g.name] ??= []).push(g.progress);
  const sc = scores(s);
  for (const [k, v] of Object.entries(sc)) (agg[k] ??= []).push(v);
  for (const [k, v] of Object.entries(s.world)) (worldEnd[k] ??= []).push(v);
  for (const a of Object.values(s.actors)) if (a.collapsed) (agg[a.id + ':collapsed'] ??= []).push(1);
}
const ms = performance.now() - t0;
const mean = (a) => (a.reduce((n, x) => n + x, 0) / a.length).toFixed(1);
console.log(`\n${games} games in ${ms.toFixed(0)} ms (${(ms / games).toFixed(0)} ms/game)`);
console.log('Mean final score:'); for (const a of ACTORS) console.log(`  ${a.id.padEnd(13)} start ${mean(agg[a.id + ':start'])} → ${mean(agg[a.id])}  min ${Math.min(...agg[a.id]).toFixed(0)} max ${Math.max(...agg[a.id]).toFixed(0)}  collapsed ${(agg[a.id + ':collapsed'] || []).length}`);
console.log('Mean final world:', Object.fromEntries(Object.entries(worldEnd).map(([k, v]) => [k, +mean(v)])));
console.log('Action frequency:', Object.entries(actionCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
if (process.argv.includes('--goals')) for (const [k, v] of Object.entries(goalAgg)) console.log(`  ${mean(v)}  ${k}`);
