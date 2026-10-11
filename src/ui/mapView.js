// SVG theater map: baked country outlines, theater markers, a magnified Levant inset (the Levant is
// ~20px across at full scale), result arcs, and named cameras.
import { COUNTRIES, MAP_W, MAP_H, project } from '../data/map.js';
import { THEATERS, THEATER_BY_ID, ANCHORS } from '../data/theaters.js';
import { ACTOR_BY_ID } from '../data/actors.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

const LABELS = ['Turkey', 'Syria', 'Iraq', 'Iran', 'Saudi Arabia', 'Egypt', 'Yemen', 'Oman', 'Jordan', 'Kuwait', 'United Arab Emirates', 'Sudan', 'Afghanistan', 'Pakistan', 'Eritrea'];
const LABEL_FIX = { 'United Arab Emirates': 'UAE', 'Saudi Arabia': 'SAUDI ARABIA' };
const HOME_COUNTRY = { us: null, israel: 'Israel', iran: 'Iran', turkey: 'Turkey', saudi: 'Saudi Arabia', egypt: 'Egypt', houthis: 'Yemen', hezbollah: 'Lebanon', hamas: 'Palestine', pij: 'Palestine', iraqMilitias: 'Iraq', sdf: 'Syria', krg: 'Iraq', isis: 'Syria', syria: 'Syria', lebanon: 'Lebanon' };

// Levant inset: source box in lon/lat and its placement on the map (viewBox units).
const INSET_SRC = { w: 32.6, e: 38.4, s: 29.4, n: 35.7 };
const INSET_IDS = new Set(['gaza', 'westbank', 'israelHome', 'southLebanon', 'beirut', 'southSyria', 'damascus', 'tartus', 'sinai']);

export const CAMS = {
  overview: [0, 0, MAP_W, MAP_H],
  levant: null, // computed from the projection
  gulf: null,
  'hud-check': [0, 0, MAP_W, MAP_H],
};

export function createMap(svg, { onTheaterClick, onTheaterHover }) {
  svg.setAttribute('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = '';
  const defs = el('defs', {}, svg);
  const landG = el('g', { id: 'land' }, defs);
  for (const c of COUNTRIES) el('path', { d: c.d, class: 'country', 'data-name': c.name }, landG);

  el('rect', { x: -500, y: -500, width: MAP_W + 1000, height: MAP_H + 1000, fill: 'var(--sea)' }, svg);
  const world = el('g', { id: 'world' }, svg);
  const landUse = el('g', {}, world);
  for (const c of COUNTRIES) el('path', { d: c.d, class: 'country', 'data-name': c.name }, landUse);
  const labels = el('g', {}, world);
  for (const c of COUNTRIES) {
    if (!LABELS.includes(c.name)) continue;
    const t = el('text', { x: c.cx, y: c.cy, class: 'clabel', 'text-anchor': 'middle' }, labels);
    t.textContent = LABEL_FIX[c.name] ?? c.name;
  }
  const P = Object.fromEntries(THEATERS.map((t) => [t.id, project(t.lon, t.lat)]));
  const adj = el('g', {}, world);
  const seen = new Set();
  for (const t of THEATERS) for (const n of t.adj) {
    const k = [t.id, n].sort().join('-');
    if (seen.has(k) || INSET_IDS.has(t.id) && INSET_IDS.has(n)) continue;
    seen.add(k);
    el('line', { x1: P[t.id][0], y1: P[t.id][1], x2: P[n][0], y2: P[n][1], class: 'adj' }, adj);
  }
  const anchors = el('g', { class: 'anchor' }, world);
  const A = {};
  for (const [id, a] of Object.entries(ANCHORS)) {
    A[id] = project(a.lon, a.lat);
    el('circle', { cx: A[id][0], cy: A[id][1], r: 5, fill: ACTOR_BY_ID[id].color, stroke: '#0a0f15', 'stroke-width': 1.5 }, anchors);
    const t = el('text', { x: A[id][0] + 8, y: A[id][1] + 4 }, anchors);
    t.textContent = a.label;
  }

  // Inset frame and source box.
  const [sx0, sy0] = project(INSET_SRC.w, INSET_SRC.n), [sx1, sy1] = project(INSET_SRC.e, INSET_SRC.s);
  const srcW = sx1 - sx0, srcH = sy1 - sy0;
  const insetH = 340, insetW = (srcW / srcH) * insetH, ix = 14, iy = MAP_H - insetH - 14;
  el('rect', { x: sx0, y: sy0, width: srcW, height: srcH, class: 'inset-src' }, world);
  el('line', { x1: sx0, y1: sy1, x2: ix + insetW, y2: iy, class: 'inset-src' }, world);
  el('rect', { x: ix, y: iy, width: insetW, height: insetH, class: 'inset-frame', rx: 4 }, world);
  const inset = el('svg', { x: ix, y: iy, width: insetW, height: insetH, viewBox: `${sx0} ${sy0} ${srcW} ${srcH}`, overflow: 'hidden' }, world);
  el('use', { href: '#land' }, inset);
  const insetScale = insetH / srcH;
  const it = el('text', { x: ix + 8, y: iy + 16, class: 'inset-title' }, world);
  it.textContent = 'LEVANT';
  CAMS.levant = [ix - 10, iy - 10, Math.max(insetW + 20, 1), insetH + 20];
  const [gx0, gy0] = project(46, 31), [gx1, gy1] = project(60, 22);
  CAMS.gulf = [gx0, gy0, gx1 - gx0, gy1 - gy0];

  const arcs = el('g', { id: 'arcs' }, world);
  const fx = el('g', { id: 'fx' }, world);
  const markers = el('g', { id: 'markers' }, world);
  const insetMarkers = el('g', {}, inset);

  // Marker positions in world coordinates (inset theaters live inside the inset box).
  const pos = {};
  for (const t of THEATERS) {
    if (INSET_IDS.has(t.id)) pos[t.id] = [ix + (P[t.id][0] - sx0) * insetScale, iy + (P[t.id][1] - sy0) * insetScale];
    else pos[t.id] = P[t.id];
  }

  const nodes = {};
  for (const t of THEATERS) {
    const inIn = INSET_IDS.has(t.id);
    // Inset theaters: a tiny true-position dot on the main map plus a full marker in the inset.
    if (inIn) el('circle', { cx: P[t.id][0], cy: P[t.id][1], r: 1.6, fill: '#8b9bab' }, world);
    const parent = inIn ? insetMarkers : markers;
    const [x, y] = inIn ? P[t.id] : pos[t.id];
    const k = inIn ? 1 / insetScale : 1;
    const g = el('g', { class: 'th', 'data-id': t.id, transform: `translate(${x} ${y}) scale(${k})` }, parent);
    const halo = el('circle', { r: 12, class: 'halo' }, g);
    const ring = el('circle', { r: 15, class: 'ring', fill: 'none' }, g);
    const core = el('circle', { r: 6, class: 'core' }, g);
    const lbl = el('text', { x: 10, y: 4, class: 'lbl' }, g);
    lbl.textContent = t.label ?? t.name;
    if (['tehran', 'baghdad', 'redSea', 'israelHome', 'neSyria'].includes(t.id)) {
      lbl.setAttribute('x', -10); lbl.setAttribute('text-anchor', 'end');
    }
    if (t.id === 'sinai') { lbl.setAttribute('x', 0); lbl.setAttribute('y', 22); lbl.setAttribute('text-anchor', 'middle'); }
    if (t.id === 'israelHome') lbl.setAttribute('y', -4);
    if (t.id === 'westbank' || t.id === 'gaza') lbl.setAttribute('y', 12);
    if (t.id === 'gulfBases') { lbl.setAttribute('x', 0); lbl.setAttribute('y', -16); lbl.setAttribute('text-anchor', 'middle'); }
    g.addEventListener('click', (e) => { e.stopPropagation(); onTheaterClick?.(t.id); });
    g.addEventListener('mouseenter', (e) => onTheaterHover?.(t.id, e));
    g.addEventListener('mousemove', (e) => onTheaterHover?.(t.id, e));
    g.addEventListener('mouseleave', () => onTheaterHover?.(null));
    nodes[t.id] = { g, halo, ring, core };
  }

  const view = { svg, pos, anchors: A, nodes, arcs, fx, cam: 'overview', homeCountry: null };

  view.anchorOf = (actorId) => {
    if (A[actorId]) return A[actorId];
    const h = ACTOR_BY_ID[actorId]?.home;
    return h ? pos[h] : [MAP_W / 2, 30];
  };

  view.setCam = (name, playerId) => {
    let vb = CAMS[name];
    if (name === 'hero-close') {
      const [x, y] = view.anchorOf(playerId || 'us');
      vb = [x - 170, y - 130, 340, 260];
    }
    if (!vb) return false;
    svg.setAttribute('viewBox', vb.map((n) => n.toFixed(1)).join(' '));
    view.cam = name;
    return true;
  };
  view.teleport = (spot) => {
    const p = typeof spot === 'string' ? pos[spot] ?? A[spot] : spot;
    if (!p) return false;
    svg.setAttribute('viewBox', `${p[0] - 150} ${p[1] - 115} 300 230`);
    view.cam = `teleport:${typeof spot === 'string' ? spot : p.join(',')}`;
    return true;
  };

  view.highlightHome = (playerId) => {
    const name = HOME_COUNTRY[playerId];
    for (const p of svg.querySelectorAll('.country')) p.classList.toggle('home', !!name && p.dataset.name === name);
  };

  return view;
}

const TENSION_COLORS = [[0, '#4f7f9f'], [40, '#c9a54a'], [65, '#e07b39'], [80, '#e5484d']];
const tensionColor = (v) => TENSION_COLORS.filter(([t]) => v >= t).pop()[1];

export function renderMap(view, s, ui) {
  for (const t of THEATERS) {
    const st = s.theaters[t.id], n = view.nodes[t.id];
    const top = Object.entries(st.infl).sort((a, b) => b[1] - a[1])[0];
    n.core.setAttribute('fill', top ? ACTOR_BY_ID[top[0]].color : '#666');
    n.core.setAttribute('r', 5 + st.tension / 25);
    n.halo.setAttribute('r', 9 + st.tension / 9);
    n.halo.setAttribute('stroke', tensionColor(st.tension));
    n.g.classList.toggle('hot', st.tension >= 75);
    n.g.classList.toggle('target', !!ui.targetable?.has(t.id));
    n.g.classList.toggle('selected', ui.selectedTheater === t.id || ui.target === t.id);
    n.g.classList.toggle('card', !!ui.cards?.includes(t.id));
  }
}

export function drawArcs(view, results, player, relevant = new Set()) {
  view.arcs.innerHTML = '';
  for (const r of results) {
    if (!r.target || r.outcome === 'fizzle') continue;
    const from = view.anchorOf(r.actor);
    const to = view.pos[r.target] ?? view.anchorOf(r.target);
    if (!from || !to || (from[0] === to[0] && from[1] === to[1])) continue;
    const mx = (from[0] + to[0]) / 2, my = (from[1] + to[1]) / 2;
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const bend = 0.22;
    const d = `M${from[0]},${from[1]} Q${mx - dy * bend},${my + dx * bend} ${to[0]},${to[1]}`;
    el('path', { d, class: `arc ${r.ok ? 'ok' : 'bad'} ${r.actor === player ? 'mine' : relevant.has(r.actor) ? 'rel' : 'faint'}` }, view.arcs);
  }
}

export function flash(view, theaterId) {
  const p = view.pos[theaterId];
  if (!p) return;
  el('circle', { cx: p[0], cy: p[1], r: 6, class: 'flash' }, view.fx);
  setTimeout(() => view.fx.firstChild?.remove(), 5000);
}

export function theaterName(id) { return THEATER_BY_ID[id]?.name ?? id; }
