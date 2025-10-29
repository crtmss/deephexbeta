import { supabase } from './SupabaseClient.js';

/**
 * Creates a lobby with a 6-digit numeric code.
 * The code itself is also used as the world seed.
 */
export async function createLobby(playerName, roomCode) {
    // The roomCode is a 6-digit numeric string — use as seed
    const seed = roomCode;

    const state = {
        seed, // numeric string used for map generation
        players: [playerName],
        currentTurn: playerName
    };

    console.log('[Supabase] Creating lobby with:', { roomCode, playerName, state });

    const { data, error } = await supabase
        .from('lobbies')
        .insert([
            {
                room_code: roomCode,
                player_1: playerName,
                state
            }
        ]);

    if (error) {
        console.error('[Supabase ERROR] Failed to create lobby:', error.message);
    }

    return { data, error };
}

/**
 * Joins an existing lobby.
 */
export async function joinLobby(playerName, roomCode) {
    const { data: lobbyData, error: fetchError } = await supabase
        .from('lobbies')
        .select('state')
        .eq('room_code', roomCode)
        .single();

    if (fetchError || !lobbyData) {
        console.error('[Supabase ERROR] Failed to fetch lobby for join:', fetchError);
        return { error: fetchError || 'Lobby not found' };
    }

    const updatedState = {
        ...lobbyData.state,
        players: [...new Set([...(lobbyData.state.players || []), playerName])]
    };

    console.log('[Supabase] Joining lobby with:', { roomCode, playerName, updatedState });

    const { data, error } = await supabase
        .from('lobbies')
        .update({
            player_2: playerName,
            state: updatedState
        })
        .eq('room_code', roomCode);

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
