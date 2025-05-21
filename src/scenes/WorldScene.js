import HexMap from '../engine/HexMap.js';
import { findPath } from '../engine/AStar.js';

export default class WorldScene extends Phaser.Scene {
    constructor() {
        super('WorldScene');
    }

    async create() {
        this.hexSize = 32;
        this.mapWidth = 25;
        this.mapHeight = 25;

        const { roomCode, playerName, isHost } = this.scene.settings.data;
        console.log('[Multiplayer] Joined Room:', roomCode, '| Player:', playerName, '| Host:', isHost);

        const { getLobbyState } = await import('../net/LobbyManager.js');
        const { data: lobbyData, error } = await getLobbyState(roomCode);
        if (error || !lobbyData?.state?.seed) {
            console.error('Failed to fetch lobby seed:', error);
            return;
        }
        this.seed = lobbyData.state.seed;

        const { subscribeToGame } = await import('../net/SyncManager.js');
        const { supabase } = await import('../net/SupabaseClient.js');

        this.playerName = playerName;
        this.roomCode = roomCode;

        this.syncPlayerMove = async (unit) => {
            const { data: lobbyData, error: fetchError } = await supabase
                .from('lobbies')
                .select('state')
                .eq('room_code', roomCode)
                .single();

            if (fetchError) return;

            const updatedState = {
                ...lobbyData.state,
                units: {
                    ...lobbyData.state.units,
                    [playerName]: { q: unit.q, r: unit.r }
                },
                currentTurn: this.getNextPlayer(lobbyData.state.players, playerName)
            };

            await supabase
                .from('lobbies')
                .update({ state: updatedState })
                .eq('room_code', roomCode);
        };

        this.getNextPlayer = (list, current) => {
            const idx = list.indexOf(current);
            return list[(idx + 1) % list.length];
        };

        subscribeToGame(roomCode, (newState) => {
            if (!newState.units) return;

            for (const name in newState.units) {
                if (name === playerName) continue;
                const other = newState.units[name];
                const existing = this.players.find(p => p.playerName === name);
                if (existing) {
                    const { x, y } = this.hexToPixel(other.q, other.r, this.hexSize);
                    existing.setPosition(x, y);
                    existing.q = other.q;
                    existing.r = other.r;
                }
            }

            if (newState.currentTurn !== playerName) {
                this.selectedUnit = null;
            }

            if (this.turnText) {
                this.turnText.setText('Player Turn: ' + newState.currentTurn);
            }
        });

        this.hexMap = new HexMap(this.mapWidth, this.mapHeight, this.seed);
        this.mapData = this.hexMap.getMap();

        this.selectedUnit = null;
        this.movingPath = [];
        this.currentTurnIndex = 0;

        this.tileMap = {};
        this.mapData.forEach(hex => {
            const { q, r, terrain } = hex;
            const { x, y } = this.hexToPixel(q, r, this.hexSize);
            const color = this.getColorForTerrain(terrain);
            this.drawHex(q, r, x, y, this.hexSize, color);
        });

        this.players = [];
        const safeTiles = this.mapData.filter(hex => !['water', 'mountain'].includes(hex.terrain));
        Phaser.Utils.Array.Shuffle(safeTiles);

        for (let i = 0; i < 4 && i < safeTiles.length; i++) {
            const tile = safeTiles[i];
            const { x, y } = this.hexToPixel(tile.q, tile.r, this.hexSize);
            const unit = this.add.circle(x, y, 12, 0xff0000).setDepth(10);
            unit.q = tile.q;
            unit.r = tile.r;
            unit.playerName = i === 0 ? playerName : `P${i+1}`;
            unit.fillColor = unit.playerName === playerName ? 0xff0000 : 0x0000ff;
            unit.setInteractive();
            unit.on('pointerdown', () => {
                if (this.players[this.currentTurnIndex] === unit) {
                    this.selectedUnit = unit;
                }
            });
            this.players.push(unit);
        }

        this.enemies = [];
        const enemyTiles = safeTiles.slice(4, 14);
        for (let tile of enemyTiles) {
            const { x, y } = this.hexToPixel(tile.q, tile.r, this.hexSize);
            const enemy = this.add.circle(x, y, 10, 0x0000ff).setDepth(10);
            enemy.q = tile.q;
            enemy.r = tile.r;
            this.enemies.push(enemy);
        }

        this.input.on('pointerdown', pointer => {
            if (!this.selectedUnit || this.players[this.currentTurnIndex] !== this.selectedUnit) return;
            const { worldX, worldY } = pointer;
            const clickedHex = this.pixelToHex(worldX - 400, worldY - 100);
            const target = this.mapData.find(h => h.q === clickedHex.q && h.r === clickedHex.r);
            if (!target || ['water', 'mountain'].includes(target.terrain)) return;

            const path = findPath(
                { q: this.selectedUnit.q, r: this.selectedUnit.r },
                { q: clickedHex.q, r: clickedHex.r },
                this.mapData,
                tile => ['water', 'mountain'].includes(tile.terrain)
            );

            this.movingPath = path.slice(1);
        });

        this.displayTurnText();

        this.endTurnButton = this.add.text(1050, 20, 'End Turn', {
            fontSize: '22px',
            backgroundColor: '#222',
            color: '#fff',
            padding: { x: 12, y: 6 }
        }).setInteractive().setDepth(100);

        this.endTurnButton.on('pointerdown', () => {
            this.endTurn();
        });
    }

    update() {
        if (Array.isArray(this.movingPath) && this.movingPath.length > 0 && this.selectedUnit) {
            const next = this.movingPath.shift();
            const { x, y } = this.hexToPixel(next.q, next.r, this.hexSize);
            this.selectedUnit.setPosition(x, y);
            this.selectedUnit.q = next.q;
            this.selectedUnit.r = next.r;
            if (this.movingPath.length === 0) {
                this.syncPlayerMove(this.selectedUnit);
                this.endTurn();
                this.checkCombat();
            }
        }
    }

    moveEnemies() {
        const directions = [
            { dq: +1, dr: 0 }, { dq: -1, dr: 0 }, { dq: 0, dr: +1 },
            { dq: 0, dr: -1 }, { dq: +1, dr: -1 }, { dq: -1, dr: +1 }
        ];

        this.enemies.forEach(enemy => {
            Phaser.Utils.Array.Shuffle(directions);
            for (const dir of directions) {
                const newQ = enemy.q + dir.dq;
                const newR = enemy.r + dir.dr;
                const tile = this.mapData.find(t => t.q === newQ && t.r === newR);
                if (tile && !['water', 'mountain'].includes(tile.terrain)) {
                    const { x, y } = this.hexToPixel(newQ, newR, this.hexSize);
                    enemy.setPosition(x, y);
                    enemy.q = newQ;
                    enemy.r = newR;
                    break;
                }
            }
        });
    }

    checkCombat() {
        for (const player of this.players) {
            for (const enemy of this.enemies) {
                if (player.q === enemy.q && player.r === enemy.r) {
                    console.log('Combat triggered at', player.q, player.r);
                    this.scene.start('CombatScene');
                    return;
                }
            }
        }
    }

    displayTurnText() {
        const playerText = this.add.text(10, 10, 'Player Turn: 1', {
            fontSize: '20px',
            fill: '#ffffff'
        }).setDepth(100);
        this.turnText = playerText;
    }

    endTurn() {
        this.currentTurnIndex = (this.currentTurnIndex + 1) % this.players.length;
        this.selectedUnit = null;
        if (this.turnText) {
            this.turnText.setText('Player Turn: ' + (this.currentTurnIndex + 1));
        }
        this.moveEnemies(); // enemy movement on turn end
    }

    hexToPixel(q, r, size) {
        const x = size * Math.sqrt(3) * (q + r / 2);
        const y = size * 3/2 * r;
        return { x: x + 400, y: y + 100 };
    }

    pixelToHex(x, y) {
        const size = this.hexSize;
        const q = (x * Math.sqrt(3)/3 - y / 3) / size;
        const r = y * 2/3 / size;
        return this.roundHex(q, r);
    }

    roundHex(q, r) {
        let x = q;
        let z = r;
        let y = -x - z;

        let rx = Math.round(x);
        let ry = Math.round(y);
        let rz = Math.round(z);

        const dx = Math.abs(rx - x);
        const dy = Math.abs(ry - y);
        const dz = Math.abs(rz - z);

        if (dx > dy && dx > dz) rx = -ry - rz;
        else if (dy > dz) ry = -rx - rz;
        else rz = -rx - ry;

        return { q: rx, r: rz };
    }

    drawHex(q, r, x, y, size, color) {
        const graphics = this.add.graphics({ x: 0, y: 0 });
        graphics.lineStyle(1, 0x000000);
        graphics.fillStyle(color, 1);
        const corners = [];
        for (let i = 0; i < 6; i++) {
            const angle = Phaser.Math.DegToRad(60 * i - 30);
            const px = x + size * Math.cos(angle);
            const py = y + size * Math.sin(angle);
            corners.push({ x: px, y: py });
        }
        graphics.beginPath();
        graphics.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) {
            graphics.lineTo(corners[i].x, corners[i].y);
        }
        graphics.closePath();
        graphics.fillPath();
        graphics.strokePath();

        this.tileMap[`${q},${r}`] = graphics;
    }

    getColorForTerrain(terrain) {
        switch (terrain) {
            case 'grassland': return 0x34a853;
            case 'sand': return 0xFFF59D;
            case 'mud': return 0x795548;
            case 'swamp': return 0x4E342E;
            case 'mountain': return 0x9E9E9E;
            case 'water': return 0x4da6ff;
            default: return 0x888888;
        }
    }
}
