// src/scenes/WorldSceneUnitPanel.js
//
// Unit panel UI (sprite-based).
// Renders a single background sprite (assets/ui/unit_panel/UnitPanel.png)
// and positions icons/text strictly by coordinates on that sprite.
//
// Exposes:
//   setupUnitActionPanel(scene)
// which installs on scene:
//   - openUnitActionPanel(unit)
//   - closeUnitActionPanel()
//   - refreshUnitActionPanel()
//
/* eslint-disable no-console */

// Texture keys (must be preloaded in WorldScenePreload.js)
const TEX_PANEL_BG = 'ui_unit_panel_bg';

// Stats icons
const TEX_STAT_AP = 'ui_stat_ap';
const TEX_STAT_MP = 'ui_stat_mp';
const TEX_STAT_GR = 'ui_stat_gr';
const TEX_STAT_HP = 'ui_stat_hp';
const TEX_STAT_MO = 'ui_stat_mo';

// Resist icons (7)
const RESIST_ORDER = [
  { id: 'physical', tex: 'ui_resist_phy' },
  { id: 'thermal', tex: 'ui_resist_thr' },
  { id: 'toxic', tex: 'ui_resist_tox' },
  { id: 'cryo', tex: 'ui_resist_cry' },
  { id: 'radiation', tex: 'ui_resist_rad' },
  { id: 'energy', tex: 'ui_resist_eng' },
  { id: 'corrosive', tex: 'ui_resist_cor' },
];

// Action button textures (PNG already includes labels)
const ACTIONS = [
  { id: 'defence', key: 'ui_action_defence' },
  { id: 'ambush', key: 'ui_action_ambush' },
  { id: 'endturn', key: 'ui_action_endturn' },
  { id: 'heal', key: 'ui_action_heal' },
  { id: 'turn', key: 'ui_action_turn' },
  { id: 'dismiss', key: 'ui_action_dismiss' },
  { id: 'switch', key: 'ui_action_switch' },
  { id: 'build', key: 'ui_action_build' },
  { id: 'active1', key: 'ui_action_active1' },
  { id: 'active2', key: 'ui_action_active2' },
];

function safeNum(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

function getHp(u) {
  return safeNum(u?.hp, safeNum(u?.HP, 0));
}
function getHpMax(u) {
  return safeNum(u?.maxHp, safeNum(u?.hpMax, safeNum(u?.HPMax, getHp(u))));
}
function getAp(u) {
  return safeNum(u?.ap, safeNum(u?.AP, 0));
}
function getApMax(u) {
  return safeNum(u?.apMax, safeNum(u?.APMax, getAp(u)));
}
function getMp(u) {
  if (Number.isFinite(u?.mp)) return u.mp;
  if (Number.isFinite(u?.movementPoints)) return u.movementPoints;
  return safeNum(u?.MP, 0);
}
function getMpMax(u) {
  if (Number.isFinite(u?.mpMax)) return u.mpMax;
  if (Number.isFinite(u?.movementPointsMax)) return u.movementPointsMax;
  return safeNum(u?.MPMax, getMp(u));
}
function getGr(u) {
  return safeNum(u?.gr, safeNum(u?.GR, safeNum(u?.guard, 0)));
}
function getMo(u) {
  return safeNum(u?.mo, safeNum(u?.MO, safeNum(u?.morale, 0)));
}

function getUnitName(u) {
  return u?.displayName || u?.unitName || u?.name || 'UNIT';
}

function getFaction(u, scene) {
  return (
    u?.faction ||
    u?.ownerFaction ||
    u?.playerFaction ||
    (typeof scene?.turnOwner === 'string' ? scene.turnOwner : '') ||
    ''
  );
}

function getOwnerLabel(u, scene) {
  return (
    u?.playerName ||
    u?.ownerName ||
    u?.owner ||
    (typeof scene?.playerName === 'string' ? scene.playerName : '') ||
    ''
  );
}

function getWeaponText(u) {
  const main =
    u?.weaponName ||
    u?.primaryWeaponName ||
    u?.primaryWeapon ||
    (Array.isArray(u?.weapons) ? (u.weapons[0]?.name || u.weapons[0]) : null) ||
    null;

  const side =
    u?.sideWeaponName ||
    u?.secondaryWeaponName ||
    u?.secondaryWeapon ||
    (Array.isArray(u?.weapons) ? (u.weapons[1]?.name || u.weapons[1]) : null) ||
    null;

  return {
    main: main ? String(main) : '',
    side: side ? String(side) : '',
  };
}

function getArmorResists(unit) {
  const r = unit?.resists || unit?.resistances || null;

  const base = {
    normal: { physical: 0, thermal: 0, toxic: 0, cryo: 0, radiation: 0, energy: 0, corrosive: 0 },
    heavy: { physical: 0, thermal: 0, toxic: 0, cryo: 0, radiation: 0, energy: 0, corrosive: 0 },
    both: { physical: 0, thermal: 0, toxic: 0, cryo: 0, radiation: 0, energy: 0, corrosive: 0 },
  };

  if (!r || typeof r !== 'object') return base;

  // Preferred layout: r.normal.physical etc.
  for (const armorKey of ['normal', 'heavy', 'both']) {
    const src = r[armorKey];
    if (src && typeof src === 'object') {
      for (const dt of Object.keys(base[armorKey])) {
        if (Number.isFinite(src[dt])) base[armorKey][dt] = src[dt];
        else if (Number.isFinite(src[dt?.toUpperCase?.()])) base[armorKey][dt] = src[dt.toUpperCase()];
      }
    }
  }

  // Alternate layout: r.physical.normal etc.
  for (const dt of Object.keys(base.normal)) {
    const src = r[dt] || r[dt?.toUpperCase?.()] || null;
    if (src && typeof src === 'object') {
      for (const armorKey of ['normal', 'heavy', 'both']) {
        if (!Number.isFinite(base[armorKey][dt]) || base[armorKey][dt] === 0) {
          if (Number.isFinite(src[armorKey])) base[armorKey][dt] = src[armorKey];
        }
      }
    }
  }

  return base;
}

function unitIsEnemy(u) {
  return !!(u?.isEnemy || u?.controller === 'ai');
}

function effectKeyFromInst(inst) {
  const raw = inst && (inst.defId || inst.effectId || inst.id) ? String(inst.defId || inst.effectId || inst.id) : '';
  return raw.trim();
}

function buildEffectIconList(scene, unit) {
  const effects = Array.isArray(unit?.effects) ? unit.effects : [];
  const out = [];

  for (const inst of effects) {
    if (!inst) continue;
    const key = effectKeyFromInst(inst);
    if (!key) continue;

    if (scene?.textures?.exists?.(key)) {
      out.push({ key, stacks: safeNum(inst.stacks, 1) });
      continue;
    }

    const candidates = [key, key.replace(/_/g, ''), key.toLowerCase(), key.toUpperCase()];
    let found = null;
    for (const c of candidates) {
      if (c && scene?.textures?.exists?.(c)) {
        found = c;
        break;
      }
    }
    if (found) out.push({ key: found, stacks: safeNum(inst.stacks, 1) });
  }

  return out;
}

function safeBringToTop(scene, obj) {
  try {
    scene.children.bringToTop(obj);
  } catch (_) {}
}

export function setupUnitActionPanel(scene) {
  if (!scene) return;
  if (scene.__unitPanelInitialized) return;
  scene.__unitPanelInitialized = true;

  const panelW = 601;
  const panelH = 281;

  // Matches your reference (bigger icons); adjust if you want.
  const scale = 1.25;

  const margin = 10;
  const originX = margin;
  const originY = scene.scale.height - panelH * scale - margin;

  const panel = scene.add.container(originX, originY).setDepth(4200).setScrollFactor(0);
  panel.visible = false;
  panel.setScale(scale);

  // Background sprite
  const bg = scene.add.image(0, 0, TEX_PANEL_BG).setOrigin(0, 0);
  panel.add(bg);

  // Overlay to block clicks behind the panel
  const overlay = scene
    .add
    .rectangle(0, 0, scene.scale.width, scene.scale.height, 0x000000, 0.001)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(4190);
  overlay.visible = false;
  overlay.setInteractive({ useHandCursor: false });
  overlay.on('pointerdown', (pointer, lx, ly, event) => event?.stopPropagation?.());

  // Title + owner
  const titleText = scene.add.text(10, 6, '* UNIT  FACTION', {
    fontFamily: 'monospace',
    fontSize: '13px',
    color: '#ffffff',
  });

  const ownerText = scene.add.text(10, 22, 'PLAYER', {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#ffffff',
  });

  panel.add([titleText, ownerText]);

  // Weapon block (left portrait area)
  const weaponMainText = scene.add.text(10, 95, 'Weapon:', {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#ffffff',
  });

  const weaponSideText = scene.add.text(10, 115, 'Side weapon:', {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#ffffff',
  });

  panel.add([weaponMainText, weaponSideText]);

  // Stats: top row, 5 cells of 80px starting at x=199
  const statCells = [
    { tex: TEX_STAT_AP, get: (u) => `${getAp(u)}/${getApMax(u)}` },
    { tex: TEX_STAT_MP, get: (u) => `${getMp(u)}/${getMpMax(u)}` },
    { tex: TEX_STAT_GR, get: (u) => `${getGr(u)}` },
    { tex: TEX_STAT_HP, get: (u) => `${getHp(u)}/${getHpMax(u)}` },
    { tex: TEX_STAT_MO, get: (u) => `${getMo(u)}` },
  ];

  const stats = [];
  for (let i = 0; i < statCells.length; i++) {
    const cellLeft = 199 + i * 80;
    const icon = scene.add.image(cellLeft + 12, 20, statCells[i].tex).setOrigin(0.5, 0.5);
    icon.setDisplaySize(22, 22);
    const text = scene.add.text(cellLeft + 26, 13, '0', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#ffffff',
    });
    panel.add([icon, text]);
    stats.push({ icon, text, get: statCells[i].get, tex: statCells[i].tex });
  }

  // Resists: directly under title (row y 40..79)
  const resistRowYIcon = 52;
  const resistRowYVal = 64;
  const resistAreaLeft = 199;
  const resistAreaRight = 599;
  const resistAreaW = resistAreaRight - resistAreaLeft;
  const resistStep = resistAreaW / RESIST_ORDER.length;

  const resistIcons = [];
  const resistVals = [];
  for (let i = 0; i < RESIST_ORDER.length; i++) {
    const cx = resistAreaLeft + (i + 0.5) * resistStep;
    const icon = scene.add.image(cx, resistRowYIcon, RESIST_ORDER[i].tex).setOrigin(0.5, 0.5);
    icon.setDisplaySize(18, 18);
    const val = scene.add.text(cx, resistRowYVal, '0', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#ffffff',
    }).setOrigin(0.5, 0);
    panel.add([icon, val]);
    resistIcons.push(icon);
    resistVals.push(val);
  }

  // Status effects: row y 80..119, 10 slots of 40px
  const statusSlots = [];
  const statusCellY = 100;
  for (let i = 0; i < 10; i++) {
    const cellLeft = 199 + i * 40;
    const cx = cellLeft + 20;
    const icon = scene.add.image(cx, statusCellY, '__missing__').setOrigin(0.5, 0.5);
    icon.visible = false;
    icon.setDisplaySize(18, 18);
    const stacksText = scene.add.text(cellLeft + 37, statusCellY + 7, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(1, 1);
    stacksText.visible = false;
    panel.add([icon, stacksText]);
    statusSlots.push({ icon, stacksText });
  }

  // Action buttons (right area), 5 columns x 2 rows
  // Row1: DEFENCE, AMBUSH, ENDTURN, HEAL, TURN
  // Row2: DISMISS, SWITCH, BUILD, ACTIVE1, ACTIVE2
  const actionButtons = [];
  const actionCols = [239, 319, 399, 479, 559];
  const row1Y = 155;
  const row2Y = 235;

  const actionLayout = [
    ['defence', 'ambush', 'endturn', 'heal', 'turn'],
    ['dismiss', 'switch', 'build', 'active1', 'active2'],
  ];

  for (let r = 0; r < actionLayout.length; r++) {
    for (let c = 0; c < actionLayout[r].length; c++) {
      const id = actionLayout[r][c];
      const def = ACTIONS.find((a) => a.id === id);
      const cx = actionCols[c];
      const cy = r === 0 ? row1Y : row2Y;

      const icon = scene.add.image(cx, cy, def?.key || '__missing__').setOrigin(0.5, 0.5);
      icon.setDisplaySize(52, 36);

      // Hit rect inside each 80x80 cell
      const cellLeft = 199 + c * 80;
      const cellTop = r === 0 ? 120 : 200;
      const hit = scene
        .add
        .rectangle(cellLeft, cellTop, 80, 80, 0x000000, 0)
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });
      hit.on('pointerdown', (pointer, lx, ly, event) => {
        event?.stopPropagation?.();
        onAction(id);
      });

      panel.add([icon, hit]);
      actionButtons.push({ id, icon, hit });
    }
  }

  scene.unitPanel = {
    panel,
    overlay,
    bg,
    titleText,
    ownerText,
    weaponMainText,
    weaponSideText,
    stats,
    resistIcons,
    resistVals,
    statusSlots,
    actionButtons,
    selectedUnit: null,
  };

  function onAction(actionId) {
    const u = scene.unitPanel?.selectedUnit || scene.selectedUnit || null;
    if (!u) return;

    // Enemies: prevent actions (except dismiss which just closes)
    if (unitIsEnemy(u) && actionId !== 'dismiss') return;

    switch (actionId) {
      case 'defence':
        scene.events?.emit?.('unit_action_defence', { unit: u });
        if (typeof scene.onUnitDefence === 'function') scene.onUnitDefence(u);
        break;
      case 'ambush':
        scene.events?.emit?.('unit_action_ambush', { unit: u });
        if (typeof scene.onUnitAmbush === 'function') scene.onUnitAmbush(u);
        break;
      case 'heal':
        scene.events?.emit?.('unit_action_heal', { unit: u });
        if (typeof scene.onUnitHeal === 'function') scene.onUnitHeal(u);
        break;
      case 'turn':
        scene.events?.emit?.('unit_action_turn', { unit: u });
        if (typeof scene.onUnitTurn === 'function') scene.onUnitTurn(u);
        break;
      case 'switch':
        scene.events?.emit?.('unit_action_switch', { unit: u });
        if (typeof scene.onUnitSwitch === 'function') scene.onUnitSwitch(u);
        break;
      case 'build':
        scene.events?.emit?.('unit_action_build', { unit: u });
        if (typeof scene.onUnitBuild === 'function') scene.onUnitBuild(u);
        break;
      case 'active1':
        scene.events?.emit?.('unit_action_active1', { unit: u });
        if (typeof scene.onUnitActive1 === 'function') scene.onUnitActive1(u);
        break;
      case 'active2':
        scene.events?.emit?.('unit_action_active2', { unit: u });
        if (typeof scene.onUnitActive2 === 'function') scene.onUnitActive2(u);
        break;
      case 'endturn':
        scene.endTurn?.();
        break;
      case 'dismiss':
        scene.setSelectedUnit?.(null);
        break;
      default:
        break;
    }

    scene.refreshUnitActionPanel?.();
  }

  scene.openUnitActionPanel = function openUnitActionPanel(unit) {
    scene.unitPanel.selectedUnit = unit || null;
    scene.unitPanel.panel.visible = !!unit;
    scene.unitPanel.overlay.visible = !!unit;
    scene.refreshUnitActionPanel?.();
    safeBringToTop(scene, scene.unitPanel.panel);
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

    // Title: “* NAME  FACTION”
    const name = String(getUnitName(u)).toUpperCase();
    const faction = String(getFaction(u, scene)).toUpperCase();
    p.titleText.setText(faction ? `* ${name}  ${faction}` : `* ${name}`);

    // Owner line
    p.ownerText.setText(String(getOwnerLabel(u, scene) || '').toUpperCase());

    // Weapon block
    const wt = getWeaponText(u);
    p.weaponMainText.setText(wt.main ? `Weapon: ${wt.main}` : 'Weapon:');
    if (wt.side) {
      p.weaponSideText.visible = true;
      p.weaponSideText.setText(`Side weapon: ${wt.side}`);
    } else {
      p.weaponSideText.visible = false;
    }

    // Stats
    for (const s of p.stats) {
      s.icon.visible = !!(scene.textures?.exists?.(s.tex));
      s.text.setText(String(s.get(u)));
    }

    // Resists (normal armor)
    const res = getArmorResists(u);
    for (let i = 0; i < RESIST_ORDER.length; i++) {
      const dt = RESIST_ORDER[i].id;
      const v = safeNum(res?.normal?.[dt], 0);
      p.resistVals[i].setText(String(v));
      p.resistIcons[i].visible = !!(scene.textures?.exists?.(RESIST_ORDER[i].tex));
    }

    // Status effects
    const effList = buildEffectIconList(scene, u).slice(0, p.statusSlots.length);
    for (let i = 0; i < p.statusSlots.length; i++) {
      const slot = p.statusSlots[i];
      const info = effList[i] || null;
      if (!info || !scene.textures?.exists?.(info.key)) {
        slot.icon.visible = false;
        slot.stacksText.visible = false;
        continue;
      }
      slot.icon.setTexture(info.key);
      slot.icon.visible = true;

      const stacks = safeNum(info.stacks, 1);
      if (stacks > 1) {
        slot.stacksText.setText(String(stacks));
        slot.stacksText.visible = true;
      } else {
        slot.stacksText.visible = false;
      }
    }

    // Action enable/disable
    const enemy = unitIsEnemy(u);
    for (const b of p.actionButtons) {
      let enabled = !enemy;

      if (b.id === 'build') {
        const allowBuild = !!u.canBuild || /base/i.test(getUnitName(u)) || u.unitType === 'mobile_base';
        enabled = enabled && allowBuild;
      }

      if (enabled) {
        if (!b.hit.input) b.hit.setInteractive({ useHandCursor: true });
        b.hit.setAlpha(1);
        b.icon.setAlpha(1);
      } else {
        if (b.hit.input) b.hit.disableInteractive();
        b.hit.setAlpha(0.4);
        b.icon.setAlpha(0.55);
      }
    }
  };
}

export default {
  setupUnitActionPanel,
};
