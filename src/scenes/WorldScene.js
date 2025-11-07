// deephexbeta/src/scenes/WorldScene.js
import HexMap from '../engine/HexMap.js';
import { findPath } from '../engine/AStar.js';
import { setupCameraControls, setupTurnUI } from './WorldSceneUI.js';
import { spawnUnitsAndEnemies, subscribeToGameUpdates } from './WorldSceneUnits.js';
import { startDocksPlacement, cancelPlacement, placeDocks } from './WorldSceneBuildings.js';
import {
  drawHexMap, hexToPixel, pixelToHex, roundHex, drawHex, getColorForTerrain, isoOffset, LIFT_PER_LVL
} from './WorldSceneMap.js';

/* =========================
   Deterministic world summary
   (mirrors the lobby so labels match)
   ========================= */
function __hashStr32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function __xorshift32(seed) {
  let x = (seed || 1) >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17; x >>>= 0;
    x ^= x << 5;  x >>>= 0;
    return (x >>> 0) / 4294967296;
  };
}
function getWorldSummaryForSeed(seed) {
  const rng = __xorshift32(__hashStr32(String(seed ?? 'default')));

  const geoRoll = rng();
  const bioRoll = rng();

  let geography;
  if (geoRoll < 0.15) geography = 'Big Lagoon';
  else if (geoRoll < 0.30) geography = 'Central Lake';
  else if (geoRoll < 0.50) geography = 'Small Bays';
  else if (geoRoll < 0.70) geography = 'Scattered Terrain';
  else if (geoRoll < 0.85) geography = 'Diagonal Island';
  else geography = 'Multiple Islands';

  let biome;
  if (bioRoll < 0.20) biome = 'Icy Biome';
  else if (bioRoll < 0.40) biome = 'Volcanic Biome';
  else if (bioRoll < 0.60) biome = 'Desert Biome';
  else if (bioRoll < 0.80) biome = 'Temperate Biome';
  else biome = 'Swamp Biome';

  return { geography, biome };
}

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

    // === isometry-aware axial -> world position (includes map offsets + elevation lift)
    this.axialToWorld = (q, r) => {
      const tile = this.mapData?.find(t => t.q === q && t.r === r);
      const elev = (tile && tile.type !== 'water')
        ? Math.max(0, (typeof tile?.elevation === 'number' ? tile.elevation : 0) - 1)
        : 0;
      const p = this.hexToPixel(q, r, this.hexSize);
      return {
        x: p.x + (this.mapOffsetX || 0),
        y: p.y + (this.mapOffsetY || 0) - (LIFT_PER_LVL * elev),
      };
    };

    this.tileMap = {};
    this.selectedUnit = null;
    this.selectedHex = null;
    this.movingPath = [];
    this.pathGraphics = this.add.graphics({ x: 0, y: 0 }).setDepth(50);
    this.pathLabels = [];
    this.debugGraphics = this.add.graphics({ x: 0, y: 0 }).setDepth(100);

    // === HEX INSPECT glue (so geo-object clicks can feed into it)
    this.events.on('hex-inspect', (text) => this.hexInspect(text));
    this.events.on('hex-inspect-extra', ({ header, lines }) => {
      const payload = [`[HEX INSPECT] ${header}`, ...(lines || [])].join('\n');
      this.hexInspect(payload);
    });
    // cleanup on shutdown
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off('hex-inspect');
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off('hex-inspect-extra');
    });

    this.hexMap = new HexMap(this.mapWidth, this.mapHeight, this.seed);
    this.mapData = this.hexMap.getMap();
    delete this.mapData.__locationsApplied;
    drawHexMap.call(this);

    // === Top-center world meta badge (Geography & Biome)
    const { geography, biome } =
      (this.hexMap.worldInfo ?? this.hexMap.worldMeta) || getWorldSummaryForSeed(this.seed);
    this.addWorldMetaBadge(geography, biome);

    await spawnUnitsAndEnemies.call(this);
    subscribeToGameUpdates.call(this);
    setupCameraControls(this);
    setupTurnUI(this);

    // Expose Docks placement to the UI and allow ESC to cancel
    this.startDocksPlacement = () => startDocksPlacement.call(this);
    this.input.keyboard?.on('keydown-ESC', () => cancelPlacement.call(this));

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
        const { x, y } = this.axialToWorld(q, r);
        const unit = this.players.find(p => p.name === this.playerName);
        if (unit) {
          unit.setPosition(x, y);
          unit.q = q;
          unit.r = r;
          console.log(`[REFRESH] Unit moved to synced position: (${q}, ${r})`);
        }
      });
    }

    // 🖱️ Pointer Click: Move or Select (with building placement handling)
    this.input.on("pointerdown", pointer => {
      if (pointer.rightButtonDown()) return;

      const { worldX, worldY } = pointer;
      const approx = this.pixelToHex(worldX - (this.mapOffsetX || 0), worldY - (this.mapOffsetY || 0), this.hexSize);
      const rounded = this.roundHex(approx.q, approx.r);

      /* ---------- Handle building placement first ---------- */
      if (this.placing?.type === 'docks') {
        const key = `${rounded.q},${rounded.r}`;
        if (this.placing.valid?.has(key)) {
          placeDocks.call(this, rounded.q, rounded.r); // auto-clears placement & highlight
        } else {
          cancelPlacement.call(this);                   // click outside → cancel
        }
        return; // don’t fall through to unit select/move
      }
      /* ----------------------------------------------------- */

      const tile = this.mapData.find(h => h.q === rounded.q && h.r === rounded.r);
      const playerHere = this.players.find(p => p.q === rounded.q && p.r === rounded.r);

      this.selectedHex = rounded;
      this.debugHex(rounded.q, rounded.r); // enhanced debug

      if (this.selectedUnit) {
        // Deselect if clicking the same hex
        if (this.selectedUnit.q === rounded.q && this.selectedUnit.r === rounded.r) {
          this.selectedUnit = null;
          this.hideUnitPanel?.();             // hide panel on deselect
          return;
        }

        const isBlocked = t => !t || t.type === 'water' || t.type === 'mountain';
        const fullPath = findPath(this.selectedUnit, rounded, this.mapData, isBlocked);
        if (fullPath && fullPath.length > 1) {
          const movePoints = this.selectedUnit.movementPoints || 10;
          let totalCost = 0;
          const trimmedPath = [fullPath[0]];
          for (let i = 1; i < fullPath.length; i++) {
            const stepTile = this.mapData.find(h => h.q === fullPath[i].q && h.r === fullPath[i].r);
            const cost = stepTile?.movementCost || 1;
            totalCost += cost;
            if (totalCost <= movePoints) trimmedPath.push(fullPath[i]); else break;
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
        // Nothing selected yet: click selects a unit
        if (playerHere) {
          this.selectedUnit = playerHere;
          this.selectedUnit.movementPoints = 10;
          this.showUnitPanel?.(this.selectedUnit);   // show the 4-button panel
          console.log(`[SELECTED] Unit at (${playerHere.q}, ${playerHere.r})`);
        } else {
          // Clicked empty terrain → ensure the panel is hidden
          this.selectedUnit = null;
          this.hideUnitPanel?.();
        }
      }
    });

    // 🧭 Pointer Move: Draw Path Preview
    this.input.on("pointermove", pointer => {
      if (!this.selectedUnit || this.isUnitMoving) return;

      const { worldX, worldY } = pointer;
      const approx = this.pixelToHex(worldX - (this.mapOffsetX || 0), worldY - (this.mapOffsetY || 0), this.hexSize);
      const rounded = this.roundHex(approx.q, approx.r);

      const isBlocked = t => !t || t.type === 'water' || t.type === 'mountain';
      const path = findPath(this.selectedUnit, rounded, this.mapData, isBlocked);

      this.clearPathPreview();
      if (path && path.length > 1) {
        let costSum = 0;
        const maxMove = this.selectedUnit.movementPoints || 10;

        for (let i = 0; i < path.length; i++) {
          const step = path[i];
          const stepTile = this.mapData.find(h => h.q === step.q && h.r === step.r);
          const moveCost = stepTile?.movementCost || 1;

          const { x, y } = this.axialToWorld(step.q, step.r);
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

  // Minimal inspector that the geo-object code can call.
  // Feel free to replace with your in-game panel later.
  hexInspect(text) {
    if (!text) return;
    const lines = String(text).split('\n');
    const title = lines.shift() || '[HEX INSPECT]';
    console.groupCollapsed(title);
    lines.forEach(l => console.log(l));
    console.groupEnd();
  }

  addWorldMetaBadge(geography, biome) {
    // Container at top center, fixed to screen
    const cam = this.cameras.main;
    const cx = cam.width / 2;

    const container = this.add.container(cx, 18).setScrollFactor(0).setDepth(2000);
    const text1 = this.add.text(0, 0, `🌍 Geography: ${geography}`, {
      fontSize: '16px',
      color: '#e8f6ff'
    }).setOrigin(0.5, 0.5).setDepth(2001);

    const text2 = this.add.text(0, 20, `🌿 Biome: ${biome}`, {
      fontSize: '16px',
      color: '#e8f6ff'
    }).setOrigin(0.5, 0.5).setDepth(2001);

    // background pill
    const w = Math.max(text1.width, text2.width) + 24;
    const h = 44;
    const bg = this.add.graphics().setDepth(2000);
    bg.fillStyle(0x000000, 0.35);
    bg.fillRoundedRect(-w/2, -10, w, h, 10);
    bg.lineStyle(1, 0xffffff, 0.15);
    bg.strokeRoundedRect(-w/2, -10, w, h, 10);

    container.add([bg, text1, text2]);
    this.worldMetaBadge = container;
  }

  clearPathPreview() {
    this.pathGraphics.clear();
    this.pathLabels.forEach(label => label.destroy());
    this.pathLabels = [];
  }

  // --- CLICK DEBUG: neighbor levels per YOUR side numbering using odd-r axial deltas ---
  debugHex(q, r) {
    // Local outline
    const center = this.axialToWorld(q, r);
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

    // --- odd-r axial deltas mapped to your sides (0..5) ---
    // sides: 0=NE, 1=E, 2=SE, 3=SW, 4=W, 5=NW
    const isOdd = (r & 1) === 1;

    // even row deltas
    const evenNE = [0, -1], evenE = [+1, 0], evenSE = [0, +1];
    const evenSW = [-1, +1], evenW = [-1, 0], evenNW = [-1, -1];

    // odd row deltas
    const oddNE = [+1, -1], oddE = [+1, 0], oddSE = [+1, +1];
    const oddSW = [0, +1], oddW = [-1, 0], oddNW = [0, -1];

    const deltas = isOdd
      ? [oddNE, oddE, oddSE, oddSW, oddW, oddNW]
      : [evenNE, evenE, evenSE, evenSW, evenW, evenNW];

    for (let side = 0; side < 6; side++) {
      const [dq, dr] = deltas[side];
      const nq = q + dq, nr = r + dr;
      const nTile = this.mapData.find(h => h.q === nq && h.r === nr);
      if (!nTile) {
        console.log(`Side ${side} - adjacent to hex level N/A (off map)`);
      } else {
        const lvl = (typeof nTile.elevation === 'number') ? nTile.elevation : 'N/A';
        console.log(`Side ${side} - adjacent to hex level ${lvl} (terrain ${nTile.type})`);
      }
    }
  }

  startStepMovement() {
    if (!this.selectedUnit || !this.movingPath || this.movingPath.length === 0) return;

    const unit = this.selectedUnit;
    const step = this.movingPath.shift();
    const { x, y } = this.axialToWorld(step.q, step.r);

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
    this.hideUnitPanel?.();  // hide the panel when the turn ends
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
          const { x, y } = this.axialToWorld(nq, nr);
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
