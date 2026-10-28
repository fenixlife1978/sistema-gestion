const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', Object.freeze({
  getStatus: () => ipcRenderer.invoke('desktop:status'),
  getQueue: () => ipcRenderer.invoke('desktop:queue:list'),
  enqueue: (event) => ipcRenderer.invoke('desktop:queue:add', event),
  syncNow: () => ipcRenderer.invoke('desktop:sync-now'),
  setActiveUser: (userId) => ipcRenderer.invoke('desktop:user:set', userId),
  getCached: (key) => ipcRenderer.invoke('desktop:cache:get', key),
  setCached: (key, value) => ipcRenderer.invoke('desktop:cache:set', { key, value }),
  clearCache: () => ipcRenderer.invoke('desktop:cache:clear')
}));
