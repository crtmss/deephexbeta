// src/scenes/LoreGeneration.js
//
// Deterministic lore generation helpers for the world.
// - Ruin / city lore
// - Road lore connecting POIs
//
// Public API:
//   generateRuinLoreForTile(scene, tile)
//   generateRoadLoreForExistingConnections(scene)

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
    x ^= x << 5; x >>>= 0;
    return (x >>> 0) / 4294967296;
  };
}

// Shared vocab so factions line up between ruins and roads
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

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function deterministicFactionForCoord(seedStr, q, r) {
  const h = hashStr32(`${seedStr}|faction|${q},${r}`);
  const rng = xorshift32(h);
  return pick(rng, FACTIONS);
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

  const owningFaction = pick(rng, FACTIONS);
  const enemyFaction  = pick(rng, ENEMIES);
  const disaster      = pick(rng, DISASTER_TYPES);
  const cityName      = `${pick(rng, CITY_PREFIX)} ${pick(rng, CITY_ROOT)}`;

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

  // Persist basic metadata on the tile so road lore can re-use it
  tile.owningFaction = owningFaction;
  tile.cityName = cityName;
  tile.ruinDisaster = disaster;

  tile.__loreGenerated = true;
  tile.__historyLogged = true;
}

/**
 * Generate lore entries for all road connections stored on the scene.
 *
 * Expects:
 *   scene.roadConnections = [
 *     { from: {q,r,type}, to: {q,r,type}, path: [{q,r}, ...] },
 *     ...
 *   ]
 *
 * Roads are attributed to:
 *   - owningFaction of the 'from' tile if present
 *   - else owningFaction of 'to' tile
 *   - else deterministicFactionForCoord(seed, from.q, from.r)
 *
 * @param {Phaser.Scene & any} scene
 */
export function generateRoadLoreForExistingConnections(scene) {
  if (!scene) return;
  if (scene.__roadLoreGenerated) return;

  const conns = Array.isArray(scene.roadConnections)
    ? scene.roadConnections
    : [];
  if (!conns.length) {
    scene.__roadLoreGenerated = true;
    return;
  }

  const seedStr = String(scene.seed || '000000');

  const getTile = (q, r) =>
    (scene.mapData || []).find(t => t.q === q && t.r === r);

  const addEntry = scene.addHistoryEntry
    ? (entry) => scene.addHistoryEntry(entry)
    : null;

  if (!addEntry) {
    scene.__roadLoreGenerated = true;
    return;
  }

  for (const conn of conns) {
    const fq = conn.from?.q;
    const fr = conn.from?.r;
    const tq = conn.to?.q;
    const tr = conn.to?.r;

    const fromTile = getTile(fq, fr);
    const toTile   = getTile(tq, tr);

    const faction =
      (fromTile && fromTile.owningFaction) ||
      (toTile && toTile.owningFaction) ||
      deterministicFactionForCoord(seedStr, fq, fr);

    const fromLabel = buildLocationLabel(conn.from, fromTile, true);
    const toLabel   = buildLocationLabel(conn.to, toTile, false);

    const year = scene.getNextHistoryYear
      ? scene.getNextHistoryYear()
      : 5000;

    addEntry({
      year,
      text: `${faction} build a road from ${fromLabel} to ${toLabel}.`,
      type: 'road_built',
      from: { q: fq, r: fr },
      to: { q: tq, r: tr },
      faction,
    });
  }

  scene.__roadLoreGenerated = true;
}

function buildLocationLabel(endpoint, tile, isFrom) {
  if (!endpoint) return 'an unknown place';
  const q = endpoint.q;
  const r = endpoint.r;
  const type = String(endpoint.type || '').toLowerCase();

  if (tile && tile.cityName) {
    // if we know the city name, use it
    if (isFrom) {
      return `the city of ${tile.cityName} (${q},${r})`;
    }
    return `the ruins of ${tile.cityName} (${q},${r})`;
  }

  if (type === 'crash_site' || type === 'wreck') {
    return `a crash site near (${q},${r})`;
  }

  if (type === 'vehicle') {
    return `a stranded vehicle at (${q},${r})`;
  }

  if (type === 'ruin') {
    return `ruins at (${q},${r})`;
  }

  return `(${q},${r})`;
}
