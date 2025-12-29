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
//  - Attack: toggles scene.unitCommandMode = 'attack'
//  - Defence: calls applyDefence(unit)
//  - Convoy/Hide: no-op placeholders
//  - Turn: opens direction picker (free)

import { applyDefence } from '../units/UnitActions.js';
import { updateCombatPreview, clearCombatPreview } from './WorldSceneCombatPreview.js';
import { getWeaponDef } from '../units/WeaponDefs.js';
import { AttackController } from '../combat/AttackController.js';

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
function makeTextButton(scene, parent, x, y, w, h, label, onClick) {
  const g = scene.add.graphics();
  g.fillStyle(0x173b52, 1);
  g.fillRoundedRect(x, y, w, h, 10);
  g.lineStyle(2, 0x6fe3ff, 0.7);
  g.strokeRoundedRect(x, y, w, h, 10);

  const t = scene.add.text(x + w / 2, y + h / 2, label, {
    fontSize: '14px',
    color: '#e8f6ff',
    align: 'center',
    wordWrap: { width: w - 10 },
  }).setOrigin(0.5);

  const hit = scene.add.rectangle(x, y, w, h, 0x000000, 0)
    .setOrigin(0, 0)
    .setInteractive({ useHandCursor: true });

  const drawNormal = () => {
    g.clear();
    g.fillStyle(0x173b52, 1);
    g.fillRoundedRect(x, y, w, h, 10);
    g.lineStyle(2, 0x6fe3ff, 0.7);
    g.strokeRoundedRect(x, y, w, h, 10);
  };

  const drawHover = () => {
    g.clear();
    g.fillStyle(0x1a4764, 1);
    g.fillRoundedRect(x, y, w, h, 10);
    g.lineStyle(2, 0x9be4ff, 1);
    g.strokeRoundedRect(x, y, w, h, 10);
  };

  hit.on('pointerover', drawHover);
  hit.on('pointerout', drawNormal);
  hit.on('pointerdown', (pointer, lx, ly, event) => {
    event?.stopPropagation?.();
    onClick?.();
  });

  // Also let label click
  t.setInteractive({ useHandCursor: true });
  t.on('pointerdown', (pointer, lx, ly, event) => {
    event?.stopPropagation?.();
    onClick?.();
  });
  t.on('pointerover', drawHover);
  t.on('pointerout', drawNormal);

  parent.add([g, t, hit]);
  return { g, t, hit, setLabel: (s) => t.setText(s) };
}

function makeTooltip(scene) {
  const c = scene.add.container(0, 0).setDepth(PANEL_DEPTH + 50).setScrollFactor(0);
  const bg = scene.add.graphics();
  const text = scene.add.text(0, 0, '', {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#e8f6ff',
    align: 'left',
  });
  text.setOrigin(0, 0);
  c.add([bg, text]);
  c.visible = false;

  function show(str, x, y) {
    const pad = 8;
    text.setText(str || '');
    const bounds = text.getBounds();
    bg.clear();
    bg.fillStyle(0x050f1a, 0.92);
    bg.fillRoundedRect(-pad, -pad, bounds.width + pad * 2, bounds.height + pad * 2, 10);
    bg.lineStyle(1, 0x34d2ff, 0.9);
    bg.strokeRoundedRect(-pad, -pad, bounds.width + pad * 2, bounds.height + pad * 2, 10);
    c.setPosition(x, y);
    c.visible = true;
  }

  function hide() {
    c.visible = false;
  }

  return { c, text, bg, show, hide };
}

/**
 * Stage C entry point.
 */
export function setupUnitActionPanel(scene) {
  if (!scene) return;

  // Persistent state
  scene.unitPanelState = scene.unitPanelState || {
    page: 'root', // 'root' | 'active' | 'passive'
    turnPickerOpen: false,
  };

  const W = 620;
  const H = 170;

  const container = scene.add.container(0, 0)
    .setScrollFactor(0)
    .setDepth(PANEL_DEPTH);
  container.visible = false;

  // =========================================================
  // LAYERING FIX (CRITICAL)
  // =========================================================
  // makeTextButton() immediately adds its graphics/text/hit objects
  // into `container`. In the earlier version of this file we added
  // the background/bezel AFTER creating buttons, which put the BG on
  // top of buttons (Phaser container render order = child order).
  // That caused exactly the "layers overlap" issue you see.
  //
  // To guarantee correct z-order:
  //  1) Add bg/bezel/blocker FIRST.
  //  2) Create buttons/text afterwards.
  //  3) Keep blocker BELOW buttons so it doesn't steal pointer events.
  // =========================================================

  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.94);
  bg.fillRoundedRect(0, 0, W, H, 14);
  bg.lineStyle(2, 0x3da9fc, 1);
  bg.strokeRoundedRect(0, 0, W, H, 14);

  const bezel = scene.add.graphics();
  bezel.lineStyle(1, 0x9be4ff, 0.22);
  for (let i = 1; i <= 2; i++) {
    bezel.strokeRect(10 * i, 10 * i, W - 20 * i, H - 20 * i);
  }

  // Click-blocker so clicks on empty parts of the panel don't leak into the world.
  // Must stay BELOW buttons/labels in display order.
  const blocker = scene.add.rectangle(0, 0, W, H, 0x000000, 0)
    .setOrigin(0, 0)
    .setInteractive({ useHandCursor: false });
  blocker.on('pointerdown', (pointer, lx, ly, event) => {
    event?.stopPropagation?.();
  });

  // Add base layers FIRST (fixes overlap/"greyed" buttons)
  container.add([bg, bezel, blocker]);

  // Title + stats
  const titleText = scene.add.text(16, 12, 'Unit', {
    fontSize: '18px',
    color: '#e8f6ff',
    fontStyle: 'bold',
  });

  const statsText = scene.add.text(16, 38, '', {
    fontSize: '13px',
    color: '#cfefff',
    fontFamily: 'monospace',
  });

  // Weapon area
  const weaponLabel = scene.add.text(16, 86, 'Weapon:', {
    fontSize: '13px',
    color: '#9be4ff',
    fontFamily: 'monospace',
  });
  const weaponText = scene.add.text(80, 86, '', {
    fontSize: '13px',
    color: '#e8f6ff',
    fontFamily: 'monospace',
  });

  const tooltip = makeTooltip(scene);

  // Keep tooltip near cursor
  scene.input.on('pointermove', (pointer) => {
    if (!tooltip.c.visible) return;
    const x = pointer.x + 14;
    const y = pointer.y + 14;
    tooltip.c.setPosition(x, y);
  });

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
    console.log('[UNITS] Move selected (click-to-move)');
  });

  buttons.defence = makeTextButton(scene, container, colX + (btnW + btnPad) * 1, rowY + (btnH + btnPad) * 0, btnW, btnH, 'Defence', () => {
    const u = scene.selectedUnit;
    if (!u) return;
    const res = applyDefence(u);
    if (!res.ok) {
      console.log('[DEFENCE] failed:', res.reason);
      return;
    }
    scene.refreshUnitActionPanel?.();
  });

  buttons.attack = makeTextButton(scene, container, colX + (btnW + btnPad) * 2, rowY + (btnH + btnPad) * 0, btnW, btnH, 'Attack', () => {
    // Attack button: highlight ENEMIES that are in weapon range for the currently selected unit.
    const u = scene.selectedUnit;
    if (!u) return;

    // This is NOT a toggle: it always enters attack targeting mode and draws highlights.
    scene.unitCommandMode = 'attack';
    updateCombatPreview(scene);
    scene.refreshUnitActionPanel?.();
  });


  buttons.convoy = makeTextButton(scene, container, colX + (btnW + btnPad) * 0, rowY + (btnH + btnPad) * 1, btnW, btnH, 'Convoy', () => {
    console.log('[UNITS] Convoy (placeholder)');
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
    scene.unitPanelState.page = 'active';
    scene.unitPanelState.turnPickerOpen = false;
    scene.refreshUnitActionPanel?.();
  });

  buttons.passiveFolder = makeTextButton(scene, container, colX + (btnW + btnPad) * 2 - (btnW * 1 + btnPad), rowY + (btnH + btnPad) * 2, btnW * 1 + btnPad, btnH, 'Passive\nAbilities', () => {
    scene.unitPanelState.page = 'passive';
    scene.unitPanelState.turnPickerOpen = false;
    scene.refreshUnitActionPanel?.();
  });

  // Switch weapon
  buttons.switchWeapon = makeTextButton(scene, container, 16, 118, 140, 34, 'Switch Weapon', () => {
    const u = scene.selectedUnit;
    const ws = Array.isArray(u?.weapons) ? u.weapons : [];
    if (!u || ws.length <= 1) return;
    const idx = Number.isFinite(u.activeWeaponIndex) ? u.activeWeaponIndex : 0;
    u.activeWeaponIndex = (idx + 1) % ws.length;
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
  const backBtn = makeTextButton(scene, container, colX, 120, 92, 34, 'Back', () => {
    scene.unitPanelState.page = 'root';
    scene.unitPanelState.turnPickerOpen = false;
    scene.refreshUnitActionPanel?.();
  });

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
      // turn is free; no cost
      scene.unitPanelState.turnPickerOpen = false;
      scene.refreshUnitActionPanel?.();
    });
    tp.buttons.push(b);
  }

  // NOTE: bg/bezel/blocker were already added FIRST.
  // Now add UI content above them.
  container.add([titleText, statsText, weaponLabel, weaponText, pageTitle, pageBody, backBtn.g, backBtn.t, backBtn.hit, tp.label]);
  // NOTE: buttons were already added to container in makeTextButton
  // We'll manage visibility per-page.

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

    // Hex can only be inspected when no unit is selected (caller enforces too)
    scene.selectedHex = { q, r };

    // Clear command mode / previews
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
    // HEX INSPECT MODE (no buttons, no weapon, just tile info)
    // =========================================================
    if (hexMode) {
      const q = unit.q;
      const r = unit.r;

      // Title
      const hx = summarizeHex(scene, q, r);
      panel.titleText.setText(hx.title);

      // Stats text (multi-line)
      panel.statsText.setText(hx.lines.join('\n'));

      // Hide weapon area completely
      panel.weaponLabel.setVisible(false);
      panel.weaponText.setVisible(false);

      // Hide switch weapon if present
      const sw = panel.buttons.switchWeapon;
      if (sw) {
        sw.g.setVisible(false);
        sw.t.setVisible(false);
        sw.hit.setVisible(false);
        if (sw.hit?.input) sw.hit.disableInteractive();
        if (sw.t?.input) sw.t.disableInteractive();
      }

      // Hide all action buttons & subpages
      for (const k of Object.keys(panel.buttons || {})) {
        const b = panel.buttons[k];
        if (!b) continue;
        b.g.setVisible(false);
        b.t.setVisible(false);
        b.hit.setVisible(false);
        if (b.hit?.input) b.hit.disableInteractive();
        if (b.t?.input) b.t.disableInteractive();
      }

      panel.pageTitle.setVisible(false);
      panel.pageBody.setVisible(false);
      panel.backBtn.g.setVisible(false);
      panel.backBtn.t.setVisible(false);
      panel.backBtn.hit.setVisible(false);
      if (panel.backBtn.hit?.input) panel.backBtn.hit.disableInteractive();

      // Turn picker hidden too
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
    // UNIT MODE (original behavior)
    // =========================================================

    // Ensure weapon area visible
    panel.weaponLabel.setVisible(true);
    panel.weaponText.setVisible(true);

    // Title
    const nm = unit.unitName || unit.type || 'Unit';
    panel.titleText.setText(nm);

    // Stats
    const hp = Number.isFinite(unit.hp) ? unit.hp : 0;
    const hpMax = Number.isFinite(unit.maxHp) ? unit.maxHp : (Number.isFinite(unit.hpMax) ? unit.hpMax : 0);
    const mp = Number.isFinite(unit.mp) ? unit.mp : (Number.isFinite(unit.movementPoints) ? unit.movementPoints : 0);
    const mpMax = Number.isFinite(unit.mpMax) ? unit.mpMax : (Number.isFinite(unit.maxMovementPoints) ? unit.maxMovementPoints : 0);
    const ap = Number.isFinite(unit.ap) ? unit.ap : 0;
    const apMax = Number.isFinite(unit.apMax) ? unit.apMax : 1;
    const armor = Number.isFinite(unit.armorPoints) ? unit.armorPoints : 0;
    const bonus = Number.isFinite(unit.tempArmorBonus) ? unit.tempArmorBonus : 0;
    const armorClass = unit.armorClass || 'NONE';

    const attackMode = scene.unitCommandMode === 'attack' ? 'ON' : 'OFF';
    const defending = unit.status?.defending ? 'DEF' : '';

    panel.statsText.setText(
      `HP: ${fmt(hp)}/${fmt(hpMax)}   ARM: ${fmt(armor)}${bonus ? `(+${fmt(bonus)})` : ''} (${armorClass})\n` +
      `MP: ${fmt(mp)}/${fmt(mpMax)}   AP: ${fmt(ap)}/${fmt(apMax)}   ${defending}\n` +
      `Mode: Attack ${attackMode}`
    );

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
    const rootButtons = ['move', 'defence', 'attack', 'convoy', 'hide', 'turn', 'activeFolder', 'passiveFolder'];
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

    if (!isRoot) {
      panel.pageTitle.setText(page === 'active' ? 'Active abilities' : 'Passive abilities');
      panel.pageBody.setText('No abilities yet.\n\n(Placeholder folder)');
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
