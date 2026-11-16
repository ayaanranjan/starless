// CHAPTER II — THE HOLLOW ARK  (owner: L2)
// Biomechanical alien warp-ship. Tile-map built; 3 warp cores -> 3 universe jumps -> engage hub drive.
import * as THREE from 'three';
import { L2Fx, paintBackdrop } from './l2/fx.js';

const CELL = 4, WALL_H = 5, HUB_H = 16;
// '#' wall  'V' viewport  'R' rocket wall  '.' corridor  'h' hub  'X' drive  'c' core chamber  'N/E/W' core console
// 'r' room  'p' specimen pod  'k' Kestrel pod  'D' membrane door  'S' spawn vestibule
const MAP = [
  '##################VVV##############', // 0
  '##################cNc##############', // 1
  '##################ccc##############', // 2
  '##################ccc##############', // 3
  '###################D###############', // 4
  '###################.###############', // 5
  '#################...###############', // 6
  '#################.#################', // 7
  '#################.#################', // 8
  '#############pprrr#################', // 9
  '#############krrrr###########V#cccV', // 10
  'Vccc#########prrrp##########..DccEV', // 11
  'VWcc###########.############.##cccV', // 12
  'Vccc###########.#########VV#.######', // 13
  '##D############...######prrrr######', // 14
  '#V.##############.######rrrrr######', // 15
  '#V....###########D######prrpr######', // 16
  '#####.##########hhh######.#########', // 17
  '#####rrrp######hhhhh#####.#########', // 18
  '#####rrrr....DhhhhhhhD....#########', // 19
  '#####prrr#####hhhXhhh##############', // 20
  '##############hhhhhhh##############', // 21
  '##############VhhhhhV##############', // 22
  '###############VhhhV###############', // 23
  '################VSV################', // 24
  '#################S#################', // 25
  '#################R#################', // 26
];
const H = MAP.length, W = MAP[0].length, OX = 17, OZ = 20;
const WALKC = '.hcrDSXNEWpk';
const cx = (c) => (c - OX) * CELL, cz = (r) => (r - OZ) * CELL;
const ch = (c, r) => (r < 0 || r >= H || c < 0 || c >= W) ? ' ' : (MAP[r][c] || ' ');
const isWalk = (c, r) => { const k = ch(c, r); return k !== ' ' && WALKC.includes(k); };
const isHub = (c, r) => { const k = ch(c, r); return k === 'h' || k === 'X'; };
const isPath = (c, r) => isWalk(c, r) && ch(c, r) !== 'p' && ch(c, r) !== 'k';
const isSolid = (c, r) => { const k = ch(c, r); return k === '#' || k === 'V' || k === 'R'; };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const adjWalk = (c, r) => DIRS.some(([a, b]) => isWalk(c + a, r + b));
const adjHub = (c, r) => DIRS.some(([a, b]) => isHub(c + a, r + b));

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };

// Universe palettes: U0 derelict, U1 crimson nebula, U2 crystal, U3 inverted
const PAL = [
  { fog: 0x050c0e, dens: 0.042, vein: 0x22e8c8, sky: 0x4a7a80, gnd: 0x120808, hemi: 0.25, wall: 0xffffff, drive: 0x5affe6, spore: 0x7dffe8, light: 0x3ff0d0, cry: 0x2ad8ff, cryCol: 0x8feeff },
  { fog: 0x230406, dens: 0.048, vein: 0xff2a2a, sky: 0x8a2a2a, gnd: 0x180404, hemi: 0.28, wall: 0xffd4d0, drive: 0xff3a24, spore: 0xff6a4a, light: 0xff3d2e, cry: 0x2ad8ff, cryCol: 0x8feeff },
  { fog: 0x03131a, dens: 0.038, vein: 0x55f2ff, sky: 0x6ad0f0, gnd: 0x061018, hemi: 0.3, wall: 0xd8f2ff, drive: 0xa8faff, spore: 0xc0ffff, light: 0x7ff0ff, cry: 0x2ad8ff, cryCol: 0x9ff4ff },
  { fog: 0xdfe2e4, dens: 0.05, vein: 0x000000, sky: 0xffffff, gnd: 0x9a9a9a, hemi: 0.6, wall: 0xb8bcc0, drive: 0x050505, spore: 0x0a0a0a, light: 0xffffff, cry: 0x000000, cryCol: 0x141414 },
];
const PAL_COLORS = ['fog', 'vein', 'sky', 'gnd', 'wall', 'drive', 'spore', 'light', 'cry', 'cryCol'];
const PAL_NUMS = ['dens', 'hemi'];
const GRADE = [
  { saturation: 1, exposure: 1, tint: [1, 1, 1] },
  { saturation: 1.1, exposure: 1.05, tint: [1.08, 0.9, 0.9] },
  { saturation: 1.1, exposure: 1.05, tint: [0.9, 1.02, 1.1] },
  { saturation: 0.2, exposure: 1.25, tint: [1, 1, 1] },
];

const HALE_INTRO = [
  ['HALE', 'Rocket hull breached... and sealed. Something grew around us. We are inside the Ark.', 5.5],
  ['HALE', 'Three energy signatures: north, east and west wings. Warp cores, feeding the drive in this chamber.', 6],
  ['HALE', 'Keep your lights on. Something is moving inside the walls.', 4.5],
];
const HALE_JUMP = [
  null,
  [['HALE', 'Warp jump confirmed. Star catalogue... no match. This is not our universe.', 5.5]],
  [['HALE', 'Second jump. Crystalline growth across the hull. The Ark is... adapting.', 5]],
  [['HALE', 'All three cores awake. The drive is answering. Get to the hub.', 5]],
];
const LOGS = [
  [['KESTREL · CMDR. VOSS', '...Kestrel log. They pulled Haruki and Dee off Vesper. I followed them in.', 6],
    ['KESTREL · CMDR. VOSS', 'This is not a ship. It is a nursery. It keeps us in glass until it is hungry.', 5.5],
    ['KESTREL · CMDR. VOSS', 'The cores wake the drive. Every jump, the light changes... and more of them come aboard.', 6],
    ['HALE', 'No biosigns inside the pod. Recorder timestamp: 2063. Twenty-eight years.', 5]],
  [['KESTREL · DR. SATO', 'Day forty, maybe. The shadows that wear our shapes do not move while you watch them.', 6],
    ['KESTREL · DR. SATO', 'Put a light on them and they come apart like smoke. The crawlers hate light too. Keep your lamps charged.', 6.5]],
  [['KESTREL · ENG. MARLOW', 'Three cores. One heartbeat. Wake all three and the drive in the hub will take you anywhere.', 6],
    ['KESTREL · ENG. MARLOW', "Anywhere but home. Every jump shakes something loose in here. Don't stop moving.", 5.5]],
];
// battery cells [c,r], log spots [c,r] (log 0 = Kestrel pod)
const BATTERY_CELLS = [[19, 6], [16, 10], [6, 19], [3, 16], [27, 15], [29, 11]];
const LOG_CELLS = [null, [7, 20], [25, 15]];

function mergeGeos(list) {
  let n = 0; const parts = [];
  for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; parts.push(g); n += g.attributes.position.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function genVeins(R, S, n) {
  const out = [], stack = [];
  for (let i = 0; i < n; i++) stack.push([R() * S, R() * S, R() * Math.PI * 2, 2 + R() * 3.5, 0]);
  while (stack.length && out.length < 300) {
    let [x, y, a, w, d] = stack.pop();
    const pts = [[x, y]]; const len = 10 + (R() * 30 | 0);
    for (let k = 0; k < len; k++) {
      a += (R() - 0.5) * 0.7; x += Math.cos(a) * 7; y += Math.sin(a) * 7; pts.push([x, y]);
      if (R() < 0.08 && d < 3 && w > 0.9) stack.push([x, y, a + (R() < 0.5 ? 1 : -1) * (0.6 + R() * 0.6), w * 0.65, d + 1]);
    }
    out.push({ pts, w });
  }
  return out;
}
function strokeVeins(g, veins, style, wMul, wAdd) {
  g.strokeStyle = style; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const v of veins) {
    g.lineWidth = v.w * wMul + wAdd; g.beginPath(); g.moveTo(v.pts[0][0], v.pts[0][1]);
    for (let i = 1; i < v.pts.length; i++) g.lineTo(v.pts[i][0], v.pts[i][1]);
    g.stroke();
  }
}

export default class Level2 {
  static id = 'l2'; static title = 'CHAPTER II'; static subtitle = 'THE HOLLOW ARK';

  constructor(ctx) {
    this.ctx = ctx; this.t = 0;
    this.cores = [false, false, false]; this.universe = 0; this.uTarget = 0; this.driveDone = false;
    this.bats = BATTERY_CELLS.map(() => false);
    this.creatures = []; this.loops = []; this.disp = []; this.coreLoops = [];
    this.subQ = []; this.subT = 0; this.boost = 0; this.lastObj = null;
    this.netT = 0; this.tenT = 0; this.sparkT = 1; this.sparkN = 0;
    this.completeAt = Infinity; this.completed = false; this.logT = [-99, -99, -99];
    this.uBlend = 1; this.uDur = 2.2; this.cryGrow = 0; this.bdCur = 0; this.bdTo = 0;
    this._v = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._e = new THREE.Euler();
    this.createCreature = null;
    this.nCores = 0; this.jumpFx = [false, false, false]; // jumpFx: jump FX/lines already played on this peer
    this.loopRecs = []; this.loopRetryT = 2; this._dimCol = new THREE.Color(0x101010);
  }

  // ------------------------------------------------------------------ build
  async build(save) {
    const ctx = this.ctx;
    ctx.setOxygenDrain?.(0); ctx.footstepSound = 'footstep_metal'; ctx.setGravity?.(-18);
    try { const m = await import('../creatures/creatures.js'); this.createCreature = m.createCreature || null; } catch (e) { console.warn('[L2] creatures unavailable', e); }
    if (this._disposed) return; // level was torn down while the import was in flight
    this.low = ctx.quality === 'low';
    this.R = mulberry32(0xA2C0FFEE);
    this.root = new THREE.Group(); this.root.name = 'L2'; ctx.scene.add(this.root);
    const steps = ['_buildPalette', '_buildTextures', '_buildMaterials', '_buildEnv', '_buildShell', '_buildDetails', '_buildHub',
      '_buildCores', '_buildPods', '_buildDoors', '_buildRocket', '_buildPickups', '_buildCrystals', '_buildFx', '_buildColliders', '_buildCreatureSpecs'];
    for (const s of steps) { try { this[s](); } catch (e) { console.error('[L2] build step failed', s, e); } }
    // accept the level save ({cores}) or a whole store record ({levelSave:{cores}})
    const sv = save && typeof save === 'object' ? (Array.isArray(save.cores) ? save : (save.levelSave && Array.isArray(save.levelSave.cores) ? save.levelSave : null)) : null;
    if (sv) for (let i = 0; i < 3; i++) if (sv.cores[i]) { this._activateCore(i, true); this.jumpFx[i] = true; }
    this._syncCreatures();
    try { this._applyPal(); } catch (e) { console.error('[L2] palette', e); }
    ctx.audio?.ambience?.('l2');
    this.subT = 4.5;
    const n = this.nCores;
    if (n === 0) this._queue(HALE_INTRO);
    else if (n < 3) this._queue([['HALE', `Systems restored. ${n} of 3 warp cores awake.`, 4]]);
    else this._queue([['HALE', 'All cores awake. Engage the drive in the hub.', 4]]);
  }

  _buildPalette() {
    this.PALC = PAL.map((p) => { const o = {}; for (const k of PAL_COLORS) o[k] = new THREE.Color(p[k]); for (const k of PAL_NUMS) o[k] = p[k]; return o; });
    this.cur = this._snap(this.PALC[0]); this.from = this._snap(this.PALC[0]);
  }
  _snap(src) { const o = {}; for (const k of PAL_COLORS) o[k] = src[k].clone(); for (const k of PAL_NUMS) o[k] = src[k]; return o; }

  _tex(cv, rep) {
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4; if (rep) t.repeat.set(rep, rep); this.disp.push(t); return t;
  }
  _buildTextures() {
    const R = this.R;
    // wall: chitin plates + veins
    const S = 512, base = canvas(S, S), emi = canvas(S, S), g = base.getContext('2d'), e = emi.getContext('2d');
    g.fillStyle = '#17191b'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 220; i++) {
      const x = R() * S, y = R() * S, r = 10 + R() * 60, grd = g.createRadialGradient(x, y, 0, x, y, r);
      const v = R() < 0.5 ? 'rgba(64,40,40,' : 'rgba(8,12,14,';
      grd.addColorStop(0, v + (0.25 + R() * 0.3) + ')'); grd.addColorStop(1, v + '0)'); g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let x = 0; x < S; x += 64) {
      const grd = g.createLinearGradient(x, 0, x + 64, 0);
      grd.addColorStop(0, 'rgba(0,0,0,.6)'); grd.addColorStop(0.15, 'rgba(95,85,80,.22)'); grd.addColorStop(0.5, 'rgba(0,0,0,0)');
      grd.addColorStop(0.88, 'rgba(0,0,0,.35)'); grd.addColorStop(1, 'rgba(0,0,0,.65)'); g.fillStyle = grd; g.fillRect(x, 0, 64, S);
    }
    for (let i = 0; i < 4000; i++) { const b = R() < 0.5 ? 0 : 110; g.fillStyle = `rgba(${b},${b * 0.9 | 0},${b * 0.85 | 0},${R() * 0.09})`; g.fillRect(R() * S, R() * S, 2, 2); }
    const veins = genVeins(R, S, 18);
    strokeVeins(g, veins, 'rgba(6,3,3,.9)', 1, 3.5); strokeVeins(g, veins, 'rgba(80,46,50,.85)', 1, 0);
    e.fillStyle = '#000'; e.fillRect(0, 0, S, S); e.shadowColor = '#fff'; e.shadowBlur = 10;
    strokeVeins(e, veins, 'rgba(255,255,255,1)', 0.6, 0.4); e.shadowBlur = 0;
    this.tWall = this._tex(base); this.tWallE = this._tex(emi);
    // floor: fleshy base + grate slots
    const fb = canvas(S, S), fe = canvas(S, S), f = fb.getContext('2d'), fq = fe.getContext('2d');
    f.fillStyle = '#1c1212'; f.fillRect(0, 0, S, S);
    for (let i = 0; i < 160; i++) {
      const x = R() * S, y = R() * S, r = 14 + R() * 50, grd = f.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(${70 + R() * 40 | 0},28,30,.35)`); grd.addColorStop(1, 'rgba(40,10,12,0)'); f.fillStyle = grd; f.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const fv = genVeins(R, S, 10);
    fq.fillStyle = '#000'; fq.fillRect(0, 0, S, S); fq.shadowColor = '#fff'; fq.shadowBlur = 6;
    strokeVeins(fq, fv, 'rgba(255,255,255,.55)', 0.5, 0.5); fq.shadowBlur = 0;
    for (let y = 0; y < S; y += 64) for (let x = 0; x < S; x += 64) {
      for (let k = 0; k < 4; k++) {
        const sx = x + 8, sy = y + 6 + k * 14;
        f.fillStyle = 'rgba(0,0,0,.85)'; f.fillRect(sx, sy, 48, 7);
        f.fillStyle = 'rgba(120,110,105,.35)'; f.fillRect(sx, sy + 7, 48, 2);
      }
      f.strokeStyle = 'rgba(0,0,0,.7)'; f.lineWidth = 3; f.strokeRect(x + 2, y + 2, 60, 60);
    }
    strokeVeins(f, fv, 'rgba(90,30,36,.55)', 0.8, 0);
    this.tFloor = this._tex(fb); this.tFloorE = this._tex(fe);
    // membrane
    const mb = canvas(256, 256), m = mb.getContext('2d');
    const mg = m.createRadialGradient(128, 128, 10, 128, 128, 180); mg.addColorStop(0, '#7a3038'); mg.addColorStop(1, '#2a0c10');
    m.fillStyle = mg; m.fillRect(0, 0, 256, 256);
    strokeVeins(m, genVeins(R, 256, 9), 'rgba(20,4,6,.8)', 0.8, 1);
    this.tMem = this._tex(mb);
    // spore sprite
    const sp = canvas(64, 64), s = sp.getContext('2d'), sg = s.createRadialGradient(32, 32, 0, 32, 32, 32);
    sg.addColorStop(0, 'rgba(255,255,255,1)'); sg.addColorStop(0.3, 'rgba(255,255,255,.5)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    s.fillStyle = sg; s.fillRect(0, 0, 64, 64); this.tSpore = new THREE.CanvasTexture(sp); this.disp.push(this.tSpore);
    // backdrops
    this.tBack = [0, 1, 2, 3].map((k) => this._backdropTex(k));
  }
  _backdropTex(kind) {
    try { const t = new THREE.CanvasTexture(paintBackdrop(kind, mulberry32(991 + kind * 31))); t.colorSpace = THREE.SRGBColorSpace; this.disp.push(t); return t; } catch (e) { console.warn('[L2] backdrop', e); }
    const R = mulberry32(777 + kind * 31), c = canvas(1024, 512), g = c.getContext('2d');
    const neb = (cols, n, a, comp) => {
      g.globalCompositeOperation = comp || 'lighter';
      for (let i = 0; i < n; i++) {
        const x = R() * 1024, y = 256 + (R() - 0.5) * 300, r = 50 + R() * 220, col = cols[i % cols.length];
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a * (0.4 + R() * 0.6)})`); grd.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      g.globalCompositeOperation = 'source-over';
    };
    const stars = (n, rgb, big) => {
      for (let i = 0; i < n; i++) {
        const s = R() < 0.97 ? 0.5 + R() * 1.2 : 1.5 + R() * big;
        g.fillStyle = `rgba(${rgb},${0.35 + R() * 0.65})`; g.fillRect(R() * 1024, R() * 512, s, s);
      }
    };
    if (kind === 0) {
      g.fillStyle = '#010306'; g.fillRect(0, 0, 1024, 512);
      neb([[20, 70, 80], [10, 30, 60]], 14, 0.22); stars(1100, '220,240,255', 1.5);
    } else if (kind === 1) {
      g.fillStyle = '#0d0104'; g.fillRect(0, 0, 1024, 512);
      neb([[210, 20, 30], [255, 90, 40], [140, 0, 70], [255, 40, 60]], 34, 0.42); stars(900, '255,220,210', 2.5);
      neb([[255, 200, 160]], 4, 0.25);
    } else if (kind === 2) {
      g.fillStyle = '#010a12'; g.fillRect(0, 0, 1024, 512);
      neb([[20, 160, 200], [80, 240, 255], [10, 60, 120]], 22, 0.3);
      g.strokeStyle = 'rgba(140,240,255,.16)'; g.lineWidth = 1;
      for (let i = 0; i < 70; i++) { g.beginPath(); const x = R() * 1024, y = R() * 512, a = R() * Math.PI; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 300, y + Math.sin(a) * 160); g.stroke(); }
      const pg = g.createRadialGradient(700, 200, 10, 700, 200, 90); pg.addColorStop(0, '#e8ffff'); pg.addColorStop(0.7, '#3ab8d8'); pg.addColorStop(1, 'rgba(10,60,90,0)');
      g.fillStyle = pg; g.beginPath(); g.arc(700, 200, 90, 0, Math.PI * 2); g.fill();
      stars(1000, '190,250,255', 2.5);
    } else {
      g.fillStyle = '#f1f1ee'; g.fillRect(0, 0, 1024, 512);
      neb([[60, 60, 64], [20, 20, 24]], 18, 0.18, 'source-over'); stars(900, '0,0,0', 2);
      g.fillStyle = '#000'; g.beginPath(); g.arc(380, 230, 46, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3; g.beginPath(); g.arc(380, 230, 62, 0, Math.PI * 2); g.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; this.disp.push(t); return t;
  }

  _mat(m) { this.disp.push(m); return m; }
  _buildFx() { const f = new L2Fx(this); f.build(); this.fx2 = f; }
  _buildMaterials() {
    const v = this.PALC[0].vein;
    this.wallMat = this._mat(new THREE.MeshStandardMaterial({ map: this.tWall, emissiveMap: this.tWallE, emissive: v.clone(), emissiveIntensity: 0.9, roughness: 0.82, metalness: 0.15, bumpMap: this.tWall, bumpScale: 2.5 }));
    this.floorMat = this._mat(new THREE.MeshStandardMaterial({ map: this.tFloor, emissiveMap: this.tFloorE, emissive: v.clone(), emissiveIntensity: 0.5, roughness: 0.6, metalness: 0.3, bumpMap: this.tFloor, bumpScale: 2 }));
    this.ceilMat = this._mat(new THREE.MeshStandardMaterial({ map: this.tWall, emissiveMap: this.tWallE, emissive: v.clone(), emissiveIntensity: 0.4, color: 0x707070, roughness: 0.9 }));
    this.chitinMat = this._mat(new THREE.MeshStandardMaterial({ color: 0x15191b, roughness: 0.32, metalness: 0.55 }));
    this.tendrilMat = this._mat(new THREE.MeshStandardMaterial({ color: 0x1a0d0f, roughness: 0.45, metalness: 0.2 }));
    this.veinMat = this._mat(new THREE.MeshStandardMaterial({ color: 0x050505, emissive: v.clone(), emissiveIntensity: 2 }));
    this.memMat = this._mat(new THREE.MeshStandardMaterial({ map: this.tMem, emissiveMap: this.tWallE, emissive: v.clone(), emissiveIntensity: 0.8, transparent: true, opacity: 0.88, side: THREE.DoubleSide, roughness: 0.4 }));
    this.glassMat = this._mat(new THREE.MeshStandardMaterial({ color: 0x9fc8d0, transparent: true, opacity: 0.13, roughness: 0.05, metalness: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    this.fluidMat = this._mat(new THREE.MeshBasicMaterial({ color: v.clone().multiplyScalar(0.45), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.silMat = this._mat(new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.pulseMats = [this.wallMat, this.floorMat, this.ceilMat, this.veinMat, this.memMat];
  }

  _buildEnv() {
    const ctx = this.ctx, c0 = this.PALC[0];
    this.fog = new THREE.FogExp2(c0.fog.clone(), c0.dens); ctx.scene.fog = this.fog; ctx.scene.background = this.fog.color;
    this.hemi = new THREE.HemisphereLight(c0.sky.clone(), c0.gnd.clone(), c0.hemi); this.root.add(this.hemi);
    // universe backdrop spheres (follow camera, unfogged)
    this.bdGroup = new THREE.Group(); this.root.add(this.bdGroup);
    const sg = new THREE.SphereGeometry(140, 48, 24); this.disp.push(sg);
    this.bd = this.tBack.map((t, i) => {
      const m = this._mat(new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, depthWrite: false, transparent: true, opacity: i === 0 ? 1 : 0 }));
      const mesh = new THREE.Mesh(sg, m); mesh.renderOrder = -10; mesh.visible = i === 0; mesh.frustumCulled = false; this.bdGroup.add(mesh); return mesh;
    });
    // spores
    const R = this.R, N = this.low ? 350 : 800, pos = new Float32Array(N * 3), cells = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (isWalk(c, r)) cells.push([c, r]);
    for (let i = 0; i < N; i++) {
      const [c, r] = cells[(R() * cells.length) | 0], hub = isHub(c, r);
      pos[i * 3] = cx(c) + (R() - 0.5) * 4; pos[i * 3 + 1] = 0.2 + R() * (hub ? 14 : 4.6); pos[i * 3 + 2] = cz(r) + (R() - 0.5) * 4;
    }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); this.disp.push(pg);
    this.sporeMat = this._mat(new THREE.PointsMaterial({ map: this.tSpore, color: c0.spore.clone(), size: 0.09, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.spores = new THREE.Points(pg, this.sporeMat); this.spores.frustumCulled = false; this.root.add(this.spores);
  }

  _inst(geo, mat, list, fn) {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    list.forEach((it, i) => { fn(it, this._m); mesh.setMatrixAt(i, this._m); });
    mesh.count = list.length; mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere?.();
    this.root.add(mesh); this.disp.push(geo); return mesh;
  }

  _buildShell() {
    const shortW = [], tallW = [], lint = [], floors = [], vps = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const k = ch(c, r);
      if (isWalk(c, r)) { floors.push([c, r]); if (!isHub(c, r) && adjHub(c, r)) lint.push([c, r]); }
      else if (k === 'V') vps.push([c, r, adjHub(c, r)]);
      else if (isSolid(c, r) && adjWalk(c, r)) (adjHub(c, r) ? tallW : shortW).push([c, r]);
    }
    const gS = new THREE.BoxGeometry(CELL, WALL_H, CELL); gS.translate(0, WALL_H / 2, 0);
    const gT = new THREE.BoxGeometry(CELL, HUB_H, CELL); gT.translate(0, HUB_H / 2, 0);
    const uv = gT.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 3.2);
    this._inst(gS, this.wallMat, shortW, ([c, r], m) => m.makeTranslation(cx(c), 0, cz(r)));
    const tallAll = tallW.map((a) => [a[0], a[1], 0]).concat(lint.map((a) => [a[0], a[1], 1]));
    this._inst(gT, this.wallMat, tallAll, ([c, r, l], m) => {
      if (l) { m.makeScale(1, (HUB_H - WALL_H) / HUB_H, 1); m.setPosition(cx(c), WALL_H, cz(r)); } else m.makeTranslation(cx(c), 0, cz(r));
    });
    const gF = new THREE.PlaneGeometry(CELL, CELL); gF.rotateX(-Math.PI / 2);
    this._inst(gF, this.floorMat, floors, ([c, r], m) => m.makeTranslation(cx(c), 0, cz(r)));
    const gC = new THREE.PlaneGeometry(CELL, CELL); gC.rotateX(Math.PI / 2);
    this._inst(gC, this.ceilMat, floors, ([c, r], m) => m.makeTranslation(cx(c), isHub(c, r) ? HUB_H : WALL_H, cz(r)));
    // viewports: glass block + chitin frame posts
    const gG = new THREE.BoxGeometry(CELL * 0.98, 1, CELL * 0.98); gG.translate(0, 0.5, 0);
    this._inst(gG, this.glassMat, vps, ([c, r, tall], m) => { m.makeScale(1, tall ? HUB_H : WALL_H, 1); m.setPosition(cx(c), 0, cz(r)); }).renderOrder = 2;
    const posts = [];
    for (const [c, r, tall] of vps) {
      const h = tall ? HUB_H : WALL_H;
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) posts.push([cx(c) + a * 1.85, cz(r) + b * 1.85, h, 0]);
      for (let y = 1.6; y < h; y += tall ? 3.2 : 2.4) posts.push([cx(c), cz(r), y, 1]);
    }
    const gP = new THREE.BoxGeometry(1, 1, 1);
    this._inst(gP, this.chitinMat, posts, ([x, z, h, bar], m) => {
      if (bar) { m.makeScale(3.9, 0.22, 3.9); m.setPosition(x, h, z); } else { m.makeScale(0.42, h, 0.42); m.setPosition(x, h / 2, z); }
    });
    this.floorCells = floors;
  }

  _buildDetails() {
    const R = this.R;
    // corridor rib arches
    const tor = new THREE.TorusGeometry(1.88, 0.17, 6, 18, Math.PI); tor.translate(0, 2.9, 0);
    const p1 = new THREE.CylinderGeometry(0.17, 0.24, 2.9, 6); p1.translate(1.88, 1.45, 0);
    const p2 = new THREE.CylinderGeometry(0.17, 0.24, 2.9, 6); p2.translate(-1.88, 1.45, 0);
    const arch = mergeGeos([tor, p1, p2]); arch.scale(1, 1, 0.7);
    const arches = [];
    for (const [c, r] of this.floorCells) {
      const k = ch(c, r); if (k !== '.' && k !== 'D' && k !== 'S') continue;
      const ns = isWalk(c, r - 1) && isWalk(c, r + 1), ew = isWalk(c - 1, r) && isWalk(c + 1, r);
      if (ns === ew) continue;
      const offs = k === 'D' ? [-1.6, 1.6] : [-1, 1];
      for (const o of offs) arches.push(ns ? [cx(c), cz(r) + o, 0] : [cx(c) + o, cz(r), Math.PI / 2]);
    }
    this._inst(arch, this.chitinMat, arches, ([x, z, ry], m) => { m.makeRotationY(ry); m.setPosition(x, 0, z); });
    // hanging tendrils (merged) + glowing tips (instanced)
    const tubes = [], tips = [];
    for (const [c, r] of this.floorCells) {
      const hub = isHub(c, r), n = hub ? (R() < 0.3 ? 1 : 0) : (R() < (this.low ? 0.4 : 0.7) ? 1 + (R() < 0.4 ? 1 : 0) : 0);
      for (let i = 0; i < n; i++) {
        const top = hub ? HUB_H : WALL_H, x = cx(c) + (R() - 0.5) * 3.2, z = cz(r) + (R() - 0.5) * 3.2;
        const len = hub ? 4 + R() * 6 : 0.8 + R() * 1.6;
        const a = new THREE.Vector3(x, top, z), b = new THREE.Vector3(x + (R() - 0.5) * 0.8, top - len * 0.55, z + (R() - 0.5) * 0.8), e = new THREE.Vector3(x + (R() - 0.5) * 0.5, top - len, z + (R() - 0.5) * 0.5);
        tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, b, e]), 6, 0.03 + R() * 0.05, 4, false));
        tips.push(e);
      }
    }
    if (tubes.length) { const tg = mergeGeos(tubes); tubes.forEach((t) => t.dispose()); const tm = new THREE.Mesh(tg, this.tendrilMat); this.root.add(tm); this.disp.push(tg); }
    const tipG = new THREE.SphereGeometry(0.07, 6, 4);
    this._inst(tipG, this.veinMat, tips, (p, m) => m.makeTranslation(p.x, p.y, p.z));
  }

  _buildHub() {
    const g = new THREE.Group(); this.root.add(g); this.hub = g;
    // radial ribs
    const ribs = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.13, co = Math.cos(a), si = Math.sin(a);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(12 * co, 0, 12 * si), new THREE.Vector3(13 * co, 15.2, 13 * si), new THREE.Vector3(3.2 * co, 15.7, 3.2 * si));
      ribs.push(new THREE.TubeGeometry(curve, 22, 0.32, 6, false));
    }
    const ring = new THREE.TorusGeometry(3.2, 0.45, 8, 32); ring.rotateX(Math.PI / 2); ring.translate(0, 15.6, 0); ribs.push(ring);
    const rg = mergeGeos(ribs); ribs.forEach((x) => x.dispose()); this.disp.push(rg); g.add(new THREE.Mesh(rg, this.chitinMat));
    // pedestal + glowing inlay
    const ped = new THREE.CylinderGeometry(2.6, 3.3, 1.2, 28); this.disp.push(ped);
    const pm = new THREE.Mesh(ped, this.chitinMat); pm.position.y = 0.6; g.add(pm);
    const inl = new THREE.TorusGeometry(2.3, 0.07, 6, 48); inl.rotateX(Math.PI / 2); this.disp.push(inl);
    const im = new THREE.Mesh(inl, this.veinMat); im.position.y = 1.22; g.add(im);
    const floorRing = new THREE.TorusGeometry(6.5, 0.06, 6, 64); floorRing.rotateX(Math.PI / 2); this.disp.push(floorRing);
    const fr = new THREE.Mesh(floorRing, this.veinMat); fr.position.y = 0.03; g.add(fr);
    // energy column
    this.driveMat = this._mat(new THREE.MeshBasicMaterial({ color: this.PALC[0].drive.clone() }));
    this.driveGlowMat = this._mat(new THREE.MeshBasicMaterial({ color: this.PALC[0].drive.clone(), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const colG = new THREE.CylinderGeometry(0.6, 0.6, HUB_H - 1.2, 20, 1, true); this.disp.push(colG);
    this.column = new THREE.Mesh(colG, this.driveMat); this.column.position.y = 1.2 + (HUB_H - 1.2) / 2; g.add(this.column);
    const glG = new THREE.CylinderGeometry(1.5, 1.5, HUB_H - 1.2, 20, 1, true); this.disp.push(glG);
    this.columnGlow = new THREE.Mesh(glG, this.driveGlowMat); this.columnGlow.position.copy(this.column.position); g.add(this.columnGlow);
    // 3 counter-rotating rings
    this.rings = [];
    const rdefs = [[3.4, 0.22], [4.8, 0.3], [6.2, 0.38]];
    for (let i = 0; i < 3; i++) {
      const tg = new THREE.TorusGeometry(rdefs[i][0], rdefs[i][1], 10, 72); this.disp.push(tg);
      const piv = new THREE.Group(); piv.position.y = 8.2; g.add(piv);
      const ringM = new THREE.Mesh(tg, this.chitinMat); piv.add(ringM);
      const vg = new THREE.TorusGeometry(rdefs[i][0], rdefs[i][1] * 0.35, 6, 72); this.disp.push(vg);
      const vm = new THREE.Mesh(vg, this.veinMat); vm.position.z = rdefs[i][1] * 0.75; ringM.add(vm);
      const vm2 = new THREE.Mesh(vg, this.veinMat); vm2.position.z = -rdefs[i][1] * 0.75; ringM.add(vm2);
      piv.rotation.set(i === 0 ? 0.4 : i === 1 ? 1.2 : -0.7, i * 1.1, i === 2 ? 0.5 : 0);
      this.rings.push({ piv, ringM, dir: i === 1 ? -1 : 1, axis: i });
    }
    this.driveLight = new THREE.PointLight(this.PALC[0].drive.clone(), 90, 40, 2); this.driveLight.position.set(0, 7, 0); g.add(this.driveLight);
    // drive console (south of pedestal, facing the vestibule)
    this.driveCon = this._makeConsole(0, 5.6, 0, 0xff2020);
    this.ctx.interact?.add?.({
      id: 'l2_drive', object: this.driveCon.g, radius: 2.4, prompt: 'Engage the warp drive', holdTime: 5, enabled: false,
      onInteract: () => { if (!this.driveDone && this.cores.every(Boolean)) this.ctx.levelEvent?.('drive', {}); },
    });
    this.ctx.audio && (this.hubLoop = this._loop('engine_hum', new THREE.Vector3(0, 3, 0), 0.35));
  }

  // Positional loop behind a proxy: if audio isn't initialised yet (no user gesture, e.g. ?level=2) audio.loop()
  // hands back an inert stub, so the real loop is (re)created later from update() via _retryLoops().
  _loop(name, pos, vol) {
    const rec = { name, pos, vol, h: null, stopped: false };
    const proxy = {
      setVolume: (v) => { rec.vol = v; try { rec.h?.setVolume?.(v); } catch (e) { /* */ } },
      setPosition: (p) => { rec.pos = p; try { rec.h?.setPosition?.(p); } catch (e) { /* */ } },
      stop: (f) => { if (rec.stopped) return; rec.stopped = true; try { rec.h?.stop?.(f); } catch (e) { /* */ } rec.h = null; },
    };
    this.loopRecs.push(rec); this.loops.push(proxy);
    this._tryLoop(rec);
    return proxy;
  }
  _tryLoop(rec) {
    if (rec.stopped || rec.h) return;
    try {
      const h = this.ctx.audio?.loop?.(rec.name, { position: rec.pos, volume: rec.vol });
      const inert = !h || typeof h.setVolume !== 'function' || String(h.setVolume).replace(/\s/g, '').length < 40;
      if (inert) { try { h?.stop?.(0); } catch (e) { /* */ } rec.h = null; } else rec.h = h;
    } catch (e) { rec.h = null; }
  }
  _retryLoops(dt) {
    this.loopRetryT -= dt; if (this.loopRetryT > 0) return; this.loopRetryT = 2;
    for (const rec of this.loopRecs) if (!rec.h && !rec.stopped) this._tryLoop(rec);
  }

  _makeConsole(x, z, yaw, color) {
    if (!this.geoCon) {
      this.geoCon = { ped: new THREE.CylinderGeometry(0.26, 0.48, 1.0, 8), panel: new THREE.BoxGeometry(0.95, 0.06, 0.6), horn: new THREE.TorusGeometry(0.55, 0.05, 5, 12, Math.PI) };
      for (const k in this.geoCon) this.disp.push(this.geoCon[k]);
    }
    const G = this.geoCon, g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
    const ped = new THREE.Mesh(G.ped, this.chitinMat); ped.position.y = 0.5; g.add(ped);
    const pm = this._mat(new THREE.MeshStandardMaterial({ color: 0x050505, emissive: new THREE.Color(color), emissiveIntensity: 1.6, roughness: 0.3 }));
    const panel = new THREE.Mesh(G.panel, pm); panel.position.set(0, 1.06, 0.05); panel.rotation.x = 0.55; g.add(panel);
    const horn = new THREE.Mesh(G.horn, this.chitinMat); horn.position.set(0, 0.95, -0.25); horn.scale.set(1, 1.3, 1); g.add(horn);
    this.root.add(g);
    this.ctx.world?.addBox?.(new THREE.Vector3(x - 0.55, 0, z - 0.55), new THREE.Vector3(x + 0.55, 1.15, z + 0.55));
    return { g, pm };
  }

  _buildCores() {
    // [console cell, chamber center cell]
    const defs = [[[19, 1], [19, 2]], [[33, 11], [32, 11]], [[1, 12], [2, 12]]];
    this.coreObjs = [];
    const baseG = new THREE.CylinderGeometry(1.1, 1.45, 0.6, 14), capG = new THREE.CapsuleGeometry(0.42, 2.6, 6, 14), topG = new THREE.CylinderGeometry(1.2, 0.7, 0.5, 14);
    const cage = []; for (let i = 0; i < 4; i++) { const t = new THREE.TorusGeometry(0.95, 0.07, 5, 16, Math.PI); t.rotateZ(Math.PI / 2); t.scale(1, 2, 1); t.rotateY(i * Math.PI / 2); t.translate(0, 2.4, 0); cage.push(t); }
    const cageG = mergeGeos(cage); cage.forEach((t) => t.dispose());
    this.disp.push(baseG, capG, topG, cageG);
    defs.forEach(([[kc, kr], [mc, mr]], i) => {
      const mx = cx(mc), mz = cz(mr), kx = cx(kc), kz = cz(kr);
      const dx = mx - kx, dz = mz - kz, len = Math.hypot(dx, dz) || 1;
      const conX = kx - (dx / len) * 1.0, conZ = kz - (dz / len) * 1.0;
      const con = this._makeConsole(conX, conZ, Math.atan2(dx, dz), 0xffa040);
      const g = new THREE.Group(); g.position.set(mx, 0, mz); this.root.add(g);
      const b = new THREE.Mesh(baseG, this.chitinMat); b.position.y = 0.3; g.add(b);
      const mat = this._mat(new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: this.PALC[0].vein.clone().multiplyScalar(0.3), emissiveIntensity: 1, roughness: 0.2 }));
      const cap = new THREE.Mesh(capG, mat); cap.position.y = 2.4; g.add(cap);
      const cg = new THREE.Mesh(cageG, this.chitinMat); g.add(cg);
      const top = new THREE.Mesh(topG, this.chitinMat); top.position.y = 4.35; g.add(top);
      const light = new THREE.PointLight(this.PALC[0].vein.clone(), 8, 16, 2); light.position.y = 2.6; g.add(light);
      this.ctx.world?.addBox?.(new THREE.Vector3(mx - 1.2, 0, mz - 1.2), new THREE.Vector3(mx + 1.2, 4.6, mz + 1.2));
      const id = 'l2_core' + i;
      this.ctx.interact?.add?.({
        id, object: con.g, radius: 2.4, prompt: 'Activate warp core', holdTime: 4, enabled: true,
        onInteract: () => { if (!this.cores[i]) this.ctx.levelEvent?.('jump', { core: i }); },
      });
      this.coreLoops[i] = this._loop('warp_core', new THREE.Vector3(mx, 2, mz), 0.3);
      this.coreObjs.push({ g, cap, cg, mat, light, con, active: false, spin: 0, pos: new THREE.Vector3(mx, 2.4, mz) });
    });
  }

  _buildPods() {
    const pods = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const k = ch(c, r); if (k === 'p' || k === 'k') pods.push([c, r, k === 'k']); }
    const glassG = new THREE.CylinderGeometry(0.92, 0.92, 3.1, 22, 1, true); glassG.translate(0, 1.95, 0);
    const fluidG = new THREE.CylinderGeometry(0.86, 0.86, 3.0, 18, 1, true); fluidG.translate(0, 1.95, 0);
    const c1 = new THREE.CylinderGeometry(1.0, 1.1, 0.4, 18); c1.translate(0, 0.2, 0);
    const c2 = new THREE.CylinderGeometry(1.1, 0.95, 0.45, 18); c2.translate(0, 3.7, 0);
    const c3 = new THREE.CylinderGeometry(0.12, 0.16, 1.2, 6); c3.translate(0.35, 4.5, 0);
    const c4 = new THREE.CylinderGeometry(0.1, 0.14, 1.2, 6); c4.translate(-0.4, 4.5, 0.2);
    const capsG = mergeGeos([c1, c2, c3, c4]); [c1, c2, c3, c4].forEach((x) => x.dispose());
    // alien silhouette
    const parts = [];
    const torso = new THREE.CapsuleGeometry(0.2, 0.8, 4, 8); torso.translate(0, 1.95, 0); parts.push(torso);
    const head = new THREE.SphereGeometry(0.22, 10, 8); head.scale(0.7, 1.6, 0.9); head.translate(0, 2.75, 0.05); parts.push(head);
    for (const s of [-1, 1]) {
      const arm = new THREE.CapsuleGeometry(0.05, 1.25, 3, 6); arm.rotateZ(s * 0.18); arm.translate(s * 0.34, 1.6, 0); parts.push(arm);
      const leg = new THREE.CapsuleGeometry(0.07, 0.9, 3, 6); leg.rotateZ(s * 0.08); leg.translate(s * 0.12, 0.95, 0); parts.push(leg);
    }
    const silG = mergeGeos(parts); parts.forEach((x) => x.dispose());
    const all = pods.map(([c, r]) => [cx(c), cz(r)]);
    this._inst(glassG, this.glassMat, all, ([x, z], m) => m.makeTranslation(x, 0, z)).renderOrder = 3;
    this._inst(fluidG, this.fluidMat, all, ([x, z], m) => m.makeTranslation(x, 0, z)).renderOrder = 1;
    this._inst(capsG, this.chitinMat, all, ([x, z], m) => m.makeTranslation(x, 0, z));
    const sils = pods.filter((p) => !p[2]).map(([c, r], i) => [cx(c), cz(r), i * 1.7]);
    this.sil = this._inst(silG, this.silMat, sils, ([x, z, ph], m) => { m.makeRotationY(ph); m.setPosition(x, 0, z); });
    this.silData = sils;
    for (const [x, z] of all) this.ctx.world?.addBox?.(new THREE.Vector3(x - 1.0, 0, z - 1.0), new THREE.Vector3(x + 1.0, 4.0, z + 1.0));
    // Kestrel astronaut
    const kp = pods.find((p) => p[2]);
    if (kp) {
      const kx = cx(kp[0]), kz = cz(kp[1]);
      const suit = this._mat(new THREE.MeshStandardMaterial({ color: 0xd9d4c6, roughness: 0.7 }));
      const visor = this._mat(new THREE.MeshStandardMaterial({ color: 0x3a2a08, metalness: 1, roughness: 0.15, emissive: 0x201000 }));
      const a = new THREE.Group(); a.position.set(kx, 0, kz); a.rotation.y = Math.PI / 2;
      const geos = [new THREE.CapsuleGeometry(0.27, 0.55, 4, 10), new THREE.SphereGeometry(0.25, 14, 10), new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.2),
        new THREE.BoxGeometry(0.42, 0.55, 0.22), new THREE.CapsuleGeometry(0.08, 0.5, 3, 6), new THREE.CapsuleGeometry(0.1, 0.62, 3, 6)];
      this.disp.push(...geos);
      const add = (geo, mat, x, y, z, rx, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, 0, rz || 0); a.add(m); return m; };
      add(geos[0], suit, 0, 1.75, 0); add(geos[1], suit, 0, 2.38, 0); add(geos[2], visor, 0, 2.4, 0.08, Math.PI / 2); add(geos[3], suit, 0, 1.85, -0.3);
      add(geos[4], suit, 0.38, 1.7, 0, 0, 0.35); add(geos[4], suit, -0.38, 1.7, 0, 0, -0.35); add(geos[5], suit, 0.13, 0.95, 0, 0, 0.06); add(geos[5], suit, -0.13, 0.95, 0, 0, -0.06);
      this.root.add(a); this.kestrel = a;
      this.ctx.interact?.add?.({ id: 'l2_kestrel', object: a, radius: 2.8, prompt: 'Inspect the specimen pod', holdTime: 0, enabled: true, onInteract: () => this.ctx.levelEvent?.('log', { i: 0 }) });
    }
  }

  _buildDoors() {
    this.doors = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (ch(c, r) === 'D') {
      const ns = isWalk(c, r - 1) && isWalk(c, r + 1);
      this.doors.push({ x: cx(c), z: cz(r), ns, open: 0, target: 0, pos: new THREE.Vector3(cx(c), 1.5, cz(r)) });
    }
    const pg = new THREE.PlaneGeometry(2.05, 4.7); pg.translate(0, 2.35, 0);
    this.doorMesh = new THREE.InstancedMesh(pg, this.memMat, this.doors.length * 2); this.doorMesh.frustumCulled = false;
    this.root.add(this.doorMesh); this.disp.push(pg);
    this._updateDoors(0, true);
  }
  _updateDoors(dt, force) {
    const ctx = this.ctx; let any = force;
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i]; let near = false;
      if (ctx.players) for (const p of ctx.players.values()) { const pp = p.position; if (pp && Math.abs(pp.x - d.x) < 5 && Math.abs(pp.z - d.z) < 5) { near = true; break; } }
      if (!near) for (const cr of this.creatures) { const cp = cr?.position; if (cp && Math.abs(cp.x - d.x) < 4.5 && Math.abs(cp.z - d.z) < 4.5) { near = true; break; } }
      const tgt = near ? 1 : 0;
      if (tgt !== d.target) { d.target = tgt; if (!force) ctx.audio?.play?.('door', { position: d.pos, volume: 0.6 }); }
      if (d.open !== d.target) { any = true; d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), dt * 1.8); }
      if (any || force) {
        const o = smooth(d.open);
        for (let j = 0; j < 2; j++) {
          const s = j ? 1 : -1, off = s * (1.02 + o * 2.0);
          this._m.makeRotationY(d.ns ? 0 : Math.PI / 2);
          this._m.setPosition(d.ns ? d.x + off : d.x, 0, d.ns ? d.z : d.z + off);
          this.doorMesh.setMatrixAt(i * 2 + j, this._m);
        }
      }
    }
    if (any) this.doorMesh.instanceMatrix.needsUpdate = true;
  }

  _buildRocket() {
    const g = new THREE.Group(); g.position.set(0, 0, 0); this.root.add(g);
    const hull = this._mat(new THREE.MeshStandardMaterial({ color: 0xcfc8bb, roughness: 0.55, metalness: 0.35 }));
    const scorch = this._mat(new THREE.MeshStandardMaterial({ color: 0x241e1a, roughness: 0.9 }));
    const red = this._mat(new THREE.MeshStandardMaterial({ color: 0x8a1c14, roughness: 0.6 }));
    const cone = new THREE.ConeGeometry(1.4, 2.4, 24); cone.rotateX(-Math.PI / 2);
    const body = new THREE.CylinderGeometry(1.4, 1.4, 3, 24); body.rotateX(Math.PI / 2);
    const band = new THREE.CylinderGeometry(1.43, 1.43, 0.3, 24); band.rotateX(Math.PI / 2);
    const flesh = new THREE.TorusGeometry(1.55, 0.35, 8, 24);
    this.disp.push(cone, body, band, flesh);
    const m1 = new THREE.Mesh(cone, hull); m1.position.set(0, 1.8, 19.4); g.add(m1);
    const m2 = new THREE.Mesh(body, scorch); m2.position.set(0, 1.8, 22.1); g.add(m2);
    const m3 = new THREE.Mesh(band, red); m3.position.set(0, 1.8, 20.85); g.add(m3);
    const m4 = new THREE.Mesh(flesh, this.tendrilMat); m4.position.set(0, 1.8, 21.95); m4.scale.set(1.15, 1.15, 0.8); g.add(m4);
    const spikes = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, s = new THREE.ConeGeometry(0.16, 1.1 + (i % 3) * 0.4, 5);
      s.rotateZ(-Math.PI / 2); s.translate(1.75, 0, 0); s.rotateY(-0.35); s.rotateZ(a); s.translate(0, 1.8, 21.7); spikes.push(s);
    }
    const sg = mergeGeos(spikes); spikes.forEach((x) => x.dispose()); this.disp.push(sg);
    const sm = new THREE.Mesh(sg, this.chitinMat); sm.scale.set(1, 1, 1); g.add(sm);
    this.ctx.world?.addBox?.(new THREE.Vector3(-1.45, 0, 18.2), new THREE.Vector3(1.45, 3.3, 22.2));
    this.sparkPos = new THREE.Vector3(0.95, 2.9, 21.6);
    this.rocketLight = new THREE.PointLight(0xff8a3a, 10, 12, 2); this.rocketLight.position.set(0, 3.6, 18.6); g.add(this.rocketLight);
  }

  _buildPickups() {
    const bodyG = new THREE.CylinderGeometry(0.11, 0.11, 0.34, 10), capG = new THREE.CylinderGeometry(0.118, 0.118, 0.08, 10);
    const bodyM = this._mat(new THREE.MeshStandardMaterial({ color: 0x2a2f33, metalness: 0.7, roughness: 0.35 }));
    const capM = this._mat(new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x6fe8ff, emissiveIntensity: 2.2 }));
    this.disp.push(bodyG, capG);
    this.batObjs = BATTERY_CELLS.map(([c, r], i) => {
      const g = new THREE.Group(); g.position.set(cx(c) + 0.6, 1.0, cz(r) - 0.6);
      g.add(new THREE.Mesh(bodyG, bodyM)); const cap = new THREE.Mesh(capG, capM); cap.position.y = 0.2; g.add(cap);
      const cap2 = new THREE.Mesh(capG, capM); cap2.position.y = -0.05; cap2.scale.set(1.02, 0.5, 1.02); g.add(cap2);
      this.root.add(g);
      this.ctx.interact?.add?.({
        id: 'l2_bat' + i, object: g, radius: 2.0, prompt: 'Take battery cell', holdTime: 1, enabled: true,
        onInteract: (pid) => { if (this.bats[i]) return; this.ctx.givePlayer?.(pid, { battery: 60 }); this.ctx.levelEvent?.('bat', { i }); },
      });
      return g;
    });
    // log recorders
    const recG = new THREE.BoxGeometry(0.34, 0.16, 0.44), pedG = new THREE.CylinderGeometry(0.12, 0.3, 0.9, 7);
    const recM = this._mat(new THREE.MeshStandardMaterial({ color: 0xbdb6a6, roughness: 0.6 }));
    this.recLed = this._mat(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa020, emissiveIntensity: 2 }));
    const ledG = new THREE.SphereGeometry(0.035, 6, 4); this.disp.push(recG, pedG, ledG);
    LOG_CELLS.forEach((cell, i) => {
      if (!cell) return;
      const g = new THREE.Group(); g.position.set(cx(cell[0]), 0, cz(cell[1]));
      const p = new THREE.Mesh(pedG, this.tendrilMat); p.position.y = 0.45; g.add(p);
      const rec = new THREE.Mesh(recG, recM); rec.position.y = 0.98; rec.rotation.y = 0.5; g.add(rec);
      const led = new THREE.Mesh(ledG, this.recLed); led.position.set(0.1, 1.08, 0.1); g.add(led);
      this.root.add(g);
      this.ctx.interact?.add?.({ id: 'l2_log' + i, object: g, radius: 2.2, prompt: 'Play Kestrel recording', holdTime: 0, enabled: true, onInteract: () => this.ctx.levelEvent?.('log', { i }) });
    });
  }

  _buildCrystals() {
    const R = mulberry32(4242), N = this.low ? 150 : 260, data = [], UP = new THREE.Vector3(0, 1, 0);
    const faces = [];
    for (const [c, r] of this.floorCells) for (const [a, b] of DIRS) if (ch(c + a, r + b) === '#') faces.push([c, r, a, b, isHub(c, r)]);
    for (let i = 0; i < N && faces.length; i++) {
      const [c, r, a, b, hub] = faces[(R() * faces.length) | 0];
      const n = new THREE.Vector3(-a, 0, -b), t = new THREE.Vector3(b, 0, -a);
      const floorC = R() < 0.3;
      const p = new THREE.Vector3(cx(c) + a * 1.95, floorC ? 0 : 0.3 + R() * (hub ? 11 : 4.3), cz(r) + b * 1.95).addScaledVector(t, (R() - 0.5) * 3.4);
      const dir = n.clone().multiplyScalar(floorC ? 0.5 : 1).add(new THREE.Vector3((R() - 0.5) * 0.7, floorC ? 1 : (R() - 0.3) * 0.9, (R() - 0.5) * 0.7)).normalize();
      data.push({ p, q: new THREE.Quaternion().setFromUnitVectors(UP, dir), s: (floorC ? 0.6 : 0.35) + R() * 0.9, d: R() * 0.6 });
    }
    const g = new THREE.OctahedronGeometry(0.5, 0); g.scale(0.45, 2.3, 0.45); g.translate(0, 1.0, 0); this.disp.push(g);
    this.cryMat = this._mat(new THREE.MeshStandardMaterial({ color: this.PALC[2].cryCol.clone(), emissive: this.PALC[2].cry.clone(), emissiveIntensity: 1.1, roughness: 0.12, metalness: 0.2, flatShading: true }));
    this.cry = new THREE.InstancedMesh(g, this.cryMat, Math.max(1, data.length)); this.cry.frustumCulled = false; this.cry.visible = false;
    this.cryData = data; this.root.add(this.cry); this._updateCrystals();
  }
  _updateCrystals() {
    if (!this.cry || !this.cryData) return;
    const g = this.cryGrow;
    for (let i = 0; i < this.cryData.length; i++) {
      const d = this.cryData[i], k = smooth(g * 1.6 - d.d), s = d.s * k + 1e-4;
      this._m.compose(d.p, d.q, this._s.set(s, s, s)); this.cry.setMatrixAt(i, this._m);
    }
    this.cry.instanceMatrix.needsUpdate = true; this.cry.visible = g > 0;
  }

  _buildColliders() {
    const w = this.ctx.world; if (!w) return;
    for (let r = 0; r < H; r++) {
      let c = 0;
      while (c < W) {
        if (!isSolid(c, r)) { c++; continue; }
        const s = c; while (c < W && isSolid(c, r)) c++;
        w.addBox(new THREE.Vector3(cx(s) - 2, 0, cz(r) - 2), new THREE.Vector3(cx(c - 1) + 2, 6, cz(r) + 2));
      }
    }
    w.addBox(new THREE.Vector3(cx(0) - 4, -2, cz(0) - 4), new THREE.Vector3(cx(W - 1) + 4, 0, cz(H - 1) + 4));
    w.addBox(new THREE.Vector3(-2.5, 0, -2.5), new THREE.Vector3(2.5, 3, 2.5)); // drive pedestal
    w.bounds = { minX: cx(0) - 2, maxX: cx(W - 1) + 2, minZ: cz(0) - 2, maxZ: cz(H - 1) + 2 };
  }

  _bfs(sc, sr, gc, gr) {
    const key = (c, r) => r * W + c, prev = new Map([[key(sc, sr), -1]]), q = [[sc, sr]];
    while (q.length) {
      const [c, r] = q.shift(); if (c === gc && r === gr) break;
      for (const [a, b] of DIRS) { const nc = c + a, nr = r + b, k = key(nc, nr); if (!isPath(nc, nr) || prev.has(k)) continue; prev.set(k, key(c, r)); q.push([nc, nr]); }
    }
    const out = []; let k = key(gc, gr); if (!prev.has(k)) return [[sc, sr]];
    while (k !== -1) { out.push([k % W, (k / W) | 0]); k = prev.get(k); }
    return out.reverse();
  }
  _buildCreatureSpecs() {
    const V = (c, r) => new THREE.Vector3(cx(c), 0, cz(r));
    const wing = (a, b) => { const p = this._bfs(a[0], a[1], b[0], b[1]).map(([c, r]) => V(c, r)); return p.concat(p.slice(1, -1).reverse()); };
    // patrols end at the chamber cell in front of each core (the core centre cell is inside the core's collider)
    const north = wing([17, 16], [19, 3]), east = wing([21, 19], [31, 11]), west = wing([13, 19], [2, 13]);
    const mid = (p) => p[Math.floor(p.length / 4)].clone();
    const ring = []; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ring.push(new THREE.Vector3(Math.cos(a) * 8.5, 0, Math.sin(a) * 8.5)); }
    this.patrols = { north, east, west };
    this.specs = [
      { type: 'crawler', pos: mid(north), patrol: north },
      { type: 'crawler', pos: mid(east), patrol: east },
      { type: 'mimic', pos: V(16, 9), patrol: [V(16, 9), north[Math.floor(north.length / 2)].clone(), north[north.length - 2].clone(), mid(east)] },
      { type: 'mimic', pos: V(2, 15), patrol: [V(2, 15), west[Math.floor(west.length / 2)].clone(), west[west.length - 2].clone(), east[east.length - 2].clone()] },
      { type: 'crawler', pos: mid(west), patrol: west },
      { type: 'crawler', pos: ring[4].clone(), patrol: ring },
      { type: 'crawler', pos: east[Math.floor(east.length / 3)].clone(), patrol: east },
    ];
  }
  _syncCreatures() {
    if (!this.createCreature || !this.specs) return;
    // spawn order is fixed (specs order) and keyed only on the core count, so every peer builds the same list
    const target = Math.min(this.specs.length, 4 + Math.min(3, this.nCores));
    while (this.creatures.length < target) {
      const s = this.specs[this.creatures.length]; let c = null;
      try { c = this.createCreature(s.type, this.ctx, { position: s.pos.clone(), patrol: s.patrol.map((p) => p.clone()) }); } catch (e) { console.warn('[L2] creature spawn failed', e); }
      this.creatures.push(c);
    }
  }

  // ------------------------------------------------------------------ universe
  _setUniverse(n, instant) {
    n = Math.max(0, Math.min(3, n));
    if (n === this.uTarget && !instant) return;
    this.uTarget = n; this.universe = n; this.from = this._snap(this.cur);
    this.bdTo = n; this.bd.forEach((m, j) => { if (j !== this.bdCur && j !== n) m.visible = false; }); this.bd[n].visible = true; this.bd[n].renderOrder = -9;
    this.ctx.fx?.setGrade?.(GRADE[n], instant ? 0 : this.uDur);
    this.sporeMat.blending = n === 3 ? THREE.NormalBlending : THREE.AdditiveBlending; this.sporeMat.needsUpdate = true;
    this.fluidMat.blending = n === 3 ? THREE.NormalBlending : THREE.AdditiveBlending; this.fluidMat.needsUpdate = true;
    this.uBlend = 0;
    if (instant) { this._stepPal(1); this.cryGrow = n >= 2 ? 1 : 0; this._updateCrystals(); }
  }
  _stepPal(b) {
    this.uBlend = b; const k = smooth(b), to = this.PALC[this.uTarget];
    for (const key of PAL_COLORS) this.cur[key].lerpColors(this.from[key], to[key], k);
    for (const key of PAL_NUMS) this.cur[key] = this.from[key] + (to[key] - this.from[key]) * k;
    if (this.bdTo !== this.bdCur) {
      const a = this.bd[this.bdCur], z = this.bd[this.bdTo];
      a.material.opacity = 1; a.renderOrder = -10; z.material.opacity = k;
      if (b >= 1) { a.visible = false; z.renderOrder = -10; z.material.opacity = 1; this.bdCur = this.bdTo; }
    }
    this._applyPal();
  }
  _applyPal() {
    const c = this.cur; if (!c || !this.fog) return;
    this.fog.color.copy(c.fog); this.fog.density = c.dens;
    this.hemi.color.copy(c.sky); this.hemi.groundColor.copy(c.gnd); this.hemi.intensity = c.hemi;
    this.wallMat.color.copy(c.wall); this.floorMat.color.copy(c.wall); this.ceilMat.color.copy(c.wall).multiplyScalar(0.45);
    for (const m of this.pulseMats) m.emissive.copy(c.vein);
    this.fluidMat.color.copy(c.vein).multiplyScalar(0.45);
    if (this.driveMat) { this.driveMat.color.copy(c.drive); this.driveGlowMat.color.copy(c.drive); this.driveLight.color.copy(c.drive); }
    this.sporeMat.color.copy(c.spore);
    if (this.cryMat) { this.cryMat.color.copy(c.cryCol); this.cryMat.emissive.copy(c.cry); }
    if (this.coreObjs) for (const o of this.coreObjs) {
      if (o.active) { o.mat.emissive.copy(c.light); o.light.color.copy(c.light); o.con.pm.emissive.copy(c.light); }
      else { o.mat.emissive.copy(c.vein).multiplyScalar(0.3); o.light.color.copy(c.vein); }
    }
    if (this.driveCon && this.nCores >= 3) this.driveCon.pm.emissive.copy(this.universe === 3 ? this._dimCol : c.light);
    try { this.fx2?.applyPal(c, this.universe); } catch (e) { /* */ }
  }

  // ------------------------------------------------------------------ gameplay
  _activateCore(i, instant) {
    if (!(i >= 0 && i < 3) || this.cores[i]) return false;
    this.cores[i] = true;
    const n = this.nCores = this.cores.filter(Boolean).length, o = this.coreObjs?.[i];
    this.ctx.interact?.setEnabled?.('l2_core' + i, false);
    // visuals must never block the gameplay state below (drive unlock + creature spawns)
    try {
      if (o) { o.active = true; o.light.intensity = 40; }
      this.coreLoops[i]?.setVolume?.(0.85);
      this._setUniverse(n, instant);
    } catch (e) { console.error('[L2] core visuals', e); }
    if (n >= 3) { this.ctx.interact?.setEnabled?.('l2_drive', true); try { this.hubLoop?.setVolume?.(0.9); } catch (e) { /* */ } }
    this._syncCreatures();
    try { this._applyPal(); } catch (e) { /* */ }
    return true;
  }
  _takeBattery(i, silent) {
    if (this.bats[i]) return; this.bats[i] = true;
    const g = this.batObjs?.[i]; if (g) { g.visible = false; if (!silent) this.ctx.audio?.play?.('pickup', { position: g.position, volume: 0.8 }); }
    this.ctx.interact?.remove?.('l2_bat' + i);
  }
  _engageDrive() {
    if (this.driveDone) return; this.driveDone = true;
    this.ctx.interact?.setEnabled?.('l2_drive', false);
    this.subQ.length = 0; this.subT = 0; this._queue([['HALE', 'Coordinates... unknown. Engaging.', 4]]);
    this.ctx.fx?.flash?.(0xffffff, 0.6, 1.5); this.ctx.fx?.shake?.(0.5, 4); this.ctx.fx?.pulseGlitch?.(0.6, 2);
    this.ctx.audio?.play?.('warp', { volume: 1 }); this.ctx.audio?.play?.('metal_groan', { volume: 0.9 });
    this.boost = 3; this.completeAt = this.t + 4.2;
  }
  _queue(lines) { for (const l of lines) this.subQ.push(l); }

  onEvent(type, data, fromId) {
    const ctx = this.ctx;
    try {
      if (type === 'jump') {
        const i = data?.core | 0;
        if (i < 0 || i > 2) return;
        const fresh = this._activateCore(i, false);
        // a client may already have the core from a level-state packet: still play the jump once here
        if (!fresh && this.jumpFx[i]) return;
        this.jumpFx[i] = true;
        const n = this.jumpFx.filter(Boolean).length;
        ctx.fx?.flash?.(0xffffff, 1, 1.3); ctx.fx?.pulseGlitch?.(0.9, 1.4); ctx.fx?.shake?.(0.7, 1.8);
        ctx.audio?.play?.('warp', { volume: 1 }); ctx.audio?.play?.('metal_groan', { volume: 0.8 });
        this.boost = 2.5;
        if (HALE_JUMP[n] && !this.driveDone) { this.subQ.length = 0; this.subT = 2.2; this._queue(HALE_JUMP[n]); }
        if (fresh && ctx.isHost) ctx.checkpoint?.();
      } else if (type === 'drive') {
        this._engageDrive();
      } else if (type === 'bat') {
        const i = data?.i | 0;
        if (i >= 0 && i < this.bats.length) this._takeBattery(i, false);
      } else if (type === 'log') {
        const i = data?.i | 0;
        if (!LOGS[i] || this.t - this.logT[i] < 12) return;
        this.logT[i] = this.t; this.subQ.length = 0; this.subT = 0.3; this._queue(LOGS[i]);
        ctx.audio?.play?.('radio', { volume: 0.6 });
      }
    } catch (e) { console.error('[L2] onEvent', type, e); }
  }
  onNoise(pos, loudness) { for (const c of this.creatures) try { c?.hearNoise?.(pos, loudness); } catch (e) { /* */ } }

  spawnPoints() {
    return [{ x: -0.9, y: 0, z: 16.6, yaw: 0 }, { x: 0.9, y: 0, z: 16.6, yaw: 0 }, { x: -0.9, y: 0, z: 14.6, yaw: 0 }, { x: 0.9, y: 0, z: 14.6, yaw: 0 }];
  }

  update(dt) {
    const ctx = this.ctx; if (!this.root) return;
    dt = Math.min(dt, 0.1); this.t += dt; const t = this.t;
    try {
      // pulsing veins (heartbeat)
      const hb = Math.pow(Math.max(0, Math.sin(t * 1.9)), 6) + 0.6 * Math.pow(Math.max(0, Math.sin(t * 1.9 - 0.7)), 8);
      this.boost = Math.max(0, this.boost - dt * 0.8);
      const pulse = 0.55 + 0.2 * Math.sin(t * 0.9) + 0.5 * hb + this.boost;
      this.wallMat.emissiveIntensity = 0.85 * pulse; this.floorMat.emissiveIntensity = 0.45 * pulse; this.ceilMat.emissiveIntensity = 0.35 * pulse;
      this.veinMat.emissiveIntensity = 2.0 * pulse; this.memMat.emissiveIntensity = 0.9 * pulse;
      this._retryLoops(dt);
      if (this.uBlend < 1) this._stepPal(Math.min(1, this.uBlend + dt / this.uDur));
      if (this.universe >= 2 && this.cryGrow < 1) { this.cryGrow = Math.min(1, this.cryGrow + dt / 2.6); this._updateCrystals(); }
      if (ctx.camera) ctx.camera.getWorldPosition(this.bdGroup.position);
      this.bdGroup.rotation.y = t * 0.004;
      // warp drive
      const n = this.nCores, sp = this.driveDone ? 2.2 + (t - (this.completeAt - 4.2)) * 1.5 : 0.12 + n * 0.22;
      for (const r of this.rings) { if (r.axis === 0) r.ringM.rotation.x += dt * sp * r.dir; else if (r.axis === 1) r.ringM.rotation.y += dt * sp * r.dir * 1.2; else { r.ringM.rotation.x += dt * sp * 0.7; r.piv.rotation.y -= dt * sp * 0.5; } }
      const cp = 1 + 0.08 * Math.sin(t * 6) + n * 0.05 + (this.driveDone ? 0.4 : 0);
      this.column.scale.set(cp * (0.6 + 0.4 * (n / 3)), 1, cp * (0.6 + 0.4 * (n / 3)));
      this.columnGlow.scale.set(cp * (1 + hb * 0.3), 1, cp * (1 + hb * 0.3));
      this.driveGlowMat.opacity = 0.15 + n * 0.06 + hb * 0.1 + (this.driveDone ? 0.3 : 0);
      this.driveLight.intensity = 40 + n * 25 + hb * 25 + (this.driveDone ? 150 : 0);
      if (this.driveCon && n < 3) this.driveCon.pm.emissiveIntensity = 0.6 + 0.4 * Math.sin(t * 3);
      else if (this.driveCon) this.driveCon.pm.emissiveIntensity = 1.5 + Math.sin(t * 8);
      // cores
      for (const o of this.coreObjs || []) {
        if (o.active) { o.cg.rotation.y += dt * 1.6; o.mat.emissiveIntensity = 2.2 + Math.sin(t * 9) * 0.6 + this.boost; o.light.intensity = 30 + Math.sin(t * 9) * 8; }
        else { o.mat.emissiveIntensity = 0.7 + hb * 1.5; o.con.pm.emissiveIntensity = 1 + 0.6 * Math.sin(t * 4); o.light.intensity = 5 + hb * 10; }
      }
      // pods sway, kestrel drift
      if (this.sil) {
        for (let i = 0; i < this.silData.length; i++) { const [x, z, ph] = this.silData[i]; this._m.makeRotationY(ph + Math.sin(t * 0.3 + ph) * 0.2); this._m.setPosition(x, Math.sin(t * 0.7 + ph) * 0.08, z); this.sil.setMatrixAt(i, this._m); }
        this.sil.instanceMatrix.needsUpdate = true;
      }
      if (this.kestrel) { this.kestrel.position.y = Math.sin(t * 0.6) * 0.07; this.kestrel.rotation.z = Math.sin(t * 0.4) * 0.04; }
      // batteries
      if (this.batObjs) for (let i = 0; i < this.batObjs.length; i++) { const g = this.batObjs[i]; if (!g.visible) continue; g.rotation.y += dt * 1.4; g.position.y = 1.0 + Math.sin(t * 2 + i) * 0.06; }
      if (this.recLed) this.recLed.emissiveIntensity = (Math.sin(t * 5) > 0) ? 2.5 : 0.2;
      // spores drift
      this.spores.position.y = Math.sin(t * 0.25) * 0.35; this.spores.position.x = Math.sin(t * 0.13) * 0.4;
      // rocket sparks
      this.sparkT -= dt;
      if (this.sparkT <= 0) {
        this.sparkT = 0.25 + Math.random() * 1.3; this.sparkN++;
        ctx.fx?.burst?.(this.sparkPos, { count: 14, color: 0xffb060, speed: 4.5, life: 0.6, size: 0.05 });
        this.rocketLight.intensity = 30;
        if (this.sparkN % 4 === 0) ctx.audio?.play?.('static', { position: this.sparkPos, volume: 0.25 });
      }
      this.rocketLight.intensity = Math.max(4 + Math.random() * 3, this.rocketLight.intensity - dt * 90);
      this._updateDoors(dt, false);
      this.fx2?.update(dt, t, hb);
    } catch (e) { if (!this._warned) { this._warned = true; console.error('[L2] update visuals', e); } }

    // creatures
    for (let i = 0; i < this.creatures.length; i++) { const c = this.creatures[i]; if (!c) continue; try { c.update?.(dt); } catch (e) { if (!this._cw) { this._cw = true; console.error('[L2] creature update', e); } } }

    try {
      // host: noise -> creatures; completion
      if (ctx.isHost) {
        this.netT -= dt;
        if (this.netT <= 0 && ctx.players) {
          this.netT = 0.2;
          for (const p of ctx.players.values()) if (p && !p.downed && p.noise > 0.3 && p.position) this.onNoise(p.position, p.noise);
        }
        if (this.driveDone && !this.completed && t >= this.completeAt) { this.completed = true; ctx.fx?.flash?.(0xffffff, 1, 2); ctx.completeLevel?.(); }
      }
      // local tension
      this.tenT -= dt;
      if (this.tenT <= 0) {
        this.tenT = 0.25; const lp = ctx.getLocalPlayer?.(); let ten = 0;
        if (lp?.position) for (const c of this.creatures) {
          if (!c?.position) continue;
          const st = c.state, w = (st === 'chase' || st === 'attack') ? 1 : st === 'investigate' ? 0.55 : c.type === 'mimic' ? 0.25 : 0.15;
          const v = w * Math.max(0, 1 - c.position.distanceTo(lp.position) / 28); if (v > ten) ten = v;
        }
        ctx.audio?.setTension?.(Math.min(1, ten + (this.driveDone ? 0.3 : 0)));
      }
      // objective (state-driven on every peer)
      const done = this.nCores;
      const obj = this.driveDone ? 'Hold on.' : done < 3 ? `Activate the warp cores (${done}/3)` : 'Engage the warp drive in the hub';
      if (obj !== this.lastObj) { this.lastObj = obj; ctx.ui?.setObjective?.(obj); }
      // subtitles
      if (this.subT > 0) this.subT -= dt;
      else if (this.subQ.length) { const [who, text, sec] = this.subQ.shift(); ctx.ui?.subtitle?.(who, text, sec); ctx.audio?.speak?.(sec * 0.7); this.subT = sec + 0.35; }
    } catch (e) { if (!this._lw) { this._lw = true; console.error('[L2] update logic', e); } }
  }

  getState() {
    return {
      cores: this.cores.slice(), u: this.universe, dd: this.driveDone, b: this.bats.slice(),
      cr: this.creatures.map((c) => { try { return c?.getNetState?.() ?? null; } catch (e) { return null; } }),
    };
  }
  applyState(s) {
    if (!s) return;
    try {
      if (Array.isArray(s.cores)) s.cores.forEach((v, i) => { if (v && !this.cores[i]) this._activateCore(i, false); });
      if (s.dd && !this.driveDone) this._engageDrive();
      if (Array.isArray(s.b)) s.b.forEach((v, i) => { if (v && i < this.bats.length && !this.bats[i]) this._takeBattery(i, true); });
      this._syncCreatures();
      if (Array.isArray(s.cr)) s.cr.forEach((cs, i) => { const c = this.creatures[i]; if (c && cs != null) { try { c.setNetState?.(cs); } catch (e) { /* */ } } });
    } catch (e) { console.error('[L2] applyState', e); }
  }
  getSaveData() { return { cores: this.cores.slice() }; }

  dispose() {
    this._disposed = true;
    for (const l of this.loops) { try { l?.stop?.(0.5); } catch (e) { /* */ } }
    this.loops.length = 0; this.loopRecs.length = 0;
    for (const c of this.creatures) { try { c?.dispose?.(); } catch (e) { /* */ } }
    this.creatures.length = 0;
    try { this.ctx.fx?.setGrade?.(GRADE[0]); this.ctx.audio?.setTension?.(0); } catch (e) { /* */ }
    try { if (this.ctx.scene) { if (this.ctx.scene.fog === this.fog) this.ctx.scene.fog = null; if (this.ctx.scene.background === this.fog?.color) this.ctx.scene.background = null; } } catch (e) { /* */ }
    if (this.root) {
      this.root.parent?.remove(this.root);
      // free per-instance GPU buffers (geometries/materials/textures are in this.disp)
      try { this.root.traverse((o) => { if (o.isInstancedMesh) o.dispose(); }); } catch (e) { /* */ }
    }
    for (const d of this.disp) { try { d?.dispose?.(); } catch (e) { /* */ } }
    this.disp.length = 0; this.root = null;
  }
}
