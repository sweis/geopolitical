// Policy probe: does always using force pay? Plays fixed policies for a seat across seeds and compares.
//   force – on every card pick the most forceful affordable option; initiative = strikes/bombing when possible
//   talk  – pick the most diplomatic option; initiative = talks/escorts/aid/ceasefires
//   ai    – the utility-maximizing AI (balanced)
// Usage: node tests/policies.mjs [seeds=5] [actors=us,israel,iran]
import { newGame, endTurn, choose, setInitiative, autoTurn, thresholds } from '../src/engine/game.js';
import { ACTOR_BY_ID } from '../src/data/actors.js';
import { ACTION_BY_ID, affordable } from '../src/engine/actions.js';
import { goalScore } from '../src/engine/goals.js';

const seeds = +(process.argv[2] ?? 5);
const actors = (process.argv[3] ?? 'us,israel,iran').split(',');
const FORCE = ['massiveBombing', 'strike', 'offensive', 'harass', 'decapitation'];
const TALK = ['talks', 'ceasefire', 'escort', 'reliefGaza', 'deployISF', 'disarm', 'normalize', 'bankroll', 'invest', 'unResolution'];
const FORCE_RE = /strike|retaliat|escalat|bomb|hunt|attack|hit |crush|seize|seal|crack|press|push|operation|salvo|rocket|missile|drone|counter|fire|resume|full campaign|launchers|sweep|storm|arm|reinforce|harden|demand|defy|double|unconditional|bill|reject|refuse/i;
const TALK_RE = /talk|negotiat|accept|terms|deal|channel|mediat|offer|envoy|withdraw|restrain|comply|pause|de-escalat|hotline|appeal|lobby|freeze|concede|conditions|host|relay|aid|fund|pay|share|quiet|wait|hold|truce|ceasefire|summit|verif|hand over|handover/i;
const PREF_TARGETS = { us: ['nuclearSites', 'tehran', 'hormuz'], israel: ['nuclearSites', 'southLebanon', 'gaza', 'tehran'], iran: ['gulfBases', 'israelHome', 'hormuz'] };

function pickOption(sit, re, preferActions) {
  const ok = sit.options.filter((o) => o.affordable);
  const scored = ok.map((o) => ({ o, w: (o.action && preferActions.includes(o.action) ? 3 : 0) + (re.test(`${o.id} ${o.label}`) ? 2 : 0) - (o.default ? 1 : 0) }));
  scored.sort((a, b) => b.w - a.w);
  return scored[0]?.o.id ?? null;
}
function pickInitiative(s, p, list) {
  for (const id of list) {
    const act = ACTION_BY_ID[id];
    if (!act || (act.who !== 'ALL' && act.who !== 'NONSTATE' && !act.who.includes(p)) || !affordable(s, p, act, 0)) continue;
    const targets = act.targets(s, p);
    if (!targets.length) continue;
    const pref = (PREF_TARGETS[p] ?? []).find((t) => targets.includes(t));
    return { action: id, target: pref ?? targets[0] };
  }
  return null;
}
function play(p, seed, policy) {
  const s = newGame({ seed, player: p });
  let forceTurns = 0;
  while (s.phase !== 'over') {
    if (policy === 'ai') { autoTurn(s); continue; }
    const re = policy === 'force' ? FORCE_RE : TALK_RE;
    const pref = policy === 'force' ? FORCE : TALK;
    for (const sit of s.situations) { const id = pickOption(sit, re, pref); if (id) choose(s, sit.id, id); }
    const init = pickInitiative(s, p, pref);
    if (init) { try { setInitiative(s, init.action, init.target, 0); if (FORCE.includes(init.action)) forceTurns++; } catch { /* hold */ } }
    endTurn(s);
  }
  return { score: goalScore(ACTOR_BY_ID[p], s), result: s.outcome.result, world: s.world, me: s.actors[p], forceTurns, turns: s.turn };
}

for (const p of actors) {
  console.log(`\n${ACTOR_BY_ID[p].name}  (start ${thresholds(newGame({ seed: 1, player: p }), p).start}, win ${thresholds(newGame({ seed: 1, player: p }), p).victory})`);
  console.log('policy  mean  W/D/L     oil  war  Hormuz  breakout  USsupport  stab  mil   force-turns');
  for (const policy of ['force', 'talk', 'ai']) {
    const rs = [];
    for (let i = 0; i < seeds; i++) rs.push(play(p, 2000 + i, policy));
    const m = (f) => (rs.reduce((n, r) => n + f(r), 0) / rs.length).toFixed(0);
    const tally = ['victory', 'draw', 'defeat'].map((k) => rs.filter((r) => r.result === k).length).join('/');
    console.log(`${policy.padEnd(6)} ${m((r) => r.score).padStart(5)}  ${tally.padEnd(8)} ${m((r) => r.world.oil).padStart(4)} ${m((r) => r.world.warIntensity).padStart(4)} ${m((r) => r.world.hormuz).padStart(7)} ${m((r) => r.world.iranNuclear).padStart(9)} ${m((r) => r.world.usWarSupport).padStart(10)} ${m((r) => r.me.stability).padStart(5)} ${m((r) => r.me.military).padStart(4)}   ${m((r) => r.forceTurns)}`);
  }
}
