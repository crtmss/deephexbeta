// src/scenes/WorldSceneBuildings.js

import {
  buildShipForDocks,
  openDocksRoutePicker,
  recallShipsToDocks,
  ensureDocksStoreLabel,
  updateDocksStoreLabel,
  // Back-compat re-exports for callers that imported from buildings before split:
  applyHaulerRoutesOnEndTurn,           // eslint-disable-line no-unused-vars
} from './WorldSceneHaulers.js';

// Re-export (back-compat): some old code may import these names from Buildings.
export { applyHaulerBehaviorOnEndTurn as applyHaulerRoutesOnEndTurn } from './WorldSceneHaulers.js';
export { enterHaulerRoutePicker, buildHaulerAtSelectedUnit, applyShipRoutesOnEndTurn } from './WorldSceneHaulers.js';

///////////////////////////////
// Visual + UI constants (shared with this file only)
///////////////////////////////
const COLORS = {
  plate: 0x0f2233,
  stroke: 0x3da9fc,
  labelText: '#e8f6ff',
};
const UI = {
  labelFontSize: 16,
  boxRadius: 8,
  boxStrokeAlpha: 0.9,
  zBuilding: 2100,
  zOverlay: 2290,
  zMenu: 2300,
};

///////////////////////////////
// Storage cap used by labels inside Haulers module
///////////////////////////////
const DOCKS_STORAGE_CAP = 10; // kept for reference; labels handled in Haulers

///////////////////////////////
// Buildings registry
///////////////////////////////
export const BUILDINGS = {
  docks: {
    key: 'docks',
    name: 'Docks',
    emojiWater: '🚢',
    emojiLand: '⚓',
    validateTile(scene, q, r) {
      const t = _tileAt(scene, q, r);
      if (!t || !_isWater(scene, q, r)) return false;
      const landAdj = _offsetNeighbors(q, r).some(h => _isLand(scene, h.q, h.r));
      if (!landAdj) return false;
      if ((scene.buildings || []).some(b => b.type === 'docks' && b.q === q && b.r === r)) return false;
      return true;
    },
  },
};

///////////////////////////////
// Public API: Docks building flow
///////////////////////////////
export function startDocksPlacement() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _ensureResourceInit(scene);

  if (!_canAfford(scene, { scrap: 20, money: 50 })) {
    console.warn('[BUILD] Not enough resources for Docks (need 🛠20 + 💰50).');
    return;
  }
  const count = (scene.buildings || []).filter(b => b.type === 'docks').length;
  if (count >= 2) {
    console.warn('[BUILD] Docks: limit reached (2).');
    return;
  }
  if (!scene.selectedUnit) {
    console.warn('[BUILD] Docks: no unit selected.');
    return;
  }

  const u = scene.selectedUnit;

  const ring1 = _neighbors(u.q, u.r)
    .filter(({ q, r }) => _isWater(scene, q, r))
    .filter(({ q, r }) => BUILDINGS.docks.validateTile(scene, q, r));

  let pick = null;
  if (ring1.length) pick = _getRandom(ring1, scene);

  if (!pick) {
    const coastal = _computeCoastalWater(scene, u.q, u.r)
      .filter(({ q, r }) => BUILDINGS.docks.validateTile(scene, q, r));
    if (coastal.length) pick = _getRandom(coastal, scene);
  }

  if (!pick) {
    const nearest = _nearestWaterWithin(scene, u.q, u.r, 3);
    if (nearest && BUILDINGS.docks.validateTile(scene, nearest.q, nearest.r)) pick = nearest;
  }

  if (!pick) {
    console.warn('[BUILD] Docks: no nearby valid water found.');
    return;
  }

  if (!_spend(scene, { scrap: 20, money: 50 })) {
    console.warn('[BUILD] Failed to spend resources for Docks.');
    return;
  }
  _placeDocks(scene, pick.q, pick.r, 'spawned from mobile base');
}

export function cancelPlacement() { /* reserved */ }

export function placeDocks(q, r) {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _ensureResourceInit(scene);

  if (!_canAfford(scene, { scrap: 20, money: 50 })) {
    console.warn('[BUILD] Not enough resources for Docks (need 🛠20 + 💰50).');
    return;
  }
  if (!_spend(scene, { scrap: 20, money: 50 })) return;
  _placeDocks(scene, q, r, 'direct place');
}

///////////////////////////////
// Docks placement + menu
///////////////////////////////
function _placeDocks(scene, q, r, reason='') {
  const docksCount = (scene.buildings || []).filter(b => b.type === 'docks').length;
  if (docksCount >= 2) {
    console.warn('[BUILD] Docks: limit reached (2).');
    return;
  }
  if (!BUILDINGS.docks.validateTile(scene, q, r)) {
    console.warn(`[BUILD] Docks: invalid placement at (${q},${r}).`);
    return;
  }

  const landAdj = _offsetNeighbors(q, r).filter(h => _isLand(scene, h.q, h.r));
  if (landAdj.length === 0) {
    console.warn(`[BUILD] Docks: no adjacent land at (${q},${r}).`);
    return;
  }
  const ground = landAdj[0];

  scene.buildings = scene.buildings || [];
  scene._buildingIdSeq = (scene._buildingIdSeq || 1) + 1;
  const id = scene._buildingIdSeq;

  // Water label/container
  const posW = scene.axialToWorld(q, r);
  const contWater = scene.add.container(posW.x, posW.y).setDepth(UI.zBuilding);
  const labelW = scene.add.text(0, 0, `${BUILDINGS.docks.emojiWater}  ${BUILDINGS.docks.name}`, {
    fontSize: `${UI.labelFontSize}px`, color: COLORS.labelText,
  }).setOrigin(0.5);
  const wW = Math.max(64, labelW.width + 12), hW = Math.max(26, labelW.height + 12);
  const boxW = scene.add.graphics();
  boxW.fillStyle(COLORS.plate ?? 0x0f2233, 0.92);
  boxW.fillRoundedRect(-wW/2, -hW/2, wW, hW, 8);
  boxW.lineStyle(2, COLORS.stroke ?? 0x3da9fc, UI.boxStrokeAlpha ?? 0.9);
  boxW.strokeRoundedRect(-wW/2, -hW/2, wW, hW, 8);
  const hitW = scene.add.rectangle(0, 0, wW, hW, 0x000000, 0).setOrigin(0.5).setInteractive({ useHandCursor: true });
  contWater.add([boxW, labelW, hitW]);

  // Ground label/container
  const posG = scene.axialToWorld(ground.q, ground.r);
  const contLand = scene.add.container(posG.x, posG.y).setDepth(UI.zBuilding);
  const labelG = scene.add.text(0, 0, `${BUILDINGS.docks.emojiLand}  ${BUILDINGS.docks.name}`, {
    fontSize: `${UI.labelFontSize}px`, color: COLORS.labelText,
  }).setOrigin(0.5);
  const wG = Math.max(64, labelG.width + 12), hG = Math.max(26, labelG.height + 12);
  const boxG = scene.add.graphics();
  boxG.fillStyle(COLORS.plate ?? 0x0f2233, 0.92);
  boxG.fillRoundedRect(-wG/2, -hG/2, wG, hG, 8);
  boxG.lineStyle(2, COLORS.stroke ?? 0x3da9fc, UI.boxStrokeAlpha ?? 0.9);
  boxG.strokeRoundedRect(-wG/2, -hG/2, wG, hG, 8);
  const hitG = scene.add.rectangle(0, 0, wG, hG, 0x000000, 0).setOrigin(0, 0).setInteractive({ useHandCursor: true });
  contLand.add([boxG, labelG, hitG]);

  const building = {
    id,
    type: BUILDINGS.docks.key,
    name: BUILDINGS.docks.name,
    q, r,            // WATER hex
    container: contWater,
    gq: ground.q, gr: ground.r, // GROUND hex
    containerLand: contLand,
    routeMarker: null,
    menu: null,
    overlay: null,
    route: null,
    storageFood: 0,
    storageObj: null,
  };

  scene.buildings.push(building);

  // Ensure storage label (now implemented in Haulers module)
  ensureDocksStoreLabel(scene, building);
  updateDocksStoreLabel(scene, building);

  const openMenu = (pointer, lx, ly, event) => {
    event?.stopPropagation?.();
    _openBuildingMenu(scene, building);
  };
  hitW.on('pointerdown', openMenu);
  hitG.on('pointerdown', openMenu);

  console.log(`[BUILD] Docks placed at WATER(${q},${r}) + GROUND(${ground.q},${ground.r}) — ${reason}`);
}

function _openBuildingMenu(scene, building) {
  _closeAnyBuildingMenu(scene, building.id);
  scene.uiLock = 'buildingMenu';

  const cam = scene.cameras.main;
  const overlay = scene.add.rectangle(
    cam.worldView.x + cam.worldView.width / 2,
    cam.worldView.y + cam.worldView.height / 2,
    cam.worldView.width,
    cam.worldView.height,
    0x000000, 0.001
  ).setInteractive({ useHandCursor: false })
   .setScrollFactor(0)
   .setDepth(UI.zOverlay);
  overlay.on('pointerdown', (pointer, lx, ly, event) => { event?.stopPropagation?.(); _closeBuildingMenu(scene, building); });
  building.overlay = overlay;

  const midX = (scene.axialToWorld(building.q, building.r).x + scene.axialToWorld(building.gq, building.gr).x) / 2;
  const midY = (scene.axialToWorld(building.q, building.r).y + scene.axialToWorld(building.gq, building.gr).y) / 2;

  const menu = scene.add.container(midX, midY - 56).setDepth(UI.zMenu);
  building.menu = menu;

  const W = 172, H = 172;
  const bg = scene.add.graphics();
  bg.fillStyle(0x0f2233, 0.96);
  bg.fillRoundedRect(-W/2, -H/2, W, H, 12);
  bg.lineStyle(2, 0x3da9fc, 1);
  bg.strokeRoundedRect(-W/2, -H/2, W, H, 12);

  const bezel = scene.add.graphics();
  bezel.lineStyle(1, 0x9be4ff, 0.25);
  bezel.strokeRect(-W/2 + 16, -H/2 + 16, W - 32, H - 32);
  bezel.strokeRect(-W/2 + 8,  -H/2 + 8,  W - 16, H - 16);

  const btnSize = 70, pad = 8, startX = -W/2 + 12, startY = -H/2 + 12;

  const addBtn = (x, y, label, onClick) => {
    const g = scene.add.graphics();
    g.fillStyle(0x173b52, 1);
    g.fillRoundedRect(x, y, btnSize, btnSize, 8);
    g.lineStyle(2, 0x6fe3ff, 0.7);
    g.strokeRoundedRect(x, y, btnSize, btnSize, 8);

    const t = scene.add.text(x + btnSize/2, y + btnSize/2, label, {
      fontSize: '14px', color: '#e8f6ff', align: 'center', wordWrap: { width: btnSize - 10 }
    }).setOrigin(0.5);

    const hit = scene.add.rectangle(x, y, btnSize, btnSize, 0x000000, 0)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerdown', (pointer, lx, ly, event) => { event?.stopPropagation?.(); onClick?.(); });

    menu.add([g, t, hit]);
  };

  const defs = [
    { text: 'Build a ship', onClick: () => buildShipForDocks(scene, building) },
    { text: 'Set route',    onClick: () => openDocksRoutePicker(scene, building) },
    { text: 'Recall ships', onClick: () => recallShipsToDocks(scene, building) },
    { text: 'Destroy',      onClick: () => _destroyBuilding(scene, building) },
  ];
  for (let i = 0; i < defs.length; i++) {
    const r = Math.floor(i / 2), c = i % 2;
    const x = startX + c * (btnSize + pad);
    const y = startY + r * (btnSize + pad);
    addBtn(x, y, defs[i].text, defs[i].onClick);
  }

  menu.add([bg, bezel]);
  menu.sendToBack(bg); menu.sendToBack(bezel);
  menu.active = true;
}

function _closeAnyBuildingMenu(scene, exceptId) {
  (scene.buildings || []).forEach(b => { if (b.menu && b.id !== exceptId) _closeBuildingMenu(scene, b); });
}
function _closeBuildingMenu(scene, building) {
  building.menu?.destroy(true); building.menu = null;
  building.overlay?.destroy(true); building.overlay = null;
  if (scene.uiLock === 'buildingMenu') scene.uiLock = null;
}

function _destroyBuilding(scene, building) {
  building.container?.destroy(true);
  building.containerLand?.destroy(true);
  building.menu?.destroy(true);
  building.overlay?.destroy(true);
  building.storageObj?.destroy(true);
  building.routeMarker?.destroy(true);

  (scene.ships || []).forEach(s => { if (s.docksId === building.id) s.docksId = null; });
  (scene.haulers || []).forEach(h => { if (h.targetDocksId === building.id) h.targetDocksId = null; });

  scene.buildings = (scene.buildings || []).filter(b => b !== building);
  if (scene.uiLock === 'buildingMenu') scene.uiLock = null;

  console.log(`[BUILD] Docks destroyed (id=${building.id}).`);
}

///////////////////////////////
// Shared helpers (kept local)
///////////////////////////////
function _ensureResourceInit(scene) {
  if (!scene.playerResources) scene.playerResources = { food: 20, scrap: 20, money: 100, influence: 0 };
  scene.updateResourceUI?.();
}
function _canAfford(scene, cost) {
  const r = scene.playerResources || {};
  return Object.entries(cost).every(([k, v]) => (r[k] ?? 0) >= v);
}
function _spend(scene, cost) {
  if (!_canAfford(scene, cost)) return false;
  Object.entries(cost).forEach(([k, v]) => {
    scene.playerResources[k] = (scene.playerResources[k] ?? 0) - v;
    scene.bumpResource?.(k);
  });
  scene.updateResourceUI?.();
  return true;
}
function _tileAt(scene, q, r) { return scene.mapData?.find?.(t => t.q === q && t.r === r); }
function _isWater(scene, q, r) { const t=_tileAt(scene,q,r); return !!t && (t.type==='water'||t.type==='ocean'||t.type==='sea'); }
function _isLand(scene, q, r)  { const t=_tileAt(scene,q,r); return !!t && !_isWater(scene, q, r); }

function _offsetNeighbors(q, r) {
  const isOdd = (r & 1) === 1;
  const even = [[0,-1],[+1,0],[0,+1],[-1,+1],[-1,0],[-1,-1]];
  const odd  = [[+1,-1],[+1,0],[+1,+1],[0,+1],[-1,0],[0,-1]];
  return (isOdd ? odd : even).map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}
function _neighbors(q, r) { return _offsetNeighbors(q, r); }

function _nearestWaterWithin(scene, uq, ur, maxRadius=3) {
  const key=(q,r)=>`${q},${r}`, seen=new Set([key(uq,ur)]);
  const qArr=[{q:uq,r:ur,dist:0}];
  while(qArr.length){
    const cur=qArr.shift();
    if(cur.dist>maxRadius) break;
    if(_isWater(scene,cur.q,cur.r)&&BUILDINGS.docks.validateTile(scene,cur.q,cur.r)){
      if(!(cur.q===uq&&cur.r===ur)) return { q: cur.q, r: cur.r };
    }
    for(const n of _offsetNeighbors(cur.q,cur.r)){
      if(n.q<0||n.r<0||n.q>=scene.mapWidth||n.r>=scene.mapHeight)continue;
      const k=key(n.q,n.r); if(seen.has(k))continue;
      seen.add(k); qArr.push({ q:n.q, r:n.r, dist:cur.dist+1 });
    }
  }
  return null;
}
function _computeCoastalWater(scene,uq,ur){
  const set=new Set(), out=[]; const add=(q,r)=>{const k=`${q},${r}`; if(!set.has(k)){set.add(k); out.push({q,r});}};
  for(const h of _offsetNeighbors(uq,ur)){
    if(h.q<0||h.r<0||h.q>=scene.mapWidth||h.r>=scene.mapHeight)continue;
    if(_isLand(scene,h.q,h.r)){
      for(const n of _offsetNeighbors(h.q,h.r)){
        if(n.q<0||n.r<0||n.q>=scene.mapWidth||n.r>=scene.mapHeight)continue;
        if(_isWater(scene,n.q,n.r)) add(n.q,n.r);
      }
    }
  }
  return out;
}
function _getRandom(list, scene){ if(!list||!list.length) return null; const i=Math.floor((scene?.hexMap?.rand?.() ?? Math.random())*list.length); return list[i]; }
