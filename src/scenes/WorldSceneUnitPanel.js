// src/scenes/WorldSceneUnitPanel.js
//
// Unit panel UI.
// - Shows selected unit stats and status icons.
// - Provides action buttons (no old build submenu / no ability tooltips here).
// - Keeps facing picker (direction switch) as requested.
//
// This file is intentionally self-contained and does not import Phaser.
// It assumes it's executed in a Phaser ES-module build.

/* eslint-disable no-console */

/* ============================================================================
   Helpers
   ============================================================================ */

function safeNum(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

function clamp(v, lo, hi) {
  const n = safeNum(v, lo);
  return Math.max(lo, Math.min(hi, n));
}

function getHp(unit) {
  return safeNum(unit?.hp, safeNum(unit?.HP, 0));
}
function getHpMax(unit) {
  return safeNum(unit?.maxHp, safeNum(unit?.hpMax, safeNum(unit?.HPMax, getHp(unit))));
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
  return safeNum(unit?.gr, safeNum(unit?.GR, safeNum(unit?.guard, 0)));
}
function getMo(unit) {
  return safeNum(unit?.mo, safeNum(unit?.MO, safeNum(unit?.morale, 0)));
}

function getArmorResists(unit) {
  // Project has multiple legacy fields. We normalize into 3 columns: normal/heavy/both.
  // If you already store resists elsewhere, plug it here.
  const r = unit?.resists || unit?.resistances || null;

  const base = {
    normal: { physical: 0, thermal: 0, toxic: 0, cryo: 0, radiation: 0, energy: 0, corrosive: 0 },
    heavy:  { physical: 0, thermal: 0, toxic: 0, cryo: 0, radiation: 0, energy: 0, corrosive: 0 },
    both:   { physical: 0, thermal: 0, toxic: 0, cryo: 0, radiation: 0, energy: 0, corrosive: 0 },
  };

  if (!r || typeof r !== 'object') return base;

  // Accept:
  //  r.normal.physical, r.heavy.physical, r.both.physical ...
  //  or r.physical.normal etc (fallback)
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

function getUnitDisplayName(unit) {
  return (
    unit?.displayName ||
    unit?.unitName ||
    unit?.name ||
    'Unit'
  );
}

function getUnitTier(unit) {
  return safeNum(unit?.tier, safeNum(unit?.level, safeNum(unit?.lvl, 1)));
}

function isEnemy(unit) {
  return !!(unit?.isEnemy || unit?.controller === 'ai');
}

function effectKeyFromInst(inst) {
  // Effect instance shape from EffectEngine: { defId, ... }
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

    // If texture exists exactly, use it.
    if (scene?.textures?.exists?.(key)) {
      out.push({ key, stacks: safeNum(inst.stacks, 1) });
      continue;
    }

    // Some projects keep ids in different case; attempt common normalizations.
    const candidates = [
      key,
      key.replace(/_/g, ''),
      key.replace(/_/g, '').replace(/^\w/, c => c.toUpperCase()),
      key.toLowerCase(),
      key.toUpperCase(),
    ];

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

function makeRoundedPanel(scene, x, y, w, h, fill = 0x071826, alpha = 0.88, stroke = 0x3da9fc) {
  const g = scene.add.graphics();
  g.fillStyle(fill, alpha);
  g.fillRoundedRect(x, y, w, h, 12);
  g.lineStyle(2, stroke, 0.85);
  g.strokeRoundedRect(x, y, w, h, 12);
  return g;
}

function makeLabel(scene, x, y, text, style = {}) {
  return scene.add.text(x, y, text, {
    fontFamily: 'monospace',
    fontSize: '12px',
    color: '#e8f6ff',
    ...style,
  });
}

function makeIconFrame(scene, x, y, size) {
  const g = scene.add.graphics();
  g.fillStyle(0x0f2233, 0.9);
  g.fillRoundedRect(x, y, size, size, 6);
  g.lineStyle(2, 0x6fe3ff, 0.65);
  g.strokeRoundedRect(x, y, size, size, 6);
  return g;
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

function safeBringToTop(scene, obj) {
  try { scene.children.bringToTop(obj); } catch (_) {}
}

/* ============================================================================
   Main setup
   ============================================================================ */

export function setupUnitActionPanel(scene) {
  if (!scene) return;

  // Avoid double-init
  if (scene.__unitPanelInitialized) return;
  scene.__unitPanelInitialized = true;

  const originX = 14;
  const originY = 14;

  const W = 860;
  const H = 178;

  const panel = scene.add.container(originX, originY)
    .setDepth(4200)
    .setScrollFactor(0);

  panel.visible = false;

  // BG
  const bg = makeRoundedPanel(scene, 0, 0, W, H, 0x071826, 0.90, 0x3da9fc);
  bg.setScrollFactor(0);

  // subtle bezel
  const bezel = scene.add.graphics().setScrollFactor(0);
  bezel.lineStyle(1, 0x9be4ff, 0.20);
  for (let i = 1; i <= 2; i++) {
    bezel.strokeRect(8 * i, 8 * i, W - 16 * i, H - 16 * i);
  }

  panel.add([bg, bezel]);

  // Left portrait frame (placeholder)
  const portraitSize = 66;
  const portraitX = 16;
  const portraitY = 16;
  const portraitFrame = makeIconFrame(scene, portraitX, portraitY, portraitSize).setScrollFactor(0);

  // name + tier
  const nameText = makeLabel(scene, portraitX + portraitSize + 12, portraitY + 4, 'Unit', {
    fontSize: '16px',
    fontStyle: 'bold',
  }).setScrollFactor(0);

  const tierText = makeLabel(scene, portraitX + portraitSize + 12, portraitY + 28, 'Tier: 1', {
    fontSize: '12px',
    color: '#bfefff',
  }).setScrollFactor(0);

  // Stats line (AP/MP/GR/HP/MO)
  const statsY = portraitY + 52;
  const statStyle = { fontSize: '12px', color: '#e8f6ff' };
  const apText = makeLabel(scene, portraitX + portraitSize + 12, statsY, 'AP: 0/0', statStyle).setScrollFactor(0);
  const mpText = makeLabel(scene, portraitX + portraitSize + 160, statsY, 'MP: 0/0', statStyle).setScrollFactor(0);
  const grText = makeLabel(scene, portraitX + portraitSize + 310, statsY, 'GR: 0', statStyle).setScrollFactor(0);
  const hpText = makeLabel(scene, portraitX + portraitSize + 400, statsY, 'HP: 0/0', statStyle).setScrollFactor(0);
  const moText = makeLabel(scene, portraitX + portraitSize + 550, statsY, 'MO: 0', statStyle).setScrollFactor(0);

  // Resist grid (3 rows: Normal/Heavy/Both, 7 cols types)
  const resistX = 340;
  const resistY = 18;
  const resistRowH = 18;
  const resistColW = 46;

  const resistTitle = makeLabel(scene, resistX, resistY, 'RESISTS', {
    fontSize: '11px',
    color: '#9be4ff',
  }).setScrollFactor(0);

  const headers = ['PHY', 'THR', 'TOX', 'CRY', 'RAD', 'ENG', 'COR'];
  const headerTexts = headers.map((h, i) =>
    makeLabel(scene, resistX + 60 + i * resistColW, resistY, h, { fontSize: '10px', color: '#9be4ff' }).setScrollFactor(0)
  );

  const armorRows = [
    { key: 'normal', label: 'N:' },
    { key: 'heavy',  label: 'H:' },
    { key: 'both',   label: 'B:' },
  ];

  const resistTexts = {
    normal: [],
    heavy: [],
    both: [],
  };

  armorRows.forEach((row, rIdx) => {
    makeLabel(scene, resistX, resistY + 18 + rIdx * resistRowH, row.label, {
      fontSize: '11px',
      color: '#e8f6ff',
    }).setScrollFactor(0);

    for (let c = 0; c < headers.length; c++) {
      const t = makeLabel(scene,
        resistX + 60 + c * resistColW,
        resistY + 18 + rIdx * resistRowH,
        '0',
        { fontSize: '11px', color: '#e8f6ff' }
      ).setScrollFactor(0);
      resistTexts[row.key].push(t);
    }
  });

  // Status icons row (10 slots)
  const statusRowY = 92;
  const statusRowX = 16;
  const statusSlot = 30;
  const statusPad = 6;
  const maxStatus = 10;

  const statusLabel = makeLabel(scene, statusRowX, statusRowY - 14, 'STATUS', {
    fontSize: '11px',
    color: '#9be4ff',
  }).setScrollFactor(0);

  const statusSlots = [];
  for (let i = 0; i < maxStatus; i++) {
    const x = statusRowX + i * (statusSlot + statusPad);
    const y = statusRowY;

    const frame = makeIconFrame(scene, x, y, statusSlot).setScrollFactor(0);
    // actual icon (will be setTexture during refresh)
    const icon = scene.add.image(x + statusSlot / 2, y + statusSlot / 2, '__missing__')
      .setOrigin(0.5)
      .setScrollFactor(0);
    icon.visible = false;

    const stacksText = makeLabel(scene, x + statusSlot - 6, y + statusSlot - 14, '', {
      fontSize: '11px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(1, 0).setScrollFactor(0);
    stacksText.visible = false;

    statusSlots.push({ frame, icon, stacksText });
    panel.add([frame, icon, stacksText]);
  }

  // Action bar icons (8)
  const actionBarX = 330;
  const actionBarY = 122;
  const actionSize = 34;
  const actionPad = 8;

  const ACTIONS = [
    { id: 'defence', label: 'Def', iconKey: 'ui_action_defence' },
    { id: 'heal',    label: 'Heal', iconKey: 'ui_action_heal' },
    { id: 'ambush',  label: 'Amb', iconKey: 'ui_action_ambush' },
    // Build menu removed: keep a generic button you can later rewire to “construct” if needed.
    // If you want to hide it entirely, set enabled=false below in refresh.
    { id: 'build',   label: 'Build', iconKey: 'ui_action_build' },
    { id: 'switch',  label: 'Dir', iconKey: 'ui_action_switch' },
    { id: 'turn',    label: 'Turn', iconKey: 'ui_action_turn' },
    { id: 'end',     label: 'End', iconKey: 'ui_action_endturn' },
    { id: 'dismiss', label: 'X', iconKey: 'ui_action_dismiss' },
  ];

  const actionButtons = [];

  function drawActionButtonBase(g, x, y, size, enabled) {
    g.clear();
    g.fillStyle(0x0f2233, enabled ? 0.95 : 0.55);
    g.fillRoundedRect(x, y, size, size, 8);
    g.lineStyle(2, enabled ? 0x6fe3ff : 0x6fe3ff, enabled ? 0.75 : 0.25);
    g.strokeRoundedRect(x, y, size, size, 8);
  }

  for (let i = 0; i < ACTIONS.length; i++) {
    const a = ACTIONS[i];
    const x = actionBarX + i * (actionSize + actionPad);
    const y = actionBarY;

    const g = scene.add.graphics().setScrollFactor(0);
    drawActionButtonBase(g, x, y, actionSize, true);

    // icon
    const icon = scene.add.image(x + actionSize / 2, y + actionSize / 2, a.iconKey || '__missing__')
      .setOrigin(0.5)
      .setScrollFactor(0);

    // fallback if texture doesn't exist
    const fallbackText = makeLabel(scene, x + actionSize / 2, y + actionSize / 2, a.label, {
      fontSize: '10px',
      color: '#e8f6ff',
      align: 'center',
    }).setOrigin(0.5).setScrollFactor(0);

    const hit = makeHitRect(scene, x, y, actionSize, actionSize, () => onAction(a.id)).setScrollFactor(0);

    actionButtons.push({ id: a.id, g, icon, fallbackText, hit, x, y, enabled: true });
    panel.add([g, icon, fallbackText, hit]);
  }

  // Facing picker (6 hex directions)
  const facingPicker = scene.add.container(760, 18).setScrollFactor(0);
  facingPicker.visible = false;

  const facingBg = makeRoundedPanel(scene, 0, 0, 86, 86, 0x0a1b2a, 0.92, 0x6fe3ff).setScrollFactor(0);
  facingPicker.add(facingBg);

  const faceButtons = [];
  const faceSize = 22;
  const faceCoords = [
    { x: 32, y: 6,  dir: 0 },
    { x: 56, y: 18, dir: 1 },
    { x: 56, y: 46, dir: 2 },
    { x: 32, y: 60, dir: 3 },
    { x: 8,  y: 46, dir: 4 },
    { x: 8,  y: 18, dir: 5 },
  ];

  for (const p of faceCoords) {
    const g = scene.add.graphics().setScrollFactor(0);
    g.fillStyle(0x173b52, 1);
    g.fillRoundedRect(p.x, p.y, faceSize, faceSize, 6);
    g.lineStyle(2, 0x9be4ff, 0.7);
    g.strokeRoundedRect(p.x, p.y, faceSize, faceSize, 6);

    const t = makeLabel(scene, p.x + faceSize / 2, p.y + faceSize / 2, String(p.dir), {
      fontSize: '11px',
      color: '#e8f6ff',
    }).setOrigin(0.5).setScrollFactor(0);

    const hit = makeHitRect(scene, p.x, p.y, faceSize, faceSize, () => setFacing(p.dir)).setScrollFactor(0);

    facingPicker.add([g, t, hit]);
    faceButtons.push({ dir: p.dir, g, t, hit });
  }

  panel.add([
    portraitFrame,
    nameText,
    tierText,
    apText,
    mpText,
    grText,
    hpText,
    moText,
    resistTitle,
    ...headerTexts,
    statusLabel,
    facingPicker,
  ]);

  // Store panel state on scene
  scene.unitPanel = {
    panel,
    bg,
    bezel,
    nameText,
    tierText,
    apText,
    mpText,
    grText,
    hpText,
    moText,
    resistTexts,
    statusSlots,
    actionButtons,
    facingPicker,
    selectedUnit: null,
    // used to suppress click-through when visible (optional)
    overlay: null,
  };

  // Optional overlay to absorb clicks
  const overlay = scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, 0x000000, 0.001)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(4190);
  overlay.visible = false;
  overlay.setInteractive({ useHandCursor: false });
  overlay.on('pointerdown', (pointer, lx, ly, event) => {
    // swallow
    event?.stopPropagation?.();
  });
  scene.unitPanel.overlay = overlay;

  /* ==========================================================================
     Actions
     ========================================================================== */

  function onAction(actionId) {
    const u = scene.unitPanel?.selectedUnit || scene.selectedUnit || null;
    if (!u) return;

    switch (actionId) {
      case 'defence':
        // Hook: your combat/ability pipeline can listen to this.
        scene.events?.emit?.('unit_action_defence', { unit: u });
        if (typeof scene.onUnitDefence === 'function') scene.onUnitDefence(u);
        break;

      case 'heal':
        scene.events?.emit?.('unit_action_heal', { unit: u });
        if (typeof scene.onUnitHeal === 'function') scene.onUnitHeal(u);
        break;

      case 'ambush':
        scene.events?.emit?.('unit_action_ambush', { unit: u });
        if (typeof scene.onUnitAmbush === 'function') scene.onUnitAmbush(u);
        break;

      case 'build':
        // Build submenu is removed; keep a hook so you can rewire later.
        // If you don't want this at all, we disable/hide it in refresh based on unit type.
        scene.events?.emit?.('unit_action_build', { unit: u });
        if (typeof scene.onUnitBuild === 'function') scene.onUnitBuild(u);
        break;

      case 'switch':
        // Toggle facing picker
        if (scene.unitPanel?.facingPicker) {
          const fp = scene.unitPanel.facingPicker;
          fp.visible = !fp.visible;
          safeBringToTop(scene, fp);
        }
        break;

      case 'turn':
        // This is a placeholder hook (e.g., “rotate 60°”)
        scene.events?.emit?.('unit_action_turn', { unit: u });
        if (typeof scene.onUnitTurn === 'function') scene.onUnitTurn(u);
        break;

      case 'end':
        scene.endTurn?.();
        break;

      case 'dismiss':
        // close panel
        scene.setSelectedUnit?.(null);
        break;

      default:
        break;
    }

    // after any action, refresh UI
    scene.refreshUnitActionPanel?.();
  }

  function setFacing(dir) {
    const u = scene.unitPanel?.selectedUnit || scene.selectedUnit || null;
    if (!u) return;

    u.facing = clamp(dir, 0, 5);

    // Optional: if you have a function to update sprite direction
    try {
      if (typeof scene.updateUnitOrientation === 'function') {
        scene.updateUnitOrientation(u);
      } else if (typeof scene.refreshAllIconWorldPositions === 'function') {
        // at least refresh UI/world icons
        scene.refreshAllIconWorldPositions();
      }
    } catch (e) {
      console.warn('[UnitPanel] setFacing failed', e);
    }

    // close picker
    if (scene.unitPanel?.facingPicker) scene.unitPanel.facingPicker.visible = false;

    scene.refreshUnitActionPanel?.();
  }

  /* ==========================================================================
     Public scene methods
     ========================================================================== */

  scene.openUnitActionPanel = function openUnitActionPanel(unit) {
    scene.unitPanel.selectedUnit = unit || null;
    scene.unitPanel.panel.visible = !!unit;
    scene.unitPanel.overlay.visible = !!unit;
    scene.unitPanel.facingPicker.visible = false;

    scene.refreshUnitActionPanel?.();

    safeBringToTop(scene, scene.unitPanel.panel);
  };

  scene.closeUnitActionPanel = function closeUnitActionPanel() {
    if (!scene.unitPanel) return;
    scene.unitPanel.selectedUnit = null;
    scene.unitPanel.panel.visible = false;
    scene.unitPanel.overlay.visible = false;
    scene.unitPanel.facingPicker.visible = false;
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

    // Title
    p.nameText.setText(getUnitDisplayName(u));
    p.tierText.setText(`Tier: ${getUnitTier(u)}`);

    // Core stats
    p.apText.setText(`AP: ${getAp(u)}/${getApMax(u)}`);
    p.mpText.setText(`MP: ${getMp(u)}/${getMpMax(u)}`);
    p.grText.setText(`GR: ${getGr(u)}`);
    p.hpText.setText(`HP: ${getHp(u)}/${getHpMax(u)}`);
    p.moText.setText(`MO: ${getMo(u)}`);

    // Resist table
    const res = getArmorResists(u);
    const order = ['physical', 'thermal', 'toxic', 'cryo', 'radiation', 'energy', 'corrosive'];
    for (const armorKey of ['normal', 'heavy', 'both']) {
      const row = p.resistTexts[armorKey];
      for (let i = 0; i < order.length; i++) {
        const dt = order[i];
        row[i].setText(String(safeNum(res?.[armorKey]?.[dt], 0)));
      }
    }

    // Status icons
    const effList = buildEffectIconList(scene, u).slice(0, p.statusSlots.length);

    for (let i = 0; i < p.statusSlots.length; i++) {
      const slot = p.statusSlots[i];
      const info = effList[i] || null;

      if (!info) {
        slot.icon.visible = false;
        slot.stacksText.visible = false;
        continue;
      }

      // Ensure texture exists
      if (!scene.textures?.exists?.(info.key)) {
        slot.icon.visible = false;
        slot.stacksText.visible = false;
        continue;
      }

      slot.icon.setTexture(info.key);
      slot.icon.setDisplaySize(22, 22);
      slot.icon.visible = true;

      const stacks = safeNum(info.stacks, 1);
      if (stacks > 1) {
        slot.stacksText.setText(String(stacks));
        slot.stacksText.visible = true;
      } else {
        slot.stacksText.visible = false;
      }
    }

    // Action buttons enable/disable
    const enemy = isEnemy(u);
    for (const b of p.actionButtons) {
      let enabled = true;

      // Enemies: disable all interactive actions in UI
      if (enemy) enabled = false;

      // Build: by default disabled unless you explicitly allow it (mobile base etc.)
      if (b.id === 'build') {
        // Heuristic: allow build only if unit has a flag, or name contains "Base"
        const allowBuild = !!u.canBuild || /base/i.test(getUnitDisplayName(u)) || u.unitType === 'mobile_base';
        enabled = enabled && allowBuild;
      }

      // Switch (facing) always allowed for controllable units
      if (b.id === 'switch') {
        enabled = !enemy;
      }

      // End turn always enabled even if enemy selected? We keep disabled if enemy to avoid accidental.
      if (b.id === 'end') {
        enabled = !enemy;
      }

      b.enabled = enabled;

      // visuals
      drawActionButtonBase(b.g, b.x, b.y, actionSize, enabled);

      if (scene.textures?.exists?.(b.icon.texture?.key || '')) {
        // keep
      } else if (b.iconKey && scene.textures?.exists?.(b.iconKey)) {
        b.icon.setTexture(b.iconKey);
      }

      // show icon if texture exists, else show fallback text
      const iconKey = b.icon.texture?.key;
      const iconOk = !!iconKey && scene.textures?.exists?.(iconKey);
      b.icon.visible = iconOk;
      b.fallbackText.visible = !iconOk;

      // interactivity
      if (enabled) {
        if (!b.hit.input) b.hit.setInteractive({ useHandCursor: true });
        b.hit.setAlpha(1);
      } else {
        if (b.hit.input) b.hit.disableInteractive();
        b.hit.setAlpha(0.4);
      }
    }
  };

  // Optional: hex inspect panel hook used elsewhere in your codebase.
  // If you already implement it in another module, this no-op won't interfere.
  if (typeof scene.openHexInspectPanel !== 'function') {
    scene.openHexInspectPanel = function openHexInspectPanel() {
      // no-op
    };
  }
}

export default {
  setupUnitActionPanel,
};
