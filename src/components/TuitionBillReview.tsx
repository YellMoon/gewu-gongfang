import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Drawer, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
// @ts-ignore Shared suggestions never authorize a write.
import { buildTuitionCandidates, moneyMinor, similarPayments, studentLabel } from '../../shared/personal-finance/tuitionReview';
import { formatMinor } from '../services/personalFinanceClient.mjs';

type Props={open:boolean;onClose:()=>void;transactions:any[];revision:string;scopeKey:string;client:any};
const minor=(v:string)=>moneyMinor(v)||'0';
export default function TuitionBillReview({open,onClose,transactions,revision,scopeKey,client}:Props){
 const [data,setData]=useState<any>(),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [drafts,setDrafts]=useState<Record<string,any>>({}),[selected,setSelected]=useState<string[]>([]),[expanded,setExpanded]=useState<string[]>([]);
 const [search,setSearch]=useState(''),[includeAll,setAll]=useState(false),[status,setStatus]=useState('pending'),[confirm,setConfirm]=useState(false);
 const mounted=useRef(true),owner=useRef(scopeKey),retry=useRef<any>();owner.current=scopeKey;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const current=(s:string)=>mounted.current&&owner.current===s;
 useEffect(()=>{if(!open)return;let active=true;const s=scopeKey;setLoading(true);setData(undefined);setError('');setDrafts({});setSelected([]);setExpanded([]);setConfirm(false);retry.current=undefined;
  client.tuitionReviewState().then((r:any)=>{if(active&&current(s)){if(r.review.revision!==revision)throw Error('REVISION');setData(r.review);}}).catch((e:any)=>{if(active&&current(s))setError(e.code==='CLOUD_PERSONAL_FINANCE_ACCESS_DENIED'?'缴费登记需要管理员权限，请切换管理员角色后使用。':e.message==='REVISION'?'账本已更新，请关闭列表并刷新账本后重新核对。':'无法读取学生和缴费记录，请联网后重新打开列表。');}).finally(()=>{if(active&&current(s))setLoading(false);});
  return()=>{active=false;};
 },[open,revision,scopeKey,client]);
 const rows=useMemo(()=>data?buildTuitionCandidates({transactions,students:data.students,payments:data.payments,links:data.links,includeAll:true}):[],[transactions,data]);
 const likely=useMemo(()=>new Set(data?buildTuitionCandidates({transactions,students:data.students,links:data.links}).map((r:any)=>r.id):[]),[transactions,data]);
 const byId=useMemo(()=>new Map(rows.map((r:any)=>[r.id,r])),[rows]);
 const initial=(r:any)=>{if(r.linked)return {ignored:false,remainderAcknowledged:false,allocations:r.linked.allocations.map((a:any)=>({studentId:a.studentId,amount:formatMinor(a.amountMinor),existingPaymentId:a.paymentId,allowSimilar:false}))};const p=r.similarPayments.length===1?r.similarPayments[0]:null;return {ignored:false,remainderAcknowledged:false,allocations:[{studentId:r.suggestedStudentId,amount:formatMinor(r.amountMinor),existingPaymentId:p?.id||'',allowSimilar:false}]};};
 const draft=(r:any)=>drafts[r.id]||initial(r);
 const change=(r:any,patch:any)=>{setDrafts(d=>({...d,[r.id]:{...(d[r.id]||initial(r)),...patch}}));setSelected(ids=>ids.filter(id=>id!==r.id));};
 const allocation=(r:any,index:number,patch:any)=>change(r,{allocations:draft(r).allocations.map((a:any,i:number)=>i===index?{...a,...patch}:a)});
 const selectedRows=selected.map(id=>byId.get(id)).filter(Boolean);
 const validate=(r:any)=>{const d=draft(r),ids=new Set();if(d.ignored||r.linked)return false;let sum=0n;
  for(const a of d.allocations){if(!data.students.some((s:any)=>s.id===a.studentId)||ids.has(a.studentId)||!moneyMinor(a.amount)||BigInt(minor(a.amount))<=0n)return false;ids.add(a.studentId);sum+=BigInt(minor(a.amount));
   if(!a.existingPaymentId&&!a.allowSimilar&&similarPayments(data.payments,{studentId:a.studentId,amountMinor:minor(a.amount),date:r.date}).length)return false;
  }
  return sum<=BigInt(r.amountMinor)&&(sum===BigInt(r.amountMinor)||d.remainderAcknowledged);
 };
 const selectRows=(keys:React.Key[])=>{const valid=keys.map(String).filter(id=>{const r=byId.get(id);return r&&validate(r);});if(valid.length!==keys.length)message.warning('请先完善学生、金额及已有缴费处理，再确认此笔。');if(valid.length>50){message.warning('每批最多提交50笔，可分批核对。');return;}setSelected(valid);};
 const visible=rows.filter((r:any)=>{const d=draft(r),q=search.trim().toLowerCase(),text=[r.counterparty,r.description,r.date,r.sourceTransactionId,...r.matches.map((m:any)=>data.students.find((s:any)=>s.id===m.studentId)?.name||'')].join(' ').toLowerCase();return (includeAll||likely.has(r.id))&&(!q||text.includes(q))&&(status==='all'||status==='linked'&&r.linked||status==='ignored'&&d.ignored||status==='confirmed'&&selected.includes(r.id)||status==='pending'&&!r.linked&&!d.ignored&&!selected.includes(r.id));});
 const submit=async()=>{if(!selectedRows.length||selectedRows.some(r=>!validate(r))){message.error('核对内容已变化，请重新确认。');return;}const s=scopeKey;setBusy(true);setError('');
  const payload={expectedRevision:revision,confirmed:true,rows:selectedRows.map((r:any)=>({source:r.source,remainderAcknowledged:!!draft(r).remainderAcknowledged,allocations:draft(r).allocations.map((a:any)=>{const p=data.payments.find((p:any)=>p.id===a.existingPaymentId);return {studentId:a.studentId,amountMinor:minor(a.amount),...(p?{existingPaymentId:p.id,expectedUpdatedAt:p.updated_at}:{allowSimilar:!!a.allowSimilar})};})}))};
  const json=JSON.stringify(payload);if(retry.current?.json!==json)retry.current={json,key:crypto.randomUUID()};
  try{const result=await client.submitTuitionReview(payload,retry.current.key);if(!current(s))return;setConfirm(false);setSelected([]);retry.current=undefined;message.success('已新增'+result.receipt.created+'条缴费，关联'+result.receipt.linked+'条已有缴费。');
   try{const refreshed=await client.tuitionReviewState();if(current(s))setData(refreshed.review);}catch{if(current(s))setError('本批已写入，列表刷新失败。重新打开后可查看已登记结果。');}
   try{await (window as any).dbService?.refreshAuthorityProjection?.({businessOnly:true,notifyConsumers:true});}catch{if(current(s))message.warning('缴费已保存，缴费页暂未刷新，请稍后刷新。');}
  }catch(e:any){if(current(s))setError(/CONFLICT/.test(e.code||'')?'来源、学生或已有缴费发生变化，整批未写入。请重新打开列表核对；若网络异常，可重试原批次。':'提交未得到确认，请保留本批核对内容并重试；相同批次不会重复登记。');}
  finally{if(current(s))setBusy(false);}
 };
 const editor=(r:any)=>{const d=draft(r),sum=d.allocations.reduce((n:bigint,a:any)=>n+BigInt(minor(a.amount)),0n),left=BigInt(r.amountMinor)-sum;
  return <div className="tuition-editor"><p>原交易号：{r.sourceTransactionId||'未提供'}；原始收款 {formatMinor(r.amountMinor)} 元。匹配建议不会自动选中。</p>
   {d.allocations.map((a:any,i:number)=>{const similar=similarPayments(data.payments,{studentId:a.studentId,amountMinor:minor(a.amount),date:r.date});const choices=data.payments.filter((p:any)=>p.student_id===a.studentId&&moneyMinor(p.amount)===minor(a.amount));return <div className="tuition-allocation" key={i}>
    <Select aria-label={'第'+(i+1)+'项学生'} showSearch optionFilterProp="label" value={a.studentId||undefined} placeholder="选择学生（请核对编号）" options={data.students.map((s:any)=>({value:s.id,label:studentLabel(s)}))} onChange={v=>allocation(r,i,{studentId:v,existingPaymentId:'',allowSimilar:false})}/>
    <Input aria-label={'第'+(i+1)+'项缴费金额'} addonAfter="元" inputMode="decimal" value={a.amount} onChange={e=>allocation(r,i,{amount:e.target.value,existingPaymentId:'',allowSimilar:false})}/>
    <Select aria-label={'第'+(i+1)+'项登记方式'} value={a.existingPaymentId||''} options={[{value:'',label:'新增缴费记录'},...choices.map((p:any)=>({value:p.id,label:'关联已有：'+p.payment_date+' · '+p.amount+'元 · '+(p.payment_method||'未注明方式')}))]} onChange={v=>allocation(r,i,{existingPaymentId:v,allowSimilar:false})}/>
    {d.allocations.length>1&&<Button onClick={()=>change(r,{allocations:d.allocations.filter((_:any,n:number)=>n!==i)})}>移除此项</Button>}
    {!a.existingPaymentId&&<Checkbox checked={a.allowSimilar} onChange={e=>allocation(r,i,{allowSimilar:e.target.checked})}>{similar.length?'附近3天已有同学生同额缴费；已核对，仍需新增':'已核对，允许与同批同额缴费分别新增'}</Checkbox>}
   </div>;})}
   <Space wrap><Button disabled={d.allocations.length>=10} onClick={()=>change(r,{allocations:[...d.allocations,{studentId:'',amount:'',existingPaymentId:'',allowSimilar:false}]})}>拆分给另一位学生</Button><span>未分配：{formatMinor(left.toString())} 元</span>{left>0n&&<Checkbox checked={d.remainderAcknowledged} onChange={e=>change(r,{remainderAcknowledged:e.target.checked})}>确认剩余金额不登记为学费</Checkbox>}</Space>
   <p><Button type="primary" disabled={busy||d.ignored||!!r.linked} onClick={()=>selectRows([...selected.filter(id=>id!==r.id),r.id])}>确认此笔并加入提交</Button></p>
  </div>;
 };
 return <Drawer title="账单学费核对" open={open} width="min(1440px, 100vw)" onClose={()=>{if(busy)return;if(selected.length||Object.keys(drafts).length)Modal.confirm({title:'关闭学费核对？',content:'本窗口还有核对内容尚未提交。关闭后需要重新核对，继续留在列表可保留当前修改。',okText:'放弃本次核对并关闭',cancelText:'继续核对',onOk:onClose});else onClose();}} maskClosable={!busy} keyboard={!busy} destroyOnClose={false}>
  <Alert type="info" showIcon message="先核对，再提交写入" description="候选来自当前账户和日期范围内已去重的微信、支付宝外部入账。昵称和姓名仅作线索；请核对学生编号，修改、拆分或排除记录，确认后再提交。"/>
  {error&&<Alert type="warning" showIcon message={error}/>}
  <Space wrap style={{margin:'16px 0'}}><Input.Search aria-label="搜索学费收款" placeholder="付款人、备注、日期或交易号" value={search} onChange={e=>setSearch(e.target.value)} allowClear style={{width:280}}/><Checkbox checked={includeAll} onChange={e=>setAll(e.target.checked)}>包含其他平台入账</Checkbox><Select aria-label="核对状态" value={status} onChange={setStatus} options={[{value:'pending',label:'未确认'},{value:'confirmed',label:'本批已确认'},{value:'linked',label:'已登记'},{value:'ignored',label:'本次已排除'},{value:'all',label:'全部状态'}]}/><span>已确认 {selected.length} 笔（每批最多50笔）</span><Button type="primary" disabled={!selected.length||busy||!data} onClick={()=>setConfirm(true)}>预览并提交已确认记录</Button></Space>
  <Table rowKey="id" loading={loading||busy} dataSource={visible} pagination={{pageSize:15,showSizeChanger:true}} scroll={{x:1250}} rowSelection={{selectedRowKeys:selected,onChange:selectRows,preserveSelectedRowKeys:true,getCheckboxProps:(r:any)=>({disabled:busy||!!r.linked||draft(r).ignored})}} expandable={{expandedRowKeys:expanded,onExpandedRowsChange:keys=>setExpanded(keys.map(String)),expandedRowRender:editor,rowExpandable:(r:any)=>!r.linked}} columns={[
   {title:'收款时间 / 渠道',width:170,render:(_:any,r:any)=><>{r.date}<div>{r.occurredAt?.slice(11,19)} · {r.provider==='wechat'?'微信':'支付宝'}</div></>},
   {title:'原始付款人 / 备注',width:270,render:(_:any,r:any)=><div style={{whiteSpace:'normal',overflowWrap:'anywhere'}}><strong>{r.counterparty}</strong><div>{r.description}</div></div>},
   {title:'到账金额（元）',width:130,render:(_:any,r:any)=><span style={{fontVariantNumeric:'tabular-nums'}}>{formatMinor(r.amountMinor)}</span>},
   {title:'初步匹配 / 依据',width:340,render:(_:any,r:any)=><><div>{r.linked?<Tag color={r.linked.needsReview?'orange':'green'}>{r.linked.needsReview?'关联缴费已变更，请到缴费页复核':'已登记，保留来源关联'}</Tag>:draft(r).ignored?<Tag>本次已排除</Tag>:selected.includes(r.id)?<Tag color="blue">已人工确认</Tag>:<Tag color="gold">仅为建议</Tag>}</div>{draft(r).allocations.map((a:any,i:number)=><div key={i}>{data.students.find((s:any)=>s.id===a.studentId)?studentLabel(data.students.find((s:any)=>s.id===a.studentId)):'尚未选择学生'}</div>)}<div>{[...new Set(r.reasons)].join('；')||'未发现直接匹配线索'}</div>{r.warnings.map((w:string)=><div key={w} style={{color:'#a15c00'}}>{w}</div>)}{r.similarPayments.length>0&&<div>已有 {r.similarPayments.length} 条相近日期同额缴费</div>}</>},
   {title:'核对',width:170,render:(_:any,r:any)=>r.linked?'已登记':<Space wrap><Button disabled={busy} onClick={()=>setExpanded(ids=>ids.includes(r.id)?ids.filter(id=>id!==r.id):[...ids,r.id])}>核对 / 修改</Button><Button disabled={busy} onClick={()=>change(r,{ignored:!draft(r).ignored})}>{draft(r).ignored?'恢复':'不是学费'}</Button></Space>}
  ]}/>
  <p style={{color:'#666'}}>未提交的核对仅保留在当前窗口；关闭后重新打开会重新生成建议。缴费按原始到账日期登记，不自动增加课时，也不重复计入资产收入。</p>
  <Modal title="确认写入缴费记录" open={confirm} width={850} confirmLoading={busy} maskClosable={!busy} closable={!busy} onCancel={()=>{if(!busy)setConfirm(false);}} okButtonProps={{'aria-label':'提交写入缴费记录'}} cancelText="返回修改" okText="提交写入缴费记录" onOk={()=>void submit()}>
   <p>将提交 {selectedRows.length} 笔收款。请最后核对学生、金额，以及“新增 / 关联已有”的处理方式。</p>
   <Table size="small" rowKey="id" pagination={{pageSize:8}} dataSource={selectedRows.flatMap((r:any)=>draft(r).allocations.map((a:any,i:number)=>({id:r.id+'-'+i,date:r.date,payer:r.counterparty,sourceTransactionId:r.sourceTransactionId,student:studentLabel(data.students.find((s:any)=>s.id===a.studentId)||{id:a.studentId,name:'未知学生'}),amount:formatMinor(minor(a.amount)),action:a.existingPaymentId?'关联已有缴费':'新增缴费'})))} columns={[{title:'到账日期',dataIndex:'date'},{title:'付款人 / 原交易号',render:(_:any,r:any)=><div style={{overflowWrap:'anywhere'}}>{r.payer}<div>{r.sourceTransactionId}</div></div>},{title:'学生',dataIndex:'student'},{title:'金额（元）',dataIndex:'amount'},{title:'处理',dataIndex:'action'}]}/>
   <p>本次仅写入已确认的缴费及来源关联。任一笔校验冲突将整批回滚；网络重试使用原批次凭据防止重复。</p>
  </Modal>
 </Drawer>;
}
