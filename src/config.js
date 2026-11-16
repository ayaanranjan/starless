// Global config. TITLE is a working title — change it here and in index.html <title>.
export const CONFIG = {
  title: 'STARLESS',
  tagline: 'They took us past the edge of the stars.',
  version: '0.1.0',
  peerPrefix: 'starless-v1-',
  maxPlayers: 4,
  callsigns: ['VEGA', 'ORION', 'LYRA', 'ATLAS'],
  colors: [0x4fd1ff, 0xffb347, 0xb48cff, 0x7dff9a],
  colorsCss: ['#4fd1ff', '#ffb347', '#b48cff', '#7dff9a'],
  levels: ['l1', 'l2', 'l3'],
  cutsceneAfter: { 0: 'l1_end', 1: 'l2_end', 2: 'ending' },
  netRates: { player: 15, level: 10 },
  credits: [
    ['A co-op horror game', 'STARLESS (working title)'],
    ['Engine', 'Three.js r170 · WebRTC via PeerJS'],
    ['Sound', 'Synthesized live in your browser'],
    ['Built with', 'Claude Code'],
  ],
};
