function fail(code) { return Object.assign(new Error(code), { code }); }

export async function loadOperationAudits({ baseUrl, session, filters = {}, signal, fetchImpl = globalThis.fetch } = {}) {
  if (!session?.authorization?.startsWith('Bearer ')) throw fail('AUTHORIZATION_CONTEXT_REQUIRED');
  if (!/^https?:\/\//i.test(baseUrl || '')) throw fail('OPERATION_AUDIT_BASE_URL_REQUIRED');
  const pageSize = Number(filters.pageSize) || 20;
  const page = Number(filters.page) || 1;
  const query = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
  for (const key of ['q', 'action', 'status', 'from', 'to']) if (filters[key]) query.set(key, String(filters[key]));
  const timeout = new AbortController();
  const abort = () => timeout.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 20000);
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/desktop/operation-audits?${query}`, { headers: { Accept: 'application/json', Authorization: session.authorization }, signal: timeout.signal });
    let payload;
    try { payload = await response.json(); } catch (_) { throw fail('OPERATION_AUDIT_RESPONSE_INVALID'); }
    if (!response.ok || payload?.success !== true) throw fail(payload?.code || 'OPERATION_AUDIT_REQUEST_FAILED');
    const data = payload.data;
    if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total) || data.total < 0 || !['tenant', 'self'].includes(data.scope)) throw fail('OPERATION_AUDIT_RESPONSE_INVALID');
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export function auditErrorMessage(code) {
  if (['AUTHORIZATION_CONTEXT_REQUIRED', 'CLOUD_BUSINESS_ACCESS_DENIED'].includes(code)) return '当前登录已失效或没有查看权限，请重新登录后重试。';
  return '云端操作日志暂时无法加载，请检查网络后重试。';
}
export const auditActionLabels = { create: '新增', update: '修改', delete: '删除', command: '题库变更', task: '提交任务' };
export const auditStatusLabels = { success: '成功', conflict: '版本冲突', error: '失败', rejected: '已拒绝', unknown: '结果待确认' };
export const auditResourceLabels = { schedules: '排课', courses: '课程', teachers: '教师', students: '学生', rooms: '教室', schools: '学校', institutions: '机构', payments: '缴费', consumptions: '课时消耗', grades: '成绩', 'personal-asset-categories': '资产分类', 'personal-asset-records': '资产记录', questions: '试题', 'question-bank': '题库', 'question-imports': '试题导入', 'paper-export-tasks': '试卷导出', 'miniapp-paper-export-tasks': '小程序试卷导出', 'miniapp-personal-assets': '小程序资产导入', 'miniapp-question-assets': '小程序试题资源', taxonomy: '题库体系' };
const fieldLabels = {
  request: '提交字段（脱敏）', changeCapture: '记录范围', completedAt: '完成时间', items: '明细', version: '版本', result: '云端结果', response: '云端响应', method: '请求方式', path: '操作路径', code: '结果代码', httpStatus: '响应状态',
  name: '名称', displayName: '显示名称', type: '类型', active: '启用', year: '年度', semester: '学期', date: '日期', startTime: '开始时间', endTime: '结束时间', status: '状态', durationMinutes: '时长（分钟）', defaultDurationMinutes: '默认时长（分钟）',
  expectedUpdatedAt: '提交依据版本', updatedAt: '云端更新时间', billingUnit: '计费单位', teacherFeeMode: '教师费用口径', priceTuition: '学费单价', priceTeacher: '教师课时费单价', amount: '金额', hours: '课时', count: '数量',
  studentId: '学生编号', courseId: '课程编号', scheduleId: '排课编号', teacherId: '教师编号', institutionId: '机构编号', roomId: '教室编号', commandId: '命令编号', action: '操作', id: '记录编号', paymentDate: '缴费日期', paymentType: '缴费类型', sourceType: '来源类型',
  fields: '涉及字段', changedFields: '涉及字段', resourceId: '对象编号', resourceType: '对象类型', questionId: '试题编号', taskId: '任务编号',
};
export function auditFieldLabel(key) { return fieldLabels[key] || key; }
