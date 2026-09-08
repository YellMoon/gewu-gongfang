// UTF-8: a pending institution command overlays a derived cache only.
const marker='机构课程费用专用学生';
const failure=code=>Object.assign(new Error(code),{code});
export function overlayInstitutionBillingDraft(cache,institution){
  if(!institution?.id||!Array.isArray(cache?.students))throw failure('INSTITUTION_BILLING_DRAFT_INVALID');
  const linkedId=institution.billing_student_id;
  const candidates=cache.students.filter(s=>s.institution_id===institution.id&&s.is_institution_student&&s.notes===marker);
  if(!linkedId&&candidates.length>1)throw failure('INSTITUTION_BILLING_DRAFT_AMBIGUOUS');
  const id=linkedId||candidates[0]?.id||'institution-student-'+institution.id;
  const existing=cache.students.find(s=>s.id===id);
  if(existing&&(existing.institution_id!==institution.id||!existing.is_institution_student))throw failure('INSTITUTION_BILLING_DRAFT_ID_CONFLICT');
  if(linkedId&&!existing)throw failure('INSTITUTION_BILLING_STUDENT_NOT_LOADED');
  const name=String(institution.name||'').trim()+'学生';
  const row=existing?{...existing,name,source_type:2}:{
    id,name,institution_id:institution.id,source_type:2,is_institution_student:true,
    balance_hours:0,balance_money:0,notes:marker,created_at:institution.created_at,updated_at:institution.updated_at,
  };
  cache.students=existing?cache.students.map(s=>s.id===id?row:s):[...cache.students,row];
  return row;
}
