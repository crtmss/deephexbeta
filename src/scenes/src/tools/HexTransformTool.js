// src/tools/HexTransformTool.js
//
// Simple dev/editor tool to change a hex tile's type + level at runtime.
//
// Features:
// - startHexTransformTool(scene):
//     * shows a transparent overlay
//     * waits for a single left-click on the map
//     * prompts for new type + level
//     * applies changes to the clicked tile
// - applyHexTransform(scene, q, r, newType, newLevel):
//     * programmatic helper to change a tile without UI
//
// Notes:
// - Expects scene.mapData to be an array of tiles with { q, r, type, level, ... }.
// - Visual refresh is done via optional hooks if present:
//     scene.updateTileSprite?.(tile);
//     scene.refreshBiomeLabels?.();
//     scene.refreshFogOfWar?.();

const HEX_TOOL_Z = {
  overlay: 3900, // below HUD/logistics (which you’re running at ~4000–8000)
};

/**
 * One-shot interactive transform:
 *  1) Draws a faint overlay.
 *  2) Next left-click selects a hex.
 *  3) Prompts for type + level, then applies.
 */
export function startHexTransformTool(scene) {
  if (!scene || !scene.mapData) {
    console.warn('[HEX-TOOL] Scene or mapData missing.');
    return;
  }

  // Prevent overlapping modes
  if (scene.isHexTransformMode) {
    console.warn('[HEX-TOOL] Already in hex transform mode.');
    return;
  }
  scene.isHexTransformMode = true;

  const cam = scene.cameras.main;
  const overlay = scene.add.rectangle(
    cam.worldView.x + cam.worldView.width / 2,
    cam.worldView.y + cam.worldView.height / 2,
    cam.worldView.width,
    cam.worldView.height,
    0x000000,
    0.001
  )
    .setScrollFactor(0)
    .setDepth(HEX_TOOL_Z.overlay)
    .setInteractive({ useHandCursor: true });

  console.log('[HEX-TOOL] Click a hex to transform it…');

  const finish = () => {
    overlay.destroy();
    scene.isHexTransformMode = false;
  };

  overlay.once('pointerdown', (pointer, _lx, _ly, event) => {
    event?.stopPropagation?.();

    const wp = pointer.positionToCamera(scene.cameras.main);
    const { q, r } = scene.worldToAxial(wp.x, wp.y);

    const tile = (scene.mapData || []).find(t => t.q === q && t.r === r);
    if (!tile) {
      console.warn('[HEX-TOOL] No tile at clicked hex', { q, r });
      finish();
      return;
    }

    // Prompt for new type / level (dev tool, so prompt() is fine)
    const currentType = tile.type ?? 'unknown';
    const currentLevel = tile.level ?? 1;

    const newType = window.prompt(
      `HEX-TOOL: New type for hex (${q},${r})?` +
      `\nCurrent: "${currentType}"` +
      `\nExamples: grass, water, sand, ice, snow, desert, tundra`,
      String(currentType)
    );

    if (newType == null || newType.trim() === '') {
      console.log('[HEX-TOOL] Transform cancelled (no type).');
      finish();
      return;
    }

    const levelStr = window.prompt(
      `HEX-TOOL: New level for hex (${q},${r})?` +
      `\nCurrent: ${currentLevel}` +
      `\nEnter integer like 1, 2, 3…`,
      String(currentLevel)
    );

    let newLevel = currentLevel;
    if (levelStr != null && levelStr.trim() !== '') {
      const parsed = parseInt(levelStr, 10);
      if (!Number.isNaN(parsed)) newLevel = parsed;
    }

    applyHexTransform(scene, q, r, newType.trim(), newLevel);
    finish();
  });
}

/**
 * Programmatic helper: change the tile at (q,r) to newType/newLevel.
 * Returns the mutated tile, or null if not found.
 */
export function applyHexTransform(scene, q, r, newType, newLevel) {
  if (!scene || !scene.mapData) return null;

  const tile = scene.mapData.find(t => t.q === q && t.r === r);
  if (!tile) {
    console.warn('[HEX-TOOL] applyHexTransform: no tile at', { q, r });
    return null;
  }

  const oldType = tile.type;
  const oldLevel = tile.level;

  tile.type = newType;
  tile.level = newLevel;

  console.log(
    `[HEX-TOOL] Hex (${q},${r}) transformed:`,
    `type "${oldType}"→"${newType}",`,
    `level ${oldLevel}→${newLevel}`
  );

  // Optional: let the scene refresh visuals if it has helpers for that.
  try {
    scene.updateTileSprite?.(tile);
    scene.refreshBiomeLabels?.();
    scene.refreshFogOfWar?.();
  } catch (err) {
    console.warn('[HEX-TOOL] Visual refresh threw:', err);
  }

  return tile;
}

export default {
  startHexTransformTool,
  applyHexTransform,
};
