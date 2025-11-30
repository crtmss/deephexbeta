// src/net/LobbyManager.js
import { supabase } from './SupabaseClient.js';

const MAX_PLAYERS = 4;
const PLAYER_COLS = ['player_1', 'player_2', 'player_3', 'player_4'];

/**
 * Create initial game state when the host creates a lobby.
 */
function createInitialState(roomCode, hostName) {
  return {
    seed: roomCode,          // used for map generation
    players: [hostName],     // list of player names
    currentTurn: hostName,   // whose turn it is
    turnNumber: 1,           // start at turn 1
  };
}

/**
 * Make sure `state` always has a sane shape.
 */
function normalizeState(rawState, roomCode) {
  const state = rawState || {};
  const players = Array.isArray(state.players) ? [...state.players] : [];

  return {
    seed: state.seed || roomCode,
    players,
    currentTurn: state.currentTurn || (players[0] ?? null),
    turnNumber:
      typeof state.turnNumber === 'number' ? state.turnNumber : 1,
  };
}

/**
 * Creates a lobby with a 6-digit numeric code.
 * The code itself is also used as the world seed.
 */
export async function createLobby(playerName, roomCode) {
  const state = createInitialState(roomCode, playerName);

  console.log('[Supabase] Creating lobby with:', {
    roomCode,
    playerName,
    state,
  });

  const { data, error } = await supabase
    .from('lobbies')
    .insert([
      {
        room_code: roomCode,
        player_1: playerName,
        state,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error('[Supabase ERROR] Failed to create lobby:', error.message);
  }

  return { data, error };
}

/**
 * Joins an existing lobby (up to 4 players).
 */
export async function joinLobby(playerName, roomCode) {
  const { data: lobbyRow, error: fetchError } = await supabase
    .from('lobbies')
    .select('id, room_code, state, player_1, player_2, player_3, player_4')
    .eq('room_code', roomCode)
    .single();

  if (fetchError || !lobbyRow) {
    console.error('[Supabase ERROR] Failed to fetch lobby for join:', fetchError);
    return { data: null, error: fetchError || new Error('Lobby not found') };
  }

  let state = normalizeState(lobbyRow.state, roomCode);
  const players = state.players;

  // Already in lobby: no-op
  if (players.includes(playerName)) {
    console.log('[Supabase] Player already in lobby, nothing to update:', {
      roomCode,
      playerName,
      players,
    });
    return { data: { ...lobbyRow, state }, error: null };
  }

  // Lobby full (4 players)
  if (players.length >= MAX_PLAYERS) {
    const err = new Error('Lobby is full');
    console.warn('[Supabase] Join rejected, lobby is full:', {
      roomCode,
      players,
    });
    return { data: null, error: err };
  }

  // Add to players list in state
  players.push(playerName);
  state = {
    ...state,
    players,
    currentTurn: state.currentTurn || players[0],
  };

  // Decide which player_N column to fill
  let slotToFill = -1;
  for (let i = 0; i < PLAYER_COLS.length; i++) {
    if (!lobbyRow[PLAYER_COLS[i]]) {
      slotToFill = i;
      break;
    }
  }

  // If all columns are non-empty but players <4, just map by index
  if (slotToFill === -1 && players.length <= MAX_PLAYERS) {
    slotToFill = players.length - 1; // 0-based index
  }

  const updatePatch = { state };
  if (slotToFill >= 0 && slotToFill < PLAYER_COLS.length) {
    updatePatch[PLAYER_COLS[slotToFill]] = playerName;
  }

  console.log('[Supabase] Joining lobby with:', {
    roomCode,
    playerName,
    state,
    slotToFill,
  });

  const { data, error } = await supabase
    .from('lobbies')
    .update(updatePatch)
    .eq('room_code', roomCode)
    .select('id, room_code, state, player_1, player_2, player_3, player_4')
    .single();

  if (error) {
    console.error('[Supabase ERROR] Failed to join lobby:', error.message);
  }

  return { data, error };
}

/**
 * Fetches a lobby's game state (seed, players, etc.)
 */
export async function getLobbyState(roomCode) {
  const { data, error } = await supabase
    .from('lobbies')
    .select('state')
    .eq('room_code', roomCode)
    .single();

  if (error) {
    console.error('[Supabase ERROR] Failed to fetch lobby state:', error.message);
  }

  return { data, error };
}
