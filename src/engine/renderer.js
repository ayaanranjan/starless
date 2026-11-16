// STARLESS — renderer + post-processing (ENGINE)
// RenderPass -> UnrealBloomPass (high only) -> HorrorPass -> OutputPass (tone mapping + sRGB) -> SMAA (high only)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const DEFAULTS = {
  vignette: 0.45, grain: 0.35, chroma: 0.15, glitch: 0, damage: 0,
  saturation: 1, exposure: 1, tint: [1, 1, 1], bloomStrength: 0.8,
  contrast: 1.07, split: 0.85, halation: 0.6, distort: 0.045,
};
// bloom: only true HDR emissives (> ~1.0 linear) glow; fog / sky / lit terrain stay crisp
const BLOOM_RADIUS = 0.62, BLOOM_THRESHOLD = 0.92;

const HorrorShader = {
  name: 'HorrorPass',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uVignette: { value: DEFAULTS.vignette },
    uGrain: { value: DEFAULTS.grain },
    uChroma: { value: DEFAULTS.chroma },
    uGlitch: { value: 0 },
    uDamage: { value: 0 },
    uSaturation: { value: 1 },
    uExposure: { value: 1 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uContrast: { value: DEFAULTS.contrast },
    uSplit: { value: DEFAULTS.split },
    uHalation: { value: DEFAULTS.halation },
    uDistort: { value: DEFAULTS.distort },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uChroma;
    uniform float uGlitch;
    uniform float uDamage;
    uniform float uSaturation;
    uniform float uExposure;
    uniform vec3 uTint;
    uniform float uContrast;
    uniform float uSplit;
    uniform float uHalation;
    uniform float uDistort;
    varying vec2 vUv;

    float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

    void main() {
      float t = uTime;
      float g = clamp(uGlitch, 0.0, 1.0);
      float aspect = uResolution.x / max(uResolution.y, 1.0);

      // ---- very gentle barrel distortion (corners stay anchored, centre slightly magnified)
      vec2 dc0 = vUv - 0.5;
      vec2 dcA = dc0 * vec2(aspect, 1.0);
      float rMax = 0.25 * (aspect * aspect + 1.0);
      vec2 uv = 0.5 + dc0 * (1.0 + uDistort * dot(dcA, dcA)) / (1.0 + uDistort * rMax);

      // ---- glitch: horizontal slice displacement + block tears
      if (g > 0.001) {
        float tk = floor(t * 16.0);
        float rows = 18.0 + floor(hash11(tk + 1.3) * 46.0);
        float row = floor(uv.y * rows);
        float on = step(1.0 - 0.55 * g, hash12(vec2(row, tk)));
        float shift = (hash12(vec2(row * 1.7 + 3.0, tk)) - 0.5) * 0.14 * g * on;
        float blk = step(0.93 - 0.1 * g, hash12(vec2(floor(uv.y * 7.0), floor(t * 6.0))));
        shift += blk * (hash11(tk + 5.0) - 0.5) * 0.22 * g;
        uv.x = fract(uv.x + shift);
      }

      // ---- radial chromatic aberration (+ glitch RGB split)
      vec2 dc = uv - 0.5;
      float d = length(dc0);
      vec2 caOff = dc * (uChroma * 0.03 * d);
      caOff.x += g * 0.014 * (hash11(floor(t * 30.0)) - 0.25);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + caOff).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - caOff).b;

      // ---- halation: jittered ring taps of HDR highlights -> warm red film glow around lights
      if (uHalation > 0.001) {
        float j = hash12(gl_FragCoord.xy + fract(t) * 91.0) * 6.2832;
        vec3 h = vec3(0.0);
        float cL = max(max(col.r, col.g), col.b);
        float thr = max(cL, 0.85);
        for (int i = 0; i < 6; i++) {
          float a = j + float(i) * 1.0472;
          float rr = 0.006 + 0.014 * fract(j * 0.37 + float(i) * 0.618);
          vec3 sm = texture2D(tDiffuse, uv + vec2(cos(a) / aspect, sin(a)) * rr).rgb;
          h += max(sm - thr, 0.0);
        }
        col += min(h, vec3(24.0)) * (uHalation / 6.0) * vec3(0.55, 0.16, 0.06);
      }

      // ---- grading (linear HDR)
      col *= uExposure;
      // filmic contrast (log space, pivot ~0.12): full strength below the pivot so shadows sink,
      // only a quarter above it so bright skies / lit areas don't wash out before ACES
      vec3 dlc = log2(max(col, vec3(1e-6))) + 3.06;
      vec3 kc = mix(vec3(uContrast), vec3(1.0 + (uContrast - 1.0) * 0.25), step(0.0, dlc));
      col = exp2(dlc * kc - 3.06);
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = max(mix(vec3(lum), col, uSaturation), 0.0);
      col *= uTint;
      // split-tone: cool teal shadows, warm amber highlights; whisper of blue in the blacks
      float sl = smoothstep(0.004, 0.45, dot(col, vec3(0.2126, 0.7152, 0.0722)));
      col *= mix(vec3(1.0), mix(vec3(0.88, 0.98, 1.16), vec3(1.07, 1.0, 0.88), sl), uSplit);
      col += vec3(0.0003, 0.0006, 0.0012) * uSplit;

      // ---- screen effects in perceptual space
      vec3 p = pow(col, vec3(1.0 / 2.2));

      // damage: desaturate a touch, then pulsing red edges
      float pl = dot(p, vec3(0.299, 0.587, 0.114));
      p = mix(p, vec3(pl), clamp(uDamage, 0.0, 1.0) * 0.35);

      // vignette (aspect-aware oval, slightly cool as it darkens)
      float vr = length(dc0 * vec2(mix(1.0, aspect, 0.6), 1.0));
      float vig = 1.0 - uVignette * smoothstep(0.22, 0.98, vr * 1.22);
      p *= vig * mix(vec3(1.0), vec3(0.94, 0.97, 1.0), (1.0 - vig));

      float pulse = 0.72 + 0.28 * sin(t * 7.5);
      float edge = smoothstep(0.26, 0.86, d * 1.25);
      p = mix(p, vec3(0.42, 0.0, 0.015), clamp(edge * uDamage * pulse * 1.15, 0.0, 0.92));

      // glitch noise bands, white lines, flicker
      if (g > 0.001) {
        float by = fract(hash11(floor(t * 5.0)) + t * 0.37);
        float band = smoothstep(0.035, 0.0, abs(vUv.y - by)) * g;
        float sn = hash12(floor(gl_FragCoord.xy * 0.5) + floor(t * 60.0) * 17.0);
        p = mix(p, vec3(sn) * vec3(0.8, 0.95, 1.0), band * 0.75);
        float line = step(0.992 - 0.03 * g, hash12(vec2(floor(gl_FragCoord.y * 0.33), floor(t * 24.0))));
        p += line * g * 0.25 * vec3(sn);
        p *= 1.0 - g * 0.2 * hash11(floor(t * 22.0));
      }

      // very subtle scanlines
      p *= 1.0 - 0.012 * (0.5 + 0.5 * sin(gl_FragCoord.y * 1.6 + t * 3.0));

      // fine animated film grain: triangular-distributed per pixel, re-rolled per frame, peaks in the mids
      vec2 gs = gl_FragCoord.xy + floor(fract(t * 0.371) * 4096.0) * vec2(0.618, 1.414);
      float n = hash12(gs) + hash12(gs + 17.31) - 1.0;
      float pl2 = dot(p, vec3(0.299, 0.587, 0.114));
      float gw = (0.45 + 0.55 * smoothstep(0.0, 0.18, pl2)) * (1.0 - 0.65 * smoothstep(0.35, 1.0, pl2));
      p += n * uGrain * 0.13 * gw * vec3(1.0, 0.97, 1.04);

      col = pow(max(p, 0.0), vec3(2.2));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

function pixelRatioFor(q) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return Math.min(dpr, q === 'high' ? 1.5 : 1);
}

export function createRenderer(container, quality = 'high') {
  let q = quality === 'low' ? 'low' : 'high';
  const host = container || document.body;

  const renderer = new THREE.WebGLRenderer({
    antialias: q === 'high', powerPreference: 'high-performance', alpha: false, stencil: false,
  });
  renderer.setPixelRatio(pixelRatioFor(q));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 1);
  host.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); }, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const size = () => {
    const w = host.clientWidth || window.innerWidth || 1280;
    const h = host.clientHeight || window.innerHeight || 720;
    return [Math.max(1, w), Math.max(1, h)];
  };
  let [W, H] = size();
  renderer.setSize(W, H, false);

  const camera = new THREE.PerspectiveCamera(72, W / H, 0.05, 900);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  // Re-add the camera if it got orphaned (e.g. main.js cleared scene children between levels),
  // so camera children (flashlight) keep rendering. Leaves it alone if a cutscene parented it elsewhere.
  function ensureCamera() {
    if (!camera.parent) scene.add(camera);
  }

  const state = { ...DEFAULTS, tint: DEFAULTS.tint.slice() };

  let composer = null, renderPass = null, bloom = null, horror = null, output = null, smaa = null;
  const makeSMAA = () => {
    try { const pr = renderer.getPixelRatio(); return new SMAAPass(W * pr, H * pr); } catch (e) { return null; }
  };
  try {
    composer = new EffectComposer(renderer);
    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    if (q === 'high') {
      bloom = new UnrealBloomPass(new THREE.Vector2(W, H), state.bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
      composer.addPass(bloom);
    }
    horror = new ShaderPass(HorrorShader);
    composer.addPass(horror);
    output = new OutputPass();
    composer.addPass(output);
    if (q === 'high') { smaa = makeSMAA(); if (smaa) composer.addPass(smaa); }
  } catch (e) {
    console.warn('[renderer] post-processing unavailable, falling back to direct render', e);
    composer = null;
  }

  function applyPost() {
    if (horror) {
      const u = horror.uniforms;
      u.uVignette.value = state.vignette;
      u.uGrain.value = state.grain;
      u.uChroma.value = state.chroma;
      u.uGlitch.value = state.glitch;
      u.uDamage.value = state.damage;
      u.uSaturation.value = state.saturation;
      u.uExposure.value = state.exposure;
      u.uTint.value.set(state.tint[0], state.tint[1], state.tint[2]);
      u.uContrast.value = state.contrast;
      u.uSplit.value = state.split;
      u.uHalation.value = q === 'high' ? state.halation : state.halation * 0.5;
      u.uDistort.value = state.distort;
    } else {
      renderer.toneMappingExposure = state.exposure;
    }
    if (bloom) bloom.strength = state.bloomStrength;
  }

  const num = (v, lo, hi, fb) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);

  const post = {
    set(params) {
      if (!params) return post.get();
      if ('vignette' in params) state.vignette = num(params.vignette, 0, 1.5, state.vignette);
      if ('grain' in params) state.grain = num(params.grain, 0, 2, state.grain);
      if ('chroma' in params) state.chroma = num(params.chroma, 0, 3, state.chroma);
      if ('glitch' in params) state.glitch = num(params.glitch, 0, 1, state.glitch);
      if ('damage' in params) state.damage = num(params.damage, 0, 1, state.damage);
      if ('saturation' in params) state.saturation = num(params.saturation, 0, 3, state.saturation);
      if ('exposure' in params) state.exposure = num(params.exposure, 0, 8, state.exposure);
      if ('bloomStrength' in params) state.bloomStrength = num(params.bloomStrength, 0, 5, state.bloomStrength);
      if ('contrast' in params) state.contrast = num(params.contrast, 0.5, 2, state.contrast);
      if ('split' in params) state.split = num(params.split, 0, 2, state.split);
      if ('halation' in params) state.halation = num(params.halation, 0, 4, state.halation);
      if ('distort' in params) state.distort = num(params.distort, 0, 0.5, state.distort);
      if ('tint' in params && params.tint) {
        const t = params.tint;
        if (Array.isArray(t)) {
          state.tint[0] = num(t[0], 0, 4, 1); state.tint[1] = num(t[1], 0, 4, 1); state.tint[2] = num(t[2], 0, 4, 1);
        } else if (typeof t === 'object' && 'r' in t) {
          state.tint[0] = num(t.r, 0, 4, 1); state.tint[1] = num(t.g, 0, 4, 1); state.tint[2] = num(t.b, 0, 4, 1);
        }
      }
      applyPost();
      return post.get();
    },
    get() { return { ...state, tint: state.tint.slice() }; },
    reset() { Object.assign(state, DEFAULTS, { tint: DEFAULTS.tint.slice() }); applyPost(); return post.get(); },
  };

  function resize() {
    [W, H] = size();
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(W, H);
    }
    if (horror) {
      const pr = renderer.getPixelRatio();
      horror.uniforms.uResolution.value.set(W * pr, H * pr);
    }
  }

  function setQuality(nq) {
    q = nq === 'low' ? 'low' : 'high';
    renderer.setPixelRatio(pixelRatioFor(q));
    if (composer) {
      if (q === 'high' && !bloom) {
        try {
          bloom = new UnrealBloomPass(new THREE.Vector2(W, H), state.bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
          composer.insertPass(bloom, 1);
        } catch (e) { bloom = null; }
      } else if (q === 'low' && bloom) {
        composer.removePass(bloom);
        try { bloom.dispose(); } catch (e) { /* ignore */ }
        bloom = null;
      }
      if (q === 'high' && !smaa) {
        smaa = makeSMAA();
        if (smaa) composer.addPass(smaa);
      } else if (q === 'low' && smaa) {
        composer.removePass(smaa);
        try { smaa.dispose(); } catch (e) { /* ignore */ }
        smaa = null;
      }
    }
    resize();
    applyPost();
  }

  let time = 0;
  function render(dt = 1 / 60) {
    ensureCamera();
    if (!(dt >= 0) || dt > 1) dt = 1 / 60;
    time = (time + dt) % 3600;
    if (composer) {
      horror.uniforms.uTime.value = time;
      composer.render(dt);
    } else {
      renderer.render(scene, camera);
    }
  }

  window.addEventListener('resize', resize);
  resize();
  applyPost();

  return {
    renderer, scene, camera,
    get composer() { return composer; },
    get bloom() { return bloom; },
    get horrorPass() { return horror; },
    get quality() { return q; },
    render, resize, setQuality, ensureCamera, post,
  };
}
