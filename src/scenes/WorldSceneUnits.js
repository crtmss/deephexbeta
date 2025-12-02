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
    ? [[+1,0],[0,-1],[-1,-1],[−1,0],[−1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[−1,0],[0,+1],[+1,+1]];
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

  const tilesWithMeta = land.map(t => {
    const dx = t.q - cx;
    const dy = t.r - cy;
    const angle = Math.atan2(dy, dx);
    const dist2 = dx * dx + dy * dy;
    return { tile: t, angle, dist2 };
  });

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
    bucket.sort((a, b) => b.dist2 - a.dist2);
    result.push(bucket[0].tile);
    if (result.length >= count) break;
  }

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

  const unit = scene.add.circle(x, y, 16, color)
    .setDepth(UNIT_Z.player);

  unit.q = spawnTile.q;
  unit.r = spawnTile.r;

  unit.type = 'mobile_base';
  unit.isPlayer = true;
  unit.isEnemy = false;

  unit.playerName = playerName;
  unit.name = playerName || 'Player';
  unit.playerIndex = playerIndex; // deterministic ordering

  unit.movementPoints = 4;
  unit.maxMovementPoints = 4;

  unit.hp = 10;
  unit.maxHp = 10;

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
    0, 18,
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

  enemy.rotation = Math.PI;
  return enemy;
}

/**
 * Main entry: called from WorldScene.create().
 *
 * Multiplayer rules:
 * - Spawn EXACTLY lobbyState.maxPlayers bases.
 * - Base i belongs to player i.
 * - If a client connects but lobby has no slot for them, they DO NOT spawn.
 */
export async function spawnUnitsAndEnemies() {
  const scene = /** @type {any} */ (this);

  scene.units   = [];
  scene.players = [];
  scene.enemies = [];

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

  // Local fallback
  const localName = scene.playerName || (scene.isHost ? 'Host' : 'Player');
  if (!lobbyPlayers) lobbyPlayers = [{ name: localName }];

  // Determine required number of units
  const lobbyMaxPlayers = (() => {
    const raw = scene.lobbyState?.maxPlayers;
    if (typeof raw === 'number') return Math.max(1, Math.min(4, raw));
    return 1;
  })();

  // Sort lobby players by slot (0..3)
  const sortedLobby = lobbyPlayers
    .slice()
    .sort((a, b) => (a.slot ?? 999) - (b.slot ?? 999))
    .slice(0, lobbyMaxPlayers);

  const spawnTiles = pickSpawnTiles(scene, sortedLobby.length);
  if (!spawnTiles.length) {
    console.warn('[Units] No valid spawn tiles.');
    return;
  }

  // Spawn bases in deterministic slot order
  sortedLobby.forEach((player, index) => {
    const tile = spawnTiles[index];
    const color = PLAYER_COLORS[index % PLAYER_COLORS.length];

    const unit = createMobileBase(scene, tile, player.name, color, index);
    unit.isLocalPlayer = (player.name === localName);

    scene.units.push(unit);
    scene.players.push(unit);
  });

  // Host spawns enemies
  if (scene.isHost) {
    const map = scene.mapData || [];
    const byKey = new Map(map.map(t => [keyOf(t.q, t.r), t]));
    const centerQ = Math.floor(scene.mapWidth / 2);
    const centerR = Math.floor(scene.mapHeight / 2);

    const originTile = byKey.get(keyOf(centerQ, centerR)) || map[0];
    if (originTile) {
      const candidate = [];

      const seen = new Set();
      const qd = [originTile];
      seen.add(keyOf(originTile.q, originTile.r));

      while (qd.length && candidate.length < 6) {
        const cur = qd.shift();
        if (cur.type !== 'water' && cur.type !== 'mountain') {
          candidate.push(cur);
        }
        for (const [dq, dr] of neighborsOddR(cur.q, cur.r)) {
          const nq = cur.q + dq, nr = cur.r + dr, k = keyOf(nq, nr);
          if (seen.has(k)) continue;
          const nt = byKey.get(k);
          if (!nt) continue;
          seen.add(k);
          qd.push(nt);
        }
      }

      candidate.slice(0, 3).forEach(tile => {
        const enemy = createEnemyUnit(scene, tile);
        scene.units.push(enemy);
        scene.enemies.push(enemy);
      });
    }
  }

  console.log(
    `[Units] Spawn complete: ${scene.players.length} players, ` +
    `${scene.enemies.length} enemies.`
  );
}

/**
 * Update unit orientation based on movement direction.
 */
export function updateUnitOrientation(scene, unit, fromQ, fromR, toQ, toR) {
  if (!unit) return;

  const dq = toQ - fromQ;
  const dr = toR - fromR;
  if (dq === 0 && dr === 0) return;

  const ANGLES = {
    '1,0':   0,
    '1,-1': -Math.PI / 3,
    '0,-1': -2 * Math.PI / 3,
    '-1,0': Math.PI,
    '-1,1':  2 * Math.PI / 3,
    '0,1':   Math.PI / 3,
  };

  const key = `${dq},${dr}`;
  const angle = ANGLES[key] ?? 0;

  if (typeof unit.rotation === 'number') {
    unit.rotation = angle;
  }
  if (typeof unit.setFlipX === 'function') {
    unit.setFlipX(dq < 0);
  }

  unit.facingAngle = angle;
}

/**
 * Placeholder for future real-time sync subscription.
 */
export async function subscribeToGameUpdates(_scene, _roomCode) {
  return {
    unsubscribe() {}
  };
}
