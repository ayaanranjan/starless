// STARLESS — renderer + post-processing (ENGINE)
// RenderPass -> UnrealBloomPass (high only) -> HorrorPass -> OutputPass (tone mapping + sRGB)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const DEFAULTS = {
  vignette: 0.45, grain: 0.35, chroma: 0.15, glitch: 0, damage: 0,
  saturation: 1, exposure: 1, tint: [1, 1, 1], bloomStrength: 0.8,
};

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
    varying vec2 vUv;

    float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

    void main() {
      vec2 uv = vUv;
      float t = uTime;
      float g = clamp(uGlitch, 0.0, 1.0);

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
      vec2 dc = vUv - 0.5;
      float d = length(dc);
      vec2 caOff = dc * (uChroma * 0.03 * d);
      caOff.x += g * 0.014 * (hash11(floor(t * 30.0)) - 0.25);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + caOff).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - caOff).b;

      // ---- grading (linear HDR)
      col *= uExposure;
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = max(mix(vec3(lum), col, uSaturation), 0.0);
      col *= uTint;

      // ---- screen effects in perceptual space
      vec3 p = pow(col, vec3(1.0 / 2.2));

      // damage: desaturate a touch, then pulsing red edges
      float pl = dot(p, vec3(0.299, 0.587, 0.114));
      p = mix(p, vec3(pl), clamp(uDamage, 0.0, 1.0) * 0.35);

      // vignette
      float vig = 1.0 - uVignette * smoothstep(0.25, 0.95, d * 1.3);
      p *= vig;

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
      p *= 1.0 - 0.018 * (0.5 + 0.5 * sin(gl_FragCoord.y * 1.6 + t * 3.0));

      // animated film grain (stronger in shadows / mids)
      float n = hash12(gl_FragCoord.xy + fract(t * 7.13) * 1000.0) - 0.5;
      float pl2 = dot(p, vec3(0.299, 0.587, 0.114));
      p += n * uGrain * 0.17 * (1.0 - 0.6 * smoothstep(0.2, 1.0, pl2));

      col = pow(max(p, 0.0), vec3(2.2));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

function pixelRatioFor(q) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return Math.min(dpr, q === 'high' ? 1.75 : 1);
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

  let composer = null, renderPass = null, bloom = null, horror = null, output = null;
  try {
    composer = new EffectComposer(renderer);
    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    if (q === 'high') {
      bloom = new UnrealBloomPass(new THREE.Vector2(W, H), state.bloomStrength, 0.55, 0.72);
      composer.addPass(bloom);
    }
    horror = new ShaderPass(HorrorShader);
    composer.addPass(horror);
    output = new OutputPass();
    composer.addPass(output);
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
          bloom = new UnrealBloomPass(new THREE.Vector2(W, H), state.bloomStrength, 0.55, 0.72);
          composer.insertPass(bloom, 1);
        } catch (e) { bloom = null; }
      } else if (q === 'low' && bloom) {
        composer.removePass(bloom);
        try { bloom.dispose(); } catch (e) { /* ignore */ }
        bloom = null;
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
