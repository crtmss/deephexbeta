// deephexbeta/src/main.js
import LobbyScene from './scenes/LobbyScene.js';
import WorldScene from './scenes/WorldScene.js';
import CombatScene from './scenes/CombatScene.js';

const DESIGN_WIDTH  = 1600;   // your "authoring" size
const DESIGN_HEIGHT = 1000;

const config = {
  type: Phaser.AUTO,
  backgroundColor: '#7CC4FF',
  parent: 'game-container',
  scene: [LobbyScene, WorldScene, CombatScene],

  // 👇 important: use Phaser’s Scale Manager
  scale: {
    mode: Phaser.Scale.FIT,                     // scale uniformly to fit
    autoCenter: Phaser.Scale.CENTER_BOTH,       // center the canvas
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT
  },

  // 👇 crisp rendering on high-DPI devices
  resolution: window.devicePixelRatio || 1,
  render: {
    antialias: true,
    roundPixels: true,
    pixelArt: false
  },

  dom: { createContainer: true }
};

new Phaser.Game(config);
