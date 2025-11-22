// src/scenes/WorldScene.js
import HexMap from '../engine/HexMap.js';
import { findPath as aStarFindPath } from '../engine/AStar.js';
import { drawLocationsAndRoads } from './WorldSceneMapLocations.js';
import { setupWorldMenus, attachSelectionHighlight } from './WorldSceneMenus.js';

// Logistics: building-side production + advanced hauler routes
import { applyLogisticsOnEndTurn } from './WorldSceneLogistics.js';
import { applyLogisticsRoutesOnEndTurn } from './WorldSceneLogisticsRuntime.js';

// Haulers & ships
import {
  applyShipRoutesOnEndTurn,
  applyHaulerBehaviorOnEndTurn as applyHaulerRoutesOnEndTurn,
} from './WorldSceneHaulers.js';

// UI & input
import { setupTurnUI, updateTurnText, setupWorldInputUI } from './WorldSceneUI.js';

// Units / resources
import { spawnUnitsAndEnemies } from './WorldSceneUnits.js';
import { spawnFishResources } from './WorldSceneResources.js';

// Map rendering & helpers
import {
  drawHexMap,
  hexToPixel,
  pixelToHex,
  roundHex,
  drawHex,
  getColorForTerrain,
  isoOffset,
  LIFT_PER_LVL
} from './WorldSceneMap.js';

/* =========================
   Deterministic world summary
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
function getWorldSummaryForSeed(seedStr, width, height) {
  const seed = __hashStr32(seedStr);
  const rng = __xorshift32(seed);

  const totalTiles = width * height;
  const waterRatio = 0.28 + (rng() - 0.5) * 0.08;
  const forestRatio = 0.25 + (rng() - 0.5) * 0.10;
  const mountainRatio = 0.10 + (rng() - 0.5) * 0.05;

  const roughness = 0.4 + rng() * 0.4;
  const elevationVar = 0.6 + rng() * 0.4;

  const geography = {
    waterTiles: Math.round(totalTiles * waterRatio),
    forestTiles: Math.round(totalTiles * forestRatio),
    mountainTiles: Math.round(totalTiles * mountainRatio),
    roughness: +roughness.toFixed(2),
    elevationVar: +elevationVar.toFixed(2),
  };

  const biomes = [];
  if (waterRatio > 0.3) biomes.push('Archipelago');
  else if (waterRatio < 0.22) biomes.push('Continental');

  if (forestRatio > 0.28) biomes.push('Dense Forests');
  else if (forestRatio < 0.20) biomes.push('Sparse Forests');

  if (mountainRatio > 0.12) biomes.push('Mountainous');
  if (roughness > 0.6) biomes.push('Rugged Terrain');
  if (elevationVar > 0.7) biomes.push('High Elevation Contrast');

  const biome =
    biomes.length > 0
      ? biomes.join(', ')
      : 'Mixed Terrain';

  return { geography, biome };
}

/* =========================
   Small axial helpers
   ========================= */
function getTile(scene, q, r) {
  return scene.mapData.find(h => h.q === q && h.r === r);
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

    // collections
    this.units = [];
    this.enemies = [];
    this.players = [];
    this.buildings = [];
    this.haulers = [];
    this.shipRoutes = [];
    this.resources = [];

    // selection state
    this.selectedUnit = null;
    this.selectedHex = null;
    this.pathPreviewTiles = [];
    this.pathPreviewLabels = [];

    this.uiLocked = false;

    const {
      seed,
      playerName,
      roomCode,
      isHost,
      supabase,
      lobbyState,
    } = this.scene.settings.data || {};

    this.seed = seed || 'default-seed';
    this.playerName = playerName;
    this.roomCode = roomCode;
    this.isHost = isHost;
    this.supabase = supabase;
    this.lobbyState = lobbyState || { units: {}, enemies: [] };

    this.turnOwner = null;
    this.turnNumber = 1;

    // >>> INITIAL RESOURCES: +200 each <<<
    this.playerResources = {
      food: 200,
      scrap: 200,
      money: 200,
      influence: 200,
    };

    // --- map generation: use HexMap.generateMap() but wrap into mapInfo ---
    this.hexMap = new HexMap(this.mapWidth, this.mapHeight, this.seed);
    let mapInfo = this.hexMap.generateMap && this.hexMap.generateMap();

    if (Array.isArray(mapInfo)) {
      mapInfo = {
        tiles: mapInfo,
        objects: this.hexMap.objects || [],
      };
    } else if (!mapInfo || !Array.isArray(mapInfo.tiles)) {
      const tiles = this.hexMap.getMap ? this.hexMap.getMap() : (this.hexMap.map || []);
      mapInfo = {
        tiles,
        objects: this.hexMap.objects || [],
      };
    } else {
      if (!Array.isArray(mapInfo.objects)) {
        mapInfo.objects = this.hexMap.objects || [];
      }
    }

    this.mapInfo = mapInfo;
    this.hexMap.mapInfo = mapInfo;
    this.mapData = mapInfo.tiles;

    // expose helpers; offset handling is centralized in axialToWorld/worldToAxial
    this.hexToPixel = (q, r, sizeOverride) =>
      hexToPixel(q, r, sizeOverride ?? this.hexSize);
    this.pixelToHex = (x, y, sizeOverride) =>
      pixelToHex(x, y, sizeOverride ?? this.hexSize);

    // draw map and world objects
    drawHexMap.call(this);
    drawLocationsAndRoads.call(this);
    spawnFishResources.call(this);

    // === UNITS & ENEMIES SPAWN ===
    await spawnUnitsAndEnemies.call(this);
    // ==============================

    this.players = this.players || this.units.filter(u => u.isPlayer);
    this.enemies = this.enemies || this.units.filter(u => u.isEnemy);

    this.turnOwner =
      this.players[0]?.playerName ||
      this.players[0]?.name ||
      null;

    // UI: selection highlight + build menu + top HUD
    attachSelectionHighlight(this);
    setupWorldMenus(this);
    setupTurnUI(this);
    if (this.turnOwner) {
      updateTurnText(this, this.turnOwner);
    }

    this.addWorldMetaBadge();

    // Input (selection + path preview + movement) is handled via UI module
    setupWorldInputUI(this);

    if (this.supabase) {
      this.syncPlayerMove = async unit => {
        const res = await this.supabase
          .from('lobbies')
          .select('state')
          .eq('room_code', this.roomCode)
          .single();
        if (!res.data) return;
        const nextPlayer = this.getNextPlayer(res.data.state.players, this.playerName);
        await this.supabase
          .from('lobbies')
          .update({
            state: {
              ...res.data.state,
              players: res.data.state.players.map(p =>
                p.name === this.playerName
                  ? { ...p, q: unit.q, r: unit.r }
                  : p
              ),
              currentTurn: nextPlayer,
            },
          })
          .eq('room_code', this.roomCode);
      };
    }

    this.printTurnSummary?.();
  }

  getNextPlayer(players, currentName) {
    if (!players || players.length === 0) return null;
    const idx = players.findIndex(p => p.name === currentName);
    if (idx === -1) return players[0].name;
    return players[(idx + 1) % players.length].name;
  }

  addWorldMetaBadge() {
    const { geography, biome } = getWorldSummaryForSeed(this.seed, this.mapWidth, this.mapHeight);

    const text = `Seed: ${this.seed}
Water: ~${geography.waterTiles}
Forest: ~${geography.forestTiles}
Mountains: ~${geography.mountainTiles}
Roughness: ${geography.roughness}
Elev.Var: ${geography.elevationVar}
Biomes: ${biome}`;

    const pad = { x: 8, y: 6 };

    // moved to the right so it doesn't overlap the resource HUD
    const x = 320;
    const y = 16;

    const tempText = this.add.text(0, 0, text, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#d0f2ff',
    }).setVisible(false);

    const bounds = tempText.getBounds();
    tempText.destroy();

    const bgWidth = bounds.width + pad.x * 2;
    const bgHeight = bounds.height + pad.y * 2;

    const graphics = this.add.graphics();
    graphics.fillStyle(0x050f1a, 0.85);
    graphics.fillRoundedRect(x, y, bgWidth, bgHeight, 8);
    graphics.lineStyle(1, 0x34d2ff, 0.9);
    graphics.strokeRoundedRect(x, y, bgWidth, bgHeight, 8);
    graphics.setDepth(100);

    const label = this.add.text(
      x + pad.x,
      y + pad.y,
      text,
      {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#d0f2ff',
      }
    );
    label.setDepth(101);
  }

  // === Centralized offset-aware conversions ===
  axialToWorld(q, r) {
    const size = this.hexSize;
    const { x, y } = hexToPixel(q, r, size);

    const ox = this.mapOffsetX || 0;
    const oy = this.mapOffsetY || 0;

    return { x: x + ox, y: y + oy };
  }

  worldToAxial(x, y) {
    const size = this.hexSize;

    const ox = this.mapOffsetX || 0;
    const oy = this.mapOffsetY || 0;

    const { q, r } = pixelToHex(x - ox, y - oy, size);
    return roundHex(q, r);
  }

  debugHex(q, r) {
    const tile = getTile(this, q, r);
    if (!tile) {
      console.log(`Clicked outside map at (${q},${r})`);
      return;
    }
    console.log(
      `Hex (${q},${r}) type=${tile.type}, elev=${tile.elevation}, movementCost=${tile.movementCost}, feature=${tile.feature}`
    );
  }

  clearPathPreview() {
    if (this.pathPreviewTiles) {
      this.pathPreviewTiles.forEach(g => g.destroy());
      this.pathPreviewTiles = [];
    }
    if (this.pathPreviewLabels) {
      this.pathPreviewLabels.forEach(l => l.destroy());
      this.pathPreviewLabels = [];
    }
  }

  checkCombat(unit, destHex) {
    const enemy = this.enemies.find(e => e.q === destHex.q && e.r === destHex.r);
    if (!enemy) return false;

    console.log(
      `[COMBAT] ${unit.name} engages enemy at (${destHex.q},${destHex.r}) — TODO: enter combat scene.`
    );
    return true;
  }

  startStepMovement(unit, path, onComplete) {
    if (!path || path.length < 2) {
      if (onComplete) onComplete();
      return;
    }

    this.isUnitMoving = true;
    const scene = this;
    let index = 1; // start from second node

    function stepNext() {
      if (index >= path.length) {
        const last = path[path.length - 1];
        unit.q = last.q;
        unit.r = last.r;
        scene.isUnitMoving = false;
        scene.updateSelectionHighlight?.();   // keep highlight on the new hex
        if (onComplete) onComplete();
        return;
      }

      const step = path[index];
      const { x, y } = scene.axialToWorld(step.q, step.r);

      scene.tweens.add({
        targets: unit,
        x,
        y,
        duration: 160,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          index += 1;
          stepNext();
        }
      });
    }

    stepNext();
  }

  endTurn() {
    if (this.uiLocked) return;
    this.uiLocked = true;

    console.log(`[TURN] Ending turn for ${this.turnOwner} (Turn ${this.turnNumber})`);

    // 1) Ships (fish → docks)
    applyShipRoutesOnEndTurn(this);
    // 2) Ground haulers (basic docks ↔ base behavior)
    applyHaulerRoutesOnEndTurn(this);
    // 3) Buildings logistics (e.g. Mines produce scrap into local storage)
    applyLogisticsOnEndTurn(this);
    // 4) Factorio-style logistics routes (haulers with custom logisticsRoute)
    applyLogisticsRoutesOnEndTurn(this);

    this.moveEnemies();

    const idx = this.players.findIndex(p => p.name === this.turnOwner);
    const nextIdx = (idx + 1) % this.players.length;
    this.turnOwner = this.players[nextIdx].name;
    this.turnNumber += 1;

    console.log(`[TURN] New turn owner: ${this.turnOwner} (Turn ${this.turnNumber})`);

    updateTurnText(this, this.turnOwner);
    this.printTurnSummary?.();

    this.uiLocked = false;
  }

  moveEnemies() {
    if (!this.enemies || this.enemies.length === 0) return;

    this.enemies.forEach(enemy => {
      const dirsEven = [
        { dq: +1, dr: 0 }, { dq: 0, dr: -1 }, { dq: -1, dr: -1 },
        { dq: -1, dr: 0 }, { dq: -1, dr: +1 }, { dq: 0, dr: +1 },
      ];
      const dirsOdd = [
        { dq: +1, dr: 0 }, { dq: +1, dr: -1 }, { dq: 0, dr: -1 },
        { dq: -1, dr: 0 }, { dq: 0, dr: +1 }, { dq: +1, dr: +1 },
      ];
      const dirs = (enemy.r & 1) ? dirsOdd : dirsEven;

      Phaser.Utils.Array.Shuffle(dirs);

      for (const d of dirs) {
        const nq = enemy.q + d.dq;
        const nr = enemy.r + d.dr;
        if (nq < 0 || nr < 0 || nq >= this.mapWidth || nr >= this.mapHeight) continue;
        const tile = getTile(this, nq, nr);
        if (tile && !['water', 'mountain'].includes(tile.type)) {
          const { x, y } = this.axialToWorld(nq, nr);
          enemy.setPosition(x, y);
          enemy.q = nq;
          enemy.r = nr;
          break;
        }
      }
    });
  }
}

/* =========================================================
   Helpers defined outside the class
   ========================================================= */

// Wrapper to use shared A* pathfinding logic (kept for compatibility)
function computePathWithAStar(unit, targetHex, mapData, blockedPred) {
  const start = { q: unit.q, r: unit.r };
  const goal = { q: targetHex.q, r: targetHex.r };

  if (start.q === goal.q && start.r === goal.r) {
    return [start];
  }

  const isBlocked = tile => {
    if (!tile) return true;
    return blockedPred ? blockedPred(tile) : false;
  };

  return aStarFindPath(start, goal, mapData, isBlocked);
}

WorldScene.prototype.setSelectedUnit = function (unit) {
  this.selectedUnit = unit;
  this.updateSelectionHighlight?.();

  if (unit) {
    // Open the root menu when a unit is selected
    this.openRootUnitMenu?.(unit);
  } else {
    // Close menus when nothing is selected
    this.closeAllMenus?.();
  }
};

WorldScene.prototype.toggleSelectedUnitAtHex = function (q, r) {
  // If the same unit is already selected – deselect it
  if (this.selectedUnit && this.selectedUnit.q === q && this.selectedUnit.r === r) {
    this.setSelectedUnit(null);
    return;
  }

  // Find a unit/hauler on this hex
  const unit =
    (this.players || []).find(u => u.q === q && u.r === r) ||
    (this.haulers || []).find(h => h.q === q && h.r === r);

  this.setSelectedUnit(unit || null);
};

WorldScene.prototype.printTurnSummary = function () {
  console.log(`[WORLD] Turn ${this.turnNumber} – Current player: ${this.turnOwner}`);
};
