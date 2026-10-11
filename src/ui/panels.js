// HTML renderers for the side panel, top bar and modals. Pure functions of (state, ui) → string.
import { ACTORS, ACTOR_BY_ID } from '../data/actors.js';
import { THEATER_BY_ID } from '../data/theaters.js';
import { WORLD_LABELS } from '../data/world.js';
import { ACTION_BY_ID, COMMIT, costOf, affordable, targetName } from '../engine/actions.js';
import { goalReport, goalScore } from '../engine/goals.js';
import { dateOf, rel } from '../engine/state.js';
import { playerMenu, preview, thresholds, scores } from '../engine/game.js';

export const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (p) => `${Math.round(p * 100)}%`;
const sign = (d) => (d > 0 ? `+${Math.round(d * 100)}` : `${Math.round(d * 100)}`);
const fmtDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
const name = (id) => ACTOR_BY_ID[id]?.name ?? THEATER_BY_ID[id]?.name ?? id;
const dot = (id) => `<span class="dot" style="background:${ACTOR_BY_ID[id]?.color ?? '#888'}"></span>`;

export function costHtml(c) {
  const parts = [];
  if (c.money) parts.push(`<b>$${c.money}</b>`);
  if (c.military) parts.push(`<b>${c.military}</b> mil`);
  if (c.political) parts.push(`<b>${c.political}</b> PC`);
  return `<span class="cost">${parts.join(' · ') || 'free'}</span>`;
}

// ── top bar ──
const IND = [
  ['oil', 'Brent', (v) => `$${v}`], ['hormuz', 'Hormuz', (v) => `${v}%`], ['redSea', 'Red Sea', (v) => `${v}%`], ['warIntensity', 'Iran war', (v) => v],
  ['iranNuclear', 'Breakout', (v) => v], ['gazaCeasefire', 'Gaza truce', (v) => v], ['humanitarian', 'Gaza aid', (v) => v], ['isisStrength', 'ISIS', (v) => v],
];
export function clockHtml(s) {
  const phase = { declare: 'DECLARE', debate: 'DEBATE', results: 'RESULTS', over: 'GAME OVER' }[s.phase];
  return `${fmtDate(dateOf(s.turn))} · TURN ${s.turn}/${s.maxTurns} · ${phase}`;
}
export function indicatorsHtml(s) {
  const prev = s.history.length >= 2 ? s.history[s.history.length - 2].world : s.history[0]?.world;
  return IND.map(([k, short, f]) => {
    const v = s.world[k], d = prev ? v - prev[k] : 0;
    const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    const ds = d ? `${d > 0 ? '▲' : '▼'}${Math.abs(Math.round(d))}` : '';
    return `<div class="ind" title="${esc(WORLD_LABELS[k])}"><span class="k">${esc(short)}</span><span class="v">${f(Math.round(v))}</span><span class="d ${cls}">${ds}</span></div>`;
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
      <div title="Political capital: pays for actions and arguments"><div class="k">Political</div><div class="v">${Math.floor(a.political)} PC</div></div>
      <div title="Domestic stability (0 = collapse)"><div class="k">Stability</div><div class="v">${Math.floor(a.stability)}</div></div>
    </div>`;
}

// ── command tab ──
const CATS = ['all', 'military', 'diplomatic', 'economic', 'covert', 'domestic'];
function phaseStrip(s) {
  const steps = [['declare', '1 Declare'], ['debate', '2 Debate'], ['results', '3 Adjudicate']];
  return `<div class="phase">${steps.map(([k, l]) => `<span class="${s.phase === k ? 'on' : ''}">${l}</span>`).join('')}</div>`;
}

function reasonsHtml(ev) {
  const rows = [`<li><span class="d mono">${Math.round(ev.base * 100)}</span><span class="muted">Base likelihood</span></li>`];
  for (const m of ev.mods) rows.push(`<li><span class="d ${m.d > 0 ? 'up' : 'down'}">${sign(m.d)}</span><span>${esc(m.text)}</span></li>`);
  if (ev.commitBonus) rows.push(`<li><span class="d up">${sign(ev.commitBonus)}</span><span>Extra commitment of resources</span></li>`);
  if (ev.debate) rows.push(`<li><span class="d ${ev.debate > 0 ? 'up' : 'down'}">${sign(ev.debate)}</span><span>Arguments from other actors</span></li>`);
  return `<ul class="reasons">${rows.join('')}</ul>`;
}
function oddsHtml(ev) {
  return `<div class="odds"><span class="pct">${pct(ev.p)}</span><span class="band">${esc(ev.band)}</span></div>
    <div class="pbar"><i style="width:${pct(ev.p)}"></i></div>${reasonsHtml(ev)}`;
}

export function commandHtml(s, ui) {
  if (!s.player) return `${phaseStrip(s)}<p class="muted">Observer mode. Use the dev hooks (step / resume) to advance.</p>${resultsList(s, ui)}`;
  if (s.actors[s.player].collapsed) return `<p>Your government has collapsed.</p>`;
  if (s.phase === 'declare') return phaseStrip(s) + declareHtml(s, ui);
  if (s.phase === 'debate') return phaseStrip(s) + debateHtml(s, ui);
  return phaseStrip(s) + resultsHtml(s, ui);
}

function declareHtml(s, ui) {
  const menu = playerMenu(s);
  const list = menu.filter((m) => ui.cat === 'all' || m.cat === ui.cat);
  let h = ui.action ? actionDetail(s, ui) : '';
  h += `<h3>${ui.action ? 'Other actions' : 'Choose your action'}</h3><div class="chips">${CATS.map((c) => `<button data-act="cat" data-id="${c}" class="${ui.cat === c ? 'on' : ''}">${c[0].toUpperCase() + c.slice(1)}</button>`).join('')}</div>`;
  h += `<div class="alist">${list.map((m) => {
    const usable = m.affordable && m.targets.length;
    return `<button class="arow ${ui.action === m.id ? 'on' : ''}" data-act="action" data-id="${m.id}" ${usable ? '' : 'disabled'} title="${esc(usable ? m.desc : m.targets.length ? 'Cannot afford' : 'No valid targets')}">
      <span><span class="nm">${esc(m.name)}</span><br><span class="cat">${m.cat}</span></span>${costHtml(m.cost)}</button>`;
  }).join('')}</div>`;
  if (!ui.action) h += `<p class="muted small">Pick an action. Highlighted theaters on the map are valid targets.</p>`;
  return h;
}

function actionDetail(s, ui) {
  let h = '';
  const act = ACTION_BY_ID[ui.action];
  const targets = act.targets(s, s.player);
  h += `<div class="box" id="actionDetail"><div class="nm"><b>${esc(act.name)}</b></div><div class="desc">${esc(act.desc)}</div>`;
  if (targets.length > 1 || targets[0] !== null) {
    h += `<h3>Target</h3><div class="targets">${targets.map((t) => `<button data-act="target" data-id="${t}" class="${ui.target === t ? 'on' : ''}">${act.target === 'actor' ? dot(t) : ''}${esc(targetName(t))}</button>`).join('')}</div>`;
  }
  h += `<h3>Commitment</h3><div class="seg">${COMMIT.map((c, i) => {
    const ok = affordable(s, s.player, act, i);
    return `<button data-act="commit" data-id="${i}" class="${ui.commit === i ? 'on' : ''}" ${ok ? '' : 'disabled'}>${c.label}<br>${costHtml(costOf(act, i))}</button>`;
  }).join('')}</div>`;
  if (ui.target !== undefined && targets.includes(ui.target)) {
    const ev = preview(s, s.player, act.id, ui.target, ui.commit);
    h += `<h3>Game master's assessment</h3>${oddsHtml(ev)}`;
    h += `<div class="btnrow"><button class="primary" data-act="declare">Declare action →</button></div>`;
  } else h += `<p class="muted small">Select a target to see the odds.</p>`;
  return h + `</div>`;
}

function declLine(s, d, opts = {}) {
  const act = ACTION_BY_ID[d.action];
  const args = d.args.map((x) => `<div class="${x.stance > 0 ? 'up' : 'down'}">${x.stance > 0 ? '▲' : '▼'} ${esc(x.text)}</div>`).join('');
  return `<div class="decl" style="border-left-color:${ACTOR_BY_ID[d.actor].color}">
    <span class="who">${esc(name(d.actor))}</span> <span class="what">→ ${esc(act.name)}${d.target ? ` · ${esc(targetName(d.target))}` : ''}${d.commit ? ` · ${COMMIT[d.commit].label}` : ''}</span>
    ${opts.extra ?? ''}${args ? `<div class="args">${args}</div>` : ''}</div>`;
}

function debateHtml(s, ui) {
  const mine = s.declared[s.player];
  const ev = preview(s, s.player, mine.action, mine.target, mine.commit);
  let h = `<h3>Your declaration</h3>${declLine(s, mine)}<div class="box">${oddsHtml(ev)}</div>`;
  const me = s.actors[s.player];
  h += `<h3>Moves that affect you <span class="muted">· ${Math.floor(me.political)} PC</span></h3>`;
  if (!s.debate.length) h += `<p class="muted small">No other declaration this turn touches your goals much.</p>`;
  for (const item of s.debate) {
    const d = s.declared[item.actor];
    const stake = `<div class="stake ${item.delta > 0 ? 'up' : 'down'}">${item.delta > 0 ? 'Helps you' : 'Hurts you'} (${item.delta > 0 ? '+' : ''}${item.delta.toFixed(1)})</div>`;
    const btns = `<div class="argbtns">
      <button data-act="argue" data-id="${item.actor}" data-stance="1" class="${item.choice === 1 ? 'on-sup' : ''}">Support (1 PC)</button>
      <button data-act="argue" data-id="${item.actor}" data-stance="-1" class="${item.choice === -1 ? 'on-opp' : ''}">Oppose (1 PC)</button>
      ${item.choice ? `<button data-act="argue" data-id="${item.actor}" data-stance="0">Withdraw</button>` : ''}</div>`;
    h += declLine(s, d, { extra: stake + btns });
  }
  const others = Object.values(s.declared).filter((d) => d.actor !== s.player && !s.debate.find((x) => x.actor === d.actor));
  h += `<h3>All other declarations</h3>${others.map((d) => declLine(s, d)).join('')}`;
  h += `<div class="btnrow"><button class="primary" data-act="resolve">Adjudicate turn →</button></div>`;
  return h;
}

function resultsList(s, ui) {
  if (!s.results.length) return '';
  let h = '';
  const news = s.news.map((n) => `<div class="news">${esc(n.text)}</div>`).join('');
  if (news) h += `<h3>Events</h3>${news}`;
  h += `<h3>Adjudication · initiative order</h3>`;
  for (const r of s.results) h += resultRow(s, r);
  return h;
}

function resultRow(s, r) {
  const label = { success: 'SUCCESS', crit: 'DECISIVE', fail: 'FAILED', blowback: 'BLOWBACK', fizzle: 'OVERTAKEN' }[r.outcome];
  const roll = r.outcome === 'fizzle' ? '' : `<div class="roll">d100 ${r.roll} vs ${Math.round(r.p * 100)} · ${esc(r.band)}</div>`;
  return `<div class="result ${r.actor === s.player ? 'mine' : ''}"><span class="oc ${r.outcome}">${label}</span><div>${esc(r.text)}${roll}</div></div>`;
}

function resultsHtml(s, ui) {
  const prev = s.history[s.history.length - 2], cur = s.history[s.history.length - 1];
  let h = '';
  const mine = s.results.find((r) => r.actor === s.player);
  if (mine) h += `<h3>Your action</h3>${resultRow(s, mine)}`;
  if (s.player && prev) {
    const d = cur.scores[s.player] - prev.scores[s.player];
    h += `<div class="box"><b>Your score: ${cur.scores[s.player].toFixed(0)}</b> <span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'} mono">${d >= 0 ? '+' : ''}${d.toFixed(1)}</span>
      <div class="small muted">${changedWorld(prev.world, cur.world)}</div></div>`;
  }
  h += resultsList(s, ui);
  h += `<div class="btnrow">${s.phase === 'over' ? '<button class="primary" data-act="showEnd">See outcome →</button>' : '<button class="primary" data-act="next">Next turn →</button>'}</div>`;
  return h;
}

function changedWorld(a, b) {
  const out = [];
  for (const k of Object.keys(WORLD_LABELS)) {
    const d = Math.round(b[k] - a[k]);
    if (Math.abs(d) >= 3) out.push(`${WORLD_LABELS[k]} <span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</span>`);
  }
  return out.length ? out.join(' · ') : 'No major shifts in the strategic picture.';
}

// ── goals tab ──
export function goalsHtml(s) {
  let h = '';
  if (s.player) {
    const def = ACTOR_BY_ID[s.player], th = thresholds(s, s.player), sc = goalScore(def, s);
    h += `<h3>Your objectives</h3><p class="small muted">Score ${sc.toFixed(0)} (started ${th.start}). Victory at turn ${s.maxTurns} needs ≥ ${th.victory} and ${th.metNeeded} objectives fully met; ending below ${th.draw} is defeat. Meet every objective for an early decisive win.</p>`;
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
    <p class="lede small">A <b>matrix game</b>: each fortnight every actor declares one action. The game master weighs the arguments for and against, other actors argue their case, and a d100 decides. Achieve your objectives within ${s0.maxTurns} turns.</p>
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
  <li><b>Declare.</b> Pick one action, a target and how much to commit. The game master shows the likelihood and the reasons for and against, drawn from the current situation.</li>
  <li><b>Debate.</b> Every other actor declares too. Actors spend political capital to argue for moves that help them and against moves that hurt them; you can do the same on the moves that touch your goals.</li>
  <li><b>Adjudicate.</b> Actions resolve in random initiative order: roll d100 under the final likelihood. A roll in the bottom fifth of the success band is decisive; 96+ on a failure is blowback.</li></ol>
  <h2>Winning</h2><p>Your score (0–100) is weighted progress on your objectives. Raise it by 15 points (minimum 60) and fully meet at least half your objectives by the last turn to win; meet every objective for a decisive early win; let your stability hit 0 and you collapse.</p>
  <h2>Resources</h2><p><b>Treasury</b> and <b>military</b> pay for operations. <b>Political capital</b> pays for diplomacy and arguments. <b>Stability</b> is your home front.</p>
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
