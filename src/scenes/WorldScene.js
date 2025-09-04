// deephexbeta/src/scenes/WorldScene.js
import HexMap from '../engine/HexMap.js';
import { findPath } from '../engine/AStar.js';
import { setupCameraControls, setupTurnUI } from './WorldSceneUI.js';
import { spawnUnitsAndEnemies, subscribeToGameUpdates } from './WorldSceneUnits.js';
import { handleHexClick, refreshUnits, setupPointerActions } from './WorldSceneActions.js';
import {
  drawHexMap,
  hexToPixel, pixelToHex, roundHex, drawHex, getColorForTerrain
} from './WorldSceneMap.js';

export default class WorldScene extends Phaser.Scene {
  constructor() {
    super('WorldScene');
  }

  preload() {}

  async create() {
    this.hexSize = 24;
    this.mapWidth = 25;
    this.mapHeight = 25;
    this.input.setDefaultCursor('grab');
    this.isDragging = false;
    this.moveCooldown = false;

    const pad = this.hexSize * 2;
    const mapPixelWidth = this.hexSize * Math.sqrt(3) * (this.mapWidth + 0.5) + pad * 2;
    const mapPixelHeight = this.hexSize * 1.5 * (this.mapHeight + 0.5) + pad * 2;
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

    this.syncPlayerMove = async unit => {
      const res = await this.supabase.from('lobbies').select('state').eq('room_code', this.roomCode).single();
      if (!res.data) return;
      const nextPlayer = this.getNextPlayer(res.data.state.players, this.playerName);
      await this.supabase
        .from('lobbies')
        .update({
          state: {
            ...res.data.state,
            units: { ...res.data.state.units, [this.playerName]: { q: unit.q, r: unit.r } },
            currentTurn: nextPlayer
          }
        })
        .eq('room_code', this.roomCode);
    };

    this.syncEnemies = async () => {
      const enemyData = this.enemies.map(e => ({ q: e.q, r: e.r }));
      await this.supabase
        .from('lobbies')
        .update({ state: { ...this.lobbyState, enemies: enemyData } })
        .eq('room_code', this.roomCode);
    };

    this.getNextPlayer = (list, current) => {
      const idx = list.indexOf(current);
      return list[(idx + 1) % list.length];
    };

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
    this.debugGraphics = this.add.graphics({ x: 0, y: 0 }).setDepth(100);

    this.hexMap = new HexMap(this.mapWidth, this.mapHeight, this.seed);
    this.mapData = this.hexMap.getMap();
    drawHexMap.call(this);

    await spawnUnitsAndEnemies.call(this);
    subscribeToGameUpdates.call(this);

    setupCameraControls(this);
    setupTurnUI(this);
    setupPointerActions(this);

    this.input.on("pointerdown", (pointer) => {
      if (pointer.rightButtonDown()) return;

      const worldX = pointer.worldX;
      const worldY = pointer.worldY;
      const approx = this.pixelToHex(worldX, worldY, this.hexSize);
      const rounded = this.roundHex(approx.q, approx.r);
      const center = this.hexToPixel(rounded.q, rounded.r, this.hexSize);

      this.debugGraphics.clear();
      this.debugGraphics.lineStyle(2, 0xff00ff, 1);
      this.drawHex(this.debugGraphics, center.x, center.y, this.hexSize);

      this.selectedHex = rounded;

      const tile = this.mapData.find(h => h.q === rounded.q && h.r === rounded.r);
      const terrainType = tile?.type || "unknown";

      const playerHere = this.players.find(p => p.q === rounded.q && p.r === rounded.r);
      const enemiesHere = this.enemies.filter(e => e.q === rounded.q && e.r === rounded.r);

      const objects = [];
      if (tile?.hasForest) objects.push("Forest");
      if (tile?.hasRuin) objects.push("Ruin");
      if (tile?.hasCrashSite) objects.push("Crash Site");
      if (tile?.hasVehicle) objects.push("Vehicle");
      if (tile?.hasRoad) objects.push("Road");

      console.log(`[HEX INSPECT] (${rounded.q}, ${rounded.r})`);
      console.log(`• Terrain: ${terrainType}`);
      console.log(`• Player Unit: ${playerHere ? "Yes" : "No"}`);
      console.log(`• Enemy Units: ${enemiesHere.length}`);
      if (enemiesHere.length > 0) {
        enemiesHere.forEach((e, i) => console.log(`   - Enemy #${i + 1} at (${e.q}, ${e.r})`));
      }
      console.log(`• Objects: ${objects.length > 0 ? objects.join(", ") : "None"}`);

      if (this.selectedUnit) {
        const start = { q: this.selectedUnit.q, r: this.selectedUnit.r };
        const end = { q: rounded.q, r: rounded.r };
        const path = findPath(start, end, this.mapData);

        if (path.length > 0) {
          this.selectedUnit.setPosition(center.x, center.y);
          this.selectedUnit.q = rounded.q;
          this.selectedUnit.r = rounded.r;
          this.syncPlayerMove(this.selectedUnit);
          this.checkCombat();
          this.pathGraphics.clear();
        }
      }
    });

    if (this.refreshButton) {
      this.refreshButton.removeAllListeners('pointerdown');
      this.refreshButton.on('pointerdown', () => refreshUnits(this));
    }
  }

  update() {}

  checkCombat() {
    console.log('[Combat] not implemented yet');
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
    const dirs = [
      { dq: +1, dr: 0 }, { dq: -1, dr: 0 },
      { dq: 0, dr: +1 }, { dq: 0, dr: -1 },
      { dq: +1, dr: -1 }, { dq: -1, dr: +1 }
    ];
    this.enemies.forEach(enemy => {
      Phaser.Utils.Array.Shuffle(dirs);
      for (const d of dirs) {
        const nq = enemy.q + d.dq, nr = enemy.r + d.dr;
        const tile = this.mapData.find(h => h.q === nq && h.r === nr);
        if (tile && !['water', 'mountain'].includes(tile.type)) {
          const { x, y } = this.hexToPixel(nq, nr, this.hexSize);
          enemy.setPosition(x, y);
          enemy.q = nq;
          enemy.r = nr;
          break;
        }
      }
    });
    this.syncEnemies();
  }
}
