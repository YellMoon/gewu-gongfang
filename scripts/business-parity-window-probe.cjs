'use strict';
// UTF-8: isolate native window sizing in the original desktop without login or cloud writes.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {_electron}=require('playwright');
(async()=>{
  const root=path.resolve(__dirname,'..');
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'gewu-business-parity-'));
  const env={...process.env,NODE_ENV:'production',GEWU_PARITY_SHADOW_URL:'http://127.0.0.1:1',
    GEWU_DATA_DIR:path.join(out,'profile'),DB_PATH:path.join(out,'profile/data/scheduling.db')};
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_START_URL;delete env.GEWU_DESKTOP_LOGIN_FIXTURE;
  const server=require('node:net').createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  env.PORT=String(server.address().port);await new Promise(r=>server.close(r));
  const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),
    cwd:root,args:[path.join(__dirname,'business-parity-desktop-entry.cjs'),'--user-data-dir='+path.join(out,'profile')],env,timeout:45000});
  try {
    const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
    console.log(JSON.stringify({out,windows:await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({
      id:w.id,url:w.webContents.getURL(),visible:w.isVisible(),maximized:w.isMaximized(),resizable:w.isResizable(),
      enabled:w.isEnabled(),maximizable:w.isMaximizable(),fullscreen:w.isFullScreen(),bounds:w.getBounds(),normal:w.getNormalBounds(),content:w.getContentSize()})))}));
    for(const accept of [false,true]) {
      const dialogEvent=page.waitForEvent('dialog');
      const result=page.evaluate(()=>window.confirm('Native confirmation test'));
      const dialog=await dialogEvent;
      if(!process.argv.includes('--cdp-repro'))console.log(JSON.stringify({stage:'native_confirmation_waiting',expected:accept}));
      else if(accept)await dialog.accept();else await dialog.dismiss();
      console.log(JSON.stringify({confirmation:await result,enabled:await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isEnabled())}));
    }
    const attempts=[];
    for(const method of ['unmaximize','restore']) {
      attempts.push(await app.evaluate(async({BrowserWindow},method)=>{
        const win=BrowserWindow.getAllWindows()[0],events=[];
        const observe=()=>events.push({maximized:win.isMaximized(),bounds:win.getBounds()});
        win.on('unmaximize',observe);win.on('resize',observe);
        win[method]();await new Promise(r=>setTimeout(r,1000));
        const restored={maximized:win.isMaximized(),bounds:win.getBounds(),content:win.getContentSize()};
        win.setContentSize(1280,800);await new Promise(r=>setTimeout(r,500));
        win.removeListener('unmaximize',observe);win.removeListener('resize',observe);
        return{method,restored,after:{maximized:win.isMaximized(),bounds:win.getBounds(),content:win.getContentSize()},events};
      },method));
    }
    const result={attempts,renderer:await page.evaluate(()=>({width:innerWidth,height:innerHeight}))};
    fs.writeFileSync(path.join(out,'window-probe.json'),JSON.stringify(result,null,2),'utf8');
    console.log(JSON.stringify(result));
    require('node:assert/strict').deepEqual(result.renderer,{width:1280,height:800});
    for(const width of [1200,1280]) {
      await app.evaluate(require('./business-parity-window-size.cjs').resizeParityWindow,{width,height:800});
      await page.waitForFunction(expected=>innerWidth===expected,width);
    }
  } finally {await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
