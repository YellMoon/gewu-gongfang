'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{verifyPackagedRuntimes}=require('./verify-packaged-runtimes');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gewu-packaged-runtimes-'));
try{
 assert.throws(()=>verifyPackagedRuntimes({appRoot:''}),/ROOT_REQUIRED/);
 assert.throws(()=>verifyPackagedRuntimes({appRoot:temp,platform:'win32'}),/PYTHON_RUNTIME_MISSING/);
 for(const relative of ['runtime/python/python.exe','runtime/ruby/bin/ruby.exe']){const file=path.join(temp,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'synthetic-only',{encoding:'utf8'});}
 const calls=[],spawn=(file,args,options)=>{calls.push({file,args,options});return{status:0,stdout:file.endsWith('python.exe')?'GEWU_PACKAGED_PYTHON_OK':'GEWU_PACKAGED_RUBY_OK'};};
 assert.deepEqual(verifyPackagedRuntimes({appRoot:temp,platform:'win32',spawn,env:{PYTHONPATH:'external',GEM_PATH:'external',SAFE:'retained'},log:()=>{}}),{python:true,ruby:true});
 assert.equal(calls.length,2);for(const call of calls){assert(call.file.startsWith(temp+path.sep));assert.equal(call.options.shell,false);assert.equal(call.options.env.PYTHONPATH,undefined);assert.equal(call.options.env.GEM_PATH,undefined);assert.equal(call.options.env.SAFE,'retained');}
 assert.throws(()=>verifyPackagedRuntimes({appRoot:temp,platform:'win32',spawn:()=>({status:1,stdout:''}),log:()=>{}}),/PYTHON_RUNTIME_FAILED/);
 assert.throws(()=>verifyPackagedRuntimes({appRoot:temp,platform:'win32',spawn:file=>({status:0,stdout:file.endsWith('python.exe')?'GEWU_PACKAGED_PYTHON_OK':'external ruby'}),log:()=>{}}),/RUBY_RUNTIME_FAILED/);
 console.log('packaged runtime presence, isolated module loading, document roundtrip and fail-closed checks passed');
}finally{assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'gewu-packaged-runtimes-'));fs.rmSync(temp,{recursive:true,force:true});}
