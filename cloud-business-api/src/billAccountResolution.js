'use strict';
const crypto = require('node:crypto');
const {ACCOUNT_PRODUCTS}=require('../../shared/personal-finance/accountProducts');
const SOURCES = Object.freeze({
  wechat: { label: '\u5fae\u4fe1\u652f\u4ed8', aliases: ['wechat','wechatpay','wechat pay','weixin','\u5fae\u4fe1','\u5fae\u4fe1\u652f\u4ed8'] },
  alipay: { label: '\u652f\u4ed8\u5b9d', aliases: ['alipay','\u652f\u4ed8\u5b9d'] },
});
const canonical = value => Object.entries(SOURCES).find(([,source]) => source.aliases.includes(String(value || '').trim().toLowerCase()))?.[0];

// Only the parsed bill provider identifies a source. Filenames, email senders and
// payment-card hints must not create an account or choose an unrelated wallet.
function resolveBillAccount({ preview, accounts, owner, selectedAccountId } = {}) {
  if (selectedAccountId) {
    const account = accounts.find(a => a.id === selectedAccountId);
    if (!account) return { status: 'missing', candidates: [] };
    if (account.status !== 'active') return { status: 'archived', candidates: [account] };
    return { status: 'matched', account, explicit: true };
  }
  if (preview.errors?.length || !preview.records?.length) return { status: 'pending', candidates: [] };
  if(preview.provider==='mybank'&&['mybank-current-v1','mybank-yulibao-v1'].includes(preview.templateId)){
    const identity=preview.accountIdentity;
    if(!identity||!/^\d{4}$/.test(identity.maskedIdentifier)||identity.currency!=='CNY')return {status:'manual',candidates:[]};
    if(identity.product==='alipay_yulibao')return resolveRelatedBillAccounts({preview:{records:[{currency:'CNY',accountRelations:[{product:'alipay_yulibao'}]}]},accounts,owner})[0];
    const bank='\u7f51\u5546\u94f6\u884c';
    const matching=accounts.filter(a=>require('../../shared/personal-finance/assetRegister').sameBankAccount(a,{bank,type:'debit_card',tail:identity.maskedIdentifier},'CNY'));
    const candidates=matching.filter(a=>a.status==='active');
    if(candidates.length===1)return {status:'matched',account:candidates[0],explicit:false};
    if(candidates.length>1)return {status:'ambiguous',candidates};
    if(matching.length)return {status:'archived',candidates:matching};
    const digest=crypto.createHash('sha256').update(JSON.stringify([...owner,'mybank',identity.maskedIdentifier,'CNY'])).digest('hex').slice(0,32);
    return {status:'create',account:{id:'finance_source_'+digest,label:bank+'\u6d3b\u671f\u5b58\u6b3e\uff08'+identity.maskedIdentifier+'\uff09',provider:bank,type:'debit_card',maskedIdentifier:identity.maskedIdentifier,currency:'CNY',openingBalanceMinor:null,openingDate:null,status:'active',balanceConvention:'signed'}};
  }
  const provider = canonical(preview.provider);
  const currencies = [...new Set(preview.records.map(r => r.currency))];
  if (!provider || currencies.length !== 1 || !/^[A-Z]{3}$/.test(currencies[0])) return { status: 'manual', candidates: accounts.filter(a => a.status === 'active') };
  const currency = currencies[0];
  const matching = accounts.filter(a => canonical(a.provider) === provider && a.currency === currency && a.type === 'wallet');
  const candidates = matching.filter(a => a.status === 'active');
  if (candidates.length === 1) return { status: 'matched', account: candidates[0], explicit: false };
  if (candidates.length > 1) return { status: 'ambiguous', candidates };
  if (matching.length) return { status: 'archived', candidates: matching };
  const digest = crypto.createHash('sha256').update(JSON.stringify([...owner, provider, currency])).digest('hex').slice(0,32);
  return { status: 'create', account: { id: 'finance_source_' + digest, label: SOURCES[provider].label, provider, type: 'wallet', maskedIdentifier: '', currency, openingBalanceMinor: null, openingDate: null, status: 'active', balanceConvention:'signed' } };
}
function resolveRelatedBillAccounts({preview,accounts,owner,selectedRelatedAccountIds={}}={}) {
 const products=[...new Set((preview.records||[]).flatMap(r=>(r.accountRelations||[]).map(relation=>relation.product)))];
 if(!selectedRelatedAccountIds||typeof selectedRelatedAccountIds!=='object'||Array.isArray(selectedRelatedAccountIds)||Object.keys(selectedRelatedAccountIds).some(key=>!products.includes(key)||typeof selectedRelatedAccountIds[key]!=='string'||!selectedRelatedAccountIds[key].trim()))throw Object.assign(new Error('CLOUD_PERSONAL_FINANCE_INPUT_INVALID'),{code:'CLOUD_PERSONAL_FINANCE_INPUT_INVALID'});
 if(preview.errors?.length)return [];
 const currency=preview.records[0]?.currency;
 return products.map(product=>{
  const spec=ACCOUNT_PRODUCTS[product];
  if(!spec)return {product,status:'manual',candidates:[]};
  const matching=accounts.filter(a=>a.currency===currency&&canonical(a.provider)===spec.provider&&(spec.type==='investment'?a.type==='investment':['loan','credit_card'].includes(a.type))&&(a.sourceProduct===product||!a.sourceProduct&&spec.aliases.some(alias=>a.label?.includes(alias))));
  const candidates=matching.filter(a=>a.status==='active'),selected=selectedRelatedAccountIds[product];
  if(selected){const account=candidates.find(a=>a.id===selected);return account?{product,status:'matched',account,explicit:true}:{product,status:'manual',candidates};}
  if(candidates.length===1)return {product,status:'matched',account:candidates[0]};
  if(candidates.length>1)return {product,status:'ambiguous',candidates};
  if(matching.length)return {product,status:'archived',candidates:matching};
  const digest=crypto.createHash('sha256').update(JSON.stringify([...owner,product,currency])).digest('hex').slice(0,32);
  return {product,status:'create',account:{id:'finance_product_'+digest,label:spec.label,provider:spec.provider,type:spec.type,sourceProduct:product,maskedIdentifier:'',currency,openingBalanceMinor:null,openingDate:null,status:'active',balanceConvention:'signed'}};
 });
}
module.exports = { resolveBillAccount, resolveRelatedBillAccounts };
