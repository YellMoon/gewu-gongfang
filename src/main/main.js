const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: { preload: require("path").join(__dirname, "preload.js"), 
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, '../public/icon.png')
  });

  // 寮€鍙戠幆澧冨姞杞芥湰鍦版湇鍔″櫒锛岀敓浜х幆澧冨姞杞芥瀯寤烘枃浠?  const isDev = process.env.NODE_ENV !== 'production';
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../build/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ========== IPC 澶勭悊 - 鏁版嵁搴撴搷浣?==========
// 娉ㄦ剰锛氭暟鎹簱瀹為檯鍦ㄦ覆鏌撹繘绋嬩腑鍒濆鍖栵紝杩欓噷鍙浆鍙戣姹?
// 鍒濆鍖栨暟鎹簱锛堝湪娓叉煋杩涚▼涓墽琛岋級
ipcMain.handle('db:init', async () => {
  try {
    return { success: true };
  } catch (error) {
    console.error('鏁版嵁搴撳垵濮嬪寲澶辫触:', error);
    return { success: false, error: error.message };
  }
});

// 瀛︾敓绠＄悊
ipcMain.handle('student:getAll', async (event) => {
  try {
    return { success: true, data: [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('student:create', async (event, student) => {
  try {
    return { success: true, data: { ...student, id: Date.now().toString() } };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('student:update', async (event, id, updates) => {
  try {
    return { success: true, data: { id, ...updates } };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('student:delete', async (event, id) => {
  try {
    return { success: true, data: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 璇剧▼绠＄悊
ipcMain.handle('course:getAll', async (event) => {
  try {
    return { success: true, data: [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('course:create', async (event, course) => {
  try {
    return { success: true, data: { ...course, id: Date.now().toString() } };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('course:update', async (event, id, updates) => {
  try {
    return { success: true, data: { id, ...updates } };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('course:delete', async (event, id) => {
  try {
    return { success: true, data: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 鎺掕绠＄悊
ipcMain.handle('schedule:getAll', async (event) => {
  try {
    return { success: true, data: [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('schedule:create', async (event, schedule) => {
  try {
    return { success: true, data: { ...schedule, id: Date.now().toString() } };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('schedule:update', async (event, id, updates) => {
  try {
    return { success: true, data: { id, ...updates } };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('schedule:delete', async (event, id) => {
  try {
    return { success: true, data: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 璐㈠姟绠＄悊
ipcMain.handle('payment:create', async (event, payment) => {
  try {
    return { success: true, data: { ...payment, id: Date.now().toString() } };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('consumption:create', async (event, consumption) => {
  try {
    return { success: true, data: { ...consumption, id: Date.now().toString() } };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 鏁版嵁缁熻
ipcMain.handle('data:getRevenueStats', async (event, startDate, endDate) => {
  try {
    return { success: true, data: { total_revenue: 0, payment_count: 0 } };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('data:getConsumptionStats', async (event, startDate, endDate) => {
  try {
    return { success: true, data: { total_hours: 0, total_amount: 0, consumption_count: 0 } };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 鏁版嵁瀵煎嚭
ipcMain.handle('data:export', async (event) => {
  try {
    return { success: true, data: {} };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 鏁版嵁瀵煎叆
ipcMain.handle('data:import', async (event, data) => {
  try {
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

