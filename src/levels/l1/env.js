// L1 environment helpers: heightfield, terrain, sky (gas giant), particles, lightning bolt.
import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

export const SITES = {
  lander: { x: 0, z: 72 },
  rocket: { x: 0, z: -122 },
  shuttle: { x: -100, z: 26 },
  nest: { x: 104, z: 36 },
  ridge: { x: -78, z: -54 },
  maze: { x: 84, z: -50 },
};

const smooth = (t) => t * t * (3 - 2 * t);

export function makeHeightfield(rng) {
  const S = new SimplexNoise({ random: rng });
  const keep = Object.values(SITES);
  const craters = [];
  let tries = 0;
  while (craters.length < 8 && tries++ < 300) {
    const x = (rng() * 2 - 1) * 145, z = (rng() * 2 - 1) * 145, r = 7 + rng() * 11;
    if (keep.some((s) => Math.hypot(s.x - x, s.z - z) < r * 1.8 + 24)) continue;
    if (craters.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + r + 10)) continue;
    craters.push({ x, z, r, d: r * 0.34, rim: r * 0.13 });
  }
  // ridge segment for the navigation-core site
  const ax = -104, az = -38, bx = -60, bz = -66;
  const abx = bx - ax, abz = bz - az, abl = abx * abx + abz * abz;
  function raw(x, z) {
    let h = S.noise(x * 0.0075, z * 0.0075) * 5.5;
    const warp = S.noise(x * 0.02 + 7.1, z * 0.02 - 3.3) * 2.2;
    h += Math.sin(x * 0.085 + z * 0.035 + warp) * 0.8;
    const rn = 1 - Math.abs(S.noise(x * 0.016 + 31.7, z * 0.016 - 17.2));
    h += rn * rn * rn * 6.0 - 1.5;
    h += S.noise(x * 0.075, z * 0.075) * 0.4;
    for (let i = 0; i < craters.length; i++) {
      const c = craters[i];
      const dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz, R = c.r * 1.7;
      if (d2 > R * R) continue;
      const t = Math.sqrt(d2) / c.r;
      if (t < 1) h -= c.d * (1 - t * t);
      const k = (t - 1) / 0.28;
      h += c.rim * Math.exp(-k * k);
    }
    let t = ((x - ax) * abx + (z - az) * abz) / abl;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const rx = x - (ax + abx * t), rz = z - (az + abz * t);
    const rd = Math.sqrt(rx * rx + rz * rz) / 12;
    h += 7.5 * Math.exp(-rd * rd);
    const e = Math.max(Math.abs(x), Math.abs(z));
    if (e > 136) { const k = (e - 136) / 44; h += k * k * 36; }
    return h;
  }
  const zones = [
    { ...SITES.rocket, r: 34, f: 28, add: 3.5 },
    { ...SITES.lander, r: 13, f: 12, add: 0 },
    { ...SITES.shuttle, r: 10, f: 10, add: -0.5 },
    { ...SITES.nest, r: 13, f: 10, add: -1.2 },
    { ...SITES.ridge, r: 7, f: 9, add: 0 },
    { ...SITES.maze, r: 24, f: 10, add: 0 },
  ];
  for (const zn of zones) zn.h = raw(zn.x, zn.z) + zn.add;
  function height(x, z) {
    let h = raw(x, z);
    for (let i = 0; i < zones.length; i++) {
      const zn = zones[i];
      const dx = x - zn.x, dz = z - zn.z, rr = zn.r + zn.f;
      if (dx * dx + dz * dz >= rr * rr) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      const w = d <= zn.r ? 1 : smooth(1 - (d - zn.r) / zn.f);
      h += (zn.h - h) * w;
    }
    return h;
  }
  return { height, craters, noise: S };
}

export function makeDetailTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#c4c4c4';
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 150 + Math.random() * 90;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  // blotches
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 4 + Math.random() * 22;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() < 0.6;
    gr.addColorStop(0, dark ? 'rgba(40,40,40,0.35)' : 'rgba(255,255,255,0.25)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.save(); g.translate(ox, oy); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.restore();
    }
  }
  // cracks
  g.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    let x = Math.random() * size, y = Math.random() * size, a = Math.random() * Math.PI * 2;
    g.strokeStyle = `rgba(20,20,18,${0.5 + Math.random() * 0.4})`;
    g.lineWidth = 0.6 + Math.random() * 1.6;
    g.beginPath(); g.moveTo(x, y);
    const n = 4 + (Math.random() * 9) | 0;
    for (let k = 0; k < n; k++) {
      a += (Math.random() - 0.5) * 1.3;
      x += Math.cos(a) * (4 + Math.random() * 10); y += Math.sin(a) * (4 + Math.random() * 10);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildTerrain(hf, size = 360, seg = 170) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, hf.height(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const S = hf.noise;
  const col = new Float32Array(pos.count * 3);
  const basalt = [0.035, 0.036, 0.032], ochre = [0.30, 0.22, 0.05], olive = [0.12, 0.15, 0.06], ash = [0.16, 0.16, 0.13];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ny = nrm.getY(i);
    const n1 = S.noise(x * 0.045, z * 0.045), n2 = S.noise(x * 0.012 + 50, z * 0.012 - 20), n3 = S.noise(x * 0.2, z * 0.2);
    let wO = Math.max(0, n2) * 0.9 + Math.max(0, -y - 1.0) * 0.18;
    let wV = Math.max(0, n1) * (ny > 0.93 ? 0.9 : 0.2);
    let wA = Math.max(0, -n1) * 0.35;
    const steep = Math.min(1, Math.max(0, (0.9 - ny) * 4));
    wO *= 1 - steep; wV *= 1 - steep; wA *= 1 - steep;
    const wB = 0.55 + steep * 1.5;
    const sum = wO + wV + wA + wB;
    const k = 0.85 + n3 * 0.15;
    for (let c = 0; c < 3; c++) col[i * 3 + c] = ((basalt[c] * wB + ochre[c] * wO + olive[c] * wV + ash[c] * wA) / sum) * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const tex = makeDetailTexture();
  tex.repeat.set(size / 5, size / 5);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, bumpMap: tex, bumpScale: 2.2, roughness: 0.96, metalness: 0.0 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'l1_terrain';
  return mesh;
}

// ---------- sky: ringed gas giant ----------
function bandTexture() {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const pal = [[96, 112, 70], [140, 128, 74], [70, 86, 60], [168, 150, 96], [58, 70, 52], [120, 118, 80], [84, 96, 62]];
  const img = g.createImageData(W, H);
  const d = img.data;
  const ph = [Math.random() * 6, Math.random() * 6, Math.random() * 6];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const wob = Math.sin(u * Math.PI * 2 * 3 + y * 0.05 + ph[0]) * 2.5 + Math.sin(u * Math.PI * 2 * 7 + ph[1]) * 1.2;
      const yy = y + wob;
      const b = (Math.sin(yy * 0.11 + ph[2]) * 0.5 + 0.5) * 3 + (Math.sin(yy * 0.37) * 0.5 + 0.5) * 2 + yy * 0.02;
      const i0 = Math.floor(b) % pal.length, i1 = (i0 + 1) % pal.length, f = b - Math.floor(b);
      const p0 = pal[i0], p1 = pal[i1];
      const n = 0.9 + Math.random() * 0.1;
      const o = (y * W + x) * 4;
      d[o] = (p0[0] + (p1[0] - p0[0]) * f) * n;
      d[o + 1] = (p0[1] + (p1[1] - p0[1]) * f) * n;
      d[o + 2] = (p0[2] + (p1[2] - p0[2]) * f) * n;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // storm eye
  const gr = g.createRadialGradient(W * 0.62, H * 0.62, 2, W * 0.62, H * 0.62, 26);
  gr.addColorStop(0, 'rgba(210,190,120,0.9)');
  gr.addColorStop(0.5, 'rgba(120,100,60,0.6)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.save(); g.scale(1.8, 1); g.beginPath(); g.arc(W * 0.62 / 1.8, H * 0.62, 26, 0, Math.PI * 2); g.fill(); g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 4;
  const g = c.getContext('2d');
  for (let x = 0; x < 512; x++) {
    const u = x / 512;
    let a = 0.25 + 0.35 * Math.abs(Math.sin(u * 40.0)) * Math.abs(Math.sin(u * 7.3 + 1.0));
    if (u > 0.62 && u < 0.67) a *= 0.1; // gap
    a *= Math.min(1, u * 8) * Math.min(1, (1 - u) * 6);
    const v = 150 + Math.sin(u * 23) * 30;
    g.fillStyle = `rgba(${v | 0},${(v * 0.95) | 0},${(v * 0.7) | 0},${a.toFixed(3)})`;
    g.fillRect(x, 0, 1, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildSky(camera, fogColor) {
  const group = new THREE.Group();
  group.name = 'l1_sky';
  const far = camera?.far || 1000;
  const R = Math.min(430, far * 0.72);
  const pr = R * 0.4;
  const dir = new THREE.Vector3(0.5, 0.42, -0.76).normalize();
  const sun = new THREE.Vector3(-0.8, 0.35, 0.45).normalize();
  const planetMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: bandTexture() }, sun: { value: sun }, fogc: { value: new THREE.Color(fogColor) }, op: { value: 0.62 }, time: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv=uv; vN=normalize(mat3(modelMatrix)*normal); vec4 wp=modelMatrix*vec4(position,1.0); vV=normalize(cameraPosition-wp.xyz); gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 sun; uniform vec3 fogc; uniform float op; uniform float time;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vec3 c=texture2D(map, vUv+vec2(time*0.0015,0.0)).rgb; float l=clamp(dot(normalize(vN),sun)*1.1+0.05,0.0,1.0);
        float rim=pow(1.0-max(dot(normalize(vN),normalize(vV)),0.0),2.5);
        vec3 col=c*(0.05+1.1*l)+vec3(0.45,0.75,0.5)*rim*0.45;
        gl_FragColor=vec4(mix(fogc,col,op),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    fog: false,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(pr, 64, 40), planetMat);
  planet.position.copy(dir).multiplyScalar(R);
  planet.rotation.z = 0.32;
  planet.frustumCulled = false;
  group.add(planet);
  // ring with radial UVs
  const rg = new THREE.RingGeometry(pr * 1.35, pr * 2.35, 160, 1);
  const rp = rg.attributes.position, ruv = rg.attributes.uv;
  for (let i = 0; i < rp.count; i++) {
    const r = Math.hypot(rp.getX(i), rp.getY(i));
    ruv.setXY(i, (r - pr * 1.35) / (pr * 1.0), 0.5);
  }
  const ringMat = new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, opacity: 0.5, side: THREE.DoubleSide, fog: false, depthWrite: false });
  const ring = new THREE.Mesh(rg, ringMat);
  ring.position.copy(planet.position);
  ring.rotation.set(-Math.PI / 2 + 0.38, 0.22, 0.3);
  ring.frustumCulled = false;
  group.add(ring);
  // faint second moon
  const moon = new THREE.Mesh(new THREE.SphereGeometry(pr * 0.09, 24, 16), new THREE.MeshBasicMaterial({ color: 0x5f6a55, fog: false, transparent: true, opacity: 0.55 }));
  moon.position.copy(new THREE.Vector3(-0.62, 0.5, -0.6).normalize().multiplyScalar(R * 0.95));
  group.add(moon);
  return {
    group, dir, R,
    update(dt, camPos) {
      planetMat.uniforms.time.value += dt;
      if (camPos) group.position.copy(camPos);
    },
  };
}

// ---------- soft particle system (points with per-particle size/alpha/color) ----------
export class Particles {
  constructor(max, { additive = false, name = 'l1_particles' } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max).fill(1);
    this.used = 0;
    this.emitters = [];
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 600 } }]),
      defines: additive ? { ADD: 1 } : {},
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale;
        varying float vA; varying vec3 vC;
        #include <fog_pars_vertex>
        void main(){ vA=aAlpha; vC=aColor; vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
          gl_PointSize = aAlpha<=0.0 ? 0.0 : clamp(aSize*uScale/max(-mvPosition.z,0.05), 0.0, 400.0);
          gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        #include <fog_pars_fragment>
        void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d)*2.0; float a=1.0-smoothstep(0.0,1.0,r); a*=a;
          gl_FragColor=vec4(vC, a*vA);
          if(gl_FragColor.a<0.002) discard;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #ifdef USE_FOG
            #ifdef FOG_EXP2
              float ff = 1.0 - exp(-fogDensity*fogDensity*vFogDepth*vFogDepth);
            #else
              float ff = smoothstep(fogNear, fogFar, vFogDepth);
            #endif
            #ifdef ADD
              gl_FragColor.a *= (1.0-ff);
            #else
              gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ff);
            #endif
          #endif
        }`,
      transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.name = name;
    this.points.renderOrder = additive ? 3 : 2;
  }
  // def: {x,y,z, n, color:[r,g,b], life:[a,b], vel:[x,y,z], jitter, spread, size:[s0,s1], alpha, rise, drag, active}
  addEmitter(def) {
    const n = Math.min(def.n, this.max - this.used);
    def.start = this.used; def.count = n; this.used += n;
    def.active = def.active !== false;
    def.rise = def.rise ?? 0.6; def.drag = def.drag ?? 0.5; def.jitter = def.jitter ?? 0.4; def.spread = def.spread ?? 0.4;
    for (let i = def.start; i < def.start + n; i++) {
      this.age[i] = def.active ? -Math.random() * def.life[1] : -1e9;
      this.alpha[i] = 0;
    }
    this.emitters.push(def);
    return def;
  }
  setActive(def, on) {
    if (!def || def.active === on) return;
    def.active = on;
    if (on) for (let i = def.start; i < def.start + def.count; i++) if (this.age[i] < -1e8) this.age[i] = -Math.random() * def.life[1];
  }
  _spawn(i, e) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * e.spread;
    this.pos[i * 3] = e.x + Math.cos(a) * r;
    this.pos[i * 3 + 1] = e.y + (e.spreadY ? (Math.random() - 0.5) * e.spreadY : 0);
    this.pos[i * 3 + 2] = e.z + Math.sin(a) * r;
    const j = e.jitter;
    this.vel[i * 3] = e.vel[0] + (Math.random() - 0.5) * 2 * j;
    this.vel[i * 3 + 1] = e.vel[1] + (Math.random() - 0.5) * 2 * j;
    this.vel[i * 3 + 2] = e.vel[2] + (Math.random() - 0.5) * 2 * j;
    this.life[i] = e.life[0] + Math.random() * (e.life[1] - e.life[0]);
    this.age[i] = 0;
    const c = e.color, v = e.colorVar ?? 0.1, k = 1 - v + Math.random() * v;
    this.col[i * 3] = c[0] * k; this.col[i * 3 + 1] = c[1] * k; this.col[i * 3 + 2] = c[2] * k;
  }
  update(dt, wind = 0) {
    const s = this.emitters;
    for (let ei = 0; ei < s.length; ei++) {
      const e = s[ei];
      const end = e.start + e.count;
      const dragK = Math.max(0, 1 - e.drag * dt);
      for (let i = e.start; i < end; i++) {
        let age = this.age[i];
        if (age < 0) {
          if (age < -1e8) { this.alpha[i] = 0; continue; }
          age += dt; this.age[i] = age;
          if (age < 0) { this.alpha[i] = 0; continue; }
          this._spawn(i, e); age = 0;
        }
        age += dt;
        if (age >= this.life[i]) {
          if (e.active) { this._spawn(i, e); age = 0; } else { this.age[i] = -1e9; this.alpha[i] = 0; continue; }
        }
        this.age[i] = age;
        const t = age / this.life[i];
        const i3 = i * 3;
        this.vel[i3 + 1] += e.rise * dt;
        this.vel[i3] = this.vel[i3] * dragK + wind * dt;
        this.vel[i3 + 2] *= dragK;
        this.pos[i3] += this.vel[i3] * dt;
        this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
        this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
        this.size[i] = e.size[0] + (e.size[1] - e.size[0]) * t;
        const fade = t < 0.15 ? t / 0.15 : (1 - t) / 0.85;
        this.alpha[i] = e.alpha * fade * (e.flicker ? 0.6 + Math.random() * 0.4 : 1);
      }
    }
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = true;
  }
  setScale(px) { this.mat.uniforms.uScale.value = px; }
  dispose() { this.points.geometry.dispose(); this.mat.dispose(); }
}

// drifting spores that wrap around the camera
export class Spores {
  constructor(count) {
    this.p = new Particles(count, { additive: true, name: 'l1_spores' });
    this.n = count;
    this.box = [56, 26, 56];
    this.ph = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.p.pos[i * 3] = (Math.random() - 0.5) * this.box[0];
      this.p.pos[i * 3 + 1] = (Math.random() - 0.3) * this.box[1];
      this.p.pos[i * 3 + 2] = (Math.random() - 0.5) * this.box[2];
      this.p.vel[i * 3] = (Math.random() - 0.5) * 0.25 + 0.15;
      this.p.vel[i * 3 + 1] = (Math.random() - 0.5) * 0.12 + 0.03;
      this.p.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
      this.p.size[i] = 0.03 + Math.random() * 0.07;
      const g = Math.random();
      this.p.col[i * 3] = 0.55 + g * 0.3; this.p.col[i * 3 + 1] = 0.75 + g * 0.2; this.p.col[i * 3 + 2] = 0.35 + g * 0.2;
      this.ph[i] = Math.random() * 6.28;
      this.p.alpha[i] = 0.35 + Math.random() * 0.5;
    }
    this.points = this.p.points;
    this.t = 0;
  }
  update(dt, cam) {
    this.t += dt;
    const P = this.p.pos, V = this.p.vel, A = this.p.alpha, B = this.box;
    const cx = cam.x, cy = cam.y, cz = cam.z, hx = B[0] / 2, hy = B[1] / 2, hz = B[2] / 2;
    const tt = this.t;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3, ph = this.ph[i];
      P[i3] += (V[i3] + Math.sin(tt * 0.7 + ph) * 0.08) * dt;
      P[i3 + 1] += (V[i3 + 1] + Math.sin(tt * 0.5 + ph * 1.3) * 0.05) * dt;
      P[i3 + 2] += (V[i3 + 2] + Math.cos(tt * 0.6 + ph) * 0.08) * dt;
      let d = P[i3] - cx; if (d > hx) P[i3] -= B[0]; else if (d < -hx) P[i3] += B[0];
      d = P[i3 + 1] - cy; if (d > hy) P[i3 + 1] -= B[1]; else if (d < -hy) P[i3 + 1] += B[1];
      d = P[i3 + 2] - cz; if (d > hz) P[i3 + 2] -= B[2]; else if (d < -hz) P[i3 + 2] += B[2];
      A[i] = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(tt * 1.7 + ph * 3.0));
    }
    this.p.aPos.needsUpdate = true; this.p.aAlpha.needsUpdate = true;
    this.p.aCol.needsUpdate = false;
  }
  setScale(px) { this.p.setScale(px); }
  dispose() { this.p.dispose(); }
}

// jagged lightning bolt mesh, regenerated per strike
export function makeBolt(from, groundY) {
  const pts = [];
  const p = from.clone();
  pts.push(p.clone());
  const steps = 14;
  const dy = (from.y - groundY) / steps;
  for (let i = 0; i < steps; i++) {
    p.x += (Math.random() - 0.5) * 9; p.z += (Math.random() - 0.5) * 9; p.y -= dy;
    pts.push(p.clone());
  }
  const geos = [];
  const main = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), 48, 0.55, 4, false);
  geos.push(main);
  for (let b = 0; b < 3; b++) {
    const k = 3 + ((Math.random() * (steps - 6)) | 0);
    const q = pts[k].clone();
    const bp = [q.clone()];
    const dx = (Math.random() - 0.5) * 2, dz = (Math.random() - 0.5) * 2;
    for (let i = 0; i < 5; i++) { q.x += dx * 6 + (Math.random() - 0.5) * 5; q.z += dz * 6 + (Math.random() - 0.5) * 5; q.y -= dy * 0.8; bp.push(q.clone()); }
    geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bp), 16, 0.28, 3, false));
  }
  return geos;
}
