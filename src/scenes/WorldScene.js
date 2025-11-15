// src/scenes/WorldScene.js
import HexMap from '../engine/HexMap.js';
import { drawLocationsAndRoads } from './WorldSceneMapLocations.js';

import {
  startDocksPlacement,
  placeDocks,
  cancelPlacement,
} from './WorldSceneBuildings.js';

import {
  applyShipRoutesOnEndTurn,
  applyHaulerBehaviorOnEndTurn as applyHaulerRoutesOnEndTurn,
  buildHaulerAtSelectedUnit,
  enterHaulerRoutePicker,
} from './WorldSceneHaulers.js';

import { spawnUnitsAndEnemies } from './WorldSceneUnits.js';
import { spawnFishResources } from './WorldSceneResources.js';

import {
  drawHexMap,
  hexToPixel,
  pixelToHex,
  roundHex,
  drawHex,
  getColorForTerrain,
  isoOffset,
  LIFT_PER_LVL
} from './WorldSceneMap.js';

/* =========================
   Deterministic world summary
   ========================= */
function __hashStr32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function __xorshift32(seed) {
  let x = (seed || 1) >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17; x >>>= 0;
    x ^= x << 5;  x >>>= 0;
    return (x >>> 0) / 4294967296;
  };
}
function getWorldSummaryForSeed(seed) {
  const rng = __xorshift32(__hashStr32(String(seed ?? 'default')));
  const geoRoll = rng();
  const bioRoll = rng();

  let geography;
  if (geoRoll < 0.15) geography = 'Big Lagoon';
  else if (geoRoll < 0.30) geography = 'Central Lake';
  else if (geoRoll < 0.50) geography = 'Small Bays';
  else if (geoRoll < 0.70) geography = 'Scattered Terrain';
  else if (geoRoll < 0.85) geography = 'Diagonal Island';
  else geography = 'Multiple Islands';

  let biome;
  if (bioRoll < 0.20) biome = 'Icy Biome';
  else if (bioRoll < 0.40) biome = 'Volcanic Biome';
  else if (bioRoll < 0.60) biome = 'Desert Biome';
  else if (bioRoll < 0.80) biome = 'Temperate Biome';
  else biome = 'Swamp Biome';

  return { geography, biome };
}

/* =========================
   Small axial helpers
   ========================= */
const NEIGHBORS = [
  { dq: +1, dr: 0 }, { dq: -1, dr: 0 },
  { dq: 0, dr: +1 }, { dq: 0, dr: -1 },
  { dq: +1, dr: -1 }, { dq: -1, dr: +1 }
];

function inBounds(scene, q, r) {
  return q >= 0 && r >= 0 && q < scene.mapWidth && r < scene.mapHeight;
}
function getTile(scene, q, r) {
  return scene.mapData.find(h => h.q === q && h.r === r);
}
function isLandPassable(tile) {
  if (!tile) return false;
  const t = String(tile.type || '').toLowerCase();
  if (t === 'water' || t === 'ocean' || t === 'sea') return false;
  if (t === 'mountain') return false;
  return true;
}
function isWater(tile) {
  if (!tile) return false;
  const t = String(tile.type || '').toLowerCase();
  return (t === 'water' || t === 'ocean' || t === 'sea');
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

    // collections
    this.haulers = this.haulers || [];
    this.ships = this.ships || [];

    const pad = this.hexSize * 2;
    const mapPixelWidth = this.hexSize * Math.sqrt(3) * (this.mapWidth + 0.5) + pad * 2;
    const mapPixelHeight = this.hexSize * 1.5 * (this.mapHeight + 0.5) + pad * 2;
    this.cameras.main.setBounds(0, 0, mapPixelWidth, mapPixelHeight);
    this.cameras.main.setZoom(1.0);

    const { roomCode, playerName, isHost } = this.scene.settings.data || {};
    const { getLobbyState } = await import('../net/LobbyManager.js');
    const { data: lobbyData, error } = await getLobbyState(roomCode);
    if (error || !lobbyData?.state?.seed) return;

    this.seed = lobbyData.state.seed;
    this.lobbyState = lobbyData.state;

    // Only Supabase client here; old subscribeToGameUpdates is removed
    const { supabase } = await import('../net/SupabaseClient.js');

    this.playerName = playerName;
    this.roomCode = roomCode;
    this.isHost = isHost;
    this.supabase = supabase;

    // simple move sync
    this.syncPlayerMove = async unit => {
      const res = await this.supabase.from('lobbies').select('state').eq('room_code', this.roomCode).single();
      if (!res.data) return;
      const nextPlayer = this.getNextPlayer(res.data.state.players, this.playerName);
      await this.supabase
        .from('lobbies')
        .update({
          state: {
            ...res.data.state,
            units: { ...res.data.state.units, [this.playerName]: { q: unit.q, r: unit.r } },
            currentTurn: nextPlayer
          }
        })
        .eq('room_code', this.roomCode);
    };

    this.getNextPlayer = (list, current) => {
      const idx = list.indexOf(current);
      return list[(idx + 1) % list.length];
    };

    // bind geometry helpers to scene
    this.hexToPixel = hexToPixel.bind(this);
    this.pixelToHex = pixelToHex.bind(this);
    this.roundHex = roundHex.bind(this);
    this.drawHex = drawHex.bind(this);
    this.getColorForTerrain = getColorForTerrain.bind(this);
    this.isoOffset = isoOffset.bind(this);

    // axial -> world (includes lift)
    this.axialToWorld = (q, r) => {
      const tile = this.mapData?.find(t => t.q === q && t.r === r);
      const elev = (tile && tile.type !== 'water')
        ? Math.max(0, (typeof tile?.elevation === 'number' ? tile.elevation : 0) - 1)
        : 0;
      const p = this.hexToPixel(q, r, this.hexSize);
      return {
        x: p.x + (this.mapOffsetX || 0),
        y: p.y + (this.mapOffsetY || 0) - (LIFT_PER_LVL * elev),
      };
    };

    this.tileMap = {};
    this.selectedUnit = null;
    this.selectedHex = null;
    this.movingPath = [];
    this.pathGraphics = this.add.graphics({ x: 0, y: 0 }).setDepth(50);
    this.pathLabels = [];
    this.debugGraphics = this.add.graphics({ x: 0, y: 0 }).setDepth(100);

    // inspector hooks
    this.events.on('hex-inspect', (text) => this.hexInspect(text));
    this.events.on('hex-inspect-extra', ({ header, lines }) => {
      const payload = [`[HEX INSPECT] ${header}`, ...(lines || [])].join('\n');
      this.hexInspect(payload);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off('hex-inspect');
      this.events.off('hex-inspect-extra');
    });

    // map gen
    this.hexMap = new HexMap(this.mapWidth, this.mapHeight, this.seed);
    this.mapData = this.hexMap.getMap();
    delete this.mapData.__locationsApplied;
    drawHexMap.call(this);

    // resources
    spawnFishResources.call(this);

    // world badge
    const { geography, biome } =
      (this.hexMap.worldInfo ?? this.hexMap.worldMeta) || getWorldSummaryForSeed(this.seed);
    this.addWorldMetaBadge(geography, biome);

    // units
    await spawnUnitsAndEnemies.call(this);

    setupCameraControls(this);
    setupTurnUI(this);

    // building placement API
    this.startDocksPlacement = () => startDocksPlacement.call(this);
    this.input.keyboard?.on('keydown-ESC', () => cancelPlacement.call(this));

    /* ------------------------------------
       WIRE UNIT ACTION PANEL BUTTONS (4)
       ------------------------------------ */
    if (this.unitPanelButtons && this.unitPanelButtons.length >= 4) {
      // We assume the panel still creates 4 buttons in order.
      const [btnBuildings, btnBlank, btnSetRoute, btnClose] = this.unitPanelButtons;

      btnBuildings.hit.removeAllListeners();
      btnBlank.hit.removeAllListeners();
      btnSetRoute.hit.removeAllListeners();
      btnClose.hit.removeAllListeners();

      // Update labels safely if they exist
      if (btnBuildings.label?.setText) btnBuildings.label.setText('Buildings');
      if (btnBlank.label?.setText) btnBlank.label.setText('Blank');
      if (btnSetRoute.label?.setText) btnSetRoute.label.setText('Set Path');

      // 1) Buildings → open our in-scene Build Menu popup
      btnBuildings.hit.on('pointerdown', () => {
        console.log('[UI] Buildings clicked');
        this.openBuildMenu();
      });

      // 2) Blank → currently no behavior (reserved)
      btnBlank.hit.on('pointerdown', () => {
        console.log('[UI] Blank clicked (no action yet)');
      });

      // 3) Set Path → for now, use hauler route picker (can be extended later)
      btnSetRoute.hit.on('pointerdown', () => {
        console.log('[UI] Set Path clicked');
        enterHaulerRoutePicker.call(this);
      });

      // 4) Close panel
      btnClose.hit.on('pointerdown', () => {
        console.log('[UI] Close panel');
        this.hideUnitPanel?.();
      });
    }

    // Keep a thin wrapper if other code calls this.buildHauler()
    this.buildHauler = () => {
      buildHaulerAtSelectedUnit.call(this);
    };

    // Refresh button
    if (this.refreshButton) {
      this.refreshButton.removeAllListeners('pointerdown');
      this.refreshButton.on('pointerdown', async () => {
        const { data: lobbyData, error } = await this.supabase
          .from('lobbies')
          .select('state')
          .eq('room_code', this.roomCode)
          .single();

        if (error || !lobbyData?.state?.units) {
          console.error("Failed to refresh units:", error);
          return;
        }

        const unitData = lobbyData.state.units[this.playerName];
        if (!unitData) return;

        const { q, r } = unitData;
        const { x, y } = this.axialToWorld(q, r);
        const unit = this.players.find(p => p.name === this.playerName);
        if (unit) {
          unit.setPosition(x, y);
          unit.q = q;
          unit.r = r;
          console.log(`[REFRESH] Unit moved to synced position: (${q}, ${r})`);
        }
      });
    }

    // Click selection / movement (support selecting haulers too)
    this.input.on("pointerdown", pointer => {
      if (pointer.rightButtonDown()) return;

      const { worldX, worldY } = pointer;
      const approx = this.pixelToHex(
        worldX - (this.mapOffsetX || 0),
        worldY - (this.mapOffsetY || 0),
        this.hexSize
      );
      const rounded = this.roundHex(approx.q, approx.r);
      if (rounded.q < 0 || rounded.r < 0 || rounded.q >= this.mapWidth || rounded.r >= this.mapHeight) return;

      const tile = getTile(this, rounded.q, rounded.r);

      const playerHere =
        (this.players?.find?.(p => p.q === rounded.q && p.r === rounded.r)) ||
        (this.haulers?.find?.(h => h.q === rounded.q && h.r === rounded.r));

      this.selectedHex = rounded;
      this.debugHex(rounded.q, rounded.r);

      if (this.selectedUnit) {
        if (this.selectedUnit.q === rounded.q && this.selectedUnit.r === rounded.r) {
          this.selectedUnit = null;
          this.hideUnitPanel?.();
          return;
        }

        // block water/mountain for land movers
        const blocked = t => !t || t.type === 'water' || t.type === 'mountain';
        const fullPath = findPath(this.selectedUnit, rounded, this.mapData, blocked);
        if (fullPath && fullPath.length > 1) {
          const movePoints = this.selectedUnit.movementPoints || 10;
          let totalCost = 0;
          const trimmedPath = [fullPath[0]];
          for (let i = 1; i < fullPath.length; i++) {
            const stepTile = getTile(this, fullPath[i].q, fullPath[i].r);
            const cost = stepTile?.movementCost || 1;
            totalCost += cost;
            if (totalCost <= movePoints) trimmedPath.push(fullPath[i]);
            else break;
          }
          if (trimmedPath.length > 1) {
            this.movingPath = trimmedPath.slice(1);
            this.isUnitMoving = true;
            this.clearPathPreview();
            this.startStepMovement();
          }
        } else {
          console.log("Path not found or blocked.");
        }
      } else {
        if (playerHere) {
          this.selectedUnit = playerHere;
          this.selectedUnit.movementPoints =
            this.selectedUnit.type === 'hauler' ? 8 : 10;
          this.showUnitPanel?.(this.selectedUnit);
          console.log(`[SELECTED] Unit at (${playerHere.q}, ${playerHere.r})`);
        }
      }
    });

    // Path preview (land units only)
    this.input.on("pointermove", pointer => {
      if (!this.selectedUnit || this.isUnitMoving) return;

      const { worldX, worldY } = pointer;
      const approx = this.pixelToHex(
        worldX - (this.mapOffsetX || 0),
        worldY - (this.mapOffsetY || 0),
        this.hexSize
      );
      const rounded = this.roundHex(approx.q, approx.r);
      if (rounded.q < 0 || rounded.r < 0 || rounded.q >= this.mapWidth || rounded.r >= this.mapHeight) return;

      const blocked = t => !t || t.type === 'water' || t.type === 'mountain';
      const path = findPath(this.selectedUnit, rounded, this.mapData, blocked);

      this.clearPathPreview();
      if (path && path.length > 1) {
        let costSum = 0;
        const maxMove = this.selectedUnit.movementPoints || 10;

        for (let i = 0; i < path.length; i++) {
          const step = path[i];
          const tile = getTile(this, step.q, step.r);
          const moveCost = tile?.movementCost || 1;

          const { x, y } = this.axialToWorld(step.q, step.r);
          const isStart = i === 0;
          if (!isStart) costSum += moveCost;

          const fillColor = isStart ? 0xeeeeee : (costSum <= maxMove ? 0x00ff00 : 0xffffff);
          const labelColor = costSum <= maxMove ? '#ffffff' : '#000000';
          const bgColor = costSum <= maxMove ? 0x008800 : 0xffffff;

          this.pathGraphics.lineStyle(1, 0x000000, 0.3);
          this.pathGraphics.fillStyle(fillColor, 0.4);
          this.pathGraphics.beginPath();
          this.drawHex(this.pathGraphics, x, y, this.hexSize);
          this.pathGraphics.closePath();
          this.pathGraphics.fillPath();
          this.pathGraphics.strokePath();

          if (!isStart) {
            const circle = this.add.graphics();
            circle.fillStyle(bgColor, 1);
            circle.fillCircle(x, y, 9);
            circle.setDepth(50);
            this.pathLabels.push(circle);

            const label = this.add.text(x, y, `${costSum}`, {
              fontSize: '10px',
              color: labelColor,
              fontStyle: 'bold'
            }).setOrigin(0.5).setDepth(51);
            this.pathLabels.push(label);
          }
        }
      }
    });
  }

  // ---- BUILD MENU POPUP (Buildings / Units / Infrastructure) ----
  openBuildMenu() {
    // If already exists, just show it
    if (this.buildMenuContainer) {
      this.buildMenuContainer.setVisible(true);
      this.buildMenuOverlay?.setVisible(true).setInteractive({ useHandCursor: false });
      return;
    }

    const cam = this.cameras.main;
    const W = 240;
    const H = 220;
    const x = cam.width / 2 - W / 2;
    const y = cam.height / 2 - H / 2;

    // Dim overlay to close on click
    const overlay = this.add.rectangle(
      cam.width / 2,
      cam.height / 2,
      cam.width,
      cam.height,
      0x000000,
      0.25
    )
      .setScrollFactor(0)
      .setDepth(2050)
      .setInteractive({ useHandCursor: false });

    overlay.on('pointerdown', () => {
      this.closeBuildMenu();
    });

    this.buildMenuOverlay = overlay;

    const container = this.add.container(x, y).setScrollFactor(0).setDepth(2060);

    const bg = this.add.graphics();
    bg.fillStyle(0x0f2233, 0.95);
    bg.fillRoundedRect(0, 0, W, H, 10);
    bg.lineStyle(2, 0x3da9fc, 0.9);
    bg.strokeRoundedRect(0, 0, W, H, 10);

    // Title
    const title = this.add.text(W / 2, 18, 'Build Menu', {
      fontSize: '16px',
      color: '#e8f6ff'
    }).setOrigin(0.5, 0.5);

    // Close "X"
    const closeText = this.add.text(W - 16, 14, '✕', {
      fontSize: '14px',
      color: '#e8f6ff'
    }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });

    closeText.on('pointerdown', () => {
      this.closeBuildMenu();
    });

    // Tabs: Buildings / Units / Infrastructure
    const tabY = 40;
    const tabXStart = 20;
    const tabWidth = 70;
    const tabs = [
      { id: 'buildings', label: 'Buildings' },
      { id: 'units',     label: 'Units' },
      { id: 'infra',     label: 'Infra' },
    ];

    this.buildMenuTabs = {};
    this.buildMenuActiveCategory = 'buildings';

    tabs.forEach((t, idx) => {
      const tx = tabXStart + idx * (tabWidth + 5);
      const tabRect = this.add.rectangle(tx + tabWidth / 2, tabY, tabWidth, 22, 0x173b52, 1)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      const tabLabel = this.add.text(tx + tabWidth / 2, tabY, t.label, {
        fontSize: '12px',
        color: '#e8f6ff'
      }).setOrigin(0.5, 0.5);

      tabRect.on('pointerdown', () => {
        this.showBuildMenuCategory(t.id);
      });

      this.buildMenuTabs[t.id] = { rect: tabRect, label: tabLabel };
      container.add(tabRect);
      container.add(tabLabel);
    });

    // Options container area
    const optionsContainer = this.add.container(0, 68);
    this.buildMenuOptionsContainer = optionsContainer;

    container.add([bg, title, closeText, optionsContainer]);
    this.buildMenuContainer = container;

    // First render
    this.showBuildMenuCategory('buildings');
  }

  showBuildMenuCategory(category) {
    this.buildMenuActiveCategory = category;

    const optionsByCategory = {
      buildings: ['Bunker', 'Docks', 'Mine', 'Factory'],
      units:     ['Hauler', 'Builder', 'Scout', 'Raider'],
      infra:     ['Bridge', 'Canal', 'Road', 'Remove Forest', 'Level', 'Other'],
    };

    // Visual tab highlighting
    if (this.buildMenuTabs) {
      Object.entries(this.buildMenuTabs).forEach(([id, obj]) => {
        const isActive = id === category;
        obj.rect.fillColor = isActive ? 0x235070 : 0x173b52;
      });
    }

    // Clear old option items
    if (this.buildMenuOptionsContainer) {
      this.buildMenuOptionsContainer.removeAll(true);
    }

    const opts = optionsByCategory[category] || [];
    const startX = 20;
    const startY = 0;
    const lineH = 24;

    opts.forEach((name, idx) => {
      const y = startY + idx * lineH;
      const optionBg = this.add.rectangle(startX + 90, y + 10, 180, 20, 0x173b52, 0.9)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      const label = this.add.text(startX + 90, y + 10, name, {
        fontSize: '13px',
        color: '#e8f6ff'
      }).setOrigin(0.5, 0.5);

      optionBg.on('pointerdown', () => {
        console.log(`[BUILD MENU] ${category} → ${name} (no functionality yet)`);
        // future: hook real build logic here.
      });

      this.buildMenuOptionsContainer.add(optionBg);
      this.buildMenuOptionsContainer.add(label);
    });
  }

  closeBuildMenu() {
    if (this.buildMenuContainer) {
      this.buildMenuContainer.setVisible(false);
    }
    if (this.buildMenuOverlay) {
      this.buildMenuOverlay.disableInteractive();
      this.buildMenuOverlay.setVisible(false);
    }
  }

  // Minimal inspector (logs)
  hexInspect(text) {
    if (!text) return;
    const lines = String(text).split('\n');
    const title = lines.shift() || '[HEX INSPECT]';
    console.groupCollapsed(title);
    lines.forEach(l => console.log(l));
    console.groupEnd();
  }

  addWorldMetaBadge(geography, biome) {
    const cam = this.cameras.main;
    const cx = cam.width / 2;

    const container = this.add.container(cx, 18).setScrollFactor(0).setDepth(2000);
    const text1 = this.add.text(0, 0, `🌍 Geography: ${geography}`, {
      fontSize: '16px',
      color: '#e8f6ff'
    }).setOrigin(0.5, 0.5).setDepth(2001);

    const text2 = this.add.text(0, 20, `🌿 Biome: ${biome}`, {
      fontSize: '16px',
      color: '#e8f6ff'
    }).setOrigin(0.5, 0.5).setDepth(2001);

    const w = Math.max(text1.width, text2.width) + 24;
    const h = 44;
    const bg = this.add.graphics().setDepth(2000);
    bg.fillStyle(0x000000, 0.35);
    bg.fillRoundedRect(-w/2, -10, w, h, 10);
    bg.lineStyle(1, 0xffffff, 0.15);
    bg.strokeRoundedRect(-w/2, -10, w, h, 10);

    container.add([bg, text1, text2]);
    this.worldMetaBadge = container;
  }

  clearPathPreview() {
    this.pathGraphics.clear();
    this.pathLabels.forEach(label => label.destroy());
    this.pathLabels = [];
  }

  debugHex(q, r) {
    if (q < 0 || r < 0 || q >= this.mapWidth || r >= this.mapHeight) return;

    const center = this.axialToWorld(q, r);
    this.debugGraphics.clear();
    this.debugGraphics.lineStyle(2, 0xff00ff, 1);
    this.drawHex(this.debugGraphics, center.x, center.y, this.hexSize);

    const tile = getTile(this, q, r);
    const playerHere = this.players?.find?.(p => p.q === q && p.r === r);
    const enemiesHere = this.enemies?.filter?.(e => e.q === q && e.r === r) || [];

    const resourcesHere = (this.resources || []).filter(o => o.q === q && o.r === r);
    const buildingsHere = (this.buildings || []).filter(b =>
      (b.q === q && b.r === r) || (b.gq === q && b.gr === r)
    );

    const objects = [];
    if (tile?.hasForest) objects.push("Forest");
    if (tile?.hasRuin) objects.push("Ruin");
    if (tile?.hasCrashSite) objects.push("Crash Site");
    if (tile?.hasVehicle) objects.push("Vehicle");
    if (tile?.hasRoad) objects.push("Road");
    if (resourcesHere.length) objects.push(`Resources×${resourcesHere.length}`);
    if (buildingsHere.length) objects.push(`Buildings×${buildingsHere.length}`);

    console.log(`[HEX INSPECT] (${q}, ${r})`);
    console.log(`• Terrain: ${tile?.type}`);
    console.log(`• Level (elevation): ${tile?.elevation ?? 'N/A'}`);
    console.log(`• Player Unit: ${playerHere ? "Yes" : "No"}`);
    console.log(`• Enemy Units: ${enemiesHere.length}`);
    console.log(`• Objects: ${objects.join(", ") || "None"}`);
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
    console.log("[Combat] not implemented yet.");
  }

  endTurn() {
    if (this.playerName !== this.lobbyState.currentTurn) return;

    // Ships: movement / harvesting / deposit
    try {
      applyShipRoutesOnEndTurn.call(this);
    } catch (e) {
      console.warn('[SHIP] applyShipRoutesOnEndTurn failed:', e);
    }

    // Haulers: pickups / deliveries
    try {
      applyHaulerRoutesOnEndTurn.call(this);
    } catch (e) {
      console.warn('[HAULER] applyHaulerRoutesOnEndTurn failed:', e);
    }

    // UI cleanup
    this.selectedUnit = null;
    this.hideUnitPanel?.();
    if (this.selectedHexGraphic) {
      this.selectedHexGraphic.destroy();
      this.selectedHexGraphic = null;
    }
    if (this.turnText) {
      this.turnText.setText("Player Turn: ...");
    }

    // Optional enemy roaming
    if (this.isHost) this.moveEnemies();
  }

  moveEnemies() {
    const dirs = [
      { dq: +1, dr: 0 }, { dq: -1, dr: 0 },
      { dq: 0, dr: +1 }, { dq: 0, dr: -1 },
      { dq: +1, dr: -1 }, { dq: -1, dr: +1 }
    ];

    this.enemies?.forEach?.(enemy => {
      Phaser.Utils.Array.Shuffle(dirs);
      for (const d of dirs) {
        const nq = enemy.q + d.dq, nr = enemy.r + d.dr;
        const tile = getTile(this, nq, nr);
        if (tile && !['water', 'mountain'].includes(tile.type)) {
          const { x, y } = this.axialToWorld(nq, nr);
          enemy.setPosition(x, y);
          enemy.q = nq;
          enemy.r = nr;
          break;
        }
      }
    });
  }
}

/* =========================================================
   Helpers defined outside the class
   ========================================================= */

// Simple axial BFS pathfinder (no A*, fine for 25x25)
function findPath(unit, targetHex, mapData, blockedPred) {
  const start = { q: unit.q, r: unit.r };
  const goal = { q: targetHex.q, r: targetHex.r };

  if (start.q === goal.q && start.r === goal.r) {
    return [start];
  }

  const key = (q, r) => `${q},${r}`;
  const cameFrom = new Map();
  const visited = new Set([key(start.q, start.r)]);
  const queue = [start];

  const getTileLocal = (q, r) => mapData.find(t => t.q === q && t.r === r);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur.q === goal.q && cur.r === goal.r) {
      const path = [];
      let node = cur;
      while (node) {
        path.push({ q: node.q, r: node.r });
        const prev = cameFrom.get(key(node.q, node.r));
        node = prev || null;
      }
      return path.reverse();
    }

    for (const d of NEIGHBORS) {
      const nq = cur.q + d.dq;
      const nr = cur.r + d.dr;
      const k = key(nq, nr);
      if (visited.has(k)) continue;

      const tile = getTileLocal(nq, nr);
      if (blockedPred && blockedPred(tile)) continue;

      visited.add(k);
      cameFrom.set(k, cur);
      queue.push({ q: nq, r: nr });
    }
  }

  return null;
}

function setupCameraControls(scene) {
  const cam = scene.cameras.main;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let camStartX = 0;
  let camStartY = 0;

  // Middle mouse drag (or left with ALT, adjust if you like)
  scene.input.on('pointerdown', pointer => {
    if (pointer.middleButtonDown() || pointer.altKey) {
      dragging = true;
      scene.isDragging = true;
      dragStartX = pointer.position.x;
      dragStartY = pointer.position.y;
      camStartX = cam.scrollX;
      camStartY = cam.scrollY;
      scene.input.setDefaultCursor('grabbing');
    }
  });

  scene.input.on('pointerup', () => {
    if (dragging) {
      dragging = false;
      scene.isDragging = false;
      scene.input.setDefaultCursor('grab');
    }
  });

  scene.input.on('pointermove', pointer => {
    if (!dragging) return;
    const dx = pointer.position.x - dragStartX;
    const dy = pointer.position.y - dragStartY;
    cam.scrollX = camStartX - dx / cam.zoom;
    cam.scrollY = camStartY - dy / cam.zoom;
  });

  // Wheel zoom
  scene.input.on('wheel', (pointer, _x, _y, deltaY) => {
    const oldZoom = cam.zoom;
    const newZoom = Phaser.Math.Clamp(oldZoom - deltaY * 0.001, 0.4, 2.2);
    if (newZoom === oldZoom) return;

    const worldPoint = pointer.positionToCamera(cam);
    cam.zoom = newZoom;
    const newWorldPoint = pointer.positionToCamera(cam);

    cam.scrollX += worldPoint.x - newWorldPoint.x;
    cam.scrollY += worldPoint.y - newWorldPoint.y;
  });
}

function setupTurnUI(scene) {
  // Keyboard shortcut
  scene.input.keyboard?.on('keydown-ENTER', () => {
    scene.endTurn();
  });

  // End Turn button (HUD, bottom-right-ish)
  const cam = scene.cameras.main;
  const x = cam.width - 110;
  const y = cam.height - 40;

  const container = scene.add.container(x, y).setScrollFactor(0).setDepth(2100);

  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.9);
  bg.fillRoundedRect(0, 0, 100, 30, 8);
  bg.lineStyle(2, 0x3da9fc, 0.9);
  bg.strokeRoundedRect(0, 0, 100, 30, 8);

  const label = scene.add.text(50, 15, 'End Turn ▶', {
    fontSize: '14px',
    color: '#e8f6ff'
  }).setOrigin(0.5, 0.5);

  const hit = scene.add.rectangle(50, 15, 100, 30, 0x000000, 0)
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });

  hit.on('pointerdown', () => {
    scene.endTurn();
  });

  hit.on('pointerover', () => {
    bg.clear();
    bg.fillStyle(0x173b52, 0.95);
    bg.fillRoundedRect(0, 0, 100, 30, 8);
    bg.lineStyle(2, 0x9be4ff, 1);
    bg.strokeRoundedRect(0, 0, 100, 30, 8);
  });

  hit.on('pointerout', () => {
    bg.clear();
    bg.fillStyle(0x0f2233, 0.9);
    bg.fillRoundedRect(0, 0, 100, 30, 8);
    bg.lineStyle(2, 0x3da9fc, 0.9);
    bg.strokeRoundedRect(0, 0, 100, 30, 8);
  });

  container.add([bg, label, hit]);
  scene.endTurnButton = container;
}
