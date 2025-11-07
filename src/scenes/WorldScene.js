// deephexbeta/src/scenes/WorldScene.js
import HexMap from '../engine/HexMap.js';
import { findPath } from '../engine/AStar.js';
import { setupCameraControls, setupTurnUI } from './WorldSceneUI.js';
import { spawnUnitsAndEnemies, subscribeToGameUpdates } from './WorldSceneUnits.js';
import {
  drawHexMap, hexToPixel, pixelToHex, roundHex, drawHex,
  getColorForTerrain, isoOffset, LIFT_PER_LVL
} from './WorldSceneMap.js';

/* =========================
   Deterministic world summary
   (mirrors the lobby so labels match)
   ========================= */
function __hashStr32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}
function __mulberry32(a) {
  let t = a >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function getWorldSummaryForSeed(seed) {
  const h = __hashStr32(String(seed));
  const rnd = __mulberry32(h);

  let geography;
  const geoRoll = rnd();
  if (geoRoll < 0.20) geography = 'Archipelago';
  else if (geoRoll < 0.40) geography = 'Ring Continent';
  else if (geoRoll < 0.60) geography = 'Pangea';
  else if (geoRoll < 0.80) geography = 'Fractured Isles';
  else geography = 'Shattered Coast';

  let biome;
  const bioRoll = rnd();
  if (bioRoll < 0.20) biome = 'Icy Biome';
  else if (bioRoll < 0.40) biome = 'Volcanic Biome';
  else if (bioRoll < 0.60) biome = 'Desert Biome';
  else if (bioRoll < 0.80) biome = 'Temperate Biome';
  else biome = 'Swamp Biome';

  return { geography, biome };
}

export default class WorldScene extends Phaser.Scene {
  constructor() {
    super('WorldScene');
  }

  preload() {}

  async create() {
    this.hexSize = 24;
    this.mapWidth = 25;
    this.mapHeight = 25;
    this.input.setDefaultCursor('grab');
    this.isDragging = false;
    this.isUnitMoving = false;

    const pad = this.hexSize * 2;
    const mapPixelWidth = this.hexSize * Math.sqrt(3) * (this.mapWidth + 0.5) + pad * 2;
    const mapPixelHeight = this.hexSize * 1.5 * (this.mapHeight + 0.5) + pad * 2;
    this.cameras.main.setBounds(0, 0, mapPixelWidth, mapPixelHeight);
    this.cameras.main.setZoom(1.0);

    this.input.on('pointerdown', () => {
      this.input.setDefaultCursor('grabbing');
      this.isDragging = true;
    });
    this.input.on('pointerup', () => {
      this.input.setDefaultCursor('grab');
      this.isDragging = false;
    });
    this.input.on('pointermove', (pointer) => {
      if (this.isDragging && pointer.isDown) {
        this.cameras.main.scrollX -= (pointer.x - pointer.prevPosition.x) / this.cameras.main.zoom;
        this.cameras.main.scrollY -= (pointer.y - pointer.prevPosition.y) / this.cameras.main.zoom;
      }
    });

    // Helpers to cycle choices (if used by UI)
    this.nextOf = (list, current) => {
      const idx = list.indexOf(current);
      return list[(idx + 1) % list.length];
    };

    // bind geometry helpers to scene
    this.hexToPixel = hexToPixel.bind(this);
    this.pixelToHex = pixelToHex.bind(this);
    this.roundHex = roundHex.bind(this);
    this.drawHex = drawHex.bind(this);

    // Unified axial(q,r) -> on-screen isometric position (including map offsets and elevation lift)
    this.axialToWorld = (q, r) => {
      const tile = (this.tileAt ? this.tileAt(q, r) : (this.mapData?.find(t => t.q === q && t.r === r)));
      const elev = (tile && tile.type !== 'water')
        ? Math.max(0, (typeof tile?.elevation === 'number' ? tile.elevation : 0) - 1)
        : 0;
      const p = this.hexToPixel(q, r, this.hexSize);
      return {
        x: p.x + (this.mapOffsetX || 0),
        y: p.y + (this.mapOffsetY || 0) - (LIFT_PER_LVL * elev),
      };
    };

    this.getColorForTerrain = getColorForTerrain.bind(this);
    this.isoOffset = isoOffset.bind(this);

    // Supabase, lobby state (injected elsewhere)
    this.supabase = (await import('../net/SupabaseClient.js')).supabase;

    // Seed / player / lobby meta (filled by LobbyScene before start)
    this.roomCode = this.roomCode || (window.__roomCode ?? 'ABCD');
    this.playerName = this.playerName || (window.__playerName ?? `Player_${Math.floor(Math.random()*1000)}`);
    this.seed = this.seed || (window.__seed ?? Date.now());
    this.lobbyState = this.lobbyState || { units: {}, enemies: [], currentTurn: this.playerName };

    // Keep any prior event handlers clean
    this.events.once('shutdown', () => {
      this.events.off('hex-inspect');
      this.events.off('hex-inspect-extra');
    });

    this.hexMap = new HexMap(this.mapWidth, this.mapHeight, this.seed);
    this.mapData = this.hexMap.getMap();
    delete this.mapData.__locationsApplied;
    drawHexMap.call(this);

    // === Top-center world meta badge (Geography & Biome)
    const { geography, biome } =
      (this.hexMap.worldInfo ?? this.hexMap.worldMeta) || getWorldSummaryForSeed(this.seed);
    this.addWorldMetaBadge(geography, biome);

    await spawnUnitsAndEnemies.call(this);
    subscribeToGameUpdates.call(this);
    setupCameraControls(this);
    setupTurnUI(this);

    // 🌀 Refresh Button (Unit sync)
    if (this.refreshButton) {
      this.refreshButton.removeAllListeners('pointerdown');
      this.refreshButton.on('pointerdown', async () => {
        const { data: lobbyData, error } = await this.supabase
          .from('lobbies')
          .select('state')
          .eq('room_code', this.roomCode)
          .single();

        if (error || !lobbyData?.state?.units) return;

        // snap my unit to server pos
        const unitData = lobbyData.state.units[this.playerName];
        if (!unitData) return;

        const { q, r } = unitData;
        const { x, y } = this.axialToWorld(q, r);
        const unit = this.players.find(p => p.name === this.playerName);
        if (unit) {
          unit.setPosition(x, y);
          unit.q = q; unit.r = r;
        }
      });
    }

    // Setup pointer actions (click-to-move, etc.)
    const actions = await import('./WorldSceneActions.js');
    actions.setupPointerActions(this);

    // Hex inspector (optional UI hooks)
    this.events.on('hex-inspect', (q, r) => {
      const tile = this.mapData.find(h => h.q === q && h.r === r);
      if (!tile) return;
      const info = `(${q},${r}) ${tile.type} h=${tile.elevation ?? 0}`;
      console.log('[hex]', info);
    });
    this.events.on('hex-inspect-extra', (q, r) => {
      const tile = this.mapData.find(h => h.q === q && h.r === r);
      if (!tile) return;
      console.log('[hex extra]', tile);
    });
  }

  addWorldMetaBadge(geography, biome) {
    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const container = this.add.container(cx, 18).setScrollFactor(0).setDepth(2000);
    const text1 = this.add.text(0, 0, `🌍 Geography: ${geography}`, {
      fontSize: '16px', color: '#e8f6ff'
    }).setOrigin(0.5).setDepth(2001);
    const text2 = this.add.text(0, 20, `🌿 Biome: ${biome}`, {
      fontSize: '16px', color: '#e8f6ff'
    }).setOrigin(0.5).setDepth(2001);

    const w = Math.max(text1.width, text2.width) + 20;
    const h = 44;
    const bg = this.add.rectangle(0, 10, w, h, 0x133046, 0.8)
      .setStrokeStyle(1, 0x3da9fc, 0.9)
      .setDepth(2000)
      .setOrigin(0.5);
    container.add([bg, text1, text2]);
  }

  /* =========================
     Pathfinding + movement
     ========================= */
  startPathPreview(fromQ, fromR, toQ, toR) {
    if (this.previewGraphics) this.previewGraphics.destroy();
    this.previewGraphics = this.add.graphics().setDepth(1000);

    const path = findPath(this.mapData, fromQ, fromR, toQ, toR);
    this.movingPath = path || [];
    if (!path || path.length === 0) return;

    for (const step of path) {
      const { x, y } = this.axialToWorld(step.q, step.r);
      this.previewGraphics.fillStyle(0xffffff, 0.8);
      this.previewGraphics.fillCircle(x, y, 3);
    }
  }

  clearPathPreview() {
    if (this.previewGraphics) {
      this.previewGraphics.destroy();
      this.previewGraphics = null;
    }
  }

  startStepMovement() {
    if (!this.selectedUnit || !this.movingPath || this.movingPath.length === 0) return;

    const unit = this.selectedUnit;
    const step = this.movingPath.shift();
    const { x, y } = this.axialToWorld(step.q, step.r);

    this.tweens.add({
      targets: unit,
      x, y,
      duration: 200,
      onComplete: () => {
        unit.q = step.q;
        unit.r = step.r;
        this.clearPathPreview();

        if (this.movingPath.length > 0) {
          this.startStepMovement();
        } else {
          this.syncPlayerMove(unit);
          this.isUnitMoving = false;
          this.checkCombat();
        }
      }
    });
  }

  checkCombat() {
    if (!this.players || !this.enemies) return;
    const u = this.players.find(p => p.playerName === this.playerName);
    if (!u) return;

    this.enemies.forEach(enemy => {
      if (Math.abs(enemy.q - u.q) <= 1 && Math.abs(enemy.r - u.r) <= 1) {
        // placeholder combat hook
      }
    });
  }

  async syncPlayerMove(unit) {
    const { supabase } = await import('../net/SupabaseClient.js');
    const state = this.lobbyState || {};
    state.units = state.units || {};
    state.units[this.playerName] = { q: unit.q, r: unit.r };
    await supabase
      .from('lobbies')
      .update({ state })
      .eq('room_code', this.roomCode);
  }

  endTurn() {
    const names = Object.keys(this.lobbyState?.units || {});
    const idx = names.indexOf(this.playerName);
    const next = names[(idx + 1) % names.length] || this.playerName;
    this.lobbyState.currentTurn = next;
  }

  roamEnemies() {
    if (!this.isHost) return;
    if (!this.enemies || this.enemies.length === 0) return;

    const dirs = [
      { dq: 1, dr: 0 }, { dq: -1, dr: 0 },
      { dq: 0, dr: 1 }, { dq: 0, dr: -1 },
      { dq: 1, dr: -1 }, { dq: -1, dr: 1 }
    ];

    this.enemies.forEach(enemy => {
      const d = Phaser.Utils.Array.GetRandom(dirs);
      const nq = enemy.q + d.dq, nr = enemy.r + d.dr;
      const tile = this.mapData.find(h => h.q === nq && h.r === nr);
      if (tile && !['water', 'mountain'].includes(tile.type)) {
        const { x, y } = this.axialToWorld(nq, nr);
        enemy.setPosition(x, y);
        enemy.q = nq;
        enemy.r = nr;
      }
    });
  }
}
