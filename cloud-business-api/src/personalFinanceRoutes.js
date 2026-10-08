'use strict';
function registerPersonalFinanceRoutes({app,finance,tenantId,desktopContext,miniappContext}){
 const invalid=()=>Object.assign(new Error('CLOUD_PERSONAL_FINANCE_INPUT_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_INPUT_INVALID'});
 const fields=(body,allowed)=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))throw invalid();return body;};
 const run=(context,work)=>async(req,res)=>{try{if(!finance||!tenantId)return res.status(503).json({ok:false,code:'CLOUD_PERSONAL_FINANCE_UNAVAILABLE'});const actor=await context(req);if(!actor?.roles?.some(r=>r==='teacher'||r==='super_admin'))throw Object.assign(new Error('denied'),{code:'CLOUD_PERSONAL_FINANCE_ACCESS_DENIED'});return res.json({ok:true,...await work(req,{tenantId,actor})});}catch(e){const code=/ACCESS_DENIED|IDENTITY_REJECTED/.test(e.code||'')?'CLOUD_PERSONAL_FINANCE_ACCESS_DENIED':typeof e.code==='string'&&e.code.startsWith('CLOUD_PERSONAL_FINANCE_')?e.code:'CLOUD_PERSONAL_FINANCE_UNAVAILABLE';const status=/ACCESS_DENIED/.test(code)?403:/NOT_FOUND/.test(code)?404:/CONFLICT|EXISTS|IMMUTABLE|INCOMPATIBLE/.test(code)?409:/UNAVAILABLE/.test(code)?503:400;return res.status(status).json({ok:false,code});}};
 for(const [prefix,context] of [['/api/business/personal-finance',desktopContext],['/api/business/miniapp-personal-finance',miniappContext]]){
  app.get(prefix+'/ledger',run(context,async(req,owner)=>({ledger:await finance.getLedger(owner)})));
  app.post(prefix+'/imports/preview',run(context,async(req,owner)=>({preview:await finance.previewImport({...owner,...fields(req.body,['filename','base64','financialAccountId','fieldMapping'])})})));
  app.post(prefix+'/imports',run(context,async(req,owner)=>{const body=fields(req.body,['filename','base64','financialAccountId','fieldMapping','expectedRevision']);const idempotencyKey=req.get('x-idempotency-key');if(typeof idempotencyKey!=='string'||!idempotencyKey.trim())throw invalid();return {receipt:await finance.import({...owner,...body,idempotencyKey})};}));
 }
 const prefix='/api/business/personal-finance';
 app.post(prefix+'/accounts',run(desktopContext,async(req,owner)=>{const body=fields(req.body,['account','expectedRevision']);return finance.createAccount({...owner,...body});}));
 app.patch(prefix+'/accounts/:id',run(desktopContext,async(req,owner)=>{const body=fields(req.body,['patch','expectedRevision']);return finance.updateAccount({...owner,...body,id:req.params.id});}));
 app.patch(prefix+'/transactions/:observationId',run(desktopContext,async(req,owner)=>{const body=fields(req.body,['patch','expectedRevision']);return finance.annotateObservation({...owner,...body,observationId:req.params.observationId});}));
 app.post(prefix+'/links',run(desktopContext,async(req,owner)=>{const body=fields(req.body,['link','expectedRevision']);return finance.createLink({...owner,...body});}));
 app.delete(prefix+'/links/:id',run(desktopContext,async(req,owner)=>{const body=fields(req.body||{},['expectedRevision']);return finance.deleteLink({...owner,...body,id:req.params.id});}));
 app.post(prefix+'/balance-snapshots',run(desktopContext,async(req,owner)=>{const body=fields(req.body,['snapshot','expectedRevision']);return finance.createBalanceSnapshot({...owner,...body});}));
}
module.exports={registerPersonalFinanceRoutes};
