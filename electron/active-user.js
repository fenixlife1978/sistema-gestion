async function bindActiveUser({store,userId,isOnline,verifyRemoteUser}) {
  if (!store) throw new Error('La base local no está disponible');
  if (userId === null || userId === undefined || userId === '') return store.setActiveUserId(null);
  const requestedId=Number(userId);
  if (!Number.isSafeInteger(requestedId) || requestedId < 1) throw new Error('Identificador de usuario inválido');
  const previousId=store.getActiveUserId();
  // Clear the marker before any fallible verification so a failed account switch cannot reuse the old owner.
  store.setActiveUserId(null);
  if (previousId !== requestedId) store.clearCache();
  if (!isOnline()) throw new Error('La identidad del usuario solo se puede confirmar con conexión.');
  const remoteUser=await verifyRemoteUser();
  if (!remoteUser || Number(remoteUser.id)!==requestedId) {
    throw new Error('El servidor no confirmó que esta sesión pertenezca al usuario indicado.');
  }
  return store.setActiveUserId(remoteUser.id);
}

module.exports={bindActiveUser};
