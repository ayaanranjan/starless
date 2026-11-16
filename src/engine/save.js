// STARLESS — save.js (GAME). localStorage persistence.
// Save object: { levelIndex, levelSave, unlocked, t }
// `unlocked` = highest chapter reached (1..3). Also mirrored under its own key so
// clients (who never write a checkpoint) and clear() keep their unlocked chapters.

const KEY = 'starless.save';
const UKEY = 'starless.unlocked';

function readRaw() {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const d = JSON.parse(s);
    return d && typeof d === 'object' ? d : null;
  } catch (e) {
    return null;
  }
}

function readUnlockedKey() {
  try {
    const n = parseInt(localStorage.getItem(UKEY), 10);
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    return 0;
  }
}

/** Returns the checkpoint save or null. */
export function load() {
  const d = readRaw();
  if (!d || !Number.isFinite(+d.levelIndex) || +d.levelIndex < 0) return null;
  return {
    levelIndex: Math.floor(+d.levelIndex),
    levelSave: d.levelSave === undefined ? null : d.levelSave,
    unlocked: Math.max(1, +d.unlocked || 0, readUnlockedKey()),
    t: +d.t || 0,
  };
}

/** Stores a checkpoint. data = { levelIndex, levelSave, unlocked? }. Returns true on success. */
export function save(data) {
  if (!data || !Number.isFinite(+data.levelIndex)) return false;
  const levelIndex = Math.max(0, Math.floor(+data.levelIndex));
  const unlocked = Math.max(getUnlocked(), +data.unlocked || 0, levelIndex + 1);
  const out = {
    levelIndex,
    levelSave: data.levelSave === undefined ? null : data.levelSave,
    unlocked,
    t: Date.now(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(out));
    localStorage.setItem(UKEY, String(unlocked));
    return true;
  } catch (e) {
    console.warn('[save] could not write save', e);
    return false;
  }
}

/** Removes the checkpoint (keeps unlocked chapters). */
export function clear() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

/** Highest chapter reached (>= 1). */
export function getUnlocked() {
  const d = readRaw();
  return Math.max(1, readUnlockedKey(), (d && +d.unlocked) || 0);
}

/** Raises the unlocked chapter count (never lowers it). */
export function setUnlocked(n) {
  n = Math.floor(+n || 0);
  const cur = getUnlocked();
  if (n <= cur) return cur;
  try {
    localStorage.setItem(UKEY, String(n));
    const d = readRaw();
    if (d) { d.unlocked = n; localStorage.setItem(KEY, JSON.stringify(d)); }
  } catch (e) { /* ignore */ }
  return n;
}

export const saveStore = { load, save, clear, getUnlocked, setUnlocked };
export default saveStore;
