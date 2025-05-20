import { supabase } from './SupabaseClient.js';

export async function createLobby(playerName, roomCode) {
    const seed = Math.random().toString(36).substring(2, 10); // simple random seed
    const state = {
        seed,
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
        ]); // ✅ No .select()

    if (error) {
        console.error('[Supabase ERROR] Failed to create lobby:', error.message);
    }

    return { data, error };
}

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
