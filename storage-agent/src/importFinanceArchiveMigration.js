'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {createObjectStore}=require('./objectStore');
const {validReferenceId,objectIdFor,validDescriptor,sha256}=require('../../shared/financeSourceArchiveProtocol');
async function importFinanceArchiveMigration({nasRoot,manifestPath}) {
  const root=path.resolve(nasRoot),manifest=path.resolve(manifestPath);
  if(!manifest.startsWith(root+path.sep))throw Error('FINANCE_MIGRATION_PATH_INVALID');
  const raw=await fs.readFile(manifest),input=JSON.parse(raw.toString('utf8'));
  if(!input.ok||!Array.isArray(input.objects)||input.objects.length!==input.files)throw Error('FINANCE_MIGRATION_MANIFEST_INVALID');
  const store=createObjectStore({nasRoot:root});let bytes=0;
  for(const item of input.objects) {
    const ref=item.referenceId,d=item.descriptor;
    if(!validReferenceId(ref)||!validDescriptor(d)||d.objectId!==objectIdFor(ref))throw Error('FINANCE_MIGRATION_DESCRIPTOR_INVALID');
    const source=path.join(path.dirname(manifest),ref+'.enc'),stat=await fs.lstat(source);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==d.bytes)throw Error('FINANCE_MIGRATION_SOURCE_INVALID');
    const payload=await fs.readFile(source);
    if(sha256(payload)!==d.sha256||payload.subarray(0,4).toString()!=='GWB1')throw Error('FINANCE_MIGRATION_SOURCE_HASH_INVALID');
    await store.putVerified(d,payload);await store.readVerified(d);bytes+=payload.length;
  }
  if(bytes!==input.bytes)throw Error('FINANCE_MIGRATION_BYTES_INVALID');
  const receipt={ok:true,phase:'nas-objects-verified',files:input.files,bytes,manifestSha256:sha256(raw),agentVersion:require('../package.json').version};
  await fs.writeFile(path.join(path.dirname(manifest),'nas-import-receipt.json'),JSON.stringify(receipt,null,2),'utf8');
  return receipt;
}
if(require.main===module)importFinanceArchiveMigration({nasRoot:process.argv[2],manifestPath:process.argv[3]}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={importFinanceArchiveMigration};
