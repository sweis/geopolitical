// All situation definitions. See dsl.js for the shape.
import { GENERIC } from './generic.js';
import { POWERS } from './powers.js';
import { STATES } from './states.js';
import { GROUPS } from './groups.js';

export const SITUATIONS = [...GENERIC, ...POWERS, ...STATES, ...GROUPS];
export const SITUATION_BY_ID = Object.fromEntries(SITUATIONS.map((d) => [d.id, d]));
export { appliesTo, makeHelpers } from './dsl.js';
