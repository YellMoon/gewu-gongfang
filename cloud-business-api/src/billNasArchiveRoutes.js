'use strict';
const express=require('express');
const {MAX_ENCRYPTED_BYTES}=require('../../shared/financeSourceArchiveProtocol');
function registerBillNasArchiveRoutes({app,transfers,storageAgent}) {
  const router=express.Router();
  router.use(async(req,res,next)=>{
    if(!transfers||!storageAgent||typeof storageAgent.authorize!=='function')return res.status(503).json({ok:false,code:'BILL_ARCHIVE_UNAVAILABLE'});
    const agentId=req.get('x-gewu-storage-agent-id'),token=req.get('x-gewu-storage-agent-token');
    if(!agentId||!token||req.body?.agentId&&req.body.agentId!==agentId)return res.status(403).json({ok:false,code:'STORAGE_AGENT_REJECTED'});
    try {await storageAgent.authorize({agentId,token});res.locals.financeArchiveAgentId=agentId;next();}
    catch(_){res.status(403).json({ok:false,code:'STORAGE_AGENT_REJECTED'});}
  });
  const handle=work=>async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{await work(req,res);}
    catch(error){const code=/^BILL_ARCHIVE_[A-Z_]+$/.test(error.code||'')?error.code:'BILL_ARCHIVE_UNAVAILABLE';res.status(/UNAVAILABLE|BUSY/.test(code)?503:409).json({ok:false,code});}
  };
  router.post('/lease',handle(async(req,res)=>{res.json({ok:true,task:transfers.lease()});}));
  router.post('/status',handle(async(req,res)=>{res.json({ok:true,...transfers.status()});}));
  router.post('/:taskId/download',handle(async(req,res)=>{
    const bytes=transfers.download({taskId:req.params.taskId,leaseToken:req.body?.leaseToken});
    res.type('application/octet-stream').send(bytes);
  }));
  router.post('/:taskId/complete',handle(async(req,res)=>{
    const receipt=await transfers.complete({taskId:req.params.taskId,leaseToken:req.body?.leaseToken,observedSha256:req.body?.observedSha256,observedBytes:req.body?.observedBytes},res.locals.financeArchiveAgentId);
    res.json({ok:true,receipt});
  }));
  // Authentication above must run before buffering uploaded bytes.
  router.post('/:taskId/upload',express.raw({type:'application/octet-stream',limit:MAX_ENCRYPTED_BYTES}),handle(async(req,res)=>{
    const receipt=transfers.upload({taskId:req.params.taskId,leaseToken:req.get('x-gewu-storage-agent-lease-token'),bytes:req.body});
    res.json({ok:true,receipt});
  }));
  app.use('/api/storage-agent/finance-archives',router);
}
module.exports={registerBillNasArchiveRoutes};
