'use strict';
const {MAX_ENCRYPTED_BYTES,validTask}=require('../../shared/financeSourceArchiveProtocol');
const fail=code=>Object.assign(new Error(code),{code});
function createFinanceArchiveClient({cloudBaseUrl,agentId,token,fetch:fetchImpl=globalThis.fetch,requestTimeoutMs=20000}={}) {
  let url;try{url=new URL(cloudBaseUrl);}catch(_){throw fail('STORAGE_BILL_CONFIG_INVALID');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!/^[-A-Za-z0-9._]{3,64}$/.test(agentId||'')
    ||typeof token!=='string'||token.length<24||typeof fetchImpl!=='function'||!Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<1||requestTimeoutMs>60000)throw fail('STORAGE_BILL_CONFIG_INVALID');
  const base=cloudBaseUrl.replace(/\/$/,'')+'/api/storage-agent/finance-archives';
  async function readBody(response,maximum) {
    if(!response.body?.getReader)return Buffer.from(await response.arrayBuffer());
    const reader=response.body.getReader(),chunks=[];let total=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>maximum){await reader.cancel();throw fail('STORAGE_BILL_RESPONSE_INVALID');}chunks.push(Buffer.from(value));}}
    finally{reader.releaseLock();}
    return Buffer.concat(chunks,total);
  }
  async function request(endpoint,body,binary=false,headers={},allowLegacyMissing=false) {
    const controller=new AbortController();let timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail('STORAGE_BILL_TIMEOUT'));},requestTimeoutMs);});
    const operation=(async()=>{
      const raw=Buffer.isBuffer(body);
      const response=await fetchImpl(base+endpoint,{method:'POST',headers:{'x-gewu-storage-agent-id':agentId,'x-gewu-storage-agent-token':token,'content-type':raw?'application/octet-stream':'application/json',...headers},body:raw?body:JSON.stringify(body),signal:controller.signal,redirect:'error'});
      if(response.status===404&&allowLegacyMissing){await response.body?.cancel?.();return{ok:true,task:null};}
      if(response.status!==200||!response.ok){await response.body?.cancel?.();throw fail('STORAGE_BILL_UNAVAILABLE');}
      if(binary){
        const declared=response.headers?.get('content-length');
        if(declared!==null&&declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>MAX_ENCRYPTED_BYTES))throw fail('STORAGE_BILL_RESPONSE_INVALID');
        const bytes=await readBody(response,MAX_ENCRYPTED_BYTES);
        if(bytes.length<33||bytes.length>MAX_ENCRYPTED_BYTES)throw fail('STORAGE_BILL_RESPONSE_INVALID');
        return bytes;
      }
      if(response.body?.getReader)return JSON.parse((await readBody(response,1024*1024)).toString('utf8'));
      return response.json();
    })();
    try{return await Promise.race([operation,deadline]);}
    catch(error){if(/^STORAGE_BILL_/.test(error.code||''))throw error;throw fail('STORAGE_BILL_UNAVAILABLE');}
    finally{clearTimeout(timer);}
  }
  function input(task){if(!validTask(task))throw fail('STORAGE_BILL_RESPONSE_INVALID');return{agentId,leaseToken:task.leaseToken};}
  function receipt(response,task){if(response?.ok!==true||response.receipt?.taskId!==task.taskId||response.receipt?.state!=='verified')throw fail('STORAGE_BILL_RESPONSE_INVALID');return response.receipt;}
  return Object.freeze({
    async lease(){const data=await request('/lease',{agentId},false,{},true);if(data?.ok!==true||data.task!==null&&!validTask(data.task))throw fail('STORAGE_BILL_RESPONSE_INVALID');return data.task;},
    download(task){return request('/'+task.taskId+'/download',input(task),true);},
    async complete(task){return receipt(await request('/'+task.taskId+'/complete',{...input(task),observedSha256:task.descriptor.sha256,observedBytes:task.descriptor.bytes}),task);},
    async upload(task,bytes){input(task);if(!Buffer.isBuffer(bytes)||bytes.length!==task.descriptor.bytes)throw fail('STORAGE_BILL_RESPONSE_INVALID');return receipt(await request('/'+task.taskId+'/upload',bytes,false,{'x-gewu-storage-agent-lease-token':task.leaseToken}),task);},
  });
}
module.exports={createFinanceArchiveClient};
