import React, {useState} from 'react';
import {Button,Card,Drawer,Form,Input,Modal,Select,Space,Table,Tag,message} from 'antd';
import {formatMinor,parseMoney} from '../services/personalFinanceClient.mjs';
const money=(v:any)=>v==null?'\u672a\u77e5':formatMinor(v).replace(/^-/, '\u2212');
const decimal=(v:any)=>v==null?'':formatMinor(v);
const rate=(v:any)=>v==null?'\u672a\u77e5':String(Number(v)/10000)+'%';
const inputMoney=(v:any)=>{const t=String(v||'').trim();if(!/^\d+(?:\.\d{1,2})?$/.test(t))throw new Error('\u8bf7\u586b\u5199\u6709\u6548\u91d1\u989d');return parseMoney(t);};
const percent=(v:any)=>{const t=String(v||'').trim();if(!/^\d+(?:\.\d{1,4})?$/.test(t))throw new Error('\u8bf7\u586b\u5199\u6709\u6548\u5e74\u5229\u7387');const [a,b='']=t.split('.');return String(BigInt(a)*10000n+BigInt(b.padEnd(4,'0')));};
export const mortgageActual=(m:any)=>m?.status==='actual_bank_statement'&&m?.confidence==='actual_bank_statement';
export const mortgageBasis=(v:string)=>v==='actual_bank_statement'?'银行还款记录':v==='estimated_reference'?'近期参考试算':v==='user_confirmed_split'?'已指定账期本息':'模型拆分';
const warning=(w:any)=>w.month+(w.reason==='extra_amount_not_assumed_principal'?' 差额 '+money(w.amountMinor):' 待核对');
export default function MortgageAccounts({models,accounts,onSave,busy}:{models:any[];accounts:any[];onSave:(account:any,existing?:any)=>Promise<any>;busy:boolean}){
 const [detail,setDetail]=useState<string>(),[editing,setEditing]=useState<any>(),[open,setOpen]=useState(false),[saving,setSaving]=useState(false),[form]=Form.useForm();
 const model=models.find(m=>m.financialAccountId===detail),loanType=Form.useWatch('loanType',form);
 const edit=(account?:any)=>{const m=account?.mortgage;setEditing(account);form.resetFields();form.setFieldsValue({label:account?.label||'',loanType:m?.loanType||'commercial',sourceAccountId:m?.sourceAccountId,statementReference:m?.statementReference||'',termMonths:m?.termMonths??'',firstPaymentDate:m?.firstPaymentDate||'',originalPrincipal:decimal(m?.originalPrincipalMinor),annualRate:m?.annualRatePpm==null?'':String(Number(m.annualRatePpm)/10000),recentPrincipal:decimal(m?.recentSplit?.principalMinor),recentInterest:decimal(m?.recentSplit?.interestMinor),prepayments:(m?.prepayments||[]).map((p:any)=>({date:p.date,amount:decimal(p.amountMinor),amountBasis:p.amountBasis||'principal'}))});setOpen(true);};
 const save=async()=>{if(saving)return;setSaving(true);try{
  const v=await form.validateFields(),prior=editing?.mortgage;
  const recent:any=v.recentPrincipal||v.recentInterest?{principalMinor:inputMoney(v.recentPrincipal),interestMinor:inputMoney(v.recentInterest),month:null,monthBasis:'latest_matching_statement'}:null;
  if(recent&&prior?.recentSplit&&recent.principalMinor===prior.recentSplit.principalMinor&&recent.interestMinor===prior.recentSplit.interestMinor){recent.month=prior.recentSplit.month;recent.monthBasis=prior.recentSplit.monthBasis||'bank_confirmed';}
  const mortgage={schema:'mortgage-v1',loanType:v.loanType,sourceAccountId:v.sourceAccountId,statementReference:v.statementReference,originalPrincipalMinor:inputMoney(v.originalPrincipal),...(v.termMonths?{termMonths:Number(v.termMonths)}:{}),...(v.firstPaymentDate?{firstPaymentDate:v.firstPaymentDate}:{}),annualRatePpm:v.annualRate?percent(v.annualRate):null,recentSplit:recent,prepayments:(v.prepayments||[]).map((p:any)=>({date:p.date,amountMinor:inputMoney(p.amount),amountBasis:p.amountBasis||'total_payment',mode:'reduce_payment_keep_term'}))};
  if(prior?.loanType==='commercial'&&v.loanType==='commercial'){
   if(prior.minimumAnnualRatePpm!==undefined)Object.assign(mortgage,{minimumAnnualRatePpm:prior.minimumAnnualRatePpm});
   if(prior.repricingTerms!==undefined)Object.assign(mortgage,{repricingTerms:structuredClone(prior.repricingTerms)});
  }
  const source=accounts.find(a=>a.id===v.sourceAccountId),account=editing?{...editing,label:v.label,mortgage}:{label:v.label,provider:v.loanType==='commercial'?source.provider:'\u4f4f\u623f\u516c\u79ef\u91d1',type:'loan',currency:'CNY',maskedIdentifier:v.loanType==='commercial'?v.statementReference:'',openingBalanceMinor:null,openingDate:null,status:'active',balanceConvention:'signed',mortgage};
  const saved=await onSave(account,editing);if(saved)setOpen(false);
 }catch(e:any){message.error(e.code||e.message||'\u8d37\u6b3e\u53c2\u6570\u672a\u4fdd\u5b58');}finally{setSaving(false);}};
 return <Card title={'\u623f\u8d37\u503a\u52a1'} style={{marginTop:16}} extra={<Button disabled={busy} onClick={()=>edit()}>{'\u65b0\u589e\u623f\u8d37\u8d26\u6237'}</Button>}>
  {!models.length?<p>暂无房贷账户</p>:models.map(m=><Card key={m.financialAccountId} size="small" title={m.label} style={{marginTop:12}} extra={<Space><Button onClick={()=>setDetail(m.financialAccountId)}>{'\u672c\u606f\u4e0e\u8ba1\u7b97\u4f9d\u636e'}</Button><Button disabled={busy} onClick={()=>edit(accounts.find(a=>a.id===m.financialAccountId))}>{'\u8d37\u6b3e\u53c2\u6570'}</Button></Space>}>
   <Space wrap><span>{'\u539f\u8d37\u6b3e\uff1a'}{money(m.originalPrincipalMinor)}{' \u5143'}</span><strong>{mortgageActual(m)?'剩余本金（银行记录）：':'剩余本金估算：'}{money(m.balanceMinor)}{' \u5143'}</strong><Tag color={mortgageActual(m)?'blue':'gold'}>{mortgageActual(m)?'银行还款记录':m.status==='estimated'?'模型估算':'依据待补充'}</Tag></Space>
   <p className="finance-muted">截至 {m.asOf||'—'} · 已还 {m.paymentCount??m.periods?.length??0} 期 · 提前还款 {m.prepayments.length} 笔</p>
   {m.nextPayment&&<p>下期预计：本金 {money(m.nextPayment.principalMinor)} · 利息 {money(m.nextPayment.interestMinor)}</p>}
  </Card>)}
  <Drawer title={model?.label+' \u00b7 \u672c\u606f\u4e0e\u8ba1\u7b97\u4f9d\u636e'} open={!!model} onClose={()=>setDetail(undefined)} width={920}>
    {model&&<><Tag color={mortgageActual(model)?'blue':'gold'}>{mortgageActual(model)?'银行记录':'估算'}</Tag>
    {model.lprAnalysis&&<p>参考 LPR {rate(model.lprAnalysis.impliedReferenceLprPpm)} · <a href={model.lprAnalysis.source} target="_blank" rel="noreferrer">利率来源</a></p>}

    {(model.contractTermMonths||model.firstPaymentDate)&&<p>{'\u5df2\u786e\u8ba4\u539f\u5408\u540c\u4fe1\u606f\uff1a'}{model.contractTermMonths?model.contractTermMonths+' \u4e2a\u6708':''}{model.firstPaymentDate?'\uff1b\u9996\u6b21\u8fd8\u6b3e '+model.firstPaymentDate:''}</p>}
    {model.contractComparison&&<p>剩余 {model.contractComparison.remainingPeriods} 期{model.contractComparison.status==='payment_differs'&&<> · 预计月供 {money(model.contractComparison.expectedPaymentMinor)} <Tag color="gold">与账单不一致</Tag></>}</p>}

    {model.inferredTermMonths&&<p>{'\u81ea\u52a8\u5339\u914d\u671f\u9650\uff1a'}{model.inferredTermMonths}{' \u4e2a\u6708\u3002'}</p>}
    <Table rowKey="month" size="small" dataSource={model.periods} pagination={{pageSize:12}} scroll={{x:780}} columns={[{title:'\u8d26\u5355\u671f',dataIndex:'month'},{title:'\u6263\u6b3e\u5408\u8ba1',dataIndex:'amountMinor',render:money},{title:'\u672c\u91d1',dataIndex:'principalMinor',render:money},{title:'\u5229\u606f',dataIndex:'interestMinor',render:money},{title:'\u53e6\u5217\u5dee\u989d',dataIndex:'extraMinor',render:money},{title:'剩余本金',dataIndex:'balanceMinor',render:money},{title:'\u5e74\u5229\u7387',dataIndex:'annualRatePpm',render:rate},{title:'\u4f9d\u636e',dataIndex:'confidence',render:mortgageBasis}]}/>
    {model.prepayments.map((p:any)=><p key={p.date}>{p.date}{p.confidence==='actual_bank_statement'?<> 提前还款合计 {money(p.amountMinor)} 元；本金 {money(p.principalMinor)} 元，利息 {money(p.interestMinor)} 元（银行记录）。</>:p.amountBasis==='total_payment'?<>{' \u63d0\u524d\u8fd8\u6b3e\u5408\u8ba1 '}{money(p.amountMinor)}{' \u5143\uff1b\u672c\u91d1\u4e0e\u5229\u606f\u5c1a\u672a\u62c6\u5206\u3002'}</>:<>{' \u63d0\u524d\u8fd8\u672c '}{money(p.principalMinor)}{' \u5143\u3002'}</>}{'\u671f\u9650\u4e0d\u53d8\u3001\u964d\u4f4e\u6708\u4f9b\u3002'}</p>)}
    {model.periods.filter((p:any)=>p.extraExplanation).map((p:any)=><p key={p.month}>{p.month} · 罚息估算 {money(p.extraMinor)}</p>)}
    {model.warnings.map((w:any,i:number)=><p key={i}>{warning(w)}</p>)}
    {model.policySources?.map((url:string,i:number)=><p key={url}><a href={url} target="_blank" rel="noreferrer">{'\u516c\u5f00\u5229\u7387\u4e0e\u8ba1\u606f\u89c4\u5219\u4f9d\u636e '}{i+1}</a></p>)}
   </>}
  </Drawer>
  <Modal title={editing?'\u8d37\u6b3e\u53c2\u6570':'\u5efa\u7acb\u623f\u8d37\u503a\u52a1\u8d26\u6237'} open={open} okText={'\u4fdd\u5b58\u53c2\u6570'} cancelText={'\u53d6\u6d88\u7f16\u8f91'} confirmLoading={saving} onCancel={()=>setOpen(false)} onOk={()=>void save()}>
   <Form form={form} layout="vertical"><Form.Item name="label" label={'\u8d26\u6237\u540d\u79f0'} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="loanType" label={'\u8d37\u6b3e\u7c7b\u578b'} rules={[{required:true}]}><Select disabled={!!editing} options={[{value:'commercial',label:'\u5546\u4e1a\u623f\u8d37'},{value:'provident',label:'\u516c\u79ef\u91d1\u623f\u8d37'}]}/></Form.Item><Form.Item name="originalPrincipal" label={'\u539f\u8d37\u6b3e\u989d\uff08\u5143\uff09'} rules={[{required:true}]}><Input/></Form.Item><Form.Item name="sourceAccountId" label={'\u8fd8\u6b3e\u50a8\u84c4\u5361'} rules={[{required:true}]}><Select options={accounts.filter(a=>['bank','debit_card','savings'].includes(a.type)&&a.currency==='CNY'&&a.status==='active').map(a=>({value:a.id,label:a.label}))}/></Form.Item><Form.Item name="statementReference" label={'\u8d26\u5355\u4e2d\u7684\u8d37\u6b3e\u5c3e\u53f7\u6216\u516c\u79ef\u91d1\u9644\u8a00\u5c3e\u53f7'} rules={[{required:true,pattern:/^\d{4}$/}]}><Input maxLength={4}/></Form.Item>
    <Form.Item name="termMonths" label={'\u539f\u5408\u540c\u671f\u9650\uff08\u6708\uff0c\u53ef\u7559\u7a7a\uff09'} rules={[{pattern:/^[1-9]\d{0,2}$/,message:'\u8bf7\u586b\u5199\u6574\u6570\u6708\u6570'}]}><Input type="number" min={1} max={600} placeholder={'30\u5e74\u4e3a360\u4e2a\u6708'}/></Form.Item>
    <Form.Item name="firstPaymentDate" label={'\u9996\u6b21\u8fd8\u6b3e\u65e5\u671f\uff08\u53ef\u7559\u7a7a\uff09'}><Input type="date"/></Form.Item>
    <Form.Item name="annualRate" label={'\u5df2\u77e5\u5e74\u5229\u7387\uff08%\uff09'}><Input placeholder={loanType==='provident'?'\u7559\u7a7a\uff0c\u81ea\u52a8\u5339\u914d\u5386\u53f2\u516c\u5f00\u5229\u7387':'\u4f8b\u5982 3.3'}/></Form.Item>
    <Form.Item name="recentPrincipal" label={'\u8fd1\u671f\u672c\u91d1\u53c2\u8003\uff08\u5143\uff09'}><Input/></Form.Item><Form.Item name="recentInterest" label={'\u8fd1\u671f\u5229\u606f\u53c2\u8003\uff08\u5143\uff09'}><Input/></Form.Item>
    <Form.List name="prepayments">{(fields,{add,remove})=><><p>{'\u671f\u9650\u4e0d\u53d8\u3001\u964d\u4f4e\u6708\u4f9b\u7684\u63d0\u524d\u8fd8\u6b3e'}</p>{fields.map(f=><Space key={f.key} align="baseline" wrap><Form.Item name={[f.name,'date']} rules={[{required:true}]}><Input type="date"/></Form.Item><Form.Item name={[f.name,'amount']} rules={[{required:true}]}><Input placeholder={'\u91d1\u989d\uff08\u5143\uff09'}/></Form.Item><Form.Item name={[f.name,'amountBasis']} initialValue="total_payment" rules={[{required:true}]}><Select aria-label={'\u63d0\u524d\u8fd8\u6b3e\u91d1\u989d\u53e3\u5f84'} style={{width:130}} options={[{value:'total_payment',label:'\u6263\u6b3e\u5408\u8ba1'},{value:'principal',label:'\u507f\u8fd8\u672c\u91d1'}]}/></Form.Item><Button onClick={()=>remove(f.name)}>{'\u79fb\u9664'}</Button></Space>)}<Button onClick={()=>add({amountBasis:'total_payment'})}>{'\u589e\u52a0\u63d0\u524d\u8fd8\u6b3e'}</Button></>}</Form.List>
   </Form>
  </Modal>
 </Card>;
}
