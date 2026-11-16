// STARLESS — main.js (GAME): boot, game flow, ctx, net sync, down/revive, save. The glue.
// Every other module is loaded with dynamic import() so one broken file shows an error instead of a dead page.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Interactables } from './engine/interact.js';
import * as store from './engine/save.js';

// ------------------------------------------------------------------ params / constants
const params = new URLSearchParams(location.search);
const NUM_LEVELS = (CONFIG.levels && CONFIG.levels.length) || 3;
const PARAM_LEVEL = (() => {
  const n = parseInt(params.get('level'), 10);
  return Number.isFinite(n) && n >= 1 && n <= NUM_LEVELS ? n - 1 : -1;
})();
const NOCUT = params.has('nocut');
const TEST_MODE = params.has('test'); // automation: drag-look, never request pointer lock, never auto-pause on unlock
const LEVEL_TITLES = ['CHAPTER I', 'CHAPTER II', 'CHAPTER III'];
const LEVEL_SUBTITLES = ['THE DROWNING WORLD', 'THE HOLLOW ARK', 'THE DARK BETWEEN'];
const CUT_MAX_MS = 6 * 60 * 1000;
const PLAYER_HZ = (CONFIG.netRates && CONFIG.netRates.player) || 15;
const LEVEL_HZ = (CONFIG.netRates && CONFIG.netRates.level) || 10;

// ------------------------------------------------------------------ module handles (filled at boot)
let createRenderer = null, input = null, World = null, LocalPlayer = null, RemotePlayer = null;
let createFX = null, audio = null, Net = null, ui = null;

// ------------------------------------------------------------------ error reporting
const errorCounts = new Map();
let notifyBudget = 14;
function errMsg(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  return err.message || String(err);
}
function reportError(where, err) {
  const msg = errMsg(err);
  const key = where + '|' + msg;
  const n = (errorCounts.get(key) || 0) + 1;
  errorCounts.set(key, n);
  if (n <= 3) console.error('[STARLESS] ' + where + ':', err);
  if (n === 1 && notifyBudget > 0) {
    notifyBudget--;
    try { ui && ui.notify && ui.notify(('⚠ ' + where + ': ' + msg).slice(0, 180), 6); } catch (_) { /* ignore */ }
  }
}
function safe(where, fn) {
  try { return fn(); } catch (e) { reportError(where, e); return undefined; }
}
function bootFail(msg) {
  console.error('[STARLESS] boot failed:\n' + msg);
  const b = document.getElementById('boot');
  if (!b) return;
  b.classList.remove('gone');
  b.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'err';
  d.textContent = 'Boot error:\n' + msg;
  b.appendChild(d);
}

// ------------------------------------------------------------------ stubs for optional modules
const noop = () => {};
const loopStub = { setPosition: noop, setVolume: noop, stop: noop };
function makeStub(base) {
  return new Proxy(base || {}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'then' || typeof k === 'symbol') return undefined;
      return noop;
    },
  });
}
const soloNet = {
  isHost: true, localId: 'solo', peers: new Map(),
  send: noop, broadcast: noop, sendTo: noop, on: noop, onPeerJoin: noop, onPeerLeave: noop,
  ping: () => 0, close: noop, host: async () => '', join: async () => { throw new Error('offline'); },
};

// ------------------------------------------------------------------ helpers
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(label || 'timed out')), ms);
    Promise.resolve(p).then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
  });
}
function clampLevel(i) {
  i = Math.floor(+i || 0);
  return Math.max(0, Math.min(NUM_LEVELS - 1, i));
}
function toV3(p) {
  if (!p) return new THREE.Vector3();
  if (p.isVector3) return p.clone();
  if (Array.isArray(p)) return new THREE.Vector3(+p[0] || 0, +p[1] || 0, +p[2] || 0);
  return new THREE.Vector3(+p.x || 0, +p.y || 0, +p.z || 0);
}
function arr3(v) {
  if (!v) return null;
  if (Array.isArray(v)) return [+v[0] || 0, +v[1] || 0, +v[2] || 0];
  return [+v.x || 0, +v.y || 0, +v.z || 0];
}
const r2 = (x) => Math.round((+x || 0) * 100) / 100;
const r3 = (x) => Math.round((+x || 0) * 1000) / 1000;
function cleanText(s, max) { return String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, max || 160); }
function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}
function notify(text, secs) { safe('ui.notify', () => ui.notify && ui.notify(text, secs || 3)); }
function safeFade(toBlack, secs) {
  try {
    const p = ui.fade && ui.fade(toBlack, secs);
    return withTimeout(Promise.resolve(p), (secs || 1) * 1000 + 1500, 'fade').catch(() => {});
  } catch (e) { reportError('ui.fade', e); return Promise.resolve(); }
}

// ------------------------------------------------------------------ game state
let R = null, scene = null, camera = null, world = null, fx = null, interact = null, ctx = null;
let settings = {};
let state = 'boot'; // boot | menu | lobby | cutscene | loading | playing | paused | gameover | credits
let flow = 0;       // incremented whenever the game flow changes; stale async flows bail out
let net = null;     // real Net instance in multiplayer
let mp = false;
let roster = [];    // [{id,name,callsign,color,colorCss,slot,isHost}]
let lobbyCode = '';
let hostId = null;
let busy = false;
let level = null, levelReady = false, levelIndex = -1, levelSeed = 0;
let lastSave = null; // {levelIndex, levelSave} for retry
let localPlayer = null, localState = null;
const remotes = new Map();
const updates = new Set();
const hookErrors = new Map();
let backdrop = null;
let currentCut = null, cutSkip = null, pendingSkip = false;
let completing = false, overSent = false, overPending = 0;
let chatOpen = false, chatOpenedAt = 0;
let spaceAt = 0;
let pausedAt = 0, lockLostAt = 0;
let audioReady = false, curAmbience = null;
const netT = { p: 0, l: 0, ui: 0 };
const prevDowned = new Map();
const reviveProxies = new Map();
const reviveGrace = new Map(); // HOST: id -> ms until which a client's stale 'pst' may not re-down them after a revive
let lastLockReq = -1e9;
let pendingEvents = [];
let persistent = new Set(), camPersistent = new Set();
let initialEnv = null, initialPost = null, initialExposure = 1;
let creditsTimer = 0;
let lockHintShown = null;
let fallbackHint = null;
let zoneSeq = 0;
let skipShown = 0;
const _lp = new THREE.Vector3(), _lf = new THREE.Vector3();

function setState(s) {
  state = s;
  if (ctx) ctx.gameState = s;
}

// ------------------------------------------------------------------ players
function slotInfo(slot) {
  return {
    callsign: (CONFIG.callsigns && CONFIG.callsigns[slot]) || ('CREW ' + (slot + 1)),
    color: (CONFIG.colors && CONFIG.colors[slot] != null) ? CONFIG.colors[slot] : 0xffffff,
    colorCss: (CONFIG.colorsCss && CONFIG.colorsCss[slot]) || '#ffffff',
  };
}
function makeState(id, info, isLocal) {
  info = info || {};
  return {
    id, name: info.name || info.callsign || 'CREW', callsign: info.callsign || 'CREW',
    color: info.color != null ? info.color : 0xffffff, colorCss: info.colorCss || '#ffffff',
    slot: info.slot | 0, isLocal: !!isLocal, isHost: !!info.isHost,
    position: new THREE.Vector3(), yaw: 0, pitch: 0, flashlight: false,
    health: 100, oxygen: 100, battery: 100, stamina: 100, downed: false, noise: 0, crouching: false,
  };
}
function resetVitals(s) {
  s.health = 100; s.oxygen = 100; s.battery = 100; s.stamina = 100;
  s.downed = false; s.noise = 0; s.crouching = false;
}
function myName() {
  const n = settings && (settings.name || settings.playerName || settings.nickname);
  return cleanText(n || '', 16);
}
function payloadName(p) {
  const n = p && typeof p === 'object' ? (p.name || p.playerName) : null;
  return cleanText(n || myName() || '', 16);
}
function setupLocal(id, name) {
  ctx.localId = String(id);
  localState = makeState(ctx.localId, Object.assign({ name: name || '' }, slotInfo(0)), true);
  if (!localState.name) localState.name = localState.callsign;
  ctx.players.clear();
  ctx.players.set(ctx.localId, localState);
  prevDowned.clear();
}
function rosterEntry(id) { return roster.find((r) => r.id === id) || null; }
function freeSlot() {
  for (let i = 0; i < (CONFIG.maxPlayers || 4); i++) if (!roster.some((r) => r.slot === i)) return i;
  return -1;
}
function spawnRemote(s) {
  if (!RemotePlayer || remotes.has(s.id) || s.id === ctx.localId) return;
  try {
    const rp = new RemotePlayer(ctx, s);
    remotes.set(s.id, rp);
    try { rp.setNetState && rp.setNetState(s); } catch (e) { reportError('RemotePlayer.setNetState', e); }
  } catch (e) { reportError('RemotePlayer', e); }
}
function removePlayer(id) {
  const rp = remotes.get(id);
  if (rp) { safe('RemotePlayer.dispose', () => rp.dispose && rp.dispose()); remotes.delete(id); }
  if (id !== ctx.localId) ctx.players.delete(id);
  prevDowned.delete(id);
  reviveGrace.delete(id);
  removeRevive(id);
}
function syncPlayersFromRoster() {
  for (const r of roster) {
    let s = ctx.players.get(r.id);
    if (!s) {
      s = r.id === ctx.localId ? localState : makeState(r.id, r, false);
      ctx.players.set(r.id, s);
    }
    s.name = r.name || r.callsign; s.callsign = r.callsign; s.color = r.color; s.colorCss = r.colorCss;
    s.slot = r.slot | 0; s.isHost = !!r.isHost;
    if (r.id !== ctx.localId && levelReady) spawnRemote(s);
  }
  for (const id of Array.from(ctx.players.keys())) {
    if (id === ctx.localId) continue;
    if (!roster.some((r) => r.id === id)) removePlayer(id);
  }
}

// ------------------------------------------------------------------ net helpers
function send(msg) { if (mp && net) { try { net.send(msg); } catch (e) { reportError('net.send', e); } } }
function broadcast(msg, exceptId) { if (mp && net) { try { net.broadcast(msg, exceptId); } catch (e) { reportError('net.broadcast', e); } } }
function sendTo(id, msg) { if (mp && net) { try { net.sendTo(id, msg); } catch (e) { reportError('net.sendTo', e); } } }

function packState(s) {
  return [s.id, r2(s.position.x), r2(s.position.y), r2(s.position.z), r3(s.yaw), r3(s.pitch),
    s.flashlight ? 1 : 0, Math.round(+s.health || 0), Math.round(+s.oxygen || 0), Math.round(+s.battery || 0),
    Math.round(+s.stamina || 0), s.downed ? 1 : 0, r2(s.noise), s.crouching ? 1 : 0];
}
function unpackInto(s, a) {
  s.position.set(+a[1] || 0, +a[2] || 0, +a[3] || 0);
  s.yaw = +a[4] || 0; s.pitch = +a[5] || 0; s.flashlight = !!a[6];
  s.health = +a[7] || 0; s.oxygen = +a[8] || 0; s.battery = +a[9] || 0; s.stamina = +a[10] || 0;
  s.downed = !!a[11]; s.noise = +a[12] || 0; s.crouching = !!a[13];
}

function newNet() {
  const n = new Net();
  const on = (t, fn) => {
    try {
      n.on(t, (m, from) => {
        if (n !== net) return;
        try { fn(m || {}, from); } catch (e) { reportError('net "' + t + '"', e); }
      });
    } catch (e) { reportError('net.on', e); }
  };
  // ---- host-side
  on('pst', (m, from) => {
    if (!ctx.isHost || !Array.isArray(m.s)) return;
    const s = ctx.players.get(from);
    if (!s || s.isLocal) return;
    const prevHealth = s.health;
    unpackInto(s, m.s);
    const until = reviveGrace.get(from);
    if (until !== undefined) {
      // A 'pst' sent before the client handled our 'revive' still says downed: don't re-down them.
      if (!s.downed || performance.now() > until) reviveGrace.delete(from);
      else { s.downed = false; s.health = Math.max(+s.health || 0, +prevHealth || 0); }
    }
    const rp = remotes.get(from);
    if (rp && rp.setNetState) rp.setNetState(s);
  });
  on('interact', (m, from) => {
    if (!ctx.isHost || m.id == null) return;
    if (m.li != null && m.li !== levelIndex) return;
    if (!levelReady) return;
    const id = String(m.id);
    if (id.indexOf('revive:') === 0) hostRevive(id.slice(7), from);
    else interact.trigger(id, from);
  });
  on('noise', (m) => { if (ctx.isHost && Array.isArray(m.p)) hostNoise(toV3(m.p), +m.l || 0.5); });
  // ---- both directions
  on('ev', (m, from) => {
    if (m.li != null && m.li !== levelIndex) return;
    if (ctx.isHost) {
      if (!levelReady) return;
      dispatchLevelEvent(m.type, m.data, from);
      broadcast({ t: 'ev', type: m.type, data: m.data, from, li: levelIndex });
    } else {
      if (!levelReady) { if (pendingEvents.length < 200) pendingEvents.push(m); return; }
      dispatchLevelEvent(m.type, m.data, m.from);
    }
  });
  on('chat', (m, from) => {
    const name = cleanText(m.name, 24) || 'CREW';
    const text = cleanText(m.text, 200);
    if (!text) return;
    safe('ui.chatMessage', () => ui.chatMessage && ui.chatMessage(name, text));
    if (ctx.isHost) broadcast({ t: 'chat', name, text }, from);
  });
  // ---- client-side
  on('lobby', (m, from) => {
    if (ctx.isHost) return;
    if (from && !hostId) hostId = from;
    if (Array.isArray(m.players)) roster = m.players.map((p) => ({
      id: String(p.id), name: cleanText(p.name, 16), callsign: p.callsign, color: p.color, colorCss: p.colorCss,
      slot: p.slot | 0, isHost: !!p.isHost,
    }));
    const hostEntry = roster.find((r) => r.isHost);
    if (hostEntry) hostId = hostEntry.id;
    if (m.code) lobbyCode = String(m.code);
    if (ctx.localId && localState) syncPlayersFromRoster();
    if (state === 'lobby') refreshLobbyUI();
  });
  on('start', (m) => {
    if (ctx.isHost) return;
    startGame(clampLevel(m.levelIndex), (+m.seed) >>> 0, m.save == null ? null : m.save, { noCut: !!m.late });
  });
  on('pall', (m) => {
    if (ctx.isHost || !Array.isArray(m.ps)) return;
    for (const a of m.ps) {
      if (!Array.isArray(a)) continue;
      const id = String(a[0]);
      if (id === ctx.localId) continue;
      let s = ctx.players.get(id);
      if (!s) {
        const r = rosterEntry(id);
        if (!r) continue;
        s = makeState(id, r, false);
        ctx.players.set(id, s);
        if (levelReady) spawnRemote(s);
      }
      unpackInto(s, a);
      const rp = remotes.get(id);
      if (rp && rp.setNetState) rp.setNetState(s);
    }
  });
  on('ls', (m) => {
    if (ctx.isHost || !levelReady || !level || m.li !== levelIndex) return;
    try { level.applyState && level.applyState(m.s); } catch (e) { reportError('level.applyState', e); }
  });
  on('dmg', (m) => {
    if (ctx.isHost || (m.id != null && String(m.id) !== ctx.localId)) return;
    if (localPlayer && localPlayer.applyDamage) localPlayer.applyDamage(+m.amount || 0, m.src ? toV3(m.src) : undefined);
  });
  on('give', (m) => {
    if (ctx.isHost || (m.id != null && String(m.id) !== ctx.localId)) return;
    if (localPlayer && localPlayer.give) localPlayer.give({ health: +m.health || 0, oxygen: +m.oxygen || 0, battery: +m.battery || 0 });
  });
  on('revive', (m) => { if (!ctx.isHost) applyRevive(String(m.id), m.by != null ? String(m.by) : null); });
  on('skip', () => {
    if (ctx.isHost) return;
    // Only remember a skip that arrives while we are heading into / inside a cutscene; a late one
    // must not silently skip the NEXT chapter's cutscene.
    if (cutSkip) cutSkip(); else if (state === 'cutscene') pendingSkip = true;
  });
  on('next', (m) => { if (!ctx.isHost) handleNext(+m.levelIndex | 0, (+m.seed) >>> 0); });
  on('over', () => { if (!ctx.isHost) showGameOver(); });
  on('retry', (m) => { if (!ctx.isHost) doRetry(clampLevel(m.levelIndex), (+m.seed) >>> 0, m.save == null ? null : m.save); });
  on('reject', (m) => {
    if (ctx.isHost) return;
    const reason = cleanText(m.reason, 80) || 'The host turned you away.';
    closeNet();
    goMenu(reason);
  });

  try {
    n.onPeerJoin((id, name) => { if (n === net) safe('peer join', () => onPeerJoin(String(id), name)); });
    n.onPeerLeave((id) => { if (n === net) safe('peer leave', () => onPeerLeave(String(id))); });
    if (typeof n.onError === 'function') n.onError((msg) => { if (n === net && msg) notify(cleanText(msg, 140), 4); });
  } catch (e) { reportError('net peer hooks', e); }
  return n;
}

function closeNet() {
  const n = net;
  net = null;
  mp = false;
  roster = [];
  hostId = null;
  lobbyCode = '';
  if (ctx) ctx.net = soloNet;
  if (n) { try { n.close(); } catch (e) { /* ignore */ } }
}

function rosterForWire() {
  return roster.map((r) => ({ id: r.id, name: r.name, callsign: r.callsign, color: r.color, colorCss: r.colorCss, slot: r.slot, isHost: !!r.isHost }));
}
function broadcastLobby() {
  if (!ctx.isHost || !mp) return;
  broadcast({ t: 'lobby', code: lobbyCode, players: rosterForWire(), status: '' });
}

function onPeerJoin(id, name) {
  if (!ctx.isHost) return;
  if (rosterEntry(id)) return;
  const slot = freeSlot();
  if (slot < 0) { sendTo(id, { t: 'reject', reason: 'The crew is full (4/4).' }); return; }
  const entry = Object.assign({ id, name: cleanText(name, 16), slot, isHost: false }, slotInfo(slot));
  if (!entry.name) entry.name = entry.callsign;
  roster.push(entry);
  roster.sort((a, b) => a.slot - b.slot);
  syncPlayersFromRoster();
  broadcastLobby();
  refreshLobbyUI();
  notify(entry.callsign + ' joined the crew', 3);
  safe('audio', () => audio.play('beep', { volume: 0.6 }));
  // Late join: drop them straight into the current chapter.
  if (state === 'playing' || state === 'paused' || state === 'gameover' || state === 'loading' || state === 'cutscene') {
    if (levelIndex >= 0) {
      const save = lastSave && lastSave.levelIndex === levelIndex ? lastSave.levelSave : null;
      sendTo(id, { t: 'start', levelIndex, seed: levelSeed, save, late: true });
    }
  }
}

function onPeerLeave(id) {
  if (ctx.isHost) {
    const r = rosterEntry(id);
    if (!r) return;
    roster = roster.filter((x) => x.id !== id);
    removePlayer(id);
    broadcastLobby();
    refreshLobbyUI();
    notify(r.callsign + ' lost signal', 3);
  } else {
    hostLeft(); // net.js only reports the host to clients
  }
}

function hostLeft() {
  if (!mp) return;
  closeNet();
  goMenu('The host closed the channel.');
}

// ------------------------------------------------------------------ lobby / menu
function refreshLobbyUI(status) {
  if (state !== 'lobby' || !ui) return;
  const save = ctx.isHost ? store.load() : null;
  const st = status || (ctx.isHost
    ? (roster.length + '/' + (CONFIG.maxPlayers || 4) + ' crew aboard — share the code')
    : 'Connected. Waiting for the host to launch…');
  safe('ui.setLobby', () => ui.setLobby({
    code: lobbyCode,
    players: roster.map((r) => ({ id: r.id, name: r.name, callsign: r.callsign, color: r.colorCss, colorHex: r.color, isHost: !!r.isHost, isLocal: r.id === ctx.localId })),
    isHost: !!ctx.isHost,
    unlocked: store.getUnlocked(),
    canContinue: !!save,
    hasSave: !!save,
    saveLevelIndex: save ? save.levelIndex : undefined,
    save: save ? { levelIndex: save.levelIndex } : null,
    status: st,
  }));
}

function disposeBackdrop() {
  if (!backdrop) return;
  const b = backdrop;
  backdrop = null;
  safe('menu backdrop dispose', () => b.dispose && b.dispose());
}

async function ensureBackdrop(my) {
  if (backdrop) return;
  const mod = await getCutscenes();
  if (my !== flow || backdrop || (state !== 'menu' && state !== 'lobby')) return;
  if (mod && typeof mod.buildMenuBackdrop === 'function') {
    backdrop = safe('menu backdrop', () => mod.buildMenuBackdrop(ctx)) || null;
  }
}

// Hide the interact prompt through interact.js so its cached text is dropped (else it never re-shows
// after a solo pause while looking at the same object).
function hidePrompt() {
  if (interact && typeof interact.hidePrompt === 'function') safe('interact.hidePrompt', () => interact.hidePrompt());
  else safe('ui.setPrompt', () => ui.setPrompt && ui.setPrompt(null, 0));
}

function resetHud() {
  hidePrompt();
  safe('ui', () => {
    ui.setDowned && ui.setDowned(false);
    ui.skipHint && ui.skipHint(false);
    ui.letterbox && ui.letterbox(false);
  });
  showLockHint(false);
}

function goMenu(note) {
  const my = ++flow;
  closeNet();
  disposeBackdrop();
  teardownWorld();
  ctx.isHost = true;
  setupLocal('solo', myName());
  setState('menu');
  ctx.paused = false;
  forceCloseChat();
  safe('input', () => { input.enabled = true; });
  unlockPointer();
  resetHud();
  safe('ui.showScreen', () => ui.showScreen('menu', {
    canContinue: !!store.load(), unlocked: store.getUnlocked(), version: CONFIG.version, title: CONFIG.title, tagline: CONFIG.tagline,
  }));
  safeFade(false, 0.6);
  setAmbience('menu');
  if (note) notify(note, 5);
  ensureBackdrop(my);
}

function goLobby(status) {
  const my = ++flow;
  if (state !== 'menu' && state !== 'lobby') { teardownWorld(); disposeBackdrop(); }
  setState('lobby');
  ctx.paused = false;
  unlockPointer();
  resetHud();
  safe('ui.showScreen', () => ui.showScreen('lobby'));
  refreshLobbyUI(status);
  setAmbience('menu');
  ensureBackdrop(my);
}

function leaveToMenu() {
  goMenu(); // closeNet() inside -> net.close() tells peers goodbye
}

// ------------------------------------------------------------------ session start
function startSolo(opts) {
  opts = opts || {};
  if (busy) return;
  closeNet();
  ctx.isHost = true;
  setupLocal('solo', myName());
  roster = [Object.assign({ id: 'solo', name: localState.name, slot: 0, isHost: true }, slotInfo(0))];
  syncPlayersFromRoster();
  let li = clampLevel(opts.levelIndex || 0);
  let save = null;
  if (opts.continue) {
    const s = store.load();
    if (s) { li = clampLevel(s.levelIndex); save = s.levelSave; } else li = 0;
  }
  startGame(li, (Math.random() * 2147483647) >>> 0, save, { noCut: !!opts.noCut });
}

async function hostGame(payload) {
  if (busy) return;
  if (!Net) { notify('Multiplayer is unavailable (net module failed to load).', 5); return; }
  busy = true;
  const name = payloadName(payload);
  safe('ui.showLoading', () => ui.showLoading('OPENING A CHANNEL…', 0.3));
  try {
    closeNet();
    net = newNet();
    const code = await withTimeout(net.host(name), 20000, 'Timed out opening a channel');
    mp = true;
    ctx.isHost = true;
    ctx.net = net;
    lobbyCode = String(code || net.code || '');
    setupLocal(net.localId || ('host-' + lobbyCode), name);
    hostId = ctx.localId;
    roster = [Object.assign({ id: ctx.localId, name: localState.name, slot: 0, isHost: true }, slotInfo(0))];
    syncPlayersFromRoster();
    busy = false;
    goLobby();
  } catch (e) {
    busy = false;
    console.error(e);
    closeNet();
    goMenu('Could not open a channel: ' + errMsg(e));
  }
}

async function joinGame(payload) {
  if (busy) return;
  if (!Net) { notify('Multiplayer is unavailable (net module failed to load).', 5); return; }
  const code = cleanText(typeof payload === 'string' ? payload : (payload && payload.code) || '', 64);
  if (!code) { notify('Enter a crew code first.', 3); return; }
  busy = true;
  const name = payloadName(payload);
  safe('ui.showLoading', () => ui.showLoading('HAILING ' + code.toUpperCase() + '…', 0.3));
  try {
    closeNet();
    net = newNet();
    roster = [];
    ctx.isHost = false;
    await withTimeout(net.join(code, name), 20000, 'No answer on that code');
    mp = true;
    ctx.isHost = false;
    ctx.net = net;
    lobbyCode = code;
    const rosterBefore = roster;
    setupLocal(net.localId || ('client-' + Math.random().toString(36).slice(2, 8)), name);
    roster = rosterBefore;
    syncPlayersFromRoster();
    busy = false;
    if (state === 'menu' || state === 'lobby') goLobby();
  } catch (e) {
    busy = false;
    console.error(e);
    closeNet();
    goMenu('Could not join: ' + errMsg(e));
  }
}

function hostStart(payload) {
  if (!ctx.isHost) return;
  if (state !== 'lobby' && state !== 'menu') return;
  if (!mp) { startSolo(payload || {}); return; }
  let li = clampLevel(payload && payload.levelIndex != null ? payload.levelIndex : 0);
  let save = null;
  if (payload && (payload.continue || payload.useSave)) {
    const s = store.load();
    if (s) { li = clampLevel(s.levelIndex); save = s.levelSave; }
  }
  const seed = (Math.random() * 2147483647) >>> 0;
  broadcast({ t: 'start', levelIndex: li, seed, save });
  startGame(li, seed, save, {});
}

async function startGame(li, seed, save, opts) {
  opts = opts || {};
  const my = ++flow;
  levelSeed = seed >>> 0;
  if (li === 0 && save == null && !NOCUT && !opts.noCut) {
    await playCut('intro', my);
    if (my !== flow) return;
  }
  await loadLevel(li, save, levelSeed, my);
}

// ------------------------------------------------------------------ scene management
function disposeMaterial(m) {
  if (!m) return;
  try {
    for (const k in m) {
      const v = m[k];
      if (v && v.isTexture) { try { v.dispose(); } catch (e) { /* ignore */ } }
    }
    if (m.uniforms) {
      for (const k in m.uniforms) {
        const u = m.uniforms[k];
        if (u && u.value && u.value.isTexture) { try { u.value.dispose(); } catch (e) { /* ignore */ } }
      }
    }
    m.dispose();
  } catch (e) { /* ignore */ }
}
function disposeTree(root) {
  try {
    root.traverse((o) => {
      if (o.geometry && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) { /* ignore */ } }
      const m = o.material;
      if (m) { if (Array.isArray(m)) m.forEach(disposeMaterial); else disposeMaterial(m); }
      if (o.isLight && o.shadow && o.shadow.map) { try { o.shadow.map.dispose(); o.shadow.map = null; } catch (e) { /* ignore */ } }
      if (o.isInstancedMesh && o.dispose) { try { o.dispose(); } catch (e) { /* ignore */ } }
    });
  } catch (e) { /* ignore */ }
}
function isKept(o) { return persistent.has(o) || !!(o.userData && (o.userData.persistent || o.userData.keep)); }

function clearScene() {
  if (!scene) return;
  try {
    if (camera.parent && camera.parent !== scene) scene.attach(camera);
  } catch (e) { /* ignore */ }
  const doomed = scene.children.filter((c) => c !== camera && !isKept(c));
  for (const o of doomed) { scene.remove(o); disposeTree(o); }
  const camDoomed = camera.children.filter((c) => !camPersistent.has(c) && !(c.userData && (c.userData.persistent || c.userData.keep)));
  for (const o of camDoomed) { camera.remove(o); disposeTree(o); }
  if (initialEnv) {
    scene.fog = initialEnv.fog;
    scene.background = initialEnv.background;
    scene.environment = initialEnv.environment;
    camera.fov = initialEnv.fov; camera.near = initialEnv.near; camera.far = initialEnv.far;
  }
  camera.position.set(0, 1.62, 0);
  camera.rotation.set(0, 0, 0);
  camera.up.set(0, 1, 0);
  try { camera.updateProjectionMatrix(); } catch (e) { /* ignore */ }
}

function resetEnv() {
  ctx.oxygenDrain = 0;
  ctx.oxygenZones.length = 0;
  ctx.footstepSound = 'footstep';
  ctx.gravity = -18;
  ctx.time = 0;
  ctx.cinematic = false;
  safe('post reset', () => {
    if (R.post && typeof R.post.reset === 'function') R.post.reset();
    else if (initialPost && R.post && R.post.set) R.post.set(initialPost);
  });
  safe('renderer exposure', () => { if (R.renderer) R.renderer.toneMappingExposure = initialExposure; });
  safe('fx reset', () => { if (typeof fx.reset === 'function') fx.reset(); else if (fx.setGlitch) fx.setGlitch(0); });
  safe('audio reset', () => { audio.setTension && audio.setTension(0); audio.setMuffle && audio.setMuffle(0); });
  safe('ui reset', () => { ui.setObjective && ui.setObjective(''); });
  hidePrompt();
}

// Finish a cutscene that is still running (flow changed mid-cutscene, or it outlived its timeout).
// Otherwise its end restores the OLD fog/background/camera near-far on top of the next level / menu.
function stopCutscene() {
  const h = currentCut;
  if (!h) return;
  currentCut = null;
  try { h.skip && h.skip(); } catch (e) { reportError('cutscene stop', e); }
}

function teardownWorld() {
  stopCutscene();
  levelReady = false;
  pendingEvents = [];
  reviveGrace.clear();
  if (level) {
    const L = level;
    level = null;
    ctx.level = null;
    try { L.dispose && L.dispose(); } catch (e) { reportError('level.dispose', e); }
  }
  updates.clear();
  hookErrors.clear();
  for (const rp of remotes.values()) safe('RemotePlayer.dispose', () => rp.dispose && rp.dispose());
  remotes.clear();
  if (localPlayer) {
    const lp = localPlayer;
    localPlayer = null;
    ctx.localPlayer = null;
    safe('LocalPlayer.dispose', () => lp.dispose && lp.dispose());
  }
  safe('interact.clear', () => interact.clear());
  reviveProxies.clear();
  prevDowned.clear();
  safe('world.clear', () => world.clear());
  clearScene();
  resetEnv();
}

// ------------------------------------------------------------------ module loaders
let cutModPromise = null;
function getCutscenes() {
  if (!cutModPromise) {
    cutModPromise = import('./story/cutscenes.js').catch((e) => {
      reportError('cutscenes.js', e);
      cutModPromise = null;
      return null;
    });
  }
  return cutModPromise;
}
const levelModCache = {};
function importLevel(i) {
  const n = i + 1;
  if (!levelModCache[n]) {
    levelModCache[n] = import('./levels/level' + n + '.js').catch((e) => { delete levelModCache[n]; throw e; });
  }
  return levelModCache[n];
}

// ------------------------------------------------------------------ cutscenes
async function playCut(name, my) {
  if (NOCUT || !name) return;
  setState('cutscene');
  disposeBackdrop();
  teardownWorld();
  safe('ui.showScreen', () => ui.showScreen('none'));
  resetHud();
  setAmbience('cutscene');
  const mod = await getCutscenes();
  if (my !== flow) return;
  if (!mod || typeof mod.playCutscene !== 'function') return;
  ctx.cinematic = true;
  skipShown = 0;
  if (ctx.isHost) safe('ui.skipHint', () => ui.skipHint && ui.skipHint(true));
  let resolveSkip = null;
  const skipP = new Promise((r) => { resolveSkip = r; });
  let handle = null, skipped = false, settled = false;
  // A skip can arrive before the handle exists (during the fade-in): remember it instead of losing it,
  // which used to leave the cutscene running underneath the next level.
  const doSkip = () => {
    if (skipped) return;
    skipped = true;
    if (cutSkip === doSkip) cutSkip = null;
    try { handle && handle.skip && handle.skip(); } catch (e) { reportError('cutscene skip', e); }
    resolveSkip();
  };
  cutSkip = doSkip;
  if (pendingSkip) { pendingSkip = false; doSkip(); }
  try {
    await safeFade(false, 0.4);
    if (my !== flow || skipped) return;
    handle = mod.playCutscene(name, ctx);
    currentCut = handle;
    const p = handle && handle.promise ? Promise.resolve(handle.promise) : Promise.resolve();
    p.then(() => { settled = true; }, () => { settled = true; });
    await Promise.race([
      p,
      skipP.then(() => Promise.race([p, sleep(2500)])),
      sleep(CUT_MAX_MS),
    ]);
  } catch (e) {
    reportError('cutscene "' + name + '"', e);
  } finally {
    if (handle && !settled) { try { handle.skip && handle.skip(); } catch (e) { /* ignore */ } }
    if (currentCut === handle) currentCut = null;
    if (cutSkip === doSkip) cutSkip = null;
    if (my === flow) { // a newer flow owns these now
      pendingSkip = false;
      ctx.cinematic = false;
      safe('ui.skipHint', () => ui.skipHint && ui.skipHint(false));
      safe('ui.letterbox', () => ui.letterbox && ui.letterbox(false));
    }
  }
}

function hostSkipCutscene() {
  if (!ctx.isHost || !cutSkip) return;
  broadcast({ t: 'skip' });
  cutSkip();
}

// ------------------------------------------------------------------ level loading
function levelMeta(L, i) {
  return {
    title: (L && L.title) || LEVEL_TITLES[i] || ('CHAPTER ' + (i + 1)),
    subtitle: (L && L.subtitle) || LEVEL_SUBTITLES[i] || '',
  };
}

function spawnPointFor(pts, slot) {
  let sp = Array.isArray(pts) && pts.length ? (pts[slot % pts.length] || pts[0]) : null;
  if (!sp) {
    let gy = 0;
    try { const h = world.groundHeight(0, 0); if (Number.isFinite(h)) gy = h; } catch (e) { /* ignore */ }
    sp = { x: 0, y: gy, z: 0, yaw: 0 };
  }
  return { x: +sp.x || 0, y: Number.isFinite(+sp.y) ? +sp.y : 0, z: +sp.z || 0, yaw: +sp.yaw || 0 };
}

async function loadLevel(li, save, seed, my) {
  if (my == null) my = ++flow;
  li = clampLevel(li);
  setState('loading');
  pendingSkip = false;
  disposeBackdrop();
  teardownWorld();
  completing = false; overSent = false; overPending = 0;
  forceCloseChat();
  levelIndex = li; ctx.levelIndex = li;
  levelSeed = seed >>> 0; ctx.seed = levelSeed;
  ctx.rng = mulberry32((levelSeed + li * 7919) >>> 0);
  ctx.time = 0;
  const meta0 = levelMeta(null, li);
  safe('ui.showLoading', () => ui.showLoading(meta0.title + ' — ' + meta0.subtitle, 0.05));

  let Mod = null;
  try { Mod = await importLevel(li); } catch (e) { reportError('level' + (li + 1) + '.js', e); }
  if (my !== flow) return;
  const LevelClass = Mod && (Mod.default || Mod['Level' + (li + 1)]);
  if (typeof LevelClass !== 'function') {
    safe('ui.showLoading', () => ui.showLoading('SIGNAL LOST — ' + meta0.title + ' failed to load', 0));
    notify('Chapter ' + (li + 1) + ' failed to load. Returning to menu…', 5);
    setTimeout(() => { if (my === flow) leaveToMenu(); }, 4500);
    return;
  }
  const meta = levelMeta(LevelClass, li);
  safe('ui.showLoading', () => ui.showLoading(meta.title + ' — ' + meta.subtitle, 0.25));

  for (const s of ctx.players.values()) resetVitals(s);
  localState.flashlight = false;
  try {
    localPlayer = new LocalPlayer(ctx, localState);
    ctx.localPlayer = localPlayer;
    try { localPlayer.gravity = ctx.gravity; } catch (e) { /* ignore */ }
  } catch (e) {
    reportError('LocalPlayer', e);
    localPlayer = null; ctx.localPlayer = null;
  }

  let L = null;
  try { L = new LevelClass(ctx); } catch (e) { reportError('level constructor', e); }
  level = L; ctx.level = L;
  if (L && typeof L.build === 'function') {
    try { await withTimeout(Promise.resolve(L.build(save == null ? null : save)), 45000, 'level build timed out'); }
    catch (e) { if (my === flow) reportError('level.build', e); else console.warn('[STARLESS] stale level.build ended:', e); }
  }
  if (my !== flow) return;
  safe('ui.showLoading', () => ui.showLoading(meta.title + ' — ' + meta.subtitle, 1));

  let pts = null;
  try { pts = L && L.spawnPoints ? L.spawnPoints() : null; } catch (e) { reportError('level.spawnPoints', e); }
  const sp = spawnPointFor(pts, localState.slot | 0);
  localState.position.set(sp.x, sp.y, sp.z);
  localState.yaw = sp.yaw;
  if (localPlayer) { try { localPlayer.spawn(sp); } catch (e) { reportError('LocalPlayer.spawn', e); } }
  // Screenshot/debug hooks: ?pose=x,z,yaw,pitch teleports the local player (feet snapped to ground); ?nohud hides the overlay.
  try {
    const qp = new URLSearchParams(location.search);
    const pose = qp.get('pose');
    if (pose && localPlayer) {
      const [px, pz, pyaw, ppitch] = pose.split(',').map(Number);
      if (Number.isFinite(px) && Number.isFinite(pz)) {
        const gy = ctx.world.groundHeight(px, pz);
        localPlayer.spawn({ x: px, y: Number.isFinite(gy) ? gy : sp.y, z: pz, yaw: Number.isFinite(pyaw) ? pyaw : 0 });
        if (Number.isFinite(ppitch)) localPlayer.pitch = ppitch;
      }
    }
    if (qp.has('nohud')) { const u = document.getElementById('ui'); if (u) u.style.visibility = 'hidden'; }
  } catch (e) { console.warn('[debug pose]', e); }
  for (const s of ctx.players.values()) {
    if (s.id === ctx.localId) continue;
    const rp = spawnPointFor(pts, s.slot | 0);
    s.position.set(rp.x, rp.y, rp.z);
    s.yaw = rp.yaw;
    spawnRemote(s);
  }
  for (const id of ctx.players.keys()) prevDowned.set(id, false);

  try { if (R.renderer && R.renderer.compile) R.renderer.compile(scene, camera); } catch (e) { /* ignore */ }

  levelReady = true;
  store.setUnlocked(li + 1);
  if (ctx.isHost) {
    if (save == null) store.save({ levelIndex: li, levelSave: null });
    lastSave = { levelIndex: li, levelSave: save == null ? null : save };
  }
  const queued = pendingEvents;
  pendingEvents = [];
  for (const m of queued) if (m.li == null || m.li === li) dispatchLevelEvent(m.type, m.data, m.from);

  ctx.paused = false;
  safe('input', () => { input.enabled = true; });
  setState('playing');
  safe('ui.showScreen', () => ui.showScreen('hud'));
  safe('ui.setDowned', () => ui.setDowned && ui.setDowned(false));
  safe('ui.chapterCard', () => ui.chapterCard && ui.chapterCard(meta.title, meta.subtitle));
  setAmbience('l' + (li + 1));
  safeFade(false, 1.2);
  netT.p = netT.l = netT.ui = 0;
  lockPointer(true);
}

function doRetry(li, seed, save) {
  const my = ++flow;
  safe('ui', () => ui.setDowned && ui.setDowned(false));
  loadLevel(li, save, seed, my);
}

function hostRetry() {
  if (!ctx.isHost || levelIndex < 0) return;
  let save = null;
  if (lastSave && lastSave.levelIndex === levelIndex) save = lastSave.levelSave;
  else { const s = store.load(); if (s && s.levelIndex === levelIndex) save = s.levelSave; }
  broadcast({ t: 'retry', levelIndex, seed: levelSeed, save });
  doRetry(levelIndex, levelSeed, save);
}

async function handleNext(next, seed) {
  const my = ++flow;
  const prev = next - 1;
  completing = true;
  store.setUnlocked(Math.min(NUM_LEVELS, next + 1));
  if (ctx.isHost) {
    if (next < NUM_LEVELS) store.save({ levelIndex: next, levelSave: null });
    else store.clear();
  }
  setState('cutscene');
  ctx.cinematic = true;
  resetHud();
  await safeFade(true, 1.0);
  if (my !== flow) return;
  const cut = CONFIG.cutsceneAfter ? CONFIG.cutsceneAfter[prev] : null;
  if (cut && !NOCUT) {
    await playCut(cut, my);
    if (my !== flow) return;
  } else {
    teardownWorld();
  }
  if (next >= NUM_LEVELS) { showCredits(); return; }
  await loadLevel(next, null, seed, my);
}

function showCredits() {
  ++flow;
  teardownWorld();
  setState('credits');
  unlockPointer();
  resetHud();
  safe('ui.showScreen', () => ui.showScreen('credits', { credits: CONFIG.credits, title: CONFIG.title }));
  safeFade(false, 1.0);
  setAmbience('menu');
  clearTimeout(creditsTimer);
  creditsTimer = setTimeout(() => endCredits(), 75000);
}

function endCredits() {
  if (state !== 'credits') return;
  clearTimeout(creditsTimer);
  if (mp && net) goLobby(); else goMenu();
}

// ------------------------------------------------------------------ level events / host routing
function dispatchLevelEvent(type, data, from) {
  if (!level || typeof level.onEvent !== 'function') return;
  try { level.onEvent(type, data, from); } catch (e) { reportError('level.onEvent "' + type + '"', e); }
}

function hostNoise(pos, loudness) {
  const L = level;
  if (!L || !levelReady) return;
  try {
    if (typeof L.onNoise === 'function') L.onNoise(pos, loudness);
    else if (typeof L.noiseAt === 'function') L.noiseAt(pos, loudness);
    else if (Array.isArray(L.creatures)) for (const c of L.creatures) { if (c && c.hearNoise) c.hearNoise(pos, loudness); }
  } catch (e) { reportError('noise', e); }
}

// ------------------------------------------------------------------ down / revive / game over
function addRevive(s) {
  if (!s || s.id === ctx.localId) return;
  let o = reviveProxies.get(s.id);
  if (!o) { o = new THREE.Object3D(); reviveProxies.set(s.id, o); }
  o.position.set(s.position.x, s.position.y + 0.6, s.position.z);
  const target = s.id;
  interact.add({
    id: 'revive:' + target, object: o, radius: 2.0, holdTime: 3,
    prompt: 'Revive ' + (s.callsign || 'crewmate'),
    onInteract: (by) => hostRevive(target, by),
  });
}
function removeRevive(id) {
  safe('interact.remove', () => interact.remove('revive:' + id));
  reviveProxies.delete(id);
}
function hostRevive(targetId, byId) {
  if (!ctx.isHost) return;
  const s = ctx.players.get(targetId);
  if (!s || !s.downed) return;
  s.downed = false;
  if (s.health < 1) s.health = 30;
  if (targetId !== ctx.localId) reviveGrace.set(targetId, performance.now() + 2000);
  broadcast({ t: 'revive', id: targetId, by: byId });
  applyRevive(targetId, byId);
}
function applyRevive(id, by) {
  const s = ctx.players.get(id);
  const b = by ? ctx.players.get(by) : null;
  if (id === ctx.localId) {
    safe('LocalPlayer.revive', () => localPlayer && localPlayer.revive && localPlayer.revive());
    localState.downed = false;
    if (localState.health < 1) localState.health = 30;
    safe('ui.setDowned', () => ui.setDowned && ui.setDowned(false));
  } else if (s) {
    s.downed = false; // remote copy: the next 'pall'/'pst' carries the real values
    if (s.health < 1) s.health = 30;
  }
  removeRevive(id);
  safe('audio', () => audio.play('revive', s ? { position: s.position } : {}));
  if (s) notify((b ? b.callsign : 'CREW') + ' revived ' + s.callsign, 3);
}

function onLocalDowned(down) {
  safe('ui.setDowned', () => ui.setDowned && ui.setDowned(down));
  if (down && mp) notify('You are down. A crewmate can revive you.', 4);
}

function checkDowned(dt) {
  for (const [id, s] of ctx.players) {
    const was = prevDowned.get(id) || false;
    const now = !!s.downed;
    if (was !== now) {
      prevDowned.set(id, now);
      if (id === ctx.localId) onLocalDowned(now);
      else if (now) { addRevive(s); notify(s.callsign + ' is down!', 3); }
      else removeRevive(id);
    }
  }
  for (const [id, o] of reviveProxies) {
    const s = ctx.players.get(id);
    if (s) o.position.set(s.position.x, s.position.y + 0.6, s.position.z);
  }
  if (ctx.isHost && !overSent && (state === 'playing' || state === 'paused') && !completing) {
    let any = false, all = true;
    for (const s of ctx.players.values()) { any = true; if (!s.downed) { all = false; break; } }
    if (any && all) {
      overPending += dt;
      if (overPending > 2.2) triggerGameOver();
    } else overPending = 0;
  }
}

function triggerGameOver() {
  if (overSent) return;
  overSent = true;
  broadcast({ t: 'over' });
  showGameOver();
}

function showGameOver() {
  if (state === 'gameover') return;
  if (state !== 'playing' && state !== 'paused') return;
  setState('gameover');
  ctx.paused = false;
  forceCloseChat();
  safe('input', () => { input.enabled = false; });
  unlockPointer();
  showLockHint(false);
  safe('ui.setDowned', () => ui.setDowned && ui.setDowned(false));
  hidePrompt();
  safe('ui.showScreen', () => ui.showScreen('gameover', { isHost: !!ctx.isHost, canRetry: !!ctx.isHost, multiplayer: mp }));
  safe('audio', () => audio.play('death', { volume: 0.8 }));
}

// ------------------------------------------------------------------ pause / chat / pointer lock
function isLocked() {
  try { return input.isLocked ? !!input.isLocked() : !!document.pointerLockElement; }
  catch (e) { return !!document.pointerLockElement; }
}
// Drag-look mode (input.js): pointer lock failed after a real click, or the URL has ?test.
// In it we never auto-pause on unlock and never show the "click to enter" hint.
function dragLookOn() {
  if (TEST_MODE) return true;
  try { return !!(input && input.dragLook); } catch (e) { return false; }
}
function hasActivation() {
  try {
    const ua = navigator.userActivation;
    if (ua && typeof ua.isActive === 'boolean') return ua.isActive;
  } catch (e) { /* ignore */ }
  return true; // unknown: let the browser decide
}
// auto = not directly inside a click (level start / resume): skip it when the browser would refuse anyway
// (no user activation) — the click hint then asks for a click instead.
function lockPointer(auto) {
  if (TEST_MODE) return;
  if (auto && !hasActivation()) return;
  const now = performance.now();
  if (now - lastLockReq < 250) return; // mousedown + click on the hint arrive back to back
  lastLockReq = now;
  try { input.lock(); } catch (e) {
    try { const p = R.renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ }
  }
}
function unlockPointer() {
  try { input.unlock(); } catch (e) {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) { /* ignore */ }
  }
}

function showLockHint(on) {
  on = !!on;
  if (on === lockHintShown) return;
  lockHintShown = on;
  if (ui && typeof ui.setLockHint === 'function') { safe('ui.setLockHint', () => ui.setLockHint(on)); return; }
  if (!fallbackHint) {
    if (!on) return;
    fallbackHint = document.createElement('div');
    fallbackHint.textContent = 'CLICK TO ENTER THE DARK';
    fallbackHint.style.cssText = 'position:fixed;left:50%;top:58%;transform:translate(-50%,-50%);z-index:50;color:#cfe8ff;' +
      'font:600 14px "Chakra Petch",monospace;letter-spacing:.35em;padding:14px 22px;border:1px solid rgba(160,210,255,.35);' +
      'background:rgba(0,0,0,.45);cursor:pointer;pointer-events:auto;user-select:none;';
    fallbackHint.addEventListener('click', () => lockPointer());
    document.body.appendChild(fallbackHint);
  }
  fallbackHint.style.display = on ? 'block' : 'none';
}

function pauseGame() {
  if (state !== 'playing') return;
  setState('paused');
  pausedAt = performance.now();
  ctx.paused = !mp; // solo freezes the simulation; multiplayer keeps running
  safe('input', () => { input.enabled = false; });
  safe('LocalPlayer.setFrozen', () => localPlayer && localPlayer.setFrozen && localPlayer.setFrozen(true));
  showLockHint(false);
  hidePrompt();
  safe('ui.showScreen', () => ui.showScreen('pause', { isHost: !!ctx.isHost, multiplayer: mp, code: lobbyCode }));
  unlockPointer();
}

function resumeGame() {
  if (state !== 'paused') return;
  setState('playing');
  ctx.paused = false;
  safe('input', () => { input.enabled = !chatOpen; });
  safe('LocalPlayer.setFrozen', () => localPlayer && localPlayer.setFrozen && localPlayer.setFrozen(false));
  safe('ui.showScreen', () => ui.showScreen('hud'));
  lockPointer(true);
}

function openChat() {
  if (chatOpen || state !== 'playing' || !mp) return;
  chatOpen = true; ctx.chatOpen = true;
  chatOpenedAt = performance.now();
  safe('input', () => { input.enabled = false; });
  safe('ui.openChat', () => ui.openChat && ui.openChat());
}
function forceCloseChat() {
  if (!chatOpen) return;
  chatOpen = false;
  if (ctx) ctx.chatOpen = false;
  safe('ui.closeChat', () => ui.closeChat && ui.closeChat());
}
function closeChat() {
  if (!chatOpen) return;
  forceCloseChat();
  if (state === 'playing') safe('input', () => { input.enabled = true; });
}
function sendChat(text) {
  closeChat();
  text = cleanText(text, 200);
  if (!text) return;
  const name = (localState && localState.callsign) || 'CREW';
  safe('ui.chatMessage', () => ui.chatMessage && ui.chatMessage(name, text));
  if (!mp) return;
  if (ctx.isHost) broadcast({ t: 'chat', name, text });
  else send({ t: 'chat', name, text });
}

function onEscape() {
  const now = performance.now();
  if (state === 'playing') {
    if (chatOpen) return;
    if (now - lockLostAt < 350) return;
    pauseGame();
  } else if (state === 'paused') {
    if (now - pausedAt < 400) return;
    resumeGame();
  } else if (state === 'credits') {
    endCredits();
  }
}

// ------------------------------------------------------------------ settings / audio
function readSettings() {
  try { const s = ui.getSettings && ui.getSettings(); return s && typeof s === 'object' ? s : {}; } catch (e) { return {}; }
}
function applySettings(s) {
  settings = s && typeof s === 'object' ? Object.assign({}, readSettings(), s) : readSettings();
  ctx.settings = settings;
  let v = settings.volume != null ? settings.volume : (settings.masterVolume != null ? settings.masterVolume : settings.master);
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 1) v /= 100;
    safe('audio.setMasterVolume', () => audio.setMasterVolume && audio.setMasterVolume(Math.max(0, Math.min(1, v))));
  }
  if (settings.quality) {
    const q = settings.quality === 'low' ? 'low' : 'high';
    if (q !== ctx.quality) { ctx.quality = q; safe('renderer.setQuality', () => R.setQuality && R.setQuality(q)); }
  }
  let sens = settings.sensitivity != null ? +settings.sensitivity : (settings.mouseSensitivity != null ? +settings.mouseSensitivity : NaN);
  if (Number.isFinite(sens)) { ctx.sensitivity = sens; try { input.sensitivity = sens; } catch (e) { /* ignore */ } }
  if (localState && !mp) { const n = myName(); if (n) localState.name = n; }
}
function setAmbience(name) {
  curAmbience = name;
  safe('audio.ambience', () => audio.ambience && audio.ambience(name));
}
function initAudio() {
  if (audioReady) return;
  audioReady = true;
  try {
    Promise.resolve(audio.init()).then(() => {
      applySettings(settings);
      if (curAmbience) setAmbience(curAmbience);
    }).catch((e) => reportError('audio.init', e));
  } catch (e) { reportError('audio.init', e); }
}

// ------------------------------------------------------------------ ui actions
function onAction(action, payload) {
  switch (action) {
    case 'solo': {
      const li = payload && typeof payload === 'object' && payload.levelIndex != null ? payload.levelIndex : 0;
      startSolo({ levelIndex: li, continue: !!(payload && payload.continue) });
      break;
    }
    case 'continue':
      if (state === 'lobby' && mp) { if (ctx.isHost) hostStart({ continue: true }); else notify('Only the host can launch.', 3); }
      else if (state === 'menu') startSolo({ continue: true });
      break;
    case 'host': if (state === 'menu' || state === 'lobby') hostGame(payload); break;
    case 'join': if (state === 'menu' || state === 'lobby') joinGame(payload); break;
    case 'start':
      if (state === 'lobby' || state === 'menu') {
        if (ctx.isHost) hostStart(payload && typeof payload === 'object' ? payload : { levelIndex: +payload || 0 });
        else notify('Only the host can launch.', 3);
      }
      break;
    case 'leave': leaveToMenu(); break;
    case 'resume': resumeGame(); break;
    case 'retry':
      if (state !== 'gameover') break;
      if (ctx.isHost) hostRetry(); else notify('Waiting for the host to try again…', 3);
      break;
    case 'quit': case 'menu': case 'back':
      if (state === 'credits') endCredits();
      else if (state === 'menu') { /* already there */ }
      else leaveToMenu();
      break;
    case 'credits_done': case 'done': endCredits(); break;
    case 'settings': applySettings(payload); break;
    case 'lock': lockPointer(); break;
    case 'skip': if (state === 'cutscene') hostSkipCutscene(); break;
    case 'chat': sendChat(payload && typeof payload === 'object' ? payload.text : payload); break;
    default: break;
  }
}

// ------------------------------------------------------------------ frame loop
function runUpdates(dt) {
  for (const fn of updates) {
    try { fn(dt); } catch (e) {
      const n = (hookErrors.get(fn) || 0) + 1;
      hookErrors.set(fn, n);
      reportError('update hook', e);
      if (n >= 60) { updates.delete(fn); console.warn('[STARLESS] removed a failing update hook'); }
    }
  }
}

function netTick(dt) {
  if (!mp || !net) return;
  netT.p += dt; netT.l += dt;
  const pInt = 1 / PLAYER_HZ, lInt = 1 / LEVEL_HZ;
  if (netT.p >= pInt) {
    netT.p = netT.p > pInt * 3 ? 0 : netT.p - pInt;
    if (ctx.isHost) {
      if (roster.length > 1) {
        const ps = [];
        for (const s of ctx.players.values()) ps.push(packState(s));
        broadcast({ t: 'pall', ps });
      }
    } else if (localState) {
      send({ t: 'pst', s: packState(localState) });
    }
  }
  if (netT.l >= lInt) {
    netT.l = netT.l > lInt * 3 ? 0 : netT.l - lInt;
    if (ctx.isHost && level && levelReady && roster.length > 1 && typeof level.getState === 'function') {
      let s = null;
      try { s = level.getState(); } catch (e) { reportError('level.getState', e); }
      if (s != null) broadcast({ t: 'ls', li: levelIndex, s });
    }
  }
}

function uiTick(dt) {
  netT.ui += dt;
  if (netT.ui < 0.1) return;
  netT.ui = 0;
  if (localState) {
    safe('ui.setVitals', () => ui.setVitals && ui.setVitals({
      health: localState.health, oxygen: localState.oxygen, stamina: localState.stamina, battery: localState.battery,
    }));
  }
  if (mp) {
    const team = [];
    for (const s of ctx.players.values()) {
      if (s.id === ctx.localId) continue;
      team.push({ id: s.id, name: s.name, callsign: s.callsign, color: s.colorCss, health: s.health, downed: !!s.downed });
    }
    safe('ui.setTeam', () => ui.setTeam && ui.setTeam(team));
  }
}

function gameUpdate(dt) {
  ctx.time += dt;
  if (localPlayer) { try { localPlayer.update(dt); } catch (e) { reportError('LocalPlayer.update', e); } }
  for (const rp of remotes.values()) { try { rp.update(dt); } catch (e) { reportError('RemotePlayer.update', e); } }
  if (level && typeof level.update === 'function') { try { level.update(dt); } catch (e) { reportError('level.update', e); } }
  try { interact.update(dt); } catch (e) { reportError('interact.update', e); }
  runUpdates(dt);
  try { checkDowned(dt); } catch (e) { reportError('downed check', e); }
}

let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.05) dt = 0.05;
  try { tick(dt, now); } catch (e) { reportError('frame', e); }
  try { R.render(dt); } catch (e) { reportError('render', e); }
  try { input.endFrame && input.endFrame(); } catch (e) { /* ignore */ }
}

function tick(dt, now) {
  const st = state;
  let frozen = false;
  if (st === 'menu' || st === 'lobby' || st === 'credits') {
    if (backdrop && backdrop.update) { try { backdrop.update(dt); } catch (e) { reportError('menu backdrop', e); } }
    runUpdates(dt);
  } else if (st === 'cutscene') {
    runUpdates(dt);
    if (ctx.isHost && cutSkip) {
      const p = spaceAt ? Math.min(1, (now - spaceAt) / 1000) : 0;
      if (Math.abs(p - skipShown) > 0.02) { skipShown = p; safe('ui.skipHint', () => ui.skipHint && ui.skipHint(p > 0 ? p : true)); }
      if (spaceAt && p >= 1) { spaceAt = 0; skipShown = 0; hostSkipCutscene(); }
    }
  } else if (st === 'playing' || st === 'paused' || st === 'gameover') {
    frozen = st === 'paused' && !mp;
    if (!frozen && levelReady) gameUpdate(dt);
    if (levelReady) netTick(dt);
    if (levelReady) uiTick(dt);
  }
  if (!frozen) {
    try { fx.update && fx.update(dt); } catch (e) { reportError('fx.update', e); }
    try { fx.applyCamera && fx.applyCamera(camera); } catch (e) { reportError('fx.applyCamera', e); }
  }
  try {
    camera.getWorldPosition(_lp);
    camera.getWorldDirection(_lf);
    audio.setListener && audio.setListener(_lp, _lf);
  } catch (e) { reportError('audio.setListener', e); }

  if (chatOpen && now - chatOpenedAt > 250) {
    let open = false;
    try { open = typeof ui.isChatOpen === 'function' ? !!ui.isChatOpen() : isTyping(document.activeElement); } catch (e) { open = false; }
    if (!open) closeChat();
  }
  showLockHint(state === 'playing' && levelReady && !chatOpen && !isLocked() && !dragLookOn());
}

// ------------------------------------------------------------------ boot
async function imp(path) {
  try { return { mod: await import(path) }; } catch (e) { return { err: e }; }
}

async function boot() {
  const [rM, iM, wM, pM, fM, aM, nM, uM] = await Promise.all([
    imp('./engine/renderer.js'), imp('./engine/input.js'), imp('./engine/world.js'), imp('./engine/player.js'),
    imp('./engine/fx.js'), imp('./audio/audio.js'), imp('./net/net.js'), imp('./ui/ui.js'),
  ]);
  const fatal = [];
  const need = (m, file, key) => {
    if (m.err) { fatal.push(file + ': ' + errMsg(m.err)); return null; }
    const v = m.mod[key] || (m.mod.default && (key === 'default' ? m.mod.default : m.mod.default[key])) ;
    if (!v) { fatal.push(file + ': missing export "' + key + '"'); return null; }
    return v;
  };
  createRenderer = need(rM, 'engine/renderer.js', 'createRenderer');
  input = iM.err ? need(iM, 'engine/input.js', 'input') : (iM.mod.input || iM.mod.default || need(iM, 'engine/input.js', 'input'));
  World = need(wM, 'engine/world.js', 'World');
  LocalPlayer = need(pM, 'engine/player.js', 'LocalPlayer');
  RemotePlayer = pM.mod ? (pM.mod.RemotePlayer || null) : null;
  ui = uM.err ? need(uM, 'ui/ui.js', 'ui') : (uM.mod.ui || uM.mod.default || need(uM, 'ui/ui.js', 'ui'));
  if (fatal.length) { bootFail(fatal.join('\n')); return; }

  const soft = [];
  if (fM.err || !fM.mod.createFX) { soft.push('fx.js'); if (fM.err) console.error(fM.err); createFX = null; } else createFX = fM.mod.createFX;
  if (aM.err || !(aM.mod.audio || aM.mod.default)) { soft.push('audio.js'); if (aM.err) console.error(aM.err); audio = makeStub({ loop: () => loopStub }); }
  else audio = aM.mod.audio || aM.mod.default;
  if (nM.err || !(nM.mod.Net || nM.mod.default)) { soft.push('net.js'); if (nM.err) console.error(nM.err); Net = null; }
  else Net = nM.mod.Net || nM.mod.default;
  if (!RemotePlayer) soft.push('RemotePlayer');

  // UI first (settings decide quality)
  try { ui.init(document.getElementById('ui')); } catch (e) { bootFail('ui.init: ' + errMsg(e)); console.error(e); return; }
  settings = readSettings();
  const quality = settings.quality === 'low' ? 'low' : 'high';

  try { R = createRenderer(document.getElementById('game'), quality); }
  catch (e) { bootFail('Could not start WebGL: ' + errMsg(e)); console.error(e); return; }
  scene = R.scene; camera = R.camera;
  try { world = new World(); } catch (e) { bootFail('World: ' + errMsg(e)); console.error(e); return; }

  ctx = {
    THREE, scene, camera, renderer: R.renderer, composer: R.composer, rendererApi: R, post: R.post,
    world, audio, ui, fx: null, net: soloNet, input,
    isHost: true, localId: 'solo', players: new Map(),
    getLocalPlayer: () => localState,
    localPlayer: null, interact: null, rng: Math.random, time: 0, quality, cinematic: false,
    settings, sensitivity: settings.sensitivity, paused: false, chatOpen: false, gameState: state,
    oxygenDrain: 0, oxygenZones: [], footstepSound: 'footstep', gravity: -18,
    level: null, levelIndex: -1, seed: 0, config: CONFIG,
    addUpdate(fn) {
      if (typeof fn !== 'function') return noop;
      updates.add(fn);
      return () => { updates.delete(fn); };
    },
    levelEvent(type, data) {
      if (ctx.isHost) {
        dispatchLevelEvent(type, data, ctx.localId);
        broadcast({ t: 'ev', type, data, from: ctx.localId, li: levelIndex });
      } else {
        send({ t: 'ev', type, data, li: levelIndex });
      }
    },
    damagePlayer(id, amount, srcPos) {
      if (!ctx.isHost) return;
      id = String(id);
      const s = ctx.players.get(id);
      if (!s || s.downed) return;
      if (id === ctx.localId) {
        if (localPlayer && localPlayer.applyDamage) safe('LocalPlayer.applyDamage', () => localPlayer.applyDamage(+amount || 0, srcPos));
      } else {
        sendTo(id, { t: 'dmg', id, amount: +amount || 0, src: arr3(srcPos) });
      }
    },
    givePlayer(id, g) {
      if (!ctx.isHost || !g) return;
      id = String(id);
      const pay = { health: +g.health || 0, oxygen: +g.oxygen || 0, battery: +g.battery || 0 };
      if (id === ctx.localId) {
        if (localPlayer && localPlayer.give) safe('LocalPlayer.give', () => localPlayer.give(pay));
      } else {
        sendTo(id, Object.assign({ t: 'give', id }, pay));
      }
    },
    setOxygenDrain(perSec) { ctx.oxygenDrain = Number.isFinite(+perSec) ? +perSec : 0; },
    addOxygenZone(pos, radius) {
      const id = ++zoneSeq;
      const p = toV3(pos);
      ctx.oxygenZones.push({ id, pos: p, position: p, radius: Number.isFinite(+radius) && +radius > 0 ? +radius : 3 });
      return id;
    },
    removeOxygenZone(id) {
      const i = ctx.oxygenZones.findIndex((z) => z.id === id);
      if (i >= 0) ctx.oxygenZones.splice(i, 1);
    },
    setGravity(g) {
      ctx.gravity = Number.isFinite(+g) ? +g : -18;
      if (localPlayer) { try { localPlayer.gravity = ctx.gravity; } catch (e) { /* ignore */ } }
    },
    checkpoint() {
      if (!ctx.isHost || !level || !levelReady) return;
      let data = null;
      try { data = level.getSaveData ? level.getSaveData() : null; } catch (e) { reportError('level.getSaveData', e); }
      if (data === undefined) data = null;
      lastSave = { levelIndex, levelSave: data };
      store.save({ levelIndex, levelSave: data });
      notify('CHECKPOINT', 2);
    },
    completeLevel() {
      if (!ctx.isHost) return;
      if (completing || !levelReady || (state !== 'playing' && state !== 'paused')) return;
      completing = true;
      const next = levelIndex + 1;
      broadcast({ t: 'next', levelIndex: next, seed: levelSeed, save: null });
      handleNext(next, levelSeed);
    },
    noiseAt(pos, loudness) {
      if (!pos) return;
      const l = Number.isFinite(+loudness) ? +loudness : 0.5;
      if (ctx.isHost) hostNoise(pos, l);
      else send({ t: 'noise', p: arr3(pos), l });
    },
    reportError,
  };
  window.STARLESS = ctx;

  interact = new Interactables(ctx);
  ctx.interact = interact;
  try { fx = createFX ? createFX(ctx) : null; } catch (e) { console.error(e); soft.push('fx (createFX threw)'); fx = null; }
  if (!fx) fx = makeStub({});
  ctx.fx = fx;

  try { input.init(R.renderer.domElement); } catch (e) { bootFail('input.init: ' + errMsg(e)); console.error(e); return; }

  // Snapshot what the engine itself put in the scene so level teardown never removes it.
  persistent = new Set(scene.children);
  camPersistent = new Set(camera.children);
  initialEnv = { fog: scene.fog, background: scene.background, environment: scene.environment, fov: camera.fov, near: camera.near, far: camera.far };
  try { initialPost = R.post && R.post.get ? JSON.parse(JSON.stringify(R.post.get())) : null; } catch (e) { initialPost = null; }
  try { initialExposure = R.renderer ? R.renderer.toneMappingExposure : 1; } catch (e) { initialExposure = 1; }

  setupLocal('solo', myName());
  applySettings(settings);

  // ---- listeners
  try { ui.onAction((a, p) => { try { onAction(a, p); } catch (e) { reportError('action ' + a, e); } }); }
  catch (e) { reportError('ui.onAction', e); }
  try { ui.onChat && ui.onChat((text) => sendChat(text)); } catch (e) { reportError('ui.onChat', e); }

  window.addEventListener('pointerdown', initAudio, true);
  window.addEventListener('keydown', initAudio, true);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && !isTyping(e.target)) spaceAt = performance.now();
    if (e.repeat) return;
    if (e.code === 'Escape') { onEscape(); return; }
    if (e.code === 'KeyT' && state === 'playing' && mp && !chatOpen && !isTyping(e.target)) {
      e.preventDefault();
      setTimeout(openChat, 0);
    }
  }, true);
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceAt = 0; }, true);
  window.addEventListener('blur', () => { spaceAt = 0; });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) return;
    lockLostAt = performance.now();
    // Drag-look / ?test: losing (or never getting) the lock must not flip to PAUSED — automated
    // browsers and embeds would get stuck there. Esc (keydown) still pauses via onEscape().
    if (state === 'playing' && !chatOpen && !dragLookOn()) pauseGame();
  });
  document.addEventListener('mousedown', (e) => {
    if (TEST_MODE || state !== 'playing' || chatOpen || !levelReady || isLocked()) return;
    if (isTyping(e.target)) return;
    // Lock already failed: the player drags to look; retry the lock now and then, not on every drag.
    let failed = false;
    try { failed = !!input.lockFailed; } catch (_) { failed = false; }
    if (failed && performance.now() - lastLockReq < 4000) return;
    lockPointer();
  });
  window.addEventListener('resize', () => { safe('renderer.resize', () => R.resize && R.resize()); });
  window.addEventListener('beforeunload', () => {
    try { net && net.close(); } catch (e) { /* ignore */ }
  });
  window.addEventListener('error', (e) => { if (state !== 'boot') reportError('uncaught', e.error || e.message); });
  window.addEventListener('unhandledrejection', (e) => { console.warn('[STARLESS] unhandled rejection', e.reason); });

  // ---- go
  requestAnimationFrame((t) => { lastT = t; frame(t); });
  const bootEl = document.getElementById('boot');
  if (bootEl) bootEl.classList.add('gone');

  // Warm the module cache in the background.
  getCutscenes();
  importLevel(PARAM_LEVEL >= 0 ? PARAM_LEVEL : 0).catch(() => {});

  if (PARAM_LEVEL >= 0) {
    setState('menu');
    startSolo({ levelIndex: PARAM_LEVEL, noCut: true });
  } else {
    goMenu();
  }
  if (soft.length) notify('Running without: ' + soft.join(', '), 6);
}

boot().catch((e) => { bootFail(errMsg(e)); console.error(e); });
