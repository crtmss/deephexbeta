// File: game/lobby.js

let roomId = null;
let playerId = null;

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function createLobby() {
  const room_code = generateRoomCode();
  const initialMap = generateMap(25, 25, room_code);

  const initialUnits = [
  { id: 'p1unit', owner: 'player1', x: 2, y: 2, hp: 5, mp: 8, ap: 1 },
  { id: 'p2unit', owner: 'player2', x: 22, y: 22, hp: 5, mp: 8, ap: 1 }
];

  const { data, error } = await supabase
    .from('lobbies')
    .insert([{
      room_code,
      player_1: true,
      player_2: false,
      map: initialMap,
      units: initialUnits,
      turn: 'player1'
    }])
    .select('id, room_code');

  if (error) {
    console.error('Lobby creation error:', error.message);
    alert('Failed to create lobby.');
    return;
  }

  roomId = data[0].id;
  playerId = 'player1';

  initialUnits.forEach(u => console.log(`Unit created: ${u.id} at (${u.x}, ${u.y})`));
  setState({
    playerId,
    roomId,
    map: initialMap,
    units: initialUnits,
    currentTurn: 'player1',
    player2Seen: false
  });

  listenToLobby(roomId);
  console.log(`Lobby created with code: ${room_code}`);
  const codeDisplay = document.getElementById('lobby-code');
  if (codeDisplay) codeDisplay.textContent = `Room Code: ${room_code}`;

  window.location.href = `https://crtmss.github.io/deephex/game.html?room=${room_code}&player=1`;
}

async function joinLobby(room_code) {
  const { data, error } = await supabase
    .from('lobbies')
    .select('*')
    .eq('room_code', room_code)
    .single();

  if (error || !data) {
    console.error('Lobby join error:', error.message);
    alert('Failed to join lobby.');
    return;
  }

  await supabase
    .from('lobbies')
    .update({ player_2: true })
    .eq('id', data.id);

  roomId = data.id;
  playerId = 'player2';

  const state = {
    map: data.map,
    units: data.units,
    turn: data.turn
  };

  const newUnit = {
    id: 'p2unit',
    owner: 'player2',
    x: 22,
    y: 22,
    hp: 5,
    mp: 8,
    ap: 1
  };

  state.units.push(newUnit);

  await supabase
    .from('lobbies')
    .update({ units: state.units })
    .eq('id', data.id);

  initialUnits.forEach(u => console.log(`Unit created: ${u.id} at (${u.x}, ${u.y})`));
  setState({
    playerId,
    roomId: data.id,
    map: state.map,
    units: state.units,
    currentTurn: state.turn,
    player2Seen: true
  });

  listenToLobby(data.id);
  console.log(`Joined lobby with code: ${room_code}`);
  window.location.href = `game.html?room=${room_code}&player=2`;
}

function listenToLobby(roomId) {
  const channel = supabase.channel(`lobby-${roomId}`);

  channel.on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'lobbies',
    filter: `id=eq.${roomId}`
  }, (payload) => {
    const { map, units, turn } = payload.new;
    const current = getState();

    const mapChanged = JSON.stringify(current.map) !== JSON.stringify(map);
    const unitsChanged = JSON.stringify(current.units) !== JSON.stringify(units);
    const turnChanged = current.currentTurn !== turn;

    const criticalDesync = !map || !units || units.length === 0;

    if (criticalDesync) {
      console.warn('[Realtime] Critical desync detected. Reloading page.');
      window.location.reload();
      return;
    }

    if (mapChanged || unitsChanged || turnChanged) {
      console.log('[Realtime] Detected important state change. Updating locally...');
      initialUnits.forEach(u => console.log(`Unit created: ${u.id} at (${u.x}, ${u.y})`));
  setState({
        ...current,
        map,
        units,
        currentTurn: turn
      });
      updateGameUI(); // ✅ Re-render map, units, sidebar etc
    } else {
      console.log('[Realtime] No major change detected.');
    }
  });

  channel.subscribe();
}

function initLobby() {
  const createBtn = document.getElementById('create-room');
  const joinBtn = document.getElementById('join-room');
  const codeInput = document.getElementById('room-code');

  if (createBtn && joinBtn && codeInput) {
    createBtn.addEventListener('click', () => createLobby());
    joinBtn.addEventListener('click', () => {
      const code = codeInput.value.trim();
      if (code) joinLobby(code);
    });
  }
}

export {
  createLobby,
  joinLobby,
  initLobby,
  roomId,
  playerId
};








window.initialMap = initialMap;
window.channel = channel;
window.code = code;
window.generateRoomCode = generateRoomCode;
window.createBtn = createBtn;
window.joinLobby = joinLobby;
window.criticalDesync = criticalDesync;
window.createLobby = createLobby;
window.codeInput = codeInput;
window.codeDisplay = codeDisplay;
window.current = current;
window.mapChanged = mapChanged;
window.listenToLobby = listenToLobby;
window.turnChanged = turnChanged;
window.initialUnits = initialUnits;
window.unitsChanged = unitsChanged;
window.state = state;
window.playerId = playerId;
window.initLobby = initLobby;
window.room_code = room_code;
window.joinBtn = joinBtn;
window.newUnit = newUnit;
window.roomId = roomId;