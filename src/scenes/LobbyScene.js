// deephexbeta/src/scenes/LobbyScene.js
import { createLobby, joinLobby } from '../net/LobbyManager.js';
import { supabase } from '../net/SupabaseClient.js';
import HexMap from '../engine/HexMap.js';
import { getColorForTerrain } from './WorldSceneMap.js';

/* ---------- small helpers used only to label the preview ---------- */
const keyOf = (q, r) => `${q},${r}`;
const inBounds = (q, r, w, h) => q >= 0 && q < w && r >= 0 && r < h;
function neighborsOddR(q, r) {
  const even = (r % 2 === 0);
  return even
    ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
    : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];
}
function classifyBiomeFromTiles(tiles) {
  const land = tiles.filter(t => t.type !== 'water');
  const total = land.length || 1;
  const cnt = tiles.reduce((a, t) => (a[t.type] = (a[t.type] || 0) + 1, a), {});
  const pct = n => (cnt[n] || 0) / total;
  const icy  = pct('ice') + pct('snow');
  const ash  = pct('volcano_ash');
  const sand = pct('sand');
  const swampy = pct('swamp') + pct('mud');
  if (icy >= 0.50) return 'Icy Biome';
  if (ash >= 0.50) return 'Volcanic Biome';
  if (sand >= 0.50) return 'Desert Biome';
  if (swampy >= 0.45 && icy < 0.05 && ash < 0.05) return 'Swamp Biome';
  return 'Temperate Biome';
}
function classifyGeographyFromTiles(tiles, width, height) {
  const byKey = new Map(tiles.map(t => [keyOf(t.q, t.r), t]));
  const seen = new Set();
  let comps = 0;
  for (const t of tiles) {
    if (t.type === 'water') continue;
    const k = keyOf(t.q, t.r);
    if (seen.has(k)) continue;
    comps++;
    const qd = [t]; seen.add(k);
    while (qd.length) {
      const cur = qd.pop();
      for (const [dq, dr] of neighborsOddR(cur.q, cur.r)) {
        const nq = cur.q + dq, nr = cur.r + dr, nk = keyOf(nq, nr);
        if (!inBounds(nq, nr, width, height) || seen.has(nk)) continue;
        const nt = byKey.get(nk);
        if (!nt || nt.type === 'water') continue;
        seen.add(nk); qd.push(nt);
      }
    }
  }
  if (comps >= 2) return 'Multiple Islands';

  // inner-water heuristic for lagoon/lake
  const innerQ0 = Math.floor(width * 0.2),  innerQ1 = Math.ceil(width * 0.8);
  const innerR0 = Math.floor(height * 0.2), innerR1 = Math.ceil(height * 0.8);
  let innerWater = 0, innerTot = 0;
  for (let r = innerR0; r < innerR1; r++) for (let q = innerQ0; q < innerQ1; q++) {
    const t = byKey.get(keyOf(q, r)); if (!t) continue;
    innerTot++; if (t.type === 'water') innerWater++;
  }
  const innerRatio = innerTot ? innerWater / innerTot : 0;
  if (innerRatio >= 0.12) return innerRatio >= 0.18 ? 'Big Lagoon' : 'Central Lake';

  // riveriness
  let riverEdges = 0; let landCount = 0;
  for (const t of tiles) {
    if (t.type === 'water') continue;
    landCount++;
    for (const [dq, dr] of neighborsOddR(t.q, t.r)) {
      const n = byKey.get(keyOf(t.q + dq, t.r + dr));
      if (n && n.type === 'water') riverEdges++;
    }
  }
  if ((riverEdges / Math.max(1, landCount)) >= 1.2) return 'Scattered Terrain';

  // diagonal check (simple PCA)
  const land = tiles.filter(t => t.type !== 'water');
  const cx = land.reduce((s, t) => s + t.q, 0) / Math.max(1, land.length);
  const cy = land.reduce((s, t) => s + t.r, 0) / Math.max(1, land.length);
  let Sxx=0,Syy=0,Sxy=0;
  for (const t of land) { const dx=t.q-cx, dy=t.r-cy; Sxx+=dx*dx; Syy+=dy*dy; Sxy+=dx*dy; }
  const tr=Sxx+Syy, det=Sxx*Syy-Sxy*Sxy, disc=Math.max(0,tr*tr-4*det);
  const lambda1=(tr+Math.sqrt(disc))/2, lambda2=(tr-Math.sqrt(disc))/2;
  const ratio = lambda2>0 ? lambda1/lambda2 : 99;
  const angle = Math.abs(0.5 * Math.atan2(2*Sxy, Sxx-Syy) * 180/Math.PI);
  if (ratio>=1.6 && angle>=20 && angle<=70) return 'Diagonal Island';

  return 'Small Bays';
}

/* -------------------------------- Lobby Scene -------------------------------- */

export default class LobbyScene extends Phaser.Scene {
  constructor() { super('LobbyScene'); }

  async create() {
    this.add.text(500, 60, 'DeepHex Multiplayer Lobby', { fontSize: '28px', fill: '#ffffff' });

    try {
      const { error: pingError } = await supabase.from('lobbies').select('id').limit(1);
      if (pingError) console.error('[Supabase ERROR] Cannot connect:', pingError.message);
      else console.log('[Supabase OK] Connection active.');
    } catch (err) { console.error('[Supabase EXCEPTION] Connection check failed:', err.message); }

    // Inputs
    this.add.text(460, 130, 'Your Name:', { fontSize: '18px', fill: '#ffffff' });
    const nameInput = this.add.dom(640, 160, 'input'); nameInput.setOrigin(0.5); nameInput.setDepth(1200);
    nameInput.node.placeholder = 'Your name'; nameInput.node.maxLength = 16;

    this.add.text(400, 220, 'Map Seed (6 digits):', { fontSize: '18px', fill: '#ffffff' });
    const codeInput = this.add.dom(640, 250, 'input'); codeInput.setOrigin(0.5); codeInput.setDepth(1200);
    codeInput.node.placeholder = '000000'; codeInput.node.maxLength = 6;
    codeInput.node.style.textAlign = 'center'; codeInput.node.style.width = '110px';

    // 🎲 Random Seed
    const randomBtn = this.add.dom(640, 290, 'button', {
      backgroundColor: '#555', color: '#fff', fontSize: '14px',
      padding: '8px 14px', border: '1px solid #888', borderRadius: '6px', cursor: 'pointer'
    }, '🎲 Random Seed');
    randomBtn.setOrigin(0.5); randomBtn.setDepth(1250); randomBtn.setScrollFactor(0);

    // Preview title + canvas
    this.add.text(870, 130, 'Map Preview', { fontSize: '18px', fill: '#ffffff' });
    this.previewSize = 80;
    this.previewContainer = this.add.container(900, 200);
    this.previewGraphics = this.add.graphics();
    this.previewContainer.add(this.previewGraphics);

    // Labels (will be computed from the generated map)
    this.geographyText = this.add.text(820, 380, '', { fontSize: '18px', fill: '#aadfff' });
    this.biomeText     = this.add.text(820, 410, '', { fontSize: '18px', fill: '#aadfff' });

    // Keep the latest generated map for the preview (so order is explicit)
    this.previewWidth  = 25;
    this.previewHeight = 25;
    this.currentHexMap = null;     // <- map object created first
    this.currentTiles  = null;     // <- flat tiles array

    // Seed init + events
    const firstSeed = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    codeInput.node.value = firstSeed;

    const regenerateAndPreview = (seed) => {
      // (1) generate map
      this.currentHexMap = new HexMap(this.previewWidth, this.previewHeight, seed);
      this.currentTiles  = this.currentHexMap.getMap();

      // (2) render preview from the already-generated tiles
      this.drawPreviewFromTiles(this.currentTiles);

      // (3) classify from those tiles (so labels == what you see)
      const geo  = classifyGeographyFromTiles(this.currentTiles, this.previewWidth, this.previewHeight);
      const biome = classifyBiomeFromTiles(this.currentTiles);
      this.geographyText.setText(`🌍 Geography: ${geo}`);
      this.biomeText.setText(`🌿 Biome: ${biome}`);
    };

    codeInput.node.addEventListener('input', () => {
      let v = codeInput.node.value.replace(/\D/g, '');
      if (v.length > 6) v = v.slice(0, 6);
      codeInput.node.value = v;
      regenerateAndPreview(v.padStart(6, '0'));
    });
    codeInput.node.addEventListener('blur', () => {
      let v = codeInput.node.value.trim();
      if (!v) v = '000000';
      codeInput.node.value = v.padStart(6, '0');
      regenerateAndPreview(codeInput.node.value);
    });
    randomBtn.addListener('click');
    randomBtn.on('click', () => {
      const seed = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
      codeInput.node.value = seed;
      regenerateAndPreview(seed);
    });

    // first run
    regenerateAndPreview(firstSeed);

    // Host / Join
    const hostBtn = this.add.dom(540, 330, 'button', {
      backgroundColor: '#006400', color: '#fff', fontSize: '18px',
      padding: '10px 20px', border: 'none', borderRadius: '6px', cursor: 'pointer'
    }, 'Host Game').setDepth(1200);

    const joinBtn = this.add.dom(720, 330, 'button', {
      backgroundColor: '#1E90FF', color: '#fff', fontSize: '18px',
      padding: '10px 20px', border: 'none', borderRadius: '6px', cursor: 'pointer'
    }, 'Join Game').setDepth(1200);

    hostBtn.addListener('click');
    hostBtn.on('click', async () => {
      const name = nameInput.node.value.trim();
      const code = codeInput.node.value.trim().padStart(6, '0');
      if (!name || !/^\d{6}$/.test(code)) { alert('Enter your name and a 6-digit numeric seed.'); return; }
      const { error } = await createLobby(name, code);
      if (error) { console.error('[Supabase ERROR] Create lobby:', error.message); alert('Failed to create lobby.'); return; }
      this.scene.start('WorldScene', { playerName: name, roomCode: code, isHost: true });
    });

    joinBtn.addListener('click');
    joinBtn.on('click', async () => {
      const name = nameInput.node.value.trim();
      const code = codeInput.node.value.trim().padStart(6, '0');
      if (!name || !/^\d{6}$/.test(code)) { alert('Enter your name and a 6-digit numeric seed.'); return; }
      const { error } = await joinLobby(name, code);
      if (error) { console.error('[Supabase ERROR] Join lobby:', error.message); alert('Failed to join lobby.'); return; }
      this.scene.start('WorldScene', { playerName: name, roomCode: code, isHost: false });
    });
  }

  // --- draw preview strictly from an already-generated tiles array ---
  drawPreviewFromTiles(tiles) {
    this.previewGraphics.clear();
    const size = 6;

    const hexToPixel = (q, r, s) => {
      const x = s * Math.sqrt(3) * (q + 0.5 * (r & 1));
      const y = s * 1.5 * r;
      return { x, y };
    };

    const gridW = size * Math.sqrt(3) * (this.previewWidth + 0.5);
    const gridH = size * 1.5 * (this.previewHeight + 0.5);
    const offsetX = -gridW * 0.45;
    const offsetY = -gridH * 0.38;

    for (const t of tiles) {
      const { x, y } = hexToPixel(t.q, t.r, size);
      const color = getColorForTerrain ? getColorForTerrain(t.type, t.elevation) : 0x999999;
      this.drawHex(this.previewGraphics, x + offsetX, y + offsetY, size, color);
    }
  }

  drawHex(g, x, y, size, color) {
    const corners = [];
    for (let i = 0; i < 6; i++) {
      const a = Phaser.Math.DegToRad(60 * i - 30);
      corners.push({ x: x + size * Math.cos(a), y: y + size * Math.sin(a) });
    }
    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 6; i++) g.lineTo(corners[i].x, corners[i].y);
    g.closePath();
    g.fillPath();
  }
}
