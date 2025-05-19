import { supabase } from './SupabaseClient.js';

export async function createLobby(playerName, roomCode) {
    const seed = Math.random().toString(36).substring(2, 10); // simple random seed
    const { data, error } = await supabase.from('lobbies').insert([
        {
            room_code: roomCode,
            player_1: playerName,
            state: { seed, players: [playerName], currentTurn: playerName }
        }
    ]);
    return { data, error };
}

export async function joinLobby(playerName, roomCode) {
    const { data: lobbyData, error: fetchError } = await supabase
        .from('lobbies')
        .select('state')
        .eq('room_code', roomCode)
        .single();

    if (fetchError || !lobbyData) return { error: fetchError || 'Lobby not found' };

    const updatedState = {
        ...lobbyData.state,
        players: [...new Set([...(lobbyData.state.players || []), playerName])]
    };

    const { data, error } = await supabase
        .from('lobbies')
        .update({
            player_2: playerName,
            state: updatedState
        })
        .eq('room_code', roomCode);

    return { data, error };
}

export async function getLobbyState(roomCode) {
    const { data, error } = await supabase
        .from('lobbies')
        .select('state')
        .eq('room_code', roomCode)
        .single();
    return { data, error };
}
