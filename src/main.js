import LobbyScene from './scenes/LobbyScene.js';
import WorldScene from './scenes/WorldScene.js';
import CombatScene from './scenes/CombatScene.js';

const config = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: '#000000',
  parent: 'game-container',
  scene: [LobbyScene, WorldScene, CombatScene],
  dom: {
    createContainer: true  // 👈 this is the missing piece
  }
};

const game = new Phaser.Game(config);
