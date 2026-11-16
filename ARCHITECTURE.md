# STARLESS — architecture contract (working title)

Browser co-op space-horror FPS. Three.js r170 + PeerJS (WebRTC P2P, host-authoritative). **No build step, no npm.**
Static site served from repo root; deployed to Vercel as static files.

## Hard rules for every module
- ES modules only. `import * as THREE from 'three'`; addons from `'three/addons/...'` (import map in index.html → three@0.170.0 on jsdelivr). PeerJS is a global `window.Peer` (script tag).
- **No external assets.** Textures = procedural (CanvasTexture/DataTexture). Audio = Web Audio synthesis. Models = Three primitives / BufferGeometry.
- Units meters, Y up. Player: radius 0.35, height 1.75, eye 1.62 (crouch eye 1.0).
- Call other modules defensively: `ctx.audio?.play?.('x')`. Never crash the frame loop: wrap risky per-frame code in try/catch where sensible.
- Layout/procedural generation that must match across peers uses **`ctx.rng()` only** (seeded, same on all peers). `Math.random` is fine for purely visual noise (particles, flicker).
- Perf budget: 60fps on an M1 Air / mid laptop. InstancedMesh for repeated props, < ~250 draw calls, no per-frame allocations in hot loops, max 1 shadow-casting light (the local flashlight, owned by player.js). Level build < 3s.
- Syntax check every file you write (no node on this machine):
  `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -e 'checkModuleSyntax(readFile("ABS_PATH"))'` (silent = OK).

## File ownership
| File | Owner |
|---|---|
| index.html, vercel.json, src/config.js, ARCHITECTURE.md | lead |
| src/engine/renderer.js, input.js, world.js, player.js, fx.js | ENGINE |
| src/main.js, src/engine/interact.js, src/engine/save.js | GAME |
| src/ui/ui.js, src/ui/ui.css | UI |
| src/audio/audio.js | AUDIO |
| src/net/net.js | NET |
| src/creatures/creatures.js | CREATURES |
| src/levels/level1.js / level2.js / level3.js | L1 / L2 / L3 |
| src/story/cutscenes.js | STORY |

## Story bible (all text/dialogue must fit this)
- 2091. Deep-survey vessel **ICV PERIHELION** investigates "the Lantern": a signal from 7 AU beyond Neptune, where stars are going dark one by one (the *starless* patch). Voices: **CONTROL** (Dr. Amara Okafor, Earth), **HALE** (ship AI, calm, glitchy later). Players are crew; callsigns by join order: **VEGA, ORION, LYRA, ATLAS** (`CONFIG.callsigns`).
- Intro: a colossal organic alien vessel, **the Harvester** (black ribbed hull, bioluminescent cyan veins), unfolds out of the dark, kills the ship's power and takes the crew in a pale beam.
- **Chapter I — THE DROWNING WORLD** (planet **VESPER**): toxic gas-shrouded world, yellow‑green fog, green lightning, a ringed gas giant in the sky, oxygen vents. The crew is dumped like specimens. A previous abducted crew (**the Kestrel expedition**, 2063) left a half-built escape rocket and audio logs. Monsters: **Stalkers** (tall, thin, eyeless, clicking, hunt by sound, recoil from flashlight). Goal: find 4 rocket parts, install, launch → **launch fails** (coolant rupture) → seal 3 valves while the stalkers swarm → relaunch → escape.
- **Chapter II — THE HOLLOW ARK**: the rocket is snatched by a derelict alien warp-ship (the Ark) full of specimen pods (one holds a Kestrel astronaut). Activate 3 warp cores; each core triggers a **warp jump** into another universe (crimson nebula → crystal cyan → inverted white void), changing the lighting/sky and the life forms. Monsters: **Crawlers** (many-legged, fast, hate light) and **Mimics** (silhouettes of crew members that stand still and vanish when lit). Then engage the warp drive in the hub.
- **Chapter III — THE DARK BETWEEN**: a dark-matter realm: floating fragments of abducted ships (including the Perihelion's broken hull) in a violet-black void with dark-energy streams; low gravity; a colossal **Watcher** (cluster of eyes + tendrils) in the distance that turns to look at players. Monsters: **Wraiths** (floating, phase through matter, stunned by light). Collect 3 singularity shards → power the Gate → realm collapses → run to the wormhole.
- Ending: they exit near Earth at dawn. CONTROL: "Perihelion... your last transmission was forty-one years ago." The radio fills with familiar clicking. Something came back with them. Title card. TO BE CONTINUED.

## Game flow (main.js, GAME)
`MENU → LOBBY → cutscene 'intro' → L1 → cutscene 'l1_end' → L2 → cutscene 'l2_end' → L3 → cutscene 'ending' → credits → MENU`
Solo = host with no peers (no PeerJS needed). Debug URL params: `?level=1|2|3` (start directly, solo), `?nocut` (skip cutscenes), `?god`.
Save (localStorage `starless.save`): `{levelIndex, levelSave, unlocked, t}`. Host saves on `ctx.checkpoint()`; every peer stores `unlocked` (highest chapter reached). Lobby lets host choose New Game or any unlocked chapter / Continue.
All players down (or solo death) → UI 'gameover' ("SIGNAL LOST") → retry = reload current level from last checkpoint save.

## ctx (built by main.js, passed to levels, creatures, cutscenes)
```js
ctx = {
  THREE, scene, camera, renderer,     // camera owned by player.js during play; cutscenes may drive it while ctx.cinematic === true
  world,            // World (engine/world.js)
  audio, ui, fx, net, input,
  isHost,           // true in solo
  localId,          // string
  players,          // Map<id, PlayerState> incl. local
  getLocalPlayer(), // PlayerState
  localPlayer,      // LocalPlayer instance (player.js)
  interact,         // Interactables (engine/interact.js)
  rng,              // () => [0,1) seeded per level (same seed on all peers)
  time,             // seconds since level start
  quality,          // 'low' | 'high'
  cinematic,        // bool; when true LocalPlayer doesn't move/drive camera
  addUpdate(fn),    // fn(dt) every frame; returns remove()
  levelEvent(type, data), // any peer: host -> level.onEvent on host + broadcast to all; client -> sent to host, host runs level.onEvent(type,data,fromId) and rebroadcasts. Every peer's level.onEvent gets called exactly once per event.
  damagePlayer(id, amount, srcPos),   // HOST ONLY. routes to the owning peer (LocalPlayer.applyDamage)
  givePlayer(id, {health, oxygen, battery}), // HOST ONLY. routes to owning peer (LocalPlayer.give)
  setOxygenDrain(perSec),   // per-level oxygen drain (0 = breathable). default 0
  addOxygenZone(pos, radius) -> id,   // inside zone: oxygen refills +25/s
  setGravity(g),            // default -18; L3 uses ~-7
  checkpoint(),     // HOST ONLY. saves level.getSaveData()
  completeLevel(),  // HOST ONLY. ends level -> transition cutscene -> next level on all peers
  noiseAt(pos, loudness),  // anyone; host forwards to creatures via level (levels may also read PlayerState.noise)
}
PlayerState = { id, name, callsign, color, isLocal, position: Vector3 (feet), yaw, pitch, flashlight: bool,
  health 0-100, oxygen 0-100, battery 0-100, stamina 0-100, downed: bool, noise 0-1, crouching: bool }
```

## Level interface (src/levels/levelN.js) — default export class
```js
export default class Level1 {
  static id = 'l1'; static title = 'CHAPTER I'; static subtitle = 'THE DROWNING WORLD';
  constructor(ctx)
  async build(save)      // save = getSaveData() object from checkpoint or null. Build scene (fog, background, lights, terrain, props),
                         // colliders (ctx.world), interactables (ctx.interact), creatures. Deterministic via ctx.rng.
  spawnPoints()          // [{x,y,z,yaw}] x4 (y = feet)
  update(dt)             // all peers each frame. Host: AI + objective logic. Clients: visuals + interpolation.
  getState()             // HOST, ~10Hz: small JSON (creature net states, objective flags, door states...)
  applyState(s)          // CLIENTS
  onEvent(type, data, fromId) // all peers
  getSaveData()          // HOST: JSON checkpoint
  dispose()              // stop loops/sounds, remove listeners (main.js clears scene/world/interactables after)
}
```
Levels set objectives via `ctx.ui.setObjective(text)` on every peer (drive it from state so clients match). Each level should take ~6–10 min, be completable solo and co-op (2–4).

## Engine APIs (ENGINE)
```js
// renderer.js
export function createRenderer(container, quality) -> {
  renderer, scene, camera, composer,
  render(dt),               // composer render incl. post
  resize(), setQuality(q),
  post: { set(params), get() } // {vignette 0-1, grain 0-1, chroma 0-1, glitch 0-1, damage 0-1, saturation, exposure, tint:[r,g,b], bloomStrength}
}
// input.js
export const input = { init(canvas), isDown(code), pressed(code), mouseDelta()->{x,y}, lock(), unlock(), isLocked(), onLockChange(fn), enabled, endFrame() }
// world.js
export class World {
  clear(); setHeightfield(fn(x,z)->y | null); addBox(minV3, maxV3) -> id; addBoxFromObject(obj3d) -> id; removeBox(id);
  groundHeight(x, z, fromY = Infinity) -> number (-Infinity if none)
  moveCapsule(pos, vel, radius, height, dt, gravity) -> { onGround }   // mutates pos & vel; slides along boxes, stands on box tops/heightfield
  raycast(origin, dir, maxDist) -> {distance, point} | null
  lineOfSight(a, b) -> bool
  killY = -60; bounds = null | {minX,maxX,minZ,maxZ}
}
// player.js
export class LocalPlayer { constructor(ctx, state); spawn({x,y,z,yaw}); update(dt); applyDamage(amount, srcPos); give({health,oxygen,battery});
  revive(); setFrozen(bool); flashlight /* SpotLight, castShadow */; gravity; dispose() }
export class RemotePlayer { constructor(ctx, state); setNetState(s); update(dt); dispose() }   // astronaut avatar, name tag, non-shadow spotlight
// fx.js
export function createFX(ctx) -> { shake(intensity, dur), flash(hex, intensity, dur), pulseGlitch(amount, dur), setGlitch(v),
  setGrade({saturation, exposure, tint}), burst(pos, {count,color,speed,life,size}), update(dt), applyCamera(camera) }
```
Controls: WASD, mouse look (pointer lock), Shift sprint, C/Ctrl crouch, Space jump, F flashlight, E interact (hold), T chat, Esc pause.

## Interactables (engine/interact.js, GAME)
```js
ctx.interact.add({ id /*unique & identical on all peers*/, object /*Object3D for position*/, radius: 2.2, prompt: 'Pick up fuel cell',
                   holdTime: 0 /*sec, >0 = hold E*/, enabled: true, onInteract(playerId) {} })   // onInteract runs ON HOST ONLY
ctx.interact.remove(id); ctx.interact.setEnabled(id, bool); ctx.interact.setPrompt(id, text)
```

## Creatures (src/creatures/creatures.js, CREATURES)
```js
export function createCreature(type, ctx, opts) -> Creature   // adds itself to ctx.scene
// types: 'stalker' (L1), 'crawler' (L2), 'mimic' (L2), 'wraith' (L3), 'leviathan' (L1 sky decor, non-hostile), 'watcher' (L3 colossal decor that looks at nearest player)
// opts: { position: Vector3, patrol?: Vector3[], speed?, damage?, aggression? }
class Creature { object, type, position, yaw, state /* 'idle'|'patrol'|'investigate'|'chase'|'attack'|'stunned'|'flee' */,
  setPatrol(points), hearNoise(pos, loudness), update(dt) /* host: AI+move+anim; clients: interpolate+anim */,
  getNetState() -> array, setNetState(arr), dispose() }
```
Host AI uses ctx.players (position, noise, flashlight+yaw/pitch for light cone), ctx.world (moveCapsule/groundHeight/lineOfSight), ctx.damagePlayer, ctx.audio (positional loops), ctx.fx (shake when close).

## Audio (src/audio/audio.js, AUDIO) — all synthesized
```js
export const audio = { init() /*on user gesture*/, setListener(pos, forwardV3), setMasterVolume(v), ambience(name) /* 'menu','l1','l2','l3','cutscene','silence' */,
  play(name, {position, volume, pitch}), loop(name, {position, volume}) -> {setPosition(v3), setVolume(v), stop(fadeSec)},
  setTension(0..1), setMuffle(0..1), stinger(), speak(seconds) /* radio chatter blip under subtitles */ }
```
One-shots: footstep, footstep_metal, jump, land, pickup, interact, deny, heartbeat, breath, stinger, screech, growl, click, static, beep, radio, door, alarm, warp, explosion, rocket_fail, rocket_launch, hurt, death, revive, whisper, metal_groan, thunder, ui_hover, ui_select, typing, valve, shard, gate.
Loops: creature_breath, creature_chitter, wraith_hum, engine_hum, alarm_loop, wind, fire, beacon, rocket_charge, steam, warp_core.

## Net (src/net/net.js, NET)
```js
export class Net { async host(name) -> code; async join(code, name); isHost; localId; peers /*Map id->{id,name}*/;
  send(msg) /* client->host, host->all */; broadcast(msg, exceptId); sendTo(id, msg); on(t, fn(msg, fromId)); onPeerJoin(fn(id,name)); onPeerLeave(fn(id)); ping(); close() }
```
Messages are JSON with `t`. Protocol (GAME implements): `lobby` `start{levelIndex,seed,save}` `pst`(player state, 15Hz c→h) `pall`(all players, 15Hz h→all) `ls`(level state 10Hz) `ev{type,data,from}` `interact{id}` `dmg{id,amount,src}` `give{id,...}` `revive{id}` `chat{name,text}` `cut{name}` `skip` `next{levelIndex,save}` `over` `retry`.

## UI (src/ui/ui.js + ui.css, UI) — DOM overlay in `#ui`
```js
export const ui = { init(root), showScreen(name, data) /* 'menu','lobby','join','settings','loading','hud','pause','gameover','credits','none' */,
  onAction(fn(action, payload)) /* 'solo','host','join'(code),'continue','start'({levelIndex}),'leave','resume','retry','quit','settings'(settings) */,
  setLobby({code, players:[{id,name,callsign,color,isHost}], isHost, unlocked, status}), setObjective(text), setPrompt(text|null, progress0to1),
  setVitals({health, oxygen, stamina, battery}), setTeam([{name,callsign,color,health,downed}]), subtitle(speaker, text, seconds),
  notify(text, seconds), chapterCard(title, subtitle), fade(toBlack, seconds) -> Promise, letterbox(on), damageFlash(v),
  setDowned(bool, secondsLeft), chatMessage(name, text), onChat(fn(text)), openChat(), showLoading(text, p), getSettings(), skipHint(bool) }
```

## Cutscenes (src/story/cutscenes.js, STORY)
```js
export function playCutscene(name, ctx) -> { promise, skip() }  // 'intro','l1_end','l2_end','ending'. ctx.cinematic=true while running.
export function buildMenuBackdrop(ctx) -> { update(dt), dispose() } // 3D space scene behind the main menu
```
Cutscenes build their own temporary objects in ctx.scene, drive ctx.camera, use ctx.ui.subtitle/letterbox/fade, ctx.audio, ctx.fx; clean up after.
