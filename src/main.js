// deephexbeta/src/main.js

import LobbyScene from './scenes/LobbyScene.js';
import WorldScene from './scenes/WorldScene.js';
import CombatScene from './scenes/CombatScene.js';

const config = {
  type: Phaser.AUTO,
  width: 1600, // Increased from 1280
  height: 1000, // Increased from 720
  backgroundColor: '#000000',
  parent: 'game-container',
  scene: [LobbyScene, WorldScene, CombatScene],
  dom: {
    createContainer: true
  }
};

const game = new Phaser.Game(config);
