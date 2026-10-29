'use strict';
function repaymentOrderComposition(rule,cardReceivedMinor,date){
 if(rule.orderOriginalPriceMinor===undefined)return null;
 if(rule.receiptBasis!=='owner_confirmed_order_detail'||date<'2018-08-01')return null;
 const principal=BigInt(cardReceivedMinor),price=BigInt(rule.orderOriginalPriceMinor),paid=BigInt(rule.cashPaidMinor),fee=price-principal,standard=(principal+999n)/1000n>10n?(principal+999n)/1000n:10n;
 if(fee!==standard||fee<=0n||price<=paid)return null;
 return {orderOriginalPriceMinor:String(price),serviceFeeMinor:String(fee),discountMinor:String(price-paid),netBenefitMinor:String(principal-paid),feeConfidence:'inferred_from_owner_original_price_and_native_card_receipt',feeRuleUrl:'https://posts.tenpay.com/posts/13c6ced75fa9fba3001233cf61c631d6.html'};
}
module.exports={repaymentOrderComposition};
