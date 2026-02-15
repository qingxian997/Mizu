const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const DB_FILE = 'games.json';
const DEFAULT_PORTRAIT_COVER = 'https://images.weserv.nl/?url=store.steampowered.com/public/shared/images/responsive/header_logo.png&w=600&h=900&fit=cover';
const DEFAULT_LANDSCAPE_COVER = 'https://images.weserv.nl/?url=store.steampowered.com/public/shared/images/header/globalheader_logo.png&w=1280&h=720&fit=cover';

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
  if (Array.isArray(args)) return args.map((item) => String(item).trim()).filter(Boolean);
  if (typeof args === 'string') {
    const tokens = [];
    const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;
    while ((match = regex.exec(args)) !== null) {
      tokens.push((match[1] ?? match[2] ?? match[3] ?? '').trim());
    }
    return tokens.filter(Boolean);
  }
  return [];
}

function normalizeWorkingDir(workingDir, execPath) {
  const preferred = String(workingDir || '').trim();
  if (preferred) return preferred;
  if (!execPath || isUriLaunchPath(execPath)) return '';
  return path.dirname(execPath);
}

function withDefaults(game) {
  return {
    id: game.id || Date.now(),
    englishTitle: String(game.englishTitle || '').trim(),
    title: String(game.title || game.englishTitle || '').trim(),
    execPath: String(game.execPath || '').trim(),
    args: normalizeArgs(game.args),
    workingDir: normalizeWorkingDir(game.workingDir, game.execPath),
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

function toFileUrl(filePath) {
  return pathToFileURL(path.resolve(filePath)).toString();
}

function isUriLaunchPath(execPath) {
  return /^steam:\/\//i.test(execPath) || /^https?:\/\//i.test(execPath);
}

function splitLaunchTarget(target = '') {
  const value = String(target || '').trim();
  if (!value) return { execPath: '', args: [] };

  const quoteMatch = value.match(/^"([^"]+)"\s*(.*)$/);
  if (quoteMatch) {
    const [, execPath, rest] = quoteMatch;
    return { execPath: execPath.trim(), args: normalizeArgs(rest) };
  }

  const steamUriMatch = value.match(/^(steam:\/\/\S+)\s*(.*)$/i);
  if (steamUriMatch) {
    return { execPath: steamUriMatch[1].trim(), args: normalizeArgs(steamUriMatch[2]) };
  }

  const exeMatch = value.match(/^(.+?\.(?:exe|bat|cmd|lnk|url|app|sh))\s*(.*)$/i);
  if (exeMatch) {
    return { execPath: exeMatch[1].trim(), args: normalizeArgs(exeMatch[2]) };
  }

  const [first, ...rest] = normalizeArgs(value);
  return { execPath: first || '', args: rest };
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

function parseAppIdFromText(text = '') {
  const input = String(text || '').trim();
  if (!input) return null;
  const uriMatch = input.match(/steam:\/\/rungameid\/(\d+)/i);
  if (uriMatch?.[1]) return Number(uriMatch[1]);
  if (/^\d{3,}$/.test(input)) return Number(input);
  return null;
}

function buildSearchTerms(title, englishTitle = '') {
  return [englishTitle, title]
    .map((term) => String(term || '').trim())
    .filter(Boolean);
}

async function resolveSteamAppByTitle(title, englishTitle = '') {
  const terms = buildSearchTerms(title, englishTitle);

  for (const term of terms) {
    const appIdFromTerm = parseAppIdFromText(term);
    if (appIdFromTerm) return { appId: appIdFromTerm, matchedTerm: term };
  }

  for (const term of terms) {
    try {
      const url = `https://store.steampowered.com/api/storesearch?term=${encodeURIComponent(term)}&l=schinese&cc=CN`;
      const res = await fetch(url);
      const data = await res.json();
      const item = data?.items?.[0];
      if (item?.id) return { appId: item.id, matchedTerm: term };
    } catch {}
  }
  return { appId: null, matchedTerm: '' };
}

async function fetchCover(title, englishTitle = '') {
  const fallback = { appId: null, portrait: DEFAULT_PORTRAIT_COVER, landscape: DEFAULT_LANDSCAPE_COVER };
  try {
    const { appId } = await resolveSteamAppByTitle(title, englishTitle);
    if (appId) {
      return {
        appId,
        portrait: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
        landscape: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
      };
    }
  } catch {}

  try {
    for (const term of buildSearchTerms(title, englishTitle)) {
      const itunes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&limit=5`);
      const iJson = await itunes.json();
      const item = (iJson.results || []).find(Boolean);
      if (item?.artworkUrl512 || item?.artworkUrl100) {
        const portrait = item.artworkUrl512 || item.artworkUrl100.replace('100x100bb', '512x512bb');
        return { appId: null, portrait, landscape: DEFAULT_LANDSCAPE_COVER };
      }
    }
  } catch {}

  return fallback;
}

async function getSteamGameInfo(title, englishTitle, apiKey) {
  const { appId, matchedTerm } = await resolveSteamAppByTitle(title, englishTitle);
  if (!appId) {
    const q = englishTitle || title;
    return {
      found: false,
      title,
      message: '未在 Steam 上匹配到该游戏。',
      steamdbUrl: `https://steamdb.info/search/?a=app&q=${encodeURIComponent(q)}`,
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

  return {
    found: true,
    appId,
    title: appData?.name || title,
    matchedTerm,
    headerImage: appData?.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
    shortDescription: appData?.short_description || '暂无简介。',
    genres: (appData?.genres || []).map((g) => g.description).slice(0, 4),
    price: appData?.price_overview?.final_formatted || '价格信息暂不可用',
    currentPlayers,
    steamUrl: `https://store.steampowered.com/app/${appId}/`,
    steamdbUrl: `https://steamdb.info/app/${appId}/`,
  };
}

async function getSteamGameMeta(appId) {
  if (!appId) {
    return { achievements: [], news: [] };
  }

  let achievements = [];
  try {
    const achRes = await fetch(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appId}`);
    const achJson = await achRes.json();
    achievements = (achJson?.achievementpercentages?.achievements || []).slice(0, 6).map((item) => ({
      name: item.name,
      percent: item.percent,
    }));
  } catch {}

  let news = [];
  try {
    const newsRes = await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=4&maxlength=240&format=json`);
    const newsJson = await newsRes.json();
    news = (newsJson?.appnews?.newsitems || []).map((item) => ({
      gid: item.gid,
      title: item.title,
      url: item.url,
      date: item.date,
      feedlabel: item.feedlabel,
    }));
  } catch {}

  return { achievements, news };
}

async function getSteamCommunityFeed(titles, apiKey) {
  const normalizedTitles = Array.isArray(titles) ? titles.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 6) : [];
  const entries = [];

  for (const title of normalizedTitles) {
    try {
      const { appId } = await resolveSteamAppByTitle(title);
      if (!appId) continue;

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

  return entries;
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
  if (!payload.title && !payload.englishTitle) return { ok: false, error: '中文名和英文名至少填写一个' };
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
    updated = { ...g, ...patch, args: normalizeArgs(patch.args ?? g.args), workingDir: normalizeWorkingDir(patch.workingDir ?? g.workingDir, patch.execPath ?? g.execPath) };
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
ipcMain.handle('games:fetchCover', (_, title, englishTitle) => fetchCover(title, englishTitle));
ipcMain.handle('steam:getGameInfo', (_, title, englishTitle, apiKey) => getSteamGameInfo(title, englishTitle, apiKey));
ipcMain.handle('steam:getGameMeta', (_, appId) => getSteamGameMeta(appId));
ipcMain.handle('steam:getCommunityFeed', (_, titles, apiKey) => getSteamCommunityFeed(titles, apiKey));
ipcMain.handle('games:launch', (_, id) => {
  const game = readGames().find((g) => g.id === id);
  if (!game) return { ok: false, error: '游戏不存在' };

  try {
    const parsed = splitLaunchTarget(game.execPath);
    const execPath = parsed.execPath;
    const mergedArgs = [...parsed.args, ...normalizeArgs(game.args)];
    const workingDir = normalizeWorkingDir(game.workingDir, execPath);
    if (workingDir && !fs.existsSync(workingDir)) return { ok: false, error: '工作目录不存在' };

    if (isUriLaunchPath(execPath)) {
      openUri(execPath, workingDir);
    } else {
      if (!execPath || !fs.existsSync(execPath)) return { ok: false, error: '游戏路径不存在' };
      const ext = path.extname(execPath).toLowerCase();
      if (process.platform === 'win32' && ['.lnk', '.url'].includes(ext)) {
        openUri(execPath, workingDir);
      } else {
        const child = spawn(execPath, mergedArgs || [], {
          cwd: workingDir || path.dirname(execPath),
          detached: true,
          stdio: 'ignore',
          shell: process.platform === 'win32' && ['.bat', '.cmd'].includes(ext),
          windowsHide: true,
        });
        child.unref();
      }
    }

    const next = readGames().map((g) => (g.id === id ? { ...g, lastPlayed: '刚刚', isRecent: true } : g));
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
