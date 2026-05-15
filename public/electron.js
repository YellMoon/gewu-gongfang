const { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
let autoUpdater = null;
const updateFeedUrl = (process.env.UPDATE_FEED_URL || 'https://gewugongfang.oss-cn-hangzhou.aliyuncs.com/desktop/').replace(/\/?$/, '/');
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.setFeedURL({ provider: 'generic', url: updateFeedUrl });
} catch (err) {
  autoUpdater = null;
}

const logDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'electron-main.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(logFile, line); } catch(e) {}
}

process.on('uncaughtException', (err) => {
  log('UNCAUGHT: ' + err.message + '\n' + err.stack);
});

let mainWindow;
let backendServer = null;

function findBackendApp() {
  const candidates = [
    path.join(process.resourcesPath || '', 'backend', 'src', 'app.js'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'backend', 'src', 'app.js'),
    path.join(app.getAppPath(), 'backend', 'src', 'app.js'),
    path.join(__dirname, '..', 'backend', 'src', 'app.js'),
    path.join(process.cwd(), 'backend', 'src', 'app.js'),
  ];
  for (const p of candidates) {
    log('Backend app candidate: ' + p + ' exists=' + fs.existsSync(p));
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function startBackendService() {
  if (process.env.DISABLE_EMBEDDED_BACKEND === '1') return;
  const appPath = findBackendApp();
  if (!appPath) {
    log('Backend app.js not found, embedded backend disabled');
    return;
  }
  try {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production';
    process.env.PORT = process.env.PORT || '3001';
    const appDataDir = app.getPath('userData');
    process.env.GEWU_DATA_DIR = process.env.GEWU_DATA_DIR || appDataDir;
    process.env.QUESTION_BANK_UPLOAD_DIR = process.env.QUESTION_BANK_UPLOAD_DIR || path.join(appDataDir, 'uploads', 'question-bank');
    const nodePath = path.join(app.getAppPath(), 'node_modules');
    process.env.NODE_PATH = process.env.NODE_PATH ? `${process.env.NODE_PATH}${path.delimiter}${nodePath}` : nodePath;
    require('module').Module._initPaths();
    const { createApp } = require(appPath);
    const backendApp = createApp();
    backendServer = backendApp.listen(Number(process.env.PORT), '127.0.0.1', () => {
      log(`Embedded backend listening on http://127.0.0.1:${process.env.PORT}`);
    });
    backendServer.on('error', err => log('Embedded backend error: ' + err.message));
  } catch (err) {
    log('Embedded backend start failed: ' + err.message + '\n' + err.stack);
  }
}

function createWindow() {
  log('createWindow, cwd=' + process.cwd());
  log('__dirname=' + __dirname);
  log('app.getAppPath=' + app.getAppPath());

  // ⑥ 去掉菜单栏和灰色区域
  Menu.setApplicationMenu(null);

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: screenWidth,
    height: screenHeight,
    minWidth: 1200,
    minHeight: 800,
    frame: true,
    backgroundColor: '#ffffff',
    show: false,
    title: '格物工坊',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      enableRemoteModule: false,
      webSecurity: true,
    }
  });

  // 打开时最大化
  mainWindow.maximize();

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
    mainWindow.show();
  } else {
    const candidates = [
      path.join(__dirname, 'index.html'),
      path.join(__dirname, 'build', 'index.html'),
      path.join(__dirname, '..', 'build', 'index.html'),
      path.join(process.resourcesPath, 'app.asar', 'build', 'index.html'),
      path.join(path.dirname(process.execPath), 'build', 'index.html'),
    ];

    let indexPath = null;
    for (const p of candidates) {
      log('Try: ' + p + ' exists=' + fs.existsSync(p));
      if (fs.existsSync(p)) {
        indexPath = p;
        break;
      }
    }

    if (indexPath) {
      log('Using indexPath=' + indexPath);
      mainWindow.loadFile(indexPath).then(() => {
        log('loadFile OK');
        mainWindow.show();
      }).catch(err => {
        log('loadFile failed: ' + err.message + ', trying loadURL...');
        const fileUrl = 'file:///' + indexPath.replace(/\\/g, '/');
        mainWindow.loadURL(fileUrl).then(() => {
          log('loadURL OK');
          mainWindow.show();
        }).catch(err2 => {
          log('loadURL also failed: ' + err2.message);
          showErrorPage('加载失败: ' + err2.message);
        });
      });
    } else {
      log('All paths failed!');
      showErrorPage('找不到应用文件');
    }
  }

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL();
    if (url !== currentUrl && /^https?:\/\//.test(url) && !url.startsWith('http://localhost:3000')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('did-fail-load', (e, code, desc) => {
    log('did-fail-load: ' + code + ' ' + desc);
  });
  mainWindow.webContents.on('render-process-gone', (e, details) => {
    log('render-process-gone: ' + details.reason + ' ' + details.exitCode);
  });
  mainWindow.webContents.on('console-message', (e, level, msg) => {
    if (level >= 2) log('[Renderer ERROR] ' + msg);
    else if (level === 1) log('[Renderer WARN] ' + msg);
  });
}

function showErrorPage(msg) {
  const html = `<html><body style="font-family:sans-serif;padding:50px;background:#fff">
    <h2>⚠️ ${msg}</h2>
    <p>请尝试用命令行启动查看详细日志：</p>
    <code>"${process.execPath}"</code>
    <p>日志位置：${logFile}</p>
  </body></html>`;
  mainWindow.loadURL('data:text/html,' + encodeURIComponent(html));
  mainWindow.show();
}

app.whenReady().then(() => {
  log('whenReady');
  startBackendService();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (backendServer) {
    backendServer.close();
    backendServer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendServer) {
    backendServer.close();
    backendServer = null;
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-user-data-path', () => app.getPath('userData'));
ipcMain.handle('open-external', (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    throw new Error('Invalid external URL');
  }
  return shell.openExternal(url);
});
ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater) return { success: false, error: 'autoUpdater unavailable' };
  try {
    log('check-for-updates feed=' + updateFeedUrl + ' version=' + app.getVersion());
    const result = await autoUpdater.checkForUpdates();
    return {
      success: true,
      updateInfo: result?.updateInfo || null,
      feedUrl: updateFeedUrl,
    };
  } catch (err) {
    log('check-for-updates failed: ' + err.message);
    return { success: false, error: err.message };
  }
});
ipcMain.handle('download-update', async () => {
  if (!autoUpdater) return { success: false, error: 'autoUpdater unavailable' };
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle('install-update', () => {
  if (!autoUpdater) return { success: false, error: 'autoUpdater unavailable' };
  autoUpdater.quitAndInstall(false, true);
  return { success: true };
});

if (autoUpdater) {
  autoUpdater.on('checking-for-update', () => log('checking-for-update'));
  autoUpdater.on('update-not-available', info => {
    log('update-not-available ' + JSON.stringify(info || {}));
    mainWindow?.webContents.send('update-not-available', info);
  });
  autoUpdater.on('update-available', info => {
    log('update-available ' + JSON.stringify(info || {}));
    mainWindow?.webContents.send('update-available', info);
  });
  autoUpdater.on('update-downloaded', info => {
    log('update-downloaded ' + JSON.stringify(info || {}));
    mainWindow?.webContents.send('update-downloaded', info);
  });
  autoUpdater.on('download-progress', info => mainWindow?.webContents.send('download-progress', info));
  autoUpdater.on('error', err => {
    log('update-error ' + err.message);
    mainWindow?.webContents.send('update-error', err.message);
  });
}
