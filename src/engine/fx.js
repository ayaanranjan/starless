// STARLESS — screen & world effects (ENGINE)
// Trauma-based camera shake, DOM colour flash, glitch pulses / grading via ctx.post, pooled additive particles.
import * as THREE from 'three';

const MAX_PARTICLES = 2000;

function smoothNoise(t, seed) {
  // cheap smooth pseudo-noise in [-1, 1]
  return (Math.sin(t * 1.0 + seed * 12.9898) * 0.5
    + Math.sin(t * 2.31 + seed * 78.233) * 0.3
    + Math.sin(t * 4.77 + seed * 37.719) * 0.2);
}

export function createFX(ctx) {
  // ---------------------------------------------------------------- flash overlay
  let flashEl = null;
  try {
    flashEl = document.getElementById('fx-flash');
    if (!flashEl) {
      flashEl = document.createElement('div');
      flashEl.id = 'fx-flash';
      Object.assign(flashEl.style, {
        position: 'fixed', left: '0', top: '0', right: '0', bottom: '0',
        pointerEvents: 'none', opacity: '0', background: '#ffffff', willChange: 'opacity',
      });
      const ui = document.getElementById('ui');
      if (ui && ui.parentNode) ui.parentNode.insertBefore(flashEl, ui); // above #game canvas, below #ui
      else document.body.appendChild(flashEl);
    }
  } catch (e) { flashEl = null; }

  let flashA = 0, flashStart = 0, flashDur = 0.3, flashT = 0, lastFlashOpacity = -1;

  // ---------------------------------------------------------------- shake
  let trauma = 0, decay = 1.5, rumbleFloor = 0, time = 0, tick = 0;
  const applied = { cam: null, tick: -1, ox: 0, oy: 0, oz: 0, rx: 0, ry: 0, rz: 0,
    px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0 };

  // ---------------------------------------------------------------- glitch / grade
  let baseGlitch = 0, pulseAmt = 0, pulseDur = 0, pulseT = 0, lastGlitch = -1;
  const grade = { saturation: 1, exposure: 1, tint: [1, 1, 1] };
  let gradeFrom = null, gradeTo = null, gradeT = 0, gradeDur = 0;

  const post = () => ctx && ctx.post;

  // ---------------------------------------------------------------- particles
  const pos = new Float32Array(MAX_PARTICLES * 3);
  const col = new Float32Array(MAX_PARTICLES * 3);
  const size = new Float32Array(MAX_PARTICLES);
  const alpha = new Float32Array(MAX_PARTICLES);
  const vel = new Float32Array(MAX_PARTICLES * 3);
  const life = new Float32Array(MAX_PARTICLES);
  const maxLife = new Float32Array(MAX_PARTICLES);
  const grav = new Float32Array(MAX_PARTICLES);
  const drag = new Float32Array(MAX_PARTICLES);
  let head = 0, alive = 0, dirty = false;

  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  const aSize = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  const aAlpha = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos);
  geo.setAttribute('aColor', aCol);
  geo.setAttribute('aSize', aSize);
  geo.setAttribute('aAlpha', aAlpha);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: /* glsl */`
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aAlpha;
      uniform float uScale;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aAlpha <= 0.0 ? 0.0 : clamp(aSize * uScale / max(-mv.z, 0.05), 1.0, 96.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c) * 4.0;
        if (d > 1.0) discard;
        float a = exp(-d * 3.2) * (1.0 - d);
        gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  points.name = 'fx-particles';

  const tmpColor = new THREE.Color();

  function ensureInScene() {
    const scene = ctx && ctx.scene;
    if (scene && points.parent !== scene) scene.add(points);
  }

  function setPostGlitch(g) {
    if (Math.abs(g - lastGlitch) < 0.002) return;
    lastGlitch = g;
    post()?.set?.({ glitch: g });
  }

  const fx = {
    points,

    shake(intensity = 0.3, dur = 0.4) {
      const i = Math.min(1, Math.max(0, +intensity || 0));
      if (i <= 0) return;
      const d = Math.max(0.05, +dur || 0.4);
      if (i >= trauma) { trauma = i; decay = i / d; }
      else { trauma = Math.min(1, trauma + i * 0.35); }
    },

    // persistent low rumble (0..1), e.g. engines / launch. 0 to stop.
    rumble(v = 0) { rumbleFloor = Math.min(1, Math.max(0, +v || 0)); },

    flash(hex = 0xffffff, intensity = 0.6, dur = 0.35) {
      if (!flashEl) return;
      try {
        tmpColor.set(hex);
        flashEl.style.background = '#' + tmpColor.getHexString();
      } catch (e) { flashEl.style.background = '#ffffff'; }
      flashA = Math.min(1, Math.max(0, +intensity || 0));
      flashStart = flashA;
      flashDur = Math.max(0.03, +dur || 0.35);
      flashT = 0;
      flashEl.style.opacity = String(flashA);
      lastFlashOpacity = flashA;
    },

    pulseGlitch(amount = 0.6, dur = 0.4) {
      const a = Math.min(1, Math.max(0, +amount || 0));
      if (a <= 0) return;
      const remaining = pulseDur > 0 ? pulseAmt * Math.max(0, 1 - pulseT / pulseDur) : 0;
      if (a >= remaining) { pulseAmt = a; pulseDur = Math.max(0.05, +dur || 0.4); pulseT = 0; }
    },

    setGlitch(v = 0) { baseGlitch = Math.min(1, Math.max(0, +v || 0)); },

    // setGrade({saturation, exposure, tint}, blendSeconds = 0)
    setGrade(params = {}, dur = 0) {
      const to = {
        saturation: typeof params.saturation === 'number' ? params.saturation : grade.saturation,
        exposure: typeof params.exposure === 'number' ? params.exposure : grade.exposure,
        tint: Array.isArray(params.tint) ? params.tint.slice(0, 3) : grade.tint.slice(),
      };
      if (dur > 0) {
        gradeFrom = { saturation: grade.saturation, exposure: grade.exposure, tint: grade.tint.slice() };
        gradeTo = to; gradeT = 0; gradeDur = dur;
      } else {
        gradeFrom = gradeTo = null;
        grade.saturation = to.saturation; grade.exposure = to.exposure; grade.tint = to.tint;
        post()?.set?.({ saturation: grade.saturation, exposure: grade.exposure, tint: grade.tint });
      }
    },

    burst(p, opts = {}) {
      if (!p) return;
      ensureInScene();
      const count = Math.min(400, Math.max(1, (opts.count ?? 24) | 0));
      const speed = opts.speed ?? 3;
      const lifeS = Math.max(0.05, opts.life ?? 0.8);
      const sz = opts.size ?? 0.08;
      const g = opts.gravity ?? -1.5;
      const dr = opts.drag ?? 1.6;
      const spread = opts.spread ?? 0.05;
      const dir = opts.dir || null;     // optional bias direction (Vector3-like)
      const cone = opts.cone ?? 1;      // 1 = full sphere, small = tight cone around dir
      try { tmpColor.set(opts.color ?? 0xffffff); } catch (e) { tmpColor.set(0xffffff); }
      const cr = tmpColor.r, cg = tmpColor.g, cb = tmpColor.b;
      for (let n = 0; n < count; n++) {
        const i = head;
        head = (head + 1) % MAX_PARTICLES;
        if (life[i] <= 0) alive++;
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        let vx = s * Math.cos(th), vy = u, vz = s * Math.sin(th);
        if (dir) {
          const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
          vx = dir.x / dl + vx * cone; vy = dir.y / dl + vy * cone; vz = dir.z / dl + vz * cone;
          const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
        }
        const sp = speed * (0.35 + 0.65 * Math.random());
        const i3 = i * 3;
        pos[i3] = p.x + (Math.random() - 0.5) * spread;
        pos[i3 + 1] = p.y + (Math.random() - 0.5) * spread;
        pos[i3 + 2] = p.z + (Math.random() - 0.5) * spread;
        vel[i3] = vx * sp; vel[i3 + 1] = vy * sp; vel[i3 + 2] = vz * sp;
        const k = 0.75 + Math.random() * 0.25;
        col[i3] = cr * k; col[i3 + 1] = cg * k; col[i3 + 2] = cb * k;
        size[i] = sz * (0.6 + Math.random() * 0.8);
        life[i] = maxLife[i] = lifeS * (0.55 + Math.random() * 0.45);
        alpha[i] = 1;
        grav[i] = g;
        drag[i] = dr;
      }
      if (alive > MAX_PARTICLES) alive = MAX_PARTICLES;
      dirty = true;
    },

    update(dt) {
      if (!(dt > 0)) return;
      if (dt > 0.1) dt = 0.1;
      time += dt;
      tick++;

      // trauma
      trauma = Math.max(0, trauma - decay * dt);
      if (trauma <= 0) decay = 1.5;

      // flash fade (ease-out)
      if (flashEl && flashA > 0) {
        flashT += dt;
        const k = Math.min(1, flashT / flashDur);
        flashA = flashStart * (1 - k) * (1 - k);
        if (k >= 1) flashA = 0;
        const o = Math.round(flashA * 1000) / 1000;
        if (o !== lastFlashOpacity) { flashEl.style.opacity = String(o); lastFlashOpacity = o; }
      }

      // glitch
      let g = baseGlitch;
      if (pulseDur > 0) {
        pulseT += dt;
        const k = 1 - pulseT / pulseDur;
        if (k <= 0) { pulseDur = 0; pulseAmt = 0; }
        else g = Math.max(g, pulseAmt * (0.35 + 0.65 * k) * (0.75 + 0.25 * Math.random()));
      }
      setPostGlitch(g);

      // grade blend
      if (gradeTo && gradeDur > 0) {
        gradeT += dt;
        const k = Math.min(1, gradeT / gradeDur);
        const e = k * k * (3 - 2 * k);
        grade.saturation = gradeFrom.saturation + (gradeTo.saturation - gradeFrom.saturation) * e;
        grade.exposure = gradeFrom.exposure + (gradeTo.exposure - gradeFrom.exposure) * e;
        for (let j = 0; j < 3; j++) grade.tint[j] = gradeFrom.tint[j] + ((gradeTo.tint[j] ?? 1) - gradeFrom.tint[j]) * e;
        post()?.set?.({ saturation: grade.saturation, exposure: grade.exposure, tint: grade.tint });
        if (k >= 1) { gradeFrom = gradeTo = null; }
      }

      // particles
      if (alive > 0 || dirty) {
        ensureInScene();
        let count = 0;
        for (let i = 0; i < MAX_PARTICLES; i++) {
          if (life[i] <= 0) continue;
          life[i] -= dt;
          if (life[i] <= 0) { life[i] = 0; alpha[i] = 0; continue; }
          count++;
          const i3 = i * 3;
          const dk = Math.max(0, 1 - drag[i] * dt);
          vel[i3] *= dk; vel[i3 + 1] = vel[i3 + 1] * dk + grav[i] * dt; vel[i3 + 2] *= dk;
          pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
          const f = life[i] / maxLife[i];
          alpha[i] = Math.min(1, (1 - f) * 12) * Math.pow(f, 1.3);
        }
        alive = count;
        aPos.needsUpdate = true; aCol.needsUpdate = true; aSize.needsUpdate = true; aAlpha.needsUpdate = true;
        dirty = false;
        const el = ctx?.renderer?.domElement;
        if (el && el.height) mat.uniforms.uScale.value = el.height * 0.5;
      }
    },

    // Adds shake offsets after the camera was positioned this frame. Safe to call more than once per
    // frame and on static cameras: it undoes its own previous offset if nobody touched the camera since.
    applyCamera(camera) {
      if (!camera) return;
      const untouched = applied.cam === camera
        && camera.position.x === applied.px && camera.position.y === applied.py && camera.position.z === applied.pz
        && camera.rotation.x === applied.qx && camera.rotation.y === applied.qy && camera.rotation.z === applied.qz;
      if (untouched) {
        camera.position.x -= applied.ox; camera.position.y -= applied.oy; camera.position.z -= applied.oz;
        camera.rotation.x -= applied.rx; camera.rotation.y -= applied.ry; camera.rotation.z -= applied.rz;
      }
      const t = Math.max(trauma, rumbleFloor * 0.45);
      const s = t * t;
      let ox = 0, oy = 0, oz = 0, rx = 0, ry = 0, rz = 0;
      if (s > 1e-5) {
        const tt = time * 24;
        ox = 0.07 * s * smoothNoise(tt, 1);
        oy = 0.07 * s * smoothNoise(tt, 2);
        oz = 0.03 * s * smoothNoise(tt, 3);
        rx = 0.045 * s * smoothNoise(tt, 4);
        ry = 0.045 * s * smoothNoise(tt, 5);
        rz = 0.06 * s * smoothNoise(tt, 6);
      }
      camera.position.x += ox; camera.position.y += oy; camera.position.z += oz;
      camera.rotation.x += rx; camera.rotation.y += ry; camera.rotation.z += rz;
      applied.cam = camera; applied.tick = tick;
      applied.ox = ox; applied.oy = oy; applied.oz = oz; applied.rx = rx; applied.ry = ry; applied.rz = rz;
      applied.px = camera.position.x; applied.py = camera.position.y; applied.pz = camera.position.z;
      applied.qx = camera.rotation.x; applied.qy = camera.rotation.y; applied.qz = camera.rotation.z;
    },

    get trauma() { return trauma; },

    reset() {
      trauma = 0; rumbleFloor = 0; baseGlitch = 0; pulseAmt = 0; pulseDur = 0;
      flashA = 0; if (flashEl) flashEl.style.opacity = '0'; lastFlashOpacity = 0;
      for (let i = 0; i < MAX_PARTICLES; i++) { life[i] = 0; alpha[i] = 0; }
      alive = 0; dirty = true;
      setPostGlitch(0);
    },

    dispose() {
      try { points.removeFromParent(); geo.dispose(); mat.dispose(); } catch (e) { /* ignore */ }
      try { flashEl?.remove(); } catch (e) { /* ignore */ }
    },
  };

  return fx;
}

export default createFX;
