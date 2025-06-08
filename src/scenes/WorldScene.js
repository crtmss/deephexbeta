// deephexbeta/src/scenes/WorldScene.js

import HexMap from '../engine/HexMap.js';
import { findPath } from '../engine/AStar.js';
import { setupCameraControls, setupTurnUI } from './WorldSceneUI.js';
import { spawnUnitsAndEnemies, subscribeToGameUpdates } from './WorldSceneUnits.js';
import { handleHexClick, refreshUnits, setupPointerActions } from './WorldSceneActions.js';
import {
  generateHexMap,
  drawHexMap,
  hexToPixel,
  pixelToHex,
  roundHex,
  drawHex,
  getColorForTerrain
} from './WorldSceneMap.js';

export default class WorldScene extends Phaser.Scene {
  constructor() {
    super('WorldScene');
  }

  async create() {
    this.hexSize = 24;
    this.mapWidth = 25;
    this.mapHeight = 25;
    this.input.setDefaultCursor('grab');
    this.isDragging = false;
    this.moveCooldown = false;

    // Set camera boundaries
    const mapPixelWidth = this.hexSize * Math.sqrt(3) * (this.mapWidth + 0.5);
    const mapPixelHeight = this.hexSize * 0.75 * (this.mapHeight - 1) + this.hexSize * 2;
    this.cameras.main.setBounds(0, 0, mapPixelWidth, mapPixelHeight);
    this.cameras.main.setZoom(1.0);

    const { roomCode, playerName, isHost } = this.scene.settings.data;
    const { getLobbyState } = await import('../net/LobbyManager.js');
    const { data: lobbyData, error } = await getLobbyState(roomCode);
    if (error || !lobbyData?.state?.seed) return;
    this.seed = lobbyData.state.seed;
    this.lobbyState = lobbyData.state;

    const { subscribeToGame } = await import('../net/SyncManager.js');
    const { supabase } = await import('../net/SupabaseClient.js');

    this.playerName = playerName;
    this.roomCode = roomCode;
    this.isHost = isHost;
    this.supabase = supabase;
    this.subscribeToGame = subscribeToGame;

    // Helper for syncing movement
    this.syncPlayerMove = async (unit) => {
      const { data: lobbyData, error: fetchError } = await this.supabase
        .from('lobbies').select('state').eq('room_code', this.roomCode).single();
      if (fetchError) return;
      const updatedState = {
        ...lobbyData.state,
        units: {
          ...lobbyData.state.units,
          [this.playerName]: { q: unit.q, r: unit.r }
        },
        currentTurn: this.getNextPlayer(lobbyData.state.players, this.playerName)
      };
      await this.supabase.from('lobbies').update({ state: updatedState }).eq('room_code', this.roomCode);
    };

    // Enemy sync
    this.syncEnemies = async () => {
      const enemyData = this.enemies.map(e => ({ q: e.q, r: e.r }));
      await this.supabase.from('lobbies').update({
        state: { ...this.lobbyState, enemies: enemyData }
      }).eq('room_code', this.roomCode);
    };

    this.getNextPlayer = (list, current) => {
      const idx = list.indexOf(current);
      return list[(idx + 1) % list.length];
    };

    // Bind hex methods
    this.hexToPixel = hexToPixel.bind(this);
    this.pixelToHex = pixelToHex.bind(this);
    this.roundHex = roundHex.bind(this);
    this.drawHex = drawHex.bind(this);
    this.getColorForTerrain = getColorForTerrain.bind(this);

    this.tileMap = {};
    this.selectedUnit = null;
    this.selectedHex = null;
    this.movingPath = [];
    this.pathGraphics = this.add.graphics({ x: 0, y: 0 }).setDepth(50);

    // Setup base map
    this.hexMap = new HexMap(this.mapWidth, this.mapHeight, this.seed);
    this.mapData = this.hexMap.getMap();
    drawHexMap.call(this);

    // Setup units/enemies
    await spawnUnitsAndEnemies.call(this);

    // Subscribe to real-time updates
    subscribeToGameUpdates.call(this);

    // Setup UI and controls
    setupCameraControls(this);
    setupTurnUI(this); // ✅ FIXED: pass 'this' properly as the scene
    setupPointerActions.call(this);
  }

  update() {}

  startStepMovement() {
    if (!this.selectedUnit || this.movingPath.length === 0) return;
    this.moveCooldown = true;
    this.time.addEvent({
      delay: 300,
      repeat: this.movingPath.length - 1,
      callback: () => {
        const next = this.movingPath.shift();
        const { x, y } = this.hexToPixel(next.q, next.r, this.hexSize);
        this.selectedUnit.setPosition(x, y);
        this.selectedUnit.q = next.q;
        this.selectedUnit.r = next.r;
        if (this.movingPath.length === 0) {
          this.moveCooldown = false;
          this.syncPlayerMove(this.selectedUnit);
          this.checkCombat();
          this.pathGraphics.clear();
        }
      }
    });
  }

  checkCombat() {
    console.log('[Combat] Check not implemented.');
  }

  endTurn() {
    if (this.playerName !== this.lobbyState.currentTurn) return;
    this.selectedUnit = null;
    if (this.selectedHexGraphic) {
      this.selectedHexGraphic.destroy();
      this.selectedHexGraphic = null;
    }
    if (this.turnText) {
      this.turnText.setText('Player Turn: ...');
    }
    if (this.isHost) this.moveEnemies();
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
        if (tile && !['water', 'mountain'].includes(tile.type)) {
          const { x, y } = this.hexToPixel(newQ, newR, this.hexSize);
          enemy.setPosition(x, y);
          enemy.q = newQ;
          enemy.r = newR;
          break;
        }
      }
    });
    this.syncEnemies();
  }
}
