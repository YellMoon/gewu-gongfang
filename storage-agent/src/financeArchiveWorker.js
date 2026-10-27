'use strict';
const {validTask,sha256}=require('../../shared/financeSourceArchiveProtocol');
const fail=()=>Object.assign(new Error('STORAGE_BILL_BYTES_MISMATCH'),{code:'STORAGE_BILL_BYTES_MISMATCH'});
function createFinanceArchiveWorker({client,objectStore}) {
  if(!client||!['lease','download','complete','upload'].every(k=>typeof client[k]==='function')
    ||!objectStore||typeof objectStore.putVerified!=='function'||typeof objectStore.readVerified!=='function')throw fail();
  return Object.freeze({async runOnce(){
    const task=await client.lease();if(task===null)return{state:'idle'};
    if(!validTask(task))throw fail();
    if(task.operation==='store') {
      const bytes=await client.download(task);
      if(!Buffer.isBuffer(bytes)||bytes.length!==task.descriptor.bytes||sha256(bytes)!==task.descriptor.sha256||bytes.subarray(0,4).toString()!=='GWB1')throw fail();
      await objectStore.putVerified(task.descriptor,bytes);
      // putVerified performs a write/read/checksum check before issuing a receipt.
      await client.complete(task);
      return{state:'bill_archive_stored',taskId:task.taskId};
    }
    const bytes=await objectStore.readVerified(task.descriptor);
    await client.upload(task,bytes);
    return{state:'bill_archive_delivered',taskId:task.taskId};
  }});
}
module.exports={createFinanceArchiveWorker};
