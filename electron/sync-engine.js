function createSyncEngine({ store, isOnline, getCookieHeader, postSync }) {
  let syncInFlight = false;

  return async function syncPending() {
    if (syncInFlight || !isOnline() || !store) {
      return { ok:false, message:'Sin conexión o sincronización ya en curso; las operaciones permanecen guardadas localmente.' };
    }
    syncInFlight = true;
    try {
      const activeUserId = store.getActiveUserId();
      if (!activeUserId) {
        return { ok:false, message:'Inicie sesión en línea con el usuario propietario de las operaciones para sincronizar.' };
      }
      const pending = store.listSyncableEvents(activeUserId);
      if (!pending.length) {
        return { ok:true, message:'No hay operaciones pendientes de este usuario. Las operaciones de otras cuentas permanecen separadas.' };
      }
      const cookieHeader = await getCookieHeader();
      if (!cookieHeader) {
        return { ok:false, message:'Conéctese e inicie sesión en el sistema para autorizar la sincronización.' };
      }
      const events = pending.map(x => ({
        event_id:x.event_id,
        actor_id:x.actor_id,
        type:x.event_type,
        payload:x.payload
      }));
      const response = await postSync({ cookieHeader, events });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok:false, message:data.error || 'El servidor rechazó la sincronización.' };
      }
      for (const result of (data.results || [])) {
        if (result.status === 'synced') store.setEventStatus(result.event_id,'synced');
        else if (result.status === 'conflict') store.setEventStatus(result.event_id,'conflict',result.error);
        else store.setEventStatus(result.event_id,'failed',result.error);
      }
      const remaining = store.pendingCount();
      return {ok:true, message:'Sincronización procesada. Pendientes por enviar: '+remaining+'.'};
    } catch (error) {
      return {ok:false, message:'No se pudo sincronizar; los datos siguen en este equipo. '+String(error.message||error)};
    } finally {
      syncInFlight = false;
    }
  };
}

module.exports = { createSyncEngine };
