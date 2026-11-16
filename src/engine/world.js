// STARLESS — collision world (ENGINE)
// Axis-aligned boxes + optional heightfield. Vertical cylinder "capsule" movement with slide,
// step-up, ground snapping, ceiling bumps. Spatial hash (8 m cells) once there are many boxes.
import * as THREE from 'three';

const CELL = 8;
const HASH_MIN = 40;          // use the grid only above this many boxes
const BIG_CELLS = 24;         // boxes spanning more cells than this per axis go into the "big" list
const STEP = 0.45;            // max step-up height
const SNAP = 0.45;            // ground snap distance when walking down
const EPS = 1e-4;

const cellOf = (v) => Math.floor(v / CELL);
const key = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

export class World {
  constructor() {
    this.killY = -60;
    this.bounds = null;
    this._boxes = new Map();
    this._list = [];
    this._big = [];
    this._grid = new Map();
    this._hf = null;
    this._nextId = 1;
    this._qid = 1;
    this._cand = [];
    this._cand2 = [];
    this._tmpBox = new THREE.Box3();
  }

  clear() {
    this._boxes.clear();
    this._list.length = 0;
    this._big.length = 0;
    this._grid.clear();
    this._hf = null;
    this.killY = -60;
    this.bounds = null;
  }

  setHeightfield(fn) { this._hf = typeof fn === 'function' ? fn : null; }
  get heightfield() { return this._hf; }
  get boxCount() { return this._list.length; }

  _h(x, z) {
    if (!this._hf) return -Infinity;
    let h;
    try { h = this._hf(x, z); } catch (e) { return -Infinity; }
    return (typeof h === 'number' && isFinite(h)) ? h : -Infinity;
  }

  addBox(min, max) {
    if (!min || !max) return -1;
    const ax = +min.x, ay = +min.y, az = +min.z, bx = +max.x, by = +max.y, bz = +max.z;
    if (![ax, ay, az, bx, by, bz].every(isFinite)) return -1;
    const b = {
      id: this._nextId++,
      minX: Math.min(ax, bx), minY: Math.min(ay, by), minZ: Math.min(az, bz),
      maxX: Math.max(ax, bx), maxY: Math.max(ay, by), maxZ: Math.max(az, bz),
      _q: 0, _cells: null, _idx: this._list.length,
    };
    this._boxes.set(b.id, b);
    this._list.push(b);
    const c0x = cellOf(b.minX), c1x = cellOf(b.maxX), c0z = cellOf(b.minZ), c1z = cellOf(b.maxZ);
    if (c1x - c0x > BIG_CELLS || c1z - c0z > BIG_CELLS) {
      this._big.push(b);
    } else {
      b._cells = [];
      for (let cx = c0x; cx <= c1x; cx++) {
        for (let cz = c0z; cz <= c1z; cz++) {
          const k = key(cx, cz);
          let arr = this._grid.get(k);
          if (!arr) { arr = []; this._grid.set(k, arr); }
          arr.push(b);
          b._cells.push(k);
        }
      }
    }
    return b.id;
  }

  addBoxFromObject(obj) {
    if (!obj) return -1;
    try {
      obj.updateWorldMatrix(true, true);
      const box = this._tmpBox.makeEmpty().setFromObject(obj);
      if (box.isEmpty()) return -1;
      return this.addBox(box.min, box.max);
    } catch (e) {
      console.warn('[world] addBoxFromObject failed', e);
      return -1;
    }
  }

  removeBox(id) {
    const b = this._boxes.get(id);
    if (!b) return false;
    this._boxes.delete(id);
    // swap-remove from list
    const last = this._list.pop();
    if (last !== b) { this._list[b._idx] = last; last._idx = b._idx; }
    if (b._cells) {
      for (const k of b._cells) {
        const arr = this._grid.get(k);
        if (!arr) continue;
        const i = arr.indexOf(b);
        if (i >= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); }
        if (!arr.length) this._grid.delete(k);
      }
    } else {
      const i = this._big.indexOf(b);
      if (i >= 0) this._big.splice(i, 1);
    }
    return true;
  }

  // candidate boxes overlapping an XZ rectangle
  _query(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const list = this._list;
    if (list.length <= HASH_MIN) {
      for (let i = 0; i < list.length; i++) out.push(list[i]);
      return out;
    }
    const c0x = cellOf(minX), c1x = cellOf(maxX), c0z = cellOf(minZ), c1z = cellOf(maxZ);
    if ((c1x - c0x + 1) * (c1z - c0z + 1) > 96) {
      for (let i = 0; i < list.length; i++) out.push(list[i]);
      return out;
    }
    const q = ++this._qid;
    for (let i = 0; i < this._big.length; i++) { const b = this._big[i]; b._q = q; out.push(b); }
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const arr = this._grid.get(key(cx, cz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const b = arr[i];
          if (b._q !== q) { b._q = q; out.push(b); }
        }
      }
    }
    return out;
  }

  // highest surface at (x,z) at or below fromY (box tops + heightfield); -Infinity if none
  groundHeight(x, z, fromY = Infinity) {
    let best = -Infinity;
    const h = this._h(x, z);
    if (h <= fromY + EPS) best = h;
    const c = this._query(x, z, x, z, this._cand2);
    for (let i = 0; i < c.length; i++) {
      const b = c[i];
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY <= fromY + EPS && b.maxY > best) best = b.maxY;
    }
    return best;
  }

  // support surface under a disc of radius r at (x,z), considering box tops <= maxY. Heightfield always counts.
  _support(x, z, maxY, r, cands) {
    let best = this._h(x, z);
    const r2 = r * r;
    for (let i = 0; i < cands.length; i++) {
      const b = cands[i];
      if (b.maxY > maxY || b.maxY <= best) continue;
      const cx = x < b.minX ? b.minX : (x > b.maxX ? b.maxX : x);
      const cz = z < b.minZ ? b.minZ : (z > b.maxZ ? b.maxZ : z);
      const ddx = x - cx, ddz = z - cz;
      if (ddx * ddx + ddz * ddz <= r2) best = b.maxY;
    }
    return best;
  }

  // true if a standing cylinder at pos would not intersect any box
  capsuleFree(pos, radius = 0.35, height = 1.75) {
    const c = this._query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, this._cand2);
    const r2 = radius * radius;
    for (let i = 0; i < c.length; i++) {
      const b = c[i];
      if (b.maxY <= pos.y + 0.05 || b.minY >= pos.y + height) continue;
      const cx = Math.min(Math.max(pos.x, b.minX), b.maxX);
      const cz = Math.min(Math.max(pos.z, b.minZ), b.maxZ);
      const ddx = pos.x - cx, ddz = pos.z - cz;
      if (ddx * ddx + ddz * ddz < r2) return false;
    }
    return true;
  }

  moveCapsule(pos, vel, radius = 0.35, height = 1.75, dt = 1 / 60, gravity = -18) {
    const res = { onGround: false, hitWall: false, hitCeiling: false, stepped: 0 };
    if (!pos || !vel) return res;
    if (!(dt > 0)) return res;
    if (dt > 0.1) dt = 0.1;
    if (!isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) { pos.set(0, 10, 0); vel.set(0, 0, 0); }
    if (!isFinite(vel.x) || !isFinite(vel.y) || !isFinite(vel.z)) vel.set(0, 0, 0);

    // were we standing before this move? (enables snapping down stairs/slopes)
    const pre = this._query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, this._cand);
    const sup0 = this._support(pos.x, pos.z, pos.y + 0.05, radius * 0.6, pre);
    const wasGround = vel.y <= 0.01 && sup0 > -Infinity && pos.y - sup0 <= 0.06;

    if (typeof gravity === 'number' && gravity) vel.y += gravity * dt;
    if (vel.y < -60) vel.y = -60;

    const horiz = Math.sqrt(vel.x * vel.x + vel.z * vel.z) * dt;
    const vert = Math.abs(vel.y) * dt;
    const n = Math.min(12, Math.max(1, Math.ceil(Math.max(horiz / (radius * 0.75), vert / 0.3))));
    const sdt = dt / n;
    let ground = wasGround;
    for (let i = 0; i < n; i++) {
      ground = this._step(pos, vel, radius, height, sdt, ground, res);
    }
    res.onGround = ground;

    const bd = this.bounds;
    if (bd) {
      const r = radius;
      if (pos.x < bd.minX + r) { pos.x = bd.minX + r; if (vel.x < 0) vel.x = 0; res.hitWall = true; }
      if (pos.x > bd.maxX - r) { pos.x = bd.maxX - r; if (vel.x > 0) vel.x = 0; res.hitWall = true; }
      if (pos.z < bd.minZ + r) { pos.z = bd.minZ + r; if (vel.z < 0) vel.z = 0; res.hitWall = true; }
      if (pos.z > bd.maxZ - r) { pos.z = bd.maxZ - r; if (vel.z > 0) vel.z = 0; res.hitWall = true; }
    }
    return res;
  }

  _step(pos, vel, r, h, dt, wasGround, res) {
    const canStep = wasGround || vel.y <= 0;
    const ox = pos.x, oz = pos.z;

    // ---------- horizontal
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;

    // heightfield cliffs act as walls when the rise is too high to step
    if (this._hf && (pos.x !== ox || pos.z !== oz)) {
      const hNew = this._h(pos.x, pos.z);
      if (hNew - pos.y > STEP && hNew > this._h(ox, oz) + 0.001) {
        const hx = this._h(pos.x, oz), hz = this._h(ox, pos.z);
        if (hx - pos.y <= STEP) { pos.z = oz; vel.z = 0; }
        else if (hz - pos.y <= STEP) { pos.x = ox; vel.x = 0; }
        else { pos.x = ox; pos.z = oz; vel.x = 0; vel.z = 0; }
        res.hitWall = true;
      }
    }

    const cands = this._query(pos.x - r - 0.5, pos.z - r - 0.5, pos.x + r + 0.5, pos.z + r + 0.5, this._cand);
    const stepTop = pos.y + (canStep ? STEP : 0.02);
    const headY = pos.y + h;
    const r2 = r * r;
    for (let iter = 0; iter < 3; iter++) {
      let pushed = false;
      for (let i = 0; i < cands.length; i++) {
        const b = cands[i];
        if (b.maxY <= stepTop) continue;          // floor / steppable — vertical pass handles it
        if (b.minY >= headY - 0.001) continue;     // above our head
        const cx = pos.x < b.minX ? b.minX : (pos.x > b.maxX ? b.maxX : pos.x);
        const cz = pos.z < b.minZ ? b.minZ : (pos.z > b.maxZ ? b.maxZ : pos.z);
        let ddx = pos.x - cx, ddz = pos.z - cz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 >= r2) continue;
        let nx = 0, nz = 0;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          nx = ddx / d; nz = ddz / d;
          const push = r - d;
          pos.x += nx * push; pos.z += nz * push;
        } else {
          // center inside the box footprint: exit through the nearest side
          const pl = pos.x - b.minX, pr = b.maxX - pos.x, pb = pos.z - b.minZ, pf = b.maxZ - pos.z;
          const m = Math.min(pl, pr, pb, pf);
          if (m === pl) { pos.x = b.minX - r; nx = -1; }
          else if (m === pr) { pos.x = b.maxX + r; nx = 1; }
          else if (m === pb) { pos.z = b.minZ - r; nz = -1; }
          else { pos.z = b.maxZ + r; nz = 1; }
        }
        const vn = vel.x * nx + vel.z * nz;
        if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; }
        res.hitWall = true;
        pushed = true;
      }
      if (!pushed) break;
    }

    // ---------- vertical
    const prevY = pos.y;
    pos.y += vel.y * dt;

    // ceiling
    if (vel.y > 0) {
      const head = pos.y + h, prevHead = prevY + h;
      const rr = r * 0.85, rr2 = rr * rr;
      for (let i = 0; i < cands.length; i++) {
        const b = cands[i];
        if (b.minY < prevHead - 0.05 || b.minY > head) continue;
        const cx = pos.x < b.minX ? b.minX : (pos.x > b.maxX ? b.maxX : pos.x);
        const cz = pos.z < b.minZ ? b.minZ : (pos.z > b.maxZ ? b.maxZ : pos.z);
        const ddx = pos.x - cx, ddz = pos.z - cz;
        if (ddx * ddx + ddz * ddz >= rr2) continue;
        pos.y = b.minY - h;
        vel.y = 0;
        res.hitCeiling = true;
        break;
      }
    }

    // ground
    let onGround = false;
    const sup = this._support(pos.x, pos.z, Math.max(prevY, pos.y) + (canStep ? STEP : 0.02), r * 0.6, cands);
    if (sup > -Infinity) {
      if (pos.y <= sup) {
        res.stepped += sup - pos.y;
        pos.y = sup;
        if (vel.y < 0) vel.y = 0;
        onGround = vel.y <= 0.01;
      } else if (wasGround && vel.y <= 0 && pos.y - sup <= SNAP) {
        res.stepped -= pos.y - sup;
        pos.y = sup;
        vel.y = 0;
        onGround = true;
      } else if (vel.y <= 0 && pos.y - sup < 0.02) {
        onGround = true;
      }
    }
    return onGround;
  }

  // ray vs boxes (slab) + heightfield march. Returns distance only (Infinity on miss).
  _ray(ox, oy, oz, dx, dy, dz, maxDist, out) {
    let best = maxDist;
    let hitAxis = -1, hitSign = 0, hitBox = null, terrain = false;
    let cands;
    if (maxDist <= 64) {
      const ex = ox + dx * maxDist, ez = oz + dz * maxDist;
      cands = this._query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), this._cand2);
    } else {
      cands = this._list;
    }
    for (let i = 0; i < cands.length; i++) {
      const b = cands[i];
      let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
      // X
      if (Math.abs(dx) < 1e-12) { if (ox < b.minX || ox > b.maxX) continue; }
      else {
        const inv = 1 / dx;
        let t1 = (b.minX - ox) * inv, t2 = (b.maxX - ox) * inv, s = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
        if (t2 < tmax) tmax = t2;
      }
      // Y
      if (Math.abs(dy) < 1e-12) { if (oy < b.minY || oy > b.maxY) continue; }
      else {
        const inv = 1 / dy;
        let t1 = (b.minY - oy) * inv, t2 = (b.maxY - oy) * inv, s = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
        if (t2 < tmax) tmax = t2;
      }
      // Z
      if (Math.abs(dz) < 1e-12) { if (oz < b.minZ || oz > b.maxZ) continue; }
      else {
        const inv = 1 / dz;
        let t1 = (b.minZ - oz) * inv, t2 = (b.maxZ - oz) * inv, s = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
        if (t2 < tmax) tmax = t2;
      }
      // origin inside a box doesn't count as a hit (tmin <= 0)
      if (tmin > EPS && tmin <= tmax && tmin < best) { best = tmin; hitAxis = axis; hitSign = sign; hitBox = b; }
    }

    if (this._hf) {
      let prevDiff = oy - this._h(ox, oz);
      if (prevDiff > 0) {
        const stepLen = Math.max(0.5, best / 400);
        let t = 0, prevT = 0;
        while (t < best) {
          t = Math.min(t + stepLen, best);
          const diff = (oy + dy * t) - this._h(ox + dx * t, oz + dz * t);
          if (diff <= 0) {
            let lo = prevT, hi = t;
            for (let k = 0; k < 10; k++) {
              const mid = (lo + hi) * 0.5;
              const dm = (oy + dy * mid) - this._h(ox + dx * mid, oz + dz * mid);
              if (dm > 0) lo = mid; else hi = mid;
            }
            if (hi < best) { best = hi; terrain = true; hitBox = null; }
            break;
          }
          prevT = t;
        }
      }
    }

    if (out) {
      out.terrain = terrain;
      out.box = hitBox;
      out.axis = hitAxis;
      out.sign = hitSign;
    }
    return (terrain || hitBox) ? best : Infinity;
  }

  raycast(origin, dir, maxDist = 1000) {
    if (!origin || !dir) return null;
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    if (!(len > 1e-9)) return null;
    const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;
    const info = {};
    const d = this._ray(origin.x, origin.y, origin.z, dx, dy, dz, Math.max(0, maxDist), info);
    if (d === Infinity) return null;
    const point = new THREE.Vector3(origin.x + dx * d, origin.y + dy * d, origin.z + dz * d);
    const normal = new THREE.Vector3(0, 1, 0);
    if (info.box && info.axis >= 0) {
      normal.set(0, 0, 0);
      normal.setComponent(info.axis, info.sign);
    } else if (info.terrain) {
      const e = 0.25;
      const hx = this._h(point.x + e, point.z) - this._h(point.x - e, point.z);
      const hz = this._h(point.x, point.z + e) - this._h(point.x, point.z - e);
      if (isFinite(hx) && isFinite(hz)) normal.set(-hx, 2 * e, -hz).normalize();
    }
    return { distance: d, point, normal, boxId: info.box ? info.box.id : null, terrain: !!info.terrain };
  }

  lineOfSight(a, b) {
    if (!a || !b) return false;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.1) return true;
    const inv = 1 / dist;
    return this._ray(a.x, a.y, a.z, dx * inv, dy * inv, dz * inv, dist - 0.1, null) === Infinity;
  }
}

export default World;
