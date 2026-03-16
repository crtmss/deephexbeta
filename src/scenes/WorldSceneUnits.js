// src/scenes/WorldSceneUnits.js
//
// Spawning players & enemies + orientation helpers.
// Bridge between "abstract game state" (lobby / seed)
// and concrete Phaser units on the map.

import { getLobbyState } from '../net/LobbyManager.js';
// Stage A unit stats infrastructure (pure logic + backwards compatible fields)
import { createUnitState, applyUnitStateToPhaserUnit } from '../units/UnitFactory.js';
import { getUnitDef } from '../units/UnitDefs.js';

// Basic visual / model constants
const UNIT_Z = {
  player: 2000,
  enemy:  2000,
  building: 1500, // Raider Camp marker
};


// Badge sprite offset tuning (DashFrameForUnits.png is a right-pointing drop).
// We shift the whole badge so the circular head is centered on the hex and the top isn't visually clipped.
const UNIT_BADGE_OFFSET_X_RATIO = 0.14; // ~14% of frameSize
const UNIT_BADGE_OFFSET_Y_RATIO = 0.06; // ~6% of frameSize
// 4 player colors (slots 0..3)
const PLAYER_COLORS = [
  0xff4b4b, // P1 - red
  0x4bc0ff, // P2 - blue
  0x54ff9b, // P3 - green
  0xffe14b, // P4 - yellow
];

// 2 AI colors (max 2 factions AI)
const AI_COLORS = [
  0xaa66ff, // AI0 - purple
  0x5e5ce6, // AI1 - indigo
];

// Border + neutral
const UNIT_BORDER_COLOR = 0x0b1d2a;
const UNIT_NEUTRAL_BG   = 0x9aa0a6;

/**
 * Owner key normalization:
 * - players are numeric slots 0..3
 * - AI are 'ai0' or 'ai1'
 */
function normalizeOwnerKey(ownerKey, fallback) {
  if (ownerKey === null || ownerKey === undefined) return fallback;
  if (typeof ownerKey === 'number') return ownerKey;
  const s = String(ownerKey).toLowerCase();
  if (s === 'ai0' || s === 'ai1') return s;
  // if someone passes 'ai' -> default ai0
  if (s === 'ai') return 'ai0';
  // fallback to numeric parse if possible
  const n = Number(ownerKey);
  if (Number.isFinite(n)) return n;
  return fallback;
}

/**
 * Resolve badge fill color for units (6 total):
 * - 4 players (0..3)
 * - 2 AI ('ai0','ai1')
 */
function colorForOwner(ownerKey) {
  const k = normalizeOwnerKey(ownerKey, null);
  if (k === null) return UNIT_NEUTRAL_BG;
  if (k === 'ai0') return AI_COLORS[0];
  if (k === 'ai1') return AI_COLORS[1];
  if (typeof k === 'number') return PLAYER_COLORS[((k % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length];
  return UNIT_NEUTRAL_BG;
}

// NEW: combat unit colors (tint derived from owner slot)
function colorForSlot(slot) {
  return colorForOwner(slot);
}

// Small axial helpers (odd-r)
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]]
    : [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]];
}

function keyOf(q, r) {
  return q + ',' + r;
}

function axialDistance(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function getTile(scene, q, r) {
  return (scene.mapData || []).find(t => t && t.q === q && t.r === r) || null;
}

/**
 * Single source of truth for "land" tiles.
 * Units may spawn ONLY on land:
 * - not water
 * - not mountain
 * - not under water / covered by water flags (some maps keep groundType but are flooded)
 */
function isLandTile(t) {
  if (!t) return false;

  // Primary type check
  if (t.type === 'water' || t.type === 'mountain') return false;

  // Flood flags (important!)
  if (t.isUnderWater === true) return false;
  if (t.isWater === true) return false;
  if (t.isCoveredByWater === true) return false;

  // Some generators keep groundType='mountain' but type differs
  if (t.groundType === 'mountain') return false;

  return true;
}

/**
 * Robust occupancy check across all unit arrays + buildings.
 */
function isOccupied(scene, q, r) {
  const all = []
    .concat(scene.units || [])
    .concat(scene.players || [])
    .concat(scene.enemies || [])
    .concat(scene.haulers || []);

  if (all.find(u => u && !u.isDead && u.q === q && u.r === r)) return true;

  // Buildings occupy a hex too (camp must not overlap)
  const buildings = (scene.buildings || []);
  if (buildings.find(b => b && typeof b.q === 'number' && typeof b.r === 'number' && b.q === q && b.r === r)) return true;

  return false;
}

function isBlockedForUnit(scene, q, r) {
  const t = getTile(scene, q, r);
  if (!isLandTile(t)) return true;

  // No stacking: any unit or building occupying blocks
  return isOccupied(scene, q, r);
}

function findFreeNeighbor(scene, q, r) {
  for (const [dq, dr] of neighborsOddR(q, r)) {
    const nq = q + dq;
    const nr = r + dr;
    if (nq < 0 || nr < 0 || nq >= (scene.mapWidth || 0) || nr >= (scene.mapHeight || 0)) continue;
    if (!isBlockedForUnit(scene, nq, nr)) return { q: nq, r: nr };
  }
  return null;
}

/**
 * Pick up to N reasonably spaced spawn tiles on land.
 * Deterministic (only depends on the map), so all clients
 * with the same seed and map will pick the same positions.
 */
function pickSpawnTiles(scene, count) {
  const map = scene.mapData || [];
  if (!map.length) return [];

  // land = ONLY tiles that pass isLandTile()
  const land = map.filter(isLandTile);
  if (!land.length) return [];

  const w = scene.mapWidth || 25;
  const h = scene.mapHeight || 25;

  const cx = w / 2;
  const cy = h / 2;

  // score tiles by angle sector + distance
  const tilesWithMeta = land.map(t => {
    const dx = t.q - cx;
    const dy = t.r - cy;
    const angle = Math.atan2(dy, dx); // -PI..PI
    const dist2 = dx * dx + dy * dy;
    return { tile: t, angle, dist2 };
  });

  // Split map into angular sectors and pick best from each
  const sectors = Math.max(1, count);
  const buckets = Array.from({ length: sectors }, () => []);

  tilesWithMeta.forEach(entry => {
    let a = entry.angle;
    if (a < 0) a += Math.PI * 2;
    const idx = Math.floor((a / (Math.PI * 2)) * sectors) % sectors;
    buckets[idx].push(entry);
  });

  const result = [];
  for (let i = 0; i < sectors; i++) {
    const bucket = buckets[i];
    if (!bucket.length) continue;
    // prefer tiles a bit away from center (larger dist2)
    bucket.sort((a, b) => b.dist2 - a.dist2);
    result.push(bucket[0].tile);
    if (result.length >= count) break;
  }

  // Fallback if not enough unique buckets
  let idx = 0;
  while (result.length < count && idx < land.length) {
    const candidate = land[idx++];
    if (result.indexOf(candidate) === -1) result.push(candidate);
  }

  return result.slice(0, count);
}

/* ======================================================================
   NEW: Unit badge visuals (directional background + non-rotating icon)
   - Background rotates to show facing
   - Icon NEVER rotates
   - Background fill color = owner color (player slot or ai0/ai1)
   ====================================================================== */

/**
 * Create a "directional badge" (like your unit mock):
 * - circular/rounded body
 * - sharp nose indicating direction (default points RIGHT)
 * Returns:
 *  { cont, bg, icon }
 *
 * Notes:
 * - cont is positioned at hex center
 * - bg is a Graphics object; rotate THIS for facing
 * - icon is Text; do not rotate
 */
function createDirectionalUnitBadge(scene, x, y, ownerKey, iconText, sizePx, depth) {
  const fill = colorForOwner(ownerKey);
  const s = Math.max(18, Math.round(sizePx || 28));

  // Sprite frame (authored as a square). We scale it up by +30% as requested.
  const FRAME_KEY = 'dashFrameForUnits';
  const FRAME_URL = 'src/assets/sprites/DashFrameForUnits.png';
  const scaleMul = 1.30;

  // Keep the sprite square to avoid squishing.
  const frameSize = Math.round(s * scaleMul);

  // Offset whole badge so the circular head is centered on the hex and the top isn't clipped.
  const offX = Math.round(frameSize * UNIT_BADGE_OFFSET_X_RATIO);
  const offY = Math.round(frameSize * UNIT_BADGE_OFFSET_Y_RATIO);

  const cont = scene.add.container(Math.round(x + offX), Math.round(y + offY)).setDepth(depth ?? UNIT_Z.player);

  // Ensure texture is queued for loading exactly once.
  if (scene.textures && !scene.textures.exists(FRAME_KEY) && scene.load && !scene._dashFrameForUnitsQueued) {
    scene._dashFrameForUnitsQueued = true;

    // Helpful diagnostics if path is wrong.
    if (!scene._dashFrameForUnitsLoadDiagHooked && scene.load.on) {
      scene._dashFrameForUnitsLoadDiagHooked = true;
      scene.load.on('loaderror', (file) => {
        try {
          if (file && file.key === FRAME_KEY) {
            // eslint-disable-next-line no-console
            console.warn('[DashFrameForUnits] loaderror', file.src || file.url || file);
          }
        } catch (_) {}
      });
    }

    scene.load.image(FRAME_KEY, FRAME_URL);
    scene.load.once('complete', () => scene.events.emit('dashFrameForUnitsLoaded'));
    if (typeof scene.load.start === 'function') scene.load.start();
  }

  // Background (direction indicator) - sprite, tinted.
  let bg = null;
  if (scene.textures && scene.textures.exists(FRAME_KEY)) {
    bg = scene.add.image(0, 0, FRAME_KEY).setOrigin(0.5);
    bg.setDisplaySize(frameSize, frameSize);
    bg.setTint(fill);
    cont.add(bg);
  } else {
    // If not loaded yet, swap-in when loaded.
    scene.events.once('dashFrameForUnitsLoaded', () => {
      if (!cont.scene) return;
      if (!(scene.textures && scene.textures.exists(FRAME_KEY))) return;
      const img = scene.add.image(0, 0, FRAME_KEY).setOrigin(0.5);
      img.setDisplaySize(frameSize, frameSize);
      img.setTint(colorForOwner(ownerKey));
      cont.addAt(img, 0);
      cont._dirBg = img;
    });
  }

  // Icon above background
  const icon = scene.add.text(0, 0, iconText, {
    fontFamily: 'Arial',
    fontSize: `${Math.max(12, Math.round(s * 0.55))}px`,
    color: '#ffffff',
    stroke: '#0b0b0b',
    strokeThickness: 3,
  }).setOrigin(0.5);

  cont.add(icon);

  cont._dirBg = bg;
  cont._unitIcon = icon;
  cont._ownerKey = ownerKey;

  cont.setOwnerKey = (newOwnerKey) => {
    cont._ownerKey = newOwnerKey;
    const newFill = colorForOwner(newOwnerKey);
    if (cont._dirBg && typeof cont._dirBg.setTint === 'function') cont._dirBg.setTint(newFill);
  };

  return { cont, bg, icon };
}

/**
 * Creates a mobile base unit (player "king" piece).
 *
 * Now uses a directional badge (icon 🏠), with owner color background.
 */
function createMobileBase(scene, spawnTile, player, _color, playerIndex) {
  const pos = scene.axialToWorld(spawnTile.q, spawnTile.r);

  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;
  const s = Math.max(26, Math.round(size * 1.35));

  const ownerKey = (typeof playerIndex === 'number') ? playerIndex : 0;

  const { cont } = createDirectionalUnitBadge(
    scene,
    pos.x,
    pos.y,
    ownerKey,
    '🏠',
    s,
    UNIT_Z.player
  );

  const unit = cont;

  unit.q = spawnTile.q;
  unit.r = spawnTile.r;

  unit.type = 'mobile_base';
  unit.isPlayer = true;
  unit.isEnemy = false;

  unit.playerId = player.id || null;
  unit.playerName = player.name || 'Player';
  unit.name = unit.playerName;
  unit.playerIndex = playerIndex; // slot index 0..3

  const def = getUnitDef('mobile_base');
  const st = createUnitState({
    type: 'mobile_base',
    ownerId: unit.playerId,
    ownerSlot: playerIndex,
    controller: 'player',
    faction: `player${(typeof playerIndex === 'number' ? playerIndex : 0)}`,
    q: spawnTile.q,
    r: spawnTile.r,
    facing: 0,
  });
  unit.unitName = def.name;
  applyUnitStateToPhaserUnit(unit, st);
  unit.faction = st.faction;

  unit.facingAngle = 0;

  // Keep a stable id for selection systems
  if (!unit.id && !unit.unitId) {
    unit.id = `mb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }

  return unit;
}

/**
 * Creates a Transporter.
 *
 * ✅ NEW: Uses directional badge, icon 📦, icon stays upright.
 */
function createTransporter(scene, q, r, ownerLike) {
  const pos = scene.axialToWorld(q, r);

  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;
  const s = Math.max(24, Math.round(size * 1.20));

  const ownerSlot = Number.isFinite(ownerLike?.playerIndex)
    ? ownerLike.playerIndex
    : (Number.isFinite(ownerLike?.ownerSlot) ? ownerLike.ownerSlot : 0);

  const { cont } = createDirectionalUnitBadge(
    scene,
    pos.x,
    pos.y,
    ownerSlot,
    '📦',
    s,
    UNIT_Z.player
  );

  const unit = cont;

  unit.q = q;
  unit.r = r;

  unit.type = 'transporter';
  unit.isPlayer = true;
  unit.isEnemy = false;

  unit.playerId = ownerLike?.playerId || null;
  unit.playerName = ownerLike?.playerName || ownerLike?.name || 'Player';
  unit.name = unit.playerName;
  unit.playerIndex = ownerSlot;

  const def = getUnitDef('transporter');
  const st = createUnitState({
    type: 'transporter',
    ownerId: unit.playerId,
    ownerSlot,
    controller: 'player',
    faction: `player${ownerSlot}`,
    q, r,
    facing: 0,
  });
  unit.unitName = def.name;
  applyUnitStateToPhaserUnit(unit, st);
  unit.faction = st.faction;

  unit.facingAngle = 0;

  if (!unit.id && !unit.unitId) {
    unit.id = `tr_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }

  return unit;
}

/**
 * Creates a Raider.
 * If controller='ai', unit is enemy.
 *
 * ✅ NEW: Raider is a badge with a knife icon, icon does not rotate.
 * Background rotates for facing.
 */
function createRaider(scene, q, r, opts = {}) {
  const controller = opts.controller || 'player';
  const pos = scene.axialToWorld(q, r);

  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;
  const s = Math.max(24, Math.round(size * 1.20));

  // owner key:
  // - player uses numeric slot
  // - AI uses 'ai0' or 'ai1' (default ai0)
  const ownerKey = (controller === 'ai')
    ? normalizeOwnerKey(opts.ownerKey ?? opts.aiKey ?? 'ai0', 'ai0')
    : normalizeOwnerKey(opts.ownerSlot ?? 0, 0);

  const { cont } = createDirectionalUnitBadge(
    scene,
    pos.x,
    pos.y,
    ownerKey,
    '🔪',
    s,
    controller === 'ai' ? UNIT_Z.enemy : UNIT_Z.player
  );

  const unit = cont;

  unit.q = q;
  unit.r = r;

  unit.type = 'raider';
  unit.isEnemy = controller === 'ai';
  unit.isPlayer = controller !== 'ai';

  if (controller === 'ai') {
    unit.controller = 'ai';
    unit.aiFaction = String(opts.aiFaction || ownerKey || 'ai0');
    unit.name = String(opts.name || unit.aiFaction);
  } else {
    unit.controller = 'player';
    unit.playerId = opts.playerId || null;
    unit.playerName = opts.playerName || 'Player';
    unit.name = unit.playerName;
    unit.playerIndex = Number.isFinite(opts.ownerSlot) ? opts.ownerSlot : 0;
  }

  const st = createUnitState({
    type: 'raider',
    ownerId: unit.playerId ?? null,
    ownerSlot: (controller === 'ai') ? null : unit.playerIndex,
    controller,
    faction: (controller === 'ai') ? String(opts.aiFaction || ownerKey || 'ai0') : `player${unit.playerIndex || 0}`,
    q,
    r,
    facing: 0,
  });

  unit.unitName = getUnitDef('raider').name;
  applyUnitStateToPhaserUnit(unit, st);
  unit.faction = st.faction;

  unit.facingAngle = 0;

  // Keep stable id
  if (!unit.id && !unit.unitId) {
    unit.id = `${controller === 'ai' ? 'er' : 'r'}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }

  return unit;
}

export function updateUnitOrientation(scene, unit, fromQ, fromR, toQ, toR) {
  if (!unit) return;

  const from = scene.axialToWorld(fromQ, fromR);
  const to = scene.axialToWorld(toQ, toR);

  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // Angle of motion in screen space
  let angle = Math.atan2(dy, dx);

  // If your dash frame artwork points RIGHT by default, no offset is needed.
  // If you later discover it points UP, set ROTATION_OFFSET = Math.PI / 2, etc.
  const ROTATION_OFFSET = 0;

  const finalAngle = angle + ROTATION_OFFSET;

  // Rotate background only; icon stays upright.
  if (unit._dirBg) {
    unit._dirBg.rotation = finalAngle;
  } else {
    // fallback if someone passes the old badge/graphics container
    unit.rotation = finalAngle;
  }

  unit.facingAngle = finalAngle;
}

/**
 * Create enemy raider near camp.
 * Uses AI ownerKey ai0 so it has its own distinct tint.
 */
function spawnEnemyRaiderAt(scene, q, r, ownerKey = 'ai0') {
  const unit = createRaider(scene, q, r, {
    controller: 'ai',
    ownerKey,
    aiFaction: ownerKey,
    name: ownerKey,
  });

  scene.enemies.push(unit);
  scene.units.push(unit);
  return unit;
}

const ELIMINATION_FACTION_PRESETS = Object.freeze({
  Admiralty: ['sharpshooter', 'line_infantry', 'combat_engineer', 'warden', 'tidewalker'],
  Cannibals: ['burrower', 'hunter', 'shaman', 'berserk', 'broodlord'],
  Collective: ['chorus_warrior', 'chant_weaver', 'spire', 'templar', 'oracle'],
  Fabricators: ['bulwark', 'breacher', 'chariot', 'assembler', 'foundry_cannon'],
  Mutants: ['mutant_hound', 'scavenger', 'herald', 'brute', 'gene_alternator'],
  Transcendent: ['operative', 'adept', 'phantom', 'knight', 'wyrm'],
});

function normalizeLobbyFactionName(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'chain admiralty' || raw === 'admiralty') return 'Admiralty';
  if (raw === 'fleshbound clans' || raw === 'cannibals') return 'Cannibals';
  if (raw === 'the collective' || raw === 'collective') return 'Collective';
  if (raw === 'fabricators') return 'Fabricators';
  if (raw === 'afterborn' || raw === 'mutants') return 'Mutants';
  if (raw === 'transcendent') return 'Transcendent';
  return 'Admiralty';
}

function getEliminationPresetForFaction(factionName) {
  const key = normalizeLobbyFactionName(factionName);
  return (ELIMINATION_FACTION_PRESETS[key] || ELIMINATION_FACTION_PRESETS.Admiralty).slice();
}

function stampLegacyPlayerOwnership(unit, player, playerIndex) {
  if (!unit) return unit;

  const ownerName = player?.name || unit.playerName || unit.ownerName || unit.name || 'Player';

  unit.playerId = player?.id ?? unit.playerId ?? null;
  unit.playerIndex = playerIndex ?? unit.playerIndex ?? unit.ownerSlot ?? 0;
  unit.ownerSlot = unit.playerIndex;

  unit.playerName = ownerName;
  unit.ownerName = ownerName;
  unit.owner = ownerName;
  unit.name = ownerName;

  unit.controller = unit.controller || 'player';
  unit.isPlayer = true;
  unit.isEnemy = false;

  if (Number.isFinite(unit.mp) && !Number.isFinite(unit.movementPoints)) {
    unit.movementPoints = unit.mp;
  }

  if (Number.isFinite(unit.mpMax)) {
    if (!Number.isFinite(unit.maxMovementPoints)) {
      unit.maxMovementPoints = unit.mpMax;
    }
    if (!Number.isFinite(unit.movementPointsMax)) {
      unit.movementPointsMax = unit.mpMax;
    }
  }

  return unit;
}

function iconTextForUnitType(unitType, def) {
  const explicit = {
    chorus_warrior: 'CW', chant_weaver: 'CH', spire: 'SP', templar: 'TP', oracle: 'OR',
    bulwark: 'BW', breacher: 'BR', chariot: 'CH', assembler: 'AS', foundry_cannon: 'FC',
    mutant_hound: 'MH', scavenger: 'SC', herald: 'HR', brute: 'BT', gene_alternator: 'GA',
    operative: 'OP', adept: 'AD', phantom: 'PH', knight: 'KN', wyrm: 'WY',
    sharpshooter: 'SS', line_infantry: 'LI', combat_engineer: 'CE', warden: 'WD', tidewalker: 'TW',
    burrower: 'BU', hunter: 'HU', shaman: 'SH', berserk: 'BZ', broodlord: 'BL',
  };

  if (explicit[unitType]) return explicit[unitType];

  const src = String(def?.name || unitType || '').trim();
  const words = src.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
  return src.slice(0, 2).toUpperCase() || 'U';
}

function findFreeClusterTiles(scene, originQ, originR, count) {
  const out = [];
  const seen = new Set();
  const queue = [{ q: originQ, r: originR, d: 0 }];

  while (queue.length && out.length < count) {
    const cur = queue.shift();
    const k = keyOf(cur.q, cur.r);
    if (seen.has(k)) continue;
    seen.add(k);

    if (
      cur.q >= 0 &&
      cur.r >= 0 &&
      cur.q < (scene.mapWidth || 0) &&
      cur.r < (scene.mapHeight || 0)
    ) {
      if (!isBlockedForUnit(scene, cur.q, cur.r)) {
        out.push({ q: cur.q, r: cur.r });
      }

      const neigh = neighborsOddR(cur.q, cur.r)
        .map(([dq, dr]) => ({ q: cur.q + dq, r: cur.r + dr, d: cur.d + 1 }))
        .filter(n =>
          n.q >= 0 &&
          n.r >= 0 &&
          n.q < (scene.mapWidth || 0) &&
          n.r < (scene.mapHeight || 0)
        )
        .sort((a, b) => a.d - b.d || a.r - b.r || a.q - b.q);

      for (const n of neigh) {
        const nk = keyOf(n.q, n.r);
        if (!seen.has(nk)) queue.push(n);
      }
    }
  }

  return out;
}

function createFactionTestUnit(scene, q, r, unitType, player, playerIndex) {
  const def = getUnitDef(unitType);
  const pos = scene.axialToWorld(q, r);
  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;
  const s = Math.max(22, Math.round(size * 1.15));
  const ownerKey = normalizeOwnerKey(playerIndex, 0);

  const { cont } = createDirectionalUnitBadge(
    scene,
    pos.x,
    pos.y,
    ownerKey,
    iconTextForUnitType(unitType, def),
    s,
    UNIT_Z.player
  );

  const unit = cont;
  unit.q = q;
  unit.r = r;
  unit.type = def.id;
  unit.unitType = def.id;
  unit.isPlayer = true;
  unit.isEnemy = false;
  unit.controller = 'player';

  unit.playerId = player?.id ?? null;
  unit.playerName = player?.name || 'Player';
  unit.ownerName = unit.playerName;
  unit.owner = unit.playerName;
  unit.name = unit.playerName;
  unit.playerIndex = playerIndex;
  unit.ownerSlot = playerIndex;

  const st = createUnitState({
    type: def.id,
    ownerId: unit.playerId,
    ownerSlot: playerIndex,
    controller: 'player',
    faction: def.faction || normalizeLobbyFactionName(player?.faction),
    q,
    r,
    facing: 0,
  });

  unit.unitName = def.name;
  applyUnitStateToPhaserUnit(unit, st);
  unit.faction = st.faction;
  unit.facingAngle = 0;
  unit.isLocalPlayer = false;

  stampLegacyPlayerOwnership(unit, player, playerIndex);

  if (Number.isFinite(unit.mp)) {
    unit.movementPoints = unit.mp;
  }
  if (Number.isFinite(unit.mpMax)) {
    unit.maxMovementPoints = unit.mpMax;
    unit.movementPointsMax = unit.mpMax;
  }

  if (!unit.id && !unit.unitId) {
    unit.id = `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }

  return unit;
}

function spawnEliminationSquadForPlayer(scene, tile, player, playerIndex) {
  const factionName = player?.faction || 'Admiralty';
  const preset = getEliminationPresetForFaction(factionName);
  const spots = findFreeClusterTiles(scene, tile.q, tile.r, preset.length);

  if (spots.length < preset.length) {
    console.warn('[Units] Not enough free hexes for elimination squad', {
      player: player?.name,
      faction: factionName,
      requested: preset.length,
      found: spots.length,
      origin: tile,
    });
  }

  const spawned = [];
  for (let i = 0; i < Math.min(preset.length, spots.length); i++) {
    const unit = createFactionTestUnit(scene, spots[i].q, spots[i].r, preset[i], player, playerIndex);
    spawned.push(unit);
  }

  return spawned;
}

/* =========================================================
   Raider Camp (spawned at game start by host)
   ========================================================= */

/**
 * Create Raider Camp marker as a building-like container on a specific hex.
 * Stored as scene.raiderCamp = {q,r,radius,container,alertTargetId,respawnQueue}
 *
 * ✅ FIX:
 * - camp is ON a specific hex (q,r)
 * - looks like a building plate, with background color = ownerColor (AI = blue)
 */
function createRaiderCamp(scene, q, r) {
  const pos = scene.axialToWorld(q, r);
  const size = (typeof scene.hexSize === 'number') ? scene.hexSize : 22;

  const ownerSlot = 1; // AI should be blue like P2 in your palette
  const ownerColor = colorForSlot(ownerSlot);

  const cont = scene.add.container(Math.round(pos.x), Math.round(pos.y)).setDepth(UNIT_Z.building);

  const w = Math.max(28, Math.round(size * 1.35));
  const h = Math.max(22, Math.round(size * 1.10));

  const plate = scene.add.graphics();
  plate.fillStyle(ownerColor, 1);
  plate.lineStyle(2, 0x000000, 0.55);
  // rounded rect centered at (0,0)
  const rx = -w / 2;
  const ry = -h / 2;
  plate.fillRoundedRect(rx, ry, w, h, 7);
  plate.strokeRoundedRect(rx, ry, w, h, 7);

  const icon = scene.add.text(0, -1, '⛺', {
    fontFamily: 'Arial',
    fontSize: `${Math.max(14, Math.round(size * 0.75))}px`,
    color: '#ffffff',
    stroke: '#0b0b0b',
    strokeThickness: 3,
  }).setOrigin(0.5);

  cont.add([plate, icon]);

  try {
    cont.setSize(w, h);
    cont.setInteractive();
  } catch (_) {}

  const camp = {
    q, r,
    radius: 4,
    container: cont,
    type: 'raider_camp',
    ownerSlot,
    ownerColor,
    alertTargetId: null,
    respawnQueue: [], // [{dueTurn:number}]
  };

  scene.buildings = scene.buildings || [];
  scene.buildings.push({
    type: 'raider_camp',
    q, r,
    container: cont,
    ownerSlot,
    ownerColor,
    campRef: camp,
  });

  scene.raiderCamp = camp;
  return camp;
}
// ==============================
// WorldSceneUnits.js (PART 2/2)
// ==============================

function pickRandomFreeLandTile(scene) {
  const land = (scene.mapData || []).filter(isLandTile);
  if (!land.length) return null;

  for (let i = 0; i < 250; i++) {
    const t = land[Math.floor(Math.random() * land.length)];
    if (!t) continue;
    if (isOccupied(scene, t.q, t.r)) continue;
    return t;
  }

  for (const t of land) {
    if (!t) continue;
    if (!isOccupied(scene, t.q, t.r)) return t;
  }

  return null;
}

function spawnInitialRaidersAroundCamp(scene, camp, maxUnits = 3) {
  if (!camp) return;

  const candidates = [];
  const map = scene.mapData || [];

  // prefer near ring 1..2 first
  for (let rr = 1; rr <= 2; rr++) {
    for (const t of map) {
      if (!t || !isLandTile(t)) continue;
      if (axialDistance(t.q, t.r, camp.q, camp.r) !== rr) continue;
      if (isBlockedForUnit(scene, t.q, t.r)) continue;
      candidates.push(t);
    }
  }

  // then any within camp radius
  if (candidates.length < maxUnits) {
    for (const t of map) {
      if (!t || !isLandTile(t)) continue;
      const d = axialDistance(t.q, t.r, camp.q, camp.r);
      if (d < 1 || d > camp.radius) continue;
      if (isBlockedForUnit(scene, t.q, t.r)) continue;
      candidates.push(t);
    }
  }

  // shuffle
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  let spawned = 0;
  for (const t of candidates) {
    if (spawned >= maxUnits) break;
    if (isBlockedForUnit(scene, t.q, t.r)) continue;

    const u = spawnEnemyRaiderAt(scene, t.q, t.r);
    u.homeQ = camp.q;
    u.homeR = camp.r;
    u.aiProfile = 'camp_raider';

    spawned++;
  }
}

/**
 * Main entry: called from WorldScene.create().
 */
export async function spawnUnitsAndEnemies() {
  const scene = /** @type {any} */ (this);

  scene.units   = scene.units   || [];
  scene.players = scene.players || [];
  scene.enemies = scene.enemies || [];
  scene.buildings = scene.buildings || [];

  let lobbyPlayers = null;

  if (scene.lobbyState && Array.isArray(scene.lobbyState.players)) {
    lobbyPlayers = scene.lobbyState.players;
  } else if (scene.roomCode) {
    try {
      const { data, error } = await getLobbyState(scene.roomCode);
      if (!error && data && data.state && Array.isArray(data.state.players)) {
        lobbyPlayers = data.state.players;
      }
    } catch (err) {
      console.error('[Units] Failed to fetch lobby state for spawns:', err);
    }
  }

  const localPlayerId = scene.playerId || null;
  const localName = scene.playerName || (scene.isHost ? 'Host' : 'Player');

  if (!Array.isArray(lobbyPlayers) || lobbyPlayers.length === 0) {
    lobbyPlayers = [{
      id: 'p1',
      name: localName,
      slot: 0,
      isHost: !!scene.isHost,
      isConnected: true,
    }];
  }

  const lobbyMaxPlayers = 4;
  const sortedPlayers = lobbyPlayers
    .slice()
    .sort((a, b) => {
      const sa = (typeof a.slot === 'number') ? a.slot : 999;
      const sb = (typeof b.slot === 'number') ? b.slot : 999;
      return sa - sb;
    })
    .slice(0, lobbyMaxPlayers);

  if (sortedPlayers.length === 0) {
    console.warn('[Units] No players found after sorting.');
    return;
  }

  const spawnTiles = pickSpawnTiles(scene, sortedPlayers.length);
  if (spawnTiles.length === 0) {
    console.warn('[Units] No valid land spawn tiles found (all blocked/flooded?).');
    return;
  }

  scene.players.length = 0;

  const connectedPlayers = [];
  const aiSlots = [];

  sortedPlayers.forEach((player, idx) => {
    const isAI = (player?.controller === 'ai') || (player?.isAI === true) || (String(player?.name || '').toLowerCase().includes('ai'));
    const isConnected = (player?.isConnected !== false);
    if (!isAI && isConnected) connectedPlayers.push({ player, idx });
    else aiSlots.push({ player, idx });
  });

  connectedPlayers.forEach(({ player, idx }) => {
    const tile = spawnTiles[idx] || spawnTiles[spawnTiles.length - 1];
    const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];

    // hard safety
    if (!isLandTile(tile)) {
      console.warn('[Units] Picked spawn tile is not land, searching neighbor/fallback…', tile);
      const fallback = (scene.mapData || []).find(isLandTile);
      if (!fallback) return;
      tile.q = fallback.q;
      tile.r = fallback.r;
    }

    const spawnedUnits = (scene.isEliminationMission || scene.missionType === 'elimination')
      ? spawnEliminationSquadForPlayer(scene, tile, player, idx)
      : [createMobileBase(scene, tile, player, color, idx)];

    for (const unit of spawnedUnits) {
      if (!unit) continue;

      unit.isLocalPlayer =
        (localPlayerId && player.id === localPlayerId) ||
        (!localPlayerId && player.name === localName);

      stampLegacyPlayerOwnership(unit, player, idx);

      scene.units.push(unit);

      // FIX:
      // In the current project movement / selection / turn logic still expects
      // controllable player units to be present in scene.players.
      // For Elimination each spawned squad member must therefore also be registered there.
      scene.players.push(unit);
    }
  });

  // Elimination mission: no camps/enemies/resources, only players
  if (scene.isEliminationMission || scene.missionType === 'elimination') {
    scene.enemies = scene.enemies || [];
    scene.enemies.length = 0;
    scene.raiderCamp = null;
    console.log('[Units] Elimination mission: skipping enemy/camp spawns.');
    console.log('[Units] Spawn complete: ' + scene.players.length + ' players, 0 enemies.');
    return;
  }

  // =========================================================
  // ✅ PATCH: Enemy spawning logic changed:
  // - NO aiSlots spawning
  // - NO neutral enemies spawning
  // - ONLY Raider Camp + exactly 3 raiders around it (host only)
  // =========================================================
  if (scene.isHost) {
    // remove any old enemies that might exist from previous runs
    scene.enemies.length = 0;
    scene.units = (scene.units || []).filter(u => !(u && (u.isEnemy || u.controller === 'ai')));

    if (!scene.raiderCamp) {
      const campTile = pickRandomFreeLandTile(scene);
      if (campTile) {
        const camp = createRaiderCamp(scene, campTile.q, campTile.r);
        spawnInitialRaidersAroundCamp(scene, camp, 3);
        console.log(`[CAMP] Raider Camp created at (${camp.q},${camp.r}) radius=${camp.radius}`);
      } else {
        console.warn('[CAMP] Could not find free land tile for Raider Camp.');
      }
    }
  }

  console.log(
    '[Units] Spawn complete: ' +
    scene.players.length + ' players, ' +
    scene.enemies.length + ' enemies.'
  );
}

/* =========================================================
   Mobile Base production (Stage A extension)
   ========================================================= */

const UNIT_COSTS = {
  transporter: { scrap: 15, money: 10 },
  raider:      { scrap: 10, money: 5 },
};

function trySpendResources(scene, cost) {
  const res = scene.playerResources || scene.resources || scene.state?.resources;
  if (!res || !cost) return false;
  for (const k of Object.keys(cost)) {
    if (!Number.isFinite(res[k]) || res[k] < cost[k]) return false;
  }
  for (const k of Object.keys(cost)) {
    res[k] -= cost[k];
  }
  return true;
}

function selectedMobileBase(scene) {
  const u = scene.menuContextSelection || scene.selectedUnit || null;
  if (u && (u.type === 'mobile_base' || u.unitType === 'mobile_base')) return u;
  const mb = (scene.players || []).find(p => p && (p.type === 'mobile_base' || p.unitType === 'mobile_base'));
  return mb || null;
}

function spawnUnitNearBase(scene, base, unitType) {
  if (!scene || !base) return null;
  const spot = findFreeNeighbor(scene, base.q, base.r);
  if (!spot) {
    console.warn('[UNITS] No free adjacent LAND hex to spawn unit near base.');
    return null;
  }

  let unit = null;
  if (unitType === 'transporter') unit = createTransporter(scene, spot.q, spot.r, base);
  else if (unitType === 'raider') unit = createRaider(scene, spot.q, spot.r, {
    controller: 'player',
    ownerId: base.playerId,
    ownerSlot: base.playerIndex ?? base.ownerSlot ?? 0,
    ownerName: base.playerName || base.name
  });

  if (!unit) return null;

  scene.units.push(unit);
  scene.players.push(unit);
  return unit;
}

export function buildTransporterAtSelectedUnit() {
  const scene = /** @type {any} */ (this);
  const base = selectedMobileBase(scene);
  if (!base) {
    console.warn('[UNITS] buildTransporter: no mobile base selected');
    return null;
  }

  const ownerName = base.playerName || base.name;
  if (scene.turnOwner && ownerName !== scene.turnOwner) return null;

  const cost = UNIT_COSTS.transporter;
  if (!trySpendResources(scene, cost)) {
    console.warn('[UNITS] Not enough resources for Transporter', cost);
    return null;
  }

  const unit = spawnUnitNearBase(scene, base, 'transporter');
  scene.updateResourceUI?.();
  scene.refreshResourcesPanel?.();
  return unit;
}

export function buildRaiderAtSelectedUnit() {
  const scene = /** @type {any} */ (this);
  const base = selectedMobileBase(scene);
  if (!base) {
    console.warn('[UNITS] buildRaider: no mobile base selected');
    return null;
  }

  const ownerName = base.playerName || base.name;
  if (scene.turnOwner && ownerName !== scene.turnOwner) return null;

  const cost = UNIT_COSTS.raider;
  if (!trySpendResources(scene, cost)) {
    console.warn('[UNITS] Not enough resources for Raider', cost);
    return null;
  }

  const unit = spawnUnitNearBase(scene, base, 'raider');
  scene.updateResourceUI?.();
  scene.refreshResourcesPanel?.();
  return unit;
}

/* =========================================================
   AI / Raiders helpers used by WorldScene
   ========================================================= */

export function findNearestPlayerUnit(scene, fromQ, fromR) {
  const allPlayers = []
    .concat(scene.players || [])
    .concat(scene.units || [])
    .filter(u => u && !u.isDead && !u.isEnemy && u.controller !== 'ai');

  if (!allPlayers.length) return null;

  let best = null;
  let bestD = Infinity;

  for (const u of allPlayers) {
    const d = axialDistance(fromQ, fromR, u.q, u.r);
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }

  return best;
}

export function isInsideRaiderCampRadius(scene, q, r) {
  const camp = scene.raiderCamp;
  if (!camp) return false;
  return axialDistance(q, r, camp.q, camp.r) <= camp.radius;
}

export function queueRaiderRespawn(scene, dueTurn) {
  if (!scene.raiderCamp) return;
  scene.raiderCamp.respawnQueue.push({ dueTurn });
}

export function processQueuedRaiderRespawns(scene, currentTurn) {
  const camp = scene.raiderCamp;
  if (!camp) return;

  const ready = [];
  const pending = [];

  for (const item of camp.respawnQueue) {
    if ((item?.dueTurn ?? Infinity) <= currentTurn) ready.push(item);
    else pending.push(item);
  }

  camp.respawnQueue = pending;

  for (const _item of ready) {
    const spawn = findFreeNeighbor(scene, camp.q, camp.r) || pickRandomFreeLandTile(scene);
    if (!spawn) continue;

    const u = spawnEnemyRaiderAt(scene, spawn.q, spawn.r);
    u.homeQ = camp.q;
    u.homeR = camp.r;
    u.aiProfile = 'camp_raider';
  }
}

/* =========================================================
   Convenience default export
   ========================================================= */

export default {
  spawnUnitsAndEnemies,
  updateUnitOrientation,
  buildTransporterAtSelectedUnit,
  buildRaiderAtSelectedUnit,
  findNearestPlayerUnit,
  isInsideRaiderCampRadius,
  queueRaiderRespawn,
  processQueuedRaiderRespawns,
};
