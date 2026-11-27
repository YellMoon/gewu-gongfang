import React, {useState} from 'react';
import {Button,Card,Drawer,Form,Input,Modal,Select,Space,Table,Tag,message} from 'antd';
import {formatMinor,parseMoney} from '../services/personalFinanceClient.mjs';
import '../layout/EditorModal.css';
import '../layout/EditorDrawer.css';
import '../layout/EditorForm.css';
import './MortgageEditor.css';
const money=(v:any)=>v==null?'\u672a\u77e5':formatMinor(v).replace(/^-/, '\u2212');
const decimal=(v:any)=>v==null?'':formatMinor(v);
const rate=(v:any)=>v==null?'\u672a\u77e5':String(Number(v)/10000)+'%';
const inputMoney=(v:any)=>{const t=String(v||'').trim();if(!/^\d+(?:\.\d{1,2})?$/.test(t))throw new Error('\u8bf7\u586b\u5199\u6709\u6548\u91d1\u989d');return parseMoney(t);};
const percent=(v:any)=>{const t=String(v||'').trim();if(!/^\d+(?:\.\d{1,4})?$/.test(t))throw new Error('\u8bf7\u586b\u5199\u6709\u6548\u5e74\u5229\u7387');const [a,b='']=t.split('.');return String(BigInt(a)*10000n+BigInt(b.padEnd(4,'0')));};
export const mortgageActual=(m:any)=>m?.status==='actual_bank_statement'&&m?.confidence==='actual_bank_statement';
export const mortgageBasis=(v:string)=>v==='actual_bank_statement'?'银行还款记录':v==='estimated_reference'?'近期参考试算':v==='user_confirmed_split'?'已指定账期本息':'模型拆分';
const warning=(w:any)=>w.month+(w.reason==='extra_amount_not_assumed_principal'?' 差额 '+money(w.amountMinor):' 待核对');
function mortgageFormParameters(account:any) {
 const evidence=account.mortgageEvidence;
 const parameters=account.mortgage||evidence;
 return {...parameters,
  statementReference:parameters.statementReference||evidence?.statementReference,
  annualRatePpm:parameters.annualRatePpm??evidence?.annualRatePpm,
 };
}
export function missingMortgageFields(account:any) {
 if(account.status==='archived'||!account.mortgageEvidence)return [];
 const parameters=mortgageFormParameters(account);
 return [
  !parameters.originalPrincipalMinor&&'原贷款额',
  !parameters.statementReference&&'账单尾号',
  !parameters.termMonths&&'原合同期限',
  !parameters.firstPaymentDate&&'首次还款日期',
  parameters.loanType==='commercial'&&!parameters.annualRatePpm&&'已知年利率',
 ].filter(Boolean);
}
export default function MortgageAccounts({models,accounts,onSave,busy}:{models:any[];accounts:any[];onSave:(account:any)=>Promise<any>;busy:boolean}){
 const [detail,setDetail]=useState<string>(),[editing,setEditing]=useState<any>(),[open,setOpen]=useState(false),[saving,setSaving]=useState(false),[form]=Form.useForm();
 const model=models.find(m=>m.financialAccountId===detail),loanType=Form.useWatch('loanType',form);
 const mortgages=accounts.filter(account=>account.status!=='archived'&&(account.mortgage||account.mortgageEvidence));
 const edit=(account:any)=>{
  const m=mortgageFormParameters(account);
  setEditing(account);
  form.resetFields();
  form.setFieldsValue({label:account.label,loanType:m.loanType,sourceAccountId:m.sourceAccountId,
   statementReference:m.statementReference||'',termMonths:m.termMonths??'',firstPaymentDate:m.firstPaymentDate||'',
   originalPrincipal:decimal(m.originalPrincipalMinor),annualRate:m.annualRatePpm==null?'':String(Number(m.annualRatePpm)/10000),
   recentPrincipal:decimal(m.recentSplit?.principalMinor),recentInterest:decimal(m.recentSplit?.interestMinor),
   prepayments:(m.prepayments||[]).map((p:any)=>({date:p.date,amount:decimal(p.amountMinor),amountBasis:p.amountBasis||'principal'}))});
  setOpen(true);
 };
 const save=async()=>{if(saving||!editing)return;setSaving(true);try{
  const v=await form.validateFields(),prior=editing?.mortgage;
  const recent:any=v.recentPrincipal||v.recentInterest?{principalMinor:inputMoney(v.recentPrincipal),interestMinor:inputMoney(v.recentInterest),month:null,monthBasis:'latest_matching_statement'}:null;
  if(recent&&prior?.recentSplit&&recent.principalMinor===prior.recentSplit.principalMinor&&recent.interestMinor===prior.recentSplit.interestMinor){recent.month=prior.recentSplit.month;recent.monthBasis=prior.recentSplit.monthBasis||'bank_confirmed';}
  const mortgage={schema:'mortgage-v1',loanType:v.loanType,sourceAccountId:v.sourceAccountId,statementReference:v.statementReference,originalPrincipalMinor:inputMoney(v.originalPrincipal),...(v.termMonths?{termMonths:Number(v.termMonths)}:{}),...(v.firstPaymentDate?{firstPaymentDate:v.firstPaymentDate}:{}),annualRatePpm:v.annualRate?percent(v.annualRate):null,recentSplit:recent,prepayments:(v.prepayments||[]).map((p:any)=>({date:p.date,amountMinor:inputMoney(p.amount),amountBasis:p.amountBasis||'total_payment',mode:'reduce_payment_keep_term'}))};
  if(prior?.loanType==='commercial'&&v.loanType==='commercial'){
   if(prior.minimumAnnualRatePpm!==undefined)Object.assign(mortgage,{minimumAnnualRatePpm:prior.minimumAnnualRatePpm});
   if(prior.repricingTerms!==undefined)Object.assign(mortgage,{repricingTerms:structuredClone(prior.repricingTerms)});
  }
  const saved=await onSave({...editing,label:v.label,mortgage});if(saved)setOpen(false);
 }catch(e:any){message.error(e.code||e.message||'\u8d37\u6b3e\u53c2\u6570\u672a\u4fdd\u5b58');}finally{setSaving(false);}};
 return <Card title="房贷债务" style={{marginTop:16}}>
  {!mortgages.length?<p>导入可识别的房贷账单后，系统会自动创建账户。</p>:mortgages.map(account=>{
   const m=models.find(model=>model.financialAccountId===account.id);
   const missing=account.mortgageEvidence?missingMortgageFields(account):[];
   const principal=m?.originalPrincipalMinor||(account.mortgage||account.mortgageEvidence).originalPrincipalMinor;
   return <Card key={account.id} size="small" title={account.label} style={{marginTop:12}} extra={<Space wrap>
    {m&&<Button onClick={()=>setDetail(account.id)}>本息与计算依据</Button>}
    <Button disabled={busy} onClick={()=>edit(account)}>{missing.length?'补充资料':'贷款参数'}</Button>
   </Space>}>
    {(principal!=null||m)&&<Space wrap>
     {principal!=null&&<span>原贷款 {money(principal)}&nbsp;元</span>}
     {m&&<strong>{mortgageActual(m)?'剩余本金（银行记录）':'剩余本金估算'} {money(m.balanceMinor)}{m.balanceMinor!=null&&<>&nbsp;元</>}</strong>}
     {m&&<Tag color={mortgageActual(m)?'blue':'gold'}>{mortgageActual(m)?'银行还款记录':m.status==='estimated'?'模型估算':'依据待补充'}</Tag>}
    </Space>}
    {!!missing.length&&<div><Space wrap size={4}><Tag color="gold">资料待补充</Tag><span className="finance-muted">{missing.join('、')}</span></Space></div>}
    {m&&<p className="finance-muted">截至 {m.asOf||'—'} · 已还 {m.paymentCount??m.periods?.length??0} 期 · 提前还款 {m.prepayments.length} 笔</p>}
    {m?.nextPayment&&<p>下期预计：本金 {money(m.nextPayment.principalMinor)} · 利息 {money(m.nextPayment.interestMinor)}</p>}
   </Card>;
  })}
  <Drawer rootClassName="editor-drawer mortgage-detail-drawer" title={model?.label+' \u00b7 \u672c\u606f\u4e0e\u8ba1\u7b97\u4f9d\u636e'} open={!!model} onClose={()=>setDetail(undefined)} width={920}>
    {model&&<><section className="editor-drawer__section"><Tag color={mortgageActual(model)?'blue':'gold'}>{mortgageActual(model)?'银行记录':'估算'}</Tag>
    {model.lprAnalysis&&<p>参考 LPR {rate(model.lprAnalysis.impliedReferenceLprPpm)} · <a href={model.lprAnalysis.source} target="_blank" rel="noreferrer">利率来源</a></p>}

    {(model.contractTermMonths||model.firstPaymentDate)&&<p>{'\u5df2\u786e\u8ba4\u539f\u5408\u540c\u4fe1\u606f\uff1a'}{model.contractTermMonths?model.contractTermMonths+' \u4e2a\u6708':''}{model.firstPaymentDate?'\uff1b\u9996\u6b21\u8fd8\u6b3e '+model.firstPaymentDate:''}</p>}
    {mortgageActual(model)&&model.bankStatementTermMonths&&model.bankStatementTermMonths!==model.contractTermMonths&&<p>银行明细所列期限 {model.bankStatementTermMonths}&nbsp;个月</p>}
    {model.contractComparison&&<p>剩余 {model.contractComparison.remainingPeriods} 期{model.contractComparison.status==='payment_differs'&&<> · 预计月供 {money(model.contractComparison.expectedPaymentMinor)} <Tag color="gold">与账单不一致</Tag></>}</p>}

    {model.inferredTermMonths&&<p>{'\u81ea\u52a8\u5339\u914d\u671f\u9650\uff1a'}{model.inferredTermMonths}{' \u4e2a\u6708\u3002'}</p>}
    </section>
    <Table className="editor-drawer__table" rowKey="month" size="small" dataSource={model.periods} pagination={{pageSize:12}} scroll={{x:780}} columns={[{title:'\u8d26\u5355\u671f',dataIndex:'month'},{title:'\u6263\u6b3e\u5408\u8ba1',dataIndex:'amountMinor',render:money},{title:'\u672c\u91d1',dataIndex:'principalMinor',render:money},{title:'\u5229\u606f',dataIndex:'interestMinor',render:money},{title:'\u53e6\u5217\u5dee\u989d',dataIndex:'extraMinor',render:money},{title:'剩余本金',dataIndex:'balanceMinor',render:money},{title:'\u5e74\u5229\u7387',dataIndex:'annualRatePpm',render:rate},{title:'\u4f9d\u636e',dataIndex:'confidence',render:mortgageBasis}]}/>
    {model.prepayments.map((p:any)=><p key={p.date}>{p.date}{p.confidence==='actual_bank_statement'?<> 提前还款合计 {money(p.amountMinor)} 元；本金 {money(p.principalMinor)} 元，利息 {money(p.interestMinor)} 元（银行记录）。</>:p.amountBasis==='total_payment'?<>{' \u63d0\u524d\u8fd8\u6b3e\u5408\u8ba1 '}{money(p.amountMinor)}{' \u5143\uff1b\u672c\u91d1\u4e0e\u5229\u606f\u5c1a\u672a\u62c6\u5206\u3002'}</>:<>{' \u63d0\u524d\u8fd8\u672c '}{money(p.principalMinor)}{' \u5143\u3002'}</>}{'\u671f\u9650\u4e0d\u53d8\u3001\u964d\u4f4e\u6708\u4f9b\u3002'}</p>)}
    {model.periods.filter((p:any)=>p.extraExplanation).map((p:any)=><p key={p.month}>{p.month} · 罚息估算 {money(p.extraMinor)}</p>)}
    {model.warnings.map((w:any,i:number)=><p key={i}>{warning(w)}</p>)}
    {model.policySources?.map((url:string,i:number)=><p key={url}><a href={url} target="_blank" rel="noreferrer">{'\u516c\u5f00\u5229\u7387\u4e0e\u8ba1\u606f\u89c4\u5219\u4f9d\u636e '}{i+1}</a></p>)}
   </>}
  </Drawer>
  <Modal
    title={editing?.mortgageEvidence&&missingMortgageFields(editing).length?'补充房贷资料':'贷款参数'}
    open={open}
    className="editor-modal editor-modal--form"
    width={640}
    centered
    forceRender
    okText="保存参数"
    cancelText="取消"
    okButtonProps={{ 'aria-label': '保存参数' }}
    cancelButtonProps={{ disabled: saving }}
    confirmLoading={saving}
    closable={!saving}
    maskClosable={!saving}
    keyboard={!saving}
    onCancel={() => setOpen(false)}
    onOk={() => void save()}
  >
    <Form form={form} layout="vertical" className="editor-form">
      <section className="editor-form__details" aria-label="房贷参数">
        <div className="editor-form__fields">
          <div>
            <Form.Item name="label" label="账户名称" rules={[{ required: true }]}>
              <Input title={editing?.label} />
            </Form.Item>
            <Form.Item name="loanType" label="贷款类型" rules={[{ required: true }]}>
              <Select disabled options={[
                { value: 'commercial', label: '商业房贷' },
                { value: 'provident', label: '公积金房贷' },
              ]} />
            </Form.Item>
            <Form.Item name="originalPrincipal" label="原贷款额" rules={[{ required: true }]}>
              <Input inputMode="decimal" suffix="元" />
            </Form.Item>
            <Form.Item name="termMonths" label="原合同期限" rules={[{ pattern: /^[1-9]\d{0,2}$/, message: '请填写整数月数' }]}>
              <Input type="number" min={1} max={600} suffix="月" />
            </Form.Item>
            <Form.Item name="firstPaymentDate" label="首次还款日期">
              <Input type="date" />
            </Form.Item>
          </div>
          <div>
            <Form.Item name="sourceAccountId" label="还款储蓄卡" rules={[{ required: true }]}>
              <Select
                popupMatchSelectWidth={false}
                options={accounts.filter(account => ['bank', 'debit_card', 'savings'].includes(account.type) && account.currency === 'CNY' && account.status === 'active')
                  .map(account => ({ value: account.id, label: account.label }))}
              />
            </Form.Item>
            <Form.Item name="statementReference" label="账单尾号" rules={[{ required: true, pattern: /^\d{4}$/, message: '请输入 4 位尾号' }]}>
              <Input inputMode="numeric" maxLength={4} placeholder={loanType === 'provident' ? '公积金附言尾号' : '账单贷款尾号'} />
            </Form.Item>
            <Form.Item name="annualRate" label="已知年利率">
              <Input inputMode="decimal" suffix="%" placeholder={loanType === 'provident' ? '留空自动匹配' : '例如 3.3'}
                title={loanType === 'provident' ? '留空时自动匹配历史公开利率' : undefined} />
            </Form.Item>
            <Form.Item name="recentPrincipal" label="近期本金参考">
              <Input inputMode="decimal" suffix="元" />
            </Form.Item>
            <Form.Item name="recentInterest" label="近期利息参考">
              <Input inputMode="decimal" suffix="元" />
            </Form.Item>
          </div>
        </div>
      </section>

      <section className="mortgage-editor__prepayments" aria-label="提前还款">
        <div className="mortgage-editor__heading">
          <h3>提前还款</h3>
          <span>期限不变，降低月供</span>
        </div>
        <Form.List name="prepayments">
          {(fields, { add, remove }) => (
            <div className="editor-form__table-wrap">
              <table className="editor-form__table mortgage-editor__prepayments-table" aria-label="提前还款">
                <thead>
                  <tr>
                    <th scope="col">日期</th>
                    <th scope="col">金额</th>
                    <th scope="col">金额口径</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map(({ key, name }) => (
                    <tr key={key}>
                      <td>
                        <Form.Item name={[name, 'date']} rules={[{ required: true, message: '请选择日期' }]}>
                          <Input type="date" aria-label={'第 ' + (name + 1) + ' 笔提前还款日期'} />
                        </Form.Item>
                      </td>
                      <td>
                        <Form.Item name={[name, 'amount']} rules={[{ required: true, message: '请输入金额' }]}>
                          <Input inputMode="decimal" suffix="元" aria-label={'第 ' + (name + 1) + ' 笔提前还款金额'} />
                        </Form.Item>
                      </td>
                      <td>
                        <Form.Item name={[name, 'amountBasis']} rules={[{ required: true, message: '请选择金额口径' }]}>
                          <Select aria-label={'第 ' + (name + 1) + ' 笔提前还款金额口径'} options={[
                            { value: 'total_payment', label: '扣款合计' },
                            { value: 'principal', label: '偿还本金' },
                          ]} />
                        </Form.Item>
                      </td>
                      <td>
                        <Button
                          className="editor-form__row-action editor-form__row-action--remove"
                          type="text"
                          danger
                          title="移除此笔"
                          aria-label={'移除第 ' + (name + 1) + ' 笔提前还款'}
                          onClick={() => remove(name)}
                        >
                          <span aria-hidden="true">×</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                  <tr className="mortgage-editor__add-row">
                    <td>
                      <Button
                        className="editor-form__row-action editor-form__row-action--add"
                        type="text"
                        title="增加提前还款"
                        aria-label="增加提前还款"
                        onClick={() => add({ amountBasis: 'total_payment' })}
                      >
                        <span aria-hidden="true">＋</span>
                      </Button>
                    </td>
                    <td />
                    <td />
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Form.List>
      </section>
    </Form>
  </Modal>
 </Card>;
}
