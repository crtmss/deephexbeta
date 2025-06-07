// deephexbeta/src/net/SyncManager.js

import { supabase } from './SupabaseClient.js';

let channel = null;

/**
 * Subscribe to game state updates for a specific lobby room.
 * Automatically triggers `onUpdate` with the latest state.
 *
 * @param {string} roomCode - The room code used to identify the lobby.
 * @param {Function} onUpdate - Callback for when new state is pushed from Supabase.
 */
export async function subscribeToGame(roomCode, onUpdate) {
    if (channel) {
        console.warn('[SyncManager] Already subscribed to a channel. Unsubscribing first...');
        await unsubscribeFromGame();
    }

    // First fetch current state immediately
    const { data: lobbyData, error } = await supabase
        .from('lobbies')
        .select('state')
        .eq('room_code', roomCode)
        .single();

    if (error) {
        console.error('[SyncManager] Failed to fetch initial state:', error.message);
    } else if (onUpdate && lobbyData?.state) {
        onUpdate(lobbyData.state);
    }

    // Setup real-time listener
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
                if (onUpdate && newState) {
                    console.log('[SyncManager] State update received');
                    onUpdate(newState);
                }
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('[SyncManager] Subscribed to lobby:', roomCode);
            } else if (status === 'CHANNEL_ERROR') {
                console.error('[SyncManager] Error subscribing to lobby channel');
            }
        });
}

/**
 * Clean up the subscription channel.
 */
export async function unsubscribeFromGame() {
    if (channel) {
        await supabase.removeChannel(channel);
        console.log('[SyncManager] Unsubscribed from game channel');
        channel = null;
    }
}
