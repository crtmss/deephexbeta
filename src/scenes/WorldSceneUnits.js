// deephexbeta/src/scenes/WorldSceneUnits.js

import { supabase } from '../net/SupabaseClient.js';
import { subscribeToGame } from './WorldScene.js';  // adjust based on your architecture

/**
 * Spawns player unit and enemy units (if host) and synchronizes positions in lobby state.
 */
export async function spawnUnitsAndEnemies() {
    const safeTiles = this.mapData.filter(h => !['water', 'mountain'].includes(h.type));
    Phaser.Utils.Array.Shuffle(safeTiles);

    this.players = [];
    this.enemies = [];

    // Spawn player for this client if not yet in state
    if (!this.lobbyState.units?.[this.playerName]) {
        const tile = safeTiles.pop();
        const { x, y } = this.hexToPixel(tile.q, tile.r, this.hexSize);
        const unit = this.add.circle(x, y, 10, 0xff0000).setDepth(10);
        unit.q = tile.q;
        unit.r = tile.r;
        unit.playerName = this.playerName;
        unit.setInteractive();
        unit.on('pointerdown', (pointer) => {
            if (pointer.rightButtonDown()) return;
            pointer.event.stopPropagation();
            this.selectedUnit = this.selectedUnit === unit ? null : unit;
        });
        this.players.push(unit);

        this.lobbyState.units = {
            ...(this.lobbyState.units || {}),
            [this.playerName]: { q: tile.q, r: tile.r }
        };
        await supabase
            .from('lobbies')
            .update({ state: this.lobbyState })
            .eq('room_code', this.roomCode);
    }

    // Spawn enemies only for host
    if (this.isHost && !this.lobbyState.enemies) {
        const enemyTiles = safeTiles.slice(0, 10);
        for (let tile of enemyTiles) {
            const { x, y } = this.hexToPixel(tile.q, tile.r, this.hexSize);
            const enemy = this.add.circle(x, y, 8, 0x0000ff).setDepth(10);
            enemy.q = tile.q;
            enemy.r = tile.r;
            this.enemies.push(enemy);
        }
        this.lobbyState.enemies = this.enemies.map(e => ({ q: e.q, r: e.r }));
        await supabase
            .from('lobbies')
            .update({ state: this.lobbyState })
            .eq('room_code', this.roomCode);
    } else if (!this.isHost && this.lobbyState.enemies) {
        // create enemy objects placeholders
        for (const pos of this.lobbyState.enemies) {
            const { x, y } = this.hexToPixel(pos.q, pos.r, this.hexSize);
            const enemy = this.add.circle(x, y, 8, 0x0000ff).setDepth(10);
            enemy.q = pos.q;
            enemy.r = pos.r;
            this.enemies.push(enemy);
        }
    }
}

/**
 * Subscribe to real-time updates for units & enemies.
 */
export function subscribeToGameUpdates() {
    subscribeToGame(this.roomCode, (newState) => {
        this.lobbyState = newState;

        // Update or spawn player units
        if (newState.units) {
            for (const [name, pos] of Object.entries(newState.units)) {
                let unit = this.players.find(p => p.playerName === name);
                const { x, y } = this.hexToPixel(pos.q, pos.r, this.hexSize);
                if (unit) {
                    unit.setPosition(x, y);
                } else {
                    const color = name === this.playerName ? 0xff0000 : 0x0000ff;
                    unit = this.add.circle(x, y, 10, color).setDepth(10);
                    unit.q = pos.q;
                    unit.r = pos.r;
                    unit.playerName = name;
                    if (name === this.playerName) {
                        unit.setInteractive();
                        unit.on('pointerdown', (pointer) => {
                            if (pointer.rightButtonDown()) return;
                            pointer.event.stopPropagation();
                            this.selectedUnit = this.selectedUnit === unit ? null : unit;
                        });
                    }
                    this.players.push(unit);
                }
            }
        }

        // Update enemy positions for non-hosts
        if (newState.enemies && !this.isHost) {
            newState.enemies.forEach((pos, i) => {
                const enemy = this.enemies[i];
                if (enemy) {
                    const { x, y } = this.hexToPixel(pos.q, pos.r, this.hexSize);
                    enemy.setPosition(x, y);
                    enemy.q = pos.q;
                    enemy.r = pos.r;
                }
            });
        }

        // Reset selection if turn changed
        if (newState.currentTurn !== this.playerName) {
            this.selectedUnit = null;
        }
    });
}

// Export both functions for use in WorldScene.js
export {
    spawnUnitsAndEnemies,
    subscribeToGameUpdates
};
