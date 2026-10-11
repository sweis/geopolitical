// Balance probe: the AI plays each seat; how often does a competent-but-myopic player win?
// Usage: node tests/verdicts.mjs [seeds=3]
import { ACTORS } from '../src/data/actors.js';
import { newGame, autoTurn, thresholds } from '../src/engine/game.js';
import { goalScore } from '../src/engine/goals.js';
const n = +(process.argv[2] ?? 3);
const tally = { victory: 0, draw: 0, defeat: 0 };
for (const a of ACTORS) {
  const row = [];
  for (let seed = 1; seed <= n; seed++) {
    const s = newGame({ seed: 1000 + seed, player: a.id });
    while (s.phase !== 'over') autoTurn(s);
    tally[s.outcome.result]++;
    row.push(`${{ victory: 'W', draw: 'D', defeat: 'L' }[s.outcome.result]}${goalScore(a, s).toFixed(0)}`);
  }
  const th = thresholds(newGame({ seed: 1, player: a.id }), a.id);
  console.log(`${a.id.padEnd(13)} start ${th.start} need ${th.victory}/${th.metNeeded}  ${row.join(' ')}`);
}
console.log(tally);
