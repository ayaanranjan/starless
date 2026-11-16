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
  if (!e.repeat) rawEdge.add(code);
  rawDownSet.add(code);
  if (typingTarget(e)) return;
  if (isLockedNow() && (PREVENT.has(code) || (e.ctrlKey && (code === 'KeyS' || code === 'KeyD' || code === 'KeyF' || code === 'KeyC')))) {
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
  if (!isLockedNow()) return; // gameplay mouse buttons only while captured
  if (!down.has(code)) edge.add(code);
  down.add(code);
}

function onMouseUp(e) {
  const code = 'Mouse' + e.button;
  rawDownSet.delete(code);
  down.delete(code);
}

function onMouseMove(e) {
  if (!isLockedNow()) return;
  // Chrome sometimes emits a huge spike right after locking — ignore the first few ms.
  if (performance.now() - lockedAt < 60) return;
  let mx = e.movementX || 0, my = e.movementY || 0;
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
  if (l) lockedAt = performance.now();
  else { clearHeld(); dx = 0; dy = 0; }
  for (const fn of lockFns) {
    try { fn(l); } catch (err) { console.error('[input] lock listener', err); }
  }
}

function onContextMenu(e) {
  if (isLockedNow()) e.preventDefault();
}

export const input = {
  enabled: true,

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
    window.addEventListener('blur', () => { clearHeld(); dx = 0; dy = 0; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearHeld(); dx = 0; dy = 0; } });
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', () => { console.warn('[input] pointer lock failed'); });
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
    try {
      const p = el.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => { /* user gesture / cooldown — ignore */ });
    } catch (e) { /* ignore */ }
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
