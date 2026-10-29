'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const express=require('express');
const {createBillSourceArchive}=require('./billSourceArchive');
const {createBillNasArchive}=require('./billNasArchive');
const {registerBillNasArchiveRoutes}=require('./billNasArchiveRoutes');
const {createFinanceArchiveClient}=require('../../storage-agent/src/financeArchiveClient');
const {createFinanceArchiveWorker}=require('../../storage-agent/src/financeArchiveWorker');
const {createObjectStore}=require('../../storage-agent/src/objectStore');
function meta(){const rows=new Map();return{rows,async get(id){return rows.get(id)||null;},async confirm(id,d){rows.set(id,{...d});}};}
async function pending(transfers){for(let i=0;i<100;i++){if(transfers.status().pendingTransfers)return;await new Promise(r=>setImmediate(r));}throw Error('expected transfer');}
const input={tenantId:'tenant-a',ownerAccountId:'owner-a',filename:'bill.csv',buffer:Buffer.from('private source amount 123')};
test('real HTTP NAS storage roundtrip preserves encryption and never creates a cloud file or database byte payload',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bill-nas-'));const metadata=meta();const transfers=createBillNasArchive({metadata,waitMs:1000});
 const app=express();app.use(express.json());
 const token='x'.repeat(32),agentId='nas-test-agent';
 registerBillNasArchiveRoutes({app,transfers,storageAgent:{async authorize(value){if(value.agentId!==agentId||value.token!==token)throw Error('rejected');}}});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base='http://127.0.0.1:'+server.address().port;
 const client=createFinanceArchiveClient({cloudBaseUrl:'https://cloud.example',agentId,token,fetch:(url,options)=>fetch(url.replace('https://cloud.example',base),options)});
 const store=createObjectStore({nasRoot:root}),worker=createFinanceArchiveWorker({client,objectStore:store});
 const archive=createBillSourceArchive({root:path.join(root,'forbidden-cloud-disk'),key:Buffer.alloc(32,7),storage:transfers});
 try{
  const unauthorized=await fetch(base+'/api/storage-agent/finance-archives/lease',{method:'POST',headers:{'content-type':'application/json','x-gewu-storage-agent-id':agentId,'x-gewu-storage-agent-token':'wrong'},body:JSON.stringify({agentId})});
  assert.equal(unauthorized.status,403);
  const saved=archive(input);await pending(transfers);assert.equal((await worker.runOnce()).state,'bill_archive_stored');const reference=await saved;
  assert.deepEqual(await archive(input),reference,'an acknowledged immutable NAS source is reused');
  const descriptor=metadata.rows.get(reference.id),raw=await store.readVerified(descriptor);
  assert.equal(raw.subarray(0,4).toString(),'GWB1');assert.equal(raw.includes(input.buffer),false);
  assert.equal(Object.values(descriptor).some(Buffer.isBuffer),false);
  await assert.rejects(fs.access(path.join(root,'forbidden-cloud-disk')),e=>e.code==='ENOENT');
  const read=archive.read({...input,reference});await pending(transfers);await worker.runOnce();assert.deepEqual(await read,input.buffer);
  await assert.rejects(archive.read({...input,ownerAccountId:'other-owner',reference}),/BILL_ARCHIVE_SCOPE/);
  assert.equal(transfers.status().pendingTransfers,0);assert.equal(transfers.status().reservedBytes,0);
  const deniedUpload=await fetch(base+'/api/storage-agent/finance-archives/bill_transfer_fake/upload',{method:'POST',headers:{'content-type':'application/octet-stream','x-gewu-storage-agent-id':agentId,'x-gewu-storage-agent-token':'wrong'},body:raw});assert.equal(deniedUpload.status,403);
  await fs.writeFile(store.objectPath(descriptor),Buffer.alloc(raw.length));
  const corrupted=archive.read({...input,reference});const rejection=assert.rejects(corrupted,/NAS_UNAVAILABLE/);await pending(transfers);
  await assert.rejects(worker.runOnce(),/INTEGRITY_FAILED/);await rejection;
  assert.equal(transfers.status().reservedBytes,0,'failure releases every reserved byte');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});
test('NAS absence and malformed receipts fail closed without retaining a bill in metadata',async()=>{
 const metadata=meta(),transfers=createBillNasArchive({metadata,waitMs:40});const archive=createBillSourceArchive({key:Buffer.alloc(32,1),storage:transfers});
 const promise=archive(input),rejection=assert.rejects(promise,/NAS_UNAVAILABLE/);await pending(transfers);const task=transfers.lease();
 await assert.rejects(transfers.complete({...task,observedSha256:'0'.repeat(64),observedBytes:task.descriptor.bytes},'nas-test'),/RECEIPT_MISMATCH/);
 await rejection;assert.equal(metadata.rows.size,0);assert.equal(transfers.status().reservedBytes,0);assert.equal(transfers.lease(),null);
});
test('lease renewal rejects stale receipts and bounded transfers reject overflow',async()=>{
 let clock=100;const metadata=meta(),transfers=createBillNasArchive({metadata,waitMs:1000,leaseMs:10,maxPending:1,now:()=>clock});const archive=createBillSourceArchive({key:Buffer.alloc(32,1),storage:transfers});
 const first=archive(input);await pending(transfers);const stale=transfers.lease();clock+=11;const current=transfers.lease();assert.notEqual(stale.leaseToken,current.leaseToken);
 await assert.rejects(archive({...input,buffer:Buffer.from('different source')}),/BUSY/);
 await assert.rejects(transfers.complete({...stale,observedSha256:stale.descriptor.sha256,observedBytes:stale.descriptor.bytes},'nas-test'),/LEASE_REJECTED/);
 await transfers.complete({...current,observedSha256:current.descriptor.sha256,observedBytes:current.descriptor.bytes},'nas-test');await first;
 assert.equal(metadata.rows.size,1);assert.equal(transfers.status().reservedBytes,0);
});
test('finance transfer HTTP client covers stalled response bodies with an overall deadline',async()=>{
 const client=createFinanceArchiveClient({cloudBaseUrl:'https://cloud.example',agentId:'nas-test',token:'t'.repeat(32),requestTimeoutMs:20,fetch:async()=>({status:200,ok:true,json:()=>new Promise(()=>{})})});
 await assert.rejects(client.lease(),e=>e.code==='STORAGE_BILL_TIMEOUT');
});
test('memory reservation rejects source bytes beyond the configured budget before queuing',async()=>{
 const transfers=createBillNasArchive({metadata:meta(),maxBufferedBytes:33});
 const archive=createBillSourceArchive({key:Buffer.alloc(32,1),storage:transfers});
 await assert.rejects(archive(input),/BUSY/);assert.equal(transfers.status().reservedBytes,0);assert.equal(transfers.lease(),null);
});
test('new NAS clients remain compatible with a cloud version without finance transfer routes',async()=>{
 const client=createFinanceArchiveClient({cloudBaseUrl:'https://cloud.example',agentId:'nas-test',token:'t'.repeat(32),fetch:async()=>({status:404,ok:false,body:{cancel:async()=>{}}})});
 assert.equal(await client.lease(),null);
});
