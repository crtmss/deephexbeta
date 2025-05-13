// Database connection
function findPath(start, goal, grid, costMap) {
  return [start, goal]; // Return dummy path for now
}


// ✅ NEW: Realtime sync
export async function subscribeToLobby(roomId) {
  const channel = supabase.channel(`lobby-${roomId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'lobbies',
      filter: `id=eq.${roomId}`
    }, (payload) => {
      const newState = payload.new.state;
      const current = getState();

      const changed =
        JSON.stringify(current.map) !== JSON.stringify(newState.map) ||
        JSON.stringify(current.units) !== JSON.stringify(newState.units) ||
        current.currentTurn !== newState.turn;

      if (changed) {
        setState({
          map: newState.map,
          currentTurn: newState.turn,
          units: newState.units
        });
      }
    })
    .subscribe();

  console.log(`Subscribed to real-time lobby updates for room ${roomId}`);
}

window.subscribeToLobby = subscribeToLobby;
window.current = current;
window.newState = newState;
window.findPath = findPath;
window.changed = changed;
window.channel = channel;