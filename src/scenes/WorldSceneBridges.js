// src/scenes/WorldSceneBridges.js

// For now "ashland" is represented by the existing terrain type "volcano_ash".
const BRIDGE_TERRAIN = 'volcano_ash';
const BRIDGE_MOVEMENT_COST = 2;

/** Get a tile from scene.mapData by axial coords (odd-r offset). */
function getTile(scene, q, r) {
  return (scene.mapData || []).find(t => t.q === q && t.r === r);
}

/**
 * Parity-aware neighbor step in a given direction.
 * Direction indices are aligned with AStar.js:
 * 0: E, 1: NE, 2: NW, 3: W, 4: SW, 5: SE
 */
function neighborInDirection(q, r, dir) {
  const even = (r % 2) === 0;

  const evenDirs = [
    { dq: +1, dr: 0 },  // 0 E
    { dq: 0,  dr: -1 }, // 1 NE
    { dq: -1, dr: -1 }, // 2 NW
    { dq: -1, dr: 0 },  // 3 W
    { dq: -1, dr: +1 }, // 4 SW
    { dq: 0,  dr: +1 }, // 5 SE
  ];

  const oddDirs = [
    { dq: +1, dr: 0 },  // 0 E
    { dq: +1, dr: -1 }, // 1 NE
    { dq: 0,  dr: -1 }, // 2 NW
    { dq: -1, dr: 0 },  // 3 W
    { dq: 0,  dr: +1 }, // 4 SW
    { dq: +1, dr: +1 }, // 5 SE
  ];

  const d = even ? evenDirs[dir] : oddDirs[dir];
  return { q: q + d.dq, r: r + d.dr };
}

/** Find the current player's mobile base unit. */
function findMobileBase(scene) {
  const players = scene.players || scene.units || [];
  return players.find(u => u.type === 'mobile_base' && u.playerName === scene.playerName)
      || players.find(u => u.type === 'mobile_base');
}

/**
 * Collect a straight line of `length` tiles starting at (q0,r0)
 * in a given direction. Returns `null` if any step is off-map.
 */
function collectLine(scene, q0, r0, dir, length) {
  const tiles = [];
  let q = q0, r = r0;

  const startTile = getTile(scene, q, r);
  if (!startTile) return null;
  tiles.push(startTile);

  for (let i = 1; i < length; i++) {
    const n = neighborInDirection(q, r, dir);
    q = n.q; r = n.r;
    const t = getTile(scene, q, r);
    if (!t) return null;
    tiles.push(t);
  }

  return tiles;
}

/**
 * Bridge validity:
 * - length is 3 or 4
 * - start and end tiles are NOT water
 * - middle tiles (1 or 2) ARE water
 */
function isValidBridgeLine(tiles) {
  if (!tiles) return false;
  if (tiles.length !== 3 && tiles.length !== 4) return false;

  const start = tiles[0];
  const end   = tiles[tiles.length - 1];
  if (!start || !end) return false;

  if (start.type === 'water' || end.type === 'water') return false;

  for (let i = 1; i < tiles.length - 1; i++) {
    const t = tiles[i];
    if (!t || t.type !== 'water') return false;
  }

  return true;
}

/**
 * Scans around the mobile base and returns the first valid bridge line:
 * either:
 *   [land, water, land]      (3 hexes)
 * or [land, water, water, land] (4 hexes)
 */
function findBridgeLineFromMobileBase(scene) {
  const base = findMobileBase(scene);
  if (!base) {
    console.warn('[BRIDGE] No mobile base found for player.');
    return null;
  }

  const startTile = getTile(scene, base.q, base.r);
  if (!startTile) {
    console.warn('[BRIDGE] Mobile base tile not found in mapData.');
    return null;
  }

  if (startTile.type === 'water') {
    console.warn('[BRIDGE] Mobile base is on water; cannot start bridge here.');
    return null;
  }

  // Try each of the 6 hex directions.
  for (let dir = 0; dir < 6; dir++) {
    // First try length-3 bridge: land - water - land
    const line3 = collectLine(scene, startTile.q, startTile.r, dir, 3);
    if (isValidBridgeLine(line3)) {
      return line3;
    }

    // Then try length-4 bridge: land - water - water - land
    const line4 = collectLine(scene, startTile.q, startTile.r, dir, 4);
    if (isValidBridgeLine(line4)) {
      return line4;
    }
  }

  console.log('[BRIDGE] No valid 3–4 hex bridge configuration around mobile base.');
  return null;
}

/**
 * Public API: try to construct a bridge starting at the mobile base.
 * If a valid line is found, all tiles in that line are converted to "ashland"
 * (represented by terrain type "volcano_ash") and the world is redrawn.
 */
export function tryBuildBridgeFromMobileBase(scene) {
  const line = findBridgeLineFromMobileBase(scene);
  if (!line) return;

  line.forEach(tile => {
    tile.type = BRIDGE_TERRAIN;
    tile.movementCost = BRIDGE_MOVEMENT_COST;
    tile.impassable = false;
    // Optional: tag for future logic
    tile.isBridge = true;
  });

  if (typeof scene.redrawWorld === 'function') {
    scene.redrawWorld();
  }

  console.log('[BRIDGE] Built bridge of length', line.length, 'from mobile base.');
}
