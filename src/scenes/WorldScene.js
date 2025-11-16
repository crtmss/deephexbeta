// src/scenes/WorldScene.js
import HexMap from '../engine/HexMap.js';
import { findPath as aStarFindPath } from '../engine/AStar.js';
import { drawLocationsAndRoads } from './WorldSceneMapLocations.js';

import {
  startDocksPlacement,
  placeDocks,
  cancelPlacement,
} from './WorldSceneBuildings.js';

import {
  applyShipRoutesOnEndTurn,
  applyHaulerBehaviorOnEndTurn as applyHaulerRoutesOnEndTurn,
  buildHaulerAtSelectedUnit,
  enterHaulerRoutePicker,
} from './WorldSceneHaulers.js';

// ⬇️ NEW: use the actual exports from WorldSceneUI.js
import { setupTurnUI, updateTurnText } from './WorldSceneUI.js';

import { spawnUnitsAndEnemies } from './WorldSceneUnits.js';
import { spawnFishResources } from './WorldSceneResources.js';

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

    // ⬇️ NEW: helpers for WorldSceneMapLocations & others that expect scene.hexToPixel / scene.pixelToHex
    this.hexToPixel = (q, r) => hexToPixel(q, r, this.hexSize);
    this.pixelToHex = (x, y) => pixelToHex(x, y, this.hexSize);

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

    const { seed, playerName, roomCode, isHost, supabase } = this.scene.settings.data || {};
    this.seed = seed || 'default-seed';
    this.playerName = playerName;
    this.roomCode = roomCode;
    this.isHost = isHost;
    this.supabase = supabase;

    this.turnOwner = null;
    this.turnNumber = 1;

    // --- map generation: robust mapInfo so .tiles / .objects never crash ---
    this.hexMap = new HexMap(this.mapWidth, this.mapHeight, this.seed);
    let mapInfo = this.hexMap.generateMap && this.hexMap.generateMap();

    if (Array.isArray(mapInfo)) {
      mapInfo = {
        tiles: mapInfo,
        objects: this.hexMap.objects || [],
      };
    } else if (!mapInfo || !Array.isArray(mapInfo.tiles)) {
      mapInfo = {
        tiles: this.hexMap.tiles || [],
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
    // ----------------------------------------------------------------------

    drawHexMap(this);

    drawLocationsAndRoads(this, this.mapData);
    spawnFishResources(this);

    spawnUnitsAndEnemies(this, { mapWidth: this.mapWidth, mapHeight: this.mapHeight });

    this.players = this.units.filter(u => u.isPlayer);
    this.enemies = this.units.filter(u => u.isEnemy);

    this.turnOwner = this.players[0]?.name || null;

    // ⬇️ REPLACED: setupWorldSceneUI(this);
    setupTurnUI(this);
    if (this.turnOwner) {
      updateTurnText(this, this.turnOwner);
    }

    this.addWorldMetaBadge();

    // ❌ Do NOT call setupCameraControls -> no camera pan/zoom
    // setupCameraControls(this);

    this.setupInputHandlers?.();

    if (this.supabase) {
      this.syncPlayerMove = async unit => {
        const res = await this.supabase.from('lobbies').select('state').eq('room_code', this.roomCode).single();
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
    return (players[(idx + 1) % players.length]).name;
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
    const x = 10;
    const y = 10;

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
    return { x, y };
  }

  worldToAxial(x, y) {
    const size = this.hexSize;
    const { q, r } = pixelToHex(x, y, size);
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

    console.log(`[COMBAT] ${unit.name} engages enemy at (${destHex.q},${destHex.r}) — TODO: enter combat scene.`);
    return true;
  }

  startStepMovement(unit, path, onComplete) {
    if (!path || path.length < 2) {
      if (onComplete) onComplete();
      return;
    }

    this.isUnitMoving = true;

    const tweens = [];
    for (let i = 1; i < path.length; i++) {
      const step = path[i];
      const { x, y } = this.axialToWorld(step.q, step.r);
      tweens.push({
        targets: unit,
        x,
        y,
        duration: 160,
        ease: 'Sine.easeInOut',
      });
    }

    this.tweens.timeline({
      tweens,
      onComplete: () => {
        const last = path[path.length - 1];
        unit.q = last.q;
        unit.r = last.r;
        this.isUnitMoving = false;
        if (onComplete) onComplete();
      },
    });
  }

  endTurn() {
    if (this.uiLocked) return;
    this.uiLocked = true;

    console.log(`[TURN] Ending turn for ${this.turnOwner} (Turn ${this.turnNumber})`);

    applyShipRoutesOnEndTurn(this);
    applyHaulerRoutesOnEndTurn(this);

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

// Wrapper to use shared A* pathfinding logic
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

/**
 * Hook up pointer input for selecting units, tiles, and plotting paths.
 */
WorldScene.prototype.setupInputHandlers = function () {
  const scene = this;

  this.input.on('pointerdown', pointer => {
    if (scene.isDragging) return;

    const worldPoint = pointer.positionToCamera(scene.cameras.main);
    const rounded = scene.worldToAxial(worldPoint.x, worldPoint.y);

    if (rounded.q < 0 || rounded.r < 0 || rounded.q >= scene.mapWidth || rounded.r >= scene.mapHeight) return;

    const clickedUnit =
      scene.units.find(u => u.q === rounded.q && u.r === rounded.r && u.isPlayer) ||
      scene.haulers?.find?.(h => h.q === rounded.q && h.r === rounded.r);

    if (clickedUnit) {
      scene.selectedUnit = clickedUnit;
      scene.showUnitPanel?.(clickedUnit);
      scene.clearPathPreview();
      scene.selectedHex = null;
      scene.debugHex(rounded.q, rounded.r);
      return;
    }

    const tile = getTile(scene, rounded.q, rounded.r);
    if (tile && tile.isLocation) {
      console.log(`[LOCATION] Clicked on location: ${tile.locationType || 'Unknown'} at (${rounded.q},${rounded.r})`);
    }

    scene.selectedHex = rounded;
    scene.debugHex(rounded.q, rounded.r);

    if (scene.selectedUnit) {
      if (scene.selectedUnit.q === rounded.q && scene.selectedUnit.r === rounded.r) {
        scene.selectedUnit = null;
        scene.hideUnitPanel?.();
        scene.clearPathPreview();
      } else {
        const blocked = t => !t || t.type === 'water' || t.type === 'mountain';
        const fullPath = computePathWithAStar(scene.selectedUnit, rounded, scene.mapData, blocked);
        if (fullPath && fullPath.length > 1) {
          let movementPoints = scene.selectedUnit.movementPoints || 4;
          const trimmedPath = [];
          let costSum = 0;
          for (let i = 0; i < fullPath.length; i++) {
            const step = fullPath[i];
            const tile2 = getTile(scene, step.q, step.r);
            const cost = tile2?.movementCost || 1;
            if (i > 0 && costSum + cost > movementPoints) break;
            trimmedPath.push(step);
            if (i > 0) costSum += cost;
          }

          if (trimmedPath.length > 1) {
            console.log('[MOVE] Committing move along path:', trimmedPath);
            scene.startStepMovement(scene.selectedUnit, trimmedPath, () => {
              if (scene.checkCombat(scene.selectedUnit, trimmedPath[trimmedPath.length - 1])) {
                scene.scene.start('CombatScene', {
                  seed: scene.seed,
                  playerUnit: scene.selectedUnit,
                });
              } else {
                scene.syncPlayerMove?.(scene.selectedUnit);
              }
            });
          }
        }
      }
    }
  });

  this.input.on('pointermove', pointer => {
    if (scene.isDragging) return;
    if (!scene.selectedUnit || scene.isUnitMoving) return;

    const worldPoint = pointer.positionToCamera(scene.cameras.main);
    const rounded = scene.worldToAxial(worldPoint.x, worldPoint.y);

    if (rounded.q < 0 || rounded.r < 0 || rounded.q >= scene.mapWidth || rounded.r >= scene.mapHeight) {
      scene.clearPathPreview();
      return;
    }

    const blocked = t => !t || t.type === 'water' || t.type === 'mountain';
    const path = computePathWithAStar(scene.selectedUnit, rounded, scene.mapData, blocked);

    scene.clearPathPreview();
    if (path && path.length > 1) {
      let movementPoints = scene.selectedUnit.movementPoints || 4;
      let costSum = 0;
      const maxPath = [];

      for (let i = 0; i < path.length; i++) {
        const step = path[i];
        const tile = getTile(scene, step.q, step.r);
        const cost = tile?.movementCost || 1;

        if (i > 0 && costSum + cost > movementPoints) break;
        maxPath.push(step);
        if (i > 0) costSum += cost;
      }

      const graphics = scene.add.graphics();
      graphics.lineStyle(2, 0x64ffda, 0.9);
      graphics.setDepth(50);

      for (let i = 0; i < maxPath.length - 1; i++) {
        const a = maxPath[i];
        const b = maxPath[i + 1];
        const wa = scene.axialToWorld(a.q, a.r);
        const wb = scene.axialToWorld(b.q, b.r);
        graphics.beginPath();
        graphics.moveTo(wa.x, wa.y);
        graphics.lineTo(wb.x, wb.y);
        graphics.strokePath();
      }

      scene.pathPreviewTiles.push(graphics);

      const baseColor = '#e8f6ff';
      const outOfRangeColor = '#ff7b7b';
      costSum = 0;
      for (let i = 0; i < maxPath.length; i++) {
        const step = maxPath[i];
        const tile = getTile(scene, step.q, step.r);
        const cost = tile?.movementCost || 1;
        if (i > 0) costSum += cost;
        const { x, y } = scene.axialToWorld(step.q, step.r);
        const labelColor = costSum <= movementPoints ? baseColor : outOfRangeColor;
        const label = scene.add.text(x, y, `${costSum}`, {
          fontSize: '10px',
          color: labelColor,
          fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(51);
        scene.pathPreviewLabels.push(label);
      }
    }
  });

  this.input.on('pointerout', () => {
    scene.clearPathPreview();
  });
};

WorldScene.prototype.printTurnSummary = function () {
  console.log(`[WORLD] Turn ${this.turnNumber} – Current player: ${this.turnOwner}`);
};

// Kept for compatibility; WorldSceneUI may override these with unitActionPanel API
WorldScene.prototype.showUnitPanel = function (unit) {
  if (!this.unitPanel) return;
  this.unitPanel.setVisible(true);
};

WorldScene.prototype.hideUnitPanel = function () {
  if (!this.unitPanel) return;
  this.unitPanel.setVisible(false);
};
