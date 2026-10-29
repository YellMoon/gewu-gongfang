'use strict';
const norm=s=>String(s||'').normalize('NFKC').replace(/\s/g,'');
// Public business identities support a provisional category, not the goods,
// service, funding method or success of any particular private order.
const profiles=new Map([
 ['\u591a\u70b9',{brand:'Dmall',family:'retail',identityPrecision:'displayed_brand_only',urls:['https://www.dmallplus.com/','https://www.dmallplus.com/resource/pc/public/pc/cert/%E8%90%A5%E4%B8%9A%E6%89%A7%E7%85%A7.pdf']}],
 ['\u5341\u8db3\u96c6\u56e2\u6709\u9650\u516c\u53f8',{brand:'Shizu',family:'retail',identityPrecision:'printed_merchant_legal_name',urls:['https://www.cnshizu.com/about.html']}],
 ['\u4e0a\u6d77\u5bfb\u68a6\u4fe1\u606f\u6280\u672f\u6709\u9650\u516c\u53f8',{brand:'Pinduoduo',family:'retail',identityPrecision:'printed_merchant_legal_name',urls:['https://www.yangkeduo.com/pdd_privacy_policy.pdf']}],
 ['\u82cf\u5b81\u6613\u8d2d\u96c6\u56e2\u80a1\u4efd\u6709\u9650\u516c\u53f8\u82cf\u5b81\u91c7\u8d2d\u4e2d\u5fc3',{brand:'Suning',family:'retail',identityPrecision:'printed_retail_purchase_center',urls:['https://www.suning.com/']}],
 ['\u676d\u5dde\u54c8\u884c\u7f51\u7edc\u79d1\u6280\u6709\u9650\u516c\u53f8',{brand:'Hello',family:'transport',identityPrecision:'printed_merchant_legal_name',urls:['https://hellobike.com/m/integrity-regulations.html','https://www.sec.gov/Archives/edgar/data/1841944/000110465921046007/filename5.htm']}]
]);
function namedRetailMerchantService(record){
 const full=norm(record.description),parts=full.split('_'),profile=profiles.get(parts[0]);
 if(!profile||record.kind!=='unknown'||record.direction!=='debit'||record.status!=='completed'||record.currency!=='CNY'||record.bankNetwork?.nativeStatus!=='settled'||parts.length>2||parts.length===2&&!/^(?:\u6dd8\u5b9d|\u62fc\u591a\u591a)\u5e73\u53f0\u5546\u6237$/.test(parts[1])||/\u501f\u6b3e|\u8d37\u6b3e|\u8fd8\u6b3e|\u8f6c\u8d26|\u57fa\u91d1|\u7406\u8d22|\u8bc1\u5238|\u6295\u8d44|\u91d1\u878d|\u4fdd\u8d39|\u5145\u503c|\u63d0\u73b0|\u50a8\u503c|\u4f59\u989d|\u62bc\u91d1|\u4fdd\u8bc1\u91d1|\u9884\u6388\u6743|\u9000\u6b3e|\u9000\u8d27|\u51bb\u7ed3|\u6e05\u7b97/.test(full))return null;
 return{schema:'named-native-merchant-purpose-v1',method:'original_named_merchant_primary_business_inference',displayedMerchant:record.description,normalizedMerchant:parts[0],brand:profile.brand,businessFamily:profile.family,identityPrecision:profile.identityPrecision,primarySourceUrls:[...profile.urls],publicIdentityScope:'business_identity_only_not_this_transaction',specificOrderPurposeVerified:false,provisionalPersonalSpending:true,confidence:'inferred_merchant_business',suggestedCategory:profile.family==='transport'?'\u4ea4\u901a\u51fa\u884c\uff08\u5546\u6237\u4e1a\u52a1\u63a8\u7b97\u3001\u53ef\u4fee\u6539\uff09':'\u8d2d\u7269\u6d88\u8d39\uff08\u5546\u6237\u4e1a\u52a1\u63a8\u7b97\u3001\u53ef\u4fee\u6539\uff09',reversible:true};
}
module.exports={namedRetailMerchantService};
