// ============================================================
//  Seeded PRNG
// ============================================================

function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277,
      h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0,
          (h2 ^ h1) >>> 0,
          (h3 ^ h1) >>> 0,
          (h4 ^ h1) >>> 0];
}

function sfc32(a,b,c,d){
  return function(){
    a>>>=0;b>>>=0;c>>>=0;d>>>=0;
    let t=(a+b)|0;
    a=b^(b>>>9);
    b=(c+(c<<3))|0;
    c=(c<<21|c>>>11);
    d=(d+1)|0;
    t=(t+d)|0;
    c=(c+t)|0;
    return (t>>>0)/4294967296;
  };
}

// ============================================================
//  Minimal terrain presets
// ============================================================

const terrainTypes = {
  water:    { movementCost:999, defense:0 },
  plains:   { movementCost:1, defense:0 },
  forest:   { movementCost:2, defense:1 },
  mountain: { movementCost:999, defense:3 },
  swamp:    { movementCost:3, defense:-1 }
};

// ============================================================
//  Helper functions
// ============================================================

const keyOf = (q,r)=>`${q},${r}`;
const clamp = (v,a,b)=>v<a?a:v>b?b:v;

function neighborsOddR(q,r){
  const even=(r%2===0);
  return even
  ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
  : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}

function inBounds(q,r,w,h){
  return q>=0 && q<w && r>=0 && r<h;
}

// ============================================================
//  Noise fields (simple value noise)
// ============================================================

function makeValueNoise(width,height,rand,scale){
  const g=[];
  for(let r=0;r<height;r++){
    g[r]=[];
    for(let q=0;q<width;q++){
      const nx=q/width, ny=r/height;
      const n = (
        rand()*0.7 +
        rand()*0.2*Math.sin((nx+ny*2)*scale*3.1) +
        rand()*0.1*Math.cos((ny-nx)*scale*2.7)
      );
      g[r][q]=n;
    }
  }
  return g;
}

// ============================================================
//  HexMap class wrapper
// ============================================================

export default class HexMap {
  constructor(width,height,seed){
    this.width=width;
    this.height=height;
    this.seed=String(seed??'defaultseed');
    this.map=[];
    this.worldMeta=null;
    this.generateMap();
  }

  generateMap(){
    const rngSeed=cyrb128(this.seed);
    const rand=sfc32(...rngSeed);
    const tiles=generateMap(this.height,this.width,this.seed,rand);
    this.map=tiles;
    this.worldMeta=tiles.__worldMeta||{};
  }

  getMap(){ return this.map; }
}

// ============================================================
//  CORE ISLAND GENERATOR (E1)
// ============================================================

function generateMap(height, width, seedStr, rand) {
  const tiles = [];

  // -------------------------------
  // Base grid init
  // -------------------------------
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      tiles.push({
        q, r,
        type: 'plains',
        elevation: 0,
        movementCost: terrainTypes.plains.movementCost,
        defense: terrainTypes.plains.defense,
        resource: null,

        hasForest: false,
        hasRuin: false,
        hasCrashSite: false,
        hasVehicle: false,
        hasRoad: false,
        feature: null
      });
    }
  }

  const byKey = new Map(tiles.map(t => [keyOf(t.q, t.r), t]));
  const inB = (q,r)=>inBounds(q,r,width,height);

  // ============================================================
  // 1. ISLAND SHAPE (radial + noise)
  // ============================================================

  const noise1 = makeValueNoise(width, height, rand, 1.0);
  const noise2 = makeValueNoise(width, height, rand, 2.3);

  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.hypot(cx, cy);

  for (const t of tiles) {
    const nx = t.q;
    const ny = t.r;
    const dist = Math.hypot(nx - cx, ny - cy) / maxDist; // 0 center → 1 edge

    // island mask, soft falloff
    let mask =
      (1 - dist) * 0.9 +
      (noise1[ny][nx] - 0.5) * 0.25 +
      (noise2[ny][nx] - 0.5) * 0.15;

    // clamp 0..1
    mask = clamp(mask, 0, 1);

    // convert to elevation bands
    if (mask < 0.28) {
      // WATER
      t.type = 'water';
      t.elevation = 0;
    } else if (mask < 0.40) {
      // COAST
      t.type = 'plains';
      t.elevation = 0;
    } else if (mask < 0.75) {
      // INLAND PLAINS / FOREST
      t.type = 'plains';
      t.elevation = 1;
    } else if (mask < 0.88) {
      // HILLS
      t.type = 'plains';
      t.elevation = 2;
    } else {
      // MOUNTAINS
      t.type = 'mountain';
      t.elevation = 3 + (rand() < 0.3 ? 1 : 0); // 3–4
    }
  }

  // Apply terrain presets
  for (const t of tiles) {
    if (t.type === 'water') {
      Object.assign(t, terrainTypes.water);
      continue;
    }
    if (t.type === 'mountain') {
      Object.assign(t, terrainTypes.mountain);
      continue;
    }

    Object.assign(t, terrainTypes.plains);
  }

  // ============================================================
  // 2. SECONDARY TERRAIN: swamps, sand, biome shifts
  // ============================================================

  for (const t of tiles) {
    if (t.type === 'plains') {
      if (t.elevation === 0 && rand() < 0.10) {
        t.type = 'sand';            // beaches / shallow coastlines
      }
      if (t.elevation === 1 && rand() < 0.06) {
        t.type = 'swamp';           // wetlands
        Object.assign(t, terrainTypes.swamp);
      }
    }
  }

  // ============================================================
  // 3. RIVER NETWORK (multiple rivers, deterministic)
  // ============================================================

  const mountains = tiles.filter(t => t.type === 'mountain');
  if (mountains.length > 0) {
    const riverSources = Math.min(3, 1 + Math.floor(rand() * 3));
    for (let i = 0; i < riverSources; i++) {
      const src = mountains[Math.floor(rand() * mountains.length)];
      carveRiverFrom(src);
    }
  }

  function carveRiverFrom(startTile) {
    let cur = startTile;
    const steps = 50 + Math.floor(rand() * 60);

    for (let i = 0; i < steps; i++) {
      const neigh = neighborsOddR(cur.q, cur.r)
        .map(([dq,dr]) => byKey.get(keyOf(cur.q + dq, cur.r + dr)))
        .filter(n => n && inB(n.q,n.r));

      if (!neigh.length) break;

      let best = null;
      let bestScore = Infinity;

      for (const n of neigh) {
        const elev = n.elevation ?? 0;
        const jitter = (rand() - 0.5) * 0.2;
        const score = elev + jitter;

        if (score < bestScore) {
          bestScore = score;
          best = n;
        }
      }

      if (!best) break;

      if (best.type !== 'water') {
        best.type = 'water';
        best.elevation = 0;
      }
      cur = best;
    }
  }

  // ============================================================
  // 4. FOREST BLOBS
  // ============================================================

  const forestCount = 8 + Math.floor(rand() * 12);
  const candidates = tiles.filter(t =>
    t.type !== 'water' && t.type !== 'mountain'
  );

  for (let i = 0; i < forestCount; i++) {
    if (!candidates.length) break;
    const center = candidates[Math.floor(rand() * candidates.length)];
    floodForest(center, 4 + Math.floor(rand() * 6));
  }

  function floodForest(center, size) {
    const queue = [center];
    const visited = new Set([keyOf(center.q, center.r)]);
    while (queue.length && size-- > 0) {
      const cur = queue.shift();
      if (!cur) break;

      cur.type = 'forest';
      cur.hasForest = true;
      Object.assign(cur, terrainTypes.forest);

      for (const [dq,dr] of neighborsOddR(cur.q, cur.r)) {
        const qq = cur.q + dq;
        const rr = cur.r + dr;
        if (!inB(qq,rr)) continue;
        const k = keyOf(qq,rr);
        if (visited.has(k)) continue;

        const n = byKey.get(k);
        if (!n || n.type === 'water' || n.type === 'mountain') continue;

        if (rand() < 0.5) {
          visited.add(k);
          queue.push(n);
        }
      }
    }
  }

  // ============================================================
  // 5. WORLD OBJECTS (POIs, ruins, vehicles, crash sites)
  // ============================================================

  const { objects, roads } = generateWorldObjectsForSeed(tiles, width, height, rand);
  tiles.__worldObjects = objects;
  tiles.__roads = roads;

  // ============================================================
  // 6. SUMMARY META
  // ============================================================

  const worldMeta = computeWorldSummaryFromTiles(tiles, width, height);
  Object.defineProperty(tiles, '__worldMeta', { value: worldMeta, enumerable: false });

  return tiles;
}

// ============================================================
//  WORLD OBJECTS (RUINS, CRASHSITES, VEHICLES) + ROADS
//  Fully seed-based and deterministic
// ============================================================

function generateWorldObjectsForSeed(tiles, width, height, rand) {
  const keyOf = (q, r) => `${q},${r}`;
  const byKey = new Map(tiles.map(t => [keyOf(t.q, t.r), t]));
  const inBounds = (q, r) => q >= 0 && q < width && r >= 0 && r < height;

  function neighborsOddR(q, r) {
    const even = (r % 2 === 0);
    return even
      ? [[+1,0],[0,-1],[-1,-1],[-1,0],[ -1,+1],[0,+1]]
      : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
  }

  const objects = [];
  const roads = [];

  // ------------------------------------------------------------
  // LAND POIs (ruins, crash sites, vehicle wrecks)
  // ------------------------------------------------------------

  const landTiles = tiles.filter(t =>
    t.type !== 'water' && t.type !== 'mountain'
  );

  function pickRandomLand() {
    if (!landTiles.length) return null;
    return landTiles[Math.floor(rand() * landTiles.length)];
  }

  const ruinCount = 3 + Math.floor(rand() * 4);      // 3–6
  const crashCount = 2 + Math.floor(rand() * 4);     // 2–5
  const vehicleCount = 1 + Math.floor(rand() * 3);   // 1–3

  // RUINS
  for (let i = 0; i < ruinCount; i++) {
    const tile = pickRandomLand();
    if (!tile) break;
    tile.hasRuin = true;
    objects.push({ type: 'ruin', q: tile.q, r: tile.r });
  }

  // CRASH SITES
  for (let i = 0; i < crashCount; i++) {
    const tile = pickRandomLand();
    if (!tile) break;
    tile.hasCrashSite = true;
    objects.push({ type: 'crash_site', q: tile.q, r: tile.r });
  }

  // VEHICLE WRECKS
  for (let i = 0; i < vehicleCount; i++) {
    const tile = pickRandomLand();
    if (!tile) break;
    tile.hasVehicle = true;
    objects.push({ type: 'vehicle_wreck', q: tile.q, r: tile.r });
  }

  // ------------------------------------------------------------
  // ROADS — seeded A* connectors + radial stubs
  // ------------------------------------------------------------

  // 1) Radial tree from a random land center
  if (landTiles.length > 0) {
    const c = landTiles[Math.floor(rand() * landTiles.length)];

    const queue = [c];
    const visited = new Set([keyOf(c.q, c.r)]);
    const maxRoads = 60 + Math.floor(rand() * 40);

    while (queue.length && roads.length < maxRoads) {
      const cur = queue.shift();
      if (!cur) break;

      roads.push({ q: cur.q, r: cur.r });
      cur.hasRoad = true;

      for (const [dq, dr] of neighborsOddR(cur.q, cur.r)) {
        const qq = cur.q + dq;
        const rr = cur.r + dr;
        if (!inBounds(qq, rr)) continue;

        const k = keyOf(qq, rr);
        if (visited.has(k)) continue;

        const nt = byKey.get(k);
        if (!nt || nt.type === 'water' || nt.type === 'mountain') continue;

        if (rand() < 0.45) { // branching
          visited.add(k);
          queue.push(nt);
        }
      }
    }
  }

  // 2) Connect POIs with short seeded A* roads
  const poiTiles = tiles.filter(t =>
    t.hasRuin || t.hasCrashSite || t.hasVehicle
  );

  function astar(start, goal) {
    const open = new Map();
    const closed = new Set();
    const kStart = keyOf(start.q, start.r);
    const kGoal = keyOf(goal.q, goal.r);

    open.set(kStart, { q: start.q, r: start.r, g: 0, f: 0, parent: null });

    const heur = (q,r)=>Math.abs(q-goal.q) + Math.abs(r-goal.r);

    while (open.size) {
      let cur = null;
      for (const n of open.values()) if (!cur || n.f < cur.f) cur = n;
      open.delete(keyOf(cur.q,cur.r));
      const ck = keyOf(cur.q,cur.r);

      if (ck === kGoal) {
        const path = [];
        let n = cur;
        while (n) {
          path.push(byKey.get(keyOf(n.q,n.r)));
          n = n.parent;
        }
        return path.reverse();
      }

      closed.add(ck);

      for (const [dq, dr] of neighborsOddR(cur.q, cur.r)) {
        const qq = cur.q + dq;
        const rr = cur.r + dr;
        if (!inBounds(qq, rr)) continue;

        const k = keyOf(qq, rr);
        if (closed.has(k)) continue;

        const t = byKey.get(k);
        if (!t || t.type === 'water' || t.type === 'mountain') continue;

        const g = cur.g + 1;
        const f = g + heur(qq,rr);

        const ex = open.get(k);
        if (!ex || g < ex.g) {
          open.set(k, { q: qq, r: rr, g, f, parent: cur });
        }
      }
    }

    return null;
  }

  for (let i = 0; i < poiTiles.length - 1; i++) {
    const a = poiTiles[i];
    const b = poiTiles[i + 1];
    const path = astar(a, b);
    if (!path) continue;

    for (const t of path) {
      if (t.type !== 'water' && t.type !== 'mountain') {
        t.hasRoad = true;
        roads.push({ q: t.q, r: t.r });
      }
    }
  }

  return { objects, roads };
}
