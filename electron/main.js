const { app, BrowserWindow, shell, session, ipcMain, net } = require('electron');
const path = require('path');
const { openStore } = require('./sqlite-store');

const PRODUCTION_URL = 'https://gestion-erp-electoral.vercel.app/';
const SYNC_URL = new URL('/api/desktop-sync', PRODUCTION_URL).toString();
let store;
let mainWindow;
let syncInFlight = false;
let offlinePageLoaded = false;

function isOnline() {
  return Boolean(net.isOnline());
}

async function syncPending() {
  if (syncInFlight || !isOnline() || !store) return { ok:false, message:'Sin conexión; las operaciones permanecen guardadas localmente.' };
  syncInFlight = true;
  try {
    const pending = store.listSyncableEvents();
    if (!pending.length) return { ok:true, message:'No hay operaciones pendientes.' };
    const cookies = await session.defaultSession.cookies.get({ url: PRODUCTION_URL, name:'erp_session' });
    if (!cookies.length) return { ok:false, message:'Conéctese e inicie sesión en el sistema para autorizar la sincronización.' };
    const response = await net.fetch(SYNC_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json','Cookie':cookies.map(c => c.name+'='+c.value).join('; ')},
      body:JSON.stringify({events:pending.map(x => ({event_id:x.event_id,type:x.event_type,payload:x.payload}))})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok:false, message:data.error || 'El servidor rechazó la sincronización.' };
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
}

function showOfflinePage() {
  if (!mainWindow || mainWindow.isDestroyed() || offlinePageLoaded) return;
  offlinePageLoaded = true;
  mainWindow.loadFile(path.join(__dirname,'offline.html')).catch(() => {});
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width:1440, height:900, minWidth:900, minHeight:650, show:false,
    autoHideMenuBar:true, icon:path.join(__dirname,'icono.png'),
    webPreferences:{
      preload:path.join(__dirname,'preload.js'),
      contextIsolation:true, nodeIntegration:false, sandbox:true
    }
  });
  mainWindow.once('ready-to-show',()=>mainWindow.show());
  mainWindow.webContents.on('did-fail-load',(_event,errorCode,errorDescription,validatedURL,isMainFrame)=>{
    if(isMainFrame && errorCode !== -3 && /^https?:/i.test(validatedURL)) showOfflinePage();
  });
  mainWindow.webContents.setWindowOpenHandler(({url})=>{
    if(/^https?:/i.test(url) && !url.startsWith(PRODUCTION_URL)) shell.openExternal(url);
    return {action:'deny'};
  });
  mainWindow.webContents.on('will-navigate',(event,url)=>{
    if(url.startsWith('file://') && url.includes('/electron/offline.html')) return;
    if(!url.startsWith(PRODUCTION_URL)){event.preventDefault();if(/^https?:/i.test(url))shell.openExternal(url);}
  });
  mainWindow.webContents.on('did-finish-load',()=>{
    if(mainWindow.webContents.getURL().startsWith(PRODUCTION_URL)) offlinePageLoaded=false;
  });
  mainWindow.loadURL(PRODUCTION_URL).catch(showOfflinePage);
}

ipcMain.handle('desktop:status', async () => ({
  online:isOnline(), pending:store ? store.pendingCount() : 0,
  queue:store ? store.queueSummary() : {pending:0,failed:0,conflict:0,syncing:0,toSync:0,totalUnresolved:0},
  mode:mainWindow && mainWindow.webContents.getURL().startsWith('file://')?'offline-fallback':'web'
}));
ipcMain.handle('desktop:queue:list', () => store ? store.listEvents().map(x=>({
  event_id:x.event_id,type:x.event_type,status:x.status,attempts:x.attempts,
  created_at:x.created_at,last_error:x.last_error,payload:x.payload
})) : []);
ipcMain.handle('desktop:queue:add', (_event, data) => {
  if (!store) throw new Error('La base local no está disponible');
  return store.addEvent(data || {});
});
ipcMain.handle('desktop:sync-now', () => syncPending());
ipcMain.handle('desktop:cache:get', (_event,key) => store ? store.getCache(key) : null);
ipcMain.handle('desktop:cache:set', (_event,{key,value}) => {
  if (!store) throw new Error('La base local no está disponible');
  return store.setCache(key,value);
});

app.whenReady().then(()=>{
  store=openStore(app.getPath('userData'));
  session.defaultSession.setPermissionRequestHandler((_webContents,permission,callback)=>callback(permission==='notifications'));
  createWindow();
  // Reintento de fondo. Nunca se descarta una operación por falta de conexión.
  setInterval(()=>{syncPending().catch(()=>{});},15000);
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('before-quit',()=>{try{store?.close();}catch(_){}});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
