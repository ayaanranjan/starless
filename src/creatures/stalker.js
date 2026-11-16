// Stalker (Ch.I): 2.7m eyeless, emaciated, digitigrade, long-armed. Hunts by sound, recoils from light.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WalkerAI, acquireShared, limbGeo, mesh, group, damp, clamp, rand, localPlayer, yawTo, wrapAngle, wetSkin, eyeShine, clawMat } from './common.js';

function buildShared() {
  // wet, translucent-looking grey-brown hide with cold fresnel rim; glowing bioluminescent nodules flare under the beam
  const skin = wetSkin({ color: 0x1d100e, roughness: 0.6, metalness: 0.0, clearcoat: 0.4, clearcoatRoughness: 0.3,
    sheen: 0.4, sheenColor: new THREE.Color(0x4a1a1e), rim: 0x8a5a58, rimStrength: 0.32, rimPower: 3.6, scale: 14, mottle: 0.65 }); // fleshy, not chrome
  const glow = eyeShine(new THREE.MeshStandardMaterial({ color: 0x0a1612, emissive: 0x47ffd0, emissiveIntensity: 1.2, roughness: 0.25 }), 2.5);
  const maw = new THREE.MeshBasicMaterial({ color: 0x3a0505 });
  const claw = clawMat(0x0a0807);
  // merged ribcage + spine ridge (one draw call): ribs arc around the front of the chest, vertebrae down the back
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const y = -0.13 + i * 0.085, f = Math.sqrt(1 - (y / 0.312) ** 2);
    const g = new THREE.TorusGeometry(1, 0.055, 4, 14, Math.PI);
    g.rotateX(-Math.PI / 2); g.scale(0.252 * f * 1.07, 0.26, 0.173 * f * 1.16); g.rotateX(-0.22); g.translate(0, y, 0);
    parts.push(g);
  }
  for (let i = 0; i < 7; i++) {
    const y = -0.24 + i * 0.075, f = Math.sqrt(Math.max(0.05, 1 - (y / 0.312) ** 2));
    const g = new THREE.SphereGeometry(0.03 - i * 0.0015, 6, 4); g.scale(1.3, 0.8, 1); g.translate(0, y, 0.173 * f + 0.004);
    parts.push(g);
  }
  const ribcage = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  parts.forEach((g) => g.dispose());
  const chest = new THREE.SphereGeometry(0.24, 12, 10);
  const abdomen = new THREE.CylinderGeometry(0.11, 0.14, 0.52, 8, 3); abdomen.translate(0, 0.26, 0);
  return {
    skin, glow, maw, claw, ribcage, chest, abdomen,
    pelvis: new THREE.SphereGeometry(0.16, 10, 8),
    neck: (() => { const g = new THREE.CylinderGeometry(0.045, 0.06, 0.22, 7); g.translate(0, 0.11, 0); return g; })(),
    skull: new THREE.SphereGeometry(0.13, 12, 10),
    slit: new THREE.BoxGeometry(0.03, 0.2, 0.03),
    flap: new THREE.BoxGeometry(0.05, 0.22, 0.035),
    upper: limbGeo(0.055, 0.04, 0.75), fore: limbGeo(0.042, 0.028, 0.72), hand: limbGeo(0.035, 0.022, 0.17),
    finger: limbGeo(0.013, 0.004, 0.32, 5),
    thigh: limbGeo(0.09, 0.06, 0.55), shin: limbGeo(0.06, 0.04, 0.6), meta: limbGeo(0.045, 0.03, 0.46), toe: limbGeo(0.032, 0.01, 0.2, 5),
    nodule: new THREE.SphereGeometry(0.024, 6, 5),
  };
}

const _v = new THREE.Vector3();

export class Stalker extends WalkerAI {
  constructor(ctx, opts) {
    super('stalker', ctx, opts);
    this.radius = 0.45; this.height = 2.4;
    const chase = opts.speed ?? 4.6, k = chase / 4.6;
    this.initAI({ walk: 1.5 * k, invest: 2.7 * k, chase, sight: 18, fov: 110, close: 5, hearR: 22, atkRange: 1.7, atkHit: 0.28, atkDur: 0.62,
      dmg: opts.damage ?? 25, atkCd: 1.4, litNeed: 1.2, stunDur: 2.5, fleeDur: 4, loseT: 6, eyeH: 2.3, chestH: 1.85 });
    const S = this.S = acquireShared('stalker', buildShared);
    this.build(S);
    this.phase = Math.random() * 6; this.limp = rand(0.75, 0.9);
    this.hunch = 0.2; this.mouth = 0; this.mouthT = 0; this.lungeT = 9;
    this.jerkT = 0; this.jerk = new THREE.Vector3(); this.headAim = new THREE.Vector2();
    this.clickT = rand(1, 4); this.clickQ = 0; this.clickGap = 0; this.hitchT = rand(2, 6); this.hitch = 0;
    this.startLoop('creature_breath', 0.55);
  }
  build(S) {
    const root = this.rig = group(this.object);
    const hips = this.hips = group(root, 0, 1.34, 0);
    mesh(S.pelvis, S.skin, hips).scale.set(1.1, 0.8, 0.8);
    const torso = this.torso = group(hips);
    const abdM = mesh(S.abdomen, S.skin, torso); abdM.scale.set(1, 1, 0.75); abdM.castShadow = true;
    const chestG = this.chestG = group(torso, 0, 0.5, 0);
    this.chestM = mesh(S.chest, S.skin, chestG, 0, 0.26, 0); this.chestM.scale.set(1.05, 1.3, 0.72); this.chestM.castShadow = true;
    mesh(S.ribcage, S.skin, chestG, 0, 0.26, 0);
    for (let i = 0; i < 4; i++) mesh(S.nodule, S.glow, chestG, (i % 2 ? 0.05 : -0.05), 0.08 + i * 0.13, 0.17 - i * 0.004);
    mesh(S.nodule, S.glow, torso, 0.03, 0.22, 0.1); mesh(S.nodule, S.glow, torso, -0.04, 0.38, 0.1);
    const neck = this.neck = group(chestG, 0, 0.5, -0.04);
    mesh(S.neck, S.skin, neck).rotation.x = -0.25;
    const head = this.head = group(neck, 0, 0.21, -0.04);
    const skull = mesh(S.skull, S.skin, head, 0, 0.08, 0); skull.scale.set(0.82, 1.3, 1.0); skull.castShadow = true;
    this.slit = mesh(S.slit, S.maw, head, 0, 0.04, -0.118); this.slit.scale.x = 0.3;
    this.flapL = mesh(S.flap, S.skin, head, -0.022, 0.04, -0.11);
    this.flapR = mesh(S.flap, S.skin, head, 0.022, 0.04, -0.11);
    this.arms = [-1, 1].map((side) => {
      const sh = group(chestG, 0.27 * side, 0.42, 0);
      mesh(S.upper, S.skin, sh);
      const el = group(sh, 0, -0.75, 0); mesh(S.fore, S.skin, el);
      if (side > 0) mesh(S.nodule, S.glow, el, 0.03, -0.3, 0.02);
      const wr = group(el, 0, -0.72, 0); mesh(S.hand, S.skin, wr);
      const fingers = [-1, 0, 1].map((f) => { const fg = group(wr, f * 0.018, -0.16, 0); mesh(S.finger, S.claw, fg); fg.rotation.z = f * 0.12; return fg; });
      return { sh, el, wr, fingers, side };
    });
    this.legs = [-1, 1].map((side) => {
      const hip = group(hips, 0.15 * side, 0, 0); mesh(S.thigh, S.skin, hip);
      const kn = group(hip, 0, -0.55, 0); mesh(S.shin, S.skin, kn);
      const an = group(kn, 0, -0.6, 0); mesh(S.meta, S.skin, an);
      const to = group(an, 0, -0.46, 0); mesh(S.toe, S.claw, to);
      return { hip, kn, an, to, side };
    });
  }
  loopVolume() { return this.hidden ? 0 : (this.state === 'chase' || this.state === 'attack' ? 1.0 : 0.5); }
  onStateChange(prev, next) {
    if (next === 'chase' && prev !== 'attack') {
      if (this.t - this.screechT > 6) {
        this.screechT = this.t; this.mouthT = 1.3;
        this.play('screech', 1, rand(0.85, 1.05));
        if (this.localDist() < 14) { try { this.ctx.audio?.stinger?.(); } catch (e) { /* ignore */ } }
      }
      this.clickT = Math.min(this.clickT, 0.3);
    } else if (next === 'stunned') {
      this.mouthT = 1.6; this.play('screech', 0.9, rand(1.15, 1.35));
    } else if (next === 'attack') {
      this.onAttackAnim();
    }
  }
  onAttackAnim() { this.lungeT = 0; this.mouthT = Math.max(this.mouthT, 0.5); }

  animate(dt) {
    const t = this.t, st = this.state, spd = this.animSpeed;
    const S = this.S;
    S.glow.emissiveIntensity = 0.9 + 0.5 * Math.sin(t * 1.7) + (st === 'chase' ? 0.6 : 0);
    // clicks
    this.clickT -= dt;
    if (this.clickT <= 0 && !this.hidden) {
      const hunting = st === 'chase' || st === 'investigate' || st === 'attack';
      this.clickT = hunting ? rand(0.7, 1.8) : rand(3, 8); this.clickQ = (2 + Math.random() * 4) | 0; this.clickGap = 0;
    }
    if (this.clickQ > 0) { this.clickGap -= dt; if (this.clickGap <= 0) { this.clickQ--; this.clickGap = rand(0.06, 0.13); this.play('click', 0.75, rand(0.75, 1.3)); this.jerkT = 0; } }

    // posture targets
    let hunchT = 0.25, armF = 0.12, armSpread = 0.06, elbow = 0.18;
    if (st === 'chase' || st === 'attack') { hunchT = 1; armF = 0.95; elbow = 0.35; armSpread = 0.22; }
    else if (st === 'investigate') { hunchT = 0.55; armF = 0.35; }
    else if (st === 'flee') { hunchT = 0.8; armF = 0.5; }
    else if (st === 'stunned') { hunchT = -0.7; }
    this.hunch = damp(this.hunch, hunchT, 4, dt);

    // gait with limp + hitch
    this.hitchT -= dt;
    if (this.hitchT <= 0) { this.hitchT = rand(1.5, 5); this.hitch = 0.22; }
    this.hitch = Math.max(0, this.hitch - dt);
    const stride = clamp(spd / 3, 0, 1.25);
    if (this.hitch <= 0) this.phase += spd * 3.4 * dt + (spd < 0.1 ? 0 : 0.6 * dt);
    const ph = this.phase;
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i];
      const p = ph + (i ? Math.PI * this.limp : 0);
      const amp = (i ? 0.8 : 1) * stride;
      const s = Math.sin(p), c = Math.cos(p), lift = Math.max(0, c);
      L.hip.rotation.x = 0.45 + 0.5 * s * amp + this.hunch * 0.25;
      L.hip.rotation.z = L.side * (0.05 + 0.04 * amp);
      L.kn.rotation.x = -1.15 - 0.65 * lift * amp - this.hunch * 0.2;
      L.an.rotation.x = 0.95 + 0.4 * lift * amp - 0.15 * s * amp;
      L.to.rotation.x = 1.3 - 0.4 * s * amp;
    }
    const bob = Math.abs(Math.sin(ph)) * 0.07 * stride;
    this.hips.position.y = 1.31 - 0.08 * Math.max(0, this.hunch) + bob - (this.hitch > 0 ? 0.06 : 0);
    this.hips.rotation.z = Math.sin(ph) * 0.07 * stride + Math.sin(t * 0.55) * 0.035;
    this.hips.rotation.y = Math.sin(ph) * 0.12 * stride;

    // torso
    const breath = Math.sin(t * (st === 'chase' ? 5 : 1.6));
    this.torso.rotation.x = -(0.15 + this.hunch * 0.5) + (st === 'stunned' ? Math.sin(t * 40) * 0.03 : 0);
    this.torso.rotation.z = Math.sin(t * 0.7) * 0.05 - this.hips.rotation.z * 0.6;
    this.chestG.rotation.x = -0.12 - this.hunch * 0.22 + breath * 0.025;
    this.chestM.scale.y = 1.3 + breath * 0.03;

    // lunge
    this.lungeT += dt;
    const lp = this.lungeT < 0.6 ? this.lungeT / 0.6 : 1;
    const lunge = lp < 1 ? Math.sin(lp * Math.PI) : 0;
    this.rig.position.z = -0.45 * lunge;
    this.torso.rotation.x -= 0.45 * lunge;

    // arms
    for (let i = 0; i < 2; i++) {
      const A = this.arms[i], side = A.side;
      const sw = Math.sin(ph + (i ? 0 : Math.PI)) * 0.35 * stride;
      let shx = armF + sw * (st === 'chase' ? 0.5 : 1), shz = side * armSpread, elx = elbow + Math.max(0, sw) * 0.3;
      if (st === 'stunned') { shx = 1.25 + Math.sin(t * 31 + i) * 0.07; shz = -side * 0.38; elx = 2.05 + Math.sin(t * 27 + i * 2) * 0.06; }
      if (lp < 1) { shx = lp < 0.35 ? 2.3 : 2.3 - (lp - 0.35) / 0.65 * 1.9; elx = 0.2; shz = -side * 0.15; }
      A.sh.rotation.x = damp(A.sh.rotation.x, shx, st === 'stunned' || lp < 1 ? 18 : 6, dt);
      A.sh.rotation.z = damp(A.sh.rotation.z, shz + Math.sin(t * 0.9 + i * 2) * 0.03, 6, dt);
      A.el.rotation.x = damp(A.el.rotation.x, elx, 8, dt);
      A.wr.rotation.x = 0.15 + Math.sin(t * 1.3 + i) * 0.1;
      for (let f = 0; f < 3; f++) {
        const fg = A.fingers[f];
        fg.rotation.x = 0.25 + (st === 'chase' ? 0.35 : 0) + (Math.random() < 0.02 ? rand(-0.6, 0.6) : 0) * 1 + Math.sin(t * 3 + f * 1.7 + i) * 0.08;
      }
    }

    // head: twitchy tracking
    this.jerkT -= dt;
    const hunting = st === 'chase' || st === 'investigate';
    if (this.jerkT <= 0) {
      this.jerkT = hunting ? rand(0.25, 1.1) : rand(0.6, 2.6);
      const big = Math.random() < 0.18;
      this.jerk.set(rand(-0.3, 0.3), rand(-0.7, 0.7) * (big ? 1.6 : 1), rand(-0.6, 0.6) * (big ? 1.9 : 1));
    }
    let ay = this.jerk.y, ax = this.jerk.x, az = this.jerk.z;
    const tgt = this.isHost ? this.target : null;
    const track = (tgt && hunting) ? tgt : (hunting || st === 'attack' ? localPlayer(this.ctx) : null);
    if (track?.position) {
      _v.copy(track.position).sub(this.position);
      const rel = wrapAngle(yawTo(_v.x, _v.z) - this.yaw);
      if (Math.abs(rel) < 1.6) {
        ay = clamp(rel, -1.1, 1.1) + this.jerk.y * 0.25; az = this.jerk.z * 0.6;
        ax = Math.atan2(_v.y + 1.4 - 2.4, Math.hypot(_v.x, _v.z)) + this.jerk.x * 0.3;
      }
    }
    if (st === 'stunned') { ay = 0.6 * Math.sin(t * 2); ax = -0.7; az = 0.5; }
    const pitchComp = -this.torso.rotation.x - this.chestG.rotation.x;
    this.head.rotation.x = damp(this.head.rotation.x, ax + pitchComp * 0.85, 24, dt);
    this.head.rotation.y = damp(this.head.rotation.y, ay, 24, dt);
    this.head.rotation.z = damp(this.head.rotation.z, az, 24, dt);

    // mouth slit
    this.mouthT -= dt;
    const mOpen = this.mouthT > 0 ? 0.75 + 0.25 * Math.sin(t * 45) : 0;
    this.mouth = damp(this.mouth, mOpen, 18, dt);
    const m = this.mouth;
    this.flapL.position.x = -0.022 - m * 0.04; this.flapR.position.x = 0.022 + m * 0.04;
    this.flapL.rotation.y = m * 0.7; this.flapR.rotation.y = -m * 0.7;
    this.slit.scale.set(0.3 + m * 2.2, 1 + m * 0.35, 1);
    this.object.visible = !this.hidden;
  }
}
