# STARLESS (working title)

A co-op space horror game that runs in the browser. 1–4 players. Three.js + WebRTC (PeerJS), no build step.

> 2091. The survey ship *Perihelion* chases a signal past Neptune, into a patch of sky where the stars are going out.
> Something was waiting there. It took the crew.

## Chapters
1. **The Drowning World** – a toxic gas-shrouded planet. Find four rocket parts, launch, fail, survive, launch again. Stalkers hunt by sound.
2. **The Hollow Ark** – a derelict alien warp-ship. Each warp core you light jumps the ship into another universe.
3. **The Dark Between** – floating wreckage in a dark-matter void, watched by something enormous. Open the Gate, run for the wormhole.

## Play
- **Solo:** New Game. **Co-op:** one person picks *Host Co-op* and shares the 5-letter crew code; friends pick *Join Co-op*.
- Controls: WASD move · mouse look · Shift sprint · C crouch (quieter) · Space jump · F flashlight (stuns monsters, drains battery) · E interact / hold · T chat · Esc pause.
- Progress saves at checkpoints (browser localStorage). The host's save decides where the crew starts.

## Run locally
```bash
python3 -m http.server 8642
```
Open http://localhost:8642. Dev shortcuts: `?level=2` jumps to a chapter, `?nocut` skips cutscenes, `?god` disables damage.

## How multiplayer works
Peer-to-peer WebRTC through PeerJS's free public signaling server. The host's browser runs the monsters and objectives; everyone else sends their position 15×/sec and gets the world state back 10×/sec. No game server to pay for. Very strict networks (some school Wi-Fi) can block WebRTC.

## Layout
See `ARCHITECTURE.md` for the module contract. `src/engine` (renderer, physics, player), `src/levels` (chapters), `src/creatures` (monsters + AI), `src/audio` (all sound is synthesized live), `src/net`, `src/ui`, `src/story` (cutscenes).
