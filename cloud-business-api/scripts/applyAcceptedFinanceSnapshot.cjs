'use strict';
// Run through the administrator's authenticated deployment channel. Input is
// structured ledger JSON only; this command never reads or uploads bill files.
const fs=require('node:fs'),crypto=require('node:crypto'),{Pool}=require('pg');
const {applyAcceptedSnapshot}=require('../src/financeSnapshotMigration');
const option=name=>{const p=process.argv.indexOf('--'+name);return p>=0?process.argv[p+1]:undefined;};
async function main(){
 const inputPath=option('input'),expectedSha=option('sha256'),expectedDigest=option('baseline-digest'),expectedRevision=option('revision'),owner=[option('tenant'),option('owner')],migrationId=option('migration-id'),commit=process.argv.includes('--commit');
 if(!inputPath||!/^[a-f0-9]{64}$/.test(expectedSha||'')||!/^[a-f0-9]{64}$/.test(expectedDigest||'')||!/^\d+$/.test(expectedRevision||'')||owner.some(x=>!x)||!migrationId)throw Error('FINANCE_SNAPSHOT_CLI_INPUT_INVALID');
 const bytes=fs.readFileSync(inputPath);if(crypto.createHash('sha256').update(bytes).digest('hex')!==expectedSha)throw Error('FINANCE_SNAPSHOT_FILE_CHANGED');const accepted=JSON.parse(bytes.toString('utf8')).ledger;if(!accepted)throw Error('FINANCE_SNAPSHOT_LEDGER_REQUIRED');
 if(commit){const receipt=JSON.parse(fs.readFileSync(option('backup-receipt'),'utf8'));if(receipt.restoreVerified!==true||!/^[a-f0-9]{64}$/.test(receipt.sha256||'')||!receipt.root)throw Error('FINANCE_SNAPSHOT_VERIFIED_BACKUP_REQUIRED');}
 const pool=new Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),database:process.env.PGDATABASE,user:process.env.PGUSER,password:process.env.PGPASSWORD,connectionTimeoutMillis:10000});const c=await pool.connect();c.on('error',()=>{});
 try{await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await c.query('SET LOCAL ROLE vnext_pg17_business_owner');const result=await applyAcceptedSnapshot({query:(s,v)=>c.query(s,v),owner,accepted,expectedRevision,expectedDigest,migrationId});await c.query(commit?'COMMIT':'ROLLBACK');process.stdout.write(JSON.stringify({...result,committed:commit,sourceSha256:expectedSha})+'\n');}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();await pool.end();}
}
if(require.main===module)main().catch(e=>{process.stderr.write(String(e.code||e.message).replace(/\n.*/s,'').slice(0,300)+'\n');process.exitCode=1;});
module.exports={main};
