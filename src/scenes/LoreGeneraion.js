// src/scenes/LoreGeneration.js
//
// Deterministic lore generation helpers for the world.
// For now: generates a mini-timeline for ruined cities/buildings.
//
// Public API:
//   generateRuinLoreForTile(scene, tile)

function hashStr32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function xorshift32(seed) {
  let x = (seed || 1) >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17; x >>>= 0;
    x ^= x << 5;  x >>>= 0;
    return (x >>> 0) / 4294967296;
  };
}

/**
 * Generate a deterministic lore timeline for a ruin tile and push it
 * into scene.historyEntries via scene.addHistoryEntry().
 *
 * - Does nothing if tile.__loreGenerated is already true.
 * - Uses scene.seed + (q,r) to make the story deterministic per map.
 *
 * @param {Phaser.Scene & any} scene
 * @param {object} tile  expects {q, r, ...}
 */
export function generateRuinLoreForTile(scene, tile) {
  if (!scene || !tile) return;
  if (tile.__loreGenerated) return;

  const seedStr = String(scene.seed || '000000');
  const hashInput = `${seedStr}|ruin|${tile.q},${tile.r}`;

  const h = hashStr32(hashInput);
  const rng = xorshift32(h);

  const FACTIONS = [
    'Azure Concord',
    'Dust Mariners',
    'Iron Compact',
    'Verdant Covenant',
    'Sable Court',
    'Old Reef League',
  ];

  const ENEMIES = [
    'Red Tide Raiders',
    'Saltborn Nomads',
    'Pale Plague',
    'Seismic Choir',
    'Falling Sky Cult',
  ];

  const CITY_PREFIX = [
    'Harbor of',
    'Citadel of',
    'Port of',
    'Watch of',
    'Spire of',
    'Haven of',
  ];

  const CITY_ROOT = [
    'Nareth',
    'Korvan',
    'Brinefall',
    'Greywatch',
    'Solmere',
    'Lowmar',
    'Tiderest',
  ];

  const DISASTER_TYPES = [
    'war',
    'abandonment',
    'flooding',
    'earthquake',
    'meteor shower',
    'plague',
  ];

  const pick = arr => arr[Math.floor(rng() * arr.length)];

  const owningFaction = pick(FACTIONS);
  const enemyFaction  = pick(ENEMIES);
  const disaster      = pick(DISASTER_TYPES);
  const cityName      = `${pick(CITY_PREFIX)} ${pick(CITY_ROOT)}`;

  const baseYear = scene.getNextHistoryYear
    ? scene.getNextHistoryYear()
    : 5000;

  const q = tile.q;
  const r = tile.r;

  const events = [
    {
      year: baseYear,
      text: `City ${cityName} is founded by the ${owningFaction} on hex (${q},${r}).`,
      type: 'city_foundation',
    },
    {
      year: baseYear + 6,
      text: `${cityName} grows into a key outpost of the ${owningFaction}, with workshops and docks.`,
      type: 'city_growth',
    },
    {
      year: baseYear + 18,
      text: `Tensions rise as the ${enemyFaction} contest control of ${cityName} and its trade routes.`,
      type: 'faction_tension',
    },
    {
      year: baseYear + 21,
      text: `${cityName} is devastated by ${disaster}; its districts are shattered and left in ruins.`,
      type: 'city_ruined',
    },
  ];

  const addEntry = scene.addHistoryEntry
    ? (entry) => scene.addHistoryEntry(entry)
    : null;

  if (!addEntry) {
    // Fail-safe: mark lore as generated so we don't spam next time,
    // even if we can't actually store entries yet.
    tile.__loreGenerated = true;
    tile.__historyLogged = true;
    return;
  }

  for (const ev of events) {
    addEntry({
      year: ev.year,
      text: ev.text,
      type: ev.type,
      q,
      r,
      faction: owningFaction,
      cityName,
      disaster,
      enemyFaction,
    });
  }

  tile.__loreGenerated = true;
  tile.__historyLogged = true;
}
