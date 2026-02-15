const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const DB_FILE = 'games.json';
const DEFAULT_PORTRAIT_COVER = 'https://images.weserv.nl/?url=store.steampowered.com/public/shared/images/responsive/header_logo.png&w=600&h=900&fit=cover';
const DEFAULT_LANDSCAPE_COVER = 'https://images.weserv.nl/?url=store.steampowered.com/public/shared/images/header/globalheader_logo.png&w=1280&h=720&fit=cover';
const WIN_SHORTCUT_EXTENSIONS = new Set(['.lnk', '.url']);
const WIN_SHELL_EXTENSIONS = new Set(['.bat', '.cmd']);

function getDbPath() {
  return path.join(app.getPath('userData'), DB_FILE);
}

function readGames() {
  try {
    const data = fs.readFileSync(getDbPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeGames(games) {
  fs.writeFileSync(getDbPath(), JSON.stringify(games, null, 2), 'utf-8');
}

function normalizeArgs(args) {
  if (Array.isArray(args)) return args;
  if (typeof args === 'string') return args.split(' ').map((s) => s.trim()).filter(Boolean);
  return [];
}

function splitCommandLine(input) {
  const source = String(input || '').trim();
  if (!source) return [];
  const tokens = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if ((ch === '"' || ch === "'") && source[i - 1] !== '\\') {
      if (!quote) {
        quote = ch;
        continue;
      }
      if (quote === ch) {
        quote = null;
        continue;
      }
    }

    if (!quote && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

function getAppIdFromValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.match(/^\d+$/);
  if (direct) return direct[0];
  const steamUri = raw.match(/^steam:\/\/rungameid\/(\d+)/i);
  if (steamUri) return steamUri[1];
  const appStoreUrl = raw.match(/store\.steampowered\.com\/app\/(\d+)/i);
  if (appStoreUrl) return appStoreUrl[1];
  return '';
}

function normalizeExecPath(execPath, steamAppId = '') {
  const trimmed = String(execPath || '').trim();
  const appId = getAppIdFromValue(steamAppId) || getAppIdFromValue(trimmed);
  if (appId) return `steam://rungameid/${appId}`;
  return trimmed;
}

function resolveLaunchCommand(game) {
  const execPath = normalizeExecPath(game.execPath, game.steamAppId);
  if (isUriLaunchPath(execPath)) {
    return { execPath, args: [] };
  }

  const normalizedArgs = normalizeArgs(game.args);
  if (normalizedArgs.length > 0) {
    return { execPath, args: normalizedArgs };
  }

  const parts = splitCommandLine(execPath);
  if (parts.length <= 1) {
    return { execPath, args: normalizedArgs };
  }

  return {
    execPath: parts[0],
    args: parts.slice(1),
  };
}

function normalizeWorkingDir(workingDir, execPath) {
  const preferred = String(workingDir || '').trim();
  if (preferred) return preferred;
  return '';
}

function withDefaults(game) {
  const steamAppId = getAppIdFromValue(game.steamAppId || game.execPath);
  const normalizedExecPath = normalizeExecPath(game.execPath, steamAppId);
  return {
    id: game.id || Date.now(),
    title: String(game.title || '').trim(),
    titleEn: String(game.titleEn || '').trim(),
    steamAppId,
    execPath: normalizedExecPath,
    args: normalizeArgs(game.args),
    workingDir: normalizeWorkingDir(game.workingDir, normalizedExecPath),
    coverUrl: String(game.coverUrl || '').trim(),
    landscapeCoverUrl: String(game.landscapeCoverUrl || '').trim(),
    color: game.color || 'from-slate-700 via-slate-600 to-slate-900',
    icon: game.icon || 'gamepad-2',
    hours: Number(game.hours || 0),
    lastPlayed: game.lastPlayed || '未运行',
    isRecent: Boolean(game.isRecent),
    isFav: Boolean(game.isFav),
  };
}

function formatLastPlayed(lastPlayedUnix) {
  const value = Number(lastPlayedUnix || 0);
  if (!value) return '未运行';
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return '未运行';
  return date.toISOString();
}

function toFileUrl(filePath) {
  return pathToFileURL(path.resolve(filePath)).toString();
}

function isUriLaunchPath(execPath) {
  return /^steam:\/\//i.test(execPath) || /^https?:\/\//i.test(execPath);
}

function openUri(uri, workingDir = '') {
  if (process.platform === 'win32') {
    const commandArgs = ['/c', 'start', ''];
    if (workingDir) commandArgs.push('/d', workingDir);
    commandArgs.push(uri);
    const child = spawn('cmd.exe', commandArgs, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return;
  }
  if (process.platform === 'darwin') {
    const child = spawn('open', [uri], { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }
  const child = spawn('xdg-open', [uri], { detached: true, stdio: 'ignore' });
  child.unref();
}

async function resolveSteamAppIdByTitle(title) {
  const query = String(title || '').trim();
  if (!query) return null;

  const trySearch = async (lang = 'english') => {
    const url = `https://store.steampowered.com/api/storesearch?term=${encodeURIComponent(query)}&l=${encodeURIComponent(lang)}&cc=US`;
    const res = await fetch(url);
    const data = await res.json();
    return data?.items?.[0]?.id || null;
  };

  try {
    const englishResult = await trySearch('english');
    if (englishResult) return englishResult;
  } catch {
    // noop
  }

  try {
    return await trySearch('schinese');
  } catch {
    return null;
  }
}

function stripHtml(input = '') {
  return String(input || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchCoverFromTheGamesDB(game = {}) {
  const rawTitle = String(game.titleEn || game.title || '').trim();
  if (!rawTitle) return null;

  const endpoint = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://legacy.thegamesdb.net/api/GetGamesList.php?name=${encodeURIComponent(rawTitle)}`)}`;
  const response = await fetch(endpoint);
  const xmlText = await response.text();
  if (!xmlText || !xmlText.includes('<baseImgUrl>')) return null;

  const base = (xmlText.match(/<baseImgUrl>([^<]+)<\/baseImgUrl>/i)?.[1] || '').trim();
  if (!base) return null;

  const gameBlocks = [...xmlText.matchAll(/<Game>([\s\S]*?)<\/Game>/gi)].map((m) => m[1]);
  if (!gameBlocks.length) return null;

  const normalizedTarget = rawTitle.toLowerCase();
  let bestBlock = gameBlocks[0];
  for (const block of gameBlocks) {
    const name = stripHtml(block.match(/<GameTitle>([\s\S]*?)<\/GameTitle>/i)?.[1] || '').toLowerCase();
    if (name === normalizedTarget) {
      bestBlock = block;
      break;
    }
    if (name.includes(normalizedTarget)) bestBlock = block;
  }

  const thumb = (bestBlock.match(/<thumb>([^<]+)<\/thumb>/i)?.[1] || '').trim();
  const fanart = (bestBlock.match(/<fanart>([^<]+)<\/fanart>/i)?.[1] || '').trim();
  const portrait = thumb ? `${base}/${thumb.replace(/^\/+/, '')}` : '';
  const landscape = fanart ? `${base}/${fanart.replace(/^\/+/, '')}` : portrait;
  if (!portrait && !landscape) return null;

  return {
    portrait: portrait || landscape,
    landscape: landscape || portrait,
  };
}

async function resolveSteamAppId(game = {}) {
  const byPayload = getAppIdFromValue(game.steamAppId || game.execPath);
  if (byPayload) return byPayload;

  const englishTitle = String(game.titleEn || '').trim();
  if (englishTitle) {
    const appId = await resolveSteamAppIdByTitle(englishTitle);
    if (appId) return String(appId);
  }

  const chineseTitle = String(game.title || '').trim();
  if (chineseTitle) {
    const appId = await resolveSteamAppIdByTitle(chineseTitle);
    if (appId) return String(appId);
  }

  return '';
}

async function fetchCover(game = {}) {
  const fallback = { portrait: DEFAULT_PORTRAIT_COVER, landscape: DEFAULT_LANDSCAPE_COVER };
  try {
    const appId = await resolveSteamAppId(game);
    if (appId) {
      return {
        portrait: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
        landscape: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
      };
    }
  } catch {}

  try {
    const gamesDbCover = await fetchCoverFromTheGamesDB(game);
    if (gamesDbCover?.portrait || gamesDbCover?.landscape) {
      return {
        portrait: gamesDbCover.portrait || gamesDbCover.landscape,
        landscape: gamesDbCover.landscape || gamesDbCover.portrait,
      };
    }
  } catch {}

  try {
    const title = game.titleEn || game.title || '';
    const itunes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(title)}&entity=software&limit=5`);
    const iJson = await itunes.json();
    const item = (iJson.results || []).find(Boolean);
    if (item?.artworkUrl512 || item?.artworkUrl100) {
      const portrait = item.artworkUrl512 || item.artworkUrl100.replace('100x100bb', '512x512bb');
      return { portrait, landscape: portrait };
    }
  } catch {}

  return fallback;
}

async function fetchSingleCover(game = {}, type = 'portrait') {
  const cover = await fetchCover(game);
  if (type === 'landscape') return cover?.landscape || cover?.portrait || DEFAULT_LANDSCAPE_COVER;
  return cover?.portrait || cover?.landscape || DEFAULT_PORTRAIT_COVER;
}

async function getSteamGameInfo(game, apiKey, steamId) {
  const appId = await resolveSteamAppId(game);
  const title = String(game?.title || game?.titleEn || '').trim();
  if (!appId) {
    return {
      found: false,
      title,
      message: '未在 Steam 上匹配到该游戏。',
      steamdbUrl: `https://steamdb.info/search/?a=app&q=${encodeURIComponent(title)}`,
    };
  }

  let appData = null;
  try {
    const detailRes = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=schinese&cc=CN`);
    const detailJson = await detailRes.json();
    appData = detailJson?.[appId]?.data || null;
  } catch {}

  let currentPlayers = null;
  if (apiKey) {
    try {
      const playersRes = await fetch(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?key=${encodeURIComponent(apiKey)}&appid=${appId}`);
      const playersJson = await playersRes.json();
      currentPlayers = playersJson?.response?.player_count ?? null;
    } catch {}
  }

  let achievementTotal = null;
  try {
    achievementTotal = appData?.achievements?.total ?? null;
  } catch {}

  let playerAchievement = null;
  if (apiKey && steamId) {
    try {
      const achRes = await fetch(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamId)}&appid=${appId}`);
      const achJson = await achRes.json();
      const items = achJson?.playerstats?.achievements || [];
      const unlocked = items.filter((item) => item.achieved === 1);
      const rate = items.length ? Math.round((unlocked.length / items.length) * 100) : 0;
      playerAchievement = {
        total: items.length,
        unlocked: unlocked.length,
        rate,
        recent: unlocked
          .filter((item) => Number(item.unlocktime || 0) > 0)
          .sort((a, b) => Number(b.unlocktime || 0) - Number(a.unlocktime || 0))
          .slice(0, 8)
          .map((item) => ({
            key: item.apiname,
            unlockTime: item.unlocktime,
          })),
      };
    } catch {}
  }

  let news = [];
  try {
    const newsRes = await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=3&maxlength=220&format=json`);
    const newsJson = await newsRes.json();
    news = newsJson?.appnews?.newsitems || [];
  } catch {}

  return {
    found: true,
    appId,
    title: appData?.name || title,
    headerImage: appData?.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
    shortDescription: appData?.short_description || '暂无简介。',
    genres: (appData?.genres || []).map((g) => g.description).slice(0, 4),
    price: appData?.price_overview?.final_formatted || '价格信息暂不可用',
    currentPlayers,
    achievementTotal,
    playerAchievement,
    news,
    steamUrl: `https://store.steampowered.com/app/${appId}/`,
    steamdbUrl: `https://steamdb.info/app/${appId}/`,
  };
}

async function getSteamCommunityFeed(games, apiKey, steamId) {
  const normalizedGames = Array.isArray(games) ? games.slice(0, 6) : [];
  const entries = [];

  for (const game of normalizedGames) {
    try {
      const appId = await resolveSteamAppId(game);
      if (!appId) continue;
      const title = String(game.title || game.titleEn || '').trim() || `App ${appId}`;

      let newsItems = [];
      try {
        const newsRes = await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=2&maxlength=240&format=json`);
        const newsJson = await newsRes.json();
        newsItems = newsJson?.appnews?.newsitems || [];
      } catch {}

      let currentPlayers = null;
      if (apiKey) {
        try {
          const playersRes = await fetch(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?key=${encodeURIComponent(apiKey)}&appid=${appId}`);
          const playersJson = await playersRes.json();
          currentPlayers = playersJson?.response?.player_count ?? null;
        } catch {}
      }

      entries.push({
        appId,
        title,
        currentPlayers,
        news: newsItems.map((item) => ({
          gid: item.gid,
          title: item.title,
          url: item.url,
          author: item.author,
          date: item.date,
          feedlabel: item.feedlabel,
          excerpt: item.contents,
        })),
      });
    } catch {}
  }

  if (apiKey && steamId) {
    try {
      const recentRes = await fetch(`https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamId)}`);
      const recentJson = await recentRes.json();
      const recentGames = recentJson?.response?.games || [];
      for (const game of recentGames.slice(0, 3)) {
        entries.push({
          appId: String(game.appid),
          title: game.name,
          currentPlayers: null,
          news: [{
            gid: `recent-${game.appid}`,
            title: `你最近游玩了 ${Math.round((game.playtime_2weeks || 0) / 60)} 小时`,
            url: `https://store.steampowered.com/app/${game.appid}/`,
            excerpt: `过去两周游玩 ${Math.round((game.playtime_2weeks || 0) / 60)} 小时，总时长 ${Math.round((game.playtime_forever || 0) / 60)} 小时。`,
            author: 'Steam',
            date: Math.floor(Date.now() / 1000),
            feedlabel: 'recent_playtime',
          }],
        });
      }
    } catch {}
  }

  return entries;
}

async function getSteamFriends(apiKey, steamId) {
  if (!apiKey || !steamId) return [];
  try {
    const listRes = await fetch(`https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamId)}&relationship=friend`);
    const listJson = await listRes.json();
    const friendIds = (listJson?.friendslist?.friends || []).map((item) => item.steamid).slice(0, 50);
    if (!friendIds.length) return [];

    const summaryRes = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${friendIds.join(',')}`);
    const summaryJson = await summaryRes.json();
    return (summaryJson?.response?.players || []).map((player) => {
      const status = Number(player.personastate || 0) > 0 ? 'online' : 'offline';
      return {
        id: player.steamid,
        name: player.personaname,
        status,
        game: player.gameextrainfo ? `在线 · ${player.gameextrainfo}` : (status === 'online' ? '在线' : '离线'),
        avatar: player.avatarmedium || player.avatarfull || '',
      };
    });
  } catch {
    return [];
  }
}

async function importSteamOwnedGames(apiKey, steamId) {
  if (!apiKey || !steamId) {
    return { ok: false, error: '请先填写 Steam API Key 与 SteamID64' };
  }

  try {
    const res = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamId)}&include_appinfo=1&include_played_free_games=1&format=json`);
    const payload = await res.json();
    const owned = payload?.response?.games || [];
    if (!owned.length) return { ok: false, error: '未获取到可导入的 Steam 游戏' };

    const games = readGames();
    const byAppId = new Map(games.map((g) => [String(g.steamAppId || ''), g]));
    let added = 0;
    let updated = 0;

    for (const item of owned) {
      const appId = String(item.appid || '');
      if (!appId) continue;
      const basePayload = withDefaults({
        id: Date.now() + Number(appId),
        title: item.name || `Steam App ${appId}`,
        titleEn: item.name || '',
        steamAppId: appId,
        execPath: `steam://rungameid/${appId}`,
        coverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
        landscapeCoverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
        hours: Number(((item.playtime_forever || 0) / 60).toFixed(1)),
        lastPlayed: formatLastPlayed(item.rtime_last_played),
        isRecent: Number(item.rtime_last_played || 0) > 0,
      });

      const existing = byAppId.get(appId);
      if (existing) {
        const merged = withDefaults({
          ...existing,
          title: existing.title || basePayload.title,
          titleEn: existing.titleEn || basePayload.titleEn,
          steamAppId: appId,
          execPath: existing.execPath || basePayload.execPath,
          coverUrl: existing.coverUrl || basePayload.coverUrl,
          landscapeCoverUrl: existing.landscapeCoverUrl || basePayload.landscapeCoverUrl,
          hours: Math.max(Number(existing.hours || 0), Number(basePayload.hours || 0)),
          lastPlayed: basePayload.lastPlayed === '未运行' ? existing.lastPlayed : basePayload.lastPlayed,
          isRecent: existing.isRecent || basePayload.isRecent,
        });
        const index = games.findIndex((g) => g.id === existing.id);
        if (index >= 0) games[index] = merged;
        updated += 1;
      } else {
        games.push(basePayload);
        added += 1;
      }
    }

    writeGames(games);
    return { ok: true, added, updated, total: games.length };
  } catch (error) {
    return { ok: false, error: error.message || '导入失败' };
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'index.html'));
  return win;
}

let mainWindow = null;
let tray = null;
let forceQuit = false;

function getTrayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2563eb"/><path d="M19 27h26v8H19z" fill="#fff"/><path d="M25 21h14v6H25zM25 35h14v8H25z" fill="#bfdbfe"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function showMainWindow() {
  if (!mainWindow) return;
  mainWindow.setSkipTaskbar(false);
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function hideToTray() {
  if (!mainWindow) return;
  mainWindow.hide();
  mainWindow.setSkipTaskbar(true);
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip('Steam 游戏库');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主界面', click: showMainWindow },
    {
      label: '退出', click: () => {
        forceQuit = true;
        app.quit();
      },
    },
  ]));
  tray.on('double-click', showMainWindow);
}

ipcMain.handle('games:get', () => readGames());
ipcMain.handle('games:add', (_, game) => {
  const payload = withDefaults(game);
  if (!payload.title && !payload.titleEn) return { ok: false, error: '中文名和英文名至少填写一个' };
  if (!payload.execPath) return { ok: false, error: '启动路径不能为空' };
  const games = readGames();
  const next = [...games, payload];
  writeGames(next);
  return { ok: true, game: payload };
});
ipcMain.handle('games:update', (_, id, patch) => {
  const games = readGames();
  let updated = null;
  const next = games.map((g) => {
    if (g.id !== id) return g;
    updated = withDefaults({ ...g, ...patch, args: normalizeArgs(patch.args ?? g.args), workingDir: normalizeWorkingDir(patch.workingDir ?? g.workingDir, patch.execPath ?? g.execPath) });
    return updated;
  });
  writeGames(next);
  return updated;
});
ipcMain.handle('games:remove', (_, id) => {
  const next = readGames().filter((g) => g.id !== id);
  writeGames(next);
  return true;
});
ipcMain.handle('games:pickDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return '';
  return result.filePaths[0];
});
ipcMain.handle('games:pickExecutable', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: '应用程序', extensions: ['exe', 'bat', 'cmd', 'app', 'sh', 'lnk', 'url'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return '';
  return result.filePaths[0];
});
ipcMain.handle('games:pickCoverFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return '';
  return toFileUrl(result.filePaths[0]);
});
ipcMain.handle('games:fetchCover', (_, title) => fetchCover(title));
ipcMain.handle('games:fetchPortraitCover', (_, game) => fetchSingleCover(game, 'portrait'));
ipcMain.handle('games:fetchLandscapeCover', (_, game) => fetchSingleCover(game, 'landscape'));
ipcMain.handle('games:resolveSteamAppId', (_, game) => resolveSteamAppId(game));
ipcMain.handle('steam:getGameInfo', (_, game, apiKey, steamId) => getSteamGameInfo(game, apiKey, steamId));
ipcMain.handle('steam:getCommunityFeed', (_, games, apiKey, steamId) => getSteamCommunityFeed(games, apiKey, steamId));
ipcMain.handle('steam:getFriends', (_, apiKey, steamId) => getSteamFriends(apiKey, steamId));
ipcMain.handle('steam:importOwnedGames', (_, apiKey, steamId) => importSteamOwnedGames(apiKey, steamId));
ipcMain.handle('games:launch', (_, id) => {
  const games = readGames();
  const game = games.find((g) => g.id === id);
  if (!game) return { ok: false, error: '游戏不存在' };

  try {
    const launch = resolveLaunchCommand(game);
    const workingDir = normalizeWorkingDir(game.workingDir, launch.execPath);
    if (workingDir && !fs.existsSync(workingDir)) return { ok: false, error: '工作目录不存在' };

    if (isUriLaunchPath(launch.execPath)) {
      openUri(launch.execPath, workingDir);
    } else {
      if (!launch.execPath || !fs.existsSync(launch.execPath)) return { ok: false, error: '游戏路径不存在' };
      const ext = path.extname(launch.execPath).toLowerCase();
      if (process.platform === 'win32' && WIN_SHORTCUT_EXTENSIONS.has(ext)) {
        openUri(launch.execPath, workingDir);
      } else {
        const child = spawn(launch.execPath, launch.args || [], {
          cwd: workingDir || path.dirname(launch.execPath),
          detached: true,
          stdio: 'ignore',
          shell: process.platform === 'win32' && WIN_SHELL_EXTENSIONS.has(ext),
          windowsHide: true,
        });
        child.unref();
      }
    }

    const nowIso = new Date().toISOString();
    const next = games.map((g) => (g.id === id ? { ...g, lastPlayed: nowIso, isRecent: true } : g));
    writeGames(next);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || '启动失败' };
  }
});

app.whenReady().then(() => {
  mainWindow = createWindow();
  createTray();

  mainWindow.on('close', (event) => {
    if (forceQuit) return;
    event.preventDefault();
    hideToTray();
  });

  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    hideToTray();
  });

  app.on('activate', () => {
    if (mainWindow) showMainWindow();
  });
});

app.on('before-quit', () => {
  forceQuit = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && forceQuit) app.quit();
});
