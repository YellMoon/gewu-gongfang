'use strict';

const { randomUUID } = require('node:crypto');
const STATUS = new Set(['success', 'conflict', 'error', 'rejected', 'unknown']);
const ACTIONS = new Set(['create', 'update', 'delete', 'command', 'task']);
const RESOURCES = 'schedules|students|teachers|rooms|courses|institutions|schools|payments|consumptions|grades|personal-asset-categories|personal-asset-records';
const CORE = new RegExp(`^/api/business/(${RESOURCES})(?:/([^/]+))?(?:/.*)?$`);
const LIMITED = /^\/api\/(desktop|business)\/(question-bank|question-imports|paper-export-tasks|miniapp-personal-assets|miniapp-paper-export-tasks|miniapp-question-assets)(?:\/([^/]+))?(?:\/.*)?$/;
const RESOURCE_KEYS = { schedules:'scheduleId',students:'studentId',teachers:'teacherId',rooms:'roomId',courses:'courseId',institutions:'institutionId',schools:'schoolId',payments:'paymentId',consumptions:'consumptionId',grades:'gradeId','personal-asset-categories':'categoryId','personal-asset-records':'recordId' };
const RESOURCE_NAMES = { schedules:'排课',students:'学生',teachers:'教师',rooms:'上课地点',courses:'课程',institutions:'机构',schools:'学校',payments:'缴费',consumptions:'课时消费',grades:'成绩','personal-asset-categories':'个人资产分类','personal-asset-records':'个人资产记录','question-bank':'题库','question-imports':'题库导入','paper-export-tasks':'试卷导出','miniapp-personal-assets':'小程序个人资产导入','miniapp-paper-export-tasks':'小程序试卷导出','miniapp-question-assets':'小程序题库资源'};
const ACTION_NAMES = { create:'新增',update:'修改',delete:'删除',command:'提交',task:'提交任务：' };
const SAFE_VALUES = new Set(['active','status','type','year','semester','difficulty','gradeYear','gradeCurrent','sourceType','serviceType','billingUnit','teacherFeeMode','defaultDurationMinutes','priceTuition','priceTeacher','tuition','teacherFee','amount','hours','attendanceStatus','startAt','endAt','expectedUpdatedAt','updatedAt','expectedVersion','version','taskType','commandId','courseId','studentId','teacherId','roomId','schoolId','institutionId','paymentId','consumptionId','gradeId','categoryId','recordId','scheduleId','questionId','id']);
for (const key of ['has_image','has_formula','edit_status','subject_id','chapter_id','question_type','grade_year','grade_current','source_type','attendance_status','teacher_fee','billing_unit','teacher_fee_mode']) SAFE_VALUES.add(key);
const NESTED = new Set(['data','payload','changes','request','record','pricings']);
function failure(code) { return Object.assign(new Error(code), { code }); }
function identifier(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) ? value : null; }
// Unknown/free-text values are never retained (including names, phones, credentials and question content).
function safeDetail(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return {};
  if (Array.isArray(value)) return { count: value.length, items: value.slice(0, 20).map(item => safeDetail(item, depth + 1)) };
  const result = {};
  for (const key of Object.keys(value).slice(0, 80)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(key)) continue;
    const item = value[key];
    if (SAFE_VALUES.has(key) && (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)))) result[key] = item;
    else if (SAFE_VALUES.has(key) && typeof item === 'string' && item.length <= 160 && /^[A-Za-z0-9._:+\-TZ ]+$/.test(item) && !/\d{11,}/.test(item)) result[key] = item;
    else if (NESTED.has(key) && item && typeof item === 'object') result[key] = safeDetail(item, depth + 1);
    else result[key] = '[redacted]';
  }
  return result;
}
function describeOperation(request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return null;
  const core = CORE.exec(request.path), limited = LIMITED.exec(request.path);
  if (!core && !limited) return null;
  const resourceType = core ? core[1] : limited[2];
  const action = request.method === 'DELETE' ? 'delete' : ['PUT','PATCH'].includes(request.method) ? 'update' : resourceType === 'question-bank' && request.path.endsWith('/commands') ? 'command' : core ? 'create' : 'task';
  const suppliedId = core ? core[2] : ['commands','assets','import','relay'].includes(limited[3]) ? null : limited[3];
  const body = request.body || {};
  const candidate = suppliedId || (core ? body[RESOURCE_KEYS[resourceType]] : action === 'command' ? body.payload?.id || body.payload?.record?.id : null);
  return { resourceType, resourceId: identifier(candidate), action, summary: `${ACTION_NAMES[action]}${RESOURCE_NAMES[resourceType]}`, detail: { request: safeDetail(body), changeCapture: 'submitted-fields-only' }, miniapp: Boolean(limited && limited[2].startsWith('miniapp-')) };
}
function parseFilters(input = {}) {
  if (Object.keys(input).some(key => !['limit','offset','q','action','status','from','to'].includes(key))) throw failure('CLOUD_OPERATION_AUDIT_INPUT_INVALID');
  const integer = (key, fallback, max) => {
    if (input[key] === undefined) return fallback;
    if (typeof input[key] !== 'string' || !/^(0|[1-9][0-9]*)$/.test(input[key])) throw failure('CLOUD_OPERATION_AUDIT_INPUT_INVALID');
    const n = Number(input[key]);
    if (!Number.isSafeInteger(n) || n > max || (key === 'limit' && n < 1)) throw failure('CLOUD_OPERATION_AUDIT_INPUT_INVALID');
    return n;
  };
  const optional = (key, max) => {
    if (input[key] === undefined || input[key] === '') return null;
    if (typeof input[key] !== 'string' || input[key].length > max) throw failure('CLOUD_OPERATION_AUDIT_INPUT_INVALID');
    return input[key].trim() || null;
  };
  const filters = { limit: integer('limit',20,100), offset: integer('offset',0,1000000), q: optional('q',160), action: optional('action',24), status: optional('status',24), from: optional('from',35), to: optional('to',35) };
  if ((filters.action && !ACTIONS.has(filters.action)) || (filters.status && !STATUS.has(filters.status))) throw failure('CLOUD_OPERATION_AUDIT_INPUT_INVALID');
  for (const key of ['from','to']) if (filters[key]) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(filters[key]) || !Number.isFinite(Date.parse(filters[key]))) throw failure('CLOUD_OPERATION_AUDIT_INPUT_INVALID');
    filters[key] = new Date(filters[key]).toISOString();
  }
  if (filters.from && filters.to && filters.from > filters.to) throw failure('CLOUD_OPERATION_AUDIT_INPUT_INVALID');
  return filters;
}
function createOperationAuditRepository({ query }) {
  return Object.freeze({
    async begin({ tenantId, actor, operation }) {
      const id = randomUUID();
      if (!identifier(actor?.accountId)) throw failure('CLOUD_BUSINESS_ACCESS_DENIED');
      // Names are display-only data supplied by the verified session, never by the request body.
      const name = typeof actor.displayName === 'string' ? actor.displayName.replace(/\d{7,}/g,'[redacted]').slice(0,120) : null;
      const detail = { ...operation.detail, actorRoles:(actor.roles || []).filter(role => ['super_admin','teacher','student','family_member','visitor'].includes(role)), surface:operation.miniapp ? 'miniapp' : 'desktop' };
      // Large legitimate batches still receive an intent without retaining an unbounded payload.
      if (Buffer.byteLength(JSON.stringify(detail),'utf8') > 30000) detail.request = { truncated:true };
      await query('SELECT business.vnext_begin_operation_audit($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)', [id,tenantId,actor.accountId,name,identifier(actor.deviceId),operation.action,operation.resourceType,operation.resourceId,operation.summary,JSON.stringify(detail)]);
      return id;
    },
    async complete({ id, status, httpStatus, code, result }) {
      await query('SELECT business.vnext_complete_operation_audit($1::uuid,$2,$3,$4,$5::jsonb)', [id,status,httpStatus,identifier(code),JSON.stringify(safeDetail(result))]);
    },
    async list({ tenantId, actor, filters }) {
      const scope = actor.roles?.includes('super_admin') ? 'tenant' : actor.roles?.includes('teacher') ? 'self' : null;
      if (!scope || !identifier(actor.accountId)) throw failure('CLOUD_BUSINESS_ACCESS_DENIED');
      const f = filters;
      const result = await query('SELECT business.vnext_list_operation_audits($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz) AS data', [tenantId,scope,actor.accountId,f.limit,f.offset,f.q,f.action,f.status,f.from,f.to]);
      return { ...result.rows[0].data, scope };
    },
  });
}
function createOperationAuditMiddleware({ repository, required, tenantId, desktopContext, miniappContext, businessContext }) {
  return async (request, response, next) => {
    const operation = describeOperation(request);
    if (!operation || (!repository && !required)) return next();
    if (!repository || !tenantId) return response.status(503).json({ ok:false,code:'CLOUD_OPERATION_AUDIT_UNAVAILABLE' });
    let id;
    try {
      const actor = await (operation.miniapp ? miniappContext(request) : operation.resourceType === 'paper-export-tasks' ? businessContext(request) : desktopContext(request));
      id = await repository.begin({ tenantId, actor, operation });
    } catch (error) {
      return response.status(error.code === 'CLOUD_BUSINESS_ACCESS_DENIED' ? 403 : 503).json({ ok:false,code:error.code === 'CLOUD_BUSINESS_ACCESS_DENIED' ? error.code : 'CLOUD_OPERATION_AUDIT_UNAVAILABLE' });
    }
    const send = response.json.bind(response);
    let sending = false;
    response.json = body => {
      if (sending) return response;
      sending = true;
      const httpStatus = response.statusCode;
      const code = body?.code || body?.receipt?.result?.error?.code;
      const status = httpStatus === 409 || /CONFLICT$/.test(code || '') ? 'conflict' : httpStatus >= 500 ? 'error' : httpStatus >= 400 || body?.receipt?.status === 'rejected' ? 'rejected' : body?.ok === false || body?.success === false ? 'error' : 'success';
      // The durable intent precedes every effect. Await completion before sending; if
      // completion fails, keep the original business outcome and the durable unknown.
      (async () => {
        let recorded = status;
        const record = body?.receipt?.result || Object.values(body || {}).find(value => value && typeof value === 'object' && (value.updatedAt || value.id || value.taskId || value.deliveryId)) || {};
        try { await repository.complete({ id,status,httpStatus,code,result: { id:identifier(record.id || record.taskId || record.deliveryId), updatedAt:record.updatedAt || null, version:record.version || null } }); }
        catch (_) { recorded = 'unknown'; }
        send({ ...body, audit: { id,status:recorded } });
      })().catch(() => { if (!response.headersSent) response.destroy(); });
      return response;
    };
    return next();
  };
}
module.exports = { createOperationAuditRepository,createOperationAuditMiddleware,parseFilters,safeDetail,describeOperation };
