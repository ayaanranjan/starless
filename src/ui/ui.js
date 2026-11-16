// STARLESS — UI overlay (owner: UI). DOM overlay inside #ui. Contract: ARCHITECTURE.md § UI.
// All peer-provided strings (names, chat, codes) are rendered with textContent only.
import { CONFIG } from '../config.js';

const C = CONFIG || {};
const CALLSIGNS = C.callsigns || ['VEGA', 'ORION', 'LYRA', 'ATLAS'];
const COLORS = C.colorsCss || ['#4fd1ff', '#ffb347', '#b48cff', '#7dff9a'];
const MAXP = C.maxPlayers || 4;
const CHAPTERS = ['I · THE DROWNING WORLD', 'II · THE HOLLOW ARK', 'III · THE DARK BETWEEN'];
const FLAVOR = [
  'Recalibrating oxygen scrubbers…',
  'Do not answer the clicking.',
  'Signal integrity: 3%',
  'HALE: Hull pressure nominal. Probably.',
  'Counting the stars that are left…',
  'The Lantern is still transmitting.',
  'Kestrel expedition: last contact 2063.',
  'Keep your flashlight charged.',
  'They hunt by sound. Walk softly.',
  'If it looks like your crewmate, light it first.',
  'Distance to Earth: unknown.',
  'Something is listening on this frequency.',
];
const SCREENS = ['menu', 'lobby', 'join', 'settings', 'loading', 'hud', 'pause', 'gameover', 'credits', 'none'];
const SETTINGS_KEY = 'starless.settings';

// ---- audio (dynamic import so a broken/missing audio module never breaks the UI) ----
let audio = null;
import('../audio/audio.js').then((m) => { audio = (m && (m.audio || m.default)) || null; }).catch(() => {});
let lastHover = 0;
function sfx(name, opts) {
  try { if (audio && typeof audio.play === 'function') audio.play(name, opts || {}); } catch (e) { /* ignore */ }
}

// ---- utils ----
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function cssColor(c, i) {
  if (typeof c === 'number' && Number.isFinite(c)) return '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  if (typeof c === 'string' && c) return c;
  return COLORS[Math.abs(i | 0) % COLORS.length] || '#d8d4c8';
}
function h(tag, cls, text, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  if (parent) parent.appendChild(e);
  return e;
}
function isolateKeys(input) {
  // keep typing out of the game's keyboard handlers (keyup is allowed through so held keys release)
  input.addEventListener('keydown', (e) => e.stopPropagation());
  input.addEventListener('keypress', (e) => e.stopPropagation());
}
function setLabel(b, text) { const t = b && b.querySelector('.sl-btn-t'); if (t) t.textContent = text; }

// ---- settings ----
let settings = null;
function randomName() { return 'Crew-' + String(Math.floor(1000 + Math.random() * 9000)); }
function sanitize(s) {
  const name = String(s.name == null ? '' : s.name).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return {
    name: name || (settings && settings.name) || randomName(),
    volume: clamp(num(s.volume, 0.8), 0, 1),
    sensitivity: clamp(num(s.sensitivity, 1), 0.3, 3),
    quality: s.quality === 'low' ? 'low' : 'high',
  };
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ } }
function loadSettings() {
  if (settings) return settings;
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { s = {}; }
  settings = sanitize({ name: randomName(), volume: 0.8, sensitivity: 1, quality: 'high', ...s });
  saveSettings();
  return settings;
}
function updateSettings(patch) {
  const prev = loadSettings();
  const next = sanitize({ ...prev, ...patch });
  if (JSON.stringify(next) === JSON.stringify(prev)) return;
  settings = next;
  saveSettings();
  try { if (patch && 'volume' in patch && audio && audio.setMasterVolume) audio.setMasterVolume(next.volume); } catch (e) { /* ignore */ }
  emit('settings', { ...next });
}
function commitName(v) { if (String(v || '').trim()) updateSettings({ name: v }); }

// ---- events ----
const actionFns = [];
const chatFns = [];
function emit(action, payload) {
  for (const fn of actionFns.slice()) {
    try { fn(action, payload); } catch (e) { console.error('[ui] action handler failed:', action, e); }
  }
}

// ---- state ----
let R = null;
const E = { scr: {}, v: {}, slots: [], teamRows: [] };
let current = 'none';
const screenData = {};
let settingsReturn = 'menu';
let lobby = { code: null, players: [], isHost: false, unlocked: 1, status: '' };
let selChapter = 0;
let chapterCount = 0;
const nameColors = new Map();
let vig = 0, vigShown = -1, lastT = 0;
let chatOpen = false;

function ensure() { if (!R) init(); }

// ---- build ----
function button(label, onClick, cls, parent) {
  const b = h('button', 'sl-btn' + (cls ? ' ' + cls : ''), null, parent);
  b.type = 'button';
  h('span', 'sl-btn-t', label, b);
  b.addEventListener('mouseenter', () => {
    if (b.disabled) return;
    const t = now();
    if (t - lastHover > 70) { lastHover = t; sfx('ui_hover', { volume: 0.35 }); }
  });
  b.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (b.disabled) return;
    sfx('ui_select', { volume: 0.6 });
    try { if (onClick) onClick(e); } catch (err) { console.error('[ui]', err); }
  });
  return b;
}
function menuItem(nav, label, fn) {
  const b = button(label, fn, 'menu', nav);
  b.insertBefore(h('span', 'sl-btn-i', '00'), b.firstChild);
  return b;
}
function renumber(nav) {
  let n = 0;
  for (const b of nav.children) {
    if (b.style.display === 'none') continue;
    n++;
    const i = b.querySelector('.sl-btn-i');
    if (i) i.textContent = String(n).padStart(2, '0');
  }
}
function screen(name, extra) {
  const s = h('div', 'sl-screen sl-' + name + (extra ? ' ' + extra : ''), null, R);
  E.scr[name] = s;
  return s;
}
function field(parent, label) {
  const f = h('div', 'sl-field', null, parent);
  h('span', 'sl-label', label, f);
  return f;
}
function range(parent, min, max, step) {
  const r = h('input', 'sl-range', null, parent);
  r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step);
  isolateKeys(r);
  return r;
}

function buildHud() {
  const hud = E.hud = h('div', 'sl-hud', null, R);
  E.obj = h('div', 'sl-obj', null, hud);
  h('div', 'sl-obj-label', 'OBJECTIVE', E.obj);
  E.objText = h('div', 'sl-obj-text', '', E.obj);
  h('div', 'sl-cross', null, hud);
  E.prompt = h('div', 'sl-prompt', null, hud);
  h('span', 'sl-key', 'E', E.prompt);
  E.promptText = h('span', 'sl-prompt-t', '', E.prompt);
  E.hold = h('div', 'sl-hold', null, E.prompt);
  E.holdFill = h('i', null, null, E.hold);
  E.team = h('div', 'sl-team', null, hud);
  const bl = h('div', 'sl-bl', null, hud);
  E.chat = h('div', 'sl-chat', null, bl);
  E.chatLog = h('div', 'sl-chat-log', null, E.chat);
  E.chatIn = h('div', 'sl-chat-in', null, E.chat);
  h('span', 'sl-chat-pre', 'SAY ›', E.chatIn);
  const ci = E.chatInput = h('input', 'sl-chat-input', null, E.chatIn);
  ci.type = 'text'; ci.maxLength = 140; ci.autocomplete = 'off'; ci.spellcheck = false;
  ci.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const t = ci.value.trim();
      closeChat();
      if (t) for (const fn of chatFns.slice()) { try { fn(t); } catch (err) { console.error('[ui] chat handler', err); } }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeChat();
    }
  });
  ci.addEventListener('keypress', (e) => e.stopPropagation());
  ci.addEventListener('blur', () => { setTimeout(() => { if (chatOpen && document.activeElement !== ci) closeChat(); }, 0); });
  E.vitals = h('div', 'sl-vitals', null, bl);
  for (const [k, label, cls] of [['oxygen', 'O2', 'o2'], ['health', 'HP', 'hp'], ['stamina', 'STAMINA', 'st'], ['battery', 'LIGHT', 'lt']]) {
    const row = h('div', 'sl-vital v-' + cls, null, E.vitals);
    h('span', 'sl-vl', label, row);
    const bar = h('div', 'sl-vb', null, row);
    const fill = h('i', null, null, bar);
    const n = h('span', 'sl-vn', '100', row);
    E.v[k] = { row, fill, num: n, last: -1 };
  }
}

function buildOverlays() {
  E.downed = h('div', 'sl-downed', null, R);
  h('div', 'sl-downed-edge', null, E.downed);
  const dc = h('div', 'sl-downed-c', null, E.downed);
  h('div', 'sl-downed-t', "YOU'RE DOWN", dc);
  h('div', 'sl-downed-s', 'a crewmate can revive you', dc);
  E.downT = h('div', 'sl-downed-n', '', dc);

  h('div', 'sl-lb top', null, R);
  h('div', 'sl-lb bot', null, R);

  E.lock = h('div', 'sl-lock', null, R);
  const lc = h('div', 'sl-lock-c', null, E.lock);
  h('div', 'sl-lock-t', 'CLICK TO ENTER THE DARK', lc);
  h('div', 'sl-lock-s', 'Esc to pause', lc);
  E.lock.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); emit('lock'); });

  E.fade = h('div', 'sl-fade', null, R);
  E.card = h('div', 'sl-card', null, R);

  E.subs = h('div', 'sl-subs', null, R);
  E.subSpk = h('div', 'sl-sub-s', '', E.subs);
  E.subTxt = h('div', 'sl-sub-t', '', E.subs);

  E.skip = h('div', 'sl-skip', null, R);
  h('span', 'sl-skip-t', 'HOLD SPACE TO SKIP', E.skip);
  const sb = h('div', 'sl-skip-bar', null, E.skip);
  E.skipFill = h('i', null, null, sb);
}

function buildMenu() {
  const s = screen('menu', 'crt');
  h('div', 'sl-menu-shade', null, s);
  const m = h('div', 'sl-menu-main', null, s);
  h('div', 'sl-kicker', 'ICV PERIHELION  ·  DEEP SURVEY  ·  2091', m);
  const title = h('h1', 'sl-title sl-glitch', C.title || 'STARLESS', m);
  title.setAttribute('data-text', C.title || 'STARLESS');
  h('div', 'sl-tagline', C.tagline || '', m);
  const nav = E.mNav = h('nav', 'sl-menu-nav', null, m);
  E.mContinue = menuItem(nav, 'CONTINUE', () => emit('continue'));
  menuItem(nav, 'NEW GAME (SOLO)', () => emit('solo'));
  menuItem(nav, 'HOST CO-OP', () => emit('host'));
  menuItem(nav, 'JOIN CO-OP', () => showScreen('join'));
  menuItem(nav, 'SETTINGS', () => showScreen('settings'));
  const f = h('div', 'sl-menu-foot', null, s);
  h('span', 'sl-ver', 'v' + (C.version || '0.0.0'), f);
  h('span', 'sl-keys', 'WASD · MOUSE · F flashlight · E interact · SHIFT sprint · C crouch · T chat', f);
  h('div', 'sl-touch', 'This game needs a keyboard and mouse. Touch-only devices are not supported.', s);
}

let joinT = 0;
function setJoinStatus(text, err) {
  if (!E.joinStatus) return;
  E.joinStatus.textContent = text || '';
  E.joinStatus.classList.toggle('err', !!err);
}
const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
function doJoin() {
  const code = cleanCode(E.joinCode.value);
  E.joinCode.value = code;
  if (code.length !== 5) { setJoinStatus('A crew code is 5 characters.', true); sfx('deny', { volume: 0.5 }); E.joinCode.focus(); return; }
  commitName(E.joinName.value);
  setJoinStatus('Searching for signal ' + code + '…');
  E.joinBtn.disabled = true;
  clearTimeout(joinT);
  joinT = setTimeout(() => { if (E.joinBtn) E.joinBtn.disabled = false; }, 6000);
  emit('join', code);
}
function buildJoin() {
  const s = screen('join', 'crt');
  const p = h('div', 'sl-panel', null, s);
  h('div', 'sl-kicker', '// JOIN CO-OP', p);
  h('h2', 'sl-h', 'ENTER CREW CODE', p);
  const code = E.joinCode = h('input', 'sl-code-in', null, p);
  code.type = 'text'; code.maxLength = 5; code.autocomplete = 'off'; code.spellcheck = false;
  code.placeholder = '•••••';
  code.setAttribute('autocapitalize', 'characters');
  code.setAttribute('aria-label', 'Crew code');
  isolateKeys(code);
  code.addEventListener('input', () => { const v = cleanCode(code.value); if (v !== code.value) code.value = v; setJoinStatus(''); });
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doJoin(); } });
  const f = field(p, 'YOUR NAME');
  const nm = E.joinName = h('input', 'sl-input', null, f);
  nm.type = 'text'; nm.maxLength = 16; nm.autocomplete = 'off'; nm.spellcheck = false;
  isolateKeys(nm);
  nm.addEventListener('change', () => { commitName(nm.value); nm.value = loadSettings().name; });
  nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doJoin(); } });
  const row = h('div', 'sl-row', null, p);
  E.joinBtn = button('JOIN', doJoin, 'primary', row);
  button('BACK', () => showScreen('menu'), 'ghost', row);
  E.joinStatus = h('div', 'sl-status', '', p);
}

function copyText(text) {
  return new Promise((resolve) => {
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        resolve(!!ok);
      } catch (e) { resolve(false); }
    };
    try {
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => resolve(true), fallback);
      else fallback();
    } catch (e) { fallback(); }
  });
}
let copyT = 0;
function inviteLink(code) {
  try { const u = new URL(location.href); u.search = '?join=' + encodeURIComponent(code); u.hash = ''; return u.toString(); }
  catch (e) { return code; }
}
function copyCode() {
  const code = lobby.code ? String(lobby.code).toUpperCase() : '';
  if (!code) return;
  copyText(inviteLink(code)).then((ok) => {
    setLabel(E.lCopy, ok ? 'LINK COPIED' : 'COPY FAILED');
    clearTimeout(copyT);
    copyT = setTimeout(() => setLabel(E.lCopy, 'COPY INVITE LINK'), 1600);
  });
}
let startLockT = 0;
function buildLobby() {
  const s = screen('lobby', 'crt');
  const p = h('div', 'sl-panel sl-lobby-p', null, s);
  h('div', 'sl-kicker', '// CREW CHANNEL', p);
  E.lCodeWrap = h('div', 'sl-lcode', null, p);
  E.lCode = h('div', 'sl-lcode-v', '', E.lCodeWrap);
  E.lCopy = button('COPY INVITE LINK', copyCode, 'small', E.lCodeWrap);
  E.lHint = h('div', 'sl-lhint', 'Send the invite link (or the code) to your crew', p);
  const slots = h('div', 'sl-slots', null, p);
  for (let i = 0; i < MAXP; i++) {
    const row = h('div', 'sl-slot empty', null, slots);
    const sw = h('span', 'sl-sw', null, row);
    const cs = h('span', 'sl-cs', CALLSIGNS[i] || 'CREW ' + (i + 1), row);
    const nm = h('span', 'sl-nm', 'awaiting signal', row);
    const tag = h('span', 'sl-tag', '', row);
    E.slots.push({ row, sw, cs, nm, tag });
  }
  E.lHost = h('div', 'sl-lhost', null, p);
  h('div', 'sl-label', 'CHAPTER', E.lHost);
  E.lChapters = h('div', 'sl-chapters', null, E.lHost);
  E.lWait = h('div', 'sl-lwait', 'Waiting for host…', p);
  const row = h('div', 'sl-row', null, p);
  E.lStart = button('START', () => {
    E.lStart.disabled = true;
    clearTimeout(startLockT);
    startLockT = setTimeout(() => { E.lStart.disabled = false; }, 2000);
    if (selChapter === -1) {
      const n = clamp(Math.floor(num(lobby.unlocked, 1)), 1, CHAPTERS.length);
      emit('start', { levelIndex: clamp(Math.floor(num(lobby.saveLevelIndex, n - 1)), 0, CHAPTERS.length - 1), continue: true });
    } else emit('start', { levelIndex: selChapter });
  }, 'primary', row);
  button('LEAVE', () => emit('leave'), 'ghost', row);
  E.lStatus = h('div', 'sl-status', '', p);
}
function renderChapters() {
  const n = clamp(Math.floor(num(lobby.unlocked, 1)), 1, CHAPTERS.length);
  const withContinue = !!(lobby.hasSave || lobby.canContinue);
  const key = n + (withContinue ? 'c' : '');
  if (selChapter >= n) selChapter = n - 1;
  if (selChapter < 0 && !withContinue) selChapter = 0;
  if (key !== chapterCount) {
    chapterCount = key;
    E.lChapters.textContent = '';
    if (withContinue) {
      const b = button('CONTINUE · LAST CHECKPOINT', () => { selChapter = -1; renderChapters(); }, 'small sl-chap', E.lChapters);
      b.dataset.i = '-1';
    }
    for (let i = 0; i < n; i++) {
      const b = button('CHAPTER ' + CHAPTERS[i], () => { selChapter = i; renderChapters(); }, 'small sl-chap', E.lChapters);
      b.dataset.i = String(i);
    }
  }
  for (const b of E.lChapters.children) b.classList.toggle('sel', Number(b.dataset.i) === selChapter);
}
function renderLobby() {
  if (!E.lCode) return;
  const L = lobby;
  const code = L.code ? String(L.code).toUpperCase() : '';
  E.lCode.textContent = code || '·····';
  E.lCodeWrap.classList.toggle('nocode', !code);
  E.lHint.textContent = code ? 'Send this code to your crew' : 'Opening a channel…';
  const players = Array.isArray(L.players) ? L.players : [];
  for (let i = 0; i < E.slots.length; i++) {
    const s = E.slots[i];
    const pl = players[i];
    if (pl) {
      const col = cssColor(pl.color, i);
      s.row.classList.remove('empty');
      s.sw.style.background = col;
      s.cs.textContent = pl.callsign || CALLSIGNS[i] || '';
      s.cs.style.color = col;
      s.nm.textContent = pl.name || 'Crew';
      s.tag.textContent = pl.isHost ? 'HOST' : (pl.isLocal || pl.you ? 'YOU' : '');
      if (pl.name) nameColors.set(String(pl.name), col);
    } else {
      s.row.classList.add('empty');
      s.sw.style.background = '';
      s.cs.textContent = CALLSIGNS[i] || '';
      s.cs.style.color = '';
      s.nm.textContent = 'awaiting signal';
      s.tag.textContent = '';
    }
  }
  E.lHost.style.display = L.isHost ? '' : 'none';
  E.lStart.style.display = L.isHost ? '' : 'none';
  E.lWait.style.display = L.isHost ? 'none' : '';
  renderChapters();
  const st = L.status ? String(L.status) : '';
  E.lStatus.textContent = st;
  E.lStatus.classList.toggle('err', isErr(st));
}
const isErr = (s) => /error|fail|could not|couldn't|not found|lost|full|refused|timed? ?out|invalid/i.test(String(s || ''));

function buildSettings() {
  const s = screen('settings', 'crt');
  const p = h('div', 'sl-panel', null, s);
  h('div', 'sl-kicker', '// SYSTEM', p);
  h('h2', 'sl-h', 'SETTINGS', p);
  const f1 = field(p, 'NAME');
  const nm = E.sName = h('input', 'sl-input', null, f1);
  nm.type = 'text'; nm.maxLength = 16; nm.autocomplete = 'off'; nm.spellcheck = false;
  isolateKeys(nm);
  let nameT = 0;
  nm.addEventListener('input', () => { clearTimeout(nameT); nameT = setTimeout(() => commitName(nm.value), 400); });
  nm.addEventListener('change', () => { clearTimeout(nameT); commitName(nm.value); nm.value = loadSettings().name; });
  nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') nm.blur(); });
  const f2 = field(p, 'MASTER VOLUME');
  E.sVol = range(f2, 0, 100, 1);
  E.sVolV = h('span', 'sl-val', '', f2);
  E.sVol.addEventListener('input', () => { updateSettings({ volume: num(E.sVol.value, 80) / 100 }); syncSettingsUI(); });
  const f3 = field(p, 'MOUSE SENSITIVITY');
  E.sSens = range(f3, 30, 300, 5);
  E.sSensV = h('span', 'sl-val', '', f3);
  E.sSens.addEventListener('input', () => { updateSettings({ sensitivity: num(E.sSens.value, 100) / 100 }); syncSettingsUI(); });
  const f4 = field(p, 'QUALITY');
  const seg = h('div', 'sl-seg', null, f4);
  E.sHigh = button('HIGH', () => { updateSettings({ quality: 'high' }); syncSettingsUI(); }, 'small', seg);
  E.sLow = button('LOW', () => { updateSettings({ quality: 'low' }); syncSettingsUI(); }, 'small', seg);
  const row = h('div', 'sl-row', null, p);
  button('BACK', () => {
    commitName(E.sName.value);
    const ret = settingsReturn && settingsReturn !== 'settings' ? settingsReturn : 'menu';
    showScreen(ret);
  }, 'ghost', row);
}
function syncSettingsUI() {
  if (!E.sVol) return;
  const s = loadSettings();
  if (document.activeElement !== E.sName) E.sName.value = s.name;
  if (document.activeElement !== E.joinName && E.joinName) E.joinName.value = s.name;
  E.sVol.value = String(Math.round(s.volume * 100));
  E.sVol.style.setProperty('--p', Math.round(s.volume * 100) + '%');
  E.sVolV.textContent = Math.round(s.volume * 100) + '%';
  E.sSens.value = String(Math.round(s.sensitivity * 100));
  E.sSens.style.setProperty('--p', ((s.sensitivity - 0.3) / 2.7 * 100).toFixed(1) + '%');
  E.sSensV.textContent = s.sensitivity.toFixed(2) + '×';
  E.sHigh.classList.toggle('sel', s.quality === 'high');
  E.sLow.classList.toggle('sel', s.quality === 'low');
}

function buildLoading() {
  const s = screen('loading');
  const w = h('div', 'sl-load', null, s);
  E.loadText = h('div', 'sl-load-t', 'LOADING', w);
  E.loadFlavor = h('div', 'sl-load-f', '', w);
  E.loadBar = h('div', 'sl-load-bar indet', null, w);
  E.loadFill = h('i', null, null, E.loadBar);
}
let flavorT = 0, flavorSwapT = 0, flavorI = 0;
function startFlavor() {
  stopFlavor();
  flavorI = Math.floor(Math.random() * FLAVOR.length);
  E.loadFlavor.textContent = FLAVOR[flavorI];
  E.loadFlavor.classList.remove('swap');
  flavorT = setInterval(() => {
    E.loadFlavor.classList.add('swap');
    clearTimeout(flavorSwapT);
    flavorSwapT = setTimeout(() => {
      flavorI = (flavorI + 1) % FLAVOR.length;
      E.loadFlavor.textContent = FLAVOR[flavorI];
      E.loadFlavor.classList.remove('swap');
    }, 450);
  }, 2900);
}
function stopFlavor() { clearInterval(flavorT); clearTimeout(flavorSwapT); flavorT = 0; }

function buildPause() {
  const s = screen('pause', 'crt');
  const p = h('div', 'sl-pause-p', null, s);
  h('div', 'sl-kicker', '// TRANSMISSION HELD', p);
  h('h2', 'sl-h big', 'PAUSED', p);
  E.pCode = h('div', 'sl-pcode', '', p);
  const nav = h('nav', 'sl-menu-nav', null, p);
  menuItem(nav, 'RESUME', () => emit('resume'));
  menuItem(nav, 'SETTINGS', () => showScreen('settings'));
  menuItem(nav, 'QUIT TO MENU', () => emit('quit'));
  renumber(nav);
}

function buildGameover() {
  const s = screen('gameover', 'crt');
  const p = h('div', 'sl-over-p', null, s);
  const t = h('h1', 'sl-over-t sl-glitch hard', 'SIGNAL LOST', p);
  t.setAttribute('data-text', 'SIGNAL LOST');
  h('div', 'sl-tagline', 'The dark keeps what it takes.', p);
  const row = h('div', 'sl-row center', null, p);
  E.gRetry = button('RETRY FROM CHECKPOINT', () => emit('retry'), 'primary', row);
  E.gWait = h('div', 'sl-lwait inline', 'Waiting for host…', row);
  button('QUIT', () => emit('quit'), 'ghost', row);
}

let creditsT = 0;
function buildCredits() {
  const s = screen('credits');
  const view = E.crView = h('div', 'sl-cr-view', null, s);
  const roll = E.crRoll = h('div', 'sl-cr-roll', null, view);
  h('div', 'sl-cr-title', C.title || 'STARLESS', roll);
  h('div', 'sl-cr-tag', C.tagline || '', roll);
  for (const entry of (C.credits || [])) {
    const role = Array.isArray(entry) ? entry[0] : entry && entry.role;
    const name = Array.isArray(entry) ? entry[1] : entry && entry.name;
    if (role) h('div', 'sl-cr-role', role, roll);
    if (name) h('div', 'sl-cr-name', name, roll);
  }
  h('div', 'sl-cr-role', 'Crew of the ICV Perihelion', roll);
  h('div', 'sl-cr-name', CALLSIGNS.join('  ·  '), roll);
  h('div', 'sl-cr-memo', 'In memory of the Kestrel expedition, 2063.', roll);
  h('div', 'sl-cr-memo dim', 'Some of the stars are still out there.', roll);
  E.crEnd = h('div', 'sl-cr-end', null, s);
  h('div', 'sl-cr-thanks', 'THANK YOU FOR PLAYING', E.crEnd);
  button('BACK TO MENU', () => emit('quit'), 'ghost', E.crEnd);
  button('SKIP', endCredits, 'small ghost sl-cr-skip', s);
}
function startCredits() {
  const s = E.scr.credits;
  s.classList.remove('done');
  clearTimeout(creditsT);
  const roll = E.crRoll;
  roll.style.animation = 'none';
  void roll.offsetHeight;
  const hgt = roll.offsetHeight || 1400;
  const vh = window.innerHeight || 800;
  const dur = clamp((hgt + vh) / 42, 16, 90);
  roll.style.setProperty('--dur', dur.toFixed(1) + 's');
  roll.style.animation = '';
  creditsT = setTimeout(endCredits, dur * 1000 + 200);
}
function endCredits() { clearTimeout(creditsT); if (E.scr.credits) E.scr.credits.classList.add('done'); }

function makeNoise() {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = (Math.random() * 46) | 0;
    }
    g.putImageData(img, 0, 0);
    R.style.setProperty('--sl-noise', 'url("' + c.toDataURL() + '")');
  } catch (e) { /* ignore */ }
}
function isTouchOnly() {
  try { return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches; } catch (e) { return false; }
}

// ---- per-frame (vignette decay + subtitle timing) ----
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, Math.max(0, (t - lastT) / 1000) || 0);
  lastT = t;
  try {
    if (vig > 0) vig = Math.max(0, vig - dt * (0.8 + vig * 1.3));
    const vr = Math.round(vig * 100) / 100;
    if (vr !== vigShown) { vigShown = vr; E.vig.style.opacity = String(vr); }
    if (subCur && now() >= subCur.end) advanceSub();
  } catch (e) { /* never break */ }
}

// ---- subtitles ----
const subQ = [];
let subCur = null;
function advanceSub() {
  const s = subQ.shift();
  if (!s) { subCur = null; E.subs.classList.remove('on'); return; }
  subCur = s;
  s.end = now() + s.dur * 1000;
  const spk = s.speaker.toUpperCase();
  E.subSpk.textContent = spk;
  E.subSpk.style.display = spk ? '' : 'none';
  const ci = CALLSIGNS.indexOf(spk);
  E.subSpk.style.color = ci >= 0 ? (COLORS[ci] || '') : '';
  E.subTxt.textContent = s.text;
  E.subs.classList.remove('swap');
  void E.subs.offsetWidth;
  E.subs.classList.add('on', 'swap');
}
function clearSubs() { subQ.length = 0; subCur = null; if (E.subs) E.subs.classList.remove('on'); }

// ---- objective typewriter ----
let objTarget = null, objTimer = 0, pingT = 0;
function setObjective(text) {
  ensure();
  const t = text == null ? '' : String(text);
  if (t === objTarget) return;
  objTarget = t;
  clearInterval(objTimer);
  clearTimeout(pingT);
  if (!t) { E.obj.classList.remove('on', 'typing', 'ping'); E.objText.textContent = ''; return; }
  E.obj.classList.add('on', 'typing');
  E.obj.classList.remove('ping');
  void E.obj.offsetWidth;
  E.obj.classList.add('ping');
  pingT = setTimeout(() => E.obj.classList.remove('ping'), 1600);
  let i = 0;
  const step = t.length > 90 ? 2 : 1;
  E.objText.textContent = '';
  objTimer = setInterval(() => {
    i = Math.min(t.length, i + step);
    E.objText.textContent = t.slice(0, i);
    if (i % 4 === 0 && current === 'hud') sfx('typing', { volume: 0.22 });
    if (i >= t.length) { clearInterval(objTimer); E.obj.classList.remove('typing'); }
  }, 26);
}

// ---- prompt ----
let lastPrompt = null, lastProg = -1;
function setPrompt(text, progress) {
  ensure();
  const t = text ? String(text) : '';
  if (t !== lastPrompt) {
    lastPrompt = t;
    if (t) E.promptText.textContent = t;
    E.prompt.classList.toggle('on', !!t);
  }
  const p = t ? Math.round(clamp(num(progress, 0), 0, 1) * 200) / 200 : 0;
  if (p !== lastProg) {
    lastProg = p;
    E.hold.classList.toggle('on', p > 0);
    E.holdFill.style.width = (p * 100).toFixed(1) + '%';
  }
}

// ---- vitals ----
function hpColor(v) {
  const k = clamp((60 - v) / 45, 0, 1);
  const r = Math.round(216 + (255 - 216) * k), g = Math.round(212 + (59 - 212) * k), b = Math.round(200 + (59 - 200) * k);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}
function setVitals(v) {
  ensure();
  if (!v || typeof v !== 'object') return;
  for (const k in E.v) {
    if (!(k in v)) continue;
    const val = Number(v[k]);
    if (!Number.isFinite(val)) continue;
    const r = Math.round(clamp(val, 0, 100));
    const ent = E.v[k];
    if (r === ent.last) continue;
    ent.last = r;
    ent.fill.style.width = r + '%';
    ent.num.textContent = String(r).padStart(3, '0');
    if (k === 'health') {
      ent.row.style.setProperty('--c', hpColor(r));
      ent.row.classList.toggle('low', r < 20);
      R.classList.toggle('lowhp', r < 30 && r > 0);
    } else if (k === 'oxygen') ent.row.classList.toggle('low', r < 25);
    else if (k === 'battery') ent.row.classList.toggle('low', r < 15);
    else if (k === 'stamina') ent.row.classList.toggle('low', r < 15);
  }
}

// ---- team ----
function setTeam(list) {
  ensure();
  const arr = Array.isArray(list) ? list : [];
  if (arr.length !== E.teamRows.length) {
    E.team.textContent = '';
    E.teamRows = arr.map(() => {
      const row = h('div', 'sl-tm', null, E.team);
      const cs = h('span', 'sl-tm-cs', '', row);
      const nm = h('span', 'sl-tm-nm', '', row);
      const dn = h('span', 'sl-tm-dn', 'DOWNED', row);
      const hb = h('div', 'sl-tm-hb', null, row);
      const fill = h('i', null, null, hb);
      return { row, cs, nm, dn, fill, key: '' };
    });
  }
  E.team.classList.toggle('on', arr.length > 0);
  arr.forEach((m, i) => {
    const r = E.teamRows[i];
    if (!m || !r) return;
    const ci = CALLSIGNS.indexOf(String(m.callsign || '').toUpperCase());
    const col = cssColor(m.color != null ? m.color : (ci >= 0 ? COLORS[ci] : null), ci >= 0 ? ci : i);
    const hp = Math.round(clamp(num(m.health, 100), 0, 100));
    const key = [m.callsign, m.name, col, hp, !!m.downed].join('|');
    if (key === r.key) return;
    r.key = key;
    r.cs.textContent = String(m.callsign || CALLSIGNS[i] || '');
    r.cs.style.color = col;
    r.nm.textContent = String(m.name || '');
    r.fill.style.width = hp + '%';
    r.row.classList.toggle('down', !!m.downed);
    r.row.classList.toggle('low', hp < 30);
    if (m.name) nameColors.set(String(m.name), col);
    if (m.callsign) nameColors.set(String(m.callsign), col);
  });
}

// ---- chat ----
function openChat() {
  ensure();
  if (current !== 'hud') return;
  chatOpen = true;
  R.classList.add('chatting');
  E.chatInput.value = '';
  setTimeout(() => { if (!chatOpen) return; E.chatInput.value = ''; try { E.chatInput.focus({ preventScroll: true }); } catch (e) { E.chatInput.focus(); } }, 0);
}
function closeChat() {
  if (!R) return;
  chatOpen = false;
  R.classList.remove('chatting');
  if (E.chatInput) { E.chatInput.value = ''; if (document.activeElement === E.chatInput) E.chatInput.blur(); }
}
function chatMessage(name, text) {
  ensure();
  const row = h('div', 'sl-cm', null, E.chatLog);
  const n = name == null || name === '' ? '???' : String(name);
  const nm = h('span', 'sl-cm-n', n, row);
  // main.js sends the callsign as the chat name -> fall back to the callsign colour
  const ci = CALLSIGNS.indexOf(n.toUpperCase());
  const col = nameColors.get(n) || (ci >= 0 ? COLORS[ci] : null);
  if (col) nm.style.color = col;
  h('span', 'sl-cm-t', String(text == null ? '' : text), row);
  while (E.chatLog.children.length > 6) E.chatLog.firstChild.remove();
  setTimeout(() => row.classList.add('old'), 8000);
}

// ---- screens ----
function showScreen(name, data) {
  ensure();
  if (SCREENS.indexOf(name) < 0) { console.warn('[ui] unknown screen', name); name = 'none'; }
  const prev = current;
  if (name === 'settings' && prev !== 'settings') settingsReturn = (prev === 'none' || prev === 'loading' || prev === 'hud') ? (prev === 'hud' ? 'pause' : 'menu') : prev;
  if (data !== undefined) screenData[name] = data;
  const d = screenData[name];
  current = name;
  R.classList.remove('scr-' + prev);
  R.classList.add('scr-' + name);
  for (const k in E.scr) E.scr[k].classList.toggle('on', k === name);
  if (name !== 'hud' && chatOpen) closeChat();
  const ae = document.activeElement;
  if (ae && ae !== document.body && R.contains(ae) && !(E.scr[name] && E.scr[name].contains(ae))) { try { ae.blur(); } catch (e) { /* ignore */ } }
  if (prev === 'loading' && name !== 'loading') stopFlavor();
  if (prev === 'credits' && name !== 'credits') clearTimeout(creditsT);
  // A chapter card must never linger behind menu/loading/game-over screens (CSS also hides it on pause/settings).
  if (CARD_KILL.indexOf(name) >= 0) dismissCard();
  // Stale level dialogue must not bleed into loading screens or lag a cutscene's own timed lines.
  if (name !== prev && SUB_KILL.indexOf(name) >= 0) clearSubs();
  try {
    switch (name) {
      case 'menu':
        if (prev !== 'menu') resetSession();
        E.mContinue.style.display = d && (d.hasSave || d.canContinue) ? '' : 'none';
        renumber(E.mNav);
        break;
      case 'join':
        E.joinName.value = loadSettings().name;
        E.joinBtn.disabled = false;
        if (prev !== 'join') setJoinStatus('');
        setTimeout(() => { if (current === 'join') E.joinCode.focus(); }, 60);
        break;
      case 'lobby':
        if (prev !== 'lobby') resetSession();
        if (data && typeof data === 'object') setLobby(data); else renderLobby();
        break;
      case 'settings':
        syncSettingsUI();
        break;
      case 'loading':
        if (prev !== 'loading') { startFlavor(); if (data === undefined) applyLoading('LOADING', undefined); }
        if (d && typeof d === 'object' && data !== undefined) applyLoading(d.text, d.progress != null ? d.progress : d.p);
        else if (typeof data === 'string') applyLoading(data, undefined);
        break;
      case 'pause':
        E.pCode.textContent = d && d.code ? 'CREW CODE  ' + String(d.code).toUpperCase() : '';
        break;
      case 'gameover': {
        const canRetry = !d || (d.canRetry != null ? !!d.canRetry : (d.solo || d.isHost || d.isHost === undefined));
        E.gRetry.style.display = canRetry ? '' : 'none';
        E.gWait.style.display = canRetry ? 'none' : '';
        break;
      }
      case 'credits':
        startCredits();
        break;
      default: break;
    }
  } catch (e) { console.error('[ui] showScreen', name, e); }
}
// Clear per-session HUD/cinematic leftovers (e.g. after quitting mid-level or a skipped cutscene).
function resetSession() {
  R.classList.remove('letterbox', 'skiphint', 'downed', 'lowhp', 'chatting');
  setObjective(null);
  setPrompt(null);
  setTeam([]);
  clearSubs();
  E.chatLog.textContent = '';
  E.downT.textContent = '';
  vig = 0;
  for (const k in E.v) E.v[k].last = -1;
}
function applyLoading(text, p) {
  if (text != null) E.loadText.textContent = String(text);
  const pv = Number(p);
  if (p == null || !Number.isFinite(pv)) {
    E.loadBar.classList.add('indet');
    E.loadFill.style.width = '';
  } else {
    E.loadBar.classList.remove('indet');
    E.loadFill.style.width = (clamp(pv, 0, 1) * 100).toFixed(1) + '%';
  }
}

function setLobby(d) {
  ensure();
  if (!d || typeof d !== 'object') return;
  for (const k of ['code', 'players', 'isHost', 'unlocked', 'status', 'hasSave', 'canContinue', 'saveLevelIndex']) if (k in d) lobby[k] = d[k];
  // main.js sends the checkpoint as { save: { levelIndex } }
  if (!('saveLevelIndex' in d) && 'save' in d) lobby.saveLevelIndex = d.save && typeof d.save === 'object' ? d.save.levelIndex : undefined;
  if ('levelIndex' in d && Number.isFinite(Number(d.levelIndex))) selChapter = Number(d.levelIndex) | 0;
  renderLobby();
  if ('status' in d) {
    setJoinStatus(d.status ? String(d.status) : '', isErr(d.status));
    if (E.joinBtn && isErr(d.status)) { E.joinBtn.disabled = false; clearTimeout(joinT); }
  }
}

// ---- cinematic ----
let cardT1 = 0, cardT2 = 0, cardResolve = null;
const CARD_KILL = ['menu', 'lobby', 'join', 'loading', 'gameover', 'credits'];
const SUB_KILL = ['none', 'loading', 'lobby', 'gameover', 'credits'];
function dismissCard() {
  clearTimeout(cardT1); clearTimeout(cardT2);
  if (E.card) { E.card.classList.remove('on', 'out'); E.card.textContent = ''; }
  if (cardResolve) { const r = cardResolve; cardResolve = null; r(); }
}
function chapterCard(title, subtitle) {
  ensure();
  clearTimeout(cardT1); clearTimeout(cardT2);
  if (cardResolve) { const r = cardResolve; cardResolve = null; r(); }
  const card = E.card;
  card.textContent = '';
  card.classList.remove('on', 'out');
  const t = h('div', 'sl-card-t', null, card);
  const chars = Array.from(String(title == null ? '' : title));
  chars.forEach((ch, i) => {
    const s = h('span', null, ch === ' ' ? ' ' : ch, t);
    s.style.animationDelay = (0.2 + i * 0.075).toFixed(3) + 's';
  });
  h('div', 'sl-card-line', null, card);
  if (subtitle) h('div', 'sl-card-s', String(subtitle), card);
  void card.offsetWidth;
  card.classList.add('on');
  const reveal = 0.2 + chars.length * 0.075 + 1.4;
  const hold = reveal + 4;
  return new Promise((resolve) => {
    cardResolve = resolve;
    cardT1 = setTimeout(() => {
      card.classList.add('out');
      cardT2 = setTimeout(() => {
        card.classList.remove('on', 'out'); card.textContent = '';
        if (cardResolve === resolve) cardResolve = null;
        resolve();
      }, 1500);
    }, hold * 1000);
  });
}
function fade(toBlack, seconds) {
  ensure();
  const s = seconds == null ? 1 : Math.max(0, num(seconds, 1));
  E.fade.style.transition = 'opacity ' + s + 's ease';
  E.fade.style.opacity = toBlack ? '1' : '0';
  return new Promise((resolve) => setTimeout(resolve, s * 1000 + 20));
}

// ---- init ----
function init(root) {
  if (R) return ui;
  const host = root || document.getElementById('ui') || document.body;
  R = h('div', 'sl-root scr-none', null, host);
  makeNoise();
  E.vig = h('div', 'sl-vig', null, R);
  h('div', 'sl-lowhp', null, R);
  buildHud();
  buildOverlays();
  buildMenu();
  buildJoin();
  buildLobby();
  buildSettings();
  buildLoading();
  buildPause();
  buildGameover();
  buildCredits();
  E.notes = h('div', 'sl-notes', null, R);
  if (isTouchOnly()) R.classList.add('touchonly');
  loadSettings();
  syncSettingsUI();
  renderLobby();
  requestAnimationFrame(loop);
  return ui;
}

const recentNotes = new Map();
export const ui = {
  init,
  showScreen,
  onAction(fn) {
    if (typeof fn !== 'function') return () => {};
    actionFns.push(fn);
    return () => { const i = actionFns.indexOf(fn); if (i >= 0) actionFns.splice(i, 1); };
  },
  setLobby,
  setObjective,
  setPrompt,
  setVitals,
  setTeam,
  subtitle(speaker, text, seconds) {
    ensure();
    if ((speaker == null || speaker === '') && (text == null || text === '')) { clearSubs(); return; }
    const txt = String(text == null ? '' : text);
    const sec = num(seconds, 0);
    const dur = sec > 0 ? sec : clamp(1.4 + txt.length * 0.06, 2.2, 9);
    subQ.push({ speaker: speaker == null ? '' : String(speaker), text: txt, dur, end: 0 });
    if (subQ.length > 8) subQ.splice(0, subQ.length - 8);
    if (!subCur || subCur.end - now() < 350) advanceSub();
  },
  clearSubtitles: () => { ensure(); clearSubs(); },
  notify(text, seconds) {
    ensure();
    const t = String(text == null ? '' : text);
    if (!t) return;
    const n = now();
    if (recentNotes.has(t) && n - recentNotes.get(t) < 1200) return;
    recentNotes.set(t, n);
    if (recentNotes.size > 30) recentNotes.clear();
    const el = h('div', 'sl-note', t, E.notes);
    while (E.notes.children.length > 4) E.notes.firstChild.remove();
    const s = Math.max(0.8, num(seconds, 3.5));
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 600); }, s * 1000);
  },
  chapterCard,
  fade,
  letterbox(on) { ensure(); R.classList.toggle('letterbox', !!on); },
  damageFlash(v) {
    ensure();
    const a = v == null ? 0.6 : num(v, 0.6);
    vig = clamp(Math.max(vig, a > 1 ? 1 : a), 0, 1);
  },
  setDowned(on, secondsLeft) {
    ensure();
    R.classList.toggle('downed', !!on);
    const s = Number(secondsLeft);
    E.downT.textContent = on && secondsLeft != null && Number.isFinite(s) ? 'SIGNAL FADES IN ' + Math.max(0, Math.ceil(s)) + 's' : '';
  },
  chatMessage,
  onChat(fn) {
    if (typeof fn !== 'function') return () => {};
    chatFns.push(fn);
    return () => { const i = chatFns.indexOf(fn); if (i >= 0) chatFns.splice(i, 1); };
  },
  openChat,
  closeChat: () => closeChat(),
  isChatOpen: () => chatOpen,
  showLoading(text, p) {
    ensure();
    if (current !== 'loading') showScreen('loading');
    applyLoading(text, p);
  },
  getSettings() { return { ...loadSettings() }; },
  skipHint(on) {
    ensure();
    R.classList.toggle('skiphint', !!on);
    const p = typeof on === 'number' ? clamp(on, 0, 1) : 0;
    E.skipFill.style.width = (p * 100).toFixed(1) + '%';
  },
  setLockHint(on) { ensure(); R.classList.toggle('lockhint', !!on); },
  getScreen: () => current,
};
export default ui;
