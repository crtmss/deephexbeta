// deephexbeta/src/scenes/WorldSceneUnits.js
import { supabase } from '../net/SupabaseClient.js';

export async function spawnUnitsAndEnemies() {
  // Safe land tiles
  const safeTiles = this.mapData.filter(h => !['water', 'mountain'].includes(h.type));
  Phaser.Utils.Array.Shuffle(safeTiles);

  this.players = this.players || [];
  this.enemies = this.enemies || [];

  // --- Spawn (or restore) my mobile base (red) ---
  if (!this.lobbyState.units?.[this.playerName]) {
    const tile = safeTiles.pop();
    const { x, y } = this.axialToWorld(tile.q, tile.r);
    const unit = this.add.circle(x, y, 10, 0xff0000).setDepth(10); // mobile base
    unit.q = tile.q;
    unit.r = tile.r;
    unit.playerName = this.playerName;
    unit.type = 'mobile_base';
    this.players.push(unit);

    // persist my spawn
    this.lobbyState.units = this.lobbyState.units || {};
    this.lobbyState.units[this.playerName] = { q: unit.q, r: unit.r };
    await supabase
      .from('lobbies')
      .update({ state: this.lobbyState })
      .eq('room_code', this.roomCode);
  } else {
    const pos = this.lobbyState.units[this.playerName];
    const { x, y } = this.axialToWorld(pos.q, pos.r);
    const unit = this.add.circle(x, y, 10, 0xff0000).setDepth(10); // mobile base
    unit.q = pos.q;
    unit.r = pos.r;
    unit.playerName = this.playerName;
    unit.type = 'mobile_base';
    this.players.push(unit);
  }

  // --- Spawn enemies (blue) — host is authoritative ---
  // Always enforce exactly 2 enemies in state.
  if (this.isHost) {
    // choose two distinct safe tiles, not on player
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

    this.enemies.length = 0;
    for (const tile of enemyTiles) {
      const { x, y } = this.axialToWorld(tile.q, tile.r);
      const enemy = this.add.circle(x, y, 8, 0x0000ff).setDepth(10);
      enemy.q = tile.q;
      enemy.r = tile.r;
      this.enemies.push(enemy);
    }

    // overwrite lobby with exactly two enemies
    this.lobbyState.enemies = this.enemies.map(e => ({ q: e.q, r: e.r }));
    await supabase
      .from('lobbies')
      .update({ state: this.lobbyState })
      .eq('room_code', this.roomCode);
  } else {
    // client: render from server; clamp to two in case server had leftovers
    const list = (this.lobbyState.enemies || []).slice(0, 2);
    this.enemies.length = 0;
    for (const pos of list) {
      const { x, y } = this.axialToWorld(pos.q, pos.r);
      const enemy = this.add.circle(x, y, 8, 0x0000ff).setDepth(10);
      enemy.q = pos.q;
      enemy.r = pos.r;
      this.enemies.push(enemy);
    }
  }
}

export async function subscribeToGameUpdates() {
  const { subscribeToGame } = await import('../net/SyncManager.js');

  subscribeToGame(this.roomCode, (newState) => {
    this.lobbyState = newState;

    // Units (players)
    if (newState.units) {
      for (const [name, pos] of Object.entries(newState.units)) {
        let unit = this.players.find(p => p.playerName === name);
        const { x, y } = this.axialToWorld(pos.q, pos.r);
        if (unit) {
          unit.setPosition(x, y);
          unit.q = pos.q;
          unit.r = pos.r;
        } else {
          const color = name === this.playerName ? 0xff0000 : 0x0000ff;
          unit = this.add.circle(x, y, 10, color).setDepth(10);
          unit.q = pos.q;
          unit.r = pos.r;
          unit.playerName = name;
          unit.type = name === this.playerName ? 'mobile_base' : 'player';

          if (name === this.playerName) {
            unit.setInteractive();
          }
          this.players.push(unit);
        }
      }
    }

    // Enemies (authoritative state)
    if (Array.isArray(newState.enemies)) {
      const list = newState.enemies.slice(0, 2); // enforce client-side clamp too
      // grow/shrink pool
      while (this.enemies.length < list.length) {
        const enemy = this.add.circle(0, 0, 8, 0x0000ff).setDepth(10);
        enemy.q = 0; enemy.r = 0;
        this.enemies.push(enemy);
      }
      while (this.enemies.length > list.length) {
        const e = this.enemies.pop();
        e.destroy();
      }
      // position enemies
      list.forEach((pos, i) => {
        const enemy = this.enemies[i];
        const { x, y } = this.axialToWorld(pos.q, pos.r);
        enemy.setPosition(x, y);
        enemy.q = pos.q;
        enemy.r = pos.r;
      });
    }

    // Deselect if it's not my turn
    if (newState.currentTurn !== this.playerName) {
      this.selectedUnit = null;
    }
  });
}
