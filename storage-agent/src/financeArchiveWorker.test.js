'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFinanceArchiveWorker}=require('./financeArchiveWorker');
const {sha256}=require('../../shared/financeSourceArchiveProtocol');
const bytes=Buffer.concat([Buffer.from('GWB1'),Buffer.alloc(40,1)]);
const task={taskId:'bill_transfer_'+'a'.repeat(32),operation:'store',descriptor:{objectId:'obj_bill_'+'b'.repeat(64),version:1,sha256:sha256(bytes),bytes:bytes.length},leaseToken:'t'.repeat(43)};
test('NAS stores and verifies encrypted bytes before acknowledging; a storage failure never acknowledges',async()=>{
 const calls=[];const client={lease:async()=>task,download:async()=>bytes,complete:async()=>calls.push('ack'),upload:async()=>{throw Error('unexpected');}};
 const objectStore={putVerified:async(d,b)=>{assert.deepEqual(d,task.descriptor);assert.deepEqual(b,bytes);calls.push('stored');},readVerified:async()=>bytes};
 const worker=createFinanceArchiveWorker({client,objectStore});assert.equal((await worker.runOnce()).state,'bill_archive_stored');assert.deepEqual(calls,['stored','ack']);
 calls.length=0;objectStore.putVerified=async()=>{throw Error('disk unavailable');};await assert.rejects(worker.runOnce(),/disk unavailable/);assert.deepEqual(calls,[]);
 client.download=async()=>Buffer.alloc(bytes.length);await assert.rejects(worker.runOnce(),/BYTES_MISMATCH/);assert.deepEqual(calls,[]);
});
test('NAS read requests upload only bytes from the verified object store',async()=>{
 const client={lease:async()=>({...task,operation:'read'}),download:async()=>{throw Error('unexpected');},complete:async()=>{throw Error('unexpected');},upload:async(t,b)=>assert.deepEqual(b,bytes)};
 const worker=createFinanceArchiveWorker({client,objectStore:{putVerified:async()=>{},readVerified:async d=>{assert.deepEqual(d,task.descriptor);return bytes;}}});
 assert.equal((await worker.runOnce()).state,'bill_archive_delivered');client.lease=async()=>null;assert.equal((await worker.runOnce()).state,'idle');
});
