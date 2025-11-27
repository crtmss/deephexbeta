// src/scenes/WorldSceneUnits.js
import { supabase } from '../net/SupabaseClient.js';

// 0 = east, then clockwise, but now parity-aware (odd-r offset)
function getDirectionDeltasForRow(r) {
  const even = r % 2 === 0;

  // Order here must match your facing index:
  // 0: E, 1: NE, 2: NW, 3: W, 4: SW, 5: SE
  if (even) {
    // Even rows – match AStar.js
    return [
      { dq: +1, dr: 0 },  // 0 east
      { dq: 0,  dr: -1 }, // 1 NE
      { dq: -1, dr: -1 }, // 2 NW
      { dq: -1, dr: 0 },  // 3 west
      { dq: -1, dr: +1 }, // 4 SW
      { dq: 0,  dr: +1 }, // 5 SE
    ];
  } else {
    // Odd rows – match AStar.js
    return [
      { dq: +1, dr: 0 },  // 0 east
      { dq: +1, dr: -1 }, // 1 NE
      { dq: 0,  dr: -1 }, // 2 NW
      { dq: -1, dr: 0 },  // 3 west
      { dq: 0,  dr: +1 }, // 4 SW
      { dq: +1, dr: +1 }, // 5 SE
    ];
  }
}

/** Computes hex facing direction index 0–5 */
function computeFacingDirection(oldQ, oldR, newQ, newR) {
  const dq = newQ - oldQ;
  const dr = newR - oldR;

  const dirs = getDirectionDeltasForRow(oldR);

  for (let i = 0; i < 6; i++) {
    if (dirs[i].dq === dq && dirs[i].dr === dr) {
      return i;
    }
  }

  // Fallback: if move is > 1 hex (teleport / path jump), keep current or default
  return 0;
}

/** Draw/update the triangle that shows the facing direction */
function updateTriangleFacing(scene, unit) {
  if (!unit) return;

  // Remove old triangle if exists
  if (unit.orientationObj) {
    unit.orientationObj.destroy();
    unit.orientationObj = null;
  }

  const facing = unit.orientation ?? 0;
  const angleRad = (Math.PI * 2 / 6) * facing; // 60° per face

  const { x, y } = scene.axialToWorld(unit.q, unit.r);

  const size = 8; // triangle size
  const tipX = x + Math.cos(angleRad) * size;
  const tipY = y + Math.sin(angleRad) * size;

  // Base corners (back side)
  const baseAngle1 = angleRad + Math.PI * 0.75;
  const baseAngle2 = angleRad - Math.PI * 0.75;

  const b1x = x + Math.cos(baseAngle1) * (size * 0.6);
  const b1y = y + Math.sin(baseAngle1) * (size * 0.6);

  const b2x = x + Math.cos(baseAngle2) * (size * 0.6);
  const b2y = y + Math.sin(baseAngle2) * (size * 0.6);

  const triangle = scene.add.polygon(
    0,
    0,
    [tipX, tipY, b1x, b1y, b2x, b2y],
    0xffdd55,
    1.0
  );
  triangle.setDepth(12);
  triangle.setOrigin(0);

  unit.orientationObj = triangle;
}

/** Update orientation when the unit moves */
export function updateUnitOrientation(scene, unit, oldQ, oldR, newQ, newR) {
  if (!unit) return;

  const facing = computeFacingDirection(oldQ, oldR, newQ, newR);
  unit.orientation = facing;

  updateTriangleFacing(scene, unit);

  // Write into lobbyState for multiplayer sync
  scene.lobbyState = scene.lobbyState || {};
  scene.lobbyState.units = scene.lobbyState.units || {};
  scene.lobbyState.units[unit.playerName] =
    scene.lobbyState.units[unit.playerName] || {};
  scene.lobbyState.units[unit.playerName].q = newQ;
  scene.lobbyState.units[unit.playerName].r = newR;
  scene.lobbyState.units[unit.playerName].orientation = facing;

  // Sync to Supabase (fire-and-forget)
  if (scene.supabase || supabase) {
    (scene.supabase || supabase)
      .from('lobbies')
      .update({ state: scene.lobbyState })
      .eq('room_code', scene.roomCode);
  }
}

// ------------------------- MAIN EXPORT ------------------------------

export async function spawnUnitsAndEnemies() {
  // Safe land tiles for spawning
  const safeTiles = this.mapData.filter(h => !['water', 'mountain'].includes(h.type));
  Phaser.Utils.Array.Shuffle(safeTiles);

  this.players = this.players || [];
  this.enemies = this.enemies || [];

  // --- Spawn or restore mobile base ---
  if (!this.lobbyState.units?.[this.playerName]) {
    const tile = safeTiles.pop();
    const { x, y } = this.axialToWorld(tile.q, tile.r);

    const unit = this.add.circle(x, y, 10, 0xff0000).setDepth(10);
    unit.q = tile.q;
    unit.r = tile.r;
    unit.playerName = this.playerName;
    unit.type = 'mobile_base';
    unit.orientation = 0; // facing east initially

    this.players.push(unit);

    this.lobbyState.units = this.lobbyState.units || {};
    this.lobbyState.units[this.playerName] = {
      q: unit.q,
      r: unit.r,
      orientation: 0,
    };

    await supabase
      .from('lobbies')
      .update({ state: this.lobbyState })
      .eq('room_code', this.roomCode);

    updateTriangleFacing(this, unit);

  } else {
    const pos = this.lobbyState.units[this.playerName];
    const { x, y } = this.axialToWorld(pos.q, pos.r);

    const unit = this.add.circle(x, y, 10, 0xff0000).setDepth(10);
    unit.q = pos.q;
    unit.r = pos.r;
    unit.playerName = this.playerName;
    unit.type = 'mobile_base';
    unit.orientation = pos.orientation ?? 0;

    this.players.push(unit);
    updateTriangleFacing(this, unit);
  }

  // --- ENEMIES SPAWN ---
  if (this.isHost) {
    this.enemies.length = 0;

    const taken = new Set([`${this.players[0].q},${this.players[0].r}`]);
    const enemyTiles = [];

    for (let i = 0; i < safeTiles.length && enemyTiles.length < 2; i++) {
      const t = safeTiles[i];
      const key = `${t.q},${t.r}`;
      if (!taken.has(key)) {
        enemyTiles.push(t);
        taken.add(key);
      }
    }

    for (const tile of enemyTiles) {
      const { x, y } = this.axialToWorld(tile.q, tile.r);
      const enemy = this.add.circle(x, y, 8, 0x0000ff).setDepth(10);
      enemy.q = tile.q;
      enemy.r = tile.r;
      enemy.type = 'enemy';
      enemy.orientation = 0;

      this.enemies.push(enemy);
      updateTriangleFacing(this, enemy);
    }

    this.lobbyState.enemies = this.enemies.map(e => ({
      q: e.q,
      r: e.r,
      orientation: e.orientation,
    }));

    await supabase
      .from('lobbies')
      .update({ state: this.lobbyState })
      .eq('room_code', this.roomCode);

  } else {
    const list = (this.lobbyState.enemies || []).slice(0, 2);

    this.enemies.length = 0;
    for (const pos of list) {
      const { x, y } = this.axialToWorld(pos.q, pos.r);

      const enemy = this.add.circle(x, y, 8, 0x0000ff).setDepth(10);
      enemy.q = pos.q;
      enemy.r = pos.r;
      enemy.type = 'enemy';
      enemy.orientation = pos.orientation ?? 0;

      this.enemies.push(enemy);
      updateTriangleFacing(this, enemy);
    }
  }
}

// ------------------------- MULTIPLAYER SYNC -------------------------

export async function subscribeToGameUpdates() {
  const { subscribeToGame } = await import('../net/SyncManager.js');

  subscribeToGame(this.roomCode, (newState) => {
    this.lobbyState = newState;

    // ---- PLAYERS ----
    if (newState.units) {
      for (const [name, pos] of Object.entries(newState.units)) {
        let unit = this.players.find(p => p.playerName === name);
        const { x, y } = this.axialToWorld(pos.q, pos.r);

        if (unit) {
          const oldQ = unit.q;
          const oldR = unit.r;

          unit.setPosition(x, y);
          unit.q = pos.q;
          unit.r = pos.r;

          // Update orientation if changed remotely
          if (typeof pos.orientation === 'number') {
            unit.orientation = pos.orientation;
            updateTriangleFacing(this, unit);
          } else {
            updateUnitOrientation(this, unit, oldQ, oldR, unit.q, unit.r);
          }

        } else {
          // New player unit
          const color = name === this.playerName ? 0xff0000 : 0x0000ff;
          unit = this.add.circle(x, y, 10, color).setDepth(10);
          unit.q = pos.q;
          unit.r = pos.r;
          unit.playerName = name;
          unit.type = name === this.playerName ? 'mobile_base' : 'player';
          unit.orientation = pos.orientation ?? 0;

          if (name === this.playerName) unit.setInteractive();

          this.players.push(unit);
          updateTriangleFacing(this, unit);
        }
      }
    }

    // ---- ENEMIES ----
    if (Array.isArray(newState.enemies)) {
      const list = newState.enemies.slice(0, 2);

      while (this.enemies.length < list.length) {
        const enemy = this.add.circle(0, 0, 8, 0x0000ff).setDepth(10);
        this.enemies.push(enemy);
      }
      while (this.enemies.length > list.length) {
        const e = this.enemies.pop();
        e.destroy();
      }

      list.forEach((pos, i) => {
        const enemy = this.enemies[i];
        const { x, y } = this.axialToWorld(pos.q, pos.r);

        const oldQ = enemy.q;
        const oldR = enemy.r;

        enemy.setPosition(x, y);
        enemy.q = pos.q;
        enemy.r = pos.r;

        if (typeof pos.orientation === 'number') {
          enemy.orientation = pos.orientation;
          updateTriangleFacing(this, enemy);
        } else {
          updateUnitOrientation(this, enemy, oldQ, oldR, enemy.q, enemy.r);
        }
      });
    }

    // Deselect if turn changed
    if (newState.currentTurn !== this.playerName) {
      this.selectedUnit = null;
    }
  });
}
