// src/scenes/WorldSceneEnergyUI.js
//
// Energy (Electricity) panel UI.
// Visual style intentionally mirrors Logistics panel.
//
// UX:
//  - Opening the panel highlights ALL tiles that belong to any power network.
//  - Hovering a network highlights only that network.
//
// Data source:
//  - scene.electricState (created by WorldSceneElectricity)

const UI_Z = 9105;

// Palette (match Logistics-ish)
const COLORS = {
  bg: 0x08121c,
  border: 0x2ec7ff,
  title: '#d6f3ff',
  text: '#ffffff',      // ensure high contrast for main row title
  subtle: '#86b6cf',
  danger: '#ff8b8b',
  ok: '#b8ffcf',
};

function fmtSigned(n) {
  const v = Math.round(n);
  return v >= 0 ? `+${v}` : `${v}`;
}
function safeArr(x) {
  return Array.isArray(x) ? x : [];
}
function getTile(scene, q, r) {
  return (scene.mapData || []).find(t => t && t.q === q && t.r === r) || null;
}

/**
 * Draw a hex polygon centered at x,y.
 * Pointy-top orientation.
 */
function drawHex(g, x, y, radius, fillColor, fillAlpha, lineColor, lineAlpha) {
  const pts = [];
  const start = Math.PI / 6; // 30deg
  for (let i = 0; i < 6; i++) {
    const a = start + i * (Math.PI / 3);
    pts.push({ x: x + radius * Math.cos(a), y: y + radius * Math.sin(a) });
  }

  g.fillStyle(fillColor, fillAlpha);
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
  g.fillPath();

  if (lineAlpha > 0) {
    g.lineStyle(2, lineColor, lineAlpha);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    g.strokePath();
  }
}

/**
 * Compute list of display networks:
 *  - Base network (mobile base energy)
 *  - Each electricityState.networks entry
 */
function computeDisplayNetworks(scene) {
  const es = scene.electricState || null;
  const out = [];

  // Base “network”
  const baseStored = es?.baseStored ?? 0;
  const baseCap = es?.baseCapacity ?? 5;
  const baseProd = es?.baseProductionPerTurn ?? 1;

  const baseUnit =
    safeArr(scene.players).find(p => p?.type === 'mobile_base') ||
    safeArr(scene.units).find(p => p?.type === 'mobile_base') ||
    null;

  out.push({
    kind: 'base',
    id: 'base',
    title: 'Mobile Base',
    stored: baseStored,
    capacity: baseCap,
    producedPerTurn: baseProd,
    demandPerTurn: 0,
    tiles:
      baseUnit && Number.isFinite(baseUnit.q) && Number.isFinite(baseUnit.r)
        ? [{ q: baseUnit.q, r: baseUnit.r }]
        : [],
  });

  const nets = es?.networks || {};
  const ids = Object.keys(nets)
    .map(x => parseInt(x, 10))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  for (const id of ids) {
    const net = nets[id];
    if (!net) continue;

    let prod = 0;
    let dem = 0;

    // Production sum
    for (const b of safeArr(net.producers)) {
      const e = b?.energy || {};
      const t = String(b?.type || '').toLowerCase();
      if (t === 'fuel_generator') {
        prod += Number.isFinite(e.productionPerTurn) ? e.productionPerTurn : 5;
      } else if (t === 'solar_panel') {
        prod += Number.isFinite(e.productionPerTurn) ? e.productionPerTurn : 2;
      } else {
        prod += Number.isFinite(e.productionPerTurn) ? e.productionPerTurn : 0;
      }
    }

    // Demand sum
    for (const b of safeArr(net.consumers)) {
      const e = b?.energy || {};
      dem += Number.isFinite(e.consumptionPerTurn) ? e.consumptionPerTurn : 0;
    }

    const tiles = safeArr(net.nodes)
      .map(n => ({ q: n?.q, r: n?.r }))
      .filter(p => Number.isFinite(p.q) && Number.isFinite(p.r));

    out.push({
      kind: 'network',
      id,
      title: `Network ${id}`,
      stored: net.storedEnergy ?? 0,
      capacity: net.storageCapacity ?? 0,
      producedPerTurn: prod,
      demandPerTurn: dem,
      tiles,
    });
  }

  return out;
}

/**
 * Draw overlay highlights for a set of tiles.
 * Goal: visually match your regular hover highlight on the map.
 * If the scene exposes a hover-highlighting helper, we reuse it.
 * Otherwise we fallback to a "hover-like" white outline.
 */
function drawEnergyOverlay(scene, tiles) {
  if (!scene || !scene.add) return;

  if (scene.energyHighlightGraphics) {
    scene.energyHighlightGraphics.destroy();
    scene.energyHighlightGraphics = null;
  }

  const g = scene.add.graphics().setDepth(95);
  scene.energyHighlightGraphics = g;

  const size = scene.hexSize || 24;
  const radius = size * 0.62;

  const seen = new Set();
  for (const p of safeArr(tiles)) {
    if (!p) continue;
    const q = p.q, r = p.r;
    if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
    const k = `${q},${r}`;
    if (seen.has(k)) continue;
    seen.add(k);

    const world =
      typeof scene.axialToWorld === 'function'
        ? scene.axialToWorld(q, r)
        : { x: 0, y: 0 };

    const t = getTile(scene, q, r);
    if (t && t.type === 'water') continue;

    // If the scene has a canonical hover highlight drawer, prefer it.
    // (We keep safe fallbacks because naming differs per project.)
    const usedSceneHighlight =
      (typeof scene.drawHoverHexAt === 'function' && (scene.drawHoverHexAt(world.x, world.y, g), true)) ||
      (typeof scene.drawHexHoverAt === 'function' && (scene.drawHexHoverAt(world.x, world.y, g), true)) ||
      (typeof scene.drawHexOutlineAt === 'function' && (scene.drawHexOutlineAt(world.x, world.y, g), true));

    if (!usedSceneHighlight) {
      // Fallback: mimic "hover" look (white outline, minimal fill)
      drawHex(g, world.x, world.y, radius, 0xffffff, 0.04, 0xffffff, 0.95);
    }
  }
}

function clearEnergyOverlay(scene) {
  if (scene.energyHighlightGraphics) {
    scene.energyHighlightGraphics.destroy();
    scene.energyHighlightGraphics = null;
  }
}

export function setupEnergyPanel(scene) {
  if (!scene) return;
  if (scene.energyUI?.initialized) return;

  scene.energyUI = scene.energyUI || {};
  scene.energyUI.initialized = true;
  scene.energyUI.needsRefresh = false;

  const W = 360;
  const H = 420;

  const panel = scene.add
    .container(scene.scale.width - W - 20, 98)
    .setScrollFactor(0)
    .setDepth(UI_Z)
    .setVisible(false);

  // Background first, always behind
  const bg = scene.add.graphics();
  bg.fillStyle(COLORS.bg, 0.92);
  bg.fillRoundedRect(0, 0, W, H, 14);
  bg.lineStyle(2, COLORS.border, 0.9);
  bg.strokeRoundedRect(0, 0, W, H, 14);
  panel.add(bg);

  const title = scene.add.text(16, 12, 'ENERGY NETWORKS', {
    fontFamily: 'monospace',
    fontSize: '14px',
    color: COLORS.title,
  });
  panel.add(title);

  const hint = scene.add.text(16, 32, 'Hover a network to highlight it on the map.', {
    fontFamily: 'monospace',
    fontSize: '11px',
    color: COLORS.subtle,
  });
  panel.add(hint);

  panel.sendToBack(bg);

  const listY = 58;
  const rowH = 52;
  const maxRows = 6;

  const rows = [];

  for (let i = 0; i < maxRows; i++) {
    const y = listY + i * rowH;

    const line = scene.add.graphics();
    line.lineStyle(1, 0x1f3b52, 0.9);
    line.beginPath();
    line.moveTo(12, y + rowH - 1);
    line.lineTo(W - 12, y + rowH - 1);
    line.strokePath();

    const name = scene.add.text(18, y + 8, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: COLORS.text, // white
    });

    const meta = scene.add.text(18, y + 26, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: COLORS.subtle,
    });

    const delta = scene.add
      .text(W - 18, y + 16, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: COLORS.ok,
      })
      .setOrigin(1, 0);

    const hit = scene.add.rectangle(0, y, W, rowH, 0xffffff, 0.001).setOrigin(0, 0);
    hit.setInteractive({ useHandCursor: true });

    const row = { name, meta, delta, hit, network: null };
    rows.push(row);

    panel.add([line, name, meta, delta, hit]);
  }

  const footer = scene.add.text(16, H - 38, '', {
    fontFamily: 'monospace',
    fontSize: '11px',
    color: COLORS.subtle,
    wordWrap: { width: W - 32 },
  });
  panel.add(footer);

  scene.energyUI.panel = panel;
  scene.energyUI.rows = rows;
  scene.energyUI.footer = footer;

  // --- Auto refresh wiring ---
  // 1) Refresh when: panel open AND someone marked it OR electricity marked dirty.
  // 2) Refresh after endTurn() so values update each turn even if not dirty.
  if (!scene.energyUI._wiredAutoRefresh) {
    scene.energyUI._wiredAutoRefresh = true;

    // next-frame refresh helper
    scene.requestEnergyUIRefresh = function () {
      if (!scene.energyUI) return;
      scene.energyUI.needsRefresh = true;
    };

    // run once per frame if needed (cheap when closed)
    scene.events?.on?.('postupdate', () => {
      if (!scene.energyUI?.isOpen) return;
      if (scene.energyUI.needsRefresh || scene.electricState?.dirty) {
        scene.energyUI.needsRefresh = false;
        scene.refreshEnergyPanel?.();
      }
    });

    // wrap endTurn to trigger a refresh after turn resolves
    if (typeof scene.endTurn === 'function' && !scene._energyUIWrappedEndTurn) {
      scene._energyUIWrappedEndTurn = true;
      const origEndTurn = scene.endTurn;
      scene.endTurn = function (...args) {
        const ret = origEndTurn.apply(this, args);
        // even if networks aren't dirty, energy values can change per turn
        this.requestEnergyUIRefresh?.();
        return ret;
      };
    }
  }

  scene.openEnergyPanel = function () {
    panel.setVisible(true);
    scene.energyUI.isOpen = true;
    scene.requestEnergyUIRefresh?.();
    scene.showAllEnergyReach?.();
  };

  scene.closeEnergyPanel = function () {
    panel.setVisible(false);
    scene.energyUI.isOpen = false;
    clearEnergyOverlay(scene);
  };

  scene.refreshEnergyPanel = function () {
    if (!scene.energyUI?.isOpen) return;

    // If electricity system exposes recalc and state is dirty, recalc now
    try {
      if (scene.electricState?.dirty) {
        // Try a few likely attachment points
        if (scene.electricitySystem?.recalcNetworks) scene.electricitySystem.recalcNetworks(scene);
        else if (scene.electricity?.recalcNetworks) scene.electricity.recalcNetworks(scene);
        else if (scene.electricitySystem?.recalc) scene.electricitySystem.recalc(scene);
        // else: electricity module may already recalc lazily elsewhere
      }
    } catch (e) {}

    const nets = computeDisplayNetworks(scene);
    const ordered = nets.slice().sort((a, b) => {
      if (a.kind === 'base' && b.kind !== 'base') return -1;
      if (b.kind === 'base' && a.kind !== 'base') return 1;
      return a.id > b.id ? 1 : a.id < b.id ? -1 : 0;
    });

    footer.setText(`Networks: ${ordered.length} • Hover to isolate highlight`);

    const visible = ordered.slice(0, rows.length);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const net = visible[i] || null;
      row.network = net;

      if (!net) {
        row.name.setText('');
        row.meta.setText('');
        row.delta.setText('');
        row.hit.disableInteractive();
        continue;
      }

      row.hit.setInteractive({ useHandCursor: true });

      const stored = Math.max(0, net.stored || 0);
      const cap = Math.max(0, net.capacity || 0);
      const prod = net.producedPerTurn || 0;
      const dem = net.demandPerTurn || 0;
      const d = prod - dem;

      row.name.setText(net.title);
      row.meta.setText(
        `Stored ${Math.round(stored)}/${cap > 0 ? Math.round(cap) : '∞'} • Prod ${Math.round(prod)} / Use ${Math.round(dem)}`
      );

      row.delta.setColor(d < 0 ? COLORS.danger : COLORS.ok);
      row.delta.setText(fmtSigned(d));

      row.hit.removeAllListeners?.();
      row.hit.on('pointerover', () => scene.highlightEnergyNetwork?.(net));
      row.hit.on('pointerout', () => scene.showAllEnergyReach?.());
    }
  };

  scene.showAllEnergyReach = function () {
    if (!scene.energyUI?.isOpen) return;
    const nets = computeDisplayNetworks(scene);
    const tiles = [];
    for (const n of nets) tiles.push(...safeArr(n.tiles));
    drawEnergyOverlay(scene, tiles);
  };

  scene.highlightEnergyNetwork = function (net) {
    if (!scene.energyUI?.isOpen) return;
    drawEnergyOverlay(scene, safeArr(net?.tiles));
  };
}

export default {
  setupEnergyPanel,
};
