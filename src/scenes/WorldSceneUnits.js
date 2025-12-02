// src/scenes/WorldSceneUnits.js
//
// Spawning players & enemies + orientation helpers.
// Bridge between "abstract game state" (lobby / seed)
// and concrete Phaser units on the map.

import { getLobbyState } from '../net/LobbyManager.js';

// Basic visual / model constants
const UNIT_Z = {
  player: 2000,
  enemy:  2000,
};

const PLAYER_COLORS = [
  0xff4b4b, // P1 - red
  0x4bc0ff, // P2 - blue
  0x54ff9b, // P3 - green
  0xffe14b, // P4 - yellow
];

const ENEMY_COLOR = 0xaa66ff;

// Small axial helpers (odd-r)
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]]
    : [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]];
}

function keyOf(q, r) {
  return q + ',' + r;
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
  const sectors = Math.max(1, count);
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
  let idx = 0;
  while (result.length < count && idx < land.length) {
    const candidate = land[idx++];
    if (result.indexOf(candidate) === -1) result.push(candidate);
  }

  return result.slice(0, count);
}

/**
 * Creates a mobile base unit (player "king" piece).
 */
function createMobileBase(scene, spawnTile, player, color, playerIndex) {
  const pos = scene.axialToWorld(spawnTile.q, spawnTile.r);
  const unit = scene.add.circle(pos.x, pos.y, 16, color).setDepth(UNIT_Z.player);

  unit.q = spawnTile.q;
  unit.r = spawnTile.r;

  unit.type = 'mobile_base';
  unit.isPlayer = true;
  unit.isEnemy = false;

  unit.playerId = player.id || null;
  unit.playerName = player.name || 'Player';
  unit.name = unit.playerName;
  unit.playerIndex = playerIndex; // slot index 0..3

  unit.movementPoints = 4;
  unit.maxMovementPoints = 4;

  unit.hp = 10;
  unit.maxHp = 10;

  unit.facingAngle = 0;
  if (typeof unit.setStrokeStyle === 'function') {
    unit.setStrokeStyle(2, 0x000000, 0.7);
  }

  return unit;
}

/**
 * Creates a simple enemy unit.
 */
function createEnemyUnit(scene, spawnTile) {
  const pos = scene.axialToWorld(spawnTile.q, spawnTile.r);

  const enemy = scene.add.triangle(
    pos.x, pos.y,
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
 * - Read the lobby state (if any) from Supabase via LobbyManager
 *   or from scene.lobbyState (passed by LobbyScene).
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

  // 1) Prefer already-fetched lobby state from scene data
  if (scene.lobbyState && Array.isArray(scene.lobbyState.players)) {
    lobbyPlayers = scene.lobbyState.players;
  } else if (scene.roomCode) {
    // 2) Fallback: fetch from Supabase
    try {
      const { data, error } = await getLobbyState(scene.roomCode);
      if (!error && data && data.state && Array.isArray(data.state.players)) {
        lobbyPlayers = data.state.players;
      }
    } catch (err) {
      console.error('[Units] Failed to fetch lobby state for spawns:', err);
    }
  }

  const localPlayerId = scene.playerId || null;
  const localName = scene.playerName || (scene.isHost ? 'Host' : 'Player');

  // 3) Singleplayer fallback: no lobby or empty players array
  if (!Array.isArray(lobbyPlayers) || lobbyPlayers.length === 0) {
    lobbyPlayers = [{
      id: 'p1',
      name: localName,
      slot: 0,
      isHost: !!scene.isHost,
      isConnected: true,
    }];
  }

  // 4) Sort players by slot for deterministic colors / spawn order
  const lobbyMaxPlayers = 4;
  const sortedPlayers = lobbyPlayers
    .slice()
    .sort((a, b) => {
      const sa = (typeof a.slot === 'number') ? a.slot : 999;
      const sb = (typeof b.slot === 'number') ? b.slot : 999;
      return sa - sb;
    })
    .slice(0, lobbyMaxPlayers);

  if (sortedPlayers.length === 0) {
    console.warn('[Units] No players found after sorting.');
    return;
  }

  const spawnTiles = pickSpawnTiles(scene, sortedPlayers.length);
  if (spawnTiles.length === 0) {
    console.warn('[Units] No valid spawn tiles found – map may be all water.');
    return;
  }

  // --- Spawn players ---
  scene.players.length = 0;

  sortedPlayers.forEach((player, idx) => {
    const tile = spawnTiles[idx] || spawnTiles[spawnTiles.length - 1];
    const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];

    const unit = createMobileBase(scene, tile, player, color, idx);

    // Mark which unit belongs to the local player
    unit.isLocalPlayer =
      (localPlayerId && player.id === localPlayerId) ||
      (!localPlayerId && player.name === localName);

    scene.units.push(unit);
    scene.players.push(unit);
  });

  // --- Spawn enemies (host only, so they don't multiply across clients) ---
  if (scene.isHost) {
    const map = scene.mapData || [];
    if (map.length > 0) {
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
  }

  console.log(
    '[Units] Spawn complete: ' +
    scene.players.length + ' players, ' +
    scene.enemies.length + ' enemies.'
  );
}

/**
 * Update unit orientation based on movement direction.
 * Called from WorldScene.startStepMovement().
 *
 * Keeps the rule:
 * - "Facing along the path" and flipping / rotating accordingly.
 */
export function updateUnitOrientation(scene, unit, fromQ, fromR, toQ, toR) {
  if (!unit) return;

  const dq = toQ - fromQ;
  const dr = toR - fromR;

  if (dq === 0 && dr === 0) return;

  const key = dq + ',' + dr;
  const ANGLES = {
    '1,0':   0,
    '1,-1':  -Math.PI / 3,
    '0,-1':  -2 * Math.PI / 3,
    '-1,0':  Math.PI,
    '-1,1':  2 * Math.PI / 3,
    '0,1':   Math.PI / 3,
  };

  const angle = ANGLES[key] !== undefined ? ANGLES[key] : 0;

  if (typeof unit.rotation === 'number') {
    unit.rotation = angle;
  }

  if (typeof unit.setFlipX === 'function') {
    const goingLeft = (dq < 0);
    unit.setFlipX(goingLeft);
  }

  unit.facingAngle = angle;
}

/**
 * Placeholder for future real-time sync subscription.
 * For now this is a no-op so imports are safe.
 */
export async function subscribeToGameUpdates(_scene, _roomCode) {
  return {
    unsubscribe() { /* no-op for now */ }
  };
}
