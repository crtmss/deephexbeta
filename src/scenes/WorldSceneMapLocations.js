// deephexbeta/src/scenes/WorldSceneMapLocations.js
/**
 * Populate per-tile location flags (forests, ruins, crash sites, vehicles, mountain icons).
 * This was moved out of WorldSceneMap.js to keep it lean.
 *
 * Returns the same array (mutated for convenience).
 */
export function populateLocationFlags(mapData, seed) {
  const rng = new Phaser.Math.RandomDataGenerator([seed ?? Date.now()]);
  const chance = (p) => rng.frac() < p;

  mapData.forEach(tile => {
    // Reset to avoid stale flags if re-used
    tile.hasForest = false;
    tile.hasRuin = false;
    tile.hasCrashSite = false;
    tile.hasVehicle = false;
    tile.hasMountainIcon = false;

    if (tile.type === 'water') return;

    switch (tile.type) {
      case 'grassland':
        if (chance(0.06))  tile.hasForest = true;
        if (chance(0.012)) tile.hasRuin = true;
        if (chance(0.007)) tile.hasVehicle = true;
        break;
      case 'sand':
        if (chance(0.008)) tile.hasRuin = true;
        if (chance(0.010)) tile.hasCrashSite = true;
        break;
      case 'mud':
        if (chance(0.04))  tile.hasForest = true;
        if (chance(0.012)) tile.hasVehicle = true;
        break;
      case 'swamp':
        if (chance(0.05))  tile.hasForest = true;
        if (chance(0.008)) tile.hasRuin = true;
        break;
      case 'mountain':
        if (chance(0.10))  tile.hasMountainIcon = true;
        if (chance(0.004)) tile.hasRuin = true;
        break;
      default:
        if (chance(0.03))  tile.hasForest = true;
        if (chance(0.006)) tile.hasRuin = true;
        if (chance(0.006)) tile.hasVehicle = true;
        break;
    }
  });

  return mapData;
}
