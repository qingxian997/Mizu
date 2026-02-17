/**
 * Mizu - 现代化游戏库管理器
 * 预加载脚本
 * 
 * 此文件负责在渲染进程中安全地暴露主进程的 API
 * 使用 contextBridge 实现进程间通信的安全隔离
 */

const { contextBridge, ipcRenderer } = require('electron');

// 向渲染进程暴露 Electron API
contextBridge.exposeInMainWorld('electronAPI', {
  // ==================== 游戏库管理 ====================
  
  // 获取所有游戏列表
  getGames: () => ipcRenderer.invoke('games:get'),
  
  // 添加新游戏
  addGame: (game) => ipcRenderer.invoke('games:add', game),
  
  // 更新游戏信息
  updateGame: (id, patch) => ipcRenderer.invoke('games:update', id, patch),
  
  // 删除游戏
  removeGame: (id) => ipcRenderer.invoke('games:remove', id),
  
  // 启动游戏
  launchGame: (id) => ipcRenderer.invoke('games:launch', id),
  
  // 重新排序游戏
  reorderGames: (orderedIds) => ipcRenderer.invoke('games:reorder', orderedIds),

  // ==================== 文件选择对话框 ====================
  
  // 选择可执行文件
  pickExecutable: () => ipcRenderer.invoke('games:pickExecutable'),
  
  // 选择目录
  pickDirectory: () => ipcRenderer.invoke('games:pickDirectory'),
  
  // 选择封面图片文件
  pickCoverFile: () => ipcRenderer.invoke('games:pickCoverFile'),

  // ==================== 封面获取 ====================
  
  // 获取游戏封面（自动从 Steam 或其他来源）
  fetchCover: (game) => ipcRenderer.invoke('games:fetchCover', game),
  
  // 获取竖版封面
  fetchPortraitCover: (game) => ipcRenderer.invoke('games:fetchPortraitCover', game),
  
  // 获取横版封面
  fetchLandscapeCover: (game) => ipcRenderer.invoke('games:fetchLandscapeCover', game),
  
  // 解析 Steam AppId
  resolveSteamAppId: (game) => ipcRenderer.invoke('games:resolveSteamAppId', game),

  // ==================== Steam API 集成 ====================
  
  // 获取 Steam 游戏信息
  getSteamGameInfo: (game, apiKey, steamId) => ipcRenderer.invoke('steam:getGameInfo', game, apiKey, steamId),
  
  // 获取 Steam 社区动态
  getSteamCommunityFeed: (games, apiKey, steamId) => ipcRenderer.invoke('steam:getCommunityFeed', games, apiKey, steamId),
  
  // 获取 Steam 好友列表
  getSteamFriends: (apiKey, steamId) => ipcRenderer.invoke('steam:getFriends', apiKey, steamId),
  
  // 获取 Steam 用户信息
  getSteamUserInfo: (apiKey, steamId) => ipcRenderer.invoke('steam:getUserInfo', apiKey, steamId),
  
  // 获取 Steam 好友动态（成就、新游戏等）
  getSteamFriendsActivities: (apiKey, steamId) => ipcRenderer.invoke('steam:getFriendsActivities', apiKey, steamId),
  
  // 导入 Steam 库中的游戏
  importSteamOwnedGames: (apiKey, steamId) => ipcRenderer.invoke('steam:importOwnedGames', apiKey, steamId),

  // ==================== 游戏扫描 ====================
  
  // 扫描已安装的游戏（Steam、Epic、miHoYo、WeGame）
  scanInstalledGames: () => ipcRenderer.invoke('games:scanInstalled'),
  
  // 扫描所有已安装程序
  scanAllPrograms: (customDirs) => ipcRenderer.invoke('programs:scanAll', customDirs),

  // ==================== 系统信息 ====================
  
  // 获取磁盘空间信息
  getDiskSpace: () => ipcRenderer.invoke('system:getDiskSpace'),

  // ==================== 自动更新 ====================
  
  // 检查更新
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  
  // 下载更新
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  
  // 安装更新
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  
  // 获取当前版本
  getAppVersion: () => ipcRenderer.invoke('updater:getVersion'),
  
  // 监听更新状态
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (_, data) => callback(data));
  },
  
  // 移除更新状态监听
  removeUpdateListener: () => {
    ipcRenderer.removeAllListeners('update-status');
  },

  // ==================== 窗口控制 ====================
  
  // 最小化窗口
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  
  // 最大化/还原窗口
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  
  // 关闭窗口
  closeWindow: () => ipcRenderer.invoke('window:close'),
  
  // 检查窗口是否最大化
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
});
