'use strict';
const crypto=require('node:crypto');
const {sameBankAccount}=require('../../shared/personal-finance/assetRegister');
const banks=new Set(['\u5174\u4e1a\u94f6\u884c','\u90ae\u50a8\u94f6\u884c','\u6c5f\u82cf\u94f6\u884c','\u6d66\u53d1\u94f6\u884c','\u4ea4\u901a\u94f6\u884c','\u5efa\u8bbe\u94f6\u884c','\u5e7f\u53d1\u94f6\u884c','\u4e2d\u4fe1\u94f6\u884c','\u6d59\u5546\u94f6\u884c','\u62db\u5546\u94f6\u884c','\u676d\u5dde\u94f6\u884c']);
const bankAccountKey=a=>JSON.stringify([a.provider,a.type,a.maskedIdentifier,a.currency]);
function resolveBankAccount({identity,accounts,owner}){
 if(!identity||!banks.has(identity.provider)||!['credit_card','debit_card'].includes(identity.type)||!/^\d{4}$/.test(identity.maskedIdentifier)||!['CNY','USD'].includes(identity.currency))return{status:'manual',candidates:[]};
 const matching=accounts.filter(a=>sameBankAccount(a,{bank:identity.provider,type:identity.type,tail:identity.maskedIdentifier},identity.currency)),active=matching.filter(a=>a.status==='active');
 if(active.length===1)return{status:'matched',account:active[0]};if(active.length>1)return{status:'ambiguous',candidates:active};if(matching.length)return{status:'archived',candidates:matching};
 const key=crypto.createHash('sha256').update(JSON.stringify([...owner,bankAccountKey(identity)])).digest('hex').slice(0,32);
 return{status:'create',account:{id:'finance_bank_'+key,label:identity.provider+(identity.type==='credit_card'?'\u4fe1\u7528\u5361\uff08':'\u50a8\u84c4\u5361\uff08')+identity.maskedIdentifier+'\uff09'+(identity.currency==='CNY'?'':' '+identity.currency),...identity,openingBalanceMinor:null,openingDate:null,status:'active',balanceConvention:'signed'}};
}
module.exports={resolveBankAccount,bankAccountKey};
