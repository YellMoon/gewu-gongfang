'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseAssetMonthlyRows:parse}=require('./assetMonthlyStatement');
const {resolveBillAccount}=require('./billAccountResolution');
const {validateRecord,buildFinanceView}=require('../../shared/personal-finance/ledger');
const webank=()=>[
 ['\u5fae\u4f17\u94f6\u884cApp\u4e2a\u4eba\u8d26\u6237\u8d44\u4ea7\u5bf9\u8d26\u5355\uff08\u6708\u62a5\uff09- 2026\u5e7410\u6708'],
 ['\u6237\u540d\uff1a\u6d4b\u8bd5','\u8d26\u53f7/\u5361\u53f7\uff1a6236000000001234','\u5e01\u79cd\uff1a\u4eba\u6c11\u5e01'],
 ['\u8d44\u4ea7\u6982\u89c8','\u622a\u6b62\u65e5\u671f\uff1a2026\u5e7410\u670831\u65e5'],['\u6d3b\u671f+','\uffe5 3.73'],['\u65e5\u65e5\u65b01\u53f7C','\uffe5 3.73'],['\u5408\u8ba1','\uffe5 3.73'],
 ['\u4ea4\u6613\u6982\u89c8','\u7edf\u8ba1\u65f6\u95f4\uff1a2026\u5e7410\u670801\u65e5 \uff5e 2026\u5e7410\u670831\u65e5'],['\u672c\u671f\u65e0\u4ea4\u6613\u6570\u636e'],['\u7b2c1\u9875','\u51711\u9875']
];
const matrix=(title,stocks,cash,net)=>[[title,'\u5408\u8a08(HKD)','\u6e2f\u5e63\u8cc7\u7522','\u7f8e\u5143\u8cc7\u7522','\u4eba\u6c11\u5e63\u8cc7\u7522','\u65e5\u5143\u8cc7\u7522','\u65b0\u52a0\u5761\u5143\u8cc7\u7522','\u97d3\u5143\u8cc7\u7522'],['\u8cc7\u7522\u7d44\u5408'],...['\u80a1\u7968\u548c\u80a1\u7968\u671f\u6b0a','\u73fe\u91d1\u7d50\u9918','\u8cc7\u7522\u6de8\u503c'].map((s,i)=>[s,[stocks,cash,net][i],[stocks,cash,net][i],'0.00','0.00','0.00','0.00','0.00'])];
const holding=['\u4ee3\u78bc\u540d\u7a31','\u4ea4\u6613\u6240/\u5e02\u5834','\u8ca8\u5e63\u7a2e\u985e','\u6578\u91cf','\u50f9\u683c','\u4e58\u6578','\u5e02\u503c'];
const futu=()=>[
 ['\u4fdd\u8b49\u91d1\u7d9c\u5408\u5e33\u6236(1234) - \u8b49\u5238\u6708\u7d50\u55ae'],['2026/10'],
 ['\u540d\u7a31','\u5e33\u6236\u865f\u78bc','\u5e33\u6236\u985e\u578b','\u5730\u5740','\u57fa\u6e96\u8ca8\u5e63'],['Test','1000000000001234','\u5b56\u5c55','Test','HKD'],
 ['\u8cc7\u7522\u7d44\u5408\u6458\u8981'],['\u671f\u521d\u91d1\u984d(HKD)','\u671f\u672b\u91d1\u984d(HKD)','\u8b8a\u52d5(HKD)'],['\u8cc7\u7522\u7d44\u5408'],
 ['\u80a1\u7968\u548c\u80a1\u7968\u671f\u6b0a','158.00','135.70','-22.30'],['\u73fe\u91d1\u7d50\u9918','0.78','0.00','-0.78'],['\u8cc7\u7522\u6de8\u503c','158.78','135.70','-23.08'],
 ['\u671f\u521d\u6982\u89bd'],...matrix('\u671f\u521d\u8cc7\u7522\u6de8\u503c\u7e3d\u89bd','158.00','0.78','158.78'),
 ['\u671f\u521d\u6982\u89bd-\u80a1\u7968\u548c\u80a1\u7968\u671f\u6b0a'],holding,['00005(Test)','SEHK','HKD','1','158.0000','-','158.00'],
 ['\u8cc7\u91d1\u9032\u51fa'],['\u65e5\u671f','\u65b9\u5411','\u985e\u578b','\u8ca8\u5e63\u7a2e\u985e','\u91d1\u984d','\u5099\u8a3b'],['2026/10/08','\u6e1b\u5c11','\u8cc7\u7522\u8abf\u6574','HKD','-0.78','Dormant Account Management Fee'],
 ['\u671f\u672b\u6982\u89bd'],...matrix('\u671f\u672b\u8cc7\u7522\u6de8\u503c\u7e3d\u89bd','135.70','0.00','135.70'),
 ['\u671f\u672b\u6982\u89bd-\u80a1\u7968\u548c\u80a1\u7968\u671f\u6b0a'],holding,['00005(Test)','SEHK','HKD','1','135.7000','-','135.70'],
 ['\u91cd\u8981\u63d0\u793a'],['\u5bcc\u9014\u8b49\u5238\u570b\u969b\uff08\u9999\u6e2f\uff09\u6709\u9650\u516c\u53f8'],['\u8cec\u6236\u865f\u78bc\uff1a1000000000001234','1/1']
];
test('WeBank asset proof counts parent and holding once, separate from debit card',()=>{
 const p=parse(webank());assert.deepEqual(p.errors,[]);assert.equal(p.records.length,1);validateRecord(p.records[0]);assert.equal(p.records[0].balanceMinor,'373');
 const card={id:'card',provider:'\u5fae\u4f17\u94f6\u884c',type:'debit_card',currency:'CNY',maskedIdentifier:'1234',status:'active'};
 const r=resolveBillAccount({preview:p,accounts:[card],owner:['t','o']});assert.equal(r.status,'create');assert.equal(r.account.type,'investment');assert.notEqual(r.account.id,card.id);
 assert.equal(resolveBillAccount({preview:p,accounts:[r.account],owner:['t','o']}).account.id,r.account.id);
 const ledger={accounts:[r.account],observations:p.records.map((o,i)=>({...o,id:'o'+i,provider:p.provider,financialAccountId:r.account.id,sourceVersionOrdinal:1})),imports:[],annotations:[],links:[],balanceSnapshots:[]};
 const v=buildFinanceView(ledger);assert.equal(v.currencyTotals.CNY.incomeMinor,'0');assert.equal(v.currencyTotals.CNY.consumptionMinor,'0');
});
test('Futu management fee and full portfolio valuation stay distinct',()=>{
 const p=parse(futu());assert.deepEqual(p.errors,[]);p.records.forEach(validateRecord);
 assert.deepEqual(p.records.map(r=>[r.kind,r.amountMinor,r.balanceMinor]),[['fee','78',null],['transfer','0','13570']]);
 const r=resolveBillAccount({preview:p,accounts:[],owner:['t','o']});assert.equal(r.status,'create');assert.equal(r.account.currency,'HKD');
 const v=buildFinanceView({accounts:[r.account],observations:p.records.map((o,i)=>({...o,id:'o'+i,provider:p.provider,financialAccountId:r.account.id,sourceVersionOrdinal:1})),imports:[],annotations:[],links:[],balanceSnapshots:[]});
 assert.equal(v.currencyTotals.HKD.incomeMinor,'0');assert.equal(v.currencyTotals.HKD.consumptionMinor,'78');
});
test('reject inconsistent amounts, dates, currencies, holdings, cash and unsupported activity',()=>{
 const mutations=[
  r=>{r.find(x=>x[0]==='\u5408\u8ba1')[1]='\uffe5 7.46';},
  r=>{r.find(x=>x[0]==='\u672c\u671f\u65e0\u4ea4\u6613\u6570\u636e')[0]='\u6709\u4ea4\u6613';},
  r=>{r.find(x=>x[0]==='\u4ea4\u6613\u6982\u89c8')[1]='\u7edf\u8ba1\u65f6\u95f4\uff1a2026\u5e7409\u670801\u65e5 \uff5e 2026\u5e7410\u670831\u65e5';}
 ];
 for(const mutate of mutations){const r=webank();mutate(r);const p=parse(r);assert.ok(p.errors.length);assert.equal(p.records.length,0);}
 const cases=[
  r=>{r.find(x=>x[0]==='\u8cc7\u7522\u6de8\u503c')[2]='135.71';},
  r=>{r.find(x=>x[0]==='2026/10/08')[4]='-0.79';},
  r=>{r.find(x=>x[0]==='2026/10/08')[5]='Other fee';},
  r=>{r.find(x=>x[0]==='2026/10/08')[3]='USD';},
  r=>{r.find(x=>x[0]==='\u80a1\u7968\u548c\u80a1\u7968\u671f\u6b0a'&&x.length===8)[3]='1.00';},
  r=>{r.filter(x=>x[0]==='00005(Test)')[1][3]='2';},
  r=>{r.at(-1)[0]='\u8cec\u6236\u865f\u78bc\uff1a1000000000009999';},
  r=>{r.at(-1)[1]='1/2';},
  r=>{r.splice(r.findIndex(x=>x[0]==='\u8cc7\u91d1\u9032\u51fa'),0,['\u8b49\u5238\u4ea4\u6613']);}
 ];
 for(const mutate of cases){const r=futu();mutate(r);const p=parse(r);assert.ok(p.errors.length,JSON.stringify(r));assert.equal(p.records.length,0);}
});
test('unrelated PDFs stay with their existing decoders',()=>assert.equal(parse([['Other statement']]),null));

