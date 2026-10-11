// npm test: engine checks, then browser checks.
import { spawnSync } from 'node:child_process';
const run = (f) => spawnSync(process.execPath, [new URL(f, import.meta.url).pathname], { stdio: 'inherit' }).status;
const a = run('./engine.mjs');
const b = run('./browser.mjs');
process.exit(a || b ? 1 : 0);
