// File: game/units.js

import {
  updateGameUI,
  setHoveredHex,
  drawDebugInfo,
  setCurrentPath
} from './ui.js';
function getHexAtMouse(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const size = 16;
  const SQRT3 = Math.sqrt(3);
  const offsetX = canvas.width / 2 - ((25 * size * SQRT3) / 2);
  const offsetY = canvas.height / 2 - ((25 * size * 1.5) / 2);

  const adjustedX = x - offsetX;
  const adjustedY = y - offsetY;

  const r = Math.round(adjustedY / (size * 1.5));
  const q = Math.round((adjustedX / (SQRT3 * size)) - 0.5 * (r % 2));

  return { q, r };
}

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;

  canvas.addEventListener('click', (e) => {
    const { q, r } = getHexAtMouse(e, canvas);
    const state = getState();
    if (!state.map?.[r]?.[q]) return;

    const selectedUnit = state.units.find(u => u.id === state.selectedUnitId);

    if (selectedUnit && state.currentTurn === state.playerId) {
      state.selectedHex = { col: q, row: r };  // UI still uses col/row
      const path = calculatePath(selectedUnit.q, selectedUnit.r, q, r, state.map);
      setCurrentPath(path || []);
      setHoveredHex(null);
      setState(state);
      updateGameUI();
    } else {
      const clickedUnit = state.units.find(u => u.q === q && u.r === r && u.owner === state.playerId);
      if (clickedUnit) {
        setState({ ...state, selectedUnitId: clickedUnit.id });
        updateGameUI();
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const { q, r } = getHexAtMouse(e, canvas);
    const state = getState();
    if (!state.map?.[r]?.[q]) return;

    if (!state.selectedHex) {
      setHoveredHex(q, r); // UI still expects col/row
    }

    if (state.debugEnabled) drawDebugInfo(q, r);
  });

  document.getElementById('selectUnitBtn')?.addEventListener('click', () => {
    const state = getState();
    if (state.currentTurn === state.playerId) {
      const unit = state.units.find(u => u.owner === state.playerId);
      if (unit) {
        setState({ ...state, selectedUnitId: unit.id });
        updateGameUI();
      }
    } else {
      alert('It is not your turn.');
    }
  });

  document.getElementById('moveToHexBtn')?.addEventListener('click', () => {
    const state = getState();
    const target = state.selectedHex;
    if (!target) return;

    const unit = state.units.find(u => u.id === state.selectedUnitId && u.owner === state.playerId);
    if (!unit) return;

    const path = calculatePath(unit.q, unit.r, target.col, target.row, state.map);
    if (!path || path.length < 2) return;

    const next = path[1];
    unit.q = next.q;
    unit.r = next.r;

    setCurrentPath([]);
    setState(state);
    pushStateToSupabase();
    updateGameUI();
  });
});

function performAction(unitId, targetQ, targetR) {
  const state = getState();
  const unit = state.units.find(u => u.id === unitId && u.owner === state.playerId);
  if (!unit || state.currentTurn !== state.playerId || unit.ap < 1) return;

  const dq = targetQ - unit.q;
  const dr = targetR - unit.r;
  const dz = -dq - dr;
  const distance = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dz));

  if (distance <= 3 && !isTileBlocked(targetQ, targetR, state.map)) {
    unit.ap -= 1;
    const targetUnit = state.units.find(u => u.q === targetQ && u.r === targetR);
    if (targetUnit) {
      targetUnit.hp -= 1;
      if (targetUnit.hp <= 0) {
        state.units = state.units.filter(u => u.id !== targetUnit.id);
      }
    }
    setState(state);
    pushStateToSupabase();
    updateGameUI();
  }
}

function endTurn() {
  const state = getState();
  state.currentTurn = state.currentTurn === 'player1' ? 'player2' : 'player1';
  state.units.forEach(unit => {
    if (unit.owner === state.currentTurn) {
      unit.mp = 10;
      unit.ap = 1;
    }
  });
  state.selectedHex = null;
  setCurrentPath([]);
  setState(state);
  pushStateToSupabase();
  updateGameUI();
}

window.adjustedY = adjustedY;
window.clickedUnit = clickedUnit;
window.y = y;
window.SQRT3 = SQRT3;
window.dq = dq;
window.getHexAtMouse = getHexAtMouse;
window.dr = dr;
window.canvas = canvas;
window.path = path;
window.x = x;
window.endTurn = endTurn;
window.size = size;
window.offsetX = offsetX;
window.performAction = performAction;
window.target = target;
window.r = r;
window.q = q;
window.distance = distance;
window.next = next;
window.rect = rect;
window.offsetY = offsetY;
window.adjustedX = adjustedX;
window.state = state;
window.unit = unit;
window.dz = dz;
window.targetUnit = targetUnit;
window.selectedUnit = selectedUnit;