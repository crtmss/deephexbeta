// src/scenes/WorldSceneUnitPanel.js
//
// New Unit Panel (v2) — aligned to your target UX.
// - No Build menu.
// - No Active/Passive "folder" pages.
// - Passives are displayed as STATUS EFFECTS (from EffectEngine / unit.effects).
// - Actives are buttons on the same row as Defence/Attack/etc.
// - Weapon tooltip removed.
// - Facing (Turn picker) kept, but controlled from this panel.
//
// NOTE:
// - Portraits are intentionally NOT implemented yet (you asked to postpone).
// - Status icons are shown using EffectDefs.icon (emoji for now).
// - Later we will replace buttons with UI icons from UI.rar and add pressed states.
//
// Compatibility:
// - Keeps scene.openUnitActionPanel(unit), scene.closeUnitActionPanel(), scene.refreshUnitActionPanel()
// - Keeps scene.openHexInspectPanel(q,r) for WorldSceneHistory.js

import { applyDefence } from '../units/UnitActions.js';
import { updateCombatPreview, clearCombatPreview } from './WorldSceneCombatPreview.js';
import { getWeaponDef } from '../units/WeaponDefs.js';
import { AttackController } from '../combat/AttackController.js';

// Actives as buttons in the same row
import { getAbilityDef } from '../abilities/AbilityDefs.js';
import { AbilityController } from '../abilities/AbilityController.js';

// Status effects (passives, DOTs, debuffs etc.)
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

function asInt(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

function getActiveWeaponId(unit) {
  const weapons = Array.isArray(unit?.weapons) ? unit.weapons : [];
  if (!weapons.length) return null;
  const idx = Number.isFinite(unit?.activeWeaponIndex) ? unit.activeWeaponIndex : 0;
  return weapons[idx] || weapons[0] || null;
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

function isHexInspect(obj) {
  return !!(obj && obj.__hexInspect && Number.isFinite(obj.q) && Number.isFinite(obj.r));
}

function makeHexInspectObj(q, r) {
  return { __hexInspect: true, q, r };
}

function getTileAt(scene, q, r) {
  return (scene.mapData || []).find(t => t && t.q === q && t.r === r) || null;
}

function summarizeHex(scene, q, r) {
  const t = getTileAt(scene, q, r);
  if (!t) return { title: `Hex (${q}, ${r})`, lines: ['Tile not found.'] };

  const terrain = t.type || 'unknown';
  const ground = t.groundType || '—';
  const elev =
    Number.isFinite(t.visualElevation) ? t.visualElevation :
    (Number.isFinite(t.elevation) ? t.elevation :
    (Number.isFinite(t.baseElevation) ? t.baseElevation : 0));

  const flags = [];
  if (t.hasRoad) flags.push('Road');
  if (t.hasForest) flags.push('Forest');
  if (t.hasSettlement) flags.push(`Settlement${t.settlementName ? ` (${t.settlementName})` : ''}`);
  if (t.hasRuin) flags.push('Ruin');
  if (t.hasRaiderCamp) flags.push('Raider camp');
  if (t.hasRoadsideCamp) flags.push('Roadside camp');
  if (t.hasWatchtower) flags.push('Watchtower');
  if (t.hasMinePOI) flags.push('Mine');
  if (t.hasShrine) flags.push('Shrine');

  const lines = [];
  lines.push(`Terrain: ${terrain}   Ground: ${ground}`);
  lines.push(`Elevation: ${fmt(elev)}   Underwater: ${t.isUnderWater ? 'YES' : 'NO'}`);
  lines.push(`Features: ${flags.length ? flags.join(', ') : '—'}`);

  const res = (scene.resources || []).filter(o => o && o.q === q && o.r === r);
  if (res.length) {
    const names = res.map(o => o.name || o.type || o.kind || 'resource');
    lines.push(`Resources: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` +${names.length - 5}` : ''}`);
  } else {
    lines.push(`Resources: —`);
  }

  const objs = (scene.mapInfo?.objects || []).filter(o => o && o.q === q && o.r === r);
  if (objs.length) {
    const names = objs.map(o => o.name || o.type || 'object');
    lines.push(`Map objects: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` +${names.length - 4}` : ''}`);
  }

  return { title: `Hex (${q}, ${r})`, lines };
}

/**
 * Simple button (text for now; later replaced by icon buttons).
 * Supports enabled/disabled and "active" visual mode (pressed).
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

  const state = {
    enabled: true,
    active: false,
    label,
  };

  const draw = () => {
    g.clear();

    const fill = state.enabled
      ? (state.active ? 0x335b88 : 0x1a2240)
      : 0x101522;

    const alpha = state.enabled ? 0.92 : 0.55;
    const stroke = state.enabled ? (state.active ? 0x9de6ff : 0x4aa6d8) : 0x2b3a4a;

    g.fillStyle(fill, alpha);
    g.fillRoundedRect(x, y, w, h, 8);
    g.lineStyle(2, stroke, 0.85);
    g.strokeRoundedRect(x, y, w, h, 8);

    t.setColor(state.enabled ? '#e8f6ff' : '#7f93a3');
  };
  draw();

  hit.setPosition(x, y);
  t.setPosition(x + w / 2, y + h / 2);

  container.add([g, hit, t]);

  const setEnabled = (v) => {
    state.enabled = !!v;
    if (state.enabled) hit.setInteractive({ useHandCursor: true });
    else hit.disableInteractive();
    draw();
  };

  const setActive = (v) => {
    state.active = !!v;
    draw();
  };

  const setLabel = (txt) => {
    state.label = String(txt ?? '');
    t.setText(state.label);
    draw();
  };

  hit.setInteractive({ useHandCursor: true });
  hit.on('pointerdown', () => {
    if (!state.enabled) return;
    onClick?.();
  });

  return { g, hit, t, setEnabled, setActive, setLabel, state };
}

/**
 * Reads status effects from unit.effects and returns up to 10 icons.
 * Uses EffectDefs.icon (emoji for now).
 */
function getStatusIcons(unit, maxIcons = 10) {
  const out = [];
  const list = Array.isArray(unit?.effects) ? unit.effects : [];
  for (const inst of list) {
    if (!inst || inst.disabled) continue;
    const def = getEffectDef(inst.defId);
    if (!def) continue;
    const ic = def.icon || '•';
    out.push(ic);
    if (out.length >= maxIcons) break;
  }
  return out;
}

/**
 * Extract resists from unit.resists (or unit.resistances), normalize keys.
 * Damage types required by your spec:
 * physical, thermal, toxic, cryo, radiation, energy, corrosion
 */
function getResists(unit) {
  const raw =
    (unit && typeof unit.resists === 'object' && unit.resists) ? unit.resists :
    (unit && typeof unit.resistances === 'object' && unit.resistances) ? unit.resistances :
    null;

  const r = (k) => (raw && Number.isFinite(raw[k])) ? raw[k] : 0;

  // Accept toxin/toxic alias
  const tox = Number.isFinite(raw?.toxic) ? raw.toxic : (Number.isFinite(raw?.toxin) ? raw.toxin : 0);

  return {
    physical: r('physical'),
    thermal: r('thermal'),
    toxic: tox,
    cryo: r('cryo'),
    radiation: r('radiation'),
    energy: r('energy'),
    corrosion: r('corrosion'),
  };
}

function getUnitLevel(unit) {
  // for now: always 1 per your instruction
  // later: we’ll implement level-up on kills
  return 1;
}

function getGroup(unit) {
  // new stat: size of squad
  // fallback 1 for heavy units
  return Number.isFinite(unit?.group) ? asInt(unit.group, 1) : 1;
}

function getMorale(unit) {
  // new stat: morale (for now always 0)
  return Number.isFinite(unit?.morale) ? asInt(unit.morale, 0) : 0;
}

/**
 * Unit panel setup
 */
export function setupUnitActionPanel(scene) {
  if (scene.unitActionPanel) return;

  // Panel state
  scene.unitPanelState = {
    turnPickerOpen: false,
  };

  // Container dims (tuned for new layout)
  const W = 760;
  const H = 190;

  const container = scene.add.container(0, 0).setDepth(PANEL_DEPTH);
  container.visible = false;

  // Background
  const bg = scene.add.graphics();
  bg.fillStyle(0x0b0f1a, 0.86);
  bg.fillRoundedRect(0, 0, W, H, 14);

  // Bezel
  const bezel = scene.add.graphics();
  bezel.lineStyle(2, 0x4aa6d8, 0.65);
  bezel.strokeRoundedRect(0, 0, W, H, 14);

  // Input blocker
  const blocker = scene.add.rectangle(0, 0, W, H, 0x000000, 0);
  blocker.setOrigin(0, 0);
  blocker.setInteractive();

  container.add([bg, bezel, blocker]);

  // Left portrait placeholder (no portrait yet)
  const portraitBox = scene.add.graphics();
  portraitBox.fillStyle(0x111827, 0.9);
  portraitBox.fillRoundedRect(14, 14, 92, 92, 10);
  portraitBox.lineStyle(2, 0x294a63, 0.9);
  portraitBox.strokeRoundedRect(14, 14, 92, 92, 10);

  const portraitHint = scene.add.text(14 + 46, 14 + 46, '—', {
    fontSize: '22px',
    color: '#5d7687',
    fontFamily: 'monospace',
  });
  portraitHint.setOrigin(0.5, 0.5);

  // Header (Level + Name)
  const headerText = scene.add.text(120, 14, 'LVL 1 — Unit', {
    fontSize: '18px',
    color: '#e8f6ff',
    fontStyle: 'bold',
  });

  // Row 1: AP/MP/Group/HP/Morale
  const coreStatsText = scene.add.text(120, 42, '', {
    fontSize: '13px',
    color: '#cfefff',
    fontFamily: 'monospace',
  });

  // Row 2: Resists
  const resistText = scene.add.text(120, 66, '', {
    fontSize: '13px',
    color: '#9be4ff',
    fontFamily: 'monospace',
  });

  // Row 3: Status icons (up to 10)
  const statusText = scene.add.text(120, 92, '', {
    fontSize: '18px',
    color: '#e8f6ff',
    fontFamily: 'monospace',
  });

  // Weapon line (no tooltip)
  const weaponLabel = scene.add.text(120, 122, 'Weapon:', {
    fontSize: '13px',
    color: '#9be4ff',
    fontFamily: 'monospace',
  });

  const weaponText = scene.add.text(184, 122, '—', {
    fontSize: '13px',
    color: '#e8f6ff',
    fontFamily: 'monospace',
  });

  // Right-side action bar (buttons)
  const btnW = 94;
  const btnH = 34;
  const btnPad = 8;

  // Right edge alignment
  const rightX = W - 14 - (btnW * 3 + btnPad * 2);
  const topY = 14;

  const buttons = {};

  // Row 1 actions
  buttons.move = makeTextButton(scene, container, rightX + (btnW + btnPad) * 0, topY + (btnH + btnPad) * 0, btnW, btnH, 'Move', () => {
    scene.unitCommandMode = null;
    scene.attackController?.exit?.('move');
    scene.abilityController?.exit?.('move');
    clearCombatPreview(scene);
    scene.refreshUnitActionPanel?.();
  });

  buttons.attack = makeTextButton(scene, container, rightX + (btnW + btnPad) * 1, topY + (btnH + btnPad) * 0, btnW, btnH, 'Attack', () => {
    const u = scene.selectedUnit;
    if (!u) return;

    // leave any ability targeting
    scene.abilityController?.exit?.('attack_btn');

    const ac = scene.attackController || (scene.attackController = new AttackController(scene));
    ac.enter(u);

    updateCombatPreview(scene);
    scene.refreshUnitActionPanel?.();
  });

  buttons.defence = makeTextButton(scene, container, rightX + (btnW + btnPad) * 2, topY + (btnH + btnPad) * 0, btnW, btnH, 'Defence', () => {
    const u = scene.selectedUnit;
    if (!u) return;

    // leave modes
    scene.attackController?.exit?.('defence');
    scene.abilityController?.exit?.('defence');
    scene.unitCommandMode = null;
    clearCombatPreview(scene);

    applyDefence(u);
    scene.refreshUnitActionPanel?.();
  });

  // Row 2 actions (2 ability slots + Turn)
  buttons.ability1 = makeTextButton(scene, container, rightX + (btnW + btnPad) * 0, topY + (btnH + btnPad) * 1, btnW, btnH, '—', () => {});
  buttons.ability2 = makeTextButton(scene, container, rightX + (btnW + btnPad) * 1, topY + (btnH + btnPad) * 1, btnW, btnH, '—', () => {});

  buttons.turn = makeTextButton(scene, container, rightX + (btnW + btnPad) * 2, topY + (btnH + btnPad) * 1, btnW, btnH, 'Turn', () => {
    scene.unitPanelState.turnPickerOpen = !scene.unitPanelState.turnPickerOpen;
    scene.refreshUnitActionPanel?.();
  });

  // Row 3 actions: Switch weapon + placeholders (future: Heal / End Turn etc.)
  buttons.switchWeapon = makeTextButton(scene, container, rightX + (btnW + btnPad) * 0, topY + (btnH + btnPad) * 2, btnW * 2 + btnPad, btnH, 'Switch Weapon', () => {
    const u = scene.selectedUnit;
    const ws = Array.isArray(u?.weapons) ? u.weapons : [];
    if (!u || ws.length <= 1) return;

    const idx = Number.isFinite(u.activeWeaponIndex) ? u.activeWeaponIndex : 0;
    u.activeWeaponIndex = (idx + 1) % ws.length;

    // refresh attack highlights if in attack mode
    if (scene.unitCommandMode === 'attack') {
      scene.attackController?.enter?.(u);
      updateCombatPreview(scene);
    }

    scene.refreshUnitActionPanel?.();
  });

  buttons.extra = makeTextButton(scene, container, rightX + (btnW + btnPad) * 2, topY + (btnH + btnPad) * 2, btnW, btnH, '—', () => {
    // reserved slot (future: Heal / End Turn / Build etc.)
  });
  buttons.extra.setEnabled(false);

  // Turn picker (6 buttons)
  const turnPicker = {
    label: scene.add.text(120, 150, 'Facing:', {
      fontSize: '13px',
      color: '#9be4ff',
      fontFamily: 'monospace',
    }),
    buttons: [],
  };

  const tpX = 184;
  const tpY = 142;
  const smallW = 44;
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
    turnPicker.buttons.push(b);
  }

  // Add UI elements
  container.add([
    portraitBox,
    portraitHint,
    headerText,
    coreStatsText,
    resistText,
    statusText,
    weaponLabel,
    weaponText,
    turnPicker.label,
  ]);

  // Positioning
  const position = () => {
    const cx = scene.scale.width / 2;
    const y = scene.scale.height - H - 14;
    container.setPosition(Math.round(cx - W / 2), Math.round(y));
  };
  position();
  scene.scale.on('resize', position);

  // Store handles
  scene.unitActionPanel = {
    container,
    bg,
    bezel,
    blocker,
    portraitBox,
    portraitHint,
    headerText,
    coreStatsText,
    resistText,
    statusText,
    weaponLabel,
    weaponText,
    buttons,
    turnPicker,
    W,
    H,
  };

  // API
  scene.openUnitActionPanel = function (unit) {
    if (!scene.unitActionPanel) return;
    scene.unitPanelState.turnPickerOpen = false;
    scene.unitActionPanel.container.visible = true;
    scene.refreshUnitActionPanel?.(unit);
    scene.children.bringToTop(scene.unitActionPanel.container);
  };

  scene.openHexInspectPanel = function (q, r) {
    if (!scene.unitActionPanel) return;
    if (!Number.isFinite(q) || !Number.isFinite(r)) return;

    scene.selectedHex = { q, r };

    // Clear modes
    scene.unitCommandMode = null;
    scene.clearPathPreview?.();

    const obj = makeHexInspectObj(q, r);
    scene.unitPanelState.turnPickerOpen = false;
    scene.unitActionPanel.container.visible = true;
    scene.refreshUnitActionPanel?.(obj);
    scene.children.bringToTop(scene.unitActionPanel.container);
  };

  scene.closeUnitActionPanel = function () {
    if (!scene.unitActionPanel) return;
    scene.unitPanelState.turnPickerOpen = false;
    scene.unitActionPanel.container.visible = false;
  };

  // Renders unit OR hex-inspect
  scene.refreshUnitActionPanel = function (unitMaybe) {
    const panel = scene.unitActionPanel;
    if (!panel) return;

    const unit = unitMaybe || scene.selectedUnit;

    // Hide if nothing selected
    if (!unit) {
      scene.closeUnitActionPanel?.();
      return;
    }

    // =============================
    // HEX INSPECT MODE
    // =============================
    if (isHexInspect(unit)) {
      const q = unit.q;
      const r = unit.r;

      const hx = summarizeHex(scene, q, r);
      panel.headerText.setText(hx.title);

      // Show hex info in core text; hide other rows
      panel.coreStatsText.setText(hx.lines.join('\n'));
      panel.resistText.setText('');
      panel.statusText.setText('');
      panel.weaponLabel.setVisible(false);
      panel.weaponText.setVisible(false);

      // Hide portrait placeholders (optional: keep visible, but meaningless)
      panel.portraitHint.setText('⬡');

      // Hide all buttons
      for (const k of Object.keys(panel.buttons || {})) {
        const b = panel.buttons[k];
        if (!b) continue;
        b.g.setVisible(false);
        b.t.setVisible(false);
        b.hit.setVisible(false);
        b.setEnabled(false);
      }

      // Hide turn picker
      panel.turnPicker.label.setVisible(false);
      for (const b of panel.turnPicker.buttons) {
        b.g.setVisible(false);
        b.t.setVisible(false);
        b.hit.setVisible(false);
        b.setEnabled(false);
      }

      return;
    }

    // =============================
    // UNIT MODE
    // =============================
    panel.weaponLabel.setVisible(true);
    panel.weaponText.setVisible(true);

    // Title: LVL + name
    const lvl = getUnitLevel(unit);
    const nm = unit.unitName || unit.name || unit.type || 'Unit';
    panel.headerText.setText(`LVL ${lvl} — ${nm}`);

    // Core stats row
    const hp = Number.isFinite(unit.hp) ? unit.hp : 0;
    const hpMax = Number.isFinite(unit.maxHp) ? unit.maxHp : (Number.isFinite(unit.hpMax) ? unit.hpMax : 0);

    const mp = Number.isFinite(unit.mp) ? unit.mp : (Number.isFinite(unit.movementPoints) ? unit.movementPoints : 0);
    const mpMax = Number.isFinite(unit.mpMax) ? unit.mpMax : (Number.isFinite(unit.maxMovementPoints) ? unit.maxMovementPoints : 0);

    const ap = Number.isFinite(unit.ap) ? unit.ap : 0;
    const apMax = Number.isFinite(unit.apMax) ? unit.apMax : 1;

    const group = getGroup(unit);
    const morale = getMorale(unit);

    panel.coreStatsText.setText(
      `AP ${fmt(ap)}/${fmt(apMax)}    MP ${fmt(mp)}/${fmt(mpMax)}    GROUP ${fmt(group)}    HP ${fmt(hp)}/${fmt(hpMax)}    MORALE ${fmt(morale)}`
    );

    // Resist row
    const rs = getResists(unit);
    panel.resistText.setText(
      `RESISTS: PHY ${fmt(rs.physical)}  THR ${fmt(rs.thermal)}  TOX ${fmt(rs.toxic)}  CRYO ${fmt(rs.cryo)}  RAD ${fmt(rs.radiation)}  ENG ${fmt(rs.energy)}  CORR ${fmt(rs.corrosion)}`
    );

    // Status row (up to 10 icons)
    const icons = getStatusIcons(unit, 10);
    panel.statusText.setText(icons.length ? icons.join(' ') : '');

    // Weapon label
    const wid = getActiveWeaponId(unit);
    const w = wid ? getWeaponDef(wid) : null;
    panel.weaponText.setText(w ? `${w.name} (${wid})` : '—');

    // Switch weapon button visibility
    const ws = Array.isArray(unit?.weapons) ? unit.weapons : [];
    const hasManyWeapons = ws.length > 1;
    panel.buttons.switchWeapon.g.setVisible(hasManyWeapons);
    panel.buttons.switchWeapon.t.setVisible(hasManyWeapons);
    panel.buttons.switchWeapon.hit.setVisible(hasManyWeapons);
    panel.buttons.switchWeapon.setEnabled(hasManyWeapons);

    // Buttons visible/enabled
    const btnKeys = Object.keys(panel.buttons || {});
    for (const k of btnKeys) {
      const b = panel.buttons[k];
      if (!b) continue;
      // show all by default (except extra disabled slot is always visible but disabled)
      if (k === 'extra') {
        b.g.setVisible(true); b.t.setVisible(true); b.hit.setVisible(true);
        b.setEnabled(false);
      } else if (k === 'switchWeapon') {
        // already handled
      } else {
        b.g.setVisible(true); b.t.setVisible(true); b.hit.setVisible(true);
        b.setEnabled(true);
      }
    }

    // Highlight current modes on buttons
    panel.buttons.attack.setActive(scene.unitCommandMode === 'attack');
    panel.buttons.move.setActive(!scene.unitCommandMode);
    panel.buttons.defence.setActive(!!unit?.status?.defending);

    // Ability buttons in the action row (up to 2)
    const actives = Array.isArray(unit?.activeAbilities) ? unit.activeAbilities : [];
    const a1 = actives[0] || null;
    const a2 = actives[1] || null;

    const applyAbilityButton = (btn, abilityId) => {
      if (!btn) return;

      if (!abilityId) {
        btn.setLabel('—');
        btn.setEnabled(false);
        btn.setActive(false);
        return;
      }

      const def = getAbilityDef(abilityId);
      const label = def?.icon ? `${def.icon} ${def.name}` : (def?.name || abilityId);

      btn.setLabel(label);
      btn.setEnabled(true);

      // set active if we are in this ability mode
      const mode = String(scene.unitCommandMode || '');
      btn.setActive(mode === `ability:${abilityId}`);

      // replace click behavior
      btn.hit.removeAllListeners('pointerdown');
      btn.hit.on('pointerdown', () => {
        const caster = scene.selectedUnit;
        if (!caster) return;

        // leave attack mode
        scene.attackController?.exit?.('ability_btn');
        clearCombatPreview(scene);

        // enter ability targeting
        const ctrl = scene.abilityController || (scene.abilityController = new AbilityController(scene));
        ctrl.enter(caster, abilityId);

        // mark mode (AbilityController may also set this, but we keep it consistent)
        scene.unitCommandMode = `ability:${abilityId}`;

        scene.refreshUnitActionPanel?.();
      });
    };

    applyAbilityButton(panel.buttons.ability1, a1);
    applyAbilityButton(panel.buttons.ability2, a2);

    // Turn picker visibility
    const tpOpen = !!scene.unitPanelState.turnPickerOpen;
    panel.turnPicker.label.setVisible(tpOpen);
    for (const b of panel.turnPicker.buttons) {
      b.g.setVisible(tpOpen);
      b.t.setVisible(tpOpen);
      b.hit.setVisible(tpOpen);
      b.setEnabled(tpOpen);
    }
  };
}

export default {
  setupUnitActionPanel,
};
