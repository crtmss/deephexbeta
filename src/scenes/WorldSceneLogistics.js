// src/scenes/WorldSceneLogistics.js
//
// Logistics UI (Factorio-style routes for haulers/ships)
// - Right-side panel under "Logistics" tab
// - Shows list of haulers (and later ships) on the left
// - Shows selected hauler's route on the right
// - Minimal editing: clear route + click-to-add stop from map
//
// Runtime execution of these routes is handled by:
//   src/scenes/WorldSceneLogisticsRuntime.js
// which reads per-carrier `logisticsRoute` + `routeIndex`.
//

/**
 * Shape of a single logistics route stop (informal JSdoc only):
 *
 * {
 *   id: number,                    // local stop id
 *   targetKind: 'building' | 'mobileBase',
 *   buildingId?: number | null,    // for targetKind === 'building'
 *   targetQ: number,
 *   targetR: number,
 *   op: 'loadAll' | 'unloadAll' | 'loadResource' | 'unloadResource',
 *   resourceKey?: string | null,   // e.g. 'food', 'scrap', ...
 * }
 *
 * LogisticsRuntime only really needs: targetQ, targetR, op, resourceKey, targetKind, buildingId.
 * UI adds `label` etc. for display as needed.
 */

const PANEL = {
  width: 520,
  height: 260,
};

const COLORS = {
  plate: 0x0f2233,
  stroke: 0x3da9fc,
  text: '#e8f6ff',
  header: '#9be4ff',
  accent: 0x3da9fc,
  btnBg: 0x173b52,
  btnBgHover: 0x1d5473,
  btnText: '#ffffff',
};

/**
 * Entry point, called from WorldSceneUI.setupTurnUI(scene)
 */
export function setupLogisticsUI(scene) {
  const panelX = scene.scale.width - PANEL.width; // same anchor as resources panel
  const panelY = 70;

  const container = scene.add.container(panelX, panelY)
    .setScrollFactor(0)
    .setDepth(2055);

  container.visible = false;

  // ---- Background frame ----
  const bg = scene.add.graphics();
  bg.fillStyle(COLORS.plate, 0.96);
  bg.fillRoundedRect(0, 0, PANEL.width - 20, PANEL.height, 12);
  bg.lineStyle(2, COLORS.stroke, 1);
  bg.strokeRoundedRect(0, 0, PANEL.width - 20, PANEL.height, 12);

  const bezel = scene.add.graphics();
  bezel.lineStyle(1, 0x9be4ff, 0.25);
  bezel.strokeRect(10, 10, PANEL.width - 40, PANEL.height - 20);
  bezel.strokeRect(18, 18, PANEL.width - 56, PANEL.height - 36);

  container.add([bg, bezel]);

  // Slight inset so we don't stick to the left edge
  container.x = panelX + 20;

  // ---- Titles / columns ----
  const title = scene.add.text(
    24,
    18,
    'Logistics',
    {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: COLORS.header,
      fontStyle: 'bold',
    }
  ).setOrigin(0, 0);

  const haulerHeader = scene.add.text(
    24,
    42,
    'Haulers',
    {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: COLORS.header,
    }
  ).setOrigin(0, 0);

  const routeHeader = scene.add.text(
    220,
    42,
    'Route',
    {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: COLORS.header,
    }
  ).setOrigin(0, 0);

  container.add([title, haulerHeader, routeHeader]);

  // ---- Buttons for route operations ----
  const buttons = {};

  buttons.addStop = makeSmallButton(
    scene,
    220,
    60,
    'Add stop',
    () => _startAddStopMode(scene)
  );
  buttons.clearRoute = makeSmallButton(
    scene,
    320,
    60,
    'Clear',
    () => _clearSelectedHaulerRoute(scene)
  );

  container.add([buttons.addStop.container, buttons.clearRoute.container]);

  // ---- Dynamic areas: hauler list + route list ----
  const meta = {
    container,
    buttons,
    haulerRows: [],   // text objects for left side
    routeRows: [],    // text objects for right side
    selectedHaulerId: null,
    nextStopId: 1,
  };

  scene.logisticsPanel = container;
  scene.logisticsMeta = meta;

  // Public methods on scene:

  scene.refreshLogisticsPanel = function () {
    _refreshLogisticsPanel(scene);
  };

  scene.openLogisticsPanel = function () {
    scene.logisticsPanel.visible = true;
    scene.refreshLogisticsPanel?.();
    scene.closeResourcesPanel?.();
    scene.setActiveTopTab?.('logistics');
  };

  scene.closeLogisticsPanel = function () {
    if (scene.logisticsPanel) scene.logisticsPanel.visible = false;
  };
}

/* ----------------------------------------------------
 * Small helper: create a rectangular text button
 * -------------------------------------------------- */
function makeSmallButton(scene, x, y, label, onClick) {
  const W = 80;
  const H = 24;

  const g = scene.add.graphics();
  g.fillStyle(COLORS.btnBg, 1);
  g.fillRoundedRect(x, y, W, H, 6);
  g.lineStyle(1, COLORS.stroke, 0.9);
  g.strokeRoundedRect(x, y, W, H, 6);

  const t = scene.add.text(
    x + W / 2,
    y + H / 2,
    label,
    {
      fontSize: '12px',
      color: COLORS.btnText,
    }
  ).setOrigin(0.5);

  const hit = scene.add.rectangle(x, y, W, H, 0x000000, 0)
    .setOrigin(0, 0)
    .setInteractive({ useHandCursor: true });

  hit.on('pointerover', () => {
    g.clear();
    g.fillStyle(COLORS.btnBgHover, 1);
    g.fillRoundedRect(x, y, W, H, 6);
    g.lineStyle(1, COLORS.stroke, 0.9);
    g.strokeRoundedRect(x, y, W, H, 6);
  });

  hit.on('pointerout', () => {
    g.clear();
    g.fillStyle(COLORS.btnBg, 1);
    g.fillRoundedRect(x, y, W, H, 6);
    g.lineStyle(1, COLORS.stroke, 0.9);
    g.strokeRoundedRect(x, y, W, H, 6);
  });

  hit.on('pointerdown', (pointer, lx, ly, event) => {
    event?.stopPropagation?.();
    onClick?.();
  });

  return { container: scene.add.container(0, 0, [g, t, hit]), g, t, hit };
}

/* ----------------------------------------------------
 * Main refresh function
 * -------------------------------------------------- */
function _refreshLogisticsPanel(scene) {
  const meta = scene.logisticsMeta;
  if (!meta) return;

  const haulers = scene.haulers || [];

  // ---- ensure selected hauler ----
  if (!meta.selectedHaulerId && haulers.length > 0) {
    const first = haulers[0];
    meta.selectedHaulerId = first.id ?? first._uid ?? 1;
  }

  // Destroy old row texts
  meta.haulerRows.forEach(r => r.destroy());
  meta.routeRows.forEach(r => r.destroy());
  meta.haulerRows.length = 0;
  meta.routeRows.length = 0;

  // ---- Left side: hauler list ----
  const baseX = 24;
  const baseY = 60;
  const rowH  = 18;

  haulers.forEach((h, idx) => {
    const lineY = baseY + idx * rowH;
    const id = (typeof h.id === 'number') ? h.id : (idx + 1);
    const posLabel = `(${h.q},${h.r})`;
    const label = `${h.emoji || '🚚'} Hauler #${id} ${posLabel}`;

    const text = scene.add.text(
      baseX,
      lineY,
      label,
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: meta.selectedHaulerId === (h.id ?? id) ? '#ffffff' : '#c0d8ff',
      }
    ).setOrigin(0, 0);

    text.setInteractive({ useHandCursor: true });
    text.on('pointerdown', (pointer, lx, ly, event) => {
      event?.stopPropagation?.();
      meta.selectedHaulerId = h.id ?? id;
      _refreshLogisticsPanel(scene);
    });

    meta.haulerRows.push(text);
  });

  // ---- Right side: route for selected hauler ----
  const selected = (() => {
    if (haulers.length === 0) return null;
    return haulers.find(h => (h.id ?? 0) === meta.selectedHaulerId) || haulers[0];
  })();

  if (!selected) return;

  if (!Array.isArray(selected.logisticsRoute)) {
    selected.logisticsRoute = [];
  }
  if (typeof selected.routeIndex !== 'number') {
    selected.routeIndex = 0;
  }

  const route = selected.logisticsRoute;

  const routeBaseX = 220;
  const routeBaseY = 88;

  if (route.length === 0) {
    const t = scene.add.text(
      routeBaseX,
      routeBaseY,
      'No route yet. Click "Add stop" and then click a building or the mobile base on the map.',
      {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#9bb3d8',
        wordWrap: { width: PANEL.width - 260 },
      }
    ).setOrigin(0, 0);
    meta.routeRows.push(t);
    return;
  }

  route.forEach((stop, idx) => {
    const y = routeBaseY + idx * rowH;

    const prefix = (idx === selected.routeIndex)
      ? `► ${idx + 1}. `
      : `   ${idx + 1}. `;

    const label = prefix + _describeStop(scene, stop);

    const t = scene.add.text(
      routeBaseX,
      y,
      label,
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: idx === selected.routeIndex ? '#ffffff' : COLORS.text,
      }
    ).setOrigin(0, 0);

    meta.routeRows.push(t);
  });
}

/* ----------------------------------------------------
 * Stop description for UI
 * -------------------------------------------------- */
function _describeStop(scene, stop) {
  // Target name
  let targetName = 'Unknown target';

  if (stop.targetKind === 'mobileBase') {
    targetName = 'Mobile Base';
  } else if (stop.targetKind === 'building' && typeof stop.buildingId === 'number') {
    const b = (scene.buildings || []).find(bb => bb.id === stop.buildingId);
    if (b) {
      const baseName = b.displayName || b.name || (b.type ? b.type[0].toUpperCase() + b.type.slice(1) : 'Building');
      targetName = `${baseName} #${b.id ?? '?'}`;
    }
  } else if (typeof stop.targetQ === 'number' && typeof stop.targetR === 'number') {
    targetName = `Hex (${stop.targetQ},${stop.targetR})`;
  }

  // Operation
  const resEmoji = _resourceEmoji(stop.resourceKey);
  let opText = '';
  switch (stop.op) {
    case 'loadAll':
      opText = 'Load all';
      break;
    case 'unloadAll':
      opText = 'Unload all';
      break;
    case 'loadResource':
      opText = `Load ${resEmoji}`;
      break;
    case 'unloadResource':
      opText = `Unload ${resEmoji}`;
      break;
    default:
      opText = 'Idle';
      break;
  }

  return `${targetName} (${opText})`;
}

function _resourceEmoji(key) {
  switch (key) {
    case 'food':  return '🍖';
    case 'scrap': return '🛠';
    case 'money': return '💰';
    default:      return key || '…';
  }
}

/* ----------------------------------------------------
 * Clear route for current hauler
 * -------------------------------------------------- */
function _clearSelectedHaulerRoute(scene) {
  const meta = scene.logisticsMeta;
  if (!meta) return;

  const haulers = scene.haulers || [];
  const selected = haulers.find(h => (h.id ?? 0) === meta.selectedHaulerId) || haulers[0];
  if (!selected) return;

  selected.logisticsRoute = [];
  selected.routeIndex = 0;
  console.log('[LOGI] Cleared route for hauler', selected.id);
  _refreshLogisticsPanel(scene);
}

/* ----------------------------------------------------
 * Add stop: click-to-pick building or mobile base on map
 * -------------------------------------------------- */
function _startAddStopMode(scene) {
  const meta = scene.logisticsMeta;
  if (!meta) return;

  const haulers = scene.haulers || [];
  const selected = haulers.find(h => (h.id ?? 0) === meta.selectedHaulerId) || haulers[0];
  if (!selected) return;

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
    .setDepth(2500);

  console.log('[LOGI] Add stop: click a building or the mobile base on the map…');

  overlay.once('pointerdown', (pointer, lx, ly, event) => {
    event?.stopPropagation?.();
    overlay.destroy();

    const worldPoint = pointer.positionToCamera(scene.cameras.main);
    const { q, r } = scene.worldToAxial(worldPoint.x, worldPoint.y);

    if (q < 0 || r < 0 || q >= scene.mapWidth || r >= scene.mapHeight) {
      console.warn('[LOGI] Click out of bounds, cancelled.');
      return;
    }

    const buildings = scene.buildings || [];
    const building = buildings.find(b => b.q === q && b.r === r) || null;

    // Try to detect mobile base
    let mobileBase = null;
    if (!building && Array.isArray(scene.players)) {
      mobileBase = scene.players.find(u =>
        u.q === q && u.r === r &&
        (u.type === 'mobileBase' || u.isMobileBase === true ||
         u.name === 'Mobile Base' || u.emoji === '🏕️' || u.emoji === '🚚')
      ) || null;
    }

    if (!building && !mobileBase) {
      console.warn('[LOGI] No building or mobile base on clicked hex — stop not added.');
      return;
    }

    const targetKind = building ? 'building' : 'mobileBase';
    const buildingId = building ? building.id ?? null : null;

    // Simple heuristic: first stop => loadAll, second => unloadAll, then alternate
    const route = selected.logisticsRoute || (selected.logisticsRoute = []);
    const index = route.length;
    let op = 'loadAll';
    if (index === 1) {
      op = 'unloadAll';
    } else if (index >= 2) {
      op = (route[index - 1]?.op === 'loadAll') ? 'unloadAll' : 'loadAll';
    }

    const stop = {
      id: meta.nextStopId++,
      targetKind,
      buildingId,
      targetQ: q,
      targetR: r,
      op,
      resourceKey: 'food', // default; can be expanded later in UI
    };

    route.push(stop);
    selected.routeIndex = 0;
    console.log('[LOGI] Added stop to hauler route:', stop);
    _refreshLogisticsPanel(scene);
  });
}

export default {
  setupLogisticsUI,
};
