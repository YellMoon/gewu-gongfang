'use strict';
const crypto=require('node:crypto');
const {MAX_ENCRYPTED_BYTES,sha256,validReferenceId,objectIdFor,validDescriptor}=require('../../shared/financeSourceArchiveProtocol');
const failure=code=>Object.assign(new Error(code),{code});
// File contents live only in these bounded request-scoped buffers. Only metadata is durable.
function createBillNasArchive({metadata,waitMs=30000,leaseMs=15000,maxPending=4,maxBufferedBytes=32*1024*1024,now=()=>Date.now()}={}) {
  if(!metadata||typeof metadata.get!=='function'||typeof metadata.confirm!=='function'
    || !Number.isSafeInteger(waitMs)||waitMs<10||waitMs>55000||!Number.isSafeInteger(leaseMs)||leaseMs<1
    ||!Number.isSafeInteger(maxPending)||maxPending<1||!Number.isSafeInteger(maxBufferedBytes)||maxBufferedBytes<33) throw failure('BILL_ARCHIVE_CONFIGURATION');
  const jobs=new Map(),stores=new Map();let reservedBytes=0,lastAgentSeenAt=null;
  function reference(input) {
    const ref=input?.reference;
    if(!ref||!validReferenceId(ref.id)||ref.id.slice(65)!==ref.fileHash) throw failure('BILL_ARCHIVE_SCOPE');
    return ref;
  }
  function enqueue(operation,id,descriptor,bytes=null) {
    if(jobs.size>=maxPending||reservedBytes+descriptor.bytes>maxBufferedBytes) throw failure('BILL_ARCHIVE_BUSY');
    const taskId='bill_transfer_'+crypto.randomBytes(16).toString('hex');
    let resolve,reject;
    const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});
    const job={taskId,operation,id,descriptor,bytes,promise,resolve,reject,leaseTokenHash:null,leaseExpires:0};
    job.timer=setTimeout(()=>{job.reject(failure('BILL_ARCHIVE_NAS_UNAVAILABLE'));},waitMs);
    jobs.set(taskId,job);reservedBytes+=descriptor.bytes;
    return job;
  }
  async function wait(job) {
    try{return await job.promise;}
    finally {
      clearTimeout(job.timer);
      if(jobs.delete(job.taskId)) reservedBytes-=job.descriptor.bytes;
      job.bytes=null;
      if(stores.get(job.id)===job) stores.delete(job.id);
    }
  }
  function leased(input,operation) {
    const job=jobs.get(input?.taskId);
    if(!job||job.operation!==operation||typeof input.leaseToken!=='string'||!job.leaseTokenHash
      ||sha256(input.leaseToken)!==job.leaseTokenHash||job.leaseExpires<=now()) throw failure('BILL_ARCHIVE_LEASE_REJECTED');
    return job;
  }
  const api={
    async put(input) {
      const ref=reference(input),bytes=input.bytes;
      if(!Buffer.isBuffer(bytes)||bytes.length<33||bytes.length>MAX_ENCRYPTED_BYTES||bytes.subarray(0,4).toString()!=='GWB1'
        ||bytes.length!==ref.byteLength+32) throw failure('BILL_ARCHIVE_SIZE');
      const existing=await metadata.get(ref.id);
      if(existing) {
        if(!validDescriptor(existing)||existing.objectId!==objectIdFor(ref.id)||existing.bytes!==bytes.length)throw failure('BILL_ARCHIVE_METADATA_INVALID');
        return;
      }
      const pending=stores.get(ref.id);
      if(pending){await pending.promise;return;}
      const descriptor={objectId:objectIdFor(ref.id),version:1,sha256:sha256(bytes),bytes:bytes.length};
      const job=enqueue('store',ref.id,descriptor,Buffer.from(bytes));stores.set(ref.id,job);
      await wait(job);
    },
    async read(input) {
      const ref=reference(input),descriptor=await metadata.get(ref.id);
      if(!validDescriptor(descriptor)||descriptor.objectId!==objectIdFor(ref.id)) throw failure('BILL_ARCHIVE_NOT_FOUND');
      return wait(enqueue('read',ref.id,descriptor));
    },
    lease() {
      lastAgentSeenAt=now();
      for(const job of jobs.values()) {
        if(job.leaseExpires>now()) continue;
        const leaseToken=crypto.randomBytes(32).toString('base64url');
        job.leaseTokenHash=sha256(leaseToken);job.leaseExpires=now()+leaseMs;
        return {taskId:job.taskId,operation:job.operation,descriptor:{...job.descriptor},leaseToken};
      }
      return null;
    },
    download(input) {return Buffer.from(leased(input,'store').bytes);},
    async complete(input,agentId) {
      const job=leased(input,'store');
      if(input.observedSha256!==job.descriptor.sha256||input.observedBytes!==job.descriptor.bytes) throw failure('BILL_ARCHIVE_RECEIPT_MISMATCH');
      await metadata.confirm(job.id,job.descriptor,agentId);
      if(jobs.get(job.taskId)!==job||job.leaseExpires<=now()) throw failure('BILL_ARCHIVE_LEASE_REJECTED');
      job.resolve();return {taskId:job.taskId,state:'verified'};
    },
    upload(input) {
      const job=leased(input,'read'),bytes=input.bytes;
      if(!Buffer.isBuffer(bytes)||bytes.length!==job.descriptor.bytes||sha256(bytes)!==job.descriptor.sha256) throw failure('BILL_ARCHIVE_RECEIPT_MISMATCH');
      job.resolve(Buffer.from(bytes));return {taskId:job.taskId,state:'verified'};
    },
    status() {return {backend:'nas',protocolVersion:1,pendingTransfers:jobs.size,reservedBytes,lastAgentSeenAt};},
  };
  return Object.freeze(api);
}
module.exports={createBillNasArchive};
