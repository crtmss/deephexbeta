// File: game/terrain.js

// Movement cost per terrain type
const terrainMovementCosts = {
  grassland: 1,
  forest: 2,
  mountain: Infinity,
  swamp: 3,
  water: Infinity
};

// Returns the movement cost of a tile, or of a terrain type
function getMovementCost(terrainOrTile) {
  const type = typeof terrainOrTile === 'string' ? terrainOrTile : terrainOrTile?.terrain || terrainOrTile?.type;
  return terrainMovementCosts[type] ?? 1;
}

// Returns true if the tile or terrain type is passable
function isPassable(terrainOrTile) {
  return getMovementCost(terrainOrTile) !== Infinity;
}

// Returns true if the tile is not passable or is missing
function isTileBlocked(x, y, map) {
  const tile = map?.[y]?.[x];
  if (!tile) return true;
  return !isPassable(tile);
}

// Returns true if the tile is dangerous (e.g. fire, landmine)
function isDangerousTile(tile) {
  return tile?.effect === 'fire' || tile?.effect === 'mine';
}

window.isDangerousTile = isDangerousTile;
window.terrainMovementCosts = terrainMovementCosts;
window.getMovementCost = getMovementCost;
window.tile = tile;
window.type = type;
window.isPassable = isPassable;
window.isTileBlocked = isTileBlocked;