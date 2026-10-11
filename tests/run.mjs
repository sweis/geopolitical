// npm test: engine checks, situation content probe, then browser checks.
import { spawnSync } from 'node:child_process';
const run = (f, args = []) => spawnSync(process.execPath, [new URL(f, import.meta.url).pathname, ...args], { stdio: 'inherit' }).status;
const a = run('./engine.mjs');
const b = run('./situations.mjs', ['1']);
const c = run('./browser.mjs');
process.exit(a || b || c ? 1 : 0);
