'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express'),{gunzipSync}=require('node:zlib');
const {sendFinanceLedger}=require('./financeLedgerResponse');
test('authenticated ledger transport negotiates gzip and preserves source order and exact integers',async()=>{
 const ledger={revision:'9007199254740993',observations:Array.from({length:2000},(_,i)=>({id:String(i),amountMinor:'900719925474099123',description:'Original statement'}))};
 const app=express();app.get('/ledger',async(req,res)=>sendFinanceLedger(req,res,{ledger}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const http=require('node:http'),read=encoding=>new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port:server.address().port,path:'/ledger',headers:{'Accept-Encoding':encoding}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);}).on('error',reject);});
  const zipped=await read('gzip');assert.equal(zipped.headers['content-encoding'],'gzip');assert.equal(zipped.headers['cache-control'],'private, no-store');assert.equal(zipped.headers.vary,'Accept-Encoding');assert.match(zipped.headers['content-type'],/application\/json/);assert.deepEqual(JSON.parse(gunzipSync(zipped.body)),{ok:true,ledger});
  for(const encoding of ['identity','gzip;q=0, identity']){const plain=await read(encoding);assert.equal(plain.headers['content-encoding'],undefined);assert.deepEqual(JSON.parse(plain.body),{ok:true,ledger});assert.ok(zipped.body.length<plain.body.length/10);}
 }finally{await new Promise(r=>server.close(r));}
});
