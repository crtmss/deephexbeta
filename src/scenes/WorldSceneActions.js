// deephexbeta/src/scenes/WorldSceneActions.js
import { findPath } from '../engine/AStar.js';

/**
 * Handles clicking hexes to issue movement
 */
export function handleHexClick(scene, pointer) {
  if (pointer.rightButtonDown()) return;
  if (!scene.selectedUnit || scene.moveCooldown) return;
  if (scene.playerName !== scene.lobbyState.currentTurn) return;

  const worldPoint = pointer.positionToCamera(scene.cameras.main);
  const clickedHex = scene.pixelToHex(worldPoint.x, worldPoint.y);
  const target = scene.mapData.find(h => h.q === clickedHex.q && h.r === clickedHex.r);
  if (!target || ['water', 'mountain'].includes(target.type)) return;

  if (scene.selectedHexGraphic) scene.selectedHexGraphic.destroy();
  const { x, y } = scene.hexToPixel(target.q, target.r, scene.hexSize);
  scene.selectedHexGraphic = scene.add.graphics({ x: 0, y: 0 });
  scene.selectedHexGraphic.lineStyle(2, 0xffff00);
  scene.selectedHexGraphic.strokeCircle(x, y, scene.hexSize * 0.8);

  scene.selectedHex = target;
  const path = findPath(
    { q: scene.selectedUnit.q, r: scene.selectedUnit.r },
    { q: target.q, r: target.r },
    scene.mapData,
    tile => ['water', 'mountain'].includes(tile.type)
  );

  if (path.length > 1) {
    scene.movingPath = path.slice(1);

    scene.pathGraphics.clear();
    scene.pathGraphics.lineStyle(3, 0x00ffff, 1);
    scene.pathGraphics.beginPath();
    const start = scene.hexToPixel(path[0].q, path[0].r, scene.hexSize);
    scene.pathGraphics.moveTo(start.x, start.y);
    for (let i = 1; i < path.length; i++) {
      const pt = scene.hexToPixel(path[i].q, path[i].r, scene.hexSize);
      scene.pathGraphics.lineTo(pt.x, pt.y);
    }
    scene.pathGraphics.strokePath();

    scene.startStepMovement();
  }
}

/**
 * Refreshes unit/enemy positions and flashes them
 */
export function refreshUnits(scene) {
  if (!scene.lobbyState?.units) return;
  for (const name in scene.lobbyState.units) {
    const other = scene.lobbyState.units[name];
    const existing = scene.players.find(p => p.playerName === name);
    if (existing) {
      const { x, y } = scene.hexToPixel(other.q, other.r, scene.hexSize);
      existing.setPosition(x, y);
      existing.q = other.q;
      existing.r = other.r;
      scene.tweens.add({ targets: existing, alpha: 0.5, duration: 100, yoyo: true, repeat: 1 });
    }
  }
  if (scene.lobbyState.enemies && !scene.isHost) {
    scene.enemies.forEach((enemy, i) => {
      if (scene.lobbyState.enemies[i]) {
        const pos = scene.lobbyState.enemies[i];
        const { x, y } = scene.hexToPixel(pos.q, pos.r, scene.hexSize);
        enemy.setPosition(x, y);
        enemy.q = pos.q;
        enemy.r = pos.r;
        scene.tweens.add({ targets: enemy, alpha: 0.5, duration: 100, yoyo: true, repeat: 1 });
      }
    });
  }
}

/**
 * Sets up global pointer logic and cursor style
 */
export function setupPointerActions(scene) {
  scene.input.on('pointerdown', pointer => {
    handleHexClick(scene, pointer);
  });
  scene.input.setDefaultCursor('crosshair');
}
