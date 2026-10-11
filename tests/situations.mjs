// Content probe for the situation deck: the AI plays every seat; we count cards dealt per turn,
// which situations ever fire, and any content errors the director swallowed.
// Usage: node tests/situations.mjs [gamesPerActor=2]
import { newGame, autoTurn } from '../src/engine/game.js';
import { ACTORS } from '../src/data/actors.js';
import { DIRECTOR_ERRORS } from '../src/engine/director.js';
import { SITUATIONS, appliesTo } from '../src/data/situations/index.js';

const games = +(process.argv[2] ?? 2);
let failures = 0;
const everFired = new Set();
console.log('actor         turns  cards/turn  no-card turns  distinct  pool  intel/turn');
for (const a of ACTORS) {
  let turns = 0, cards = 0, none = 0, intel = 0;
  const seen = new Set();
  for (let g = 0; g < games; g++) {
    const s = newGame({ seed: 500 + g, player: a.id });
    while (s.phase !== 'over') {
      const regular = s.situations.filter((x) => x.kind !== 'intel');
      turns++; cards += regular.length; if (!regular.length) none++;
      if (s.situations.some((x) => x.kind === 'intel')) intel++;
      for (const x of regular) { seen.add(x.id); everFired.add(x.id); }
      for (const x of s.situations) {
        if (x.options.length < 2) { failures++; console.log(`FAIL  ${x.id} has ${x.options.length} options`); }
        if (!x.options.some((o) => o.default)) { failures++; console.log(`FAIL  ${x.id} has no default option`); }
        if (!x.options.some((o) => o.affordable)) { failures++; console.log(`FAIL  ${x.id} has no affordable option`); }
        if (!x.title || !x.text) { failures++; console.log(`FAIL  ${x.id} missing title/text`); }
      }
      autoTurn(s);
    }
  }
  const pool = SITUATIONS.filter((d) => appliesTo(d, a.id)).length;
  console.log(`${a.id.padEnd(13)} ${String(turns).padStart(5)}  ${(cards / turns).toFixed(2).padStart(10)}  ${String(none).padStart(13)}  ${String(seen.size).padStart(8)}  ${String(pool).padStart(4)}  ${(intel / turns).toFixed(2).padStart(10)}`);
}
const never = SITUATIONS.filter((d) => !everFired.has(d.id)).map((d) => d.id);
console.log(`\nnever fired (${never.length}): ${never.join(' ')}`);
const errs = [...new Set(DIRECTOR_ERRORS.map((e) => `${e.where} ${e.id}: ${e.message}`))];
console.log(`\ncontent errors: ${errs.length}`);
for (const e of errs.slice(0, 30)) console.log('  ' + e);
if (errs.length) failures++;
console.log(failures ? `\n${failures} FAILED` : '\nsituation probe passed');
process.exit(failures ? 1 : 0);
