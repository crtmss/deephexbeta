// src/scenes/WorldSceneUnits.js
//
// Spawning players & enemies + orientation helpers.
// This file is the main bridge between "abstract game state"
// (lobby players / seed) and concrete Phaser units on the map.

import { getLobbyState } from '../net/LobbyManager.js';

// Basic visual / model constants
const UNIT_Z = {
  player: 2000,
  enemy:  2000,
};

const PLAYER_COLORS = [
  0xff4b4b, // P1 – red
  0x4bc0ff, // P2 – blue
  0x54ff9b, // P3 – green
  0xffe14b, // P4 – yellow
];

const ENEMY_COLOR = 0xaa66ff;

// Small axial helpers (odd-r)
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}

function keyOf(q, r) {
  return `${q},${r}`;
}

/**
 * Pick up to N reasonably spaced spawn tiles on land.
 * Deterministic (only depends on the map), so all clients
 * with the same seed and map will pick the same positions.
 */
function pickSpawnTiles(scene, count) {
  const map = scene.mapData || [];
  if (!map.length) return [];

  const land = map.filter(t => t.type !== 'water' && t.type !== 'mountain');
  if (!land.length) return [];

  const w = scene.mapWidth || 25;
  const h = scene.mapHeight || 25;

  const cx = w / 2;
  const cy = h / 2;

  // score tiles by angle sector + distance
  const tilesWithMeta = land.map(t => {
    const dx = t.q - cx;
    const dy = t.r - cy;
    const angle = Math.atan2(dy, dx); // -PI..PI
    const dist2 = dx * dx + dy * dy;
    return { tile: t, angle, dist2 };
  });

  // Split map into angular sectors and pick best from each
  const sectors = count;
  const buckets = Array.from({ length: sectors }, () => []);

  tilesWithMeta.forEach(entry => {
    let a = entry.angle;
    if (a < 0) a += Math.PI * 2;
    const idx = Math.floor((a / (Math.PI * 2)) * sectors) % sectors;
    buckets[idx].push(entry);
  });

  const result = [];
  for (let i = 0; i < sectors; i++) {
    const bucket = buckets[i];
    if (!bucket.length) continue;
    // prefer tiles a bit away from center (larger dist2)
    bucket.sort((a, b) => b.dist2 - a.dist2);
    result.push(bucket[0].tile);
    if (result.length >= count) break;
  }

  // Fallback if not enough unique buckets
  while (result.length < count && result.length < land.length) {
    const candidate = land[result.length];
    if (!result.includes(candidate)) result.push(candidate);
  }

  return result.slice(0, count);
}

/**
 * Creates a mobile base unit (player "king" piece).
 */
function createMobileBase(scene, spawnTile, playerName, color, playerIndex) {
  const { x, y } = scene.axialToWorld(spawnTile.q, spawnTile.r);

  // Use a simple circle for now – can be swapped to sprite later
  const unit = scene.add.circle(x, y, 16, color)
    .setDepth(UNIT_Z.player);

  unit.q = spawnTile.q;
  unit.r = spawnTile.r;

  unit.type = 'mobile_base';
  unit.isPlayer = true;
  unit.isEnemy = false;

  unit.playerName = playerName;
  unit.name = playerName || 'Player';

  // index in lobby state (0..3), useful for deterministic ordering
  unit.playerIndex = playerIndex;

  unit.movementPoints = 4;
  unit.maxMovementPoints = 4;

  unit.hp = 10;
  unit.maxHp = 10;

  // Used by orientation helper
  unit.facingAngle = 0;
  unit.setStrokeStyle?.(2, 0x000000, 0.7);

  return unit;
}

/**
 * Creates a simple enemy unit.
 */
function createEnemyUnit(scene, spawnTile) {
  const { x, y } = scene.axialToWorld(spawnTile.q, spawnTile.r);

  const enemy = scene.add.triangle(
    x, y,
    0,  18,
    -16, -14,
    16, -14,
    ENEMY_COLOR
  ).setDepth(UNIT_Z.enemy);

  enemy.q = spawnTile.q;
  enemy.r = spawnTile.r;

  enemy.type = 'enemy_raider';
  enemy.isEnemy = true;
  enemy.isPlayer = false;

  enemy.movementPoints = 2;
  enemy.maxMovementPoints = 2;

  enemy.hp = 5;
  enemy.maxHp = 5;

  // Face "down" by default
  enemy.rotation = Math.PI;

  return enemy;
}

/**
 * Main entry: called from WorldScene.create().
 *
 * Responsibility in the multiplayer model:
 * - Read the lobby state (if any) from Supabase via LobbyManager.
 * - Infer the list of players (up to 4).
 * - Map that to concrete Phaser units on the map.
 * - Spawn a few neutral enemies (host only).
 */
export async function spawnUnitsAndEnemies() {
  const scene = /** @type {any} */ (this);

  scene.units   = scene.units   || [];
  scene.players = scene.players || [];
  scene.enemies = scene.enemies || [];

  let lobbyPlayers = null;

  if (scene.roomCode) {
    try {
      const { data, error } = await getLobbyState(scene.roomCode);
      if (!error && data && data.state && Array.isArray(data.state.players)) {
        lobbyPlayers = data.state.players;
      }
    } catch (err) {
      console.error('[Units] Failed to fetch lobby state for spawns:', err);
    }
  }

  const localName = scene.playerName || (scene.isHost ? 'Host' : 'Player');

  // If we don't have remote lobby data, treat this as local / singleplayer.
  if (!lobbyPlayers || lobbyPlayers.length === 0) {
    lobbyPlayers = [localName];
  }

  // Ensure local player is included (if lobby has room for them).
  if (!lobbyPlayers.includes(localName) && lobbyPlayers.length < 4) {
    lobbyPlayers = [...lobbyPlayers, localName];
  }

  // Limit to 4 players, keep order from lobby state
  const maxPlayers = 4;
  const uniquePlayers = Array.from(new Set(lobbyPlayers)).slice(0, maxPlayers);

  const spawnTiles = pickSpawnTiles(scene, uniquePlayers.length);
  if (spawnTiles.length === 0) {
    console.warn('[Units] No valid spawn tiles found – map may be all water.');
    return;
  }

  // --- Spawn players ---
  scene.players.length = 0;

  uniquePlayers.forEach((name, idx) => {
    const tile = spawnTiles[idx] || spawnTiles[spawnTiles.length - 1];
    const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];

    const unit = createMobileBase(scene, tile, name, color, idx);

    // Mark which unit belongs to the local player
    unit.isLocalPlayer = (name === localName);

    scene.units.push(unit);
    scene.players.push(unit);
  });

  // --- Spawn enemies (host only, so they don't multiply) ---
  if (scene.isHost) {
    const map = scene.mapData || [];
    const byKey = new Map(map.map(t => [keyOf(t.q, t.r), t]));
    const centerQ = Math.floor(scene.mapWidth / 2);
    const centerR = Math.floor(scene.mapHeight / 2);

    const originTile = byKey.get(keyOf(centerQ, centerR)) || map[0];
    if (originTile) {
      const enemySpawnCandidates = [];

      // simple BFS from center, looking for non-water/non-mountain
      const seen = new Set();
      const qd = [originTile];
      seen.add(keyOf(originTile.q, originTile.r));

      while (qd.length && enemySpawnCandidates.length < 6) {
        const cur = qd.shift();
        if (cur.type !== 'water' && cur.type !== 'mountain') {
          enemySpawnCandidates.push(cur);
        }
        for (const [dq, dr] of neighborsOddR(cur.q, cur.r)) {
          const nq = cur.q + dq;
          const nr = cur.r + dr;
          const k = keyOf(nq, nr);
          if (seen.has(k)) continue;
          const nt = byKey.get(k);
          if (!nt) continue;
          seen.add(k);
          qd.push(nt);
        }
      }

      scene.enemies.length = 0;
      enemySpawnCandidates.slice(0, 3).forEach(tile => {
        const enemy = createEnemyUnit(scene, tile);
        scene.units.push(enemy);
        scene.enemies.push(enemy);
      });
    }
  }

  console.log(
    `[Units] Spawn complete: ${scene.players.length} players, ${scene.enemies.length} enemies.`
  );
}

/**
 * Update unit orientation based on movement direction.
 * Called from WorldScene.startStepMovement().
 *
 * Keeps the rule you wanted:
 * - "Facing along the path" and flipping / rotating accordingly.
 */
export function updateUnitOrientation(scene, unit, fromQ, fromR, toQ, toR) {
  if (!unit) return;

  const dq = toQ - fromQ;
  const dr = toR - fromR;

  if (dq === 0 && dr === 0) return;

  // Convert axial step to an angle in screen space.
  // For pointy-top odd-r, we can use a small lookup.
  const key = `${dq},${dr}`;
  const ANGLES = {
    '1,0':   0,                  // east
    '1,-1':  -Math.PI / 3,       // NE
    '0,-1':  -2 * Math.PI / 3,   // NW
    '-1,0':  Math.PI,            // W
    '-1,1':  2 * Math.PI / 3,    // SW
    '0,1':   Math.PI / 3,        // SE
  };

  const angle = ANGLES[key] ?? 0;

  // If the unit is a triangle / image, set rotation.
  if (typeof unit.rotation === 'number') {
    unit.rotation = angle;
  }

  // If it's a sprite with flipX, approximate left/right
  if (typeof unit.setFlipX === 'function') {
    const goingLeft = (dq < 0);
    unit.setFlipX(goingLeft);
  }

  unit.facingAngle = angle;
}

/**
 * Placeholder for future real-time sync subscription (step 4).
 * For now this is a no-op so imports are safe.
 */
export async function subscribeToGameUpdates(_scene, _roomCode) {
  return {
    unsubscribe() { /* no-op for now */ }
  };
}
