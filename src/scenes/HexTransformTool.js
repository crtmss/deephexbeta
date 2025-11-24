// src/scenes/HexTransformTool.js
//
// Small dev tool for transforming individual hex tiles at runtime
// and for stamping small patterns (like a central lake).
//
// Exports:
//   - startHexTransformTool(scene, options?)
//   - stopHexTransformTool(scene)
//   - applyHexTransform(scene, q, r, newType, level?, extra?)
//   - makeCentralLake(scene, level?)
//
// Usage example in WorldScene.create():
//   import { startHexTransformTool } from './HexTransformTool.js';
//   startHexTransformTool(this, { defaultType: 'water', defaultLevel: 1 });
//
// While the tool is active:
//   - Left-click on a hex: it will be converted to the configured type/level.
//   - Press "X": 8 adjacent hexes in the center of the map become water.
//
// This is intended as a debugging / world-editing helper.

import { drawHex } from './WorldSceneMap.js';

// -----------------
// Internal helpers
// -----------------

// Simple default movement cost per terrain type (tweak as needed)
function movementCostForType(terrainType) {
  switch (terrainType) {
    case 'water':
    case 'ocean':
    case 'sea':
    case 'mountain':
      return 99; // effectively impassable
    case 'forest':
      return 2;
    case 'hill':
      return 2;
    case 'sand':
    case 'snow':
    case 'ice':
      return 2;
    default:
      return 1;
  }
}

function findTile(scene, q, r) {
  return (scene.mapData || []).find(t => t.q === q && t.r === r);
}

// -----------------
// Core transform
// -----------------

/**
 * Mutate a single hex at (q,r) to a new type / level and redraw that hex.
 *
 * @param {Phaser.Scene} scene
 * @param {number} q axial q
 * @param {number} r axial r
 * @param {string} newType e.g. 'water', 'sand', 'snow', 'forest', etc.
 * @param {number} [level=1] arbitrary elevation / level value to store
 * @param {object} [extra] optional extra props (e.g. { feature: 'none' })
 */
export function applyHexTransform(scene, q, r, newType, level = 1, extra = {}) {
  if (!scene || !scene.mapData) {
    console.warn('[HEX-TOOL] applyHexTransform: scene/mapData missing.');
    return;
  }

  const tile = findTile(scene, q, r);
  if (!tile) {
    console.warn('[HEX-TOOL] applyHexTransform: no tile at', { q, r });
    return;
  }

  tile.type = newType;
  tile.level = level;
  tile.elevation = level; // keep in sync with your elevation usage
  tile.movementCost = movementCostForType(newType);

  // Apply any extra overrides (feature, biome, etc.)
  Object.assign(tile, extra);

  // Redraw just this hex using your existing renderer
  try {
    drawHex.call(scene, tile);
  } catch (err) {
    console.warn('[HEX-TOOL] drawHex failed, map may not update visually until redraw.', err);
  }

  console.log('[HEX-TOOL] Transformed hex', { q, r, type: newType, level });
}

/**
 * Stamp a small 8-hex "lake" near the geometric center of the map.
 * Center + its neighbours (and one extra neighbour) become water.
 *
 * @param {Phaser.Scene} scene
 * @param {number} [level=1]
 */
export function makeCentralLake(scene, level = 1) {
  if (!scene || !scene.mapData || !scene.mapWidth || !scene.mapHeight) {
    console.warn('[HEX-TOOL] makeCentralLake: scene/map data missing.');
    return;
  }

  const cx = Math.floor(scene.mapWidth / 2);
  const cy = Math.floor(scene.mapHeight / 2);

  // Find tile closest to center in axial coords
  let centerTile = null;
  let bestDist = Infinity;
  for (const t of scene.mapData) {
    const d = Math.abs(t.q - cx) + Math.abs(t.r - cy);
    if (d < bestDist) {
      bestDist = d;
      centerTile = t;
    }
  }

  if (!centerTile) {
    console.warn('[HEX-TOOL] makeCentralLake: could not find center tile.');
    return;
  }

  const { q: cq, r: cr } = centerTile;

  // Neighbour offsets for odd-r horizontal layout
  const isOdd = (cr & 1) === 1;
  const neighEven = [
    [0, -1], [+1, 0], [0, +1],
    [-1, +1], [-1, 0], [-1, -1],
  ];
  const neighOdd = [
    [+1, -1], [+1, 0], [+1, +1],
    [0, +1], [-1, 0], [0, -1],
  ];
  const neigh = isOdd ? neighOdd : neighEven;

  // Center + its 6 immediate neighbours + one “extra” further away = 8 tiles total
  const targets = [{ q: cq, r: cr }];

  neigh.forEach(([dq, dr]) => {
    targets.push({ q: cq + dq, r: cr + dr });
  });

  const [dqExtra, drExtra] = neigh[0];
  targets.push({ q: cq + dqExtra * 2, r: cr + drExtra * 2 });

  targets.forEach(({ q, r }) => {
    if (q < 0 || r < 0 || q >= scene.mapWidth || r >= scene.mapHeight) return;
    applyHexTransform(scene, q, r, 'water', level);
  });

  console.log('[HEX-TOOL] Central lake created around', { q: cq, r: cr });
}

// -----------------
// Interactive tool
// -----------------

/**
 * Enable interactive hex-editing mode on the given scene.
 *
 * Left-click: change clicked hex to `options.defaultType` / `options.defaultLevel`.
 * Key "X": call makeCentralLake(scene, defaultLevel).
 *
 * @param {Phaser.Scene & any} scene
 * @param {object} [options]
 * @param {string} [options.defaultType='water']
 * @param {number} [options.defaultLevel=1]
 */
export function startHexTransformTool(scene, options = {}) {
  if (!scene || !scene.input) {
    console.warn('[HEX-TOOL] startHexTransformTool: scene/input missing.');
    return;
  }

  const defaultType = options.defaultType ?? 'water';
  const defaultLevel = options.defaultLevel ?? 1;

  // Prevent double-activation
  if (scene._hexTransformTool && scene._hexTransformTool.active) {
    console.warn('[HEX-TOOL] Tool already active on this scene.');
    return;
  }

  // Pointer handler – convert clicked hex
  const onPointerDown = (pointer) => {
    // Only left button
    if (pointer.rightButtonDown && pointer.rightButtonDown()) return;

    const cam = scene.cameras.main;
    const worldPoint = pointer.positionToCamera(cam);

    if (!scene.worldToAxial) {
      console.warn('[HEX-TOOL] worldToAxial not available on scene.');
      return;
    }

    const { q, r } = scene.worldToAxial(worldPoint.x, worldPoint.y);

    if (
      q < 0 || r < 0 ||
      q >= scene.mapWidth || r >= scene.mapHeight
    ) {
      return;
    }

    applyHexTransform(scene, q, r, defaultType, defaultLevel);
  };

  scene.input.on('pointerdown', onPointerDown);

  // Keyboard: press "X" to create the central lake
  let keyX = null;
  if (scene.input.keyboard) {
    keyX = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);
    keyX.on('down', () => {
      makeCentralLake(scene, defaultLevel);
    });
  }

  scene._hexTransformTool = {
    active: true,
    onPointerDown,
    keyX,
  };

  console.log('[HEX-TOOL] Hex transform tool started. Left-click to paint, press X for central lake.');
}

/**
 * Disable the interactive hex-editing tool previously enabled with startHexTransformTool().
 */
export function stopHexTransformTool(scene) {
  if (!scene || !scene._hexTransformTool) return;
  const tool = scene._hexTransformTool;

  if (tool.onPointerDown) {
    scene.input?.off('pointerdown', tool.onPointerDown);
  }
  if (tool.keyX) {
    tool.keyX.off('down');
    // optionally: scene.input.keyboard.removeKey(tool.keyX);
  }

  scene._hexTransformTool = { active: false };
  console.log('[HEX-TOOL] Hex transform tool stopped.');
}

export default {
  startHexTransformTool,
  stopHexTransformTool,
  applyHexTransform,
  makeCentralLake,
};
