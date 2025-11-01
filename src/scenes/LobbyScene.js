// deephexbeta/src/scenes/LobbyScene.js
import { createLobby, joinLobby } from '../net/LobbyManager.js';
import { supabase } from '../net/SupabaseClient.js';
import HexMap from '../engine/HexMap.js';
import { getColorForTerrain } from './WorldSceneMap.js';

/* -------------------------------------------
   Lightweight analysis helpers (no RNG guess)
-------------------------------------------- */
function keyOf(q, r) { return `${q},${r}`; }
function analyzeMapForSummary(mapData, W = 25, H = 25) {
  const byKey = new Map(mapData.map(t => [keyOf(t.q, t.r), t]));
  const land = mapData.filter(t => t.type !== 'water');
  const water = mapData.length - land.length;
  const landRatio = land.length / mapData.length;

  const count = tName => land.filter(t => t.type === tName).length;
  const nSnow  = count('snow');
  const nIce   = count('ice');
  const nAsh   = count('volcano_ash');
  const nSand  = count('sand');
  const nMud   = count('mud');
  const nSwamp = count('swamp');

  let biome = 'Temperate Biome';
  if ((nSnow + nIce) / Math.max(1, land.length) > 0.55) biome = 'Icy Biome';
  else if (nAsh / Math.max(1, land.length) > 0.45)      biome = 'Volcanic Biome';
  else if (nSand / Math.max(1, land.length) > 0.45)     biome = 'Desert Biome';
  else if ((nMud + nSwamp) / Math.max(1, land.length) > 0.50) biome = 'Swamp Biome';

  const neighborsOddR = (q, r) =>
    (r % 2 === 0)
      ? [[+1,0],[0,-1],[-1,-1],[-1,0],[-1,+1],[0,+1]]
      : [[+1,0],[+1,-1],[0,-1],[-1,0],[0,+1],[+1,+1]];

  const visited = new Set();
  const compSizes = [];
  for (const t of land) {
    const k = keyOf(t.q, t.r);
    if (visited.has(k)) continue;
    let size = 0;
    const q = [t];
    visited.add(k);
    while (q.length) {
      const cur = q.shift();
      size++;
      for (const [dq, dr] of neighborsOddR(cur.q, cur.r)) {
        const nk = keyOf(cur.q + dq, cur.r + dr);
        if (visited.has(nk)) continue;
        const nt = byKey.get(nk);
        if (nt && nt.type !== 'water') {
          visited.add(nk);
          q.push(nt);
        }
      }
    }
    compSizes.push(size);
  }
  compSizes.sort((a, b) => b - a);
  const components = compSizes.length;

  const minQ = Math.floor(W * 0.3), maxQ = Math.ceil(W * 0.7);
  const minR = Math.floor(H * 0.3), maxR = Math.ceil(H * 0.7);
  let centralWater = 0, centralTotal = 0;
  for (let r = minR; r < maxR; r++) {
    for (let q = minQ; q < maxQ; q++) {
      const t = byKey.get(keyOf(q, r));
      if (!t) continue;
      centralTotal++;
      if (t.type === 'water') centralWater++;
    }
  }
  const centralWaterRatio = centralTotal ? centralWater / centralTotal : 0;

  let shoreline = 0;
  for (const t of land) {
    for (const [dq, dr] of neighborsOddR(t.q, t.r)) {
      const n = byKey.get(keyOf(t.q + dq, t.r + dr));
      if (!n || n.type === 'water') shoreline++;
    }
  }
  const shorePerLand = shoreline / Math.max(1, land.length);

  let sx = 0, sy = 0;
  for (const t of land) { sx += t.q; sy += t.r; }
  const mx = sx / Math.max(1, land.length);
  const my = sy / Math.max(1, land.length);
  let sxx = 0, syy = 0, sxy = 0;
  for (const t of land) {
    const dx = t.q - mx, dy = t.r - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const diagness = Math.abs(sxy) / Math.max(1, Math.sqrt(sxx * syy));

  let geography = 'Diagonal Island';
  if (components >= 3) {
    geography = 'Multiple Islands';
  } else if (centralWaterRatio > 0.25 && landRatio > 0.4) {
    geography = 'Central Lake';
  } else if (shorePerLand > 1.8) {
    geography = 'Small Bays';
  } else if (diagness > 0.55) {
    geography = 'Diagonal Island';
  } else {
    const waterTouchingLand = mapData
      .filter(t => t.type === 'water')
      .filter(t => {
        for (const [dq, dr] of neighborsOddR(t.q, t.r)) {
          const n = byKey.get(keyOf(t.q + dq, t.r + dr));
          if (n && n.type !== 'water') return true;
        }
        return false;
      }).length;
    const water = mapData.length - land.length;
    const channeled = water ? (waterTouchingLand / water > 0.7) : false;
    geography = channeled ? 'Scattered Terrain' : 'Big Lagoon';
  }

  return { geography, biome };
}

/* -------------------------------------------
   Lobby Scene
-------------------------------------------- */
export default class LobbyScene extends Phaser.Scene {
  constructor() { super('LobbyScene'); }

  async create() {
    this.add.text(500, 60, 'DeepHex Multiplayer Lobby', { fontSize: '28px', fill: '#ffffff' });

    try {
      const { error: pingError } = await supabase.from('lobbies').select('id').limit(1);
      if (pingError) console.error('[Supabase ERROR] Cannot connect:', pingError.message);
      else console.log('[Supabase OK] Connection active.');
    } catch (err) { console.error('[Supabase EXCEPTION] Connection check failed:', err.message); }

    // Name
    this.add.text(460, 130, 'Your Name:', { fontSize: '18px', fill: '#ffffff' });
    const nameInput = this.add.dom(640, 160, 'input').setOrigin(0.5).setDepth(1200);
    nameInput.node.placeholder = 'Your name'; nameInput.node.maxLength = 16;

    // Seed
    this.add.text(400, 220, 'Map Seed (6 digits):', { fontSize: '18px', fill: '#ffffff' });
    const codeInput = this.add.dom(640, 250, 'input').setOrigin(0.5).setDepth(1200);
    codeInput.node.placeholder = '000000';
    codeInput.node.maxLength = 6;
    codeInput.node.style.textAlign = 'center';
    codeInput.node.style.width = '110px';

    // 🎲 Random seed button
    const randomBtn = this.add.dom(640, 290, 'button', {
      backgroundColor: '#555', color: '#fff', fontSize: '14px',
      padding: '8px 14px', border: '1px solid #888', borderRadius: '6px', cursor: 'pointer'
    }, '🎲 Random Seed').setOrigin(0.5).setDepth(1250).setScrollFactor(0);

    const randomSeed = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    codeInput.node.value = randomSeed;

    // Preview area
    this.add.text(870, 130, 'Map Preview', { fontSize: '18px', fill: '#ffffff' });
    this.previewSize = 80;
    this.previewContainer = this.add.container(900, 200);
    this.previewGraphics = this.add.graphics();
    this.previewContainer.add(this.previewGraphics);

    // Labels
    this.geographyText = this.add.text(820, 380, '', { fontSize: '18px', fill: '#aadfff' });
    this.biomeText     = this.add.text(820, 410, '', { fontSize: '18px', fill: '#aadfff' });

    // Input guards + preview update
    codeInput.node.addEventListener('input', () => {
      let v = codeInput.node.value.replace(/\D/g, '');
      if (v.length > 6) v = v.slice(0, 6);
      codeInput.node.value = v;
      this.updatePreview(v.padStart(6, '0'));
    });
    codeInput.node.addEventListener('blur', () => {
      let v = codeInput.node.value.trim();
      if (!v) v = '000000';
      codeInput.node.value = v.padStart(6, '0');
      this.updatePreview(codeInput.node.value);
    });

    randomBtn.addListener('click');
    randomBtn.on('click', () => {
      const newSeed = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
      codeInput.node.value = newSeed;
      this.updatePreview(newSeed);
    });

    // First preview
    this.updatePreview(randomSeed);

    // Host
    const hostBtn = this.add.dom(540, 330, 'button', {
      backgroundColor: '#006400', color: '#fff', fontSize: '18px',
      padding: '10px 20px', border: 'none', borderRadius: '6px', cursor: 'pointer'
    }, 'Host Game').setDepth(1200);

    // Join
    const joinBtn = this.add.dom(720, 330, 'button', {
      backgroundColor: '#1E90FF', color: '#fff', fontSize: '18px',
      padding: '10px 20px', border: 'none', borderRadius: '6px', cursor: 'pointer'
    }, 'Join Game').setDepth(1200);

    // Host logic (force-sync seed into lobby state)
    hostBtn.addListener('click');
    hostBtn.on('click', async () => {
      const name = nameInput.node.value.trim();
      const code = codeInput.node.value.trim().padStart(6, '0');
      if (!name || !/^\d{6}$/.test(code)) { alert('Enter your name and a 6-digit numeric seed.'); return; }

      const { data, error } = await createLobby(name, code);
      if (error) { console.error('[Supabase ERROR] Failed to create lobby:', error.message); alert('Failed to create lobby. Check console.'); return; }

      // 🔒 Ensure the seed in the lobby state matches what you previewed
      try {
        const { data: row, error: readErr } = await supabase
          .from('lobbies').select('state').eq('room_code', code).single();
        if (!readErr && row?.state) {
          const state = row.state || {};
          if (state.seed !== code) {
            const newState = { ...state, seed: code };
            const { error: updErr } = await supabase
              .from('lobbies').update({ state: newState }).eq('room_code', code);
            if (updErr) console.warn('[Supabase] Seed sync update failed:', updErr.message);
          }
        }
      } catch (e) {
        console.warn('[Seed sync] exception, continuing:', e?.message);
      }

      this.scene.start('WorldScene', { playerName: name, roomCode: code, isHost: true });
    });

    // Join logic (no seed mutation here; relies on host’s stored seed)
    joinBtn.addListener('click');
    joinBtn.on('click', async () => {
      const name = nameInput.node.value.trim();
      const code = codeInput.node.value.trim().padStart(6, '0');
      if (!name || !/^\d{6}$/.test(code)) { alert('Enter your name and a 6-digit numeric seed.'); return; }

      const { data, error } = await joinLobby(name, code);
      if (error) { console.error('[Supabase ERROR] Failed to join lobby:', error.message); alert('Failed to join lobby. Check console.'); return; }

      this.scene.start('WorldScene', { playerName: name, roomCode: code, isHost: false });
    });
  }

  // --- Preview drawing + true summary from the generated map
  updatePreview(seedString) {
    if (!this.previewGraphics) return;
    this.previewGraphics.clear();

    const hexMap = new HexMap(25, 25, seedString);
    const mapData = hexMap.getMap();

    // water background to avoid black gaps
    const w = this.previewSize;
    this.previewGraphics.fillStyle(0x7CC4FF, 1);
    this.previewGraphics.fillRect(-w - 10, -w - 10, w * 2 + 60, w * 2 + 60);

    const size = 6;
    const hexToPixel = (q, r, s) => {
      const x = s * Math.sqrt(3) * (q + 0.5 * (r & 1));
      const y = s * 1.5 * r;
      return { x, y };
    };

    const offsetX = -w;
    const offsetY = -w / 1.2;

    for (const tile of mapData) {
      const { q, r, type, elevation } = tile;
      const { x, y } = hexToPixel(q, r, size);
      const color = getColorForTerrain ? getColorForTerrain(type, elevation) : 0x999999;

      const corners = [];
      for (let i = 0; i < 6; i++) {
        const ang = Phaser.Math.DegToRad(60 * i - 30);
        corners.push({ x: x + size * Math.cos(ang), y: y + size * Math.sin(ang) });
      }
      this.previewGraphics.fillStyle(color, 1);
      this.previewGraphics.beginPath();
      this.previewGraphics.moveTo(corners[0].x + offsetX, corners[0].y + offsetY);
      for (let i = 1; i < 6; i++) this.previewGraphics.lineTo(corners[i].x + offsetX, corners[i].y + offsetY);
      this.previewGraphics.closePath();
      this.previewGraphics.fillPath();
    }

    const { geography, biome } = analyzeMapForSummary(mapData, 25, 25);
    this.geographyText.setText(`🌍 Geography: ${geography}`);
    this.biomeText.setText(`🌿 Biome: ${biome}`);
  }
}
