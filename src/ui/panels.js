// HTML renderers for the side panel, top bar and modals. Pure functions of (state, ui) → string.
// Visual first: icons, odds pips and effect chips carry the information; prose is one sentence, folded.
import { ACTORS, ACTOR_BY_ID } from '../data/actors.js';
import { THEATER_BY_ID } from '../data/theaters.js';
import { WORLD_LABELS, WORLD_SHORT } from '../data/world.js';
import { ACTION_BY_ID, COMMIT, costOf, affordable, targetName } from '../engine/actions.js';
import { goalReport, goalScore, goalKeys } from '../engine/goals.js';
import { dateOf, rel } from '../engine/state.js';
import { playerMenu, previewInitiative, thresholds, scores, ordersTotal } from '../engine/game.js';
import { actionEffects } from '../engine/director.js';
import { icon, actionIcon, optionIcon, KIND_ICON, OUTCOME_ICON } from './icons.js';

export const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sign = (d) => (d > 0 ? `+${Math.round(d * 100)}` : `${Math.round(d * 100)}`);
const fmtDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
const name = (id) => ACTOR_BY_ID[id]?.name ?? THEATER_BY_ID[id]?.name ?? id;
const short = (id) => ACTOR_BY_ID[id]?.short ?? THEATER_BY_ID[id]?.label ?? THEATER_BY_ID[id]?.name ?? id;
const dot = (id) => `<span class="dot" style="background:${ACTOR_BY_ID[id]?.color ?? '#888'}"></span>`;
const OUTCOME = { success: 'Success', crit: 'Decisive', fail: 'Setback', blowback: 'Backfired', fizzle: 'Overtaken', auto: 'Done' };
const lead = (text) => { const m = /^(.*?[.!?])(\s+[A-Z"'“(].*)$/s.exec(text ?? ''); return m ? [m[1], m[2].trim()] : [text ?? '', '']; };

// ── shared visual atoms ──
export function costHtml(c) {
  const parts = [];
  if (c.money) parts.push(`<span>${icon('coin')}${c.money}</span>`);
  if (c.military) parts.push(`<span>${icon('shield')}${c.military}</span>`);
  if (c.political) parts.push(`<span>${icon('people')}${c.political}</span>`);
  return `<span class="cost" title="Cost: $${c.money || 0} · ${c.military || 0} military · ${c.political || 0} political capital">${parts.join('') || '<span class="free">free</span>'}</span>`;
}
export const chip = (c) => `<span class="chip ${c.good > 0 ? 'good' : c.good < 0 ? 'bad' : 'neutral'}" title="${esc(c.label)} ${c.d > 0 ? '+' : ''}${c.d}">${c.actor ? dot(c.actor) : ''}${esc(c.label)} <b>${c.d > 0 ? '▲' : '▼'}${c.unit === '$' ? '$' : ''}${Math.abs(c.d)}${c.unit === '%' ? '%' : ''}</b></span>`;
const chips = (list, cls = '') => (list?.length ? `<div class="fx ${cls}">${list.map(chip).join('')}</div>` : '');
function pips(p, band) {
  if (p == null) return `<span class="pips auto" title="Certain"><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i></span>`;
  const n = Math.max(1, Math.round(p * 5));
  return `<span class="pips b${Math.round(p * 4)}" title="${esc(band)}">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}<span class="bw">${esc(band)}</span></span>`;
}

// ── top bar: only the tracks this actor's objectives use (plus oil) ──
const FMT = { oil: (v) => `$${v}`, hormuz: (v) => `${v}%`, redSea: (v) => `${v}%`, usWarSupport: (v) => `${v}%` };
export function clockHtml(s) {
  return `${fmtDate(dateOf(s.turn))} · ${s.turn}/${s.maxTurns}`;
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
    return `<div class="ind" title="${esc(WORLD_LABELS[k])}"><span class="k">${esc(WORLD_SHORT[k] ?? WORLD_LABELS[k])}</span><span class="v">${(FMT[k] ?? ((x) => x))(Math.round(v))}</span><span class="d ${cls}">${ds}</span></div>`;
  }).join('');
}

// ── actor card ──
export function actorCardHtml(s) {
  if (!s.player) return `<div class="ac-head"><div class="swatch" style="background:#555"></div><div><div class="ac-name">Observer</div><div class="ac-leader">All actors are AI-controlled</div></div></div>`;
  const def = ACTOR_BY_ID[s.player], a = s.actors[s.player];
  const sc = goalScore(def, s), th = thresholds(s, s.player);
  const bar = (v, max = 100) => `<i class="mbar"><b style="width:${Math.max(0, Math.min(100, (v / max) * 100))}%"></b></i>`;
  return `<div class="ac-head"><div class="swatch" style="background:${def.color}"></div>
    <div><div class="ac-name">${esc(def.name)}</div><div class="ac-leader">${esc(def.leader)}</div></div>
    <div class="ac-score" title="Score · victory at ${th.victory}"><div class="n">${sc.toFixed(0)}</div><div class="l">win ≥ ${th.victory}</div></div></div>
    <div class="res">
      <div title="Treasury"><span class="k">${icon('coin')}</span><span class="v">$${Math.floor(a.money)}</span>${bar(a.money, 120)}</div>
      <div title="Military strength"><span class="k">${icon('shield')}</span><span class="v">${Math.floor(a.military)}</span>${bar(a.military)}</div>
      <div title="Political capital"><span class="k">${icon('people')}</span><span class="v">${Math.floor(a.political)}</span>${bar(a.political, 20)}</div>
      <div title="Stability (0 = collapse)"><span class="k">${icon('flag')}</span><span class="v">${Math.floor(a.stability)}</span>${bar(a.stability)}</div>
    </div>`;
}

// ── odds ──
function reasonsHtml(base, reasons, extra = []) {
  const rows = [`<li><span class="d mono">${Math.round(base * 100)}</span><span class="muted">Base</span></li>`];
  for (const m of reasons) rows.push(`<li><span class="d ${m.d > 0 ? 'up' : 'down'}">${sign(m.d)}</span><span>${esc(m.text)}</span></li>`);
  for (const m of extra) rows.push(`<li><span class="d ${m.d > 0 ? 'up' : 'down'}">${sign(m.d)}</span><span>${esc(m.text)}</span></li>`);
  return `<ul class="reasons">${rows.join('')}</ul>`;
}

// ── command tab: the turn screen ──
export function commandHtml(s, ui) {
  if (!s.player) return `<p class="muted">Observer mode. Use the dev hooks (step / resume) to advance.</p>${s.briefing ? elsewhereHtml(s.briefing) : ''}`;
  if (s.actors[s.player].collapsed || s.phase === 'over') return `<div class="btnrow"><button class="primary" data-act="showEnd">See the outcome →</button></div>`;
  let h = `<div class="turnhead"><span class="muted small">${s.turn === 1 ? 'Opening moves' : `Turn ${s.turn}`}</span>${s.briefing ? `<button class="ghost small" data-act="briefing">${icon('bolt')} Last fortnight</button>` : ''}</div>`;
  h += situationsHtml(s, ui);
  h += initiativeHtml(s, ui);
  h += ordersHtml(s, ui);
  return h;
}

function situationsHtml(s, ui) {
  if (!s.situations.length) return `<h3>Situations</h3><p class="muted small">A quiet fortnight.</p>`;
  let h = `<h3>Situations</h3>`;
  for (const sit of s.situations) {
    const chosen = sit.options.find((o) => o.id === sit.choice);
    const [first, rest] = lead(sit.text);
    const open = ui.expanded.has(sit.id);
    h += `<div class="card ${sit.kind}" data-sit="${esc(sit.id)}"><div class="card-head">${icon(KIND_ICON[sit.kind], 'kind')}<span class="title">${esc(sit.title)}</span>${sit.at ? `<span class="where">${esc(short(sit.at))}</span>` : ''}</div>
      <div class="card-text">${esc(first)}${rest ? (open ? ` ${esc(rest)} <button class="more" data-act="more" data-id="${esc(sit.id)}">less</button>` : ` <button class="more" data-act="more" data-id="${esc(sit.id)}">more</button>`) : ''}</div><div class="opts">`;
    for (const o of sit.options) {
      const on = sit.choice === o.id;
      h += `<div class="optrow ${on ? 'on' : ''} ${o.affordable ? '' : 'disabled'}" data-act="choose" data-sit="${esc(sit.id)}" data-opt="${esc(o.id)}" role="radio" aria-checked="${on}" tabindex="0" title="${esc(o.text)}">
        <span class="radio"></span><span class="oic">${icon(optionIcon(o))}</span>
        <span class="body"><span class="lbl">${esc(o.label)}</span> ${pips(o.p, o.band)}${chips(o.effects)}${on && o.text ? `<span class="small muted desc">${esc(o.text)}</span>` : ''}</span>
        ${costHtml(o.cost)}</div>`;
    }
    h += `</div>`;
    if (chosen && chosen.p != null) {
      const why = ui.why.has(sit.id);
      h += `<button class="ghost small why" data-act="why" data-id="${esc(sit.id)}">${why ? 'Hide' : 'Why these odds?'}</button>`;
      if (why) h += `<div class="pbar"><i style="width:${Math.round(chosen.p * 100)}%"></i></div>${reasonsHtml(chosen.base, chosen.reasons)}`;
    }
    if (!sit.choice) h += `<div class="small muted hint">Unanswered → "${esc(sit.options.find((o) => o.default)?.label)}"</div>`;
    h += `</div>`;
  }
  return h;
}

const CATS = ['all', 'military', 'diplomatic', 'economic', 'covert', 'domestic'];
function initiativeHtml(s, ui) {
  const init = s.orders.initiative;
  let h = `<h3>Initiative <span class="muted">· one per turn</span></h3>`;
  const props = ui.proposals?.list ?? [];
  h += `<div class="alist">`;
  for (const p of props) {
    const on = init && init.action === p.action && init.target === p.target;
    h += `<button class="prop ${on ? 'on' : ''}" data-act="prop" data-action="${esc(p.action)}" data-target="${p.target == null ? '' : esc(p.target)}" title="${esc(ACTION_BY_ID[p.action].desc)}">
      <span class="oic">${icon(actionIcon(p.action))}</span>
      <span class="body"><span class="nm">${esc(p.name)}${p.targetName ? ` <span class="muted">· ${esc(p.targetName)}</span>` : ''}</span> ${pips(p.p, p.band)}${chips(p.effects)}</span>
      ${costHtml(p.cost)}</button>`;
  }
  h += `</div><div class="rowbtns"><button class="ghost small" data-act="toggleAll">${ui.showAll ? 'Hide the full list' : 'All orders ▾'}</button>${init ? `<button class="ghost small" data-act="noInit">${icon('pause')} Hold instead</button>` : ''}</div>`;
  if (ui.showAll) h += catalogueHtml(s, ui);
  if (init) h += initiativeDetail(s, ui, init);
  else h += `<p class="small muted">${icon('pause')} No initiative: hold and consolidate (+1 PC, +$2).</p>`;
  return h;
}

function catalogueHtml(s, ui) {
  const menu = playerMenu(s).filter((m) => ui.cat === 'all' || m.cat === ui.cat);
  let h = `<div class="chips">${CATS.map((c) => `<button data-act="cat" data-id="${c}" class="${ui.cat === c ? 'on' : ''}">${c[0].toUpperCase() + c.slice(1)}</button>`).join('')}</div><div class="alist">`;
  for (const m of menu) {
    const usable = m.affordable && m.targets.length;
    h += `<button class="arow ${ui.action === m.id ? 'on' : ''}" data-act="action" data-id="${m.id}" ${usable ? '' : 'disabled'} title="${esc(usable ? m.desc : m.targets.length ? 'Cannot afford' : 'No valid targets')}">
      <span class="oic">${icon(actionIcon(m.id))}</span><span class="body"><span class="nm">${esc(m.name)}</span></span>${costHtml(m.cost)}</button>`;
  }
  h += `</div>`;
  if (ui.action && !s.orders.initiative) {
    const act = ACTION_BY_ID[ui.action];
    const targets = act.targets(s, s.player);
    h += `<div class="box"><b>${icon(actionIcon(act.id))} ${esc(act.name)}</b><div class="desc">${esc(act.desc)}</div><div class="targets">${targets.map((t) => `<button data-act="target" data-id="${t}">${act.target === 'actor' ? dot(t) : ''}${esc(targetName(t))}</button>`).join('')}</div><p class="small muted">Or click a highlighted theater on the map.</p></div>`;
  }
  return h;
}

function initiativeDetail(s, ui, init) {
  const act = ACTION_BY_ID[init.action];
  const ev = previewInitiative(s, init.action, init.target, init.commit);
  const opp = ev.args.filter((a) => a.stance < 0), sup = ev.args.filter((a) => a.stance > 0);
  const extra = [];
  if (ev.commitBonus) extra.push({ text: 'Extra commitment', d: ev.commitBonus });
  if (ev.debate) extra.push({ text: `${opp.length ? `Opposition: ${opp.map((a) => ACTOR_BY_ID[a.by].short).join(', ')}` : ''}${opp.length && sup.length ? '; ' : ''}${sup.length ? `backing: ${sup.map((a) => ACTOR_BY_ID[a.by].short).join(', ')}` : ''}`, d: ev.debate });
  let h = `<div class="box init"><div class="nm">${icon(actionIcon(act.id))} <b>${esc(act.name)}</b>${init.target ? ` <span class="muted">· ${esc(targetName(init.target))}</span>` : ''}</div>`;
  h += `<div class="seg">${COMMIT.map((c, i) => `<button data-act="commit" data-id="${i}" class="${init.commit === i ? 'on' : ''}" ${affordable(s, s.player, act, i) ? '' : 'disabled'}>${c.label}<br>${costHtml(costOf(act, i))}</button>`).join('')}</div>`;
  h += `<div class="odds">${pips(ev.p, ev.band)}${opp.map((a) => `<span class="lob down" title="${esc(ACTOR_BY_ID[a.by].name)} will lobby against it">${dot(a.by)}▼</span>`).join('')}${sup.map((a) => `<span class="lob up" title="${esc(ACTOR_BY_ID[a.by].name)} will back it">${dot(a.by)}▲</span>`).join('')}</div>`;
  h += chips(actionEffects(s, s.player, init.action, init.target));
  const open = ui.why.has('init');
  h += `<button class="ghost small why" data-act="why" data-id="init">${open ? 'Hide' : 'Why these odds?'}</button>`;
  if (open) h += `<div class="pbar"><i style="width:${Math.round(ev.p * 100)}%"></i></div>${reasonsHtml(ev.base, ev.mods, extra)}`;
  return h + `</div>`;
}

function ordersHtml(s, ui) {
  const t = ordersTotal(s), a = s.actors[s.player];
  const over = t.money > a.money || t.military > a.military || t.political > a.political;
  const unanswered = s.situations.filter((x) => !x.choice).length;
  return `<div class="orders ${over ? 'over' : ''}"><div class="small">${costHtml(t)}${over ? '<div class="down">Over budget</div>' : ''}${unanswered ? `<div class="muted">${unanswered} unanswered</div>` : ''}</div>
    <button class="primary" data-act="endTurn" ${over ? 'disabled' : ''}>End turn →</button></div>`;
}

// ── briefing overlay: what happened, filtered to what matters to you ──
function resultRow(r, mine = false) {
  const tag = r.outcome === 'auto' ? 'auto' : r.outcome;
  const ic = r.kind === 'situation' || r.kind === 'intel' ? optionIcon({ id: r.option, label: r.label }) : actionIcon(r.action);
  const title = r.kind === 'situation' ? `<span class="muted">${esc(r.title)}</span> · <b>${esc(r.label)}</b>` : r.kind === 'intel' ? `<b>${esc(r.label)}</b>` : `<b>${esc(ACTION_BY_ID[r.action]?.name ?? r.action)}${r.target ? ` · ${esc(targetName(r.target))}` : ''}</b>`;
  return `<div class="brow ${mine ? 'mine' : ''} ${r.ok ? 'ok' : 'bad'}"><span class="oc ${tag}" title="${OUTCOME[tag] ?? tag}">${icon(OUTCOME_ICON[tag] ?? 'diamond')}</span><span class="oic">${mine ? icon(ic) : dot(r.actor)}</span><div class="bbody">${mine ? `<div class="small">${title}</div>` : ''}<div class="narr small">${esc(r.text)}</div>${chips(r.lines)}</div></div>`;
}
function sparkline(vals, w = 220, h = 36) {
  if (vals.length < 2) return '';
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - (v / 100) * h}`).join(' ');
  const last = pts.split(' ').at(-1).split(',');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="var(--amber)" stroke-width="2"/><circle cx="${last[0]}" cy="${last[1]}" r="3" fill="var(--amber)"/></svg>`;
}
export function briefingHtml(s) {
  const b = s.briefing;
  if (!b) return '';
  const d = b.scoreAfter - b.scoreBefore;
  let h = `<div class="sheet brief"><div class="eyebrow">TWO WEEKS LATER · ${fmtDate(dateOf(b.turn + 1))}</div>
    <div class="scoreline"><span class="mono big">${b.scoreBefore.toFixed(0)} → ${b.scoreAfter.toFixed(0)}</span><span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'} mono">${d >= 0 ? '+' : ''}${d.toFixed(1)}</span>${sparkline(s.history.map((x) => x.scores[s.player]))}</div>`;
  h += chips(b.worldDelta, 'big');
  if (b.mine.length) h += `<h2>Your decisions</h2>${b.mine.map((r) => resultRow(r, true)).join('')}`;
  const ev = b.events.filter((e) => e.relevant), evOther = b.events.filter((e) => !e.relevant);
  h += `<h2>Affecting you</h2>`;
  if (b.affecting.length || ev.length) {
    h += ev.map((e) => `<div class="brow event"><span class="oc event">${icon('bolt')}</span><span class="oic"></span><div class="bbody"><div class="narr small">${esc(e.text)}</div>${chips(e.lines)}</div></div>`).join('');
    h += b.affecting.map((r) => resultRow(r)).join('');
  } else h += `<p class="muted small">Nothing anyone else did this fortnight moved your position.</p>`;
  h += elsewhereHtml(b, evOther);
  h += `<div class="btnrow"><button class="primary" data-act="continue">${s.phase === 'over' ? 'See the outcome →' : `Turn ${s.turn} →`}</button></div></div>`;
  return h;
}
function elsewhereHtml(b, evOther = []) {
  const n = b.elsewhere.length + evOther.length;
  if (!n) return '';
  return `<details class="elsewhere"><summary>Elsewhere · ${n}</summary>${evOther.map((e) => `<div class="small muted">${icon('bolt')} ${esc(e.text)}</div>`).join('')}${b.elsewhere.map((r) => `<div class="small muted">${dot(r.actor)}${esc(r.text)}</div>`).join('')}</details>`;
}

// ── goals tab ──
export function goalsHtml(s) {
  let h = '';
  if (s.player) {
    const def = ACTOR_BY_ID[s.player], th = thresholds(s, s.player), sc = goalScore(def, s);
    h += `<h3>Objectives</h3><div class="kv small muted"><span>Score</span><span class="v">${sc.toFixed(0)}</span><span>Started</span><span class="v">${th.start}</span><span>Victory</span><span class="v">≥ ${th.victory}</span><span>Defeat</span><span class="v">&lt; ${th.draw}</span></div>`;
    h += goalReport(def, s).map((g) => `<div class="goal ${g.met ? 'met' : ''}"><div class="top"><span>${esc(g.name)} <span class="muted small">${'●'.repeat(g.w)}</span></span><span class="val">${g.value} → ${esc(g.target)}</span></div><div class="gbar"><i style="width:${Math.round(g.progress * 100)}%"></i></div></div>`).join('');
  }
  const sc = scores(s);
  const rows = ACTORS.map((a) => [a.id, sc[a.id]]).sort((x, y) => y[1] - x[1]);
  h += `<h3>All actors</h3><table class="lb">${rows.map(([id, v]) => `<tr class="${id === s.player ? 'me' : ''}"><td>${dot(id)}${esc(name(id))}${s.actors[id].collapsed ? ' <span class="down">✗</span>' : ''}</td><td class="n">${v.toFixed(0)}</td></tr>`).join('')}</table>`;
  return h;
}

// ── intel tab ──
export function intelHtml(s, ui) {
  let h = '';
  if (ui.selectedTheater) {
    const t = s.theaters[ui.selectedTheater], def = THEATER_BY_ID[ui.selectedTheater];
    h += `<h3>${esc(def.name)}</h3><div class="kv"><span>Tension</span><span class="v">${Math.round(t.tension)}</span><span>Controller</span><span class="v">${esc(name(def.controller))}</span></div>`;
    h += `<h3>Influence</h3>` + Object.entries(t.infl).sort((a, b) => b[1] - a[1]).map(([id, v]) => `<div class="infl"><span>${dot(id)}${esc(ACTOR_BY_ID[id].short)}</span><span class="bar"><i style="width:${v}%;background:${ACTOR_BY_ID[id].color}"></i></span><span class="mono">${Math.round(v)}</span></div>`).join('');
  } else h += `<p class="muted small">Click a theater on the map.</p>`;
  if (s.player) {
    const decl = Object.values(s.declared).filter((d) => d.actor !== s.player);
    if (decl.length) h += `<h3>Reported intentions</h3><div class="intent">` + decl.map((d) => `<span title="${esc(ACTOR_BY_ID[d.actor].name)}: ${esc(ACTION_BY_ID[d.action].name)}${d.target ? ` · ${esc(targetName(d.target))}` : ''}">${dot(d.actor)}${icon(actionIcon(d.action))}${d.target ? `<span class="muted">${esc(short(d.target))}</span>` : ''}</span>`).join('') + `</div>`;
  }
  h += `<h3>Actors</h3><table class="lb"><tr class="muted"><td></td><td class="n">${icon('coin')}</td><td class="n">${icon('shield')}</td><td class="n">${icon('flag')}</td>${s.player ? '<td class="n">Rel</td>' : ''}</tr>`;
  for (const a of ACTORS) {
    const r = s.actors[a.id];
    const rv = s.player && a.id !== s.player ? rel(s, s.player, a.id) : null;
    h += `<tr class="${a.id === s.player ? 'me' : ''}"><td title="${esc(a.blurb)}">${dot(a.id)}${esc(a.short)}</td><td class="n">${Math.floor(r.money)}</td><td class="n">${Math.floor(r.military)}</td><td class="n">${Math.floor(r.stability)}</td>${s.player ? `<td class="n ${rv > 20 ? 'up' : rv < -20 ? 'down' : ''}">${rv ?? '—'}</td>` : ''}</tr>`;
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
    <p class="lede">October 2026. Eight months into the Iran war: Hormuz shut, Brent above $100, Gaza's ceasefire and Lebanon's disarmament hanging by a thread. Pick a seat. Each fortnight you answer the situations your last moves created, make one move of your own, and read only what touched you.</p>
    ${GROUPS.map(([g, ids]) => `<h2>${g}</h2><div class="grid">${ids.map((id) => `<button class="pick ${id === sel ? 'on' : ''}" data-act="pick" data-id="${id}"><span class="swatch" style="background:${ACTOR_BY_ID[id].color};height:28px;width:6px"></span><span><span class="nm">${esc(ACTOR_BY_ID[id].name)}</span><br><span class="ld">${esc(ACTOR_BY_ID[id].leader)}</span></span></button>`).join('')}</div>`).join('')}
    <div class="detail"><div><h2>${esc(def.name)}</h2><p class="small">${esc(def.blurb)}</p>
      <div class="res start"><div>${icon('coin')}<span class="v">$${r.money}</span></div><div>${icon('shield')}<span class="v">${r.military}</span></div><div>${icon('people')}<span class="v">${r.political}</span></div><div>${icon('flag')}<span class="v">${r.stability}</span></div></div></div>
      <div><h2>Objectives</h2>${def.goals.map((g) => `<div class="goal"><div class="top"><span>${esc(g.name)} <span class="muted small">${'●'.repeat(g.w)}</span></span><span class="val">${g.dir} ${g.unit === '$' ? '$' : ''}${g.thr}${g.unit === '%' ? '%' : ''}</span></div></div>`).join('')}
      <p class="small muted">Start ${th.start} · win ≥ ${th.victory} by turn ${s0.maxTurns}</p>
      <div class="btnrow"><button class="primary" data-act="begin" data-id="${sel}">Play as ${esc(def.name)} →</button></div></div></div>
  </div>`;
}

export function helpHtml() {
  return `<div class="sheet" style="max-width:560px"><h1 style="font-size:22px">How to play</h1>
  <div class="howto">
    <div>${icon('alert')}<b>Situations.</b> Cards dealt from what everyone did last turn. Pick an option: pips are the odds, chips are what it does if it works, icons are the cost.</div>
    <div>${icon('crosshair')}<b>Initiative.</b> One move of your own. Advisers rank the best; the full list is a click away. Dots show who will lobby for (▲) or against (▼) it.</div>
    <div>${icon('bolt')}<b>End turn.</b> Everything resolves at once. The briefing shows your results and what touched you; the rest folds away.</div>
    <div>${icon('flag')}<b>Win.</b> Raise your score by 28 (to at least 75) by turn 16. Meet every objective after turn 6 to win outright. Stability 0 is collapse.</div>
  </div>
  <div class="btnrow"><button class="primary" data-act="closeModal">Back</button></div></div>`;
}

export function endHtml(s) {
  const o = s.outcome;
  const sc = scores(s);
  const rows = ACTORS.map((a) => [a.id, sc[a.id], s.history[0].scores[a.id]]).sort((x, y) => (y[1] - y[2]) - (x[1] - x[2]));
  const mine = s.player ? s.history.map((h) => h.scores[s.player]) : [];
  return `<div class="sheet" style="max-width:760px"><div class="verdict ${o.result}">${o.result.toUpperCase()}${o.decisive ? ' — DECISIVE' : ''}</div>
    <p>${esc(o.reason)}</p>${mine.length > 1 ? sparkline(mine, 420, 70) : ''}
    ${s.player ? `<h2>Objectives</h2>${goalReport(ACTOR_BY_ID[s.player], s).map((g) => `<div class="goal ${g.met ? 'met' : ''}"><div class="top"><span>${esc(g.name)}</span><span class="val">${g.value} → ${esc(g.target)}</span></div><div class="gbar"><i style="width:${Math.round(g.progress * 100)}%"></i></div></div>`).join('')}` : ''}
    <h2>Who gained most</h2><table class="lb">${rows.map(([id, v, st]) => `<tr class="${id === s.player ? 'me' : ''}"><td>${dot(id)}${esc(name(id))}</td><td class="n">${st.toFixed(0)} → ${v.toFixed(0)}</td><td class="n ${v - st >= 0 ? 'up' : 'down'}">${v - st >= 0 ? '+' : ''}${(v - st).toFixed(0)}</td></tr>`).join('')}</table>
    <div class="btnrow"><button data-act="closeModal">Review the map</button><button class="primary" data-act="newGame">New game</button></div></div>`;
}

// ── status bar (top of the page): turn timeline, score gauge, resources ──
export function statusHtml(s) {
  const segs = Array.from({ length: s.maxTurns }, (_, i) => `<i class="${i + 1 < s.turn ? 'past' : i + 1 === s.turn ? 'now' : ''}" title="Turn ${i + 1}"></i>`).join('');
  let h = `<div class="sb-turn" title="Turn ${s.turn} of ${s.maxTurns}"><div class="tl">${segs}</div><span class="date">${fmtDate(dateOf(s.turn))} · ${s.turn}/${s.maxTurns}</span></div>`;
  if (!s.player) return h;
  const def = ACTOR_BY_ID[s.player], a = s.actors[s.player];
  const sc = goalScore(def, s), th = thresholds(s, s.player);
  const prev = s.history.length >= 2 ? s.history.at(-2).scores[s.player] : s.history[0]?.scores[s.player] ?? sc;
  const d = sc - prev;
  h += `<div class="sb-score" title="Score ${sc.toFixed(0)} · started ${th.start} · victory ≥ ${th.victory} · defeat below ${th.draw}">
    <span class="n">${sc.toFixed(0)}</span><span class="d ${d > 0.5 ? 'up' : d < -0.5 ? 'down' : 'flat'}">${d > 0.5 ? `▲${d.toFixed(0)}` : d < -0.5 ? `▼${Math.abs(d).toFixed(0)}` : '—'}</span>
    <div class="gauge"><i class="fill ${sc >= th.victory ? 'win' : sc < th.draw ? 'lose' : ''}" style="width:${Math.max(0, Math.min(100, sc))}%"></i><i class="tick start" style="left:${th.start}%" title="Start ${th.start}"></i><i class="tick win" style="left:${th.victory}%" title="Victory ${th.victory}"></i></div></div>`;
  h += `<div class="sb-res"><span title="Treasury">${icon('coin')}${Math.floor(a.money)}</span><span title="Military">${icon('shield')}${Math.floor(a.military)}</span><span title="Political capital">${icon('people')}${Math.floor(a.political)}</span><span title="Stability">${icon('flag')}${Math.floor(a.stability)}</span></div>`;
  return h;
}

// ── theater popover on the map: what is here, what happened here, cards dealt here ──
export function theaterPopHtml(s, tid, happenings = []) {
  const t = s.theaters[tid], def = THEATER_BY_ID[tid];
  const infl = Object.entries(t.infl).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const cards = s.situations.filter((x) => x.at === tid);
  let h = `<div class="pop-head"><b>${esc(def.name)}</b><span class="muted small">tension ${Math.round(t.tension)}</span><button class="x" data-act="closePop" title="Close">×</button></div>`;
  h += `<div class="pop-infl">${infl.map(([id, v]) => `<span title="${esc(ACTOR_BY_ID[id].name)} ${Math.round(v)}">${dot(id)}<i class="bar"><b style="width:${v}%;background:${ACTOR_BY_ID[id].color}"></b></i></span>`).join('')}</div>`;
  if (cards.length) h += `<div class="pop-cards">${cards.map((c) => `<button data-act="gotoCard" data-id="${esc(c.id)}" class="${c.kind}">${icon(KIND_ICON[c.kind])}<span>${esc(c.title)}</span></button>`).join('')}</div>`;
  if (happenings.length) {
    h += `<div class="pop-hap">${happenings.slice(0, 6).map((x) => `<div class="hrow ${x.cls}"><span class="oic">${icon(x.icon)}</span><div class="bbody">${x.actor ? dot(x.actor) : ''}<span class="small">${esc(x.text)}</span>${chips(x.lines)}</div></div>`).join('')}${happenings.length > 6 ? `<div class="small muted">+${happenings.length - 6} more in the log</div>` : ''}</div>`;
  } else h += `<div class="small muted pop-empty">Quiet this fortnight.</div>`;
  h += `<div class="pop-foot"><button class="ghost small" data-act="intel" data-id="${esc(tid)}">${icon('eye')} Theater intel</button></div>`;
  return h;
}
