'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {monthlyPayment,validateMortgage,bindMortgageCalibration,buildMortgageModels,matchesMortgage}=require('./mortgages');
const {buildFinanceView}=require('./ledger');
const mortgage=(patch={})=>({schema:'mortgage-v1',loanType:'commercial',sourceAccountId:'bank',statementReference:'1234',originalPrincipalMinor:'200000000',annualRatePpm:'30000',recentSplit:{principalMinor:'100000',interestMinor:'250000',month:null},prepayments:[],...patch});
const account=(m)=>({id:'loan',label:'Mortgage',provider:'bank',type:'loan',currency:'CNY',openingBalanceMinor:null,openingDate:null,status:'active',balanceConvention:'signed',mortgage:m});
const payment=(id,date,amount,extra={})=>({id,sourceTransactionId:id,financialAccountId:'bank',provider:'huaxia',date,occurredAt:date+'T23:59:59+08:00',amountMinor:amount,currency:'CNY',status:'completed',direction:'debit',kind:'debt_payment',description:'\u67dc\u53f0\u6263\u6536\u8d37\u6b3e\u672c\u606f',counterparty:'\u534e\u590f\u94f6\u884c\u4e2a\u4eba\u8d37\u6b3e\u6237',rawFields:{'\u5bf9\u65b9\u5361/\u8d26\u53f7':'****1234 '},principalMinor:null,interestMinor:null,feeMinor:null,balanceMinor:null,paymentChannel:'',paymentAccountHint:'',relatedReference:'',...extra});
test('exact integer annuity matches independent published-style vectors and supports zero rate',()=>{assert.equal(String(monthlyPayment('120000000','32500',360)),'522248');assert.equal(String(monthlyPayment('100000000','50000',240)),'659956');assert.equal(String(monthlyPayment('120000','0',12)),'10000');});
test('bind the recent split once, group partial debits, retain originals and do not reset on a later same-amount bill',()=>{
 const sources=[payment('old','2026-08-20','350000'),payment('part-a','2026-09-20','100000'),payment('part-b','2026-09-20','250000')],m=bindMortgageCalibration(mortgage(),sources);assert.equal(m.recentSplit.month,'2026-09');assert.equal(m.recentSplit.monthBasis,'latest_matching_statement');
 const before=JSON.stringify(sources),rows=[...sources,payment('next','2026-10-20','350000')],model=buildMortgageModels([account(m)],rows)[0];assert.equal(JSON.stringify(sources),before);assert.equal(model.paymentCount,3);assert.equal(model.calibrationAfterMinor,'99900000');assert.equal(model.balanceMinor,'99799750');assert.equal(model.periods[1].principalMinor,'100250');assert.equal(model.periods[0].observationIds.length,2);
 assert.equal(model.periods[0].confidence,'estimated_reference');assert.equal(model.calibrationMonthBasis,'latest_matching_statement');assert.equal(bindMortgageCalibration(m,rows),m,'later equal payments cannot silently rebind the reference');
 assert.throws(()=>bindMortgageCalibration(mortgage(),[payment('wrong','2026-09-20','349999')]),/CALIBRATION_NOT_FOUND/);
});
test('a prepayment before calibration is already in the inferred balance; later prepayments reduce it once',()=>{
 const m=bindMortgageCalibration(mortgage({prepayments:[{date:'2025-12-03',amountMinor:'10000000',mode:'reduce_payment_keep_term'},{date:'2026-10-03',amountMinor:'20000000',mode:'reduce_payment_keep_term'}]}),[payment('anchor','2026-09-20','350000')]);
 const model=buildMortgageModels([account(m)],[payment('before','2025-12-03','10000000'),payment('anchor','2026-09-20','350000'),payment('after','2026-10-03','20000000')])[0];assert.equal(model.balanceMinor,'79900000');assert.equal(model.asOf,'2026-10-03');assert.equal(model.prepayments.length,2);assert.equal(model.nextPayment,undefined,'keep-term reduce-payment needs the next actual payment amount, not the old instalment');
 const transition=buildMortgageModels([account(m)],[payment('anchor','2026-09-20','350000'),payment('after','2026-10-03','20000000'),payment('next','2026-10-20','300000')])[0];assert.equal(transition.balanceMinor,'79900000','a transition must not deduct the same prepayment twice');assert.equal(transition.status,'partial_estimate');assert.equal(transition.asOf,'2026-10-03');
});
test('provable source account, counterparty and statement reference are all required',()=>{const m=mortgage();assert.equal(matchesMortgage(payment('valid','2026-09-20','1'),m),true);assert.equal(matchesMortgage(payment('other-owner','2026-09-20','1',{financialAccountId:'other'}),m),false);assert.equal(matchesMortgage(payment('wrong-tail','2026-09-20','1',{rawFields:{'\u5bf9\u65b9\u5361/\u8d26\u53f7':'****5678'}}),m),false);});
test('provident history fits its initial term and January repricing rather than using today rate for every year',()=>{
 const m=mortgage({loanType:'provident',originalPrincipalMinor:'120000000',annualRatePpm:null,recentSplit:null}),source=(id,date,amount)=>payment(id,date,amount,{kind:'unknown',description:'\u5176\u4ed6\u516c\u79ef\u91d1\u6263\u6b3e',counterparty:'\u4f4f\u623f\u516c\u79ef\u91d1\u7ba1\u7406\u4e2d\u5fc3',rawFields:{'\u9644\u8a00':'****1234 '}});
 const rows=[source('one','2022-09-20','565581'),source('two','2022-10-20','522248'),source('three','2022-11-21','522248'),source('four','2022-12-20','522248'),source('jan','2023-01-20','517972'),source('feb','2023-02-20','512508')],model=buildMortgageModels([account(m)],rows)[0];assert.equal(model.status,'estimated');assert.equal(model.inferredTermMonths,360);assert.equal(model.periods[0].principalMinor,'197248');assert.equal(model.periods[4].annualRatePpm,'31000');assert.equal(model.periods[4].principalMinor,'204555');assert.equal(model.balanceMinor,'118798159');
 const missing=buildMortgageModels([account(m)],rows.filter(r=>r.id!=='jan'))[0];assert.equal(missing.status,'partial_estimate');assert.equal(missing.asOf,'2022-12-20');
});
test('an explicitly dated bank-confirmed split is counted once while the inferred loan balance stays separate',()=>{
 const m=mortgage({recentSplit:{principalMinor:'100000',interestMinor:'250000',month:'2026-09',monthBasis:'bank_confirmed'}}),bank={id:'bank',label:'Bank',provider:'bank',type:'bank',currency:'CNY',openingBalanceMinor:'1000000',openingDate:'2026-09-01'},l={accounts:[bank,account(m)],observations:[payment('anchor','2026-09-20','350000')],balanceSnapshots:[],annotations:[],links:[]};const raw=JSON.stringify(l),v=buildFinanceView(l);assert.equal(JSON.stringify(l),raw);assert.equal(v.currencyTotals.CNY.consumptionMinor,'250000');assert.equal(v.accountStats.bank.balanceMinor,'650000');assert.equal(v.accountStats.loan.balanceMinor,null);assert.equal(v.accountStats.loan.estimatedBalanceMinor,'-99900000');assert.equal(v.transactions[0].balanceEffects.loan,'100000');assert.equal(v.transactions[0].sources[0].principalMinor,null);
});
test('malformed monetary inputs, unsupported fields and invalid rates are rejected',()=>{for(const patch of [{annualRatePpm:'3.3'},{annualRatePpm:'0'},{originalPrincipalMinor:'-1'},{statementReference:'123'},{sourceAccountId:''},{termMonths:0},{termMonths:601},{termMonths:'360'},{termMonths:359.5},{firstPaymentDate:'2022-02-30'},{prepayments:[{date:'2026-02-30',amountMinor:'1',mode:'reduce_payment_keep_term'}]},{untrusted:'value'}])assert.throws(()=>validateMortgage(mortgage(patch)),/INPUT_INVALID/);});

test('amount and month evidence bases are optional strict enums with legacy compatibility',()=>{
 const prepay={date:'2025-12-03',amountMinor:'10000000',mode:'reduce_payment_keep_term'},split={principalMinor:'100000',interestMinor:'250000',month:'2026-09'};
 for(const amountBasis of [undefined,'principal','total_payment'])for(const monthBasis of [undefined,'latest_matching_statement','bank_confirmed'])assert.doesNotThrow(()=>validateMortgage(mortgage({prepayments:[{...prepay,...(amountBasis?{amountBasis}:{})}],recentSplit:{...split,...(monthBasis?{monthBasis}:{})}})));
 for(const amountBasis of [null,'estimated',0])assert.throws(()=>validateMortgage(mortgage({prepayments:[{...prepay,amountBasis}]})),/INPUT_INVALID/);
 for(const monthBasis of [null,'user_guessed',0])assert.throws(()=>validateMortgage(mortgage({recentSplit:{...split,monthBasis}})),/INPUT_INVALID/);
 assert.throws(()=>validateMortgage(mortgage({recentSplit:{...split,month:null,monthBasis:'bank_confirmed'}})),/INPUT_INVALID/,'a confirmed bank month cannot be absent');
 const legacy=mortgage({prepayments:[prepay],recentSplit:split}),model=buildMortgageModels([account(legacy)],[payment('pre','2025-12-03','10000000'),payment('anchor','2026-09-20','350000')])[0];
 assert.equal(model.prepayments[0].amountBasis,'principal');assert.equal(model.prepayments[0].principalMinor,'10000000');assert.equal(model.prepayments[0].confidence,'user_confirmed_prepayment');assert.equal(model.periods[0].confidence,'user_confirmed_split');assert.equal(model.calibrationMonthBasis,'legacy_explicit');
});

test('a total-only prepayment before calibration preserves its unknown split and is not deducted again',()=>{
 const m=bindMortgageCalibration(mortgage({prepayments:[{date:'2025-12-03',amountMinor:'10000000',amountBasis:'total_payment',mode:'reduce_payment_keep_term'}]}),[payment('anchor','2026-09-20','350000')]);
 const model=buildMortgageModels([account(m)],[payment('pre','2025-12-03','10000000'),payment('anchor','2026-09-20','350000')])[0];
 assert.equal(model.balanceMinor,'99900000');assert.equal(model.asOf,'2026-09-20');assert.equal(model.prepayments[0].principalMinor,null);assert.equal(model.prepayments[0].interestMinor,null);assert.equal(model.prepayments[0].amountMinor,'10000000');assert.equal(model.prepayments[0].confidence,'statement_total_only');assert.equal(model.periods[0].confidence,'estimated_reference');
});

test('an unknown future prepayment stops the model before the event with or without later regular payments',()=>{
 const prepayment={date:'2026-10-03',amountMinor:'10000000',amountBasis:'total_payment',mode:'reduce_payment_keep_term'},laterKnown={date:'2026-11-03',amountMinor:'20000000',amountBasis:'principal',mode:'reduce_payment_keep_term'};
 const m=mortgage({recentSplit:{principalMinor:'100000',interestMinor:'250000',month:'2026-09',monthBasis:'bank_confirmed'},prepayments:[laterKnown,prepayment]});
 const base=[payment('anchor','2026-09-20','350000'),payment('unknown-pre','2026-10-03','10000000'),payment('later-known-pre','2026-11-03','20000000')];
 for(const rows of [base,[...base,payment('oct','2026-10-20','300000'),payment('nov','2026-11-20','250000')]]){
  const model=buildMortgageModels([account(m)],rows)[0];assert.equal(model.balanceMinor,'99900000','unknown principal is neither zero nor the total cash debit');assert.equal(model.asOf,'2026-09-20');assert.equal(model.status,'partial_estimate');assert.equal(model.periods.length,1);assert.equal(model.balanceEvents.length,1);assert.equal(model.nextPayment,undefined);assert.deepEqual(model.warnings,[{date:'2026-10-03',reason:'mortgage_prepayment_split_unknown'}]);
 }
});

test('confirmed original term and first payment date are preserved separately from inferred periods',()=>{
 const m=bindMortgageCalibration(mortgage({termMonths:360,firstPaymentDate:'2022-09-20'}),[payment('anchor','2026-09-20','350000')]),model=buildMortgageModels([account(m)],[payment('anchor','2026-09-20','350000')])[0];
 assert.equal(model.contractTermMonths,360);assert.equal(model.firstPaymentDate,'2022-09-20');assert.equal(model.balanceMinor,'99900000');assert.equal(model.calibrationMonth,'2026-09');
 assert.equal(model.contractComparison.remainingPeriods,311);
 assert.equal(model.contractComparison.observedPaymentMinor,'350000');
 assert.equal(model.contractComparison.status,'payment_differs');
 assert.equal(model.contractComparison.expectedPaymentMinor,String(monthlyPayment('99900000','30000',311)));
 assert.equal(model.periods[0].interestMinor,'250000','term comparison never silently changes the user reference or loan balance');
});

test('one-day extra is explained only with same-statement empty-balance evidence and an exact local penalty match',()=>{
 const m=mortgage({loanType:'provident',originalPrincipalMinor:'120000000',annualRatePpm:null,recentSplit:null});
 const source=(id,date,amount)=>payment(id,date,amount,{importId:'statement',kind:'unknown',description:'\u5176\u4ed6\u516c\u79ef\u91d1\u6263\u6b3e',counterparty:'\u676d\u5dde\u4f4f\u623f\u516c\u79ef\u91d1\u7ba1\u7406\u4e2d\u5fc3',rawFields:{'\u9644\u8a00':'****1234'},statementFlow:{schema:'huaxia-debit-v1',sequence:200}});
 const rows=[];
 for(let i=0;i<24;i++){const date=new Date(Date.UTC(2022,8+i,20)).toISOString().slice(0,10),month=date.slice(0,7),isExtra=['2024-06','2024-08'].includes(month);rows.push(source('month-'+i,isExtra?month+'-21':month==='2024-07'?month+'-22':date,i===0?'565581':date<'2023-01-01'?'522248':month==='2023-01'?'517972':isExtra?'512536':'512508'));}
 const empty=month=>payment('empty-'+month,month+'-20','1',{importId:'statement',balanceMinor:'0',statementFlow:{schema:'huaxia-debit-v1',sequence:199}});
 const evidence=[empty('2024-06'),empty('2024-08')],model=buildMortgageModels([account(m)],[...rows,...evidence])[0];
 assert.equal(model.status,'estimated');assert.equal(model.balanceMinor,'115014730');assert.equal(model.warnings.length,0);
 for(const [month,principal]of [['2024-06','213726'],['2024-08','214832']]){const p=model.periods.find(p=>p.month===month);assert.equal(p.extraMinor,'28');assert.equal(p.extraExplanation.reason,'inferred_one_day_overdue_interest');assert.equal(p.extraExplanation.principalMinor,principal);assert.equal(p.extraExplanation.confidence,'estimated');assert.deepEqual(p.extraExplanation.evidenceObservationIds,['empty-'+month,p.observationIds[0]]);}
 assert.equal(model.periods.find(p=>p.month==='2024-07').extraExplanation,undefined,'a funded weekend deferral is not a penalty');
 for(const invalidEvidence of [[],evidence.map(e=>({...e,balanceMinor:'1'})),evidence.map(e=>({...e,financialAccountId:'another-bank'})),evidence.map(e=>({...e,importId:'unrelated-statement'})),evidence.map(e=>({...e,statementFlow:{...e.statementFlow,sequence:201}}))]){const v=buildMortgageModels([account(m)],[...rows,...invalidEvidence])[0];assert.equal(v.periods.filter(p=>p.extraExplanation).length,0);assert.equal(v.warnings.length,2);assert.equal(v.balanceMinor,model.balanceMinor,'explaining a fee must never reduce principal');}
 const mismatch=rows.map(r=>r.date==='2024-06-21'?{...r,amountMinor:'512537'}:r),unexplained=buildMortgageModels([account(m)],[...mismatch,...evidence])[0];assert.equal(unexplained.periods.find(p=>p.month==='2024-06').extraExplanation,undefined,'an approximate amount is insufficient');
});
