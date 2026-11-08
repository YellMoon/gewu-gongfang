'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createLocalDockerReadiness} = require('./localDocker');
const {EventEmitter} = require('node:events');
test('an available Linux engine is reused with an explicit local host and clean environment', async () => {
  const calls=[];
  await createLocalDockerReadiness({env:{DOCKER_HOST:'remote',DOCKER_CONTEXT:'production'},run:async (...args)=>{calls.push(args);return {stdout:'linux\n'};}})();
  assert.equal(calls.length,1);
  assert.equal(calls[0][1][0],'--host');
  assert.equal(calls[0][2].env.DOCKER_HOST,undefined);
  assert.equal(calls[0][2].env.DOCKER_CONTEXT,undefined);
});
test('cold Windows startup waits for readiness and coalesces concurrent requests', async () => {
  let probes=0,starts=0,clock=0;
  const ensure=createLocalDockerReadiness({platform:'win32',now:()=>clock,wait:async ms=>{clock+=ms;},run:async (_command,args)=>{
    if(args[0]==='desktop'){starts++;return {stdout:''};}
    if(++probes<3)throw Error('pipe unavailable');
    return {stdout:'linux'};
  }});
  await Promise.all([ensure(),ensure()]);
  assert.equal(starts,1);assert.equal(probes,3);assert.equal(clock,2000);
});
test('startup timeout is bounded and a later request may retry', async () => {
  let clock=0,available=false;
  const ensure=createLocalDockerReadiness({platform:'win32',timeoutMs:4000,now:()=>clock,wait:async ms=>{clock+=ms;},run:async (_command,args)=>{
    if(args[0]==='desktop')return {stdout:''};
    if(!available)throw Error('offline');return {stdout:'linux'};
  }});
  await assert.rejects(ensure(),{code:'VNEXT_PG17_DOCKER_DESKTOP_READY_TIMEOUT'});
  assert.equal(clock,4000);available=true;await ensure();
});
test('missing Docker and Windows-container mode report actionable failures',async()=>{
  await assert.rejects(createLocalDockerReadiness({run:async()=>{throw Object.assign(Error(),{code:'ENOENT'});}})(),{code:'VNEXT_PG17_DOCKER_NOT_INSTALLED'});
  await assert.rejects(createLocalDockerReadiness({run:async()=>({stdout:'windows'})})(),{code:'VNEXT_PG17_DOCKER_LINUX_ENGINE_REQUIRED'});
});
test('older Docker CLIs launch the installed desktop executable without a shell',async()=>{
  let available=false,launched;
  const child=new EventEmitter();child.unref=()=>{};
  await createLocalDockerReadiness({platform:'win32',env:{ProgramFiles:'C:/Program Files'},exists:()=>true,
    run:async (_command,args)=>{if(args[0]==='desktop')throw Error('unknown command');if(!available)throw Error('offline');return {stdout:'linux'};},
    launch:(...args)=>{launched=args;available=true;queueMicrotask(()=>child.emit('spawn'));return child;}})();
  assert.ok(launched[0].endsWith('Docker Desktop.exe'));
  assert.deepEqual(launched[1],[]);assert.equal(launched[2].windowsHide,true);assert.equal(launched[2].stdio,'ignore');
});
