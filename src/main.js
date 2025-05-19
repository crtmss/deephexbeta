import LobbyScene from './scenes/LobbyScene.js';
import WorldScene from './scenes/WorldScene.js';
import CombatScene from './scenes/CombatScene.js';

const config = {
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    backgroundColor: '#000000',
    scene: [LobbyScene, WorldScene, CombatScene],
    parent: 'game-container',
};

const game = new Phaser.Game(config);
