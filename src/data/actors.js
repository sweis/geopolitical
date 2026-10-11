// Playable actors. Resource scale is abstract: money ~ $bn of discretionary spend, military 0-100
// deployable strength, political = capital spent on actions and arguments, stability 0-100 (0 = collapse).
import { atLeast, atMost, W, R, INF } from '../engine/goals.js';
import { rel } from '../engine/relations.js';

const US_IN_IRAQ_SYRIA = (s) => ['baghdad', 'neSyria', 'kurdistan'].reduce((n, t) => n + (s.theaters[t].infl.us || 0), 0);
const AXIS_STRENGTH = (s) => (s.actors.hezbollah.military + s.actors.houthis.military + s.actors.iraqMilitias.military) / 3;
const FOOTPRINT = (id) => (s) => Object.values(s.theaters).reduce((n, t) => n + (t.infl[id] || 0), 0);
const CHINA_FOOTPRINT = FOOTPRINT('china');
const EU_FOOTPRINT = FOOTPRINT('eu');

export const ACTORS = [
  {
    id: 'us', name: 'United States', short: 'USA', color: '#4f8fe8', kind: 'superpower',
    leader: 'President Trump', home: 'gulfBases',
    start: { money: 120, military: 95, political: 8, stability: 62 }, income: { money: 14, military: 5, political: 3 },
    blurb: 'Seven months into a war it expected to win in weeks. Hormuz is still choked, Brent is over $100 and the midterms are three weeks out. Washington wants Iran disarmed and the oil flowing, without a quagmire.',
    goals: [
      atLeast('Reopen the Strait of Hormuz', W('hormuz'), 80, 20, 3, '%'),
      atMost('No Iranian bomb', W('iranNuclear'), 25, 80, 3),
      atMost('Brent crude under $80', W('oil'), 80, 120, 2, '$'),
      atLeast('Gaza deal holds', W('gazaCeasefire'), 70, 30, 1),
      atLeast('Hold the home front', W('usWarSupport'), 50, 20, 2, '%'),
    ],
  },
  {
    id: 'israel', name: 'Israel', short: 'ISR', color: '#7fb8ff', kind: 'state',
    leader: 'Prime Minister Netanyahu', home: 'israelHome',
    start: { money: 60, military: 80, political: 6, stability: 55 }, income: { money: 8, military: 4, political: 2 },
    blurb: 'Fighting on every front since 2023. The Iranian program is damaged but not gone, Hezbollah and Hamas have signed disarmament frameworks they may never honor, and an election year looms.',
    goals: [
      atMost('Iranian nuclear program destroyed', W('iranNuclear'), 15, 75, 3),
      atLeast('Hezbollah disarmed', W('hezbollahDisarm'), 70, 10, 2),
      atLeast('Hamas disarmed', W('hamasDisarm'), 60, 0, 2),
      atLeast('Saudi normalization', W('normalization'), 50, 0, 1),
      atLeast('National resilience', R('israel', 'stability'), 65, 35, 2),
    ],
  },
  {
    id: 'iran', name: 'Islamic Republic of Iran', short: 'IRN', color: '#3fae6a', kind: 'state',
    leader: 'Supreme Leader Mojtaba Khamenei', home: 'tehran',
    start: { money: 35, military: 55, political: 6, stability: 42 }, income: { money: 5, military: 3, political: 2 },
    blurb: 'Decapitated in February, blockaded, bombed, and still standing. Tehran\'s leverage is the Strait: it stays shut until the June memorandum\'s conditions are met. Survival comes first.',
    goals: [
      atLeast('Regime survival', R('iran', 'stability'), 55, 15, 3),
      atMost('Break the sanctions siege', W('iranSanctions'), 40, 100, 2),
      atLeast('Preserve nuclear latency', W('iranNuclear'), 75, 25, 1),
      atLeast('Keep the Axis armed', AXIS_STRENGTH, 50, 20, 2),
      atMost('Hormuz shut until sanctions lift', (s) => (s.world.iranSanctions > 60 ? s.world.hormuz : 0), 30, 100, 2, '%'),
    ],
  },
  {
    id: 'turkey', name: 'Türkiye', short: 'TUR', color: '#e0524f', kind: 'state',
    leader: 'President Erdoğan', home: 'ankara',
    start: { money: 45, military: 60, political: 6, stability: 60 }, income: { money: 7, military: 3, political: 2 },
    blurb: 'The PKK is laying down arms; Ankara wants the SDF folded into a Syria it can shape. A Gaza mediator with NATO\'s second-largest army and an economy that hates $100 oil.',
    goals: [
      atMost('End armed Kurdish autonomy', W('kurdishAutonomy'), 20, 70, 3),
      atLeast('A stable Syria in Ankara\'s orbit', INF('damascus', 'turkey'), 40, 10, 2),
      atLeast('Domestic stability', R('turkey', 'stability'), 70, 40, 2),
      atMost('Affordable energy', W('oil'), 85, 120, 1, '$'),
      atLeast('A seat at the Gaza table', INF('gaza', 'turkey'), 20, 0, 1),
    ],
  },
  {
    id: 'saudi', name: 'Saudi Arabia', short: 'KSA', color: '#2e9a52', kind: 'state',
    leader: 'Crown Prince Mohammed bin Salman', home: 'riyadh',
    start: { money: 80, military: 50, political: 6, stability: 68 }, income: { money: 11, military: 3, political: 2 },
    blurb: 'Houthi missiles are hitting Saudi airports again. Riyadh wants the war in Yemen ended, Iran contained, and Vision 2030 protected; normalization with Israel only with a Palestinian path.',
    goals: [
      atMost('Stop Houthi attacks', W('yemenWar'), 20, 85, 3),
      atMost('Contain Iran\'s program', W('iranNuclear'), 30, 80, 2),
      atLeast('Vision 2030 stability', R('saudi', 'stability'), 78, 50, 2),
      atLeast('Red Sea open', W('redSea'), 75, 20, 1, '%'),
      atLeast('Normalization with a Palestinian path', (s) => Math.min(s.world.normalization, s.world.humanitarian), 40, 0, 1),
    ],
  },
  {
    id: 'egypt', name: 'Egypt', short: 'EGY', color: '#c9a54a', kind: 'state',
    leader: 'President el-Sisi', home: 'sinai',
    start: { money: 20, military: 45, political: 5, stability: 52 }, income: { money: 4, military: 2, political: 2 },
    blurb: 'Suez revenue has collapsed with Red Sea traffic. Cairo mediates in Gaza, guards Rafah, and fears a refugee exodus into Sinai above all.',
    goals: [
      atLeast('Restore Suez revenue', W('redSea'), 75, 20, 3, '%'),
      atLeast('Gaza ceasefire holds', W('gazaCeasefire'), 75, 30, 2),
      atLeast('No exodus into Sinai', W('humanitarian'), 50, 10, 2),
      atLeast('Regime stability', R('egypt', 'stability'), 65, 35, 2),
    ],
  },
  {
    id: 'houthis', name: 'Ansar Allah (Houthis)', short: 'HTH', color: '#8bc34a', kind: 'nonstate',
    leader: 'Abdul-Malik al-Houthi', home: 'northYemen',
    start: { money: 10, military: 40, political: 4, stability: 55 }, income: { money: 2, military: 3, political: 1 },
    blurb: 'Rulers of northern Yemen and the Axis\'s most defiant member. Bab el-Mandeb is their chokehold; Saudi money is their price.',
    goals: [
      atLeast('Survive and rule Sana\'a', R('houthis', 'stability'), 65, 30, 3),
      atMost('Chokehold on the Red Sea', W('redSea'), 30, 80, 2, '%'),
      atLeast('Saudi recognition and payouts', (s) => rel(s, 'houthis', 'saudi'), 0, -85, 2),
      atLeast('Missile arsenal rebuilt', R('houthis', 'military'), 55, 20, 1),
    ],
  },
  {
    id: 'hezbollah', name: 'Hezbollah', short: 'HZB', color: '#f2c94c', kind: 'nonstate',
    leader: 'Secretary-General Naim Qassem', home: 'southLebanon',
    start: { money: 12, military: 35, political: 3, stability: 45 }, income: { money: 2, military: 2, political: 1 },
    blurb: 'Badly mauled, supply lines through Syria cut, and facing a US-backed framework to disarm it zone by zone. Its arms are its identity.',
    goals: [
      atMost('Keep the arms', W('hezbollahDisarm'), 15, 70, 3),
      atLeast('Rebuild strength', R('hezbollah', 'military'), 55, 15, 2),
      atMost('Israel out of the south', INF('southLebanon', 'israel'), 5, 50, 2),
      atLeast('Hold the Shia base', R('hezbollah', 'stability'), 60, 20, 2),
    ],
  },
  {
    id: 'hamas', name: 'Hamas', short: 'HMS', color: '#2f9e44', kind: 'nonstate',
    leader: 'Leadership council (Doha / Gaza)', home: 'gaza',
    start: { money: 6, military: 18, political: 3, stability: 35 }, income: { money: 1, military: 1, political: 1 },
    blurb: 'Agreed in July to a disarmament roadmap it says depends on Israeli withdrawal. Gaza lies in ruins; the movement wants to survive as a political force.',
    goals: [
      atLeast('Survive as a movement', R('hamas', 'stability'), 50, 10, 3),
      atMost('Keep the guns', W('hamasDisarm'), 5, 60, 2),
      atMost('Israeli withdrawal', INF('gaza', 'israel'), 20, 70, 2),
      atLeast('Rebuild Gaza', W('humanitarian'), 60, 10, 1),
    ],
  },
  {
    id: 'pij', name: 'Palestinian Islamic Jihad', short: 'PIJ', color: '#5c7a3a', kind: 'nonstate',
    leader: 'Ziyad al-Nakhalah', home: 'gaza',
    start: { money: 3, military: 10, political: 2, stability: 40 }, income: { money: 1, military: 1, political: 1 },
    blurb: 'Tehran\'s most loyal Palestinian faction and a natural spoiler: any deal that disarms Gaza disarms it too.',
    goals: [
      atLeast('Keep fighting capacity', R('pij', 'military'), 25, 0, 2),
      atMost('No disarmament', W('hamasDisarm'), 5, 50, 2),
      atLeast('Survive', R('pij', 'stability'), 50, 15, 2),
      atMost('Wreck the ceasefire', W('gazaCeasefire'), 25, 75, 1),
    ],
  },
  {
    id: 'iraqMilitias', name: 'Islamic Resistance in Iraq', short: 'IRI', color: '#9ccc65', kind: 'nonstate',
    leader: 'Kata\'ib Hezbollah, Nujaba et al.', home: 'baghdad',
    start: { money: 15, military: 35, political: 4, stability: 55 }, income: { money: 3, military: 2, political: 1 },
    blurb: 'The Iran-aligned PMF factions celebrated the US withdrawal. They refuse to disarm and want Baghdad to themselves.',
    goals: [
      atMost('No US forces in Iraq or Syria', US_IN_IRAQ_SYRIA, 0, 30, 2),
      atLeast('Keep the weapons', R('iraqMilitias', 'military'), 50, 15, 2),
      atLeast('Dominate Baghdad', INF('baghdad', 'iraqMilitias'), 75, 35, 2),
      atLeast('Tehran stays standing', R('iran', 'stability'), 50, 10, 1),
    ],
  },
  {
    id: 'sdf', name: 'SDF / Rojava Kurds', short: 'SDF', color: '#ffb74d', kind: 'nonstate',
    leader: 'General Mazloum Abdi', home: 'neSyria',
    start: { money: 10, military: 35, political: 3, stability: 50 }, income: { money: 2, military: 2, political: 1 },
    blurb: 'Holding the northeast and the ISIS prisons, squeezed between Ankara and Damascus, with US cover thinning.',
    goals: [
      atLeast('Self-rule preserved', W('kurdishAutonomy'), 70, 20, 3),
      atMost('ISIS kept down', W('isisStrength'), 15, 60, 2),
      atLeast('Hold the northeast', INF('neSyria', 'sdf'), 75, 35, 2),
      atLeast('Survive', R('sdf', 'stability'), 65, 25, 1),
    ],
  },
  {
    id: 'krg', name: 'Kurdistan Region (KRG)', short: 'KRG', color: '#ffd54f', kind: 'state',
    leader: 'Barzani family / Peshmerga', home: 'kurdistan',
    start: { money: 15, military: 30, political: 3, stability: 55 }, income: { money: 3, military: 1, political: 1 },
    blurb: 'Erbil sits between Turkish bases, Iranian drones and Baghdad\'s militias, trying to keep oil revenue flowing and the war away.',
    goals: [
      atLeast('A stable Kurdistan', R('krg', 'stability'), 70, 35, 3),
      atMost('Keep Iran and its militias out', (s) => (s.theaters.kurdistan.infl.iran || 0) + (s.theaters.kurdistan.infl.iraqMilitias || 0), 0, 30, 2),
      atLeast('Oil revenue', R('krg', 'money'), 60, 5, 2),
      atLeast('Autonomy secured', W('kurdishAutonomy'), 55, 25, 1),
    ],
  },
  {
    id: 'isis', name: 'Islamic State', short: 'ISIS', color: '#9e9e9e', kind: 'nonstate',
    leader: 'Shura council (anonymous)', home: 'badiya',
    start: { money: 6, military: 18, political: 2, stability: 50 }, income: { money: 1, military: 2, political: 1 },
    blurb: 'Waiting in the desert for the vacuum. Every distracted army and unguarded prison is an opportunity.',
    goals: [
      atLeast('Resurgence', W('isisStrength'), 70, 20, 4),
      atLeast('Hold the Badiya', INF('badiya', 'isis'), 60, 20, 2),
      atLeast('Fighters in the field', R('isis', 'military'), 40, 10, 2),
    ],
  },
  {
    id: 'syria', name: 'Syrian Government', short: 'SYR', color: '#d06a3a', kind: 'state',
    leader: 'President Ahmed al-Sharaa', home: 'damascus',
    start: { money: 15, military: 35, political: 4, stability: 48 }, income: { money: 3, military: 2, political: 2 },
    blurb: 'A new government trying to reunify a shattered country, with Israel in the south, the SDF in the northeast and ISIS in the desert.',
    goals: [
      atMost('Reunify Syria (SDF integrated)', W('kurdishAutonomy'), 15, 70, 2),
      atMost('Israel out of the south', INF('southSyria', 'israel'), 5, 50, 2),
      atLeast('Reconstruction stability', R('syria', 'stability'), 65, 30, 2),
      atMost('Crush ISIS', W('isisStrength'), 15, 60, 1),
      atLeast('Reconstruction money', R('syria', 'money'), 70, 5, 1),
    ],
  },
  {
    id: 'lebanon', name: 'Lebanese State (LAF)', short: 'LBN', color: '#e57373', kind: 'state',
    leader: 'President Aoun / PM Salam', home: 'beirut',
    start: { money: 6, military: 20, political: 3, stability: 40 }, income: { money: 1, military: 1, political: 1 },
    blurb: 'Signed the June framework with Israel and the US: the army deploys as Hezbollah is verified disarmed, Israel withdraws in stages. Beirut must make it real without civil war.',
    goals: [
      atLeast('State monopoly on arms', W('hezbollahDisarm'), 70, 10, 3),
      atMost('Israeli withdrawal', INF('southLebanon', 'israel'), 0, 50, 2),
      atLeast('Recovery', R('lebanon', 'stability'), 60, 20, 2),
      atLeast('Reconstruction funds', R('lebanon', 'money'), 40, 0, 1),
    ],
  },
  {
    id: 'eu', name: 'European Union', short: 'EU', color: '#5c6bc0', kind: 'superpower',
    leader: 'Commission / E3', home: null,
    start: { money: 90, military: 40, political: 7, stability: 60 }, income: { money: 12, military: 2, political: 3 },
    blurb: 'Paying for the war at the pump. Europe wants energy prices down, Gaza fed, the Red Sea open and Iran kept from the bomb by diplomacy.',
    goals: [
      atMost('Energy prices down', W('oil'), 80, 120, 3, '$'),
      atLeast('Gaza humanitarian relief', W('humanitarian'), 60, 10, 2),
      atMost('No Iranian bomb', W('iranNuclear'), 30, 80, 2),
      atLeast('Red Sea open (Aspides)', W('redSea'), 80, 20, 1, '%'),
      atLeast('Diplomatic relevance', EU_FOOTPRINT, 70, 20, 1),
    ],
  },
  {
    id: 'russia', name: 'Russia', short: 'RUS', color: '#b71c1c', kind: 'superpower',
    leader: 'President Putin', home: null,
    start: { money: 50, military: 60, political: 6, stability: 58 }, income: { money: 6, military: 2, political: 2 },
    blurb: 'Profiting from $100 oil and a distracted Washington. Moscow arms Tehran quietly and relays its terms to Trump.',
    goals: [
      atLeast('Petro revenues', W('oil'), 110, 70, 2, '$'),
      atLeast('Keep Iran standing', R('iran', 'stability'), 55, 15, 2),
      atLeast('Keep the Syrian bases', INF('tartus', 'russia'), 60, 20, 2),
      atMost('America bogged down', W('usWarSupport'), 25, 60, 2, '%'),
    ],
  },
  {
    id: 'china', name: 'China', short: 'PRC', color: '#ff7043', kind: 'superpower',
    leader: 'President Xi', home: null,
    start: { money: 110, military: 50, political: 7, stability: 70 }, income: { money: 14, military: 2, political: 3 },
    blurb: 'The largest buyer of Gulf oil, watching its energy lifeline choke. Beijing wants Hormuz open and a broker\'s role, without picking a side.',
    goals: [
      atLeast('Energy security: Hormuz open', W('hormuz'), 85, 20, 3, '%'),
      atMost('Affordable oil', W('oil'), 85, 120, 2, '$'),
      atLeast('Economic footprint', CHINA_FOOTPRINT, 80, 10, 2),
    ],
  },
];

export const ACTOR_BY_ID = Object.fromEntries(ACTORS.map((a) => [a.id, a]));

// Starting relations (-100 hostile .. +100 allied). Unlisted pairs are 0, except ISIS which defaults to -80.
export const RELATIONS = {
  'us|israel': 85, 'us|saudi': 60, 'us|egypt': 45, 'us|turkey': 25, 'us|eu': 50, 'us|krg': 50, 'us|sdf': 35,
  'us|iran': -90, 'us|houthis': -70, 'us|hezbollah': -80, 'us|hamas': -80, 'us|pij': -80, 'us|iraqMilitias': -75,
  'us|russia': -40, 'us|china': -35, 'us|syria': 15, 'us|lebanon': 40,
  'israel|iran': -100, 'israel|hezbollah': -100, 'israel|hamas': -100, 'israel|pij': -100, 'israel|houthis': -90,
  'israel|iraqMilitias': -80, 'israel|turkey': -45, 'israel|saudi': 10, 'israel|egypt': 15, 'israel|eu': 10,
  'israel|syria': -20, 'israel|china': -10, 'israel|lebanon': -30, 'israel|krg': 25, 'israel|sdf': 20,
  'iran|hezbollah': 90, 'iran|houthis': 75, 'iran|iraqMilitias': 85, 'iran|hamas': 55, 'iran|pij': 70, 'iran|russia': 55,
  'iran|china': 40, 'iran|saudi': -30, 'iran|turkey': -10, 'iran|eu': -35, 'iran|krg': -35, 'iran|sdf': -10,
  'iran|syria': -45, 'iran|egypt': -10,
  'turkey|sdf': -80, 'turkey|syria': 70, 'turkey|hamas': 35, 'turkey|krg': 30, 'turkey|eu': 15, 'turkey|russia': 10,
  'turkey|saudi': 20, 'turkey|egypt': 10, 'turkey|china': 10, 'turkey|iraqMilitias': -20,
  'saudi|houthis': -85, 'saudi|egypt': 50, 'saudi|eu': 30, 'saudi|china': 40, 'saudi|russia': 25, 'saudi|hamas': -30,
  'saudi|hezbollah': -60, 'saudi|syria': 50, 'saudi|lebanon': 30, 'saudi|iraqMilitias': -40,
  'egypt|hamas': -20, 'egypt|houthis': -40, 'egypt|eu': 35, 'egypt|pij': -20, 'egypt|china': 20,
  'houthis|hamas': 40, 'houthis|hezbollah': 60, 'houthis|iraqMilitias': 50, 'houthis|eu': -50,
  'hezbollah|hamas': 45, 'hezbollah|iraqMilitias': 70, 'hezbollah|syria': -60, 'hezbollah|lebanon': -10, 'hezbollah|pij': 50,
  'hamas|pij': 70, 'hamas|eu': -60,
  'iraqMilitias|krg': -40, 'iraqMilitias|sdf': -10,
  'sdf|krg': 20, 'sdf|syria': -20, 'sdf|eu': 20,
  'krg|eu': 25,
  'syria|russia': 10, 'syria|eu': 30, 'syria|lebanon': 30,
  'eu|russia': -70, 'eu|lebanon': 40,
  'russia|china': 60, 'russia|houthis': 10,
};
