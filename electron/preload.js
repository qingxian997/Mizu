const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getGames: () => ipcRenderer.invoke('games:get'),
  addGame: (game) => ipcRenderer.invoke('games:add', game),
  updateGame: (id, patch) => ipcRenderer.invoke('games:update', id, patch),
  removeGame: (id) => ipcRenderer.invoke('games:remove', id),
  launchGame: (id) => ipcRenderer.invoke('games:launch', id),
  pickExecutable: () => ipcRenderer.invoke('games:pickExecutable'),
  fetchCover: (title) => ipcRenderer.invoke('games:fetchCover', title),
});
