// Mimic (Ch.II): featureless astronaut silhouette. Stands still, watches, dissolves when lit/approached, rushes when you look away.
import * as THREE from 'three';
import { CreatureBase, acquireShared, mesh, group, damp, dampAngle, clamp, rand, fogShaderMaterial, GLSL_NOISE, validTarget, isLit, lookAngle, los, playerEye, yawTo, wrapAngle } from './common.js';

function buildShared() {
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 3, 8);
  const visor = new THREE.SphereGeometry(0.205, 14, 8, Math.PI * 1.15, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.32);
  return { helmet: new THREE.SphereGeometry(0.2, 14, 10), visor, torso: cap(0.21, 0.3), pack: new THREE.BoxGeometry(0.38, 0.5, 0.18),
    limb: cap(0.075, 0.3), leg: cap(0.09, 0.34), boot: new THREE.BoxGeometry(0.16, 0.12, 0.28) };
}
const VERT = `
varying vec3 vLocal; varying vec3 vN; varying vec3 vV;
void main(){
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = `
uniform float uTime; uniform float uDissolve; uniform vec3 uEdge;
varying vec3 vLocal; varying vec3 vN; varying vec3 vV;
${GLSL_NOISE}
void main(){
  float n = n3(vLocal * 9.0 + vec3(0.0, uTime * 0.8, 0.0)) * 0.65 + n3(vLocal * 23.0 - uTime) * 0.35;
  if (n < uDissolve) discard;
  float edge = (1.0 - smoothstep(0.0, 0.07, n - uDissolve)) * step(0.01, uDissolve);
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
  vec3 col = vec3(0.008, 0.009, 0.012) + rim * vec3(0.03, 0.04, 0.05) + edge * uEdge;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

const _p = new THREE.Vector3(), _q = new THREE.Vector3();

export class Mimic extends CreatureBase {
  constructor(ctx, opts) {
    super('mimic', ctx, opts);
    this.radius = 0.35; this.height = 1.8;
    this.sprint = opts.speed ?? 7; this.dmg = opts.damage ?? 20;
    const S = this.S = acquireShared('mimic', buildShared);
    this.mat = fogShaderMaterial({ uniforms: { uTime: { value: 0 }, uDissolve: { value: 0 }, uEdge: { value: new THREE.Color(0x9fd8ff).multiplyScalar(1.6) } }, vertex: VERT, fragment: FRAG });
    this.visorMat = new THREE.MeshBasicMaterial({ color: 0x5f93a6, transparent: true, opacity: 0.3, depthWrite: false });
    const m = this.mat;
    const hips = this.hips = group(this.object, 0, 0.98, 0);
    const torso = this.torso = group(hips);
    mesh(S.torso, m, torso, 0, 0.36, 0).scale.set(1, 1, 0.78);
    mesh(S.pack, m, torso, 0, 0.42, 0.22);
    const head = this.head = group(torso, 0, 0.78, 0);
    mesh(S.helmet, m, head, 0, 0.1, 0);
    this.visor = mesh(S.visor, this.visorMat, head, 0, 0.1, 0);
    this.arms = [-1, 1].map((side) => {
      const sh = group(torso, 0.29 * side, 0.6, 0); mesh(S.limb, m, sh, 0, -0.2, 0);
      const el = group(sh, 0, -0.42, 0); mesh(S.limb, m, el, 0, -0.2, 0);
      sh.rotation.z = side * 0.12; return { sh, el, side };
    });
    this.legs = [-1, 1].map((side) => {
      const hp = group(hips, 0.12 * side, 0, 0); mesh(S.leg, m, hp, 0, -0.24, 0);
      const kn = group(hp, 0, -0.48, 0); mesh(S.leg, m, kn, 0, -0.22, 0); mesh(S.boot, m, kn, 0, -0.46, -0.04);
      return { hp, kn, side };
    });
    this.dissolve = 0; this.reappearT = 0; this.phase = 0; this.hitDone = false; this.rushCheck = 0;
    this.headYaw = 0; this.headPitch = 0; this.tiltT = rand(2, 6); this.tilt = 0; this.tickT = rand(2, 5);
    this.target = null;
    this.setState('idle');
  }
  netExtra() { return null; }
  onStateChange(prev, next) {
    if (next === 'flee') this.play('whisper', 0.9, rand(0.85, 1.1));
    if (next === 'chase') this.play('whisper', 1, 0.6);
    if (next === 'idle' && prev === 'flee') this.dissolve = 1;
  }
  hearNoise() {}
  vanish() {
    if (this.state === 'flee') return;
    this.hidden = true; this.reappearT = rand(5, 10); this.vel.set(0, 0, 0); this.setState('flee');
  }
  _relocate() {
    const pts = this.patrol.length ? this.patrol : [this.home];
    const players = this.ctx.players;
    let best = null, tries = 0;
    for (let k = 0; k < pts.length && tries < 12; k++) {
      const c = pts[(Math.random() * pts.length) | 0]; tries++;
      let ok = true;
      _p.set(c.x, c.y + 1.4, c.z);
      if (players) for (const p of players.values()) {
        if (!p?.position) continue;
        const d = p.position.distanceTo(c);
        if (d < 9) { ok = false; break; }
        if (d < 40 && lookAngle(p, _p) < 70 * Math.PI / 180 && los(this.ctx, playerEye(p, _q), _p)) { ok = false; break; }
      }
      if (ok) { best = c; break; }
    }
    if (!best) return false;
    this.position.copy(best); this.vel.set(0, 0, 0);
    const n = this.nearestPlayer(80);
    if (n) this.yaw = yawTo(n.position.x - best.x, n.position.z - best.z);
    return true;
  }
  think(dt) {
    _p.set(this.position.x, this.position.y + 1.3, this.position.z);
    switch (this.state) {
      case 'idle': {
        const near = this.stateTime < 0.8 ? null : this.nearestPlayer(Infinity);
        // when nobody is looking its way, it drifts closer (never seen moving)
        let creep = false;
        if (near && this.aggr >= 0.5 && near.position.distanceTo(this.position) > 9) {
          creep = true;
          for (const p of this.ctx.players.values()) { if (validTarget(p) && lookAngle(p, _p) < 1.35) { creep = false; break; } }
        }
        if (creep) this.moveToward(near.position.x, near.position.z, 0.8 * this.aggr, dt, 2);
        else { this.vel.x = 0; this.vel.z = 0; this.physics(dt); }
        if (this.stateTime < 0.8) break; // fading in
        this.target = near;
        if (this.litByAny(_p)) { this.vanish(); break; }
        if (near && near.position.distanceTo(this.position) < 6) { this.vanish(); break; }
        if (near) this.yaw = dampAngle(this.yaw, yawTo(near.position.x - this.position.x, near.position.z - this.position.z), 0.25, dt);
        this.rushCheck -= dt;
        if (near && this.rushCheck <= 0) {
          this.rushCheck = 0.25;
          const d = near.position.distanceTo(this.position);
          if (d < 14 && lookAngle(near, _p) > 100 * Math.PI / 180 && Math.random() < 0.05 * this.aggr) { this.hitDone = false; this.setState('chase'); }
        }
        break;
      }
      case 'chase': {
        const tgt = this.target;
        if (!validTarget(tgt) || this.stateTime > 3.5 || this.litByAny(_p)) { this.vanish(); break; }
        const d = this.moveToward(tgt.position.x, tgt.position.z, this.sprint, dt, 14);
        if (d < 1.35 && !this.hitDone) { this.hitDone = true; this.atkSeq++; this.hitPlayer(tgt, this.dmg); this.vanish(); }
        break;
      }
      case 'flee':
        this.vel.set(0, 0, 0);
        this.reappearT -= dt;
        if (this.reappearT <= 0 && this.stateTime > 1) {
          if (this._relocate()) { this.hidden = false; this.setState('idle'); } else this.reappearT = 1;
        }
        break;
      default: this.setState('idle');
    }
  }
  animate(dt) {
    const t = this.t, st = this.state;
    this.mat.uniforms.uTime.value = t;
    // dissolve: flicker out when hidden/fleeing, slow resolve when appearing
    const want = (this.hidden || st === 'flee') ? 1 : 0;
    if (want > this.dissolve) this.dissolve = Math.min(1, this.dissolve + dt * (1.2 + Math.random() * 1.5));
    else this.dissolve = Math.max(0, this.dissolve - dt * 0.6);
    const flick = this.dissolve > 0 && this.dissolve < 1 ? (Math.random() < 0.3 ? 0.25 : 0) : 0;
    this.mat.uniforms.uDissolve.value = clamp(this.dissolve + flick, 0, 1);
    this.object.visible = this.dissolve < 0.995;
    this.visorMat.opacity = (0.22 + 0.1 * Math.sin(t * 2.3) + (Math.random() < 0.03 ? 0.25 : 0)) * (1 - this.dissolve);
    // head tracks nearest player slowly; an occasional too-fast snap
    const n = this.target && this.target.position ? this.target : this.nearestPlayer(60);
    let hy = 0, hx = 0;
    if (n) {
      _q.copy(n.position).sub(this.position);
      hy = clamp(wrapAngle(yawTo(_q.x, _q.z) - this.yaw), -1.3, 1.3);
      hx = Math.atan2(_q.y, Math.hypot(_q.x, _q.z));
    }
    this.tiltT -= dt;
    if (this.tiltT <= 0) { this.tiltT = rand(3, 8); this.tilt = Math.random() < 0.5 ? 0 : rand(-0.45, 0.45); }
    const rate = st === 'chase' ? 20 : 0.9;
    this.headYaw = damp(this.headYaw, hy, rate, dt); this.headPitch = damp(this.headPitch, hx, rate, dt);
    this.head.rotation.set(this.headPitch, this.headYaw, damp(this.head.rotation.z, st === 'chase' ? 0.5 : this.tilt, 0.6, dt));
    // body
    if (st === 'chase') {
      this.phase += dt * 15;
      const s = Math.sin(this.phase);
      this.torso.rotation.x = -0.45 + Math.sin(t * 30) * 0.03;
      for (const L of this.legs) { const k = L.side; L.hp.rotation.x = 0.4 + s * 0.95 * k; L.kn.rotation.x = -0.6 - Math.max(0, -s * k) * 1.2; }
      for (const A of this.arms) { A.sh.rotation.x = 0.4 - Math.sin(this.phase) * 1.3 * A.side; A.el.rotation.x = 1.1; }
      this.hips.position.y = 0.92 + Math.abs(s) * 0.07;
    } else {
      this.torso.rotation.x = damp(this.torso.rotation.x, 0, 3, dt);
      for (const L of this.legs) { L.hp.rotation.x = damp(L.hp.rotation.x, 0, 4, dt); L.kn.rotation.x = damp(L.kn.rotation.x, 0, 4, dt); }
      this.tickT -= dt;
      for (const A of this.arms) { A.sh.rotation.x = damp(A.sh.rotation.x, 0.02, 3, dt); A.el.rotation.x = damp(A.el.rotation.x, 0.08, 3, dt); }
      if (this.tickT <= 0) { this.tickT = rand(2.5, 7); const A = this.arms[(Math.random() * 2) | 0]; A.el.rotation.x = rand(0.3, 0.6); A.sh.rotation.x = rand(-0.1, 0.15); }
      this.hips.position.y = 0.98;
    }
  }
  disposeOwn() { this.mat.dispose(); this.visorMat.dispose(); }
}
