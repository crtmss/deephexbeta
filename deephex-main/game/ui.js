// File: game/ui.js

let hoveredHex = null;
let currentPath = [];

function updateTurnDisplay(turn) {
  const turnInfo = document.getElementById('turn-display');
  if (turnInfo) turnInfo.textContent = `Current Turn: ${turn}`;
}

function drawMap() {
  const state = getState();
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const hexSize = 16;
  for (let r = 0; r < state.map.length; r++) {
    for (let q = 0; q < state.map[r].length; q++) {
      const tile = state.map[r][q];
      drawTerrain(ctx, tile.q, tile.r, tile.type, hexSize); // ✅ uses q, r
    }
  }

  if (currentPath.length > 0) drawPath(ctx, currentPath, hexSize);
  if (state.selectedHex) drawSelectedHex(ctx, state.selectedHex.q, state.selectedHex.r, hexSize);
  if (hoveredHex && !state.selectedHex) drawHoveredHex(ctx, hoveredHex.q, hoveredHex.r, hexSize);

  state.units.forEach(unit => drawUnit(ctx, unit, hexSize));
}

function setHoveredHex(q, r) {
  hoveredHex = q !== null && r !== null ? { q, r } : null;
  drawMap();
}

function setCurrentPath(path) {
  currentPath = path;
  drawMap();
}

function drawPath(ctx, path, hexSize) {
  ctx.strokeStyle = 'yellow';
  ctx.lineWidth = 3;
  ctx.beginPath();

  path.forEach((hex, i) => {
    const { x, y } = hexToPixel(hex.q, hex.r, hexSize); // ✅ only q, r
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
}

function drawHoveredHex(ctx, q, r, size) {
  const { x, y } = hexToPixel(q, r, size);
  const corners = getHexCorners(x, y, size);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawSelectedHex(ctx, q, r, size) {
  const { x, y } = hexToPixel(q, r, size);
  const corners = getHexCorners(x, y, size);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.strokeStyle = 'orange';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function getHexCorners(cx, cy, size) {
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i - 30);
    corners.push({ x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) });
  }
  return corners;
}

function hexToPixel(q, r, size) {
  const SQRT3 = Math.sqrt(3);
  const canvas = document.getElementById('gameCanvas');
  const x = size * SQRT3 * (q + 0.5 * (r % 2));
  const y = size * 1.5 * r;
  const offsetX = canvas.width / 2 - ((25 * size * SQRT3) / 2);
  const offsetY = canvas.height / 2 - ((25 * size * 1.5) / 2);
  return { x: x + offsetX, y: y + offsetY };
}

function updateGameUI() {
  drawMap();
  updateTurnDisplay(getState().currentTurn);
}

function drawDebugInfo(q, r) {
  const state = getState();
  if (!state.debugEnabled) return;

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const tile = state.map?.[r]?.[q];
  if (!tile) return;

  const hexSize = 16;
  const { x, y } = hexToPixel(q, r, hexSize);
  let text = `(${q},${r}) ${tile.type}`;
  const unit = state.units.find(u => u.q === q && u.r === r);
  if (unit) text += ` | ${unit.owner}`;

  ctx.fillStyle = 'black';
  ctx.font = '12px monospace';
  ctx.fillText(text, x + 10, y - 10);
}

function toggleDebugMode() {
  const state = getState();
  const enabled = !state.debugEnabled;
  setState({ ...state, debugEnabled: enabled });
  console.log(enabled ? '✅ Entered debug mode' : '❌ Exited debug mode');
}

window.SQRT3 = SQRT3;
window.y = y;
window.tile = tile;
window.hexSize = hexSize;
window.drawSelectedHex = drawSelectedHex;
window.drawMap = drawMap;
window.canvas = canvas;
window.drawDebugInfo = drawDebugInfo;
window.x = x;
window.offsetX = offsetX;
window.getHexCorners = getHexCorners;
window.angle = angle;
window.r = r;
window.text = text;
window.drawPath = drawPath;
window.toggleDebugMode = toggleDebugMode;
window.q = q;
window.corners = corners;
window.currentPath = currentPath;
window.turnInfo = turnInfo;
window.offsetY = offsetY;
window.drawHoveredHex = drawHoveredHex;
window.state = state;
window.setHoveredHex = setHoveredHex;
window.updateGameUI = updateGameUI;
window.enabled = enabled;
window.unit = unit;
window.hexToPixel = hexToPixel;
window.hoveredHex = hoveredHex;
window.updateTurnDisplay = updateTurnDisplay;
window.ctx = ctx;
window.i = i;
window.setCurrentPath = setCurrentPath;