// src/scenes/WorldSceneWorldMeta.js
// Merged: WorldMeta + Coords + Turn

// ====== WORLD META (deterministic summary) ======
function hashStr32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function xorshift32(seed) {
  let x = (seed || 1) >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17; x >>>= 0;
    x ^= x << 5;  x >>>= 0;
    return (x >>> 0) / 4294967296;
  };
}

export function getWorldSummaryForSeed(seedStr, width, height) {
  const seed = hashStr32(seedStr);
  const rng = xorshift32(seed);

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

// ====== COORDS HELPERS ======
import {
  hexToPixel,
  pixelToHex,
  roundHex,
  LIFT_PER_LVL,
  effectiveElevation
} from './WorldSceneMap.js';

export function getTile(scene, q, r) {
  return (scene.mapData || []).find(h => h.q === q && h.r === r);
}

/**
 * Axial -> world position, WITH elevation lift (must match map renderer).
 */
export function axialToWorld(scene, q, r) {
  const size = scene.hexSize;
  const base = hexToPixel(q, r, size);

  const ox = scene.mapOffsetX || 0;
  const oy = scene.mapOffsetY || 0;

  const tile = getTile(scene, q, r);

  const liftLvl =
    (typeof scene.LIFT_PER_LVL === 'number')
      ? scene.LIFT_PER_LVL
      : (typeof LIFT_PER_LVL === 'number' ? LIFT_PER_LVL : 4);

  const wl = (typeof scene?.waterLevel === 'number')
    ? scene.waterLevel
    : (typeof scene?.worldWaterLevel === 'number' ? scene.worldWaterLevel : undefined);

  const elev = tile ? effectiveElevation(tile, wl) : 0;

  return { x: base.x + ox, y: (base.y + oy) - liftLvl * elev };
}

/**
 * World -> axial, WITH elevation compensation.
 */
export function worldToAxial(scene, x, y) {
  const size = scene.hexSize;
  const ox = scene.mapOffsetX || 0;
  const oy = scene.mapOffsetY || 0;

  const liftLvl =
    (typeof scene.LIFT_PER_LVL === 'number')
      ? scene.LIFT_PER_LVL
      : (typeof LIFT_PER_LVL === 'number' ? LIFT_PER_LVL : 4);

  const px = x - ox;
  let { q, r } = pixelToHex(px, (y - oy), size);
  let rounded = roundHex(q, r);

  for (let i = 0; i < 2; i++) {
    const t = getTile(scene, rounded.q, rounded.r);

    const wl = (typeof scene?.waterLevel === 'number')
      ? scene.waterLevel
      : (typeof scene?.worldWaterLevel === 'number' ? scene.worldWaterLevel : undefined);

    const elev = t ? effectiveElevation(t, wl) : 0;
    const py2 = (y - oy) + liftLvl * elev;
    const hr = pixelToHex(px, py2, size);
    rounded = roundHex(hr.q, hr.r);
  }

  return rounded;
}

/**
 * Re-snap ALL in-world icons/containers to correct elevated positions.
 */
export function refreshAllIconWorldPositions(scene) {
  const snapObj = (obj) => {
    if (!obj || typeof obj.q !== 'number' || typeof obj.r !== 'number') return;
    const { x, y } = axialToWorld(scene, obj.q, obj.r);
    if (typeof obj.setPosition === 'function') obj.setPosition(x, y);
    else { obj.x = x; obj.y = y; }
  };

  (scene.units || []).forEach(snapObj);
  (scene.players || []).forEach(snapObj);
  (scene.enemies || []).forEach(snapObj);
  (scene.haulers || []).forEach(snapObj);
  (scene.ships || []).forEach(snapObj);

  (scene.buildings || []).forEach(b => {
    if (!b) return;

    if (b.container) {
      const { x, y } = axialToWorld(scene, b.q, b.r);
      b.container.setPosition(x, y);

      if (b.storageScrapLabel) {
        b.storageScrapLabel.setPosition(x + 16, y - 14);
      }
    }

    if (b.storageObj) snapObj(b.storageObj);
    if (b.routeMarker) snapObj(b.routeMarker);

    if (b.menu) {
      const { x, y } = axialToWorld(scene, b.q, b.r);
      b.menu.setPosition(x, y - 56);
    }
  });

  (scene.resources || []).forEach(snapObj);

  scene.clearPathPreview?.();
}

export function debugHex(scene, q, r) {
  const tile = getTile(scene, q, r);
  if (!tile) {
    console.log(`Clicked outside map at (${q},${r})`);
    return;
  }
  console.log(
    `Hex (${q},${r}) type=${tile.type}, elev=${tile.elevation}, baseElev=${tile.baseElevation}, groundType=${tile.groundType}, isUnderWater=${tile.isUnderWater}, visualElevation=${tile.visualElevation}`
  );
}

// ====== TURN HELPERS ======
import {
  applyShipRoutesOnEndTurn,
  applyHaulerBehaviorOnEndTurn as applyHaulerRoutesOnEndTurn,
} from './WorldSceneHaulers.js';

import { applyLogisticsOnEndTurn } from './WorldSceneLogistics.js';
import { applyLogisticsRoutesOnEndTurn } from './WorldSceneLogisticsRuntime.js';

import { updateTurnText } from './WorldSceneUI.js';

// Effects / Abilities (pure logic)
import { getAbilityDef } from '../abilities/AbilityDefs.js';
import {
  ensurePassiveEffects,
  tickUnitEffects,
  tickHexEffects,
  decrementUnitEffectDurations,
  decrementHexEffectDurations,
  cleanupExpiredUnitEffects,
  cleanupExpiredHexEffects,
} from '../effects/EffectEngine.js';
import { ensureUnitCombatFields } from '../units/UnitActions.js';
import { applyElectricityOnEndTurn } from './WorldSceneElectricity.js';

export function getNextPlayer(players, currentName) {
  if (!players || players.length === 0) return null;

  const norm = players.map(p => (typeof p === 'string' ? { name: p } : p));
  const idx = norm.findIndex(p => p.name === currentName);

  if (idx === -1) return norm[0].name;
  return norm[(idx + 1) % norm.length].name;
}

export function resetUnitsForNewTurn(scene) {
  const owner = scene.turnOwner || null;
  const all = []
    .concat(scene.units || [])
    .concat(scene.players || [])
    .concat(scene.enemies || []);

  for (const u of all) {
    if (!u || u.isDead) continue;
    ensureUnitCombatFields(u);

    const uOwner = u.playerName || u.name || null;

    // AI/enemies: always reset on their turn cycle
    if (u.isEnemy || u.controller === 'ai') {
      u.mp = u.mpMax;
      u.ap = u.apMax;
      u.tempArmorBonus = 0;
      if (u.status) {
        u.status.defending = false;
        u.status.attackedThisTurn = false;
      }
      if (Number.isFinite(u.movementPoints)) u.movementPoints = u.mp;
      continue;
    }

    // Player units: reset only for the active turn owner
    if (owner && uOwner === owner) {
      u.mp = u.mpMax;
      u.ap = u.apMax;
      u.tempArmorBonus = 0;
      if (u.status) {
        u.status.defending = false;
        u.status.attackedThisTurn = false;
      }
      if (Number.isFinite(u.movementPoints)) u.movementPoints = u.mp;
    }
  }

  scene.refreshUnitActionPanel?.();
}

export function endTurn(scene) {
  if (scene.uiLocked) return;
  scene.uiLocked = true;

  const prevOwner = scene.turnOwner;
  const prevTurnNumber = scene.turnNumber;

  console.log(`[TURN] Ending turn for ${scene.turnOwner} (Turn ${scene.turnNumber})`);

  // 1) Apply all "end of turn" systems for the CURRENT owner
  applyShipRoutesOnEndTurn(scene);
  applyHaulerRoutesOnEndTurn(scene);
  applyLogisticsOnEndTurn(scene);
  applyLogisticsRoutesOnEndTurn(scene);

  try {
    if (typeof applyElectricityOnEndTurn === 'function') {
      applyElectricityOnEndTurn(scene);
    } else if (
      scene.electricitySystem &&
      typeof scene.electricitySystem.applyElectricityOnEndTurn === 'function'
    ) {
      scene.electricitySystem.applyElectricityOnEndTurn(scene);
    } else if (
      scene.electricitySystem &&
      typeof scene.electricitySystem.tickElectricity === 'function'
    ) {
      scene.electricitySystem.tickElectricity(scene);
    }
  } catch (err) {
    console.error('[ENERGY] Error during end-turn electricity tick:', err);
  }

  // -------------------------------------------------------------------------
  // Effects pipeline (compact, high-signal logs via EffectEngine)
  // 1) Ensure passive effects exist (infinite duration) based on passive abilities
  // 2) Tick effects (turnEnd) for the side that is ENDING their turn
  // 3) Decrement durations and cleanup (1 decrement per player turn)
  // -------------------------------------------------------------------------

  try {
    const allUnits = ([])
      .concat(scene.units || [])
      .concat(scene.players || [])
      .concat(scene.enemies || [])
      .concat(scene.haulers || [])
      .concat(scene.ships || []);

    // Ensure passives exist (cheap)
    for (const u of allUnits) {
      if (!u) continue;
      ensurePassiveEffects(u, getAbilityDef);
    }

    // Tick unit effects
    for (const u of allUnits) {
      if (!u) continue;
      tickUnitEffects(u, 'turnEnd', {
        scene,
        turnOwner: prevOwner,
        turnNumber: prevTurnNumber,
      });
      decrementUnitEffectDurations(u);
      cleanupExpiredUnitEffects(u);
    }

    // Tick hex effects
    tickHexEffects(scene, 'turnEnd', {
      scene,
      turnOwner: prevOwner,
      turnNumber: prevTurnNumber,
    });
    decrementHexEffectDurations(scene);
    cleanupExpiredHexEffects(scene);
  } catch (e) {
    console.warn('[EFF] endTurn pipeline failed:', e);
  }

  // 2) Advance to next owner FIRST (so that "resetUnitsForNewTurn" applies to the correct side)
  const playersArr = scene.players || [];
  const idx = playersArr.findIndex(p =>
    (typeof p === 'string' ? p : (p.playerName || p.name)) === scene.turnOwner
  );

  const nextIdx =
    (idx === -1) ? 0 : ((idx + 1) % Math.max(1, playersArr.length));

  const pNext = playersArr[nextIdx];
  const nextOwner =
    (typeof pNext === 'string')
      ? pNext
      : (pNext?.playerName || pNext?.name || scene.turnOwner);

  scene.turnOwner = nextOwner;
  scene.turnNumber += 1;

  console.log(`[TURN] New turn owner: ${scene.turnOwner} (Turn ${scene.turnNumber})`);

  updateTurnText(scene, scene.turnNumber);

  // 3) Now reset MP/AP for the NEW owner
  resetUnitsForNewTurn(scene);

  // Turn-start tick (does not decrement durations)
  try {
    const allUnits = ([])
      .concat(scene.units || [])
      .concat(scene.players || [])
      .concat(scene.enemies || [])
      .concat(scene.haulers || [])
      .concat(scene.ships || []);

    for (const u of allUnits) {
      if (!u) continue;
      tickUnitEffects(u, 'turnStart', {
        scene,
        turnOwner: scene.turnOwner,
        turnNumber: scene.turnNumber,
      });
    }
    tickHexEffects(scene, 'turnStart', {
      scene,
      turnOwner: scene.turnOwner,
      turnNumber: scene.turnNumber,
    });
  } catch (e) {
    console.warn('[EFF] turnStart tick failed:', e);
  }

  // 4) AI acts on its turn AFTER it has been reset
  // (This keeps "AI ALWAYS ACTS AFTER PLAYER TURN" behavior, but correctly aligned with turnOwner.)
  if (scene.moveEnemies) {
    console.log('[AI] Executing AI turn');
    scene.moveEnemies();
  }

  scene.printTurnSummary?.();
  scene.refreshUnitActionPanel?.();

  scene.uiLocked = false;
}
