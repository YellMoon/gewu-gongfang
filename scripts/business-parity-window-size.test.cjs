'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { resizeParityWindow } = require('./business-parity-window-size.cjs');

(async()=>{
  for(const maximized of [false,true]) {
    const win = new EventEmitter();
    let full=maximized, size=[1536,890], calls=0;
    win.isMaximized=()=>full;
    win.getContentSize=()=>size.slice();
    win.getBounds=()=>({x:0,y:0,width:size[0],height:size[1]});
    win.unmaximize=()=>setTimeout(()=>{full=false;size=[1400,900];win.emit('unmaximize');},10);
    win.setContentSize=(width,height)=>{
      assert.equal(full,false,'must await unmaximize before requesting the size');
      calls++;size=[width,height];
    };
    const result=await resizeParityWindow({BrowserWindow:{getAllWindows:()=>[win]}},{width:1280,height:800});
    assert.deepEqual(result.before.contentSize,[1536,890]);
    assert.deepEqual(result.after.contentSize,[1280,800]);
    assert.equal(calls,1);assert.equal(win.listenerCount('unmaximize'),0);
  }
  await assert.rejects(()=>resizeParityWindow({BrowserWindow:{getAllWindows:()=>[]}},{width:1280,height:800}),/PARITY_WINDOW_MISSING/);
  console.log('parity window sizing waits for native unmaximize and preserves requested dimensions');
})().catch(error=>{console.error(error);process.exitCode=1;});
