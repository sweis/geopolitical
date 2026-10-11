// Situations that apply to whole classes of actors, parameterized by who did what to whom.
import { C, FREE, fromAction, opt } from './dsl.js';
import { ACTOR_BY_ID } from '../actors.js';
import { homeOf } from '../../engine/state.js';
import { canUse, ACTION_BY_ID, ACTIONS, affordable } from '../../engine/actions.js';
import { simClone } from '../../engine/state.js';

const can = (h, id) => canUse(ACTION_BY_ID[id], h.p);
const hasTarget = (h, id, t) => { try { return ACTION_BY_ID[id].targets(h.s, h.p).includes(t); } catch { return false; } };
const isState = (h) => h.kind !== 'nonstate';
const VERB = { strike: 'struck', massiveBombing: 'bombed', offensive: 'attacked', harass: 'attacked shipping around', decapitation: 'assassinated a senior figure of', terror: 'bombed', prisonBreak: 'stormed prisons in', cyber: 'hacked', infoOps: 'ran an influence campaign against', sanctions: 'sanctioned', counterTerror: 'raided' };

export const GENERIC = [
  // ── Someone hit you ──
  {
    id: 'g_struck', who: 'ALL', kind: 'crisis', priority: 80, cooldown: 1,
    when: (h) => h.hit(1).length > 0,
    at: (h) => h.home ?? homeOf(h.hit(1)[0].actor),
    title: (h) => `${h.name(h.hit(1)[0].actor)} ${VERB[h.hit(1)[0].action] ?? 'struck'} you`,
    text: (h) => {
      const hits = h.hit(1);
      const r = hits[0];
      const more = hits.length > 1 ? ` ${hits.length - 1} other hostile ${hits.length > 2 ? 'moves' : 'move'} landed in the same fortnight.` : '';
      const base = isState(h) ? 'Your public demands a response; your generals say the enemy expects one.' : 'Your fighters want blood; your political wing wants the ceasefire talks kept alive.';
      return `${r.text}${more} ${base}`;
    },
    options: (h) => {
      const r = h.hit(1)[0];
      const foe = r.actor, foeHome = homeOf(foe);
      const out = [];
      if (foeHome && can(h, 'strike') && hasTarget(h, 'strike', foeHome))
        out.push(fromAction(h, 'strike', foeHome, { id: 'retaliate', label: `Retaliate against ${h.short(foeHome)}`, text: 'Hit back in kind. Restores deterrence; raises the temperature.', bonus: 0.05, why: 'Targets were mapped while they attacked', success: (h2) => { h2.rel(h2.p, foe, -5); h2.res(h2.p, { stability: 2 }); } }));
      else if (foeHome && can(h, 'offensive') && hasTarget(h, 'offensive', foeHome))
        out.push(fromAction(h, 'offensive', foeHome, { id: 'retaliate', label: `Counter-attack in ${h.short(foeHome)}`, bonus: 0.05, why: 'Enemy forces are exposed after their attack' }));
      else if (foe && can(h, 'infoOps') && hasTarget(h, 'infoOps', foe))
        out.push(fromAction(h, 'infoOps', foe, { id: 'retaliate', label: `Expose and shame ${h.short(foe)}`, text: 'Flood the information space with the attack\'s civilian cost.', bonus: 0.1, why: 'Fresh footage, global attention' }));
      out.push(opt({
        id: 'harden', label: 'Harden defenses', text: 'Disperse assets, dig in, buy interceptors.', cost: C(4, 0, 0),
        success: (h2) => { h2.res(h2.p, { military: 6, stability: 1 }); if (h2.home) h2.tension(h2.home, -4); },
        say: { success: 'Defenses were hardened; the next strike will find less to hit.' },
      }));
      out.push(opt({
        id: 'absorb', label: 'Absorb the blow and rally', text: 'Bury the dead, show resolve, hold the line for now.', cost: C(0, 0, 1),
        success: (h2) => { h2.res(h2.p, { stability: 3 }); if (h2.p === 'us') h2.W('usWarSupport', 2); },
        say: { success: 'You chose restraint. The home front held, for now.' }, default: true,
      }));
      const patron = h.patron();
      if (patron) out.push(opt({
        id: 'appeal', label: `Appeal to ${h.short(patron)}`, text: `Ask your patron for air defenses, cash and a public warning to ${h.short(foe)}.`, cost: C(0, 0, 2),
        odds: 0.35, reasons: (h2) => [{ text: `${h2.short(patron)} relationship ${h2.relOf(patron)}`, d: h2.relOf(patron) / 400 }],
        success: (h2) => { h2.res(h2.p, { military: 6, money: 4 }); h2.rel(h2.p, patron, 4); h2.rel(patron, foe, -6); h2.tension(h2.home ?? foeHome, -5); },
        fail: (h2) => { h2.rel(h2.p, patron, -3); },
        say: { success: `${h.name(patron)} answered: deliveries, a public warning to ${h.short(foe)}, and a quiet promise of more.`, fail: `${h.name(patron)} offered sympathy and little else.` },
      }));
      return out;
    },
  },

  // ── Unrest at home ──
  {
    id: 'g_unrest', who: 'ALL', kind: 'crisis', priority: 70, cooldown: 3,
    when: (h) => h.me.stability < 35,
    at: (h) => h.home,
    title: (h) => (isState(h) ? 'Unrest in the streets' : 'The base is restless'),
    text: (h) => isState(h)
      ? `Strikes, blackouts and funerals have turned into protests in ${h.short(h.home)}. The security services are asking for orders; the finance ministry is asking for money.`
      : 'Field commanders complain of unpaid salaries and absent leaders. Rival factions are recruiting your men. Something has to give.',
    options: (h) => [
      opt({ id: 'crackdown', label: 'Crack down', text: 'Arrests, curfews, show trials. Fast and ugly.', cost: C(2, 3, 0), odds: 0.75,
        reasons: (h2) => [...(h2.me.stability < 20 ? [{ text: 'Security forces may not obey', d: -0.15 }] : [])],
        success: (h2) => { h2.res(h2.p, { stability: 9 }); h2.rel(h2.p, 'eu', -6); }, fail: (h2) => { h2.res(h2.p, { stability: -6 }); },
        say: { success: 'The crackdown worked. The streets are quiet and the prisons are full.', fail: 'The crackdown sparked wider unrest; units refused orders.' } }),
      opt({ id: 'concede', label: 'Concessions and cash', text: 'Pay arrears, promise reforms, release prisoners.', cost: C(8, 0, 0),
        success: (h2) => { h2.res(h2.p, { stability: 7 }); }, say: { success: 'Money and promises took the heat out of the protests.' } }),
      opt({ id: 'blame', label: 'Blame the enemy', text: 'Pin the misery on foreign hands and rally the faithful.', cost: C(0, 0, 1), odds: 0.55,
        reasons: (h2) => [...(h2.enemies(-60).length ? [{ text: 'A credible villain is available', d: 0.1 }] : [])],
        success: (h2) => { h2.res(h2.p, { stability: 5 }); const e = h2.enemies(-60)[0]; if (e) h2.rel(h2.p, e, -5); },
        fail: (h2) => { h2.res(h2.p, { stability: -3 }); },
        say: { success: 'The rally worked; the crowd found a foreign enemy to hate.', fail: 'Nobody believed it. The chants turned on you instead.' }, default: true }),
    ],
  },

  // ── Out of money ──
  {
    id: 'g_broke', who: 'ALL', kind: 'crisis', priority: 60, cooldown: 4,
    when: (h) => h.me.money < 4,
    at: (h) => h.home,
    title: 'The treasury is empty',
    text: (h) => (isState(h) ? 'Salaries are late, contractors have stopped work and the central bank is burning reserves. Your options are all bad.' : 'The money has run out. Fighters are drifting home and suppliers want cash up front.'),
    options: (h) => {
      const patron = h.patron();
      const out = [
        opt({ id: 'austerity', label: 'Austerity', text: 'Cut everything that is not a gun or a salary.', cost: FREE, success: (h2) => { h2.res(h2.p, { money: 8, stability: -4 }); }, say: { success: 'Austerity bought breathing room and cost goodwill.' }, default: true }),
        opt({ id: 'print', label: isState(h) ? 'Print money' : 'Borrow from the networks', text: isState(h) ? 'Inflation later for cash now.' : 'Loans from the diaspora and the smugglers.', cost: C(0, 0, 1), success: (h2) => { h2.res(h2.p, { money: 6, stability: -2 }); }, say: { success: 'Cash now; the bill comes later.' } }),
      ];
      if (patron) out.push(opt({ id: 'patron', label: `Ask ${h.short(patron)} for a bailout`, text: 'Emergency deposits in exchange for loyalty.', cost: C(0, 0, 1), odds: 0.5,
        reasons: (h2) => [{ text: `${h2.short(patron)} relationship ${h2.relOf(patron)}`, d: h2.relOf(patron) / 300 }],
        success: (h2) => { h2.res(h2.p, { money: 14 }); h2.rel(h2.p, patron, 5); if (h2.home) h2.inf(h2.home, patron, 5); },
        say: { success: `${h.name(patron)} wired the money, with strings attached.`, fail: `${h.name(patron)} said no.` } }));
      if (['saudi', 'russia', 'iran', 'krg'].includes(h.p)) out.push(opt({ id: 'dump', label: 'Sell crude at a discount', text: 'Move barrels to anyone who will take them.', cost: FREE,
        success: (h2) => { h2.res(h2.p, { money: 10 }); h2.W('oilAdj', -2); }, say: { success: 'Discounted cargoes found buyers; the price slipped.' } }));
      if (h.kind === 'nonstate') out.push(opt({ id: 'tax', label: 'Squeeze the population', text: 'Checkpoint taxes, smuggling rents, aid diversion.', cost: FREE,
        success: (h2) => { h2.res(h2.p, { money: 7, stability: -3 }); if (['hamas', 'pij'].includes(h2.p)) h2.W('humanitarian', -4); }, say: { success: 'Checkpoints and smuggling rents refilled the war chest, at the people\'s expense.' } }));
      return out;
    },
  },

  // ── A partner asks for help ──
  {
    id: 'g_partner', who: 'STATE', kind: 'opportunity', priority: 40, cooldown: 3,
    when: (h) => h.me.money >= 10 && partnerInNeed(h) != null,
    at: (h) => homeOf(partnerInNeed(h)),
    title: (h) => `${h.name(partnerInNeed(h))} asks for help`,
    text: (h) => { const b = partnerInNeed(h); const a = h.A(b); return `${h.name(b)} sends an envoy: ${a.military < 30 ? 'its forces are depleted' : 'its leadership is losing its grip'} and it needs ${a.military < 30 ? 'weapons' : 'money'} now. ${h.relOf(b) >= 70 ? 'This is your closest partner in the region.' : 'Refusing will be noticed.'}`; },
    options: (h) => {
      const b = partnerInNeed(h);
      const out = [];
      if (can(h, 'armProxy')) out.push(fromAction(h, 'armProxy', b, { id: 'arms', label: 'Send weapons and advisers', text: 'Rebuilds their strength and binds them to you.' }));
      out.push(opt({ id: 'money', label: 'Send money', text: 'Budget support, no questions asked.', cost: C(10, 0, 0), success: (h2) => { h2.res(b, { money: 9, stability: 4 }); h2.rel(h2.p, b, 8); const hm = homeOf(b); if (hm) h2.inf(hm, h2.p, 5); }, say: { success: `Your money steadied ${h.name(b)}.` } }));
      out.push(opt({ id: 'decline', label: 'Decline politely', text: 'Keep your resources for your own fights.', cost: FREE, success: (h2) => { h2.rel(h2.p, b, -6); }, say: { success: `${h.name(b)} went away empty-handed and remembered it.` }, default: true }));
      return out;
    },
  },

  // ── An enemy is tottering ──
  {
    id: 'g_enemy_weak', who: 'ALL', kind: 'opportunity', priority: 50, cooldown: 4,
    when: (h) => weakEnemy(h) != null,
    at: (h) => homeOf(weakEnemy(h)),
    title: (h) => `${h.name(weakEnemy(h))} is tottering`,
    text: (h) => { const e = weakEnemy(h); return `Intelligence says ${h.name(e)}'s leadership is fracturing: stability is at ${Math.round(h.A(e).stability)} and falling. Press now, or offer terms while they are weak?`; },
    options: (h) => {
      const e = weakEnemy(h), eh = homeOf(e);
      const out = [];
      if (eh && can(h, 'strike') && hasTarget(h, 'strike', eh)) out.push(fromAction(h, 'strike', eh, { id: 'press', label: 'Press the advantage', text: 'Strike while their command is in disarray.', bonus: 0.1, why: 'Enemy command is in disarray' }));
      else if (eh && can(h, 'offensive') && hasTarget(h, 'offensive', eh)) out.push(fromAction(h, 'offensive', eh, { id: 'press', label: 'Press the advantage', bonus: 0.1, why: 'Enemy command is in disarray' }));
      out.push(opt({ id: 'terms', label: 'Offer terms', text: 'A quiet channel: de-escalation now, talks later.', cost: C(0, 0, 2), odds: 0.5,
        reasons: (h2) => [{ text: 'They need a way out', d: 0.1 }, ...(h2.relOf(e) <= -90 ? [{ text: 'Decades of hatred', d: -0.1 }] : [])],
        success: (h2) => { h2.rel(h2.p, e, 15); if (eh) h2.tension(eh, -12); if (h2.home) h2.tension(h2.home, -8); h2.res(h2.p, { stability: 2 }); h2.res(e, { stability: 3 }); h2.set(`truce:${h2.p}:${e}`, h2.turn); },
        fail: (h2) => { h2.res(h2.p, { political: -1 }); },
        say: { success: `${h.name(e)} took the lifeline. A fragile truce is in place.`, fail: `${h.name(e)} publicly rejected your terms and called them surrender.` } }));
      out.push(opt({ id: 'covert', label: 'Back the opposition', text: 'Money and messaging for their rivals.', cost: C(4, 0, 1), odds: 0.5,
        reasons: () => [{ text: 'Discontent is already high', d: 0.1 }],
        success: (h2) => { h2.res(e, { stability: -6 }); }, fail: (h2) => { h2.rel(h2.p, e, -10); h2.res(h2.p, { political: -1 }); },
        say: { success: `Your money reached ${h.name(e)}'s rivals; the infighting got worse.`, fail: 'The operation was exposed. Their hardliners used it to close ranks.' } }));
      out.push(opt({ id: 'watch', label: 'Watch and wait', text: 'Let them bleed.', cost: FREE, success: () => {}, say: { success: 'You watched them bleed.' }, default: true }));
      return out;
    },
  },

  // ── Oil shock for importers ──
  {
    id: 'g_oil_shock', who: 'IMPORTER', kind: 'crisis', priority: 45, cooldown: 4,
    when: (h) => h.w.oil >= 105,
    at: 'hormuz',
    title: (h) => `Brent at $${h.w.oil}`,
    text: (h) => `Fuel queues, factory shutdowns and a widening deficit. ${h.p === 'eu' ? 'Finance ministers want a joint response before the winter.' : 'The cabinet wants a response before the street provides one.'}`,
    options: (h) => [
      opt({ id: 'subsidy', label: 'Subsidize fuel', text: 'Cap prices at the pump and eat the difference.', cost: C(8, 0, 0), success: (h2) => { h2.res(h2.p, { stability: 4 }); }, say: { success: 'Subsidies kept the pumps affordable and the budget bleeding.' } }),
      ...(['eu', 'china'].includes(h.p) ? [opt({ id: 'reserves', label: 'Release strategic reserves', text: 'Flood the market with stored crude.', cost: C(4, 0, 0), success: (h2) => { h2.W('oilAdj', -5); h2.res(h2.p, { stability: 2 }); }, say: { success: 'Reserve crude hit the market and prices eased.' } })] : []),
      opt({ id: 'ride', label: 'Ride it out', text: 'Let prices bite and blame the war.', cost: FREE, success: (h2) => { h2.res(h2.p, { stability: -3 }); }, say: { success: 'You let the prices bite. People noticed.' }, default: true }),
    ],
  },

  // ── Windfall for exporters ──
  {
    id: 'g_windfall', who: 'EXPORTER', kind: 'opportunity', priority: 40, cooldown: 4,
    when: (h) => h.w.oil >= 100 && h.me.collapsed === false,
    at: (h) => h.home,
    title: (h) => `Windfall: Brent at $${h.w.oil}`,
    text: (h) => `Every barrel you can move earns a premium. ${h.p === 'iran' ? 'The dark fleet is sailing at full stretch.' : 'Washington and Beijing are both asking what you will do with it.'}`,
    options: (h) => [
      opt({ id: 'bank', label: 'Bank it', text: 'Build reserves for the fights ahead.', cost: FREE, success: (h2) => { h2.res(h2.p, { money: 8 }); }, say: { success: 'The windfall went into reserves.' }, default: true }),
      opt({ id: 'allies', label: 'Discount barrels for friends', text: 'Cheap crude for partners buys goodwill.', cost: FREE, success: (h2) => { for (const a of h2.allies(30).slice(0, 2)) h2.rel(h2.p, a, 6); h2.res(h2.p, { money: 3 }); }, say: { success: 'Discounted cargoes bought goodwill in friendly capitals.' } }),
      opt({ id: 'spend', label: 'Spend it at home', text: 'Subsidies and salaries while the money lasts.', cost: FREE, success: (h2) => { h2.res(h2.p, { money: 2, stability: 5 }); }, say: { success: 'Oil money flowed into salaries and subsidies.' } }),
    ],
  },

  // ── A mediator offers talks with an enemy ──
  {
    id: 'g_mediator', who: 'ALL', kind: 'opportunity', priority: 45, cooldown: 4,
    when: (h) => mediated(h) != null,
    at: (h) => homeOf(mediated(h).foe) ?? h.home,
    title: (h) => `${h.name(mediated(h).via)} offers to mediate with ${h.short(mediated(h).foe)}`,
    text: (h) => { const m = mediated(h); return `${h.name(m.via)} proposes quiet talks with ${h.name(m.foe)}: a mutual pause, prisoner exchanges, maybe more. Your hawks call it a trap; your treasury calls it relief.`; },
    options: (h) => {
      const { via, foe } = mediated(h);
      return [
        opt({ id: 'accept', label: 'Accept the channel', text: 'Send a delegation; see what they offer.', cost: C(0, 0, 2), odds: 0.55,
          reasons: (h2) => [{ text: `${h2.short(via)} is trusted by both sides`, d: 0.1 }, ...(h2.A(foe).stability < 35 ? [{ text: 'They need a pause more than you', d: 0.1 }] : [])],
          success: (h2) => { h2.rel(h2.p, foe, 12); h2.rel(h2.p, via, 5); const fh = homeOf(foe); if (fh) h2.tension(fh, -10); if (h2.home) h2.tension(h2.home, -10); h2.set(`talks:${h2.p}:${foe}`, h2.turn); },
          fail: (h2) => { h2.res(h2.p, { political: -1 }); h2.res(h2.p, { stability: -2 }); },
          say: { success: `Talks in ${h.short(via)} produced a pause and a channel that stays open.`, fail: 'The talks collapsed on the first day; your hawks are vindicated.' } }),
        opt({ id: 'conditions', label: 'Accept with conditions', text: 'Demand a concession up front. Higher reward, more likely to fail.', cost: C(0, 0, 3), odds: 0.35,
          reasons: (h2) => [...(h2.A(foe).stability < 35 ? [{ text: 'They need a pause more than you', d: 0.15 }] : [])],
          success: (h2) => { h2.rel(h2.p, foe, 10); h2.res(foe, { military: -4, political: -1 }); h2.res(h2.p, { stability: 4, political: 2 }); const fh = homeOf(foe); if (fh) h2.tension(fh, -10); },
          fail: (h2) => { h2.rel(h2.p, via, -5); h2.res(h2.p, { political: -1 }); },
          say: { success: `${h.name(foe)} swallowed your condition. A real win at the table.`, fail: `${h.name(foe)} walked out and ${h.short(via)} blamed you.` } }),
        opt({ id: 'refuse', label: 'Refuse', text: 'No talks while they shoot.', cost: FREE, success: (h2) => { h2.res(h2.p, { stability: 2 }); h2.rel(h2.p, via, -3); }, say: { success: 'You refused. The hawks cheered; the mediator shrugged.' }, default: true }),
      ];
    },
  },

  // ── A partner collapsed ──
  {
    id: 'g_ally_collapse', who: 'ALL', kind: 'crisis', priority: 65, cooldown: 1,
    when: (h) => collapsedAlly(h) != null,
    at: (h) => homeOf(collapsedAlly(h)) ?? h.home,
    title: (h) => `${h.name(collapsedAlly(h))} has collapsed`,
    text: (h) => `${h.name(collapsedAlly(h))}, your partner, has ceased to function as a coherent force. Its territory is up for grabs and its people are on the move.`,
    options: (h) => {
      const b = collapsedAlly(h), bh = homeOf(b);
      return [
        ...(bh && can(h, 'offensive') ? [fromAction(h, 'offensive', bh, { id: 'fill', label: `Move into ${h.short(bh)}`, text: 'Fill the vacuum before an enemy does.', bonus: 0.15, why: 'No organized resistance' })] : []),
        opt({ id: 'rebuild', label: 'Fund a successor', text: 'Money and recognition for whoever can hold the ground.', cost: C(8, 0, 1), odds: 0.5, success: (h2) => { if (bh) h2.inf(bh, h2.p, 15); h2.res(h2.p, { political: 1 }); }, fail: (h2) => {}, say: { success: 'A successor leadership emerged under your patronage.', fail: 'The money vanished into a dozen feuding commanders.' } }),
        opt({ id: 'writeoff', label: 'Write them off', text: 'Cut losses.', cost: FREE, success: (h2) => { h2.res(h2.p, { stability: -2 }); }, say: { success: 'You wrote them off.' }, default: true }),
      ];
    },
  },

  // ── The front heats up ──
  {
    id: 'g_front', who: 'ALL', kind: 'crisis', priority: 55, cooldown: 3,
    when: (h) => !!h.home && h.T(h.home).tension >= 60 && h.hit(1).length === 0,
    at: (h) => h.home,
    title: (h) => `Tension rising in ${h.short(h.home)}`,
    text: (h) => `Skirmishes, drone sightings and mobilization rumours around ${h.short(h.home)}. Your commanders want reinforcements; your diplomats want a channel opened before someone miscalculates.`,
    options: (h) => {
      const foe = hostileAt(h, h.home);
      return [
        opt({ id: 'reinforce', label: 'Reinforce the front', text: 'Move units forward and harden positions.', cost: C(4, 0, 0), success: (h2) => { h2.res(h2.p, { military: 5 }); h2.inf(h2.home, h2.p, 5); h2.tension(h2.home, -6); }, say: { success: 'Reinforcements arrived; the probing stopped.' } }),
        opt({ id: 'deescalate', label: 'Open a deconfliction channel', text: 'Hotlines and a quiet message.', cost: C(0, 0, 1), odds: 0.6,
          reasons: (h2) => [...(foe && h2.relOf(foe) <= -80 ? [{ text: 'No trust on either side', d: -0.15 }] : [])],
          success: (h2) => { h2.tension(h2.home, -15); if (foe) h2.rel(h2.p, foe, 5); }, fail: (h2) => { h2.tension(h2.home, 5); },
          say: { success: 'A hotline and a pause. The front cooled.', fail: 'The message went unanswered and the probing continued.' }, default: true }),
        ...(foe && homeOf(foe) && can(h, 'strike') && hasTarget(h, 'strike', homeOf(foe)) ? [fromAction(h, 'strike', homeOf(foe), { id: 'preempt', label: `Pre-empt ${h.short(foe)}`, text: 'Strike first while they are still massing.', bonus: 0.05, why: 'Forces caught in the open' })] : []),
      ];
    },
  },

  // ── Contested ground ──
  {
    id: 'g_contested', who: 'ALL', kind: 'opportunity', priority: 45, cooldown: 3,
    when: (h) => contested(h) != null,
    at: (h) => contested(h).t,
    title: (h) => `Contested ground in ${h.short(contested(h).t)}`,
    text: (h) => { const { t, foe } = contested(h); return `${h.name(foe)} is building up in ${h.short(t)}, where your own position matters. Surge now, bargain for a share, or cede quietly.`; },
    options: (h) => {
      const { t, foe } = contested(h);
      return [
        opt({ id: 'surge', label: 'Surge', text: 'Money, men and advisers into the theater.', cost: C(5, 4, 0), success: (h2) => { h2.inf(t, h2.p, 10); h2.inf(t, foe, -4); h2.tension(t, 6); }, say: { success: `Your position in ${h.short(t)} grew at ${h.short(foe)}'s expense.` } }),
        opt({ id: 'bargain', label: 'Bargain for a share', text: 'A quiet spheres-of-influence understanding.', cost: C(0, 0, 2), odds: 0.5,
          reasons: (h2) => [{ text: `Relationship with ${h2.short(foe)}: ${h2.relOf(foe)}`, d: h2.relOf(foe) / 400 }],
          success: (h2) => { h2.inf(t, h2.p, 5); h2.rel(h2.p, foe, 8); h2.tension(t, -8); }, fail: (h2) => { h2.inf(t, h2.p, -3); },
          say: { success: `An understanding with ${h.short(foe)} over ${h.short(t)}.`, fail: `${h.name(foe)} took the meeting and kept building.` } }),
        opt({ id: 'cede', label: 'Cede quietly', text: 'Pull back and save the resources.', cost: FREE, success: (h2) => { h2.inf(t, h2.p, -8); h2.res(h2.p, { money: 3 }); }, say: { success: `You pulled back from ${h.short(t)}.` }, default: true }),
      ];
    },
  },

  // ── The patron asks for something ──
  {
    id: 'g_patron_asks', who: 'ALL', kind: 'crisis', priority: 48, cooldown: 4,
    when: (h) => h.kind !== 'superpower' && h.patron() != null,
    at: (h) => homeOf(h.patron()) ?? h.home,
    title: (h) => `${h.name(h.patron())} calls in a favour`,
    text: (h) => { const pt = h.patron(); return `${h.name(pt)} wants ${ASK[pt] ?? 'public support for its position'}. Patrons remember who answered.`; },
    options: (h) => {
      const pt = h.patron();
      return [
        opt({ id: 'deliver', label: 'Deliver', text: 'Give the patron what it asked for.', cost: C(4, 2, 1), success: (h2) => { h2.rel(h2.p, pt, 12); h2.res(h2.p, { political: 1 }); const ph = homeOf(pt); if (ph) h2.inf(ph, h2.p, 3); if (h2.home) h2.inf(h2.home, pt, 4); }, say: { success: `${h.name(pt)} got what it asked for and said so publicly.` } }),
        opt({ id: 'token', label: 'A token gesture', text: 'Enough to be seen, not enough to cost.', cost: C(0, 0, 1), success: (h2) => { h2.rel(h2.p, pt, 3); }, say: { success: 'A statement and a small contribution.' }, default: true }),
        opt({ id: 'refuse', label: 'Refuse', text: 'Your resources are your own.', cost: FREE, success: (h2) => { h2.rel(h2.p, pt, -10); h2.res(h2.p, { stability: 1 }); }, say: { success: `${h.name(pt)} was told no.` } }),
      ];
    },
  },

  // ── A defector ──
  {
    id: 'g_defector', who: 'ALL', kind: 'opportunity', priority: 40, cooldown: 5,
    when: (h) => h.enemies(-60).length > 0 && h.turn >= 2,
    at: (h) => homeOf(h.enemies(-60)[0]) ?? h.home,
    title: (h) => `A defector from ${h.short(h.enemies(-60)[0])}`,
    text: (h) => `A mid-level official from ${h.name(h.enemies(-60)[0])} is offering documents and names in exchange for protection. The intelligence could be gold; it could also be a plant.`,
    options: (h) => {
      const e = h.enemies(-60)[0];
      return [
        opt({ id: 'accept', label: 'Take the defector', text: 'Protection for the files.', cost: C(2, 0, 1), odds: 0.6,
          success: (h2) => { h2.res(e, { stability: -4, political: -1 }); h2.res(h2.p, { political: 2 }); }, fail: (h2) => { h2.res(h2.p, { political: -1, stability: -1 }); },
          say: { success: `The files were genuine. ${h.name(e)} is purging its ministries.`, fail: 'A plant. Two of your own networks were exposed.' } }),
        opt({ id: 'ignore', label: 'Pass', text: 'Too risky.', cost: FREE, default: true, say: { success: 'The offer went unanswered.' } }),
      ];
    },
  },

  // ── A scandal ──
  {
    id: 'g_scandal', who: 'STATE', kind: 'crisis', priority: 42, cooldown: 5,
    when: (h) => h.turn >= 2 && h.me.stability < 65,
    at: (h) => h.home,
    title: 'A scandal breaks',
    text: () => 'Leaked recordings show senior officials diverting war funds and lying about casualties. The opposition smells blood; your allies abroad are asking questions.',
    options: (h) => [
      opt({ id: 'investigate', label: 'Investigate and sack', text: 'Heads roll, credibility survives.', cost: C(0, 0, 1), success: (h2) => { h2.res(h2.p, { stability: 3 }); for (const a of h2.allies(40).slice(0, 2)) h2.rel(h2.p, a, 2); }, say: { success: 'Three officials resigned; the story moved on.' }, default: true }),
      opt({ id: 'deny', label: 'Deny everything', text: 'Call it a forgery.', cost: FREE, odds: 0.5, success: (h2) => { h2.res(h2.p, { stability: 2 }); }, fail: (h2) => { h2.res(h2.p, { stability: -6 }); }, say: { success: 'The denial held.', fail: 'A second leak proved the first.' } }),
      opt({ id: 'foreign', label: 'Blame foreign intelligence', text: 'A hostile operation, obviously.', cost: C(0, 0, 1), success: (h2) => { h2.res(h2.p, { stability: 1 }); const e = h2.enemies(-50)[0]; if (e) h2.rel(h2.p, e, -5); }, say: { success: 'The foreign-plot story bought a week.' } }),
    ],
  },

  // ── An objective is slipping ──
  {
    id: 'g_slipping', who: 'ALL', kind: 'opportunity', priority: 48, cooldown: 2,
    when: (h) => { const sl = slipping(h); return sl != null && servingGoal(h, sl.goal).length >= 1; },
    at: (h) => h.home,
    title: (h) => `Advisers alarmed: ${slipping(h).goal.name}`,
    text: (h) => { const { goal, drop } = slipping(h); return `Progress on "${goal.name}" fell ${Math.round(drop * 100)} points over the last fortnight. Your staff has pulled together the options that would move it, and wants a decision.`; },
    options: (h) => {
      const { goal } = slipping(h);
      const picks = servingGoal(h, goal).slice(0, 2);
      const out = picks.map((c, i) => fromAction(h, c.action, c.target, { id: `fix${i}`, bonus: 0.05, why: 'Staff attention and priority' }));
      out.push(opt({ id: 'accept', label: 'Accept the setback for now', text: 'Other fires are hotter.', cost: FREE, default: true, say: { success: 'The setback was noted and set aside.' } }));
      return out;
    },
  },

  // ── A quiet fortnight (floor card: only dealt when nothing else is pressing) ──
  {
    id: 'g_allocate', who: 'ALL', kind: 'opportunity', priority: 5, cooldown: 2,
    when: () => true,
    at: (h) => h.home,
    title: 'A quiet fortnight',
    text: (h) => (isState(h) ? 'No crisis demands the cabinet\'s attention this fortnight. Use the time: train the forces, shore up the home front, raise money, or work the phones.' : 'A rare quiet fortnight. Train, consolidate the base, raise money, or build political ties.'),
    options: (h) => [
      opt({ id: 'train', label: 'Train and equip', text: 'Exercises, maintenance, new units.', cost: C(4, 0, 0), success: (h2) => { h2.res(h2.p, { military: 6 }); }, say: { success: 'Two weeks of exercises and maintenance.' } }),
      opt({ id: 'consolidate', label: 'Shore up the home front', text: 'Patronage, services, a little theatre.', cost: C(3, 0, 0), success: (h2) => { h2.res(h2.p, { stability: 5 }); }, say: { success: 'Services and patronage bought goodwill at home.' }, default: true }),
      opt({ id: 'raise', label: 'Raise money', text: 'Taxes, sales, donors.', cost: C(0, 0, 1), success: (h2) => { h2.res(h2.p, { money: 8 }); }, say: { success: 'The treasury grew.' } }),
      opt({ id: 'phones', label: 'Work the phones', text: 'Visits, favours and photo opportunities.', cost: C(2, 0, 0), success: (h2) => { h2.res(h2.p, { political: 2 }); for (const a of h2.allies(30).slice(0, 2)) h2.rel(h2.p, a, 3); }, say: { success: 'A fortnight of visits and favours.' } }),
    ],
  },
];

const ASK = { us: 'troops for the Hormuz coalition and a vote with Washington at the UN', iran: 'a public pledge of loyalty to the Axis and a contribution to the Resistance front', saudi: 'public backing for its Yemen policy and a seat for Saudi investors', turkey: 'support for its position on the Syrian Kurds', china: 'a port concession and silence on Xinjiang', russia: 'a vote against Western resolutions and a grain contract', eu: 'reforms on human rights and migration cooperation' };

function hostileAt(h, t) {
  const infl = h.T(t).infl;
  return Object.keys(infl).filter((id) => id !== h.p && h.alive(id) && h.relOf(id) <= -40 && infl[id] >= 10).sort((a, b) => infl[b] - infl[a])[0] ?? null;
}
function contested(h) {
  for (const t of Object.keys(h.s.theaters)) {
    if (t === h.home || h.infOf(t) < 20) continue;
    const foe = Object.keys(h.T(t).infl).find((id) => id !== h.p && h.alive(id) && h.relOf(id) <= -40 && h.infOf(t, id) >= 25);
    if (foe) return { t, foe };
  }
  return null;
}
function slipping(h) {
  const hist = h.s.history;
  if (hist.length < 2 || !hist.at(-1).progress || !hist.at(-2).progress) return null;
  const goals = ACTOR_BY_ID[h.p].goals;
  let best = null;
  goals.forEach((goal, i) => {
    const drop = hist.at(-2).progress[i] - hist.at(-1).progress[i];
    if (drop >= 0.1 && (!best || drop > best.drop)) best = { goal, drop, i };
  });
  return best;
}
// Catalogue moves that would advance a goal on success, best first.
function servingGoal(h, goal) {
  const out = [];
  for (const act of ACTIONS) {
    if (!canUse(act, h.p) || act.id === 'hold' || !affordable(h.s, h.p, act, 0)) continue;
    for (const target of act.targets(h.s, h.p)) {
      const c = simClone(h.s);
      try { act.success(c, h.p, target, 1); } catch { continue; }
      const gain = goal.progress(c) - goal.progress(h.s);
      if (gain > 0.03) out.push({ action: act.id, target, gain });
    }
  }
  return out.sort((a, b) => b.gain - a.gain);
}

// ── selectors ──
function partnerInNeed(h) {
  const c = h.allies(50).filter((b) => ACTOR_BY_ID[b].kind !== 'superpower' && (h.A(b).military < 30 || h.A(b).stability < 40));
  c.sort((a, b) => h.relOf(b) - h.relOf(a));
  return c[0] ?? null;
}
function weakEnemy(h) {
  const c = h.enemies(-60).filter((e) => h.A(e).stability < 30 && ACTOR_BY_ID[e].kind !== 'superpower');
  c.sort((a, b) => h.A(a).stability - h.A(b).stability);
  return c[0] ?? null;
}
function mediated(h) {
  for (const foe of h.enemies(-50)) {
    const fh = homeOf(foe);
    const hot = (fh && h.T(fh).tension >= 60) || (h.home && h.T(h.home).tension >= 60);
    if (!hot || h.flag(`talks:${h.p}:${foe}`) >= h.turn - 4) continue;
    const via = ['egypt', 'turkey', 'china', 'eu', 'saudi', 'russia', 'us'].find((m) => m !== h.p && m !== foe && h.alive(m) && h.relOf(m) >= 20 && h.relOf(m, foe) >= 10);
    if (via) return { foe, via };
  }
  return null;
}
function collapsedAlly(h) {
  return Object.keys(h.s.actors).find((id) => id !== h.p && h.A(id).collapsed && h.relOf(id) >= 40 && h.flag(`collapsed:${id}`) === h.turn - 1) ?? null;
}
