// src/story/cutscenes.js — STORY. playCutscene(name, ctx) -> { promise, skip() }; buildMenuBackdrop(ctx).
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { makeStars, makePerihelion, makeHarvester, makeBeam, makeCockpit, makeRocket, makeArk, makeWarpTunnel, makeEye, makeEarth, makeDarkPlanet, makeCloudLayer, glowTexture, sunTexture } from './props.js';

const CANCEL = Symbol('cutscene-cancel');
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const ramp = (t, a, b) => clamp01((t - a) / (b - a));
const PATCH = new THREE.Vector3(0.22, 0.14, -1).normalize();

function crew(ctx) {
  const list = [];
  try { for (const p of ctx.players?.values?.() || []) if (p?.callsign && !list.includes(p.callsign)) list.push(p.callsign); } catch (e) { /* ignore */ }
  for (const c of CONFIG.callsigns || ['VEGA', 'ORION', 'LYRA', 'ATLAS']) if (!list.includes(c)) list.push(c);
  return list;
}

function disposeTree(root) {
  const geos = new Set(), mats = new Set(), texs = new Set();
  root.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) { mats.add(m); for (const k in m) { const v = m[k]; if (v && v.isTexture) texs.add(v); } if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k]?.value; if (v && v.isTexture) texs.add(v); } }
    if (o.isLight && o.dispose) o.dispose();
  });
  geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); texs.forEach((t) => t.dispose());
}

// DOM overlay (caption + veil) inserted as first child of #ui so UI subtitles/cards stay above it.
function makeOverlay() {
  const parent = document.getElementById('ui') || document.body;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;display:flex;align-items:center;justify-content:center;';
  const veil = document.createElement('div');
  veil.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;transition:opacity 0.5s linear;';
  const cap = document.createElement('div');
  cap.style.cssText = 'position:relative;color:#cfd9e2;font:400 20px "Share Tech Mono",monospace;letter-spacing:.32em;text-align:center;white-space:pre-line;opacity:1;transition:opacity 1.2s;text-shadow:0 0 12px rgba(120,200,255,.35);padding:0 16px;';
  el.append(veil, cap);
  const ensure = () => { if (!el.isConnected) parent.insertBefore(el, parent.firstChild); };
  ensure();
  return {
    veil(color, opacity, sec) { ensure(); veil.style.transition = `opacity ${Math.max(0.001, sec)}s linear`; veil.style.background = color; void veil.offsetWidth; veil.style.opacity = String(opacity); },
    text(s, style) { ensure(); cap.style.opacity = '1'; if (style === 'serif') { cap.style.font = '300 italic 44px "Cormorant Garamond",serif'; cap.style.letterSpacing = '.18em'; } else { cap.style.font = '400 20px "Share Tech Mono",monospace'; cap.style.letterSpacing = '.32em'; } cap.textContent = s; },
    hideText(sec = 1.2) { cap.style.transition = `opacity ${sec}s`; cap.style.opacity = '0'; },
    remove() { el.remove(); },
  };
}

function createRun(ctx, name) {
  const scene = ctx.scene, camera = ctx.camera;
  const root = new THREE.Group(); root.name = 'cutscene-' + name;
  const saved = { bg: scene?.background ?? null, fog: scene?.fog ?? null, fov: 72, near: camera?.near ?? 0.05, far: camera?.far ?? 1000,
    parent: null, pos: camera?.position.clone(), quat: camera?.quaternion.clone(), up: camera?.up.clone(), hidden: [], cinematic: ctx.cinematic };
  if (camera && camera.parent && camera.parent !== scene) { saved.parent = camera.parent; scene?.add(camera); }
  if (scene) { for (const ch of scene.children) if (ch.visible) { ch.visible = false; saved.hidden.push(ch); } scene.add(root); }
  ctx.cinematic = true;
  const overlay = makeOverlay();
  const pending = new Set(), fns = new Set(), loops = [];
  let done = false, cancelled = false, clock = 0, shotFn = null, shotT = 0, resolveOuter;
  const promise = new Promise((r) => { resolveOuter = r; });

  const tick = (dt) => {
    if (done) return;
    dt = Math.min(Math.max(dt || 0.016, 0), 0.1); clock += dt; shotT += dt;
    for (const f of fns) { try { f(dt, clock); } catch (e) { console.warn('[cutscene]', e); fns.delete(f); } }
    if (shotFn && camera) { try { shotFn(shotT, dt); } catch (e) { console.warn('[cutscene shot]', e); shotFn = null; } }
  };
  let removeUpdate = null;
  const r = typeof ctx.addUpdate === 'function' ? ctx.addUpdate(tick) : null;
  if (typeof r === 'function') removeUpdate = r;
  else if (r && typeof r.remove === 'function') removeUpdate = () => r.remove();
  else if (!ctx.addUpdate) { let last = performance.now(), raf = 0; const loop = () => { const n = performance.now(); tick((n - last) / 1000); last = n; raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); removeUpdate = () => cancelAnimationFrame(raf); }

  const run = {
    ctx, root, scene, camera, overlay, promise,
    get cancelled() { return cancelled; }, get t() { return clock; },
    wait(sec) {
      if (cancelled) return Promise.reject(CANCEL);
      return new Promise((res, rej) => {
        const e = { rej, id: 0 };
        e.id = setTimeout(() => { pending.delete(e); if (cancelled) rej(CANCEL); else res(); }, Math.max(0, sec) * 1000);
        pending.add(e);
      });
    },
    on(fn) { fns.add(fn); return () => fns.delete(fn); },
    shot(fn) { shotFn = fn; shotT = 0; if (fn && camera) { try { fn(0, 0); } catch (e) { /* ignore */ } } },
    fov(f) { if (camera) { camera.fov = f; camera.updateProjectionMatrix(); } },
    space(far = 30000) { if (scene) { scene.background = new THREE.Color(0x000000); scene.fog = null; } if (camera) { camera.near = 0.5; camera.far = far; camera.updateProjectionMatrix(); } },
    sfx(n, o) { try { ctx.audio?.play?.(n, o); } catch (e) { /* ignore */ } },
    loop(n, o) { try { const h = ctx.audio?.loop?.(n, o); if (h) loops.push(h); return h; } catch (e) { return null; } },
    shake(i, d) { try { ctx.fx?.shake?.(i, d); } catch (e) { /* ignore */ } },
    flash(c, i, d) { try { ctx.fx?.flash?.(c, i, d); } catch (e) { /* ignore */ } },
    glitch(a, d) { try { ctx.fx?.pulseGlitch?.(a, d); } catch (e) { /* ignore */ } },
    line(who, text, secs, radio = true) {
      if (cancelled) return;
      try { ctx.ui?.subtitle?.(who, text, secs); } catch (e) { /* ignore */ }
      if (radio) { this.sfx('radio', { volume: 0.35 }); try { ctx.audio?.speak?.(Math.max(0.6, secs - 0.8)); } catch (e) { /* ignore */ } }
    },
    async say(who, text, secs, radio = true) { if (cancelled) throw CANCEL; this.line(who, text, secs, radio); await this.wait(secs + 0.2); },
    async type(text, cps = 16) {
      for (let i = 1; i <= text.length; i++) {
        overlay.text(text.slice(0, i) + (i < text.length ? '▌' : ''));
        if (text[i - 1] !== ' ' && i % 2) this.sfx('typing', { volume: 0.25 });
        await this.wait(1 / cps);
      }
    },
    finish() {
      if (done) return; done = true; cancelled = true;
      for (const e of pending) { clearTimeout(e.id); try { e.rej(CANCEL); } catch (er) { /* ignore */ } }
      pending.clear(); fns.clear(); shotFn = null;
      try { removeUpdate?.(); } catch (e) { /* ignore */ }
      for (const h of loops) { try { h.stop?.(0.4); } catch (e) { /* ignore */ } }
      try { scene?.remove(root); disposeTree(root); } catch (e) { console.warn('[cutscene] dispose', e); }
      if (scene) { scene.background = saved.bg; scene.fog = saved.fog; for (const o of saved.hidden) if (o.parent === scene || o === camera) o.visible = true; }
      if (camera) {
        if (saved.parent) saved.parent.add(camera);
        if (saved.pos) camera.position.copy(saved.pos); if (saved.quat) camera.quaternion.copy(saved.quat); if (saved.up) camera.up.copy(saved.up);
        camera.fov = 72; camera.near = saved.near; camera.far = saved.far; camera.updateProjectionMatrix();
      }
      overlay.remove();
      ctx.cinematic = false;
      try { ctx.ui?.letterbox?.(false); ctx.ui?.fade?.(false, 0.6); } catch (e) { /* ignore */ }
      try { ctx.fx?.setGlitch?.(0); } catch (e) { /* ignore */ }
      resolveOuter();
    },
  };
  return run;
}

// ============================================================ INTRO
async function intro(run) {
  const { ctx, root, camera } = run;
  const [C1, C2] = crew(ctx);
  run.space();
  const stars = makeStars({ patchDir: PATCH, count: 8000 }); root.add(stars.points);
  root.add(new THREE.AmbientLight(0x1c2533, 1.0));
  const key = new THREE.DirectionalLight(0xfff0dd, 1.6); key.position.set(1, 0.6, 0.8); root.add(key);
  const rim = new THREE.DirectionalLight(0x6fc8ff, 1.0); rim.position.set(-0.4, 0.3, -1); root.add(rim);
  const ship = makePerihelion(); root.add(ship.group);
  const cockpit = makeCockpit(); cockpit.group.position.set(0, 0.2, -33.5); cockpit.group.visible = false; ship.group.add(cockpit.group);
  const harv = makeHarvester(); root.add(harv.group);
  const beam = makeBeam(0xe4f6ff, 58, 46); beam.mesh.visible = false; root.add(beam.mesh);

  const S = new THREE.Vector3(0, 0, 60), vel = new THREE.Vector3(0, 0, -7);
  const H = new THREE.Vector3(), maw = new THREE.Vector3(), tmp = new THREE.Vector3(), look = new THREE.Vector3();
  let hDist = 1900, pull = 0, pullT = 0;
  const placeHarv = () => { H.copy(S).addScaledVector(PATCH, hDist); harv.group.position.copy(H); harv.group.lookAt(S); };
  placeHarv();
  run.on((dt, t) => {
    if (pull > 0) { pullT += dt; harv.mawWorld(maw); tmp.subVectors(maw, S).normalize(); vel.lerp(tmp.multiplyScalar(Math.min(10 + 6 * pullT * pullT, 120)), Math.min(1, dt * 2)); }
    S.addScaledVector(vel, dt); ship.group.position.copy(S);
    if (pull > 0) { ship.group.rotation.z += dt * 0.25 * pull; ship.group.rotation.x += dt * 0.08 * pull; }
    ship.update(dt); cockpit.update(dt); harv.update(dt); beam.update(t);
    if (pull > 0) harv.group.lookAt(S); else placeHarv();
    stars.update(camera, t);
    if (beam.mesh.visible) { harv.mawWorld(maw); tmp.copy(S).addScaledVector(PATCH, -40); beam.set(tmp, maw); }
  });

  try { ctx.ui?.fade?.(false, 0.01); } catch (e) { /* ignore */ }
  run.overlay.veil('#000', 1, 0.001);
  ctx.ui?.letterbox?.(true);
  try { ctx.audio?.ambience?.('cutscene'); } catch (e) { /* ignore */ }
  await run.wait(1.0);
  await run.type('2091 — 7.2 AU BEYOND NEPTUNE', 15);
  await run.wait(1.2);
  await run.type('2091 — 7.2 AU BEYOND NEPTUNE\nICV PERIHELION · DEEP SURVEY · DAY 412', 22);
  await run.wait(1.6);
  run.overlay.hideText(1.0);

  // Shot A — the ship glides past
  run.fov(48); S.set(0, 0, 60);
  const camA = new THREE.Vector3(-13, -4.5, 0);
  run.shot((lt) => { camera.position.set(camA.x + lt * 0.15, camA.y + lt * 0.05, camA.z); look.copy(S); look.z -= 8; camera.lookAt(look); });
  run.overlay.veil('#000', 0, 3.0);
  const hum = run.loop('engine_hum', { volume: 0.35 });
  await run.wait(2.5);
  await run.say('CONTROL', 'Perihelion, Control. Survey telescopes lost another forty stars in your sector this week.', 5.2);
  await run.say('HALE', 'Confirmed, Dr. Okafor. The Lantern signal holds at one-point-four-two gigahertz. It is repeating our own carrier wave back to us.', 6.0);

  // Shot B — over the shoulder toward the dying patch
  run.fov(52);
  run.shot((lt) => { camera.position.copy(S).add(tmp.set(6, 7, 78 - lt * 1.6)); look.copy(S).addScaledVector(PATCH, 400); camera.lookAt(look); });
  run.on((dt) => { stars.dark = Math.min(0.38, stars.dark + dt * 0.03); });
  await run.say(C1, 'Then something out there knows we are listening.', 3.6);
  await run.say('CONTROL', 'Hold standoff distance. Observe, record, come home. That is the job.', 4.4);

  // Shot C — telephoto on the patch, stars dying faster
  run.fov(24);
  run.shot((lt) => { camera.position.copy(S).add(tmp.set(-4, 3.2, 26)); look.copy(S).addScaledVector(PATCH, 1000); look.y += Math.sin(lt * 0.7) * 3; camera.lookAt(look); });
  const fast = run.on((dt) => { stars.dark = Math.min(1.25, stars.dark + dt * 0.11); });
  run.sfx('static', { volume: 0.25 });
  await run.say(C2, 'They are going out faster. Hale, are you seeing this?', 3.6);
  await run.say('HALE', 'I am. The dark region is no longer expanding. It is approaching.', 4.4);
  fast();

  // Shot D — the Harvester unfolds
  run.fov(58);
  run.stingerDone = false;
  run.sfx('stinger', { volume: 0.9 }); try { ctx.audio?.stinger?.(); } catch (e) { /* ignore */ }
  run.sfx('metal_groan', { volume: 0.8 });
  let dT = 0;
  run.on((dt) => {
    dT += dt; stars.dark = 1.3;
    harv.setVeins(clamp01(dT / 4) * (0.75 + 0.25 * Math.sin(dT * 9) * (dT < 4 ? 1 : 0.2)));
    harv.setUnfold(smooth((dT - 2) / 8)); harv.setMaw(smooth((dT - 6) / 6) * 0.65);
    hDist = lerp(1900, 820, smooth(dT / 13));
  });
  run.shot((lt) => { camera.position.copy(S).add(tmp.set(-46 - lt * 0.8, -14, 70 + lt * 1.5)); look.copy(S).lerp(H, 0.42); camera.lookAt(look); });
  run.shake(0.15, 3);
  await run.wait(3.5);
  await run.say(C1, 'Control, we have a contact. It is huge. It is—', 3.2);
  run.sfx('metal_groan', { volume: 1 });
  await run.wait(2.6);

  // power dies (exterior)
  run.sfx('alarm', { volume: 0.7 }); run.glitch(0.6, 0.5);
  let pT = 0;
  const pw = run.on((dt) => { pT += dt; const p = pT < 1.6 ? (Math.random() < 0.5 ? 1 - pT / 1.6 : 0.1) : 0; ship.setPower(p); cockpit.setPower(p); });
  await run.wait(2.2);
  pw(); ship.setPower(0); vel.multiplyScalar(0.4); hum?.stop?.(0.3);

  // Shot E — cockpit, red alarm
  ship.hull.visible = false; ship.ring.visible = false; cockpit.group.visible = true;
  cockpit.setAlarm(true); cockpit.setGlitch(0.85); cockpit.setPower(0.3);
  const al = run.loop('alarm_loop', { volume: 0.45 });
  root.children.forEach((c) => { if (c.isAmbientLight) c.intensity = 0.25; });
  run.fov(64);
  const cp = new THREE.Vector3(), ct = new THREE.Vector3();
  run.shot((lt) => {
    cockpit.group.localToWorld(cp.set(Math.sin(lt * 9) * 0.01, 0.3 + Math.sin(lt * 13) * 0.01, 1.25));
    cockpit.group.localToWorld(ct.set(0.4 + Math.sin(lt * 0.5) * 0.3, 0.55, -10));
    camera.position.copy(cp); camera.lookAt(ct);
  });
  run.shake(0.25, 1.0); run.glitch(0.5, 0.6);
  await run.say('HALE', 'Main bus offline. Reactor is not— is not resp— not responding.', 4.0);
  run.sfx('static', { volume: 0.6 }); run.glitch(0.7, 0.4);
  await run.say('CONTROL', 'Perihelion, respond— Perihelion, do you read—', 3.0);

  // Shot F — the beam
  ship.hull.visible = true; ship.ring.visible = true; cockpit.group.visible = false;
  beam.mesh.visible = true; pull = 0.25;
  let bT = 0;
  run.on((dt) => { bT += dt; beam.mat.uniforms.uReach.value = smooth(bT / 2.2); beam.mat.uniforms.uI.value = 0.4 + smooth(bT / 3) * 1.2 + Math.random() * 0.2; harv.setMaw(0.65 + 0.35 * smooth(bT / 4)); pull = 0.25 + bT * 0.25; });
  run.fov(50);
  run.shot((lt) => { camera.position.copy(S).add(tmp.set(34 - lt * 1.5, 12 + lt * 0.6, 48 - lt * 2)); camera.lookAt(S); });
  run.sfx('stinger', { volume: 1 }); run.sfx('static', { volume: 0.8 }); run.shake(0.5, 6); run.glitch(0.6, 1.2);
  await run.say(C2, 'It is pulling us in!', 2.4);
  run.glitch(1, 1.5); run.sfx('metal_groan', { volume: 1 }); run.shake(0.9, 3);
  run.line('HALE', 'I am sorry. I cannot— I c— I—', 2.6);
  await run.wait(2.2);
  run.flash?.(0xffffff, 1, 0.6);
  run.overlay.veil('#e9f4ff', 1, 0.9);
  await run.wait(1.4);
  al?.stop?.(0.2);
  run.overlay.veil('#000', 1, 0.08);
  try { ctx.audio?.ambience?.('silence'); } catch (e) { /* ignore */ }
  await run.wait(1.6);
  run.overlay.text('THEY TOOK US.', 'serif');
  await run.wait(4.0);
  run.overlay.hideText(1.2);
  await run.wait(1.4);
}

// ============================================================ L1 END — escape from Vesper
async function l1End(run) {
  const { ctx, root, scene, camera } = run;
  const [C1] = crew(ctx);
  run.space(30000);
  const bgLow = new THREE.Color(0x26330f), bgSpace = new THREE.Color(0x000000);
  scene.background = bgLow.clone();
  const fogLow = new THREE.Color(0x4b5c1d);
  scene.fog = new THREE.FogExp2(fogLow.clone(), 0.004);
  const hemi = new THREE.HemisphereLight(0xa8c860, 0x0c1006, 1.2); root.add(hemi);
  const dir = new THREE.DirectionalLight(0xd8e8a0, 0.7); dir.position.set(0.3, 1, 0.2); root.add(dir);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshStandardMaterial({ color: 0x1b2210, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -1; root.add(ground);
  const padMat = new THREE.MeshStandardMaterial({ color: 0x3a3d35, roughness: 0.9, metalness: 0.3 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 1.2, 24), padMat); pad.position.y = -0.6; root.add(pad);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(2, 28, 2), padMat); tower.position.set(-5.5, 13, 0); root.add(tower);
  for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.3, 0.3), padMat); b.position.set(-3.8, 3 + i * 4.2, 0); root.add(b); }
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x252b18, roughness: 1 }), 120);
  { const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < 120; i++) { const a = Math.random() * 6.28, r = 20 + Math.random() * 300; p.set(Math.cos(a) * r, 0, Math.sin(a) * r); q.setFromEuler(new THREE.Euler(Math.random(), Math.random(), 0)); s.setScalar(1 + Math.random() * 6); rocks.setMatrixAt(i, m.compose(p, q, s)); } }
  root.add(rocks);
  const rocket = makeRocket(); root.add(rocket.group);
  const puff = glowTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.35)');
  const layers = [makeCloudLayer({ y: 120, map: puff, color: 0x93ad4d, opacity: 0.55 }), makeCloudLayer({ y: 175, map: puff, color: 0x7f9a3e, opacity: 0.6 }), makeCloudLayer({ y: 235, map: puff, color: 0x6f8a35, opacity: 0.65, size: 140 })];
  layers.forEach((l) => root.add(l));
  // smoke
  const SN = 260, sPos = new Float32Array(SN * 3), sVel = new Float32Array(SN * 3); let sIdx = 0;
  for (let i = 0; i < SN; i++) sPos[i * 3 + 1] = -9999;
  const sGeo = new THREE.BufferGeometry(); sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  const smoke = new THREE.Points(sGeo, new THREE.PointsMaterial({ map: puff, size: 9, color: 0xa7a890, transparent: true, opacity: 0.35, depthWrite: false }));
  smoke.frustumCulled = false; root.add(smoke);
  // lightning
  const LN = 14, lPos = new Float32Array(LN * 3);
  const lGeo = new THREE.BufferGeometry(); lGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3));
  const bolt = new THREE.Line(lGeo, new THREE.LineBasicMaterial({ color: 0xe0ffb8, transparent: true, opacity: 0, fog: false })); bolt.frustumCulled = false; root.add(bolt);
  const strike = (camPos) => {
    const a = Math.random() * 6.28, r = 120 + Math.random() * 380;
    let x = camPos.x + Math.cos(a) * r, z = camPos.z + Math.sin(a) * r, y = 240;
    for (let i = 0; i < LN; i++) { lPos[i * 3] = x; lPos[i * 3 + 1] = y; lPos[i * 3 + 2] = z; x += (Math.random() - 0.5) * 30; z += (Math.random() - 0.5) * 30; y -= 240 / (LN - 1); }
    lGeo.attributes.position.needsUpdate = true; bolt.material.opacity = 1; hemi.intensity = 4.5;
    run.sfx('thunder', { volume: 0.5 + Math.random() * 0.4 });
  };
  const stars = makeStars({ patchDir: PATCH, count: 5000, dark: 1.3 }); stars.mat.uniforms.uOpacity.value = 0; root.add(stars.points);
  const ark = makeArk(); ark.group.position.set(0, 1450, -220); ark.group.rotation.y = 0.5; root.add(ark.group);
  const tractor = makeBeam(0x6bff9a, 55, 16); tractor.mesh.visible = false; root.add(tractor.mesh);

  const R = rocket.group.position; let vy = 0, ay = 0, nextBolt = 0.6, captured = 0;
  const arkPos = new THREE.Vector3(), tmp = new THREE.Vector3(), look = new THREE.Vector3();
  run.on((dt, t) => {
    vy += ay * dt; if (captured > 0) vy = lerp(vy, 6, Math.min(1, dt * 0.8)); R.y += vy * dt;
    if (captured > 0) { rocket.group.rotation.z = Math.sin(t * 9) * 0.03 * captured; }
    rocket.update(dt); stars.update(camera, t); tractor.update(t);
    // smoke emit
    const th = rocket.flame.visible ? 1 : 0;
    for (let k = 0; k < 3 && th; k++) { const i = sIdx++ % SN; sPos[i * 3] = R.x + (Math.random() - 0.5) * 2; sPos[i * 3 + 1] = R.y - 4; sPos[i * 3 + 2] = R.z + (Math.random() - 0.5) * 2; const a = Math.random() * 6.28, sp = R.y < 12 ? 9 : 2; sVel[i * 3] = Math.cos(a) * sp; sVel[i * 3 + 1] = R.y < 12 ? Math.random() * 2 : -6; sVel[i * 3 + 2] = Math.sin(a) * sp; }
    for (let i = 0; i < SN; i++) { sPos[i * 3] += sVel[i * 3] * dt; sPos[i * 3 + 1] += sVel[i * 3 + 1] * dt; sPos[i * 3 + 2] += sVel[i * 3 + 2] * dt; sVel[i * 3] *= 0.985; sVel[i * 3 + 2] *= 0.985; }
    sGeo.attributes.position.needsUpdate = true;
    // altitude → atmosphere
    const alt = clamp01((camera.position.y - 230) / 160);
    scene.background.copy(bgLow).lerp(bgSpace, alt);
    scene.fog.color.copy(fogLow).lerp(bgSpace, alt);
    const inCloud = camera.position.y > 100 && camera.position.y < 260 ? 1 : 0;
    scene.fog.density = lerp(lerp(0.004, 0.009, inCloud), 0.00012, alt);
    stars.mat.uniforms.uOpacity.value = alt;
    hemi.intensity = lerp(hemi.intensity, lerp(1.2, 0.35, alt), Math.min(1, dt * 6));
    bolt.material.opacity = Math.max(0, bolt.material.opacity - dt * 7);
    nextBolt -= dt; if (nextBolt < 0 && alt < 0.95) { strike(camera.position); nextBolt = 0.7 + Math.random() * 1.8; }
    if (tractor.mesh.visible) { ark.hangarWorld(arkPos); tmp.copy(R); tmp.y -= 6; tractor.set(tmp, arkPos); }
  });

  try { ctx.ui?.fade?.(false, 0.01); } catch (e) { /* ignore */ }
  run.overlay.veil('#000', 1, 0.001);
  ctx.ui?.letterbox?.(true);
  try { ctx.audio?.ambience?.('cutscene'); } catch (e) { /* ignore */ }
  // Shot 1 — ignition from the ground
  run.fov(58);
  run.shot((lt) => { camera.position.set(26 - lt * 0.4, 2.2, 34 - lt * 0.6); look.set(0, 9 + Math.max(0, R.y) * 0.9, 0); camera.lookAt(look); });
  run.overlay.veil('#000', 0, 1.2);
  rocket.setThrust(0.35); run.sfx('rocket_launch', { volume: 1 }); run.shake(0.25, 3);
  run.line('HALE', 'Valves holding. Main engine at full thrust.', 3.0);
  await run.wait(2.6);
  rocket.setThrust(1); ay = 7; run.shake(0.5, 3);
  await run.say(C1, 'Go, go, GO!', 2.0);
  await run.wait(1.5);
  // Shot 2 — chase through the cloud deck
  run.fov(66);
  run.shot((lt) => { camera.position.set(R.x + 7 + Math.sin(lt * 7) * 0.15, R.y - 16, R.z + 12); look.set(R.x, R.y + 18, R.z); camera.lookAt(look); });
  run.shake(0.35, 6);
  await run.wait(5.5);
  // Shot 3 — out into space; relief
  ay = -2; rocket.setThrust(0.6);
  run.fov(55);
  run.shot((lt) => { camera.position.set(R.x + 34, R.y + 6 - lt * 0.5, R.z + 46); look.set(R.x, R.y + 8, R.z); camera.lookAt(look); });
  await run.wait(1.0);
  try { ctx.audio?.ambience?.('silence'); } catch (e) { /* ignore */ }
  await run.say(C1, 'We are out... We are actually out.', 3.2);
  await run.say('HALE', 'Orbit in ninety seconds. Plotting a course for home.', 3.4);
  // Shot 4 — the Ark looms, tractor beam
  run.sfx('stinger', { volume: 0.9 }); run.sfx('metal_groan', { volume: 0.8 });
  run.fov(60);
  let aT = 0;
  run.on((dt) => { aT += dt; ark.setLights(smooth(aT / 2.5)); ark.group.position.y = lerp(1450, R.y + 380, smooth(aT / 6)); if (aT > 2.2) { tractor.mesh.visible = true; tractor.mat.uniforms.uReach.value = smooth((aT - 2.2) / 1.6); tractor.mat.uniforms.uI.value = 1.1 + Math.random() * 0.2; } if (aT > 3.6) { captured = Math.min(1, (aT - 3.6) / 1.5); rocket.setThrust(Math.random() < 0.5 ? 0.15 : 0.0); ay = 0; } });
  run.shot((lt) => { camera.position.set(R.x - 40, R.y - 34, R.z + 52); look.set(R.x, R.y + 120 + lt * 8, R.z - 40); camera.lookAt(look); });
  await run.wait(3.8);
  run.shake(0.6, 2.5); run.glitch(0.5, 0.8); run.sfx('static', { volume: 0.5 });
  await run.wait(1.2);
  await run.say('HALE', 'Something has us.', 2.8);
  run.overlay.veil('#000', 1, 1.2);
  await run.wait(1.5);
}

// ============================================================ L2 END — warp, then the eye
async function l2End(run) {
  const { ctx, root, scene, camera } = run;
  run.space(5000);
  const tunnel = makeWarpTunnel(); tunnel.mesh.position.z = -320; root.add(tunnel.mesh);
  const cols = [new THREE.Color(0xff1838), new THREE.Color(0x2cf0ff), new THREE.Color(0xffffff), new THREE.Color(0x000000)];
  let wT = 0;
  const warpFn = run.on((dt) => {
    wT += dt; tunnel.update(wT);
    const k = Math.min(2.999, wT / 3.2), i = Math.floor(k), f = smooth(k - i);
    tunnel.mat.uniforms.uColor.value.copy(cols[i]).lerp(cols[i + 1], f);
    tunnel.mat.uniforms.uSpeed.value = 2.5 + wT * 0.6;
    tunnel.mat.uniforms.uFade.value = 1 - smooth((wT - 9) / 1.2);
    camera.up.set(Math.sin(wT * 0.25), Math.cos(wT * 0.25), 0);
  });
  try { ctx.ui?.fade?.(false, 0.01); } catch (e) { /* ignore */ }
  ctx.ui?.letterbox?.(true);
  try { ctx.audio?.ambience?.('cutscene'); } catch (e) { /* ignore */ }
  run.fov(80);
  run.shot((lt) => { camera.position.set(Math.sin(lt * 3) * 0.4, Math.cos(lt * 2.3) * 0.4, 0); camera.lookAt(0, 0, -100); });
  run.overlay.veil('#fff', 0, 0.6);
  run.sfx('warp', { volume: 1 }); run.shake(0.4, 10); run.glitch(0.4, 0.6);
  run.line('HALE', 'Warp field unstable. I cannot hold the—', 3.0);
  await run.wait(3.2); run.sfx('warp', { volume: 0.8 }); run.glitch(0.7, 0.5);
  await run.wait(3.2); run.sfx('warp', { volume: 0.9 }); run.glitch(1, 0.6); run.flash(0xffffff, 0.8, 0.4);
  await run.wait(3.6);
  // silence — violet void
  warpFn(); root.remove(tunnel.mesh); tunnel.mesh.geometry.dispose(); tunnel.mat.dispose();
  camera.up.set(0, 1, 0);
  try { ctx.audio?.ambience?.('silence'); } catch (e) { /* ignore */ }
  scene.background = new THREE.Color(0x06020c);
  const dN = 1500, dPos = new Float32Array(dN * 3);
  for (let i = 0; i < dN; i++) { dPos[i * 3] = (Math.random() - 0.5) * 900; dPos[i * 3 + 1] = (Math.random() - 0.5) * 600; dPos[i * 3 + 2] = -Math.random() * 1400; }
  const dGeo = new THREE.BufferGeometry(); dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({ color: 0x8a5cff, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  root.add(dust);
  const eye = makeEye(1150); eye.mesh.position.set(0, 20, -950); root.add(eye.mesh);
  run.fov(52);
  run.shot((lt) => { camera.position.set(0, 0, -lt * 6); camera.lookAt(0, 12, -950); });
  let eT = 0;
  run.on((dt) => {
    eT += dt; eye.update(eT); dust.rotation.z += dt * 0.004;
    const open = eT < 3.5 ? 0 : smooth((eT - 3.5) / 5.5) * (1 - 0.08 * Math.max(0, Math.sin(eT * 0.9)));
    eye.mat.uniforms.uOpen.value = open;
    eye.mat.uniforms.uPupil.value = lerp(1.6, 0.7, smooth((eT - 8) / 3));
    eye.mat.uniforms.uLook.value.set(lerp(0.12, 0.0, smooth((eT - 7) / 3)), lerp(0.05, 0.0, smooth((eT - 7) / 3)));
  });
  run.overlay.veil('#000', 0, 1.5);
  await run.wait(2.5);
  run.line('HALE', '...Where are we?', 2.6, false);
  await run.wait(4.0);
  run.sfx('stinger', { volume: 0.6 }); run.sfx('whisper', { volume: 0.7 });
  await run.wait(2.5);
  await run.say('HALE', 'There is something in the dark. It is... looking at us.', 4.2, false);
  run.overlay.veil('#000', 1, 1.6);
  await run.wait(2.0);
}

// ============================================================ ENDING — Earth at dawn
async function ending(run) {
  const { ctx, root, camera } = run;
  const [C1, C2] = crew(ctx);
  run.space(40000);
  const tunnel = makeWarpTunnel(); tunnel.mesh.position.z = -320; root.add(tunnel.mesh);
  tunnel.mat.uniforms.uColor.value.set(0xa8d8ff);
  let wT = 0;
  const wf = run.on((dt) => { wT += dt; tunnel.update(wT * Math.max(0.2, 1 - wT * 0.15)); tunnel.mat.uniforms.uSpeed.value = Math.max(0.3, 4 - wT); });
  try { ctx.ui?.fade?.(false, 0.01); } catch (e) { /* ignore */ }
  ctx.ui?.letterbox?.(true);
  try { ctx.audio?.ambience?.('cutscene'); } catch (e) { /* ignore */ }
  run.fov(75);
  run.shot((lt) => { camera.position.set(0, 0, -lt * 2); camera.lookAt(0, 0, -200); });
  run.overlay.veil('#000', 0, 0.8);
  run.sfx('warp', { volume: 0.8 }); run.shake(0.3, 3);
  await run.wait(3.6);
  run.overlay.veil('#ffffff', 1, 0.5);
  await run.wait(0.6);
  wf(); root.remove(tunnel.mesh); tunnel.mesh.geometry.dispose(); tunnel.mat.dispose();
  try { ctx.audio?.ambience?.('silence'); } catch (e) { /* ignore */ }
  // Earth
  const stars = makeStars({ patchDir: PATCH, count: 6000, dark: 0 }); stars.mat.uniforms.uOpacity.value = 0.6; root.add(stars.points);
  const earth = makeEarth(1000); earth.group.position.set(0, -1150, -1400); root.add(earth.group);
  const sunMat = new THREE.SpriteMaterial({ map: sunTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const sun = new THREE.Sprite(sunMat); sun.scale.setScalar(2600); root.add(sun);
  const sunDir = new THREE.Vector3(), look = new THREE.Vector3();
  const setSun = (el) => { const az = 0.2, e = el * Math.PI / 180; sunDir.set(Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e)); sun.position.copy(camera.position).addScaledVector(sunDir, 12000); };
  let sT = 0;
  run.on((dt, t) => { sT += dt; earth.update(t); stars.update(camera, t); setSun(lerp(-12, 1.5, smooth(sT / 30))); });
  run.fov(42);
  run.shot((lt) => { camera.position.set(lt * 0.6, lt * 0.25, -lt * 2.2); look.set(90 + lt * 1.2, -30 + lt * 0.5, -1400); camera.lookAt(look); camera.up.set(Math.sin(0.06 + lt * 0.002), 1, 0).normalize(); });
  run.overlay.veil('#ffffff', 0, 3.5);
  await run.wait(6.0);
  await run.say(C1, 'Is that...?', 2.4, false);
  await run.wait(1.0);
  await run.say(C2, 'Home. That is home.', 2.8, false);
  await run.wait(1.5);
  await run.say('HALE', 'Earth. Confirmed. Hailing Control on the old frequency.', 4.0);
  run.sfx('static', { volume: 0.35 }); run.sfx('beep', { volume: 0.5 });
  await run.wait(2.2);
  await run.say('CONTROL', 'Perihelion... this is Control. Your last transmission was forty-one years ago.', 6.0);
  await run.say(C1, 'Forty-one... Control, we have only been gone a few days.', 4.2);
  await run.say('CONTROL', 'It is Amara. I never closed the channel. Welcome home.', 4.6);
  // the clicking
  let kT = 0, nextClick = 0.5;
  run.on((dt) => { kT += dt; nextClick -= dt; if (nextClick < 0) { run.sfx('click', { volume: 0.4 + Math.min(0.5, kT * 0.05), pitch: 0.8 + Math.random() * 0.5 }); nextClick = Math.max(0.05, 0.6 - kT * 0.08) * (0.5 + Math.random()); } });
  run.sfx('static', { volume: 0.6 }); run.glitch(0.25, 0.5);
  await run.wait(2.0);
  run.line('CONTROL', 'Perihelion, what is that noise on your—', 2.6);
  await run.wait(2.2); run.sfx('static', { volume: 0.9 }); run.glitch(0.5, 0.6);
  await run.wait(1.2);
  await run.say('HALE', '...I am detecting an additional life sign aboard.', 4.2, false);
  run.sfx('stinger', { volume: 0.9 });
  run.overlay.veil('#000', 1, 0.05);
  try { ctx.audio?.ambience?.('silence'); } catch (e) { /* ignore */ }
  await run.wait(1.6);
  try { ctx.ui?.chapterCard?.(CONFIG.title || 'STARLESS', 'TO BE CONTINUED'); } catch (e) { /* ignore */ }
  if (!ctx.ui?.chapterCard) run.overlay.text((CONFIG.title || 'STARLESS') + '\n\nTO BE CONTINUED', 'serif');
  await run.wait(7.6);
}

const TIMELINES = { intro, l1_end: l1End, l2_end: l2End, ending };

export function playCutscene(name, ctx) {
  const tl = TIMELINES[name];
  let run;
  try { run = createRun(ctx, name); } catch (e) {
    console.warn('[cutscene] setup failed', e); ctx.cinematic = false;
    return { promise: Promise.resolve(), skip() {} };
  }
  (async () => {
    try { if (tl) await tl(run); } catch (e) { if (e !== CANCEL) console.warn('[cutscene]', name, e); }
    finally { run.finish(); }
  })();
  return { promise: run.promise, skip() { try { ctx.ui?.subtitle?.('', '', 0); } catch (e) { /* ignore */ } run.finish(); } };
}

// ============================================================ MENU BACKDROP (cheap, runs forever)
export function buildMenuBackdrop(ctx) {
  const scene = ctx.scene, camera = ctx.camera;
  const saved = { bg: scene?.background ?? null, fog: scene?.fog ?? null, near: camera?.near, far: camera?.far };
  const root = new THREE.Group(); root.name = 'menu-backdrop';
  scene?.add(root);
  if (scene) { scene.background = new THREE.Color(0x000000); scene.fog = null; }
  if (camera) { camera.near = 0.5; camera.far = 30000; camera.fov = 60; camera.updateProjectionMatrix(); }
  const stars = makeStars({ patchDir: PATCH, count: 7000, dark: 1.3 }); root.add(stars.points);
  const planet = makeDarkPlanet(2400); planet.group.position.set(0, -2600, 0); root.add(planet.group);
  root.add(new THREE.AmbientLight(0x223040, 0.8));
  const rimL = new THREE.DirectionalLight(0x6fd0ff, 1.2); rimL.position.set(-0.5, 0.4, -1); root.add(rimL);
  const harv = makeHarvester({ radial: 28, veins: 8 }); harv.group.position.copy(PATCH).multiplyScalar(3200); harv.group.lookAt(0, 0, 0); harv.group.rotateY(0.9); root.add(harv.group);
  harv.setUnfold(0.55); harv.setVeins(0.12);
  const flashTex = glowTexture('rgba(255,255,255,1)', 'rgba(170,220,255,0.4)');
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xbfe6ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  flash.scale.setScalar(300); root.add(flash);
  let t = 0, nextPulse = 4, pulse = 0, nextFlash = 9, fl = 0;
  const look = new THREE.Vector3(), tv = new THREE.Vector3();
  return {
    update(dt) {
      try {
        dt = Math.min(dt || 0.016, 0.1); t += dt;
        const a = t * 0.012;
        if (camera) {
          camera.position.set(Math.sin(a) * 60, 40 + Math.sin(t * 0.05) * 4, Math.cos(a) * 60);
          look.set(Math.sin(a * 0.6 + 0.25) * 1000, -60, -1000); camera.lookAt(look);
        }
        stars.update(camera, t); harv.update(dt);
        nextPulse -= dt; if (nextPulse < 0) { pulse = 1; nextPulse = 6 + Math.random() * 7; }
        pulse = Math.max(0, pulse - dt * 0.6); harv.setVeins(0.12 + Math.sin(pulse * Math.PI) * 0.7);
        nextFlash -= dt;
        if (nextFlash < 0) { tv.randomDirection(); tv.y = Math.abs(tv.y) * 0.6 + 0.05; flash.position.copy(camera ? camera.position : tv).addScaledVector(tv.normalize(), 6000); fl = 1; nextFlash = 14 + Math.random() * 18; }
        fl = Math.max(0, fl - dt * 1.8); flash.material.opacity = fl * fl; flash.scale.setScalar(200 + (1 - fl) * 300);
      } catch (e) { /* never break the menu */ }
    },
    dispose() {
      try { scene?.remove(root); disposeTree(root); } catch (e) { /* ignore */ }
      if (scene) { scene.background = saved.bg; scene.fog = saved.fog; }
      if (camera) { camera.fov = 72; if (saved.near) camera.near = saved.near; if (saved.far) camera.far = saved.far; camera.updateProjectionMatrix(); }
    },
  };
}
