'use strict';
const {gzip}=require('node:zlib'),{promisify}=require('node:util');
const compress=promisify(gzip);
async function sendAndWait(res,send){
 if(typeof res.once!=='function')return send();
 await new Promise((resolve,reject)=>{const done=()=>{res.off('finish',done);res.off('close',done);resolve();};res.once('finish',done);res.once('close',done);try{send();}catch(error){res.off('finish',done);res.off('close',done);reject(error);}});
 return res;
}
async function sendFinanceLedger(req,res,result){
 res.set('Cache-Control','private, no-store');res.vary('Accept-Encoding');
 if(req.acceptsEncodings?.('gzip','identity')!=='gzip')return sendAndWait(res,()=>res.json({ok:true,...result}));
 const body=await compress(JSON.stringify({ok:true,...result}),{level:1});
 res.type('application/json');res.set('Content-Encoding','gzip');
 // Keep the analysis worker suspended through transmission, including a slow
 // or disconnected client, rather than retaining two full ledgers in memory.
 return sendAndWait(res,()=>res.send(body));
}
module.exports={sendFinanceLedger};
