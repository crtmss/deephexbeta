import { supabase } from './SupabaseClient.js';

let channel = null;

export async function subscribeToGame(roomCode, onUpdate) {
    channel = supabase
        .channel('lobby-' + roomCode)
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'lobbies',
                filter: 'room_code=eq.' + roomCode
            },
            payload => {
                const newState = payload.new.state;
                if (onUpdate) onUpdate(newState);
            }
        )
        .subscribe();
}

export function unsubscribeFromGame() {
    if (channel) supabase.removeChannel(channel);
}
