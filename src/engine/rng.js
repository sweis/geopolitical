// mulberry32 over an integer stored in game state, so clones and saves replay identically.
export function rand(s) {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const d100 = (s) => 1 + Math.floor(rand(s) * 100);
export const pick = (s, arr) => arr[Math.floor(rand(s) * arr.length)];
