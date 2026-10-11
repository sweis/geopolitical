// HTML renderers for the side panel, top bar and modals. Pure functions of (state, ui) → string.
// No dice are shown anywhere: odds are words, outcomes are narrated.
import { ACTORS, ACTOR_BY_ID } from '../data/actors.js';
import { THEATER_BY_ID } from '../data/theaters.js';
import { WORLD_LABELS } from '../data/world.js';
import { ACTION_BY_ID, COMMIT, costOf, affordable, targetName } from '../engine/actions.js';
import { goalReport, goalScore, goalKeys } from '../engine/goals.js';
import { dateOf, rel } from '../engine/state.js';
import { playerMenu, previewInitiative, thresholds, scores, ordersTotal } from '../engine/game.js';

export const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sign = (d) => (d > 0 ? `+${Math.round(d * 100)}` : `${Math.round(d * 100)}`);
const fmtDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
const name = (id) => ACTOR_BY_ID[id]?.name ?? THEATER_BY_ID[id]?.name ?? id;
const dot = (id) => `<span class="dot" style="background:${ACTOR_BY_ID[id]?.color ?? '#888'}"></span>`;
const OUTCOME = { success: 'Success', crit: 'Decisive', fail: 'Setback', blowback: 'Backfired', fizzle: 'Overtaken', auto: 'Done' };

export function costHtml(c) {
  const parts = [];
  if (c.money) parts.push(`<b>$${c.money}</b>`);
  if (c.military) parts.push(`<b>${c.military}</b> mil`);
  if (c.political) parts.push(`<b>${c.political}</b> PC`);
  return `<span class="cost">${parts.join(' · ') || 'free'}</span>`;
}

// ── top bar: only the tracks this actor's objectives use (plus oil) ──
const FMT = { oil: (v) => `$${v}`, hormuz: (v) => `${v}%`, redSea: (v) => `${v}%`, usWarSupport: (v) => `${v}%` };
const SHORT = { oil: 'Brent', hormuz: 'Hormuz', redSea: 'Red Sea', warIntensity: 'Iran war', iranNuclear: 'Breakout', iranSanctions: 'Sanctions', gazaCeasefire: 'Gaza truce', hamasDisarm: 'Hamas disarm', isfDeployed: 'ISF', humanitarian: 'Gaza aid', westBankAnnex: 'Annexation', hezbollahDisarm: 'Hezb. disarm', normalization: 'Normalization', yemenWar: 'Yemen war', isisStrength: 'ISIS', kurdishAutonomy: 'Kurdish rule', usWarSupport: 'US support' };
export function clockHtml(s) {
  const phase = s.phase === 'over' ? 'GAME OVER' : 'YOUR MOVE';
  return `${fmtDate(dateOf(s.turn))} · TURN ${s.turn}/${s.maxTurns} · ${phase}`;
}
export function indicatorsHtml(s) {
  const prev = s.history.length >= 2 ? s.history[s.history.length - 2].world : s.history[0]?.world;
  let keys = s.player ? [...goalKeys(ACTOR_BY_ID[s.player]).world] : ['hormuz', 'redSea', 'warIntensity', 'iranNuclear', 'gazaCeasefire', 'isisStrength'];
  if (!keys.includes('oil')) keys.unshift('oil');
  keys = keys.slice(0, 8);
  return keys.map((k) => {
    const v = s.world[k], d = prev ? v - prev[k] : 0;
    const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    const ds = d ? `${d > 0 ? '▲' : '▼'}${Math.abs(Math.round(d))}` : '';
    return `<div class="ind" title="${esc(WORLD_LABELS[k])}"><span class="k">${esc(SHORT[k] ?? WORLD_LABELS[k])}</span><span class="v">${(FMT[k] ?? ((x) => x))(Math.round(v))}</span><span class="d ${cls}">${ds}</span></div>`;
  }).join('');
}

// ── actor card ──
export function actorCardHtml(s) {
  if (!s.player) return `<div class="ac-head"><div class="swatch" style="background:#555"></div><div><div class="ac-name">Observer</div><div class="ac-leader">All actors are AI-controlled</div></div></div>`;
  const def = ACTOR_BY_ID[s.player], a = s.actors[s.player];
  const sc = goalScore(def, s), th = thresholds(s, s.player);
  return `<div class="ac-head"><div class="swatch" style="background:${def.color}"></div>
    <div><div class="ac-name">${esc(def.name)}</div><div class="ac-leader">${esc(def.leader)}</div></div>
    <div class="ac-score"><div class="n">${sc.toFixed(0)}</div><div class="l">score · win ≥ ${th.victory}</div></div></div>
    <div class="res">
      <div title="Treasury: discretionary spending"><div class="k">Treasury</div><div class="v">$${Math.floor(a.money)}</div></div>
      <div title="Deployable military strength"><div class="k">Military</div><div class="v">${Math.floor(a.military)}</div></div>
      <div title="Political capital: pays for diplomacy and lobbying"><div class="k">Political</div><div class="v">${Math.floor(a.political)} PC</div></div>
      <div title="Domestic stability (0 = collapse)"><div class="k">Stability</div><div class="v">${Math.floor(a.stability)}</div></div>
    </div>`;
}

// ── odds ──
function reasonsHtml(base, reasons, extra = []) {
  const rows = [`<li><span class="d mono">${Math.round(base * 100)}</span><span class="muted">Base likelihood</span></li>`];
  for (const m of reasons) rows.push(`<li><span class="d ${m.d > 0 ? 'up' : 'down'}">${sign(m.d)}</span><span>${esc(m.text)}</span></li>`);
  for (const m of extra) rows.push(`<li><span class="d ${m.d > 0 ? 'up' : 'down'}">${sign(m.d)}</span><span>${esc(m.text)}</span></li>`);
  return `<ul class="reasons">${rows.join('')}</ul>`;
}
const bandHtml = (p, band) => (p == null ? `<span class="band auto">Certain</span>` : `<span class="band b${Math.round(p * 4)}">${esc(band)}</span>`);

// ── command tab: the turn screen ──
export function commandHtml(s, ui) {
  if (!s.player) return `<p class="muted">Observer mode. Use the dev hooks (step / resume) to advance.</p>${s.briefing ? elsewhereHtml(s.briefing) : ''}`;
  if (s.actors[s.player].collapsed || s.phase === 'over') return `<p>The game is over.</p><div class="btnrow"><button class="primary" data-act="showEnd">See the outcome →</button></div>`;
  let h = `<div class="turnhead"><span class="muted small">${s.turn === 1 ? 'Opening moves' : `Turn ${s.turn}`}</span>${s.briefing ? `<button class="ghost small" data-act="briefing">Last fortnight ›</button>` : ''}</div>`;
  h += situationsHtml(s, ui);
  h += initiativeHtml(s, ui);
  h += ordersHtml(s, ui);
  return h;
}

const KIND = { crisis: 'Crisis', opportunity: 'Opportunity', intel: 'Intelligence' };
function situationsHtml(s, ui) {
  if (!s.situations.length) return `<h3>Situations</h3><p class="muted small">A quiet fortnight: nothing demands a decision.</p>`;
  let h = `<h3>Situations</h3>`;
  for (const sit of s.situations) {
    const chosen = sit.options.find((o) => o.id === sit.choice);
    h += `<div class="card ${sit.kind}" data-sit="${esc(sit.id)}"><div class="card-head"><span class="kind">${KIND[sit.kind]}</span><span class="title">${esc(sit.title)}</span></div>
      <div class="card-text">${esc(sit.text)}</div><div class="opts">`;
    for (const o of sit.options) {
      const on = sit.choice === o.id;
      h += `<div class="optrow ${on ? 'on' : ''} ${o.affordable ? '' : 'disabled'}" data-act="choose" data-sit="${esc(sit.id)}" data-opt="${esc(o.id)}" role="radio" aria-checked="${on}" tabindex="0">
        <span class="radio"></span>
        <span class="body"><span class="lbl">${esc(o.label)}</span> ${bandHtml(o.p, o.band)}<br><span class="small muted">${esc(o.text)}</span></span>
        ${costHtml(o.cost)}</div>`;
    }
    h += `</div>`;
    if (chosen && chosen.p != null) {
      const open = ui.why.has(sit.id);
      h += `<button class="ghost small why" data-act="why" data-id="${esc(sit.id)}">${open ? 'Hide the assessment' : 'Why these odds?'}</button>`;
      if (open) h += `<div class="pbar"><i style="width:${Math.round(chosen.p * 100)}%"></i></div>${reasonsHtml(chosen.base, chosen.reasons)}`;
    }
    if (!sit.choice) h += `<div class="small muted hint">No answer yet: "${esc(sit.options.find((o) => o.default)?.label)}" will apply.</div>`;
    h += `</div>`;
  }
  return h;
}

const CATS = ['all', 'military', 'diplomatic', 'economic', 'covert', 'domestic'];
function initiativeHtml(s, ui) {
  const init = s.orders.initiative;
  let h = `<h3>Initiative <span class="muted">· one per turn</span></h3>`;
  const props = ui.proposals?.list ?? [];
  h += `<div class="small muted" style="margin-bottom:6px">Your advisers propose:</div><div class="alist">`;
  for (const p of props) {
    const on = init && init.action === p.action && init.target === p.target;
    h += `<button class="prop ${on ? 'on' : ''}" data-act="prop" data-action="${esc(p.action)}" data-target="${p.target == null ? '' : esc(p.target)}">
      <span><span class="nm">${esc(p.name)}${p.targetName ? ` <span class="muted">· ${esc(p.targetName)}</span>` : ''}</span><br><span class="small muted">${p.serves ? `Advances: ${esc(p.serves)}` : esc(p.why ?? ACTION_BY_ID[p.action].desc)}</span></span>
      <span class="right">${bandHtml(p.p, p.band)}<br>${costHtml(p.cost)}</span></button>`;
  }
  h += `</div><div class="rowbtns"><button class="ghost small" data-act="toggleAll">${ui.showAll ? 'Hide the full list' : 'All orders ▾'}</button>${init ? `<button class="ghost small" data-act="noInit">Hold instead</button>` : ''}</div>`;
  if (ui.showAll) h += catalogueHtml(s, ui);
  if (init) h += initiativeDetail(s, ui, init);
  else h += `<p class="small muted">No initiative selected: you will hold and consolidate (+1 PC, +$2).</p>`;
  return h;
}

function catalogueHtml(s, ui) {
  const menu = playerMenu(s).filter((m) => ui.cat === 'all' || m.cat === ui.cat);
  let h = `<div class="chips">${CATS.map((c) => `<button data-act="cat" data-id="${c}" class="${ui.cat === c ? 'on' : ''}">${c[0].toUpperCase() + c.slice(1)}</button>`).join('')}</div><div class="alist">`;
  for (const m of menu) {
    const usable = m.affordable && m.targets.length;
    h += `<button class="arow ${ui.action === m.id ? 'on' : ''}" data-act="action" data-id="${m.id}" ${usable ? '' : 'disabled'} title="${esc(usable ? m.desc : m.targets.length ? 'Cannot afford' : 'No valid targets')}">
      <span><span class="nm">${esc(m.name)}</span><br><span class="cat">${m.cat}</span></span>${costHtml(m.cost)}</button>`;
  }
  h += `</div>`;
  if (ui.action && !s.orders.initiative) {
    const act = ACTION_BY_ID[ui.action];
    const targets = act.targets(s, s.player);
    h += `<div class="box"><b>${esc(act.name)}</b><div class="desc">${esc(act.desc)}</div><h3>Target</h3><div class="targets">${targets.map((t) => `<button data-act="target" data-id="${t}">${act.target === 'actor' ? dot(t) : ''}${esc(targetName(t))}</button>`).join('')}</div><p class="small muted">Theater targets are highlighted on the map; click one.</p></div>`;
  }
  return h;
}

function initiativeDetail(s, ui, init) {
  const act = ACTION_BY_ID[init.action];
  const ev = previewInitiative(s, init.action, init.target, init.commit);
  const opp = ev.args.filter((a) => a.stance < 0).map((a) => ACTOR_BY_ID[a.by].short), sup = ev.args.filter((a) => a.stance > 0).map((a) => ACTOR_BY_ID[a.by].short);
  const extra = [];
  if (ev.commitBonus) extra.push({ text: 'Extra commitment of resources', d: ev.commitBonus });
  if (ev.debate) extra.push({ text: `${opp.length ? `Opposition from ${opp.join(', ')}` : ''}${opp.length && sup.length ? '; ' : ''}${sup.length ? `backing from ${sup.join(', ')}` : ''}`, d: ev.debate });
  let h = `<div class="box init"><div class="nm"><b>${esc(act.name)}</b>${init.target ? ` <span class="muted">· ${esc(targetName(init.target))}</span>` : ''}</div><div class="desc">${esc(act.desc)}</div>`;
  h += `<div class="seg">${COMMIT.map((c, i) => `<button data-act="commit" data-id="${i}" class="${init.commit === i ? 'on' : ''}" ${affordable(s, s.player, act, i) ? '' : 'disabled'}>${c.label}<br>${costHtml(costOf(act, i))}</button>`).join('')}</div>`;
  h += `<div class="odds">${bandHtml(ev.p, ev.band)}${opp.length ? `<span class="small down">opposed by ${esc(opp.join(', '))}</span>` : ''}${sup.length ? `<span class="small up">backed by ${esc(sup.join(', '))}</span>` : ''}</div><div class="pbar"><i style="width:${Math.round(ev.p * 100)}%"></i></div>`;
  const open = ui.why.has('init');
  h += `<button class="ghost small why" data-act="why" data-id="init">${open ? 'Hide the assessment' : 'Why these odds?'}</button>`;
  if (open) h += reasonsHtml(ev.base, ev.mods, extra);
  return h + `</div>`;
}

function ordersHtml(s, ui) {
  const t = ordersTotal(s), a = s.actors[s.player];
  const over = t.money > a.money || t.military > a.military || t.political > a.political;
  const unanswered = s.situations.filter((x) => !x.choice).length;
  return `<div class="orders ${over ? 'over' : ''}"><div class="small">This turn: ${costHtml(t)} <span class="muted">of $${Math.floor(a.money)} · ${Math.floor(a.military)} mil · ${Math.floor(a.political)} PC</span>${over ? '<div class="down">You cannot afford all of this.</div>' : ''}${unanswered ? `<div class="muted">${unanswered} card${unanswered > 1 ? 's' : ''} unanswered (defaults apply)</div>` : ''}</div>
    <button class="primary" data-act="endTurn" ${over ? 'disabled' : ''}>End turn →</button></div>`;
}

// ── briefing overlay: what happened, filtered to what matters to you ──
const impactChips = (lines) => (lines?.length ? `<div class="impact">${lines.map((l) => `<span class="${l.d > 0 ? 'up' : 'down'}">${esc(l.label)} ${l.d > 0 ? '+' : ''}${l.unit === '$' ? '$' : ''}${l.d}</span>`).join('')}</div>` : '');
function resultRow(r, mine = false) {
  const tag = r.outcome === 'auto' ? 'auto' : r.outcome;
  const title = r.kind === 'situation' ? `${esc(r.title)} — <b>${esc(r.label)}</b>` : r.kind === 'intel' ? `<b>${esc(r.label)}</b>` : `<b>${esc(ACTION_BY_ID[r.action]?.name ?? r.action)}${r.target ? ` · ${esc(targetName(r.target))}` : ''}</b>`;
  return `<div class="brow ${mine ? 'mine' : ''} ${r.ok ? 'ok' : 'bad'}"><span class="oc ${tag}">${OUTCOME[tag] ?? tag}</span><div>${mine ? `<div class="small">${title}</div>` : ''}<div>${mine ? '' : dot(r.actor)}${esc(r.text)}</div>${impactChips(r.lines)}</div></div>`;
}
export function briefingHtml(s) {
  const b = s.briefing;
  if (!b) return '';
  const d = b.scoreAfter - b.scoreBefore;
  let h = `<div class="sheet brief"><div class="eyebrow">TWO WEEKS LATER · ${fmtDate(dateOf(b.turn + 1))}</div>
    <div class="scoreline"><span>Score</span><span class="mono">${b.scoreBefore.toFixed(0)} → ${b.scoreAfter.toFixed(0)}</span><span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'} mono">${d >= 0 ? '+' : ''}${d.toFixed(1)}</span></div>`;
  if (b.worldDelta.length) h += `<div class="impact big">${b.worldDelta.map((l) => `<span class="${l.d > 0 ? 'up' : 'down'}">${esc(l.label)} ${l.d > 0 ? '+' : ''}${l.unit === '$' ? '$' : ''}${l.d}</span>`).join('')}</div>`;
  if (b.mine.length) h += `<h2>Your decisions</h2>${b.mine.map((r) => resultRow(r, true)).join('')}`;
  const ev = b.events.filter((e) => e.relevant), evOther = b.events.filter((e) => !e.relevant);
  if (b.affecting.length || ev.length) {
    h += `<h2>Affecting you</h2>`;
    h += ev.map((e) => `<div class="brow event"><span class="oc event">Event</span><div><div>${esc(e.text)}</div>${impactChips(e.lines)}</div></div>`).join('');
    h += b.affecting.map((r) => resultRow(r)).join('');
  } else h += `<h2>Affecting you</h2><p class="muted small">Nothing anyone else did this fortnight moved your position.</p>`;
  h += elsewhereHtml(b, evOther);
  h += `<div class="btnrow"><button class="primary" data-act="continue">${s.phase === 'over' ? 'See the outcome →' : `Continue to turn ${s.turn} →`}</button></div></div>`;
  return h;
}
function elsewhereHtml(b, evOther = []) {
  const n = b.elsewhere.length + evOther.length;
  if (!n) return '';
  return `<details class="elsewhere"><summary>Elsewhere · ${n} ${n === 1 ? 'item' : 'items'}</summary>${evOther.map((e) => `<div class="small muted">• ${esc(e.text)}</div>`).join('')}${b.elsewhere.map((r) => `<div class="small muted">${dot(r.actor)}${esc(r.text)}</div>`).join('')}</details>`;
}

// ── goals tab ──
export function goalsHtml(s) {
  let h = '';
  if (s.player) {
    const def = ACTOR_BY_ID[s.player], th = thresholds(s, s.player), sc = goalScore(def, s);
    h += `<h3>Your objectives</h3><p class="small muted">Score ${sc.toFixed(0)} (started ${th.start}). Victory at turn ${s.maxTurns} needs ≥ ${th.victory} and ${th.metNeeded} objectives fully met; ending below ${th.draw} is defeat. Meet every objective after turn 6 for an early decisive win.</p>`;
    h += goalReport(def, s).map((g) => `<div class="goal ${g.met ? 'met' : ''}"><div class="top"><span>${esc(g.name)} <span class="muted small">×${g.w}</span></span><span class="val">${g.value} → ${esc(g.target)}</span></div><div class="gbar"><i style="width:${Math.round(g.progress * 100)}%"></i></div></div>`).join('');
  }
  const sc = scores(s);
  const rows = ACTORS.map((a) => [a.id, sc[a.id]]).sort((x, y) => y[1] - x[1]);
  h += `<h3>All actors · score</h3><table class="lb">${rows.map(([id, v]) => `<tr class="${id === s.player ? 'me' : ''}"><td>${dot(id)}${esc(name(id))}${s.actors[id].collapsed ? ' <span class="down">(collapsed)</span>' : ''}</td><td class="n">${v.toFixed(0)}</td></tr>`).join('')}</table>`;
  return h;
}

// ── intel tab ──
export function intelHtml(s, ui) {
  let h = '';
  if (ui.selectedTheater) {
    const t = s.theaters[ui.selectedTheater], def = THEATER_BY_ID[ui.selectedTheater];
    h += `<h3>${esc(def.name)}</h3><div class="kv"><span>Tension</span><span class="v">${Math.round(t.tension)}</span><span>Controller</span><span class="v">${esc(name(def.controller))}</span><span>Borders</span><span class="v">${def.adj.map((x) => esc(THEATER_BY_ID[x].name)).join(', ')}</span></div>`;
    h += `<h3>Influence on the ground</h3>` + Object.entries(t.infl).sort((a, b) => b[1] - a[1]).map(([id, v]) => `<div class="infl"><span>${dot(id)}${esc(ACTOR_BY_ID[id].short)}</span><span class="bar"><i style="width:${v}%;background:${ACTOR_BY_ID[id].color}"></i></span><span class="mono">${Math.round(v)}</span></div>`).join('');
  } else h += `<p class="muted small">Click a theater on the map for details.</p>`;
  if (s.player) {
    const decl = Object.values(s.declared).filter((d) => d.actor !== s.player);
    if (decl.length) h += `<h3>Reported intentions this fortnight</h3>` + decl.map((d) => `<div class="small">${dot(d.actor)}${esc(ACTOR_BY_ID[d.actor].short)}: ${esc(ACTION_BY_ID[d.action].name.toLowerCase())}${d.target ? ` · ${esc(targetName(d.target))}` : ''}</div>`).join('');
  }
  h += `<h3>Actors</h3><table class="lb"><tr class="muted"><td>Actor</td><td class="n">$</td><td class="n">Mil</td><td class="n">Stab</td>${s.player ? '<td class="n">Rel</td>' : ''}</tr>`;
  for (const a of ACTORS) {
    const r = s.actors[a.id];
    const rv = s.player && a.id !== s.player ? rel(s, s.player, a.id) : null;
    h += `<tr class="${a.id === s.player ? 'me' : ''}"><td title="${esc(a.blurb)}">${dot(a.id)}${esc(a.short)} <span class="muted small">${esc(a.name)}</span></td><td class="n">${Math.floor(r.money)}</td><td class="n">${Math.floor(r.military)}</td><td class="n">${Math.floor(r.stability)}</td>${s.player ? `<td class="n ${rv > 20 ? 'up' : rv < -20 ? 'down' : ''}">${rv ?? '—'}</td>` : ''}</tr>`;
  }
  return h + `</table>`;
}

// ── log tab ──
export function logHtml(s) {
  return s.log.slice().reverse().map((l) => `<div class="logline"><span class="t">T${l.turn}</span><span class="${l.kind === 'success' ? 'up' : l.kind === 'fail' ? 'down' : ''}">${esc(l.text)}</span></div>`).join('');
}

// ── modals ──
const GROUPS = [
  ['Great powers', ['us', 'russia', 'china', 'eu']],
  ['Regional states', ['israel', 'iran', 'turkey', 'saudi', 'egypt', 'syria', 'lebanon', 'krg']],
  ['Armed groups', ['hezbollah', 'hamas', 'pij', 'houthis', 'iraqMilitias', 'sdf', 'isis']],
];
export function startHtml(s0, sel) {
  const def = ACTOR_BY_ID[sel];
  const th = thresholds(s0, sel);
  const r = def.start;
  return `<div class="sheet" id="startSheet"><h1>RED LINES</h1>
    <p class="lede">October 2026. Seven months after US and Israeli strikes killed Ali Khamenei, the Iran war is in a tense pause: the Strait of Hormuz is choked, Brent trades above $100, Houthi missiles hit Saudi airports and Washington is weighing a new bombing campaign before the midterms. In Gaza a year-old ceasefire and a disarmament roadmap hang by a thread; in Lebanon the army is meant to take Hezbollah's guns zone by zone.</p>
    <p class="lede small">Every fortnight the game master deals you the situations that have grown out of what everyone did last turn: crises to answer, openings to take, intelligence on what rivals are planning. Answer them, pick one initiative, end the turn. Your advisers rate the odds; nobody shows you the dice. Achieve your objectives within ${s0.maxTurns} turns.</p>
    ${GROUPS.map(([g, ids]) => `<h2>${g}</h2><div class="grid">${ids.map((id) => `<button class="pick ${id === sel ? 'on' : ''}" data-act="pick" data-id="${id}"><span class="swatch" style="background:${ACTOR_BY_ID[id].color};height:28px;width:6px"></span><span><span class="nm">${esc(ACTOR_BY_ID[id].name)}</span><br><span class="ld">${esc(ACTOR_BY_ID[id].leader)}</span></span></button>`).join('')}</div>`).join('')}
    <div class="detail"><div><h2>${esc(def.name)}</h2><p>${esc(def.blurb)}</p>
      <div class="kv"><span>Treasury</span><span class="v">$${r.money}</span><span>Military</span><span class="v">${r.military}</span><span>Political capital</span><span class="v">${r.political}</span><span>Stability</span><span class="v">${r.stability}</span></div></div>
      <div><h2>Objectives</h2><ul>${def.goals.map((g) => `<li>${esc(g.name)} <span class="muted small">(${g.dir} ${g.unit === '$' ? '$' : ''}${g.thr}${g.unit === '%' ? '%' : ''}, weight ${g.w})</span></li>`).join('')}</ul>
      <p class="small muted">Starting score ${th.start}. Victory needs ${th.victory} and ${th.metNeeded} objectives fully met by turn ${s0.maxTurns}.</p>
      <div class="btnrow"><button class="primary" data-act="begin" data-id="${sel}">Play as ${esc(def.name)} →</button></div></div></div>
  </div>`;
}

export function helpHtml() {
  return `<div class="sheet" style="max-width:680px"><h1 style="font-size:22px">How to play</h1>
  <h2>Each turn (two weeks)</h2><ol>
  <li><b>Situations.</b> The game master deals the cards that grew out of last turn: a crisis that must be answered, an opening you can take or leave, and intelligence on a rival's plan you can lobby for or against. Each option has a cost and an assessment of its odds; the reasons are a click away.</li>
  <li><b>Initiative.</b> One move of your own. Your advisers propose the moves that best serve your objectives right now; the full catalogue is there if you disagree. Other actors are expected to lobby for or against it.</li>
  <li><b>End turn.</b> Everything resolves at once. Outcomes are narrated, never rolled in front of you. The briefing shows only what mattered to you; the rest is a fold-out.</li></ol>
  <h2>Winning</h2><p>Your score (0–100) is weighted progress on your objectives. Raise it by 22 points (minimum 68) and fully meet at least half your objectives by the last turn to win; meet every objective after turn 6 for a decisive early win; let your stability hit 0 and you collapse.</p>
  <h2>Resources</h2><p><b>Treasury</b> and <b>military</b> pay for operations. <b>Political capital</b> pays for diplomacy and lobbying. <b>Stability</b> is your home front. The top bar shows only the tracks your objectives depend on.</p>
  <div class="btnrow"><button class="primary" data-act="closeModal">Back to the game</button></div></div>`;
}

export function endHtml(s) {
  const o = s.outcome;
  const sc = scores(s);
  const rows = ACTORS.map((a) => [a.id, sc[a.id], s.history[0].scores[a.id]]).sort((x, y) => (y[1] - y[2]) - (x[1] - x[2]));
  const mine = s.player ? s.history.map((h) => h.scores[s.player]) : [];
  const spark = mine.length > 1 ? sparkline(mine) : '';
  return `<div class="sheet" style="max-width:760px"><div class="verdict ${o.result}">${o.result.toUpperCase()}${o.decisive ? ' — DECISIVE' : ''}</div>
    <p>${esc(o.reason)}</p>${spark}
    ${s.player ? `<h2>Objectives</h2>${goalReport(ACTOR_BY_ID[s.player], s).map((g) => `<div class="small">${g.met ? '✓' : '✗'} ${esc(g.name)} <span class="muted">${g.value} → ${esc(g.target)}</span></div>`).join('')}` : ''}
    <h2>Who gained most</h2><table class="lb">${rows.map(([id, v, st]) => `<tr class="${id === s.player ? 'me' : ''}"><td>${dot(id)}${esc(name(id))}</td><td class="n">${st.toFixed(0)} → ${v.toFixed(0)}</td><td class="n ${v - st >= 0 ? 'up' : 'down'}">${v - st >= 0 ? '+' : ''}${(v - st).toFixed(0)}</td></tr>`).join('')}</table>
    <div class="btnrow"><button data-act="closeModal">Review the map</button><button class="primary" data-act="newGame">New game</button></div></div>`;
}

function sparkline(vals) {
  const w = 300, h = 60, max = 100;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="60" style="max-width:420px;background:#0b1118;border-radius:6px"><polyline points="${pts}" fill="none" stroke="var(--amber)" stroke-width="2"/></svg><div class="small muted">Your score by turn</div>`;
}
