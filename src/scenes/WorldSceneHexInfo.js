// src/scenes/WorldSceneHexInfo.js
//
// Hex Info panel (bottom-left).
// Shows EVERYTHING attached to the currently clicked hex (q,r):
// - Tile fields (terrain, water, elevation, flags)
// - POIs / roads
// - Units / enemies / haulers / ships
// - Buildings (including hidden behind unit icon)
// - Electricity: network id / online flags
// - Any mapInfo objects at that coord
//
// Visual style mirrors Logistics / History panels.

const UI_Z = 9105;

const COLORS = {
  bg: 0x0b1925,
  border: 0x3da9fc,
  title: '#ffffff',
  text: '#c4f1ff',
  subtle: '#8fb6d9',
  accent: '#d6f3ff',
  danger: '#ff8b8b',
  ok: '#b8ffcf',
};

function safeArr(x) {
  return Array.isArray(x) ? x : [];
}

function keyOf(q, r) {
  return `${q},${r}`;
}

function getTile(scene, q, r) {
  return safeArr(scene.mapData).find(t => t && t.q === q && t.r === r) || null;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj && obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function fmtBool(v) {
  return v ? 'YES' : 'NO';
}

function fmtNum(v, fallback = '—') {
  return Number.isFinite(v) ? String(v) : fallback;
}

function fmtList(arr, empty = '—') {
  if (!arr || arr.length === 0) return empty;
  return arr.join(', ');
}

function tryName(obj) {
  if (!obj) return 'Unknown';
  return obj.name || obj.title || obj.type || obj.kind || 'Unknown';
}

function getObjectQR(obj) {
  if (!obj) return null;
  if (Number.isFinite(obj.q) && Number.isFinite(obj.r)) return { q: obj.q, r: obj.r };
  if (obj.tile && Number.isFinite(obj.tile.q) && Number.isFinite(obj.tile.r)) return { q: obj.tile.q, r: obj.tile.r };
  if (obj.hex && Number.isFinite(obj.hex.q) && Number.isFinite(obj.hex.r)) return { q: obj.hex.q, r: obj.hex.r };
  if (obj.position && Number.isFinite(obj.position.q) && Number.isFinite(obj.position.r)) return { q: obj.position.q, r: obj.position.r };
  return null;
}

function matchAt(obj, q, r) {
  const p = getObjectQR(obj);
  return !!p && p.q === q && p.r === r;
}

function findAllAt(scene, q, r) {
  const units = safeArr(scene.units).filter(u => matchAt(u, q, r));
  const players = safeArr(scene.players).filter(u => matchAt(u, q, r));
  const enemies = safeArr(scene.enemies).filter(u => matchAt(u, q, r));
  const haulers = safeArr(scene.haulers).filter(u => matchAt(u, q, r));
  const ships = safeArr(scene.ships).filter(u => matchAt(u, q, r));
  const buildings = safeArr(scene.buildings).filter(b => matchAt(b, q, r));
  const resources = safeArr(scene.resources).filter(res => matchAt(res, q, r));

  // mapInfo.objects (ruins, wrecks etc.)
  const mapObjects = safeArr(scene.mapInfo?.objects).filter(o => matchAt(o, q, r));

  return { units, players, enemies, haulers, ships, buildings, resources, mapObjects };
}

function summarizeUnit(u) {
  const bits = [];
  bits.push(u.type ? String(u.type) : 'unit');
  if (u.isLocalPlayer) bits.push('local');
  if (u.isPlayer) bits.push('player');
  if (u.isEnemy) bits.push('enemy');
  if (Number.isFinite(u.movementPoints)) bits.push(`mp:${u.movementPoints}`);
  if (Number.isFinite(u.hp)) bits.push(`hp:${u.hp}`);
  return `${tryName(u)} (${bits.join(' ')})`;
}

function summarizeBuilding(b) {
  const bits = [];
  bits.push(b.type ? String(b.type) : 'building');

  // energy flags if present
  if (b.powerNetworkId !== undefined && b.powerNetworkId !== null) {
    bits.push(`net:${b.powerNetworkId}`);
  }
  if (typeof b.powerOnline === 'boolean') {
    bits.push(b.powerOnline ? 'online' : 'offline');
  }
  if (b.powerOfflineReason) bits.push(`reason:${b.powerOfflineReason}`);

  // storage/prod/cons if present
  const e = b.energy || {};
  if (Number.isFinite(e.productionPerTurn) && e.productionPerTurn > 0) bits.push(`prod:+${e.productionPerTurn}`);
  if (Number.isFinite(e.consumptionPerTurn) && e.consumptionPerTurn > 0) bits.push(`use:-${e.consumptionPerTurn}`);
  if (Number.isFinite(e.storageCapacity) && e.storageCapacity > 0) bits.push(`cap:${e.storageCapacity}`);

  return `${tryName(b)} (${bits.join(' ')})`;
}

function summarizeMapObject(o) {
  const bits = [];
  if (o.type) bits.push(String(o.type));
  if (o.name) bits.push(`name:${o.name}`);
  if (o.faction) bits.push(`faction:${o.faction}`);
  if (o.city) bits.push(`city:${o.city}`);
  return bits.length ? bits.join(' ') : tryName(o);
}

export function setupHexInfoPanel(scene) {
  if (!scene) return;
  if (scene.hexInfoUI?.initialized) return;

  scene.hexInfoUI = scene.hexInfoUI || {};
  scene.hexInfoUI.initialized = true;

  const W = 420;
  const H = 280;

  const x = 18;
  const y = scene.scale.height - H - 18;

  const panel = scene.add.container(x, y)
    .setScrollFactor(0)
    .setDepth(UI_Z)
    .setVisible(true); // можно true по умолчанию, либо false если хочешь открывать по клику

  // Background FIRST (важно для читаемости)
  const bg = scene.add.graphics();
  bg.fillStyle(COLORS.bg, 0.94);
  bg.fillRoundedRect(0, 0, W, H, 14);
  bg.lineStyle(2, COLORS.border, 0.95);
  bg.strokeRoundedRect(0, 0, W, H, 14);
  panel.add(bg);

  const title = scene.add.text(16, 10, 'HEX INFO', {
    fontFamily: 'monospace',
    fontSize: '14px',
    color: COLORS.title,
  });
  panel.add(title);

  const subtitle = scene.add.text(16, 30, 'Click a hex to inspect everything on it.', {
    fontFamily: 'monospace',
    fontSize: '11px',
    color: COLORS.subtle,
  });
  panel.add(subtitle);

  // Divider
  const div = scene.add.graphics();
  div.lineStyle(1, 0x1f3b52, 0.9);
  div.beginPath();
  div.moveTo(12, 54);
  div.lineTo(W - 12, 54);
  div.strokePath();
  panel.add(div);

  // Content block
  const content = scene.add.text(16, 62, '', {
    fontFamily: 'monospace',
    fontSize: '11px',
    color: COLORS.text,
    wordWrap: { width: W - 32 },
    lineSpacing: 2,
  });
  panel.add(content);

  // Small close button (optional)
  const close = scene.add.text(W - 16, 12, '×', {
    fontFamily: 'monospace',
    fontSize: '16px',
    color: COLORS.subtle,
  }).setOrigin(1, 0).setInteractive({ useHandCursor: true });

  close.on('pointerdown', () => scene.closeHexInfoPanel?.());
  close.on('pointerover', () => close.setColor(COLORS.accent));
  close.on('pointerout', () => close.setColor(COLORS.subtle));
  panel.add(close);

  scene.hexInfoUI.panel = panel;
  scene.hexInfoUI.content = content;
  scene.hexInfoUI.title = title;
  scene.hexInfoUI.subtitle = subtitle;

  scene.hexInfoUI.target = null;

  scene.openHexInfoPanel = function () {
    scene.hexInfoUI.panel.setVisible(true);
    scene.hexInfoUI.isOpen = true;
    scene.refreshHexInfoPanel?.();
  };

  scene.closeHexInfoPanel = function () {
    scene.hexInfoUI.panel.setVisible(false);
    scene.hexInfoUI.isOpen = false;
  };

  scene.setHexInfoTarget = function (q, r) {
    if (!Number.isFinite(q) || !Number.isFinite(r)) return;
    scene.hexInfoUI.target = { q, r };
    scene.hexInfoUI.panel.setVisible(true);
    scene.hexInfoUI.isOpen = true;
    scene.refreshHexInfoPanel?.();
  };

  scene.refreshHexInfoPanel = function () {
    if (!scene.hexInfoUI?.isOpen) return;

    const tgt = scene.hexInfoUI.target;
    if (!tgt) {
      content.setText('Click a hex to inspect everything on it.');
      return;
    }

    const q = tgt.q;
    const r = tgt.r;

    const t = getTile(scene, q, r);
    const { units, players, enemies, haulers, ships, buildings, resources, mapObjects } =
      findAllAt(scene, q, r);

    const lines = [];

    // Header
    lines.push(`Hex: (${q}, ${r})`);
    if (!t) {
      lines.push('Tile: NOT FOUND');
      content.setText(lines.join('\n'));
      return;
    }

    // Tile basics
    lines.push(`Terrain: ${t.type || '—'}  Ground: ${t.groundType || '—'}`);
    lines.push(`Elevation: base=${fmtNum(t.baseElevation)}  waterLevel=${fmtNum(scene.waterLevel)}  visual=${fmtNum(t.visualElevation)}`);
    lines.push(`Underwater: ${fmtBool(t.isUnderWater)}  WaterDepth: ${fmtNum(t.waterDepth, '0')}`);

    // POI / Roads
    const poiFlags = [];

    // New POIs (lore-driven)
    if (t.hasSettlement) poiFlags.push(`Settlement${t.settlementName ? `:${t.settlementName}` : ''}`);
    if (t.hasRaiderCamp) poiFlags.push('Raider Camp');
    if (t.hasRoadsideCamp) poiFlags.push('Roadside Camp');
    if (t.hasWatchtower) poiFlags.push('Watchtower');
    if (t.hasMinePOI) poiFlags.push('Mine');
    if (t.hasShrine) poiFlags.push('Shrine');

    // Existing POIs
    if (t.hasRuin) poiFlags.push('Ruin');
    if (t.hasCrashSite) poiFlags.push('Crash Site');
    if (t.hasVehicle) poiFlags.push('Vehicle');

    // Generic flags
    if (t.hasObject) poiFlags.push('Object');
    if (t.hasRoad) poiFlags.push('Road');
    if (t.hasForest) poiFlags.push('Forest');

    lines.push(`Flags: ${fmtList(poiFlags, '—')}`);

    // Road links
    if (t.roadLinks && t.roadLinks.size) {
      lines.push(`RoadLinks: ${Array.from(t.roadLinks).slice(0, 10).join(', ')}${t.roadLinks.size > 10 ? ' …' : ''}`);
    }

    // Electricity tile flags
    const elBits = [];
    if (t.hasPowerConduit) elBits.push('Conduit');
    if (t.hasPowerPole) elBits.push('Pole');
    if (elBits.length) lines.push(`PowerTile: ${elBits.join(', ')}`);

    lines.push(''); // spacer

    // Map objects (from mapInfo)
    if (mapObjects.length) {
      lines.push(`Map Objects (${mapObjects.length}):`);
      for (const o of mapObjects.slice(0, 6)) {
        lines.push(`  • ${summarizeMapObject(o)}`);
      }
      if (mapObjects.length > 6) lines.push(`  … +${mapObjects.length - 6} more`);
      lines.push('');
    }

    // Units
    const allUnits = [
      ...players,
      ...enemies,
      ...haulers,
      ...ships,
      ...units.filter(u => !players.includes(u) && !enemies.includes(u) && !haulers.includes(u) && !ships.includes(u)),
    ];
    if (allUnits.length) {
      lines.push(`Units (${allUnits.length}):`);
      for (const u of allUnits.slice(0, 6)) {
        lines.push(`  • ${summarizeUnit(u)}`);
      }
      if (allUnits.length > 6) lines.push(`  … +${allUnits.length - 6} more`);
      lines.push('');
    } else {
      lines.push('Units: —');
      lines.push('');
    }

    // Buildings
    if (buildings.length) {
      lines.push(`Buildings (${buildings.length}):`);
      for (const b of buildings.slice(0, 8)) {
        lines.push(`  • ${summarizeBuilding(b)}`);
      }
      if (buildings.length > 8) lines.push(`  … +${buildings.length - 8} more`);
      lines.push('');
    } else {
      lines.push('Buildings: —');
      lines.push('');
    }

    // Resources
    if (resources.length) {
      lines.push(`Resources (${resources.length}):`);
      for (const res of resources.slice(0, 6)) {
        const name = tryName(res);
        lines.push(`  • ${name}`);
      }
      if (resources.length > 6) lines.push(`  … +${resources.length - 6} more`);
      lines.push('');
    } else {
      lines.push('Resources: —');
      lines.push('');
    }

    // Debug: show raw tile keys summary (useful for verifying bindings)
    const raw = pick(t, [
      'q','r','type','groundType','baseElevation','elevation','visualElevation',
      'isUnderWater','waterDepth',
      // POI flags
      'hasSettlement','settlementName','hasRuin','hasRaiderCamp','hasRoadsideCamp','hasWatchtower','hasMinePOI','hasShrine',
      'hasCrashSite','hasVehicle','hasObject',
      'hasRoad','hasForest','hasPowerConduit','hasPowerPole'
    ]);
    lines.push('Raw Tile Snapshot:');
    lines.push(`  ${JSON.stringify(raw)}`);

    content.setText(lines.join('\n'));
  };
}

export default {
  setupHexInfoPanel,
};
