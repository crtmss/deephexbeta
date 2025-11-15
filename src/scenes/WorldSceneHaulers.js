// src/scenes/WorldSceneHaulers.js
// Ships + Haulers module (movement, harvesting, cyan path, labels, route picker)

///////////////////////////////
// Visual + UI constants (scoped here)
///////////////////////////////
const COLORS = {
  xMarkerPlate: 0x112633,
  xMarkerStroke: 0x3da9fc,
  cargoText: '#ffffff',
  docksStoreText: '#ffffff',
};
const UI = {
  zBuilding: 2100,
  zOverlay: 2290,
  zCargo: 2101,
  zDocksStore: 2101,
};

const DOCKS_STORAGE_CAP = 10;
const SHIP_CARGO_CAP = 2;
const HAULER_CARGO_CAP = 5;

///////////////////////////////
// Public API (named exports)
///////////////////////////////

/** Build a ship at the water tile of the given docks building. Costs 10 food. */
export function buildShipForDocks(scene, building) {
  _ensureResourceInit(scene);
  if (!_spend(scene, { food: 10 })) {
    console.warn('[SHIP] Not enough 🍖 (need 10).');
    return;
  }

  scene.ships = scene.ships || [];
  const pos = scene.axialToWorld(building.q, building.r);
  const t = scene.add.text(pos.x, pos.y, '🚢', { fontSize: '20px', color: '#ffffff' })
    .setOrigin(0.5).setDepth(UI.zBuilding);

  const ship = {
    type: 'ship',
    name: 'Ship',
    emoji: '🚢',
    isNaval: true,
    q: building.q, r: building.r,
    docksId: building.id,
    obj: t,
    maxMovePoints: 8,
    movePoints: 8,
    cargoFood: 0,
    cargoObj: null,
    mode: 'toTarget',
    harvestTurnsRemaining: 0,
    harvestAt: null,
  };
  scene.ships.push(ship);
  _ensureCargoLabel(scene, ship);
  _repositionCargoLabel(scene, ship);
}

/** Open a click-to-pick route target (water) for all ships of a docks. */
export function openDocksRoutePicker(scene, building) {
  const ships = (scene.ships || []).filter(s => s.docksId === building.id);
  if (ships.length === 0) {
    console.log(`[DOCKS] Set route: no ships for docks#${building.id}`);
    return;
  }

  const cam = scene.cameras.main;
  const overlay = scene.add.rectangle(
    cam.worldView.x + cam.worldView.width / 2,
    cam.worldView.y + cam.worldView.height / 2,
    cam.worldView.width,
    cam.worldView.height,
    0x000000, 0.001
  ).setInteractive({ useHandCursor: true })
   .setScrollFactor(0)
   .setDepth(UI.zOverlay);

  console.log('[DOCKS] Click a reachable water hex to set route…');

  overlay.once('pointerdown', (pointer, lx, ly, event) => {
    event?.stopPropagation?.();
    const approx = scene.pixelToHex(
      pointer.worldX - (scene.mapOffsetX || 0),
      pointer.worldY - (scene.mapOffsetY || 0),
      scene.hexSize
    );
    const rounded = scene.roundHex(approx.q, approx.r);

    if (rounded.q < 0 || rounded.r < 0 || rounded.q >= scene.mapWidth || rounded.r >= scene.mapHeight) {
      console.warn('[DOCKS] Route pick out of bounds — cancelled');
      overlay.destroy(); return;
    }
    if (!_isWater(scene, rounded.q, rounded.r)) {
      console.warn('[DOCKS] Route must be on water.');
      overlay.destroy(); return;
    }
    if (!_reachableOnWater(scene, building.q, building.r, rounded.q, rounded.r)) {
      console.warn('[DOCKS] Route water hex is not reachable by water.');
      overlay.destroy(); return;
    }
    _setRouteMarker(scene, building, rounded.q, rounded.r);
    overlay.destroy();
  });
}

/** Snap all ships of a docks back to the docks water tile. */
export function recallShipsToDocks(scene, building) {
  const ships = (scene.ships || []).filter(s => s.docksId === building.id);
  if (ships.length === 0) {
    console.log(`[DOCKS] Recall: no ships for docks#${building.id}`);
    return;
  }
  ships.forEach(s => {
    s.q = building.q; s.r = building.r;
    const p = scene.axialToWorld(s.q, s.r);
    s.obj.setPosition(p.x, p.y);
    _repositionCargoLabel(scene, s);
  });
}

/** End-turn execution for ships (move/harvest/return, cyan path, deposit). */
export function applyShipRoutesOnEndTurn(sceneArg) {
  const scene = sceneArg || /** @type {any} */ (this);
  if (!scene) return;
  _ensureResourceInit(scene);

  const buildings = scene.buildings || [];
  const ships = scene.ships || [];
  if (ships.length === 0) return;

  let movedAny = false;

  buildings.forEach(b => {
    if (b.type !== 'docks') return;
    if (typeof b.storageFood !== 'number') b.storageFood = 0;
    ensureDocksStoreLabel(scene, b);
    updateDocksStoreLabel(scene, b);

    const route = b.route || null;
    const docksShips = ships.filter(s => s.docksId === b.id);

    docksShips.forEach(s => {
      if (typeof s.maxMovePoints !== 'number') s.maxMovePoints = 8;
      if (typeof s.movePoints !== 'number') s.movePoints = s.maxMovePoints;
      if (typeof s.cargoFood !== 'number') s.cargoFood = 0;
      if (!s.mode) s.mode = 'toTarget';
      _ensureCargoLabel(scene, s);

      // Route changed while harvesting → reset
      if (s.mode === 'harvesting' && route && (s.harvestAt?.q !== route.q || s.harvestAt?.r !== route.r)) {
        s.mode = 'toTarget';
        s.harvestTurnsRemaining = 0;
        s.harvestAt = null;
      }
      // No route but carrying → return
      if (!route && s.cargoFood > 0) s.mode = 'returning';

      // Harvest turn (no movement)
      if (s.mode === 'harvesting') {
        if (s.harvestTurnsRemaining > 0) {
          const room = Math.max(0, SHIP_CARGO_CAP - s.cargoFood);
          const take = Math.min(1, room);
          if (take > 0) {
            s.cargoFood += take;
            _updateCargoLabel(scene, s);
          }
          s.harvestTurnsRemaining -= 1;
        }
        if (s.harvestTurnsRemaining <= 0 || s.cargoFood >= SHIP_CARGO_CAP) {
          s.mode = 'returning';
        }
        s.movePoints = s.maxMovePoints;
        return;
      }

      // Targets
      let targetQ = s.q, targetR = s.r;
      if (s.mode === 'toTarget' && route) { targetQ = route.q; targetR = route.r; }
      else if (s.mode === 'returning') { targetQ = b.q; targetR = b.r; }

      // Arrived?
      if (s.q === targetQ && s.r === targetR) {
        if (s.mode === 'toTarget') {
          const onFish = _fishAt(scene, s.q, s.r);
          if (onFish) {
            s.mode = 'harvesting';
            s.harvestTurnsRemaining = 2;
            s.harvestAt = { q: s.q, r: s.r };
          } else {
            s.mode = 'returning';
          }
        } else if (s.mode === 'returning') {
          if (s.cargoFood > 0) {
            const room = Math.max(0, DOCKS_STORAGE_CAP - b.storageFood);
            const deposit = Math.min(room, s.cargoFood);
            b.storageFood += deposit;
            s.cargoFood -= deposit;
            updateDocksStoreLabel(scene, b);
            _updateCargoLabel(scene, s);
          }
          s.mode = route ? 'toTarget' : 'returning';
        }
        s.movePoints = s.maxMovePoints;
        return;
      }

      // Movement leg
      if (s.movePoints <= 0) return;
      const path = _waterPath(scene, s.q, s.r, targetQ, targetR);
      if (!path || path.length <= 1) return;

      _debugDrawWaterPath(scene, path);
      const steps = Math.min(s.movePoints, path.length - 1);
      const nx = path[steps];
      s.q = nx.q; s.r = nx.r;
      s.movePoints -= steps;

      const p = scene.axialToWorld(s.q, s.r);
      s.obj.setPosition(p.x, p.y);
      _repositionCargoLabel(scene, s);

      movedAny = true;
    });
  });

  // Reset MPs for next turn
  (scene.ships || []).forEach(s => {
    if (typeof s.maxMovePoints !== 'number') s.maxMovePoints = 8;
    s.movePoints = s.maxMovePoints;
  });

  if (!movedAny) {
    const dbg = (scene.ships || []).map(s => `ship#${s.docksId}@${s.q},${s.r} mp=${s.movePoints} mode=${s.mode} 🍖${s.cargoFood}`).join(' | ');
    console.log(`[SHIP] No ships moved. Current ships: ${dbg}`);
  }
}

/** Build a hauler at the selected mobile base (cost 10 food). */
export function buildHaulerAtSelectedUnit() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  _ensureResourceInit(scene);
  if (!_spend(scene, { food: 10 })) {
    console.warn('[HAULER] Not enough 🍖 (need 10).');
    return;
  }
  const u = scene.selectedUnit;
  if (!u) { console.warn('[HAULER] No selected unit (mobile base).'); return; }

  scene.haulers = scene.haulers || [];
  const pos = scene.axialToWorld(u.q, u.r);
  const t = scene.add.text(pos.x, pos.y, '🚚', { fontSize: '20px', color: '#ffffff' })
    .setOrigin(0.5).setDepth(UI.zBuilding);

  const hauler = {
    type: 'hauler',
    name: 'Hauler',
    emoji: '🚚',
    q: u.q, r: u.r,
    obj: t,
    maxMovePoints: 8,
    movePoints: 8,
    cargoFood: 0,
    cargoObj: null,
    mode: 'idle',
    baseRef: u, baseQ: u.q, baseR: u.r,
    targetDocksId: null,
  };

  // Auto-assign nearest docks (by ground tile distance)
  const docksList = (scene.buildings || []).filter(b => b.type === 'docks');
  if (docksList.length > 0) {
    const best = docksList
      .map(b => ({ b, d: _hexManhattan(u.q, u.r, b.gq ?? b.q, b.gr ?? b.r) }))
      .sort((a, b) => a.d - b.d)[0].b;
    hauler.targetDocksId = best.id;
    hauler.mode = 'toDocks';
    console.log(`[HAULER] Auto-assigned to docks#${best.id} at ground(${best.gq},${best.gr}).`);
  } else {
    console.warn('[HAULER] No docks available to assign route.');
  }

  scene.haulers.push(hauler);
  _ensureCargoLabel(scene, hauler);
  _repositionCargoLabel(scene, hauler);
}

/** End-turn execution for haulers (move/pickup/deposit). */
export function applyHaulerBehaviorOnEndTurn(sceneArg) {
  const scene = sceneArg || /** @type {any} */ (this);
  if (!scene) return;
  _ensureResourceInit(scene);

  const haulers = scene.haulers || [];
  if (haulers.length === 0) return;

  let movedAny = false;

  for (const h of haulers) {
    if (typeof h.maxMovePoints !== 'number') h.maxMovePoints = 8;
    if (typeof h.movePoints !== 'number') h.movePoints = h.maxMovePoints;
    if (!h.cargoObj || h.cargoObj.destroyed) _ensureCargoLabel(scene, h);

    const docks = (scene.buildings || []).find(b => b.type === 'docks' && b.id === h.targetDocksId) || null;
    if (!docks) { h.mode = 'idle'; h.movePoints = h.maxMovePoints; continue; }

    ensureDocksStoreLabel(scene, docks);
    updateDocksStoreLabel(scene, docks);

    const targetGroundQ = docks.gq ?? docks.q;
    const targetGroundR = docks.gr ?? docks.r;

    const basePos = _getMobileBaseCoords(scene, h);
    const baseQ = basePos.q, baseR = basePos.r;

    if (h.cargoFood > 0 && h.mode !== 'returningToBase') h.mode = 'returningToBase';
    if (h.cargoFood === 0 && h.mode === 'idle') h.mode = 'toDocks';

    let targetQ = h.q, targetR = h.r;
    if (h.mode === 'toDocks') { targetQ = targetGroundQ; targetR = targetGroundR; }
    else if (h.mode === 'returningToBase') { targetQ = baseQ; targetR = baseR; }

    // Arrived?
    if (h.q === targetQ && h.r === targetR) {
      if (h.mode === 'toDocks') {
        const room = Math.max(0, HAULER_CARGO_CAP - h.cargoFood);
        const take = Math.min(room, docks.storageFood || 0);
        docks.storageFood = Math.max(0, (docks.storageFood || 0) - take);
        h.cargoFood += take;
        updateDocksStoreLabel(scene, docks);
        _updateCargoLabel(scene, h);
        h.mode = 'returningToBase';
      } else if (h.mode === 'returningToBase') {
        if (h.cargoFood > 0) {
          _gain(scene, { food: h.cargoFood });
          h.cargoFood = 0;
          _updateCargoLabel(scene, h);
        }
        h.mode = 'toDocks';
      }
      h.movePoints = h.maxMovePoints;
      continue;
    }

    // Move
    if (h.movePoints <= 0) continue;
    const path = _landPath(scene, h.q, h.r, targetQ, targetR);
    if (!path || path.length <= 1) continue;

    _debugDrawLandPath(scene, path);
    const steps = Math.min(h.movePoints, path.length - 1);
    const nx = path[steps];
    h.q = nx.q; h.r = nx.r;
    h.movePoints -= steps;

    const p = scene.axialToWorld(h.q, h.r);
    h.obj.setPosition(p.x, p.y);
    _repositionCargoLabel(scene, h);

    movedAny = true;
  }

  haulers.forEach(h => { h.movePoints = h.maxMovePoints; });

  if (!movedAny) {
    const dbg = haulers.map(h => `hauler@${h.q},${h.r} mode=${h.mode} mp=${h.movePoints} 🍖${h.cargoFood}`).join(' | ');
    console.log(`[HAULER] No haulers moved. ${dbg}`);
  }
}

/** Click UI: assign docks to selected hauler (or first). Bound to scene as `this`. */
export function enterHaulerRoutePicker() {
  const scene = /** @type {Phaser.Scene & any} */ (this);
  const sel = scene.selectedUnit;
  let targetHauler = null;
  if (sel && sel.type === 'hauler') targetHauler = sel;
  else targetHauler = (scene.haulers || [])[0] || null;

  if (!targetHauler) {
    console.warn('[HAULER] No hauler available to set a route for.');
    return;
  }

  const cam = scene.cameras.main;
  const overlay = scene.add.rectangle(
    cam.worldView.x + cam.worldView.width / 2,
    cam.worldView.y + cam.worldView.height / 2,
    cam.worldView.width,
    cam.worldView.height,
    0x000000, 0.001
  ).setInteractive({ useHandCursor: true })
   .setScrollFactor(0)
   .setDepth(UI.zOverlay);

  console.log('[HAULER] Click a docks (water or land part) to set as pickup…');

  overlay.once('pointerdown', (pointer, _lx, _ly, event) => {
    event?.stopPropagation?.();
    const approx = scene.pixelToHex(
      pointer.worldX - (scene.mapOffsetX || 0),
      pointer.worldY - (scene.mapOffsetY || 0),
      scene.hexSize
    );
    const rounded = scene.roundHex(approx.q, approx.r);

    if (rounded.q < 0 || rounded.r < 0 || rounded.q >= scene.mapWidth || rounded.r >= scene.mapHeight) {
      console.warn('[HAULER] Route pick out of bounds.');
      overlay.destroy();
      return;
    }

    const docks = (scene.buildings || []).find(b =>
      b.type === 'docks' && (
        (b.q === rounded.q && b.r === rounded.r) ||
        (b.gq === rounded.q && b.gr === rounded.r)
      )
    );

    if (!docks) {
      console.warn('[HAULER] You must select an existing docks (water or land).');
      overlay.destroy();
      return;
    }

    targetHauler.targetDocksId = docks.id;
    if (targetHauler.mode === 'idle') targetHauler.mode = 'toDocks';
    console.log(`[HAULER] Hauler will pick up from docks#${docks.id} ground(${docks.gq},${docks.gr}).`);
    overlay.destroy();
  });
}

// Back-compat alias (some code may import this old name from buildings before split)
export { applyHaulerBehaviorOnEndTurn as applyHaulerRoutesOnEndTurn };

///////////////////////////////
// Docks storage tiny helpers (exported so buildings can call after placement)
///////////////////////////////
export function ensureDocksStoreLabel(scene, docks) {
  if (docks.storageObj && !docks.storageObj.destroyed) return;
  const pos = scene.axialToWorld(docks.gq ?? docks.q, docks.gr ?? docks.r);
  docks.storageObj = scene.add.text(pos.x + 16, pos.y - 14, '', {
    fontSize: '14px',
    color: COLORS.docksStoreText,
  }).setOrigin(0, 1).setDepth(UI.zDocksStore);
  updateDocksStoreLabel(scene, docks);
}
export function updateDocksStoreLabel(scene, docks) {
  if (!docks.storageObj) return;
  const n = Math.min(DOCKS_STORAGE_CAP, docks.storageFood || 0);
  docks.storageObj.setText(n > 0 ? `🍖×${n}` : '');
}

///////////////////////////////
// Internal helpers (movement, paths, labels, resources, etc.)
///////////////////////////////
function _setRouteMarker(scene, building, q, r) {
  if (building.routeMarker) building.routeMarker.destroy(true);
  const pos = scene.axialToWorld(q, r);
  const container = scene.add.container(pos.x, pos.y).setDepth(UI.zBuilding);

  const t = scene.add.text(0, 0, 'X', { fontSize: '18px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
  const pad = 4;
  const w = Math.max(18, t.width + pad * 2);
  const h = Math.max(18, t.height + pad * 2);
  const box = scene.add.graphics();
  box.fillStyle(COLORS.xMarkerPlate, 0.93);
  box.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
  box.lineStyle(2, COLORS.xMarkerStroke, 0.9);
  box.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);

  container.add([box, t]);
  building.routeMarker = container;
  building.route = { q, r };
}

function _ensureResourceInit(scene) {
  if (!scene.playerResources) {
    scene.playerResources = { food: 20, scrap: 20, money: 100, influence: 0 };
  }
  scene.updateResourceUI?.();
}
function _spend(scene, cost) {
  if (!Object.entries(cost).every(([k, v]) => (scene.playerResources?.[k] ?? 0) >= v)) return false;
  Object.entries(cost).forEach(([k, v]) => {
    scene.playerResources[k] = (scene.playerResources[k] ?? 0) - v;
    scene.bumpResource?.(k);
  });
  scene.updateResourceUI?.();
  return true;
}
function _gain(scene, gains) {
  Object.entries(gains).forEach(([k, v]) => {
    scene.playerResources[k] = (scene.playerResources[k] ?? 0) + v;
    scene.bumpResource?.(k);
  });
  scene.updateResourceUI?.();
}

function _tileAt(scene, q, r) { return scene.mapData?.find?.(t => t.q === q && t.r === r); }
function _isWater(scene, q, r) {
  const t = _tileAt(scene, q, r);
  return !!t && (t.type === 'water' || t.type === 'ocean' || t.type === 'sea');
}
function _isLand(scene, q, r) { const t = _tileAt(scene, q, r); return !!t && !_isWater(scene, q, r); }

function _offsetNeighbors(q, r) {
  const isOdd = (r & 1) === 1;
  const even = [[0,-1],[+1,0],[0,+1],[-1,+1],[-1,0],[-1,-1]];
  const odd  = [[+1,-1],[+1,0],[+1,+1],[0,+1],[-1,0],[0,-1]];
  const d = isOdd ? odd : even;
  return d.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

function _reachableOnWater(scene, fromQ, fromR, toQ, toR) {
  if (!_isWater(scene, fromQ, fromR) || !_isWater(scene, toQ, toR)) return false;
  if (fromQ === toQ && fromR === toR) return true;
  return !!_waterPath(scene, fromQ, fromR, toQ, toR);
}
function _waterPath(scene, fromQ, fromR, toQ, toR) {
  if (!_isWater(scene,toQ,toR)||!_isWater(scene,fromQ,fromR)) return null;
  const key=(q,r)=>`${q},${r}`; const came=new Map(),seen=new Set([key(fromQ,fromR)]);
  const qArr=[{q:fromQ,r:fromR}];
  while(qArr.length){
    const cur=qArr.shift();
    if(cur.q===toQ&&cur.r===toR){
      const path=[]; let node=cur,k=key(cur.q,cur.r);
      while(node){path.push({q:node.q,r:node.r});const prev=came.get(k);if(!prev)break;k=key(prev.q,prev.r);node=prev;}
      return path.reverse();
    }
    for(const n of _offsetNeighbors(cur.q,cur.r)){
      if(n.q<0||n.r<0||n.q>=scene.mapWidth||n.r>=scene.mapHeight)continue;
      if(!_isWater(scene,n.q,n.r))continue;
      const nk=key(n.q,n.r); if(seen.has(nk))continue;
      seen.add(nk); came.set(nk,cur); qArr.push(n);
    }
  } return null;
}
function _landPath(scene,fromQ,fromR,toQ,toR){
  if(!_isLand(scene,fromQ,fromR)||!_isLand(scene,toQ,toR))return null;
  const key=(q,r)=>`${q},${r}`;const came=new Map(),seen=new Set([key(fromQ,fromR)]);
  const qArr=[{q:fromQ,r:fromR}];
  while(qArr.length){
    const cur=qArr.shift();
    if(cur.q===toQ&&cur.r===toR){
      const path=[];let node=cur,k=key(cur.q,cur.r);
      while(node){path.push({q:node.q,r:node.r});const prev=came.get(k);if(!prev)break;k=key(prev.q,prev.r);node=prev;}
      return path.reverse();
    }
    for(const n of _offsetNeighbors(cur.q,cur.r)){
      if(n.q<0||n.r<0||n.q>=scene.mapWidth||n.r>=scene.mapHeight)continue;
      if(!_isLand(scene,n.q,n.r))continue;
      const nk=key(n.q,n.r); if(seen.has(nk))continue;
      seen.add(nk); came.set(nk,cur); qArr.push(n);
    }
  } return null;
}

function _hexManhattan(q1,r1,q2,r2){return Math.abs(q1-q2)+Math.abs(r1-r2);}

function _debugDrawWaterPath(scene, path){
  try{
    if(!path||path.length<2)return;
    if(scene._shipPathGfx)scene._shipPathGfx.destroy();
    const g=scene.add.graphics().setDepth(2400);
    scene._shipPathGfx=g; g.lineStyle(2,0x6fe3ff,0.9);
    let p0=scene.axialToWorld(path[0].q,path[0].r);
    for(let i=1;i<path.length;i++){
      const p1=scene.axialToWorld(path[i].q,path[i].r);
      g.strokeLineShape(new Phaser.Geom.Line(p0.x,p0.y,p1.x,p1.y)); p0=p1;
    }
    scene.tweens.add({targets:g,alpha:0,duration:900,delay:600,onComplete:()=>g.destroy()});
  }catch{}
}
function _debugDrawLandPath(scene, path){
  try{
    if(!path||path.length<2)return;
    if(scene._haulerPathGfx)scene._haulerPathGfx.destroy();
    const g=scene.add.graphics().setDepth(2400);
    scene._haulerPathGfx=g; g.lineStyle(2,0x6fe3ff,0.9);
    let p0=scene.axialToWorld(path[0].q,path[0].r);
    for(let i=1;i<path.length;i++){
      const p1=scene.axialToWorld(path[i].q,path[i].r);
      g.strokeLineShape(new Phaser.Geom.Line(p0.x,p0.y,p1.x,p1.y)); p0=p1;
    }
    scene.tweens.add({targets:g,alpha:0,duration:900,delay:600,onComplete:()=>g.destroy()});
  }catch{}
}

function _fishAt(scene,q,r){
  return !!(scene.resources||[]).find(o=>o.type==='fish'&&o.q===q&&o.r===r);
}
function _ensureCargoLabel(scene,unit){
  if(unit.cargoObj && !unit.cargoObj.destroyed)return;
  unit.cargoObj=scene.add.text(0,0,'',{fontSize:'14px',color:COLORS.cargoText})
    .setOrigin(0,1).setDepth(UI.zCargo);
  _updateCargoLabel(scene,unit); _repositionCargoLabel(scene,unit);
}
function _updateCargoLabel(scene,unit){
  if(!unit.cargoObj)return;
  const n=unit.cargoFood||0;
  unit.cargoObj.setText(n>0?`🍖×${n}`:'');
}
function _repositionCargoLabel(scene,unit){
  if(!unit.cargoObj)return;
  const p=scene.axialToWorld(unit.q,unit.r);
  unit.cargoObj.setPosition(p.x+10,p.y-6);
}

function _getMobileBaseCoords(scene, hauler) {
  if (hauler?.baseRef && typeof hauler.baseRef.q === 'number' && typeof hauler.baseRef.r === 'number') {
    return { q: hauler.baseRef.q, r: hauler.baseRef.r };
  }
  if (Array.isArray(scene.players)) {
    const mb = scene.players.find(u =>
      u?.type === 'mobileBase' ||
      u?.isMobileBase === true ||
      u?.name === 'Mobile Base'
    );
    if (mb && typeof mb.q === 'number' && typeof mb.r === 'number') {
      return { q: mb.q, r: mb.r };
    }
  }
  return { q: hauler.baseQ ?? 0, r: hauler.baseR ?? 0 };
}
