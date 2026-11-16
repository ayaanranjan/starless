// src/net/net.js (owner: NET). PeerJS 1.5.4 wrapper: star topology, host-authoritative, JSON messages with field `t`.
//
//   const net = new Net();
//   const code = await net.host('Ayaan');      // host peer id = CONFIG.peerPrefix + code (5 chars)
//   await net.join('ab cde', 'Sam');           // resolves with the normalized code once the host welcomes us
//   net.on('pst', (msg, fromId) => {});        // many handlers per type; net.on('*', fn) sees every game message. Returns unsubscribe.
//   net.send(msg)                              // client -> host; host -> all clients
//   net.broadcast(msg, exceptId); net.sendTo(id, msg)   // never throw; return true if handed to an open connection
//   net.onPeerJoin((id, name) => {})           // host: a client was admitted
//   net.onPeerLeave((id) => {})                // host: a client left/dropped. client: fires with hostId when the host is lost
//   net.onError((message) => {})               // runtime problems after connecting (host()/join() failures reject instead)
//   await net.ping(id?)                        // RTT ms (client: host; host: worst client). Infinity on timeout, 0 when alone
//   net.latency                                // RTT ms, refreshed every 2 s
//   net.close()                                // leave quietly (no onPeerLeave), back to solo defaults. Handlers stay registered.
// State: isHost (true when idle/solo), localId ('local' when idle), peers Map id -> {id, name, latency}
//   (host: clients; client: just the host), code, hostId, hostName, connected, roster (client: [{id,name,host}] from welcome).
// Internal types never reach game handlers: hello, welcome, full, ping, pong, bye, _chunk.
// Messages too big for PeerJS's JSON channel (~16 KB) are split into `_chunk`s and reassembled transparently.
import { CONFIG } from '../config.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 5;
const SETUP_TIMEOUT_MS = 12000;
const MAX_HOST_TRIES = 5;
const PING_EVERY_MS = 2000;
const PING_TIMEOUT_MS = 5000;
const SILENCE_DROP_MS = 20000;
const HELLO_TIMEOUT_MS = 10000;
const CLOSE_DELAY_MS = 150;
const CHUNK_CHARS = 2500; // x6 worst-case JSON/UTF-8 growth stays under PeerJS's 16300-byte JSON limit
const MAX_CHUNKS = 4096;

const INTERNAL = new Set(['hello', 'welcome', 'full', 'ping', 'pong', 'bye', '_chunk']);
const RECOVERABLE_PEER_ERRORS = new Set(['network', 'socket-error', 'socket-closed', 'server-error',
  'unavailable-id', 'disconnected', 'peer-unavailable', 'webrtc']);
const SERVER_ERRORS = new Set(['network', 'socket-error', 'socket-closed', 'server-error', 'ssl-unavailable',
  'invalid-key', 'disconnected']);

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

const MSG = {
  noLib: 'Multiplayer library failed to load',
  noCrew: "Couldn't reach that crew. Check the code.",
  full: 'That crew is full.',
  server: "Couldn't reach the multiplayer server. Check your internet connection and try again.",
  browser: "This browser doesn't support WebRTC multiplayer. Try a current Chrome, Edge, Firefox or Safari.",
  direct: "Couldn't open a direct connection to the crew (a firewall may be blocking it).",
  noCode: "Couldn't create a crew code. Try again.",
  cancelled: 'Connection cancelled.',
  signalLost: "Lost the multiplayer server. Your crew is still connected, but nobody new can join right now.",
};

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const errType = (e) => (e && typeof e === 'object' && (e.type || e.code)) || '';

function friendly(err) {
  const t = errType(err);
  if (t === 'browser-incompatible') return MSG.browser;
  if (t === 'peer-unavailable') return MSG.noCrew;
  if (SERVER_ERRORS.has(t)) return MSG.server;
  if (t === 'webrtc' || t === 'negotiation-failed' || t === 'connection-closed') return MSG.direct;
  return err && err.message ? String(err.message) : 'Multiplayer error.';
}

function peerCtor() {
  const w = typeof window !== 'undefined' ? window : null;
  const P = w && (w.Peer || (w.peerjs && w.peerjs.Peer));
  if (typeof P !== 'function') throw new Error(MSG.noLib);
  return P;
}

const peerOptions = () => ({ config: { iceServers: ICE_SERVERS }, debug: 1 });

function randomCode() {
  const buf = new Uint32Array(CODE_LEN);
  try { crypto.getRandomValues(buf); } catch (e) {
    for (let i = 0; i < CODE_LEN; i++) buf[i] = Math.floor(Math.random() * 0x100000000);
  }
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[buf[i] % CODE_CHARS.length];
  return s;
}

function cleanName(name, fallback = 'Crew') {
  const s = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20);
  return s || fallback;
}

/** 'ab-cde ' -> 'ABCDE'; also accepts a pasted full peer id. */
export function normalizeCode(code) {
  let c = String(code == null ? '' : code).trim().toUpperCase();
  const p = CONFIG.peerPrefix.toUpperCase();
  const at = c.lastIndexOf(p);
  if (at >= 0) c = c.slice(at + p.length);
  return c.replace(/[^A-Z0-9]/g, '');
}

function safeClose(conn) { try { if (conn && conn.close) conn.close(); } catch (e) { /* ignore */ } }
function safeDestroy(peer) { try { if (peer && !peer.destroyed) peer.destroy(); } catch (e) { /* ignore */ } }
function addTo(set, fn) {
  if (typeof fn !== 'function') return () => {};
  set.add(fn);
  return () => set.delete(fn);
}
function callAll(set, label, a, b) {
  for (const fn of set) {
    try { fn(a, b); } catch (e) { console.error(`[net] ${label} handler threw`, e); }
  }
}
const newInfo = () => ({ lastHeard: now(), tooBig: false, chunks: null });

function readChunk(info, m) {
  if (!info) return null;
  const n = m.n | 0, i = m.i | 0;
  if (n <= 0 || n > MAX_CHUNKS || i < 0 || i >= n || typeof m.d !== 'string') return null;
  if (!info.chunks) info.chunks = new Map();
  let c = info.chunks.get(m.k);
  if (!c) { c = { n, parts: new Array(n), got: 0 }; info.chunks.set(m.k, c); }
  if (c.parts[i] === undefined) { c.parts[i] = m.d; c.got++; }
  if (c.got < c.n) return null;
  info.chunks.delete(m.k);
  try { return JSON.parse(c.parts.join('')); } catch (e) { return null; }
}

export class Net {
  constructor() {
    this.isHost = true;        // idle/solo counts as "host with no peers"
    this.localId = 'local';
    this.name = 'Crew';
    this.code = null;
    this.hostId = null;
    this.hostName = null;
    this.roster = [];
    this.peers = new Map();    // id -> {id, name, latency}
    this.latency = 0;
    this.connected = false;

    this._handlers = new Map(); // t -> Set<fn>
    this._joinFns = new Set();
    this._leaveFns = new Set();
    this._errorFns = new Set();

    this._peer = null;
    this._conns = new Map();   // admitted connections: id -> DataConnection
    this._raw = new Set();     // every DataConnection of this session (closed on teardown)
    this._session = null;      // token; events from stale sessions are ignored
    this._pending = null;      // {kind, session, promise, finish} while host()/join() runs
    this._pings = new Map();   // seq -> {id, resolve, t0, timer}
    this._pingSeq = 0;
    this._chunkSeq = 0;
    this._timer = 0;
    this._lastTick = 0;
    this._reconnectTimer = 0;
    this._reconnectTries = 0;

    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('pagehide', () => this._sayBye());
    }
  }

  // ---------------------------------------------------------------- public API
  async host(name) {
    if (this._pending && this._pending.kind === 'host') return this._pending.promise;
    const PeerCtor = peerCtor();
    this.close();
    this.name = cleanName(name, 'Host');
    return this._begin('host', (session, finish) => {
      let tries = 0;
      const attempt = () => {
        if (this._session !== session) return;
        tries++;
        const code = randomCode();
        const id = CONFIG.peerPrefix + code;
        let peer;
        try { peer = new PeerCtor(id, peerOptions()); } catch (e) { finish(new Error(friendly(e))); return; }
        this._peer = peer;
        let opened = false;
        const mine = () => this._session === session && this._peer === peer;
        peer.on('open', (pid) => {
          if (!mine()) return;
          this._reconnectTries = 0;
          if (opened) return; // re-open after reconnect()
          opened = true;
          this.isHost = true;
          this.localId = pid || id;
          this.code = code;
          this.hostId = this.localId;
          this.hostName = this.name;
          this.connected = true;
          this._startTimers(session);
          finish(null, code);
        });
        peer.on('connection', (conn) => {
          if (mine() && opened) this._acceptClient(conn, session);
          else safeClose(conn);
        });
        peer.on('error', (err) => {
          if (!mine()) return;
          const t = errType(err);
          if (!opened) {
            if (t === 'unavailable-id' && tries < MAX_HOST_TRIES) {
              this._peer = null;
              safeDestroy(peer);
              attempt();
              return;
            }
            finish(new Error(t === 'unavailable-id' ? MSG.noCode : friendly(err)));
            return;
          }
          this._onPeerError(err, session);
        });
        peer.on('disconnected', () => { if (mine() && opened) this._scheduleReconnect(session); });
      };
      attempt();
    });
  }

  async join(code, name) {
    const PeerCtor = peerCtor();
    const c = normalizeCode(code);
    if (!/^[A-Z0-9]{5}$/.test(c)) throw new Error(MSG.noCrew);
    this.close();
    this.name = cleanName(name, 'Crew');
    const hostId = CONFIG.peerPrefix + c;
    return this._begin('join', (session, finish) => {
      let peer;
      try { peer = new PeerCtor(peerOptions()); } catch (e) { finish(new Error(friendly(e))); return; }
      this._peer = peer;
      const mine = () => this._session === session && this._peer === peer;
      let conn = null;
      let welcomed = false;

      peer.on('open', () => {
        if (!mine()) return;
        this._reconnectTries = 0;
        if (conn) return; // re-open after reconnect()
        try {
          conn = peer.connect(hostId, { reliable: true, serialization: 'json', metadata: { name: this.name } });
        } catch (e) { finish(new Error(friendly(e))); return; }
        if (!conn) { finish(new Error(MSG.noCrew)); return; }
        const info = newInfo();
        conn._sl = info;
        this._raw.add(conn);
        conn.on('open', () => {
          if (mine()) this._sendRaw(conn, { t: 'hello', name: this.name, v: CONFIG.version });
        });
        conn.on('data', (data) => {
          if (!mine()) return;
          info.lastHeard = now();
          if (welcomed) { this._onData(conn, hostId, data); return; }
          if (!data || typeof data !== 'object') return;
          if (data.t === 'full') { finish(new Error(MSG.full)); return; }
          if (data.t !== 'welcome') return;
          welcomed = true;
          this.isHost = false;
          this.localId = peer.id || (typeof data.id === 'string' ? data.id : this.localId);
          this.code = c;
          this.hostId = hostId;
          this.hostName = cleanName(data.hostName, 'Host');
          this.roster = Array.isArray(data.peers)
            ? data.peers.filter((p) => p && typeof p.id === 'string').map((p) => ({ id: p.id, name: cleanName(p.name), host: !!p.host }))
            : [];
          this._conns.set(hostId, conn);
          this.peers.set(hostId, { id: hostId, name: this.hostName, latency: 0 });
          this.connected = true;
          this._startTimers(session);
          finish(null, c);
        });
        conn.on('close', () => {
          this._raw.delete(conn);
          if (!mine()) return;
          if (!welcomed) finish(new Error(MSG.noCrew));
          else this._dropPeer(hostId, conn);
        });
        conn.on('error', (err) => {
          if (!mine()) return;
          const t = errType(err);
          if (t === 'message-too-big') { info.tooBig = true; return; }
          if (t === 'not-open-yet') return;
          if (!welcomed) { finish(new Error(friendly(err))); return; }
          console.warn('[net] connection to host failed:', t, err);
          this._dropPeer(hostId, conn);
          safeClose(conn);
        });
      });
      peer.on('connection', (other) => safeClose(other)); // clients never accept inbound connections
      peer.on('error', (err) => {
        if (!mine()) return;
        if (!welcomed) { finish(new Error(errType(err) === 'peer-unavailable' ? MSG.noCrew : friendly(err))); return; }
        this._onPeerError(err, session);
      });
      peer.on('disconnected', () => { if (mine() && welcomed) this._scheduleReconnect(session); });
    });
  }

  /** client -> host; host -> every client. */
  send(msg) {
    if (!msg || typeof msg !== 'object') return false;
    if (this.isHost) return this.broadcast(msg);
    return this._sendRaw(this._conns.get(this.hostId), msg);
  }

  broadcast(msg, exceptId) {
    if (!msg || typeof msg !== 'object') return false;
    let ok = false;
    for (const [id, conn] of this._conns) {
      if (id !== exceptId && this._sendRaw(conn, msg)) ok = true;
    }
    return ok;
  }

  sendTo(id, msg) {
    if (!msg || typeof msg !== 'object') return false;
    return this._sendRaw(this._conns.get(id), msg);
  }

  on(t, fn) {
    if (typeof fn !== 'function') return () => {};
    let set = this._handlers.get(t);
    if (!set) { set = new Set(); this._handlers.set(t, set); }
    set.add(fn);
    return () => this.off(t, fn);
  }

  off(t, fn) {
    const set = this._handlers.get(t);
    if (set) set.delete(fn);
  }

  onPeerJoin(fn) { return addTo(this._joinFns, fn); }
  onPeerLeave(fn) { return addTo(this._leaveFns, fn); }
  onError(fn) { return addTo(this._errorFns, fn); }

  /** RTT in ms. No id: client -> host, host -> worst client. Resolves Infinity on timeout, 0 when alone. */
  ping(id) {
    if (!this.connected || this._conns.size === 0) return Promise.resolve(0);
    if (id !== undefined && id !== null) return this._pingOne(id);
    if (!this.isHost) return this._pingOne(this.hostId);
    const all = [];
    for (const pid of this._conns.keys()) all.push(this._pingOne(pid));
    return Promise.all(all).then((list) => {
      let worst = -1;
      for (const ms of list) if (Number.isFinite(ms) && ms > worst) worst = ms;
      return worst < 0 ? Infinity : worst;
    });
  }

  /** Leave quietly (no onPeerLeave), reset to solo defaults. Safe to call any time. */
  close() {
    const pending = this._pending;
    this._pending = null;
    if (this._session) this._sayBye();
    this._shutdownTransport();
    this._resetState();
    if (pending) {
      const err = new Error(MSG.cancelled);
      err.cancelled = true;
      pending.finish(err);
    }
  }

  // ---------------------------------------------------------------- internals
  _begin(kind, run) {
    const session = {};
    this._session = session;
    const pending = { kind, session, promise: null, finish: null };
    this._pending = pending;
    pending.promise = new Promise((resolve, reject) => {
      let done = false;
      let timer = 0;
      const finish = (err, val) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (this._pending === pending) this._pending = null;
        if (err) {
          if (this._session === session) { this._shutdownTransport(); this._resetState(); }
          reject(err);
        } else resolve(val);
      };
      pending.finish = finish;
      timer = setTimeout(() => finish(new Error(kind === 'host' ? MSG.server : MSG.noCrew)), SETUP_TIMEOUT_MS);
      try { run(session, finish); } catch (e) { finish(e instanceof Error ? e : new Error(String(e))); }
    });
    return pending.promise;
  }

  _acceptClient(conn, session) {
    const id = conn.peer;
    const info = newInfo();
    conn._sl = info;
    this._raw.add(conn);
    let admitted = false;
    const helloTimer = setTimeout(() => {
      if (!admitted && this._session === session) { this._raw.delete(conn); safeClose(conn); }
    }, HELLO_TIMEOUT_MS);

    conn.on('data', (data) => {
      if (this._session !== session) return;
      info.lastHeard = now();
      if (admitted) { this._onData(conn, id, data); return; }
      if (!data || data.t !== 'hello') return;
      clearTimeout(helloTimer);
      const old = this._conns.get(id);
      if (old && old !== conn) { this._dropPeer(id, old); safeClose(old); }
      if (this.peers.size >= CONFIG.maxPlayers - 1) {
        this._sendRaw(conn, { t: 'full' });
        setTimeout(() => { this._raw.delete(conn); safeClose(conn); }, 1000);
        return;
      }
      admitted = true;
      const name = cleanName(data.name || (conn.metadata && conn.metadata.name), 'Crew');
      this._conns.set(id, conn);
      this.peers.set(id, { id, name, latency: 0 });
      this._sendRaw(conn, { t: 'welcome', id, hostName: this.name, peers: this._rosterList() });
      callAll(this._joinFns, 'onPeerJoin', id, name);
    });
    conn.on('close', () => {
      clearTimeout(helloTimer);
      this._raw.delete(conn);
      if (this._session === session) this._dropPeer(id, conn);
    });
    conn.on('error', (err) => {
      if (this._session !== session) return;
      const t = errType(err);
      if (t === 'message-too-big') { info.tooBig = true; return; }
      if (t === 'not-open-yet') return;
      console.warn('[net] connection error from', id, t, err);
      this._dropPeer(id, conn);
      this._raw.delete(conn);
      safeClose(conn);
    });
  }

  _rosterList() {
    const list = [{ id: this.localId, name: this.name, host: true }];
    for (const p of this.peers.values()) list.push({ id: p.id, name: p.name });
    return list;
  }

  _onData(conn, fromId, data) {
    if (!data || typeof data !== 'object' || typeof data.t !== 'string') return;
    const t = data.t;
    if (INTERNAL.has(t)) {
      if (t === 'ping') this._sendRaw(conn, { t: 'pong', n: data.n });
      else if (t === 'pong') this._onPong(fromId, data);
      else if (t === 'bye') {
        this._dropPeer(fromId, conn);
        this._raw.delete(conn);
        setTimeout(() => safeClose(conn), CLOSE_DELAY_MS);
      } else if (t === '_chunk') {
        const whole = readChunk(conn._sl, data);
        if (whole) this._onData(conn, fromId, whole);
      }
      return; // hello / welcome / full after the handshake are ignored
    }
    this._dispatch(data, fromId);
  }

  _dispatch(msg, fromId) {
    const set = this._handlers.get(msg.t);
    if (set) {
      for (const fn of set) {
        try { fn(msg, fromId); } catch (e) { console.error(`[net] '${msg.t}' handler threw`, e); }
      }
    }
    const any = this._handlers.get('*');
    if (any) {
      for (const fn of any) {
        try { fn(msg, fromId); } catch (e) { console.error('[net] * handler threw', e); }
      }
    }
  }

  _sendRaw(conn, msg) {
    if (!conn || !conn.open) return false;
    const info = conn._sl;
    if (info) info.tooBig = false;
    try { conn.send(msg); } catch (e) { return false; }
    // PeerJS's JSON channel reports oversize messages synchronously via the connection 'error' event.
    if (info && info.tooBig) { info.tooBig = false; return this._sendChunks(conn, msg); }
    return true;
  }

  _sendChunks(conn, msg) {
    let s;
    try { s = JSON.stringify(msg); } catch (e) { console.error('[net] message not serializable', e); return false; }
    const k = ++this._chunkSeq;
    const n = Math.ceil(s.length / CHUNK_CHARS);
    if (n > MAX_CHUNKS) { console.error('[net] message too large to send', s.length); return false; }
    for (let i = 0; i < n; i++) {
      if (!conn.open) return false;
      const info = conn._sl;
      if (info) info.tooBig = false;
      try { conn.send({ t: '_chunk', k, i, n, d: s.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) }); } catch (e) { return false; }
      if (info && info.tooBig) { info.tooBig = false; console.error('[net] chunk rejected as too big'); return false; }
    }
    return true;
  }

  _dropPeer(id, conn) {
    if (this._conns.get(id) !== conn) return; // already dropped / replaced
    this._conns.delete(id);
    this.peers.delete(id);
    for (const [n, p] of this._pings) {
      if (p.id === id) { clearTimeout(p.timer); this._pings.delete(n); p.resolve(Infinity); }
    }
    const session = this._session;
    const lostHost = !this.isHost && id === this.hostId;
    callAll(this._leaveFns, 'onPeerLeave', id);
    if (lostHost && this._session === session && session) this._shutdownTransport(); // client: session is over
  }

  _pingOne(id) {
    const conn = this._conns.get(id);
    if (!conn || !conn.open) return Promise.resolve(Infinity);
    const n = ++this._pingSeq;
    return new Promise((resolve) => {
      const p = { id, resolve, t0: now(), timer: 0 };
      p.timer = setTimeout(() => {
        if (this._pings.get(n) === p) this._pings.delete(n);
        resolve(Infinity);
      }, PING_TIMEOUT_MS);
      this._pings.set(n, p);
      if (!this._sendRaw(conn, { t: 'ping', n })) {
        clearTimeout(p.timer);
        this._pings.delete(n);
        resolve(Infinity);
      }
    });
  }

  _onPong(fromId, m) {
    const p = this._pings.get(m.n);
    if (!p || p.id !== fromId) return;
    this._pings.delete(m.n);
    clearTimeout(p.timer);
    const ms = now() - p.t0;
    const entry = this.peers.get(fromId);
    if (entry) entry.latency = Math.round(ms);
    p.resolve(ms);
  }

  _startTimers(session) {
    clearInterval(this._timer);
    this._lastTick = now();
    this._timer = setInterval(() => this._tick(session), PING_EVERY_MS);
  }

  _tick(session) {
    if (this._session !== session) return;
    const t = now();
    const gap = t - this._lastTick;
    this._lastTick = t;
    const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    // Only judge silence when our own timers weren't throttled (hidden tab / long stall).
    if (visible && gap < PING_EVERY_MS * 3) {
      for (const [id, conn] of this._conns) {
        const info = conn._sl;
        if (info && t - info.lastHeard > SILENCE_DROP_MS) {
          console.warn(`[net] ${id} silent for ${Math.round((t - info.lastHeard) / 1000)}s, dropping`);
          this._dropPeer(id, conn);
          this._raw.delete(conn);
          safeClose(conn);
          if (this._session !== session) return;
        }
      }
    }
    if (this._conns.size === 0) { this.latency = 0; return; }
    this.ping().then((ms) => {
      if (this._session === session && Number.isFinite(ms)) this.latency = Math.round(ms);
    });
  }

  _onPeerError(err, session) {
    const t = errType(err);
    if (RECOVERABLE_PEER_ERRORS.has(t)) {
      console.warn('[net] signaling/peer problem:', t, err && err.message);
      const peer = this._peer;
      if (peer && peer.disconnected && !peer.destroyed) this._scheduleReconnect(session);
      return;
    }
    console.warn('[net] peer error:', t, err);
    callAll(this._errorFns, 'onError', friendly(err));
  }

  _scheduleReconnect(session) {
    if (this._session !== session || this._reconnectTimer) return;
    const peer = this._peer;
    if (!peer || peer.destroyed) return;
    const tries = this._reconnectTries++;
    if (tries === 6 && this.isHost) callAll(this._errorFns, 'onError', MSG.signalLost);
    const delay = Math.min(15000, 1000 * Math.pow(2, Math.min(tries, 4)));
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = 0;
      if (this._session !== session || this._peer !== peer || peer.destroyed || !peer.disconnected) return;
      try { peer.reconnect(); } catch (e) {
        console.warn('[net] reconnect failed', e);
        this._scheduleReconnect(session);
      }
    }, delay);
  }

  _sayBye() {
    for (const conn of this._conns.values()) this._sendRaw(conn, { t: 'bye' });
  }

  _shutdownTransport() {
    this._session = null;
    this.connected = false;
    clearInterval(this._timer);
    this._timer = 0;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = 0;
    this._reconnectTries = 0;
    if (this._pings.size) {
      const pend = [...this._pings.values()];
      this._pings.clear();
      for (const p of pend) { clearTimeout(p.timer); p.resolve(Infinity); }
    }
    const conns = [...this._raw];
    this._raw.clear();
    this._conns.clear();
    this.peers.clear();
    const peer = this._peer;
    this._peer = null;
    if (conns.length || peer) {
      // Small delay so a just-sent 'bye' can flush before the transport goes away.
      setTimeout(() => { for (const c of conns) safeClose(c); safeDestroy(peer); }, CLOSE_DELAY_MS);
    }
  }

  _resetState() {
    this.isHost = true;
    this.localId = 'local';
    this.code = null;
    this.hostId = null;
    this.hostName = null;
    this.roster = [];
    this.latency = 0;
    this.connected = false;
  }
}

export default Net;
