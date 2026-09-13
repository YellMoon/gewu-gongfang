'use strict';
const assert = require('node:assert/strict');
const { createPaperExportTaskProcessor } = require('./paperExportTaskProcessor');
module.exports = (async () => {
  const task = { taskId:'paper_task_lease',claimToken:'a08dc8cc-23c9-48ee-bb85-d3a0b786a1a0',tenantId:'tenant',accountId:'account',format:'word',fileName:'paper.docx',request:{},snapshot:[] };
  const owned = { taskId:task.taskId,claimToken:task.claimToken };
  let tick, cleared = 0, renewals = 0, archiveCalls = 0, failCalls = 0;
  const lost = () => Object.assign(new Error('CLOUD_PAPER_EXPORT_CLAIM_LOST'), {code:'CLOUD_PAPER_EXPORT_CLAIM_LOST'});
  const base = {
    tasks:{claimNext:async()=>task,renew:async input=>{assert.deepEqual(input,owned);renewals++;},complete:async input=>assert.equal(input.claimToken,task.claimToken),defer:async input=>assert.deepEqual(input,owned),fail:async()=>{failCalls++;}},
    setTimer:fn=>{tick=fn;return 42;},clearTimer:id=>{assert.equal(id,42);cleared++;},
    render:async()=>{await tick();return {bytes:Buffer.from('word'),mimeType:'docx'};},
    archiveArtifact:async input=>{assert.equal(input.claimToken,task.claimToken);archiveCalls++;return {artifactId:'artifact'};},
  };
  assert.equal((await createPaperExportTaskProcessor(base).runOnce()).state,'archived');
  assert(renewals>=2,'renew periodically and immediately before archive'); assert.equal(cleared,1);
  archiveCalls=0;
  const interrupted = {...base,tasks:{...base.tasks,renew:async()=>{throw lost();}}};
  assert.equal((await createPaperExportTaskProcessor(interrupted).runOnce()).state,'abandoned');
  assert.equal(archiveCalls,0); assert.equal(failCalls,0); assert.equal(cleared,2);
  const archiveRejected = {...base,archiveArtifact:async()=>{throw lost();}};
  assert.equal((await createPaperExportTaskProcessor(archiveRejected).runOnce()).state,'abandoned');
  assert.equal(failCalls,0);
  const pending = {...base,render:async()=>{throw Object.assign(new Error('pending'),{code:'CLOUD_PAPER_EXPORT_MEDIA_PENDING'});}};
  assert.equal((await createPaperExportTaskProcessor(pending).runOnce()).state,'media_pending');
  assert.equal(cleared,4);
  const completedButReplyLost = {...base,tasks:{...base.tasks,complete:async()=>{throw new Error('network');},fail:async()=>{throw lost();}}};
  assert.equal((await createPaperExportTaskProcessor(completedButReplyLost).runOnce()).state,'abandoned');
  assert.equal(cleared,5,'all exit paths stop heartbeat');
  assert.throws(()=>createPaperExportTaskProcessor({...base,tasks:{...base.tasks,renew:undefined}}),/CONFIG_INVALID/);
  console.log('paper export execution heartbeat and lost-owner checks passed');
})();
if(require.main===module) module.exports.catch(error=>{console.error(error);process.exitCode=1;});
