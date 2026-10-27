'use strict';
const {validReferenceId,validDescriptor,objectIdFor} = require('../../shared/financeSourceArchiveProtocol');
const fail = () => Object.assign(new Error('BILL_ARCHIVE_METADATA_INVALID'),{code:'BILL_ARCHIVE_METADATA_INVALID'});
function descriptor(row, id) {
  if (!row) return null;
  const value={objectId:row.objectId,version:row.version,sha256:row.sha256,bytes:row.bytes};
  if (!validDescriptor(value) || value.objectId!==objectIdFor(id)) throw fail();
  return value;
}
function createBillNasMetadataRepository({query}={}) {
  if(typeof query!=='function') throw fail();
  return Object.freeze({
    async get(id) {
      if(!validReferenceId(id)) throw fail();
      const result=await query('SELECT object_id AS "objectId",object_version AS version,encrypted_sha256 AS sha256,encrypted_bytes AS bytes FROM business.personal_finance_source_objects WHERE reference_id=$1',[id]);
      return descriptor(result.rows[0],id);
    },
    async confirm(id,value,agentId) {
      if(!validReferenceId(id)||!validDescriptor(value)||value.objectId!==objectIdFor(id)||!/^[-A-Za-z0-9._]{3,64}$/.test(agentId||'')) throw fail();
      await query('INSERT INTO business.personal_finance_source_objects(reference_id,object_id,object_version,encrypted_sha256,encrypted_bytes,verified_agent_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(reference_id) DO NOTHING',[id,value.objectId,value.version,value.sha256,value.bytes,agentId]);
      const stored=await this.get(id);
      if(!stored || ['objectId','version','sha256','bytes'].some(key=>stored[key]!==value[key])) throw fail();
      return stored;
    },
  });
}
module.exports={createBillNasMetadataRepository};
