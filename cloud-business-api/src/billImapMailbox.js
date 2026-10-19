'use strict';
const {readImapBillLinks,downloadWechatBill,decodeMimePart}=require('./wechatBillDownload');
const fail=code=>Object.assign(new Error(code),{code});
const supported=name=>/\.(csv|txt|xls|xlsx|zip|pdf|html?)$/i.test(name||'');
function parts(node,result=[]){
 if(!node||typeof node!=='object')return result;
 if(node.childNodes?.length){for(const child of node.childNodes)parts(child,result);}
 else if(node.part){const filename=node.dispositionParameters?.filename||node.parameters?.name||'';if(supported(filename)||node.disposition==='attachment'&&!filename)result.push({part:String(node.part),filename:String(filename).slice(0,180),size:node.size,encoding:node.encoding});}
 return result;
}
function statementParts(message){
 const attached=parts(message.bodyStructure);
 if(!/\u6c11\u751f.*\u4fe1\u7528\u5361.*\u8d26\u5355/.test(message.envelope?.subject||''))return attached;
 const visit=node=>{if(node?.childNodes?.length)node.childNodes.forEach(visit);else if(node?.part&&node.type==='text/html'&&!attached.some(p=>p.part===String(node.part)))attached.push({part:String(node.part),filename:'minsheng-email-statement.html',size:node.size,encoding:node.encoding,charset:node.parameters?.charset,source:'email-body'});};
 visit(message.bodyStructure);return attached;
}
function identity(value,prefix){
 const match=typeof value==='string'&&value.match(new RegExp('^'+prefix+':([1-9]\\d{0,9}):([1-9]\\d{0,9})$'));
 if(!match||Number(match[1])>4294967295||Number(match[2])>4294967295)throw fail('BILL_MAIL_INPUT_INVALID');
 return{validity:match[1],uid:Number(match[2])};
}
function createImapBillMailbox({ownerAccountId,inboxId,apiKey,parseBillFile,clientFactory,maxBytes=24*1024*1024,timeoutMs=45000,fetch=globalThis.fetch}){
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
  let data;
  try { data=await client.download(String(uid),part.part,{uid:true,maxBytes:maxBytes+1}); }
  catch(error){
   guard();if(!/unsupported BODY section/i.test(error.responseText||''))throw error;
   const limit=Math.ceil(maxBytes*1.5)+4096;
   const raw=await client.fetchOne(String(uid),{bodyParts:[{key:part.part,start:0,maxLength:limit+1}]},{uid:true});guard();
   const bytes=raw?.bodyParts?.get(part.part);if(!bytes||bytes.length>limit)throw fail('BILL_MAIL_ATTACHMENT_TOO_LARGE');
   const buffer=decodeMimePart(bytes,part);if(!buffer.length||buffer.length>maxBytes)throw fail('BILL_MAIL_ATTACHMENT_TOO_LARGE');return{filename:part.filename,buffer};
  }
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
  if(typeof attachmentId==='string'&&/^link:[a-f0-9]{64}$/.test(attachmentId))return withInbox(async(client,validity,guard)=>{
   validScope(id,validity);const message=await client.fetchOne(String(id.uid),{bodyStructure:true},{uid:true});guard();if(!message)throw fail('BILL_MAIL_MESSAGE_NOT_FOUND');message.uid=id.uid;
   const links=await readImapBillLinks(client,message,guard),link=links.find(item=>item.id===attachmentId);if(!link)throw fail('BILL_MAIL_ATTACHMENT_NOT_FOUND');
   return downloadWechatBill({url:link.url,filename:'微信支付账单-'+id.uid+'-'+(links.indexOf(link)+1)+'.zip',fetch,maxBytes,guard});
  });
  const match=typeof attachmentId==='string'&&attachmentId.match(/^part:([1-9]\d?(?:\.[1-9]\d?){0,12})$/);
  if(!match)throw fail('BILL_MAIL_INPUT_INVALID');
  return withInbox(async(client,validity,guard)=>{validScope(id,validity);const message=await client.fetchOne(String(id.uid),{bodyStructure:true,envelope:true},{uid:true});guard();if(!message)throw fail('BILL_MAIL_MESSAGE_NOT_FOUND');const part=statementParts(message).find(item=>item.part===match[1]);if(!part)throw fail('BILL_MAIL_ATTACHMENT_NOT_FOUND');return download(client,id.uid,part,guard);});
 }
 return Object.freeze({
  status({actor}){authorize(actor);return{address:inboxId,provider:'AgentMail',mode:'receive-only',transport:'imap',configured:true};},
  getAttachment,
  async previewAttachment(input){const source=await getAttachment(input);return parseBillFile({...source,password:input.password});},
  async check({actor,pageToken}){
   authorize(actor);const cursor=pageToken?identity(pageToken,'imap'):null;
   return withInbox(async(client,validity,guard)=>{
    if(cursor)validScope(cursor,validity);
    const all=await client.search({all:true},{uid:true});guard();if(!Array.isArray(all)||all.length>100000)throw fail('BILL_MAIL_MAILBOX_TOO_LARGE');
    const candidates=all.filter(uid=>Number.isSafeInteger(uid)&&uid>0&&uid<=4294967295&&(!cursor||uid<cursor.uid)).sort((a,b)=>b-a);
    const selected=candidates.slice(0,30),messages=[];
    // Finish FETCH before issuing DOWNLOAD: issuing another command inside the iterator deadlocks IMAP.
    if(selected.length)for await(const message of client.fetch([...selected].sort((a,b)=>a-b).join(','),{bodyStructure:true,internalDate:true,envelope:true},{uid:true})){guard();messages.push(message);}guard();
    messages.sort((a,b)=>b.uid-a.uid);const attachments=[];let budget=5;
    for(const message of messages){
     const metadata={subject:String(message.envelope?.subject||'').slice(0,200),sender:String(message.envelope?.from?.[0]?.address||'').slice(0,200)};
     for(const link of await readImapBillLinks(client,message,guard)){
      const item={messageId:'imap:'+validity+':'+message.uid,attachmentId:link.id,filename:'微信支付账单-'+message.uid+'.zip',source:'wechat-download-link',receivedAt:message.internalDate?.toISOString?.()||null,...metadata};
      if(budget--<=0){attachments.push({...item,code:'BILL_MAIL_PREVIEW_DEFERRED'});continue;}
      try{const source=await downloadWechatBill({url:link.url,filename:item.filename,fetch,maxBytes,guard});guard();item.filename=source.filename;item.preview=await parseBillFile(source);guard();}
      catch(error){guard();if(error.code==='BILL_MAIL_TIMEOUT')throw error;item.code=/^BILL_/.test(error.code||'')?error.code:'BILL_MAIL_PARSE_FAILED';}attachments.push(item);
     }
     for(const part of statementParts(message).slice(0,30)){
     guard();
     const item={messageId:'imap:'+validity+':'+message.uid,attachmentId:'part:'+part.part,filename:part.filename||'未命名附件',source:part.source||'attachment',receivedAt:message.internalDate?.toISOString?.()||null,...metadata};
     if(!part.filename){attachments.push({...item,code:'BILL_MAIL_FILENAME_UNAVAILABLE'});continue;}
     if(budget--<=0){attachments.push({...item,code:'BILL_MAIL_PREVIEW_DEFERRED'});continue;}
     try{const source=await download(client,message.uid,part,guard);guard();item.preview=await parseBillFile(source);guard();}catch(error){guard();if(error.code==='BILL_MAIL_TIMEOUT')throw error;item.code=/^BILL_/.test(error.code||'')?error.code:'BILL_MAIL_PARSE_FAILED';}
     attachments.push(item);
    }
    }
    return{address:inboxId,attachments,mailboxTotal:all.length,messageCount:messages.length,nextPageToken:candidates.length>30?'imap:'+validity+':'+selected.at(-1):null,checkedAt:new Date().toISOString()};
   });
  },
 });
}
module.exports={createImapBillMailbox};
