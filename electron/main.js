const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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
  if (Array.isArray(args)) return args;
  if (typeof args === 'string') return args.split(' ').map((s) => s.trim()).filter(Boolean);
  return [];
}

function withDefaults(game) {
  return {
    id: game.id || Date.now(),
    title: String(game.title || '').trim(),
    execPath: String(game.execPath || '').trim(),
    args: normalizeArgs(game.args),
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

async function fetchCover(title) {
  const fallback = { portrait: DEFAULT_PORTRAIT_COVER, landscape: DEFAULT_LANDSCAPE_COVER };
  try {
    const steamSearch = await fetch(`https://store.steampowered.com/api/storesearch?term=${encodeURIComponent(title)}&l=schinese&cc=CN`);
    const steamJson = await steamSearch.json();
    const first = steamJson?.items?.[0];
    if (first?.id) {
      const appId = first.id;
      return {
        portrait: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
        landscape: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
      };
    }
  } catch {}

  try {
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

function launchByShellOnWindows(execPath) {
  const child = spawn('cmd.exe', ['/c', 'start', '', execPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('games:get', () => readGames());
ipcMain.handle('games:add', (_, game) => {
  const payload = withDefaults(game);
  if (!payload.title) return { ok: false, error: '游戏名称不能为空' };
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
    updated = { ...g, ...patch, args: normalizeArgs(patch.args ?? g.args) };
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
ipcMain.handle('games:launch', (_, id) => {
  const game = readGames().find((g) => g.id === id);
  if (!game) return { ok: false, error: '游戏不存在' };
  if (!game.execPath || !fs.existsSync(game.execPath)) return { ok: false, error: '游戏路径不存在' };

  try {
    const ext = path.extname(game.execPath).toLowerCase();
    if (process.platform === 'win32' && ['.lnk', '.url'].includes(ext)) {
      launchByShellOnWindows(game.execPath);
    } else {
      const child = spawn(game.execPath, game.args || [], {
        cwd: path.dirname(game.execPath),
        detached: true,
        stdio: 'ignore',
        shell: process.platform === 'win32',
      });
      child.unref();
    }

    const next = readGames().map((g) => (g.id === id ? { ...g, lastPlayed: '刚刚', isRecent: true } : g));
    writeGames(next);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
