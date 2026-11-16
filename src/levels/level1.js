// CHAPTER I — THE DROWNING WORLD (planet VESPER). Owner: L1.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SITES, makeHeightfield, buildTerrain, buildSky, Particles, Spores, makeBolt } from './l1/env.js';
import {
  P, merged, glowSprite, buildLander, buildRocket, buildValve, buildBody, buildLogDevice, buildVent,
  buildPartModel, buildShuttle, buildAntenna, ribcageGeometries, spireGeometry,
} from './l1/props.js';

const PHASES = ['explore', 'install', 'launch1', 'valves', 'relaunch', 'launch2', 'done'];
const PI = (p) => PHASES.indexOf(p);
const FOG = 0x26321f;
const RUIZ = 'KESTREL — CMDR. RUIZ';

const PARTS = [
  { key: 'fuel', name: 'fuel cell', site: 'shuttle', off: [0.6, 2.6] },
  { key: 'thruster', name: 'thruster assembly', site: 'nest', off: [0, 0] },
  { key: 'nav', name: 'navigation core', site: 'ridge', off: [2.5, 1.5] },
  { key: 'coil', name: 'ignition coil', site: 'maze', off: [0, 0] },
];

const LOGS = [
  { x: -16, z: 42, body: 0, lines: [
    [RUIZ, 'Day nine. They don\'t see. They listen. Walk slow.', 4.5],
    [RUIZ, 'Light hurts them. Not enough to stop them. Not enough.', 4.5],
  ] },
  { x: 63, z: 30, body: 1, lines: [
    [RUIZ, 'Gant went to the vents for air. We heard him click... then nothing.', 5],
    [RUIZ, 'The cyan vents are the only air on this rock. They know that too.', 4.5],
  ] },
  { x: -15, z: -100, body: 2, lines: [
    [RUIZ, 'If you find this — the rocket works. It just needs coolant. Don\'t launch dry.', 5.5],
    [RUIZ, 'Fuel cell\'s in the shuttle wreck, west. Thruster\'s in the bone nest, east. Nav core on the antenna ridge. Coil... in the stone maze.', 7],
  ] },
];

const O2 = [[14, 52], [-58, 34], [60, 26], [-40, -30], [44, -24], [12, -92]];

const STALKER_ROUTES = [
  [[-88, 34], [-60, 2], [-74, -44], [-44, -20]],
  [[96, 44], [70, 8], [80, -38], [52, -12]],
  [[-30, 8], [28, -2], [22, -52], [-26, -62]],
  [[-32, -112], [30, -116], [22, -80], [-26, -82]],
];

export default class Level1 {
  static id = 'l1';
  static title = 'CHAPTER I';
  static subtitle = 'THE DROWNING WORLD';

  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'level1';
    this.loops = [];
    this.updates = [];
    this.creatures = [];
    this.stalkers = [];
    this.swarmSpawned = false;
    this.timeline = [];
    this.clock = 0;
    this.st = { ph: 'explore', parts: [0, 0, 0, 0], valves: [0, 0, 0] };
    this.lastObjective = '';
    this.flashAmt = 0;
    this.nextStrike = 6;
    this.tension = 0;
    this.tensionT = 0;
    this.noiseT = 0;
    this.logT = [-99, -99, -99];
    this.seqStart = 0;
    this.lights = [];
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._cam = new THREE.Vector3();
    this.disposed = false;
  }

  // ------------------------------------------------------------ build
  async build(save) {
    const ctx = this.ctx;
    const scene = ctx.scene;
    const rng = ctx.rng || Math.random;
    const low = ctx.quality === 'low';
    scene.add(this.root);

    // atmosphere
    this.fogBase = new THREE.Color(FOG);
    this.fogFlash = new THREE.Color(0x86a88a);
    this.fogAlarm = new THREE.Color(0x3a1712);
    this.fog = new THREE.FogExp2(FOG, 0.026);
    scene.fog = this.fog;
    scene.background = this.fog.color;
    this.hemi = new THREE.HemisphereLight(0x90a070, 0x1c160a, 0.4);
    this.root.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0xa8c4a0, 0.35);
    this.root.add(this.moon);
    this.root.add(this.moon.target);
    ctx.fx?.setGrade?.({ saturation: 0.82, exposure: 1.0, tint: [0.96, 1.04, 0.9] });

    // terrain
    const hf = makeHeightfield(rng);
    this.h = hf.height;
    const H = this.h;
    ctx.world?.setHeightfield?.(H);
    if (ctx.world) ctx.world.bounds = { minX: -176, maxX: 176, minZ: -176, maxZ: 176 };
    const terrain = buildTerrain(hf, 360, low ? 120 : 170);
    this.root.add(terrain);

    // sky
    this.sky = buildSky(ctx.camera, FOG);
    this.root.add(this.sky.group);
    this.moon.position.copy(this.sky.dir).multiplyScalar(100);
    this.boltMat = new THREE.MeshBasicMaterial({ color: 0xdcffe6, fog: false, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    this.bolt = new THREE.Mesh(new THREE.BufferGeometry(), this.boltMat);
    this.bolt.visible = false; this.bolt.frustumCulled = false;
    this.root.add(this.bolt);

    // particles
    this.spores = new Spores(low ? 1200 : 2500);
    this.root.add(this.spores.points);
    this.smoke = new Particles(900, { name: 'l1_smoke' });
    this.fire = new Particles(420, { additive: true, name: 'l1_fire' });
    this.root.add(this.smoke.points, this.fire.points);

    this._buildScatter(rng, H, low);
    this._buildLander(H);
    this._buildRocket(H);
    this._buildSites(rng, H);
    this._buildVents(H);
    this._buildLogs(H);
    this._buildBeacons(H);

    // creatures (dynamic import so a broken creatures module can't kill the level)
    try {
      const mod = await import('../creatures/creatures.js');
      this.createCreature = mod.createCreature || mod.default?.createCreature || null;
    } catch (e) { console.warn('[L1] creatures unavailable', e); this.createCreature = null; }
    STALKER_ROUTES.forEach((route) => {
      const pts = route.map(([x, z]) => new THREE.Vector3(x, H(x, z), z));
      this._makeCreature('stalker', { position: pts[0].clone(), patrol: pts });
    });
    this._makeCreature('leviathan', { position: new THREE.Vector3(-150, 95, -210) });

    // apply save
    if (save && typeof save === 'object') {
      (save.parts || []).forEach((v, i) => { if (v) this._applyPart(i, true); });
      let ph = PHASES.includes(save.phase) ? save.phase : 'explore';
      if (ph === 'launch1') ph = 'install';
      if (ph === 'launch2' || ph === 'done') ph = 'relaunch';
      if (PI(ph) >= PI('valves')) { this._damageRocket(); this._spawnSwarm(); }
      (save.valves || []).forEach((v, i) => { if (v) this._applyValve(i, true); });
      this._setPhase(ph);
      this.loaded = true;
    } else {
      this._setPhase('explore');
      this._intro();
    }

    ctx.setOxygenDrain?.(0.8);
    O2.forEach(([x, z]) => ctx.addOxygenZone?.(new THREE.Vector3(x, H(x, z), z), 4));
    ctx.audio?.ambience?.('l1');
    this._refreshObjective(true);
  }

  _intro() {
    const sub = (t, s, txt, d) => this._at(t, () => this.ctx.ui?.subtitle?.(s, txt, d));
    sub(2.5, 'HALE', '...crew vitals detected. You are alive. I— am partially intact.', 4.5);
    sub(7.5, 'HALE', 'Atmosphere is toxic. Your suit reserves are draining. The cyan vents are breathable.', 5);
    sub(13, 'HALE', 'Four Kestrel-pattern signatures across the basin. And... movement. Something is listening.', 5.5);
    this._at(19, () => this.ctx.ui?.notify?.('They hunt by sound. Crouch and walk slow. [F] flashlight', 5));
  }

  _makeCreature(type, opts) {
    let c = null;
    try { c = this.createCreature ? this.createCreature(type, this.ctx, opts) : null; } catch (e) { console.warn('[L1] createCreature failed', type, e); }
    this.creatures.push(c);
    if (c && type === 'stalker') this.stalkers.push(c);
    return c;
  }

  _spawnSwarm() {
    if (this.swarmSpawned) return;
    this.swarmSpawned = true;
    const H = this.h, R = this.rocketPos;
    const starts = [[-66, 12], [62, 26], [6, 74]];
    const vp = this.valves.map((v) => v.pos);
    starts.forEach(([dx, dz], k) => {
      const x = R.x + dx, z = R.z + dz;
      const patrol = [vp[k % 3], vp[(k + 1) % 3], new THREE.Vector3(R.x + (k - 1) * 8, R.y, R.z + 12), vp[(k + 2) % 3]].map((p) => p.clone());
      this._makeCreature('stalker', { position: new THREE.Vector3(x, H(x, z), z), patrol, aggression: 1.3 });
    });
  }

  // ------------------------------------------------------------ world dressing
  _buildScatter(rng, H, low) {
    const avoid = (x, z, r) => {
      for (const s of Object.values(SITES)) if (Math.hypot(s.x - x, s.z - z) < r) return true;
      return false;
    };
    // rock spires (instanced): maze rings + scattered
    const spires = [];
    const M = SITES.maze;
    const rings = [[9, 2.9, [0.3]], [15, 3.0, [3.6]], [21.5, 3.1, [1.9, 5.2]]];
    for (const [rad, step, gaps] of rings) {
      const n = Math.floor((Math.PI * 2 * rad) / step);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        if (gaps.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.2 + 2.4 / rad)) continue;
        const r = 1.25 + rng() * 0.45;
        spires.push({ x: M.x + Math.cos(a) * rad, z: M.z + Math.sin(a) * rad, r, h: 6 + rng() * 9, col: true });
      }
    }
    let tries = 0;
    while (spires.length < (low ? 140 : 175) && tries++ < 2000) {
      const x = (rng() * 2 - 1) * 168, z = (rng() * 2 - 1) * 168;
      if (avoid(x, z, 26) || Math.hypot(x, z - 72) < 30) continue;
      const big = rng() < 0.45;
      const r = big ? 1.6 + rng() * 2.4 : 0.5 + rng() * 0.9;
      spires.push({ x, z, r, h: big ? 9 + rng() * 22 : 2 + rng() * 6, col: big });
    }
    const sg = spireGeometry();
    const smat = new THREE.MeshStandardMaterial({ color: 0x1d1c18, roughness: 0.95, metalness: 0.05, flatShading: true });
    const sim = new THREE.InstancedMesh(sg, smat, spires.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    spires.forEach((sp, i) => {
      const y = H(sp.x, sp.z) - 0.6;
      e.set((rng() - 0.5) * 0.12, rng() * 6.28, (rng() - 0.5) * 0.12);
      m.compose(p.set(sp.x, y, sp.z), q.setFromEuler(e), s.set(sp.r, sp.h, sp.r));
      sim.setMatrixAt(i, m);
      if (sp.col) {
        const k = sp.r * 0.78;
        this.ctx.world?.addBox?.(new THREE.Vector3(sp.x - k, y - 2, sp.z - k), new THREE.Vector3(sp.x + k, y + sp.h * 0.85, sp.z + k));
      }
    });
    sim.castShadow = true; sim.receiveShadow = true;
    this.root.add(sim);

    // bioluminescent tube plants (stalk + glowing tip)
    const plants = [];
    const nClusters = low ? 26 : 42;
    for (let c = 0; c < nClusters; c++) {
      const cx = (rng() * 2 - 1) * 160, cz = (rng() * 2 - 1) * 160;
      if (Math.hypot(cx - SITES.rocket.x, cz - SITES.rocket.z) < 22) continue;
      const n = 6 + Math.floor(rng() * 8);
      for (let k = 0; k < n; k++) {
        const a = rng() * 6.28, r = rng() * 4.5;
        plants.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, h: 0.6 + rng() * 2.4, w: 0.7 + rng() * 0.8, t: (rng() - 0.5) * 0.4, ry: rng() * 6.28 });
      }
    }
    // a few lining the path north from the lander
    for (let i = 0; i < 24; i++) {
      const z = 50 - i * 7, x = Math.sin(i * 1.7) * 9 + (rng() - 0.5) * 6;
      plants.push({ x, z, h: 0.8 + rng() * 1.8, w: 0.8 + rng() * 0.6, t: (rng() - 0.5) * 0.4, ry: rng() * 6.28 });
    }
    const stalkG = new THREE.CylinderGeometry(0.05, 0.1, 1, 5); stalkG.translate(0, 0.5, 0);
    const tipG = new THREE.SphereGeometry(1, 8, 6);
    const stalkM = new THREE.MeshStandardMaterial({ color: 0x18241c, roughness: 0.8 });
    this.tipMat = new THREE.MeshStandardMaterial({ color: 0x0a2420, emissive: 0x2affd8, emissiveIntensity: 1.6, roughness: 0.4 });
    const stalks = new THREE.InstancedMesh(stalkG, stalkM, plants.length);
    const tips = new THREE.InstancedMesh(tipG, this.tipMat, plants.length);
    plants.forEach((pl, i) => {
      const y = H(pl.x, pl.z) - 0.05;
      e.set(pl.t, pl.ry, pl.t * 0.7);
      q.setFromEuler(e);
      m.compose(p.set(pl.x, y, pl.z), q, s.set(pl.w, pl.h, pl.w));
      stalks.setMatrixAt(i, m);
      const top = this._v.set(0, pl.h, 0).applyQuaternion(q);
      const tr = 0.09 + pl.w * 0.08;
      m.compose(p.set(pl.x + top.x, y + top.y, pl.z + top.z), q, s.set(tr, tr * 1.6, tr));
      tips.setMatrixAt(i, m);
    });
    this.root.add(stalks, tips);

    // small rocks
    const nr = low ? 160 : 300;
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x24221d, roughness: 1, flatShading: true }), nr);
    for (let i = 0; i < nr; i++) {
      const x = (rng() * 2 - 1) * 165, z = (rng() * 2 - 1) * 165, r = 0.15 + rng() * rng() * 1.1;
      e.set(rng() * 3, rng() * 3, rng() * 3);
      m.compose(p.set(x, H(x, z) - r * 0.3, z), q.setFromEuler(e), s.set(r, r * (0.5 + rng() * 0.5), r));
      rocks.setMatrixAt(i, m);
    }
    rocks.receiveShadow = true;
    this.root.add(rocks);

    // colossal ribcages (3) — one forms the bone nest
    const N = SITES.nest;
    const rib = [
      ...ribcageGeometries(rng, 0.85, N.x, H(N.x, N.z) - 1.0, N.z, 0.5),
      ...ribcageGeometries(rng, 1.25, -38, H(-38, -2) - 1.5, -2, 2.2),
      ...ribcageGeometries(rng, 1.0, 52, H(52, -96) - 1.2, -96, -0.9),
    ];
    // bone-nest spikes + egg sacs
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = 7 + (i % 3);
      const bx = N.x + Math.cos(a) * r, bz = N.z + Math.sin(a) * r, by = H(bx, bz);
      const pts = [new THREE.Vector3(bx, by - 0.5, bz), new THREE.Vector3(bx - Math.cos(a) * 1.5, by + 2.5, bz - Math.sin(a) * 1.5), new THREE.Vector3(bx - Math.cos(a) * 3.5, by + 3.6 + (i % 2), bz - Math.sin(a) * 3.5)];
      rib.push(P(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.22, 5, false), 0xb8ad8e));
    }
    for (let i = 0; i < 9; i++) {
      const a = i * 0.7 + 0.3, r = 2.5 + (i % 4) * 0.9;
      const ex = N.x + Math.cos(a) * r, ez = N.z + Math.sin(a) * r;
      rib.push(P(new THREE.SphereGeometry(0.6 + (i % 3) * 0.2, 10, 8), 0x6a7048, ex, H(ex, ez) + 0.3, ez, 0, 0, 0, 1, 1.4, 1));
    }
    const bones = merged(rib, { roughness: 0.75, metalness: 0.0 });
    this.root.add(bones);

    // sulfur steam mounds (decor)
    const mounds = [];
    tries = 0;
    let made = 0;
    while (made < 9 && tries++ < 200) {
      const x = (rng() * 2 - 1) * 150, z = (rng() * 2 - 1) * 150;
      if (avoid(x, z, 24)) continue;
      const y = H(x, z);
      mounds.push(P(new THREE.ConeGeometry(1.6, 1.1, 8, 1, true), 0x3a3418, x, y + 0.2, z));
      this.smoke.addEmitter({ x, y: y + 0.8, z, n: 24, color: [0.5, 0.48, 0.3], life: [3, 6], vel: [0, 1.4, 0], jitter: 0.35, spread: 0.5, size: [0.8, 3.6], alpha: 0.12, rise: 0.15, drag: 0.3 });
      made++;
    }
    if (mounds.length) this.root.add(merged(mounds, { roughness: 1 }));
  }

  _buildLander(H) {
    const L = SITES.lander;
    const y = H(L.x, L.z);
    this.landerPos = new THREE.Vector3(L.x, y, L.z);
    const lander = buildLander();
    lander.group.position.copy(this.landerPos);
    this.root.add(lander.group);
    this.lander = lander;
    this.ctx.world?.addBox?.(new THREE.Vector3(L.x - 3.2, y - 1, L.z - 3.2), new THREE.Vector3(L.x + 3.2, y + 5.2, L.z + 3.2));
    this.smoke.addEmitter({ x: L.x + 0.6, y: y + 4.5, z: L.z + 0.4, n: 130, color: [0.07, 0.07, 0.06], life: [4, 8], vel: [0.3, 2.2, 0], jitter: 0.5, spread: 1.0, size: [1.2, 6.5], alpha: 0.5, rise: 0.25, drag: 0.25, colorVar: 0.3 });
    this.fire.addEmitter({ x: L.x + 1.0, y: y + 1.2, z: L.z + 1.8, n: 70, color: [1.0, 0.42, 0.12], life: [0.4, 1.1], vel: [0, 2.0, 0], jitter: 0.6, spread: 0.9, size: [0.7, 0.2], alpha: 0.85, rise: 1.0, drag: 1.0, flicker: true });
    this.fire.addEmitter({ x: L.x - 1.5, y: y + 0.4, z: L.z + 2.5, n: 40, color: [1.0, 0.32, 0.08], life: [0.3, 0.9], vel: [0, 1.6, 0], jitter: 0.5, spread: 0.6, size: [0.5, 0.15], alpha: 0.8, rise: 1.0, drag: 1.0, flicker: true });
    this.landerLight = this._light(0xff6a28, 30, 22, this.landerPos.x + 1, y + 2.5, this.landerPos.z + 2.4);
    this._loop('fire', this.landerPos, 0.7);
    this.sparkT = 2;
  }

  _buildRocket(H) {
    const R = SITES.rocket;
    const y = H(R.x, R.z);
    this.rocketPos = new THREE.Vector3(R.x, y, R.z);
    const rk = buildRocket();
    rk.group.position.set(R.x, y - 0.65, R.z);
    this.root.add(rk.group);
    this.rk = rk;
    const w = this.ctx.world;
    w?.addBox?.(new THREE.Vector3(R.x - 2.3, y - 1, R.z - 2.3), new THREE.Vector3(R.x + 2.3, y + 28, R.z + 2.3));
    w?.addBox?.(new THREE.Vector3(R.x + rk.gantryX - 1.9, y - 1, R.z - 1.9), new THREE.Vector3(R.x + rk.gantryX + 1.9, y + 31, R.z + 1.9));
    w?.addBox?.(new THREE.Vector3(R.x - 7.6, y - 1, R.z - 2.6), new THREE.Vector3(R.x - 5.4, y + 5.4, R.z + 2.6));
    this.rocketLight = this._light(0xff2a14, 0, 40, R.x + 3, y + 6, R.z + 4);
    // hatch / install anchor
    this.hatch = new THREE.Object3D();
    this.hatch.position.set(R.x, y + 1.2, R.z + 3.4);
    this.root.add(this.hatch);
    // valves around the base with ground pipes
    const vdefs = [[-9.5, 4.5], [-2, -9.5], [7.5, 7.5]];
    const pipes = [];
    this.valves = vdefs.map(([dx, dz], i) => {
      const x = R.x + dx, z = R.z + dz, vy = H(x, z);
      const v = buildValve();
      v.group.position.set(x, vy, z);
      v.group.rotation.y = Math.atan2(dx, dz);
      this.root.add(v.group);
      const len = Math.hypot(dx, dz) - 2.2;
      pipes.push(P(new THREE.CylinderGeometry(0.18, 0.18, len, 8), 0x4c5658, R.x + dx * 0.5 + (dx / Math.hypot(dx, dz)) * 1.1, y + 0.2, R.z + dz * 0.5 + (dz / Math.hypot(dx, dz)) * 1.1, Math.PI / 2, Math.atan2(dx, dz), 0));
      const anchor = new THREE.Object3D();
      anchor.position.set(x, vy + 1.0, z);
      this.root.add(anchor);
      const leak = this.smoke.addEmitter({ x, y: vy + 1.7, z, n: 50, color: [0.85, 0.92, 0.95], life: [0.8, 1.8], vel: [dx * 0.15, 4.5, dz * 0.15], jitter: 1.4, spread: 0.2, size: [0.3, 2.6], alpha: 0.4, rise: 0.4, drag: 0.8, active: false });
      this.ctx.world?.addBox?.(new THREE.Vector3(x - 0.45, vy - 1, z - 0.45), new THREE.Vector3(x + 0.45, vy + 1.6, z + 0.45));
      return { ...v, pos: new THREE.Vector3(x, vy, z), anchor, leak, spin: 0, idx: i };
    });
    this.root.add(merged(pipes, { metalness: 0.6, roughness: 0.5 }));
    // launch effects
    this.exhaust = this.fire.addEmitter({ x: R.x, y: y + 0.3, z: R.z, n: 170, color: [1.0, 0.55, 0.2], life: [0.4, 1.0], vel: [0, -2, 0], jitter: 5, spread: 1.2, size: [1.6, 3.8], alpha: 0.9, rise: 0, drag: 0.6, flicker: true, active: false });
    this.baseFire = this.fire.addEmitter({ x: R.x - 1.5, y: y + 0.8, z: R.z + 2.0, n: 60, color: [1.0, 0.38, 0.1], life: [0.4, 1.2], vel: [0, 2.4, 0], jitter: 0.7, spread: 1.4, size: [0.9, 0.25], alpha: 0.85, rise: 1.2, drag: 1, flicker: true, active: false });
    this.rocketSmoke = this.smoke.addEmitter({ x: R.x, y: y + 1, z: R.z, n: 150, color: [0.18, 0.18, 0.16], life: [3, 7], vel: [0, 2.5, 0], jitter: 2.2, spread: 3.5, size: [2, 9], alpha: 0.45, rise: 0.25, drag: 0.4, active: false, colorVar: 0.3 });
    this.ctx.interact?.add?.({ id: 'l1_install', object: this.hatch, radius: 3.4, prompt: 'Install rocket parts', holdTime: 3, enabled: false, onInteract: () => { if (this.st.ph === 'install') this.ctx.levelEvent?.('install', {}); } });
    this.ctx.interact?.add?.({ id: 'l1_hatch', object: this.hatch, radius: 3.4, prompt: 'Relaunch — seal the hatch', holdTime: 1.5, enabled: false, onInteract: () => { if (this.st.ph === 'relaunch') this.ctx.levelEvent?.('relaunch', {}); } });
    this.valves.forEach((v, i) => {
      this.ctx.interact?.add?.({ id: 'l1_valve' + i, object: v.anchor, radius: 2.6, prompt: 'Seal coolant valve', holdTime: 3, enabled: false, onInteract: () => { if (this.st.ph === 'valves' && !this.st.valves[i]) this.ctx.levelEvent?.('valve', { i }); } });
    });
    this._loop('beacon', new THREE.Vector3(R.x + rk.gantryX, y + 30, R.z), 0.5);
  }

  _buildSites(rng, H) {
    const S = SITES;
    // crashed shuttle
    const sh = buildShuttle();
    sh.position.set(S.shuttle.x, H(S.shuttle.x, S.shuttle.z), S.shuttle.z);
    sh.rotation.y = 0.35;
    this.root.add(sh);
    sh.updateMatrixWorld(true);
    const box = (lx0, lz0, lx1, lz1, hh) => {
      const c = [[lx0, lz0], [lx1, lz0], [lx0, lz1], [lx1, lz1]].map(([x, z]) => this._v.set(x, 0, z).applyMatrix4(sh.matrixWorld).clone());
      const xs = c.map((v) => v.x), zs = c.map((v) => v.z);
      const y0 = sh.position.y;
      this.ctx.world?.addBox?.(new THREE.Vector3(Math.min(...xs), y0 - 1, Math.min(...zs)), new THREE.Vector3(Math.max(...xs), y0 + hh, Math.max(...zs)));
    };
    box(-2.0, -12, 2.0, 0.8, 3.6);
    box(-0.4, 4.2, 2.8, 9.5, 3.0);
    this.fire.addEmitter({ x: S.shuttle.x - 3, y: sh.position.y + 0.5, z: S.shuttle.z - 6, n: 26, color: [0.4, 1.0, 0.5], life: [0.4, 1.0], vel: [0, 1.0, 0], jitter: 0.4, spread: 0.6, size: [0.4, 0.1], alpha: 0.6, rise: 0.6, drag: 1, flicker: true });
    // toppled antenna on the ridge
    const an = buildAntenna();
    an.position.set(S.ridge.x - 6, H(S.ridge.x - 6, S.ridge.z + 3) - 0.2, S.ridge.z + 3);
    an.rotation.set(0, 0.4, 0.04);
    this.root.add(an);
    // dead bodies at nest
    const nb = buildBody(2);
    const nx = SITES.nest.x - 3.5, nz = SITES.nest.z + 2.5;
    nb.position.set(nx, H(nx, nz), nz); nb.rotation.y = 2.1;
    this.root.add(nb);
    // parts
    this.parts = PARTS.map((def, i) => {
      const s = SITES[def.site];
      const x = s.x + def.off[0], z = s.z + def.off[1];
      const y = H(x, z);
      const pm = buildPartModel(def.key);
      pm.group.position.set(x, y, z);
      this.root.add(pm.group);
      const light = this._light(pm.color, 14, 16, x, y + 1.6, z);
      const anchor = new THREE.Object3D(); anchor.position.set(x, y + 0.6, z); this.root.add(anchor);
      this.ctx.interact?.add?.({ id: 'l1_part' + i, object: anchor, radius: 2.4, prompt: 'Recover ' + def.name, holdTime: 1, enabled: true, onInteract: (pid) => { if (!this.st.parts[i]) this.ctx.levelEvent?.('part', { i, by: pid }); } });
      return { ...pm, def, pos: new THREE.Vector3(x, y, z), light, phase: i * 1.7 };
    });
  }

  _buildVents(H) {
    this.vents = O2.map(([x, z], i) => {
      const y = H(x, z);
      const v = buildVent();
      v.group.position.set(x, y - 0.25, z);
      this.root.add(v.group);
      this.smoke.addEmitter({ x, y: y + 0.9, z, n: 34, color: [0.42, 0.9, 0.95], life: [2.5, 4.5], vel: [0, 1.8, 0], jitter: 0.35, spread: 0.45, size: [0.6, 3.2], alpha: 0.22, rise: 0.2, drag: 0.3 });
      this._loop('steam', new THREE.Vector3(x, y + 1, z), 0.45);
      return { ...v, ph: i * 1.3 };
    });
  }

  _buildLogs(H) {
    this.logs = LOGS.map((L, i) => {
      const y = H(L.x, L.z);
      const body = buildBody(L.body);
      body.position.set(L.x, y, L.z);
      body.rotation.y = i * 2.3 + 0.6;
      this.root.add(body);
      const dev = buildLogDevice();
      dev.group.position.set(L.x + 0.9, y + 0.02, L.z + 0.5);
      dev.group.rotation.y = i;
      this.root.add(dev.group);
      const anchor = new THREE.Object3D(); anchor.position.set(L.x + 0.9, y + 0.5, L.z + 0.5); this.root.add(anchor);
      this.ctx.interact?.add?.({ id: 'l1_log' + i, object: anchor, radius: 2.3, prompt: 'Play Kestrel audio log', holdTime: 0, enabled: true, onInteract: () => {
        if (this.clock - this.logT[i] < 12) return;
        this.logT[i] = this.clock;
        this.ctx.levelEvent?.('log', { i });
      } });
      return { ...dev, pos: anchor.position.clone() };
    });
  }

  _buildBeacons() {
    // faint pale columns rising from each part site (navigation through the fog)
    const c = document.createElement('canvas'); c.width = 4; c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.CylinderGeometry(0.5, 0.9, 90, 10, 1, true); geo.translate(0, 45, 0);
    this.parts.forEach((p) => {
      const mat = new THREE.MeshBasicMaterial({ color: p.color, map: tex, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(geo, mat);
      beam.position.copy(p.pos);
      beam.renderOrder = 5;
      this.root.add(beam);
      p.beam = beam;
    });
  }

  _light(color, intensity, distance, x, y, z) {
    const l = new THREE.PointLight(color, intensity, distance, 2);
    l.position.set(x, y, z);
    l.castShadow = false;
    l.userData.base = intensity;
    this.root.add(l);
    this.lights.push(l);
    return l;
  }

  _loop(name, pos, volume) {
    try {
      const h = this.ctx.audio?.loop?.(name, { position: pos, volume });
      if (h) this.loops.push(h);
      return h || null;
    } catch (e) { return null; }
  }

  _at(delay, fn) { this.timeline.push({ at: this.clock + delay, fn }); }

  // ------------------------------------------------------------ state helpers
  _setPhase(ph) {
    this.st.ph = ph;
    const ix = this.ctx.interact;
    ix?.setEnabled?.('l1_install', ph === 'install');
    ix?.setEnabled?.('l1_hatch', ph === 'relaunch');
    this.valves?.forEach((v, i) => ix?.setEnabled?.('l1_valve' + i, ph === 'valves' && !this.st.valves[i]));
    if (ph === 'valves') {
      if (!this.alarm) this.alarm = this._loop('alarm_loop', this.rocketPos, 0.6);
      this.valves.forEach((v, i) => this.smoke.setActive(v.leak, !this.st.valves[i]));
    } else if (this.alarm) { try { this.alarm.stop(1.5); } catch (e) { /* */ } this.alarm = null; }
    if (ph !== 'valves') this.valves?.forEach((v) => this.smoke.setActive(v.leak, false));
    this._refreshObjective();
  }

  _objectiveText() {
    const s = this.st;
    switch (s.ph) {
      case 'explore': return `Recover rocket parts (${s.parts.reduce((a, b) => a + b, 0)}/4)`;
      case 'install': return 'Install the parts at the Kestrel rocket';
      case 'launch1': return 'Ignition — stand clear';
      case 'valves': return `Seal the coolant valves (${s.valves.reduce((a, b) => a + b, 0)}/3)`;
      case 'relaunch': return 'Relaunch — get to the cockpit hatch';
      default: return 'Hold on';
    }
  }

  _refreshObjective(force) {
    const t = this._objectiveText();
    if (force || t !== this.lastObjective) { this.lastObjective = t; this.ctx.ui?.setObjective?.(t); }
  }

  _applyPart(i, silent) {
    if (this.st.parts[i]) return;
    this.st.parts[i] = 1;
    const p = this.parts[i];
    p.group.visible = false;
    if (p.beam) p.beam.visible = false;
    p.light.intensity = 0; p.light.userData.base = 0;
    this.ctx.interact?.remove?.('l1_part' + i);
    if (!silent) {
      this.ctx.audio?.play?.('pickup', { position: p.pos });
      this.ctx.fx?.burst?.(p.pos.clone().setY(p.pos.y + 0.8), { count: 30, color: p.color, speed: 3, life: 0.8, size: 0.12 });
      const n = this.st.parts.reduce((a, b) => a + b, 0);
      this.ctx.ui?.notify?.(`${p.def.name.toUpperCase()} RECOVERED  ${n}/4`, 3);
    }
  }

  _applyValve(i, silent) {
    if (this.st.valves[i]) return;
    this.st.valves[i] = 1;
    const v = this.valves[i];
    v.lampMat.color.setHex(0x30ff70);
    v.glow.material.color.setHex(0x30ff70);
    v.wheel.material = v.wheel.material.clone();
    v.wheel.material.color.setHex(0x2a8a40); v.wheel.material.emissive.setHex(0x0a3a12);
    v.spokes.material = v.wheel.material;
    v.spin = silent ? 0 : 1.2;
    this.smoke.setActive(v.leak, false);
    this.ctx.interact?.setEnabled?.('l1_valve' + i, false);
    if (!silent) {
      this.ctx.audio?.play?.('valve', { position: v.pos });
      const n = this.st.valves.reduce((a, b) => a + b, 0);
      this.ctx.ui?.notify?.(`VALVE SEALED  ${n}/3`, 2.5);
    }
  }

  _damageRocket() {
    if (this.rocketDamaged) return;
    this.rocketDamaged = true;
    this.rk.scorch.material.opacity = 0.75;
    this.fire.setActive(this.baseFire, true);
    this.smoke.setActive(this.rocketSmoke, true);
    this.rocketLight.color.setHex(0xff5a20);
    this.rocketLight.userData.base = 35;
    if (!this.fireLoop) this.fireLoop = this._loop('fire', this.rocketPos, 0.8);
  }

  _alertNearest(pos, loud = 1) {
    let best = null, bd = Infinity;
    for (const s of this.stalkers) {
      if (!s?.position) continue;
      const d = s.position.distanceTo(pos);
      if (d < bd) { bd = d; best = s; }
    }
    try { best?.hearNoise?.(pos, loud); } catch (e) { /* */ }
  }

  // ------------------------------------------------------------ events (all peers)
  onEvent(type, data = {}, fromId) {
    const ctx = this.ctx;
    const host = ctx.isHost;
    try {
      if (type === 'part') {
        const i = data.i | 0;
        if (this.st.parts[i] || this.st.ph !== 'explore') return;
        this._applyPart(i, false);
        const n = this.st.parts.reduce((a, b) => a + b, 0);
        if (host) this._alertNearest(this.parts[i].pos, 1);
        if (n >= 4) {
          this._setPhase('install');
          ctx.ui?.subtitle?.('HALE', 'All four components. Get them to the Kestrel rocket — north plateau. Follow the red light.', 5);
        } else {
          ctx.ui?.subtitle?.('HALE', `${this.parts[i].def.name[0].toUpperCase() + this.parts[i].def.name.slice(1)} secured. That was loud. Move.`, 3.5);
          this._refreshObjective();
        }
        if (host) ctx.checkpoint?.();
      } else if (type === 'log') {
        const L = LOGS[data.i | 0];
        if (!L) return;
        const lg = this.logs[data.i | 0];
        ctx.audio?.play?.('radio', { position: lg.pos });
        ctx.audio?.play?.('static', { position: lg.pos, volume: 0.5 });
        let t = 0.4;
        for (const [sp, txt, d] of L.lines) {
          this._at(t, () => { ctx.ui?.subtitle?.(sp, txt, d); ctx.audio?.speak?.(d); });
          t += d + 0.3;
        }
      } else if (type === 'install') {
        if (this.st.ph !== 'install') return;
        this._setPhase('launch1');
        this._launch1();
      } else if (type === 'launchfail') {
        if (PI(this.st.ph) >= PI('valves')) return;
        this._launchFail();
      } else if (type === 'valve') {
        const i = data.i | 0;
        if (this.st.ph !== 'valves' || this.st.valves[i]) return;
        this._applyValve(i, false);
        if (host) { for (const s of this.stalkers) { if (s?.position && s.position.distanceTo(this.valves[i].pos) < 40) try { s.hearNoise?.(this.valves[i].pos, 0.5); } catch (e) { /* */ } } }
        if (this.st.valves.every((v) => v)) {
          this._setPhase('relaunch');
          ctx.ui?.subtitle?.('HALE', 'Coolant pressure holding. Get to the hatch. Now.', 4);
        } else this._refreshObjective();
        if (host) ctx.checkpoint?.();
      } else if (type === 'relaunch') {
        if (this.st.ph !== 'relaunch') return;
        this._setPhase('launch2');
        this._launch2();
      } else if (type === 'noise') {
        if (host && data?.pos) this.onNoise(data.pos, data.loudness ?? data.loud ?? 0.6);
      }
    } catch (e) { console.warn('[L1] onEvent', type, e); }
  }

  onNoise(pos, loud = 0.6) {
    if (!this.ctx.isHost || !pos) return;
    const v = this._v2.set(pos.x, pos.y, pos.z);
    for (const s of this.stalkers) {
      if (!s?.position) continue;
      if (s.position.distanceTo(v) < 15 + loud * 50) try { s.hearNoise?.(v.clone(), loud); } catch (e) { /* */ }
    }
  }

  _launch1() {
    const ctx = this.ctx, R = this.rocketPos;
    this.seqStart = this.clock;
    this.chargeLoop = this._loop('rocket_charge', R, 0.8);
    const sub = (t, txt, d) => this._at(t, () => ctx.ui?.subtitle?.('HALE', txt, d));
    sub(0, 'Components seated. Kestrel systems... online. Ignition sequence start.', 2.8);
    sub(3, 'Ignition in three...', 1);
    sub(4, 'two...', 1);
    sub(5, 'one...', 1);
    this._at(3, () => ctx.fx?.shake?.(0.15, 1.2));
    this._at(3.6, () => { this.fire.setActive(this.exhaust, true); this.smoke.setActive(this.rocketSmoke, true); });
    this._at(4, () => ctx.fx?.shake?.(0.35, 1.2));
    this._at(5, () => { ctx.fx?.shake?.(0.6, 1.2); ctx.fx?.burst?.(R.clone().setY(R.y + 1), { count: 60, color: 0xff8a30, speed: 9, life: 1, size: 0.4 }); });
    if (ctx.isHost) this._at(6.2, () => ctx.levelEvent?.('launchfail', {}));
  }

  _launchFail() {
    const ctx = this.ctx, R = this.rocketPos;
    try { this.chargeLoop?.stop?.(0.2); } catch (e) { /* */ }
    this.chargeLoop = null;
    this.fire.setActive(this.exhaust, false);
    this._damageRocket();
    const p = R.clone(); p.y += 2;
    ctx.audio?.play?.('explosion', { position: p, volume: 1 });
    ctx.audio?.play?.('rocket_fail', { position: p, volume: 1 });
    ctx.fx?.flash?.(0xffa050, 0.8, 0.6);
    ctx.fx?.shake?.(1.2, 1.6);
    ctx.fx?.pulseGlitch?.(0.4, 0.5);
    for (let k = 0; k < 3; k++) ctx.fx?.burst?.(this._v.set(R.x + (k - 1) * 2.5, R.y + 1 + k, R.z + 2).clone(), { count: 90, color: k === 1 ? 0xffe0a0 : 0xff6020, speed: 14, life: 1.4, size: 0.5 });
    this.flashAmt = Math.max(this.flashAmt, 0.6);
    this._spawnSwarm();
    this._setPhase('valves');
    ctx.ui?.subtitle?.('HALE', 'Coolant line ruptured. Launch aborted.', 3.5);
    this._at(4, () => ctx.ui?.subtitle?.('HALE', 'Three valves venting at the base. Seal them by hand. And crew... they heard that.', 5));
    this.nextStrike = 1.5;
    if (ctx.isHost) {
      for (const [id, pl] of this._players()) {
        if (pl?.position && !pl.downed && pl.position.distanceTo(R) < 8) ctx.damagePlayer?.(id, 15, R);
      }
      for (const s of this.stalkers) try { s?.hearNoise?.(R.clone(), 1); } catch (e) { /* */ }
      ctx.checkpoint?.();
    }
  }

  _launch2() {
    const ctx = this.ctx, R = this.rocketPos;
    this.seqStart = this.clock;
    this.chargeLoop = this._loop('rocket_charge', R, 1);
    try { this.fireLoop?.stop?.(1); } catch (e) { /* */ }
    this.fireLoop = null;
    this.fire.setActive(this.baseFire, false);
    const sub = (t, txt, d) => this._at(t, () => ctx.ui?.subtitle?.('HALE', txt, d));
    sub(0, 'Hatch sealed. Igniting. Hold on to something.', 2);
    sub(1, 'Three...', 1); sub(2, 'two...', 1); sub(3, 'one...', 1);
    this._at(1, () => { ctx.fx?.shake?.(0.3, 1.5); this.fire.setActive(this.exhaust, true); this.smoke.setActive(this.rocketSmoke, true); });
    this._at(2, () => ctx.fx?.shake?.(0.6, 1.5));
    this._at(3, () => { ctx.fx?.shake?.(1.0, 2.5); ctx.audio?.play?.('rocket_launch', { position: R, volume: 1 }); });
    for (let k = 0; k < 6; k++) this._at(1.5 + k * 0.5, () => ctx.fx?.burst?.(this._v.set(R.x + (Math.random() - 0.5) * 6, R.y + 0.5, R.z + (Math.random() - 0.5) * 6).clone(), { count: 50, color: 0xffa040, speed: 12, life: 1.2, size: 0.5 }));
    this._at(4.2, () => { ctx.fx?.flash?.(0xfff2d0, 1, 1.4); ctx.fx?.pulseGlitch?.(0.6, 0.8); });
    if (ctx.isHost) this._at(5.2, () => { this._setPhase('done'); ctx.completeLevel?.(); });
  }

  // ------------------------------------------------------------ frame
  update(dt) {
    if (this.disposed) return;
    dt = Math.min(dt || 0, 0.1);
    this.clock += dt;
    const ctx = this.ctx;
    const t = this.clock;
    try {
      // timeline
      if (this.timeline.length) {
        for (let i = this.timeline.length - 1; i >= 0; i--) {
          const e = this.timeline[i];
          if (e.at <= t) { this.timeline.splice(i, 1); try { e.fn(); } catch (err) { console.warn('[L1] timeline', err); } }
        }
      }
      ctx.camera?.getWorldPosition?.(this._cam);
      const cam = this._cam;
      this.sky.update(dt, cam);
      // particles
      const rh = ctx.renderer?.domElement?.height || innerHeight;
      const fov = ctx.camera?.fov || 75;
      const scale = rh / (2 * Math.tan((fov * Math.PI) / 360));
      this.spores.setScale(scale); this.smoke.setScale(scale); this.fire.setScale(scale);
      this.spores.update(dt, cam);
      this.smoke.update(dt, 0.25);
      this.fire.update(dt, 0);
      this._updateLightning(dt, cam);
      this._updateProps(dt, t);
      this._updateSequences(dt, t);
    } catch (e) { if (!this._warned) { this._warned = true; console.warn('[L1] update visuals', e); } }

    // creatures
    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (!c) continue;
      try { c.update?.(dt); } catch (e) { if (!this._cwarn) { this._cwarn = true; console.warn('[L1] creature update', e); } }
    }
    try {
      if (ctx.isHost) this._hostTick(dt);
      this._updateTension(dt);
    } catch (e) { /* */ }
  }

  _players() {
    const p = this.ctx.players;
    if (!p) return [];
    if (p instanceof Map) return p;
    return Object.entries(p);
  }

  _hostTick(dt) {
    this.noiseT -= dt;
    if (this.noiseT > 0) return;
    this.noiseT = 0.25;
    for (const [, pl] of this._players()) {
      if (!pl?.position || pl.downed || !(pl.noise > 0.3)) continue;
      for (const s of this.stalkers) {
        if (!s?.position) continue;
        if (s.position.distanceTo(pl.position) < 12 + pl.noise * 42) try { s.hearNoise?.(pl.position.clone(), pl.noise); } catch (e) { /* */ }
      }
    }
  }

  _updateTension(dt) {
    this.tensionT -= dt;
    if (this.tensionT > 0) return;
    this.tensionT = 0.2;
    const me = this.ctx.getLocalPlayer?.() || null;
    const pos = me?.position || this._cam;
    let target = 0;
    for (const s of this.stalkers) {
      if (!s?.position) continue;
      const d = s.position.distanceTo(pos);
      if (d > 30) continue;
      const chasing = s.state === 'chase' || s.state === 'attack';
      target = Math.max(target, chasing ? 0.55 + 0.45 * (1 - d / 30) : 0.45 * (1 - d / 30));
    }
    if (this.st.ph === 'valves') target = Math.max(target, 0.35);
    if (this.st.ph === 'launch2') target = Math.max(target, 0.6);
    this.tension += (target - this.tension) * 0.35;
    if (this.tension < 0.01 && target === 0) this.tension = 0;
    this.ctx.audio?.setTension?.(this.tension);
  }

  _updateLightning(dt, cam) {
    this.nextStrike -= dt;
    if (this.nextStrike <= 0) {
      const intense = this.st.ph === 'valves' || this.st.ph === 'launch1';
      this.nextStrike = intense ? 3 + Math.random() * 4 : 8 + Math.random() * 12;
      const a = Math.random() * Math.PI * 2, dist = 70 + Math.random() * 120;
      const x = cam.x + Math.cos(a) * dist, z = cam.z + Math.sin(a) * dist;
      try {
        const geos = makeBolt(new THREE.Vector3(x, 150, z), this.h(x, z));
        const g = mergeGeometries(geos, false);
        geos.forEach((q) => q.dispose());
        this.bolt.geometry.dispose();
        this.bolt.geometry = g;
        this.bolt.visible = true;
        this.boltT = 0.26;
      } catch (e) { /* */ }
      const near = 1 - (dist - 70) / 120;
      this.flashAmt = Math.max(this.flashAmt, 0.55 + near * 0.45);
      this.ctx.fx?.flash?.(0xb8ffcc, 0.12 + near * 0.15, 0.25);
      this._at(0.4 + dist / 110, () => this.ctx.audio?.play?.('thunder', { volume: 0.5 + near * 0.5 }));
    }
    if (this.boltT > 0) {
      this.boltT -= dt;
      this.boltMat.opacity = Math.random() < 0.3 ? 0.25 : 1;
      if (this.boltT <= 0) this.bolt.visible = false;
    }
    this.flashAmt = Math.max(0, this.flashAmt - dt * 2.6);
    const fl = this.flashAmt * (0.6 + Math.random() * 0.4);
    this.moon.intensity = 0.35 + fl * 5;
    this.hemi.intensity = 0.4 + fl * 1.4;
    const fc = this.fog.color.copy(this.fogBase);
    if (this.st.ph === 'valves') fc.lerp(this.fogAlarm, (0.5 + 0.5 * Math.sin(this.clock * 4.2)) * 0.35);
    fc.lerp(this.fogFlash, fl * 0.7);
  }

  _updateProps(dt, t) {
    // lander: flicker, blink, sparks
    const L = this.lander;
    const blink = (t % 1.6) < 0.18;
    L.beaconMat.color.setHex(blink ? 0xff2010 : 0x200302);
    L.bglow.material.opacity = blink ? 0.95 : 0.0;
    this.landerLight.intensity = 22 + Math.sin(t * 13) * 5 + Math.random() * 7;
    this.sparkT -= dt;
    if (this.sparkT <= 0) {
      this.sparkT = 1.5 + Math.random() * 4;
      const sp = this._v.set(this.landerPos.x + 1.6, this.landerPos.y + 3.6, this.landerPos.z + 1.2).clone();
      this.ctx.fx?.burst?.(sp, { count: 14, color: 0xffd080, speed: 4, life: 0.5, size: 0.06 });
      if (this._cam.distanceTo(sp) < 25) this.ctx.audio?.play?.('static', { position: sp, volume: 0.25 });
    }
    // rocket warning light
    const w = (t % 1.2) < 0.25;
    this.rk.warnMat.color.setHex(w ? 0xff2010 : 0x220303);
    this.rk.warnGlow.material.opacity = w ? 1 : 0.05;
    const ph = this.st.ph;
    const hatchOn = ph === 'relaunch' ? (t % 0.6) < 0.3 : ph === 'install';
    this.rk.hatchLamp.material.color.setHex(hatchOn ? 0x30ff80 : 0x401010);
    if (this.rocketDamaged && PI(ph) < PI('launch2')) this.rocketLight.intensity = 25 + Math.random() * 18;
    else if (PI(ph) < PI('valves') && ph !== 'launch1') this.rocketLight.intensity = w ? 30 : 0;
    // parts pulse
    for (const p of this.parts) {
      if (!p.group.visible) continue;
      const k = 0.5 + 0.5 * Math.sin(t * 2.2 + p.phase);
      p.emat.emissiveIntensity = 1.2 + k * 2.2;
      p.core.rotation.y += dt * 0.8;
      p.glow.material.opacity = 0.35 + k * 0.5;
      p.light.intensity = 8 + k * 10;
      if (p.beam) p.beam.material.opacity = 0.1 + k * 0.08;
    }
    // vents + plants
    this.tipMat.emissiveIntensity = 1.3 + Math.sin(t * 0.9) * 0.5;
    for (const v of this.vents) v.glow.material.opacity = 0.4 + Math.sin(t * 1.6 + v.ph) * 0.15;
    for (const lg of this.logs) { const on = (t % 2) < 0.15; lg.ledMat.color.setHex(on ? 0x60ff90 : 0x0a3014); lg.glow.material.opacity = on ? 0.9 : 0.1; }
    // valves
    for (const v of this.valves) {
      if (v.spin > 0) { v.spin -= dt; v.wheel.rotation.z += dt * 9; v.spokes.rotation.y += dt * 9; }
      if (!this.st.valves[v.idx] && ph === 'valves') { const on = (t % 0.7) < 0.35; v.lampMat.color.setHex(on ? 0xff2a10 : 0x300404); v.glow.material.opacity = on ? 0.9 : 0.1; }
    }
  }

  _updateSequences(dt, t) {
    const ph = this.st.ph;
    const rk = this.rk;
    if (ph === 'launch1' || ph === 'launch2') {
      const s = t - this.seqStart;
      const ramp = Math.min(1, s / (ph === 'launch1' ? 5.5 : 4));
      rk.bellGlow.material.opacity = ramp * (0.6 + Math.random() * 0.4);
      rk.rocket.position.x = (Math.random() - 0.5) * 0.06 * ramp;
      rk.rocket.position.z = (Math.random() - 0.5) * 0.06 * ramp;
      this.rocketLight.color.setHex(0xff8a30);
      this.rocketLight.intensity = 20 + ramp * 80 * (0.7 + Math.random() * 0.3);
      if (ph === 'launch2' && s > 3.2) rk.rocket.position.y = Math.pow(s - 3.2, 2) * 1.6;
      if (Math.random() < dt * 3 * ramp) this.ctx.fx?.shake?.(0.08 + ramp * 0.25, 0.3);
    } else if (rk.bellGlow.material.opacity > 0) {
      rk.bellGlow.material.opacity = Math.max(0, rk.bellGlow.material.opacity - dt);
      rk.rocket.position.x = rk.rocket.position.z = 0;
    }
  }

  // ------------------------------------------------------------ net + save
  getState() {
    const cr = new Array(this.creatures.length);
    for (let i = 0; i < this.creatures.length; i++) {
      try { cr[i] = this.creatures[i]?.getNetState?.() ?? null; } catch (e) { cr[i] = null; }
    }
    return { ph: this.st.ph, p: this.st.parts.slice(), v: this.st.valves.slice(), c: cr };
  }

  applyState(s) {
    if (!s || this.disposed) return;
    try {
      if (Array.isArray(s.p)) s.p.forEach((v, i) => { if (v && !this.st.parts[i]) this._applyPart(i, true); });
      if (PHASES.includes(s.ph) && s.ph !== this.st.ph) {
        // only fast-forward; never rewind
        if (PI(s.ph) > PI(this.st.ph)) {
          if (PI(s.ph) >= PI('valves')) { this._damageRocket(); this._spawnSwarm(); }
          if (s.ph === 'launch2' && this.st.ph !== 'launch2') { this._setPhase('launch2'); this._launch2(); }
          else this._setPhase(s.ph);
        }
      }
      if (Array.isArray(s.v)) s.v.forEach((v, i) => { if (v && !this.st.valves[i]) this._applyValve(i, true); });
      this._refreshObjective();
      if (Array.isArray(s.c)) {
        if (s.c.length > this.creatures.length && !this.swarmSpawned) this._spawnSwarm();
        for (let i = 0; i < s.c.length; i++) {
          const c = this.creatures[i];
          if (c && s.c[i] != null) try { c.setNetState?.(s.c[i]); } catch (e) { /* */ }
        }
      }
    } catch (e) { console.warn('[L1] applyState', e); }
  }

  getSaveData() {
    let ph = this.st.ph;
    if (ph === 'launch1') ph = 'install';
    if (ph === 'launch2' || ph === 'done') ph = 'relaunch';
    return { parts: this.st.parts.slice(), phase: ph, valves: this.st.valves.slice() };
  }

  spawnPoints() {
    const H = this.h || (() => 0);
    const pts = [];
    if (PI(this.st.ph) >= PI('install')) {
      const R = SITES.rocket;
      for (let i = 0; i < 4; i++) { const x = R.x - 4.5 + i * 3, z = R.z + 20; pts.push({ x, y: H(x, z) + 0.05, z, yaw: 0 }); }
    } else {
      const L = SITES.lander;
      for (let i = 0; i < 4; i++) { const x = L.x - 4.5 + i * 3, z = L.z - 8 - (i % 2) * 1.5; pts.push({ x, y: H(x, z) + 0.05, z, yaw: 0 }); }
    }
    return pts;
  }

  dispose() {
    this.disposed = true;
    for (const l of this.loops) { try { l?.stop?.(0.5); } catch (e) { /* */ } }
    this.loops.length = 0;
    try { this.alarm?.stop?.(0.3); this.chargeLoop?.stop?.(0.3); this.fireLoop?.stop?.(0.3); } catch (e) { /* */ }
    for (const c of this.creatures) { try { c?.dispose?.(); } catch (e) { /* */ } }
    this.creatures.length = 0; this.stalkers.length = 0;
    this.timeline.length = 0;
    try { this.ctx.audio?.setTension?.(0); } catch (e) { /* */ }
    try { this.ctx.fx?.setGrade?.({ saturation: 1, exposure: 1, tint: [1, 1, 1] }); } catch (e) { /* */ }
    try {
      this.root.parent?.remove(this.root);
      const mats = new Set();
      this.root.traverse((o) => {
        o.geometry?.dispose?.();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => mats.add(x)); else if (m) mats.add(m);
      });
      for (const m of mats) {
        for (const k of ['map', 'bumpMap', 'emissiveMap']) m[k]?.dispose?.();
        if (m.uniforms?.map?.value) m.uniforms.map.value.dispose?.();
        m.dispose?.();
      }
    } catch (e) { /* */ }
    if (this.ctx.scene?.fog === this.fog) this.ctx.scene.fog = null;
  }
}
