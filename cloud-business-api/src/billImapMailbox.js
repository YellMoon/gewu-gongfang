'use strict';
const fail=code=>Object.assign(new Error(code),{code});
const supported=name=>/\.(csv|txt|xls|xlsx|zip|pdf|html?)$/i.test(name||'');
function parts(node,result=[]){
 if(!node||typeof node!=='object')return result;
 if(node.childNodes?.length){for(const child of node.childNodes)parts(child,result);}
 else if(node.part){const filename=node.dispositionParameters?.filename||node.parameters?.name||'';if(supported(filename)||node.disposition==='attachment'&&!filename)result.push({part:String(node.part),filename:String(filename).slice(0,180),size:node.size});}
 return result;
}
function identity(value,prefix){
 const match=typeof value==='string'&&value.match(new RegExp('^'+prefix+':([1-9]\\d{0,9}):([1-9]\\d{0,9})$'));
 if(!match||Number(match[1])>4294967295||Number(match[2])>4294967295)throw fail('BILL_MAIL_INPUT_INVALID');
 return{validity:match[1],uid:Number(match[2])};
}
function createImapBillMailbox({ownerAccountId,inboxId,apiKey,parseBillFile,clientFactory,maxBytes=24*1024*1024,timeoutMs=45000}){
 if(!ownerAccountId||!inboxId||!apiKey||typeof parseBillFile!=='function')throw fail('BILL_MAIL_CONFIGURATION');
 const authorize=actor=>{if(actor?.accountId!==ownerAccountId)throw fail('BILL_MAIL_ACCESS_DENIED');};
 const factory=clientFactory||((options)=>new(require('imapflow').ImapFlow)(options));
 async function withInbox(work){
  const client=factory({host:'imap.agentmail.to',port:993,secure:true,tls:{rejectUnauthorized:true},auth:{user:inboxId,pass:apiKey},logger:false,disableAutoIdle:true,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000});
  // The library emits transport errors in addition to rejecting the active command.
  client.on('error',()=>{});
  let lock,timer,aborted=false;const streams=new Set();
  const guard=()=>{if(aborted)throw fail('BILL_MAIL_TIMEOUT');};
  guard.track=content=>streams.add(content);guard.untrack=content=>streams.delete(content);
  const destroyStreams=()=>{for(const content of streams)content.destroy();streams.clear();};
  const operation=(async()=>{await client.connect();guard();lock=await client.getMailboxLock('INBOX',{readOnly:true});if(aborted){lock.release();lock=null;guard();}return work(client,String(client.mailbox.uidValidity),guard);})();
  try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>{aborted=true;destroyStreams();client.close();reject(fail('BILL_MAIL_TIMEOUT'));},timeoutMs);})]);}
  catch(error){throw /^BILL_MAIL_/.test(error.code||'')?error:fail('BILL_MAIL_PROVIDER_UNAVAILABLE');}
  finally{aborted=true;clearTimeout(timer);destroyStreams();lock?.release();client.close();}
 }
 function validScope(id,validity){if(id.validity!==validity)throw fail('BILL_MAIL_UIDVALIDITY_CHANGED');}
 async function download(client,uid,part,guard){
  guard();
  if(!/^[1-9]\d?(?:\.[1-9]\d?){0,12}$/.test(part.part))throw fail('BILL_MAIL_INPUT_INVALID');
  if(!part.filename)throw fail('BILL_MAIL_FILENAME_UNAVAILABLE');
  if(part.size>Math.ceil(maxBytes*1.5)+4096)throw fail('BILL_MAIL_ATTACHMENT_TOO_LARGE');
  const data=await client.download(String(uid),part.part,{uid:true,maxBytes:maxBytes+1});
  if(!data?.content){guard();throw fail('BILL_MAIL_ATTACHMENT_NOT_FOUND');}
  guard.track(data.content);
  const chunks=[];let size=0;
  try{guard();for await(const chunk of data.content){guard();size+=chunk.length;if(size>maxBytes)throw fail('BILL_MAIL_ATTACHMENT_TOO_LARGE');chunks.push(Buffer.from(chunk));}guard();}
  finally{guard.untrack(data.content);data.content.destroy();}
  if(!size)throw fail('BILL_MAIL_ATTACHMENT_EMPTY');
  return{filename:part.filename,buffer:Buffer.concat(chunks,size)};
 }
 async function getAttachment({actor,messageId,attachmentId}){
  authorize(actor);const id=identity(messageId,'imap');
  const match=typeof attachmentId==='string'&&attachmentId.match(/^part:([1-9]\d?(?:\.[1-9]\d?){0,12})$/);
  if(!match)throw fail('BILL_MAIL_INPUT_INVALID');
  return withInbox(async(client,validity,guard)=>{validScope(id,validity);const message=await client.fetchOne(String(id.uid),{bodyStructure:true},{uid:true});guard();if(!message)throw fail('BILL_MAIL_MESSAGE_NOT_FOUND');const part=parts(message.bodyStructure).find(item=>item.part===match[1]);if(!part)throw fail('BILL_MAIL_ATTACHMENT_NOT_FOUND');return download(client,id.uid,part,guard);});
 }
 return Object.freeze({
  status({actor}){authorize(actor);return{address:inboxId,provider:'AgentMail',mode:'receive-only',transport:'imap',configured:true};},
  getAttachment,
  async previewAttachment(input){const source=await getAttachment(input);return parseBillFile(source);},
  async check({actor,pageToken}){
   authorize(actor);const cursor=pageToken?identity(pageToken,'imap'):null;
   return withInbox(async(client,validity,guard)=>{
    if(cursor)validScope(cursor,validity);
    const all=await client.search({all:true},{uid:true});guard();if(!Array.isArray(all)||all.length>100000)throw fail('BILL_MAIL_MAILBOX_TOO_LARGE');
    const candidates=all.filter(uid=>Number.isSafeInteger(uid)&&uid>0&&uid<=4294967295&&(!cursor||uid<cursor.uid)).sort((a,b)=>b-a);
    const selected=candidates.slice(0,30),messages=[];
    // Finish FETCH before issuing DOWNLOAD: issuing another command inside the iterator deadlocks IMAP.
    if(selected.length)for await(const message of client.fetch(selected.join(','),{bodyStructure:true,internalDate:true},{uid:true})){guard();messages.push(message);}guard();
    messages.sort((a,b)=>b.uid-a.uid);const attachments=[];let budget=5;
    for(const message of messages)for(const part of parts(message.bodyStructure).slice(0,30)){
     guard();
     const item={messageId:'imap:'+validity+':'+message.uid,attachmentId:'part:'+part.part,filename:part.filename||'未命名附件',receivedAt:message.internalDate?.toISOString?.()||null};
     if(!part.filename){attachments.push({...item,code:'BILL_MAIL_FILENAME_UNAVAILABLE'});continue;}
     if(budget--<=0){attachments.push({...item,code:'BILL_MAIL_PREVIEW_DEFERRED'});continue;}
     try{const source=await download(client,message.uid,part,guard);guard();item.preview=await parseBillFile(source);guard();}catch(error){guard();if(error.code==='BILL_MAIL_TIMEOUT')throw error;item.code=/^BILL_/.test(error.code||'')?error.code:'BILL_MAIL_PARSE_FAILED';}
     attachments.push(item);
    }
    return{address:inboxId,attachments,messageCount:messages.length,nextPageToken:candidates.length>30?'imap:'+validity+':'+selected.at(-1):null,checkedAt:new Date().toISOString()};
   });
  },
 });
}
module.exports={createImapBillMailbox};
