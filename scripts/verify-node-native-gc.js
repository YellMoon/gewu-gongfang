'use strict';
const path=require('node:path');const {spawnSync}=require('node:child_process');
const source=String.raw`
const Database=require(process.argv[1]);const assert=require('node:assert/strict');
(async()=>{const db=new Database(':memory:');try{
 for(let batch=0;batch<20;batch++){
  for(let i=0;i<2000;i++){const row=db.prepare('SELECT ? AS n').get(i);assert.equal(row.n,i);}
  // Let ordinary allocation-driven GC callbacks run while the database remains open.
  await new Promise(resolve=>setImmediate(resolve));
 }
}finally{db.close();}console.log('SQLite statement GC and teardown passed');})().catch(e=>{console.error(e);process.exitCode=1;});
`;
function verifyNodeNativeGc({rootDir=path.resolve(__dirname,'..'),spawn=spawnSync}={}){
 for(const scope of ['', 'backend']){
  const modulePath=path.join(rootDir,scope,'node_modules','better-sqlite3');
  const result=spawn(process.execPath,['-e',source,modulePath],{stdio:'inherit',timeout:60000,shell:false});
  if(result.error)throw result.error;if(result.status!==0)throw Error('NODE_NATIVE_GC_FAILED:'+scope+':'+result.status);
 }
}
if(require.main===module)verifyNodeNativeGc();
module.exports={verifyNodeNativeGc};
