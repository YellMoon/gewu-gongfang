// UTF-8 user copy. Presentation only: never changes a draft or its submission.
const entities = {student:'\u5b66\u751f',teacher:'\u6559\u5e08',course:'\u8bfe\u7a0b',schedule:'\u6392\u8bfe',room:'\u4e0a\u8bfe\u5730\u5740',institution:'\u673a\u6784',school:'\u5b66\u6821',payment:'\u7f34\u8d39',consumption:'\u8bfe\u8017',grade:'\u6210\u7ee9','personal-asset-record':'\u8d44\u4ea7\u8bb0\u5f55','personal-asset-category':'\u8d44\u4ea7\u5206\u7c7b',question:'\u8bd5\u9898'};
const collections = {student:'students',teacher:'teachers',course:'courses',schedule:'schedules',room:'rooms',institution:'institutions',school:'schools',payment:'payments',consumption:'consumptions',grade:'grades','personal-asset-record':'assetRecords','personal-asset-category':'assetCategories',question:'questions'};
const actions = {create:'\u65b0\u589e',update:'\u4fee\u6539',delete:'\u5220\u9664'};
const dateFormat = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function dateText(value) {
  if(typeof value!=='string'||!value) return '';
  const date=new Date(value); if(!Number.isFinite(date.getTime())) return '';
  const p=Object.fromEntries(dateFormat.formatToParts(date).map(part=>[part.type,part.value]));
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
}
function describeAuthorityDraft(item, cache={}) {
  const match=/^([a-z-]+)\.(create|update|delete)\.v\d+$/.exec(item?.type||'');
  const entity=match?.[1]; const action=match?.[2];
  const title=entities[entity]?actions[action]+entities[entity]:'\u5f85\u63d0\u4ea4\u7684\u66f4\u6539';
  const payload=item?.payload||{};
  const rows=cache[collections[entity]];
  const previous=Array.isArray(rows)?rows.find(row=>row.id===payload.id):null;
  const record={...previous,...(payload.record||payload.changes||{})};
  const details=[];
  const add=(label,value)=>{if(value!==undefined&&value!==null&&String(value).trim())details.push({label,value:String(value)});};
  let name=record.display_name||record.name||'';
  let time='';
  if(entity==='schedule') {
    add('计费单位',({1:'按小时',2:'按次'})[record.billing_unit]);
    add('教师计费方式',({1:'按课次',2:'按学生'})[record.teacher_fee_mode]);
    add('教师',record.teacher_name);
    const course=(cache.courses||[]).find(row=>row.id===record.course_id);
    name=course?.display_name||course?.name||'';
    time=dateText(record.start_time);
    add('\u8bfe\u7a0b',name);add('\u5f00\u59cb\u65f6\u95f4',time);add('\u7ed3\u675f\u65f6\u95f4',dateText(record.end_time));add('\u4e0a\u8bfe\u5730\u5740',record.room);
    for(const [field,label] of [['calculated_tuition','\u5b66\u8d39\u5408\u8ba1'],['calculated_teacher_fee','\u6559\u5e08\u8bfe\u65f6\u8d39\u5408\u8ba1']]) {
      if(typeof record[field]==='number'&&Number.isFinite(record[field])) add(label,record[field]+' \u5143');
    }
  } else {
    add('\u540d\u79f0',name);
    for(const [field,label] of [['subject','\u79d1\u76ee'],['address','\u5730\u5740'],['school','\u5b66\u6821'],['teacher_name','\u6559\u5e08'],['room_name','\u4e0a\u8bfe\u5730\u5740'],['amount','\u91d1\u989d'],['score','\u6210\u7ee9'],['notes','\u5907\u6ce8']]) add(label,record[field]);
  }
  return {title,summary:[name,time].filter(Boolean).join(' \u00b7 ')||title,details};
}
function authorityDraftError(code) {
  const text=String(code||'');
  // UTF-8: explain the recoverable user action, not the internal dependency protocol.
  if (text === 'AUTHORITY_DRAFT_CONFIRMATION_CHANGED') return '更改内容已变化，请重新查看并确认。';
  if (text === 'AUTHORITY_DRAFT_DEPENDENCY_CONFIRMATION_REQUIRED') return '关联的上课地址尚未确认，请查看课程更改并一并确认。';
  if (text === 'AUTHORITY_DRAFT_DEPENDENCY_BLOCKED') return '上课地址尚未提交成功，请先处理对应的地址更改。课程草稿已保留。';
  if(/ACCESS_DENIED|FORBIDDEN/.test(text)) return '\u5f53\u524d\u8d26\u53f7\u6ca1\u6709\u4fee\u6539\u6743\u9650\uff0c\u8349\u7a3f\u5df2\u4fdd\u7559\u3002\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u3002';
  if(/CONFLICT|VERSION|UPDATED_AT/.test(text)) return '\u8fd9\u6761\u8bb0\u5f55\u5df2\u53d1\u751f\u53d8\u5316\uff0c\u8349\u7a3f\u5df2\u4fdd\u7559\u3002\u8bf7\u6838\u5bf9\u540e\u518d\u63d0\u4ea4\u3002';
  if(/SESSION|LOGIN|AUTHENTICAT/.test(text)) return '\u8bf7\u91cd\u65b0\u767b\u5f55\u540e\u518d\u63d0\u4ea4\uff0c\u8349\u7a3f\u5df2\u4fdd\u7559\u3002';
  if(/ASSET|RELAY/.test(text)) return '\u9644\u4ef6\u6682\u672a\u4e0a\u4f20\u5b8c\u6210\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002';
  return '\u6682\u65f6\u65e0\u6cd5\u63d0\u4ea4\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002\u8349\u7a3f\u5df2\u4fdd\u7559\u3002';
}
module.exports={describeAuthorityDraft,authorityDraftError};
