'use strict';
// UTF-8: test-window control only. This function is serialized into Electron's main process.
async function resizeParityWindow({BrowserWindow}, {width, height, timeoutMs=8000}) {
  const win=BrowserWindow.getAllWindows()[0];
  if(!win) throw new Error('PARITY_WINDOW_MISSING');
  const snapshot=()=>({maximized:win.isMaximized(),bounds:win.getBounds(),contentSize:win.getContentSize()});
  const before=snapshot();
  if(win.isMaximized()) {
    await new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);win.removeListener('unmaximize',onRestored);};
      const onRestored=()=>{cleanup();resolve();};
      const timer=setTimeout(()=>{cleanup();reject(new Error('PARITY_WINDOW_UNMAXIMIZE_TIMEOUT'));},timeoutMs);
      win.once('unmaximize',onRestored);
      try { win.unmaximize(); } catch(error) {cleanup();reject(error);}
    });
  }
  win.setContentSize(width,height);
  return {before,after:snapshot()};
}
module.exports={resizeParityWindow};
