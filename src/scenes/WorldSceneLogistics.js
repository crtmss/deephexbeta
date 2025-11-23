// src/scenes/WorldSceneLogistics.js
//
// Factorio-style logistics backend + basic UI.
//
// Responsibilities:
// - Define a shared model for "stations" (Mobile Base + buildings).
// - Define a shared model for "logistics routes" attached to haulers/ships.
// - Provide a Logistics panel UI: list of haulers, details for selected hauler.
// - Provide applyLogisticsOnEndTurn() for building-side logistics (mines, etc.).
//
// Movement logic for haulers/ships still lives in WorldSceneHaulers.js.
// WorldSceneLogisticsRuntime.js consumes hauler.logisticsRoute on end turn.

///////////////////////////////
// Visual constants
///////////////////////////////
const LOGI_COLORS = {
  panelBg: 0x0f2233,
  panelStroke: 0x3da9fc,
  textMain: '#e8f6ff',
  textDim: '#9bb6cc',
  listHighlight: '#ffffff',
};

const LOGI_Z = {
  panel: 4100,
  overlay: 4090,
};

///////////////////////////////
// Public API
///////////////////////////////

/**
 * Called from WorldScene.create().
 * Builds the Logistics panel (hidden by default) and attaches helpers:
 *  - scene.openLogisticsPanel()
 *  - scene.closeLogisticsPanel()
 *  - scene.refreshLogisticsPanel()
 */
export function setupLogisticsPanel(scene) {
  const originX = 300;   // we can reposition later if needed
  const originY = 120;

  const container = scene.add.container(originX, originY)
    .setDepth(LOGI_Z.panel)
    .setScrollFactor(0);

  container.visible = false;

  // panel background
  const W = 460;
  const H = 260;

  const bg = scene.add.graphics();
  bg.fillStyle(LOGI_COLORS.panelBg, 0.96);
  bg.fillRoundedRect(0, 0, W, H, 12);
  bg.lineStyle(2, LOGI_COLORS.panelStroke, 1);
  bg.strokeRoundedRect(0, 0, W, H, 12);

  // inner bezel
  const bezel = scene.add.graphics();
  bezel.lineStyle(1, 0x9be4ff, 0.25);
  bezel.strokeRect(10, 10, W - 20, H - 20);

  container.add([bg, bezel]);

  // Titles
  const title = scene.add.text(
    16, 12,
    'Logistics – Haulers & Ships',
    {
      fontSize: '16px',
      color: LOGI_COLORS.textMain,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0);

  const subtitle = scene.add.text(
    16, 32,
    'Select a hauler on the left to inspect or edit its route.',
    {
      fontSize: '12px',
      color: LOGI_COLORS.textDim,
    }
  ).setOrigin(0, 0);

  container.add([title, subtitle]);

  // Close button (top-right X)
  const closeText = scene.add.text(
    W - 18, 10,
    '✕',
    {
      fontSize: '16px',
      color: LOGI_COLORS.textMain,
    }
  ).setOrigin(1, 0).setInteractive({ useHandCursor: true });

  closeText.on('pointerdown', () => {
    scene.closeLogisticsPanel?.();
  });

  container.add(closeText);

  // Left column: hauler list
  const listLabel = scene.add.text(
    16, 56,
    'Haulers & Ships',
    {
      fontSize: '14px',
      color: LOGI_COLORS.textMain,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0);

  const listContainer = scene.add.container(16, 76);
  container.add([listLabel, listContainer]);

  // Right column: selected hauler details
  const detailLabel = scene.add.text(
    200, 56,
    'Selected Route',
    {
      fontSize: '14px',
      color: LOGI_COLORS.textMain,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0);

  const detailContainer = scene.add.container(200, 76);
  container.add([detailLabel, detailContainer]);

  // Store UI handles on the scene
  scene.logisticsUI = {
    container,
    listContainer,
    detailContainer,
    listEntries: [],
    selectedHaulerId: null,
  };

  ///////////////////////////////
  // Scene helper methods
  ///////////////////////////////

  scene.openLogisticsPanel = function () {
    if (!this.logisticsUI) return;
    this.logisticsUI.container.visible = true;

    // Block normal unit movement while logistics panel is open
    this.disableUnitMovementForLogistics = true;

    this.refreshLogisticsPanel?.();
  };

  scene.closeLogisticsPanel = function () {
    if (!this.logisticsUI) return;
    this.logisticsUI.container.visible = false;

    // Re-enable movement
    this.disableUnitMovementForLogistics = false;
  };

  scene.refreshLogisticsPanel = function () {
    if (!this.logisticsUI) return;

    _ensureLogisticsIds(this);

    const ui = this.logisticsUI;
    const haulers = _getAllLogisticsHaulers(this);

    // --- rebuild list ---
    ui.listEntries.forEach(e => e.text.destroy());
    ui.listEntries = [];
    ui.listContainer.removeAll(true); // remove children from container

    let y = 0;
    const lineH = 20;

    if (haulers.length === 0) {
      const txt = this.add.text(
        0, 0,
        'No haulers or ships yet.',
        { fontSize: '12px', color: LOGI_COLORS.textDim }
      ).setOrigin(0, 0);
      ui.listContainer.add(txt);
      ui.listEntries.push({ text: txt, haulerId: null });
    } else {
      haulers.forEach(h => {
        const label = _formatHaulerLabel(h);
        const isSelected = (h._logiId === ui.selectedHaulerId);
        const txt = this.add.text(
          0, y,
          label,
          {
            fontSize: '13px',
            color: isSelected ? LOGI_COLORS.listHighlight : LOGI_COLORS.textMain,
          }
        ).setOrigin(0, 0).setInteractive({ useHandCursor: true });

        txt.on('pointerdown', () => {
          ui.selectedHaulerId = h._logiId;
          this.refreshLogisticsPanel?.();
        });

        ui.listContainer.add(txt);
        ui.listEntries.push({ text: txt, haulerId: h._logiId });
        y += lineH;
      });
    }

    // --- rebuild detail pane for selected hauler ---
    ui.detailContainer.removeAll(true);

    const selected = haulers.find(h => h._logiId === ui.selectedHaulerId) || haulers[0] || null;
    if (selected && !ui.selectedHaulerId) {
      ui.selectedHaulerId = selected._logiId;
    }

    if (!selected) {
      const t = this.add.text(
        0, 0,
        'No hauler selected.',
        { fontSize: '12px', color: LOGI_COLORS.textDim }
      ).setOrigin(0, 0);
      ui.detailContainer.add(t);
      return;
    }

    _renderHaulerDetails(this, selected);
  };
}

/**
 * Helper if you ever want to open from outside the scene helper.
 */
export function openLogisticsPanel(scene) {
  scene.openLogisticsPanel?.();
}

/**
 * Called from WorldScene.endTurn().
 * Handles building-side logistics, e.g. Mines producing scrap each turn.
 */
export function applyLogisticsOnEndTurn(sceneArg) {
  const scene = sceneArg || /** @type {any} */ (this);
  if (!scene) return;

  const buildings = scene.buildings || [];
  if (!buildings.length) return;

  // --- Mine production: +1 scrap per mine per turn, capped at maxScrap (default 10) ---
  buildings.forEach(b => {
    if (b.type !== 'mine') return;

    const maxScrap = typeof b.maxScrap === 'number' ? b.maxScrap : 10;

    // Ensure a resources bag exists for UI & logistics consumers
    if (!b.resources) b.resources = {};

    const currentFromResources =
      typeof b.resources.scrap === 'number' ? b.resources.scrap : 0;
    const currentFromStorage =
      typeof b.storageScrap === 'number' ? b.storageScrap : 0;

    // Keep compatibility with both fields by using the higher of the two
    const cur = Math.max(currentFromResources, currentFromStorage);

    const next = Math.min(maxScrap, cur + 1);

    // Write back to BOTH fields so everyone sees the same value
    b.resources.scrap = next;
    b.storageScrap = next;
  });
}

export default {
  setupLogisticsPanel,
  openLogisticsPanel,
  applyLogisticsOnEndTurn,
};

///////////////////////////////
// Internal helpers – model
///////////////////////////////

/**
 * Collect all units that participate in logistics:
 * - Land haulers (🚚)
 * - Ships (🚢) created at docks
 */
function _getAllLogisticsHaulers(scene) {
  const haulers = Array.isArray(scene.haulers) ? scene.haulers : [];
  const ships   = Array.isArray(scene.ships)   ? scene.ships   : [];

  // For now we treat ships as haulers as well.
  return [...haulers, ...ships];
}

/**
 * Ensure every hauler/ship has a unique _logiId and a logisticsRoute array.
 * This is purely internal to the Logistics system and does not affect movement yet.
 */
function _ensureLogisticsIds(scene) {
  const all = _getAllLogisticsHaulers(scene);
  let nextId = 1;

  // Reserve existing ids and find max
  all.forEach(h => {
    if (typeof h._logiId === 'number') {
      nextId = Math.max(nextId, h._logiId + 1);
    }
  });

  all.forEach(h => {
    if (typeof h._logiId !== 'number') {
      h._logiId = nextId++;
    }
    if (!Array.isArray(h.logisticsRoute)) {
      h.logisticsRoute = [];
    }
  });
}

/**
 * Format a short label for the hauler list.
 */
function _formatHaulerLabel(h) {
  const emoji = h.emoji || (h.isNaval ? '🚢' : '🚚');
  let base = `${emoji} ${h.name || 'Hauler'} #${h._logiId}`;

  if (h.type === 'ship') {
    base += ' (Ship)';
  }

  if (typeof h.q === 'number' && typeof h.r === 'number') {
    base += `  @(${h.q},${h.r})`;
  }
  return base;
}

/**
 * Render the right-side details for a single hauler:
 * - basic info
 * - list of route stops (if any)
 * - "＋ Add station…" button
 * - "Reset routes" button
 */
function _renderHaulerDetails(scene, hauler) {
  const ui = scene.logisticsUI;
  if (!ui) return;

  const c = ui.detailContainer;
  c.removeAll(true);

  const isShip = (hauler.type === 'ship' || hauler.isNaval);
  const emoji = hauler.emoji || (isShip ? '🚢' : '🚚');

  let y = 0;

  const title = scene.add.text(
    0, y,
    `${emoji} ${hauler.name || (isShip ? 'Ship' : 'Hauler')} #${hauler._logiId}`,
    {
      fontSize: '14px',
      color: LOGI_COLORS.textMain,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0);
  c.add(title);
  y += 20;

  const posLine = scene.add.text(
    0, y,
    `Position: (${hauler.q ?? '?'}, ${hauler.r ?? '?'})`,
    { fontSize: '12px', color: LOGI_COLORS.textDim }
  ).setOrigin(0, 0);
  c.add(posLine);
  y += 16;

  // Show simple cargo info (currently only 🍖 is implemented)
  const cargoFood = hauler.cargoFood ?? 0;
  const cargoLine = scene.add.text(
    0, y,
    `Cargo: 🍖 ${cargoFood}`,
    { fontSize: '12px', color: LOGI_COLORS.textDim }
  ).setOrigin(0, 0);
  c.add(cargoLine);
  y += 18;

  // Divider
  const divider = scene.add.graphics();
  divider.lineStyle(1, 0x9bb6cc, 0.4);
  divider.strokeLineShape(new Phaser.Geom.Line(0, y, 240, y));
  c.add(divider);
  y += 8;

  // Route preview
  const route = Array.isArray(hauler.logisticsRoute) ? hauler.logisticsRoute : [];
  if (route.length === 0) {
    const note = scene.add.text(
      0, y,
      'No custom logistics route.\n\n' +
      'This hauler currently does nothing.\n\n' +
      'Click "＋ Add station…" below,\n' +
      'then left-click a station on the map\n' +
      'and choose an action.',
      {
        fontSize: '11px',
        color: LOGI_COLORS.textDim,
      }
    ).setOrigin(0, 0);
    c.add(note);
    y += note.height + 8;

    _addAddStationButton(scene, hauler, c, y);
    y += 22;
    _addResetRoutesButton(scene, hauler, c, y);
    return;
  }

  const routeTitle = scene.add.text(
    0, y,
    'Route:',
    {
      fontSize: '13px',
      color: LOGI_COLORS.textMain,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0);
  c.add(routeTitle);
  y += 18;

  route.forEach((step, idx) => {
    const stepText = _formatRouteStep(scene, step, idx);
    const t = scene.add.text(
      0, y,
      stepText,
      {
        fontSize: '12px',
        color: LOGI_COLORS.textMain,
      }
    ).setOrigin(0, 0);
    c.add(t);
    y += 16;
  });

  y += 6;
  const stub = scene.add.text(
    0, y,
    'Use "＋ Add station…" to extend this route\n' +
    'or "Reset routes" to clear it.',
    { fontSize: '11px', color: LOGI_COLORS.textDim }
  ).setOrigin(0, 0);
  c.add(stub);
  y += stub.height + 4;

  _addAddStationButton(scene, hauler, c, y);
  y += 22;
  _addResetRoutesButton(scene, hauler, c, y);
}

/**
 * Small helper to create the "＋ Add station…" button.
 */
function _addAddStationButton(scene, hauler, container, y) {
  const btn = scene.add.text(
    0, y,
    '＋ Add station…',
    {
      fontSize: '12px',
      color: LOGI_COLORS.listHighlight,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0).setInteractive({ useHandCursor: true });

  btn.on('pointerdown', () => {
    _startAddStationFlow(scene, hauler);
  });

  container.add(btn);
}

/**
 * Helper to create "Reset routes" button.
 */
function _addResetRoutesButton(scene, hauler, container, y) {
  const btn = scene.add.text(
    0, y,
    'Reset routes',
    {
      fontSize: '12px',
      color: '#ff7b7b',
    }
  ).setOrigin(0, 0).setInteractive({ useHandCursor: true });

  btn.on('pointerdown', () => {
    hauler.logisticsRoute = [];
    hauler.routeIndex = 0;
    hauler.pinnedToBase = false;
    console.log('[LOGI] Reset routes for hauler#', hauler._logiId);
    scene.refreshLogisticsPanel?.();
  });

  container.add(btn);
}

/**
 * Begin "add station" interaction:
 * - User clicks button in Logistics panel.
 * - We show a faint full-screen overlay.
 * - Next left-click on the map selects a station (mobile base or building).
 * - Then an action picker (Load all / Unload all / Idle) appears in the panel.
 */
function _startAddStationFlow(scene, hauler) {
  if (!scene || !hauler) return;
  console.log('[LOGI] Add station: left-click a Mobile Base or building hex.');

  const cam = scene.cameras.main;
  const overlay = scene.add.rectangle(
    cam.worldView.x + cam.worldView.width / 2,
    cam.worldView.y + cam.worldView.height / 2,
    cam.worldView.width,
    cam.worldView.height,
    0x000000,
    0.001
  )
    .setInteractive({ useHandCursor: true })
    .setScrollFactor(0)
    .setDepth(LOGI_Z.overlay);

  overlay.once('pointerdown', (pointer, _lx, _ly, event) => {
    event?.stopPropagation?.();

    const worldPoint = pointer.positionToCamera(scene.cameras.main);
    const { q, r } = scene.worldToAxial(worldPoint.x, worldPoint.y);

    const station = _findStationAt(scene, q, r);
    if (!station) {
      console.warn('[LOGI] No station (mobile base or building) on that hex.', { q, r });
      overlay.destroy();
      return;
    }

    overlay.destroy();
    _showActionPicker(scene, hauler, station);
  });
}

/**
 * After picking a station on the map, present action options
 * (Load all / Unload all / Idle) in the Logistics panel.
 */
function _showActionPicker(scene, hauler, station) {
  const ui = scene.logisticsUI;
  if (!ui) return;

  const c = ui.detailContainer;
  c.removeAll(true);

  let y = 0;

  const stationStepLike = {
    stationType: station.stationType,
    stationId: station.stationId,
  };
  const stationName = _resolveStationName(scene, stationStepLike);

  const title = scene.add.text(
    0, y,
    `Add station: ${stationName}`,
    {
      fontSize: '14px',
      color: LOGI_COLORS.textMain,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0);
  c.add(title);
  y += 22;

  const hint = scene.add.text(
    0, y,
    'Choose what this hauler should do at this stop:',
    { fontSize: '12px', color: LOGI_COLORS.textDim }
  ).setOrigin(0, 0);
  c.add(hint);
  y += 18;

  const makeBtn = (label, actionKey) => {
    const b = scene.add.text(
      0, y,
      label,
      {
        fontSize: '12px',
        color: LOGI_COLORS.listHighlight,
      }
    ).setOrigin(0, 0).setInteractive({ useHandCursor: true });

    b.on('pointerdown', () => {
      const step = {
        stationType: station.stationType,
        stationId: station.stationId,
        action: actionKey,
        resource: 'food',  // current implemented cargo
      };

      hauler.logisticsRoute = hauler.logisticsRoute || [];
      hauler.logisticsRoute.push(step);

      // Idle at Mobile Base: pin hauler to the base so it rides along
      if (actionKey === 'idle' && station.stationType === 'mobileBase') {
        if (station.unitRef) {
          hauler.baseRef = station.unitRef;
          hauler.baseQ = station.unitRef.q;
          hauler.baseR = station.unitRef.r;
        }
        hauler.pinnedToBase = true;
      }

      console.log('[LOGI] Added route step', step, 'for hauler#', hauler._logiId);
      scene.refreshLogisticsPanel?.();
    });

    c.add(b);
    y += 18;
  };

  makeBtn('Load all (🍖)', 'loadAll');
  makeBtn('Unload all (🍖)', 'unloadAll');
  makeBtn('Idle at station', 'idle');

  y += 10;
  const note = scene.add.text(
    0, y,
    'Idle at a Mobile Base will pin the hauler\n' +
    'so it stays inside when the base moves.',
    { fontSize: '11px', color: LOGI_COLORS.textDim }
  ).setOrigin(0, 0);
  c.add(note);
}

/**
 * Convert a single route step into a readable string.
 * step shape:
 * {
 *   stationType: 'mobileBase' | 'docks' | 'mine' | 'factory' | 'bunker',
 *   stationId: number | null,
 *   action: 'load' | 'loadAll' | 'unload' | 'unloadAll' | 'idle',
 *   resource: 'food' | 'scrap' | 'money' | 'influence', // etc.
 * }
 */
function _formatRouteStep(scene, step, idx) {
  const n = idx + 1;

  const stationName = _resolveStationName(scene, step);
  const actionLabel = _formatActionLabel(step.action, step.resource);

  return `${n}. ${stationName} (${actionLabel})`;
}

/**
 * Resolve "Mine #2", "Docks #1", "Mobile Base", etc. from a step.
 */
function _resolveStationName(scene, step) {
  if (!step) return 'Unknown Station';

  const type = step.stationType;
  const id   = step.stationId;

  if (type === 'mobileBase') {
    return 'Mobile Base';
  }

  const buildings = scene.buildings || [];
  const b = buildings.find(x => x.id === id && x.type === type);
  if (!b) {
    return `${type || 'Station'} #${id ?? '?'}`;
  }

  const emoji = b.emoji || _stationEmojiFallback(type);
  const indexStr = (typeof id === 'number') ? `#${id}` : '';
  return `${emoji} ${b.name || type} ${indexStr}`;
}

function _stationEmojiFallback(type) {
  switch (type) {
    case 'docks':   return '⚓';
    case 'mine':    return '⛏️';
    case 'factory': return '🏭';
    case 'bunker':  return '🛡️';
    default:        return '🏗️';
  }
}

function _formatActionLabel(action, resource) {
  const resEmoji = _resourceEmoji(resource);
  switch (action) {
    case 'load':      return `Load ${resEmoji}`;
    case 'loadAll':   return 'Load all';
    case 'unload':    return `Unload ${resEmoji}`;
    case 'unloadAll': return 'Unload all';
    case 'idle':      return 'Idle';
    default:          return 'No action';
  }
}

function _resourceEmoji(resKey) {
  switch (resKey) {
    case 'food':      return '🍖';
    case 'scrap':     return '🛠';
    case 'money':     return '💰';
    case 'influence': return '⭐';
    default:          return '❓';
  }
}

/**
 * Find a "station" on the given hex:
 * - Mobile Base unit (very robust heuristics)
 * - Any building at that coordinate
 */
function _findStationAt(scene, q, r) {
  if (q == null || r == null) return null;

  // Collect units from multiple arrays – some setups keep the base only in units, some in players
  const players = Array.isArray(scene.players) ? scene.players : [];
  const units   = Array.isArray(scene.units)   ? scene.units   : [];
  const allUnits = [...players, ...units];

  // First: explicitly flagged mobile base on this hex
  let base = allUnits.find(u =>
    u &&
    u.q === q && u.r === r &&
    (
      u.type === 'mobileBase' ||
      u.isMobileBase === true ||
      u.name === 'Mobile Base' ||
      u.emoji === '🏕️' ||
      u.emoji === '🚚'
    )
  );

  // Fallback: any player unit on that hex counts as Mobile Base station
  if (!base) {
    const anyPlayerOnHex = allUnits.find(u =>
      u && u.q === q && u.r === r && (u.isPlayer === true || u.isBase === true)
    );
    if (anyPlayerOnHex) {
      base = anyPlayerOnHex;
    }
  }

  if (base) {
    return {
      stationType: 'mobileBase',
      stationId: base.id ?? null,
      unitRef: base,
    };
  }

  // Buildings
  const buildings = scene.buildings || [];
  const b = buildings.find(x => x.q === q && x.r === r);
  if (b) {
    return {
      stationType: b.type,
      stationId: b.id,
      buildingRef: b,
    };
  }

  return null;
}
