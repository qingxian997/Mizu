/**
 * Mizu - 现代化游戏库管理器
 * 主进程入口文件
 * 
 * 功能模块：
 * - 游戏库数据管理（增删改查）
 * - 游戏启动与路径解析
 * - Steam API 集成
 * - 系统托盘支持
 * - AI 功能集成
 */

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

// ==================== 常量定义 ====================

const DB_FILE = 'games.json';
const DEFAULT_PORTRAIT_COVER = 'https://images.weserv.nl/?url=store.steampowered.com/public/shared/images/responsive/header_logo.png&w=600&h=900&fit=cover';
const DEFAULT_LANDSCAPE_COVER = 'https://images.weserv.nl/?url=store.steampowered.com/public/shared/images/header/globalheader_logo.png&w=1280&h=720&fit=cover';
const WIN_SHORTCUT_EXTENSIONS = new Set(['.lnk', '.url']);
const WIN_SHELL_EXTENSIONS = new Set(['.bat', '.cmd']);
const WIN_EXEC_EXTENSIONS = new Set(['.exe', '.msi']);

// ==================== 数据库操作 ====================

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

// ==================== 命令行解析工具 ====================

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

// ==================== Steam AppId 解析 ====================

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

  if (fs.existsSync(execPath)) {
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
    lastPlayed: game.lastPlayed || '???',
    isRecent: Boolean(game.isRecent),
    isFav: Boolean(game.isFav),
  };
}

// ==================== 游戏数据标准化 ====================

function formatLastPlayed(lastPlayedUnix) {
  const value = Number(lastPlayedUnix || 0);
  if (!value) return '???';
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return '???';
  return date.toISOString();
}

function toFileUrl(filePath) {
  return pathToFileURL(path.resolve(filePath)).toString();
}

function isUriLaunchPath(execPath) {
  return /^steam:\/\//i.test(execPath) || /^https?:\/\//i.test(execPath);
}

// ==================== 游戏启动功能 ====================

function openUri(uri, workingDir = '') {
  shell.openExternal(uri);
}

function launchShortcut(shortcutPath, workingDir = '') {
  shell.openPath(shortcutPath);
  return { ok: true };
}

function launchExecutable(execPath, args = [], workingDir = '') {
  shell.openPath(execPath);
  return { ok: true };
}

// ==================== 游戏平台配置 ====================

const KNOWN_GAME_LAUNCHERS = [
  {
    name: 'Steam',
    type: 'steam',
    registryKey: 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam',
    registryValue: 'InstallPath',
    steamAppsDir: 'steamapps',
    commonDir: 'steamapps\\common',
  },
  {
    name: 'Epic Games',
    type: 'epic',
    registryKey: 'HKLM\\SOFTWARE\\WOW6432Node\\Epic Games\\EpicGamesLauncher',
    registryValue: 'AppDataPath',
  },
  {
    name: 'miHoYo',
    type: 'mihoyo',
    possiblePaths: [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'miHoYo Launcher'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'miHoYo Launcher'),
      'D:\\miHoYo Launcher',
      'C:\\miHoYo Launcher',
    ],
    gamesSubdir: 'games',
  },
  {
    name: 'WeGame',
    type: 'wegame',
    possiblePaths: [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WeGame'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'WeGame'),
      'D:\\WeGame',
    ],
  },
];

// ==================== 目录扫描功能 ====================

function scanDirectoryForExecutables(dir, depth = 2) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory() && depth > 0) {
        results.push(...scanDirectoryForExecutables(fullPath, depth - 1));
      } else if (item.isFile() && path.extname(item.name).toLowerCase() === '.exe') {
        const stat = fs.statSync(fullPath);
        if (stat.size > 1024 * 1024) {
          results.push({
            name: path.basename(item.name, '.exe'),
            path: fullPath,
            size: stat.size,
          });
        }
      }
    }
  } catch {}
  
  return results;
}

function getSteamInstallPath() {
  const possiblePaths = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
    'C:\\Steam',
    'D:\\Steam',
    'D:\\Games\\Steam',
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, 'steam.exe'))) {
      return p;
    }
  }
  return null;
}

function getSteamLibraryPaths(steamPath) {
  const libraries = [steamPath];
  const libraryFoldersPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  
  if (fs.existsSync(libraryFoldersPath)) {
    try {
      const content = fs.readFileSync(libraryFoldersPath, 'utf-8');
      const matches = content.matchAll(/"path"\s+"([^"]+)"/gi);
      for (const match of matches) {
        const libPath = match[1].replace(/\\\\/g, '\\');
        if (libPath !== steamPath && fs.existsSync(libPath)) {
          libraries.push(libPath);
        }
      }
    } catch {}
  }
  
  return libraries;
}

function scanSteamGames() {
  const steamPath = getSteamInstallPath();
  if (!steamPath) return [];
  
  const libraries = getSteamLibraryPaths(steamPath);
  const games = [];
  
  for (const libPath of libraries) {
    const commonPath = path.join(libPath, 'steamapps', 'common');
    if (!fs.existsSync(commonPath)) continue;
    
    try {
      const gameDirs = fs.readdirSync(commonPath, { withFileTypes: true });
      for (const gameDir of gameDirs) {
        if (!gameDir.isDirectory()) continue;
        
        const gamePath = path.join(commonPath, gameDir.name);
        const execs = scanDirectoryForExecutables(gamePath, 1);
        
        if (execs.length > 0) {
          const mainExe = execs.find(e => 
            e.name.toLowerCase().includes(gameDir.name.toLowerCase().replace(/[^a-z0-9]/gi, '').substring(0, 4)) ||
            e.name.toLowerCase() === gameDir.name.toLowerCase() ||
            e.name.toLowerCase() === 'game' ||
            e.name.toLowerCase().includes('launcher')
          ) || execs[0];
          
          games.push({
            title: gameDir.name,
            titleEn: gameDir.name,
            execPath: mainExe.path,
            source: 'Steam',
            coverUrl: '',
          });
        }
      }
    } catch {}
  }
  
  return games;
}

function scanMiHoYoGames() {
  const games = [];
  const possiblePaths = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'miHoYo Launcher'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'miHoYo Launcher'),
    'D:\\miHoYo Launcher',
    'C:\\miHoYo Launcher',
    'D:\\mihoyo\\miHoYo Launcher',
    'C:\\mihoyo\\miHoYo Launcher',
  ];
  
  for (const launcherPath of possiblePaths) {
    if (!fs.existsSync(launcherPath)) continue;
    
    const gamesPath = path.join(launcherPath, 'games');
    if (!fs.existsSync(gamesPath)) continue;
    
    try {
      const gameDirs = fs.readdirSync(gamesPath, { withFileTypes: true });
      for (const gameDir of gameDirs) {
        if (!gameDir.isDirectory()) continue;
        
        const gamePath = path.join(gamesPath, gameDir.name);
        const execs = scanDirectoryForExecutables(gamePath, 3);
        
        const knownGames = {
          'Star Rail': ['starrail', 'honkai', 'star'],
          'Genshin Impact': ['genshin', 'yuanshen'],
          'Honkai Impact 3rd': ['honkai3', 'bh3'],
          'Zenless Zone Zero': ['zenless', 'zzz'],
        };
        
        let gameTitle = gameDir.name;
        for (const [title, keywords] of Object.entries(knownGames)) {
          if (keywords.some(k => gameDir.name.toLowerCase().includes(k))) {
            gameTitle = title;
            break;
          }
        }
        
        if (execs.length > 0) {
          const mainExe = execs.find(e => 
            e.name.toLowerCase().includes('launcher') ||
            e.name.toLowerCase().includes('game') ||
            e.name.toLowerCase().includes('starrail') ||
            e.name.toLowerCase().includes('genshin') ||
            e.name.toLowerCase().includes('honkai') ||
            e.name.toLowerCase().includes('zenless')
          ) || execs.find(e => e.size === Math.max(...execs.map(x => x.size))) || execs[0];
          
          games.push({
            title: gameTitle,
            titleEn: gameDir.name,
            execPath: mainExe.path,
            source: 'miHoYo',
            coverUrl: '',
          });
        }
      }
    } catch (err) {
      console.error('scanMiHoYoGames error:', err);
    }
    
    if (games.length > 0) break;
  }
  
  return games;
}

function scanEpicGames() {
  const games = [];
  const manifestPath = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  
  if (!fs.existsSync(manifestPath)) return games;
  
  try {
    const files = fs.readdirSync(manifestPath);
    for (const file of files) {
      if (!file.endsWith('.item')) continue;
      
      try {
        const filePath = path.join(manifestPath, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        
        let manifest;
        try {
          manifest = JSON.parse(content);
        } catch {
          const appNameMatch = content.match(/"AppName"\s*"([^"]+)"/);
          const displayNameMatch = content.match(/"DisplayName"\s*"([^"]+)"/);
          const installLocationMatch = content.match(/"InstallLocation"\s*"([^"]+)"/);
          
          if (displayNameMatch && installLocationMatch) {
            manifest = {
              DisplayName: displayNameMatch[1],
              InstallLocation: installLocationMatch[1].replace(/\\\\/g, '\\'),
            };
          }
        }
        
        if (!manifest || !manifest.InstallLocation) continue;
        
        const installLocation = manifest.InstallLocation;
        if (!fs.existsSync(installLocation)) continue;
        
        const execs = scanDirectoryForExecutables(installLocation, 3);
        if (execs.length === 0) continue;
        
        const title = manifest.DisplayName || path.basename(installLocation);
        
        const mainExe = execs.find(e => {
          const nameLower = e.name.toLowerCase();
          const titleLower = title.toLowerCase();
          return nameLower.includes(titleLower.substring(0, Math.min(5, titleLower.length))) ||
                 nameLower.includes('game') ||
                 nameLower.includes('launcher') ||
                 nameLower.includes('win64') ||
                 nameLower.includes('win32');
        }) || execs.find(e => e.size === Math.max(...execs.map(x => x.size))) || execs[0];
        
        games.push({
          title: title,
          titleEn: title,
          execPath: mainExe.path,
          source: 'Epic Games',
          coverUrl: '',
        });
      } catch (err) {
        console.error('Epic manifest parse error:', err);
      }
    }
  } catch (err) {
    console.error('scanEpicGames error:', err);
  }
  
  return games;
}

function scanWeGameGames() {
  const games = [];
  const possiblePaths = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WeGame'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'WeGame'),
    'D:\\WeGame',
  ];
  
  for (const wegamePath of possiblePaths) {
    if (!fs.existsSync(wegamePath)) continue;
    
    const appsPath = path.join(wegamePath, 'apps');
    if (!fs.existsSync(appsPath)) continue;
    
    try {
      const gameDirs = fs.readdirSync(appsPath, { withFileTypes: true });
      for (const gameDir of gameDirs) {
        if (!gameDir.isDirectory()) continue;
        
        const gamePath = path.join(appsPath, gameDir.name);
        const execs = scanDirectoryForExecutables(gamePath, 2);
        
        if (execs.length > 0) {
          const mainExe = execs.find(e => 
            e.name.toLowerCase().includes(gameDir.name.toLowerCase().substring(0, 4)) ||
            e.name.toLowerCase().includes('game')
          ) || execs[0];
          
          games.push({
            title: gameDir.name,
            titleEn: gameDir.name,
            execPath: mainExe.path,
            source: 'WeGame',
            coverUrl: '',
          });
        }
      }
    } catch {}
    
    if (games.length > 0) break;
  }
  
  return games;
}

async function scanInstalledGames() {
  const allGames = [];
  
  const steamGames = scanSteamGames();
  allGames.push(...steamGames);
  
  const mihoyoGames = scanMiHoYoGames();
  allGames.push(...mihoyoGames);
  
  const epicGames = scanEpicGames();
  allGames.push(...epicGames);
  
  const wegameGames = scanWeGameGames();
  allGames.push(...wegameGames);
  
  const seen = new Set();
  return allGames.filter(game => {
    const key = game.execPath.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scanAllInstalledPrograms(customDirs = []) {
  const programs = [];
  const seenPaths = new Set();
  const seenNames = new Set();
  
  const defaultDirs = [
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs',
    path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
  
  const programDirs = customDirs.length > 0 ? customDirs : defaultDirs;
  
  const excludePatterns = [
    /unins/i,
    /setup\.exe$/i,
    /install\.exe$/i,
    /update\.exe$/i,
    /helper\.exe$/i,
    /crash/i,
    /report/i,
    /config\.exe$/i,
    /settings\.exe$/i,
    /options\.exe$/i,
    /readme/i,
    /license/i,
    /eula/i,
    /manual/i,
    /documentation/i,
    /\.chm$/i,
    /\.hlp$/i,
    /\.dll$/i,
    /\.sys$/i,
    /uninstall/i,
    /remove/i,
    /repair/i,
    /modify\.exe$/i,
    /vc_redist/i,
    /vcredist/i,
    /dotnet/i,
    /directx/i,
    /windows\s*installer/i,
  ];
  
  function normalizeTitle(title) {
    return title.toLowerCase()
      .replace(/[:\-_\(\)\[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  for (const dir of programDirs) {
    if (!fs.existsSync(dir)) continue;
    
    try {
      const scanDir = (currentPath, depth = 0) => {
        if (depth > 4) return;
        
        let entries;
        try {
          entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch {
          return;
        }
        
        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          
          if (entry.isDirectory()) {
            scanDir(fullPath, depth + 1);
            continue;
          }
          
          const ext = path.extname(entry.name).toLowerCase();
          if (!['.exe', '.lnk'].includes(ext)) continue;
          
          let execPath = fullPath;
          let title = entry.name.replace(/\.(exe|lnk)$/i, '');
          
          if (ext === '.lnk') {
            try {
              const shortcut = readShortcut(fullPath);
              if (shortcut && shortcut.targetPath) {
                const targetExt = path.extname(shortcut.targetPath).toLowerCase();
                if (targetExt === '.exe' && fs.existsSync(shortcut.targetPath)) {
                  execPath = shortcut.targetPath;
                } else {
                  continue;
                }
              } else {
                continue;
              }
            } catch {
              continue;
            }
          }
          
          const execLower = execPath.toLowerCase();
          const execName = path.basename(execPath).toLowerCase();
          
          if (excludePatterns.some(p => p.test(execLower) || p.test(execName))) continue;
          if (seenPaths.has(execLower)) continue;
          
          const normalizedTitle = normalizeTitle(title);
          if (seenNames.has(normalizedTitle)) continue;
          
          seenPaths.add(execLower);
          seenNames.add(normalizedTitle);
          
          programs.push({
            title: title,
            titleEn: title,
            execPath: execPath,
            source: 'Installed Program',
            coverUrl: '',
            iconPath: execPath,
          });
        }
      };
      
      scanDir(dir, 0);
    } catch (err) {
      console.error('scanAllInstalledPrograms error:', err);
    }
  }
  
  return programs;
}

ipcMain.handle('programs:scanAll', (_, customDirs) => {
  try {
    const programs = scanAllInstalledPrograms(customDirs);
    return { ok: true, programs };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

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
      message: '未在 Steam 找到该游戏',
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

  let achievementSchemaMap = new Map();
  if (apiKey) {
    try {
      const schemaRes = await fetch(`https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${encodeURIComponent(apiKey)}&appid=${appId}&l=schinese`);
      const schemaJson = await schemaRes.json();
      const schemaItems = schemaJson?.game?.availableGameStats?.achievements || [];
      achievementSchemaMap = new Map(schemaItems.map((item) => [item.name, item]));
    } catch {}
  }

  let playerAchievement = null;
  let achievementItems = [];
  if (apiKey && steamId) {
    try {
      const achRes = await fetch(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamId)}&appid=${appId}`);
      const achJson = await achRes.json();
      const items = achJson?.playerstats?.achievements || [];
      achievementItems = items.map((item) => {
        const schema = achievementSchemaMap.get(item.apiname) || {};
        return {
          key: item.apiname,
          achieved: item.achieved === 1,
          unlockTime: Number(item.unlocktime || 0),
          title: schema.displayName || item.apiname,
          description: schema.description || '',
          icon: schema.icon || '',
          iconGray: schema.icongray || schema.icon || '',
          hidden: Number(schema.hidden || 0) === 1,
        };
      });
      const unlocked = achievementItems.filter((item) => item.achieved);
      const rate = achievementItems.length ? Math.round((unlocked.length / achievementItems.length) * 100) : 0;
      playerAchievement = {
        total: achievementItems.length,
        unlocked: unlocked.length,
        rate,
        recent: unlocked
          .filter((item) => Number(item.unlockTime || 0) > 0)
          .sort((a, b) => Number(b.unlockTime || 0) - Number(a.unlockTime || 0))
          .slice(0, 8),
      };
    } catch {}
  }

  let news = [];
  try {
    const newsRes = await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=3&maxlength=220&format=json`);
    const newsJson = await newsRes.json();
    news = newsJson?.appnews?.newsitems || [];
  } catch {}

  let playtime_forever = null;
  let lastPlayed = null;
  if (apiKey && steamId) {
    try {
      const ownedRes = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamId)}&include_played_free_games=1&include_appinfo=true`);
      const ownedJson = await ownedRes.json();
      const games = ownedJson?.response?.games || [];
      const gameData = games.find(g => String(g.appid) === String(appId));
      if (gameData) {
        playtime_forever = gameData.playtime_forever || 0;
        lastPlayed = gameData.rtime_last_played ? new Date(gameData.rtime_last_played * 1000).toISOString() : null;
      }
    } catch {}
  }

  return {
    found: true,
    appId,
    title: appData?.name || title,
    headerImage: appData?.header_image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
    shortDescription: appData?.short_description || '暂无简介',
    genres: (appData?.genres || []).map((g) => g.description).slice(0, 4),
    price: appData?.price_overview?.final_formatted || '未知价格',
    currentPlayers,
    achievementTotal,
    playerAchievement,
    playtime_forever,
    lastPlayed,
    achievements: achievementItems.length
      ? achievementItems
      : Array.from(achievementSchemaMap.values()).map((schema) => ({
        key: schema.name,
        achieved: false,
        unlockTime: 0,
        title: schema.displayName || schema.name,
        description: schema.description || '',
        icon: schema.icon || '',
        iconGray: schema.icongray || schema.icon || '',
        hidden: Number(schema.hidden || 0) === 1,
      })),
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
            title: `最近两周游玩 ${Math.round((game.playtime_2weeks || 0) / 60)} 小时`,
            url: `https://store.steampowered.com/app/${game.appid}/`,
            excerpt: `最近两周游玩 ${Math.round((game.playtime_2weeks || 0) / 60)} 小时，总计 ${Math.round((game.playtime_forever || 0) / 60)} 小时`,
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
    const friendsList = listJson?.friendslist?.friends || [];
    const friendIds = friendsList.map((item) => item.steamid).slice(0, 100);
    if (!friendIds.length) return [];

    const summaryRes = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${friendIds.join(',')}`);
    const summaryJson = await summaryRes.json();
    
    const friendMap = new Map(friendsList.map(f => [f.steamid, f]));
    
    return (summaryJson?.response?.players || []).map((player) => {
      const status = Number(player.personastate || 0) > 0 ? 'online' : 'offline';
      const friendInfo = friendMap.get(player.steamid) || {};
      const isPlaying = !!player.gameextrainfo;
      return {
        id: player.steamid,
        name: player.personaname,
        realName: player.realname || '',
        status,
        isPlaying,
        game: player.gameextrainfo || '',
        gameAppId: player.gameid || null,
        avatar: player.avatarmedium || player.avatarfull || '',
        friendSince: friendInfo.friend_since || 0,
        lastOnline: player.lastlogoff || 0,
      };
    });
  } catch {
    return [];
  }
}

async function getSteamFriendsActivities(apiKey, steamId) {
  if (!apiKey || !steamId) return [];
  const activities = [];
  
  try {
    const listRes = await fetch(`https://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamId)}&relationship=friend`);
    const listJson = await listRes.json();
    const friendsList = listJson?.friendslist?.friends || [];
    const friendIds = friendsList.map((item) => item.steamid).slice(0, 30);
    if (!friendIds.length) return [];

    const summaryRes = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${friendIds.join(',')}`);
    const summaryJson = await summaryRes.json();
    const players = summaryJson?.response?.players || [];

    for (const player of players) {
      const friendSteamId = player.steamid;
      const friendName = player.personaname;
      const friendRealName = player.realname || '';
      const friendAvatar = player.avatarmedium || player.avatarfull || '';

      if (player.gameextrainfo) {
        activities.push({
          type: 'playing',
          friendId: friendSteamId,
          friendName,
          friendRealName,
          friendAvatar,
          game: player.gameextrainfo,
          gameAppId: player.gameid || null,
          timestamp: Date.now(),
        });
      }

      try {
        const recentRes = await fetch(`https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${friendSteamId}&count=5`);
        const recentJson = await recentRes.json();
        const recentGames = recentJson?.response?.games || [];
        
        for (const game of recentGames) {
          const isNewGame = (game.playtime_forever || 0) < 60;
          
          if (isNewGame) {
            activities.push({
              type: 'first_play',
              friendId: friendSteamId,
              friendName,
              friendRealName,
              friendAvatar,
              game: game.name,
              gameAppId: game.appid,
              timestamp: (game.rtime_last_played || 0) * 1000 || Date.now(),
            });
          }

          try {
            const achieveRes = await fetch(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${encodeURIComponent(apiKey)}&steamid=${friendSteamId}&appid=${game.appid}`);
            const achieveJson = await achieveRes.json();
            const achievements = achieveJson?.playerstats?.achievements || [];
            
            const recentAchievements = achievements
              .filter(a => a.achieved === 1 && a.unlocktime > 0)
              .sort((a, b) => b.unlocktime - a.unlocktime)
              .slice(0, 2);
            
            for (const ach of recentAchievements) {
              const unlockTime = ach.unlocktime * 1000;
              if (Date.now() - unlockTime < 14 * 24 * 60 * 60 * 1000) {
                activities.push({
                  type: 'achievement',
                  friendId: friendSteamId,
                  friendName,
                  friendRealName,
                  friendAvatar,
                  game: game.name,
                  gameAppId: game.appid,
                  achievement: ach.apiname || 'Achievement',
                  timestamp: unlockTime,
                });
              }
            }
          } catch {}
        }
      } catch {}
    }

    activities.sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
  
  return activities.slice(0, 50);
}

async function getSteamUserInfo(apiKey, steamId) {
  if (!apiKey || !steamId) return null;
  try {
    const res = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${steamId}`);
    const json = await res.json();
    const player = json?.response?.players?.[0];
    if (!player) return null;
    return {
      id: player.steamid,
      name: player.personaname,
      realName: player.realname || '',
      avatar: player.avatarfull || player.avatarmedium || '',
      status: Number(player.personastate || 0) > 0 ? 'online' : 'offline',
      game: player.gameextrainfo || '',
    };
  } catch {
    return null;
  }
}

async function importSteamOwnedGames(apiKey, steamId) {
  if (!apiKey || !steamId) {
    return { ok: false, error: '缺少 Steam API Key 或 SteamID64' };
  }

  try {
    const res = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamId)}&include_appinfo=1&include_played_free_games=1&format=json`);
    const payload = await res.json();
    const owned = payload?.response?.games || [];
    if (!owned.length) return { ok: false, error: '未能获取到已拥有的 Steam 游戏' };

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
          lastPlayed: basePayload.lastPlayed === '???' ? existing.lastPlayed : basePayload.lastPlayed,
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
    return { ok: false, error: error.message || '未知错误' };
  }
}

// ==================== 窗口与托盘管理 ====================

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Mizu',
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
  tray.setToolTip('Mizu - 游戏库');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
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
  if (!payload.title && !payload.titleEn) return { ok: false, error: '请提供游戏名称，中文或英文至少填写一项' };
  if (!payload.execPath) return { ok: false, error: '请指定可执行路径' };
  const games = readGames();
  const normalizedExecPath = payload.execPath.toLowerCase();
  const existingByPath = games.find(g => (g.execPath || '').toLowerCase() === normalizedExecPath);
  if (existingByPath) {
    return { ok: true, game: existingByPath, duplicate: true };
  }
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
ipcMain.handle('games:reorder', (_, orderedIds) => {
  if (!Array.isArray(orderedIds)) return { ok: false, error: '无效的顺序数据' };
  const games = readGames();
  const idToGame = new Map(games.map(g => [g.id, g]));
  const reordered = [];
  for (const id of orderedIds) {
    const game = idToGame.get(id);
    if (game) {
      reordered.push(game);
      idToGame.delete(id);
    }
  }
  reordered.push(...idToGame.values());
  writeGames(reordered);
  return { ok: true };
});

// ==================== 系统信息获取 ====================

function getDiskSpace() {
  const drives = [];
  try {
    const execSync = require('child_process').execSync;
    const output = execSync('powershell -Command "Get-CimInstance Win32_LogicalDisk | Where-Object {$_.DriveType -eq 3} | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json"', { encoding: 'utf8' });
    const parsed = JSON.parse(output);
    const diskList = Array.isArray(parsed) ? parsed : [parsed];
    for (const disk of diskList) {
      if (disk && disk.DeviceID && disk.Size > 0) {
        drives.push({
          drive: disk.DeviceID,
          free: disk.FreeSpace || 0,
          total: disk.Size,
          used: disk.Size - (disk.FreeSpace || 0),
        });
      }
    }
  } catch (err) {
    console.error('Failed to get disk space:', err);
  }
  return drives;
}

// ==================== IPC 处理器 ====================

ipcMain.handle('system:getDiskSpace', () => getDiskSpace());
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
      { name: '可执行文件', extensions: ['exe', 'bat', 'cmd', 'app', 'sh', 'lnk', 'url'] },
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
ipcMain.handle('steam:getUserInfo', (_, apiKey, steamId) => getSteamUserInfo(apiKey, steamId));
ipcMain.handle('steam:getFriendsActivities', (_, apiKey, steamId) => getSteamFriendsActivities(apiKey, steamId));
ipcMain.handle('steam:importOwnedGames', (_, apiKey, steamId) => importSteamOwnedGames(apiKey, steamId));
ipcMain.handle('games:scanInstalled', async () => {
  try {
    const games = await scanInstalledGames();
    return { ok: true, games };
  } catch (error) {
    return { ok: false, error: error.message || '未知错误', games: [] };
  }
});
ipcMain.handle('games:launch', (_, id) => {
  const games = readGames();
  const game = games.find((g) => g.id === id);
  if (!game) return { ok: false, error: '未找到对应游戏' };

  try {
    const launch = resolveLaunchCommand(game);
    const workingDir = normalizeWorkingDir(game.workingDir, launch.execPath);
    
    if (workingDir && !fs.existsSync(workingDir)) {
      return { ok: false, error: '工作目录不存在' };
    }

    if (isUriLaunchPath(launch.execPath)) {
      openUri(launch.execPath, workingDir);
    } else {
      if (!launch.execPath) {
        return { ok: false, error: '执行路径为空' };
      }
      
      if (!fs.existsSync(launch.execPath)) {
        return { ok: false, error: '可执行文件不存在' };
      }
      
      const ext = path.extname(launch.execPath).toLowerCase();
      
      if (process.platform === 'win32' && WIN_SHORTCUT_EXTENSIONS.has(ext)) {
        launchShortcut(launch.execPath, workingDir);
      } else {
        launchExecutable(launch.execPath, launch.args || [], workingDir);
      }
    }

    const nowIso = new Date().toISOString();
    const next = games.map((g) => (g.id === id ? { ...g, lastPlayed: nowIso, isRecent: true } : g));
    writeGames(next);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || '未知错误' };
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
