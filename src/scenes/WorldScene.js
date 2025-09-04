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

    const pad = this.hexSize * 2;
    const mapPixelWidth = this.hexSize * Math.sqrt(3) * (this.mapWidth + 0.5) + pad * 2;
    const mapPixelHeight = this.hexSize * 1.5 * (this.mapHeight + 0.5) + pad * 2;
    this.cameras.main.setBounds(0, 0, mapPixelWidth, mapPixelHeight);
    this.cameras.main.setZoom(1.0);

    // Lobby and seed
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
    this.selectionMarker = null;

    this.hexMap = new HexMap(this.mapWidth, this.mapHeight, this.seed);
    this.mapData = this.hexMap.getMap();
    drawHexMap.call(this);

    await spawnUnitsAndEnemies.call(this);
    subscribeToGameUpdates.call(this);
    setupCameraControls(this);
    setupTurnUI(this);
    setupPointerActions(this);

    // Selection & movement
    this.input.on("pointerdown", (pointer, gameObjects) => {
      if (pointer.rightButtonDown()) return;

      const worldX = pointer.worldX;
      const worldY = pointer.worldY;
      const { q, r } = this.roundHex(...Object.values(this.pixelToHex(worldX, worldY, this.hexSize)));
      const tile = this.mapData.find(t => t.q === q && t.r === r);
      const playerHere = this.players.find(p => p.q === q && p.r === r);

      this.debugGraphics.clear();
      const center = this.hexToPixel(q, r, this.hexSize);
      this.debugGraphics.lineStyle(2, 0xff00ff, 1);
      this.drawHex(this.debugGraphics, center.x, center.y, this.hexSize);

      // Print inspection info
      console.log(`[HEX INSPECT] (${q}, ${r})`);
      console.log(`• Terrain: ${tile?.type || "unknown"}`);
      console.log(`• Player Unit: ${playerHere ? "Yes" : "No"}`);
      console.log(`• Enemy Units: ${this.enemies.filter(e => e.q === q && e.r === r).length}`);
      console.log(`• Objects: ${[
        tile?.hasForest && "Forest",
        tile?.hasRuin && "Ruin",
        tile?.hasCrashSite && "Crash Site",
        tile?.hasVehicle && "Vehicle",
        tile?.hasRoad && "Road"
      ].filter(Boolean).join(", ") || "None"}`);

      // === SELECTION ===
      const clickedUnit = gameObjects.find(obj => obj.getData("isPlayerUnit"));
      if (clickedUnit) {
        // clicked the red unit circle
        if (this.selectedUnit === clickedUnit) {
          console.log("Unit already selected.");
          return;
        }

        this.selectedUnit = clickedUnit;
        console.log(`[SELECTED] Unit at (${clickedUnit.q}, ${clickedUnit.r})`);

        if (this.selectionMarker) this.selectionMarker.destroy();
        const marker = this.add.circle(clickedUnit.x, clickedUnit.y - 16, 4, 0xffffff)
          .setDepth(3);
        this.selectionMarker = marker;
        return;
      }

      // === MOVE if unit selected ===
      if (this.selectedUnit) {
        const isBlocked = (tile) =>
          !tile || tile.type === "water" || tile.type === "mountain";

        const path = findPath(
          { q: this.selectedUnit.q, r: this.selectedUnit.r },
          { q, r },
          this.mapData,
          isBlocked
        );

        if (path && path.length > 1) {
          this.movingPath = path.slice(1);
          this.startStepMovement();
        } else {
          console.log("Path not found or blocked.");
        }
        this.selectedUnit = null;
        if (this.selectionMarker) {
          this.selectionMarker.destroy();
          this.selectionMarker = null;
        }
        this.pathGraphics.clear();
      }
    });

    // === PATH PREVIEW ON HOVER ===
    this.input.on("pointermove", (pointer) => {
      if (!this.selectedUnit) return;

      const { q, r } = this.roundHex(...Object.values(this.pixelToHex(pointer.worldX, pointer.worldY, this.hexSize)));
      const tile = this.mapData.find(h => h.q === q && h.r === r);
      const isBlocked = (tile) => !tile || tile.type === "water" || tile.type === "mountain";

      const path = findPath(
        { q: this.selectedUnit.q, r: this.selectedUnit.r },
        { q, r },
        this.mapData,
        isBlocked
      );

      this.pathGraphics.clear();
      if (path && path.length > 1) {
        this.pathGraphics.lineStyle(2, 0xffffff, 0.5);
        for (let i = 0; i < path.length - 1; i++) {
          const a = this.hexToPixel(path[i].q, path[i].r, this.hexSize);
          const b = this.hexToPixel(path[i + 1].q, path[i + 1].r, this.hexSize);
          this.pathGraphics.strokeLineShape(new Phaser.Geom.Line(a.x, a.y, b.x, b.y));
        }
      }
    });

    if (this.refreshButton) {
      this.refreshButton.removeAllListeners('pointerdown');
      this.refreshButton.on('pointerdown', () => refreshUnits(this));
    }
  }

  update() {}

  startStepMovement() {
    if (!this.selectedUnit || !this.movingPath || this.movingPath.length === 0) return;

    const step = this.movingPath.shift();
    const { x, y } = this.hexToPixel(step.q, step.r, this.hexSize);

    this.tweens.add({
      targets: this.selectedUnit,
      x, y,
      duration: 200,
      onComplete: () => {
        this.selectedUnit.q = step.q;
        this.selectedUnit.r = step.r;

        if (this.selectionMarker) {
          this.selectionMarker.setPosition(x, y - 16);
        }

        if (this.movingPath.length > 0) {
          this.startStepMovement();
        } else {
          this.syncPlayerMove(this.selectedUnit);
          this.pathGraphics.clear();
          this.checkCombat();
        }
      }
    });
  }

  checkCombat() {
    console.log("[Combat] not implemented yet.");
  }

  endTurn() {
    if (this.playerName !== this.lobbyState.currentTurn) return;
    this.selectedUnit = null;
    if (this.selectionMarker) {
      this.selectionMarker.destroy();
      this.selectionMarker = null;
    }
    if (this.turnText) this.turnText.setText("Player Turn: ...");
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
