const { app, BrowserWindow, Menu, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');

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
    webPreferences: { 
      nodeIntegration: true, 
      contextIsolation: false 
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
    // 生产环境：按优先级尝试多种路径
    const candidates = [
      path.join(__dirname, 'index.html'),                          // electron.js 与 index.html 同目录
      path.join(__dirname, 'build', 'index.html'),                 // build 子目录
      path.join(__dirname, '..', 'build', 'index.html'),           // 上级 build 目录
      path.join(process.resourcesPath, 'app.asar', 'build', 'index.html'), // asar 内 build
      path.join(path.dirname(process.execPath), 'build', 'index.html'),    // exe 同级 build
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
      // 优先使用 loadFile（兼容性更好），失败再回退 loadURL
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
  const html = `<html><body style="font-family:sans-serif;padding:50px">
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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-app-version', () => app.getVersion());
