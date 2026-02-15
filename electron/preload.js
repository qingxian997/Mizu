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
  fetchCover: (game) => ipcRenderer.invoke('games:fetchCover', game),
  fetchPortraitCover: (game) => ipcRenderer.invoke('games:fetchPortraitCover', game),
  fetchLandscapeCover: (game) => ipcRenderer.invoke('games:fetchLandscapeCover', game),
  resolveSteamAppId: (game) => ipcRenderer.invoke('games:resolveSteamAppId', game),
  getSteamGameInfo: (game, apiKey) => ipcRenderer.invoke('steam:getGameInfo', game, apiKey),
  getSteamCommunityFeed: (games, apiKey) => ipcRenderer.invoke('steam:getCommunityFeed', games, apiKey),
});
