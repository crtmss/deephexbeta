// File: game/game-state.js

let state = {
  debugEnabled: false,
  units: [],
  currentTurn: null,
  map: [],
  playerId: null,
  roomId: null,
  hasRendered: false,
  player2Seen: false,
  selectedUnitId: null, // ✅ Track selected unit
  selectedHex: null     // ✅ Track selected hex for movement
};

function setState(newState) {
  const wasMapEmpty = state.map.length === 0;
  state = { ...state, ...newState };

  if (wasMapEmpty && state.map.length > 0 && !state.hasRendered) {
    renderIfMapExists();
    state.hasRendered = true;
  }

  const canvas = document.getElementById('gameCanvas');
  if (canvas && state.map.length > 0) {
    drawMap();
  }
}

function updateState(newState) {
  setState(newState);
}

function getState() {
  return state;
}

function renderIfMapExists() {
  const canvas = document.getElementById('gameCanvas');
  if (canvas && state.map.length > 0) {
    canvas.style.display = 'block';
    drawMap();
  }
}

window.canvas = canvas;
window.getState = getState;
window.state = state;
window.wasMapEmpty = wasMapEmpty;
window.setState = setState;
window.updateState = updateState;
window.renderIfMapExists = renderIfMapExists;