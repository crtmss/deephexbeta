// src/scenes/WorldScene.js
import HexMap from '../engine/HexMap.js';
import { findPath as aStarFindPath } from '../engine/AStar.js';
import { drawLocationsAndRoads } from './WorldSceneMapLocations.js';
import { setupWorldMenus, attachSelectionHighlight } from './WorldSceneMenus.js';
import { startHexTransformTool } from './HexTransformTool.js';
import { setupBuildingsUI } from './WorldSceneBuildingsUI.js';

// Haulers / ships
import {
  applyShipRoutesOnEndTurn,
  applyHaulerBehaviorOnEndTurn as applyHaulerRoutesOnEndTurn,
} from './WorldSceneHaulers.js';

// Logistics (buildings + routes)
import {
  setupLogisticsPanel,
  applyLogisticsOnEndTurn,
} from './WorldSceneLogistics.js';
import { applyLogisticsRoutesOnEndTurn } from './WorldSceneLogisticsRuntime.js';

// UI (HUD, tabs, input)
import { setupTurnUI, updateTurnText, setupWorldInputUI } from './WorldSceneUI.js';

// Units / resources / map
import { spawnUnitsAndEnemies, updateUnitOrientation } from './WorldSceneUnits.js';
import { spawnFishResources, spawnCrudeOilResources } from './WorldSceneResources.js';
import {
  drawHexMap,
  hexToPixel,
  pixelToHex,
  roundHex,
  getColorForTerrain,
  isoOffset,
  LIFT_PER_LVL,
} from './WorldSceneMap.js';

// Debug menu (hydrology controls)
import { initDebugMenu } from './WorldSceneDebug.js';

// NEW: History panel UI
import { setupHistoryUI } from './WorldSceneHistory.js';

// NEW: Electricity system (energy buildings & network)
import {
  initElectricityForScene,
  applyElectricityOnEndTurn,
} from './WorldSceneElectricity.js';

import { supabase as sharedSupabase } from '../net/SupabaseClient.js';

/* =========================
   Deterministic world summary (UI-only)
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
  const waterRatio    = 0.28 + (rng() - 0.5) * 0.08;
  const forestRatio   = 0.25 + (rng() - 0.5) * 0.10;
  const mountainRatio = 0.10 + (rng() - 0.5) * 0.05;

  const roughness    = 0.4 + rng() * 0.4;
  const elevationVar = 0.6 + rng() * 0.4;

  const geography = {
    waterTiles:    Math.round(totalTiles * waterRatio),
    forestTiles:   Math.round(totalTiles * forestRatio),
    mountainTiles: Math.round(totalTiles * mountainRatio),
    roughness:     +roughness.toFixed(2),
    elevationVar:  +elevationVar.toFixed(2),
  };

  const biomes = [];
  if (waterRatio > 0.3)        biomes.push('Archipelago');
  else if (waterRatio < 0.22)  biomes.push('Continental');

  if (forestRatio > 0.28)      biomes.push('Dense Forests');
  else if (forestRatio < 0.20) biomes.push('Sparse Forests');

  if (mountainRatio > 0.12) biomes.push('Mountainous');
  if (roughness > 0.6)      biomes.push('Rugged Terrain');
  if (elevationVar > 0.7)   biomes.push('High Elevation Contrast');

  const biome = biomes.length > 0 ? biomes.join(', ') : 'Mixed Terrain';
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
    // >>> keep 29x29 and hexSize from your previous version <<<
    this.hexSize = 22;
    this.mapWidth = 29;
    this.mapHeight = 29;

    this.input.setDefaultCursor('grab');
    this.isDragging = false;
    this.isUnitMoving = false;

    // Make elevation lift constant visible to map-location renderer
    this.LIFT_PER_LVL = LIFT_PER_LVL;

    // Hex transform tool (X key edits terrain and then calls scene.redrawWorld())
    startHexTransformTool(this, { defaultType: 'water', defaultLevel: 1 });

    // collections
    this.units = [];
    this.enemies = [];
    this.players = [];
    this.buildings = [];
    this.haulers = [];
    this.ships = [];
    this.resources = [];

    // NEW: history entries list for the History panel
    // Each entry: { year, text, type, q, r }
    this.historyEntries = [];

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

    this.seed = seed || '000000';
    this.playerName = playerName || 'Player';
    this.roomCode = roomCode || this.seed;
    this.isHost = !!isHost;

    // Prefer instance passed via scene.start, fallback to global shared supabase
    this.supabase = supabase || sharedSupabase || null;
    this.lobbyState = lobbyState || { units: {}, enemies: [] };

    this.turnOwner = null;
    this.turnNumber = 1;

    // Initial resources (kept in sync with Buildings / Haulers modules)
    this.playerResources = {
      food: 200,
      scrap: 200,
      money: 200,
      influence: 200,
    };

    // Global water level (1..7; tiles with baseElevation <= level are flooded)
    this.worldWaterLevel = 3;
    // keep simple alias used by other parts of the code (e.g. map renderer)
    this.waterLevel      = this.worldWaterLevel || 3;

    /* =========================
       Deterministic map generation
       ========================= */
    this.hexMap = new HexMap(this.mapWidth, this.mapHeight, this.seed);

    // HexMap.generateMap() returns either tiles[] or { tiles, objects }
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
    } else if (!Array.isArray(mapInfo.objects)) {
      mapInfo.objects = this.hexMap.objects || [];
    }

    // Store mapInfo so other systems (roads, POIs, resources) see the same data
    this.mapInfo = mapInfo;
    this.hexMap.mapInfo = mapInfo;
    this.mapData = mapInfo.tiles;

    // expose helpers; offset handling is centralized in axialToWorld/worldToAxial
    this.hexToPixel = (q, r, sizeOverride) =>
      hexToPixel(q, r, sizeOverride ?? this.hexSize);
    this.pixelToHex = (x, y, sizeOverride) =>
      pixelToHex(x, y, sizeOverride ?? this.hexSize);

    // =========================
    // Apply initial water level → sets tile.type from baseElevation/groundType
    // and draws terrain + POIs + roads + resources once.
    // =========================
    this.recomputeWaterFromLevel();

    // =========================
    // Electricity system (energy layer: solar, generators, batteries, grid)
    // =========================
    initElectricityForScene(this);

    /* =========================
       UNITS & ENEMIES SPAWN (multiplayer-aware)
       ========================= */
    await spawnUnitsAndEnemies.call(this);

    this.players = this.players && this.players.length
      ? this.players
      : this.units.filter(u => u.isPlayer);
    this.enemies = this.enemies && this.enemies.length
      ? this.enemies
      : this.units.filter(u => u.isEnemy);

    this.turnOwner =
      this.players[0]?.playerName ||
      this.players[0]?.name ||
      null;

    /* =========================
       UI: menus, buildings, logistics, HUD
       ========================= */
    attachSelectionHighlight(this);
    setupWorldMenus(this);
    setupBuildingsUI(this);
    setupTurnUI(this);
    setupLogisticsPanel(this);

    // NEW: History UI (panel to the left of resources panel)
    setupHistoryUI(this);

    if (this.turnOwner) {
      updateTurnText(this, this.turnOwner);
    }

    this.addWorldMetaBadge();

    // Input (selection + path preview + movement)
    setupWorldInputUI(this);

    // ---- Debug menu (top-center hydrology controls) ----
    initDebugMenu(this);

    /* =========================
       Supabase sync bridge stub
       ========================= */
    if (this.supabase && this.roomCode && this.playerName) {
      this.syncPlayerMove = async unit => {
        try {
          const res = await this.supabase
            .from('lobbies')
            .select('state')
            .eq('room_code', this.roomCode)
            .single();

          if (!res.data || !res.data.state || !Array.isArray(res.data.state.players)) return;

          const state = res.data.state;
          const nextPlayer = this.getNextPlayer(state.players, this.playerName);

          await this.supabase
            .from('lobbies')
            .update({
              state: {
                ...state,
                players: state.players.map(p =>
                  p === this.playerName || p?.name === this.playerName
                    ? { ...(typeof p === 'string' ? { name: p } : p), q: unit.q, r: unit.r }
                    : p
                ),
                currentTurn: nextPlayer,
              },
            })
            .eq('room_code', this.roomCode);
        } catch (err) {
          console.error('[Supabase syncPlayerMove] Error:', err);
        }
      };
    }

    this.printTurnSummary?.();
  }

  getNextPlayer(players, currentName) {
    if (!players || players.length === 0) return null;

    const norm = players.map(p => (typeof p === 'string' ? { name: p } : p));
    const idx = norm.findIndex(p => p.name === currentName);

    if (idx === -1) return norm[0].name;
    return norm[(idx + 1) % norm.length].name;
  }

  addWorldMetaBadge() {
    const { geography, biome } = getWorldSummaryForSeed(
      String(this.seed),
      this.mapWidth,
      this.mapHeight
    );

    const text = `Seed: ${this.seed}
Water: ~${geography.waterTiles}
Forest: ~${geography.forestTiles}
Mountains: ~${geography.mountainTiles}
Roughness: ${geography.roughness}
Elev.Var: ${geography.elevationVar}
Biomes: ${biome}`;

    const pad = { x: 8, y: 6 };

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
      `Hex (${q},${r}) type=${tile.type}, elev=${tile.elevation}, baseElev=${tile.baseElevation}, groundType=${tile.groundType}, isUnderWater=${tile.isUnderWater}, visualElevation=${tile.visualElevation}`
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
    let index = 1;

    function stepNext() {
      if (index >= path.length) {
        const last = path[path.length - 1];
        unit.q = last.q;
        unit.r = last.r;
        scene.isUnitMoving = false;
        scene.updateSelectionHighlight?.();
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
          const prevQ = unit.q;
          const prevR = unit.r;

          unit.q = step.q;
          unit.r = step.r;

          updateUnitOrientation(scene, unit, prevQ, prevR, unit.q, unit.r);

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

    applyShipRoutesOnEndTurn(this);
    applyHaulerRoutesOnEndTurn(this);
    applyLogisticsOnEndTurn(this);
    applyLogisticsRoutesOnEndTurn(this);

    // NEW: apply per-turn electricity (generation, consumption, storage, network)
    applyElectricityOnEndTurn(this);

    if (this.isHost) {
      this.moveEnemies();
    }

    const idx = this.players.findIndex(p =>
      p.playerName === this.turnOwner ||
      p.name === this.turnOwner
    );

    const nextIdx = idx === -1
      ? 0
      : (idx + 1) % this.players.length;

    const nextOwner =
      this.players[nextIdx].playerName ||
      this.players[nextIdx].name;

    this.turnOwner = nextOwner;
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

  recomputeWaterFromLevel() {
    if (!Array.isArray(this.mapData)) return;

    const lvlRaw = (typeof this.worldWaterLevel === 'number')
      ? this.worldWaterLevel
      : 3;
    const lvl = Math.max(0, Math.min(7, lvlRaw));
    this.worldWaterLevel = lvl;
    this.waterLevel      = lvl;   // keep in sync

    for (const t of this.mapData) {
      if (!t) continue;

      let base = (typeof t.baseElevation === 'number')
        ? t.baseElevation
        : (typeof t.elevation === 'number' ? t.elevation : 0);
      if (base <= 0) base = 1;
      t.baseElevation = base;
      t.elevation = base;

      if (!t.groundType) {
        if (t.type && t.type !== 'water') {
          t.groundType = t.type;
        } else {
          t.groundType = 'grassland';
        }
      }

      const under = (lvl > 0) && (base <= lvl);

      if (under) {
        t.type = 'water';
        t.isUnderWater = true;
        t.isWater = true;
        t.isCoveredByWater = true;

        let depth = base;
        if (depth < 1) depth = 1;
        if (depth > 3) depth = 3;
        t.waterDepth = depth;

        t.visualElevation = 0;
      } else {
        t.type = t.groundType || 'grassland';
        t.isUnderWater = false;
        t.isWater = false;
        t.isCoveredByWater = false;
        t.waterDepth = 0;

        const eff = base - lvl;
        t.visualElevation = eff > 0 ? eff : 0;
      }
    }

    this.redrawWorld();
  }

  redrawWorld() {
    drawHexMap.call(this);
    drawLocationsAndRoads.call(this);
    spawnFishResources.call(this);
    spawnCrudeOilResources.call(this);
  }
}

/* =========================================================
   Helpers defined outside the class
   ========================================================= */

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
    this.openRootUnitMenu?.(unit);
  } else {
    this.closeAllMenus?.();
  }
};

WorldScene.prototype.toggleSelectedUnitAtHex = function (q, r) {
  if (this.selectedUnit && this.selectedUnit.q === q && this.selectedUnit.r === r) {
    this.setSelectedUnit(null);
    return;
  }

  const unit =
    (this.players || []).find(u => u.q === q && u.r === r) ||
    (this.haulers || []).find(h => h.q === q && h.r === r);

  this.setSelectedUnit(unit || null);
};

WorldScene.prototype.printTurnSummary = function () {
  console.log(`[WORLD] Turn ${this.turnNumber} – Current player: ${this.turnOwner}`);
};

// NEW: add a history entry (ruins, etc.) and keep chronological order
WorldScene.prototype.addHistoryEntry = function (entry) {
  if (!this.historyEntries) this.historyEntries = [];
  this.historyEntries.push(entry);
  this.historyEntries.sort((a, b) => a.year - b.year);
  // If the History panel is open, let it refresh itself
  this.refreshHistoryPanel?.();
};

// NEW: simple year progression helper, starting at 5000
WorldScene.prototype.getNextHistoryYear = function () {
  const baseYear = 5000;
  if (!this.historyEntries || this.historyEntries.length === 0) {
    return baseYear;
  }
  const last = this.historyEntries[this.historyEntries.length - 1];
  return (typeof last.year === 'number' ? last.year : baseYear) + 3;
};
