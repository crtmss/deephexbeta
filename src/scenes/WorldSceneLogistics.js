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

  // panel background (50% bigger)
  const W = 460 * 1.5;   // 690
  const H = 260 * 1.5;   // 390

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

  // Titles (font sizes 50% bigger)
  const title = scene.add.text(
    16, 12,
    'Logistics – Haulers & Ships',
    {
      fontSize: '24px',
      color: LOGI_COLORS.textMain,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0);

  const subtitle = scene.add.text(
    16, 32,
    'Select a hauler on the left to inspect or edit its route.',
    {
      fontSize: '18px',
      color: LOGI_COLORS.textDim,
    }
  ).setOrigin(0, 0);

  container.add([title, subtitle]);

  // Close button (top-right X)
  const closeText = scene.add.text(
    W - 18, 10,
    '✕',
    {
      fontSize: '24px',
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
      fontSize: '21px',
      color: LOGI_COLORS.textMain,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0);

  const listContainer = scene.add.container(16, 76);
  container.add([listLabel, listContainer]);

  // Right column: selected hauler details
  const detailLabel = scene.add.text(
    260, 56,
    'Selected Route',
    {
      fontSize: '21px',
      color: LOGI_COLORS.textMain,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0);

  const detailContainer = scene.add.container(260, 76);
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

    // Unselect any selected unit and clear path preview
    this.setSelectedUnit?.(null);
    this.clearPathPreview?.();

    this.logisticsUI.container.visible = true;
    this.isLogisticsOpen = true; // block movement input while open
    this.refreshLogisticsPanel?.();
  };

  scene.closeLogisticsPanel = function () {
    if (!this.logisticsUI) return;
    this.logisticsUI.container.visible = false;
    this.isLogisticsOpen = false;
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
    const lineH = 30; // increased spacing for bigger font

    if (haulers.length === 0) {
      const txt = this.add.text(
        0, 0,
        'No haulers or ships yet.',
        { fontSize: '18px', color: LOGI_COLORS.textDim }
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
            fontSize: '19px',
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
        { fontSize: '18px', color: LOGI_COLORS.textDim }
      ).setOrigin(0, 0);
      ui.detailContainer.add(t);
      return;
    }

    _renderHaulerDetails(this, selected);
  };
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
    if (b.type === 'mine') {
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
    }

    // Update per-building resource label for *all* buildings (except bunker)
    _ensureBuildingResourceLabel(scene, b);
    _updateBuildingResourceLabel(scene, b);
  });
}

export default {
  setupLogisticsPanel,
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
 * - "＋ Add station…" button to append a new step
 * - "Reset routes" button to clear all steps
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
      fontSize: '21px',
      color: LOGI_COLORS.textMain,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0);
  c.add(title);
  y += 30;

  const posLine = scene.add.text(
    0, y,
    `Position: (${hauler.q ?? '?'}, ${hauler.r ?? '?'})`,
    { fontSize: '18px', color: LOGI_COLORS.textDim }
  ).setOrigin(0, 0);
  c.add(posLine);
  y += 24;

  // Simple cargo summary: 4 resource types
  const cargo = hauler.cargo || {};
  const cargoStr =
    `Cargo: ` +
    `🍖 ${cargo.food ?? 0}  ` +
    `🛠 ${cargo.scrap ?? 0}  ` +
    `💰 ${cargo.money ?? 0}  ` +
    `⭐ ${cargo.influence ?? 0}`;
  const cargoLine = scene.add.text(
    0, y,
    cargoStr,
    { fontSize: '18px', color: LOGI_COLORS.textDim }
  ).setOrigin(0, 0);
  c.add(cargoLine);
  y += 27;

  // Divider
  const divider = scene.add.graphics();
  divider.lineStyle(1, 0x9bb6cc, 0.4);
  divider.strokeLineShape(new Phaser.Geom.Line(0, y, 320, y));
  c.add(divider);
  y += 12;

  // Route preview
  const route = Array.isArray(hauler.logisticsRoute) ? hauler.logisticsRoute : [];
  if (route.length === 0) {
    const note = scene.add.text(
      0, y,
      'No custom logistics route.\n\n' +
      'Haulers do *nothing* by default.\n\n' +
      'Click "＋ Add station…" below,\n' +
      'then left-click a station on the map\n' +
      'and choose an action.',
      {
        fontSize: '16px',
        color: LOGI_COLORS.textDim,
      }
    ).setOrigin(0, 0);
    c.add(note);
    y += note.height + 12;

    _addAddStationButton(scene, hauler, c, y);
    _addResetRoutesButton(scene, hauler, c, y + 30);
    return;
  }

  const routeTitle = scene.add.text(
    0, y,
    'Route:',
    {
      fontSize: '20px',
      color: LOGI_COLORS.textMain,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0);
  c.add(routeTitle);
  y += 27;

  route.forEach((step, idx) => {
    const stepText = _formatRouteStep(scene, step, idx);
    const t = scene.add.text(
      0, y,
      stepText,
      {
        fontSize: '18px',
        color: LOGI_COLORS.textMain,
      }
    ).setOrigin(0, 0);
    c.add(t);
    y += 24;
  });

  y += 9;
  const stub = scene.add.text(
    0, y,
    'Use "＋ Add station…" to extend this route.',
    { fontSize: '16px', color: LOGI_COLORS.textDim }
  ).setOrigin(0, 0);
  c.add(stub);
  y += stub.height + 6;

  _addAddStationButton(scene, hauler, c, y);
  _addResetRoutesButton(scene, hauler, c, y + 30);
}

/**
 * Small helper to create the "＋ Add station…" button.
 */
function _addAddStationButton(scene, hauler, container, y) {
  const btn = scene.add.text(
    0, y,
    '＋ Add station…',
    {
      fontSize: '18px',
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
 * "Reset routes" button – clears the logisticsRoute for this hauler.
 */
function _addResetRoutesButton(scene, hauler, container, y) {
  const btn = scene.add.text(
    0, y,
    'Reset routes',
    {
      fontSize: '17px',
      color: LOGI_COLORS.textDim,
      fontStyle: 'italic',
    }
  ).setOrigin(0, 0).setInteractive({ useHandCursor: true });

  btn.on('pointerdown', () => {
    hauler.logisticsRoute = [];
    hauler.routeIndex = 0;
    hauler.pinnedToBase = false;
    console.log('[LOGI] Routes reset for hauler#', hauler._logiId);
    scene.refreshLogisticsPanel?.();
  });

  container.add(btn);
}

/**
 * Begin "add station" interaction.
 * Hides the logistics panel so the player can see/click hexes behind it,
 * then reopens the panel after the hex click (success or failure).
 */
function _startAddStationFlow(scene, hauler) {
  if (!scene || !hauler) return;
  console.log('[LOGI] Add station: left-click a Mobile Base or building hex.');

  // Hide the logistics UI so we can see the map behind it.
  const ui = scene.logisticsUI;
  const wasVisible = !!(ui && ui.container.visible);
  if (ui) {
    ui.container.visible = false;
  }
  scene.isLogisticsOpen = false;

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

  // flag so WorldSceneUI input won't treat this click as move order
  scene.isLogisticsPickingStation = true;

  const finish = () => {
    overlay.destroy();
    scene.isLogisticsPickingStation = false;
    if (wasVisible) {
      scene.openLogisticsPanel?.();
    }
  };

  overlay.once('pointerdown', (pointer, _lx, _ly, event) => {
    event?.stopPropagation?.();

    const worldPoint = pointer.positionToCamera(scene.cameras.main);
    const { q, r } = scene.worldToAxial(worldPoint.x, worldPoint.y);

    const station = _findStationAt(scene, q, r);
    if (!station) {
      console.warn('[LOGI] No station (mobile base or building) on that hex.', { q, r });
      finish();
      return;
    }

    finish();
    _showActionPicker(scene, hauler, station);
  });
}

/**
 * After picking a station on the map, present action options
 * (Load all / Load resource / Unload all / Unload resource / Idle) in the Logistics panel.
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
      fontSize: '21px',
      color: LOGI_COLORS.textMain,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0);
  c.add(title);
  y += 30;

  const hint = scene.add.text(
    0, y,
    'Choose what this hauler should do at this stop:',
    { fontSize: '18px', color: LOGI_COLORS.textDim }
  ).setOrigin(0, 0);
  c.add(hint);
  y += 24;

  // --- Buttons ---

  const addBtn = (label, onClick) => {
    const b = scene.add.text(
      0, y,
      label,
      {
        fontSize: '18px',
        color: LOGI_COLORS.listHighlight,
      }
    ).setOrigin(0, 0).setInteractive({ useHandCursor: true });

    b.on('pointerdown', onClick);
    c.add(b);
    y += 24;
  };

  // Load all (non-resource specific, runtime chooses which resource)
  addBtn('Load all', () => {
    _addRouteStep(scene, hauler, station, 'loadAll', null);
  });

  // Load resource (brings up secondary picker)
  addBtn('Load resource…', () => {
    _showResourcePicker(scene, hauler, station, 'load');
  });

  // Unload all
  addBtn('Unload all', () => {
    _addRouteStep(scene, hauler, station, 'unloadAll', null);
  });

  // Unload resource (secondary picker)
  addBtn('Unload resource…', () => {
    _showResourcePicker(scene, hauler, station, 'unload');
  });

  // Idle
  addBtn('Idle at station', () => {
    _addRouteStep(scene, hauler, station, 'idle', null);
  });

  y += 15;
  const note = scene.add.text(
    0, y,
    'Idle at a Mobile Base will pin the hauler\n' +
    'so it stays inside when the base moves.\n\n' +
    'You cannot have a route that both LOADS\n' +
    'and UNLOADS at the same station.',
    { fontSize: '16px', color: LOGI_COLORS.textDim }
  ).setOrigin(0, 0);
  c.add(note);
}

/**
 * Resource picker for "Load resource…" / "Unload resource…".
 */
function _showResourcePicker(scene, hauler, station, mode /* 'load' | 'unload' */) {
  const ui = scene.logisticsUI;
  if (!ui) return;

  const c = ui.detailContainer;
  c.removeAll(true);

  const isLoad = mode === 'load';

  let y = 0;
  const title = scene.add.text(
    0, y,
    `${isLoad ? 'Load' : 'Unload'} which resource?`,
    {
      fontSize: '21px',
      color: LOGI_COLORS.textMain,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0);
  c.add(title);
  y += 30;

  const hint = scene.add.text(
    0, y,
    'Choose a specific resource:',
    { fontSize: '18px', color: LOGI_COLORS.textDim }
  ).setOrigin(0, 0);
  c.add(hint);
  y += 24;

  const resources = [
    { key: 'food',      label: 'Food 🍖' },
    { key: 'scrap',     label: 'Scrap 🛠' },
    { key: 'money',     label: 'Money 💰' },
    { key: 'influence', label: 'Influence ⭐' },
  ];

  resources.forEach(res => {
    const btn = scene.add.text(
      0, y,
      res.label,
      {
        fontSize: '18px',
        color: LOGI_COLORS.listHighlight,
      }
    ).setOrigin(0, 0).setInteractive({ useHandCursor: true });

    btn.on('pointerdown', () => {
      _addRouteStep(scene, hauler, station, isLoad ? 'load' : 'unload', res.key);
    });

    c.add(btn);
    y += 24;
  });

  y += 20;
  const back = scene.add.text(
    0, y,
    '← Back',
    {
      fontSize: '16px',
      color: LOGI_COLORS.textDim,
      fontStyle: 'italic',
    }
  ).setOrigin(0, 0).setInteractive({ useHandCursor: true });

  back.on('pointerdown', () => {
    _showActionPicker(scene, hauler, station);
  });

  c.add(back);
}

/**
 * Add a route step with validation:
 * - Forbids having both a LOAD and UNLOAD action at the same station.
 * - Handles Mobile Base "idle" pinning.
 */
function _addRouteStep(scene, hauler, station, actionKey, resourceKey) {
  hauler.logisticsRoute = hauler.logisticsRoute || [];

  const step = {
    stationType: station.stationType,
    stationId: station.stationId,
    action: actionKey,
    resource: resourceKey || null,
  };

  if (_wouldConflictWithExistingStep(hauler.logisticsRoute, step)) {
    console.warn(
      '[LOGI] Refusing route that both loads and unloads at the same station.',
      step
    );
    return;
  }

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
}

/**
 * Check if adding "step" would create a route that both LOADS and UNLOADS
 * at the same station.
 */
function _wouldConflictWithExistingStep(route, newStep) {
  const isLoad = _isLoadAction(newStep.action);
  const isUnload = _isUnloadAction(newStep.action);

  // Idle / non-transfer actions never conflict
  if (!isLoad && !isUnload) return false;

  return route.some(s => {
    if (!s) return false;
    if (s.stationType !== newStep.stationType) return false;

    // stationId may be null for Mobile Base; treat null==null as "same"
    if ((s.stationId ?? null) !== (newStep.stationId ?? null)) return false;

    const sLoad = _isLoadAction(s.action);
    const sUnload = _isUnloadAction(s.action);

    // Conflict only if one is load-ish and the other unload-ish at same station
    return (sLoad && isUnload) || (sUnload && isLoad);
  });
}

function _isLoadAction(action) {
  return action === 'load' || action === 'loadAll';
}
function _isUnloadAction(action) {
  return action === 'unload' || action === 'unloadAll';
}

/**
 * Convert a single route step into a readable string.
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
 * - Any building at that coordinate
 * - Mobile Base unit (your big red circle, type 'mobile_base') *if no building there*
 *
 * IMPORTANT: buildings are checked *before* Mobile Base,
 * and we removed the "fallback single mobile base" hack that caused your bug.
 */
function _findStationAt(scene, q, r) {
  if (q == null || r == null) return null;

  // 1) Buildings first (mine, docks, factory, bunker, etc.)
  const buildings = scene.buildings || [];
  const b = buildings.find(x => x.q === q && x.r === r);
  if (b) {
    return {
      stationType: b.type,
      stationId: b.id,
      buildingRef: b,
    };
  }

  // 2) Mobile base / player units
  const players = Array.isArray(scene.players) ? scene.players : [];
  const units   = Array.isArray(scene.units)   ? scene.units   : [];
  const allUnits = [...players, ...units];

  const base = allUnits.find(u => {
    if (!u || typeof u.q !== 'number' || typeof u.r !== 'number') return false;
    if (u.q !== q || u.r !== r) return false;

    const isMobileBaseType =
      u.type === 'mobile_base' ||
      u.type === 'mobileBase';

    const isLocalPlayer =
      !!scene.playerName && u.playerName === scene.playerName;

    return isMobileBaseType && isLocalPlayer;
  });

  if (base) {
    return {
      stationType: 'mobileBase',
      stationId: base.id ?? null,
      unitRef: base,
    };
  }

  return null;
}

///////////////////////////////
// Building resource label helpers
///////////////////////////////

/**
 * Create a floating resource label for a building if needed.
 * Placed in the upper-right of the building (similar to docks food label).
 */
function _ensureBuildingResourceLabel(scene, building) {
  if (!building) return;
  if (building.type === 'bunker') return; // no label for bunkers by design

  if (building.resourceLabelObj && !building.resourceLabelObj.destroyed) return;

  const pos = scene.axialToWorld(building.q, building.r);
  building.resourceLabelObj = scene.add.text(
    pos.x + 16,
    pos.y - 14,
    '',
    {
      fontSize: '16px',
      color: '#ffffff',
    }
  ).setOrigin(0, 1).setDepth(2101); // similar depth to docks overlay
}

/**
 * Update the contents of a building's resource label from building.resources
 * and legacy storage fields. Only show resources > 0.
 */
function _updateBuildingResourceLabel(scene, building) {
  if (!building || building.type === 'bunker') return;
  if (!building.resourceLabelObj) return;

  const res = building.resources || {};
  const vals = {
    food:      res.food       ?? building.storageFood  ?? 0,
    scrap:     res.scrap      ?? building.storageScrap ?? 0,
    energy:    res.energy     ?? 0,
    metal:     res.metal      ?? res.metalPlates ?? 0,
    components:res.components ?? 0,
    currency:  res.currency   ?? 0,
  };

  const parts = [];
  if (vals.food > 0)      parts.push(`🍖×${vals.food}`);
  if (vals.scrap > 0)     parts.push(`🛠×${vals.scrap}`);
  if (vals.energy > 0)    parts.push(`⚡×${vals.energy}`);
  if (vals.metal > 0)     parts.push(`🔩×${vals.metal}`);
  if (vals.components > 0)parts.push(`🧩×${vals.components}`);
  if (vals.currency > 0)  parts.push(`💰×${vals.currency}`);

  building.resourceLabelObj.setText(parts.join(' '));

  // Reposition each update (in case building moved or map offset changed)
  const pos = scene.axialToWorld(building.q, building.r);
  building.resourceLabelObj.setPosition(pos.x + 16, pos.y - 14);
}
