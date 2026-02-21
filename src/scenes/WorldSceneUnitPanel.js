// src/scenes/WorldSceneUnitPanel.js
// Unit panel UI (sprite-based).
// Uses a pre-rendered background sprite: assets/ui/unit_panel/UnitPanel.png
// All interactive/icon elements are positioned into the grid.
//
// This module is ES-module safe and is imported by WorldScene.

/* eslint-disable no-console */

import {
  UNIT_PANEL_BG_KEY,
  UI_ACTION_KEYS,
  UI_STAT_KEYS,
  UI_RESIST_KEYS,
} from './WorldScenePreload.js';

/* ==========================================================================
   Data helpers (keep compatible with legacy unit fields)
   ========================================================================== */

function safeNum(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

function getUnitDisplayName(unit) {
  return unit?.displayName || unit?.unitName || unit?.name || 'Unit';
}

function getFactionName(unit) {
  return unit?.faction || unit?.ownerName || unit?.playerName || unit?.owner || '';
}

function getTier(unit) {
  return safeNum(unit?.tier, safeNum(unit?.level, safeNum(unit?.lvl, 1)));
}

function getAp(unit) {
  return safeNum(unit?.ap, safeNum(unit?.AP, 0));
}
function getApMax(unit) {
  return safeNum(unit?.apMax, safeNum(unit?.APMax, getAp(unit)));
}

function getMp(unit) {
  if (Number.isFinite(unit?.mp)) return unit.mp;
  if (Number.isFinite(unit?.movementPoints)) return unit.movementPoints;
  return safeNum(unit?.MP, 0);
}
function getMpMax(unit) {
  if (Number.isFinite(unit?.mpMax)) return unit.mpMax;
  if (Number.isFinite(unit?.movementPointsMax)) return unit.movementPointsMax;
  return safeNum(unit?.MPMax, getMp(unit));
}

function getGr(unit) {
  return safeNum(unit?.gr, safeNum(unit?.GR, safeNum(unit?.guard, safeNum(unit?.group, 0))));
}

function getHp(unit) {
  return safeNum(unit?.hp, safeNum(unit?.HP, 0));
}
function getHpMax(unit) {
  return safeNum(unit?.maxHp, safeNum(unit?.hpMax, safeNum(unit?.HPMax, getHp(unit))));
}

function getMo(unit) {
  return safeNum(unit?.mo, safeNum(unit?.MO, safeNum(unit?.morale, 0)));
}

function isEnemy(unit) {
  return !!(unit?.isEnemy || unit?.controller === 'ai');
}

function effectKeyFromInst(inst) {
  const raw = (inst && (inst.defId || inst.effectId || inst.id)) ? String(inst.defId || inst.effectId || inst.id) : '';
  return raw.trim();
}

function buildEffectIconList(scene, unit) {
  const effects = Array.isArray(unit?.effects) ? unit.effects : [];
  const out = [];

  for (const inst of effects) {
    if (!inst) continue;
    const key = effectKeyFromInst(inst);
    if (!key) continue;

    // Prefer exact
    if (scene?.textures?.exists?.(key)) {
      out.push({ key, stacks: safeNum(inst.stacks, 1) });
      continue;
    }

    // Try case tweaks
    const candidates = [
      key,
      key.toLowerCase(),
      key.toUpperCase(),
      key.replace(/_/g, ''),
      key.replace(/_/g, '').replace(/^\w/, c => c.toUpperCase()),
    ];

    let found = null;
    for (const c of candidates) {
      if (c && scene?.textures?.exists?.(c)) { found = c; break; }
    }
    if (found) out.push({ key: found, stacks: safeNum(inst.stacks, 1) });
  }

  return out;
}

function getArmorResists(unit) {
  // Normalize to 3 rows (N/H/B) and 7 damage types.
  const r = unit?.resists || unit?.resistances || null;

  const base = {
    normal: { physical: 0, thermal: 0, toxic: 0, cryo: 0, radiation: 0, energy: 0, corrosion: 0 },
    heavy:  { physical: 0, thermal: 0, toxic: 0, cryo: 0, radiation: 0, energy: 0, corrosion: 0 },
    both:   { physical: 0, thermal: 0, toxic: 0, cryo: 0, radiation: 0, energy: 0, corrosion: 0 },
  };

  if (!r || typeof r !== 'object') return base;

  for (const armorKey of ['normal', 'heavy', 'both']) {
    const src = r[armorKey];
    if (src && typeof src === 'object') {
      for (const dt of Object.keys(base[armorKey])) {
        if (Number.isFinite(src[dt])) base[armorKey][dt] = src[dt];
        else if (Number.isFinite(src[dt?.toUpperCase?.()])) base[armorKey][dt] = src[dt.toUpperCase()];
      }
    }
  }

  return base;
}

/* ==========================================================================
   UI helpers
   ========================================================================== */

function makeLabel(scene, x, y, text, style = {}) {
  return scene.add.text(x, y, text, {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#ffffff',
    ...style,
  }).setOrigin(0, 0);
}

function makeIcon(scene, x, y, key, size = 16) {
  const img = scene.add.image(x, y, key)
    .setOrigin(0, 0)
    .setDisplaySize(size, size);
  return img;
}

function makeHitRect(scene, x, y, w, h, onClick) {
  const hit = scene.add.rectangle(x, y, w, h, 0x000000, 0)
    .setOrigin(0, 0)
    .setInteractive({ useHandCursor: true });
  hit.on('pointerdown', (pointer, lx, ly, event) => {
    event?.stopPropagation?.();
    try { onClick?.(); } catch (e) { console.warn('[UnitPanel] click handler error', e); }
  });
  return hit;
}

function bringToTopSafe(scene, obj) {
  try { scene.children.bringToTop(obj); } catch (_) {}
}

/* ==========================================================================
   Main setup
   ========================================================================== */

export function setupUnitActionPanel(scene) {
  if (!scene) return;
  if (scene.__unitPanelInitialized) return;
  scene.__unitPanelInitialized = true;

  // Background sprite is 601x281; we keep native scale for pixel-perfect alignment.
  const BG_W = 601;
  const BG_H = 281;

  // Place panel at bottom-left with padding.
  const PAD = 12;
  const originX = PAD;
  const originY = Math.max(PAD, scene.scale.height - BG_H - PAD);

  const panel = scene.add.container(originX, originY)
    .setDepth(4200)
    .setScrollFactor(0);
  panel.visible = false;

  // BG sprite (grid)
  const bg = scene.add.image(0, 0, UNIT_PANEL_BG_KEY)
    .setOrigin(0, 0)
    .setScrollFactor(0);

  panel.add(bg);

  // --- Layout grid anchors (based on UnitPanel.png lines) ---
  const X0 = 0;
  const X1 = 200;
  const X2 = 600; // right edge line is at 600 (image width 601 includes border)

  const Y0 = 0;
  const Y1 = 40;
  const Y2 = 80;
  const Y3 = 120;
  const Y4 = 200;
  const Y5 = 280;

  // Helper to compute cell center for right grid (5 columns x 2 rows)
  function cellCenter(col, row) {
    const cellW = 80;
    const cellH = 80;
    const x = X1 + col * cellW;
    const y = (row === 0) ? Y3 : Y4;
    return {
      cx: x + cellW / 2,
      cy: y + cellH / 2,
      x0: x,
      y0: y,
      w: cellW,
      h: cellH,
    };
  }

  // --- Header texts (top-left area) ---
  const nameText = makeLabel(scene, 10, 8, 'Unit', { fontSize: '14px', fontStyle: 'bold' });
  const factionText = makeLabel(scene, 10, 24, 'FACTION', { fontSize: '11px', color: '#cfefff' });
  const lvlIcon = makeIcon(scene, 150, 10, UI_STAT_KEYS.lvl, 14);
  const lvlText = makeLabel(scene, 168, 10, '1', { fontSize: '12px' });

  panel.add([nameText, factionText, lvlIcon, lvlText]);

  // --- Stats row (right, Y1..Y2) : AP / MP / GR / HP / MO ---
  const statKeys = [
    { id: 'ap', key: UI_STAT_KEYS.ap },
    { id: 'mp', key: UI_STAT_KEYS.mp },
    { id: 'gr', key: UI_STAT_KEYS.gr },
    { id: 'hp', key: UI_STAT_KEYS.hp },
    { id: 'mo', key: UI_STAT_KEYS.mo },
  ];

  const statUI = {};
  for (let i = 0; i < statKeys.length; i++) {
    const baseX = X1 + i * 80;
    const icon = makeIcon(scene, baseX + 8, Y1 + 12, statKeys[i].key, 16);
    const text = makeLabel(scene, baseX + 28, Y1 + 12, '0', { fontSize: '12px' });
    panel.add([icon, text]);
    statUI[statKeys[i].id] = { icon, text };
  }

  // --- Resists row (right, Y2..Y3) : 7 icons + numbers in 40px slots ---
  const resistOrder = [
    { id: 'physical', key: UI_RESIST_KEYS.physical },
    { id: 'thermal', key: UI_RESIST_KEYS.thermal },
    { id: 'toxic', key: UI_RESIST_KEYS.toxic },
    { id: 'cryo', key: UI_RESIST_KEYS.cryo },
    { id: 'radiation', key: UI_RESIST_KEYS.radiation },
    { id: 'energy', key: UI_RESIST_KEYS.energy },
    { id: 'corrosion', key: UI_RESIST_KEYS.corrosion },
  ];

  const resistUI = [];
  for (let i = 0; i < resistOrder.length; i++) {
    const baseX = X1 + i * 40;
    const icon = makeIcon(scene, baseX + 12, Y2 + 10, resistOrder[i].key, 16);
    const text = makeLabel(scene, baseX + 12, Y2 + 26, '0', { fontSize: '11px', color: '#ffffff' });
    panel.add([icon, text]);
    resistUI.push({ id: resistOrder[i].id, icon, text });
  }

  // --- Status icons (left, Y2..Y3) : 10 small slots ---
  const maxStatus = 10;
  const statusSlots = [];
  const statusStartX = 10;
  const statusY = Y2 + 10;
  const statusSize = 16;
  const statusGap = 4;
  for (let i = 0; i < maxStatus; i++) {
    const x = statusStartX + i * (statusSize + statusGap);
    const icon = scene.add.image(x, statusY, '__missing__')
      .setOrigin(0, 0)
      .setDisplaySize(statusSize, statusSize);
    icon.visible = false;

    const stacks = makeLabel(scene, x + statusSize, statusY, '', {
      fontSize: '10px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(1, 0);
    stacks.visible = false;

    panel.add([icon, stacks]);
    statusSlots.push({ icon, stacks });
  }

  // --- Action buttons (right big grid): 5 cols x 2 rows ---
  // Matches the original intended layout in your reference screenshot.
  const ACTIONS = [
    // row 0 (Y3..Y4)
    { id: 'defence', label: 'DEFENCE', key: UI_ACTION_KEYS.defence, col: 0, row: 0 },
    { id: 'ambush',  label: 'AMBUSH',  key: UI_ACTION_KEYS.ambush,  col: 1, row: 0 },
    { id: 'end',     label: 'ENDTURN', key: UI_ACTION_KEYS.endturn, col: 2, row: 0 },
    { id: 'heal',    label: 'HEAL',    key: UI_ACTION_KEYS.heal,    col: 3, row: 0 },
    { id: 'turn',    label: 'TURN',    key: UI_ACTION_KEYS.turn,    col: 4, row: 0 },

    // row 1 (Y4..Y5)
    { id: 'dismiss', label: 'DISMISS', key: UI_ACTION_KEYS.dismiss, col: 0, row: 1 },
    { id: 'switch',  label: 'SWITCH',  key: UI_ACTION_KEYS.switch,  col: 1, row: 1 },
    { id: 'build',   label: 'BUILD',   key: UI_ACTION_KEYS.build,   col: 2, row: 1 },
    { id: 'active1', label: 'ACTIVE1', key: null,                  col: 3, row: 1 },
    { id: 'active2', label: 'ACTIVE2', key: null,                  col: 4, row: 1 },
  ];

  const actionButtons = [];
  for (const a of ACTIONS) {
    const c = cellCenter(a.col, a.row);

    const iconSize = 28;
    const iconKey = a.key || '__missing__';
    const icon = scene.add.image(c.cx, c.cy - 8, iconKey)
      .setOrigin(0.5)
      .setDisplaySize(iconSize, iconSize);

    // If there is no texture for this key, we hide it and show only label.
    const label = makeLabel(scene, c.cx, c.y0 + c.h - 18, a.label, {
      fontSize: '10px',
      color: '#ffffff',
    }).setOrigin(0.5, 0);

    const hit = makeHitRect(scene, c.x0 + 2, c.y0 + 2, c.w - 4, c.h - 4, () => onAction(a.id));

    panel.add([icon, label, hit]);
    actionButtons.push({ ...a, icon, label, hit, bounds: c, enabled: true });
  }

  // Optional overlay to absorb clicks behind the panel
  const overlay = scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, 0x000000, 0.001)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(4190);
  overlay.visible = false;
  overlay.setInteractive({ useHandCursor: false });
  overlay.on('pointerdown', (pointer, lx, ly, event) => event?.stopPropagation?.());

  scene.unitPanel = {
    panel,
    bg,
    overlay,
    selectedUnit: null,

    nameText,
    factionText,
    lvlText,
    statUI,
    resistUI,
    statusSlots,
    actionButtons,
  };

  function onAction(actionId) {
    const u = scene.unitPanel?.selectedUnit || scene.selectedUnit || null;
    if (!u) return;

    switch (actionId) {
      case 'defence':
        scene.events?.emit?.('unit_action_defence', { unit: u });
        scene.onUnitDefence?.(u);
        break;
      case 'heal':
        scene.events?.emit?.('unit_action_heal', { unit: u });
        scene.onUnitHeal?.(u);
        break;
      case 'ambush':
        scene.events?.emit?.('unit_action_ambush', { unit: u });
        scene.onUnitAmbush?.(u);
        break;
      case 'build':
        scene.events?.emit?.('unit_action_build', { unit: u });
        scene.onUnitBuild?.(u);
        break;
      case 'turn':
        scene.events?.emit?.('unit_action_turn', { unit: u });
        scene.onUnitTurn?.(u);
        break;
      case 'end':
        scene.endTurn?.();
        break;
      case 'dismiss':
        scene.setSelectedUnit?.(null);
        break;
      case 'active1':
        scene.events?.emit?.('unit_action_active1', { unit: u });
        scene.onUnitActive1?.(u);
        break;
      case 'active2':
        scene.events?.emit?.('unit_action_active2', { unit: u });
        scene.onUnitActive2?.(u);
        break;
      default:
        break;
    }

    scene.refreshUnitActionPanel?.();
  }

  /* ------------------------------------------------------------------------
     Public scene methods (used by WorldScene)
     ------------------------------------------------------------------------ */

  scene.openUnitActionPanel = function openUnitActionPanel(unit) {
    if (!scene.unitPanel) return;
    scene.unitPanel.selectedUnit = unit || null;
    scene.unitPanel.panel.visible = !!unit;
    scene.unitPanel.overlay.visible = !!unit;
    scene.refreshUnitActionPanel?.();
    bringToTopSafe(scene, scene.unitPanel.panel);
  };

  scene.closeUnitActionPanel = function closeUnitActionPanel() {
    if (!scene.unitPanel) return;
    scene.unitPanel.selectedUnit = null;
    scene.unitPanel.panel.visible = false;
    scene.unitPanel.overlay.visible = false;
  };

  scene.refreshUnitActionPanel = function refreshUnitActionPanel() {
    const p = scene.unitPanel;
    if (!p) return;

    const u = p.selectedUnit || scene.selectedUnit || null;

    if (!u) {
      p.panel.visible = false;
      p.overlay.visible = false;
      return;
    }

    p.panel.visible = true;
    p.overlay.visible = true;

    // Header
    p.nameText.setText(getUnitDisplayName(u).toUpperCase());
    const fac = getFactionName(u);
    p.factionText.setText((fac ? fac : 'FACTION').toUpperCase());
    p.lvlText.setText(String(getTier(u)));

    // Stats
    p.statUI.ap.text.setText(`${getAp(u)}/${getApMax(u)}`);
    p.statUI.mp.text.setText(`${getMp(u)}/${getMpMax(u)}`);
    p.statUI.gr.text.setText(String(getGr(u)));
    p.statUI.hp.text.setText(String(getHp(u)));
    p.statUI.mo.text.setText(String(getMo(u)));

    // Resists (show BOTH row by default; you can swap to normal/heavy later)
    const res = getArmorResists(u);
    const row = res.both || res.normal || res.heavy;
    for (const r of p.resistUI) {
      const v = safeNum(row?.[r.id], 0);
      r.text.setText(String(v));
    }

    // Status icons
    const effList = buildEffectIconList(scene, u).slice(0, p.statusSlots.length);
    for (let i = 0; i < p.statusSlots.length; i++) {
      const slot = p.statusSlots[i];
      const info = effList[i] || null;
      if (!info || !scene.textures?.exists?.(info.key)) {
        slot.icon.visible = false;
        slot.stacks.visible = false;
        continue;
      }
      slot.icon.setTexture(info.key);
      slot.icon.visible = true;

      const stacks = safeNum(info.stacks, 1);
      if (stacks > 1) {
        slot.stacks.setText(String(stacks));
        slot.stacks.visible = true;
      } else {
        slot.stacks.visible = false;
      }
    }

    // Action enable/disable
    const enemy = isEnemy(u);
    for (const b of p.actionButtons) {
      let enabled = !enemy;

      if (b.id === 'build') {
        const allowBuild = !!u.canBuild || /base/i.test(getUnitDisplayName(u)) || u.unitType === 'mobile_base';
        enabled = enabled && allowBuild;
      }

      // Active buttons: only if unit defines abilities list (optional)
      if (b.id === 'active1') {
        enabled = enabled && !!(u.abilities?.[0] || u.active1);
      }
      if (b.id === 'active2') {
        enabled = enabled && !!(u.abilities?.[1] || u.active2);
      }

      b.enabled = enabled;

      // Interactivity
      if (enabled) {
        if (!b.hit.input) b.hit.setInteractive({ useHandCursor: true });
        b.hit.setAlpha(1);
      } else {
        if (b.hit.input) b.hit.disableInteractive();
        b.hit.setAlpha(0.35);
      }

      // Icon visibility
      const key = b.key;
      const iconOk = !!key && scene.textures?.exists?.(key);
      b.icon.visible = iconOk;
      // If no icon, label is still shown.
    }
  };

  // No-op hex inspect hook so WorldSceneHistory doesn't crash if not implemented elsewhere
  if (typeof scene.openHexInspectPanel !== 'function') {
    scene.openHexInspectPanel = function openHexInspectPanel() {};
  }
}

export default {
  setupUnitActionPanel,
};
