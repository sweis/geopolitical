// The action catalogue. Each action is a matrix-game "argument" an actor can make:
// a cost, a base likelihood, situational modifiers (the GM's reasons for and against),
// and deterministic effects for success (m = 1, or 1.5 on an exceptional roll) and failure.
import { ACTOR_BY_ID } from '../data/actors.js';
import { THEATER_BY_ID } from '../data/theaters.js';
import { W, res, tension, infl, rel, relAdd, hostiles, homeOf } from './state.js';

const NAME = (id) => ACTOR_BY_ID[id]?.name ?? THEATER_BY_ID[id]?.name ?? id;
const T = (s, t) => s.theaters[t];
const A = (s, id) => s.actors[id];
const isNonstate = (id) => ACTOR_BY_ID[id].kind === 'nonstate';
const isState = (id) => !isNonstate(id);
const BIG = ['us', 'china', 'russia', 'eu'];

// Theaters an actor can reach on the ground: home, its neighbours, and anywhere it already has forces.
function reach(s, a) {
  const home = homeOf(a);
  const out = new Set();
  if (home) { out.add(home); for (const n of THEATER_BY_ID[home].adj) out.add(n); }
  for (const t of Object.values(s.theaters)) if ((t.infl[a] || 0) >= 10) out.add(t.id);
  return [...out];
}

const mod = (cond, text, d) => (cond ? [{ text, d }] : []);

export const ACTIONS = [
  // ───────────────────────── MILITARY ─────────────────────────
  {
    id: 'strike', name: 'Air & missile strikes', cat: 'military', target: 'theater',
    who: ['us', 'israel', 'iran', 'turkey', 'saudi', 'russia', 'syria', 'houthis', 'hezbollah', 'iraqMilitias', 'hamas', 'pij'],
    cost: { money: 6, military: 6, political: 1 }, base: 0.55,
    desc: 'Strike hostile forces in a theater. Degrades their strength; raises tension. Effects depend on the target.',
    targets: (s, a) => Object.keys(s.theaters).filter((t) => t !== homeOf(a) && hostiles(s, a, t).length),
    mods: (s, a, t) => {
      const ctrl = THEATER_BY_ID[t].controller;
      const air = ['us', 'israel'].includes(a);
      return [
        ...mod(air, 'Air superiority and precision munitions', 0.15),
        ...mod(['houthis', 'hezbollah', 'iraqMilitias', 'hamas', 'pij', 'iran'].includes(a), 'Missile and drone salvos face layered air defenses', -0.05),
        ...mod(ctrl !== a && A(s, ctrl)?.military >= 60, `${NAME(ctrl)} defends with strong forces`, -0.1),
        ...mod(T(s, t).tension >= 70, 'Forces already in contact; targets well mapped', 0.05),
        ...mod(a === 'us' && s.world.usWarSupport < 35, 'War-weary public limits rules of engagement', -0.05),
        ...mod(a === 'iran' && A(s, 'iran').military < 30, 'Launchers depleted by months of strikes', -0.1),
        ...mod(t === 'nuclearSites' && s.world.iranNuclear <= 40, 'Remaining material is dispersed and buried deep', -0.15),
      ];
    },
    success: (s, a, t, m) => {
      for (const h of hostiles(s, a, t)) { res(s, h, { military: -6 * m }); infl(s, t, h, -6 * m); relAdd(s, a, h, -5); }
      tension(s, t, 12);
      switch (t) {
        case 'nuclearSites': W(s, 'iranNuclear', -Math.max(2, 0.16 * s.world.iranNuclear) * m); res(s, 'iran', { stability: -3 }); W(s, 'warIntensity', 8); break;
        case 'tehran': res(s, 'iran', { stability: -8 * m, military: -4 }); W(s, 'warIntensity', 12); break;
        case 'hormuz': W(s, 'hormuz', 6 * m); W(s, 'warIntensity', 6); break;
        case 'israelHome': res(s, 'israel', { stability: -5 * m }); W(s, 'warIntensity', 6); break;
        case 'gulfBases': res(s, 'us', { military: -4 * m }); W(s, 'usWarSupport', -3); W(s, 'hormuz', -5); W(s, 'warIntensity', 8); break;
        case 'riyadh': res(s, 'saudi', { stability: -6 * m }); W(s, 'yemenWar', 8); W(s, 'oilAdj', 3); break;
        case 'gaza': W(s, 'gazaCeasefire', -18); W(s, 'humanitarian', -8); res(s, a, { political: -1 }); break;
        case 'southLebanon': res(s, 'lebanon', { stability: -3 }); break;
        case 'northYemen': W(s, 'yemenWar', 4); W(s, 'redSea', 4 * m); break;
        case 'babElMandeb': W(s, 'redSea', 8 * m); break;
        case 'redSea': W(s, 'redSea', -8 * m); break;
        case 'neSyria': W(s, 'kurdishAutonomy', -6 * m); W(s, 'isisStrength', 3); break;
        case 'kurdistan': res(s, 'krg', { stability: -5 * m }); break;
        case 'badiya': W(s, 'isisStrength', -8 * m); break;
        case 'baghdad': res(s, 'iraqMilitias', { stability: -4 * m }); break;
      }
      if (a === 'iran' || ['tehran', 'nuclearSites', 'hormuz'].includes(t)) W(s, 'warIntensity', 3);
    },
    fail: (s, a, t, m) => { res(s, a, { political: -1, military: -2 * m }); tension(s, t, 5); },
    say: { success: '{a} hit targets in {t}.', fail: '{a}\'s strikes on {t} were largely intercepted or missed.' },
  },
  {
    id: 'massiveBombing', name: 'Massive bombing campaign', cat: 'military', target: 'theater',
    who: ['us'], cost: { money: 15, military: 14, political: 3 }, base: 0.65,
    desc: 'Resume major combat operations against Iran: B-2s, carrier wings and Tomahawks. Big effects, big domestic cost.',
    targets: () => ['tehran', 'nuclearSites', 'hormuz'],
    mods: (s) => [
      ...mod(s.world.usWarSupport < 35, 'Congress and the public are souring on the war', -0.1),
      ...mod(A(s, 'iran').military < 35, 'Iranian air defenses already shattered', 0.1),
      ...mod(rel(s, 'iran', 'russia') > 60, 'Russian-supplied systems complicate the campaign', -0.05),
    ],
    success: (s, a, t, m) => {
      res(s, 'iran', { military: -12 * m, stability: -10 * m });
      W(s, 'warIntensity', 20); W(s, 'usWarSupport', -5); W(s, 'oilAdj', 4);
      if (t === 'nuclearSites') W(s, 'iranNuclear', -25 * m);
      if (t === 'hormuz') { W(s, 'hormuz', 22 * m); infl(s, 'hormuz', 'iran', -20 * m); infl(s, 'hormuz', 'us', 10); }
      if (t === 'tehran') { res(s, 'iran', { stability: -6 * m, political: -2 }); }
      tension(s, t, 20);
    },
    fail: (s, a, t, m) => { res(s, 'us', { military: -8 * m }); W(s, 'usWarSupport', -8 * m); W(s, 'warIntensity', 12); },
    say: { success: 'The United States launched a massive bombing campaign against {t}.', fail: 'The US campaign against {t} stalled; aircraft were lost and Iran claimed victory.' },
  },
  {
    id: 'offensive', name: 'Ground offensive', cat: 'military', target: 'theater',
    who: ['israel', 'turkey', 'syria', 'sdf', 'krg', 'iraqMilitias', 'hezbollah', 'hamas', 'isis', 'saudi', 'houthis', 'egypt'],
    cost: { money: 8, military: 12, political: 1 }, base: 0.5,
    desc: 'Seize ground. Shifts influence in the theater and degrades hostile forces, at heavy cost.',
    targets: (s, a) => reach(s, a).filter((t) => hostiles(s, a, t).length),
    mods: (s, a, t) => {
      const hs = hostiles(s, a, t);
      const enemy = Math.max(...hs.map((h) => A(s, h).military));
      const ratio = A(s, a).military / Math.max(enemy, 1);
      return [
        ...mod(ratio >= 2, 'Overwhelming force advantage', 0.15),
        ...mod(ratio >= 1.2 && ratio < 2, 'Favourable balance of forces', 0.05),
        ...mod(ratio < 0.8, 'Outgunned by the defenders', -0.15),
        ...mod((T(s, t).infl[a] || 0) >= 40, 'Forces already established in the area', 0.05),
        ...mod(t === 'gaza' && s.world.isfDeployed >= 40, 'International troops on the ground complicate operations', -0.1),
      ];
    },
    success: (s, a, t, m) => {
      const hs = hostiles(s, a, t);
      for (const h of hs) { infl(s, t, h, -15 * m); res(s, h, { military: -8 * m }); relAdd(s, a, h, -8); }
      infl(s, t, a, 18 * m); tension(s, t, 12);
      if (t === 'gaza' && a === 'israel') { W(s, 'hamasDisarm', 6 * m); W(s, 'gazaCeasefire', -20); W(s, 'humanitarian', -10); res(s, a, { political: -1 }); }
      if (t === 'southLebanon' && a === 'israel') { W(s, 'hezbollahDisarm', 5 * m); res(s, 'lebanon', { stability: -4 }); }
      if (t === 'neSyria' && (a === 'turkey' || a === 'syria')) { W(s, 'kurdishAutonomy', -12 * m); if (a === 'turkey') W(s, 'isisStrength', 3); }
      if (hs.includes('isis')) W(s, 'isisStrength', -10 * m);
      if (a === 'isis') W(s, 'isisStrength', 8 * m);
      if (t === 'northYemen' || t === 'riyadh') W(s, 'yemenWar', 10);
      const ctrl = THEATER_BY_ID[t].controller;
      if (ctrl !== a && hs.includes(ctrl)) res(s, ctrl, { stability: -5 * m });
    },
    fail: (s, a, t, m) => { res(s, a, { military: -8 * m, stability: -4 * m }); tension(s, t, 8); },
    say: { success: '{a} forces advanced in {t}.', fail: '{a}\'s offensive in {t} was repulsed with heavy losses.' },
  },
  {
    id: 'harass', name: 'Attack shipping', cat: 'military', target: 'theater',
    who: ['iran', 'houthis'], cost: { money: 2, military: 4, political: 0 }, base: 0.7,
    desc: 'Mines, drones and boarding parties against commercial shipping. Leverage through pain at the pump.',
    targets: (s, a) => (a === 'iran' ? ['hormuz'] : ['babElMandeb', 'redSea']),
    mods: (s, a, t) => [
      ...mod((T(s, t).infl.us || 0) >= 50, 'US naval escorts on station', -0.15),
      ...mod((T(s, t).infl.eu || 0) + (T(s, t).infl.china || 0) >= 30, 'European and Chinese warships escorting convoys', -0.05),
      ...mod((T(s, t).infl[a] || 0) >= 50, 'Controls the coastline', 0.1),
    ],
    success: (s, a, t, m) => {
      W(s, t === 'hormuz' ? 'hormuz' : 'redSea', -12 * m); tension(s, t, 10); infl(s, t, a, 4);
      res(s, a, { political: 1 }); res(s, 'eu', { stability: -1 }); relAdd(s, a, 'china', -6); relAdd(s, a, 'eu', -5);
    },
    fail: (s, a, t, m) => { res(s, a, { military: -4 * m }); infl(s, t, a, -4); },
    say: { success: '{a} attacks on shipping in {t} sent insurers fleeing.', fail: '{a}\'s attack boats in {t} were destroyed before reaching targets.' },
  },
  {
    id: 'escort', name: 'Naval escort operation', cat: 'military', target: 'theater',
    who: ['us', 'eu', 'china', 'saudi', 'egypt', 'turkey', 'russia'], cost: { money: 6, military: 5, political: 1 }, base: 0.55,
    desc: 'Convoy and mine-clearing operations to restore commercial traffic through a chokepoint.',
    targets: () => ['hormuz', 'babElMandeb', 'redSea'],
    mods: (s, a, t) => {
      const foe = t === 'hormuz' ? 'iran' : 'houthis';
      return [
        ...mod(a === 'us', 'The world\'s largest navy', 0.15),
        ...mod((T(s, t).infl[foe] || 0) >= 50, `${NAME(foe)} dominates the coastline`, -0.15),
        ...mod(s.world.warIntensity >= 60 && t === 'hormuz', 'Shipowners will not sail into an active war zone', -0.1),
        ...mod(A(s, foe).military < 25, `${NAME(foe)} capabilities degraded`, 0.1),
        ...mod(a === 'china' && t === 'hormuz', 'Tehran is reluctant to fire on Chinese hulls', 0.1),
      ];
    },
    success: (s, a, t, m) => { W(s, t === 'hormuz' ? 'hormuz' : 'redSea', 8 * m); infl(s, t, a, 10); tension(s, t, -4); },
    fail: (s, a, t, m) => { res(s, a, { military: -5 * m }); if (a === 'us') W(s, 'usWarSupport', -3); tension(s, t, 6); },
    say: { success: '{a} escorted convoys safely through {t}.', fail: 'An escort mission by {a} in {t} was hit; traffic did not recover.' },
  },
  {
    id: 'armProxy', name: 'Arm & fund a partner', cat: 'military', target: 'actor',
    who: ['us', 'iran', 'russia', 'turkey', 'saudi', 'eu', 'israel', 'china'], cost: { money: 8, military: 0, political: 1 }, base: 0.75,
    desc: 'Ship weapons, money and advisers to a friendly force.',
    targets: (s, a) => Object.keys(s.actors).filter((b) => b !== a && !s.actors[b].collapsed && rel(s, a, b) >= 40 && !BIG.includes(b)),
    mods: (s, a, b) => [
      ...mod(a === 'iran' && b === 'hezbollah', 'The Syrian land bridge is gone', -0.15),
      ...mod(a === 'iran' && (b === 'hamas' || b === 'pij'), 'Gaza is sealed', -0.25),
      ...mod(a === 'iran' && b === 'houthis', 'Red Sea smuggling routes are interdicted', -0.05),
      ...mod(a === 'iran' && s.world.iranSanctions >= 80, 'Blockade strains Iranian logistics', -0.05),
      ...mod(a === 'us', 'Unmatched logistics', 0.1),
    ],
    success: (s, a, b, m) => {
      res(s, b, { military: 10 * m, money: 3 * m }); relAdd(s, a, b, 8);
      const h = homeOf(b); if (h) infl(s, h, a, 5);
      if (a === 'russia' && b === 'iran') W(s, 'warIntensity', 3);
    },
    fail: (s, a, b) => { res(s, a, { political: -1 }); },
    say: { success: '{a} delivered weapons and cash to {t}.', fail: 'An arms shipment from {a} to {t} was intercepted.' },
  },
  {
    id: 'decapitation', name: 'Targeted killing', cat: 'covert', target: 'actor',
    who: ['us', 'israel', 'iran', 'turkey'], cost: { money: 4, military: 2, political: 2 }, base: 0.4,
    desc: 'Kill a commander or leader. Destabilises the target; invites retaliation.',
    targets: (s, a) => Object.keys(s.actors).filter((b) => b !== a && !s.actors[b].collapsed && rel(s, a, b) <= -50 && !BIG.includes(b)),
    mods: (s, a, b) => [
      ...mod(a === 'israel', 'Deep intelligence penetration', 0.2),
      ...mod(a === 'us', 'Global ISR network', 0.1),
      ...mod(isNonstate(b), 'Leaders move in small circles', 0.05),
      ...mod(A(s, b).stability >= 60, 'Target security services are cohesive', -0.05),
    ],
    success: (s, a, b, m) => {
      res(s, b, { stability: -14 * m, political: -2, military: -3 }); relAdd(s, a, b, -15);
      const h = homeOf(b); if (h) tension(s, h, 15);
      if (b === 'hamas' || b === 'pij') W(s, 'gazaCeasefire', -10);
      if (b === 'iran') W(s, 'warIntensity', 10);
    },
    fail: (s, a, b) => { res(s, a, { political: -2 }); relAdd(s, a, b, -10); },
    say: { success: '{a} killed a senior {t} figure.', fail: 'A plot by {a} against {t} was exposed.' },
  },
  {
    id: 'hold', name: 'Hold and consolidate', cat: 'domestic', target: 'none', who: 'ALL',
    cost: { money: 0, military: 0, political: 0 }, base: 0.95,
    desc: 'Make no major move this turn. Bank resources and political capital.',
    targets: () => [null], mods: () => [],
    success: (s, a) => res(s, a, { political: 1, money: 2 }),
    fail: () => {},
    say: { success: '{a} kept its powder dry.', fail: '{a} kept its powder dry.' },
  },
  {
    id: 'fortify', name: 'Mobilize & fortify', cat: 'military', target: 'none', who: 'ALL',
    cost: { money: 5, military: 0, political: 0 }, base: 0.85,
    desc: 'Call up reserves, disperse assets, harden defenses.',
    targets: () => [null], mods: () => [],
    success: (s, a, t, m) => res(s, a, { military: 8 * m, stability: 2 }),
    fail: () => {},
    say: { success: '{a} mobilized and dug in.', fail: '{a}\'s mobilization was mired in shortages.' },
  },
  {
    id: 'terror', name: 'Terror attack', cat: 'military', target: 'theater', who: ['isis'],
    cost: { money: 2, military: 3, political: 0 }, base: 0.55,
    desc: 'Suicide bombings and raids. Feeds the brand; hits the defender\'s stability.',
    targets: (s) => Object.keys(s.theaters).filter((t) => t !== 'badiya'),
    mods: (s, a, t) => {
      const ctrl = THEATER_BY_ID[t].controller;
      const ct = ['us', 'sdf', 'krg', 'israel'].reduce((n, x) => n + (T(s, t).infl[x] || 0), 0);
      return [
        ...mod(A(s, ctrl).stability < 45, `${NAME(ctrl)} security is fraying`, 0.1),
        ...mod(ct >= 50, 'Heavy counter-terror presence', -0.15),
        ...mod(s.world.isisStrength >= 50, 'Networks are rebuilt and flush with recruits', 0.1),
      ];
    },
    success: (s, a, t, m) => {
      const ctrl = THEATER_BY_ID[t].controller;
      W(s, 'isisStrength', 6 * m); res(s, ctrl, { stability: -7 * m }); tension(s, t, 15); res(s, a, { political: 2 });
    },
    fail: (s, a, t, m) => { res(s, a, { military: -4 * m }); W(s, 'isisStrength', -3); },
    say: { success: 'ISIS struck {t} in a mass-casualty attack.', fail: 'An ISIS cell targeting {t} was rolled up.' },
  },
  {
    id: 'prisonBreak', name: 'Prison break', cat: 'military', target: 'theater', who: ['isis'],
    cost: { money: 1, military: 4, political: 0 }, base: 0.35,
    desc: 'Storm a detention camp. Thousands of veteran fighters back in the field.',
    targets: () => ['neSyria', 'baghdad'],
    mods: (s, a, t) => [
      ...mod(t === 'neSyria' && A(s, 'sdf').stability < 45, 'SDF guards are stretched and unpaid', 0.15),
      ...mod(T(s, t).tension >= 60, 'Guards distracted by wider fighting', 0.1),
      ...mod(t === 'baghdad', 'Detainees moved to hardened Iraqi prisons', -0.1),
    ],
    success: (s, a, t, m) => { W(s, 'isisStrength', 14 * m); res(s, 'isis', { military: 10 * m }); res(s, THEATER_BY_ID[t].controller, { stability: -6 }); tension(s, t, 12); },
    fail: (s, a, t, m) => { res(s, 'isis', { military: -6 * m }); },
    say: { success: 'ISIS broke thousands of fighters out of prisons in {t}.', fail: 'An ISIS assault on a prison in {t} was beaten back.' },
  },
  {
    id: 'counterTerror', name: 'Counter-ISIS operations', cat: 'military', target: 'theater',
    who: ['us', 'sdf', 'krg', 'syria', 'turkey', 'iraqMilitias', 'israel', 'egypt', 'saudi', 'russia'],
    cost: { money: 4, military: 4, political: 0 }, base: 0.6,
    desc: 'Raids and strikes against ISIS cells.',
    targets: (s, a) => ['badiya', 'neSyria', 'baghdad', 'kurdistan', 'sinai'].filter((t) => ['us', 'russia', 'israel'].includes(a) || reach(s, a).includes(t)),
    mods: (s, a) => [
      ...mod(a === 'us', 'US intelligence and special forces', 0.15),
      ...mod((a === 'sdf' || a === 'krg') && (T(s, 'neSyria').infl.us || 0) < 10, 'No US air cover since the drawdown', -0.1),
      ...mod(s.world.isisStrength >= 55, 'ISIS has gone to ground in strength', -0.05),
    ],
    success: (s, a, t, m) => { W(s, 'isisStrength', -9 * m); res(s, 'isis', { military: -5 * m }); infl(s, t, 'isis', -8 * m); res(s, a, { political: 1 }); tension(s, t, -3); },
    fail: (s, a, t, m) => { res(s, a, { military: -3 * m }); },
    say: { success: 'Raids by {a} killed ISIS commanders in {t}.', fail: 'Raids by {a} in {t} came up empty.' },
  },
  {
    id: 'nuclearDash', name: 'Accelerate the nuclear program', cat: 'military', target: 'none', who: ['iran'],
    cost: { money: 8, military: 0, political: 2 }, base: 0.5,
    desc: 'Move hidden HEU, spin up clandestine cascades, edge toward a weapon. Maximum deterrence, maximum risk.',
    targets: () => [null],
    mods: (s) => [
      ...mod(s.theaters.nuclearSites.tension >= 70, 'Israeli ISR watching every site', -0.1),
      ...mod(rel(s, 'iran', 'russia') >= 60, 'Quiet Russian technical help', 0.05),
      ...mod(A(s, 'iran').stability < 30, 'Regime chaos disrupts the program', -0.1),
    ],
    success: (s, a, t, m) => { W(s, 'iranNuclear', 12 * m); W(s, 'warIntensity', 6); res(s, 'iran', { political: 1 }); relAdd(s, 'iran', 'saudi', -8); relAdd(s, 'iran', 'eu', -8); },
    fail: (s) => { W(s, 'iranNuclear', -3); res(s, 'iran', { stability: -3 }); },
    say: { success: 'Iran advanced its nuclear program at undeclared sites.', fail: 'Sabotage and defections set back Iran\'s nuclear work.' },
  },

  // ───────────────────────── DIPLOMATIC ─────────────────────────
  {
    id: 'ceasefire', name: 'Broker a ceasefire', cat: 'diplomatic', target: 'theater',
    who: ['us', 'eu', 'egypt', 'turkey', 'china', 'russia', 'saudi', 'iran', 'israel', 'hamas', 'houthis', 'lebanon', 'hezbollah'],
    cost: { money: 2, military: 0, political: 3 }, base: 0.4,
    desc: 'Mediate a halt to fighting in a theater.',
    targets: () => ['gaza', 'tehran', 'northYemen', 'southLebanon', 'neSyria'],
    mods: (s, a, t) => [
      ...mod(T(s, t).tension >= 75, 'Fighting is too hot for talks', -0.1),
      ...mod(a === 'us' && t === 'gaza', 'Board of Peace leverage over both sides', 0.15),
      ...mod(a === 'egypt' && t === 'gaza', 'Cairo controls Rafah and talks to Hamas', 0.1),
      ...mod(a === 'turkey' && (t === 'gaza' || t === 'neSyria'), 'Ankara has the ear of the armed side', 0.05),
      ...mod((a === 'china' || a === 'russia') && t === 'tehran', 'Tehran trusts the messenger', 0.05),
      ...mod(t === 'tehran' && s.world.usWarSupport < 35, 'Washington needs an exit before the midterms', 0.05),
      ...mod(t === 'gaza' && s.world.gazaCeasefire >= 60, 'Ceasefire architecture already in place', 0.1),
      ...mod(A(s, a).political >= 10, 'Diplomatic capital to spend', 0.05),
    ],
    success: (s, a, t, m) => {
      tension(s, t, -18 * m); res(s, a, { political: 2 });
      if (t === 'gaza') { W(s, 'gazaCeasefire', 14 * m); W(s, 'humanitarian', 4); }
      if (t === 'tehran') { W(s, 'warIntensity', -14 * m); W(s, 'hormuz', 8 * m); }
      if (t === 'northYemen') { W(s, 'yemenWar', -14 * m); W(s, 'redSea', 5 * m); relAdd(s, 'houthis', 'saudi', 10 * m); }
      if (t === 'southLebanon') { W(s, 'hezbollahDisarm', 3 * m); infl(s, 'southLebanon', 'israel', -5 * m); }
      if (t === 'neSyria') { W(s, 'kurdishAutonomy', -3); res(s, 'sdf', { stability: 4 }); }
    },
    fail: (s, a, t) => { res(s, a, { political: -1 }); tension(s, t, 3); },
    say: { success: '{a} brokered a de-escalation in {t}.', fail: '{a}\'s ceasefire push for {t} collapsed.' },
  },
  {
    id: 'disarm', name: 'Push disarmament / integration', cat: 'diplomatic', target: 'theater',
    who: ['us', 'egypt', 'turkey', 'eu', 'israel', 'lebanon', 'saudi', 'syria'], cost: { money: 4, military: 0, political: 3 }, base: 0.35,
    desc: 'Advance a disarmament or integration framework: Hamas in Gaza, Hezbollah in Lebanon, the PMF in Iraq, the SDF into Syria.',
    targets: () => ['gaza', 'southLebanon', 'baghdad', 'neSyria'],
    mods: (s, a, t) => {
      const w = s.world;
      if (t === 'gaza') return [
        ...mod(w.isfDeployed >= 40, 'Stabilization force on the ground', 0.15),
        ...mod(w.isfDeployed < 20, 'No one to verify decommissioning', -0.1),
        ...mod(w.gazaCeasefire >= 60, 'Ceasefire is holding', 0.1),
        ...mod(A(s, 'hamas').stability < 25, 'Hamas is cornered', 0.1),
        ...mod(T(s, 'gaza').infl.israel >= 50, 'Hamas demands Israeli withdrawal first', -0.1),
      ];
      if (t === 'southLebanon') return [
        ...mod(A(s, 'lebanon').stability >= 50, 'A confident Lebanese army', 0.1),
        ...mod(A(s, 'hezbollah').military < 30, 'Hezbollah is too weak to resist', 0.15),
        ...mod(A(s, 'hezbollah').military >= 45, 'Hezbollah has rearmed', -0.15),
        ...mod(T(s, 'southLebanon').infl.israel >= 30, 'Israeli occupation fuels refusal', -0.05),
      ];
      if (t === 'baghdad') return [
        ...mod(A(s, 'iraqMilitias').military >= 40, 'The militias are stronger than the state', -0.15),
        ...mod(A(s, 'iran').stability < 30, 'Tehran too weak to protect its proxies', 0.1),
      ];
      return [
        ...mod(a === 'syria' || a === 'turkey', 'Backed by credible military pressure', 0.05),
        ...mod(A(s, 'sdf').stability < 35, 'The SDF needs a deal', 0.1),
        ...mod((T(s, 'neSyria').infl.us || 0) >= 15, 'US guarantees for the Kurds', 0.05),
      ];
    },
    success: (s, a, t, m) => {
      res(s, a, { political: 1 });
      if (t === 'gaza') { W(s, 'hamasDisarm', 11 * m); res(s, 'hamas', { military: -5 * m }); res(s, 'pij', { military: -2 * m }); }
      if (t === 'southLebanon') { W(s, 'hezbollahDisarm', 11 * m); res(s, 'hezbollah', { military: -5 * m }); infl(s, 'southLebanon', 'lebanon', 8); infl(s, 'southLebanon', 'hezbollah', -6); infl(s, 'southLebanon', 'israel', -4); }
      if (t === 'baghdad') { res(s, 'iraqMilitias', { military: -7 * m }); infl(s, 'baghdad', 'iraqMilitias', -6); }
      if (t === 'neSyria') { W(s, 'kurdishAutonomy', -9 * m); infl(s, 'neSyria', 'syria', 10); res(s, 'sdf', { military: -4 }); }
    },
    fail: (s, a, t) => { res(s, a, { political: -1 }); tension(s, t, 4); },
    say: { success: '{a} pushed the disarmament framework forward in {t}.', fail: 'Disarmament talks on {t} stalled amid mutual accusations.' },
  },
  {
    id: 'deployISF', name: 'Deploy stabilization troops', cat: 'diplomatic', target: 'theater',
    who: ['us', 'egypt', 'turkey', 'eu', 'saudi', 'china'], cost: { money: 8, military: 3, political: 2 }, base: 0.5,
    desc: 'Contribute troops or funding to the International Stabilization Force in Gaza (UNSCR 2803).',
    targets: () => ['gaza'],
    mods: (s, a) => [
      ...mod(s.world.gazaCeasefire < 40, 'No contributor will deploy into active fighting', -0.15),
      ...mod(rel(s, a, 'israel') < -30, 'Israel vetoes the contingent', -0.15),
      ...mod(a === 'us', 'Washington chairs the Board of Peace', 0.1),
      ...mod(a === 'egypt', 'Egyptian troops are next door', 0.1),
    ],
    success: (s, a, t, m) => { W(s, 'isfDeployed', 14 * m); W(s, 'gazaCeasefire', 5); W(s, 'humanitarian', 4); infl(s, 'gaza', a, 8); res(s, a, { political: 1 }); },
    fail: (s, a) => { res(s, a, { political: -1, military: -2 }); },
    say: { success: '{a} deployed a contingent to the Gaza stabilization force.', fail: '{a}\'s ISF contingent never left the staging area.' },
  },
  {
    id: 'normalize', name: 'Normalization talks', cat: 'diplomatic', target: 'none', who: ['us', 'israel', 'saudi'],
    cost: { money: 0, military: 0, political: 3 }, base: 0.35,
    desc: 'Push the Saudi–Israel normalization track.',
    targets: () => [null],
    mods: (s, a) => [
      ...mod(s.world.humanitarian < 35, 'Images from Gaza make normalization toxic', -0.15),
      ...mod(s.world.westBankAnnex >= 40, 'Annexation steps cross a Saudi red line', -0.15),
      ...mod(s.world.gazaCeasefire >= 60, 'Gaza is quiet', 0.1),
      ...mod(s.world.iranNuclear >= 60, 'A shared Iranian threat concentrates minds', 0.05),
      ...mod(a === 'us', 'American security guarantees on the table', 0.05),
    ],
    success: (s, a, t, m) => { W(s, 'normalization', 11 * m); res(s, 'iran', { stability: -2 }); relAdd(s, 'israel', 'saudi', 8); res(s, a, { political: 1 }); },
    fail: (s, a) => { res(s, a, { political: -1 }); },
    say: { success: '{a} moved Riyadh and Jerusalem closer to normalization.', fail: 'Normalization talks broke down over the Palestinian question.' },
  },
  {
    id: 'sanctions', name: 'Impose sanctions', cat: 'economic', target: 'actor', who: ['us', 'eu'],
    cost: { money: 0, military: 0, political: 2 }, base: 0.7,
    desc: 'Financial and trade sanctions against a hostile actor.',
    targets: (s, a) => Object.keys(s.actors).filter((b) => b !== a && !s.actors[b].collapsed && rel(s, a, b) < -20),
    mods: (s, a, b) => [
      ...mod(a === 'eu', 'Requires unanimity among 27 member states', -0.1),
      ...mod(isNonstate(b), 'Already among the most sanctioned entities on earth', -0.15),
      ...mod(b === 'russia' || b === 'china', 'Target can retaliate economically', -0.15),
    ],
    success: (s, a, b, m) => { res(s, b, { money: -7 * m, stability: -3 }); relAdd(s, a, b, -8); if (b === 'iran') W(s, 'iranSanctions', 8 * m); },
    fail: (s, a) => { res(s, a, { political: -1 }); },
    say: { success: '{a} imposed new sanctions on {t}.', fail: '{a}\'s sanctions package on {t} was watered down to nothing.' },
  },
  {
    id: 'talks', name: 'Open US–Iran negotiations', cat: 'diplomatic', target: 'none',
    who: ['us', 'iran', 'eu', 'china', 'russia', 'turkey', 'saudi', 'egypt'], cost: { money: 0, military: 0, political: 3 }, base: 0.35,
    desc: 'Revive the Islamabad memorandum track: inspections and Hormuz passage in exchange for sanctions relief.',
    targets: () => [null],
    mods: (s, a) => [
      ...mod(s.world.warIntensity >= 70, 'Bombs are still falling', -0.1),
      ...mod(A(s, 'iran').stability < 35, 'Tehran badly needs relief', 0.1),
      ...mod(s.world.usWarSupport < 35, 'Washington wants a deal before the midterms', 0.1),
      ...mod(a === 'russia', 'Moscow relays Tehran\'s terms to Trump', 0.05),
      ...mod(rel(s, 'us', 'iran') <= -85, 'Deep mutual distrust', -0.05),
    ],
    success: (s, a, t, m) => {
      W(s, 'iranNuclear', -6 * m); W(s, 'iranSanctions', -9 * m); W(s, 'warIntensity', -10 * m); W(s, 'hormuz', 10 * m);
      res(s, 'iran', { money: 4 }); res(s, 'israel', { stability: -2 }); relAdd(s, 'us', 'iran', 6); res(s, a, { political: 2 });
    },
    fail: (s, a) => { W(s, 'warIntensity', 4); res(s, a, { political: -1 }); },
    say: { success: '{a} brokered a round of US–Iran talks with real concessions.', fail: 'US–Iran talks pushed by {a} collapsed in recriminations.' },
  },
  {
    id: 'annex', name: 'Extend sovereignty in the West Bank', cat: 'diplomatic', target: 'theater', who: ['israel'],
    cost: { money: 2, military: 0, political: 2 }, base: 0.6,
    desc: 'Settlement expansion and sovereignty legislation. Popular with the coalition; poison for normalization.',
    targets: () => ['westbank'],
    mods: (s) => [
      ...mod(rel(s, 'us', 'israel') >= 80, 'Washington will not object', 0.1),
      ...mod(s.world.normalization >= 40, 'Gulf partners threaten to walk away', -0.1),
    ],
    success: (s, a, t, m) => { W(s, 'westBankAnnex', 12 * m); res(s, 'israel', { stability: 4 }); W(s, 'normalization', -8); relAdd(s, 'israel', 'eu', -12); relAdd(s, 'israel', 'saudi', -8); tension(s, 'westbank', 15); },
    fail: (s) => { res(s, 'israel', { political: -2 }); },
    say: { success: 'Israel extended sovereignty measures in the West Bank.', fail: 'The annexation bill died in the Knesset.' },
  },
  {
    id: 'unResolution', name: 'UN Security Council resolution', cat: 'diplomatic', target: 'theater', who: ['us', 'eu', 'china', 'russia'],
    cost: { money: 0, military: 0, political: 2 }, base: 0.45,
    desc: 'Table a resolution on a theater. Other permanent members may veto.',
    targets: () => ['gaza', 'hormuz', 'southLebanon', 'tehran', 'babElMandeb'],
    mods: () => [],
    success: (s, a, t, m) => {
      tension(s, t, -8 * m); res(s, a, { political: 3 });
      if (t === 'gaza') W(s, 'humanitarian', 4); if (t === 'hormuz') W(s, 'hormuz', 5); if (t === 'babElMandeb') W(s, 'redSea', 5);
      if (t === 'tehran') W(s, 'warIntensity', -5);
    },
    fail: (s, a) => { res(s, a, { political: -1 }); },
    say: { success: 'The Security Council adopted {a}\'s resolution on {t}.', fail: '{a}\'s resolution on {t} was vetoed.' },
  },

  // ───────────────────────── ECONOMIC ─────────────────────────
  {
    id: 'reliefGaza', name: 'Humanitarian relief for Gaza', cat: 'economic', target: 'theater',
    who: ['us', 'eu', 'saudi', 'china', 'turkey', 'egypt'], cost: { money: 8, military: 0, political: 1 }, base: 0.6,
    desc: 'Food, shelter, water and reconstruction materials through the crossings.',
    targets: () => ['gaza'],
    mods: (s, a) => [
      ...mod(s.world.gazaCeasefire < 40, 'Crossings closed by fighting', -0.15),
      ...mod(rel(s, a, 'israel') >= 50, 'Israel waves the convoys through', 0.1),
      ...mod(a === 'egypt', 'Rafah is on Egyptian soil', 0.1),
    ],
    success: (s, a, t, m) => { W(s, 'humanitarian', 7 * m); res(s, a, { political: 1 }); res(s, 'hamas', { stability: 2 }); tension(s, 'gaza', -5); },
    fail: () => {},
    say: { success: '{a}\'s aid convoys reached Gaza.', fail: '{a}\'s aid convoys were stuck at the crossings.' },
  },
  {
    id: 'bankroll', name: 'Financial support', cat: 'economic', target: 'actor',
    who: ['us', 'eu', 'saudi', 'china', 'turkey', 'russia', 'iran'], cost: { money: 10, military: 0, political: 0 }, base: 0.85,
    desc: 'Budget support, deposits or loans to a friendly government or movement.',
    targets: (s, a) => Object.keys(s.actors).filter((b) => b !== a && !s.actors[b].collapsed && rel(s, a, b) >= 20 && !BIG.includes(b)),
    mods: (s, a, b) => [...mod(a === 'iran' && s.world.iranSanctions >= 80, 'Sanctions choke Iranian transfers', -0.2)],
    success: (s, a, b, m) => { res(s, b, { money: 9 * m, stability: 4 }); relAdd(s, a, b, 8); const h = homeOf(b); if (h) infl(s, h, a, 5); },
    fail: () => {},
    say: { success: '{a} bankrolled {t}.', fail: '{a}\'s money for {t} vanished into corruption.' },
  },
  {
    id: 'oilUp', name: 'Raise oil output', cat: 'economic', target: 'none', who: ['saudi', 'russia'],
    cost: { money: 0, military: 0, political: 1 }, base: 0.7,
    desc: 'Pump more to cool prices (and win friends in Washington and Beijing).',
    targets: () => [null],
    mods: (s, a) => [
      ...mod(a === 'saudi' && s.world.hormuz < 50, 'Gulf barrels are stuck behind Hormuz', -0.15),
      ...mod(a === 'saudi', 'East–West pipeline to Yanbu bypasses the Strait', 0.1),
      ...mod(a === 'saudi' && s.world.redSea < 40, 'Houthi threat to Yanbu tankers', -0.1),
    ],
    success: (s, a, t, m) => { W(s, 'oilAdj', -7 * m); res(s, a, { money: 2 }); relAdd(s, a, 'us', 5); relAdd(s, a, 'china', 5); },
    fail: () => {},
    say: { success: '{a} opened the taps; prices eased.', fail: '{a}\'s extra barrels could not reach market.' },
  },
  {
    id: 'oilCut', name: 'Cut oil output', cat: 'economic', target: 'none', who: ['saudi', 'russia'],
    cost: { money: 0, military: 0, political: 1 }, base: 0.75,
    desc: 'Squeeze supply to push prices up.',
    targets: () => [null], mods: () => [],
    success: (s, a, t, m) => { W(s, 'oilAdj', 7 * m); res(s, a, { money: 4 }); relAdd(s, a, 'us', -6); relAdd(s, a, 'eu', -5); },
    fail: () => {},
    say: { success: '{a} cut output; prices jumped.', fail: '{a}\'s output cut was swamped by cheating.' },
  },
  {
    id: 'invest', name: 'Investment & reconstruction', cat: 'economic', target: 'theater',
    who: ['china', 'saudi', 'turkey', 'eu', 'us', 'russia'], cost: { money: 10, military: 0, political: 0 }, base: 0.7,
    desc: 'Ports, power plants and reconstruction contracts that buy lasting influence.',
    targets: () => ['damascus', 'beirut', 'baghdad', 'kurdistan', 'riyadh', 'sinai', 'tartus', 'gulfBases'],
    mods: (s, a, t) => [
      ...mod(T(s, t).tension >= 60, 'Too unstable for investors', -0.15),
      ...mod(a === 'china', 'State banks with deep pockets', 0.1),
    ],
    success: (s, a, t, m) => {
      infl(s, t, a, 12 * m); res(s, a, { political: 1 });
      const ctrl = THEATER_BY_ID[t].controller; if (ctrl !== a) res(s, ctrl, { stability: 4, money: 4 * m });
      relAdd(s, a, ctrl, 6);
    },
    fail: () => {},
    say: { success: '{a} signed major investment deals in {t}.', fail: '{a}\'s projects in {t} stalled.' },
  },
  {
    id: 'buyOil', name: 'Buy Iranian oil', cat: 'economic', target: 'none', who: ['china'],
    cost: { money: 2, military: 0, political: 1 }, base: 0.65,
    desc: 'Teapot refineries and dark-fleet tankers keep Tehran solvent.',
    targets: () => [null],
    mods: (s) => [
      ...mod(s.world.hormuz < 40, 'Tankers cannot get out of the Gulf', -0.15),
      ...mod((T(s, 'hormuz').infl.us || 0) >= 50, 'US Navy boarding dark-fleet tankers', -0.1),
    ],
    success: (s, a, t, m) => { res(s, 'iran', { money: 9 * m, stability: 2 }); W(s, 'iranSanctions', -4); relAdd(s, 'china', 'us', -6); relAdd(s, 'china', 'iran', 6); },
    fail: (s) => { res(s, 'china', { political: -1 }); },
    say: { success: 'China quietly bought millions of barrels of Iranian crude.', fail: 'US interdictions stranded China-bound Iranian tankers.' },
  },

  // ───────────────────────── COVERT / INFO ─────────────────────────
  {
    id: 'cyber', name: 'Cyber attack', cat: 'covert', target: 'actor', who: ['us', 'israel', 'iran', 'russia', 'china'],
    cost: { money: 3, military: 0, political: 1 }, base: 0.55,
    desc: 'Hit power grids, banks, ports or command systems.',
    targets: (s, a) => Object.keys(s.actors).filter((b) => b !== a && !s.actors[b].collapsed && rel(s, a, b) <= -30 && isState(b)),
    mods: (s, a, b) => [
      ...mod(a === 'us' || a === 'israel', 'World-class offensive cyber units', 0.1),
      ...mod(b === 'us' || b === 'israel' || b === 'china', 'Hardened target networks', -0.15),
    ],
    success: (s, a, b, m) => { res(s, b, { money: -5 * m, military: -3 * m, stability: -2 }); relAdd(s, a, b, -4); },
    fail: (s, a, b) => { res(s, a, { political: -1 }); relAdd(s, a, b, -5); },
    say: { success: '{a} hackers crippled {t} infrastructure.', fail: 'A cyber operation by {a} against {t} was detected and attributed.' },
  },
  {
    id: 'infoOps', name: 'Information campaign', cat: 'covert', target: 'actor', who: 'ALL',
    cost: { money: 2, military: 0, political: 1 }, base: 0.55,
    desc: 'Propaganda, leaks and influence operations to erode an adversary\'s home front.',
    targets: (s, a) => Object.keys(s.actors).filter((b) => b !== a && b !== 'isis' && !s.actors[b].collapsed && rel(s, a, b) <= -30),
    mods: (s, a, b) => [
      ...mod(A(s, b).stability < 40, 'Fertile ground: discontent is already high', 0.1),
      ...mod(BIG.includes(a), 'Global media reach', 0.05),
    ],
    success: (s, a, b, m) => { res(s, b, { stability: -3 * m }); if (b === 'us') W(s, 'usWarSupport', -3 * m); },
    fail: (s, a) => { res(s, a, { political: -1 }); },
    say: { success: '{a}\'s campaign rattled the {t} home front.', fail: '{a}\'s influence operation against {t} was exposed.' },
  },

  // ───────────────────────── DOMESTIC ─────────────────────────
  {
    id: 'rally', name: 'Rally domestic support', cat: 'domestic', target: 'none', who: 'ALL',
    cost: { money: 3, military: 0, political: 2 }, base: 0.7,
    desc: 'Speeches, patronage, concessions: shore up your base.',
    targets: () => [null],
    mods: (s, a) => [
      ...mod(A(s, a).stability < 30, 'Legitimacy is badly eroded', -0.1),
      ...mod(a === 'us' && s.world.oil > 100, 'Voters blame the war for gas prices', -0.1),
      ...mod(A(s, a).stability >= 70, 'Little room left to improve', -0.25),
    ],
    success: (s, a, t, m) => { res(s, a, { stability: 5 * m }); if (a === 'us') W(s, 'usWarSupport', 4 * m); },
    fail: (s, a) => { res(s, a, { stability: -2 }); },
    say: { success: '{a}\'s leadership rallied its base.', fail: '{a}\'s appeal for unity fell flat.' },
  },
  {
    id: 'crackdown', name: 'Security crackdown', cat: 'domestic', target: 'none', who: ['iran', 'syria', 'egypt', 'turkey', 'saudi', 'houthis', 'hamas', 'russia', 'china'],
    cost: { money: 2, military: 3, political: 1 }, base: 0.75,
    desc: 'Arrests, curfews and executions. Buys stability, costs legitimacy.',
    targets: () => [null],
    mods: (s, a) => [...mod(A(s, a).stability < 20, 'Security forces may not obey', -0.15), ...mod(A(s, a).stability >= 70, 'Little room left to improve', -0.25)],
    success: (s, a, t, m) => { res(s, a, { stability: 7 * m }); relAdd(s, a, 'eu', -6); },
    fail: (s, a) => { res(s, a, { stability: -6 }); },
    say: { success: '{a} crushed dissent at home.', fail: '{a}\'s crackdown sparked wider unrest.' },
  },
  {
    id: 'recruit', name: 'Recruit & rearm', cat: 'domestic', target: 'none', who: 'NONSTATE',
    cost: { money: 3, military: 0, political: 1 }, base: 0.7,
    desc: 'Fill the ranks, rebuild workshops, dig tunnels.',
    targets: () => [null],
    mods: (s, a) => [
      ...mod((a === 'hamas' || a === 'pij') && s.world.humanitarian < 30, 'Grievance fuels recruitment', 0.1),
      ...mod((a === 'hamas' || a === 'pij') && s.world.isfDeployed >= 40, 'Stabilization force watching', -0.1),
      ...mod(a === 'isis' && s.world.isisStrength >= 50, 'The caliphate brand is back', 0.1),
    ],
    success: (s, a, t, m) => {
      res(s, a, { military: 9 * m, stability: 2 });
      if (a === 'isis') W(s, 'isisStrength', 4 * m);
      if (a === 'hamas' || a === 'pij') W(s, 'hamasDisarm', -3 * m);
      if (a === 'hezbollah') W(s, 'hezbollahDisarm', -3 * m);
    },
    fail: () => {},
    say: { success: '{a} rebuilt its fighting strength.', fail: '{a}\'s recruitment drive faltered.' },
  },
  {
    id: 'autonomy', name: 'Assert Kurdish self-rule', cat: 'diplomatic', target: 'none', who: ['sdf', 'krg'],
    cost: { money: 2, military: 0, political: 2 }, base: 0.5,
    desc: 'Entrench local institutions and security forces outside the central state.',
    targets: () => [null],
    mods: (s) => [
      ...mod(A(s, 'turkey').military >= 55, 'Turkish drones overhead', -0.1),
      ...mod((T(s, 'neSyria').infl.us || 0) >= 15, 'Quiet American backing', 0.1),
      ...mod(A(s, 'syria').stability < 40, 'Damascus is too weak to object', 0.1),
    ],
    success: (s, a, t, m) => { W(s, 'kurdishAutonomy', 9 * m); relAdd(s, a, 'turkey', -10); relAdd(s, a, 'syria', -8); tension(s, homeOf(a), 8); infl(s, homeOf(a), a, 5); },
    fail: (s) => { W(s, 'kurdishAutonomy', -3); },
    say: { success: '{a} entrenched Kurdish self-rule.', fail: '{a}\'s autonomy push provoked a backlash.' },
  },
  {
    id: 'withdraw', name: 'Draw down forces', cat: 'military', target: 'theater', who: ['us', 'israel', 'turkey', 'russia'],
    cost: { money: 0, military: 0, political: 1 }, base: 0.9,
    desc: 'Bring troops home. Saves money and goodwill at home; cedes ground.',
    targets: (s, a) => Object.keys(s.theaters).filter((t) => t !== homeOf(a) && (s.theaters[t].infl[a] || 0) >= 10),
    mods: () => [],
    success: (s, a, t) => {
      infl(s, t, a, -25); res(s, a, { money: 6, military: 4 });
      if (a === 'us') W(s, 'usWarSupport', 5);
      if (t === 'hormuz') W(s, 'hormuz', -8);
      if (t === 'babElMandeb' || t === 'redSea') W(s, 'redSea', -6);
      if (a === 'israel') res(s, 'israel', { stability: -2 });
    },
    fail: () => {},
    say: { success: '{a} pulled forces back from {t}.', fail: '{a}\'s drawdown from {t} was reversed under pressure.' },
  },
];

export const ACTION_BY_ID = Object.fromEntries(ACTIONS.map((x) => [x.id, x]));

export function canUse(action, a) {
  if (action.who === 'ALL') return true;
  if (action.who === 'NONSTATE') return isNonstate(a);
  return action.who.includes(a);
}

export const COMMIT = [
  { label: 'Standard', mult: 1, bonus: 0 },
  { label: 'Major effort', mult: 1.5, bonus: 0.08 },
  { label: 'All-in', mult: 2, bonus: 0.15 },
];

export function costOf(action, commit = 0) {
  const m = COMMIT[commit].mult;
  return { money: Math.ceil(action.cost.money * m), military: Math.ceil(action.cost.military * m), political: Math.ceil(action.cost.political * m) };
}

export function affordable(s, a, action, commit = 0) {
  const c = costOf(action, commit), r = s.actors[a];
  return r.money >= c.money && r.military >= c.military && r.political >= c.political;
}

export const targetName = NAME;
