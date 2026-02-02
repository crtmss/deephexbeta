// src/scenes/WorldSceneUnitPanel.js
//
// Stage C: Unit action panel UI (bottom-center).
//
// This module is designed to be additive and not break existing menus.
// It plugs into WorldSceneMenus.setupWorldMenus() and adds:
//   scene.openUnitActionPanel(unit)
//   scene.closeUnitActionPanel()
//   scene.refreshUnitActionPanel()
//
// Controls:
//  - Move: clears attack mode (movement remains click-to-move as before)
//  - Attack: highlights attackable hexes (via AttackController)
//  - Defence: calls applyDefence(unit)
//  - Build: (Mobile Base only) placeholder for now (later via Build ability)
//  - Hide: no-op placeholder
//  - Turn: opens direction picker (free)
//
// NEW (Abilities v1):
//  - Active Abilities folder: shows up to 2 cast buttons for unit's active abilities
//  - Passive Abilities folder: shows passive icons (emoji) + names
//  - Clicking an active ability enters targeting mode via AbilityController.
//
// ---------------------------------------------------------------------------
// __COMBAT_DEBUG__ (auto-instrumentation)
// Toggle in devtools: window.__COMBAT_DEBUG_ENABLED__ = true/false
// ---------------------------------------------------------------------------
const __DBG_ENABLED__ = () => (typeof window !== 'undefined' ? (window.__COMBAT_DEBUG_ENABLED__ ?? true) : true);
function __dbg_ts() { try { return new Date().toISOString().slice(11, 23); } catch (_) { return ''; } }
function __dbg(tag, data) { if (!__DBG_ENABLED__()) return; try { console.log('[' + tag + '] ' + __dbg_ts(), data); } catch (_) {} }
function __dbg_group(tag, title, data) {
  if (!__DBG_ENABLED__()) return;
  try { console.groupCollapsed('[' + tag + '] ' + __dbg_ts() + ' ' + title); if (data !== undefined) console.log(data); } catch (_) {}
}
function __dbg_group_end() { if (!__DBG_ENABLED__()) return; try { console.groupEnd(); } catch (_) {} }

// -----------------------------------------------------------------------------
// Attack debug helpers
// -----------------------------------------------------------------------------
function hexDistanceAxial(q1, r1, q2, r2) {
  const dq = q2 - q1;
  const dr = r2 - r1;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function getActiveWeaponId(unit) {
  const weapons = unit?.weapons || [];
  if (!weapons.length) return null;
  const idx = Number.isFinite(unit.activeWeaponIndex) ? unit.activeWeaponIndex : 0;
  return weapons[idx] || weapons[0] || null;
}

function getWeaponRange(weapon) {
  const rangeMin = Number.isFinite(weapon?.rangeMin) ? weapon.rangeMin : 1;
  const rangeMax = Number.isFinite(weapon?.rangeMax)
    ? weapon.rangeMax
    : (Number.isFinite(weapon?.range) ? weapon.range : 1);
  return { rangeMin, rangeMax };
}

function countEnemiesInRange(scene, attacker, rangeMin, rangeMax) {
  const all = []
    .concat(scene.units || [])
    .concat(scene.players || [])
    .concat(scene.enemies || [])
    .concat(scene.haulers || []);
  let n = 0;
  for (const u of all) {
    if (!u || u.isDead) continue;
    if (u === attacker) continue;

    // Enemy check (player vs enemy or different owner)
    if (attacker.isEnemy && u.isEnemy) continue;
    if (attacker.isPlayer && u.isPlayer) continue;

    const d = hexDistanceAxial(attacker.q, attacker.r, u.q, u.r);
    if (d >= rangeMin && d <= rangeMax) n++;
  }
  return n;
}

import { applyDefence } from '../units/UnitActions.js';
import { updateCombatPreview, clearCombatPreview } from './WorldSceneCombatPreview.js';
import { getWeaponDef } from '../units/WeaponDefs.js';
import { AttackController } from '../combat/AttackController.js';

// NEW: Abilities
import { getUnitDef } from '../units/UnitDefs.js';
import { getAbilityDef } from '../abilities/AbilityDefs.js';
import { AbilityController } from '../abilities/AbilityController.js';

// NEW: Status icons from EffectDefs
import { getEffectDef } from '../effects/EffectDefs.js';

const PANEL_DEPTH = 4200;

const DIR_ANGLES = [
  0,
  -Math.PI / 3,
  -2 * Math.PI / 3,
  Math.PI,
  2 * Math.PI / 3,
  Math.PI / 3,
];

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n));
}

function weaponTooltipText(unit) {
  const weapons = Array.isArray(unit?.weapons) ? unit.weapons : [];
  const idx = Number.isFinite(unit?.activeWeaponIndex) ? unit.activeWeaponIndex : 0;
  const weaponId = weapons[idx] || weapons[0] || 'lmg';
  const w = getWeaponDef(weaponId);

  // Short, readable tooltip.
  const range = `${w.rangeMin}-${w.rangeMax}`;
  const ac = w.armorClassMult || {};
  const lines = [
    `${w.name} (${w.id})`,
    `Damage: ${w.baseDamage}`,
    `Range: ${range}`,
    `Penetration vs armor:`,
    `  LIGHT:  x${ac.LIGHT ?? 1}`,
    `  MEDIUM: x${ac.MEDIUM ?? 1}`,
    `  HEAVY:  x${ac.HEAVY ?? 1}`,
  ];

  if (w.distanceCurve?.dist1 || w.distanceCurve?.dist2) {
    lines.push(`Distance curve:`);
    if (Number.isFinite(w.distanceCurve?.dist1)) lines.push(`  dist=1: x${w.distanceCurve.dist1}`);
    if (Number.isFinite(w.distanceCurve?.dist2)) lines.push(`  dist=2: x${w.distanceCurve.dist2}`);
  }

  return lines.join('\n');
}

/* =========================================================
   ABILITIES HELPERS
   ========================================================= */

function getAbilitiesForUnit(unit) {
  if (!unit) return { actives: [], passives: [] };

  // prefer runtime fields if present
  const act = Array.isArray(unit.activeAbilities) ? unit.activeAbilities : null;
  const pas = Array.isArray(unit.passiveAbilities) ? unit.passiveAbilities : null;
  if (act || pas) {
    return {
      actives: act || [],
      passives: pas || [],
    };
  }

  // fallback to defs by type
  const def = getUnitDef(unit.type);
  return {
    actives: Array.isArray(def.activeAbilities) ? def.activeAbilities : [],
    passives: Array.isArray(def.passiveAbilities) ? def.passiveAbilities : [],
  };
}

function summarizeAbility(abilityId) {
  const a = getAbilityDef(abilityId);
  if (!a) return { title: abilityId, body: 'Missing def' };

  const icon = a.icon ? `${a.icon} ` : '';
  if (a.kind === 'active') {
    const ad = a.active || {};
    const rm = Number.isFinite(ad.rangeMin) ? ad.rangeMin : 0;
    const rx = Number.isFinite(ad.rangeMax) ? ad.rangeMax : rm;
    const tgt = ad.target || 'self';
    const ap = Number.isFinite(ad.apCost) ? ad.apCost : 1;
    const aoe = Number.isFinite(ad.aoeRadius) ? ad.aoeRadius : 0;
    const extra = aoe > 0 ? `, AOE:${aoe}` : '';
    return {
      title: `${icon}${a.name}`,
      body: `Type: ACTIVE\nAP: ${ap}\nTarget: ${tgt}\nRange: ${rm}-${rx}${extra}\n\n${a.desc || ''}`.trim(),
    };
  }

  return {
    title: `${icon}${a.name}`,
    body: `Type: PASSIVE\n\n${a.desc || ''}`.trim(),
  };
}

/* =========================================================
   HEX INSPECT (tile info inside the unit panel)
   ========================================================= */

function getTileAt(scene, q, r) {
  return (scene.mapData || []).find(t => t && t.q === q && t.r === r) || null;
}

function summarizeHex(scene, q, r) {
  const t = getTileAt(scene, q, r);
  if (!t) {
    return {
      title: `Hex (${q}, ${r})`,
      lines: [`Tile not found.`],
    };
  }

  const bits = [];

  const terrain = t.type || 'unknown';
  const ground = t.groundType || '—';
  const elev =
    Number.isFinite(t.visualElevation) ? t.visualElevation :
    (Number.isFinite(t.elevation) ? t.elevation :
    (Number.isFinite(t.baseElevation) ? t.baseElevation : 0));

  bits.push(`Terrain: ${terrain}   Ground: ${ground}`);
  bits.push(`Elevation: ${fmt(elev)}   Underwater: ${t.isUnderWater ? 'YES' : 'NO'}`);

  // Roads / forest
  const flags = [];
  if (t.hasRoad) flags.push('Road');
  if (t.hasForest) flags.push('Forest');

  // POIs
  if (t.hasSettlement) flags.push(`Settlement${t.settlementName ? ` (${t.settlementName})` : ''}`);
  if (t.hasRuin) flags.push('Ruin');
  if (t.hasRaiderCamp) flags.push('Raider camp');
  if (t.hasRoadsideCamp) flags.push('Roadside camp');
  if (t.hasWatchtower) flags.push('Watchtower');
  if (t.hasMinePOI) flags.push('Mine');
  if (t.hasShrine) flags.push('Shrine');

  if (t.hasCrashSite) flags.push('Crash site');
  if (t.hasWreck) flags.push('Wreck');
  if (t.hasVehicle) flags.push('Vehicle');

  if (flags.length) bits.push(`Features: ${flags.join(', ')}`);
  else bits.push(`Features: —`);

  // Resources on this hex (scene.resources entries)
  const res = (scene.resources || []).filter(o => o && o.q === q && o.r === r);
  if (res.length) {
    const names = res.map(o => o.name || o.type || o.kind || 'resource');
    bits.push(`Resources: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` +${names.length - 5}` : ''}`);
  } else {
    bits.push(`Resources: —`);
  }

  // mapInfo objects (lore POIs list)
  const objs = (scene.mapInfo?.objects || []).filter(o => o && o.q === q && o.r === r);
  if (objs.length) {
    const names = objs.map(o => o.name || o.type || 'object');
    bits.push(`Map objects: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` +${names.length - 4}` : ''}`);
  }

  return { title: `Hex (${q}, ${r})`, lines: bits };
}

function isHexInspect(obj) {
  return !!(obj && obj.__hexInspect && Number.isFinite(obj.q) && Number.isFinite(obj.r));
}

function makeHexInspectObj(q, r) {
  return { __hexInspect: true, q, r };
}

function setFacing(scene, unit, dirIndex) {
  if (!scene || !unit) return;
  const d = clamp(dirIndex | 0, 0, 5);
  unit.facing = d;
  unit.facingAngle = DIR_ANGLES[d] ?? 0;
  if (typeof unit.rotation === 'number') {
    unit.rotation = unit.facingAngle;
  }
}

/**
 * Create a styled text button inside a fixed container.
 */
function makeTextButton(scene, container, x, y, w, h, label, onClick) {
  const g = scene.add.graphics();
  const hit = scene.add.rectangle(0, 0, w, h, 0x000000, 0);
  hit.setOrigin(0, 0);

  const t = scene.add.text(0, 0, label, {
    fontSize: '13px',
    color: '#e8f6ff',
    align: 'center',
    fontFamily: 'monospace',
    wordWrap: { width: w - 8 },
  });
  t.setOrigin(0.5, 0.5);

  const draw = (hover) => {
    g.clear();
    g.fillStyle(hover ? 0x2a3b66 : 0x1a2240, 0.92);
    g.fillRoundedRect(x, y, w, h, 8);
    g.lineStyle(2, hover ? 0x86d6ff : 0x4aa6d8, 0.85);
    g.strokeRoundedRect(x, y, w, h, 8);
  };
  draw(false);

  hit.setPosition(x, y);
  t.setPosition(x + w / 2, y + h / 2);

  container.add([g, hit, t]);

  hit.setInteractive({ useHandCursor: true });
  hit.on('pointerover', () => draw(true));
  hit.on('pointerout', () => draw(false));
  hit.on('pointerdown', () => onClick?.());

  return { g, hit, t, draw };
}

/* =========================================================
   NEW: UI helpers for stats/resists/statuses
   ========================================================= */

function getResistsRow(unit) {
  const r = (unit?.resists && typeof unit.resists === 'object') ? unit.resists : {};
  const v = (k) => (Number.isFinite(r?.[k]) ? r[k] : 0);

  // compact labels to fit line
  // physical thermal toxic cryo radiation energy corrosion
  return (
    `RES: ` +
    `PHY ${fmt(v('physical'))}  ` +
    `THR ${fmt(v('thermal'))}  ` +
    `TOX ${fmt(v('toxic'))}  ` +
    `CRY ${fmt(v('cryo'))}  ` +
    `RAD ${fmt(v('radiation'))}  ` +
    `ENG ${fmt(v('energy'))}  ` +
    `COR ${fmt(v('corrosion'))}`
  );
}

function getStatusesRow(unit) {
  const list = Array.isArray(unit?.statuses) ? unit.statuses : [];
  if (!list.length) return `STATUS: —`;

  const icons = [];
  for (let i = 0; i < Math.min(10, list.length); i++) {
    const s = list[i];
    const defId = s?.defId || s;
    const ed = getEffectDef(defId);
    icons.push(ed?.icon || '•');
  }

  const extra = list.length > 10 ? ` +${list.length - 10}` : '';
  return `STATUS: ${icons.join(' ')}${extra}`;
}

/**
 * Attach unit panel to scene.
 * Called once from WorldSceneMenus.setupWorldMenus(scene).
 */
export function setupUnitActionPanel(scene) {
  if (scene.unitActionPanel) return;

  // Panel state
  scene.unitPanelState = {
    page: 'root', // 'root' | 'active' | 'passive'
    turnPickerOpen: false,
  };

  // Container dims
  const W = 600;
  const H = 170;

  // Root container
  const container = scene.add.container(0, 0).setDepth(PANEL_DEPTH);
  container.visible = false;

  // Background (semi-transparent)
  const bg = scene.add.graphics();
  bg.fillStyle(0x0b0f1a, 0.82);
  bg.fillRoundedRect(0, 0, W, H, 14);

  // Bezel
  const bezel = scene.add.graphics();
  bezel.lineStyle(2, 0x4aa6d8, 0.65);
  bezel.strokeRoundedRect(0, 0, W, H, 14);

  // Input blocker so clicks don't leak to world
  const blocker = scene.add.rectangle(0, 0, W, H, 0x000000, 0);
  blocker.setOrigin(0, 0);
  blocker.setInteractive();

  container.add([bg, bezel, blocker]);

  // Left info section
  const titleText = scene.add.text(16, 12, 'Unit', {
    fontSize: '16px',
    color: '#e8f6ff',
    fontStyle: 'bold',
  });

  const statsText = scene.add.text(16, 40, '', {
    fontSize: '13px',
    color: '#cfefff',
    fontFamily: 'monospace',
  });

  // Weapon area
  const weaponLabel = scene.add.text(16, 126, 'Weapon:', {
    fontSize: '13px',
    color: '#9be4ff',
    fontFamily: 'monospace',
  });

  const weaponText = scene.add.text(80, 126, '', {
    fontSize: '13px',
    color: '#e8f6ff',
    fontFamily: 'monospace',
  });

  // Tooltip for weapon
  const tooltip = {
    box: scene.add.graphics().setDepth(PANEL_DEPTH + 100),
    text: scene.add.text(0, 0, '', {
      fontSize: '12px',
      color: '#e8f6ff',
      fontFamily: 'monospace',
      backgroundColor: 'rgba(0,0,0,0)',
    }).setDepth(PANEL_DEPTH + 101),
    visible: false,
    show(msg, x, y) {
      this.text.setText(msg);
      this.text.setPosition(x, y);
      const pad = 6;
      const b = this.text.getBounds();
      this.box.clear();
      this.box.fillStyle(0x000000, 0.85);
      this.box.fillRoundedRect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2, 8);
      this.visible = true;
      this.box.setVisible(true);
      this.text.setVisible(true);
    },
    hide() {
      this.visible = false;
      this.box.setVisible(false);
      this.text.setVisible(false);
    },
  };
  tooltip.hide();

  weaponText.setInteractive({ useHandCursor: true });
  weaponText.on('pointerover', () => {
    const u = scene.selectedUnit;
    if (!u) return;
    tooltip.show(weaponTooltipText(u), scene.input.activePointer.x + 14, scene.input.activePointer.y + 14);
  });
  weaponText.on('pointerout', () => tooltip.hide());

  // Buttons (right side)
  const btnW = 92;
  const btnH = 34;
  const btnPad = 8;
  const colX = W - (btnW * 3 + btnPad * 2) - 16;
  const rowY = 18;

  const buttons = {};

  // Root action buttons
  buttons.move = makeTextButton(scene, container, colX + (btnW + btnPad) * 0, rowY + (btnH + btnPad) * 0, btnW, btnH, 'Move', () => {
    scene.unitCommandMode = null;
    scene.attackController?.exit?.('move');
    scene.abilityController?.exit?.('move');
    clearCombatPreview(scene);
    console.log('[UNITS] Move selected (click-to-move)');
  });

  buttons.defence = makeTextButton(scene, container, colX + (btnW + btnPad) * 1, rowY + (btnH + btnPad) * 0, btnW, btnH, 'Defence', () => {
    const u = scene.selectedUnit;
    if (!u) return;

    // any mode off
    scene.attackController?.exit?.('defence');
    scene.abilityController?.exit?.('defence');
    scene.unitCommandMode = null;
    clearCombatPreview(scene);

    const res = applyDefence(u);
    console.log('[DEFENCE]', { ok: res.ok, reason: res.reason, heal: res.heal, tempArmorBonus: res.tempArmorBonus, unitId: u.id, q: u.q, r: u.r });
    scene.refreshUnitActionPanel?.();
  });

  buttons.attack = makeTextButton(scene, container, colX + (btnW + btnPad) * 2, rowY + (btnH + btnPad) * 0, btnW, btnH, 'Attack', () => {
    __dbg('PLAYER:AttackBtn', { selectedUnit: { id: scene.selectedUnit?.unitId ?? scene.selectedUnit?.id, type: scene.selectedUnit?.type, q: scene.selectedUnit?.q, r: scene.selectedUnit?.r, ap: scene.selectedUnit?.ap, faction: scene.selectedUnit?.faction, weapons: scene.selectedUnit?.weapons, activeWeaponIndex: scene.selectedUnit?.activeWeaponIndex } });

    const u = scene.selectedUnit;
    if (!u) {
      console.warn('[ATTACK] Clicked Attack but no selectedUnit');
      return;
    }

    // turn off ability mode
    scene.abilityController?.exit?.('attack_btn');

    const wid = getActiveWeaponId(u);
    const wdef = wid ? getWeaponDef(wid) : null;
    const { rangeMin, rangeMax } = getWeaponRange(wdef);

    // Enter targeting mode via AttackController
    const ac = scene.attackController || (scene.attackController = new AttackController(scene));
    ac.enter(u);

    updateCombatPreview(scene);

    __dbg('PLAYER:AttackTargets', {
      unitId: u.id,
      weaponId: wid,
      rangeMin,
      rangeMax,
      attackable: scene.attackableHexes?.size ?? 0
    });
    scene.refreshUnitActionPanel?.();
  });

  // Build (Mobile Base only)
  buttons.build = makeTextButton(scene, container, colX + (btnW + btnPad) * 0, rowY + (btnH + btnPad) * 1, btnW, btnH, 'Build', () => {
    const u = scene.selectedUnit;
    if (!u) return;

    // later: enter AbilityController with Build ability / open build grid inside unit panel
    scene.attackController?.exit?.('build');
    scene.abilityController?.exit?.('build');
    scene.unitCommandMode = null;
    clearCombatPreview(scene);

    console.log('[BUILD] Clicked Build (placeholder)', { unitId: u.id, type: u.type });
  });

  buttons.hide = makeTextButton(scene, container, colX + (btnW + btnPad) * 1, rowY + (btnH + btnPad) * 1, btnW, btnH, 'Hide', () => {
    console.log('[UNITS] Hide (placeholder)');
  });

  buttons.turn = makeTextButton(scene, container, colX + (btnW + btnPad) * 2, rowY + (btnH + btnPad) * 1, btnW, btnH, 'Turn', () => {
    scene.unitPanelState.turnPickerOpen = !scene.unitPanelState.turnPickerOpen;
    scene.refreshUnitActionPanel?.();
  });

  // Folder buttons
  buttons.activeFolder = makeTextButton(scene, container, colX + (btnW + btnPad) * 0, rowY + (btnH + btnPad) * 2, btnW * 1 + btnPad, btnH, 'Active\nAbilities', () => {
    scene.attackController?.exit?.('open_active_folder');
    scene.abilityController?.exit?.('open_active_folder');
    scene.unitCommandMode = null;
    clearCombatPreview(scene);

    scene.unitPanelState.page = 'active';
    scene.unitPanelState.turnPickerOpen = false;
    scene.refreshUnitActionPanel?.();
  });

  buttons.passiveFolder = makeTextButton(scene, container, colX + (btnW + btnPad) * 2 - (btnW * 1 + btnPad), rowY + (btnH + btnPad) * 2, btnW * 1 + btnPad, btnH, 'Passive\nAbilities', () => {
    scene.attackController?.exit?.('open_passive_folder');
    scene.abilityController?.exit?.('open_passive_folder');
    scene.unitCommandMode = null;
    clearCombatPreview(scene);

    scene.unitPanelState.page = 'passive';
    scene.unitPanelState.turnPickerOpen = false;
    scene.refreshUnitActionPanel?.();
  });

  // Switch weapon
  buttons.switchWeapon = makeTextButton(scene, container, 16, 146, 140, 22, 'Switch Weapon', () => {
    const u = scene.selectedUnit;
    const ws = Array.isArray(u?.weapons) ? u.weapons : [];
    if (!u || ws.length <= 1) return;

    const idx = Number.isFinite(u.activeWeaponIndex) ? u.activeWeaponIndex : 0;
    u.activeWeaponIndex = (idx + 1) % ws.length;

    __dbg('PLAYER:WeaponSwitch', {
      unitId: u?.unitId ?? u?.id,
      activeWeaponIndex: u.activeWeaponIndex,
      weaponId: (u.weapons || [])[u.activeWeaponIndex]
    });

    if (scene.unitCommandMode === 'attack') {
      scene.attackController?.enter?.(u);
      updateCombatPreview(scene);
    }
    if (String(scene.unitCommandMode || '').startsWith('ability:')) {
      scene.abilityController?.recompute?.();
    }

    scene.refreshUnitActionPanel?.();
  });

  // Subpage content
  const pageTitle = scene.add.text(colX, 18, '', {
    fontSize: '16px',
    color: '#e8f6ff',
    fontStyle: 'bold',
  });
  const pageBody = scene.add.text(colX, 46, '', {
    fontSize: '13px',
    color: '#cfefff',
    fontFamily: 'monospace',
    wordWrap: { width: btnW * 3 + btnPad * 2 },
  });

  // Back button (subpages)
  const backBtn = makeTextButton(scene, container, colX, 120, 92, 34, 'Back', () => {
    scene.unitPanelState.page = 'root';
    scene.unitPanelState.turnPickerOpen = false;
    scene.refreshUnitActionPanel?.();
  });

  // NEW: Active ability cast buttons (2 slots)
  const abilBtnW = btnW * 3 + btnPad * 2;
  buttons.abilityA = makeTextButton(scene, container, colX, 80, abilBtnW, 34, '—', () => {});
  buttons.abilityB = makeTextButton(scene, container, colX, 118, abilBtnW, 34, '—', () => {});

  // NEW: Passive ability icons (up to 4 shown as text blocks)
  const passiveLine1 = scene.add.text(colX, 78, '', { fontSize: '14px', color: '#cfefff', fontFamily: 'monospace' });
  const passiveLine2 = scene.add.text(colX, 100, '', { fontSize: '14px', color: '#cfefff', fontFamily: 'monospace' });
  const passiveLine3 = scene.add.text(colX, 122, '', { fontSize: '14px', color: '#cfefff', fontFamily: 'monospace' });
  const passiveLine4 = scene.add.text(colX, 144, '', { fontSize: '14px', color: '#cfefff', fontFamily: 'monospace' });

  // Turn picker (6 small buttons)
  const tp = {
    buttons: [],
    label: scene.add.text(200, 124, 'Facing:', {
      fontSize: '13px',
      color: '#9be4ff',
      fontFamily: 'monospace',
    }),
  };
  const tpX = 260;
  const tpY = 118;
  const smallW = 42;
  const smallH = 34;
  const smallPad = 6;
  const arrowLabels = ['→', '↘', '↙', '←', '↖', '↗'];
  for (let i = 0; i < 6; i++) {
    const bx = tpX + (smallW + smallPad) * i;
    const by = tpY;
    const b = makeTextButton(scene, container, bx, by, smallW, smallH, arrowLabels[i], () => {
      const u = scene.selectedUnit;
      if (!u) return;
      setFacing(scene, u, i);
      scene.unitPanelState.turnPickerOpen = false;
      scene.refreshUnitActionPanel?.();
    });
    tp.buttons.push(b);
  }

  // Add UI content above bg/bezel/blocker
  container.add([
    titleText,
    statsText,
    weaponLabel,
    weaponText,
    pageTitle,
    pageBody,
    backBtn.g, backBtn.t, backBtn.hit,
    tp.label,
    passiveLine1, passiveLine2, passiveLine3, passiveLine4,
  ]);

  // Store UI handles
  scene.unitActionPanel = {
    container,
    bg,
    bezel,
    blocker,
    titleText,
    statsText,
    weaponText,
    weaponLabel,
    tooltip,
    buttons,
    pageTitle,
    pageBody,
    backBtn,
    turnPicker: tp,
    passiveLines: [passiveLine1, passiveLine2, passiveLine3, passiveLine4],
    W,
    H,
  };

  // Positioning
  const position = () => {
    const cx = scene.scale.width / 2;
    const y = scene.scale.height - H - 14;
    container.setPosition(Math.round(cx - W / 2), Math.round(y));
  };
  position();
  scene.scale.on('resize', position);

  // Public API
  scene.openUnitActionPanel = function (unit) {
    if (!scene.unitActionPanel) return;
    scene.unitPanelState.page = 'root';
    scene.unitPanelState.turnPickerOpen = false;
    scene.unitActionPanel.container.visible = true;
    scene.refreshUnitActionPanel?.(unit);
    scene.children.bringToTop(scene.unitActionPanel.container);
  };

  // NEW: open hex inspector inside the same panel (no buttons)
  scene.openHexInspectPanel = function (q, r) {
    if (!scene.unitActionPanel) return;
    if (!Number.isFinite(q) || !Number.isFinite(r)) return;

    scene.selectedHex = { q, r };

    scene.unitCommandMode = null;
    scene.clearPathPreview?.();

    const obj = makeHexInspectObj(q, r);
    scene.unitPanelState.page = 'root';
    scene.unitPanelState.turnPickerOpen = false;
    scene.unitActionPanel.container.visible = true;
    scene.refreshUnitActionPanel?.(obj);
    scene.children.bringToTop(scene.unitActionPanel.container);
  };

  scene.closeUnitActionPanel = function () {
    if (!scene.unitActionPanel) return;
    scene.unitPanelState.page = 'root';
    scene.unitPanelState.turnPickerOpen = false;
    scene.unitActionPanel.tooltip?.hide?.();
    scene.unitActionPanel.container.visible = false;
  };

  scene.refreshUnitActionPanel = function (unitMaybe) {
    const panel = scene.unitActionPanel;
    if (!panel) return;

    const unit = unitMaybe || scene.selectedUnit;
    const hexMode = isHexInspect(unit);

    // Hide if nothing selected
    if (!unit) {
      scene.closeUnitActionPanel?.();
      return;
    }

    // =========================================================
    // HEX INSPECT MODE
    // =========================================================
    if (hexMode) {
      const q = unit.q;
      const r = unit.r;

      const hx = summarizeHex(scene, q, r);
      panel.titleText.setText(hx.title);
      panel.statsText.setText(hx.lines.join('\n'));

      panel.weaponLabel.setVisible(false);
      panel.weaponText.setVisible(false);

      const sw = panel.buttons.switchWeapon;
      if (sw) {
        sw.g.setVisible(false);
        sw.t.setVisible(false);
        sw.hit.setVisible(false);
        if (sw.hit?.input) sw.hit.disableInteractive();
        if (sw.t?.input) sw.t.disableInteractive();
      }

      for (const k of Object.keys(panel.buttons || {})) {
        const b = panel.buttons[k];
        if (!b) continue;
        b.g.setVisible(false);
        b.t.setVisible(false);
        b.hit.setVisible(false);
        if (b.hit?.input) b.hit.disableInteractive();
        if (b.t?.input) b.t.disableInteractive();
      }

      for (const ln of (panel.passiveLines || [])) ln.setVisible(false);

      panel.pageTitle.setVisible(false);
      panel.pageBody.setVisible(false);
      panel.backBtn.g.setVisible(false);
      panel.backBtn.t.setVisible(false);
      panel.backBtn.hit.setVisible(false);
      if (panel.backBtn.hit?.input) panel.backBtn.hit.disableInteractive();

      panel.turnPicker?.label?.setVisible(false);
      if (panel.turnPicker?.buttons?.length) {
        for (const b of panel.turnPicker.buttons) {
          b.g.setVisible(false);
          b.t.setVisible(false);
          b.hit.setVisible(false);
          if (b.hit?.input) b.hit.disableInteractive();
          if (b.t?.input) b.t.disableInteractive();
        }
      }

      return;
    }

    // =========================================================
    // UNIT MODE (updated stats layout)
    // =========================================================

    panel.weaponLabel.setVisible(true);
    panel.weaponText.setVisible(true);

    const def = getUnitDef(unit.type);
    const displayName = unit.unitName || def?.name || unit.type || 'Unit';
    const level = Number.isFinite(unit.level) ? unit.level : 1;

    // Title: LVL + NAME (top line)
    panel.titleText.setText(`LVL ${fmt(level)} — ${displayName}`);

    // Core values
    const hp = Number.isFinite(unit.hp) ? unit.hp : 0;
    const hpMax = Number.isFinite(unit.maxHp) ? unit.maxHp : (Number.isFinite(unit.hpMax) ? unit.hpMax : 0);

    const mp = Number.isFinite(unit.mp) ? unit.mp : (Number.isFinite(unit.movementPoints) ? unit.movementPoints : 0);
    const mpMax = Number.isFinite(unit.mpMax) ? unit.mpMax : (Number.isFinite(unit.maxMovementPoints) ? unit.maxMovementPoints : 0);

    const ap = Number.isFinite(unit.ap) ? unit.ap : 0;
    const apMax = Number.isFinite(unit.apMax) ? unit.apMax : 1;

    const groupSize = Number.isFinite(unit.groupSize) ? unit.groupSize : (Number.isFinite(def?.groupSize) ? def.groupSize : 1);
    const groupAlive = Number.isFinite(unit.groupAlive) ? unit.groupAlive : groupSize;

    const morale = Number.isFinite(unit.morale) ? unit.morale : 0;
    const moraleMax = Number.isFinite(unit.moraleMax) ? unit.moraleMax : 0;

    // Rows:
    const row1 =
      `AP ${fmt(ap)}/${fmt(apMax)}   ` +
      `MP ${fmt(mp)}/${fmt(mpMax)}   ` +
      `GRP ${fmt(groupAlive)}/${fmt(groupSize)}   ` +
      `HP ${fmt(hp)}/${fmt(hpMax)}   ` +
      `MOR ${fmt(morale)}/${fmt(moraleMax)}`;

    const row2 = getResistsRow(unit);
    const row3 = getStatusesRow(unit);

    panel.statsText.setText([row1, row2, row3].join('\n'));

    // Weapon text
    const weapons = Array.isArray(unit.weapons) ? unit.weapons : [];
    const idx = Number.isFinite(unit.activeWeaponIndex) ? unit.activeWeaponIndex : 0;
    const weaponId = weapons[idx] || weapons[0] || 'lmg';
    const w = getWeaponDef(weaponId);
    panel.weaponText.setText(`${w.name} (${weaponId})`);

    // Switch weapon button visibility
    const sw = panel.buttons.switchWeapon;
    const hasMany = weapons.length > 1;
    sw.g.setVisible(hasMany);
    sw.t.setVisible(hasMany);
    sw.hit.setVisible(hasMany);
    if (sw.hit.input) {
      hasMany ? sw.hit.setInteractive({ useHandCursor: true }) : sw.hit.disableInteractive();
    }
    if (sw.t.input) {
      hasMany ? sw.t.setInteractive({ useHandCursor: true }) : sw.t.disableInteractive();
    }

    // Page visibility
    const page = scene.unitPanelState.page;
    const isRoot = page === 'root';

    // Root buttons visible?
    // (Build will be toggled separately per-unit)
    const rootButtons = ['move', 'defence', 'attack', 'build', 'hide', 'turn', 'activeFolder', 'passiveFolder'];
    for (const k of rootButtons) {
      const b = panel.buttons[k];
      if (!b) continue;
      b.g.setVisible(isRoot);
      b.t.setVisible(isRoot);
      b.hit.setVisible(isRoot);
      if (b.hit.input) {
        isRoot ? b.hit.setInteractive({ useHandCursor: true }) : b.hit.disableInteractive();
      }
      if (b.t.input) {
        isRoot ? b.t.setInteractive({ useHandCursor: true }) : b.t.disableInteractive();
      }
    }

    // Build button: ONLY Mobile Base
    // (your rule: button appears only for Mobile Base; later we'll gate by "Build ability")
    const isMobileBase = String(unit.type || '').toLowerCase() === 'mobile_base';
    const bb = panel.buttons.build;
    if (bb) {
      const vis = isRoot && isMobileBase;
      bb.g.setVisible(vis);
      bb.t.setVisible(vis);
      bb.hit.setVisible(vis);
      if (bb.hit.input) {
        vis ? bb.hit.setInteractive({ useHandCursor: true }) : bb.hit.disableInteractive();
      }
      if (bb.t.input) {
        vis ? bb.t.setInteractive({ useHandCursor: true }) : bb.t.disableInteractive();
      }
    }

    // Subpage text + back
    panel.pageTitle.setVisible(!isRoot);
    panel.pageBody.setVisible(!isRoot);
    panel.backBtn.g.setVisible(!isRoot);
    panel.backBtn.t.setVisible(!isRoot);
    panel.backBtn.hit.setVisible(!isRoot);
    if (panel.backBtn.hit.input) {
      (!isRoot) ? panel.backBtn.hit.setInteractive({ useHandCursor: true }) : panel.backBtn.hit.disableInteractive();
    }
    if (panel.backBtn.t.input) {
      (!isRoot) ? panel.backBtn.t.setInteractive({ useHandCursor: true }) : panel.backBtn.t.disableInteractive();
    }

    // Ability buttons + passive lines default hide
    const abA = panel.buttons.abilityA;
    const abB = panel.buttons.abilityB;
    if (abA) { abA.g.setVisible(false); abA.t.setVisible(false); abA.hit.setVisible(false); abA.hit.disableInteractive(); }
    if (abB) { abB.g.setVisible(false); abB.t.setVisible(false); abB.hit.setVisible(false); abB.hit.disableInteractive(); }
    for (const ln of (panel.passiveLines || [])) ln.setVisible(false);

    if (!isRoot) {
      if (page === 'active') {
        panel.pageTitle.setText('Active abilities');
        const { actives } = getAbilitiesForUnit(unit);

        const a1 = actives[0] || null;
        const a2 = actives[1] || null;

        const makeLabel = (id) => {
          if (!id) return '—';
          const d = getAbilityDef(id);
          if (!d) return id;
          const ic = d.icon ? `${d.icon} ` : '';
          return `${ic}${d.name}`;
        };

        const lines = [];
        if (!actives.length) lines.push('No active abilities.');
        else {
          for (let i = 0; i < Math.min(2, actives.length); i++) {
            const s = summarizeAbility(actives[i]);
            lines.push(`${i + 1}) ${s.title}`);
          }
          lines.push('');
          lines.push('Click an ability → highlighted targets');
          lines.push('Then click a highlighted hex to cast.');
        }
        panel.pageBody.setText(lines.join('\n'));

        if (abA) {
          abA.t.setText(makeLabel(a1));
          abA.g.setVisible(true); abA.t.setVisible(true); abA.hit.setVisible(true);
          if (a1) {
            abA.hit.setInteractive({ useHandCursor: true });
            abA.hit.removeAllListeners('pointerdown');
            abA.hit.on('pointerdown', () => {
              const caster = scene.selectedUnit;
              if (!caster) return;

              scene.attackController?.exit?.('ability_btn');
              clearCombatPreview(scene);

              const d = getAbilityDef(a1);
              __dbg('PLAYER:AbilityBtn', { unitId: caster.id, abilityId: a1, name: d?.name, ap: caster.ap, q: caster.q, r: caster.r });

              const ctrl = scene.abilityController || (scene.abilityController = new AbilityController(scene));
              ctrl.enter(caster, a1);
              scene.refreshUnitActionPanel?.();
            });
          } else {
            abA.hit.disableInteractive();
          }
        }

        if (abB) {
          abB.t.setText(makeLabel(a2));
          abB.g.setVisible(true); abB.t.setVisible(true); abB.hit.setVisible(true);
          if (a2) {
            abB.hit.setInteractive({ useHandCursor: true });
            abB.hit.removeAllListeners('pointerdown');
            abB.hit.on('pointerdown', () => {
              const caster = scene.selectedUnit;
              if (!caster) return;

              scene.attackController?.exit?.('ability_btn');
              clearCombatPreview(scene);

              const d = getAbilityDef(a2);
              __dbg('PLAYER:AbilityBtn', { unitId: caster.id, abilityId: a2, name: d?.name, ap: caster.ap, q: caster.q, r: caster.r });

              const ctrl = scene.abilityController || (scene.abilityController = new AbilityController(scene));
              ctrl.enter(caster, a2);
              scene.refreshUnitActionPanel?.();
            });
          } else {
            abB.hit.disableInteractive();
          }
        }
      } else {
        panel.pageTitle.setText('Passive abilities');
        const { passives } = getAbilitiesForUnit(unit);

        const lines = [];
        if (!passives.length) {
          lines.push('No passive abilities.');
        } else {
          for (let i = 0; i < Math.min(4, passives.length); i++) {
            const d = getAbilityDef(passives[i]);
            const ic = d?.icon ? `${d.icon} ` : '';
            lines.push(`${ic}${d?.name || passives[i]}`);
          }
        }
        panel.pageBody.setText(
          passives.length
            ? 'Passives are always-on.\n(Their effects will be applied by EffectEngine each turn.)'
            : '—'
        );

        const out = [];
        for (let i = 0; i < Math.min(4, passives.length); i++) {
          const d = getAbilityDef(passives[i]);
          const ic = d?.icon ? `${d.icon} ` : '';
          out.push(`${ic}${d?.name || passives[i]}`);
        }
        for (let i = 0; i < (panel.passiveLines || []).length; i++) {
          const ln = panel.passiveLines[i];
          if (!ln) continue;
          ln.setVisible(true);
          ln.setText(out[i] || '');
        }
      }
    }

    // Turn picker visibility
    const tpOpen = !!scene.unitPanelState.turnPickerOpen && isRoot;
    panel.turnPicker.label.setVisible(tpOpen);
    for (const b of panel.turnPicker.buttons) {
      b.g.setVisible(tpOpen);
      b.t.setVisible(tpOpen);
      b.hit.setVisible(tpOpen);
      if (b.hit.input) {
        tpOpen ? b.hit.setInteractive({ useHandCursor: true }) : b.hit.disableInteractive();
      }
      if (b.t.input) {
        tpOpen ? b.t.setInteractive({ useHandCursor: true }) : b.t.disableInteractive();
      }
    }
  };
}

export default {
  setupUnitActionPanel,
};
