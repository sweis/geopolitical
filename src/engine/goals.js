// Goal constructors and scoring. A goal maps game state to progress in [0,1]; met when progress >= 1.
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// v >= thr is met; v <= lo is zero progress.
export function atLeast(name, get, thr, lo, w = 1, unit = '') {
  return { name, get, thr, lo, w, unit, dir: '>=', progress: (s) => clamp01((get(s) - lo) / (thr - lo)) };
}
// v <= thr is met; v >= hi is zero progress.
export function atMost(name, get, thr, hi, w = 1, unit = '') {
  return { name, get, thr, lo: hi, w, unit, dir: '<=', progress: (s) => clamp01((hi - get(s)) / (hi - thr)) };
}

// Getters are tagged with what they read so the UI can show each actor only the tracks its goals use.
export const W = (k) => Object.assign((s) => s.world[k], { world: k });
export const R = (id, k) => Object.assign((s) => s.actors[id][k], { actor: id, resource: k });
export const INF = (theater, id) => Object.assign((s) => s.theaters[theater].infl[id] || 0, { theater, who: id });

export function goalKeys(actorDef) {
  const world = new Set(), theaters = new Set(), actors = new Set();
  for (const g of actorDef.goals) {
    if (g.get.world) world.add(g.get.world);
    if (g.get.theater) theaters.add(g.get.theater);
    if (g.get.actor) actors.add(g.get.actor);
  }
  return { world, theaters, actors };
}

export function goalScore(actorDef, s) {
  let sum = 0, wsum = 0;
  for (const g of actorDef.goals) { sum += g.w * g.progress(s); wsum += g.w; }
  return wsum ? (100 * sum) / wsum : 0;
}

export function goalReport(actorDef, s) {
  return actorDef.goals.map((g) => {
    const v = g.get(s), p = g.progress(s);
    return { name: g.name, value: Math.round(v), target: `${g.dir} ${g.unit === '$' ? '$' : ''}${g.thr}${g.unit === '%' ? '%' : ''}`, progress: +p.toFixed(3), met: p >= 1, w: g.w };
  });
}
