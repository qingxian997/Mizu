const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getGames: () => ipcRenderer.invoke('games:get'),
  addGame: (game) => ipcRenderer.invoke('games:add', game),
  updateGame: (id, patch) => ipcRenderer.invoke('games:update', id, patch),
  removeGame: (id) => ipcRenderer.invoke('games:remove', id),
  launchGame: (id) => ipcRenderer.invoke('games:launch', id),
  pickExecutable: () => ipcRenderer.invoke('games:pickExecutable'),
  pickDirectory: () => ipcRenderer.invoke('games:pickDirectory'),
  pickCoverFile: () => ipcRenderer.invoke('games:pickCoverFile'),
  fetchCover: (title, englishTitle, launchTarget) => ipcRenderer.invoke('games:fetchCover', title, englishTitle, launchTarget),
  getSteamGameInfo: (title, englishTitle, apiKey) => ipcRenderer.invoke('steam:getGameInfo', title, englishTitle, apiKey),
  getSteamGameMeta: (appId) => ipcRenderer.invoke('steam:getGameMeta', appId),
  getSteamCommunityFeed: (titles, apiKey) => ipcRenderer.invoke('steam:getCommunityFeed', titles, apiKey),
});
