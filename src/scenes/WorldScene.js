// deephexbeta/src/scenes/WorldScene.js
import HexMap from '../engine/HexMap.js';
import { findPath } from '../engine/AStar.js';
import { setupCameraControls, setupTurnUI } from './WorldSceneUI.js';
import { spawnUnitsAndEnemies, subscribeToGameUpdates } from './WorldSceneUnits.js';
import {
  drawHexMap, hexToPixel, pixelToHex, roundHex, drawHex, getColorForTerrain, isoOffset
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
    this.isUnitMoving = false;

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

    this.getNextPlayer = (list, current) => {
      const idx = list.indexOf(current);
      return list[(idx + 1) % list.length];
    };

    // bind geometry helpers to scene
    this.hexToPixel = hexToPixel.bind(this);
    this.pixelToHex = pixelToHex.bind(this);
    this.roundHex = roundHex.bind(this);
    this.drawHex = drawHex.bind(this);
    this.getColorForTerrain = getColorForTerrain.bind(this);
    this.isoOffset = isoOffset.bind(this);

    this.tileMap = {};
    this.selectedUnit = null;
    this.selectedHex = null;
    this.movingPath = [];
    this.pathGraphics = this.add.graphics({ x: 0, y: 0 }).setDepth(50);
    this.pathLabels = [];
    this.debugGraphics = this.add.graphics({ x: 0, y: 0 }).setDepth(100);

    this.hexMap = new HexMap(this.mapWidth, this.mapHeight, this.seed);
    this.mapData = this.hexMap.getMap();
    drawHexMap.call(this);

    await spawnUnitsAndEnemies.call(this);
    subscribeToGameUpdates.call(this);
    setupCameraControls(this);
    setupTurnUI(this);

    // 🌀 Refresh Button (Unit sync)
    if (this.refreshButton) {
      this.refreshButton.removeAllListeners('pointerdown');
      this.refreshButton.on('pointerdown', async () => {
        const { data: lobbyData, error } = await this.supabase
          .from('lobbies')
          .select('state')
          .eq('room_code', this.roomCode)
          .single();

        if (error || !lobbyData?.state?.units) {
          console.error("Failed to refresh units:", error);
          return;
        }

        const unitData = lobbyData.state.units[this.playerName];
        if (!unitData) return;

        const { q, r } = unitData;
        const { x, y } = this.hexToPixel(q, r, this.hexSize);
        const unit = this.players.find(p => p.name === this.playerName);
        if (unit) {
          unit.setPosition(x, y);
          unit.q = q;
          unit.r = r;
          console.log(`[REFRESH] Unit moved to synced position: (${q}, ${r})`);
        }
      });
    }

    // 🖱️ Pointer Click: Move or Select
    this.input.on("pointerdown", pointer => {
      if (pointer.rightButtonDown()) return;

      const { worldX, worldY } = pointer;
      const approx = this.pixelToHex(worldX - (this.mapOffsetX || 0), worldY - (this.mapOffsetY || 0), this.hexSize);
      const rounded = this.roundHex(approx.q, approx.r);
      const tile = this.mapData.find(h => h.q === rounded.q && h.r === rounded.r);
      const playerHere = this.players.find(p => p.q === rounded.q && p.r === rounded.r);

      this.selectedHex = rounded;
      this.debugHex(rounded.q, rounded.r); // ⬅️ enhanced debug

      if (this.selectedUnit) {
        if (this.selectedUnit.q === rounded.q && this.selectedUnit.r === rounded.r) {
          this.selectedUnit = null;
          return;
        }

        const isBlocked = tile => !tile || tile.type === 'water' || tile.type === 'mountain';
        const fullPath = findPath(this.selectedUnit, rounded, this.mapData, isBlocked);
        if (fullPath && fullPath.length > 1) {
          const movePoints = this.selectedUnit.movementPoints || 10;
          let totalCost = 0;
          const trimmedPath = [fullPath[0]];
          for (let i = 1; i < fullPath.length; i++) {
            const tile = this.mapData.find(h => h.q === fullPath[i].q && h.r === fullPath[i].r);
            const cost = tile?.movementCost || 1;
            totalCost += cost;
            if (totalCost <= movePoints) {
              trimmedPath.push(fullPath[i]);
            } else {
              break;
            }
          }

          if (trimmedPath.length > 1) {
            this.movingPath = trimmedPath.slice(1);
            this.isUnitMoving = true;
            this.clearPathPreview();
            this.startStepMovement();
          }
        } else {
          console.log("Path not found or blocked.");
        }
      } else {
        if (playerHere) {
          this.selectedUnit = playerHere;
          this.selectedUnit.movementPoints = 10;
          console.log(`[SELECTED] Unit at (${playerHere.q}, ${playerHere.r})`);
        }
      }
    });

    // 🧭 Pointer Move: Draw Path Preview
    this.input.on("pointermove", pointer => {
      if (!this.selectedUnit || this.isUnitMoving) return;

      const { worldX, worldY } = pointer;
      const approx = this.pixelToHex(worldX - (this.mapOffsetX || 0), worldY - (this.mapOffsetY || 0), this.hexSize);
      const rounded = this.roundHex(approx.q, approx.r);

      const isBlocked = tile => !tile || tile.type === 'water' || tile.type === 'mountain';
      const path = findPath(this.selectedUnit, rounded, this.mapData, isBlocked);

      this.clearPathPreview();
      if (path && path.length > 1) {
        let costSum = 0;
        const maxMove = this.selectedUnit.movementPoints || 10;

        for (let i = 0; i < path.length; i++) {
          const step = path[i];
          const tile = this.mapData.find(h => h.q === step.q && h.r === step.r);
          const moveCost = tile?.movementCost || 1;

          const { x, y } = this.hexToPixel(step.q, step.r, this.hexSize);
          const isStart = i === 0;

          if (!isStart) costSum += moveCost;

          const fillColor = isStart ? 0xeeeeee : (costSum <= maxMove ? 0x00ff00 : 0xffffff);
          const labelColor = costSum <= maxMove ? '#ffffff' : '#000000';
          const bgColor = costSum <= maxMove ? 0x008800 : 0xffffff;

          // Draw hex background
          this.pathGraphics.lineStyle(1, 0x000000, 0.3);
          this.pathGraphics.fillStyle(fillColor, 0.4);
          this.pathGraphics.beginPath();
          this.drawHex(this.pathGraphics, x, y, this.hexSize);
          this.pathGraphics.closePath();
          this.pathGraphics.fillPath();
          this.pathGraphics.strokePath();

          // Draw cost circle + text
          if (!isStart) {
            const circle = this.add.graphics();
            circle.fillStyle(bgColor, 1);
            circle.fillCircle(x, y, 9);
            circle.setDepth(50);
            this.pathLabels.push(circle);

            const label = this.add.text(x, y, `${costSum}`, {
              fontSize: '10px',
              color: labelColor,
              fontStyle: 'bold'
            }).setOrigin(0.5).setDepth(51);
            this.pathLabels.push(label);
          }
        }
      }
    });
  }

  clearPathPreview() {
    this.pathGraphics.clear();
    this.pathLabels.forEach(label => label.destroy());
    this.pathLabels = [];
  }

  // --- helper for debugHex: choose ring-edge for your side numbering using unsheared vectors ---
  _sideToRingEdge(center, ring) {
    // In iso space: x' = x - y*s ; y' = y*k
    const SHEAR = 0.15, YSCALE = 0.95;

    // Your intended unit vectors in *unsheared* local space:
    // 0 top-right, 1 right, 2 bottom-right, 3 bottom-left, 4 left, 5 top-left
    const dirs = [
      {x: +0.5, y: -Math.sqrt(3)/2}, // 0 TR
      {x: +1.0, y:  0.0},            // 1 R
      {x: +0.5, y: +Math.sqrt(3)/2}, // 2 BR
      {x: -0.5, y: +Math.sqrt(3)/2}, // 3 BL
      {x: -1.0, y:  0.0},            // 4 L
      {x: -0.5, y: -Math.sqrt(3)/2}, // 5 TL
    ];

    // For each ring edge, compute unsheared unit vector from center to edge midpoint
    const edgeVecs = [];
    for (let e = 0; e < 6; e++) {
      const A = ring[e];
      const B = ring[(e + 1) % 6];
      const mxp = (A.x + B.x) * 0.5 - center.x; // iso delta x'
      const myp = (A.y + B.y) * 0.5 - center.y; // iso delta y'
      // Un-shear vector: y = y'/k ; x = x' + (y'/k)*s
      const uy = myp / YSCALE;
      const ux = mxp + uy * SHEAR;
      const L = Math.hypot(ux, uy) || 1;
      edgeVecs.push({ x: ux / L, y: uy / L }); // unit unsheared
    }

    // Map each user side to the best-matching ring edge by dot product
    const map = new Array(6).fill(0);
    for (let side = 0; side < 6; side++) {
      const d = dirs[side];
      let best = 0, bestDot = -Infinity;
      for (let e = 0; e < 6; e++) {
        const v = edgeVecs[e];
        const dot = v.x * d.x + v.y * d.y;
        if (dot > bestDot) { bestDot = dot; best = e; }
      }
      map[side] = best;
    }
    return map; // array length 6: map[side] -> ringEdgeIndex
  }

  debugHex(q, r) {
    // Local center (no map offsets)
    const center = this.hexToPixel(q, r, this.hexSize);
    this.debugGraphics.clear();
    this.debugGraphics.lineStyle(2, 0xff00ff, 1);
    this.drawHex(this.debugGraphics, center.x, center.y, this.hexSize);

    const tile = this.mapData.find(h => h.q === q && h.r === r);
    const playerHere = this.players.find(p => p.q === q && p.r === r);
    const enemiesHere = this.enemies.filter(e => e.q === q && e.r === r);

    const objects = [];
    if (tile?.hasForest) objects.push("Forest");
    if (tile?.hasRuin) objects.push("Ruin");
    if (tile?.hasCrashSite) objects.push("Crash Site");
    if (tile?.hasVehicle) objects.push("Vehicle");
    if (tile?.hasRoad) objects.push("Road");

    console.log(`[HEX INSPECT] (${q}, ${r})`);
    console.log(`• Terrain: ${tile?.type}`);
    console.log(`• Level (elevation): ${tile?.elevation ?? 'N/A'}`);
    console.log(`• Player Unit: ${playerHere ? "Yes" : "No"}`);
    console.log(`• Enemy Units: ${enemiesHere.length}`);
    console.log(`• Objects: ${objects.join(", ") || "None"}`);

    // Build ring in local iso coords (consistent with renderer)
    const w = this.hexSize * Math.sqrt(3) / 2;
    const h = this.hexSize / 2;
    const deltas = [
      { dx: 0,  dy: -this.hexSize }, // ring edge 0 (top)
      { dx: +w, dy: -h           }, // 1 (top-right)
      { dx: +w, dy: +h           }, // 2 (bottom-right)
      { dx: 0,  dy: +this.hexSize }, // 3 (bottom)
      { dx: -w, dy: +h           }, // 4 (bottom-left)
      { dx: -w, dy: -h           }, // 5 (top-left)
    ];
    const ring = deltas.map(({dx, dy}) => {
      const off = isoOffset(dx, dy);
      return { x: center.x + off.x, y: center.y + off.y };
    });

    // Map your sides (0..5) to ring edges via unsheared vector matching
    const sideToEdge = this._sideToRingEdge(center, ring);

    // For each side, sample the neighbor by going slightly over the chosen edge
    const EPS = 1.75;
    for (let side = 0; side < 6; side++) {
      const e = sideToEdge[side];
      const A = ring[e];
      const B = ring[(e + 1) % 6];
      let mx = (A.x + B.x) * 0.5;
      let my = (A.y + B.y) * 0.5;
      const vx = mx - center.x, vy = my - center.y;
      const L = Math.hypot(vx, vy) || 1;
      mx += (vx / L) * EPS;
      my += (vy / L) * EPS;

      // already local → axial
      const approx = this.pixelToHex(mx, my, this.hexSize);
      const nbr = this.roundHex(approx.q, approx.r);
      const nTile = this.mapData.find(h => h.q === nbr.q && h.r === nbr.r);

      if (!nTile) {
        console.log(`Side ${side} - adjacent to hex level N/A (off map)`);
      } else {
        const levelStr = (typeof nTile.elevation === 'number') ? nTile.elevation : 'N/A';
        console.log(`Side ${side} - adjacent to hex level ${levelStr} (terrain ${nTile.type})`);
      }
    }
  }

  startStepMovement() {
    if (!this.selectedUnit || !this.movingPath || this.movingPath.length === 0) return;

    const unit = this.selectedUnit;
    const step = this.movingPath.shift();
    const { x, y } = this.hexToPixel(step.q, step.r, this.hexSize);

    this.tweens.add({
      targets: unit,
      x, y,
      duration: 200,
      onComplete: () => {
        unit.q = step.q;
        unit.r = step.r;
        this.clearPathPreview();

        if (this.movingPath.length > 0) {
          this.startStepMovement();
        } else {
          this.syncPlayerMove(unit);
          this.isUnitMoving = false;
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
    if (this.selectedHexGraphic) {
      this.selectedHexGraphic.destroy();
      this.selectedHexGraphic = null;
    }
    if (this.turnText) {
      this.turnText.setText("Player Turn: ...");
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
