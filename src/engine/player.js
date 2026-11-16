// STARLESS — local first-person player + remote astronaut avatars (ENGINE)
import * as THREE from 'three';

const RADIUS = 0.35, HEIGHT = 1.75, CROUCH_HEIGHT = 1.15, EYE = 1.62, CROUCH_EYE = 1.0;
const WALK = 3.4, SPRINT = 6.2, CROUCH_SPEED = 1.6, JUMP = 6;
const SENS = 0.0022, PITCH_LIMIT = 1.45;
const FLASH_INTENSITY = 220, FLASH_DIST = 55, FLASH_ANGLE = 0.42, FLASH_DECAY = 1.25;
const BATTERY_DRAIN = 0.16, BATTERY_RECHARGE = 0.4; // per second: ~10 min of light per charge; recharges while off

const GOD = (() => { try { return new URLSearchParams(location.search).has('god'); } catch (e) { return false; } })();

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const wrapAngle = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

// ------------------------------------------------------------------ flashlight cookie (procedural)
let cookieTex = null;
function makeCookie() {
  if (cookieTex) return cookieTex;
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2, R = S / 2;
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const grd = g.createRadialGradient(cx, cx, 0, cx, cx, R);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.1, 'rgba(255,252,244,1)');
  grd.addColorStop(0.24, 'rgba(240,232,214,0.86)');
  grd.addColorStop(0.42, 'rgba(214,204,186,0.62)');
  grd.addColorStop(0.62, 'rgba(170,162,146,0.42)');
  grd.addColorStop(0.82, 'rgba(110,104,94,0.22)');
  grd.addColorStop(0.95, 'rgba(40,38,34,0.06)');
  grd.addColorStop(1.0, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(cx, cx, R, 0, Math.PI * 2); g.fill();
  // reflector rings
  for (const [r, a, w] of [[0.16, 0.22, 3], [0.3, 0.12, 5], [0.5, 0.1, 4], [0.68, 0.08, 7], [0.86, 0.05, 5]]) {
    g.strokeStyle = `rgba(255,246,228,${a})`; g.lineWidth = w;
    g.beginPath(); g.arc(cx, cx, r * R, 0, Math.PI * 2); g.stroke();
  }
  g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 6;
  g.beginPath(); g.arc(cx, cx, 0.4 * R, 0, Math.PI * 2); g.stroke();
  // dirt & smudges on the lens
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * R * 0.92;
    const x = cx + Math.cos(a) * d, y = cx + Math.sin(a) * d, rr = 2 + Math.random() * 11;
    const gg = g.createRadialGradient(x, y, 0, x, y, rr);
    gg.addColorStop(0, `rgba(0,0,0,${0.07 + Math.random() * 0.2})`);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gg; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  g.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    g.strokeStyle = `rgba(0,0,0,${0.06 + Math.random() * 0.1})`;
    const x = Math.random() * S, y = Math.random() * S, l = 20 + Math.random() * 60, a = Math.random() * Math.PI;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  cookieTex = tex;
  return tex;
}

// ================================================================== LocalPlayer
export class LocalPlayer {
  constructor(ctx, state) {
    this.ctx = ctx;
    this.state = state || {};
    const st = this.state;
    if (!(st.position instanceof THREE.Vector3)) {
      const p = st.position || {};
      st.position = new THREE.Vector3(+p.x || 0, +p.y || 0, +p.z || 0);
    }
    this.position = st.position;
    this.velocity = new THREE.Vector3();
    this.onGround = false;
    this.gravity = -18;
    this.yaw = +st.yaw || 0;
    this.pitch = +st.pitch || 0;
    this.frozen = false;
    this.crouching = false;
    for (const k of ['health', 'oxygen', 'battery', 'stamina']) if (typeof st[k] !== 'number') st[k] = 100;
    if (typeof st.downed !== 'boolean') st.downed = false;
    st.noise = 0; st.crouching = false;

    this._crouchToggle = false;
    this._sprinting = false; this._exhausted = false; this._staminaDelay = 0;
    this._hs = 0; this._strafe = 0;
    this._coyote = 0; this._jumpBuf = 0; this._minVy = 0;
    this._eye = EYE; this._bobPhase = 0; this._bobAmt = 0;
    this._land = 0; this._landVel = 0; this._stepSmooth = 0; this._roll = 0; this._fovAdd = 0;
    this._kickPitch = 0; this._kickYaw = 0; this._downedT = st.downed ? 1 : 0; this._breathT = 0;
    this._noiseSpike = 0; this._damageSpike = 0; this._postDamage = -1; this._muffle = 0;
    this._breathTimer = 0; this._heartTimer = 0; this._suffocateTimer = 0; this._noiseAtTimer = 0;
    this._safe = new THREE.Vector3().copy(this.position); this._safeTimer = 0;
    this._lookDYaw = 0; this._lookDPitch = 0;
    this._swayYaw = 0; this._swayPitch = 0; this._swayYawV = 0; this._swayPitchV = 0;
    this._flashOn = st.flashlight !== false; this._flashI = 0; this._onStutter = 0;
    this._flickT = 0; this._flickOn = false; this._flickLevel = 1;
    this._settings = null; this._settingsT = 0; this._vitalsUiT = 0;
    this._wasCine = false; this._errCount = 0;
    this._beamBoost = 1; this._beamWant = 1; this._beamT = 0; this._rayO = new THREE.Vector3(); this._rayD = new THREE.Vector3();

    // flashlight: SpotLight on a spring-lagged rig parented to the camera
    const high = ctx.quality !== 'low';
    const spot = new THREE.SpotLight(0xfff1d6, 0, FLASH_DIST, FLASH_ANGLE, 0.45, FLASH_DECAY);
    spot.castShadow = true;
    spot.shadow.mapSize.set(high ? 1024 : 512, high ? 1024 : 512);
    spot.shadow.bias = -0.00012;
    spot.shadow.normalBias = 0.03;
    spot.shadow.focus = 1;
    spot.shadow.camera.near = 0.15;
    spot.shadow.camera.far = FLASH_DIST;
    try { spot.map = makeCookie(); } catch (e) { /* no canvas */ }
    spot.position.set(0.24, -0.2, 0.05);
    spot.target.position.set(0.02, -0.08, -12);
    spot.name = 'local-flashlight';
    this._rig = new THREE.Object3D();
    this._rig.name = 'flashlight-rig';
    this._rig.add(spot);
    this._rig.add(spot.target);
    this.flashlight = spot;
    ctx.camera?.add?.(this._rig);
  }

  // ---------------------------------------------------------------- public API
  spawn(p = {}) {
    const x = +p.x || 0, y = +p.y || 0, z = +p.z || 0;
    this.position.set(x, y, z);
    try {
      const gh = this.ctx.world?.groundHeight?.(x, z, y + 1.2);
      if (typeof gh === 'number' && isFinite(gh) && gh > y && gh - y < 1.2) this.position.y = gh;
    } catch (e) { /* ignore */ }
    this.velocity.set(0, 0, 0);
    this.yaw = +p.yaw || 0; this.pitch = 0;
    this.onGround = false; this._minVy = 0;
    this.crouching = false; this._crouchToggle = false; this._sprinting = false; this._exhausted = false;
    this._safe.copy(this.position); this._safeTimer = 0;
    const st = this.state;
    st.downed = false; st.health = 100; st.oxygen = 100; st.stamina = 100; st.battery = 100;
    this._downedT = 0; this._eye = EYE; this._land = 0; this._landVel = 0; this._stepSmooth = 0;
    this._kickPitch = 0; this._kickYaw = 0; this._damageSpike = 0;
    this._swayYaw = this._swayPitch = this._swayYawV = this._swayPitchV = 0;
    this.setFlashlight(true, true);
    this._writeState();
    if (!this.ctx.cinematic) this._updateCamera(1 / 60);
  }

  setFrozen(b) {
    this.frozen = !!b;
    if (this.frozen) { this.velocity.x = 0; this.velocity.z = 0; this._sprinting = false; }
  }

  setFlashlight(on, silent = false) {
    const st = this.state;
    if (on && st.battery <= 0) { if (!silent) this.ctx.audio?.play?.('click', { volume: 0.5, pitch: 0.8 }); on = false; }
    if (on && !this._flashOn) this._onStutter = 0.14;
    this._flashOn = !!on;
    st.flashlight = this._flashOn;
    if (!silent) this.ctx.audio?.play?.('click', { volume: 0.6 });
  }
  toggleFlashlight() { this.setFlashlight(!this._flashOn); }

  applyDamage(amount, srcPos) {
    amount = +amount || 0;
    const st = this.state, ctx = this.ctx;
    if (amount <= 0 || st.downed) return;
    const k = Math.min(1, amount / 35);
    try {
      ctx.ui?.damageFlash?.(Math.min(1, 0.35 + k));
      ctx.fx?.shake?.(Math.min(0.85, 0.28 + k * 0.6), 0.35 + k * 0.3);
      ctx.fx?.flash?.(0x8a0000, Math.min(0.5, 0.14 + k * 0.4), 0.45);
      ctx.audio?.play?.('hurt', { volume: 0.6 + k * 0.4 });
    } catch (e) { /* feedback is best-effort */ }
    this._damageSpike = Math.max(this._damageSpike, Math.min(1, 0.5 + k * 0.6));
    if (srcPos && typeof srcPos.x === 'number') {
      const dx = srcPos.x - this.position.x, dz = srcPos.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01) {
        const rel = wrapAngle(Math.atan2(-dx, -dz) - this.yaw);
        this._kickYaw += -Math.sign(rel || 1) * 0.05 * (0.5 + k);
        this.velocity.x -= (dx / d) * (2 + 4 * k);
        this.velocity.z -= (dz / d) * (2 + 4 * k);
      }
    }
    this._kickPitch += 0.03 + k * 0.05;
    if (GOD) return;
    st.health = Math.max(0, st.health - amount);
    if (st.health <= 0) this._down();
  }

  give(g = {}) {
    const st = this.state;
    if (typeof g.health === 'number' && !st.downed) st.health = clamp(st.health + g.health, 0, 100);
    if (typeof g.oxygen === 'number') st.oxygen = clamp(st.oxygen + g.oxygen, 0, 100);
    if (typeof g.battery === 'number') st.battery = clamp(st.battery + g.battery, 0, 100);
    if (typeof g.stamina === 'number') st.stamina = clamp(st.stamina + g.stamina, 0, 100);
  }

  revive() {
    const st = this.state;
    st.downed = false;
    st.health = 35;
    st.oxygen = Math.max(st.oxygen, 30);
    this._damageSpike = 0.4;
    this.velocity.set(0, 0, 0);
  }

  dispose() {
    try { this._rig.removeFromParent(); } catch (e) { /* ignore */ }
    try { this.flashlight.dispose(); } catch (e) { /* ignore */ }
    try { this.ctx.audio?.setMuffle?.(0); } catch (e) { /* ignore */ }
    try { this.ctx.post?.set?.({ damage: 0 }); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    const ctx = this.ctx, st = this.state, inp = ctx.input;
    try {
      this._readSettings(dt);
      const cine = !!ctx.cinematic;
      const inputOk = !!inp && inp.enabled !== false;
      const canLook = !cine && !this.frozen && inputOk;
      const control = canLook && !st.downed;

      if (this._rig.parent !== ctx.camera && ctx.camera) ctx.camera.add(this._rig);
      if (st.position !== this.position) {
        if (st.position && typeof st.position.x === 'number') this.position.set(st.position.x, st.position.y, st.position.z);
        st.position = this.position;
      }

      // look
      this._lookDYaw = 0; this._lookDPitch = 0;
      if (canLook) {
        const md = inp.mouseDelta?.() || { x: 0, y: 0 };
        const s = this._settings || {};
        let sens = typeof s.sensitivity === 'number' ? s.sensitivity : 1;
        if (sens > 10) sens /= 50;
        sens = clamp(sens, 0.05, 6) * SENS;
        const inv = s.invertY ? -1 : 1;
        const py = this.pitch;
        this._lookDYaw = -md.x * sens;
        this.yaw = wrapAngle(this.yaw + this._lookDYaw);
        this.pitch = clamp(this.pitch - md.y * sens * inv, -PITCH_LIMIT, PITCH_LIMIT);
        this._lookDPitch = this.pitch - py;
      }

      if (!cine) this._move(dt, control);
      this._updateFlashlight(dt, control, cine);
      if (!cine) this._vitals(dt);
      if (!cine) this._updateCamera(dt);
      else if (this._wasCine === false) { this._sprinting = false; }
      this._wasCine = cine;
      this._writeState();
    } catch (e) {
      if (this._errCount++ < 5) console.error('[player] update error', e);
    }
  }

  _readSettings(dt) {
    if (this.ctx.settings) { this._settings = this.ctx.settings; return; }
    this._settingsT -= dt;
    if (this._settingsT <= 0) {
      this._settingsT = 1;
      try { this._settings = this.ctx.ui?.getSettings?.() || this._settings; } catch (e) { /* ignore */ }
    }
  }

  _move(dt, control) {
    const ctx = this.ctx, st = this.state, inp = ctx.input, world = ctx.world, v = this.velocity, pos = this.position;
    let fx = 0, fz = 0, sprintKey = false, jumpPressed = false, crouchHeld = false;
    if (control) {
      if (inp.isDown('KeyW') || inp.isDown('ArrowUp')) fz += 1;
      if (inp.isDown('KeyS') || inp.isDown('ArrowDown')) fz -= 1;
      if (inp.isDown('KeyD') || inp.isDown('ArrowRight')) fx += 1;
      if (inp.isDown('KeyA') || inp.isDown('ArrowLeft')) fx -= 1;
      sprintKey = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');
      jumpPressed = inp.pressed('Space');
      if (inp.pressed('KeyC')) this._crouchToggle = !this._crouchToggle;
      crouchHeld = inp.isDown('ControlLeft') || inp.isDown('ControlRight');
    }
    if (st.downed) { this._crouchToggle = false; }

    // crouch (can't stand up under a low ceiling)
    const wantCrouch = !st.downed && (this._crouchToggle || crouchHeld);
    if (wantCrouch) this.crouching = true;
    else if (this.crouching) {
      let free = true;
      try { free = world?.capsuleFree ? world.capsuleFree(pos, RADIUS * 0.95, HEIGHT) : true; } catch (e) { free = true; }
      if (free) this.crouching = false;
    }

    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    const moving = len > 0.01;
    this._strafe = fx;

    // sprint & stamina
    const canSprint = moving && fz > 0.3 && !this.crouching && !this._exhausted && !st.downed;
    const sprinting = sprintKey && canSprint && (this._sprinting ? st.stamina > 0 : st.stamina >= 5);
    this._sprinting = sprinting;
    if (sprinting && this._hs > 1) {
      st.stamina = Math.max(0, st.stamina - 22 * dt);
      this._staminaDelay = 0.5;
      if (st.stamina <= 0) {
        this._exhausted = true; this._sprinting = false;
        ctx.audio?.play?.('breath', { volume: 0.7 });
        this._breathTimer = 1.4;
      }
    } else {
      this._staminaDelay -= dt;
      if (this._staminaDelay <= 0) st.stamina = Math.min(100, st.stamina + 14 * dt);
      if (this._exhausted && st.stamina >= 20) this._exhausted = false;
    }

    // wish velocity
    const target = this.crouching ? CROUCH_SPEED : (this._sprinting ? SPRINT : WALK);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = (-sy * fz + cy * fx) * target;
    const wz = (-cy * fz - sy * fx) * target;
    const accel = this.onGround ? (moving ? 11 : 9) : (moving ? 2.2 : 0.35);
    const k = 1 - Math.exp(-accel * dt);
    if (control || !this.onGround) {
      v.x += (wx - v.x) * k; v.z += (wz - v.z) * k;
    } else {
      const kf = 1 - Math.exp(-10 * dt);
      v.x -= v.x * kf; v.z -= v.z * kf;
    }

    // jump (coyote time + buffer)
    this._coyote = this.onGround ? 0.12 : this._coyote - dt;
    this._jumpBuf = jumpPressed ? 0.14 : this._jumpBuf - dt;
    if (control && this._jumpBuf > 0 && this._coyote > 0) {
      const g = Math.abs(this.gravity || 18);
      v.y = JUMP * Math.pow(g / 18, 0.25); // low gravity -> floaty, higher arc
      this._coyote = 0; this._jumpBuf = 0; this.onGround = false;
      ctx.audio?.play?.('jump', { volume: 0.5 });
      this._noiseSpike = Math.max(this._noiseSpike, 0.5);
    }

    // physics
    const h = this.crouching ? CROUCH_HEIGHT : HEIGHT;
    const prevY = pos.y, wasGround = this.onGround;
    if (world?.moveCapsule) {
      const r = world.moveCapsule(pos, v, RADIUS, h, dt, this.gravity);
      this.onGround = !!(r && r.onGround);
    } else {
      v.y += this.gravity * dt;
      pos.addScaledVector(v, dt);
      if (pos.y < 0) { pos.y = 0; v.y = 0; this.onGround = true; } else this.onGround = false;
    }
    if (wasGround && this.onGround) {
      const dy = pos.y - prevY;
      if (Math.abs(dy) > 0.04) this._stepSmooth = clamp(this._stepSmooth - dy, -0.6, 0.6);
    }

    // landing
    if (this.onGround && !wasGround) {
      const impact = -this._minVy;
      if (impact > 3) {
        this._landVel -= Math.min(impact * 0.045, 0.6);
        ctx.audio?.play?.('land', { volume: clamp((impact - 3) / 9, 0.25, 1) });
        const loud = clamp(impact / 12, 0.3, 1);
        this._noiseSpike = Math.max(this._noiseSpike, loud);
        if (impact > 7) ctx.fx?.shake?.(Math.min(0.5, (impact - 7) / 16 + 0.12), 0.25);
        if (impact > 5 && this._noiseAtTimer <= 0) { ctx.noiseAt?.(pos.clone(), loud); this._noiseAtTimer = 0.5; }
      }
      this._minVy = 0;
    }
    if (!this.onGround) this._minVy = Math.min(this._minVy, v.y);
    this._noiseAtTimer -= dt;

    // head bob phase + footsteps
    const hs = Math.hypot(v.x, v.z);
    this._hs = hs;
    if (this.onGround && hs > 0.3 && !st.downed) {
      const stepLen = this.crouching ? 0.9 : (this._sprinting ? 2.05 : 1.5);
      const prevIdx = Math.floor(this._bobPhase / Math.PI);
      this._bobPhase += (hs / stepLen) * Math.PI * dt;
      if (Math.floor(this._bobPhase / Math.PI) !== prevIdx) {
        const vol = (this.crouching ? 0.16 : this._sprinting ? 0.85 : 0.5) * clamp(hs / target, 0.4, 1.1);
        ctx.audio?.play?.(ctx.footstepSound || 'footstep', { volume: vol, pitch: 0.92 + Math.random() * 0.16 });
      }
      if (this._bobPhase > 1e4) this._bobPhase -= Math.PI * 2 * 1000;
    }
    this._bobAmt = damp(this._bobAmt, (this.onGround && !st.downed) ? clamp(hs / WALK, 0, 1.6) : 0, 8, dt);

    // noise
    let mv = 0;
    if (this.onGround && hs > 0.5 && !st.downed) mv = this.crouching ? 0.12 : (this._sprinting ? 1 : 0.45);
    this._noiseSpike = Math.max(0, this._noiseSpike - dt * 1.8);
    st.noise = Math.max(mv, this._noiseSpike);

    // safe ground + kill plane
    if (this.onGround && !st.downed) {
      this._safeTimer += dt;
      if (this._safeTimer >= 1) { this._safeTimer = 0; this._safe.copy(pos); }
    }
    const killY = (world && typeof world.killY === 'number') ? world.killY : -60;
    if (pos.y < killY) {
      pos.copy(this._safe); pos.y += 0.05;
      v.set(0, 0, 0);
      this._minVy = 0;
      ctx.fx?.flash?.(0x000000, 1, 0.9);
      this.applyDamage(25);
    }
  }

  _updateFlashlight(dt, control, cine) {
    const st = this.state, ctx = this.ctx, spot = this.flashlight;
    if (control && ctx.input?.pressed?.('KeyF')) this.toggleFlashlight();
    if (this._flashOn && !cine) {
      st.battery = Math.max(0, st.battery - BATTERY_DRAIN * dt);
      if (st.battery <= 0) { this._flashOn = false; ctx.audio?.play?.('click', { volume: 0.5, pitch: 0.7 }); }
    } else if (!this._flashOn && !cine && !st.downed && st.battery < 100) {
      st.battery = Math.min(100, st.battery + BATTERY_RECHARGE * dt);
    }
    // adaptive throw: brighter when the beam centre reaches far (open terrain), never hotter than base up close
    if (this._flashOn && !cine) this._updateBeamBoost(dt);
    const lvlScale = (ctx.level && typeof ctx.level.flashlightScale === 'number' && ctx.level.flashlightScale > 0) ? ctx.level.flashlightScale : 1;
    let target = (this._flashOn && !cine) ? FLASH_INTENSITY * this._beamBoost * lvlScale : 0;
    if (target > 0 && st.battery < 15) {
      this._flickT -= dt;
      if (this._flickT <= 0) {
        if (this._flickOn) { this._flickOn = false; this._flickT = 0.15 + Math.random() * (0.3 + (st.battery / 15) * 2.5); }
        else { this._flickOn = true; this._flickT = 0.04 + Math.random() * 0.22; this._flickLevel = Math.random() * 0.35; }
      }
      if (this._flickOn) target *= this._flickLevel + Math.random() * 0.15;
      target *= 0.55 + 0.45 * (st.battery / 15);
    }
    if (this._onStutter > 0) {
      this._onStutter -= dt;
      if (Math.random() < 0.45) target *= 0.12;
    }
    this._flashI = (target < this._flashI) ? damp(this._flashI, target, 40, dt) : damp(this._flashI, target, 28, dt);
    if (this._flashI < 0.05) this._flashI = target > 0 ? this._flashI : 0;
    spot.intensity = this._flashI;
    spot.shadow.autoUpdate = this._flashI > 0.5;

    // spring-lagged sway behind camera rotation + hand bob
    if (!cine) {
      this._swayYaw = clamp(this._swayYaw - this._lookDYaw * 0.85, -0.25, 0.25);
      this._swayPitch = clamp(this._swayPitch - this._lookDPitch * 0.85, -0.2, 0.2);
    }
    const K = 90, C = 13;
    this._swayYawV += (-this._swayYaw * K - this._swayYawV * C) * dt;
    this._swayPitchV += (-this._swayPitch * K - this._swayPitchV * C) * dt;
    this._swayYaw += this._swayYawV * dt;
    this._swayPitch += this._swayPitchV * dt;
    const a = this._bobAmt * (this._sprinting ? 1.5 : 1);
    const ph = this._bobPhase;
    this._rig.rotation.set(
      this._swayPitch + Math.sin(ph * 2) * 0.007 * a + Math.sin(this._breathT * 0.9) * 0.003,
      this._swayYaw + Math.cos(ph) * 0.012 * a,
      0,
    );
  }

  _updateBeamBoost(dt) {
    this._beamBoost = damp(this._beamBoost, this._beamWant, 5, dt);
    this._beamT -= dt;
    if (this._beamT > 0) return;
    this._beamT = 0.1;
    const world = this.ctx.world, cam = this.ctx.camera;
    let d = 45;
    try {
      if (world && cam && typeof world.raycast === 'function') {
        cam.getWorldPosition(this._rayO);
        cam.getWorldDirection(this._rayD);
        const hit = world.raycast(this._rayO, this._rayD, 45);
        if (hit && isFinite(hit.distance)) d = hit.distance;
      }
    } catch (e) { d = 45; }
    this._beamWant = clamp(Math.pow(Math.max(d, 0.1) / 7, FLASH_DECAY), 1, 2.6);
  }

  _vitals(dt) {
    const ctx = this.ctx, st = this.state, pos = this.position;
    // oxygen
    let inZone = false;
    const zones = ctx.oxygenZones;
    if (zones) {
      const iter = (Array.isArray(zones) || zones instanceof Map || zones instanceof Set) ? zones.values() : Object.values(zones);
      for (const z of iter) {
        const zp = z && (z.pos || z.position);
        if (!zp) continue;
        const r = typeof z.radius === 'number' ? z.radius : 3;
        const dx = pos.x - zp.x, dy = pos.y - zp.y, dz = pos.z - zp.z;
        if (dx * dx + dy * dy + dz * dz <= r * r) { inZone = true; break; }
      }
    }
    const drain = +ctx.oxygenDrain || 0;
    if (inZone) st.oxygen = Math.min(100, st.oxygen + 25 * dt);
    else if (drain > 0) st.oxygen = Math.max(0, st.oxygen - drain * dt);
    else if (st.oxygen < 100) st.oxygen = Math.min(100, st.oxygen + 8 * dt); // breathable air
    this.inOxygenZone = inZone;

    if (st.oxygen <= 0 && !st.downed && !GOD) {
      st.health = Math.max(0, st.health - 6 * dt);
      this._suffocateTimer -= dt;
      if (this._suffocateTimer <= 0) {
        this._suffocateTimer = 1.3;
        ctx.ui?.damageFlash?.(0.3);
        ctx.audio?.play?.('hurt', { volume: 0.35, pitch: 0.85 });
        this._damageSpike = Math.max(this._damageSpike, 0.45);
      }
      if (st.health <= 0) this._down();
    }

    // low oxygen: muffle + gasping
    const lowO = st.oxygen < 25 ? (25 - st.oxygen) / 25 : 0;
    const muffle = st.downed ? 0.6 : lowO * 0.75;
    if (Math.abs(muffle - this._muffle) > 0.02 || (muffle === 0 && this._muffle !== 0)) {
      ctx.audio?.setMuffle?.(muffle);
      this._muffle = muffle;
    }
    this._breathTimer -= dt;
    if ((lowO > 0 || this._exhausted) && this._breathTimer <= 0 && !st.downed) {
      ctx.audio?.play?.('breath', { volume: 0.35 + lowO * 0.5 });
      this._breathTimer = this._exhausted ? 1.5 : 2.3 - lowO * 1.0;
    }
    // heartbeat at low health
    this._heartTimer -= dt;
    if (st.health < 30 && !st.downed && this._heartTimer <= 0) {
      const f = (30 - st.health) / 30;
      ctx.audio?.play?.('heartbeat', { volume: 0.35 + f * 0.5 });
      this._heartTimer = 1.05 - f * 0.4;
    }

    // post damage: hit spikes + low health / low oxygen pulse
    this._damageSpike = Math.max(0, this._damageSpike - dt * 1.6);
    const lowH = st.downed ? 0.55 : (st.health < 35 ? ((35 - st.health) / 35) * 0.55 : 0);
    const lowOx = st.oxygen < 15 ? ((15 - st.oxygen) / 15) * 0.3 : 0;
    const dmg = Math.min(1, Math.max(this._damageSpike, lowH, lowOx));
    if (Math.abs(dmg - this._postDamage) > 0.004) {
      ctx.post?.set?.({ damage: dmg });
      this._postDamage = dmg;
    }

    this._vitalsUiT -= dt;
    if (this._vitalsUiT <= 0) {
      this._vitalsUiT = 0.1;
      ctx.ui?.setVitals?.({ health: st.health, oxygen: st.oxygen, stamina: st.stamina, battery: st.battery });
    }
  }

  _down() {
    const st = this.state;
    if (st.downed) return;
    st.downed = true;
    st.health = 0;
    this.velocity.x = 0; this.velocity.z = 0;
    this._sprinting = false; this.crouching = false; this._crouchToggle = false;
  }

  _updateCamera(dt) {
    const cam = this.ctx.camera;
    if (!cam) return;
    const st = this.state, pos = this.position;
    const s = this._settings || {};
    const bobScale = typeof s.headBob === 'number' ? clamp(s.headBob, 0, 2) : 1;

    this._eye = damp(this._eye, this.crouching ? CROUCH_EYE : EYE, 10, dt);
    this._stepSmooth = damp(this._stepSmooth, 0, 12, dt);
    // landing dip spring
    this._landVel += (-this._land * 150 - this._landVel * 16) * dt;
    this._land = clamp(this._land + this._landVel * dt, -0.5, 0.2);
    // bob
    const amp = this._bobAmt * bobScale * (this._sprinting ? 1.35 : this.crouching ? 0.6 : 1);
    const ph = this._bobPhase;
    const bobY = (Math.abs(Math.sin(ph)) - 0.6) * 0.045 * amp;
    const bobX = Math.cos(ph) * 0.022 * amp;
    const bobRoll = Math.cos(ph) * 0.0045 * amp;
    // breathing sway (stronger when winded / suffocating)
    const winded = 1 - st.stamina / 100;
    this._breathT += dt * (1.1 + winded * 1.8 + (st.oxygen < 25 ? 1.2 : 0));
    const breathAmp = 0.0016 + winded * 0.006;
    const breathPitch = Math.sin(this._breathT) * breathAmp;
    const breathYaw = Math.sin(this._breathT * 0.5 + 1.3) * breathAmp * 0.5;
    const breathY = Math.sin(this._breathT) * 0.005;
    // strafe lean + hit kicks
    this._roll = damp(this._roll, -this._strafe * 0.014 * (this.onGround ? 1 : 0.5), 6, dt);
    this._kickPitch = damp(this._kickPitch, 0, 7, dt);
    this._kickYaw = damp(this._kickYaw, 0, 7, dt);
    // downed blend
    this._downedT = damp(this._downedT, st.downed ? 1 : 0, 3, dt);
    const d = this._downedT, u = 1 - d;

    const eye = (this._eye + bobY + this._land + this._stepSmooth + breathY) * u + 0.35 * d;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    cam.position.set(pos.x + cy * bobX * u, pos.y + eye, pos.z - sy * bobX * u);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(
      this.pitch + breathPitch + this._kickPitch + this._land * 0.12,
      this.yaw + this._kickYaw + breathYaw,
      (this._roll + bobRoll) * u + d * 0.38,
    );
    // sprint FOV
    const baseFov = typeof s.fov === 'number' ? clamp(s.fov, 50, 110) : 72;
    this._fovAdd = damp(this._fovAdd, (this._sprinting && this._hs > 4) ? 6 : 0, 5, dt);
    const fov = baseFov + this._fovAdd;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }

    this.ctx.fx?.applyCamera?.(cam);

  }

  _writeState() {
    const st = this.state;
    st.position = this.position;
    st.yaw = this.yaw;
    st.pitch = this.pitch;
    st.flashlight = this._flashOn && st.battery > 0;
    st.crouching = this.crouching;
  }
}

// ================================================================== RemotePlayer
function colorOf(c) {
  const col = new THREE.Color();
  try { col.set(c ?? 0x4fd1ff); } catch (e) { col.set(0x4fd1ff); }
  return col;
}

export class RemotePlayer {
  constructor(ctx, state) {
    this.ctx = ctx;
    this.state = state || {};
    const st = this.state;
    if (!st.position || typeof st.position.x !== 'number') st.position = new THREE.Vector3();
    this.color = colorOf(st.color);
    this._pos = new THREE.Vector3().copy(st.position);
    this._prev = new THREE.Vector3().copy(st.position);
    this._yaw = +st.yaw || 0; this._pitch = +st.pitch || 0;
    this._speed = 0; this._phase = 0; this._down = st.downed ? 1 : 0; this._crouch = 0;
    this._lightI = 0; this._first = true; this._tagKey = '';
    this._disposables = [];

    const track = (x) => { this._disposables.push(x); return x; };
    const suit = track(new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.78, metalness: 0.05 }));
    const suit2 = track(new THREE.MeshStandardMaterial({ color: 0x8d939b, roughness: 0.7, metalness: 0.15 }));
    const dark = track(new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.55, metalness: 0.45 }));
    this._accent = track(new THREE.MeshStandardMaterial({ color: this.color, emissive: this.color, emissiveIntensity: 1.6, roughness: 0.4 }));
    const visor = track(new THREE.MeshStandardMaterial({ color: 0x040507, roughness: 0.07, metalness: 1.0, emissive: this.color, emissiveIntensity: 0.1 }));
    const G = (g) => track(g);

    const mesh = (geo, mat, x = 0, y = 0, z = 0, parent = null, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      (parent || this.body).add(m);
      return m;
    };

    this.root = new THREE.Group();
    this.root.name = 'remote-' + (st.id ?? '');
    this.body = new THREE.Group();
    this.root.add(this.body);

    // torso & belt & chest unit
    const torso = mesh(G(new THREE.CapsuleGeometry(0.24, 0.42, 4, 12)), suit, 0, 1.2, 0);
    torso.scale.set(1, 1, 0.78);
    mesh(G(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 14)), dark, 0, 0.96, 0);
    mesh(G(new THREE.BoxGeometry(0.22, 0.14, 0.05)), dark, 0, 1.3, -0.19);
    mesh(G(new THREE.BoxGeometry(0.15, 0.022, 0.01)), this._accent, 0, 1.33, -0.218, null, false);
    // backpack with lights
    mesh(G(new THREE.BoxGeometry(0.38, 0.5, 0.2)), suit2, 0, 1.22, 0.27);
    const bl = G(new THREE.SphereGeometry(0.026, 8, 6));
    mesh(bl, this._accent, -0.11, 1.41, 0.375, null, false);
    mesh(bl, this._accent, 0.11, 1.41, 0.375, null, false);
    mesh(G(new THREE.BoxGeometry(0.02, 0.22, 0.01)), this._accent, 0, 1.18, 0.375, null, false);

    // head pivot (neck) with helmet + visor
    this.head = new THREE.Group();
    this.head.position.set(0, 1.45, 0);
    this.body.add(this.head);
    const ring = mesh(G(new THREE.TorusGeometry(0.13, 0.03, 8, 18)), dark, 0, 0.02, 0, this.head);
    ring.rotation.x = Math.PI / 2;
    mesh(G(new THREE.SphereGeometry(0.2, 22, 16)), suit, 0, 0.17, 0, this.head);
    mesh(G(new THREE.SphereGeometry(0.206, 22, 12, Math.PI + 0.38, Math.PI - 0.76, 0.95, 0.85)), visor, 0, 0.17, 0, this.head, false);

    // arms
    const upperArm = G(new THREE.CapsuleGeometry(0.075, 0.26, 3, 8));
    const foreArm = G(new THREE.CapsuleGeometry(0.068, 0.24, 3, 8));
    const glove = G(new THREE.SphereGeometry(0.075, 8, 6));
    const makeArm = (side) => {
      const sh = new THREE.Group(); sh.position.set(0.31 * side, 1.38, 0); this.body.add(sh);
      mesh(upperArm, suit, 0, -0.17, 0, sh);
      const el = new THREE.Group(); el.position.set(0, -0.34, 0); sh.add(el);
      mesh(foreArm, suit, 0, -0.15, 0, el);
      mesh(glove, dark, 0, -0.32, 0, el);
      return { sh, el };
    };
    this.armL = makeArm(-1); this.armR = makeArm(1);
    // legs
    const thigh = G(new THREE.CapsuleGeometry(0.1, 0.3, 3, 8));
    const shin = G(new THREE.CapsuleGeometry(0.09, 0.28, 3, 8));
    const boot = G(new THREE.BoxGeometry(0.16, 0.12, 0.27));
    const makeLeg = (side) => {
      const hip = new THREE.Group(); hip.position.set(0.12 * side, 0.93, 0); this.body.add(hip);
      mesh(thigh, suit, 0, -0.2, 0, hip);
      const knee = new THREE.Group(); knee.position.set(0, -0.42, 0); hip.add(knee);
      mesh(shin, suit, 0, -0.2, 0, knee);
      mesh(boot, dark, 0, -0.44, -0.03, knee);
      return { hip, knee };
    };
    this.legL = makeLeg(-1); this.legR = makeLeg(1);

    // flashlight (no shadow) + faint additive cone
    this.aim = new THREE.Group();
    this.aim.position.set(0, 1.62, 0);
    this.body.add(this.aim);
    this.light = new THREE.SpotLight(0xfff1d6, 0, 40, FLASH_ANGLE, 0.5, FLASH_DECAY);
    this.light.castShadow = false;
    this.light.position.set(0.16, -0.08, -0.18);
    this.light.target.position.set(0.0, -0.1, -10);
    this.aim.add(this.light); this.aim.add(this.light.target);
    const coneLen = 6.5, coneR = Math.tan(FLASH_ANGLE) * coneLen;
    const coneGeo = G(new THREE.ConeGeometry(coneR, coneLen, 24, 1, true));
    coneGeo.translate(0, -coneLen / 2, 0);
    coneGeo.rotateX(Math.PI / 2);
    const gc = document.createElement('canvas'); gc.width = 4; gc.height = 64;
    const gctx = gc.getContext('2d');
    const lg = gctx.createLinearGradient(0, 0, 0, 64);
    lg.addColorStop(0, '#ffffff'); lg.addColorStop(0.35, '#555555'); lg.addColorStop(1, '#000000');
    gctx.fillStyle = lg; gctx.fillRect(0, 0, 4, 64);
    const alphaTex = track(new THREE.CanvasTexture(gc));
    const coneMat = track(new THREE.MeshBasicMaterial({
      color: 0xfff1d6, alphaMap: alphaTex, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.cone = new THREE.Mesh(coneGeo, coneMat);
    this.cone.position.copy(this.light.position);
    this.cone.visible = false;
    this.cone.renderOrder = 4;
    this.aim.add(this.cone);

    // name tag
    this._tagCanvas = document.createElement('canvas');
    this._tagCanvas.width = 256; this._tagCanvas.height = 64;
    this._tagTex = track(new THREE.CanvasTexture(this._tagCanvas));
    this._tagTex.colorSpace = THREE.SRGBColorSpace;
    this._tagMat = track(new THREE.SpriteMaterial({ map: this._tagTex, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9, fog: false }));
    this.tag = new THREE.Sprite(this._tagMat);
    this.tag.scale.set(0.95, 0.24, 1);
    this.tag.position.set(0, 2.12, 0);
    this.tag.renderOrder = 999;
    this.root.add(this.tag);
    this._drawTag();
    try { document.fonts?.ready?.then(() => { this._tagKey = ''; this._drawTag(); }); } catch (e) { /* ignore */ }

    this.root.position.copy(this._pos);
    ctx.scene?.add?.(this.root);
  }

  _drawTag() {
    const st = this.state;
    const name = String(st.callsign || st.name || 'CREW').toUpperCase().slice(0, 14);
    const key = name + (st.downed ? '|D' : '');
    if (key === this._tagKey) return;
    this._tagKey = key;
    const g = this._tagCanvas.getContext('2d');
    g.clearRect(0, 0, 256, 64);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.95)'; g.shadowBlur = 8;
    g.font = '600 30px "Chakra Petch", "Share Tech Mono", monospace';
    g.fillStyle = st.downed ? '#ff5a5a' : '#' + this.color.getHexString();
    g.fillText(st.downed ? name + ' ▼' : name, 128, 30);
    if (st.downed) {
      g.font = '400 16px "Share Tech Mono", monospace';
      g.fillStyle = '#ffb0b0';
      g.fillText('DOWN — HOLD E', 128, 54);
    }
    this._tagTex.needsUpdate = true;
  }

  setNetState(s) {
    if (!s || s === this.state) return;
    const st = this.state;
    const p = s.position || s.pos || s.p;
    if (p) {
      if (Array.isArray(p)) st.position.set(+p[0] || 0, +p[1] || 0, +p[2] || 0);
      else if (typeof p.x === 'number') st.position.set(p.x, p.y, p.z);
    }
    for (const k of ['yaw', 'pitch', 'health', 'oxygen', 'battery', 'stamina', 'noise']) if (typeof s[k] === 'number') st[k] = s[k];
    for (const k of ['flashlight', 'downed', 'crouching']) if (typeof s[k] === 'boolean') st[k] = s[k];
    if (s.callsign) st.callsign = s.callsign;
    if (s.name) st.name = s.name;
  }

  update(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    try {
      const ctx = this.ctx, st = this.state;
      if (!this.root.parent && ctx.scene) ctx.scene.add(this.root);
      const tp = st.position;
      this._prev.copy(this._pos);
      if (tp && typeof tp.x === 'number') {
        if (this._first || this._pos.distanceToSquared(tp) > 36) { this._pos.set(tp.x, tp.y, tp.z); this._prev.copy(this._pos); this._first = false; }
        else {
          const k = 1 - Math.exp(-12 * dt);
          this._pos.x += (tp.x - this._pos.x) * k; this._pos.y += (tp.y - this._pos.y) * k; this._pos.z += (tp.z - this._pos.z) * k;
        }
      }
      const hs = Math.hypot(this._pos.x - this._prev.x, this._pos.z - this._prev.z) / dt;
      this._speed = damp(this._speed, Math.min(hs, 9), 8, dt);
      const ky = 1 - Math.exp(-14 * dt);
      this._yaw = wrapAngle(this._yaw + wrapAngle((+st.yaw || 0) - this._yaw) * ky);
      this._pitch += ((+st.pitch || 0) - this._pitch) * ky;

      this.root.position.copy(this._pos);
      this.body.rotation.y = this._yaw;

      // pose blends
      this._down = damp(this._down, st.downed ? 1 : 0, 4, dt);
      this._crouch = damp(this._crouch, st.crouching && !st.downed ? 1 : 0, 10, dt);
      const down = this._down, cr = this._crouch;

      // walk cycle
      const amt = clamp(this._speed / 3.4, 0, 1.4) * (1 - down);
      const prevIdx = Math.floor(this._phase / Math.PI);
      this._phase += this._speed * dt * 2.2;
      if (this._phase > 1e4) this._phase -= Math.PI * 2000;
      if (Math.floor(this._phase / Math.PI) !== prevIdx && this._speed > 0.8 && down < 0.5) {
        const vol = (st.crouching ? 0.12 : this._speed > 5 ? 0.6 : 0.38);
        ctx.audio?.play?.(ctx.footstepSound || 'footstep', { position: this._pos, volume: vol, pitch: 0.9 + Math.random() * 0.2 });
      }
      const sw = Math.sin(this._phase) * 0.55 * Math.min(1, amt);
      this.legL.hip.rotation.x = sw + cr * 1.1;
      this.legR.hip.rotation.x = -sw + cr * 1.1;
      this.legL.knee.rotation.x = -Math.max(0, -Math.cos(this._phase)) * 0.7 * Math.min(1, amt) - cr * 1.9;
      this.legR.knee.rotation.x = -Math.max(0, Math.cos(this._phase)) * 0.7 * Math.min(1, amt) - cr * 1.9;
      this.armL.sh.rotation.x = -sw * 0.7;
      this.armR.sh.rotation.x = sw * 0.7;
      this.armL.el.rotation.x = 0.25 + 0.2 * amt;
      this.armR.el.rotation.x = 0.25 + 0.2 * amt;
      this.armL.sh.rotation.z = -0.08 - down * 0.9;
      this.armR.sh.rotation.z = 0.08 + down * 0.9;
      const bob = Math.abs(Math.sin(this._phase)) * 0.04 * amt;
      this.body.position.y = bob - cr * 0.42 + down * 0.16;
      this.body.rotation.x = down * Math.PI / 2 * 0.97;
      this.head.rotation.x = clamp(this._pitch, -1.1, 1.1) * 0.75 * (1 - down);
      this.aim.rotation.x = clamp(this._pitch, -1.45, 1.45) * (1 - down) + down * 0.6;
      this.aim.position.y = 1.62 - cr * 0.1;

      // backpack lights pulse red when downed
      if (down > 0.5) {
        const p = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
        this._accent.emissive.setRGB(1, 0.05, 0.05);
        this._accent.emissiveIntensity = 0.6 + p * 2.2;
      } else {
        this._accent.emissive.copy(this.color);
        this._accent.emissiveIntensity = 1.6;
      }

      // flashlight
      const on = !!st.flashlight;
      this._lightI = damp(this._lightI, on ? 150 : 0, 18, dt);
      this.light.intensity = this._lightI < 0.05 ? 0 : this._lightI;
      this.cone.visible = this._lightI > 2;
      this.cone.material.opacity = 0.05 * (this._lightI / 150);

      // name tag
      this._drawTag();
      const cam = ctx.camera;
      if (cam) {
        const dx = cam.position.x - this._pos.x, dy = cam.position.y - this._pos.y, dz = cam.position.z - this._pos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        this._tagMat.opacity = dist < 1.4 ? 0 : clamp((45 - dist) / 20, 0, 0.9);
        this.tag.visible = this._tagMat.opacity > 0.01;
        this.tag.position.y = down > 0.5 ? 0.9 : 2.12 - cr * 0.4;
      }
    } catch (e) {
      if (!this._err) { this._err = true; console.error('[remote player] update error', e); }
    }
  }

  dispose() {
    try { this.root.removeFromParent(); } catch (e) { /* ignore */ }
    try { this.light.dispose(); } catch (e) { /* ignore */ }
    for (const d of this._disposables) { try { d.dispose(); } catch (e) { /* ignore */ } }
    this._disposables.length = 0;
  }
}

export default LocalPlayer;
