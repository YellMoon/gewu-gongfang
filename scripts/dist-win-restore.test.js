'use strict';
const assert=require('node:assert/strict');const {runWithRestore}=require('./dist-win-restore');
let calls=[];assert.throws(()=>runWithRestore(command=>{calls.push(command);return command==='dist:win:build'?7:0;}),/DESKTOP_BUILD_FAILED:7/);assert.deepEqual(calls,['dist:win:build','rebuild:node']);
calls=[];assert.throws(()=>runWithRestore(command=>{calls.push(command);if(command==='dist:win:build')throw Error('build spawn failed');return 0;}),/build spawn failed/);assert.deepEqual(calls,['dist:win:build','rebuild:node']);
assert.throws(()=>runWithRestore(command=>command==='rebuild:node'?9:0),/NODE_RESTORE_FAILED:9/);
console.log('Desktop packaging failure and spawn failure both restore Node native dependencies');
