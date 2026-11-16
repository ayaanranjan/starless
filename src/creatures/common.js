// STARLESS creatures: shared helpers, base class, generic walker AI (host-authoritative).
import * as THREE from 'three';

export const STATES = ['idle', 'patrol', 'investigate', 'chase', 'attack', 'stunned', 'flee'];
const SIDX = {}; STATES.forEach((s, i) => { SIDX[s] = i; });
export const DEG = Math.PI / 180;
export const r2 = (v) => Math.round((+v || 0) * 100) / 100;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export function wrapAngle(a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; }
export function dampAngle(a, b, rate, dt) { return a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt)); }
export function yawTo(dx, dz) { return Math.atan2(-dx, -dz); }
export const rand = (a, b) => a + Math.random() * (b - a);

// ---------- shared (per type) resources with refcount ----------
const SHARED = new Map();
export function acquireShared(key, build) {
  let e = SHARED.get(key);
  if (!e) { e = { res: build(), count: 0 }; SHARED.set(key, e); }
  e.count++;
  return e.res;
}
export function releaseShared(key) {
  const e = SHARED.get(key);
  if (!e) return;
  if (--e.count > 0) return;
  SHARED.delete(key);
  disposeDeep(e.res, 0);
}
function disposeDeep(o, depth) {
  if (!o || depth > 3) return;
  for (const k in o) {
    const v = o[k];
    if (!v || typeof v !== 'object') continue;
    if (v.isBufferGeometry || v.isMaterial || v.isTexture) { try { v.dispose(); } catch (e) { /* ignore */ } }
    else if (!v.isObject3D && !v.isColor && !v.isVector3) disposeDeep(v, depth + 1);
  }
}

// ---------- player helpers ----------
const _fwd = new THREE.Vector3();
const _to = new THREE.Vector3();
const _eye = new THREE.Vector3();
export function playerEye(p, out) {
  return out.set(p.position.x, p.position.y + (p.crouching ? 1.0 : 1.62), p.position.z);
}
export function lookDir(p, out) {
  const pitch = p.pitch || 0, yaw = p.yaw || 0, cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}
export function los(ctx, a, b) {
  const w = ctx.world;
  if (!w || typeof w.lineOfSight !== 'function') return true;
  try { return w.lineOfSight(a, b) !== false; } catch (e) { return true; }
}
export function validTarget(p) {
  return !!(p && p.position && !p.downed && (p.health === undefined || p.health > 0));
}
// Flashlight cone test: is player p lighting world point `pt`?
export function isLit(ctx, p, pt, maxDist = 16) {
  if (!p || !p.position || !p.flashlight || p.downed) return false;
  if (!((p.battery ?? 100) > 0)) return false;
  playerEye(p, _eye);
  _to.subVectors(pt, _eye);
  const d = _to.length();
  if (d > maxDist) return false;
  if (d < 0.3) return true;
  _to.multiplyScalar(1 / d);
  lookDir(p, _fwd);
  const ang = Math.max(14 * DEG, Math.atan2(0.75, d)); // body is wide up close
  if (_fwd.dot(_to) < Math.cos(ang)) return false;
  return los(ctx, _eye, pt);
}
// Angle (rad) between player's look direction and direction to pt.
export function lookAngle(p, pt) {
  playerEye(p, _eye);
  _to.subVectors(pt, _eye);
  const d = _to.length();
  if (d < 1e-4) return 0;
  _to.multiplyScalar(1 / d);
  lookDir(p, _fwd);
  return Math.acos(clamp(_fwd.dot(_to), -1, 1));
}
export function localPlayer(ctx) {
  try {
    const lp = ctx.getLocalPlayer?.();
    if (lp) return lp;
    return ctx.players?.get?.(ctx.localId) || null;
  } catch (e) { return null; }
}

// ---------- fog-aware ShaderMaterial helper ----------
export function fogShaderMaterial({ uniforms, vertex, fragment, fog = true, ...rest }) {
  const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms || {}]);
  const vs = `#include <common>\n#include <fog_pars_vertex>\n${vertex}`;
  const fs = `#include <common>\n#include <fog_pars_fragment>\n${fragment}`;
  return new THREE.ShaderMaterial({ uniforms: u, vertexShader: vs, fragmentShader: fs, fog, ...rest });
}
export const GLSL_NOISE = `
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;

// tapered limb geometry hanging DOWN from its pivot (pivot at y=0, extends to -len)
export function limbGeo(rTop, rBot, len, radial = 7) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, radial, 1);
  g.translate(0, -len / 2, 0);
  return g;
}
export function mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = false; m.receiveShadow = false;
  if (parent) parent.add(m);
  return m;
}
export function group(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (parent) parent.add(g);
  return g;
}

// ---------- base creature ----------
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class CreatureBase {
  constructor(type, ctx, opts = {}) {
    this.type = type;
    this.ctx = ctx;
    this.opts = opts;
    this.object = new THREE.Group();
    this.object.name = 'creature_' + type;
    this.position = this.object.position; // feet (wraith: body centre)
    if (opts.position) this.position.set(opts.position.x || 0, opts.position.y || 0, opts.position.z || 0);
    this.home = this.position.clone();
    this.yaw = opts.yaw || 0;
    this.state = 'idle';
    this.hidden = false;
    this.patrol = [];
    this.patrolIdx = 0;
    this.vel = new THREE.Vector3();
    this.radius = 0.45; this.height = 2.2; this.gravity = opts.gravity ?? -18;
    this.aggr = opts.aggression ?? 1;
    this.cullDist = opts.cullDist ?? ({ stalker: 85, crawler: 70, mimic: 90, wraith: 80 }[type] || 0);
    this.netPos = this.position.clone(); this.netYaw = this.yaw; this.hasNet = false;
    this.animSpeed = 0; this._prev = this.position.clone();
    this.t = Math.random() * 100;
    this.stateTime = 0;
    this.atkSeq = 0;
    this.target = null; this.targetId = null;
    this.lastKnown = this.position.clone(); this.lastSeen = -999;
    this.goal = this.position.clone();
    this.litTime = 0; this.attackCd = 0; this.percT = Math.random() * 0.2;
    this.stuckT = 0; this.sideT = 0; this.sideSign = 1; this.stuckCount = 0;
    this.loop = null; this.loopName = null; this._loopRetry = 0;
    this.disposed = false;
    this._warned = false;
    if (opts.patrol) this.setPatrol(opts.patrol);
    try { ctx.scene?.add(this.object); } catch (e) { /* ignore */ }
  }
  get isHost() { return this.ctx.isHost !== false; }

  setPatrol(points) {
    this.patrol = (points || []).filter(Boolean).map((p) => new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0));
    this.patrolIdx = 0;
  }
  setState(s) {
    if (s === this.state) return;
    const prev = this.state;
    this.state = s;
    this.stateTime = 0;
    try { this.onStateChange(prev, s); } catch (e) { this._warn(e); }
  }
  onStateChange() {}
  hearNoise() {}
  think() {}
  animate() {}
  _warn(e) { if (!this._warned) { this._warned = true; console.warn('[creatures]', this.type, e); } }

  update(dt) {
    if (this.disposed) return;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    this.t += dt; this.stateTime += dt;
    try { if (this.isHost) this.think(dt); else this.interpolate(dt); } catch (e) { this._warn(e); }
    if (dt > 0) {
      const dx = this.position.x - this._prev.x, dz = this.position.z - this._prev.z;
      const inst = Math.min(Math.sqrt(dx * dx + dz * dz) / dt, 12);
      this.animSpeed = damp(this.animSpeed, inst, 10, dt);
      this._prev.copy(this.position);
    }
    try { this.animate(dt); } catch (e) { this._warn(e); }
    this.object.rotation.y = this.yaw;
    // distance cull: far creatures are fogged out anyway, skip their draw calls
    if (this.cullDist > 0 && this.object.visible) {
      const cam = this.ctx.camera?.position;
      if (cam && cam.distanceToSquared(this.position) > this.cullDist * this.cullDist) this.object.visible = false;
    }
    this.updateAudio(dt);
  }

  // ---- networking ----
  getNetState() {
    const p = this.position;
    const a = [r2(p.x), r2(p.y), r2(p.z), r2(wrapAngle(this.yaw)), SIDX[this.state] ?? 0, this.hidden ? 1 : 0, this.atkSeq % 100];
    const ex = this.netExtra();
    if (ex) for (let i = 0; i < ex.length; i++) a.push(r2(ex[i]));
    return a;
  }
  netExtra() { return null; }
  setNetState(arr) {
    if (!Array.isArray(arr) || arr.length < 5 || this.isHost) return;
    this.netPos.set(+arr[0] || 0, +arr[1] || 0, +arr[2] || 0);
    this.netYaw = +arr[3] || 0;
    if (!this.hasNet) { this.position.copy(this.netPos); this.yaw = this.netYaw; this._prev.copy(this.position); this.hasNet = true; }
    this.hidden = arr[5] === 1;
    const seq = arr[6] | 0;
    if (seq !== this.atkSeq % 100) { this.atkSeq = seq; this.onAttackAnim?.(); }
    this.applyExtra?.(arr, 7);
    this.setState(STATES[arr[4] | 0] || 'idle');
  }
  interpolate(dt) {
    if (!this.hasNet) return;
    if (this.position.distanceToSquared(this.netPos) > 100) this.position.copy(this.netPos);
    else {
      this.position.x = damp(this.position.x, this.netPos.x, 9, dt);
      this.position.y = damp(this.position.y, this.netPos.y, 9, dt);
      this.position.z = damp(this.position.z, this.netPos.z, 9, dt);
    }
    this.yaw = dampAngle(this.yaw, this.netYaw, 10, dt);
  }

  // ---- audio ----
  startLoop(name, volume = 0.6) { this.loopName = name; this.loopVol = volume; this._tryLoop(); }
  _tryLoop() {
    if (this.loop || !this.loopName) return;
    try {
      const h = this.ctx.audio?.loop?.(this.loopName, { position: this.position, volume: this.loopVol }) || null;
      // audio not initialised yet -> module hands back an inert singleton; retry later
      if (h && typeof h.setPosition === 'function' && String(h.setPosition).replace(/\s/g, '').length <= 16) { this.loop = null; return; }
      this.loop = h;
    } catch (e) { this.loop = null; }
  }
  loopVolume() { return this.hidden ? 0 : this.loopVol; }
  updateAudio(dt) {
    if (!this.loopName) return;
    if (!this.loop) { this._loopRetry -= dt; if (this._loopRetry <= 0) { this._loopRetry = 2; this._tryLoop(); } return; }
    try { this.loop.setPosition?.(this.position); this.loop.setVolume?.(this.loopVolume()); } catch (e) { /* ignore */ }
  }
  play(name, volume = 1, pitch = 1, pos = this.position) {
    try { this.ctx.audio?.play?.(name, { position: pos, volume, pitch }); } catch (e) { /* ignore */ }
  }
  localDist() {
    const lp = localPlayer(this.ctx);
    return lp?.position ? lp.position.distanceTo(this.position) : Infinity;
  }

  // ---- movement (host) ----
  physics(dt) {
    const w = this.ctx.world;
    let ok = false;
    if (w && typeof w.moveCapsule === 'function') {
      try { const r = w.moveCapsule(this.position, this.vel, this.radius, this.height, dt, this.gravity); this.onGround = !!(r && r.onGround); ok = true; } catch (e) { ok = false; }
    }
    if (!ok) {
      this.position.x += this.vel.x * dt; this.position.z += this.vel.z * dt;
      let gy = -Infinity;
      try { gy = w?.groundHeight?.(this.position.x, this.position.z, this.position.y + 1.5) ?? -Infinity; } catch (e) { gy = -Infinity; }
      if (Number.isFinite(gy)) this.position.y = gy;
    }
    if (!Number.isFinite(this.position.x) || !Number.isFinite(this.position.y) || this.position.y < (w?.killY ?? -60)) {
      this.position.copy(this.patrol[0] || this.home); this.vel.set(0, 0, 0);
    }
  }
  // steer toward (tx,tz); returns horizontal distance
  moveToward(tx, tz, speed, dt, turnRate = 7) {
    const dx = tx - this.position.x, dz = tz - this.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    let dirx = 0, dirz = 0;
    if (d > 0.05) { dirx = dx / d; dirz = dz / d; }
    if (this.sideT > 0) {
      this.sideT -= dt;
      const c = Math.cos(1.25 * this.sideSign), s = Math.sin(1.25 * this.sideSign);
      const nx = dirx * c - dirz * s, nz = dirx * s + dirz * c; dirx = nx; dirz = nz;
    }
    if (d > 0.05) this.yaw = dampAngle(this.yaw, yawTo(dirx, dirz), turnRate, dt);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const align = clamp(fx * dirx + fz * dirz, 0.25, 1);
    const sp = d > 0.05 ? speed * align : 0;
    this.vel.x = damp(this.vel.x, dirx * sp, 7, dt);
    this.vel.z = damp(this.vel.z, dirz * sp, 7, dt);
    const px = this.position.x, pz = this.position.z;
    this.physics(dt);
    // stuck detection
    if (sp > 0.6 && dt > 0) {
      const moved = Math.hypot(this.position.x - px, this.position.z - pz) / dt;
      if (moved < sp * 0.25) { this.stuckT += dt; if (this.stuckT > 0.5) { this.stuckT = 0; this.sideT = 0.9; this.sideSign = Math.random() < 0.5 ? -1 : 1; this.stuckCount++; } }
      else { this.stuckT = Math.max(0, this.stuckT - dt); }
    }
    return d;
  }
  stop(dt) {
    this.vel.x = damp(this.vel.x, 0, 8, dt); this.vel.z = damp(this.vel.z, 0, 8, dt);
    this.physics(dt);
  }
  nextPatrolPoint(out) {
    if (this.patrol.length) {
      this.patrolIdx = (this.patrolIdx + 1 + (Math.random() < 0.25 ? 1 : 0)) % this.patrol.length;
      return out.copy(this.patrol[this.patrolIdx]);
    }
    const a = Math.random() * Math.PI * 2, r = rand(3, 9);
    return out.set(this.home.x + Math.cos(a) * r, this.home.y, this.home.z + Math.sin(a) * r);
  }

  // nearest valid player within range (optionally requiring sight: fov degrees, close range auto-detect)
  findVisible(range, fovDeg, closeRange, eyeH) {
    const players = this.ctx.players;
    if (!players) return null;
    let best = null, bestD = Infinity;
    _a.set(this.position.x, this.position.y + eyeH, this.position.z);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), cosHalf = Math.cos(fovDeg * 0.5 * DEG);
    for (const p of players.values()) {
      if (!validTarget(p)) continue;
      const dx = p.position.x - this.position.x, dz = p.position.z - this.position.z, dy = p.position.y - this.position.y;
      const d = Math.sqrt(dx * dx + dz * dz + dy * dy * 0.5);
      let r = range;
      if (p.flashlight) r *= 1.15;
      if (p.crouching && !p.flashlight) r *= 0.6;
      if (d > r || d >= bestD) continue;
      if (d > closeRange && (dx * fx + dz * fz) / Math.max(d, 1e-4) < cosHalf) continue;
      _b.set(p.position.x, p.position.y + 1.2, p.position.z);
      if (!los(this.ctx, _a, _b)) continue;
      best = p; bestD = d;
    }
    return best;
  }
  nearestPlayer(maxDist = Infinity) {
    const players = this.ctx.players;
    if (!players) return null;
    let best = null, bestD = maxDist;
    for (const p of players.values()) {
      if (!validTarget(p)) continue;
      const d = p.position.distanceTo(this.position);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }
  litByAny(pt, maxDist = 16) {
    const players = this.ctx.players;
    if (!players) return null;
    for (const p of players.values()) if (isLit(this.ctx, p, pt, maxDist)) return p;
    return null;
  }
  hitPlayer(p, dmg) {
    if (!p) return;
    try { this.ctx.damagePlayer?.(p.id, dmg, this.position.clone()); } catch (e) { this._warn(e); }
    if (p.id === this.ctx.localId) { try { this.ctx.fx?.shake?.(0.7, 0.35); } catch (e) { /* ignore */ } }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { this.loop?.stop?.(0.4); } catch (e) { /* ignore */ }
    this.loop = null; this.loopName = null;
    try { this.object.parent?.remove(this.object); } catch (e) { /* ignore */ }
    try { this.disposeOwn?.(); } catch (e) { /* ignore */ }
    releaseShared(this.type);
  }
}

// ---------- generic walking hunter AI (stalker / crawler) ----------
// P: {walk, invest, chase, sight, fov, close, hearR, atkRange, atkHit, dmg, atkCd, atkDur, litNeed, stunDur, fleeDur, loseT, eyeH, chestH}
export class WalkerAI extends CreatureBase {
  initAI(P) {
    this.P = P;
    this.fleeFrom = new THREE.Vector3();
    this.idleFor = rand(1, 3);
    this.hitDone = false;
    this.screechT = -99;
    this.setState(this.patrol.length ? 'patrol' : 'idle');
    this.nextPatrolPoint(this.goal);
  }
  hearNoise(pos, loudness = 0.5) {
    if (!this.isHost || this.hidden || !pos) return;
    if (this.state === 'chase' || this.state === 'attack' || this.state === 'stunned' || this.state === 'flee') return;
    const d = this.position.distanceTo(pos);
    if (d > (loudness || 0) * this.P.hearR * this.aggr) return;
    this.goal.set(pos.x, pos.y || 0, pos.z);
    if (this.state !== 'investigate') this.setState('investigate'); else this.stateTime = 0;
  }
  think(dt) {
    const P = this.P;
    this.attackCd -= dt;
    // flashlight
    _a.set(this.position.x, this.position.y + P.chestH, this.position.z);
    const litP = (this.state === 'stunned' || this.state === 'flee') ? null : this.litByAny(_a);
    if (litP) {
      this.litTime += dt;
      if (this.litTime >= P.litNeed) {
        this.litTime = 0; this.fleeFrom.copy(litP.position);
        this.setState(P.stunDur > 0 ? 'stunned' : 'flee');
      }
    } else this.litTime = Math.max(0, this.litTime - dt * 0.5);

    // perception @5Hz
    this.percT -= dt;
    if (this.percT <= 0 && this.state !== 'stunned' && this.state !== 'flee') {
      this.percT = 0.2;
      const seen = this.findVisible(P.sight * (0.75 + 0.25 * this.aggr), P.fov, P.close, P.eyeH);
      if (seen) {
        this.target = seen; this.lastKnown.copy(seen.position); this.lastSeen = this.t;
        if (this.state !== 'chase' && this.state !== 'attack') this.setState('chase');
      } else if (this.state !== 'chase' && this.state !== 'attack') {
        for (const p of this.ctx.players?.values?.() || []) {
          if (!validTarget(p)) continue;
          const n = p.noise || 0;
          if (n > 0.03 && p.position.distanceTo(this.position) <= n * P.hearR * this.aggr) { this.hearNoise(p.position, 1); this.goal.copy(p.position); break; }
        }
      }
    }

    switch (this.state) {
      case 'idle':
        this.stop(dt);
        if (this.stateTime > this.idleFor) { this.nextPatrolPoint(this.goal); this.setState('patrol'); }
        break;
      case 'patrol': {
        const d = this.moveToward(this.goal.x, this.goal.z, P.walk, dt, 4);
        if (d < 0.9 || this.stuckCount > 4 || this.stateTime > 25) { this.stuckCount = 0; this.idleFor = rand(0.8, 3.5); this.setState('idle'); }
        break;
      }
      case 'investigate': {
        const d = this.moveToward(this.goal.x, this.goal.z, P.invest, dt, 6);
        if (d < 1.0 || this.stuckCount > 5 || this.stateTime > 14) { this.stuckCount = 0; this.idleFor = rand(2, 4); this.setState('idle'); }
        break;
      }
      case 'chase': {
        const tgt = this.target;
        if (!validTarget(tgt) || this.t - this.lastSeen > P.loseT * this.aggr) {
          this.goal.copy(this.lastKnown); this.target = null; this.setState('investigate'); break;
        }
        const recent = this.t - this.lastSeen < 1.2;
        const gx = recent ? tgt.position.x : this.lastKnown.x, gz = recent ? tgt.position.z : this.lastKnown.z;
        const d = this.moveToward(gx, gz, P.chase, dt, 9);
        if (recent && d <= P.atkRange && this.attackCd <= 0) { this.hitDone = false; this.atkSeq++; this.setState('attack'); }
        break;
      }
      case 'attack': {
        const tgt = this.target;
        if (validTarget(tgt)) this.yaw = dampAngle(this.yaw, yawTo(tgt.position.x - this.position.x, tgt.position.z - this.position.z), 12, dt);
        const lunge = this.stateTime < P.atkDur * 0.5 ? P.chase * 0.9 : 0;
        this.vel.x = damp(this.vel.x, -Math.sin(this.yaw) * lunge, 10, dt);
        this.vel.z = damp(this.vel.z, -Math.cos(this.yaw) * lunge, 10, dt);
        this.physics(dt);
        if (!this.hitDone && this.stateTime >= P.atkHit) {
          this.hitDone = true; this.attackCd = P.atkCd;
          if (validTarget(tgt) && tgt.position.distanceTo(this.position) <= P.atkRange + 0.7) this.hitPlayer(tgt, P.dmg);
        }
        if (this.stateTime >= P.atkDur) this.setState(validTarget(tgt) ? 'chase' : 'idle');
        break;
      }
      case 'stunned':
        this.stop(dt);
        if (this.stateTime >= P.stunDur) this.setState('flee');
        break;
      case 'flee': {
        const dx = this.position.x - this.fleeFrom.x, dz = this.position.z - this.fleeFrom.z;
        const d = Math.max(Math.hypot(dx, dz), 0.01);
        this.moveToward(this.position.x + dx / d * 6, this.position.z + dz / d * 6, P.chase * 0.95, dt, 10);
        if (this.stateTime >= P.fleeDur) { this.target = null; this.nextPatrolPoint(this.goal); this.setState('patrol'); }
        break;
      }
      default: this.setState('idle');
    }
  }
}
