// src/net/LobbyManager.js
import { supabase } from './SupabaseClient.js';

/**
 * Mission options we support in the lobby UI.
 * Stored in state as both id + label for convenience.
 */
export const MISSION_TYPES = {
  BIG_CONSTRUCTION: { id: 'big_construction', label: 'Big construction' },
  RESOURCE_EXTRACTION: { id: 'resource_extraction', label: 'Resource extraction' },
  ELIMINATION: { id: 'elimination', label: 'Elimination' },
  CONTROL_POINT: { id: 'control_point', label: 'Control point' },
};

/**
 * Creates a lobby with a 6-digit numeric code.
 * The code itself is also used as the world seed.
 *
 * NEW:
 *  - options.maxPlayers (1–4), default 2
 *  - options.missionType (one of MISSION_TYPES ids), default 'big_construction'
 *
 * Signature is backwards-compatible:
 *   createLobby(playerName, roomCode)
 *   createLobby(playerName, roomCode, { maxPlayers, missionType })
 */
export async function createLobby(playerName, roomCode, options = {}) {
  // The roomCode is a 6-digit numeric string — use as seed
  const seed = roomCode;

  const maxPlayers = Math.min(4, Math.max(1, options.maxPlayers ?? 2));

  // Normalize missionType to a known id
  const missionId = (options.missionType || '').toLowerCase();
  let missionType = MISSION_TYPES.BIG_CONSTRUCTION.id;
  if (missionId === MISSION_TYPES.RESOURCE_EXTRACTION.id) missionType = missionId;
  else if (missionId === MISSION_TYPES.ELIMINATION.id)    missionType = missionId;
  else if (missionId === MISSION_TYPES.CONTROL_POINT.id)  missionType = missionId;

  const state = {
    seed,                     // numeric string used for map generation
    players: [playerName],    // host is always the first player
    currentTurn: playerName,  // simple: host starts
    maxPlayers,               // NEW: lobby target size
    missionType,              // NEW: mission id string
  };

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
        // we keep all extra info inside the JSON state to avoid migrations
        state,
      },
    ]);

  if (error) {
    console.error('[Supabase ERROR] Failed to create lobby:', error.message);
  }

  return { data, error };
}

/**
 * Joins an existing lobby.
 *
 * NEW:
 *  - Honors state.maxPlayers (if present): refuses joins beyond that.
 *  - Keeps players list unique and capped at maxPlayers.
 */
export async function joinLobby(playerName, roomCode) {
  const { data: lobbyData, error: fetchError } = await supabase
    .from('lobbies')
    .select('state')
    .eq('room_code', roomCode)
    .single();

  if (fetchError || !lobbyData) {
    console.error('[Supabase ERROR] Failed to fetch lobby for join:', fetchError);
    return { error: fetchError || new Error('Lobby not found') };
  }

  const prevState = lobbyData.state || {};
  const prevPlayers = Array.isArray(prevState.players) ? prevState.players : [];

  const maxPlayers = Math.min(
    4,
    Math.max(1, typeof prevState.maxPlayers === 'number' ? prevState.maxPlayers : 2)
  );

  // Build a unique player list
  const nextPlayers = Array.from(new Set([...prevPlayers, playerName]));

  // If lobby is already full, reject the join
  if (nextPlayers.length > maxPlayers) {
    console.warn(
      '[Supabase] joinLobby: lobby is full',
      { roomCode, maxPlayers, nextPlayers }
    );
    return {
      error: new Error('Lobby is full'),
    };
  }

  const updatedState = {
    ...prevState,
    players: nextPlayers,
    maxPlayers, // keep normalized
  };

  console.log('[Supabase] Joining lobby with:', { roomCode, playerName, updatedState });

  const { data, error } = await supabase
    .from('lobbies')
    .update({
      player_2: playerName, // legacy column; still set, even if more players in state.players
      state: updatedState,
    })
    .eq('room_code', roomCode);

  if (error) {
    console.error('[Supabase ERROR] Failed to join lobby:', error.message);
  }

  return { data, error };
}

/**
 * Fetches a lobby's game state (seed, players, maxPlayers, missionType, etc.)
 *
 * NOTE: we still only select `state` – that’s where all the new fields live.
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
