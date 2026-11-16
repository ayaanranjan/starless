// Crawler (Ch.II): low, wide, eight spindly legs with planted feet (2-bone IK), mandibles, red eye cluster.
import * as THREE from 'three';
import { WalkerAI, acquireShared, mesh, group, damp, clamp, rand } from './common.js';

function buildShared() {
  const shell = new THREE.MeshStandardMaterial({ color: 0x15110f, roughness: 0.3, metalness: 0.15 });
  const leg = new THREE.MeshStandardMaterial({ color: 0x0e0b0a, roughness: 0.45, metalness: 0.1 });
  const eye = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1a0a, emissiveIntensity: 2.2, roughness: 0.2 });
  const seg = new THREE.CylinderGeometry(1, 1, 1, 6, 1); seg.translate(0, 0.5, 0); // unit bone along +Y
  const segThin = new THREE.CylinderGeometry(0.55, 1, 1, 5, 1); segThin.translate(0, 0.5, 0);
  const mand = new THREE.ConeGeometry(0.05, 0.38, 5); mand.rotateX(-Math.PI / 2); mand.translate(0, 0, -0.17);
  return { shell, leg, eye, seg, segThin, mand, body: new THREE.SphereGeometry(0.5, 14, 10), eyeG: new THREE.SphereGeometry(0.045, 6, 5) };
}

const UP = new THREE.Vector3(0, 1, 0);
const _h = new THREE.Vector3(), _f = new THREE.Vector3(), _k = new THREE.Vector3(), _u = new THREE.Vector3(), _s = new THREE.Vector3(), _bd = new THREE.Vector3(), _d = new THREE.Vector3();

const HIPS_Z = [-0.42, -0.14, 0.14, 0.42];
const REST_Z = [-1.05, -0.38, 0.3, 0.95];
const L1 = 0.78, L2 = 0.98;

export class Crawler extends WalkerAI {
  constructor(ctx, opts) {
    super('crawler', ctx, opts);
    this.radius = 0.6; this.height = 0.9;
    const chase = opts.speed ?? 5.4, k = chase / 5.4;
    this.initAI({ walk: 2.0 * k, invest: 3.4 * k, chase, sight: 16, fov: 150, close: 4, hearR: 18, atkRange: 1.5, atkHit: 0.18, atkDur: 0.45,
      dmg: opts.damage ?? 15, atkCd: 1.0, litNeed: 0.5, stunDur: 0, fleeDur: 3.2, loseT: 5, eyeH: 0.7, chestH: 0.6 });
    const S = this.S = acquireShared('crawler', buildShared);
    this.bodyH = 0.55; this.twitch = 0; this.twitchT = rand(0.5, 2); this.rear = 0; this.lungeT = 9;
    // body
    const body = this.body = group(this.object, 0, this.bodyH, 0);
    this.thorax = mesh(S.body, S.shell, body); this.thorax.scale.set(1.25, 0.55, 1.2);
    this.abd = [];
    for (let i = 0; i < 3; i++) {
      const a = group(i === 0 ? body : this.abd[i - 1], 0, i === 0 ? 0.05 : 0.02, i === 0 ? 0.5 : 0.36);
      const m = mesh(S.body, S.shell, a, 0, 0.02, 0.2); const s = 0.95 - i * 0.22; m.scale.set(s, s * 0.7, s * 0.85);
      this.abd.push(a);
    }
    const head = this.headG = group(body, 0, 0.04, -0.62);
    const hm = mesh(S.body, S.shell, head); hm.scale.set(0.6, 0.42, 0.55);
    this.mandL = mesh(S.mand, S.shell, head, -0.1, -0.08, -0.18);
    this.mandR = mesh(S.mand, S.shell, head, 0.1, -0.08, -0.18);
    const ep = [[-0.07, 0.1, -0.24], [0.07, 0.1, -0.24], [-0.14, 0.07, -0.19], [0.14, 0.07, -0.19], [-0.035, 0.15, -0.2], [0.035, 0.15, -0.2]];
    ep.forEach(([x, y, z], i) => { const e = mesh(S.eyeG, S.eye, head, x, y, z); if (i > 3) e.scale.setScalar(0.7); });
    // legs: meshes live in root space, solved each frame
    this.legs = [];
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1, j = i % 4;
      const femur = mesh(S.seg, S.leg, this.object); femur.scale.set(0.045, L1, 0.045);
      const tibia = mesh(S.segThin, S.leg, this.object); tibia.scale.set(0.035, L2, 0.035);
      const hip = new THREE.Vector3(side * 0.42, 0, HIPS_Z[j]);
      const rest = new THREE.Vector3(side * 1.18, 0, REST_Z[j]);
      const foot = new THREE.Vector3(); this._restWorld(rest, foot); foot.y = this.position.y;
      this.legs.push({ femur, tibia, hip, rest, foot, from: foot.clone(), to: foot.clone(), t: 1, group: (j + (side > 0 ? 1 : 0)) % 2 });
    }
    this.startLoop('creature_chitter', 0.55);
  }
  // re-plant all feet under the body after a teleport / network snap (otherwise legs stretch across the map)
  onTeleport() {
    if (!this.legs) return;
    for (const L of this.legs) {
      this._restWorld(L.rest, L.foot); L.foot.y = this.position.y;
      L.from.copy(L.foot); L.to.copy(L.foot); L.t = 1;
    }
  }
  _restWorld(rest, out) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return out.set(rest.x * c + rest.z * s + this.position.x, this.position.y, -rest.x * s + rest.z * c + this.position.z);
  }
  _toLocal(w, out) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw), dx = w.x - this.position.x, dz = w.z - this.position.z;
    return out.set(dx * c - dz * s, w.y - this.position.y, dx * s + dz * c);
  }
  loopVolume() { return this.hidden ? 0 : (this.state === 'chase' || this.state === 'attack' ? 1 : 0.45); }
  onStateChange(prev, next) {
    if (next === 'chase' && prev !== 'attack') { this.play('screech', 0.55, rand(1.6, 1.9)); this.twitch = 0.4; }
    if (next === 'flee') { this.rear = 1; this.play('screech', 0.6, rand(1.9, 2.2)); }
    if (next === 'attack') this.onAttackAnim();
  }
  onAttackAnim() { this.lungeT = 0; }
  animate(dt) {
    const t = this.t, st = this.state, spd = this.animSpeed;
    // twitch bursts
    this.twitchT -= dt;
    if (this.twitchT <= 0) { this.twitchT = st === 'chase' ? rand(0.3, 1) : rand(0.8, 3.5); this.twitch = rand(0.12, 0.35); }
    this.twitch = Math.max(0, this.twitch - dt);
    const tw = this.twitch > 0 ? 1 : 0;
    this.rear = Math.max(0, this.rear - dt * 0.8);
    this.lungeT += dt;
    const lunge = this.lungeT < 0.45 ? Math.sin(this.lungeT / 0.45 * Math.PI) : 0;
    const B = this.body;
    B.position.y = this.bodyH + Math.sin(t * 9) * 0.015 * clamp(spd, 0, 1) + this.rear * 0.35 + lunge * 0.12 + (tw ? rand(-0.02, 0.02) : 0);
    B.position.z = -lunge * 0.35;
    B.rotation.x = this.rear * 0.7 + lunge * 0.25 + (tw ? rand(-0.05, 0.05) : 0);
    B.rotation.z = Math.sin(t * 7.3) * 0.03 * clamp(spd, 0, 1) + (tw ? rand(-0.06, 0.06) : 0);
    for (let i = 0; i < 3; i++) {
      this.abd[i].rotation.y = Math.sin(t * 2.1 - i * 0.9) * 0.12 * (1 + spd * 0.15);
      this.abd[i].rotation.x = Math.sin(t * 1.3 - i) * 0.05 + (i === 0 ? 0.1 : 0.08);
    }
    this.headG.rotation.y = tw ? rand(-0.35, 0.35) : damp(this.headG.rotation.y, 0, 6, dt);
    const open = (st === 'chase' || st === 'attack' ? 0.35 : 0.08) + (tw ? 0.3 : 0) + lunge * 0.6 + Math.max(0, Math.sin(t * 23)) * 0.12;
    this.mandL.rotation.y = damp(this.mandL.rotation.y, open, 30, dt);
    this.mandR.rotation.y = damp(this.mandR.rotation.y, -open, 30, dt);
    this.S.eye.emissiveIntensity = 1.8 + Math.sin(t * 11) * 0.3 + (st === 'chase' ? 1 : 0);
    this.object.visible = !this.hidden;
    this.object.rotation.y = this.yaw;
    this.object.updateMatrix();
    this._solveLegs(dt, spd);
  }
  _solveLegs(dt, spd) {
    const thresh = 0.42 + spd * 0.06, stepDur = clamp(0.2 - spd * 0.015, 0.09, 0.2);
    let stepping0 = 0, stepping1 = 0;
    for (const L of this.legs) if (L.t < 1) { if (L.group) stepping1++; else stepping0++; }
    const vx = this.vel.x, vz = this.vel.z;
    for (let i = 0; i < 8; i++) {
      const L = this.legs[i];
      this._restWorld(L.rest, _d);
      if (L.t >= 1) {
        const dx = _d.x - L.foot.x, dz = _d.z - L.foot.z, far = dx * dx + dz * dz;
        const otherBusy = L.group ? stepping0 : stepping1;
        if ((far > thresh * thresh && !otherBusy) || far > 4) {
          L.from.copy(L.foot);
          const lead = this.isHost ? 0.12 : 0.1;
          L.to.set(_d.x + (this.isHost ? vx : dx * 2) * lead, this.position.y, _d.z + (this.isHost ? vz : dz * 2) * lead);
          try { const gy = this.ctx.world?.groundHeight?.(L.to.x, L.to.z, this.position.y + 1); if (Number.isFinite(gy) && Math.abs(gy - this.position.y) < 1.2) L.to.y = gy; } catch (e) { /* ignore */ }
          L.t = 0; if (L.group) stepping1++; else stepping0++;
        }
      }
      if (L.t < 1) {
        L.t = Math.min(1, L.t + dt / stepDur);
        L.foot.lerpVectors(L.from, L.to, L.t);
        L.foot.y += Math.sin(L.t * Math.PI) * 0.28;
      }
      // IK in root-local space
      _h.copy(L.hip);
      _h.y = this.body.position.y - 0.02; _h.z += this.body.position.z;
      this._toLocal(L.foot, _f);
      _u.subVectors(_f, _h);
      let d = _u.length();
      d = clamp(d, 0.25, L1 + L2 - 0.02);
      _u.normalize();
      const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
      _s.crossVectors(_u, UP); if (_s.lengthSq() < 1e-6) _s.set(1, 0, 0); _s.normalize();
      _bd.crossVectors(_s, _u).normalize();
      if (_bd.y < 0) _bd.negate();
      _k.copy(_h).addScaledVector(_u, Math.cos(a) * L1).addScaledVector(_bd, Math.sin(a) * L1);
      _f.copy(_h).addScaledVector(_u, d);
      L.femur.position.copy(_h);
      _d.subVectors(_k, _h).normalize(); L.femur.quaternion.setFromUnitVectors(UP, _d);
      L.tibia.position.copy(_k);
      const tl = _d.subVectors(_f, _k).length(); _d.multiplyScalar(1 / Math.max(tl, 1e-4));
      L.tibia.quaternion.setFromUnitVectors(UP, _d); L.tibia.scale.y = tl;
    }
  }
}
