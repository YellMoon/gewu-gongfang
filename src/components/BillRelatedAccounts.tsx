import React from 'react';
import {Select, Space} from 'antd';
export const relatedAccountsReady = (items:any[]=[]) => items.every(item=>['matched','create'].includes(item.status));
export const relatedAccountSnapshot = (items:any[]=[]) => Object.fromEntries(items.filter(item=>item.account).map(item=>[item.product,item.account.id]));
export default function BillRelatedAccounts({items=[],selected={},disabled,onChange}:any){
 return <div>{items.map((item:any)=><div key={item.product} style={{margin:'8px 0',lineHeight:1.8}}><Space wrap>
  <span>关联账户：{item.account?.label || item.candidates?.[0]?.label || item.product} · {item.status==='create'?'确认导入时自动创建':item.status==='matched'?'已匹配':item.status==='archived'?'账户已归档，请恢复后重新验证':'存在多个候选，请确认后重新验证'}</span>
  {['ambiguous','manual'].includes(item.status)&&<Select aria-label={`关联账户 ${item.product}`} placeholder="选择此账单对应的账户" style={{minWidth:230}} disabled={disabled} value={selected[item.product]} options={(item.candidates||[]).map((a:any)=>({value:a.id,label:a.label+' · '+a.currency}))} onChange={id=>onChange({...selected,[item.product]:id})}/>}
 </Space></div>)}</div>;
}
