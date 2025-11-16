// src/scenes/WorldScene.js
import HexMap from '../engine/HexMap.js';
import { findPath as aStarFindPath } from '../engine/AStar.js';
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
function getWorldSummaryForSeed(seedStr) {
  const seed = __hashStr32(seedStr);
  const rng = __xorshift32(seed);

  const oceanRoll = rng();
  const forestRoll = rng();
  const mountainRoll = rng();
  const roughRoll = rng();
  const bioRoll = rng();

  let geography;
  if (oceanRoll < 0.3) geography = 'Archipelago';
  else if (oceanRoll < 0.6) geography = 'Mixed Coast/Interior';
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
function getTile(scene, q, r) {
  return scene.mapData.find(h => h.q === q && h.r === r);
}

/* =========================
   Scene
   ========================= */
export default class WorldScene extends Phaser.Scene {
  constructor() {
    super('WorldScene');
  }

  preload() {
    this.hexSize = 24;
    this.mapWidth = 25;
    this.mapHeight = 25;
  }

  async create() {
    this.input.setDefaultCursor('grab');
    this.isDragging = false;
    this.isUnitMoving = false;
    this.movingPath = null;

    // collections
    this.units = [];
    this.enemies = [];
    this.players = [];
    this.buildings = [];
    this.haulers = [];
    this.shipRoutes = [];
    this.resources = [];
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

    // Only Supabase client here
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
            players: res.data.state.players.map(p =>
              p.name === this.playerName
                ? { ...p, q: unit.q, r: unit.r }
                : p
            ),
            currentTurn: nextPlayer,
          },
        })
        .eq('room_code', this.roomCode);
    };

    // Restore from lobby state if present
    this.turnNumber = this.lobbyState.turnNumber ?? 1;
    this.turnOwner = this.lobbyState.currentTurn ?? this.playerName;

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

    // camera controls: disabled per request (no pan/zoom)
    // setupCameraControls(this);
    setupTurnUI(this);
    setupUnitPanel(this); // bottom-left unit action panel

    // building placement API
    this.startDocksPlacement = () => startDocksPlacement.call(this);
    this.input.keyboard?.on('keydown-ESC', () => cancelPlacement.call(this));

    // wrapper if other code calls this.buildHauler()
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
        if (error || !lobbyData?.state) return;

        this.lobbyState = lobbyData.state;

        const myState = this.lobbyState.units?.[this.playerName];
        if (myState) {
          const { q, r } = myState;
          const unit = this.players.find(u => u.playerName === this.playerName && u.type === 'mobile_base');
          if (unit && (unit.q !== q || unit.r !== r)) {
            const { x, y } = this.axialToWorld(q, r);
            unit.setPosition(x, y);
            unit.q = q;
            unit.r = r;
            console.log(`[REFRESH] Unit moved to synced position: (${q}, ${r})`);
          }
        }
      });
    }

    // Click selection / movement (support selecting haulers too)
    this.input.on("pointerdown", pointer => {
      if (pointer.rightButtonDown()) return;

      // Don't move units if build menu is open
      if (this.uiLock === 'buildMenu') return;

      const { worldX, worldY } = pointer;
      const approx = this.pixelToHex(
        worldX - (this.mapOffsetX || 0),
        worldY - (this.mapOffsetY || 0),
        this.hexSize
      );
      const rounded = this.roundHex(approx.q, approx.r);
      if (rounded.q < 0 || rounded.r < 0 || rounded.q >= this.mapWidth || rounded.r >= this.mapHeight) return;

      const clickedPlayerUnit = this.units.find(
        u => u.q === rounded.q && u.r === rounded.r && u.playerName === this.playerName
      );
      const clickedHauler = this.haulers.find(
        h => h.q === rounded.q && h.r === rounded.r && h.owner === this.playerName
      );

      if (clickedPlayerUnit || clickedHauler) {
        this.selectedUnit = clickedPlayerUnit || clickedHauler;
        this.showUnitPanel(this.selectedUnit);
        this.clearPathPreview();
        this.debugHex(rounded.q, rounded.r);
        return;
      }

      // If clicked on location
      const tile = getTile(this, rounded.q, rounded.r);
      if (tile && tile.isLocation) {
        this.events.emit('hex-inspect', `[LOCATION] ${tile.locationType || 'Unknown'} at (${rounded.q},${rounded.r})`);
      }

      if (this.selectedUnit) {
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
            this.showMovementPath(trimmedPath);
          }
        }
      }
    });

    // Hover preview path
    this.input.on('pointermove', pointer => {
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
          const cost = tile?.movementCost || 1;
          if (i > 0) costSum += cost;
          if (costSum > maxMove) break;

          const { x, y } = this.axialToWorld(step.q, step.r);
          const circle = this.add.circle(x, y, 4, 0x64ffda, 0.85).setDepth(40);
          this.pathPreviewTiles = this.pathPreviewTiles || [];
          this.pathPreviewTiles.push(circle);
        }
      }
    });

    this.input.on('pointerout', () => {
      this.clearPathPreview();
    });

    this.hexInspect(`[WORLD] Turn ${this.turnNumber} – Current player: ${this.turnOwner}`);
  }

  axialToWorld(q, r) {
    const p = hexToPixel(q, r, this.hexSize);
    const x = p.x + (this.mapOffsetX || 0);
    const y = p.y + (this.mapOffsetY || 0);
    return { x, y };
  }

  pixelToHex(x, y, size) {
    return pixelToHex(x, y, size);
  }

  roundHex(q, r) {
    return roundHex(q, r);
  }

  hexInspect(text) {
    console.log(text);
  }

  addWorldMetaBadge(geography, biome) {
    const txt = `World summary:
- Geography: ${geography}
- Biome: ${biome}`;

    if (this.worldMetaText) {
      this.worldMetaText.setText(txt);
      return;
    }

    const style = {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#e8f6ff',
      backgroundColor: '#133046',
      padding: { x: 8, y: 6 }
    };

    this.worldMetaText = this.add.text(16, 16, txt, style)
      .setScrollFactor(0)
      .setDepth(2000);
  }

  clearPathPreview() {
    if (this.pathPreviewTiles) {
      this.pathPreviewTiles.forEach(g => g.destroy());
      this.pathPreviewTiles = [];
    }
  }

  showMovementPath(path) {
    const graphics = this.add.graphics();
    graphics.lineStyle(2, 0x64ffda, 0.9);
    graphics.setDepth(50);

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const wa = this.axialToWorld(a.q, a.r);
      const wb = this.axialToWorld(b.q, b.r);
      graphics.beginPath();
      graphics.moveTo(wa.x, wa.y);
      graphics.lineTo(wb.x, wb.y);
      graphics.strokePath();
    }

    this.time.delayedCall(200, () => {
      graphics.destroy();
    });
  }

  getNextPlayer(players, currentName) {
    if (!players || players.length === 0) return null;
    const idx = players.findIndex(p => p.name === currentName);
    if (idx === -1) return players[0].name;
    return players[(idx + 1) % players.length].name;
  }

  update(time, delta) {
    if (!this.isUnitMoving || !this.movingPath || this.movingPath.length === 0) return;

    const unit = this.selectedUnit;
    if (!unit) {
      this.isUnitMoving = false;
      this.movingPath = null;
      return;
    }

    const nextStep = this.movingPath[0];
    const { x, y } = this.axialToWorld(nextStep.q, nextStep.r);

    const speed = 0.1 * delta;
    const dx = x - unit.x;
    const dy = y - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1) {
      unit.setPosition(x, y);
      unit.q = nextStep.q;
      unit.r = nextStep.r;
      this.movingPath.shift();

      if (this.movingPath.length === 0) {
        this.isUnitMoving = false;
        this.movingPath = null;
        this.syncPlayerMove?.(unit);
        this.checkCombat(unit);
      }
    } else {
      unit.x += (dx / dist) * speed;
      unit.y += (dy / dist) * speed;
    }
  }

  checkCombat(unit) {
    const enemy = this.enemies.find(e => e.q === unit.q && e.r === unit.r);
    if (!enemy) return;

    console.log(`[COMBAT] ${unit.playerName} engages enemy at (${unit.q},${unit.r})`);
    // TODO: switch to combat scene
  }

  endTurn() {
    if (this.uiLocked) return;
    this.uiLocked = true;

    console.log(`[TURN] Ending turn for ${this.turnOwner} (Turn ${this.turnNumber})`);

    applyShipRoutesOnEndTurn.call(this);
    applyHaulerRoutesOnEndTurn.call(this);

    this.moveEnemies();

    const idx = this.lobbyState.players.findIndex(p => p.name === this.turnOwner);
    const nextIdx = (idx + 1) % this.lobbyState.players.length;
    this.turnOwner = this.lobbyState.players[nextIdx].name;
    this.turnNumber += 1;
    this.lobbyState.turnNumber = this.turnNumber;
    this.lobbyState.currentTurn = this.turnOwner;

    this.hexInspect(`[WORLD] Turn ${this.turnNumber} – Current player: ${this.turnOwner}`);

    this.uiLocked = false;
  }

  moveEnemies() {
    if (!this.enemies || this.enemies.length === 0) return;

    this.enemies.forEach(enemy => {
      const dirsEven = [
        { dq: +1, dr: 0 }, { dq: 0, dr: -1 }, { dq: -1, dr: -1 },
        { dq: -1, dr: 0 }, { dq: -1, dr: +1 }, { dq: 0, dr: +1 },
      ];
      const dirsOdd = [
        { dq: +1, dr: 0 }, { dq: +1, dr: -1 }, { dq: 0, dr: -1 },
        { dq: -1, dr: 0 }, { dq: 0, dr: +1 }, { dq: +1, dr: +1 },
      ];
      const dirs = (enemy.r & 1) ? dirsOdd : dirsEven;

      Phaser.Utils.Array.Shuffle(dirs);

      for (const d of dirs) {
        const nq = enemy.q + d.dq;
        const nr = enemy.r + d.dr;
        if (nq < 0 || nr < 0 || nq >= this.mapWidth || nr >= this.mapHeight) continue;
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

// Wrapper: keep old API but delegate to A*
function findPath(unit, targetHex, mapData, blockedPred) {
  const start = { q: unit.q, r: unit.r };
  const goal  = { q: targetHex.q, r: targetHex.r };

  if (start.q === goal.q && start.r === goal.r) {
    return [start];
  }

  const getTileLocal = (q, r) => mapData.find(t => t.q === q && t.r === r);
  const isBlocked = tile => {
    if (!tile) return true;
    return blockedPred ? blockedPred(tile) : false;
  };

  const path = aStarFindPath(start, goal, mapData, (q, r) => {
    const tile = getTileLocal(q, r);
    return isBlocked(tile);
  });

  if (!path || path.length === 0) return null;
  return path;
}

function setupCameraControls(scene) {
  const cam = scene.cameras.main;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let camStartX = 0;
  let camStartY = 0;

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

  // End Turn button (HUD, bottom-right)
  const cam = scene.cameras.main;
  const x = cam.width - 110;
  const y = cam.height - 40;

  const container = scene.add.container(x, y).setScrollFactor(0).setDepth(2100);

  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.9);
  bg.fillRoundedRect(0, 0, 100, 30, 8);

  const txt = scene.add.text(10, 6, 'End Turn', {
    fontSize: '16px',
    color: '#e8f6ff',
  });

  container.add(bg);
  container.add(txt);

  container.setSize(100, 30);
  container.setInteractive(
    new Phaser.Geom.Rectangle(0, 0, 100, 30),
    Phaser.Geom.Rectangle.Contains
  );

  container.on('pointerover', () => {
    scene.input.setDefaultCursor('pointer');
  });
  container.on('pointerout', () => {
    scene.input.setDefaultCursor('grab');
  });
  container.on('pointerdown', () => {
    scene.endTurn();
  });

  scene.turnUiContainer = container;
}

function setupUnitPanel(scene) {
  const cam = scene.cameras.main;
  const x = 16;
  const y = cam.height - 200;

  const panel = scene.add.container(x, y).setScrollFactor(0).setDepth(2100);
  panel.setVisible(false);

  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.9);
  bg.fillRoundedRect(0, 0, 220, 180, 12);

  const outline = scene.add.graphics();
  outline.lineStyle(2, 0x3da9fc, 1);
  outline.strokeRoundedRect(0, 0, 220, 180, 12);

  panel.add(bg);
  panel.add(outline);

  const title = scene.add.text(12, 8, 'Unit Actions', {
    fontSize: '16px',
    color: '#e8f6ff',
  });
  panel.add(title);

  const btns = [
    { label: 'Build Docks',  action: () => startDocksPlacement.call(scene) },
    { label: 'Build Hauler', action: () => buildHaulerAtSelectedUnit.call(scene) },
    { label: 'Set Ship Route', action: () => enterHaulerRoutePicker.call(scene) },
  ];

  let offsetY = 40;
  btns.forEach(({ label, action }) => {
    const btnBg = scene.add.graphics();
    btnBg.fillStyle(0x173b52, 1);
    btnBg.fillRoundedRect(12, offsetY, 196, 32, 8);
    panel.add(btnBg);

    const txt = scene.add.text(22, offsetY + 6, label, {
      fontSize: '14px',
      color: '#e8f6ff',
    });
    panel.add(txt);

    const hit = scene.add.rectangle(12, offsetY, 196, 32, 0x000000, 0)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });

    hit.on('pointerover', () => {
      btnBg.clear();
      btnBg.fillStyle(0x1a4764, 1);
      btnBg.fillRoundedRect(12, offsetY, 196, 32, 8);
    });
    hit.on('pointerout', () => {
      btnBg.clear();
      btnBg.fillStyle(0x173b52, 1);
      btnBg.fillRoundedRect(12, offsetY, 196, 32, 8);
    });
    hit.on('pointerdown', () => {
      action();
    });

    panel.add(hit);

    offsetY += 40;
  });

  const closeTxt = scene.add.text(12, offsetY + 8, 'Close [B]', {
    fontSize: '12px',
    color: '#9be4ff',
  });
  panel.add(closeTxt);

  const closeHit = scene.add.rectangle(12, offsetY + 4, 196, 24, 0x000000, 0)
    .setOrigin(0, 0)
    .setInteractive({ useHandCursor: true });

  closeHit.on('pointerdown', () => {
    scene.hideUnitPanel();
  });

  panel.add(closeHit);

  scene.showUnitPanel = (unit) => {
    panel.setVisible(true);
  };
  scene.hideUnitPanel = () => {
    panel.setVisible(false);
  };

  scene.input.keyboard?.on('keydown-B', () => {
    if (!scene.selectedUnit) return;
    if (panel.visible) scene.hideUnitPanel();
    else scene.showUnitPanel(scene.selectedUnit);
  });
}
