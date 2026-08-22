'use strict';

const express = require('express');

function createCloudBusinessApp({ query, businessScheduleUpdate = null, businessScheduleStudentOverride = null, desktopRegistration = null, desktopPasswordAuthentication = null, miniappCloudAccount = null, desktopPairing = null, storageAgent = null, questionAuthority = null, paperExportTasks = null, encryptedStorageRelay = null, storageAgentKeyFingerprint = null, storageAgentPublicKey = null, businessTenantId = null, releaseVersion = 'unknown' }) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  if (businessScheduleUpdate !== null && typeof businessScheduleUpdate !== 'function') throw new TypeError('businessScheduleUpdate is invalid');
  if (businessScheduleStudentOverride !== null && typeof businessScheduleStudentOverride !== 'function') throw new TypeError('businessScheduleStudentOverride is invalid');
  if (desktopRegistration && (typeof desktopRegistration.begin !== 'function' || typeof desktopRegistration.register !== 'function')) throw new TypeError('desktopRegistration is invalid');
  if (desktopPasswordAuthentication && (typeof desktopPasswordAuthentication.enroll !== 'function' || typeof desktopPasswordAuthentication.verify !== 'function')) throw new TypeError('desktopPasswordAuthentication is invalid');
  if (miniappCloudAccount && (typeof miniappCloudAccount.login !== 'function' || typeof miniappCloudAccount.context !== 'function' || typeof miniappCloudAccount.pendingAccounts !== 'function' || typeof miniappCloudAccount.assignRole !== 'function')) throw new TypeError('miniappCloudAccount is invalid');
  if (desktopPairing && (typeof desktopPairing.start !== 'function' || typeof desktopPairing.confirm !== 'function' || typeof desktopPairing.read !== 'function')) throw new TypeError('desktopPairing is invalid');
  if (storageAgent && (typeof storageAgent.lease !== 'function' || typeof storageAgent.download !== 'function' || typeof storageAgent.complete !== 'function')) throw new TypeError('storageAgent is invalid');
  if (questionAuthority && typeof questionAuthority.create !== 'function') throw new TypeError('questionAuthority is invalid');
  if (paperExportTasks && (typeof paperExportTasks.create !== 'function' || typeof paperExportTasks.read !== 'function' || typeof paperExportTasks.cancel !== 'function')) throw new TypeError('paperExportTasks is invalid');
  if (encryptedStorageRelay && typeof encryptedStorageRelay.create !== 'function') throw new TypeError('encryptedStorageRelay is invalid');
  if (storageAgentKeyFingerprint !== null && (typeof storageAgentKeyFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(storageAgentKeyFingerprint))) throw new TypeError('storageAgentKeyFingerprint is invalid');
  if (storageAgentPublicKey !== null && (typeof storageAgentPublicKey !== 'string' || !/^[A-Za-z0-9_-]+$/.test(storageAgentPublicKey) || storageAgentPublicKey.length > 4096)) throw new TypeError('storageAgentPublicKey is invalid');
  if (businessTenantId !== null && (typeof businessTenantId !== 'string' || !businessTenantId.trim())) throw new TypeError('businessTenantId is invalid');
  const app = express();
  app.disable('x-powered-by');
  app.use('/api/desktop/question-bank/assets/relay', express.json({ limit: '90mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/health', async (_request, response) => {
    try {
      await query('SELECT 1 AS ok');
      response.json({
        ok: true,
        database: 'postgresql',
        businessAuthority: 'cloud',
        version: String(releaseVersion),
        time: new Date().toISOString(),
      });
    } catch (_) {
      response.status(503).json({ ok: false, database: 'unavailable' });
    }
  });
  function desktopUnavailable(response) {
    response.status(503).json({ ok: false, code: 'CLOUD_ONLINE_IDENTITY_UNAVAILABLE' });
  }
  function identityFailure(response, error) {
    if (error && error.code === 'CLOUD_ONLINE_IDENTITY_INVALID') {
      response.status(400).json({ ok: false, code: 'CLOUD_ONLINE_IDENTITY_INPUT_INVALID' });
      return;
    }
    if (error && error.code === 'CLOUD_ONLINE_IDENTITY_REJECTED') {
      response.status(403).json({ ok: false, code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
      return;
    }
    desktopUnavailable(response);
  }
  function pairingFailure(response) {
    response.status(403).json({ ok: false, code: 'CLOUD_DESKTOP_PAIRING_REJECTED' });
  }
  function businessUnavailable(response) {
    response.status(503).json({ ok: false, code: 'CLOUD_BUSINESS_UNAVAILABLE' });
  }
  function businessInputInvalid(response) {
    response.status(400).json({ ok: false, code: 'CLOUD_BUSINESS_INPUT_INVALID' });
  }
  function businessAccessDenied() {
    return Object.assign(new Error('cloud business access denied'), { code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
  }
  function storageAgentFailure(response, error) {
    if (error && error.code === 'STORAGE_AGENT_REJECTED') return response.status(403).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_REJECTED' });
    if (error && error.code === 'STORAGE_TASK_INPUT_INVALID') return response.status(400).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_INPUT_INVALID' });
    if (error && error.code === 'STORAGE_TASK_RECEIPT_MISMATCH') return response.status(409).json({ ok: false, code: 'CLOUD_STORAGE_TASK_RECEIPT_MISMATCH' });
    return response.status(503).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_UNAVAILABLE' });
  }
  function exactBody(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== keys.length
      || keys.some(key => !Object.hasOwn(value, key))) return null;
    return value;
  }
  function instant(value) {
    if (typeof value !== 'string' || value.length > 64) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : null;
  }
  function optionalText(value) {
    return value === null || (typeof value === 'string' && value === value.trim() && value.length <= 4096) ? value : undefined;
  }
  function nonNegativeNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100000000 ? value : null;
  }
  function sessionToken(request) {
    const authorization = String(request.get('authorization') || '');
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
    if (!match || match[1].length > 4096) {
      return null;
    }
    return match[1];
  }
  function storageAgentToken(request) {
    const token = String(request.get('x-gewu-storage-agent-token') || '');
    return token && token.length <= 512 ? token : null;
  }
  function encryptedCiphertext(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > (90 * 1024 * 1024)) return null;
    const bytes = Buffer.from(value, 'base64url');
    if (!bytes.length || bytes.length > (64 * 1024 * 1024) || bytes.toString('base64url') !== value) return null;
    return bytes;
  }
  async function businessContext(request) {
    const token = sessionToken(request);
    if (!token) throw businessAccessDenied();
    if (miniappCloudAccount) {
      try {
        return await miniappCloudAccount.context({ token });
      } catch (_) {
        // A desktop ticket is intentionally not a miniapp ticket; try its own verifier next.
      }
    }
    if (desktopRegistration && typeof desktopRegistration.sessionContext === 'function') {
      try {
        return await desktopRegistration.sessionContext({ sessionToken: token });
      } catch (_) {
        // Do not expose ticket-verification internals to callers.
      }
    }
    throw businessAccessDenied();
  }
  async function desktopQuestionContext(request) {
    const token = sessionToken(request);
    if (!token || !desktopRegistration || typeof desktopRegistration.sessionContext !== 'function') throw businessAccessDenied();
    try {
      return await desktopRegistration.sessionContext({ sessionToken: token });
    } catch (_) {
      throw businessAccessDenied();
    }
  }
  function scheduleScope(context) {
    if (!context || !Array.isArray(context.roles)) throw businessAccessDenied();
    if (context.roles.includes('super_admin')) return { role: 'super_admin', profileId: null };
    const profile = context.profile && typeof context.profile === 'object' ? context.profile : null;
    if (context.roles.includes('teacher')) {
      const profileId = profile?.type === 'teacher' ? profile.id : context.teacherId;
      if (typeof profileId === 'string' && profileId === profileId.trim() && profileId) return { role: 'teacher', profileId };
    }
    if (context.roles.includes('student')) {
      const profileId = profile?.type === 'student' ? profile.id : context.studentId;
      if (typeof profileId === 'string' && profileId === profileId.trim() && profileId) return { role: 'student', profileId };
    }
    throw businessAccessDenied();
  }
  const desktopProjectionSql = [
    'SELECT jsonb_build_object(',
    "'students',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'phone',s.phone_legacy,'school',s.school_legacy,'grade_year',s.grade_year,'grade_current',s.grade_current,'institution_id',s.institution_id,'parent_name',s.parent_name_legacy,'parent_wechat',s.parent_wechat_legacy,'balance_hours',s.legacy_balance_hours,'balance_money',s.legacy_balance_money,'notes',s.notes,'deleted',s.legacy_deleted,'created_at',s.created_at,'updated_at',s.updated_at) ORDER BY s.id) FROM business.students s WHERE s.tenant_id=$1),'[]'::jsonb),",
    "'teachers',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'phone',t.phone_legacy,'subject',t.subject,'hourly_rate',t.hourly_rate,'notes',t.notes,'deleted',t.legacy_deleted,'created_at',t.created_at,'updated_at',t.updated_at) ORDER BY t.id) FROM business.teachers t WHERE t.tenant_id=$1),'[]'::jsonb),",
    "'courses',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'year',c.year,'semester',c.semester,'display_name',c.display_name,'type',c.course_type,'source_type',c.legacy_source_type,'institution_id',c.institution_id,'price_tuition',c.price_tuition,'price_teacher',c.price_teacher,'billing_unit',c.billing_unit,'teacher_fee_mode',c.teacher_fee_mode,'room_id',c.legacy_room_id,'room_name',c.room_name_snapshot,'teacher_id',c.teacher_id,'teacher_name',c.teacher_name_snapshot,'active',c.legacy_active,'default_duration_minutes',c.default_duration_minutes,'notes',c.notes,'deleted',c.legacy_deleted,'created_at',c.created_at,'updated_at',c.updated_at,'student_pricings',COALESCE((SELECT jsonb_agg(jsonb_build_object('student_id',p.student_id,'tuition',p.tuition,'teacher_fee',p.teacher_fee) ORDER BY p.student_id) FROM business.course_student_pricings p WHERE p.tenant_id=c.tenant_id AND p.course_id=c.id),'[]'::jsonb)) ORDER BY c.id) FROM business.courses c WHERE c.tenant_id=$1),'[]'::jsonb),",
    "'schedules',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'course_id',s.course_id,'start_time',s.start_at,'end_time',s.end_at,'recurring_rule',s.recurring_rule_json,'status',s.status,'room',s.room_display_snapshot,'service_type',s.service_type,'calculated_tuition',s.calculated_tuition,'calculated_teacher_fee',s.calculated_teacher_fee,'notes',s.notes,'deleted',s.legacy_deleted,'created_at',s.created_at,'updated_at',s.updated_at,'student_ids',COALESCE((SELECT jsonb_agg(o.student_id ORDER BY o.student_id) FROM business.schedule_student_overrides o WHERE o.tenant_id=s.tenant_id AND o.schedule_id=s.id),(SELECT jsonb_agg(p.student_id ORDER BY p.student_id) FROM business.course_student_pricings p WHERE p.tenant_id=s.tenant_id AND p.course_id=s.course_id),'[]'::jsonb),'student_pricings',COALESCE((SELECT jsonb_agg(jsonb_build_object('student_id',o.student_id,'tuition',o.tuition,'teacher_fee',o.teacher_fee,'attendance_status',o.attendance_status) ORDER BY o.student_id) FROM business.schedule_student_overrides o WHERE o.tenant_id=s.tenant_id AND o.schedule_id=s.id),(SELECT jsonb_agg(jsonb_build_object('student_id',p.student_id,'tuition',p.tuition,'teacher_fee',p.teacher_fee) ORDER BY p.student_id) FROM business.course_student_pricings p WHERE p.tenant_id=s.tenant_id AND p.course_id=s.course_id),'[]'::jsonb)) ORDER BY s.start_at,s.id) FROM business.schedules s WHERE s.tenant_id=$1),'[]'::jsonb),",
    "'institutions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'tenant_id',i.tenant_id,'name',i.name,'contact_person',i.contact_person_legacy,'contact_phone',i.contact_phone_legacy,'revenue_share',i.revenue_share,'notes',i.notes,'deleted',i.legacy_deleted,'created_at',i.created_at,'updated_at',i.updated_at) ORDER BY i.id) FROM business.institutions i WHERE i.tenant_id=$1),'[]'::jsonb),",
    "'schools',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'tenant_id',s.tenant_id,'name',s.name,'count',s.legacy_count,'deleted',s.legacy_deleted,'created_at',s.created_at,'updated_at',s.updated_at) ORDER BY s.id) FROM business.schools s WHERE s.tenant_id=$1),'[]'::jsonb),",
    "'rooms',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'tenant_id',r.tenant_id,'name',r.name,'address',r.address_legacy,'count',r.legacy_count,'deleted',r.legacy_deleted,'created_at',r.created_at,'updated_at',r.updated_at) ORDER BY r.id) FROM business.rooms r WHERE r.tenant_id=$1),'[]'::jsonb)",
    ') AS projection',
  ].join(' ');
  function isDesktopProjection(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      && ['students', 'teachers', 'courses', 'schedules', 'institutions', 'schools', 'rooms'].every(key => Array.isArray(value[key]));
  }
  app.post('/api/desktop/online-verification', async (request, response) => {
    if (!desktopRegistration) return desktopUnavailable(response);
    try {
      const result = await desktopRegistration.begin(request.body);
      response.json({ ok: true, verificationToken: result.verificationToken });
    } catch (error) {
      identityFailure(response, error);
    }
  });
  app.post('/api/desktop/password-enrollment', async (request, response) => {
    if (!desktopPasswordAuthentication) return desktopUnavailable(response);
    try {
      const result = await desktopPasswordAuthentication.enroll(request.body);
      response.json({ ok: true, verificationToken: result.verificationToken, deviceChallenge: result.deviceChallenge });
    } catch (error) {
      identityFailure(response, error);
    }
  });
  app.post('/api/desktop/password-verification', async (request, response) => {
    if (!desktopPasswordAuthentication) return desktopUnavailable(response);
    try {
      const result = await desktopPasswordAuthentication.verify(request.body);
      response.json({ ok: true, verificationToken: result.verificationToken, deviceChallenge: result.deviceChallenge });
    } catch (error) {
      identityFailure(response, error);
    }
  });
  app.post('/api/desktop/online-registration', async (request, response) => {
    if (!desktopRegistration) return desktopUnavailable(response);
    try {
      const result = await desktopRegistration.register(request.body);
      response.json({ ok: true, receiptId: result.receiptId, sessionId: result.sessionId, replayed: result.replayed, sessionToken: result.sessionToken, offlineLease: result.offlineLease });
    } catch (error) {
      identityFailure(response, error);
    }
  });
  app.post('/api/desktop/question-bank/questions', async (request, response) => {
    if (!questionAuthority || businessTenantId === null) return businessUnavailable(response);
    const question = exactBody(request.body, ['id', 'subject', 'questionType', 'difficulty', 'stem', 'answer', 'explanation', 'options', 'richContent', 'taxonomy', 'hasFormula']);
    if (!question) return businessInputInvalid(response);
    try {
      const actor = await desktopQuestionContext(request);
      const created = await questionAuthority.create({ tenantId: businessTenantId, actor, question });
      response.json({ ok: true, question: created });
    } catch (error) {
      if (error && (error.code === 'CLOUD_BUSINESS_ACCESS_DENIED' || error.code === 'CLOUD_QUESTION_ACCESS_DENIED')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      if (error && error.code === 'CLOUD_QUESTION_INPUT_INVALID') return businessInputInvalid(response);
      businessUnavailable(response);
    }
  });
  app.post('/api/desktop/question-bank/commands', async (request, response) => {
    if (!questionAuthority || typeof questionAuthority.submitDesktopDraft !== 'function' || businessTenantId === null) return businessUnavailable(response);
    const command = exactBody(request.body, ['commandId', 'payloadHash', 'type', 'payload']);
    if (!command) return businessInputInvalid(response);
    try {
      const actor = await desktopQuestionContext(request);
      const receipt = await questionAuthority.submitDesktopDraft({ tenantId: businessTenantId, actor, command });
      response.json({ ok: true, receipt });
    } catch (error) {
      if (error && (error.code === 'CLOUD_BUSINESS_ACCESS_DENIED' || error.code === 'CLOUD_QUESTION_ACCESS_DENIED')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      if (error && (error.code === 'CLOUD_QUESTION_INPUT_INVALID' || error.code === 'CLOUD_QUESTION_COMMAND_UNSUPPORTED')) return businessInputInvalid(response);
      businessUnavailable(response);
    }
  });
  app.post('/api/desktop/paper-export-tasks', async (request, response) => {
    if (!paperExportTasks || businessTenantId === null) return businessUnavailable(response);
    const body = exactBody(request.body, ['taskType', 'request']);
    const idempotencyKey = String(request.get('x-idempotency-key') || '');
    if (!body || !idempotencyKey || idempotencyKey.length > 256) return businessInputInvalid(response);
    try {
      const currentActor = await businessContext(request);
      const task = await paperExportTasks.create({
        tenantId: businessTenantId, actor: currentActor, idempotencyKey, taskType: body.taskType, request: body.request,
      });
      response.status(task.replayed ? 200 : 202).json({ ok: true, task });
    } catch (error) {
      if (error && error.code === 'CLOUD_PAPER_EXPORT_ACCESS_DENIED') return response.status(403).json({ ok: false, code: error.code });
      if (error && ['CLOUD_PAPER_EXPORT_INPUT_INVALID', 'CLOUD_PAPER_EXPORT_SELECTION_INVALID', 'CLOUD_PAPER_EXPORT_CONFLICT'].includes(error.code)) {
        return response.status(400).json({ ok: false, code: error.code });
      }
      businessUnavailable(response);
    }
  });
  app.get('/api/desktop/paper-export-tasks/:taskId', async (request, response) => {
    if (!paperExportTasks || businessTenantId === null) return businessUnavailable(response);
    try {
      const task = await paperExportTasks.read({ tenantId: businessTenantId, actor: await businessContext(request), taskId: request.params.taskId });
      response.json({ ok: true, task });
    } catch (error) {
      if (error && error.code === 'CLOUD_PAPER_EXPORT_ACCESS_DENIED') return response.status(403).json({ ok: false, code: error.code });
      if (error && error.code === 'CLOUD_PAPER_EXPORT_NOT_FOUND') return response.status(404).json({ ok: false, code: error.code });
      businessUnavailable(response);
    }
  });
  app.post('/api/desktop/paper-export-tasks/:taskId/cancel', async (request, response) => {
    if (!paperExportTasks || businessTenantId === null || !exactBody(request.body, [])) return businessUnavailable(response);
    try {
      const task = await paperExportTasks.cancel({ tenantId: businessTenantId, actor: await businessContext(request), taskId: request.params.taskId });
      response.json({ ok: true, task });
    } catch (error) {
      if (error && error.code === 'CLOUD_PAPER_EXPORT_ACCESS_DENIED') return response.status(403).json({ ok: false, code: error.code });
      if (error && error.code === 'CLOUD_PAPER_EXPORT_NOT_CANCELLABLE') return response.status(409).json({ ok: false, code: error.code });
      businessUnavailable(response);
    }
  });
  app.get('/api/desktop/question-bank/assets/relay-key', async (request, response) => {
    if (!encryptedStorageRelay || !storageAgentKeyFingerprint || !storageAgentPublicKey || businessTenantId === null) return businessUnavailable(response);
    try {
      const actor = await desktopQuestionContext(request);
      if (!Array.isArray(actor.roles) || !actor.roles.some(role => ['super_admin', 'admin', 'teacher'].includes(role))) throw businessAccessDenied();
      response.json({ ok: true, agentPublicKey: storageAgentPublicKey, agentKeyFingerprint: storageAgentKeyFingerprint });
    } catch (error) {
      if (error && (error.code === 'CLOUD_BUSINESS_ACCESS_DENIED' || error.code === 'CLOUD_QUESTION_ACCESS_DENIED')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      businessUnavailable(response);
    }
  });
  app.post('/api/desktop/question-bank/assets/relay', async (request, response) => {
    if (!encryptedStorageRelay || !storageAgentKeyFingerprint || businessTenantId === null) return businessUnavailable(response);
    const body = exactBody(request.body, [
      'questionId', 'assetId', 'taskId', 'objectId', 'objectVersion', 'assetType', 'fileName', 'mimeType',
      'agentKeyFingerprint', 'envelope', 'ciphertextBase64', 'expiresAt',
    ]);
    const ciphertext = body ? encryptedCiphertext(body.ciphertextBase64) : null;
    if (!body || !ciphertext || body.agentKeyFingerprint !== storageAgentKeyFingerprint) return businessInputInvalid(response);
    try {
      const actor = await desktopQuestionContext(request);
      if (!Array.isArray(actor.roles) || !actor.roles.some(role => ['super_admin', 'admin', 'teacher'].includes(role))) throw businessAccessDenied();
      const relay = await encryptedStorageRelay.create({
        tenantId: businessTenantId, actorAccountId: actor.accountId, questionId: body.questionId,
        assetId: body.assetId, taskId: body.taskId, objectId: body.objectId, objectVersion: body.objectVersion,
        assetType: body.assetType, fileName: body.fileName, mimeType: body.mimeType,
        agentKeyFingerprint: body.agentKeyFingerprint, envelope: body.envelope, ciphertext, expiresAt: body.expiresAt,
      });
      response.json({ ok: true, relay });
    } catch (error) {
      if (error && (error.code === 'CLOUD_BUSINESS_ACCESS_DENIED' || error.code === 'CLOUD_QUESTION_ACCESS_DENIED')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      if (error && (error.code === 'ENCRYPTED_RELAY_INPUT_INVALID' || error.code === 'CLOUD_QUESTION_INPUT_INVALID')) return businessInputInvalid(response);
      businessUnavailable(response);
    }
  });
  app.get('/api/desktop/session-context', async (request, response) => {
    if (!desktopRegistration || typeof desktopRegistration.sessionContext !== 'function') return desktopUnavailable(response);
    const token = sessionToken(request);
    if (!token) return response.status(403).json({ ok: false, code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
    try {
      const context = await desktopRegistration.sessionContext({ sessionToken: token });
      response.json({ ok: true, ...context });
    } catch (error) {
      identityFailure(response, error);
    }
  });
  app.post('/api/miniapp/cloud-login', async (request, response) => {
    if (!miniappCloudAccount) return desktopUnavailable(response);
    try {
      const result = await miniappCloudAccount.login(request.body);
      response.json({ ok: true, token: result.token, identity: result.identity });
    } catch (error) {
      if (error && error.code === 'CLOUD_MINIAPP_IDENTITY_INVALID') return businessInputInvalid(response);
      response.status(403).json({ ok: false, code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
    }
  });
  app.get('/api/miniapp/cloud-accounts', async (request, response) => {
    if (!miniappCloudAccount) return businessUnavailable(response);
    const token = sessionToken(request);
    if (!token) return response.status(403).json({ ok: false, code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
    try {
      const accounts = await miniappCloudAccount.pendingAccounts({ token });
      response.json({ ok: true, accounts });
    } catch (_) {
      response.status(403).json({ ok: false, code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
    }
  });
  app.get('/api/miniapp/business-profiles', async (request, response) => {
    if (!miniappCloudAccount || !businessTenantId) return businessUnavailable(response);
    const token = sessionToken(request);
    const type = String(request.query.type || '').trim();
    if (!token || !['teacher', 'student'].includes(type)) return businessInputInvalid(response);
    try {
      const context = await miniappCloudAccount.context({ token });
      if (!context || !Array.isArray(context.roles) || !context.roles.includes('super_admin')) throw businessAccessDenied();
      const relation = type === 'teacher' ? 'business.teachers' : 'business.students';
      const result = await query(
        `SELECT id AS "id", name AS "name" FROM ${relation} WHERE tenant_id=$1 AND legacy_deleted=false ORDER BY name ASC,id ASC`,
        [businessTenantId],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.some(row => !row || typeof row.id !== 'string' || !row.id || typeof row.name !== 'string' || !row.name)) return businessUnavailable(response);
      response.json({ ok: true, profiles: result.rows.map(row => ({ id: row.id, name: row.name })) });
    } catch (error) {
      if (error && error.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      businessUnavailable(response);
    }
  });
  app.put('/api/miniapp/cloud-accounts/:accountId/role', async (request, response) => {
    if (!miniappCloudAccount) return businessUnavailable(response);
    const token = sessionToken(request);
    const accountId = String(request.params.accountId || '').trim();
    const body = exactBody(request.body, ['role', 'profileId', 'studentRelationship']);
    if (!token || !accountId || accountId.length > 512 || !body || typeof body.role !== 'string' || typeof body.profileId !== 'string' || (body.studentRelationship !== null && typeof body.studentRelationship !== 'string')) return response.status(400).json({ ok: false, code: 'CLOUD_MINIAPP_IDENTITY_INVALID' });
    try {
      const account = await miniappCloudAccount.assignRole({ token, accountId, role: body.role, profileId: body.profileId, studentRelationship: body.studentRelationship });
      response.json({ ok: true, account });
    } catch (_) {
      response.status(403).json({ ok: false, code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
    }
  });
 app.get('/api/business/schedules', async (request, response) => {
   if ((!desktopRegistration && !miniappCloudAccount) || !businessTenantId) return businessUnavailable(response);
    try {
      const context = await businessContext(request);
      const scope = scheduleScope(context);
      const result = await query(
        `SELECT s.id AS "id", s.course_id AS "courseId", c.display_name AS "courseName", s.start_at AS "startAt", s.end_at AS "endAt", s.updated_at AS "updatedAt", s.status AS "status", s.room_display_snapshot AS "roomDisplay",
           CASE WHEN $2='super_admin' THEN s.calculated_tuition WHEN $2='student' THEN COALESCE((SELECT o.tuition FROM business.schedule_student_overrides o WHERE o.tenant_id=s.tenant_id AND o.schedule_id=s.id AND o.student_id=$3), (SELECT p.tuition FROM business.course_student_pricings p WHERE p.tenant_id=s.tenant_id AND p.course_id=s.course_id AND p.student_id=$3)) ELSE NULL END AS "tuition",
           CASE WHEN $2 IN ('super_admin','teacher') THEN s.calculated_teacher_fee ELSE NULL END AS "teacherFee"
         FROM business.schedules s
         JOIN business.courses c ON c.tenant_id=s.tenant_id AND c.id=s.course_id
         WHERE s.tenant_id=$1
           AND ($2='super_admin'
             OR ($2='teacher' AND c.teacher_id=$3)
             OR ($2='student' AND (
               EXISTS (SELECT 1 FROM business.schedule_student_overrides o WHERE o.tenant_id=s.tenant_id AND o.schedule_id=s.id AND o.student_id=$3)
               OR (NOT EXISTS (SELECT 1 FROM business.schedule_student_overrides o WHERE o.tenant_id=s.tenant_id AND o.schedule_id=s.id)
                   AND EXISTS (SELECT 1 FROM business.course_student_pricings p WHERE p.tenant_id=s.tenant_id AND p.course_id=s.course_id AND p.student_id=$3))
             )))
         ORDER BY s.start_at ASC, s.id ASC`,
        [businessTenantId, scope.role, scope.profileId],
      );
      response.json({ ok: true, schedules: result.rows });
    } catch (error) {
      if (error && error.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
     businessUnavailable(response);
   }
 });
  app.get('/api/business/desktop-projection', async (request, response) => {
    if (!desktopRegistration || !businessTenantId) return businessUnavailable(response);
    try {
      const context = await desktopQuestionContext(request);
      if (!Array.isArray(context.roles) || !context.roles.includes('super_admin')) throw businessAccessDenied();
      const result = await query(desktopProjectionSql, [businessTenantId]);
      const projection = result?.rows?.[0]?.projection;
      if (!isDesktopProjection(projection)) return businessUnavailable(response);
      response.json({ ok: true, projection });
    } catch (error) {
      if (error && error.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      businessUnavailable(response);
    }
  });
 app.put('/api/business/schedules/:scheduleId', async (request, response) => {
    if ((!desktopRegistration && !miniappCloudAccount) || !businessTenantId || !businessScheduleUpdate) return businessUnavailable(response);
    const scheduleId = String(request.params.scheduleId || '').trim();
    const update = exactBody(request.body, ['expectedUpdatedAt', 'startAt', 'endAt', 'status', 'roomDisplay', 'tuition', 'teacherFee', 'notes']);
    if (!scheduleId || !update) return businessInputInvalid(response);
    const expectedUpdatedAt = instant(update.expectedUpdatedAt);
    const startAt = instant(update.startAt);
    const endAt = instant(update.endAt);
    const roomDisplay = optionalText(update.roomDisplay);
    const notes = optionalText(update.notes);
    const tuition = nonNegativeNumber(update.tuition);
    const teacherFee = nonNegativeNumber(update.teacherFee);
    if (!expectedUpdatedAt || !startAt || !endAt || new Date(endAt).getTime() <= new Date(startAt).getTime()
      || !Number.isInteger(update.status) || ![1, 2, 3, 4].includes(update.status)
      || roomDisplay === undefined || notes === undefined || tuition === null || teacherFee === null) return businessInputInvalid(response);
    try {
      const context = await businessContext(request);
      if (!context || !Array.isArray(context.roles) || !context.roles.includes('super_admin')) {
        return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      }
      const result = await businessScheduleUpdate({
        tenantId: businessTenantId,
        scheduleId,
        expectedUpdatedAt,
        startAt,
        endAt,
        status: update.status,
        roomDisplay,
        tuition,
        teacherFee,
        notes,
      });
      if (!result || typeof result !== 'object' || !result.id || !result.updatedAt) {
        return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_SCHEDULE_CONFLICT' });
      }
      response.json({ ok: true, schedule: result });
    } catch (error) {
      if (error && error.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      businessUnavailable(response);
    }
  });
  app.put('/api/business/schedules/:scheduleId/students/:studentId', async (request, response) => {
    if ((!desktopRegistration && !miniappCloudAccount) || !businessTenantId || !businessScheduleStudentOverride) return businessUnavailable(response);
    const scheduleId = String(request.params.scheduleId || '').trim();
    const studentId = String(request.params.studentId || '').trim();
    const update = exactBody(request.body, ['expectedUpdatedAt', 'attendanceStatus', 'tuition', 'teacherFee']);
    if (!scheduleId || !studentId || !update) return businessInputInvalid(response);
    const expectedUpdatedAt = instant(update.expectedUpdatedAt);
    const tuition = nonNegativeNumber(update.tuition);
    const teacherFee = nonNegativeNumber(update.teacherFee);
    if (!expectedUpdatedAt || !Number.isInteger(update.attendanceStatus) || ![1, 3, 4].includes(update.attendanceStatus)
      || tuition === null || teacherFee === null) return businessInputInvalid(response);
    try {
      const context = await businessContext(request);
      if (!context || !Array.isArray(context.roles) || !context.roles.includes('super_admin')) {
        return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      }
      const result = await businessScheduleStudentOverride({
        tenantId: businessTenantId,
        scheduleId,
        studentId,
        expectedUpdatedAt,
        attendanceStatus: update.attendanceStatus,
        tuition,
        teacherFee,
      });
      if (!result || typeof result !== 'object' || !result.id || !result.updatedAt) {
        return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_SCHEDULE_CONFLICT' });
      }
      response.json({ ok: true, schedule: result });
    } catch (error) {
      if (error && error.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      businessUnavailable(response);
    }
  });
  app.post('/api/storage-agent/lease', async (request, response) => {
    if (!storageAgent) return response.status(503).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_UNAVAILABLE' });
    const body = exactBody(request.body, ['agentId']);
    const token = storageAgentToken(request);
    if (!body || !token) return response.status(400).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_INPUT_INVALID' });
    try {
      const task = await storageAgent.lease({ agentId: body.agentId, token });
      response.json({ ok: true, task });
    } catch (error) {
      storageAgentFailure(response, error);
    }
  });
  app.post('/api/storage-agent/tasks/:taskId/download', async (request, response) => {
    if (!storageAgent) return response.status(503).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_UNAVAILABLE' });
    const body = exactBody(request.body, ['agentId', 'leaseToken']);
    const token = storageAgentToken(request);
    if (!body || !token) return response.status(400).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_INPUT_INVALID' });
    try {
      const relay = await storageAgent.download({ ...body, token, taskId: String(request.params.taskId || '') });
      if (!relay || typeof relay !== 'object' || !relay.envelope || !Buffer.isBuffer(relay.ciphertext)
        || relay.ciphertext.length < 1 || relay.ciphertext.length > (64 * 1024 * 1024)) {
        return response.status(503).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_UNAVAILABLE' });
      }
      response.json({ ok: true, relay: { envelope: relay.envelope, ciphertextBase64: relay.ciphertext.toString('base64url') } });
    } catch (error) {
      storageAgentFailure(response, error);
    }
  });
  app.post('/api/storage-agent/tasks/:taskId/complete', async (request, response) => {
    if (!storageAgent) return response.status(503).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_UNAVAILABLE' });
    const body = exactBody(request.body, ['agentId', 'leaseToken', 'observedSha256', 'observedBytes']);
    const token = storageAgentToken(request);
    if (!body || !token) return response.status(400).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_INPUT_INVALID' });
    try {
      const receipt = await storageAgent.complete({ ...body, token, taskId: String(request.params.taskId || '') });
      response.json({ ok: true, receipt });
    } catch (error) {
      storageAgentFailure(response, error);
    }
  });
  app.post('/api/desktop/pairing/start', (request, response) => {
    if (!desktopPairing) return desktopUnavailable(response);
    try {
      const result = desktopPairing.start(request.body);
      response.json({ ok: true, pairingId: result.pairingId, pairingSecret: result.pairingSecret, expiresAt: result.expiresAt });
    } catch (_) {
      pairingFailure(response);
    }
  });
  app.post('/api/desktop/pairing/confirm', async (request, response) => {
    if (!desktopPairing) return desktopUnavailable(response);
    try {
      const result = await desktopPairing.confirm(request.body);
      response.json({ ok: true, status: result.status });
    } catch (_) {
      pairingFailure(response);
    }
  });
  app.get('/api/desktop/pairing/:pairingId', (request, response) => {
    if (!desktopPairing) return desktopUnavailable(response);
    try {
      const result = desktopPairing.read({ pairingId: request.params.pairingId, pairingSecret: request.query.secret });
      response.json({ ok: true, ...result });
    } catch (_) {
      pairingFailure(response);
    }
  });
  return app;
}

module.exports = Object.freeze({ createCloudBusinessApp });
