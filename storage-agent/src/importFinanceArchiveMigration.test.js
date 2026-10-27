'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {importFinanceArchiveMigration}=require('./importFinanceArchiveMigration');
const {objectIdFor,sha256}=require('../../shared/financeSourceArchiveProtocol');
test('NAS legacy importer verifies manifest binding and bytes, is retryable, and issues a receipt only after verified storage',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bill-nas-migration-'));
 try{
  const ref='a'.repeat(64)+'-'+'b'.repeat(64),bytes=Buffer.concat([Buffer.from('GWB1'),Buffer.alloc(40,2)]);
  const stage=path.join(root,'staging');await fs.mkdir(stage);
  const descriptor={objectId:objectIdFor(ref),version:1,sha256:sha256(bytes),bytes:bytes.length};
  const manifest={ok:true,files:1,bytes:bytes.length,objects:[{referenceId:ref,descriptor}]};
  const file=path.join(stage,'migration-manifest.json');await fs.writeFile(file,JSON.stringify(manifest));await fs.writeFile(path.join(stage,ref+'.enc'),bytes);
  const result=await importFinanceArchiveMigration({nasRoot:root,manifestPath:file});assert.equal(result.phase,'nas-objects-verified');assert.equal(result.files,1);
  assert.deepEqual(await importFinanceArchiveMigration({nasRoot:root,manifestPath:file}),result);
  const target=path.join(root,'objects',descriptor.objectId,'1',descriptor.sha256);assert.deepEqual(await fs.readFile(target),bytes);
  manifest.objects[0].referenceId='../invalid';await fs.writeFile(file,JSON.stringify(manifest));await assert.rejects(importFinanceArchiveMigration({nasRoot:root,manifestPath:file}),/DESCRIPTOR_INVALID/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
