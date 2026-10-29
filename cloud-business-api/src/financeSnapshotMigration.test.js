'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {ledgerDigest,planAcceptedSnapshot,assertSnapshotReadback}=require('./financeSnapshotMigration');
const empty=()=>({revision:'0',accounts:[],observations:[],annotations:[],links:[],balanceSnapshots:[],imports:[]});
const account={id:'a',label:'A',provider:'manual',type:'bank',maskedIdentifier:'',currency:'CNY',openingBalanceMinor:null,openingDate:null,status:'active'};
const accepted=()=>({...empty(),revision:'3',accounts:[account]});
test('administrative snapshot requires the exact revision and entire baseline; no removal or source replacement',()=>{
 const before=empty(),l=accepted(),input={before,accepted:l,expectedRevision:'0',expectedDigest:ledgerDigest(before)};
 assert.equal(planAcceptedSnapshot(input).revision,'4');
 assert.throws(()=>planAcceptedSnapshot({...input,expectedRevision:'1'}),/BASELINE_CHANGED/);
 assert.throws(()=>planAcceptedSnapshot({...input,expectedDigest:'a'.repeat(64)}),/BASELINE_CHANGED/);
 const existing={...before,accounts:[account]};
 assert.throws(()=>planAcceptedSnapshot({...input,before:existing,expectedDigest:ledgerDigest(existing),accepted:empty()}),/ROW_MISSING/);
 assert.throws(()=>planAcceptedSnapshot({...input,before:existing,expectedDigest:ledgerDigest(existing),accepted:{...l,accounts:[{...account,maskedIdentifier:'9999'}]}}),/IDENTITY_CHANGED/);
 const original={id:'observation'};const prior={...existing,observations:[original]};
 assert.throws(()=>planAcceptedSnapshot({...input,before:prior,expectedDigest:ledgerDigest(prior),accepted:{...l,observations:[{...original,amountMinor:'1'}]}}),/IMMUTABLE_ROW_CHANGED/);
});
test('readback checks exact accepted order and only explicit missing metadata normalizations',()=>{
 const l=accepted(),actual={...l,revision:'4'};assertSnapshotReadback({actual,accepted:l,revision:'4'});
 assert.throws(()=>assertSnapshotReadback({actual:{...actual,accounts:[{...account,label:'Other'}]},accepted:l,revision:'4'}),/ACCOUNTS_MISMATCH/);
 const pair={...l,accounts:[account,{...account,id:'b'}]};
 assert.throws(()=>assertSnapshotReadback({actual:{...pair,revision:'4',accounts:[...pair.accounts].reverse()},accepted:pair,revision:'4'}),/ACCOUNTS_MISMATCH/);
});
