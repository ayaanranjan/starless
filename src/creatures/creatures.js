// STARLESS creatures — public entry point (CREATURES agent).
// createCreature(type, ctx, opts) -> Creature { object, type, position, yaw, state, hidden, setPatrol, hearNoise, update, getNetState, setNetState, dispose }
// Net state (hostile types): [x, y, z, yaw, stateIndex, hidden(0|1), attackSeq]  stateIndex -> STATES
// Watcher: [enraged 0|1]; Leviathan: [] (deterministic from ctx.time).
import * as THREE from 'three';
import { STATES } from './common.js';
import { Stalker } from './stalker.js';
import { Crawler } from './crawler.js';
import { Mimic } from './mimic.js';
import { Wraith } from './wraith.js';
import { Leviathan, Watcher } from './colossi.js';

export { STATES };
export const CREATURE_TYPES = ['stalker', 'crawler', 'mimic', 'wraith', 'leviathan', 'watcher'];

const CTORS = { stalker: Stalker, crawler: Crawler, mimic: Mimic, wraith: Wraith, leviathan: Leviathan, watcher: Watcher };

function toV3(p) {
  if (!p) return undefined;
  if (p.isVector3) return p;
  if (Array.isArray(p)) return new THREE.Vector3(+p[0] || 0, +p[1] || 0, +p[2] || 0);
  return new THREE.Vector3(+p.x || 0, +p.y || 0, +p.z || 0);
}

export function createCreature(type, ctx, opts = {}) {
  const C = CTORS[type];
  if (!C) throw new Error('Unknown creature type: ' + type);
  const o = Object.assign({}, opts);
  o.position = toV3(opts.position) || new THREE.Vector3();
  if (Array.isArray(opts.patrol)) o.patrol = opts.patrol.map(toV3).filter(Boolean);
  if (opts.lookAt) o.lookAt = toV3(opts.lookAt);
  if (opts.center) o.center = toV3(opts.center);
  return new C(ctx, o);
}

export default createCreature;
