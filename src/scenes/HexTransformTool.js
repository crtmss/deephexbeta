// src/scenes/HexTransformTool.js
//
// Simple developer tool for transforming hexes.
// Current behavior:
// - Press "X" to turn the center hex and its neighbors into water (a small lake).
// - No more click-to-change-hex behavior.

function getOddROffsetNeighbors(q, r) {
  const isOdd = (r & 1) === 1;
  // same layout style as used elsewhere (odd-r horizontal)
  const even = [
    [0, -1],  [+1, 0],  [0, +1],
    [-1, +1], [-1, 0],  [-1, -1],
  ];
  const odd = [
    [+1, -1], [+1, 0],  [+1, +1],
    [0, +1],  [-1, 0],  [0, -1],
  ];
  const d = isOdd ? odd : even;
  return d.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

function changeTileType(scene, q, r, type, level = 1) {
  if (!scene || !scene.mapData) return;
  const tile = scene.mapData.find(t => t.q === q && t.r === r);
  if (!tile) return;

  tile.type = type;
  tile.level = level;
  // You can tweak elevation / movementCost if your map generator uses them.
  if (typeof tile.elevation === 'number') {
    tile.elevation = level;
  }
}

/**
 * Optional helper if you ever want to call it directly from dev console.
 */
export function transformHexAt(scene, q, r, type = 'water', level = 1) {
  changeTileType(scene, q, r, type, level);
  scene.redrawWorld?.();
}

/**
 * Attach dev keybindings (currently only "X" for central lake).
 */
export function startHexTransformTool(scene, opts = {}) {
  const cfg = {
    defaultType: 'water',
    defaultLevel: 1,
    ...opts,
  };

  // Press "X" => create a small lake in the center of the map
  scene.input.keyboard.on('keydown-X', () => {
    if (!scene.mapWidth || !scene.mapHeight) return;

    const centerQ = Math.floor(scene.mapWidth / 2);
    const centerR = Math.floor(scene.mapHeight / 2);

    const center = { q: centerQ, r: centerR };
    const neighbors = getOddROffsetNeighbors(centerQ, centerR);

    // Take center + its six neighbors (7 tiles) as the "lake core"
    const targets = [center, ...neighbors];

    targets.forEach(({ q, r }) => {
      if (q < 0 || r < 0 || q >= scene.mapWidth || r >= scene.mapHeight) return;
      changeTileType(scene, q, r, cfg.defaultType, cfg.defaultLevel);
    });

    // Redraw the world to apply new terrain visually
    scene.redrawWorld?.();
    console.log('[HEX-TOOL] Created central lake at', center);
  });
}

export default {
  startHexTransformTool,
  transformHexAt,
};
