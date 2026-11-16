// STARLESS — keyboard / mouse / pointer-lock input (ENGINE)
// Codes are KeyboardEvent.code ('KeyW', 'Space', 'ShiftLeft', ...) plus 'Mouse0' | 'Mouse1' | 'Mouse2'.

const down = new Set();      // gameplay held keys
const edge = new Set();      // gameplay pressed this frame
const rawDownSet = new Set();
const rawEdge = new Set();   // pressed this frame regardless of `enabled` / typing
const lockFns = new Set();
const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

let dx = 0, dy = 0;
let canvasEl = null;
let inited = false;
let lockedAt = 0;
let wasLocked = false;
// pointer-lock fallback: drag-to-look when lock is unavailable (sandboxed iframe, automation, ?test)
const TEST_MODE = (() => { try { return /test/i.test(location.search || ''); } catch (e) { return false; } })();
let dragLookOverride = null;   // set via `input.dragLook = bool`
let dragOk = false;            // a drag started on a non-control element
let lastGestureAt = -1e9, unlockedAt = -1e9, reqHadGesture = false;

function dragLookActive() {
  return dragLookOverride != null ? !!dragLookOverride : (TEST_MODE || input.lockFailed === true);
}
function isControl(t) {
  if (!t || !t.tagName) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A' || tag === 'LABEL' || !!t.isContentEditable;
}
function hasGesture() {
  try {
    const ua = navigator.userActivation;
    if (ua && typeof ua.isActive === 'boolean') return ua.isActive;
  } catch (e) { /* ignore */ }
  return performance.now() - lastGestureAt < 1500;
}
// Only a failure that happened with a user gesture (and not inside Chrome's ~1s re-lock cooldown) counts.
function markLockFailure(gesture) {
  if (!gesture) return;
  if (performance.now() - unlockedAt < 1300) return;
  if (!input.lockFailed) console.warn('[input] pointer lock unavailable — drag with a mouse button held to look');
  input.lockFailed = true;
}

function typingTarget(e) {
  const t = e && e.target;
  if (!t || t === document.body) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
}

function isLockedNow() {
  return !!document.pointerLockElement && (!canvasEl || document.pointerLockElement === canvasEl);
}

function clearHeld() {
  down.clear();
  rawDownSet.clear();
}

function onKeyDown(e) {
  const code = e.code;
  if (!code) return;
  if (!e.repeat) { rawEdge.add(code); lastGestureAt = performance.now(); }
  rawDownSet.add(code);
  if (typingTarget(e)) return;
  const captured = isLockedNow() || (dragLookActive() && input.enabled !== false && !isControl(e.target));
  if (captured && (PREVENT.has(code) || (e.ctrlKey && (code === 'KeyS' || code === 'KeyD' || code === 'KeyF' || code === 'KeyC')))) {
    e.preventDefault();
  }
  if (!e.repeat && !down.has(code)) edge.add(code);
  down.add(code);
}

function onKeyUp(e) {
  const code = e.code;
  if (!code) return;
  rawDownSet.delete(code);
  down.delete(code);
  if (isLockedNow() && PREVENT.has(code)) e.preventDefault();
}

function onMouseDown(e) {
  const code = 'Mouse' + e.button;
  rawEdge.add(code);
  rawDownSet.add(code);
  lastGestureAt = performance.now();
  if (!isLockedNow()) { dragOk = !isControl(e.target); return; } // gameplay mouse buttons only while captured
  if (!down.has(code)) edge.add(code);
  down.add(code);
}

function onMouseUp(e) {
  const code = 'Mouse' + e.button;
  rawDownSet.delete(code);
  down.delete(code);
  if (!(e.buttons > 0)) dragOk = false;
}

let lastCX = null, lastCY = null;
function onMouseMove(e) {
  let mx, my;
  if (isLockedNow()) {
    // Chrome sometimes emits a huge spike right after locking — ignore the first few ms.
    if (performance.now() - lockedAt < 60) return;
    mx = e.movementX || 0; my = e.movementY || 0;
  } else {
    // drag-look fallback: accumulate movement only while a mouse button is held
    const cx = e.clientX, cy = e.clientY;
    const pcx = lastCX, pcy = lastCY;
    lastCX = cx; lastCY = cy;
    if (!dragLookActive() || !dragOk) return;
    const held = typeof e.buttons === 'number' ? e.buttons > 0
      : (rawDownSet.has('Mouse0') || rawDownSet.has('Mouse1') || rawDownSet.has('Mouse2'));
    if (!held) { dragOk = false; return; }
    if (typeof e.movementX === 'number') { mx = e.movementX; my = e.movementY || 0; }
    else { mx = pcx == null ? 0 : cx - pcx; my = pcy == null ? 0 : cy - pcy; }
  }
  if (mx > 300) mx = 300; else if (mx < -300) mx = -300;
  if (my > 300) my = 300; else if (my < -300) my = -300;
  dx += mx; dy += my;
  // safety cap if endFrame() is not being called
  if (dx > 4000) dx = 4000; else if (dx < -4000) dx = -4000;
  if (dy > 4000) dy = 4000; else if (dy < -4000) dy = -4000;
}

function onLockChange() {
  const l = isLockedNow();
  if (l === wasLocked) return;
  wasLocked = l;
  if (l) { lockedAt = performance.now(); input.lockFailed = false; }
  else { unlockedAt = performance.now(); clearHeld(); dx = 0; dy = 0; }
  for (const fn of lockFns) {
    try { fn(l); } catch (err) { console.error('[input] lock listener', err); }
  }
}

function onContextMenu(e) {
  if (isLockedNow()) e.preventDefault();
}

export const input = {
  enabled: true,
  // true once a gesture-backed requestPointerLock failed ('pointerlockerror' / rejected promise / unsupported)
  lockFailed: false,
  // true when lockFailed or the URL contains 'test': while not locked, mouseDelta() returns drag deltas
  // (mouse moved with a button held). Assignable to force it on/off; assign null to return to auto.
  get dragLook() { return dragLookActive(); },
  set dragLook(v) { dragLookOverride = v == null ? null : !!v; },

  init(canvas) {
    if (canvas) canvasEl = canvas;
    if (inited) return input;
    inited = true;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('blur', () => { clearHeld(); dx = 0; dy = 0; dragOk = false; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearHeld(); dx = 0; dy = 0; } });
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', () => {
      console.warn('[input] pointer lock failed');
      markLockFailure(reqHadGesture || hasGesture());
    });
    return input;
  },

  // gameplay queries (false while disabled)
  isDown(code) { return input.enabled !== false && down.has(code); },
  pressed(code) { return input.enabled !== false && edge.has(code); },
  // raw queries (always tracked: Escape / Enter / menus)
  rawDown(code) { return rawDownSet.has(code); },
  rawPressed(code) { return rawEdge.has(code); },
  anyPressed() { return edge.size > 0; },

  mouseDelta() {
    if (input.enabled === false) return { x: 0, y: 0 };
    return { x: dx, y: dy };
  },

  lock() {
    const el = canvasEl;
    if (!el || isLockedNow()) return;
    const gesture = hasGesture();
    reqHadGesture = gesture;
    if (typeof el.requestPointerLock !== 'function') { markLockFailure(true); return; }
    try {
      const p = el.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => { markLockFailure(gesture); });
    } catch (e) { markLockFailure(gesture); }
  },
  unlock() {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* ignore */ }
  },
  isLocked() { return isLockedNow(); },
  onLockChange(fn) {
    if (typeof fn !== 'function') return () => {};
    lockFns.add(fn);
    return () => lockFns.delete(fn);
  },

  endFrame() {
    edge.clear();
    rawEdge.clear();
    dx = 0; dy = 0;
  },

  reset() {
    clearHeld();
    edge.clear();
    rawEdge.clear();
    dx = 0; dy = 0;
  },
};

export default input;
