// Random and scripted events. Effects are applied in upkeep. `at` (theater) is optional and used by
// the dev spawn() hook and by the map to flash the location.
import { W, res, tension, rel } from '../engine/state.js';

export const EVENTS = [
  { id: 'tankerHit', at: 'hormuz', weight: 3, cond: (s) => s.world.hormuz < 70,
    text: 'A VLCC is struck by a limpet mine off Fujairah; war-risk premiums spike.',
    apply: (s) => { W(s, 'hormuz', -7); W(s, 'oilAdj', 3); tension(s, 'hormuz', 8); } },
  { id: 'iranProtests', at: 'tehran', weight: 2, cond: (s) => s.world.iranSanctions >= 70,
    text: 'Bazaar strikes and protests spread across Iranian cities over blackouts and inflation.',
    apply: (s) => { res(s, 'iran', { stability: -7 }); tension(s, 'tehran', 10); } },
  { id: 'saudiAirport', at: 'riyadh', weight: 2, cond: (s) => s.world.yemenWar >= 40,
    text: 'A Houthi drone swarm hits a Saudi airport; flights are suspended.',
    apply: (s) => { res(s, 'saudi', { stability: -4 }); W(s, 'yemenWar', 6); tension(s, 'riyadh', 10); } },
  { id: 'isisCellBusted', at: 'badiya', weight: 1, cond: () => true,
    text: 'Iraqi and SDF intelligence roll up an ISIS financing network.',
    apply: (s) => { W(s, 'isisStrength', -4); } },
  { id: 'gazaFlare', at: 'gaza', weight: 2, cond: (s) => s.world.gazaCeasefire < 70,
    text: 'A deadly exchange near the yellow line in Khan Younis threatens the truce.',
    apply: (s) => { W(s, 'gazaCeasefire', -9); W(s, 'humanitarian', -3); tension(s, 'gaza', 10); } },
  { id: 'opecSurprise', at: 'riyadh', weight: 1, cond: () => true,
    text: 'OPEC+ ministers surprise markets with a quota fight.',
    apply: (s) => { W(s, 'oilAdj', 4); } },
  { id: 'usPolitics', at: 'gulfBases', weight: 2, cond: (s) => s.world.warIntensity >= 40,
    text: 'Flag-draped coffins return to Dover; a War Powers resolution gains votes.',
    apply: (s) => { W(s, 'usWarSupport', -4); } },
  { id: 'israelCoalition', at: 'israelHome', weight: 2, cond: () => true,
    text: 'Israel\'s coalition fractures over the draft law; early elections loom.',
    apply: (s) => { res(s, 'israel', { stability: -5 }); } },
  { id: 'lira', at: 'ankara', weight: 1, cond: (s) => s.world.oil > 90,
    text: 'The lira slides as the energy import bill soars.',
    apply: (s) => { res(s, 'turkey', { money: -5, stability: -2 }); } },
  { id: 'russianMissiles', at: 'tehran', weight: 2, cond: (s) => rel(s, 'iran', 'russia') >= 50,
    text: 'Western officials say Russian missiles and air-defense parts are reaching Iran via the Caspian.',
    apply: (s) => { res(s, 'iran', { military: 6 }); } },
  { id: 'chinaEnvoy', at: 'hormuz', weight: 1, cond: (s) => s.world.hormuz < 60,
    text: 'Beijing\'s special envoy shuttles between Tehran and Riyadh.',
    apply: (s) => { res(s, 'china', { political: 2 }); W(s, 'warIntensity', -3); } },
  { id: 'militiaDrone', at: 'kurdistan', weight: 2, cond: () => true,
    text: 'Drones strike an Iranian Kurdish refugee camp near Erbil; Erbil blames Tehran.',
    apply: (s) => { res(s, 'krg', { stability: -3 }); tension(s, 'kurdistan', 8); } },
  { id: 'sweidaClashes', at: 'southSyria', weight: 1, cond: () => true,
    text: 'Druze militias and government forces clash in Sweida; Israel threatens intervention.',
    apply: (s) => { res(s, 'syria', { stability: -3 }); tension(s, 'southSyria', 10); } },
  { id: 'redSeaLull', at: 'redSea', weight: 1, cond: (s) => s.world.redSea < 60,
    text: 'A few carriers test the Red Sea route again after a quiet fortnight.',
    apply: (s) => { W(s, 'redSea', 4); } },
  { id: 'lebanonPilot', at: 'southLebanon', weight: 1, cond: (s) => s.world.hezbollahDisarm >= 20,
    text: 'The LAF completes handover of a pilot zone south of the Litani; verifiers report progress.',
    apply: (s) => { W(s, 'hezbollahDisarm', 3); res(s, 'lebanon', { stability: 2 }); } },
];

export const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

// Scripted beats keyed by turn number. Turn 2 spans the 3 November 2026 US midterms.
export const SCRIPTED = {
  2: {
    id: 'midterms', at: 'gulfBases',
    text: (s) => (s.world.usWarSupport < 40
      ? 'US midterms: Democrats take the House on an anti-war, anti-gas-price wave. Oversight hearings loom.'
      : 'US midterms: Republicans hold both chambers; the White House claims a mandate on Iran.'),
    apply: (s) => {
      s.flags.midterms = s.world.usWarSupport < 40 ? 'lost' : 'held';
      if (s.flags.midterms === 'lost') { res(s, 'us', { political: -3, stability: -4 }); }
      else { res(s, 'us', { political: 3, stability: 3 }); }
    },
  },
};

// One-off threshold events checked every upkeep.
export const THRESHOLDS = [
  { id: 'iranBomb', at: 'nuclearSites', when: (s) => s.world.iranNuclear >= 100,
    text: 'Iran announces a successful nuclear test in the Dasht-e Kavir. The region will never be the same.',
    apply: (s) => { res(s, 'iran', { political: 6, stability: 10 }); res(s, 'israel', { stability: -15 }); res(s, 'saudi', { stability: -8 }); W(s, 'warIntensity', 25); W(s, 'iranSanctions', 10); } },
  { id: 'hormuzOpen', at: 'hormuz', when: (s) => s.world.hormuz >= 80,
    text: 'Tanker traffic through Hormuz returns to near-normal for the first time since February.',
    apply: (s) => { W(s, 'oilAdj', -3); } },
  { id: 'gazaCollapse', at: 'gaza', when: (s) => s.world.gazaCeasefire <= 10,
    text: 'The Gaza ceasefire has collapsed. Full-scale war resumes.',
    apply: (s) => { W(s, 'humanitarian', -10); res(s, 'egypt', { stability: -5 }); s.flags.gazaCollapse = true; } },
];
