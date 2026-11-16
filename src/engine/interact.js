// STARLESS — interact.js (GAME). Hold/press-E interactables.
// ctx.interact.add({ id, object, radius, prompt, holdTime, enabled, onInteract(playerId) })
// onInteract runs ON THE HOST ONLY. Clients send {t:'interact', id, li} to the host.
import * as THREE from 'three';

const COS_CONE = Math.cos(55 * Math.PI / 180);
const NEAR_ANY_ANGLE = 1.3;
const _cam = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Interactables {
  constructor(ctx) {
    this.ctx = ctx;
    this.items = new Map();
    this.current = null;
    this.hold = 0;
    this.needRelease = false;
    this._prevDown = false;
    this._lastText = undefined;
    this._lastProg = -1;
  }

  add(def) {
    if (!def || def.id == null) { console.warn('[interact] add() needs an id', def); return null; }
    const id = String(def.id);
    const it = {
      id,
      object: def.object || null,
      position: def.position || null,
      radius: Number.isFinite(+def.radius) && +def.radius > 0 ? +def.radius : 2.2,
      prompt: def.prompt != null ? String(def.prompt) : 'Interact',
      holdTime: Math.max(0, +def.holdTime || 0),
      enabled: def.enabled !== false,
      onInteract: typeof def.onInteract === 'function' ? def.onInteract : null,
      localOnly: !!def.localOnly, // optional: run onInteract on the local peer instead of the host
    };
    if (this.current && this.current.id === id) this._reset();
    this.items.set(id, it);
    return id;
  }

  remove(id) {
    id = String(id);
    this.items.delete(id);
    if (this.current && this.current.id === id) this._reset();
  }

  setEnabled(id, on) {
    const it = this.items.get(String(id));
    if (!it) return;
    it.enabled = !!on;
    if (!it.enabled && this.current === it) this._reset();
  }

  setPrompt(id, text) {
    const it = this.items.get(String(id));
    if (it) it.prompt = text != null ? String(text) : '';
  }

  has(id) { return this.items.has(String(id)); }
  get(id) { return this.items.get(String(id)) || null; }

  clear() {
    this.items.clear();
    this._reset();
    this._show(null, 0);
  }

  /** HOST: run an interactable's handler for playerId. Returns true if it ran. */
  trigger(id, playerId) {
    const it = this.items.get(String(id));
    if (!it || !it.enabled || !it.onInteract) return false;
    try {
      it.onInteract(playerId);
    } catch (e) {
      console.error('[interact] onInteract failed for', id, e);
      try { this.ctx && this.ctx.reportError && this.ctx.reportError('interact "' + id + '"', e); } catch (_) { /* ignore */ }
    }
    return true;
  }

  update(dt) {
    dt = dt > 0 ? dt : 0;
    let target = null;
    let active = false;
    try {
      active = this._active();
      target = active ? this._findTarget() : null;
    } catch (e) {
      target = null;
    }
    const down = active && this._keyDown();
    const edge = down && !this._prevDown;
    this._prevDown = down;
    if (!down) this.needRelease = false;

    if (target !== this.current) { this.current = target; this.hold = 0; }
    if (!target) { this._show(null, 0); return; }

    let progress = 0;
    if (target.holdTime > 0) {
      if (down && !this.needRelease) {
        this.hold += dt;
        if (this.hold >= target.holdTime) {
          this.hold = 0;
          this.needRelease = true;
          this._complete(target);
        }
      } else {
        this.hold = 0;
      }
      progress = Math.min(1, this.hold / target.holdTime);
    } else if ((edge || this._pressed()) && !this.needRelease) {
      this.needRelease = true;
      this._complete(target);
    }

    // The handler may have removed/disabled it. (ui.js draws the [E] key cap itself.)
    if (this.items.get(target.id) === target && target.enabled) this._show(target.prompt, progress);
    else this._show(null, 0);
  }

  /** Hide the prompt now and forget the cached text, so it re-appears when the player looks again
   *  (main.js calls this on pause / game over instead of ui.setPrompt(null) directly). */
  hidePrompt() {
    this._reset();
    this._lastText = undefined;
    this._lastProg = -1;
    try { this.ctx && this.ctx.ui && this.ctx.ui.setPrompt && this.ctx.ui.setPrompt(null, 0); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- internals
  _reset() { this.current = null; this.hold = 0; }

  _active() {
    const ctx = this.ctx;
    if (!ctx || !ctx.camera || ctx.cinematic || ctx.paused || ctx.chatOpen) return false;
    if (ctx.gameState && ctx.gameState !== 'playing') return false;
    if (ctx.input && ctx.input.enabled === false) return false;
    const me = ctx.getLocalPlayer ? ctx.getLocalPlayer() : null;
    if (me && me.downed) return false;
    return true;
  }

  _keyDown() {
    try { return !!this.ctx.input.isDown('KeyE'); } catch (e) { return false; }
  }

  _pressed() {
    try { return !!(this.ctx.input.pressed && this.ctx.input.pressed('KeyE')); } catch (e) { return false; }
  }

  _pos(it, out) {
    const o = it.object;
    if (o) {
      if (o.isObject3D) {
        if (o.parent) o.getWorldPosition(out); else out.copy(o.position);
        return true;
      }
      if (Number.isFinite(o.x)) { out.set(o.x, o.y || 0, o.z || 0); return true; }
    }
    const p = it.position;
    if (p) {
      if (Array.isArray(p)) out.set(+p[0] || 0, +p[1] || 0, +p[2] || 0);
      else out.set(+p.x || 0, +p.y || 0, +p.z || 0);
      return true;
    }
    return false;
  }

  _findTarget() {
    const cam = this.ctx.camera;
    cam.getWorldPosition(_cam);
    cam.getWorldDirection(_fwd);
    const top = _cam.y;
    const bottom = _cam.y - 1.3; // body segment: eye down to roughly the knees
    let best = null;
    let bestScore = Infinity;
    for (const it of this.items.values()) {
      if (!it.enabled) continue;
      if (!this._pos(it, _p)) continue;
      const cy = _p.y > top ? top : (_p.y < bottom ? bottom : _p.y);
      const dx = _p.x - _cam.x, dy = _p.y - cy, dz = _p.z - _cam.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > it.radius) continue;
      const ex = _p.x - _cam.x, ey = _p.y - _cam.y, ez = _p.z - _cam.z;
      const len = Math.sqrt(ex * ex + ey * ey + ez * ez);
      const dot = len > 1e-4 ? (ex * _fwd.x + ey * _fwd.y + ez * _fwd.z) / len : 1;
      if (dot < COS_CONE && dist > NEAR_ANY_ANGLE) continue;
      const score = dist + (1 - dot) * 1.5;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  _complete(it) {
    const ctx = this.ctx;
    try { ctx.audio && ctx.audio.play && ctx.audio.play('interact', { volume: 0.5 }); } catch (e) { /* ignore */ }
    if (it.localOnly || ctx.isHost) {
      this.trigger(it.id, ctx.localId);
    } else {
      try { ctx.net && ctx.net.send && ctx.net.send({ t: 'interact', id: it.id, li: ctx.levelIndex }); }
      catch (e) { console.error('[interact] send failed', e); }
    }
  }

  _show(text, progress) {
    if (text === this._lastText && Math.abs(progress - this._lastProg) < 0.01) return;
    this._lastText = text;
    this._lastProg = progress;
    try { this.ctx && this.ctx.ui && this.ctx.ui.setPrompt && this.ctx.ui.setPrompt(text, progress); } catch (e) { /* ignore */ }
  }
}

export default Interactables;
