// src/scenes/WorldSceneUnitPanel.js
//
// Unit panel UI (bottom-center).
//
// Milestone scope:
//  - Build menu (top-left) is removed elsewhere; building is initiated from unit panel.
//  - Show unit header + core stats (AP/MP/Group/HP/Morale) + resistances row.
//  - Show up to 10 status effect icons (from unit.effects -> EffectDefs.icon).
//  - Action buttons are ICONS (from assets/ui/*). Actives are not in folders anymore.
//
// Notes:
//  - No weapon tooltip.
//  - No active/passive abilities pages.
//  - Direction picker (facing) remains; it will be opened from the Turn icon.
//
// Textures expected (loaded in WorldScene.preload):
//  Stats:  ui_stat_lvl ui_stat_ap ui_stat_mp ui_stat_group ui_stat_hp ui_stat_morale
//  Dmg:    ui_dmg_physical ui_dmg_thermal ui_dmg_toxic ui_dmg_cryo ui_dmg_radiation ui_dmg_energy ui_dmg_corrosion
//  Actions ui_action_defence/ui_action_defence_a ui_action_heal/ui_action_heal_a ui_action_ambush/ui_action_ambush_a
//          ui_action_build/ui_action_build_a ui_action_switch/ui_action_switch_a ui_action_turn/ui_action_turn_a
//          ui_action_endturn/ui_action_endturn_a ui_action_dismiss/ui_action_dismiss_a

import { applyDefence } from '../units/UnitActions.js';
import { getEffectDef } from '../effects/EffectDefs.js';

const PANEL_DEPTH = 4200;

// Facing angles (same as before)
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

function getActiveWeaponId(unit) {
  const weapons = Array.isArray(unit?.weapons) ? unit.weapons : [];
  if (!weapons.length) return null;
  const idx = Number.isFinite(unit.activeWeaponIndex) ? unit.activeWeaponIndex : 0;
  return weapons[idx] || weapons[0] || null;
}

/* =========================================================
   IconButton (image-based)
   ========================================================= */

class IconButton {
  /**
   * @param {Phaser.Scene} scene
   * @param {Phaser.GameObjects.Container} container
   * @param {number} x
   * @param {number} y
   * @param {string} keyNormal
   * @param {string} keyActive
   * @param {Function} onClick
   */
  constructor(scene, container, x, y, keyNormal, keyActive, onClick) {
    this.scene = scene;
    this.container = container;
    this.keyNormal = keyNormal;
    this.keyActive = keyActive || keyNormal;
    this.onClick = onClick;

    // background hit area (invisible but makes clicking easy)
    this.hit = scene.add.rectangle(x, y, 44, 44, 0x000000, 0);
    this.hit.setOrigin(0, 0);

    // button icon
    this.icon = scene.add.image(x + 22, y + 22, keyNormal);
    this.icon.setOrigin(0.5, 0.5);

    // scale down if the PNG is large
    const target = 34;
    const w = this.icon.width || 1;
    const h = this.icon.height || 1;
    const s = Math.min(target / w, target / h);
    this.icon.setScale(s);

    container.add([this.hit, this.icon]);

    this.hit.setInteractive({ useHandCursor: true });
    this.hit.on('pointerdown', () => this.onClick?.());

    this._active = false;
    this._enabled = true;
  }

  setActive(on) {
    this._active = !!on;
    const key = this._active ? this.keyActive : this.keyNormal;
    if (this.scene.textures.exists(key)) this.icon.setTexture(key);
    return this;
  }

  setEnabled(on) {
    this._enabled = !!on;
    if (this._enabled) this.hit.setInteractive({ useHandCursor: true });
    else this.hit.disableInteractive();
    this.icon.setAlpha(this._enabled ? 1.0 : 0.35);
    return this;
  }

  setVisible(on) {
    const v = !!on;
    this.hit.setVisible(v);
    this.icon.setVisible(v);
    if (!v) {
      // avoid catching clicks when hidden
      this.hit.disableInteractive();
    }
    return this;
  }

  destroy() {
    try { this.hit?.destroy(); } catch (_) {}
    try { this.icon?.destroy(); } catch (_) {}
  }
}

/* =========================================================
   Status icons (from unit.effects)
   ========================================================= */

function normalizeEffectIdToIconKey(scene, defId) {
  const idRaw = String(defId || '').trim();
  if (!idRaw) return null;
  // Most common: EffectDefs id matches preload key exactly (e.g. PhysicalBleeding)
  if (scene?.textures?.exists?.(idRaw)) return idRaw;

  // Accept uppercase snake ids (e.g. PHYSICAL_BLEEDING) by converting to CamelCase
  if (idRaw.includes('_')) {
    const parts = idRaw.split('_').filter(Boolean);
    const camel = parts.map(p => p ? (p[0] + p.slice(1).toLowerCase()) : '').join('');
    if (camel && scene?.textures?.exists?.(camel)) return camel;
  }

  // Accept lowercased ids (rare)
  const cap = idRaw[0] ? (idRaw[0].toUpperCase() + idRaw.slice(1)) : idRaw;
  if (cap && scene?.textures?.exists?.(cap)) return cap;

  return null;
}

function getUnitStatusIcons(scene, unit, limit = 10) {
  const out = [];
  const list = Array.isArray(unit?.effects) ? unit.effects : [];
  for (const inst of list) {
    if (!inst || inst.disabled) continue;
    const defId = inst.defId || inst.id || null;
    if (!defId) continue;

    // Prefer EffectDefs-provided iconKey if present, otherwise use defId directly
    const def = getEffectDef(defId);
    const prefer = def?.iconKey || def?.icon || defId;
    const key = normalizeEffectIdToIconKey(scene, prefer) || normalizeEffectIdToIconKey(scene, defId);
    if (!key) continue;

    out.push({
      key,
      defId: String(defId),
      stacks: Number.isFinite(inst.stacks) ? inst.stacks : 1,
      duration: Number.isFinite(inst.duration) ? inst.duration : null,
    });

    if (out.length >= limit) break;
  }
  return out;
}

/* =========================================================
   Resist row (temporary default)
   ========================================================= */

function getResists(unit) {
  // Requested temporary rule:
  // - physical shows "4 armor"
  // - everything else 0
  // If you later add real per-type resists, set unit.resists = { physical:4, thermal:..., ... }
  const r = (unit && typeof unit.resists === 'object' && unit.resists) ? unit.resists : null;
  return {
    physical: Number.isFinite(r?.physical) ? r.physical : 4,
    thermal: Number.isFinite(r?.thermal) ? r.thermal : 0,
    toxic: Number.isFinite(r?.toxic) ? r.toxic : 0,
    cryo: Number.isFinite(r?.cryo) ? r.cryo : 0,
    radiation: Number.isFinite(r?.radiation) ? r.radiation : 0,
    energy: Number.isFinite(r?.energy) ? r.energy : 0,
    corrosion: Number.isFinite(r?.corrosion) ? r.corrosion : 0,
  };
}

/* =========================================================
   Facing setter
   ========================================================= */

function setFacing(scene, unit, dirIndex) {
  if (!scene || !unit) return;
  const d = clamp(dirIndex | 0, 0, 5);
  unit.facing = d;
  unit.facingAngle = DIR_ANGLES[d] ?? 0;
  if (typeof unit.rotation === 'number') unit.rotation = unit.facingAngle;
}

/* =========================================================
   Panel setup
   ========================================================= */

export function setupUnitActionPanel(scene) {
  if (scene.unitActionPanel) return;

  // Panel state
  scene.unitPanelState = {
    facingPickerOpen: false,
  };

  const W = 740;
  const H = 210;

  const container = scene.add.container(0, 0).setDepth(PANEL_DEPTH);
  container.visible = false;

  // Ensure we have a tiny transparent texture for placeholder images
  if (!scene.textures.exists('__transparent')) {
    const tg = scene.add.graphics();
    tg.fillStyle(0xffffff, 0);
    tg.fillRect(0, 0, 2, 2);
    tg.generateTexture('__transparent', 2, 2);
    tg.destroy();
  }


  // Background
  const bg = scene.add.graphics();
  bg.fillStyle(0x0b0f1a, 0.82);
  bg.fillRoundedRect(0, 0, W, H, 14);

  const bezel = scene.add.graphics();
  bezel.lineStyle(2, 0x4aa6d8, 0.65);
  bezel.strokeRoundedRect(0, 0, W, H, 14);

  // Input blocker so clicks don't leak to world
  const blocker = scene.add.rectangle(0, 0, W, H, 0x000000, 0);
  blocker.setOrigin(0, 0);
  blocker.setInteractive();

  container.add([bg, bezel, blocker]);

  // Left portrait placeholder (future)
  const portraitBox = scene.add.graphics();
  portraitBox.fillStyle(0x05070f, 0.65);
  portraitBox.fillRoundedRect(14, 14, 86, 86, 10);
  portraitBox.lineStyle(1, 0x2f5f7b, 0.65);
  portraitBox.strokeRoundedRect(14, 14, 86, 86, 10);
  container.add(portraitBox);

  // Header: LVL icon + level + name
  const headerY = 18;
  const headerX = 112;

  const lvlIcon = scene.add.image(headerX, headerY + 8, 'ui_stat_lvl').setOrigin(0, 0.5);
  lvlIcon.setScale(0.6);

  const lvlText = scene.add.text(headerX + 26, headerY, '1', {
    fontSize: '16px',
    color: '#e8f6ff',
    fontFamily: 'monospace',
    fontStyle: 'bold',
  });

  const nameText = scene.add.text(headerX + 56, headerY, 'Unit', {
    fontSize: '18px',
    color: '#e8f6ff',
    fontFamily: 'monospace',
    fontStyle: 'bold',
  });

  container.add([lvlIcon, lvlText, nameText]);

  // Stats row (AP/MP/Group/HP/Morale)
  const statsY = 52;
  const statGap = 116;

  const statBlocks = [
    { key: 'ui_stat_ap', label: 'AP', x: headerX + 0 },
    { key: 'ui_stat_mp', label: 'MP', x: headerX + statGap * 1 },
    { key: 'ui_stat_group', label: 'GR', x: headerX + statGap * 2 },
    { key: 'ui_stat_hp', label: 'HP', x: headerX + statGap * 3 },
    { key: 'ui_stat_morale', label: 'MO', x: headerX + statGap * 4 },
  ];

  const statIcons = [];
  const statTexts = [];
  for (const b of statBlocks) {
    const ic = scene.add.image(b.x, statsY, b.key).setOrigin(0, 0.5);
    ic.setScale(0.62);
    const tx = scene.add.text(b.x + 26, statsY - 10, `${b.label}: 0`, {
      fontSize: '13px',
      color: '#cfefff',
      fontFamily: 'monospace',
    });
    statIcons.push(ic);
    statTexts.push(tx);
    container.add([ic, tx]);
  }

  // Resists row (damage type icons + numbers)
  const resY = 86;
  const resBlocks = [
    { key: 'ui_dmg_physical', id: 'physical', x: headerX + 0 },
    { key: 'ui_dmg_thermal', id: 'thermal', x: headerX + 74 },
    { key: 'ui_dmg_toxic', id: 'toxic', x: headerX + 148 },
    { key: 'ui_dmg_cryo', id: 'cryo', x: headerX + 222 },
    { key: 'ui_dmg_radiation', id: 'radiation', x: headerX + 296 },
    { key: 'ui_dmg_energy', id: 'energy', x: headerX + 370 },
    { key: 'ui_dmg_corrosion', id: 'corrosion', x: headerX + 444 },
  ];

  const resIcons = [];
  const resTexts = [];
  for (const b of resBlocks) {
    const ic = scene.add.image(b.x, resY, b.key).setOrigin(0, 0.5);
    ic.setScale(0.58);
    const tx = scene.add.text(b.x + 24, resY - 10, '0', {
      fontSize: '13px',
      color: '#cfefff',
      fontFamily: 'monospace',
    });
    resIcons.push(ic);
    resTexts.push(tx);
    container.add([ic, tx]);
  }

  // Status effect icons row (10 slots)
  const statusY = 124;
  const statusX0 = 112;
  const statusSlot = 32;

  const statusSlots = [];
  for (let i = 0; i < 10; i++) {
    const x = statusX0 + i * statusSlot;

    const box = scene.add.graphics();
    box.fillStyle(0x05070f, 0.55);
    box.fillRoundedRect(x, statusY, 26, 26, 6);
    box.lineStyle(1, 0x2f5f7b, 0.55);
    box.strokeRoundedRect(x, statusY, 26, 26, 6);

    const icon = scene.add.image(x + 13, statusY + 13, '__transparent')
      .setOrigin(0.5, 0.5);
    // Fit icon into the 26x26 slot with a bit of padding
    icon.setDisplaySize(20, 20);
    icon.setAlpha(1);
    icon.visible = false;

    const stackTxt = scene.add.text(x + 24, statusY + 20, '', {
      fontSize: '11px',
      color: '#e8f6ff',
      fontFamily: 'monospace',
    }).setOrigin(1, 1);
    stackTxt.visible = false;

    container.add([box, icon, stackTxt]);
    statusSlots.push({ box, icon, stackTxt });

  // Right action bar (icons)
  const actionY = 154;
  const actionX0 = W - 16 - (8 * 46); // 8 buttons * 46 spacing
  const actionStep = 46;

  const buttons = {};

  const make = (k, keyN, keyA, onClick) => {
    const b = new IconButton(scene, container, actionX0 + actionStep * k, actionY, keyN, keyA, onClick);
    buttons[k] = b;
    return b;
  };

  // We keep references by name too (more convenient)
  const btn = {};

  // Defence
  btn.defence = new IconButton(scene, container, actionX0 + actionStep * 0, actionY,
    'ui_action_defence', 'ui_action_defence_a',
    () => {
      const u = scene.selectedUnit;
      if (!u) return;
      // any command modes should be off in the new UI
      scene.unitCommandMode = null;

      const res = applyDefence(u);
      console.log('[DEFENCE]', { ok: res.ok, reason: res.reason, heal: res.heal, tempArmorBonus: res.tempArmorBonus, unitId: u.id, q: u.q, r: u.r });
      scene.refreshUnitActionPanel?.();
    }
  );

  // Heal (placeholder for your future heal action)
  btn.heal = new IconButton(scene, container, actionX0 + actionStep * 1, actionY,
    'ui_action_heal', 'ui_action_heal_a',
    () => {
      const u = scene.selectedUnit;
      if (!u) return;
      console.log('[HEAL] placeholder', { unitId: u.id });
      // TODO: hook real heal action here (separate from defence)
      scene.refreshUnitActionPanel?.();
    }
  );

  // Ambush (placeholder)
  btn.ambush = new IconButton(scene, container, actionX0 + actionStep * 2, actionY,
    'ui_action_ambush', 'ui_action_ambush_a',
    () => {
      const u = scene.selectedUnit;
      if (!u) return;
      console.log('[AMBUSH] placeholder', { unitId: u.id });
      // TODO: hook ambush logic here
      scene.refreshUnitActionPanel?.();
    }
  );

  // Build (placeholder; show only for certain units)
  btn.build = new IconButton(scene, container, actionX0 + actionStep * 3, actionY,
    'ui_action_build', 'ui_action_build_a',
    () => {
      const u = scene.selectedUnit;
      if (!u) return;
      console.log('[BUILD] placeholder', { unitId: u.id, type: u.type });
      // TODO: open build picker UI for mobile base
      scene.refreshUnitActionPanel?.();
    }
  );

  // Switch weapon
  btn.switchWeapon = new IconButton(scene, container, actionX0 + actionStep * 4, actionY,
    'ui_action_switch', 'ui_action_switch_a',
    () => {
      const u = scene.selectedUnit;
      const ws = Array.isArray(u?.weapons) ? u.weapons : [];
      if (!u || ws.length <= 1) return;

      const idx = Number.isFinite(u.activeWeaponIndex) ? u.activeWeaponIndex : 0;
      u.activeWeaponIndex = (idx + 1) % ws.length;

      console.log('[WEAPON] switched', { unitId: u.id ?? u.unitId, activeWeaponIndex: u.activeWeaponIndex, weaponId: getActiveWeaponId(u) });
      scene.refreshUnitActionPanel?.();
    }
  );

  // Turn (opens facing picker)
  btn.turn = new IconButton(scene, container, actionX0 + actionStep * 5, actionY,
    'ui_action_turn', 'ui_action_turn_a',
    () => {
      scene.unitPanelState.facingPickerOpen = !scene.unitPanelState.facingPickerOpen;
      scene.refreshUnitActionPanel?.();
    }
  );

  // End turn
  btn.endTurn = new IconButton(scene, container, actionX0 + actionStep * 6, actionY,
    'ui_action_endturn', 'ui_action_endturn_a',
    () => {
      if (typeof scene.endTurn === 'function') scene.endTurn();
    }
  );

  // Dismiss (placeholder)
  btn.dismiss = new IconButton(scene, container, actionX0 + actionStep * 7, actionY,
    'ui_action_dismiss', 'ui_action_dismiss_a',
    () => {
      const u = scene.selectedUnit;
      if (!u) return;
      console.log('[DISMISS] placeholder', { unitId: u.id, type: u.type });
      // TODO: implement dismiss (remove unit) if you want it
      scene.refreshUnitActionPanel?.();
    }
  );

  // Facing picker buttons (6 small icons/text)
  const facing = {
    label: scene.add.text(actionX0, actionY - 30, 'Facing:', {
      fontSize: '13px',
      color: '#9be4ff',
      fontFamily: 'monospace',
    }),
    buttons: [],
  };

  const fpX0 = actionX0 + 70;
  const fpY = actionY - 36;
  const smallW = 34;
  const smallH = 26;
  const smallPad = 6;
  const arrowLabels = ['→', '↘', '↙', '←', '↖', '↗'];

  for (let i = 0; i < 6; i++) {
    const x = fpX0 + i * (smallW + smallPad);

    const g = scene.add.graphics();
    const hit = scene.add.rectangle(x, fpY, smallW, smallH, 0x000000, 0).setOrigin(0, 0);
    const t = scene.add.text(x + smallW / 2, fpY + smallH / 2, arrowLabels[i], {
      fontSize: '15px',
      color: '#e8f6ff',
      fontFamily: 'monospace',
    }).setOrigin(0.5, 0.5);

    const draw = (hover) => {
      g.clear();
      g.fillStyle(hover ? 0x2a3b66 : 0x1a2240, 0.92);
      g.fillRoundedRect(x, fpY, smallW, smallH, 6);
      g.lineStyle(2, hover ? 0x86d6ff : 0x4aa6d8, 0.85);
      g.strokeRoundedRect(x, fpY, smallW, smallH, 6);
    };
    draw(false);

    hit.setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => draw(true));
    hit.on('pointerout', () => draw(false));
    hit.on('pointerdown', () => {
      const u = scene.selectedUnit;
      if (!u) return;
      setFacing(scene, u, i);
      scene.unitPanelState.facingPickerOpen = false;
      scene.refreshUnitActionPanel?.();
    });

    container.add([g, hit, t]);
    facing.buttons.push({ g, hit, t, draw });
  }

  // hide facing by default
  facing.label.setVisible(false);
  for (const b of facing.buttons) {
    b.g.setVisible(false);
    b.hit.setVisible(false);
    b.t.setVisible(false);
    b.hit.disableInteractive();
  }
  container.add(facing.label);

  // Positioning
  const position = () => {
    const cx = scene.scale.width / 2;
    const y = scene.scale.height - H - 14;
    container.setPosition(Math.round(cx - W / 2), Math.round(y));
  };
  position();
  scene.scale.on('resize', position);

  // Store UI handles
  scene.unitActionPanel = {
    container,
    bg,
    bezel,
    blocker,
    portraitBox,
    lvlIcon,
    lvlText,
    nameText,
    statIcons,
    statTexts,
    resIcons,
    resTexts,
    statusSlots,
    buttons: btn,
    facing,
    W,
    H,
  };

  // Public API
  scene.openUnitActionPanel = function (unit) {
    if (!scene.unitActionPanel) return;
    scene.unitPanelState.facingPickerOpen = false;
    scene.unitActionPanel.container.visible = true;
    scene.refreshUnitActionPanel?.(unit);
    scene.children.bringToTop(scene.unitActionPanel.container);
  };

  scene.closeUnitActionPanel = function () {
    if (!scene.unitActionPanel) return;
    scene.unitPanelState.facingPickerOpen = false;
    scene.unitActionPanel.container.visible = false;
  };

  scene.refreshUnitActionPanel = function (unitMaybe) {
    const panel = scene.unitActionPanel;
    if (!panel) return;

    const unit = unitMaybe || scene.selectedUnit;

    if (!unit) {
      scene.closeUnitActionPanel?.();
      return;
    }

    // Header
    const level = Number.isFinite(unit.level) ? unit.level : 1;
    panel.lvlText.setText(String(level));

    const nm = unit.unitName || unit.type || 'Unit';
    panel.nameText.setText(nm);

    // Core stats
    const ap = Number.isFinite(unit.ap) ? unit.ap : 0;
    const apMax = Number.isFinite(unit.apMax) ? unit.apMax : 1;

    const mp = Number.isFinite(unit.mp) ? unit.mp : (Number.isFinite(unit.movementPoints) ? unit.movementPoints : 0);
    const mpMax = Number.isFinite(unit.mpMax) ? unit.mpMax : (Number.isFinite(unit.maxMovementPoints) ? unit.maxMovementPoints : 0);

    const grp = Number.isFinite(unit.groupSize) ? unit.groupSize : (Number.isFinite(unit.stack) ? unit.stack : 1);
    const hp = Number.isFinite(unit.hp) ? unit.hp : 0;
    const hpMax = Number.isFinite(unit.maxHp) ? unit.maxHp : (Number.isFinite(unit.hpMax) ? unit.hpMax : 0);
    const morale = Number.isFinite(unit.morale) ? unit.morale : 0;

    // statTexts order matches statBlocks: AP, MP, GR, HP, MO
    panel.statTexts[0].setText(`AP: ${fmt(ap)}/${fmt(apMax)}`);
    panel.statTexts[1].setText(`MP: ${fmt(mp)}/${fmt(mpMax)}`);
    panel.statTexts[2].setText(`GR: ${fmt(grp)}`);
    panel.statTexts[3].setText(`HP: ${fmt(hp)}/${fmt(hpMax)}`);
    panel.statTexts[4].setText(`MO: ${fmt(morale)}`);

    // Resists
    const res = getResists(unit);
    panel.resTexts[0].setText(fmt(res.physical));
    panel.resTexts[1].setText(fmt(res.thermal));
    panel.resTexts[2].setText(fmt(res.toxic));
    panel.resTexts[3].setText(fmt(res.cryo));
    panel.resTexts[4].setText(fmt(res.radiation));
    panel.resTexts[5].setText(fmt(res.energy));
    panel.resTexts[6].setText(fmt(res.corrosion));


    // Status icons (from unit.effects). Preloaded in WorldScene.preload() under keys like 'PhysicalBleeding'.
    const icons = getUnitStatusIcons(scene, unit, panel.statusSlots.length);
    for (let i = 0; i < panel.statusSlots.length; i++) {
      const slot = panel.statusSlots[i];
      const icon = icons[i] || null;
      if (!icon) {
        slot.icon.visible = false;
        slot.stackTxt.visible = false;
        continue;
      }

      try {
        slot.icon.setTexture(icon.key);
        slot.icon.visible = true;
      } catch (_e) {
        slot.icon.visible = false;
      }

      const showStacks = (Number.isFinite(icon.stacks) && icon.stacks > 1);
      if (showStacks) {
        slot.stackTxt.setText(String(icon.stacks));
        slot.stackTxt.visible = true;
      } else {
        slot.stackTxt.setText('');
        slot.stackTxt.visible = false;
      }
    }


    // Action bar states / visibility
    // Defence active state (if unit.status.defending exists)
    const defending = !!(unit.status && unit.status.defending);
    panel.buttons.defence.setActive(defending);

    // Heal / Ambush (toggle hooks can be wired later)
    panel.buttons.heal.setActive(false);
    panel.buttons.ambush.setActive(false);

    // Build shown only for mobile base (or any unit with canBuild flag)
    const canBuild = (String(unit.type || '').toLowerCase().includes('mobile_base')) || !!unit.canBuild;
    panel.buttons.build.setVisible(canBuild);

    // Switch weapon shown only if >1 weapon
    const ws = Array.isArray(unit.weapons) ? unit.weapons : [];
    panel.buttons.switchWeapon.setVisible(ws.length > 1);

    // Turn always visible
    panel.buttons.turn.setVisible(true);

    // End turn always visible
    panel.buttons.endTurn.setVisible(true);

    // Dismiss visible for non-enemy (you can change rule)
    const isEnemy = !!(unit.isEnemy || unit.controller === 'ai');
    panel.buttons.dismiss.setVisible(!isEnemy);

    // Facing picker
    const fpOpen = !!scene.unitPanelState.facingPickerOpen;
    panel.facing.label.setVisible(fpOpen);
    for (const b of panel.facing.buttons) {
      b.g.setVisible(fpOpen);
      b.hit.setVisible(fpOpen);
      b.t.setVisible(fpOpen);
      if (fpOpen) b.hit.setInteractive({ useHandCursor: true });
      else b.hit.disableInteractive();
    }
  };
}
