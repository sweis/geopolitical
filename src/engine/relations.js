// Relation lookup, kept dependency-free so data modules can import it.
export const relKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const rel = (s, a, b) => (a === b ? 100 : s.rel[relKey(a, b)] ?? 0);
