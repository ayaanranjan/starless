// src/story/props.js — STORY helpers: procedural cinematic models & shaders.
import * as THREE from 'three';

export const NOISE = `
float hash3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash3(i), hash3(i+vec3(1.,0.,0.)), f.x), mix(hash3(i+vec3(0.,1.,0.)), hash3(i+vec3(1.,1.,0.)), f.x), f.y),
             mix(mix(hash3(i+vec3(0.,0.,1.)), hash3(i+vec3(1.,0.,1.)), f.x), mix(hash3(i+vec3(0.,1.,1.)), hash3(i+vec3(1.,1.,1.)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a*vnoise(p); p = p*2.03 + 0.17; a *= 0.5; } return s; }
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++){ s += a*vnoise(p); p = p*2.03 + 0.17; a *= 0.5; } return s; }
`;

const pixRatio = () => Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);

// ---------------------------------------------------------------- textures
export function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)', size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner); gr.addColorStop(0.25, mid); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function sunTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  let gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.04, 'rgba(255,250,235,1)');
  gr.addColorStop(0.12, 'rgba(255,214,150,0.55)'); gr.addColorStop(0.4, 'rgba(255,150,80,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  g.translate(S / 2, S / 2);
  for (let i = 0; i < 14; i++) {
    g.rotate(Math.PI / 7 + Math.random() * 0.05);
    const L = S * (0.25 + Math.random() * 0.25);
    const lg = g.createLinearGradient(0, 0, L, 0);
    lg.addColorStop(0, 'rgba(255,240,220,0.5)'); lg.addColorStop(1, 'rgba(255,240,220,0)');
    g.fillStyle = lg; g.fillRect(0, -1.2, L, 2.4);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- starfield
export function makeStars(opts = {}) {
  const count = opts.count ?? 8000, R = opts.radius ?? 4000;
  const patchDir = (opts.patchDir || new THREE.Vector3(0.22, 0.14, -1)).clone().normalize();
  const patchAngle = opts.patchAngle ?? 0.3;
  const patchN = Math.floor(count * (opts.patchFrac ?? 0.07));
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count), kill = new Float32Array(count);
  const v = new THREE.Vector3(), c = new THREE.Color();
  const bandQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0.3, 0.95));
  for (let i = 0; i < count; i++) {
    if (i < patchN) { v.randomDirection().multiplyScalar(Math.tan(patchAngle) * Math.sqrt(Math.random())); v.add(patchDir).normalize(); }
    else if (Math.random() < 0.42) { v.randomDirection(); v.y *= 0.1; v.normalize().applyQuaternion(bandQ); }
    else v.randomDirection();
    pos[i * 3] = v.x * R; pos[i * 3 + 1] = v.y * R; pos[i * 3 + 2] = v.z * R;
    const ang = v.angleTo(patchDir);
    kill[i] = ang < patchAngle ? (ang / patchAngle) * 0.85 + Math.random() * 0.3 : 99.0;
    const r = Math.random();
    if (r < 0.12) c.setRGB(0.62, 0.74, 1.0); else if (r < 0.24) c.setRGB(1.0, 0.82, 0.62);
    else if (r < 0.28) c.setRGB(1.0, 0.55, 0.42); else c.setRGB(0.92, 0.94, 1.0);
    c.multiplyScalar(0.3 + Math.pow(Math.random(), 4) * 1.5);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    size[i] = 1.1 + Math.pow(Math.random(), 6) * 4.5 + (i < patchN ? 0.6 : 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aKill', new THREE.BufferAttribute(kill, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uDark: { value: opts.dark ?? 0 }, uTime: { value: 0 }, uPix: { value: pixRatio() }, uOpacity: { value: 1 } },
    vertexShader: `attribute vec3 aColor; attribute float aSize; attribute float aKill;
      uniform float uDark, uTime, uPix; varying vec3 vC; varying float vA; varying float vBig;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        float alive = clamp((aKill - uDark) * 12.0, 0.0, 1.0);
        float dying = 1.0 - smoothstep(0.0, 0.1, abs(aKill - uDark - 0.07));
        float sp = 1.5 + fract(aKill * 91.7 + position.x) * 5.0;
        float tw = 0.72 + 0.18 * sin(uTime * sp + position.y * 0.01) + 0.1 * sin(uTime * sp * 2.7 + position.z);
        float fl = step(0.5, fract(sin(floor(uTime * 18.0) + position.z) * 43758.5453));
        vA = alive * tw * (1.0 - dying * 0.8 * fl);
        vBig = smoothstep(3.2, 5.4, aSize);
        vC = aColor; gl_PointSize = aSize * uPix * (0.5 + 0.5 * alive) * (1.0 + 2.2 * vBig);
      }`,
    fragmentShader: `uniform float uOpacity; varying vec3 vC; varying float vA; varying float vBig;
      void main(){ vec2 d = gl_PointCoord - 0.5; float k = 1.0 + 2.2 * vBig; float r2 = dot(d, d);
        float a = exp(-r2 * 16.0 * k * k);
        a += vBig * (exp(-abs(d.x) * 70.0) + exp(-abs(d.y) * 70.0)) * (1.0 - smoothstep(0.0, 0.24, r2)) * 0.45;
        a *= vA * uOpacity; if (a < 0.004) discard; gl_FragColor = vec4(vC * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.renderOrder = -10;
  return {
    points, mat,
    set dark(v) { mat.uniforms.uDark.value = v; }, get dark() { return mat.uniforms.uDark.value; },
    update(cam, t) { if (cam) points.position.copy(cam.position); mat.uniforms.uTime.value = t; },
  };
}

// ---------------------------------------------------------------- ICV Perihelion (forward = -Z)
function windowTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 64);
  for (const y of [3, 15, 45, 57]) {
    for (let x = 2; x < 1024; x += 8) {
      if (Math.random() < 0.28) continue;
      const b = 140 + Math.random() * 115;
      g.fillStyle = Math.random() < 0.1 ? `rgb(${b * 0.6 | 0},${b * 0.85 | 0},${b | 0})` : `rgb(${b | 0},${b * 0.82 | 0},${b * 0.55 | 0})`;
      g.fillRect(x, y, 5, 4);
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makePerihelion() {
  const group = new THREE.Group(); group.name = 'perihelion';
  const hull = new THREE.Group(); group.add(hull);
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x8d949e, roughness: 0.5, metalness: 0.65 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.75, metalness: 0.45 });
  const foilMat = new THREE.MeshStandardMaterial({ color: 0xb48a3c, roughness: 0.32, metalness: 0.95 });
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = hull) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const zcyl = (rt, rb, h, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg).rotateX(Math.PI / 2);

  add(zcyl(0.9, 0.9, 62, 12), hullMat, 0, 0, 0);                      // spine
  for (const [x, y] of [[1.3, 1.3], [-1.3, 1.3], [1.3, -1.3], [-1.3, -1.3]]) add(new THREE.BoxGeometry(0.22, 0.22, 56), darkMat, x, y, 2);
  for (let z = -24; z <= 26; z += 5) add(new THREE.BoxGeometry(2.9, 2.9, 0.25), darkMat, 0, 0, z);
  // command module + nose
  add(zcyl(2.3, 3.0, 7, 20), hullMat, 0, 0, -32);
  add(new THREE.ConeGeometry(2.3, 5, 20).rotateX(-Math.PI / 2), hullMat, 0, 0, -38);
  const cockpitGlass = new THREE.MeshStandardMaterial({ color: 0x0a1820, emissive: 0x7fd4ff, emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.2 });
  add(new THREE.BoxGeometry(2.6, 0.5, 1.2), cockpitGlass, 0, 1.6, -35.2).rotation.x = -0.35;
  // cargo / modules
  for (let i = 0; i < 4; i++) { const m = add(new THREE.BoxGeometry(3.6, 3.6, 5.5), i % 2 ? foilMat : hullMat, 0, 0, -6 + i * 6.5); m.rotation.z = i * 0.4; }
  add(new THREE.CylinderGeometry(1.2, 1.2, 9, 12).rotateZ(Math.PI / 2), foilMat, 0, 2.6, 4);
  // radiators
  for (const s of [-1, 1]) {
    const r = add(new THREE.BoxGeometry(9, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0x3c4249, roughness: 0.6, metalness: 0.4, emissive: 0x3a0c06, emissiveIntensity: 0.8 }), s * 6.5, 0, 14);
    r.rotation.z = s * 0.05;
  }
  // engine
  add(zcyl(3.2, 3.6, 7, 20), darkMat, 0, 0, 29);
  const glowTex = glowTexture('rgba(220,240,255,1)', 'rgba(120,190,255,0.5)');
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x9fd4ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const glows = [];
  for (const [x, y] of [[0, 1.5], [-1.4, -0.9], [1.4, -0.9]]) {
    add(new THREE.CylinderGeometry(0.9, 1.5, 2.8, 14, 1, true).rotateX(Math.PI / 2), darkMat, x, y, 33.6).material.side = THREE.DoubleSide;
    const s = new THREE.Sprite(glowMat); s.position.set(x, y, 35.6); s.scale.setScalar(6); group.add(s); glows.push(s);
  }
  const engineLight = new THREE.PointLight(0x8fc8ff, 2.5, 60, 1); engineLight.position.set(0, 0, 38); group.add(engineLight);
  // antennae + dish
  add(new THREE.CylinderGeometry(0.06, 0.06, 9, 5), hullMat, 1.2, 5.5, -28);
  add(new THREE.CylinderGeometry(0.05, 0.05, 6, 5), hullMat, -1.0, 4.2, -26);
  const dish = add(new THREE.SphereGeometry(3.2, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }), 0, -4.6, -22);
  dish.rotation.x = Math.PI * 0.72;
  add(new THREE.CylinderGeometry(0.15, 0.15, 3, 6), hullMat, 0, -3, -22);
  // ring habitat
  const ring = new THREE.Group(); ring.position.z = -18; group.add(ring);
  const winTex = windowTexture(); winTex.wrapS = THREE.RepeatWrapping;
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.45, metalness: 0.6, emissive: 0xffe2b0, emissiveMap: winTex, emissiveIntensity: 2.2 });
  ring.add(new THREE.Mesh(new THREE.TorusGeometry(11, 1.5, 16, 96), ringMat));
  for (let i = 0; i < 4; i++) {
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 9.6, 8), darkMat);
    const a = i * Math.PI / 2; sp.position.set(Math.cos(a) * 5.6, Math.sin(a) * 5.6, 0); sp.rotation.z = a - Math.PI / 2; ring.add(sp);
  }
  ring.add(new THREE.Mesh(zcyl(2.2, 2.2, 3.2, 16), hullMat));
  // nav lights
  const navMat = (c) => new THREE.MeshBasicMaterial({ color: c });
  const navR = add(new THREE.SphereGeometry(0.28, 8, 6), navMat(0xff2a2a), -12.7, 0, -18, group);
  const navG = add(new THREE.SphereGeometry(0.28, 8, 6), navMat(0x2aff6a), 12.7, 0, -18, group);
  const strobe = add(new THREE.SphereGeometry(0.3, 8, 6), navMat(0xffffff), 0, 3.4, 28, group);
  const navSprites = [];
  for (const [o, c] of [[navR, 0xff3030], [navG, 0x30ff70], [strobe, 0xffffff]]) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(3); o.add(s); navSprites.push(s);
  }
  let power = 1, t = 0;
  return {
    group, hull, ring, glows,
    setPower(p) {
      power = p;
      ringMat.emissiveIntensity = 2.2 * p; cockpitGlass.emissiveIntensity = 1.6 * p;
      glowMat.opacity = p; engineLight.intensity = 2.5 * p;
      navR.visible = navG.visible = strobe.visible = p > 0.3;
    },
    update(dt) {
      t += dt; ring.rotation.z += dt * 0.12;
      const sOn = (t % 1.3) < 0.07 && power > 0.3;
      strobe.visible = sOn; navSprites[2].scale.setScalar(sOn ? 6 : 0.01);
      const pulse = 2.6 + Math.sin(t * 3) * 0.6; navSprites[0].scale.setScalar(pulse); navSprites[1].scale.setScalar(pulse);
      for (const g of glows) g.scale.setScalar((5.5 + Math.random() * 0.8) * (0.2 + 0.8 * power));
    },
  };
}

// ---------------------------------------------------------------- The Harvester (head = +Z)
const HL = 450;
function harvR(u) {
  const body = 125 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.02)), 0.75);
  const neck = u > 0.78 ? (u - 0.78) / 0.22 : 0;
  const flare = 92 * Math.pow(neck, 1.6);
  const ribs = 1 + 0.07 * Math.pow(Math.abs(Math.sin(u * Math.PI * 22)), 6);
  return Math.max(body, flare) * ribs + 2;
}
function taperTube(curve, segs, radius, radial, taper = 0.92) {
  const geo = new THREE.TubeGeometry(curve, segs, radius, radial, false);
  const p = geo.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    curve.getPointAt(i / segs, c);
    const k = 1 - taper * (i / segs);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(p, idx).sub(c).multiplyScalar(k).add(c);
      p.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

export function makeHarvester(opts = {}) {
  const group = new THREE.Group(); group.name = 'harvester';
  const body = new THREE.Group(); body.rotation.x = Math.PI / 2; group.add(body); // lathe +Y -> +Z
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x0a0d11, roughness: 0.5, metalness: 0.65, side: THREE.DoubleSide, emissive: 0x03272c, emissiveIntensity: 0 });
  const pts = [];
  for (let i = 0; i <= 120; i++) { const u = i / 120; pts.push(new THREE.Vector2(harvR(u), (u - 0.5) * 2 * HL)); }
  const lathe = new THREE.LatheGeometry(pts, opts.radial ?? 44);
  { const p = lathe.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(x, z);
      const f = 1 + 0.05 * Math.sin(a * 6 + y * 0.03) * Math.sin(y * 0.011) + 0.03 * Math.sin(a * 13 - y * 0.05);
      p.setXYZ(i, x * f, y, z * f);
    }
    lathe.computeVertexNormals(); }
  body.add(new THREE.Mesh(lathe, hullMat));
  // ribs
  for (let i = 0; i < 13; i++) {
    const u = 0.12 + i * 0.055; const r = harvR(u) * 1.04;
    const rib = new THREE.Mesh(new THREE.TorusGeometry(r, 3.2 + r * 0.02, 6, 40), hullMat);
    rib.rotation.x = Math.PI / 2; rib.position.y = (u - 0.5) * 2 * HL; body.add(rib);
  }
  // veins
  const veinMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uI: { value: 0 }, uColor: { value: new THREE.Color(0x58f4ff) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime, uI; uniform vec3 uColor; varying vec2 vUv;
      void main(){ float p = fract(vUv.x * 2.0 - uTime * 0.16); float pulse = smoothstep(0.0, 0.04, p) * smoothstep(0.22, 0.04, p);
        float p2 = fract(vUv.x * 5.0 - uTime * 0.37 + 0.3); float pulse2 = smoothstep(0.0, 0.02, p2) * smoothstep(0.1, 0.02, p2);
        float flick = 0.85 + 0.15 * sin(uTime * 7.0 + vUv.x * 40.0);
        float b = uI * (0.35 + 2.4 * pulse + 0.8 * pulse2) * flick;
        gl_FragColor = vec4(uColor * b + vec3(0.55, 1.0, 1.0) * pulse * uI * 0.7, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const NV = opts.veins ?? 10;
  for (let k = 0; k < NV; k++) {
    const a0 = (k / NV) * Math.PI * 2, dir = k % 2 ? 1 : -1, cp = [];
    for (let s = 0; s <= 36; s++) {
      const u = 0.06 + 0.9 * (s / 36), y = (u - 0.5) * 2 * HL;
      const a = a0 + dir * u * 1.5 + 0.18 * Math.sin(u * 19 + k);
      const r = harvR(u) * 1.1;
      cp.push(new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r));
    }
    body.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cp), 140, opts.veinR ?? 1.8, 4, false), veinMat));
  }
  // maw core + light
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xc8f6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const core = new THREE.Mesh(new THREE.SphereGeometry(52, 24, 16), coreMat); core.position.y = HL - 70; body.add(core);
  const mawLight = new THREE.PointLight(0x9ff2ff, 0, 1600, 0); mawLight.position.y = HL + 30; body.add(mawLight);
  // maw petals
  const petals = [];
  const petalGeo = new THREE.ConeGeometry(16, 150, 6).translate(0, 75, 0);
  for (let i = 0; i < 8; i++) {
    const piv = new THREE.Group(); const a = (i / 8) * Math.PI * 2;
    piv.rotation.y = a; piv.position.set(Math.sin(a) * 88, HL - 6, Math.cos(a) * 88);
    const inner = new THREE.Group(); inner.position.z = 0; piv.add(inner);
    const m = new THREE.Mesh(petalGeo, hullMat); inner.add(m);
    body.add(piv); petals.push(inner);
  }
  // unfolding arms
  const arms = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const piv = new THREE.Group(); piv.rotation.y = a;
    const u = 0.74; piv.position.set(Math.sin(a) * harvR(u), (u - 0.5) * 2 * HL, Math.cos(a) * harvR(u));
    const inner = new THREE.Group(); piv.add(inner);
    const len = 360 + (i % 2) * 90;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -len * 0.22, 12), new THREE.Vector3(0, -len * 0.5, 30), new THREE.Vector3(0, -len * 0.78, 20), new THREE.Vector3(0, -len, 0)]);
    inner.add(new THREE.Mesh(taperTube(curve, 24, 11, 6, 0.9), hullMat));
    const vc = new THREE.CatmullRomCurve3(curve.points.map((p) => p.clone().add(new THREE.Vector3(0, 0, 9))));
    inner.add(new THREE.Mesh(new THREE.TubeGeometry(vc, 40, 1.4, 3, false), veinMat));
    body.add(piv); arms.push(inner);
  }
  // tendrils
  const tendrils = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const piv = new THREE.Group(); piv.position.set(Math.sin(a) * 12, -HL + 10, Math.cos(a) * 12); piv.rotation.y = a;
    const len = 380 + Math.random() * 260, cp = [];
    for (let s = 0; s <= 8; s++) cp.push(new THREE.Vector3(Math.sin(s * 1.3 + i) * 22, -s * len / 8, s * 10 + Math.cos(s * 0.9 + i) * 18));
    piv.add(new THREE.Mesh(taperTube(new THREE.CatmullRomCurve3(cp), 40, 7, 5, 0.94), hullMat));
    body.add(piv); tendrils.push(piv);
  }
  let t = 0, unfold = 0, maw = 0, veins = 0;
  const api = {
    group, body, veinMat, coreMat, mawLight,
    setUnfold(u) { unfold = u; for (const a of arms) a.rotation.x = -u * 1.95; },
    setMaw(m) { maw = m; for (const p of petals) p.rotation.x = lerpN(-1.05, 0.62, m); coreMat.opacity = Math.min(1, m * 1.2); mawLight.intensity = m * 3.0; },
    setVeins(v) { veins = v; veinMat.uniforms.uI.value = v; hullMat.emissiveIntensity = v * 0.35; },
    get veins() { return veins; },
    mawWorld(out) { return core.getWorldPosition(out); },
    update(dt) {
      t += dt; veinMat.uniforms.uTime.value = t;
      for (let i = 0; i < tendrils.length; i++) { const p = tendrils[i]; p.rotation.x = Math.sin(t * 0.35 + i) * 0.16; p.rotation.z = Math.cos(t * 0.27 + i * 1.7) * 0.16; }
      if (maw > 0) core.scale.setScalar(1 + Math.sin(t * 2.2) * 0.05);
    },
  };
  api.setUnfold(0); api.setMaw(0); api.setVeins(0);
  return api;
}
const lerpN = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- beam (origin at target, +Y up to source)
export function makeBeam(color = 0xdff4ff, rTop = 60, rBot = 40) {
  const geo = new THREE.CylinderGeometry(rTop, rBot, 1, 40, 24, true).translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uI: { value: 0 }, uReach: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: NOISE + `uniform float uTime, uI, uReach; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float ndv = abs(dot(normalize(vN), normalize(vV))); float edge = 1.0 - ndv;
        float body = 0.3 * pow(ndv, 1.5) + 0.9 * pow(edge, 2.0);
        float ang = vUv.x * 6.2831853; vec2 ring = vec2(cos(ang), sin(ang));
        float n = fbm3(vec3(ring * 1.8, vUv.y * 8.0 - uTime * 2.2));
        float fine = vnoise(vec3(ring * 6.0, vUv.y * 50.0 - uTime * 9.0));
        float streaks = pow(vnoise(vec3(ring * 9.0, vUv.y * 1.5 - uTime * 0.6)), 3.0);
        float bands = 0.72 + 0.28 * sin(vUv.y * 70.0 - uTime * 10.0 + n * 6.0);
        float reach = smoothstep(1.0 - uReach - 0.08, 1.0 - uReach + 0.01, vUv.y);
        float a = body * (0.3 + 1.1 * n + 0.35 * fine + 1.4 * streaks) * bands * uI * reach * smoothstep(0.0, 0.05, vUv.y) * 0.6;
        gl_FragColor = vec4(uColor * a + vec3(a * a * 0.18), a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
  return {
    mesh, mat,
    set(target, source) { d.subVectors(source, target); const L = d.length(); mesh.position.copy(target); mesh.quaternion.setFromUnitVectors(up, d.divideScalar(L || 1)); mesh.scale.set(1, L, 1); },
    update(t) { mat.uniforms.uTime.value = t; },
  };
}

// ---------------------------------------------------------------- cockpit interior (looks toward -Z)
function drawScreen(g, kind, t, glitch) {
  const W = g.canvas.width, H = g.canvas.height;
  if (glitch > 0 && Math.random() < glitch) {
    g.fillStyle = Math.random() < 0.5 ? '#1c0204' : '#020306'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(${180 + Math.random() * 75 | 0},${Math.random() * 70 | 0},${Math.random() * 50 | 0},${Math.random().toFixed(2)})`; g.fillRect(0, Math.random() * H, W, 2 + Math.random() * 14); }
    g.fillStyle = '#ff3a2a'; g.font = 'bold 22px monospace';
    g.fillText(['POWER FAILURE', 'MAIN BUS OFFLINE', 'REACTOR SCRAM', 'NO CARRIER', 'ERR 0x0000', 'HULL CONTACT'][Math.random() * 6 | 0], 12 + Math.random() * 20, 40 + Math.random() * 80);
    return;
  }
  g.fillStyle = '#020a12'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(95,216,255,0.15)'; g.lineWidth = 1;
  for (let x = 0; x < W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  g.strokeStyle = kind % 2 ? '#7dff9a' : '#5fd8ff'; g.lineWidth = 2; g.beginPath();
  for (let x = 0; x <= W; x += 4) { const y = H * 0.62 + Math.sin(x * 0.07 + t * 4 + kind) * 18 * Math.sin(t * 0.7 + x * 0.013); if (x) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  g.fillStyle = '#9fd8ff'; g.font = '18px monospace';
  g.fillText(['LANTERN 1.42 GHz', 'HULL 100%', 'NAV LOCK', 'REACTOR 98%'][kind % 4], 12, 26);
  g.fillText('T+' + (t * 13.7 + kind * 100).toFixed(1), 12, 50);
}

export function makeCockpit() {
  const group = new THREE.Group(); group.name = 'cockpit';
  const wall = new THREE.MeshStandardMaterial({ color: 0x353c45, roughness: 0.8, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15191e, roughness: 0.85, metalness: 0.25 });
  const box = (w, h, d, x, y, z, m = wall) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); group.add(b); return b; };
  box(3.4, 0.1, 3.8, 0, -0.95, 0); box(3.4, 0.1, 3.8, 0, 1.35, 0);
  box(0.1, 2.3, 3.8, -1.7, 0.2, 0); box(0.1, 2.3, 3.8, 1.7, 0.2, 0); box(3.4, 2.3, 0.1, 0, 0.2, 1.9);
  box(3.4, 0.4, 0.2, 0, 1.15, -1.9); box(3.4, 0.55, 0.2, 0, -0.7, -1.9);
  box(0.1, 1.5, 0.12, -0.6, 0.2, -1.9, dark); box(0.1, 1.5, 0.12, 0.6, 0.2, -1.9, dark);
  box(0.3, 2.3, 0.2, -1.55, 0.2, -1.9); box(0.3, 2.3, 0.2, 1.55, 0.2, -1.9);
  box(3.1, 0.22, 0.9, 0, -0.42, -1.35, dark).rotation.x = 0.4;
  box(2.6, 0.12, 0.7, 0, 1.18, -1.1, dark).rotation.x = -0.3;
  for (const x of [-0.7, 0.7]) { box(0.62, 0.12, 0.62, x, -0.58, 0.35, dark); box(0.62, 0.95, 0.12, x, -0.05, 0.68, dark); box(0.34, 0.3, 0.1, x, 0.6, 0.7, dark); }
  // buttons
  const btnCols = [0x5fd8ff, 0xffb347, 0x7dff9a, 0xff4040];
  const btnMats = btnCols.map((c) => new THREE.MeshBasicMaterial({ color: c }));
  const btnGeo = new THREE.BoxGeometry(0.05, 0.02, 0.05);
  for (let i = 0; i < 28; i++) { const b = new THREE.Mesh(btnGeo, btnMats[i % 4]); b.position.set(-1.1 + (i % 14) * 0.17, 1.1 - (i / 14 | 0) * 0.05, -0.95 - (i / 14 | 0) * 0.12); group.add(b); }
  const screens = [];
  for (let i = 0; i < 4; i++) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 144;
    const g = c.getContext('2d'); const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    drawScreen(g, i, 0, 0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.34), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    m.position.set(-1.05 + i * 0.7, -0.2, -1.42); m.rotation.x = -0.75; group.add(m);
    screens.push({ g, tex, kind: i, mesh: m });
  }
  const alarm = new THREE.PointLight(0xff1a10, 0, 9, 0); alarm.position.set(0, 1.0, 0.2); group.add(alarm);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0x330000 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), bulbMat); bulb.position.set(0, 1.25, 0.4); group.add(bulb);
  const fill = new THREE.PointLight(0x6fa8ff, 1.2, 7, 0); fill.position.set(0, 0.1, -0.9); group.add(fill);
  let t = 0, acc = 0, glitch = 0, alarmOn = false;
  return {
    group,
    setGlitch(v) { glitch = v; }, setAlarm(on) { alarmOn = on; },
    setPower(p) { fill.intensity = 1.2 * p; for (const s of screens) s.mesh.visible = p > 0.05 || Math.random() < 0.3; },
    update(dt) {
      t += dt; acc += dt;
      const a = alarmOn ? Math.max(0, Math.sin(t * 7)) : 0;
      alarm.intensity = a * 3.2; bulbMat.color.setRGB(0.25 + a * 0.75, 0.02, 0.0);
      if (acc > 0.08) { acc = 0; for (const s of screens) { drawScreen(s.g, s.kind, t, glitch); s.tex.needsUpdate = true; } }
    },
  };
}

// ---------------------------------------------------------------- Kestrel rocket (up = +Y)
export function makeRocket() {
  const group = new THREE.Group(); group.name = 'kestrel';
  const white = new THREE.MeshStandardMaterial({ color: 0xc9ccc4, roughness: 0.55, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.7, metalness: 0.5 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x8a4b25, roughness: 0.8, metalness: 0.3 });
  const add = (geo, m, y) => { const o = new THREE.Mesh(geo, m); o.position.y = y; group.add(o); return o; };
  add(new THREE.CylinderGeometry(1.4, 1.6, 13, 18), white, 6.5);
  add(new THREE.CylinderGeometry(1.42, 1.42, 1.0, 18), rust, 9.5);
  add(new THREE.CylinderGeometry(1.62, 1.62, 0.8, 18), dark, 2.0);
  add(new THREE.ConeGeometry(1.4, 4.5, 18), white, 15.25);
  add(new THREE.CylinderGeometry(0.7, 1.25, 1.6, 14, 1, true), dark, -0.7).material.side = THREE.DoubleSide;
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2, 2.0), dark);
    const a = i * Math.PI / 2 + Math.PI / 4; f.position.set(Math.sin(a) * 1.9, 1.6, Math.cos(a) * 1.9); f.rotation.y = a; group.add(f);
  }
  const flameMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uI: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: NOISE + `uniform float uTime, uI; varying vec2 vUv;
      void main(){ float n = vnoise(vec3(vUv.x * 10.0, vUv.y * 6.0 + uTime * 14.0, uTime));
        float core = pow(vUv.y, 2.2); vec3 c = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.95, 0.8), core);
        float a = core * (0.55 + 0.6 * n) * uI; gl_FragColor = vec4(c * a * 2.0, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(1.1, 12, 16, 1, true).rotateX(Math.PI).translate(0, -7.2, 0), flameMat);
  group.add(flame);
  const light = new THREE.PointLight(0xff9a40, 0, 90, 0); light.position.y = -4; group.add(light); // cutoff: no orange ground from orbit
  let t = 0, thrust = 0;
  return {
    group, flame,
    setThrust(v) { thrust = v; },
    update(dt) {
      t += dt; flameMat.uniforms.uTime.value = t;
      const fl = thrust * (0.85 + Math.random() * 0.3);
      flameMat.uniforms.uI.value = fl; flame.scale.set(1, 0.6 + 0.6 * fl, 1); light.intensity = fl * 4;
    },
  };
}

// ---------------------------------------------------------------- the Ark (alien warp-ship)
export function makeArk() {
  const group = new THREE.Group(); group.name = 'ark';
  const m = new THREE.MeshStandardMaterial({ color: 0x0d1210, roughness: 0.55, metalness: 0.75, emissive: 0x0a2a14, emissiveIntensity: 0 });
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), m); hull.scale.set(240, 55, 560); group.add(hull);
  for (let i = 0; i < 11; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(14, 50 + Math.random() * 70, 40 + Math.random() * 40), m);
    const z = -450 + i * 90; s.position.set(0, 40 * Math.sqrt(Math.max(0, 1 - (z / 560) ** 2)) + 10, z); group.add(s);
  }
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(260, 10, 180), m); w.position.set(sx * 300, -5, 120); w.rotation.z = sx * -0.12; w.rotation.y = sx * 0.3; group.add(w);
  }
  const glow = new THREE.MeshBasicMaterial({ color: 0x5dff8a, transparent: true, opacity: 0 });
  for (let i = 0; i < 14; i++) {
    const z = -500 + i * 75, r = Math.sqrt(Math.max(0, 1 - (z / 560) ** 2));
    for (const sx of [-1, 1]) { const s = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 34), glow); s.position.set(sx * 200 * r, -38 * r, z); group.add(s); }
  }
  const hangar = new THREE.Mesh(new THREE.CircleGeometry(60, 40), new THREE.MeshBasicMaterial({ color: 0x8dffb0, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  hangar.rotation.x = Math.PI / 2; hangar.position.y = -56; group.add(hangar);
  const light = new THREE.PointLight(0x5dff8a, 0, 650, 0); light.position.y = -120; group.add(light);
  return {
    group,
    setLights(v) { glow.opacity = v; hangar.material.opacity = v * 0.9; light.intensity = v * 2.5; m.emissiveIntensity = v * 0.6; },
    hangarWorld(out) { return hangar.getWorldPosition(out); },
  };
}

// ---------------------------------------------------------------- warp tunnel (camera looks down -Z)
export function makeWarpTunnel() {
  const geo = new THREE.CylinderGeometry(9, 9, 700, 64, 1, true).rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSpeed: { value: 3 }, uColor: { value: new THREE.Color(0xff2040) }, uFade: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime, uSpeed, uFade; uniform vec3 uColor; varying vec2 vUv;
      float h1(float x){ return fract(sin(x * 12.9898) * 43758.5453); }
      void main(){
        float a = vUv.x * 90.0; float lane = floor(a); float h = h1(lane);
        float seg = fract(vUv.y * (5.0 + h * 9.0) + uTime * uSpeed * (0.6 + h));
        float streak = smoothstep(0.0, 0.08, seg) * smoothstep(0.7, 0.1, seg);
        float across = 1.0 - abs(fract(a) - 0.5) * 2.0;
        float b = streak * pow(across, 2.0) * (0.25 + 0.75 * h) * step(0.35, h);
        float far = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
        vec3 c = uColor * (0.12 + b * 2.4) + vec3(b * b * 0.6);
        gl_FragColor = vec4(c * far * uFade, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  return { mesh, mat, update(t) { mat.uniforms.uTime.value = t; } };
}

// ---------------------------------------------------------------- the eye in the dark
export function makeEye(w = 1100) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOpen: { value: 0 }, uTime: { value: 0 }, uLook: { value: new THREE.Vector2(0.06, 0.02) }, uPupil: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: NOISE + `uniform float uOpen, uTime, uPupil; uniform vec2 uLook; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - 0.5) * vec2(2.0, 1.2);
        float lid = uOpen * 0.5 * pow(max(1.0 - p.x * p.x, 0.0), 0.85);
        float d = abs(p.y) - lid;
        float inside = smoothstep(0.012, -0.012, d) * step(0.001, uOpen);
        vec2 ip = p - uLook; float r = length(ip); float ang = atan(ip.y, ip.x);
        float fib = vnoise(vec3(ang * 9.0, r * 14.0, uTime * 0.15)) * 0.6 + vnoise(vec3(ang * 30.0, r * 40.0, 1.0)) * 0.4;
        vec3 irisC = mix(vec3(0.42, 0.06, 0.75), vec3(1.0, 0.78, 0.32), smoothstep(0.34, 0.07, r));
        irisC *= 0.45 + 0.9 * fib;
        float iris = smoothstep(0.35, 0.33, r);
        float pr = length(ip * vec2(1.0 / (0.045 * uPupil), 1.0 / 0.27));
        float pupil = smoothstep(1.0, 0.86, pr);
        vec3 sclera = vec3(0.05, 0.015, 0.07) + vec3(0.22, 0.03, 0.12) * fbm3(vec3(p * 9.0, uTime * 0.05));
        sclera += vec3(0.4, 0.05, 0.1) * smoothstep(0.62, 0.7, vnoise(vec3(p * 30.0, 2.0))) * 0.4;
        vec3 col = mix(sclera, irisC, iris);
        col = mix(col, vec3(0.0), pupil);
        col += vec3(1.0, 0.9, 1.0) * smoothstep(0.035, 0.0, length(ip - vec2(-0.1, 0.11))) * 0.8;
        col *= 0.25 + 0.75 * smoothstep(0.0, -0.1, d);
        float rim = smoothstep(0.05, 0.0, abs(d)) * uOpen;
        float edgeFade = smoothstep(1.0, 0.82, abs(p.x));
        vec3 outC = col * inside + vec3(0.55, 0.18, 0.95) * rim * 0.5;
        float alpha = max(inside, rim * 0.6) * edgeFade;
        gl_FragColor = vec4(outC, alpha);
      }`,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.6), mat);
  return { mesh, mat, update(t) { mat.uniforms.uTime.value = t; } };
}

// ---------------------------------------------------------------- Earth
export function makeEarth(R = 1000) {
  const sun = new THREE.Vector3(0.62, 0.32, -0.72).normalize();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sun }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vW; varying vec3 vO;
      void main(){ vO = normal; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: NOISE + `uniform vec3 uSun; uniform float uTime; varying vec3 vN; varying vec3 vW; varying vec3 vO;
      void main(){
        vec3 p = normalize(vO); vec3 N = normalize(vN); vec3 L = normalize(uSun); vec3 V = normalize(cameraPosition - vW);
        float h = fbm(p * 2.3 + 3.1);
        float land = smoothstep(0.53, 0.56, h);
        float lat = abs(p.y);
        vec3 ocean = mix(vec3(0.005, 0.03, 0.11), vec3(0.02, 0.11, 0.27), smoothstep(0.3, 0.53, h));
        vec3 landC = mix(vec3(0.09, 0.2, 0.05), vec3(0.45, 0.35, 0.2), smoothstep(0.57, 0.72, h));
        landC = mix(landC, vec3(0.85, 0.88, 0.9), smoothstep(0.78, 0.9, lat));
        vec3 surf = mix(ocean, landC, land);
        float cl = smoothstep(0.5, 0.78, fbm(p * 4.2 + vec3(uTime * 0.004, 0.0, uTime * 0.002)));
        float ndl = dot(N, L);
        float day = smoothstep(-0.1, 0.25, ndl);
        vec3 col = surf * (0.03 + 1.25 * max(ndl, 0.0));
        col = mix(col, vec3(1.0) * (0.02 + 1.05 * max(ndl, 0.0)), cl * 0.92);
        vec3 H = normalize(V + L);
        col += vec3(1.0, 0.82, 0.6) * pow(max(dot(N, H), 0.0), 70.0) * (1.0 - land) * (1.0 - cl) * day * 0.9;
        float city = land * (1.0 - cl) * smoothstep(0.62, 0.85, vnoise(p * 70.0)) * smoothstep(0.08, -0.25, ndl);
        col += vec3(1.0, 0.68, 0.32) * city * 0.75;
        col += vec3(1.0, 0.4, 0.12) * smoothstep(0.18, 0.0, abs(ndl)) * 0.1;
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col += vec3(0.3, 0.58, 1.0) * fres * (0.08 + 0.9 * day);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 80), mat);
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sun } },
    vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 V = normalize(cameraPosition - vW); float f = dot(normalize(vN), V);
        float g = smoothstep(0.0, -0.3, f) * smoothstep(-0.55, -0.25, f);
        float s = 0.25 + 0.75 * smoothstep(-0.4, 0.5, dot(normalize(vN), normalize(uSun)));
        vec3 c = mix(vec3(0.25, 0.55, 1.0), vec3(1.0, 0.6, 0.35), smoothstep(0.25, -0.1, dot(normalize(vN), normalize(uSun))) * 0.5);
        float a = g * s * 1.4; gl_FragColor = vec4(c * a, a); }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.045, 96, 64), atmoMat);
  const group = new THREE.Group(); group.add(mesh, atmo);
  return { group, mat, sun, update(t) { mat.uniforms.uTime.value = t; mesh.rotation.y = t * 0.004; } };
}

// ---------------------------------------------------------------- simple dark planet (menu / Vesper-from-orbit)
export function makeDarkPlanet(R = 2400, rim = 0x3fd0c8, base = 0x0b1214) {
  const sun = new THREE.Vector3(-0.3, 0.6, -0.75).normalize();
  const scat = { value: 0 }; // forward-scattering strength (sunrise glow on the limb)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uRim: { value: new THREE.Color(rim) }, uBase: { value: new THREE.Color(base) }, uSun: { value: sun }, uScat: scat },
    vertexShader: `varying vec3 vN; varying vec3 vW; varying vec3 vO; void main(){ vO = normal; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: NOISE + `uniform vec3 uRim, uBase, uSun; uniform float uScat; varying vec3 vN; varying vec3 vW; varying vec3 vO;
      void main(){ vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW); vec3 L = normalize(uSun);
        float bands = fbm3(vec3(normalize(vO).y * 14.0, normalize(vO).x * 2.0, normalize(vO).z * 2.0));
        float sdl = dot(N, L); float ndl = max(sdl, 0.0);
        vec3 c = uBase * (0.5 + bands) + uBase * 3.0 * ndl * bands;
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        float fwd = pow(max(dot(-V, L), 0.0), 18.0);
        c += uRim * fres * (0.25 + 0.9 * ndl + 0.9 * uScat * fwd);
        c += mix(uRim, vec3(1.0, 0.7, 0.45), 0.5) * smoothstep(0.18, 0.0, abs(sdl)) * fres * 0.35 * uScat;
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), mat);
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uRim: { value: new THREE.Color(rim) }, uSun: { value: sun }, uScat: scat },
    vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uRim, uSun; uniform float uScat; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 V = normalize(cameraPosition - vW); vec3 N = normalize(vN); vec3 L = normalize(uSun); float f = dot(N, V);
        float g = smoothstep(0.0, -0.22, f) * smoothstep(-0.5, -0.2, f);
        float thin = pow(g, 7.0);
        float day = 0.45 + 0.55 * smoothstep(-0.4, 0.4, dot(N, L));
        float fwd = pow(max(dot(-V, L), 0.0), 16.0) * uScat;
        vec3 col = uRim * (g * 0.75 + thin * 1.3) * day + mix(uRim, vec3(1.0, 0.86, 0.62), 0.65) * (thin * 3.0 + g * 0.3) * fwd;
        gl_FragColor = vec4(col, 1.0); }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.03, 96, 64), atmoMat);
  const group = new THREE.Group(); group.add(mesh, atmo);
  return { group, sun, setScatter(v) { scat.value = v; } };
}

// ---------------------------------------------------------------- nebula sky (fbm evaluated per VERTEX: costs ~nothing per pixel)
export function makeNebula(opts = {}) {
  const R = opts.radius ?? 2800;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uA: { value: new THREE.Color(opts.colorA ?? 0x1d4f7a) }, uB: { value: new THREE.Color(opts.colorB ?? 0x56206e) }, uC: { value: new THREE.Color(opts.colorC ?? 0x16706a) },
      uI: { value: opts.intensity ?? 1 }, uVoid: { value: (opts.voidDir || new THREE.Vector3(0.22, 0.14, -1)).clone().normalize() }, uVoidR: { value: opts.voidAngle ?? 0.3 },
      uBand: { value: (opts.bandDir || new THREE.Vector3(0.35, 0.9, 0.25)).clone().normalize() },
    },
    vertexShader: NOISE + `uniform vec3 uA, uB, uC, uVoid, uBand; uniform float uI, uVoidR; varying vec3 vCol; varying vec3 vDir;
      void main(){
        vec3 p = normalize(position); vDir = p;
        float band = exp(-pow(dot(p, uBand) * 2.6, 2.0));
        vec3 q = p * 2.0;
        vec3 w = vec3(fbm3(q + 1.7), fbm3(q + 9.2), fbm3(q + 4.4));
        float n = fbm(q * 1.2 + w * 1.8);
        float lanes = fbm3(p * 4.5 + w * 1.5);
        float dens = smoothstep(0.36, 0.7, n) * (0.3 + 0.95 * band);
        vec3 col = mix(uA, uB, smoothstep(0.32, 0.6, w.x));
        col = mix(col, uC, smoothstep(0.42, 0.66, w.z) * 0.75);
        col *= dens;
        col += vec3(0.7, 0.78, 1.0) * band * smoothstep(0.35, 0.75, n) * 0.05;
        col *= 1.0 - smoothstep(0.42, 0.62, lanes) * 0.8;
        float vd = acos(clamp(dot(p, uVoid), -1.0, 1.0));
        col *= 0.15 + 0.85 * smoothstep(uVoidR * 0.6, uVoidR * 1.2, vd);
        col += mix(uB, uC, 0.5) * 0.45 * exp(-pow((vd - uVoidR * 1.15) / (uVoidR * 0.22), 2.0)) * (0.4 + n);
        vCol = col * uI;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: NOISE + `varying vec3 vCol; varying vec3 vDir;
      void main(){ float g = vnoise(vDir * 70.0); vec3 c = vCol * (0.8 + 0.4 * g);
        c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
        gl_FragColor = vec4(max(c, 0.0), 1.0); }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 200, 110), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -20;
  return { mesh, mat, update(cam) { if (cam) mesh.position.copy(cam.position); } };
}

// ---------------------------------------------------------------- lens flare (screen-space ghosts + anamorphic streak)
function streakTexture() {
  const W = 256, H = 32, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W * 2 - 1, v = (y + 0.5) / H * 2 - 1;
    const a = Math.pow(Math.max(0, 1 - Math.abs(u)), 2.2) * Math.exp(-v * v * 22);
    const i = (y * W + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function ringTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.72, 'rgba(255,255,255,0.12)'); gr.addColorStop(0.86, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function makeFlare(opts = {}) {
  const group = new THREE.Group(); group.name = 'flare';
  const col = new THREE.Color(opts.color ?? 0xffe0b0);
  const glow = glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.25)', 128), streakT = streakTexture(), ringT = ringTexture();
  const mk = (map, c, op) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: c, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: op, fog: false }));
    s.renderOrder = 60; s.frustumCulled = false; group.add(s); s.userData.op = op; return s;
  };
  const core = mk(glow, col.clone().multiplyScalar(2.4), 1.0), halo = mk(glow, col.clone().multiplyScalar(0.6), 0.6);
  const streak = mk(streakT, new THREE.Color(opts.streak ?? 0x86c4ff).multiplyScalar(1.8), 0.9), streak2 = mk(streakT, col.clone().multiplyScalar(1.5), 0.7);
  const ghosts = [[0.55, 0.05, 0x7fffd0, glow], [0.2, 0.025, 0xffa070, glow], [-0.35, 0.07, 0x6aa8ff, ringT], [-0.7, 0.035, 0xc89aff, glow], [-1.1, 0.12, 0x80e0ff, ringT]]
    .map(([k, s, c, m]) => ({ k, s, sp: mk(m, new THREE.Color(c), 0.16) }));
  const size = opts.size ?? 1, v = new THREE.Vector3(), D = 10;
  const place = (sp, nx, ny, cam, tanX, tanY) => { sp.position.set(nx * tanX * D, ny * tanY * D, -D).applyMatrix4(cam.matrixWorld); };
  return {
    group,
    // worldPos: the light; intensity 0..n (caller folds in occlusion). Call AFTER the camera has been placed this frame.
    update(cam, worldPos, intensity = 1, time = 0) {
      if (!cam) return;
      cam.updateMatrixWorld();
      const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), tanX = tanY * (cam.aspect || 1.7);
      v.copy(worldPos).applyMatrix4(cam.matrixWorldInverse); // camera space: independent of near/far
      const front = v.z < -0.01; const iz = front ? 1 / -v.z : 0; v.set(v.x * iz / tanX, v.y * iz / tanY, 0);
      const onScreen = front && Math.abs(v.x) < 1.4 && Math.abs(v.y) < 1.4;
      const edge = 1 - Math.min(1, Math.max(0, Math.max(Math.abs(v.x), Math.abs(v.y)) - 0.9) / 0.5);
      const I = onScreen ? Math.max(0, intensity) * edge : 0;
      group.visible = I > 0.002;
      if (!group.visible) return;
      const H = 2 * tanY * D, flick = 0.94 + 0.06 * Math.sin(time * 13.7) * Math.sin(time * 5.3);
      place(core, v.x, v.y, cam, tanX, tanY); core.scale.setScalar(H * 0.2 * size * (0.6 + 0.4 * Math.min(1, I))); core.material.opacity = Math.min(1, I) * flick;
      place(halo, v.x, v.y, cam, tanX, tanY); halo.scale.setScalar(H * 0.55 * size); halo.material.opacity = halo.userData.op * Math.min(1, I);
      place(streak, v.x, v.y, cam, tanX, tanY); streak.scale.set(H * 2.6 * size * (0.7 + 0.3 * Math.min(1, I)), H * 0.035 * size, 1); streak.material.opacity = streak.userData.op * Math.min(1.2, I) * flick;
      place(streak2, v.x, v.y, cam, tanX, tanY); streak2.scale.set(H * 0.9 * size, H * 0.012 * size, 1); streak2.material.opacity = streak2.userData.op * Math.min(1, I);
      const centered = 1 - Math.min(1, Math.hypot(v.x, v.y) / 1.6);
      for (const g of ghosts) { place(g.sp, v.x * g.k, v.y * g.k, cam, tanX, tanY); g.sp.scale.setScalar(H * g.s * 2 * size); g.sp.material.opacity = g.sp.userData.op * Math.min(1, I) * (0.35 + 0.65 * centered); }
    },
  };
}

// ---------------------------------------------------------------- drifting dust motes around the camera (wraps in a box)
export function makeDust(opts = {}) {
  const N = opts.count ?? 260, B = opts.box ?? 120;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * B; pos[i * 3 + 1] = (Math.random() - 0.5) * B; pos[i * 3 + 2] = (Math.random() - 0.5) * B; seed[i] = Math.random(); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: B }, uPix: { value: pixRatio() }, uColor: { value: new THREE.Color(opts.color ?? 0x9fc8d8) }, uOpacity: { value: opts.opacity ?? 0.5 } },
    vertexShader: `attribute float aSeed; uniform float uTime, uBox, uPix; uniform vec3 uCam; varying float vA;
      void main(){
        vec3 drift = vec3(sin(aSeed * 40.0 + uTime * 0.05), cos(aSeed * 23.0 + uTime * 0.04) * 0.6 - 0.3, sin(aSeed * 17.0 + uTime * 0.03)) * uTime * 0.6;
        vec3 p = mod(position + drift - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float d = -mv.z; vA = smoothstep(2.0, 8.0, d) * smoothstep(uBox * 0.5, uBox * 0.25, d) * (0.4 + 0.6 * fract(aSeed * 7.3));
        gl_PointSize = clamp((1.2 + aSeed * 2.2) * uPix * 30.0 / max(d, 1.0), 1.0, 6.0);
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA;
      void main(){ vec2 d = gl_PointCoord - 0.5; float a = exp(-dot(d, d) * 14.0) * vA * uOpacity; if (a < 0.003) discard; gl_FragColor = vec4(uColor * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat); points.frustumCulled = false;
  return { points, mat, update(cam, t) { mat.uniforms.uTime.value = t; if (cam) mat.uniforms.uCam.value.copy(cam.position); } };
}

// ---------------------------------------------------------------- soft particle layer
export function makeCloudLayer({ count = 350, spread = 1400, y = 150, thick = 30, size = 110, color = 0x8fa84a, opacity = 0.5, map }) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * spread; pos[i * 3 + 1] = y + (Math.random() - 0.5) * thick; pos[i * 3 + 2] = (Math.random() - 0.5) * spread;
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ map, size, sizeAttenuation: true, color, transparent: true, opacity, depthWrite: false });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
  return pts;
}
