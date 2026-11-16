// STARLESS — src/audio/audio.js (AUDIO). Pure Web Audio synthesis: no assets, no imports.
// Every public method is a safe no-op before init() and never throws.
// Graph: sources -> [lowpass] -> [HRTF panner | stereo pan] -> sfx bus -> muffle lowpass -> muffle gain -> compressor -> master -> out
//        ambience beds -> duck gain -> muffle      shared convolver reverb (generated 3 s dark IR) -> muffle
//        tension layer / radio speak / UI + "inner" sounds -> compressor (not muffled: in your head / in your helmet)

let ac = null;
const S = {};
const NB = {};
const curves = new Map();
const warned = new Set();
const voices = [];
const MAX_VOICES = 24;
const lis = { x: 0, y: 0, z: 0 };
const st = { vol: 0.8, muffle: 0, tension: 0, tS: 0, amb: null, ambName: null, pending: null, nextBeat: 0, ticker: 0, lastCg: -1, lastTg: -1 };

function warn(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  try { console.warn('[audio] ' + (msg || key)); } catch (e) { /* ignore */ }
}
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const ok = () => !!(ac && S.master);

// ---------------------------------------------------------------- node helpers
function grp(dest, vol) {
  const g = { nodes: [], srcs: [], tids: new Set(), dead: false, disposed: false, out: ac.createGain(), pan: null, send: null, rev: 0, tail: null, dest: null, fades: null, pri: 0 };
  g.out.gain.value = vol == null ? 1 : vol;
  g.nodes.push(g.out);
  if (dest) { g.out.connect(dest); g.tail = g.out; g.dest = dest; }
  return g;
}
function osc(g, type, f, t, det) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = f;
  if (det) o.detune.value = det;
  o.start(t);
  g.nodes.push(o); g.srcs.push(o);
  return o;
}
function nz(g, color, t, rate) {
  const s = ac.createBufferSource();
  s.buffer = NB[color] || NB.white;
  s.loop = true;
  s.playbackRate.value = rate || 1;
  s.start(t, Math.random() * (s.buffer.duration - 0.2));
  g.nodes.push(s); g.srcs.push(s);
  return s;
}
function gn(g, v) { const n = ac.createGain(); n.gain.value = v; g.nodes.push(n); return n; }
function flt(g, type, f, q) {
  const n = ac.createBiquadFilter();
  n.type = type;
  n.frequency.value = f;
  if (q != null) n.Q.value = q;
  g.nodes.push(n);
  return n;
}
function curve(k) {
  const key = Math.round(k * 10);
  if (curves.has(key)) return curves.get(key);
  const n = 1024, c = new Float32Array(n), th = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i * 2) / (n - 1) - 1; c[i] = Math.tanh(k * x) / th; }
  curves.set(key, c);
  return c;
}
function shaper(g, k) { const n = ac.createWaveShaper(); n.curve = curve(k); n.oversample = '2x'; g.nodes.push(n); return n; }
function chain(...ns) { for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; }
function lfo(g, rate, depth, param, t, type) {
  const o = osc(g, type || 'sine', rate, t);
  const d = gn(g, depth);
  o.connect(d); d.connect(param);
  return o;
}
// attack to peak, exponential decay
function env(p, t, a, v, d) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(Math.max(v, 0.0002), t + a);
  p.exponentialRampToValueAtTime(0.0001, t + a + Math.max(0.005, d));
}
function tone(g, t, type, f, a, d, v, f2, dest) {
  const o = osc(g, type, f, t);
  if (f2) { o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + a + d); }
  const e = gn(g, 0);
  env(e.gain, t, a, v, d);
  o.connect(e); e.connect(dest || g.out);
  return o;
}
function thump(g, t, f0, f1, d, v, dest) { return tone(g, t, 'sine', f0, 0.004, d, v, f1, dest); }
function burst(g, t, color, type, f, q, a, d, v, rate, dest) {
  const n = nz(g, color, t, rate || 1);
  const fl = flt(g, type, f, q);
  const e = gn(g, 0);
  env(e.gain, t, a, v, d);
  chain(n, fl, e, dest || g.out);
  return fl;
}
function setPos(pn, p) {
  const x = num(p.x, 0), y = num(p.y, 0), z = num(p.z, 0);
  if (pn.positionX) { pn.positionX.value = x; pn.positionY.value = y; pn.positionZ.value = z; } else pn.setPosition(x, y, z);
}
function distRev(p) {
  if (!p) return 1;
  const dx = num(p.x, 0) - lis.x, dy = num(p.y, 0) - lis.y, dz = num(p.z, 0) - lis.z;
  return 1 / (1 + Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.12);
}
function mkPanner(g, p) {
  const pn = ac.createPanner();
  pn.panningModel = 'HRTF';
  pn.distanceModel = 'inverse';
  pn.refDistance = 2;
  pn.rolloffFactor = 1.3;
  pn.maxDistance = 80;
  setPos(pn, p);
  g.nodes.push(pn);
  g.pan = pn;
  return pn;
}
// out -> [lowpass] -> [panner | stereo pan] -> dest ; out -> reverb send
function route(g, o, rev, dest) {
  let node = g.out;
  if (o._lp) { const lp = flt(g, 'lowpass', o._lp, 0.7); node.connect(lp); node = lp; }
  const p = o.position;
  if (p && typeof p.x === 'number') { const pn = mkPanner(g, p); node.connect(pn); node = pn; }
  else if (typeof o._pan === 'number' && ac.createStereoPanner) {
    const sp = ac.createStereoPanner(); sp.pan.value = clamp(o._pan, -1, 1); g.nodes.push(sp); node.connect(sp); node = sp;
  }
  node.connect(dest);
  g.tail = node; g.dest = dest;
  if (rev > 0) {
    const s = ac.createGain();
    s.gain.value = rev * distRev(p && typeof p.x === 'number' ? p : null);
    g.nodes.push(s);
    g.out.connect(s); s.connect(S.revIn);
    g.send = s; g.rev = rev;
  }
}

// ---------------------------------------------------------------- lifetime
function sched(g, first, fn) {
  let id = 0;
  const tick = () => {
    g.tids.delete(id);
    if (g.dead || !ac) return;
    let d = 1;
    try { d = ac.state === 'running' ? fn() : 0.5; } catch (e) { warn('sched', 'scheduler error: ' + (e && e.message)); d = 2; }
    id = setTimeout(tick, Math.max(0.03, num(d, 1)) * 1000);
    g.tids.add(id);
  };
  id = setTimeout(tick, Math.max(0, first) * 1000);
  g.tids.add(id);
}
function dispose(g) {
  if (!g || g.disposed) return;
  g.disposed = true; g.dead = true;
  for (const id of g.tids) clearTimeout(id);
  g.tids.clear();
  if (g.tid) clearTimeout(g.tid);
  for (const s of g.srcs) { try { s.stop(); } catch (e) { /* already stopped */ } }
  for (const n of g.nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
  g.nodes.length = 0; g.srcs.length = 0;
  const i = voices.indexOf(g);
  if (i >= 0) voices.splice(i, 1);
}
// freeze a param at its current value (no snap-back when cancelling an in-flight ramp)
function hold(p, t) {
  if (p.cancelAndHoldAtTime) { try { p.cancelAndHoldAtTime(t); return; } catch (e) { /* fall back */ } }
  const v = p.value;
  p.cancelScheduledValues(t);
  p.setValueAtTime(v, t);
}
function kill(g, fade) {
  if (!g || g.dead) return;
  g.dead = true;
  for (const id of g.tids) clearTimeout(id);
  g.tids.clear();
  const f = Math.max(0.01, num(fade, 0.05));
  const t = ac.currentTime;
  for (const node of g.fades || [g.out]) {
    try {
      const p = node.gain;
      hold(p, t);
      p.linearRampToValueAtTime(0, t + f);
    } catch (e) { /* ignore */ }
  }
  if (g.tid) clearTimeout(g.tid);
  g.tid = setTimeout(() => dispose(g), (f + 0.15) * 1000);
}
function finish(g, t0, dur) {
  const end = t0 + Math.max(0.05, dur);
  for (const s of g.srcs) { try { s.stop(end + 0.05); } catch (e) { /* ignore */ } }
  g.tid = setTimeout(() => dispose(g), Math.max(60, (end - ac.currentTime + 0.3) * 1000));
}
const HIGH_PRI = new Set(['stinger', 'rocket_launch', 'rocket_fail', 'explosion', 'warp', 'gate', 'death', 'revive', 'door', 'alarm']);
function voice(o, rev, dest, name) {
  if (voices.length >= MAX_VOICES) {
    let idx = voices.findIndex((v) => v.pri < 2);
    if (idx < 0) idx = 0;
    const old = voices.splice(idx, 1)[0];
    kill(old, 0.03);
  }
  const g = grp(null, clamp(num(o.volume, 1), 0, 4));
  g.pri = HIGH_PRI.has(name) ? 2 : 0;
  route(g, o, rev, dest);
  voices.push(g);
  return g;
}

// ---------------------------------------------------------------- shared pieces
const VOWELS = [[800, 1200, 2500], [400, 2000, 2600], [300, 2300, 3000], [500, 900, 2400], [350, 800, 2300], [600, 1700, 2700]];
function formantNoise(g, t, p, q, dest) {
  const n = nz(g, 'white', t, 1);
  const hp = flt(g, 'highpass', 450, 0.7);
  n.connect(hp);
  const e = gn(g, 0);
  const fs = [];
  [1, 0.8, 0.5].forEach((lv, i) => {
    const f = flt(g, 'bandpass', VOWELS[0][i] * p, q || 9);
    const fg = gn(g, lv * 3.2);
    hp.connect(f); f.connect(fg); fg.connect(e);
    fs.push(f);
  });
  e.connect(dest || g.out);
  return { e, fs };
}
function setVowel(fs, t, p, glide) {
  const v = pick(VOWELS);
  fs.forEach((f, i) => {
    const fr = v[i] * p * rnd(0.9, 1.1);
    if (glide) f.frequency.setTargetAtTime(fr, t, glide); else f.frequency.setValueAtTime(fr, t);
  });
}
// whisper syllables on a formant chain; returns end time
function syllables(e, fs, t, p, k, vmax) {
  let tt = t;
  for (let i = 0; i < k; i++) {
    const d = rnd(0.07, 0.22);
    setVowel(fs, tt, p, 0);
    e.gain.setValueAtTime(0.0001, tt);
    e.gain.linearRampToValueAtTime(rnd(0.35, 1) * vmax, tt + d * 0.35);
    e.gain.linearRampToValueAtTime(0.0001, tt + d);
    tt += d + rnd(0.02, 0.14);
  }
  return tt;
}
function beat(g, t, p, v, x) {
  const gap = 0.27 - 0.09 * (x || 0);
  thump(g, t, 68 * p, 36 * p, 0.17, 0.9 * v);
  tone(g, t, 'triangle', 130 * p, 0.004, 0.09, 0.4 * v, 70 * p);
  burst(g, t, 'brown', 'lowpass', 180, 0.9, 0.004, 0.08, 0.5 * v);
  thump(g, t + gap, 60 * p, 33 * p, 0.2, 0.6 * v);
  tone(g, t + gap, 'triangle', 115 * p, 0.004, 0.1, 0.16 * v, 60 * p);
}
function boom(g, t, p, v, D) {
  const n = nz(g, 'white', t, 1), lp = flt(g, 'lowpass', 5000 * p, 0.7), sh = shaper(g, 2.5), e = gn(g, 0);
  chain(n, lp, sh, e, g.out);
  lp.frequency.setValueAtTime(5500 * p, t);
  lp.frequency.exponentialRampToValueAtTime(160 * p, t + D);
  e.gain.setValueAtTime(0, t);
  e.gain.linearRampToValueAtTime(0.9 * v, t + 0.006);
  e.gain.exponentialRampToValueAtTime(0.25 * v, t + 0.5);
  e.gain.exponentialRampToValueAtTime(0.0001, t + D);
  burst(g, t, 'brown', 'lowpass', 260, 0.8, 0.01, D + 0.4, 1.0 * v);
  thump(g, t, 95 * p, 22 * p, 1.3, 1.0 * v);
  tone(g, t, 'triangle', 160 * p, 0.004, 0.5, 0.3 * v, 50 * p);
  // debris crackle
  const c = nz(g, 'white', t, 1), cb = flt(g, 'bandpass', 2200, 1.5), ce = gn(g, 0);
  chain(c, cb, ce, g.out);
  let tt = t + 0.15;
  while (tt < t + D * 0.6) {
    ce.gain.setValueAtTime(rnd(0.05, 0.35) * v, tt);
    ce.gain.exponentialRampToValueAtTime(0.001, tt + 0.008);
    tt += rnd(0.02, 0.18);
  }
}
function squelch(g, t, p, v) {
  const fl = burst(g, t, 'white', 'bandpass', 2400 * p, 1.4, 0.003, 0.22, 0.45 * v);
  fl.frequency.setValueAtTime(3400 * p, t);
  fl.frequency.exponentialRampToValueAtTime(1100 * p, t + 0.22);
  tone(g, t, 'sine', 2600 * p, 0.002, 0.05, 0.08 * v, 1700 * p);
  tone(g, t + 0.17, 'square', 1250 * p, 0.002, 0.04, 0.035 * v);
}
function bell(g, t, f, d, v, dest) {
  [1, 2.756, 5.404, 8.933].forEach((r, i) => tone(g, t, 'sine', f * r, 0.002, d / (1 + i * 0.6), v / (1 + i * 1.2), 0, dest));
}

// ---------------------------------------------------------------- one-shots: fn(g, t, pitch, opts) -> duration
const SFX = {
  footstep(g, t, p) {
    const n = nz(g, 'pink', t, rnd(0.85, 1.2) * p);
    const hp = flt(g, 'highpass', 250 * p, 0.7), bp = flt(g, 'bandpass', rnd(650, 1300) * p, 0.8), e = gn(g, 0);
    chain(n, hp, bp, e, g.out);
    let tt = t;
    const k = 3 + ((Math.random() * 3) | 0);
    for (let i = 0; i < k; i++) {
      const d = rnd(0.012, 0.028);
      e.gain.setValueAtTime(rnd(0.8, 1.6) * (1 - i / (k + 1)), tt);
      e.gain.exponentialRampToValueAtTime(0.001, tt + d);
      tt += d + rnd(0.002, 0.016);
    }
    thump(g, t, 120 * p, 55 * p, 0.07, 0.22);
    return tt - t + 0.1;
  },
  footstep_metal(g, t, p) {
    burst(g, t, 'white', 'highpass', 2200, 0.7, 0.001, 0.03, 0.3);
    const base = rnd(280, 520) * p;
    [1, 2.43, 3.87, 5.13].forEach((r, i) => tone(g, t, 'sine', base * r * rnd(0.98, 1.02), 0.001, rnd(0.12, 0.3) / (1 + i * 0.4), 0.16 / (1 + i)));
    thump(g, t, 150 * p, 60 * p, 0.09, 0.35);
    return 0.4;
  },
  jump(g, t, p) {
    const fl = burst(g, t, 'pink', 'bandpass', 900 * p, 1.2, 0.03, 0.18, 0.8);
    fl.frequency.setValueAtTime(600 * p, t);
    fl.frequency.exponentialRampToValueAtTime(1800 * p, t + 0.2);
    burst(g, t, 'brown', 'bandpass', 520 * p, 3, 0.02, 0.14, 0.5);
    return 0.3;
  },
  land(g, t, p) {
    thump(g, t, 95 * p, 38 * p, 0.22, 0.6);
    tone(g, t, 'triangle', 150 * p, 0.003, 0.08, 0.18, 70 * p);
    burst(g, t, 'brown', 'lowpass', 500 * p, 0.7, 0.003, 0.18, 0.5);
    burst(g, t, 'pink', 'bandpass', 1100 * p, 0.8, 0.002, 0.08, 0.6);
    return 0.4;
  },
  pickup(g, t, p) {
    [1, 1.5, 2, 3].forEach((r, i) => {
      const tt = t + i * 0.06, f = 660 * p * r;
      tone(g, tt, 'sine', f, 0.005, 0.6, 0.14);
      tone(g, tt, 'triangle', f * 2.01, 0.005, 0.22, 0.035);
    });
    const o = osc(g, 'sine', 1320 * p, t);
    lfo(g, 7, 40 * p, o.frequency, t);
    const e = gn(g, 0);
    env(e.gain, t, 0.03, 0.06, 0.9);
    o.connect(e); e.connect(g.out);
    return 1.1;
  },
  interact(g, t, p) {
    burst(g, t, 'white', 'bandpass', 2500 * p, 2, 0.001, 0.03, 0.25);
    tone(g, t + 0.01, 'sine', 520 * p, 0.003, 0.12, 0.12, 780 * p);
    return 0.25;
  },
  deny(g, t, p) {
    const lp = flt(g, 'lowpass', 1100, 0.8);
    lp.connect(g.out);
    for (let i = 0; i < 2; i++) tone(g, t + i * 0.13, 'square', 140 * p, 0.005, 0.1, 0.16, 0, lp);
    return 0.4;
  },
  heartbeat(g, t, p) { beat(g, t, p, 1, 0); return 0.75; },
  breath(g, t, p) {
    const n = nz(g, 'pink', t, 1);
    const hp = flt(g, 'highpass', 300, 0.7), f1 = flt(g, 'bandpass', 1000 * p, 1.2), f2 = flt(g, 'bandpass', 2300 * p, 2), e = gn(g, 0);
    n.connect(hp); hp.connect(f1); hp.connect(f2); f1.connect(e); f2.connect(e); e.connect(g.out);
    const G = e.gain;
    G.setValueAtTime(0, t);
    G.linearRampToValueAtTime(0.85, t + 0.7);
    G.linearRampToValueAtTime(0.06, t + 0.95);
    G.linearRampToValueAtTime(1.2, t + 1.15);
    G.exponentialRampToValueAtTime(0.001, t + 2.1);
    f1.frequency.setValueAtTime(1100 * p, t);
    f1.frequency.linearRampToValueAtTime(1400 * p, t + 0.9);
    f1.frequency.setValueAtTime(800 * p, t + 0.95);
    f1.frequency.linearRampToValueAtTime(600 * p, t + 2.0);
    return 2.2;
  },
  stinger(g, t, p) {
    const base = 98 * p;
    const sh = shaper(g, 3), lp = flt(g, 'lowpass', 300, 2), e = gn(g, 0);
    chain(sh, lp, e, g.out);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(4200, t + 0.07);
    lp.frequency.exponentialRampToValueAtTime(900, t + 1.5);
    lp.frequency.exponentialRampToValueAtTime(250, t + 3.8);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(0.5, t + 0.03);
    e.gain.exponentialRampToValueAtTime(0.22, t + 0.6);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    [0.5, 1, 1.059, 1.414, 1.498, 2.0, 2.118, 2.83].forEach((r) => {
      const o = osc(g, 'sawtooth', base * r, t, rnd(-14, 14)), og = gn(g, 0.12);
      o.frequency.setValueAtTime(base * r, t);
      o.frequency.exponentialRampToValueAtTime(base * r * 0.93, t + 4);
      o.connect(og); og.connect(sh);
    });
    burst(g, t, 'white', 'lowpass', 6000, 0.5, 0.002, 0.35, 0.7);
    burst(g, t, 'brown', 'lowpass', 400, 0.7, 0.002, 0.9, 0.9);
    thump(g, t, 85, 28, 0.7, 0.9);
    tone(g, t, 'sawtooth', 1870 * p, 0.02, 1.5, 0.025, 1650 * p);
    tone(g, t, 'sine', 3520 * p, 0.05, 2.5, 0.02, 3300 * p);
    return 4.3;
  },
  screech(g, t, p) {
    const c = osc(g, 'sawtooth', 700 * p, t), m = osc(g, 'sine', 180 * p, t), md = gn(g, 750 * p);
    m.connect(md); md.connect(c.frequency);
    c.frequency.setValueAtTime(700 * p, t);
    c.frequency.exponentialRampToValueAtTime(2700 * p, t + 0.22);
    c.frequency.exponentialRampToValueAtTime(1500 * p, t + 0.7);
    c.frequency.exponentialRampToValueAtTime(480 * p, t + 1.35);
    m.frequency.setValueAtTime(180 * p, t);
    m.frequency.linearRampToValueAtTime(430 * p, t + 1.3);
    const sh = shaper(g, 8), bp = flt(g, 'bandpass', 2000 * p, 0.8), e = gn(g, 0);
    chain(c, sh, bp, e, g.out);
    bp.frequency.setValueAtTime(1500 * p, t);
    bp.frequency.exponentialRampToValueAtTime(3000 * p, t + 0.25);
    bp.frequency.exponentialRampToValueAtTime(900 * p, t + 1.35);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(0.45, t + 0.05);
    e.gain.exponentialRampToValueAtTime(0.26, t + 0.5);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 1.45);
    const fl = burst(g, t, 'white', 'highpass', 3000 * p, 0.7, 0.03, 1.1, 0.14);
    fl.frequency.setValueAtTime(2500 * p, t);
    // second, detuned voice for a ragged throat
    const c2 = osc(g, 'square', 1010 * p, t), e2 = gn(g, 0), b2 = flt(g, 'bandpass', 2400 * p, 3);
    c2.frequency.setValueAtTime(1010 * p, t);
    c2.frequency.exponentialRampToValueAtTime(3100 * p, t + 0.3);
    c2.frequency.exponentialRampToValueAtTime(700 * p, t + 1.2);
    env(e2.gain, t, 0.04, 0.06, 1.1);
    chain(c2, b2, e2, g.out);
    return 1.6;
  },
  growl(g, t, p) {
    const D = rnd(1.2, 1.9);
    const n = nz(g, 'brown', t, 1), sh = shaper(g, 4);
    const f1 = flt(g, 'bandpass', 320 * p, 5), f2 = flt(g, 'bandpass', 820 * p, 6);
    const am = gn(g, 0.55);
    lfo(g, rnd(22, 36), 0.45, am.gain, t);
    const e = gn(g, 0);
    const s = osc(g, 'sawtooth', 58 * p, t), sg = gn(g, 0.6);
    s.frequency.setValueAtTime(58 * p, t);
    s.frequency.linearRampToValueAtTime(74 * p, t + D * 0.4);
    s.frequency.linearRampToValueAtTime(46 * p, t + D);
    s.connect(sg); sg.connect(sh);
    n.connect(sh); sh.connect(f1); sh.connect(f2); f1.connect(am); f2.connect(am); am.connect(e); e.connect(g.out);
    f2.frequency.setValueAtTime(820 * p, t);
    f2.frequency.linearRampToValueAtTime(600 * p, t + D);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(1.8, t + 0.15);
    e.gain.linearRampToValueAtTime(1.3, t + D * 0.7);
    e.gain.exponentialRampToValueAtTime(0.0001, t + D);
    return D + 0.2;
  },
  click(g, t, p) {
    const n = nz(g, 'white', t, 1);
    const hp = flt(g, 'highpass', 900, 0.7), b1 = flt(g, 'bandpass', rnd(2200, 3400) * p, 5), b2 = flt(g, 'bandpass', rnd(650, 950) * p, 7);
    const e = gn(g, 0), e2 = gn(g, 0);
    n.connect(hp); hp.connect(b1); b1.connect(e); e.connect(g.out);
    n.connect(b2); b2.connect(e2); e2.connect(g.out);
    const k = 7 + ((Math.random() * 11) | 0);
    let tt = t;
    for (let i = 0; i < k; i++) {
      const v = rnd(2.2, 4);
      e.gain.setValueAtTime(v, tt);
      e.gain.exponentialRampToValueAtTime(0.001, tt + 0.005);
      e2.gain.setValueAtTime(v * 1.6, tt);
      e2.gain.exponentialRampToValueAtTime(0.001, tt + 0.009);
      tt += rnd(0.017, 0.042) * (i > k * 0.6 ? 1.5 : 1);
    }
    return tt - t + 0.1;
  },
  static(g, t, p) {
    const D = rnd(0.45, 0.8);
    const n = nz(g, 'white', t, 1), bp = flt(g, 'bandpass', 2500 * p, 0.7), e = gn(g, 0);
    chain(n, bp, e, g.out);
    let tt = t;
    while (tt < t + D) { e.gain.setValueAtTime(rnd(0.04, 0.38), tt); tt += rnd(0.008, 0.05); }
    e.gain.setValueAtTime(0, tt);
    return tt - t + 0.05;
  },
  beep(g, t, p) {
    tone(g, t, 'square', 1046 * p, 0.003, 0.12, 0.04);
    tone(g, t, 'sine', 1046 * p, 0.003, 0.15, 0.16);
    return 0.25;
  },
  radio(g, t, p) { squelch(g, t, p, 1); return 0.35; },
  door(g, t, p) {
    const fl = burst(g, t, 'white', 'bandpass', 3000 * p, 1.2, 0.05, 0.9, 0.35);
    fl.frequency.setValueAtTime(4200 * p, t);
    fl.frequency.exponentialRampToValueAtTime(800 * p, t + 0.9);
    const lp = flt(g, 'lowpass', 600, 1);
    lp.connect(g.out);
    tone(g, t, 'sawtooth', 95 * p, 0.12, 0.75, 0.12, 150 * p, lp);
    thump(g, t + 0.85, 120 * p, 45 * p, 0.25, 0.75);
    burst(g, t + 0.85, 'brown', 'lowpass', 900, 1, 0.002, 0.2, 0.6);
    tone(g, t + 0.85, 'sine', 380 * p, 0.002, 0.45, 0.07);
    tone(g, t + 0.85, 'sine', 913 * p, 0.002, 0.28, 0.04);
    return 1.5;
  },
  alarm(g, t, p) {
    const o = osc(g, 'sawtooth', 660 * p, t), o2 = osc(g, 'square', 662 * p, t);
    for (let i = 0; i < 6; i++) {
      const f = (i % 2 ? 880 : 660) * p;
      o.frequency.setValueAtTime(f, t + i * 0.22);
      o2.frequency.setValueAtTime(f * 1.003, t + i * 0.22);
    }
    const lp = flt(g, 'lowpass', 2600, 1), e = gn(g, 0), o2g = gn(g, 0.4);
    o.connect(lp); o2.connect(o2g); o2g.connect(lp); lp.connect(e); e.connect(g.out);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(0.13, t + 0.02);
    e.gain.setValueAtTime(0.13, t + 1.25);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    return 1.6;
  },
  warp(g, t, p) {
    const n = nz(g, 'white', t, 1), bp = flt(g, 'bandpass', 200, 2.2), e = gn(g, 0);
    chain(n, bp, e, g.out);
    bp.frequency.setValueAtTime(180 * p, t);
    bp.frequency.exponentialRampToValueAtTime(7000 * p, t + 2.2);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(1.2, t + 2.15);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 2.7);
    const lp = flt(g, 'lowpass', 1800, 2);
    lp.connect(g.out);
    const s = tone(g, t, 'sawtooth', 70 * p, 1.6, 0.8, 0.12, 0, lp);
    s.frequency.setValueAtTime(70 * p, t);
    s.frequency.exponentialRampToValueAtTime(950 * p, t + 2.2);
    thump(g, t + 2.15, 150 * p, 24 * p, 1.4, 1.0);
    tone(g, t + 2.15, 'triangle', 220 * p, 0.005, 0.6, 0.25, 45 * p);
    burst(g, t + 2.15, 'brown', 'lowpass', 320, 0.7, 0.005, 1.1, 0.8);
    [2093, 2637, 3136, 4186, 5274].forEach((f) => {
      const tt = t + 2.15 + rnd(0, 0.15);
      const o = tone(g, tt, 'sine', f * p, 0.04, 1.8, 0.04);
      lfo(g, rnd(5, 9), f * p * 0.004, o.frequency, tt);
    });
    return 4.3;
  },
  explosion(g, t, p) { boom(g, t, p, 1, 3); return 3.6; },
  rocket_fail(g, t, p) {
    const n = nz(g, 'brown', t, 1), lp = flt(g, 'lowpass', 900 * p, 1), e = gn(g, 0);
    chain(n, lp, e, g.out);
    let tt = t;
    e.gain.setValueAtTime(0.0001, t);
    while (tt < t + 1.4) {
      e.gain.setValueAtTime(0.0001, tt);
      e.gain.linearRampToValueAtTime(rnd(0.25, 0.85), tt + 0.01);
      e.gain.exponentialRampToValueAtTime(0.01, tt + 0.06);
      tt += rnd(0.07, 0.2);
    }
    const w = osc(g, 'sawtooth', 420 * p, t), wl = flt(g, 'lowpass', 1200, 1), we = gn(g, 0);
    w.frequency.setValueAtTime(420 * p, t);
    w.frequency.exponentialRampToValueAtTime(90 * p, t + 1.5);
    env(we.gain, t, 0.05, 0.08, 1.45);
    chain(w, wl, we, g.out);
    boom(g, t + 1.5, p, 0.85, 2.6);
    burst(g, t + 1.65, 'white', 'highpass', 2800, 0.7, 0.08, 3.6, 0.32);
    return 5.6;
  },
  rocket_launch(g, t, p) {
    const D = 9;
    const n1 = nz(g, 'brown', t, 1), n2 = nz(g, 'white', t, 1);
    const lp = flt(g, 'lowpass', 150, 0.8), sh = shaper(g, 2), e = gn(g, 0), g2 = gn(g, 0.22);
    n2.connect(g2); g2.connect(lp); n1.connect(lp); chain(lp, sh, e, g.out);
    lp.frequency.setValueAtTime(150 * p, t);
    lp.frequency.exponentialRampToValueAtTime(1800 * p, t + 2.5);
    lp.frequency.linearRampToValueAtTime(2600 * p, t + 5);
    lp.frequency.exponentialRampToValueAtTime(350 * p, t + D);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(0.75, t + 2);
    e.gain.linearRampToValueAtTime(0.9, t + 5);
    e.gain.exponentialRampToValueAtTime(0.0001, t + D);
    const am = gn(g, 0.85);
    lfo(g, 31, 0.15, am.gain, t, 'square');
    const r = osc(g, 'sine', 42 * p, t), r2 = osc(g, 'triangle', 84 * p, t), re = gn(g, 0), r2g = gn(g, 0.35);
    r.connect(re); r2.connect(r2g); r2g.connect(re); re.connect(am); am.connect(g.out);
    re.gain.setValueAtTime(0, t);
    re.gain.linearRampToValueAtTime(0.6, t + 2);
    re.gain.exponentialRampToValueAtTime(0.0001, t + D);
    thump(g, t, 70 * p, 28 * p, 1.5, 0.7);
    return D + 0.3;
  },
  hurt(g, t, p) {
    thump(g, t, 150 * p, 45 * p, 0.25, 0.9);
    tone(g, t, 'triangle', 220 * p, 0.003, 0.1, 0.22, 90 * p);
    burst(g, t, 'brown', 'lowpass', 700, 0.8, 0.002, 0.2, 0.7);
    burst(g, t, 'white', 'bandpass', 1800, 1, 0.001, 0.05, 0.25);
    return 0.5;
  },
  death(g, t, p) {
    const D = 4.5;
    const lp = flt(g, 'lowpass', 1300, 1), e = gn(g, 0);
    lp.frequency.setValueAtTime(1300, t);
    lp.frequency.exponentialRampToValueAtTime(110, t + D);
    lp.connect(e); e.connect(g.out);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(0.4, t + 0.05);
    e.gain.exponentialRampToValueAtTime(0.0001, t + D);
    [110, 116.5, 164.8, 174.6].forEach((f) => {
      const o = osc(g, 'sawtooth', f * p, t, rnd(-10, 10)), og = gn(g, 0.15);
      o.frequency.setValueAtTime(f * p, t);
      o.frequency.exponentialRampToValueAtTime(f * p * 0.33, t + D);
      o.connect(og); og.connect(lp);
    });
    burst(g, t, 'brown', 'lowpass', 300, 0.7, 0.01, D, 0.6);
    thump(g, t, 100, 30, 1.0, 0.9);
    beat(g, t + 0.8, p, 0.8, 0);
    beat(g, t + 2.2, p * 0.9, 0.4, 0);
    tone(g, t, 'sine', 6200, 0.05, 3.6, 0.022);
    return D + 0.4;
  },
  revive(g, t, p) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone(g, t + i * 0.09, 'sine', f * p, 0.02, 1.2, 0.12);
      tone(g, t + i * 0.09, 'triangle', f * 2 * p, 0.02, 0.5, 0.025);
    });
    const fl = burst(g, t, 'pink', 'bandpass', 500, 1.5, 0.3, 0.6, 0.18);
    fl.frequency.setValueAtTime(400, t);
    fl.frequency.exponentialRampToValueAtTime(3000, t + 0.9);
    beat(g, t + 0.05, p, 0.5, 0.3);
    return 1.8;
  },
  whisper(g, t, p) {
    const { e, fs } = formantNoise(g, t, p, 10);
    const sn = nz(g, 'white', t, 1), shp = flt(g, 'highpass', 5000, 0.7), se = gn(g, 0);
    chain(sn, shp, se, g.out);
    let tt = t;
    const k = 4 + ((Math.random() * 6) | 0);
    for (let i = 0; i < k; i++) {
      const d = rnd(0.07, 0.22);
      setVowel(fs, tt, p, 0);
      e.gain.setValueAtTime(0.0001, tt);
      e.gain.linearRampToValueAtTime(rnd(0.4, 1), tt + d * 0.35);
      e.gain.linearRampToValueAtTime(0.0001, tt + d);
      if (Math.random() < 0.35) {
        se.gain.setValueAtTime(0.0001, tt + d);
        se.gain.linearRampToValueAtTime(rnd(0.05, 0.12), tt + d + 0.03);
        se.gain.linearRampToValueAtTime(0.0001, tt + d + 0.09);
        tt += 0.09;
      }
      tt += d + rnd(0.02, 0.14);
    }
    return tt - t + 0.2;
  },
  rwhisper(g, t, p) { // reversed-sounding: slow swell, abrupt cut
    const { e, fs } = formantNoise(g, t, p, 7);
    const D = rnd(1.4, 3);
    setVowel(fs, t, p, 0);
    setVowel(fs, t + 0.1, p, D * 0.4);
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(0.9, t + D);
    e.gain.linearRampToValueAtTime(0.0001, t + D + 0.04);
    return D + 0.1;
  },
  metal_groan(g, t, p) {
    const D = rnd(2.5, 4.5);
    const base = rnd(45, 75) * p;
    const bp = flt(g, 'bandpass', 400 * p, 6), bp2 = flt(g, 'bandpass', 1100 * p, 9), e = gn(g, 0), b2g = gn(g, 0.6);
    bp.connect(e); bp2.connect(b2g); b2g.connect(e); e.connect(g.out);
    [1, 1.007, 1.5].forEach((k) => {
      const o = osc(g, 'sawtooth', base * k, t);
      o.frequency.setValueAtTime(base * k, t);
      for (let i = 1; i <= 7; i++) o.frequency.linearRampToValueAtTime(base * k * rnd(0.82, 1.25), t + (D * i) / 7);
      o.connect(bp); o.connect(bp2);
    });
    bp.frequency.setValueAtTime(250 * p, t);
    bp.frequency.linearRampToValueAtTime(rnd(500, 800) * p, t + D * 0.45);
    bp.frequency.linearRampToValueAtTime(320 * p, t + D);
    const n = nz(g, 'brown', t, 1), ng = gn(g, 0.5);
    n.connect(ng); ng.connect(bp);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(1.4, t + D * 0.4);
    e.gain.linearRampToValueAtTime(0.9, t + D * 0.8);
    e.gain.exponentialRampToValueAtTime(0.0001, t + D);
    return D + 0.3;
  },
  creak(g, t, p) {
    const D = rnd(0.5, 1.3);
    const o = osc(g, 'sawtooth', rnd(28, 60) * p, t);
    o.frequency.setValueAtTime(o.frequency.value, t);
    for (let i = 1; i <= 5; i++) o.frequency.linearRampToValueAtTime(rnd(20, 80) * p, t + (D * i) / 5);
    const b1 = flt(g, 'bandpass', rnd(700, 1400) * p, 14), b2 = flt(g, 'bandpass', rnd(1800, 2600) * p, 12), e = gn(g, 0);
    o.connect(b1); o.connect(b2); b1.connect(e); b2.connect(e); e.connect(g.out);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(3.0, t + D * 0.3);
    e.gain.linearRampToValueAtTime(0.0001, t + D);
    return D + 0.1;
  },
  drip(g, t, p) {
    const f = rnd(900, 1700) * p;
    tone(g, t, 'sine', f * 0.6, 0.001, 0.12, 0.25, f * 1.5);
    return 0.25;
  },
  ping(g, t, p) {
    const f = rnd(1300, 2300) * p;
    tone(g, t, 'sine', f, 0.003, 2.5, 0.14);
    tone(g, t, 'sine', f * 1.004, 0.003, 2.5, 0.1);
    return 2.7;
  },
  thunder(g, t, p) {
    const D = rnd(4.5, 7);
    burst(g, t, 'white', 'highpass', 1200 * p, 0.5, 0.002, 0.25, 0.6);
    burst(g, t + 0.02, 'white', 'bandpass', 600 * p, 0.7, 0.002, 0.45, 0.5);
    const n = nz(g, 'brown', t, 1), lp = flt(g, 'lowpass', 900 * p, 0.9), e = gn(g, 0);
    chain(n, lp, e, g.out);
    lp.frequency.setValueAtTime(900 * p, t);
    lp.frequency.exponentialRampToValueAtTime(140 * p, t + D);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(0.9, t + 0.1);
    let tt = t + 0.1;
    while (tt < t + D - 1) {
      tt += rnd(0.25, 0.8);
      e.gain.linearRampToValueAtTime(Math.max(0.03, rnd(0.3, 0.95) * (1 - (tt - t) / D)), tt);
    }
    e.gain.exponentialRampToValueAtTime(0.0001, t + D);
    thump(g, t, 70 * p, 25 * p, 1.5, 0.8);
    return D + 0.3;
  },
  ui_hover(g, t, p) { tone(g, t, 'sine', 1400 * p, 0.002, 0.05, 0.05); return 0.1; },
  ui_select(g, t, p) {
    thump(g, t, 180 * p, 90 * p, 0.08, 0.2);
    tone(g, t, 'sine', 700 * p, 0.002, 0.08, 0.1);
    tone(g, t + 0.05, 'sine', 1050 * p, 0.002, 0.14, 0.09);
    return 0.3;
  },
  typing(g, t, p) {
    burst(g, t, 'white', 'bandpass', rnd(2500, 4500) * p, 3, 0.001, 0.02, rnd(0.15, 0.3));
    thump(g, t, 400 * p, 200 * p, 0.02, 0.05);
    return 0.08;
  },
  valve(g, t, p) {
    const o = osc(g, 'sawtooth', 1600 * p, t);
    lfo(g, 9, 45 * p, o.frequency, t);
    o.frequency.setValueAtTime(1600 * p, t);
    o.frequency.linearRampToValueAtTime(2300 * p, t + 0.6);
    o.frequency.linearRampToValueAtTime(1800 * p, t + 0.95);
    const bp = flt(g, 'bandpass', 1700 * p, 12), e = gn(g, 0);
    bp.frequency.setValueAtTime(1700 * p, t);
    bp.frequency.linearRampToValueAtTime(2300 * p, t + 0.6);
    chain(o, bp, e, g.out);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(0.4, t + 0.05);
    e.gain.linearRampToValueAtTime(0.25, t + 0.6);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    burst(g, t + 0.2, 'white', 'highpass', 2500 * p, 0.7, 0.1, 1.8, 0.35);
    thump(g, t, 180 * p, 80 * p, 0.12, 0.4);
    return 2.2;
  },
  shard(g, t, p) {
    bell(g, t, 659.25 * p, 2.6, 0.16);
    bell(g, t + 0.12, 987.77 * p, 2.0, 0.08);
    const o = osc(g, 'sine', 2637 * p, t), e = gn(g, 0);
    lfo(g, 6, 0.5, e.gain, t);
    env(e.gain, t, 0.3, 0.03, 2.2);
    o.connect(e); e.connect(g.out);
    return 3.0;
  },
  gate(g, t, p) {
    const D = 5;
    const sub = tone(g, t, 'sine', 36 * p, 0.8, D - 0.8, 0.8);
    sub.frequency.setValueAtTime(30 * p, t);
    sub.frequency.linearRampToValueAtTime(40 * p, t + 1.5);
    const lp = flt(g, 'lowpass', 80, 9), e = gn(g, 0);
    lp.frequency.setValueAtTime(80, t);
    lp.frequency.exponentialRampToValueAtTime(1400, t + 1.6);
    lp.frequency.exponentialRampToValueAtTime(180, t + D);
    lp.connect(e); e.connect(g.out);
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(0.25, t + 1.2);
    e.gain.exponentialRampToValueAtTime(0.0001, t + D);
    [55, 55.3, 82.5, 110.4].forEach((f) => { const o = osc(g, 'sawtooth', f * p, t), og = gn(g, 0.3); o.connect(og); og.connect(lp); });
    [110, 165, 220.5, 331, 440].forEach((f, i) => tone(g, t + 1.2 + i * 0.05, 'sine', f * p, 0.05, 3.2, 0.08 / (1 + i * 0.3)));
    const fl = burst(g, t, 'pink', 'bandpass', 200, 2, 1.2, 0.8, 0.25);
    fl.frequency.setValueAtTime(150, t);
    fl.frequency.exponentialRampToValueAtTime(4000, t + 1.3);
    return D + 0.5;
  },
};
const REV = {
  footstep: 0.06, footstep_metal: 0.2, jump: 0.04, land: 0.1, pickup: 0.35, interact: 0.08, deny: 0.05, heartbeat: 0, breath: 0.04,
  stinger: 0.9, screech: 0.6, growl: 0.4, click: 0.3, static: 0.04, beep: 0.12, radio: 0.04, door: 0.3, alarm: 0.4, warp: 0.7,
  explosion: 0.6, rocket_fail: 0.5, rocket_launch: 0.4, hurt: 0.08, death: 0.7, revive: 0.5, whisper: 0.7, rwhisper: 0.9,
  metal_groan: 0.8, creak: 0.6, drip: 0.8, ping: 1, thunder: 0.6, ui_hover: 0, ui_select: 0.04, typing: 0, valve: 0.35, shard: 0.8, gate: 0.8,
};
// non-positional plays of these go to the unmuffled "inner" bus (UI, own body, helmet comms)
const INNER = new Set(['ui_hover', 'ui_select', 'typing', 'heartbeat', 'breath', 'hurt', 'death', 'revive', 'radio', 'static', 'beep', 'deny', 'stinger']);

// ---------------------------------------------------------------- loops: fn(L, pitch, opts)
const LOOPS = {
  creature_breath(L, p) {
    const t = ac.currentTime;
    const n = nz(L, 'brown', t, rnd(0.9, 1.1)), n2 = nz(L, 'pink', t, 1);
    const f1 = flt(L, 'bandpass', 520 * p, 2.2), f2 = flt(L, 'bandpass', 1500 * p, 3.5);
    const wet = gn(L, 2.2), n2g = gn(L, 1.5), e = gn(L, 0);
    const am = lfo(L, 22, 1.4, wet.gain, t);
    n.connect(f1); n2.connect(n2g); n2g.connect(f2); f1.connect(wet); f2.connect(wet); wet.connect(e); e.connect(L.out);
    const s = osc(L, 'sawtooth', 48 * p, t), slp = flt(L, 'lowpass', 320, 1), sg = gn(L, 0);
    chain(s, slp, sg, L.out);
    let last = 0;
    sched(L, 0.05, () => {
      const t0 = Math.max(ac.currentTime + 0.03, last + 0.02);
      const inh = rnd(0.7, 1.3), hold = rnd(0.05, 0.2), exh = rnd(0.9, 1.6);
      const G = e.gain;
      G.setValueAtTime(0.0001, t0);
      G.linearRampToValueAtTime(rnd(0.3, 0.5), t0 + inh);
      G.linearRampToValueAtTime(0.04, t0 + inh + hold);
      let tt = t0 + inh + hold;
      const steps = 3 + ((Math.random() * 4) | 0);
      for (let i = 0; i < steps; i++) { tt += exh / steps; G.linearRampToValueAtTime(rnd(0.25, 0.8) * (1 - i / (steps + 1)), tt); }
      G.linearRampToValueAtTime(0.0001, tt + 0.15);
      f1.frequency.setValueAtTime(700 * p, t0);
      f1.frequency.linearRampToValueAtTime(900 * p, t0 + inh);
      f1.frequency.setValueAtTime(480 * p, t0 + inh + hold);
      f1.frequency.linearRampToValueAtTime(360 * p, tt);
      am.frequency.setValueAtTime(rnd(14, 34), t0);
      sg.gain.setValueAtTime(0.0001, t0 + inh + hold);
      sg.gain.linearRampToValueAtTime(rnd(0.05, 0.12), t0 + inh + hold + 0.1);
      sg.gain.linearRampToValueAtTime(0.0001, tt + 0.1);
      last = tt + 0.15;
      return last - ac.currentTime + rnd(0.05, 0.5);
    });
  },
  creature_chitter(L, p) {
    const t = ac.currentTime;
    const n = nz(L, 'white', t, 1);
    const b1 = flt(L, 'bandpass', 3800 * p, 7), b2 = flt(L, 'bandpass', 1600 * p, 5), e = gn(L, 0), b2g = gn(L, 0.8);
    n.connect(b1); n.connect(b2); b1.connect(e); b2.connect(b2g); b2g.connect(e); e.connect(L.out);
    let last = 0;
    sched(L, 0.05, () => {
      const t0 = Math.max(ac.currentTime + 0.03, last + 0.01);
      const k = 4 + ((Math.random() * 14) | 0), rate = rnd(0.012, 0.03);
      b1.frequency.setValueAtTime(rnd(2800, 5200) * p, t0);
      b2.frequency.setValueAtTime(rnd(1100, 2000) * p, t0);
      let tt = t0;
      for (let i = 0; i < k; i++) {
        e.gain.setValueAtTime(rnd(1.2, 3), tt);
        e.gain.exponentialRampToValueAtTime(0.001, tt + 0.004);
        tt += rate * rnd(0.75, 1.3);
      }
      last = tt;
      return tt - ac.currentTime + (Math.random() < 0.3 ? rnd(0.6, 1.6) : rnd(0.04, 0.3));
    });
  },
  wraith_hum(L, p) {
    const t = ac.currentTime, base = 174.6 * p;
    const lp = flt(L, 'lowpass', 1800, 0.7), hum = gn(L, 0.12);
    lp.connect(hum); hum.connect(L.out);
    [[1, 1.0042], [1.5, 1.5063], [2.0, 2.011], [0.5, 0.5019], [2.67, 2.676]].forEach((pair, i) => {
      const v = i === 4 ? 0.25 : 1 / (1 + i * 0.3);
      pair.forEach((r) => { const o = osc(L, 'sine', base * r, t), og = gn(L, v * 0.5); o.connect(og); og.connect(lp); });
    });
    lfo(L, 0.23, 0.03, hum.gain, t);
    const { e, fs } = formantNoise(L, t, p, 10);
    let last = 0;
    sched(L, rnd(0.3, 1.5), () => {
      const t0 = Math.max(ac.currentTime + 0.03, last + 0.02);
      last = syllables(e, fs, t0, p * rnd(0.85, 1.15), 3 + ((Math.random() * 5) | 0), 1.0);
      return last - ac.currentTime + rnd(1.2, 4);
    });
  },
  engine_hum(L, p) {
    const t = ac.currentTime, f = 55 * p;
    const lp = flt(L, 'lowpass', 380, 1.5), out = gn(L, 0.18);
    lp.connect(out); out.connect(L.out);
    lfo(L, 0.13, 90, lp.frequency, t);
    [[f, 'sawtooth', 0.5, 0], [f, 'sawtooth', 0.5, 7], [f * 2, 'square', 0.12, -4], [f * 3, 'sine', 0.3, 0], [f * 4, 'sine', 0.2, 3]].forEach(([fr, ty, v, d]) => {
      const o = osc(L, ty, fr, t, d), og = gn(L, v); o.connect(og); og.connect(lp);
    });
    const n = nz(L, 'brown', t, 1), nl = flt(L, 'lowpass', 220, 0.8), ng = gn(L, 0.08);
    chain(n, nl, ng, L.out);
  },
  alarm_loop(L, p) {
    const t = ac.currentTime;
    const o = osc(L, 'sawtooth', 700 * p, t), o2 = osc(L, 'square', 702 * p, t);
    const sw = osc(L, 'square', 1.25, t), sd = gn(L, 170 * p);
    sw.connect(sd); sd.connect(o.frequency); sd.connect(o2.frequency);
    const lp = flt(L, 'lowpass', 2400, 1.2), e = gn(L, 0.12), o2g = gn(L, 0.4);
    o.connect(lp); o2.connect(o2g); o2g.connect(lp); lp.connect(e); e.connect(L.out);
  },
  wind(L, p) {
    const t = ac.currentTime;
    const n = nz(L, 'pink', t, 1), bp = flt(L, 'bandpass', 700 * p, 4), g1 = gn(L, 2.0);
    chain(n, bp, g1, L.out);
    lfo(L, 0.07, 350 * p, bp.frequency, t);
    lfo(L, 0.17, 1.0, g1.gain, t);
    const b = nz(L, 'brown', t, 1), bl = flt(L, 'lowpass', 260, 0.7), bg = gn(L, 0.3);
    chain(b, bl, bg, L.out);
  },
  fire(L, p) {
    const t = ac.currentTime;
    const b = nz(L, 'brown', t, 1), bl = flt(L, 'lowpass', 600 * p, 0.8), bg = gn(L, 0.4);
    chain(b, bl, bg, L.out);
    lfo(L, 1.7, 0.12, bg.gain, t);
    const w = nz(L, 'white', t, 1), wh = flt(L, 'highpass', 3500, 0.7), wg = gn(L, 0.025);
    chain(w, wh, wg, L.out);
    const c = nz(L, 'white', t, 1), cb = flt(L, 'bandpass', 2600 * p, 1.2), ce = gn(L, 0);
    chain(c, cb, ce, L.out);
    let last = 0;
    sched(L, 0.05, () => {
      let tt = Math.max(ac.currentTime + 0.03, last + 0.01);
      const end = tt + 0.5;
      while (tt < end) {
        ce.gain.setValueAtTime(rnd(0.15, 0.9), tt);
        ce.gain.exponentialRampToValueAtTime(0.001, tt + 0.006);
        tt += rnd(0.012, 0.15);
      }
      last = tt;
      return 0.45;
    });
  },
  beacon(L, p) {
    const t = ac.currentTime;
    const o = osc(L, 'sine', 1180 * p, t), o2 = osc(L, 'sine', 2370 * p, t), o2g = gn(L, 0.15), e = gn(L, 0);
    o.connect(e); o2.connect(o2g); o2g.connect(e);
    const dl = ac.createDelay(1.5);
    dl.delayTime.value = 0.42;
    L.nodes.push(dl);
    const fb = gn(L, 0.38), dlf = flt(L, 'lowpass', 2500, 0.7);
    e.connect(L.out); e.connect(dl); dl.connect(dlf); dlf.connect(fb); fb.connect(dl); dlf.connect(L.out);
    sched(L, 0.1, () => {
      const t0 = ac.currentTime + 0.03;
      e.gain.setValueAtTime(0.0001, t0);
      e.gain.linearRampToValueAtTime(0.4, t0 + 0.012);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
      o.frequency.setValueAtTime(1180 * p, t0);
      o.frequency.exponentialRampToValueAtTime(1100 * p, t0 + 1.4);
      return 2.8;
    });
  },
  rocket_charge(L, p) {
    const t = ac.currentTime, R = 7;
    const o = osc(L, 'sawtooth', 110 * p, t), o2 = osc(L, 'sawtooth', 110 * p, t, 9);
    o.frequency.setValueAtTime(110 * p, t);
    o.frequency.exponentialRampToValueAtTime(880 * p, t + R);
    o2.frequency.setValueAtTime(110 * p, t);
    o2.frequency.exponentialRampToValueAtTime(880 * p, t + R);
    const vib = osc(L, 'sine', 5.5, t), vd = gn(L, 25);
    vib.connect(vd); vd.connect(o.detune); vd.connect(o2.detune);
    const bp = flt(L, 'bandpass', 300 * p, 3), e = gn(L, 0.0001), am = gn(L, 0.6);
    bp.frequency.setValueAtTime(300 * p, t);
    bp.frequency.exponentialRampToValueAtTime(2200 * p, t + R);
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(0.12, t + R);
    const tr = lfo(L, 3, 0.4, am.gain, t);
    tr.frequency.setValueAtTime(3, t);
    tr.frequency.linearRampToValueAtTime(14, t + R);
    o.connect(bp); o2.connect(bp); bp.connect(e); e.connect(am); am.connect(L.out);
    const n = nz(L, 'brown', t, 1), nl = flt(L, 'lowpass', 220, 0.8), ng = gn(L, 0.05);
    ng.gain.setValueAtTime(0.05, t);
    ng.gain.linearRampToValueAtTime(0.35, t + R);
    chain(n, nl, ng, L.out);
  },
  steam(L, p) {
    const t = ac.currentTime;
    const n = nz(L, 'white', t, 1), hp = flt(L, 'highpass', 1800 * p, 0.7), lp = flt(L, 'lowpass', 9000, 0.7), g1 = gn(L, 0.25);
    chain(n, hp, lp, g1, L.out);
    lfo(L, 9, 0.03, g1.gain, t);
    lfo(L, 0.3, 0.04, g1.gain, t);
    const b = nz(L, 'brown', t, 1), bl = flt(L, 'lowpass', 250, 0.7), bg = gn(L, 0.12);
    chain(b, bl, bg, L.out);
  },
  warp_core(L, p) {
    const t = ac.currentTime, f = 55 * p;
    const lp = flt(L, 'lowpass', 300, 7), amp = gn(L, 0.12);
    [[f, 0], [f, 11], [f * 2, -6], [f * 0.5, 0]].forEach(([fr, d], i) => {
      const o = osc(L, i === 3 ? 'sine' : 'sawtooth', fr, t, d), og = gn(L, i === 3 ? 1.2 : 0.4);
      o.connect(og); og.connect(lp);
    });
    lp.connect(amp); amp.connect(L.out);
    const l = osc(L, 'sine', 1.6, t), ld = gn(L, 260), la = gn(L, 0.08);
    l.connect(ld); ld.connect(lp.frequency); l.connect(la); la.connect(amp.gain);
    const sh = gn(L, 0.015), shd = gn(L, 0.012);
    sh.connect(L.out);
    l.connect(shd); shd.connect(sh.gain);
    [880, 1318.5, 1760.6].forEach((fr) => { const o = osc(L, 'sine', fr * p, t); o.connect(sh); });
  },
};
const LOOP_REV = { creature_breath: 0.35, creature_chitter: 0.3, wraith_hum: 0.7, engine_hum: 0.15, alarm_loop: 0.4, wind: 0.2, fire: 0.15, beacon: 0.8, rocket_charge: 0.3, steam: 0.2, warp_core: 0.4 };

// ---------------------------------------------------------------- ambience beds: fn(A) (A.out and A.wet are faded)
function wet(A, node, amt) { const s = gn(A, amt); node.connect(s); s.connect(A.wet); }
function shot(A, name, o) {
  if (A.dead) return;
  playInternal(name, o, A.out);
}
const AMB = {
  menu(A) {
    const t = ac.currentTime;
    const lp = flt(A, 'lowpass', 220, 3), dg = gn(A, 0.16);
    lfo(A, 0.045, 110, lp.frequency, t);
    lp.connect(dg); dg.connect(A.out);
    [36.71, 36.95, 55.0, 55.3, 73.4, 110.2].forEach((f, i) => {
      const o = osc(A, 'sawtooth', f, t, rnd(-8, 8)), og = gn(A, i < 2 ? 0.5 : i < 5 ? 0.3 : 0.12);
      o.connect(og); og.connect(lp);
      if (i === 1) lfo(A, 0.031, 9, o.detune, t);
    });
    wet(A, dg, 0.3);
    const sh = gn(A, 0.022);
    sh.connect(A.out); wet(A, sh, 1.2);
    [1760, 2217.46, 2637, 3322.4, 4186].forEach((f) => {
      const o = osc(A, 'sine', f * rnd(0.998, 1.002), t), tg = gn(A, 0.5);
      lfo(A, rnd(0.05, 0.22), 0.5, tg.gain, t);
      o.connect(tg); tg.connect(sh);
    });
    sched(A, rnd(10, 20), () => {
      shot(A, 'metal_groan', { volume: rnd(0.25, 0.45), pitch: rnd(0.55, 0.85), _pan: rnd(-0.8, 0.8), _lp: 700, _rev: 1 });
      return rnd(20, 45);
    });
  },
  l1(A) {
    const t = ac.currentTime;
    const gust = gn(A, 0.7);
    gust.connect(A.out); wet(A, gust, 0.2);
    [['brown', 420, 5, 3.0], ['pink', 950, 7, 1.4]].forEach(([color, f, q, v]) => {
      const n = nz(A, color, t, rnd(0.9, 1.1)), bp = flt(A, 'bandpass', f, q), g1 = gn(A, v);
      chain(n, bp, g1, gust);
      sched(A, 0, () => {
        const tt = ac.currentTime;
        bp.frequency.setTargetAtTime(f * rnd(0.55, 1.9), tt, rnd(0.8, 2.5));
        bp.Q.setTargetAtTime(q * rnd(0.6, 1.5), tt, 1.5);
        return rnd(1.5, 4);
      });
    });
    sched(A, 1, () => { gust.gain.setTargetAtTime(rnd(0.3, 1.25), ac.currentTime, rnd(0.4, 1.6)); return rnd(1, 4); });
    const r = nz(A, 'brown', t, 0.8), rl = flt(A, 'lowpass', 110, 0.8), rg = gn(A, 0.4);
    chain(r, rl, rg, A.out);
    sched(A, rnd(6, 12), () => {
      shot(A, 'thunder', { volume: rnd(0.25, 0.6), pitch: rnd(0.7, 1), _pan: rnd(-0.9, 0.9), _lp: rnd(500, 1500) });
      return rnd(14, 32);
    });
    sched(A, rnd(8, 16), () => {
      shot(A, 'click', { volume: rnd(0.05, 0.12), pitch: rnd(0.8, 1.1), _pan: rnd(-1, 1), _lp: 2600, _rev: 1 });
      return rnd(9, 22);
    });
    sched(A, rnd(25, 45), () => {
      shot(A, 'growl', { volume: rnd(0.06, 0.12), pitch: rnd(0.5, 0.7), _pan: rnd(-1, 1), _lp: 500, _rev: 1 });
      return rnd(35, 70);
    });
  },
  l2(A) {
    const t = ac.currentTime;
    const lp = flt(A, 'lowpass', 380, 1), hg = gn(A, 0.12);
    lp.connect(hg); hg.connect(A.out); wet(A, hg, 0.15);
    [[52, 'sawtooth', 0.5], [52.4, 'sawtooth', 0.4], [104, 'sine', 0.5], [156, 'sine', 0.3], [208, 'sine', 0.2], [57, 'sine', 0.4]].forEach(([f, ty, v]) => {
      const o = osc(A, ty, f, t), og = gn(A, v); o.connect(og); og.connect(lp);
    });
    const n = nz(A, 'brown', t, 1), nl = flt(A, 'lowpass', 320, 0.8), nb = flt(A, 'bandpass', 700, 2), sw = gn(A, 0.3), nbg = gn(A, 1.2);
    n.connect(nl); nl.connect(sw); n.connect(nb); nb.connect(nbg); nbg.connect(sw);
    sw.connect(A.out); wet(A, sw, 0.4);
    lfo(A, 0.09, 0.28, sw.gain, t);
    sched(A, rnd(3, 7), () => { shot(A, 'creak', { volume: rnd(0.15, 0.35), pitch: rnd(0.7, 1.2), _pan: rnd(-1, 1), _lp: 2500 }); return rnd(4, 11); });
    sched(A, rnd(1, 3), () => { shot(A, 'drip', { volume: rnd(0.15, 0.4), pitch: rnd(0.8, 1.3), _pan: rnd(-1, 1) }); return rnd(1.5, 6); });
    sched(A, rnd(6, 12), () => { shot(A, 'ping', { volume: rnd(0.08, 0.18), pitch: rnd(0.8, 1.2), _pan: rnd(-1, 1), _rev: 1.2 }); return rnd(7, 16); });
    sched(A, rnd(15, 30), () => { shot(A, 'metal_groan', { volume: rnd(0.2, 0.4), pitch: rnd(0.7, 1.1), _pan: rnd(-1, 1), _lp: 1200 }); return rnd(18, 40); });
  },
  l3(A) {
    const t = ac.currentTime;
    const sub = gn(A, 0.3);
    sub.connect(A.out);
    [[32.7, 'sine', 1], [49, 'sine', 0.6], [65.4, 'triangle', 0.25]].forEach(([f, ty, v]) => { const o = osc(A, ty, f, t), og = gn(A, v); o.connect(og); og.connect(sub); });
    lfo(A, 0.05, 0.1, sub.gain, t);
    // choir pad: detuned saws -> parallel formant bank
    const pre = gn(A, 1), pad = gn(A, 0.7);
    const fs = [700, 1150, 2800].map((f, i) => { const b = flt(A, 'bandpass', f, 6 + i * 2), bg = gn(A, [1, 0.7, 0.4][i] * 2.5); pre.connect(b); b.connect(bg); bg.connect(pad); return b; });
    pad.connect(A.out); wet(A, pad, 0.9);
    lfo(A, 0.06, 0.3, pad.gain, t);
    const body = flt(A, 'lowpass', 500, 0.7), bdg = gn(A, 0.12);
    pre.connect(body); body.connect(bdg); bdg.connect(pad);
    const CH = [[130.81, 155.56, 185.0, 261.63], [123.47, 146.83, 174.61, 246.94], [138.59, 164.81, 196.0, 277.18], [116.54, 155.56, 185.0, 233.08]];
    const vox = [];
    CH[0].forEach((f) => {
      [-7, 6].forEach((d) => {
        const o = osc(A, 'sawtooth', f, t, d), og = gn(A, 0.12);
        lfo(A, rnd(4.5, 5.8), 6, o.detune, t);
        o.connect(og); og.connect(pre);
        vox.push(o);
      });
    });
    let ci = 0;
    sched(A, rnd(10, 16), () => {
      ci = (ci + 1 + ((Math.random() * 2) | 0)) % CH.length;
      const tt = ac.currentTime;
      vox.forEach((o, i) => o.frequency.setTargetAtTime(CH[ci][i >> 1], tt, 1.2));
      return rnd(10, 20);
    });
    sched(A, rnd(3, 6), () => {
      const v = pick([[700, 1150, 2800], [400, 800, 2600], [600, 1000, 2500], [500, 1700, 2600]]);
      fs.forEach((b, i) => b.frequency.setTargetAtTime(v[i], ac.currentTime, 1.5));
      return rnd(4, 9);
    });
    const air = nz(A, 'white', t, 1), ab = flt(A, 'bandpass', 6000, 0.7), ag = gn(A, 0.02);
    chain(air, ab, ag, A.out);
    lfo(A, 0.07, 0.01, ag.gain, t);
    sched(A, rnd(5, 9), () => { shot(A, 'rwhisper', { volume: rnd(0.15, 0.35), pitch: rnd(0.8, 1.2), _pan: rnd(-1, 1) }); return rnd(6, 14); });
    sched(A, rnd(12, 25), () => { shot(A, 'whisper', { volume: rnd(0.08, 0.16), pitch: rnd(0.7, 0.95), _pan: rnd(-1, 1), _rev: 1.2 }); return rnd(15, 35); });
  },
  cutscene(A) {
    const t = ac.currentTime, R = 40;
    const lp = flt(A, 'lowpass', 120, 2), dg = gn(A, 0.15);
    lp.frequency.setValueAtTime(120, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + R);
    lp.connect(dg); dg.connect(A.out); wet(A, dg, 0.3);
    [41.2, 41.5, 61.7, 82.4].forEach((f, i) => {
      const o = osc(A, 'sawtooth', f, t, rnd(-6, 6)), og = gn(A, i < 2 ? 0.5 : 0.3);
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 1.33, t + R);
      o.connect(og); og.connect(lp);
    });
    const hi = gn(A, 0);
    hi.gain.setValueAtTime(0, t);
    hi.gain.linearRampToValueAtTime(0.02, t + R);
    hi.connect(A.out); wet(A, hi, 0.8);
    [880, 932.3, 1396.9].forEach((f) => { const o = osc(A, 'triangle', f, t), tg = gn(A, 0.6); lfo(A, rnd(5, 7), 0.4, tg.gain, t); o.connect(tg); tg.connect(hi); });
  },
};

// ---------------------------------------------------------------- tension layer
function buildTension() {
  const T = grp(S.inner, 1);
  const t = ac.currentTime;
  const bp = flt(T, 'bandpass', 650, 1.1), sw = gn(T, 0.7), cg = gn(T, 0);
  bp.connect(sw); sw.connect(cg); cg.connect(T.out);
  lfo(T, 0.09, 0.3, sw.gain, t);
  [196, 207.65, 220, 293.66, 311.13, 415.3].forEach((f, i) => {
    const o = osc(T, i % 2 ? 'triangle' : 'sawtooth', f, t), og = gn(T, i % 2 ? 0.3 : 0.18);
    lfo(T, rnd(0.05, 0.2), rnd(10, 22), o.detune, t);
    o.connect(og); og.connect(bp);
  });
  const tg = gn(T, 0);
  [7350, 7363].forEach((f) => { const o = osc(T, 'sine', f, t); o.connect(tg); });
  tg.connect(T.out);
  S.cg = cg; S.tg = tg; S.T = T;
}
function tensionTick() {
  if (!ac) return;
  try {
    const now = ac.currentTime;
    st.tS += (st.tension - st.tS) * 0.06;
    if (Math.abs(st.tS - st.tension) < 0.001) st.tS = st.tension;
    const x = st.tS;
    const cv = 0.9 * x * x;
    if (Math.abs(cv - st.lastCg) > 0.0015) { S.cg.gain.setTargetAtTime(cv, now, 0.15); st.lastCg = cv; }
    const w = x > 0.8 ? (x - 0.8) / 0.2 : 0;
    const tv = 0.018 * w * w;
    if (Math.abs(tv - st.lastTg) > 0.0005) { S.tg.gain.setTargetAtTime(tv, now, 0.25); st.lastTg = tv; }
    if (x > 0.1 && ac.state === 'running') {
      if (st.nextBeat < now) st.nextBeat = now + 0.05;
      if (st.nextBeat < now + 0.16) {
        const g = grp(S.inner, 0.12 + 0.8 * x);
        beat(g, st.nextBeat, 1, 1, x);
        finish(g, st.nextBeat, 0.75);
        st.nextBeat += 60 / (50 + 90 * x);
      }
    }
  } catch (e) { warn('tick', 'tension tick error: ' + (e && e.message)); }
}

// ---------------------------------------------------------------- graph build
function makeNoise() {
  const sr = ac.sampleRate;
  const mk = (sec, fill) => { const n = Math.floor(sr * sec), b = ac.createBuffer(1, n, sr); fill(b.getChannelData(0), n); return b; };
  const fix = (d, n) => { // seamless loop + DC removal + normalize
    const diff = d[n - 1] - d[0];
    let mean = 0, peak = 0;
    for (let i = 0; i < n; i++) { d[i] -= (diff * i) / (n - 1); mean += d[i]; }
    mean /= n;
    for (let i = 0; i < n; i++) { d[i] -= mean; const a = Math.abs(d[i]); if (a > peak) peak = a; }
    const k = peak > 0 ? 0.95 / peak : 1;
    for (let i = 0; i < n; i++) d[i] *= k;
  };
  NB.white = mk(3, (d, n) => { for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; });
  NB.pink = mk(6, (d, n) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    fix(d, n);
  });
  NB.brown = mk(6, (d, n) => {
    let l = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; }
    fix(d, n);
  });
}
function makeIR(sec) {
  const sr = ac.sampleRate, n = Math.floor(sr * sec), b = ac.createBuffer(2, n, sr), pre = Math.floor(sr * 0.018);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let y = 0;
    for (let i = pre; i < n; i++) {
      const x = (i - pre) / (n - pre);
      const e = Math.pow(1 - x, 2.2) * Math.exp(-x * 2.2);
      const a = 0.45 - 0.4 * x; // darker as it decays
      y += a * (Math.random() * 2 - 1 - y);
      d[i] = y * e;
    }
    for (let k = 0; k < 6; k++) { const i = pre + Math.floor(sr * rnd(0.005, 0.07)); if (i < n) d[i] += rnd(-0.5, 0.5); }
  }
  return b;
}
function build() {
  makeNoise();
  S.master = ac.createGain();
  S.master.gain.value = st.vol;
  S.master.connect(ac.destination);
  S.comp = ac.createDynamicsCompressor();
  S.comp.threshold.value = -16; S.comp.knee.value = 10; S.comp.ratio.value = 5; S.comp.attack.value = 0.004; S.comp.release.value = 0.3;
  S.comp.connect(S.master);
  S.mg = ac.createGain(); S.mg.connect(S.comp);
  S.muffle = ac.createBiquadFilter(); S.muffle.type = 'lowpass'; S.muffle.frequency.value = 20000; S.muffle.Q.value = 0.707;
  S.muffle.connect(S.mg);
  S.sfx = ac.createGain(); S.sfx.connect(S.muffle);
  S.duck = ac.createGain(); S.duck.gain.value = 0.9; S.duck.connect(S.muffle);
  S.inner = ac.createGain(); S.inner.connect(S.comp);
  S.revIn = ac.createGain();
  S.rev = ac.createConvolver();
  S.rev.buffer = makeIR(3);
  S.revOut = ac.createGain(); S.revOut.gain.value = 0.6;
  S.revIn.connect(S.rev); S.rev.connect(S.revOut); S.revOut.connect(S.muffle);
  buildTension();
  applyMuffle();
  st.ticker = setInterval(tensionTick, 60);
}
function applyMuffle() {
  if (!ok()) return;
  const m = st.muffle, t = ac.currentTime;
  S.muffle.frequency.setTargetAtTime(20000 * Math.pow(350 / 20000, m), t, 0.08);
  S.mg.gain.setTargetAtTime(1 - 0.3 * m, t, 0.08);
}
function duck() {
  const p = S.duck.gain, t = ac.currentTime;
  hold(p, t);
  p.linearRampToValueAtTime(0.15, t + 0.04);
  p.setTargetAtTime(0.9, t + 0.9, 0.9);
}

// ---------------------------------------------------------------- play / loop / ambience internals
function playInternal(name, opts, dest) {
  const fn = SFX[name];
  if (!fn) { warn('sfx:' + name, 'unknown sound "' + name + '"'); return null; }
  const o = opts && typeof opts === 'object' ? opts : {};
  const p = clamp(num(o.pitch, 1), 0.25, 4);
  const hasPos = !!(o.position && typeof o.position.x === 'number');
  const d = dest || (!hasPos && INNER.has(name) ? S.inner : S.sfx);
  const rev = typeof o._rev === 'number' ? o._rev : REV[name] != null ? REV[name] : 0.15;
  const g = voice(o, rev, d, name);
  const t = ac.currentTime + 0.01;
  let dur = 1;
  try { dur = fn(g, t, p, o) || 1; } catch (e) { warn('sfxerr:' + name, 'sound "' + name + '" failed: ' + (e && e.message)); dispose(g); return null; }
  finish(g, t, dur);
  if (name === 'stinger') duck();
  return g;
}
const DUMMY = { setPosition() {}, setVolume() {}, stop() {} };
function loopInternal(name, opts) {
  const b = LOOPS[name];
  if (!b) { warn('loop:' + name, 'unknown loop "' + name + '"'); return DUMMY; }
  const o = opts && typeof opts === 'object' ? opts : {};
  const L = grp(null, 0);
  route(L, o, LOOP_REV[name] != null ? LOOP_REV[name] : 0.2, S.sfx);
  try { b(L, clamp(num(o.pitch, 1), 0.25, 4), o); } catch (e) { warn('looperr:' + name, 'loop "' + name + '" failed: ' + (e && e.message)); dispose(L); return DUMMY; }
  const t = ac.currentTime;
  const vol = clamp(num(o.volume, 1), 0, 4);
  L.out.gain.setValueAtTime(0, t);
  L.out.gain.linearRampToValueAtTime(vol, t + 0.4);
  let stopped = false, lastRev = -1;
  return {
    setPosition(v) {
      try {
        if (stopped || !v || typeof v.x !== 'number' || !ac) return;
        if (!L.pan && L.tail && L.dest) { // lazily make it positional
          L.tail.disconnect(L.dest);
          const pn = mkPanner(L, v);
          L.tail.connect(pn); pn.connect(L.dest); L.tail = pn;
        }
        setPos(L.pan, v);
        if (L.send) {
          const r = L.rev * distRev(v);
          if (Math.abs(r - lastRev) > 0.02) { L.send.gain.setTargetAtTime(r, ac.currentTime, 0.1); lastRev = r; }
        }
      } catch (e) { warn('lpos', 'loop setPosition failed: ' + (e && e.message)); }
    },
    setVolume(v) {
      try {
        if (stopped || !ac) return;
        const p = L.out.gain, now = ac.currentTime;
        hold(p, now);
        p.setTargetAtTime(clamp(num(v, 1), 0, 4), now, 0.08);
      } catch (e) { /* ignore */ }
    },
    stop(fadeSec) {
      if (stopped) return;
      stopped = true;
      try { kill(L, clamp(num(fadeSec, 0.3), 0.01, 30)); } catch (e) { /* ignore */ }
    },
  };
}
function ambienceInternal(name) {
  if (name === st.ambName) return;
  const builder = AMB[name];
  if (!builder && name !== 'silence' && name != null) { warn('amb:' + name, 'unknown ambience "' + name + '"'); return; }
  if (st.amb) kill(st.amb, 2.5);
  st.amb = null;
  st.ambName = name;
  if (!builder) return;
  const A = grp(S.duck, 0);
  A.wet = gn(A, 0);
  A.wet.connect(S.revIn);
  A.fades = [A.out, A.wet];
  try { builder(A); } catch (e) { warn('amberr:' + name, 'ambience "' + name + '" failed: ' + (e && e.message)); }
  const t = ac.currentTime;
  A.out.gain.setValueAtTime(0, t);
  A.out.gain.linearRampToValueAtTime(1, t + 2.5);
  A.wet.gain.setValueAtTime(0, t);
  A.wet.gain.linearRampToValueAtTime(1, t + 2.5);
  st.amb = A;
}
function speakInternal(sec) {
  const D = clamp(num(sec, 2), 0.3, 40);
  const g = grp(S.inner, 1);
  const t = ac.currentTime + 0.01;
  squelch(g, t, 1, 0.6);
  const n = nz(g, 'white', t, 1), hp = flt(g, 'highpass', 500, 0.7), bp = flt(g, 'bandpass', 1900, 0.9), e = gn(g, 0);
  chain(n, hp, bp, e, g.out);
  let tt = t + 0.12;
  e.gain.setValueAtTime(0, t);
  while (tt < t + D) { e.gain.setValueAtTime(rnd(0.08, 0.2), tt); tt += rnd(0.03, 0.12); }
  e.gain.setValueAtTime(0, t + D);
  // faint garbled carrier under the static (reads as distant voice)
  const lp = flt(g, 'lowpass', 3000, 0.7), vg = gn(g, 0.35);
  lp.connect(vg); vg.connect(g.out);
  const fz = formantNoise(g, t, 1, 6, lp);
  let st2 = t + 0.15;
  while (st2 < t + D - 0.2) st2 = syllables(fz.e, fz.fs, st2, rnd(0.85, 1.1), 1, 0.5);
  squelch(g, t + D, 0.85, 0.5);
  finish(g, t, D + 0.45);
  return { stop(f) { try { kill(g, num(f, 0.1)); } catch (e2) { /* ignore */ } } };
}

// ---------------------------------------------------------------- public API
export const audio = {
  init() {
    try {
      if (!ac) {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) { warn('noac', 'Web Audio not supported'); return; }
        try { ac = new AC({ latencyHint: 'interactive' }); } catch (e) { ac = new AC(); }
        try { build(); } catch (e) { warn('build', 'audio graph build failed: ' + (e && e.message)); try { ac.close(); } catch (e2) { /* ignore */ } ac = null; for (const k in S) delete S[k]; return; }
        const resume = () => { if (ac && ac.state !== 'running' && ac.state !== 'closed') ac.resume().catch(() => {}); };
        ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, resume, { capture: true, passive: true }));
        if (st.pending != null) { const p = st.pending; st.pending = null; ambienceInternal(p); }
      }
      if (ac.state !== 'running' && ac.state !== 'closed') ac.resume().catch(() => {});
    } catch (e) { warn('init', 'audio init failed: ' + (e && e.message)); }
  },
  setListener(pos, forward) {
    if (!ok()) return;
    try {
      const L = ac.listener;
      if (pos) {
        const x = num(pos.x, lis.x), y = num(pos.y, lis.y), z = num(pos.z, lis.z);
        lis.x = x; lis.y = y; lis.z = z;
        if (L.positionX) { L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z; } else L.setPosition(x, y, z);
      }
      if (forward) {
        let fx = num(forward.x, 0), fy = num(forward.y, 0), fz = num(forward.z, -1);
        const h = Math.sqrt(fx * fx + fz * fz);
        if (h < 0.05) return; // straight up/down: keep last orientation
        const len = Math.sqrt(fx * fx + fy * fy + fz * fz);
        fx /= len; fy /= len; fz /= len;
        if (L.forwardX) {
          L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
          L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
        } else L.setOrientation(fx, fy, fz, 0, 1, 0);
      }
    } catch (e) { warn('listener', 'setListener failed: ' + (e && e.message)); }
  },
  setMasterVolume(v) {
    try {
      let x = num(v, st.vol);
      if (x > 1.001) x /= 100; // tolerate 0-100 sliders
      st.vol = clamp(x, 0, 1);
      if (ok()) S.master.gain.setTargetAtTime(st.vol, ac.currentTime, 0.05);
    } catch (e) { /* ignore */ }
  },
  ambience(name) {
    try {
      if (!ok()) { st.pending = name; return; }
      ambienceInternal(name);
    } catch (e) { warn('ambience', 'ambience failed: ' + (e && e.message)); }
  },
  play(name, opts) {
    if (!ok()) return null;
    try {
      const g = playInternal(name, opts, null);
      return g ? { stop(f) { try { kill(g, num(f, 0.05)); } catch (e) { /* ignore */ } } } : null;
    } catch (e) { warn('play:' + name, 'play failed: ' + (e && e.message)); return null; }
  },
  loop(name, opts) {
    if (!ok()) return DUMMY;
    try { return loopInternal(name, opts); } catch (e) { warn('loopx:' + name, 'loop failed: ' + (e && e.message)); return DUMMY; }
  },
  setTension(v) { st.tension = clamp(num(v, 0), 0, 1); },
  setMuffle(v) {
    st.muffle = clamp(num(v, 0), 0, 1);
    try { applyMuffle(); } catch (e) { /* ignore */ }
  },
  stinger() {
    if (!ok()) return;
    try { playInternal('stinger', null, null); } catch (e) { warn('stinger', 'stinger failed: ' + (e && e.message)); }
  },
  speak(seconds) {
    if (!ok()) return DUMMY;
    try { return speakInternal(seconds); } catch (e) { warn('speak', 'speak failed: ' + (e && e.message)); return DUMMY; }
  },
};
export default audio;
