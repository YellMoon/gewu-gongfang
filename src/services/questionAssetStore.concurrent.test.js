const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
let fetches=0,unblock;
const wait=new Promise(r=>unblock=r);
const db={transaction(){const tx={objectStore(){return {get(){const req={};queueMicrotask(()=>req.onsuccess());return req;},put(){queueMicrotask(()=>tx.oncomplete());}}}};return tx;}};
const indexedDB={open(){const req={result:db};queueMicrotask(()=>req.onsuccess());return req;}};
const moduleObject={exports:{}};
new Function('module','exports','indexedDB','window',ts.transpileModule(fs.readFileSync('src/services/questionAssetStore.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(moduleObject,moduleObject.exports,indexedDB,{});
global.window={desktopIdentitySessionProvider:{readCloudQuestionAsset:async()=>{fetches++;await wait;return 'data:image/png;base64,YQ==';}}};
(async()=>{const api=moduleObject.exports;const results=[api.getQuestionAssetDataUrl('same'),api.getQuestionAssetDataUrl('question-asset://same')];await new Promise(r=>setImmediate(r));assert.equal(fetches,1,'card and image must share one in-flight cloud delivery');unblock();assert.deepEqual(await Promise.all(results),['data:image/png;base64,YQ==','data:image/png;base64,YQ==']);console.log('asset in-flight coalescing passed');})().catch(e=>{console.error(e);process.exitCode=1;});
