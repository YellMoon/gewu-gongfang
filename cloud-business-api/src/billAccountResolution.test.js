'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {resolveBillAccount,resolveRelatedBillAccounts}=require('./billAccountResolution');
const preview={provider:'wechat',records:[{currency:'CNY'}],errors:[]};
const owner=['tenant','alice'];
test('source accounts are proposed without writing; same source has a stable owner-scoped identity',()=>{
 const first=resolveBillAccount({preview,owner,accounts:[]});
 assert.equal(first.status,'create');assert.equal(first.account.provider,'wechat');assert.equal(first.account.type,'wallet');assert.equal(first.account.openingBalanceMinor,null);
 assert.equal(resolveBillAccount({preview,owner,accounts:[]}).account.id,first.account.id);
 assert.notEqual(resolveBillAccount({preview,owner:['tenant','bob'],accounts:[]}).account.id,first.account.id);
 assert.notEqual(resolveBillAccount({preview:{...preview,provider:'alipay'},owner,accounts:[]}).account.id,first.account.id);
});
test('source products reuse uniquely identified accounts, bind owner-scoped proposals and require ambiguity resolution',()=>{
 const p={...preview,provider:'alipay',records:[{currency:'CNY',accountRelations:[{product:'alipay_huabei',activity:'repayment',role:'target'}]}]};
 const first=resolveRelatedBillAccounts({preview:p,owner,accounts:[]})[0];assert.equal(first.status,'create');assert.equal(first.account.balanceConvention,'signed');assert.equal(first.account.sourceProduct,'alipay_huabei');
 const other=resolveRelatedBillAccounts({preview:p,owner:['tenant','other'],accounts:[]})[0];assert.notEqual(first.account.id,other.account.id);
 const accounts=[first.account,{...first.account,id:'duplicate'}];assert.equal(resolveRelatedBillAccounts({preview:p,owner,accounts})[0].status,'ambiguous');
 assert.equal(resolveRelatedBillAccounts({preview:p,owner,accounts,selectedRelatedAccountIds:{alipay_huabei:'duplicate'}})[0].account.id,'duplicate');
 assert.equal(resolveRelatedBillAccounts({preview:p,owner,accounts,selectedRelatedAccountIds:{alipay_huabei:'foreign'}})[0].status,'manual');
 assert.equal(resolveRelatedBillAccounts({preview:p,owner,accounts:[{...first.account,status:'archived'}]})[0].status,'archived');
 assert.throws(()=>resolveRelatedBillAccounts({preview:p,owner,accounts:[],selectedRelatedAccountIds:{unrelated:'id'}}),/INPUT_INVALID/);
});
test('existing provider aliases match; multiple wallets require confirmation and unrelated bank accounts do not match',()=>{
 const a={id:'wx',provider:'\u5fae\u4fe1\u652f\u4ed8',type:'wallet',currency:'CNY',status:'active'};
 assert.equal(resolveBillAccount({preview,owner,accounts:[a]}).account.id,'wx');
 assert.equal(resolveBillAccount({preview,owner,accounts:[a,{...a,id:'other'}]}).status,'ambiguous');
 assert.equal(resolveBillAccount({preview,owner,accounts:[{...a,status:'archived'}]}).status,'archived');
 assert.equal(resolveBillAccount({preview,owner,accounts:[{...a,type:'bank'}]}).status,'create');
});
test('encrypted, invalid, generic and mixed-currency bills never propose a guessed account',()=>{
 for(const value of [{...preview,errors:[{code:'BILL_ZIP_ENCRYPTED'}]},{...preview,records:[]}])assert.equal(resolveBillAccount({preview:value,owner,accounts:[]}).status,'pending');
 for(const value of [{...preview,provider:'generic'},{...preview,records:[{currency:'CNY'},{currency:'USD'}]}])assert.equal(resolveBillAccount({preview:value,owner,accounts:[]}).status,'manual');
});
