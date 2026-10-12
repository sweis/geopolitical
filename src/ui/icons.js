// Inline SVG icon sheet (24×24, stroke-based) and the mapping from actions/options to icons.
// Injected once into the document; referenced with <svg class="ic"><use href="#i-name"/></svg>.
const P = (d) => `<path d="${d}"/>`;
const SYMBOLS = {
  crosshair: `<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>${P('M12 2v4M12 18v4M2 12h4M18 12h4')}`,
  burst: P('M12 3l2 5 5-2-2 5 5 2-5 2 2 5-5-2-2 5-2-5-5 2 2-5-5-2 5-2-2-5 5 2z'),
  chevrons: P('M5 6l6 6-6 6M13 6l6 6-6 6'),
  anchor: `<circle cx="12" cy="5" r="2.5"/>${P('M12 7.5V21M5 13H3c0 5 4 8 9 8s9-3 9-8h-2M8 12h8')}`,
  crate: `<rect x="3" y="7" width="18" height="14" rx="1"/>${P('M3 12h18M12 7v14M8 7l2-4h4l2 4')}`,
  coin: `<circle cx="12" cy="12" r="9"/>${P('M12 6v12M9.5 9.5c0-1 1-2 2.5-2s2.5 1 2.5 2-1 1.8-2.5 2.2-2.5 1.1-2.5 2.3 1 2 2.5 2 2.5-1 2.5-2')}`,
  eye: `${P('M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z')}<circle cx="12" cy="12" r="3"/>`,
  bubble: P('M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'),
  flag: P('M5 21V4M5 4h12l-3 4 3 4H5'),
  shield: P('M12 3l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z'),
  pause: P('M8 5v14M16 5v14'),
  clock: `<circle cx="12" cy="12" r="9"/>${P('M12 7v5l3.5 2')}`,
  alert: P('M12 3l10 18H2L12 3zM12 10v5M12 18v.5'),
  star: P('M12 3l2.8 6 6.2.7-4.6 4.3 1.3 6.3L12 17l-5.7 3.3 1.3-6.3L3 9.7 9.2 9z'),
  bolt: P('M13 2L4 14h7l-1 8 9-12h-7l1-8z'),
  hammer: P('M3 21l8-8M11 13l3 3M14 6l4 4M9 11l6-6 4 4-6 6-4-4z'),
  drop: P('M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z'),
  wave: P('M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0M2 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0'),
  hand: P('M7 11V6a2 2 0 0 1 4 0v5M11 10V4a2 2 0 0 1 4 0v6M15 11V6a2 2 0 0 1 4 0v8a7 7 0 0 1-7 7h-1a7 7 0 0 1-7-7v-2a2 2 0 0 1 4 0'),
  scale: P('M12 3v18M4 7h16M6 7l-3 7a4 4 0 0 0 6 0L6 7zM18 7l-3 7a4 4 0 0 0 6 0l-3-7zM8 21h8'),
  check: P('M4 12l5 5L20 7'),
  cross: P('M6 6l12 12M18 6L6 18'),
  diamond: P('M12 3l9 9-9 9-9-9 9-9z'),
  skull: `<circle cx="12" cy="10" r="7"/>${P('M9 21v-4M15 21v-4M9 10h.01M15 10h.01M10 14h4')}`,
  globe: `<circle cx="12" cy="12" r="9"/>${P('M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18')}`,
  people: `<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/>${P('M3 20c0-4 3-6 6-6s6 2 6 6M15 20c0-3 2-5 4-5s3 2 3 5')}`,
};

export function iconSheet() {
  return `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${Object.entries(SYMBOLS).map(([k, body]) => `<symbol id="i-${k}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`).join('')}</svg>`;
}
export const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${SYMBOLS[name] ? name : 'diamond'}"/></svg>`;

const ACTION_ICON = {
  strike: 'crosshair', massiveBombing: 'burst', offensive: 'chevrons', harass: 'wave', escort: 'anchor', armProxy: 'crate',
  decapitation: 'crosshair', hold: 'pause', fortify: 'shield', terror: 'burst', prisonBreak: 'chevrons', counterTerror: 'crosshair',
  nuclearDash: 'burst', ceasefire: 'hand', disarm: 'scale', deployISF: 'people', normalize: 'hand', sanctions: 'scale', talks: 'bubble',
  annex: 'flag', unResolution: 'globe', reliefGaza: 'crate', bankroll: 'coin', oilUp: 'drop', oilCut: 'drop', invest: 'hammer', buyOil: 'drop',
  cyber: 'bolt', infoOps: 'eye', rally: 'flag', crackdown: 'shield', recruit: 'people', autonomy: 'flag', withdraw: 'pause',
};
export const actionIcon = (id) => ACTION_ICON[id] ?? 'diamond';

// Heuristic for hand-written options: match words in the id and label.
const RULES = [
  [/retaliat|strike|escalat|rocket|missile|drone|launcher|preempt|pre-empt|attack|hunt|storm|bomb|salvo|press|push|operation|counter|crush|sweep|fire|hit/i, 'crosshair'],
  [/wait|ignore|absorb|hold|delay|drift|watch|pass|none|no deal|decline|refuse|stay|sit|keep|not (now|yet|this)|lie low|ride|let it|string/i, 'pause'],
  [/pay|money|cash|fund|bank|subsid|borrow|bond|deposit|tranche|print|sell|tax|toll|reserve|rent|windfall|oil|crude|barrel|pump|taps|quota/i, 'coin'],
  [/talk|negotiat|accept|terms|deal|channel|mediat|summit|broker|lobby|support|back|appeal|ask|demand|offer|envoy|conditions|relay|host|treaty|normaliz|pivot|recogni|amnesty|integrat|autonomy|unity|coalition|elections|mandate|comply|concede|concession|handover|hand over|withdraw|pull back|freeze/i, 'bubble'],
  [/harden|defend|fortify|reinforce|interceptor|air defen|seal|border|fence|crackdown|crack down|purge|arrest|guard|prison|camp|secure/i, 'shield'],
  [/hide|covert|sabotage|quiet|smuggl|run the|dhow|defector|leak|deny|intelligence|share the|tip|expose|blame|spin/i, 'eye'],
  [/arm|weapon|resupply|shipment|missiles|equip|train|mobiliz|recruit|cadres|levies|troops|peacekeep|escort|frigate|navy|convoy|coalition/i, 'crate'],
  [/rally|speech|base|street|flag|declare|announce|claim|statement|nation/i, 'flag'],
  [/invest|rebuild|reconstruct|port|project|contract|pipeline/i, 'hammer'],
];
export function optionIcon(o) {
  if (o.icon) return o.icon;
  if (o.action) return actionIcon(o.action);
  const s = `${o.id} ${o.label}`;
  for (const [re, name] of RULES) if (re.test(s)) return name;
  return 'diamond';
}

export const KIND_ICON = { crisis: 'alert', opportunity: 'star', intel: 'eye' };
export const OUTCOME_ICON = { success: 'check', crit: 'diamond', fail: 'cross', blowback: 'skull', fizzle: 'pause', auto: 'check' };
export const OP_ICON = { started: 'clock', arrived: 'anchor', done: 'check', failed: 'cross', stood_down: 'pause', disrupted: 'burst', stalled: 'alert' };
