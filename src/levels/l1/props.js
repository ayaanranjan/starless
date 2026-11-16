// L1 prop builders. Everything merged into few draw calls with vertex colors.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

// transform + color a primitive geometry
export function P(g, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  if (g.index === null) g = g; // primitives are indexed
  _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  const col = new THREE.Color(color);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export function merged(list, matOpts = {}) {
  const geos = list.map((g) => {
    if (!g.index) {
      const idx = []; for (let i = 0; i < g.attributes.position.count; i++) idx.push(i); g.setIndex(idx);
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  let g = null;
  try { g = mergeGeometries(geos, false); } catch (e) { g = null; }
  if (!g) { console.warn('[L1] merge failed'); g = new THREE.BufferGeometry(); }
  for (const x of geos) x.dispose();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.15, ...matOpts });
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);
const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 8);

export function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let _glow = null;
export function glowSprite(color, scale, opacity = 0.8, fog = true) {
  _glow = _glow || glowTexture();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: _glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog }));
  s.scale.set(scale, scale, scale);
  s.renderOrder = 4;
  return s;
}

// ---------- the wrecked Perihelion lander ----------
export function buildLander() {
  const g = new THREE.Group();
  const hull = 0x8a8d8f, dark = 0x2a2c2e, burnt = 0x1a1612, gold = 0x8a6a2a;
  const parts = [
    P(cyl(2.2, 3.0, 3.2, 10), hull, 0, 2.2, 0),
    P(cyl(1.2, 2.2, 1.6, 10), hull, 0, 4.6, 0),
    P(cyl(1.25, 1.25, 0.25, 10), dark, 0, 5.45, 0),
    P(box(1.0, 1.4, 0.2), dark, 0, 2.6, 3.0),
    P(cyl(3.05, 3.05, 0.5, 10), burnt, 0, 0.75, 0),
    P(box(6.5, 0.12, 1.4), gold, 4.2, 3.2, 0, 0, 0, -0.5),
    P(box(3.0, 0.12, 1.4), gold, -3.4, 1.4, 0.6, 0.3, 0.4, 0.9),
    P(cyl(0.8, 1.4, 1.2, 10), dark, 0, 0.2, 0),
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const broken = i === 1 || i === 2;
    parts.push(P(cyl(0.12, 0.12, broken ? 1.6 : 3.2, 6), hull, Math.cos(a) * 3.2, broken ? 0.6 : 1.1, Math.sin(a) * 3.2, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6));
    if (!broken) parts.push(P(cyl(0.5, 0.6, 0.15, 8), dark, Math.cos(a) * 4.0, 0.05, Math.sin(a) * 4.0));
  }
  // debris
  for (let i = 0; i < 9; i++) {
    const a = i * 2.1, r = 6 + (i % 4) * 2.2;
    parts.push(P(box(0.4 + (i % 3) * 0.5, 0.12, 0.3 + (i % 2) * 0.7), i % 2 ? hull : burnt, Math.cos(a) * r, 0.1, Math.sin(a) * r, i * 0.7, i, i * 0.3));
  }
  const body = merged(parts, { roughness: 0.6, metalness: 0.5 });
  body.rotation.set(0.22, 0.6, -0.16);
  body.position.y = -0.6;
  g.add(body);
  // scorch trench
  const sc = new THREE.Mesh(new THREE.CircleGeometry(7, 20), new THREE.MeshBasicMaterial({ color: 0x050403, transparent: true, opacity: 0.7, depthWrite: false }));
  sc.rotation.x = -Math.PI / 2; sc.scale.set(1, 2.2, 1); sc.position.set(0, 0.08, 7);
  sc.renderOrder = 1;
  g.add(sc);
  // red blinking beacon
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2010 });
  const beacon = new THREE.Mesh(sph(0.16, 8, 6), beaconMat);
  beacon.position.set(-0.3, 5.9, 0.9);
  g.add(beacon);
  const bglow = glowSprite(0xff2a1a, 3.2, 0.9);
  bglow.position.copy(beacon.position);
  g.add(bglow);
  // windows glow (dying cabin light)
  const win = new THREE.Mesh(box(0.9, 0.35, 0.05), new THREE.MeshBasicMaterial({ color: 0xffa860 }));
  win.position.set(0.0, 4.75, 1.62);
  body.add(win);
  return { group: g, beaconMat, bglow };
}

// ---------- the Kestrel rocket + gantry ----------
function rocketTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#c9c4b5'; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${90 + Math.random() * 60},${70 + Math.random() * 40},40,${Math.random() * 0.08})`; g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2 + Math.random() * 8); }
  g.strokeStyle = 'rgba(40,40,40,0.5)'; g.lineWidth = 1;
  for (let y = 0; y < 512; y += 48) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  for (let x = 0; x < 256; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  // rust streaks
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 256, y = Math.random() * 512, h = 20 + Math.random() * 90;
    const gr = g.createLinearGradient(x, y, x, y + h);
    gr.addColorStop(0, 'rgba(110,55,20,0.55)'); gr.addColorStop(1, 'rgba(110,55,20,0)');
    g.fillStyle = gr; g.fillRect(x, y, 2 + Math.random() * 4, h);
  }
  g.fillStyle = '#1b1b1b'; g.fillRect(0, 70, 256, 18); g.fillRect(0, 400, 256, 26);
  g.save(); g.translate(128, 260); g.rotate(-Math.PI / 2);
  g.fillStyle = 'rgba(25,25,25,0.85)'; g.font = 'bold 44px monospace'; g.textAlign = 'center'; g.fillText('KESTREL', 0, 16); g.restore();
  g.fillStyle = 'rgba(150,20,20,0.8)'; g.font = 'bold 18px monospace'; g.fillText('UNSA-2063', 140, 340);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function buildRocket() {
  const g = new THREE.Group();
  const rocket = new THREE.Group();
  g.add(rocket);
  const bodyMat = new THREE.MeshStandardMaterial({ map: rocketTexture(), roughness: 0.7, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.2, 18, 24, 1, true), bodyMat);
  body.position.y = 12; body.castShadow = true; body.receiveShadow = true;
  rocket.add(body);
  const det = [
    P(new THREE.ConeGeometry(2.0, 5.5, 24), 0xd8d2c0, 0, 23.75, 0),
    P(cyl(2.2, 2.25, 0.4, 24), 0x2a2a2a, 0, 3.0, 0),
    P(cyl(1.2, 2.0, 2.4, 16), 0x3a3633, 0, 1.6, 0),
    P(cyl(0.12, 0.12, 2.2, 6), 0x777777, 0, 27.2, 0),
  ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    det.push(P(box(0.18, 4.5, 2.6), 0x6a2018, Math.cos(a) * 2.6, 5.0, Math.sin(a) * 2.6, 0, Math.PI / 2 - a, 0));
  }
  // hatch frame (south side, +Z)
  det.push(P(box(1.5, 2.1, 0.2), 0x2c2c2c, 0, 5.2, 2.2));
  det.push(P(box(1.2, 1.8, 0.12), 0x8c8778, 0, 5.2, 2.32));
  const detail = merged(det, { roughness: 0.6, metalness: 0.4 });
  rocket.add(detail);
  // engine bell glow (used during launches)
  const bellGlow = new THREE.Mesh(new THREE.CircleGeometry(1.15, 20), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  bellGlow.rotation.x = Math.PI / 2; bellGlow.position.y = 0.39;
  rocket.add(bellGlow);
  // hatch light
  const hatchLamp = new THREE.Mesh(box(0.25, 0.25, 0.1), new THREE.MeshBasicMaterial({ color: 0x22ff88 }));
  hatchLamp.position.set(0.95, 6.3, 2.35);
  rocket.add(hatchLamp);
  // launch pad + gantry
  const gp = [P(cyl(6.5, 7.0, 1.0, 20), 0x2a2a28, 0, -0.1, 0), P(cyl(2.6, 2.6, 0.3, 16), 0x111111, 0, 0.45, 0)];
  const gx = 6.2, gh = 30, steel = 0x4a3f36, rust = 0x5a3020;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) gp.push(P(box(0.35, gh, 0.35), steel, gx + sx * 1.6, gh / 2, sz * 1.6));
  for (let y = 2; y < gh; y += 3) {
    gp.push(P(box(3.6, 0.22, 0.22), rust, gx, y + 1, -1.6), P(box(3.6, 0.22, 0.22), rust, gx, y + 1, 1.6));
    gp.push(P(box(0.22, 0.22, 3.6), rust, gx - 1.6, y + 1, 0), P(box(0.22, 0.22, 3.6), rust, gx + 1.6, y + 1, 0));
    gp.push(P(box(0.14, 4.4, 0.14), steel, gx, y + 2.5, -1.6, 0, 0, 0.75), P(box(0.14, 4.4, 0.14), steel, gx, y + 2.5, 1.6, 0, 0, -0.75));
  }
  for (const y of [8, 16, 24]) gp.push(P(box(4.2, 0.2, 1.2), steel, gx - 3.0, y, 0), P(box(0.15, 1.0, 1.2), steel, gx - 5.0, y + 0.5, 0));
  // coolant tanks + pipes
  gp.push(P(cyl(1.0, 1.0, 4.5, 14), 0x6f7c80, -6.5, 2.25, 1.5), P(cyl(1.0, 1.0, 4.5, 14), 0x6f7c80, -6.5, 2.25, -1.5));
  const pad = merged(gp, { roughness: 0.8, metalness: 0.5 });
  g.add(pad);
  // gantry warning light
  const warnMat = new THREE.MeshBasicMaterial({ color: 0xff1a0a });
  const warn = new THREE.Mesh(sph(0.3, 8, 6), warnMat);
  warn.position.set(gx, gh + 1.4, 0);
  g.add(warn);
  const warnGlow = glowSprite(0xff2010, 9, 0.9, false);
  warnGlow.position.copy(warn.position);
  g.add(warnGlow);
  // scorch decal (shown after failed launch)
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(9, 24), new THREE.MeshBasicMaterial({ color: 0x030202, transparent: true, opacity: 0, depthWrite: false }));
  scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.43; scorch.renderOrder = 1;
  g.add(scorch);
  return { group: g, rocket, bellGlow, hatchLamp, warnMat, warnGlow, scorch, bodyMat, gantryX: gx };
}

// coolant valve: pipe stub + wheel. returns {group, wheel, lampMat}
export function buildValve() {
  const g = new THREE.Group();
  const base = merged([
    P(cyl(0.35, 0.35, 1.6, 10), 0x5a6468, 0, 0.8, 0),
    P(cyl(0.22, 0.22, 2.4, 8), 0x5a6468, 0, 1.3, 0, Math.PI / 2, 0, 0),
    P(box(0.7, 0.25, 0.7), 0x2a2a2a, 0, 0.1, 0),
    P(cyl(0.5, 0.5, 0.3, 12), 0x6a2018, 0, 1.6, 0),
  ], { metalness: 0.6, roughness: 0.5 });
  g.add(base);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 6, 18), new THREE.MeshStandardMaterial({ color: 0xaa2a1a, metalness: 0.6, roughness: 0.4, emissive: 0x551008 }));
  wheel.rotation.x = Math.PI / 2; wheel.position.y = 1.85;
  g.add(wheel);
  const spokes = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.05, 0.05), wheel.material);
  spokes.position.y = 1.85; g.add(spokes);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xff2a10 });
  const lamp = new THREE.Mesh(sph(0.12, 8, 6), lampMat);
  lamp.position.set(0, 2.25, 0); g.add(lamp);
  const glow = glowSprite(0xff3010, 2.2, 0.8);
  glow.position.copy(lamp.position); g.add(glow);
  return { group: g, wheel, spokes, lampMat, glow };
}

// ---------- dead Kestrel astronaut lying on the ground ----------
export function buildBody(variant = 0) {
  const suit = [0xb8743a, 0x9a8a70, 0xa86a3a][variant % 3], dark = 0x2a2622;
  const parts = [
    P(cap(0.28, 0.6), suit, 0, 0.3, 0, Math.PI / 2, 0, 0),
    P(box(0.5, 0.35, 0.55), 0x5a5a58, 0, 0.42, 0.15),
    P(cap(0.11, 0.55), suit, 0.36, 0.14, 0.2, Math.PI / 2, 0.5, 0),
    P(cap(0.11, 0.5), suit, -0.42, 0.14, -0.1, Math.PI / 2, -0.9, 0),
    P(cap(0.13, 0.7), suit, 0.15, 0.14, -0.85, Math.PI / 2, 0.1, 0),
    P(cap(0.13, 0.7), suit, -0.18, 0.14, -0.9, Math.PI / 2, -0.25, 0),
    P(box(0.2, 0.18, 0.3), dark, 0.2, 0.12, -1.35), P(box(0.2, 0.18, 0.3), dark, -0.25, 0.12, -1.4),
    P(sph(0.26, 14, 10), 0xd0ccc0, 0, 0.3, 0.72),
  ];
  const m = merged(parts, { roughness: 0.9, metalness: 0.05 });
  const g = new THREE.Group();
  g.add(m);
  // cracked visor
  const vc = document.createElement('canvas'); vc.width = vc.height = 64;
  const x = vc.getContext('2d');
  x.fillStyle = '#0b0d0c'; x.fillRect(0, 0, 64, 64);
  x.strokeStyle = 'rgba(200,220,200,0.8)'; x.lineWidth = 1;
  for (let i = 0; i < 7; i++) { x.beginPath(); x.moveTo(30, 28); let px = 30, py = 28; const a = i * 0.9; for (let k = 0; k < 4; k++) { px += Math.cos(a + k * 0.3) * 8; py += Math.sin(a + k * 0.3) * 8; x.lineTo(px, py); } x.stroke(); }
  const vt = new THREE.CanvasTexture(vc); vt.colorSpace = THREE.SRGBColorSpace;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI, 0, Math.PI * 0.6), new THREE.MeshStandardMaterial({ map: vt, metalness: 0.9, roughness: 0.15 }));
  visor.position.set(0, 0.36, 0.8); visor.rotation.set(-1.2, 0, 0);
  g.add(visor);
  return g;
}

// audio log device with blinking LED
export function buildLogDevice() {
  const g = new THREE.Group();
  g.add(merged([P(box(0.34, 0.12, 0.22), 0x3a3a36, 0, 0.06, 0), P(cyl(0.015, 0.015, 0.3, 4), 0x999999, 0.12, 0.2, -0.06)], { metalness: 0.5 }));
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x3aff7a });
  const led = new THREE.Mesh(sph(0.03, 6, 4), ledMat); led.position.set(-0.1, 0.13, 0.06); g.add(led);
  const glow = glowSprite(0x3aff7a, 0.9, 0.9); glow.position.copy(led.position); g.add(glow);
  return { group: g, ledMat, glow };
}

// ---------- oxygen vent (cyan fissure) ----------
export function buildVent() {
  const g = new THREE.Group();
  g.add(merged([
    P(new THREE.ConeGeometry(2.4, 1.2, 9, 1, true), 0x1c1d1a, 0, 0.35, 0),
    P(new THREE.TorusGeometry(0.75, 0.22, 6, 12), 0x24302c, 0, 0.9, 0, Math.PI / 2, 0, 0),
  ], { roughness: 1, metalness: 0 }));
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.62, 14), new THREE.MeshBasicMaterial({ color: 0x40f0ff }));
  core.rotation.x = -Math.PI / 2; core.position.y = 0.95;
  g.add(core);
  const glow = glowSprite(0x30e0ff, 6, 0.55);
  glow.position.y = 1.4; g.add(glow);
  return { group: g, core, glow };
}

// ---------- rocket part models ----------
export function buildPartModel(kind) {
  const g = new THREE.Group();
  let emissiveColor = 0x40c0ff;
  const gm = [];
  if (kind === 'fuel') {
    emissiveColor = 0x60ff70;
    gm.push(P(cyl(0.32, 0.32, 1.0, 14), 0x2c3a30, 0, 0.5, 0), P(cyl(0.36, 0.36, 0.1, 14), 0x777777, 0, 0.05, 0), P(cyl(0.36, 0.36, 0.1, 14), 0x777777, 0, 0.95, 0));
  } else if (kind === 'thruster') {
    emissiveColor = 0xff8a30;
    gm.push(P(cyl(0.25, 0.55, 0.8, 16, ), 0x3a3633, 0, 0.45, 0), P(cyl(0.3, 0.3, 0.3, 12), 0x666060, 0, 1.0, 0), P(box(0.1, 0.5, 0.1), 0x8a6a2a, 0.3, 0.9, 0));
  } else if (kind === 'nav') {
    emissiveColor = 0x40a0ff;
    gm.push(P(box(0.6, 0.45, 0.6), 0x2a2e36, 0, 0.25, 0), P(box(0.64, 0.06, 0.64), 0x777777, 0, 0.5, 0));
  } else {
    emissiveColor = 0xffc040;
    gm.push(P(cyl(0.12, 0.12, 0.9, 8), 0x444444, 0, 0.45, 0), P(box(0.5, 0.1, 0.5), 0x2a2a2a, 0, 0.05, 0));
  }
  const shell = merged(gm, { metalness: 0.6, roughness: 0.4 });
  g.add(shell);
  const emat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: emissiveColor, emissiveIntensity: 2.0, roughness: 0.3 });
  let core;
  if (kind === 'fuel') { core = new THREE.Mesh(cyl(0.26, 0.26, 0.7, 12), emat); core.position.y = 0.5; }
  else if (kind === 'thruster') { core = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.06, 6, 20), emat); core.rotation.x = Math.PI / 2; core.position.y = 0.2; }
  else if (kind === 'nav') { core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), emat); core.position.y = 0.85; }
  else { core = new THREE.Mesh(new THREE.TorusKnotGeometry(0.2, 0.05, 48, 6, 2, 5), emat); core.position.y = 1.0; }
  g.add(core);
  const glow = glowSprite(emissiveColor, 2.6, 0.7);
  glow.position.y = 0.8; g.add(glow);
  return { group: g, core, emat, glow, color: emissiveColor };
}

// ---------- crashed shuttle (fuel cell site) ----------
export function buildShuttle() {
  const hull = 0x464a4b, dark = 0x1a1a1a, scorch = 0x1c1713; // weathered, soot-streaked: reads as a wreck, not a toy
  const parts = [
    P(cyl(2.4, 2.4, 10, 12, ), hull, 0, 1.6, -3.5, Math.PI / 2 - 0.12, 0, 0.18),
    P(new THREE.ConeGeometry(2.4, 4.0, 12), hull, 0.3, 2.4, -10.4, -Math.PI / 2 + 0.15, 0, 0.18),
    P(cyl(2.4, 2.2, 6, 12), scorch, 1.2, 1.2, 6.5, Math.PI / 2 + 0.3, 0.5, -0.4),
    P(box(9.0, 0.25, 3.2), hull, -5.2, 0.6, -2.0, 0.1, 0.1, 0.35),
    P(box(6.0, 0.25, 2.6), scorch, 5.5, 0.4, -3.0, -0.2, -0.3, -0.5),
    P(box(1.6, 3.0, 0.3), dark, 1.6, 1.8, 9.0, 0.4, 0.4, 0.2),
  ];
  for (let i = 0; i < 12; i++) { const a = i * 1.7, r = 5 + (i % 5) * 1.8; parts.push(P(box(0.5 + (i % 3) * 0.4, 0.15, 0.4 + (i % 2) * 0.9), i % 3 ? hull : dark, Math.cos(a) * r, 0.1, Math.sin(a) * r + 1, i, i * 0.5, i * 0.2)); }
  const m = merged(parts, { roughness: 0.82, metalness: 0.3 });
  m.position.y = -0.4;
  const g = new THREE.Group(); g.add(m);
  return g;
}

// ---------- toppled antenna (nav core site) ----------
export function buildAntenna() {
  const steel = 0x5a5550, rust = 0x5a3020;
  const parts = [];
  const L = 22;
  for (const [sy, sz] of [[0.6, -0.6], [0.6, 0.6], [1.6, 0]]) parts.push(P(box(L, 0.18, 0.18), steel, L / 2, sy, sz));
  for (let x = 1; x < L; x += 1.6) {
    parts.push(P(box(0.12, 1.4, 0.12), rust, x, 1.0, 0, 0.0, 0, 0.6), P(box(0.12, 0.12, 1.3), rust, x, 0.6, 0));
  }
  parts.push(P(new THREE.SphereGeometry(3.0, 16, 8, 0, Math.PI * 2, 0, 1.0), 0x8a8a84, L + 1.4, 2.4, 0, 0, 0, -1.9));
  parts.push(P(box(2.4, 1.2, 2.4), 0x333333, -0.6, 0.6, 0));
  const m = merged(parts, { roughness: 0.8, metalness: 0.55 });
  m.material.side = THREE.DoubleSide;
  const g = new THREE.Group(); g.add(m);
  return g;
}

// ---------- ribcage skeleton (spine + arched ribs + skull) ----------
export function ribcageGeometries(rng, scale = 1, ox = 0, oy = 0, oz = 0, ry = 0) {
  const geos = [];
  const bone = 0xcfc4a4, old = 0x9a8f72;
  const len = 34 * scale;
  const tmp = new THREE.Group();
  const spinePts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; spinePts.push(new THREE.Vector3(0, (4 + Math.sin(t * Math.PI) * 9) * scale, (t - 0.5) * len)); }
  const spine = new THREE.CatmullRomCurve3(spinePts);
  geos.push(new THREE.TubeGeometry(spine, 40, 0.9 * scale, 7, false));
  for (let i = 0; i < 26; i++) { const p = spine.getPoint(i / 25); geos.push(P(new THREE.DodecahedronGeometry(1.25 * scale, 0), old, p.x, p.y, p.z)); }
  const nr = 9;
  for (let i = 0; i < nr; i++) {
    const t = 0.15 + (i / (nr - 1)) * 0.7;
    const sp = spine.getPoint(t);
    const w = (7 + Math.sin(t * Math.PI) * 6) * scale;
    for (const side of [-1, 1]) {
      const broken = rng() < 0.22;
      const pts = [];
      const n = broken ? 4 : 7;
      for (let k = 0; k <= n; k++) {
        const a = (k / 6) * Math.PI * 0.62;
        pts.push(new THREE.Vector3(side * Math.sin(a) * w, sp.y - (1 - Math.cos(a)) * sp.y * 1.02 + Math.sin(a) * 2.5 * scale, sp.z + Math.sin(a) * 1.5 * scale));
      }
      geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.45 * scale * (1 - t * 0.3), 6, false));
    }
  }
  // skull
  const head = spine.getPoint(1);
  geos.push(P(new THREE.SphereGeometry(4.2 * scale, 12, 8), bone, 0, head.y - 2 * scale, head.z + 4 * scale, 0.3, 0, 0, 1, 0.7, 1.4));
  geos.push(P(new THREE.ConeGeometry(0.5 * scale, 4 * scale, 5), bone, 2 * scale, head.y - 4 * scale, head.z + 8 * scale, 2.6, 0, 0));
  geos.push(P(new THREE.ConeGeometry(0.5 * scale, 4 * scale, 5), bone, -2 * scale, head.y - 4 * scale, head.z + 8 * scale, 2.6, 0, 0));
  // color tubes and transform whole set
  const out = [];
  const M = new THREE.Matrix4().compose(new THREE.Vector3(ox, oy, oz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
  for (const g of geos) {
    if (!g.attributes.color) P(g, bone);
    g.applyMatrix4(M);
    out.push(g);
  }
  tmp.clear();
  return out;
}

// rock spire geometry (craggy, displaced)
export function spireGeometry() {
  const g = new THREE.CylinderGeometry(0.25, 1, 1, 7, 6);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + Math.sin(y * 9.0 + x * 3.0) * 0.18 + Math.cos(z * 5.0 + y * 4.0) * 0.12;
    p.setXYZ(i, x * k + Math.sin(y * 3.0) * 0.12, y, z * k + Math.cos(y * 2.5) * 0.12);
  }
  g.computeVertexNormals();
  return g;
}
