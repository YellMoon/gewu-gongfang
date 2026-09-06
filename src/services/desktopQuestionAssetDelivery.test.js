'use strict';
const assert = require('node:assert/strict');
(async () => {
  const { createDesktopIdentityClient } = await import('./desktopIdentityClient.mjs');
  const input = { baseUrl:'https://cloud.test', currentSession:{token:'teacher-token'}, assetKey:'a'.repeat(64) };
  async function run(states) {
    const calls = [], waits = [];
    let reads = 0;
    const client = createDesktopIdentityClient({
      desktopIdentity:{status:()=>({})},
      waitForAssetDelivery:async milliseconds => waits.push(milliseconds),
      fetchImpl:async (url, options) => {
        calls.push({url,method:options.method || 'GET',token:options.headers.Authorization});
        if (url.endsWith('/download')) return {ok:true,arrayBuffer:async()=>Uint8Array.from([137,80,78,71]).buffer};
        const state = states[Math.min(reads++,states.length-1)];
        return {ok:true,json:async()=>({ok:true,delivery:{deliveryId:'question_asset_delivery_12345678',mimeType:'image/png',...state}})};
      },
    });
    let result, error;
    try { result = await client.readCloudQuestionAsset(input); } catch (caught) { error = caught; }
    return {calls,waits,result,error};
  }
  const queued = await run([{status:'queued'},{status:'leased'},{status:'ready'}]);
  assert.equal(queued.error,undefined);
  assert.equal(queued.result,'data:image/png;base64,iVBORw==');
  assert.deepEqual(queued.calls.map(call=>call.method),['POST','GET','GET','GET']);
  assert.equal(queued.calls[1].url,'https://cloud.test/api/desktop/question-bank/asset-deliveries/question_asset_delivery_12345678');
  assert(queued.calls.every(call=>call.token==='Bearer teacher-token'));
  assert.deepEqual(queued.waits,[1000,2000]);
  const timeout = await run([{status:'queued'}]);
  assert.equal(timeout.error?.code,'DESKTOP_CLOUD_QUESTION_ASSET_PENDING');
  assert.equal(timeout.waits.length,60);
  assert(!timeout.calls.some(call=>call.url.endsWith('/download')));
  const changed = await run([{status:'queued'},{status:'ready',deliveryId:'question_asset_delivery_different'}]);
  assert.equal(changed.error?.code,'DESKTOP_CLOUD_QUESTION_ASSET_RESPONSE_INVALID');
  const invalid = await run([{status:'broken'}]);
  assert.equal(invalid.error?.code,'DESKTOP_CLOUD_QUESTION_ASSET_RESPONSE_INVALID');
  assert.equal(invalid.waits.length,0);
  console.log('desktop question asset polling checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
