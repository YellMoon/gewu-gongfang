'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {Readable}=require('node:stream');
const {createImapBillMailbox}=require('./billImapMailbox');
const actor={accountId:'owner'};
function fixture({uids=[7],structure,bytes=Buffer.from('bill'),validity=123n}={}){
 const calls=[];let fetching=false;const client={mailbox:{uidValidity:validity},on(){},connect:async()=>calls.push('connect'),getMailboxLock:async(name,options)=>{calls.push(['lock',name,options]);return{release(){calls.push('release');}};},search:async()=>uids,
 async *fetch(range,query,options){fetching=true;calls.push(['fetch',range,options]);for(const uid of range.split(',').map(Number))yield{uid,internalDate:new Date('2026-10-08T00:00:00Z'),bodyStructure:structure||{part:'2',disposition:'attachment',dispositionParameters:{filename:'bill.csv'},size:bytes.length}};fetching=false;},
 fetchOne:async(uid,query,options)=>{calls.push(['one',uid,options]);return{uid,bodyStructure:structure||{part:'2',disposition:'attachment',dispositionParameters:{filename:'bill.csv'},size:bytes.length}};},
 download:async(uid,part,options)=>{assert.equal(fetching,false,'fetch iterator must finish before download');calls.push(['download',uid,part,options]);return{meta:{},content:Readable.from([bytes])};},close(){calls.push('close');}};
 const mail=createImapBillMailbox({ownerAccountId:'owner',inboxId:'bill@agentmail.to',apiKey:'secret',parseBillFile:async({buffer})=>({records:[{size:buffer.length}],errors:[]}),clientFactory:options=>{calls.push(['options',options]);return client;}});return{mail,calls,client};
}
test('IMAP uses verified TLS and read-only owner inbox without HTTP or mutation',async()=>{
 const {mail,calls}=fixture();await assert.rejects(mail.check({actor:{accountId:'other'}}),/BILL_MAIL_ACCESS_DENIED/);assert.equal(calls.length,0);
 const result=await mail.check({actor});assert.equal(result.attachments[0].preview.records[0].size,4);assert.equal(result.attachments[0].messageId,'imap:123:7');
 const options=calls.find(c=>c[0]==='options')[1];assert.equal(options.host,'imap.agentmail.to');assert.equal(options.secure,true);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.logger,false);
 assert.deepEqual(calls.find(c=>c[0]==='lock'),['lock','INBOX',{readOnly:true}]);assert.equal(calls.at(-1),'close');assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('pagination uses stable UID identity and rejects changed UIDVALIDITY',async()=>{
 const {mail,calls}=fixture({uids:Array.from({length:35},(_,i)=>i+1)});const first=await mail.check({actor});assert.equal(first.messageCount,30);assert.equal(first.nextPageToken,'imap:123:6');
 const next=await mail.check({actor,pageToken:first.nextPageToken});assert.equal(next.messageCount,5);assert.equal(next.nextPageToken,null);
 assert.equal(calls.filter(c=>c[0]==='download').length,10);await assert.rejects(mail.check({actor,pageToken:'imap:122:6'}),/BILL_MAIL_UIDVALIDITY_CHANGED/);
 await assert.rejects(mail.getAttachment({actor,messageId:'imap:122:7',attachmentId:'part:2'}),/BILL_MAIL_UIDVALIDITY_CHANGED/);
});
test('exact MIME part is reread from trusted body structure and filenames come from server',async()=>{
 const {mail,calls}=fixture({structure:{childNodes:[{part:'1',parameters:{name:'wrong.csv'}},{part:'2.1',dispositionParameters:{filename:'bank.xlsx'}}]}});
 const result=await mail.getAttachment({actor,messageId:'imap:123:7',attachmentId:'part:2.1',filename:'attacker.csv'});assert.equal(result.filename,'bank.xlsx');assert.equal(calls.find(c=>c[0]==='download')[2],'2.1');
 await assert.rejects(mail.getAttachment({actor,messageId:'imap:123:7',attachmentId:'part:9'}),/BILL_MAIL_ATTACHMENT_NOT_FOUND/);
 await assert.rejects(mail.getAttachment({actor,messageId:'imap:123:7',attachmentId:'part:2.1\r\nSTORE'}),/BILL_MAIL_INPUT_INVALID/);
});
test('large decoded attachment stream is rejected and closed before parsing',async()=>{
 const {mail,client,calls}=fixture();let parsed=false,destroyed=false;
 client.download=async()=>{const content=Readable.from([Buffer.alloc(14*1024*1024),Buffer.alloc(14*1024*1024)]);content.on('close',()=>{destroyed=true;});return{meta:{},content};};
 await assert.rejects(mail.getAttachment({actor,messageId:'imap:123:7',attachmentId:'part:2'}),/BILL_MAIL_ATTACHMENT_TOO_LARGE/);await new Promise(r=>setImmediate(r));assert.equal(destroyed,true);assert.equal(parsed,false);assert.equal(calls.at(-1),'close');
});
test('missing filename and failed preview stay visible; remaining previews are deferred',async()=>{
 const {mail,client}=fixture({uids:[1,2,3,4,5,6,7],structure:{part:'2',disposition:'attachment'}});
 const result=await mail.check({actor});assert.equal(result.attachments.length,7);assert.ok(result.attachments.every(a=>a.code==='BILL_MAIL_FILENAME_UNAVAILABLE'));
 client.fetchOne=async()=>false;await assert.rejects(mail.getAttachment({actor,messageId:'imap:123:7',attachmentId:'part:2'}),/BILL_MAIL_MESSAGE_NOT_FOUND/);
 const ordinary=fixture({uids:[1,2,3,4,5,6,7]});const checked=await ordinary.mail.check({actor});assert.equal(checked.attachments.filter(a=>a.preview).length,5);assert.equal(checked.attachments.filter(a=>a.code==='BILL_MAIL_PREVIEW_DEFERRED').length,2);
});
test('network errors are sanitized and always close the read-only connection',async()=>{
 const {mail,client,calls}=fixture();client.connect=async()=>{throw Error('provider credential secret');};await assert.rejects(mail.check({actor}),/^Error: BILL_MAIL_PROVIDER_UNAVAILABLE$/);assert.equal(calls.at(-1),'close');
});
test('overall deadline closes the socket and late connection cannot open an inbox',async()=>{
 const {client,calls}=fixture();let finish;client.connect=()=>new Promise(resolve=>{finish=resolve;});
 const mail=createImapBillMailbox({ownerAccountId:'owner',inboxId:'bill@agentmail.to',apiKey:'secret',parseBillFile:async()=>({}),clientFactory:()=>client,timeoutMs:10});
 await assert.rejects(mail.check({actor}),/BILL_MAIL_TIMEOUT/);finish();await new Promise(r=>setImmediate(r));assert.equal(calls.some(c=>c[0]==='lock'),false);assert.equal(calls.at(-1),'close');
});
test('late download after the deadline is destroyed and never starts parsing',async()=>{
 const {client}=fixture();let finish,parsed=0;
 const content=Readable.from([Buffer.from('bill')]);
 client.download=()=>new Promise(resolve=>{finish=()=>resolve({content});});
 const mail=createImapBillMailbox({ownerAccountId:'owner',inboxId:'bill@agentmail.to',apiKey:'secret',parseBillFile:async()=>{parsed++;return{};},clientFactory:()=>client,timeoutMs:10});
 await assert.rejects(mail.check({actor}),/BILL_MAIL_TIMEOUT/);
 finish();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(parsed,0,'a timed-out request must never start a later parser');
 assert.equal(content.destroyed,true,'late returned streams must be discarded');
});
