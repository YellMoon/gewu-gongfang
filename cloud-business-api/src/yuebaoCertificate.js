'use strict';
const {createHash}=require('node:crypto');
const {validDate}=require('../../shared/personal-finance/ledger');
function parseYuebaoCertificate(pages){
 const result={provider:'alipay',templateId:'yuebao-asset-certificate-v1',records:[],errors:[],warnings:[{line:1,code:'BILL_DISTRIBUTOR_ASSET_SCOPE',message:'\u672c\u8bc1\u660e\u4ec5\u8986\u76d6\u51fa\u5177\u673a\u6784\u4ee3\u9500\u7684\u4f59\u989d\u5b9d\u8d44\u4ea7\uff1b\u5408\u5e76\u6838\u5bf9\u5404\u673a\u6784\u8bc1\u660e\u540e\u786e\u8ba4\u8d26\u6237\u603b\u4f59\u989d\u3002'}]};
 try{
  const text=pages.flatMap(p=>p.items.map(i=>i.str)).join('').normalize('NFKC').replace(/\s/g,'');
  const date=text.match(/\u622a\u81f3(20\d{2})\u5e74(\d{1,2})\u6708(\d{1,2})\u65e5(\d{1,2})\u65f6(\d{1,2})\u5206(\d{1,2})\u79d2/),amount=text.match(/\u5408\u8ba1\u4eba\u6c11\u5e01(\d+\.\d{2})\u5143/);
  const issuer=text.includes('\u6d59\u6c5f\u7f51\u5546\u94f6\u884c\u80a1\u4efd\u6709\u9650\u516c\u53f8')?'mybank':text.includes('\u8682\u8681(\u676d\u5dde)\u57fa\u91d1\u9500\u552e\u6709\u9650\u516c\u53f8')?'antfund':null;
  if(!date||!amount||!issuer)throw Error('BILL_CERTIFICATE_FIELDS_INVALID');
  const day=date[1]+'-'+date[2].padStart(2,'0')+'-'+date[3].padStart(2,'0'),occurredAt=day+'T'+date.slice(4).map(x=>x.padStart(2,'0')).join(':')+'+08:00';
  if(!validDate(day)||+date[4]>23||+date[5]>59||+date[6]>59)throw Error('BILL_CERTIFICATE_DATE_INVALID');
  const [a,b]=amount[1].split('.'),balance=String(BigInt(a)*100n+BigInt(b));
  const key=createHash('sha256').update(JSON.stringify([issuer,occurredAt,balance])).digest('hex');
  result.records=[{sourceTransactionId:'yuebao_certificate:'+key,occurredAt,date:day,amountMinor:'0',currency:'CNY',direction:'neutral',kind:'transfer',description:'\u4f59\u989d\u5b9d\u8d44\u4ea7\u67e5\u8be2\u60c5\u51b5\u544a\u77e5\u4e66',counterparty:issuer==='mybank'?'\u6d59\u6c5f\u7f51\u5546\u94f6\u884c\u80a1\u4efd\u6709\u9650\u516c\u53f8':'\u8682\u8681\uff08\u676d\u5dde\uff09\u57fa\u91d1\u9500\u552e\u6709\u9650\u516c\u53f8',category:'\u8d44\u4ea7\u8bc1\u660e',paymentChannel:'\u4f59\u989d\u5b9d',paymentAccountHint:'',balanceMinor:balance,relatedReference:'',status:'completed',principalMinor:null,interestMinor:null,feeMinor:null,rawFields:{\u8bc1\u660e\u673a\u6784:issuer,\u67e5\u8be2\u65f6\u95f4:occurredAt,\u8d44\u4ea7\u5408\u8ba1:amount[1]},accountRelations:[{product:'alipay_yuebao',role:'target',activity:'investment_confirmation'}],balanceEvidence:{schema:'yuebao-asset-certificate-v1',product:'alipay_yuebao',balanceKind:'distributor_total',issuer,incomeMinor:'0',expenseMinor:'0',sourcePage:1,sequence:1}}];
 }catch(e){result.errors.push({line:1,code:e.message,message:'\u4f59\u989d\u5b9d\u8d44\u4ea7\u8bc1\u660e\u7684\u673a\u6784\u3001\u67e5\u8be2\u65f6\u95f4\u6216\u91d1\u989d\u672a\u901a\u8fc7\u6838\u9a8c\u3002'});}
 return result;
}
module.exports={parseYuebaoCertificate};
