'use strict';

const express = require('express');

function createCloudBusinessApp({ query, businessScheduleUpdate = null, businessScheduleStudentOverride = null, businessScheduleLifecycleMutations = null, businessFoundationLifecycleMutations = null, businessSupplementalLifecycleMutations = null, businessStudentUpdate = null, businessStudentRecordUpdate = null, businessStudentLifecycleMutations = null, businessTeacherLifecycleMutations = null, businessRoomLifecycleMutations = null, businessCourseLifecycleMutations = null, desktopRegistration = null, desktopTeacherSelfRegistration = null, desktopPasswordAuthentication = null, miniappCloudAccount = null, miniappRoleApplications = null, desktopPairing = null, storageAgent = null, questionAuthority = null, paperExportTasks = null, questionImportTasks = null, encryptedStorageRelay = null, storageAgentKeyFingerprint = null, storageAgentPublicKey = null, businessTenantId = null, releaseVersion = 'unknown', miniappArtifactDeliveries = null, questionAssetDeliveries = null, personalAssetImports = null }) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  if (businessScheduleUpdate !== null && typeof businessScheduleUpdate !== 'function') throw new TypeError('businessScheduleUpdate is invalid');
  if (businessScheduleStudentOverride !== null && typeof businessScheduleStudentOverride !== 'function') throw new TypeError('businessScheduleStudentOverride is invalid');
  if (businessScheduleLifecycleMutations !== null && (typeof businessScheduleLifecycleMutations.create !== 'function' || typeof businessScheduleLifecycleMutations.remove !== 'function')) throw new TypeError('businessScheduleLifecycleMutations is invalid');
  if (businessFoundationLifecycleMutations !== null && (typeof businessFoundationLifecycleMutations.institutions?.create !== 'function' || typeof businessFoundationLifecycleMutations.institutions?.update !== 'function' || typeof businessFoundationLifecycleMutations.institutions?.remove !== 'function' || typeof businessFoundationLifecycleMutations.schools?.create !== 'function' || typeof businessFoundationLifecycleMutations.schools?.update !== 'function' || typeof businessFoundationLifecycleMutations.schools?.remove !== 'function')) throw new TypeError('businessFoundationLifecycleMutations is invalid');
  if (businessSupplementalLifecycleMutations !== null && (typeof businessSupplementalLifecycleMutations.payments?.create !== 'function' || typeof businessSupplementalLifecycleMutations.payments?.update !== 'function' || typeof businessSupplementalLifecycleMutations.payments?.remove !== 'function' || typeof businessSupplementalLifecycleMutations.consumptions?.create !== 'function' || typeof businessSupplementalLifecycleMutations.consumptions?.update !== 'function' || typeof businessSupplementalLifecycleMutations.consumptions?.remove !== 'function' || typeof businessSupplementalLifecycleMutations.grades?.create !== 'function' || typeof businessSupplementalLifecycleMutations.grades?.remove !== 'function' || typeof businessSupplementalLifecycleMutations.assetCategories?.create !== 'function' || typeof businessSupplementalLifecycleMutations.assetCategories?.remove !== 'function' || typeof businessSupplementalLifecycleMutations.assetRecords?.create !== 'function' || typeof businessSupplementalLifecycleMutations.assetRecords?.update !== 'function' || typeof businessSupplementalLifecycleMutations.assetRecords?.remove !== 'function')) throw new TypeError('businessSupplementalLifecycleMutations is invalid');
  if (businessStudentUpdate !== null && typeof businessStudentUpdate !== 'function') throw new TypeError('businessStudentUpdate is invalid');
  if (businessStudentRecordUpdate !== null && typeof businessStudentRecordUpdate !== 'function') throw new TypeError('businessStudentRecordUpdate is invalid');
  if (businessStudentLifecycleMutations !== null && (typeof businessStudentLifecycleMutations.create !== 'function' || typeof businessStudentLifecycleMutations.remove !== 'function')) throw new TypeError('businessStudentLifecycleMutations is invalid');
  if (businessTeacherLifecycleMutations !== null && (typeof businessTeacherLifecycleMutations.create !== 'function' || typeof businessTeacherLifecycleMutations.update !== 'function' || typeof businessTeacherLifecycleMutations.remove !== 'function')) throw new TypeError('businessTeacherLifecycleMutations is invalid');
  if (businessRoomLifecycleMutations !== null && (typeof businessRoomLifecycleMutations.create !== 'function' || typeof businessRoomLifecycleMutations.update !== 'function' || typeof businessRoomLifecycleMutations.remove !== 'function')) throw new TypeError('businessRoomLifecycleMutations is invalid');
  if (businessCourseLifecycleMutations !== null && (typeof businessCourseLifecycleMutations.create !== 'function' || typeof businessCourseLifecycleMutations.update !== 'function' || typeof businessCourseLifecycleMutations.remove !== 'function')) throw new TypeError('businessCourseLifecycleMutations is invalid');
  if (desktopRegistration && (typeof desktopRegistration.begin !== 'function' || typeof desktopRegistration.register !== 'function')) throw new TypeError('desktopRegistration is invalid');
  if (desktopTeacherSelfRegistration && typeof desktopTeacherSelfRegistration.register !== 'function') throw new TypeError('desktopTeacherSelfRegistration is invalid');
  if (desktopPasswordAuthentication && (typeof desktopPasswordAuthentication.enroll !== 'function' || typeof desktopPasswordAuthentication.enrollFromVerificationTicket !== 'function' || typeof desktopPasswordAuthentication.verify !== 'function')) throw new TypeError('desktopPasswordAuthentication is invalid');
  if (miniappCloudAccount && (typeof miniappCloudAccount.login !== 'function' || typeof miniappCloudAccount.context !== 'function')) throw new TypeError('miniappCloudAccount is invalid');
  if (miniappRoleApplications && (typeof miniappRoleApplications.mine !== 'function' || typeof miniappRoleApplications.submit !== 'function'
    || typeof miniappRoleApplications.listSubmittedForDesktop !== 'function' || typeof miniappRoleApplications.reviewForDesktop !== 'function')) throw new TypeError('miniappRoleApplications is invalid');
  if (desktopPairing && (typeof desktopPairing.start !== 'function' || typeof desktopPairing.confirm !== 'function' || typeof desktopPairing.read !== 'function')) throw new TypeError('desktopPairing is invalid');
  if (storageAgent && (typeof storageAgent.lease !== 'function' || typeof storageAgent.download !== 'function' || typeof storageAgent.complete !== 'function')) throw new TypeError('storageAgent is invalid');
  if (questionAuthority && (typeof questionAuthority.list !== 'function' || typeof questionAuthority.create !== 'function')) throw new TypeError('questionAuthority is invalid');
  if (paperExportTasks && (typeof paperExportTasks.create !== 'function' || typeof paperExportTasks.read !== 'function' || typeof paperExportTasks.cancel !== 'function')) throw new TypeError('paperExportTasks is invalid');
  if (miniappArtifactDeliveries && (typeof miniappArtifactDeliveries.request !== 'function' || typeof miniappArtifactDeliveries.status !== 'function' || typeof miniappArtifactDeliveries.download !== 'function')) throw new TypeError('miniappArtifactDeliveries is invalid');
  if (questionAssetDeliveries && (typeof questionAssetDeliveries.request !== 'function' || typeof questionAssetDeliveries.status !== 'function' || typeof questionAssetDeliveries.download !== 'function')) throw new TypeError('questionAssetDeliveries is invalid');
  if (personalAssetImports && typeof personalAssetImports.import !== 'function') throw new TypeError('personalAssetImports is invalid');
  if (questionImportTasks && (typeof questionImportTasks.create !== 'function' || typeof questionImportTasks.read !== 'function' || typeof questionImportTasks.prepareDrafts !== 'function' || typeof questionImportTasks.completeSourceAndStoreCandidates !== 'function')) throw new TypeError('questionImportTasks is invalid');
  if (encryptedStorageRelay && typeof encryptedStorageRelay.create !== 'function') throw new TypeError('encryptedStorageRelay is invalid');
  if (storageAgentKeyFingerprint !== null && (typeof storageAgentKeyFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(storageAgentKeyFingerprint))) throw new TypeError('storageAgentKeyFingerprint is invalid');
  if (storageAgentPublicKey !== null && (typeof storageAgentPublicKey !== 'string' || !/^[A-Za-z0-9_-]+$/.test(storageAgentPublicKey) || storageAgentPublicKey.length > 4096)) throw new TypeError('storageAgentPublicKey is invalid');
  if (businessTenantId !== null && (typeof businessTenantId !== 'string' || !businessTenantId.trim())) throw new TypeError('businessTenantId is invalid');
  const app = express();
  app.disable('x-powered-by');
  app.use('/api/desktop/question-bank/assets/relay', express.json({ limit: '90mb' }));
  app.use('/api/desktop/question-imports', express.json({ limit: '90mb' }));
  app.use('/api/storage-agent/question-imports', express.json({ limit: '90mb' }));
  app.use('/api/storage-agent/artifact-deliveries', express.raw({ type: 'application/octet-stream', limit: '64mb' }));
  app.use('/api/storage-agent/question-asset-deliveries', express.raw({ type: 'application/octet-stream', limit: '64mb' }));
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
  function questionImportFailure(response, error) {
    if (error && (error.code === 'CLOUD_BUSINESS_ACCESS_DENIED' || error.code === 'CLOUD_QUESTION_IMPORT_ACCESS_DENIED')) {
      return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
    }
    if (error && error.code === 'CLOUD_QUESTION_IMPORT_NOT_FOUND') return response.status(404).json({ ok: false, code: error.code });
    if (error && ['CLOUD_QUESTION_IMPORT_NOT_CONFIRMABLE', 'CLOUD_QUESTION_IMPORT_SOURCE_UNVERIFIED', 'CLOUD_QUESTION_IMPORT_CONFLICT'].includes(error.code)) {
      return response.status(409).json({ ok: false, code: error.code });
    }
    if (error && error.code === 'CLOUD_QUESTION_IMPORT_INPUT_INVALID') return businessInputInvalid(response);
    return businessUnavailable(response);
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
  function boundedText(value, maximumLength = 4096) {
    return value === null || (typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= maximumLength)
      ? value
      : undefined;
  }
  function studentContacts(value, allowUnbind = false) {
    if (!Array.isArray(value) || value.length > 3) return null;
    const slots = new Set();
    const contacts = [];
    for (const candidate of value) {
      const contact = exactBody(candidate, ['slot', 'relationship', 'phone', 'wechat', 'expectedUpdatedAt']);
      const expectedUpdatedAt = contact?.expectedUpdatedAt === null ? null : instant(contact?.expectedUpdatedAt);
      const phone = contact?.phone;
      const wechat = contact?.wechat;
      const validPhone = phone === null || (typeof phone === 'string' && /^1[3-9][0-9]{9}$/u.test(phone));
      const validWechat = wechat === null || (typeof wechat === 'string' && wechat === wechat.trim() && wechat.length > 0 && wechat.length <= 128);
      if (!contact || !Number.isInteger(contact.slot) || contact.slot < 1 || contact.slot > 3 || slots.has(contact.slot)
        || !['student', 'guardian'].includes(contact.relationship)
        || (contact.slot === 1 && contact.relationship !== 'student') || (contact.slot > 1 && contact.relationship !== 'guardian')
        || expectedUpdatedAt === undefined || !validPhone || !validWechat
        || (phone === null && wechat === null && (!allowUnbind || expectedUpdatedAt === null))) return null;
      slots.add(contact.slot);
      contacts.push({ slot: contact.slot, relationship: contact.relationship, phone, wechat, expectedUpdatedAt });
    }
    return contacts;
  }
  function coursePricings(value) {
    if (!Array.isArray(value) || value.length > 1000) return null;
    const studentIds = new Set(); const pricings = [];
    for (const candidate of value) {
      const pricing = exactBody(candidate, ['studentId', 'tuition', 'teacherFee']);
      const studentId = boundedText(pricing?.studentId, 256);
      const tuition = nonNegativeNumber(pricing?.tuition); const teacherFee = nonNegativeNumber(pricing?.teacherFee);
      if (!studentId || studentIds.has(studentId) || tuition === null || teacherFee === null) return null;
      studentIds.add(studentId); pricings.push({ studentId, tuition, teacherFee });
    }
    return pricings;
  }
  function nonNegativeNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100000000 ? value : null;
  }
  function courseRecord(value, expectedUpdatedAtRequired = false) {
    const keys = expectedUpdatedAtRequired
      ? ['expectedUpdatedAt', 'name', 'year', 'semester', 'displayName', 'type', 'sourceType', 'institutionId', 'priceTuition', 'priceTeacher', 'billingUnit', 'teacherFeeMode', 'roomId', 'roomName', 'teacherId', 'teacherName', 'active', 'defaultDurationMinutes', 'notes', 'pricings']
      : ['name', 'year', 'semester', 'displayName', 'type', 'sourceType', 'institutionId', 'priceTuition', 'priceTeacher', 'billingUnit', 'teacherFeeMode', 'roomId', 'roomName', 'teacherId', 'teacherName', 'active', 'defaultDurationMinutes', 'notes', 'pricings'];
    const input = exactBody(value, keys);
    const name = boundedText(input?.name, 256); const semester = boundedText(input?.semester, 128); const displayName = boundedText(input?.displayName, 256);
    const institutionId = boundedText(input?.institutionId, 256); const roomId = boundedText(input?.roomId, 256); const teacherId = boundedText(input?.teacherId, 256);
    const roomName = optionalText(input?.roomName); const teacherName = optionalText(input?.teacherName); const notes = optionalText(input?.notes);
    const pricings = coursePricings(input?.pricings); const expectedUpdatedAt = expectedUpdatedAtRequired ? instant(input?.expectedUpdatedAt) : undefined;
    if (!input || !name || !semester || !displayName || institutionId === undefined || !roomId || !teacherId || roomName === undefined || teacherName === undefined || notes === undefined || pricings === null
      || !Number.isInteger(input.year) || input.year < 1900 || input.year > 2200 || ![1, 2, 3, 4].includes(input.type) || ![1, 2, 3].includes(input.sourceType)
      || !(input.sourceType === 1 || institutionId) || ![1, 2].includes(input.billingUnit) || ![1, 2].includes(input.teacherFeeMode)
      || nonNegativeNumber(input.priceTuition) === null || nonNegativeNumber(input.priceTeacher) === null || typeof input.active !== 'boolean'
      || !(input.defaultDurationMinutes === null || (Number.isInteger(input.defaultDurationMinutes) && input.defaultDurationMinutes > 0 && input.defaultDurationMinutes <= 1440))
      || (expectedUpdatedAtRequired && !expectedUpdatedAt)) return null;
    return { expectedUpdatedAt, name, year: input.year, semester, displayName, type: input.type, sourceType: input.sourceType, institutionId, priceTuition: input.priceTuition, priceTeacher: input.priceTeacher, billingUnit: input.billingUnit, teacherFeeMode: input.teacherFeeMode, roomId, roomName, teacherId, teacherName, active: input.active, defaultDurationMinutes: input.defaultDurationMinutes, notes, pricings };
  }
  function schedulePricings(value) {
    if (!Array.isArray(value) || value.length > 1000) return null;
    const studentIds = new Set(); const pricings = [];
    for (const candidate of value) {
      const pricing = exactBody(candidate, ['studentId', 'attendanceStatus', 'tuition', 'teacherFee']);
      const studentId = boundedText(pricing?.studentId, 256);
      const tuition = nonNegativeNumber(pricing?.tuition); const teacherFee = nonNegativeNumber(pricing?.teacherFee);
      if (!studentId || studentIds.has(studentId) || ![1, 3, 4].includes(pricing?.attendanceStatus) || tuition === null || teacherFee === null) return null;
      studentIds.add(studentId); pricings.push({ studentId, attendanceStatus: pricing.attendanceStatus, tuition, teacherFee });
    }
    return pricings;
  }
  function scheduleRecord(value) {
    const input = exactBody(value, ['courseId', 'startAt', 'endAt', 'recurringRule', 'status', 'roomDisplay', 'serviceType', 'tuition', 'teacherFee', 'notes', 'pricings']);
    const courseId = boundedText(input?.courseId, 256); const startAt = instant(input?.startAt); const endAt = instant(input?.endAt);
    const recurringRule = optionalText(input?.recurringRule); const roomDisplay = optionalText(input?.roomDisplay); const notes = optionalText(input?.notes);
    const tuition = nonNegativeNumber(input?.tuition); const teacherFee = nonNegativeNumber(input?.teacherFee); const pricings = schedulePricings(input?.pricings);
    if (!input || !courseId || !startAt || !endAt || new Date(endAt).getTime() <= new Date(startAt).getTime()
      || recurringRule === undefined || roomDisplay === undefined || notes === undefined || ![1, 2, 3, 4].includes(input.status)
      || !(input.serviceType === null || [1, 2].includes(input.serviceType)) || tuition === null || teacherFee === null || pricings === null) return null;
    return { courseId, startAt, endAt, recurringRule, status: input.status, roomDisplay, serviceType: input.serviceType, tuition, teacherFee, notes, pricings };
  }
  function institutionRecord(value, expectedUpdatedAtRequired = false) {
    const keys = expectedUpdatedAtRequired ? ['expectedUpdatedAt', 'name', 'contactPerson', 'contactPhone', 'revenueShare', 'notes'] : ['name', 'contactPerson', 'contactPhone', 'revenueShare', 'notes'];
    const input = exactBody(value, keys); const name = boundedText(input?.name, 256);
    const contactPerson = optionalText(input?.contactPerson); const contactPhone = optionalText(input?.contactPhone); const notes = optionalText(input?.notes);
    const expectedUpdatedAt = expectedUpdatedAtRequired ? instant(input?.expectedUpdatedAt) : undefined;
    if (!input || !name || contactPerson === undefined || contactPhone === undefined || notes === undefined
      || !(input.revenueShare === null || (typeof input.revenueShare === 'number' && Number.isFinite(input.revenueShare) && input.revenueShare >= 0 && input.revenueShare <= 100))
      || (expectedUpdatedAtRequired && !expectedUpdatedAt)) return null;
    return { expectedUpdatedAt, name, contactPerson, contactPhone, revenueShare: input.revenueShare, notes };
  }
  function schoolRecord(value, expectedUpdatedAtRequired = false) {
    const keys = expectedUpdatedAtRequired ? ['expectedUpdatedAt', 'name', 'count'] : ['name', 'count'];
    const input = exactBody(value, keys); const name = boundedText(input?.name, 256);
    const expectedUpdatedAt = expectedUpdatedAtRequired ? instant(input?.expectedUpdatedAt) : undefined;
    if (!input || !name || !Number.isInteger(input.count) || input.count < 0 || input.count > 100000000 || (expectedUpdatedAtRequired && !expectedUpdatedAt)) return null;
    return { expectedUpdatedAt, name, count: input.count };
  }
  function dateOnly(value, nullable = false) {
    if (nullable && value === null) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
  }
  function positiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100000000 ? value : null;
  }
  function supplementalRecord(kind, value, expectedUpdatedAtRequired = false) {
    const fields = {
      payment: ['studentId', 'amount', 'paymentType', 'paymentDate', 'paymentMethod', 'notes'],
      consumption: ['scheduleId', 'studentId', 'hours', 'amount', 'consumptionDate', 'notes'],
      grade: ['studentId', 'subject', 'score', 'examDate', 'notes'],
      assetCategory: ['name', 'type', 'color'],
      assetRecord: ['date', 'type', 'categoryId', 'categoryName', 'amount', 'studentId', 'studentName', 'note'],
    }[kind];
    const input = exactBody(value, expectedUpdatedAtRequired ? ['expectedUpdatedAt', ...fields] : fields);
    if (!input) return null;
    const expectedUpdatedAt = expectedUpdatedAtRequired ? instant(input.expectedUpdatedAt) : undefined;
    if (expectedUpdatedAtRequired && !expectedUpdatedAt) return null;
    if (kind === 'payment') {
      const studentId = boundedText(input.studentId, 256); const paymentDate = dateOnly(input.paymentDate);
      const paymentMethod = optionalText(input.paymentMethod); const notes = optionalText(input.notes);
      if (!studentId || positiveNumber(input.amount) === null || ![1, 2].includes(input.paymentType) || !paymentDate || paymentMethod === undefined || notes === undefined) return null;
      return { expectedUpdatedAt, studentId, amount: input.amount, paymentType: input.paymentType, paymentDate, paymentMethod, notes };
    }
    if (kind === 'consumption') {
      const scheduleId = boundedText(input.scheduleId, 256); const studentId = boundedText(input.studentId, 256); const consumptionDate = dateOnly(input.consumptionDate); const notes = optionalText(input.notes);
      if (!scheduleId || !studentId || positiveNumber(input.hours) === null || nonNegativeNumber(input.amount) === null || !consumptionDate || notes === undefined) return null;
      return { expectedUpdatedAt, scheduleId, studentId, hours: input.hours, amount: input.amount, consumptionDate, notes };
    }
    if (kind === 'grade') {
      const studentId = boundedText(input.studentId, 256); const subject = boundedText(input.subject, 128); const examDate = dateOnly(input.examDate, true); const notes = optionalText(input.notes);
      if (!studentId || !subject || nonNegativeNumber(input.score) === null || input.score > 10000 || examDate === undefined || notes === undefined) return null;
      return { expectedUpdatedAt, studentId, subject, score: input.score, examDate, notes };
    }
    if (kind === 'assetCategory') {
      const name = boundedText(input.name, 128); const color = input.color === null || (typeof input.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(input.color)) ? input.color : undefined;
      if (!name || !['income', 'expense'].includes(input.type) || color === undefined) return null;
      return { expectedUpdatedAt, name, type: input.type, color };
    }
    const categoryId = boundedText(input.categoryId, 128); const categoryName = boundedText(input.categoryName, 128);
    const studentId = boundedText(input.studentId, 256); const studentName = boundedText(input.studentName, 256); const note = optionalText(input.note); const date = dateOnly(input.date);
    if (!date || !['income', 'expense'].includes(input.type) || !categoryId || !categoryName || positiveNumber(input.amount) === null || studentId === undefined || studentName === undefined || note === undefined) return null;
    return { expectedUpdatedAt, date, type: input.type, categoryId, categoryName, amount: input.amount, studentId, studentName, note: note ?? '' };
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
  async function miniappBusinessContext(request) {
    const token = sessionToken(request);
    if (!token || !miniappCloudAccount) throw businessAccessDenied();
    try {
      return await miniappCloudAccount.context({ token });
    } catch (_) {
      throw businessAccessDenied();
    }
  }
  function miniappCapabilities(context) {
    if (!context || !Array.isArray(context.roles)) throw businessAccessDenied();
    if (context.status === 'visitor' && context.roles.length === 0) {
      return ['projection:read', 'role-application:read', 'role-application:submit', 'question-preview:read'];
    }
    if (context.status !== 'active') throw businessAccessDenied();
    if (context.roles.includes('super_admin')) return ['business:all', 'question-bank:view'];
    if (context.roles.includes('teacher')) return ['business:teacher-scope', 'question-bank:view'];
    if (context.roles.includes('student')) return ['question-bank:view'];
    throw businessAccessDenied();
  }
  // Core teaching records are desktop-only mutations.  Miniapp tickets may read
  // their scoped data and run explicitly limited task APIs, but never write these tables.
  async function desktopBusinessContext(request) {
    return desktopQuestionContext(request);
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
  function miniappProjectionScope(context) {
    if (!context || !Array.isArray(context.roles)) throw businessAccessDenied();
    if (context.roles.includes('super_admin')) return { role: 'manager', profileId: null, accountId: context.accountId };
    const profile = context.profile && typeof context.profile === 'object' ? context.profile : null;
    if (context.roles.includes('teacher')) {
      const profileId = profile?.type === 'teacher' ? profile.id : context.teacherId;
      if (typeof profileId === 'string' && profileId === profileId.trim() && profileId) return { role: 'teacher', profileId, accountId: context.accountId };
    }
    if (context.roles.includes('student')) {
      const profileId = profile?.type === 'student' ? profile.id : context.studentId;
      if (typeof profileId === 'string' && profileId === profileId.trim() && profileId) return { role: 'student', profileId, accountId: context.accountId };
    }
    throw businessAccessDenied();
  }
  const miniappProjectionSql = [
    'WITH scoped_schedules AS (',
    'SELECT s.* FROM business.schedules s JOIN business.courses c ON c.tenant_id=s.tenant_id AND c.id=s.course_id WHERE s.tenant_id=$1 AND s.legacy_deleted=false AND c.legacy_deleted=false AND (',
    "$2='manager' OR ($2='teacher' AND c.teacher_id=$3) OR ($2='student' AND (EXISTS (SELECT 1 FROM business.schedule_student_overrides o WHERE o.tenant_id=s.tenant_id AND o.schedule_id=s.id AND o.student_id=$3) OR (NOT EXISTS (SELECT 1 FROM business.schedule_student_overrides o WHERE o.tenant_id=s.tenant_id AND o.schedule_id=s.id) AND EXISTS (SELECT 1 FROM business.course_student_pricings p WHERE p.tenant_id=s.tenant_id AND p.course_id=s.course_id AND p.student_id=$3))))",
    ')),',
    'scoped_courses AS (',
    'SELECT c.* FROM business.courses c WHERE c.tenant_id=$1 AND c.legacy_deleted=false AND (',
    "$2='manager' OR ($2='teacher' AND c.teacher_id=$3) OR ($2='student' AND (EXISTS (SELECT 1 FROM business.course_student_pricings p WHERE p.tenant_id=c.tenant_id AND p.course_id=c.id AND p.student_id=$3) OR EXISTS (SELECT 1 FROM scoped_schedules x WHERE x.tenant_id=c.tenant_id AND x.course_id=c.id)))",
    ')),',
    'scoped_students AS (',
    'SELECT s.* FROM business.students s WHERE s.tenant_id=$1 AND s.legacy_deleted=false AND (',
    "$2='manager' OR ($2='student' AND s.id=$3) OR ($2='teacher' AND (EXISTS (SELECT 1 FROM business.course_student_pricings p JOIN scoped_courses c ON c.tenant_id=p.tenant_id AND c.id=p.course_id WHERE p.tenant_id=s.tenant_id AND p.student_id=s.id) OR EXISTS (SELECT 1 FROM business.schedule_student_overrides o JOIN scoped_schedules x ON x.tenant_id=o.tenant_id AND x.id=o.schedule_id WHERE o.tenant_id=s.tenant_id AND o.student_id=s.id)))",
    '))',
    'SELECT jsonb_build_object(',
    "'students',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'phone',s.phone_legacy,'school',s.school_legacy,'grade_year',s.grade_year,'grade_current',s.grade_current,'institution_id',s.institution_id,'parent_name',s.parent_name_legacy,'parent_wechat',s.parent_wechat_legacy,'balance_hours',s.legacy_balance_hours,'balance_money',s.legacy_balance_money,'notes',s.notes,'deleted',false,'created_at',s.created_at,'updated_at',s.updated_at) ORDER BY s.id) FROM scoped_students s),'[]'::jsonb),",
    "'studentContacts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.contact_id,'student_id',d.student_id,'slot',d.contact_slot,'relationship',d.relationship,'phone',d.phone_value,'wechat',d.wechat_handle,'status',d.status,'created_at',d.created_at,'updated_at',d.updated_at) ORDER BY d.student_id,d.contact_slot) FROM business.student_contact_directory d JOIN scoped_students s ON s.id=d.student_id),'[]'::jsonb),",
    "'teachers',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'phone',t.phone_legacy,'subject',t.subject,'hourly_rate',CASE WHEN $2 IN ('manager','teacher') THEN t.hourly_rate ELSE NULL END,'notes',CASE WHEN $2 IN ('manager','teacher') THEN t.notes ELSE NULL END,'deleted',false,'created_at',t.created_at,'updated_at',t.updated_at) ORDER BY t.id) FROM business.teachers t WHERE t.tenant_id=$1 AND t.legacy_deleted=false AND ($2='manager' OR EXISTS (SELECT 1 FROM scoped_courses c WHERE c.teacher_id=t.id))),'[]'::jsonb),",
    "'courses',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'year',c.year,'semester',c.semester,'display_name',c.display_name,'type',c.course_type,'source_type',c.legacy_source_type,'institution_id',c.institution_id,'price_tuition',c.price_tuition,'price_teacher',CASE WHEN $2 IN ('manager','teacher') THEN c.price_teacher ELSE NULL END,'billing_unit',c.billing_unit,'teacher_fee_mode',CASE WHEN $2 IN ('manager','teacher') THEN c.teacher_fee_mode ELSE NULL END,'room_id',c.legacy_room_id,'room_name',c.room_name_snapshot,'teacher_id',c.teacher_id,'teacher_name',c.teacher_name_snapshot,'active',c.legacy_active,'default_duration_minutes',c.default_duration_minutes,'notes',c.notes,'deleted',false,'created_at',c.created_at,'updated_at',c.updated_at,'student_pricings',COALESCE((SELECT jsonb_agg(jsonb_build_object('student_id',p.student_id,'tuition',p.tuition,'teacher_fee',CASE WHEN $2 IN ('manager','teacher') THEN p.teacher_fee ELSE NULL END) ORDER BY p.student_id) FROM business.course_student_pricings p WHERE p.tenant_id=c.tenant_id AND p.course_id=c.id AND ($2<>'student' OR p.student_id=$3)),'[]'::jsonb)) ORDER BY c.id) FROM scoped_courses c),'[]'::jsonb),",
    "'schedules',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'course_id',s.course_id,'start_time',s.start_at,'end_time',s.end_at,'recurring_rule',s.recurring_rule_json,'status',s.status,'room',s.room_display_snapshot,'service_type',s.service_type,'calculated_tuition',CASE WHEN $2='student' THEN COALESCE((SELECT o.tuition FROM business.schedule_student_overrides o WHERE o.tenant_id=s.tenant_id AND o.schedule_id=s.id AND o.student_id=$3),(SELECT p.tuition FROM business.course_student_pricings p WHERE p.tenant_id=s.tenant_id AND p.course_id=s.course_id AND p.student_id=$3)) ELSE s.calculated_tuition END,'calculated_teacher_fee',CASE WHEN $2 IN ('manager','teacher') THEN s.calculated_teacher_fee ELSE NULL END,'notes',s.notes,'deleted',false,'created_at',s.created_at,'updated_at',s.updated_at,'student_ids',COALESCE((SELECT jsonb_agg(o.student_id ORDER BY o.student_id) FROM business.schedule_student_overrides o WHERE o.tenant_id=s.tenant_id AND o.schedule_id=s.id AND ($2<>'student' OR o.student_id=$3)),(SELECT jsonb_agg(p.student_id ORDER BY p.student_id) FROM business.course_student_pricings p WHERE p.tenant_id=s.tenant_id AND p.course_id=s.course_id AND ($2<>'student' OR p.student_id=$3)),'[]'::jsonb),'student_pricings',COALESCE((SELECT jsonb_agg(jsonb_build_object('student_id',o.student_id,'tuition',o.tuition,'teacher_fee',CASE WHEN $2 IN ('manager','teacher') THEN o.teacher_fee ELSE NULL END,'attendance_status',o.attendance_status) ORDER BY o.student_id) FROM business.schedule_student_overrides o WHERE o.tenant_id=s.tenant_id AND o.schedule_id=s.id AND ($2<>'student' OR o.student_id=$3)),(SELECT jsonb_agg(jsonb_build_object('student_id',p.student_id,'tuition',p.tuition,'teacher_fee',CASE WHEN $2 IN ('manager','teacher') THEN p.teacher_fee ELSE NULL END) ORDER BY p.student_id) FROM business.course_student_pricings p WHERE p.tenant_id=s.tenant_id AND p.course_id=s.course_id AND ($2<>'student' OR p.student_id=$3)),'[]'::jsonb)) ORDER BY s.start_at,s.id) FROM scoped_schedules s),'[]'::jsonb),",
    "'institutions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'tenant_id',i.tenant_id,'name',i.name,'contact_person',i.contact_person_legacy,'contact_phone',i.contact_phone_legacy,'revenue_share',i.revenue_share,'notes',i.notes,'deleted',false,'created_at',i.created_at,'updated_at',i.updated_at) ORDER BY i.id) FROM business.institutions i WHERE i.tenant_id=$1 AND i.legacy_deleted=false AND ($2='manager' OR EXISTS (SELECT 1 FROM scoped_courses c WHERE c.institution_id=i.id))),'[]'::jsonb),",
    "'schools',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'tenant_id',s.tenant_id,'name',s.name,'count',s.legacy_count,'deleted',false,'created_at',s.created_at,'updated_at',s.updated_at) ORDER BY s.id) FROM business.schools s WHERE s.tenant_id=$1 AND s.legacy_deleted=false AND ($2='manager' OR EXISTS (SELECT 1 FROM scoped_students x WHERE x.school_legacy=s.name))),'[]'::jsonb),",
    "'rooms',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'tenant_id',r.tenant_id,'name',r.name,'address',r.address_legacy,'count',r.legacy_count,'deleted',false,'created_at',r.created_at,'updated_at',r.updated_at) ORDER BY r.id) FROM business.rooms r WHERE r.tenant_id=$1 AND r.legacy_deleted=false AND ($2='manager' OR EXISTS (SELECT 1 FROM scoped_courses c WHERE c.legacy_room_id=r.id))),'[]'::jsonb),",
    "'assetRecords',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',asset.id,'category_id',asset.category_id,'category_name',asset.category_name,'amount',asset.amount,'type',asset.record_type,'date',asset.record_date,'student_id',asset.student_id,'student_name',asset.student_name,'note',asset.note,'created_at',asset.created_at,'updated_at',asset.updated_at) ORDER BY asset.record_date DESC,asset.id) FROM (SELECT record_id AS id,category_id,category_name,amount,record_type,record_date,NULL::text AS student_id,NULL::text AS student_name,note,created_at,updated_at FROM business.personal_asset_records WHERE tenant_id=$1 AND account_id=$4 UNION ALL SELECT record_id,category_id,category_name,amount,record_type,record_date,student_id,student_name,note,created_at,updated_at FROM business.personal_asset_manual_records WHERE tenant_id=$1 AND account_id=$4 AND deleted=false) asset),'[]'::jsonb),",
    "'assetCategories',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',category.id,'name',category.name,'type',category.category_type,'color',category.color,'created_at',category.created_at,'updated_at',category.updated_at) ORDER BY category.category_type,category.name) FROM (SELECT category_id AS id,name,category_type,'#999'::text AS color,created_at,updated_at FROM business.personal_asset_categories WHERE tenant_id=$1 AND account_id=$4 UNION ALL SELECT category_id,name,category_type,COALESCE(color,'#999'),created_at,updated_at FROM business.personal_asset_manual_categories WHERE tenant_id=$1 AND account_id=$4 AND deleted=false) category),'[]'::jsonb)",
    ') AS projection',
  ].join(' ');
  function isMiniappProjection(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      && ['students', 'studentContacts', 'teachers', 'courses', 'schedules', 'institutions', 'schools', 'rooms', 'assetRecords', 'assetCategories'].every(key => Array.isArray(value[key]));
  }
  const desktopProjectionSql = [
    'SELECT jsonb_build_object(',
    "'students',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'phone',s.phone_legacy,'school',s.school_legacy,'grade_year',s.grade_year,'grade_current',s.grade_current,'institution_id',s.institution_id,'parent_name',s.parent_name_legacy,'parent_wechat',s.parent_wechat_legacy,'balance_hours',s.legacy_balance_hours,'balance_money',s.legacy_balance_money,'notes',s.notes,'deleted',false,'created_at',s.created_at,'updated_at',s.updated_at) ORDER BY s.id) FROM business.students s WHERE s.tenant_id=$1 AND s.legacy_deleted=false),'[]'::jsonb),",
    "'student_contacts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.contact_id,'student_id',d.student_id,'slot',d.contact_slot,'relationship',d.relationship,'phone',d.phone_value,'wechat',d.wechat_handle,'status',d.status,'created_at',d.created_at,'updated_at',d.updated_at) ORDER BY d.student_id,d.contact_slot) FROM business.student_contact_directory d JOIN business.students s ON s.id=d.student_id WHERE s.tenant_id=$1 AND s.legacy_deleted=false),'[]'::jsonb),",
    "'teachers',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'phone',t.phone_legacy,'subject',t.subject,'hourly_rate',t.hourly_rate,'notes',t.notes,'deleted',false,'created_at',t.created_at,'updated_at',t.updated_at) ORDER BY t.id) FROM business.teachers t WHERE t.tenant_id=$1 AND t.legacy_deleted=false),'[]'::jsonb),",
    "'courses',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'year',c.year,'semester',c.semester,'display_name',c.display_name,'type',c.course_type,'source_type',c.legacy_source_type,'institution_id',c.institution_id,'price_tuition',c.price_tuition,'price_teacher',c.price_teacher,'billing_unit',c.billing_unit,'teacher_fee_mode',c.teacher_fee_mode,'room_id',c.legacy_room_id,'room_name',c.room_name_snapshot,'teacher_id',c.teacher_id,'teacher_name',c.teacher_name_snapshot,'active',c.legacy_active,'default_duration_minutes',c.default_duration_minutes,'notes',c.notes,'deleted',false,'created_at',c.created_at,'updated_at',c.updated_at,'student_pricings',COALESCE((SELECT jsonb_agg(jsonb_build_object('student_id',p.student_id,'tuition',p.tuition,'teacher_fee',p.teacher_fee) ORDER BY p.student_id) FROM business.course_student_pricings p WHERE p.tenant_id=c.tenant_id AND p.course_id=c.id),'[]'::jsonb)) ORDER BY c.id) FROM business.courses c WHERE c.tenant_id=$1 AND c.legacy_deleted=false),'[]'::jsonb),",
    "'schedules',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'course_id',s.course_id,'start_time',s.start_at,'end_time',s.end_at,'recurring_rule',s.recurring_rule_json,'status',s.status,'room',s.room_display_snapshot,'service_type',s.service_type,'calculated_tuition',s.calculated_tuition,'calculated_teacher_fee',s.calculated_teacher_fee,'notes',s.notes,'deleted',false,'created_at',s.created_at,'updated_at',s.updated_at,'student_ids',COALESCE((SELECT jsonb_agg(o.student_id ORDER BY o.student_id) FROM business.schedule_student_overrides o WHERE o.tenant_id=s.tenant_id AND o.schedule_id=s.id),(SELECT jsonb_agg(p.student_id ORDER BY p.student_id) FROM business.course_student_pricings p WHERE p.tenant_id=s.tenant_id AND p.course_id=s.course_id),'[]'::jsonb),'student_pricings',COALESCE((SELECT jsonb_agg(jsonb_build_object('student_id',o.student_id,'tuition',o.tuition,'teacher_fee',o.teacher_fee,'status',o.attendance_status) ORDER BY o.student_id) FROM business.schedule_student_overrides o WHERE o.tenant_id=s.tenant_id AND o.schedule_id=s.id),(SELECT jsonb_agg(jsonb_build_object('student_id',p.student_id,'tuition',p.tuition,'teacher_fee',p.teacher_fee) ORDER BY p.student_id) FROM business.course_student_pricings p WHERE p.tenant_id=s.tenant_id AND p.course_id=s.course_id),'[]'::jsonb)) ORDER BY s.start_at,s.id) FROM business.schedules s WHERE s.tenant_id=$1 AND s.legacy_deleted=false),'[]'::jsonb),",
    "'institutions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'tenant_id',i.tenant_id,'name',i.name,'contact_person',i.contact_person_legacy,'contact_phone',i.contact_phone_legacy,'revenue_share',i.revenue_share,'notes',i.notes,'deleted',false,'created_at',i.created_at,'updated_at',i.updated_at) ORDER BY i.id) FROM business.institutions i WHERE i.tenant_id=$1 AND i.legacy_deleted=false),'[]'::jsonb),",
    "'schools',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'tenant_id',s.tenant_id,'name',s.name,'count',s.legacy_count,'deleted',false,'created_at',s.created_at,'updated_at',s.updated_at) ORDER BY s.id) FROM business.schools s WHERE s.tenant_id=$1 AND s.legacy_deleted=false),'[]'::jsonb),",
    "'rooms',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'tenant_id',r.tenant_id,'name',r.name,'address',r.address_legacy,'count',r.legacy_count,'deleted',false,'created_at',r.created_at,'updated_at',r.updated_at) ORDER BY r.id) FROM business.rooms r WHERE r.tenant_id=$1 AND r.legacy_deleted=false),'[]'::jsonb),",
    "'grades',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'student_id',g.student_id,'subject',g.subject,'score',g.score,'exam_date',g.exam_date,'notes',g.notes,'created_at',g.created_at,'updated_at',g.updated_at) ORDER BY g.exam_date DESC NULLS LAST,g.id) FROM business.grades g WHERE g.tenant_id=$1 AND g.deleted=false),'[]'::jsonb),",
    "'payments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'student_id',p.student_id,'amount',p.amount,'payment_type',p.payment_type,'payment_date',p.payment_date,'payment_method',p.payment_method,'notes',p.notes,'created_at',p.created_at,'updated_at',p.updated_at) ORDER BY p.payment_date DESC,p.id) FROM business.payments p WHERE p.tenant_id=$1 AND p.deleted=false),'[]'::jsonb),",
    "'consumptions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'schedule_id',c.schedule_id,'student_id',c.student_id,'hours',c.hours,'amount',c.amount,'consumption_date',c.consumption_date,'notes',c.notes,'created_at',c.created_at,'updated_at',c.updated_at) ORDER BY c.consumption_date DESC,c.id) FROM business.consumptions c WHERE c.tenant_id=$1 AND c.deleted=false),'[]'::jsonb),",
    "'assetRecords',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',asset.id,'category_id',asset.category_id,'category_name',asset.category_name,'amount',asset.amount,'type',asset.record_type,'date',asset.record_date,'student_id',asset.student_id,'student_name',asset.student_name,'note',asset.note,'created_at',asset.created_at,'updated_at',asset.updated_at) ORDER BY asset.record_date DESC,asset.id) FROM (SELECT record_id AS id,category_id,category_name,amount,record_type,record_date,NULL::text AS student_id,NULL::text AS student_name,note,created_at,updated_at FROM business.personal_asset_records WHERE tenant_id=$1 AND account_id=$2 UNION ALL SELECT record_id,category_id,category_name,amount,record_type,record_date,student_id,student_name,note,created_at,updated_at FROM business.personal_asset_manual_records WHERE tenant_id=$1 AND account_id=$2 AND deleted=false) asset),'[]'::jsonb),",
    "'assetCategories',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',category.id,'name',category.name,'type',category.category_type,'color',category.color,'created_at',category.created_at,'updated_at',category.updated_at) ORDER BY category.category_type,category.name) FROM (SELECT category_id AS id,name,category_type,'#999'::text AS color,created_at,updated_at FROM business.personal_asset_categories WHERE tenant_id=$1 AND account_id=$2 UNION ALL SELECT category_id,name,category_type,COALESCE(color,'#999'),created_at,updated_at FROM business.personal_asset_manual_categories WHERE tenant_id=$1 AND account_id=$2 AND deleted=false) category),'[]'::jsonb),",
    "'taxonomy_systems',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'subject',s.subject,'name',s.name,'sort_order',s.sort_order,'deleted',false,'created_at',s.created_at,'updated_at',s.updated_at) ORDER BY s.subject,s.sort_order,s.id) FROM business.question_taxonomy_systems s WHERE s.tenant_id=$1 AND s.deleted=false),'[]'::jsonb),",
    "'taxonomy_nodes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',n.id,'system_id',n.system_id,'parent_id',n.parent_id,'name',n.name,'sort_order',n.sort_order,'deleted',false,'created_at',n.created_at,'updated_at',n.updated_at) ORDER BY n.system_id,n.sort_order,n.id) FROM business.question_taxonomy_nodes n WHERE n.tenant_id=$1 AND n.deleted=false),'[]'::jsonb)",
    ') AS projection',
  ].join(' ');
  function isDesktopProjection(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      && ['students', 'student_contacts', 'teachers', 'courses', 'schedules', 'institutions', 'schools', 'rooms', 'grades', 'payments', 'consumptions', 'assetRecords', 'assetCategories', 'taxonomy_systems', 'taxonomy_nodes'].every(key => Array.isArray(value[key]));
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
  app.post('/api/desktop/password-enrollment-from-verification', async (request, response) => {
    if (!desktopPasswordAuthentication) return desktopUnavailable(response);
    try {
      const result = await desktopPasswordAuthentication.enrollFromVerificationTicket(request.body);
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
  app.post('/api/desktop/teacher-self-registration', async (request, response) => {
    if (!desktopTeacherSelfRegistration) return desktopUnavailable(response);
    const body = exactBody(request.body, ['verificationToken', 'name', 'subject']);
    if (!body) return response.status(400).json({ ok: false, code: 'CLOUD_DESKTOP_TEACHER_REGISTRATION_INVALID' });
    try {
      const result = await desktopTeacherSelfRegistration.register(body);
      response.status(201).json({ ok: true, ...result });
    } catch (error) {
      if (error && error.code === 'CLOUD_DESKTOP_TEACHER_REGISTRATION_INVALID') return response.status(400).json({ ok: false, code: error.code });
      response.status(403).json({ ok: false, code: 'CLOUD_DESKTOP_TEACHER_REGISTRATION_REJECTED' });
    }
  });
  app.get('/api/desktop/question-bank/questions', async (request, response) => {
    if (!questionAuthority || businessTenantId === null) return businessUnavailable(response);
    const limit = request.query.limit === undefined ? 200 : Number(request.query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) return businessInputInvalid(response);
    try {
      const actor = await desktopQuestionContext(request);
      const questions = await questionAuthority.list({ tenantId: businessTenantId, actor, limit });
      response.json({ ok: true, questions });
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
  app.get('/api/desktop/question-imports/relay-key', async (request, response) => {
    if (!questionImportTasks || !storageAgentKeyFingerprint || !storageAgentPublicKey || businessTenantId === null) return businessUnavailable(response);
    try {
      const actor = await desktopQuestionContext(request);
      if (!Array.isArray(actor.roles) || !actor.roles.some(role => ['super_admin', 'teacher'].includes(role))) throw businessAccessDenied();
      response.json({ ok: true, agentPublicKey: storageAgentPublicKey, agentKeyFingerprint: storageAgentKeyFingerprint });
    } catch (error) {
      questionImportFailure(response, error);
    }
  });
  app.post('/api/desktop/question-imports', async (request, response) => {
    if (!questionImportTasks || !storageAgentKeyFingerprint || businessTenantId === null) return businessUnavailable(response);
    const body = exactBody(request.body, ['sourceType', 'sourceFileName', 'sourceMimeType', 'sourceSha256', 'sourceBytes', 'metadata', 'storage', 'relay']);
    const relay = body ? exactBody(body.relay, ['agentKeyFingerprint', 'envelope', 'ciphertextBase64', 'expiresAt']) : null;
    const ciphertext = relay ? encryptedCiphertext(relay.ciphertextBase64) : null;
    const idempotencyKey = String(request.get('x-idempotency-key') || '');
    if (!body || !relay || !ciphertext || relay.agentKeyFingerprint !== storageAgentKeyFingerprint || !idempotencyKey || idempotencyKey.length > 256) return businessInputInvalid(response);
    try {
      const actor = await desktopQuestionContext(request);
      const task = await questionImportTasks.create({
        tenantId: businessTenantId, actor, idempotencyKey,
        request: { ...body, relay: { ...relay, ciphertext } },
      });
      response.status(task.replayed ? 200 : 202).json({ ok: true, task });
    } catch (error) {
      questionImportFailure(response, error);
    }
  });
  app.get('/api/desktop/question-imports/:taskId', async (request, response) => {
    if (!questionImportTasks || businessTenantId === null) return businessUnavailable(response);
    try {
      const task = await questionImportTasks.read({ tenantId: businessTenantId, actor: await desktopQuestionContext(request), taskId: String(request.params.taskId || '') });
      response.json({ ok: true, task });
    } catch (error) {
      questionImportFailure(response, error);
    }
  });
  app.post('/api/desktop/question-imports/:taskId/prepare-drafts', async (request, response) => {
    if (!questionImportTasks || businessTenantId === null || !exactBody(request.body, [])) return businessUnavailable(response);
    try {
      const task = await questionImportTasks.prepareDrafts({ tenantId: businessTenantId, actor: await desktopQuestionContext(request), taskId: String(request.params.taskId || '') });
      response.json({ ok: true, task });
    } catch (error) {
      questionImportFailure(response, error);
    }
  });
  app.post('/api/storage-agent/question-imports/:taskId/candidates', async (request, response) => {
    if (!questionImportTasks || !storageAgent || typeof storageAgent.authorize !== 'function' || businessTenantId === null) return businessUnavailable(response);
    const body = exactBody(request.body, ['agentId', 'leaseToken', 'observedSha256', 'observedBytes', 'candidates']);
    const token = storageAgentToken(request);
    if (!body || !token) return response.status(400).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_INPUT_INVALID' });
    try {
      const agent = await storageAgent.authorize({ agentId: body.agentId, token });
      const task = await questionImportTasks.completeSourceAndStoreCandidates({
        taskId: String(request.params.taskId || ''), agentId: agent.agentId, leaseToken: body.leaseToken,
        observedSha256: body.observedSha256, observedBytes: body.observedBytes, candidates: body.candidates,
      });
      response.json({ ok: true, task });
    } catch (error) {
      if (error && error.code === 'STORAGE_AGENT_REJECTED') return storageAgentFailure(response, error);
      questionImportFailure(response, error);
    }
  });
  app.get('/api/desktop/question-bank/assets/relay-key', async (request, response) => {
    if (!encryptedStorageRelay || !storageAgentKeyFingerprint || !storageAgentPublicKey || businessTenantId === null) return businessUnavailable(response);
    try {
      const actor = await desktopQuestionContext(request);
      if (!Array.isArray(actor.roles) || !actor.roles.some(role => ['super_admin', 'teacher'].includes(role))) throw businessAccessDenied();
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
      if (!Array.isArray(actor.roles) || !actor.roles.some(role => ['super_admin', 'teacher'].includes(role))) throw businessAccessDenied();
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
  app.get('/api/desktop/question-bank/assets/relay/:taskId', async (request, response) => {
    if (!encryptedStorageRelay || businessTenantId === null) return businessUnavailable(response);
    const taskId = String(request.params.taskId || '').trim();
    if (!/^task_[A-Za-z0-9_-]{8,128}$/.test(taskId)) return businessInputInvalid(response);
    try {
      const actor = await desktopQuestionContext(request);
      if (!Array.isArray(actor.roles) || !actor.roles.some(role => ['super_admin', 'teacher'].includes(role))) throw businessAccessDenied();
      const result = await query(
        `SELECT task.task_id AS "taskId",asset.id AS "assetId",task.state AS "taskState",asset.state AS "assetState",receipt.verified_at AS "verifiedAt"
           FROM business.storage_object_tasks task
           JOIN business.question_assets asset ON asset.storage_object_id=task.object_id AND asset.storage_object_version=task.object_version
           LEFT JOIN business.storage_task_receipts receipt ON receipt.task_id=task.task_id
          WHERE asset.tenant_id=$1 AND task.task_id=$2 AND asset.deleted=false`,
        [businessTenantId, taskId],
      );
      const row = result?.rows?.[0];
      if (!row || result.rows.length !== 1 || row.taskId !== taskId || typeof row.assetId !== 'string') return response.status(404).json({ ok: false, code: 'CLOUD_QUESTION_ASSET_RELAY_NOT_FOUND' });
      const verified = row.taskState === 'verified' && row.assetState === 'verified' && row.verifiedAt instanceof Date;
      const state = verified ? 'verified' : ['queued', 'leased', 'failed_retryable', 'quarantined'].includes(row.taskState) ? row.taskState : null;
      if (!state) return businessUnavailable(response);
      response.json({ ok: true, relay: { taskId, assetId: row.assetId, state, verifiedAt: verified ? row.verifiedAt.toISOString() : null } });
    } catch (error) {
      if (error && (error.code === 'CLOUD_BUSINESS_ACCESS_DENIED' || error.code === 'CLOUD_QUESTION_ACCESS_DENIED')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      businessUnavailable(response);
    }
  });
  app.post('/api/desktop/question-bank/assets/:assetKey/delivery', async (request, response) => {
    if (!questionAssetDeliveries || businessTenantId === null || !exactBody(request.body, [])) return businessUnavailable(response);
    try {
      const actor = await desktopQuestionContext(request);
      if (!Array.isArray(actor.roles) || !actor.roles.some(role => ['super_admin', 'teacher'].includes(role))) throw businessAccessDenied();
      const delivery = await questionAssetDeliveries.request({ tenantId: businessTenantId, accountId: actor.accountId, assetKey: String(request.params.assetKey || '') });
      response.status(delivery.status === 'ready' ? 200 : 202).json({ ok: true, delivery });
    } catch (error) {
      if (error && ['CLOUD_BUSINESS_ACCESS_DENIED', 'QUESTION_ASSET_DELIVERY_NOT_FOUND'].includes(error.code)) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      if (error && error.code === 'QUESTION_ASSET_DELIVERY_INPUT_INVALID') return businessInputInvalid(response);
      businessUnavailable(response);
    }
  });
  app.get('/api/desktop/question-bank/asset-deliveries/:deliveryId', async (request, response) => {
    if (!questionAssetDeliveries || businessTenantId === null) return businessUnavailable(response);
    try {
      const actor = await desktopQuestionContext(request);
      if (!Array.isArray(actor.roles) || !actor.roles.some(role => ['super_admin', 'teacher'].includes(role))) throw businessAccessDenied();
      const delivery = await questionAssetDeliveries.status({ tenantId: businessTenantId, accountId: actor.accountId, deliveryId: String(request.params.deliveryId || '') });
      response.json({ ok: true, delivery });
    } catch (error) {
      if (error && ['CLOUD_BUSINESS_ACCESS_DENIED', 'QUESTION_ASSET_DELIVERY_NOT_FOUND'].includes(error.code)) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      if (error && error.code === 'QUESTION_ASSET_DELIVERY_INPUT_INVALID') return businessInputInvalid(response);
      businessUnavailable(response);
    }
  });
  app.get('/api/desktop/question-bank/asset-deliveries/:deliveryId/download', async (request, response) => {
    if (!questionAssetDeliveries || businessTenantId === null) return businessUnavailable(response);
    try {
      const actor = await desktopQuestionContext(request);
      if (!Array.isArray(actor.roles) || !actor.roles.some(role => ['super_admin', 'teacher'].includes(role))) throw businessAccessDenied();
      const asset = await questionAssetDeliveries.download({ tenantId: businessTenantId, accountId: actor.accountId, deliveryId: String(request.params.deliveryId || '') });
      response.set('Cache-Control', 'no-store');
      response.set('Content-Type', asset.mimeType);
      response.set('Content-Length', String(asset.bytes.length));
      response.send(asset.bytes);
    } catch (error) {
      if (error && ['CLOUD_BUSINESS_ACCESS_DENIED', 'QUESTION_ASSET_DELIVERY_NOT_READY'].includes(error.code)) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      if (error && error.code === 'QUESTION_ASSET_DELIVERY_INPUT_INVALID') return businessInputInvalid(response);
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
  app.get('/api/miniapp/cloud-context', async (request, response) => {
    try {
      const identity = await miniappBusinessContext(request);
      response.json({ ok: true, identity, capabilities: miniappCapabilities(identity) });
    } catch (_) {
      response.status(403).json({ ok: false, code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
    }
  });
  app.get('/api/miniapp/role-applications/me', async (request, response) => {
    if (!miniappRoleApplications) return businessUnavailable(response);
    const token = sessionToken(request);
    if (!token) return response.status(403).json({ ok: false, code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
    try {
      const result = await miniappRoleApplications.mine({ token });
      response.json({ ok: true, ...result });
    } catch (error) {
      response.status(403).json({ ok: false, code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
    }
  });
  app.post('/api/miniapp/role-applications', async (request, response) => {
    if (!miniappRoleApplications) return businessUnavailable(response);
    const token = sessionToken(request);
    const idempotencyKey = String(request.get('x-idempotency-key') || '').trim();
    const body = exactBody(request.body, ['requestedIdentity', 'profileMode', 'bindingHint']);
    if (!token || !idempotencyKey || !body) return businessInputInvalid(response);
    try {
      const result = await miniappRoleApplications.submit({ token, idempotencyKey, ...body });
      response.status(201).json({ ok: true, ...result });
    } catch (error) {
      if (error && error.code === 'CLOUD_ROLE_APPLICATION_INVALID') return businessInputInvalid(response);
      response.status(403).json({ ok: false, code: 'CLOUD_MINIAPP_IDENTITY_REJECTED' });
    }
  });
  app.get('/api/desktop/role-applications/pending', async (request, response) => {
    if (!miniappRoleApplications || !desktopRegistration) return businessUnavailable(response);
    try {
      const result = await miniappRoleApplications.listSubmittedForDesktop({ actor: await desktopQuestionContext(request) });
      response.json({ ok: true, ...result });
    } catch (_) {
      response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
    }
  });
  app.post('/api/desktop/role-applications/:applicationId/review', async (request, response) => {
    if (!miniappRoleApplications || !desktopRegistration) return businessUnavailable(response);
    const applicationId = String(request.params.applicationId || '').trim();
    const body = exactBody(request.body, ['decision', 'profileId']);
    if (!applicationId || !body) return businessInputInvalid(response);
    try {
      const result = await miniappRoleApplications.reviewForDesktop({
        actor: await desktopQuestionContext(request), applicationId, ...body,
      });
      response.json({ ok: true, ...result });
    } catch (error) {
      if (error && error.code === 'CLOUD_ROLE_APPLICATION_INVALID') return businessInputInvalid(response);
      response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
    }
  });
  app.get('/api/business/miniapp-projection', async (request, response) => {
    if ((!desktopRegistration && !miniappCloudAccount) || !businessTenantId) return businessUnavailable(response);
    try {
      const scope = miniappProjectionScope(await miniappBusinessContext(request));
      const result = await query(miniappProjectionSql, [businessTenantId, scope.role, scope.profileId, scope.accountId]);
      const projection = result?.rows?.[0]?.projection;
      if (!isMiniappProjection(projection)) return businessUnavailable(response);
      response.json({ ok: true, projection });
    } catch (error) {
      if (error && error.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      businessUnavailable(response);
    }
  });
  app.get('/api/business/miniapp-question-previews', async (request, response) => {
    if (!questionAuthority || businessTenantId === null) return businessUnavailable(response);
    try {
      const actor = await miniappBusinessContext(request);
      const limitedQuestionBrowse = actor.status === 'visitor'
        || (Array.isArray(actor.roles) && actor.roles.includes('student'));
      if (limitedQuestionBrowse) {
        const questionLimit = actor.status === 'visitor' ? 20 : 200;
        const result = await query(
          `SELECT q.id,q.subject,q.question_type AS type,q.difficulty,q.source,q.status,c.stem,c.answer,c.explanation,c.options_json AS options,c.rich_content_json AS "richContent",
                  COALESCE((
                    SELECT jsonb_agg(DISTINCT n.name ORDER BY n.name)
                    FROM business.question_taxonomy_nodes n
                    JOIN jsonb_each(CASE WHEN jsonb_typeof(q.taxonomy_json->'taxonomyIds')='object' THEN q.taxonomy_json->'taxonomyIds' ELSE '{}'::jsonb END) systems(system_id,node_ids) ON true
                    JOIN jsonb_array_elements_text(CASE WHEN jsonb_typeof(systems.node_ids)='array' THEN systems.node_ids ELSE '[]'::jsonb END) selected(node_id) ON true
                    WHERE n.tenant_id=q.tenant_id AND n.deleted=false AND n.system_id=systems.system_id AND n.id=selected.node_id
                  ), '[]'::jsonb) AS "knowledgeLabels"
             FROM business.questions q
             JOIN business.question_contents c ON c.question_id=q.id AND c.tenant_id=q.tenant_id
            WHERE q.tenant_id=$1 AND q.status='published' AND q.deleted=false AND c.deleted=false
            ORDER BY c.updated_at DESC,q.id ASC LIMIT $2`,
          [businessTenantId, questionLimit],
        );
        if (!result || !Array.isArray(result.rows)) return businessUnavailable(response);
        return response.json({ ok: true, questions: result.rows.map(question => ({
          id: question.id, subject: question.subject, type: question.type, stemPreview: String(question.stem || ''),
          answer: question.answer === null || question.answer === undefined ? '' : String(question.answer),
          explanation: question.explanation === null || question.explanation === undefined ? '' : String(question.explanation),
          options: Array.isArray(question.options) ? question.options : [],
          richContent: question.richContent && typeof question.richContent === 'object' ? question.richContent : null,
          difficulty: Number.isSafeInteger(Number(question.difficulty)) ? Number(question.difficulty) : 3,
          source: typeof question.source === 'string' ? question.source : '',
          knowledgeLabels: Array.isArray(question.knowledgeLabels) ? question.knowledgeLabels.filter(label => typeof label === 'string' && label.trim()) : [],
          status: question.status,
        })) });
      }
      const questions = await questionAuthority.list({ tenantId: businessTenantId, actor, limit: 200 });
      response.json({ ok: true, questions: questions.map(question => ({
        id: question.id, subject: question.subject, type: question.type, stemPreview: question.content.slice(0, 240),
        answer: question.answer === null || question.answer === undefined ? '' : String(question.answer),
        explanation: question.analysis === null || question.analysis === undefined ? '' : String(question.analysis),
        options: Array.isArray(question.options) ? question.options : [],
        richContent: question.rich_content && typeof question.rich_content === 'object' ? question.rich_content : null,
        difficulty: Number.isSafeInteger(Number(question.difficulty)) ? Number(question.difficulty) : 3,
        source: typeof question.source === 'string' ? question.source : '',
        knowledgeLabels: Array.isArray(question.knowledgeLabels) ? question.knowledgeLabels.filter(label => typeof label === 'string' && label.trim()) : [],
        status: question.status,
      })) });
    } catch (error) {
      if (error && (error.code === 'CLOUD_BUSINESS_ACCESS_DENIED' || error.code === 'CLOUD_QUESTION_ACCESS_DENIED')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      businessUnavailable(response);
    }
  });
  app.post('/api/business/miniapp-question-assets/:assetKey/delivery', async (request, response) => {
    if (!questionAssetDeliveries || businessTenantId === null || !exactBody(request.body, [])) return businessUnavailable(response);
    try {
      const actor = await miniappBusinessContext(request);
      const delivery = await questionAssetDeliveries.request({ tenantId: businessTenantId, accountId: actor.accountId, assetKey: String(request.params.assetKey || '') });
      response.status(delivery.status === 'ready' ? 200 : 202).json({ ok: true, delivery });
    } catch (error) {
      if (error && ['CLOUD_BUSINESS_ACCESS_DENIED', 'QUESTION_ASSET_DELIVERY_NOT_FOUND'].includes(error.code)) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      if (error && error.code === 'QUESTION_ASSET_DELIVERY_INPUT_INVALID') return businessInputInvalid(response);
      businessUnavailable(response);
    }
  });
  app.get('/api/business/miniapp-question-asset-deliveries/:deliveryId', async (request, response) => {
    if (!questionAssetDeliveries || businessTenantId === null) return businessUnavailable(response);
    try {
      const actor = await miniappBusinessContext(request);
      const delivery = await questionAssetDeliveries.status({ tenantId: businessTenantId, accountId: actor.accountId, deliveryId: String(request.params.deliveryId || '') });
      response.json({ ok: true, delivery });
    } catch (error) {
      if (error && ['CLOUD_BUSINESS_ACCESS_DENIED', 'QUESTION_ASSET_DELIVERY_NOT_FOUND'].includes(error.code)) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      if (error && error.code === 'QUESTION_ASSET_DELIVERY_INPUT_INVALID') return businessInputInvalid(response);
      businessUnavailable(response);
    }
  });
  app.get('/api/business/miniapp-question-asset-deliveries/:deliveryId/download', async (request, response) => {
    if (!questionAssetDeliveries || businessTenantId === null) return businessUnavailable(response);
    try {
      const actor = await miniappBusinessContext(request);
      const asset = await questionAssetDeliveries.download({ tenantId: businessTenantId, accountId: actor.accountId, deliveryId: String(request.params.deliveryId || '') });
      response.set('Cache-Control', 'no-store');
      response.set('Content-Type', asset.mimeType);
      response.set('Content-Length', String(asset.bytes.length));
      response.send(asset.bytes);
    } catch (error) {
      if (error && ['CLOUD_BUSINESS_ACCESS_DENIED', 'QUESTION_ASSET_DELIVERY_NOT_READY'].includes(error.code)) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      if (error && error.code === 'QUESTION_ASSET_DELIVERY_INPUT_INVALID') return businessInputInvalid(response);
      businessUnavailable(response);
    }
  });
  app.post('/api/business/miniapp-personal-assets/import', async (request, response) => {
    if (!personalAssetImports || businessTenantId === null) return businessUnavailable(response);
    const body = exactBody(request.body, ['records']);
    const idempotencyKey = String(request.get('x-idempotency-key') || '');
    if (!body || !Array.isArray(body.records) || !idempotencyKey || idempotencyKey.length > 256) return businessInputInvalid(response);
    try {
      const receipt = await personalAssetImports.import({ tenantId: businessTenantId, actor: await miniappBusinessContext(request), idempotencyKey, records: body.records });
      response.status(receipt.replayed ? 200 : 202).json({ ok: true, receipt });
    } catch (error) {
      if (error && error.code === 'CLOUD_PERSONAL_ASSET_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      if (error && ['CLOUD_PERSONAL_ASSET_INPUT_INVALID', 'CLOUD_PERSONAL_ASSET_IDEMPOTENCY_CONFLICT'].includes(error.code)) return businessInputInvalid(response);
      businessUnavailable(response);
    }
  });
  app.post('/api/business/miniapp-paper-export-tasks', async (request, response) => {
    if (!paperExportTasks || businessTenantId === null) return businessUnavailable(response);
    const body = exactBody(request.body, ['taskType', 'request']);
    const idempotencyKey = String(request.get('x-idempotency-key') || '');
    if (!body || !['paper-export-word', 'paper-export-pdf'].includes(body.taskType) || !idempotencyKey || idempotencyKey.length > 256) return businessInputInvalid(response);
    try {
      const actor = await miniappBusinessContext(request);
      if (!Array.isArray(actor.roles) || !actor.roles.some(role => ['super_admin', 'teacher'].includes(role))) throw businessAccessDenied();
      const task = await paperExportTasks.create({
        tenantId: businessTenantId, actor, idempotencyKey, taskType: body.taskType, request: body.request,
      });
      response.status(task.replayed ? 200 : 202).json({ ok: true, task });
    } catch (error) {
      if (error && ['CLOUD_PAPER_EXPORT_ACCESS_DENIED', 'CLOUD_BUSINESS_ACCESS_DENIED'].includes(error.code)) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      if (error && ['CLOUD_PAPER_EXPORT_INPUT_INVALID', 'CLOUD_PAPER_EXPORT_SELECTION_INVALID', 'CLOUD_PAPER_EXPORT_CONFLICT'].includes(error.code)) return businessInputInvalid(response);
      businessUnavailable(response);
    }
  });
  app.get('/api/business/miniapp-paper-export-tasks/:taskId', async (request, response) => {
    if (!paperExportTasks || businessTenantId === null) return businessUnavailable(response);
    try {
      const task = await paperExportTasks.read({ tenantId: businessTenantId, actor: await miniappBusinessContext(request), taskId: request.params.taskId });
      response.json({ ok: true, task });
    } catch (error) {
      if (error && error.code === 'CLOUD_PAPER_EXPORT_ACCESS_DENIED') return response.status(403).json({ ok: false, code: error.code });
      if (error && error.code === 'CLOUD_PAPER_EXPORT_NOT_FOUND') return response.status(404).json({ ok: false, code: error.code });
      businessUnavailable(response);
    }
  });
  app.post('/api/business/miniapp-paper-export-tasks/:taskId/cancel', async (request, response) => {
    if (!paperExportTasks || businessTenantId === null || !exactBody(request.body, [])) return businessUnavailable(response);
    try {
      const task = await paperExportTasks.cancel({ tenantId: businessTenantId, actor: await miniappBusinessContext(request), taskId: request.params.taskId });
      response.json({ ok: true, task });
    } catch (error) {
      if (error && error.code === 'CLOUD_PAPER_EXPORT_ACCESS_DENIED') return response.status(403).json({ ok: false, code: error.code });
      if (error && error.code === 'CLOUD_PAPER_EXPORT_NOT_CANCELLABLE') return response.status(409).json({ ok: false, code: error.code });
      businessUnavailable(response);
    }
  });
  app.post('/api/business/miniapp-paper-export-tasks/:taskId/delivery', async (request, response) => {
    if (!miniappArtifactDeliveries || businessTenantId === null || !exactBody(request.body, [])) return businessUnavailable(response);
    try {
      const actor = await miniappBusinessContext(request);
      const delivery = await miniappArtifactDeliveries.request({ tenantId: businessTenantId, accountId: actor.accountId, taskId: request.params.taskId });
      response.status(delivery.status === 'ready' ? 200 : 202).json({ ok: true, delivery });
    } catch (error) {
      if (error && ['CLOUD_BUSINESS_ACCESS_DENIED', 'MINIAPP_ARTIFACT_DELIVERY_NOT_FOUND'].includes(error.code)) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      if (error && error.code === 'MINIAPP_ARTIFACT_DELIVERY_INPUT_INVALID') return businessInputInvalid(response);
      businessUnavailable(response);
    }
  });
  app.get('/api/business/miniapp-artifact-deliveries/:deliveryId', async (request, response) => {
    if (!miniappArtifactDeliveries || businessTenantId === null) return businessUnavailable(response);
    try {
      const actor = await miniappBusinessContext(request);
      const delivery = await miniappArtifactDeliveries.status({ tenantId: businessTenantId, accountId: actor.accountId, deliveryId: request.params.deliveryId });
      response.json({ ok: true, delivery });
    } catch (error) {
      if (error && ['CLOUD_BUSINESS_ACCESS_DENIED', 'MINIAPP_ARTIFACT_DELIVERY_NOT_FOUND'].includes(error.code)) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      if (error && error.code === 'MINIAPP_ARTIFACT_DELIVERY_INPUT_INVALID') return businessInputInvalid(response);
      businessUnavailable(response);
    }
  });
  app.get('/api/business/miniapp-artifact-deliveries/:deliveryId/download', async (request, response) => {
    if (!miniappArtifactDeliveries || businessTenantId === null) return businessUnavailable(response);
    try {
      const actor = await miniappBusinessContext(request);
      const artifact = await miniappArtifactDeliveries.download({ tenantId: businessTenantId, accountId: actor.accountId, deliveryId: request.params.deliveryId });
      const filename = artifact.fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 512) || 'paper-export';
      response.set('Cache-Control', 'no-store');
      response.set('Content-Type', artifact.mimeType);
      response.set('Content-Disposition', `attachment; filename="${filename}"`);
      response.set('Content-Length', String(artifact.bytes.length));
      response.send(artifact.bytes);
    } catch (error) {
      if (error && ['CLOUD_BUSINESS_ACCESS_DENIED', 'MINIAPP_ARTIFACT_DELIVERY_NOT_READY'].includes(error.code)) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      if (error && error.code === 'MINIAPP_ARTIFACT_DELIVERY_INPUT_INVALID') return businessInputInvalid(response);
      businessUnavailable(response);
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
         WHERE s.tenant_id=$1 AND s.legacy_deleted=false AND c.legacy_deleted=false
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
      const result = await query(desktopProjectionSql, [businessTenantId, context.accountId]);
      const projection = result?.rows?.[0]?.projection;
      if (!isDesktopProjection(projection)) return businessUnavailable(response);
      response.json({ ok: true, projection });
    } catch (error) {
      if (error && error.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      businessUnavailable(response);
    }
  });
  const supplementalRoutes = [
    { resource: 'payments', service: 'payments', kind: 'payment', idKey: 'paymentId', responseKey: 'payment', allowUpdate: true, accountScoped: false },
    { resource: 'consumptions', service: 'consumptions', kind: 'consumption', idKey: 'consumptionId', responseKey: 'consumption', allowUpdate: true, accountScoped: false },
    { resource: 'grades', service: 'grades', kind: 'grade', idKey: 'gradeId', responseKey: 'grade', allowUpdate: false, accountScoped: false },
    { resource: 'personal-asset-categories', service: 'assetCategories', kind: 'assetCategory', idKey: 'categoryId', responseKey: 'category', allowUpdate: false, accountScoped: true },
    { resource: 'personal-asset-records', service: 'assetRecords', kind: 'assetRecord', idKey: 'recordId', responseKey: 'record', allowUpdate: true, accountScoped: true },
  ];
  for (const config of supplementalRoutes) {
    const conflictCode = `CLOUD_BUSINESS_${config.kind.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_CONFLICT`;
    const relationCode = `CLOUD_BUSINESS_${config.kind.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_RELATION_INVALID`;
    app.post(`/api/business/${config.resource}`, async (request, response) => {
      if (!businessTenantId || !businessSupplementalLifecycleMutations) return businessUnavailable(response);
      const id = boundedText(request.body?.[config.idKey], 128);
      const data = supplementalRecord(config.kind, request.body?.data, false);
      if (!id || !data || !exactBody(request.body, [config.idKey, 'data'])) return businessInputInvalid(response);
      try {
        const context = await desktopBusinessContext(request);
        if (!context?.roles?.includes('super_admin')) throw businessAccessDenied();
        const record = await businessSupplementalLifecycleMutations[config.service].create({ tenantId: businessTenantId, ...(config.accountScoped ? { accountId: context.accountId } : {}), [config.idKey]: id, ...data });
        if (!record) return response.status(400).json({ ok: false, code: relationCode });
        response.status(201).json({ ok: true, [config.responseKey]: record });
      } catch (error) {
        if (error?.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
        if (error?.code === '23505') return response.status(409).json({ ok: false, code: conflictCode });
        if (['23503', '23514', '22003', '22007'].includes(error?.code)) return response.status(400).json({ ok: false, code: relationCode });
        businessUnavailable(response);
      }
    });
    if (config.allowUpdate) app.put(`/api/business/${config.resource}/:${config.idKey}`, async (request, response) => {
      if (!businessTenantId || !businessSupplementalLifecycleMutations) return businessUnavailable(response);
      const id = boundedText(request.params[config.idKey], 128);
      const data = supplementalRecord(config.kind, request.body, true);
      if (!id || !data) return businessInputInvalid(response);
      try {
        const context = await desktopBusinessContext(request);
        if (!context?.roles?.includes('super_admin')) throw businessAccessDenied();
        const record = await businessSupplementalLifecycleMutations[config.service].update({ tenantId: businessTenantId, ...(config.accountScoped ? { accountId: context.accountId } : {}), [config.idKey]: id, ...data });
        if (!record) return response.status(409).json({ ok: false, code: conflictCode });
        response.json({ ok: true, [config.responseKey]: record });
      } catch (error) {
        if (error?.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
        if (['23503', '23514', '22003', '22007'].includes(error?.code)) return response.status(400).json({ ok: false, code: relationCode });
        businessUnavailable(response);
      }
    });
    app.delete(`/api/business/${config.resource}/:${config.idKey}`, async (request, response) => {
      if (!businessTenantId || !businessSupplementalLifecycleMutations) return businessUnavailable(response);
      const id = boundedText(request.params[config.idKey], 128); const expectedUpdatedAt = instant(request.body?.expectedUpdatedAt);
      if (!id || !expectedUpdatedAt || !exactBody(request.body, ['expectedUpdatedAt'])) return businessInputInvalid(response);
      try {
        const context = await desktopBusinessContext(request);
        if (!context?.roles?.includes('super_admin')) throw businessAccessDenied();
        const record = await businessSupplementalLifecycleMutations[config.service].remove({ tenantId: businessTenantId, ...(config.accountScoped ? { accountId: context.accountId } : {}), [config.idKey]: id, expectedUpdatedAt });
        if (!record) return response.status(409).json({ ok: false, code: conflictCode });
        response.json({ ok: true, [config.responseKey]: record });
      } catch (error) {
        if (error?.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
        businessUnavailable(response);
      }
    });
  }
  app.post('/api/business/schedules', async (request, response) => {
    if (!businessTenantId || !businessScheduleLifecycleMutations) return businessUnavailable(response);
    const scheduleId = String(request.body?.scheduleId || '').trim();
    const data = scheduleRecord(request.body?.data);
    if (!scheduleId || !data || !exactBody(request.body, ['scheduleId', 'data'])) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      const schedule = await businessScheduleLifecycleMutations.create({ tenantId: businessTenantId, scheduleId, ...data });
      if (!schedule) return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_SCHEDULE_CONFLICT' });
      response.status(201).json({ ok: true, schedule });
    } catch (error) {
      if (error?.code === '23503' || error?.code === '22023') return response.status(400).json({ ok: false, code: 'CLOUD_BUSINESS_SCHEDULE_RELATION_INVALID' });
      if (error?.code === '23505') return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_SCHEDULE_CONFLICT' });
      if (error?.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      businessUnavailable(response);
    }
  });
  app.put('/api/business/schedules/:scheduleId', async (request, response) => {
    if (!businessTenantId || !businessScheduleUpdate) return businessUnavailable(response);
    const scheduleId = String(request.params.scheduleId || '').trim();
    const hasPricings = Boolean(request.body && Object.prototype.hasOwnProperty.call(request.body, 'pricings'));
    const update = exactBody(request.body, hasPricings
      ? ['expectedUpdatedAt', 'startAt', 'endAt', 'status', 'roomDisplay', 'tuition', 'teacherFee', 'notes', 'pricings']
      : ['expectedUpdatedAt', 'startAt', 'endAt', 'status', 'roomDisplay', 'tuition', 'teacherFee', 'notes']);
    if (!scheduleId || !update) return businessInputInvalid(response);
    const expectedUpdatedAt = instant(update.expectedUpdatedAt);
    const startAt = instant(update.startAt);
    const endAt = instant(update.endAt);
    const roomDisplay = optionalText(update.roomDisplay);
    const notes = optionalText(update.notes);
    const tuition = nonNegativeNumber(update.tuition);
    const teacherFee = nonNegativeNumber(update.teacherFee);
    const pricings = hasPricings ? schedulePricings(update.pricings) : null;
    if (!expectedUpdatedAt || !startAt || !endAt || new Date(endAt).getTime() <= new Date(startAt).getTime()
      || !Number.isInteger(update.status) || ![1, 2, 3, 4].includes(update.status)
      || roomDisplay === undefined || notes === undefined || tuition === null || teacherFee === null
      || (hasPricings && pricings === null)) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
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
        pricings,
      });
      if (!result || typeof result !== 'object' || !result.id || !result.updatedAt) {
        return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_SCHEDULE_CONFLICT' });
      }
      response.json({ ok: true, schedule: result });
    } catch (error) {
      if (error && (error.code === '23503' || error.code === '22023')) {
        return response.status(400).json({ ok: false, code: 'CLOUD_BUSINESS_SCHEDULE_RELATION_INVALID' });
      }
      if (error && error.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      businessUnavailable(response);
    }
  });
  app.delete('/api/business/schedules/:scheduleId', async (request, response) => {
    if (!businessTenantId || !businessScheduleLifecycleMutations) return businessUnavailable(response);
    const scheduleId = String(request.params.scheduleId || '').trim(); const expectedUpdatedAt = instant(request.body?.expectedUpdatedAt);
    if (!scheduleId || !expectedUpdatedAt || !exactBody(request.body, ['expectedUpdatedAt'])) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      const schedule = await businessScheduleLifecycleMutations.remove({ tenantId: businessTenantId, scheduleId, expectedUpdatedAt });
      if (!schedule) return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_SCHEDULE_CONFLICT' });
      response.json({ ok: true, schedule });
    } catch (error) {
      if (error?.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      businessUnavailable(response);
    }
  });
  app.put('/api/business/schedules/:scheduleId/students/:studentId', async (request, response) => {
    if (!businessTenantId || !businessScheduleStudentOverride) return businessUnavailable(response);
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
      const context = await desktopBusinessContext(request);
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
  app.put('/api/business/students/:studentId', async (request, response) => {
    if (!businessTenantId || !businessStudentUpdate) return businessUnavailable(response);
    const studentId = String(request.params.studentId || '').trim();
    const update = exactBody(request.body, ['expectedUpdatedAt', 'name', 'school', 'gradeYear', 'gradeCurrent', 'institutionId', 'parentName', 'notes', 'sourceType', 'studentSource']);
    if (!studentId || !update) return businessInputInvalid(response);
    const expectedUpdatedAt = instant(update.expectedUpdatedAt);
    const name = boundedText(update.name, 256);
    const school = boundedText(update.school, 256);
    const gradeCurrent = boundedText(update.gradeCurrent, 128);
    const institutionId = boundedText(update.institutionId, 256);
    const parentName = boundedText(update.parentName, 256);
    const notes = optionalText(update.notes);
    const studentSource = boundedText(update.studentSource, 512);
    const gradeYear = update.gradeYear;
    const sourceType = update.sourceType;
    if (!expectedUpdatedAt || !name || school === undefined || gradeCurrent === undefined || institutionId === undefined
      || parentName === undefined || notes === undefined || studentSource === undefined
      || !(gradeYear === null || (Number.isInteger(gradeYear) && gradeYear >= 1900 && gradeYear <= 2200))
      || !(sourceType === null || (Number.isInteger(sourceType) && [1, 2].includes(sourceType)))) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context || !Array.isArray(context.roles) || !context.roles.includes('super_admin')) {
        return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      }
      const result = await businessStudentUpdate({
        tenantId: businessTenantId,
        studentId,
        expectedUpdatedAt,
        name,
        school,
        gradeYear,
        gradeCurrent,
        institutionId,
        parentName,
        notes,
        sourceType,
        studentSource,
      });
      if (!result || typeof result !== 'object' || !result.id || !result.updatedAt) {
        return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_STUDENT_CONFLICT' });
      }
      response.json({ ok: true, student: result });
    } catch (error) {
      if (error && error.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      businessUnavailable(response);
    }
  });
  app.post('/api/business/courses', async (request, response) => {
    if (!businessTenantId || !businessCourseLifecycleMutations) return businessUnavailable(response);
    const courseId = String(request.body?.courseId || '').trim();
    const update = courseRecord(request.body?.data, false);
    if (!courseId || !update || !exactBody(request.body, ['courseId', 'data'])) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      const course = await businessCourseLifecycleMutations.create({ tenantId: businessTenantId, courseId, ...update });
      if (!course) return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_COURSE_CONFLICT' });
      response.status(201).json({ ok: true, course });
    } catch (error) {
      if (error?.code === '23503' || error?.code === '22023') return response.status(400).json({ ok: false, code: 'CLOUD_BUSINESS_COURSE_RELATION_INVALID' });
      businessUnavailable(response);
    }
  });
  app.put('/api/business/courses/:courseId', async (request, response) => {
    if (!businessTenantId || !businessCourseLifecycleMutations) return businessUnavailable(response);
    const courseId = String(request.params.courseId || '').trim(); const update = courseRecord(request.body, true);
    if (!courseId || !update) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      const course = await businessCourseLifecycleMutations.update({ tenantId: businessTenantId, courseId, ...update });
      if (!course) return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_COURSE_CONFLICT' });
      response.json({ ok: true, course });
    } catch (error) {
      if (error?.code === '23503' || error?.code === '22023') return response.status(400).json({ ok: false, code: 'CLOUD_BUSINESS_COURSE_RELATION_INVALID' });
      businessUnavailable(response);
    }
  });
  app.delete('/api/business/courses/:courseId', async (request, response) => {
    if (!businessTenantId || !businessCourseLifecycleMutations) return businessUnavailable(response);
    const courseId = String(request.params.courseId || '').trim(); const expectedUpdatedAt = instant(request.body?.expectedUpdatedAt);
    if (!courseId || !expectedUpdatedAt || !exactBody(request.body, ['expectedUpdatedAt'])) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      const course = await businessCourseLifecycleMutations.remove({ tenantId: businessTenantId, courseId, expectedUpdatedAt });
      if (!course) return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_COURSE_CONFLICT' });
      response.json({ ok: true, course });
    } catch (error) {
      if (error?.code === 'P0001' || error?.message === 'VNEXT_BUSINESS_COURSE_REFERENCED') return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_COURSE_REFERENCED' });
      businessUnavailable(response);
    }
  });

  const foundationRoutes = [
    ['institutions', 'institutionId', institutionRecord, 'institutions', 'INSTITUTION'],
    ['schools', 'schoolId', schoolRecord, 'schools', 'SCHOOL'],
  ];
  for (const [pathName, idName, parser, serviceName, codeName] of foundationRoutes) {
    app.post(`/api/business/${pathName}`, async (request, response) => {
      if (!businessTenantId || !businessFoundationLifecycleMutations) return businessUnavailable(response);
      const recordId = String(request.body?.[idName] || '').trim(); const data = parser(request.body?.data, false);
      if (!recordId || !data || !exactBody(request.body, [idName, 'data'])) return businessInputInvalid(response);
      try {
        const context = await desktopBusinessContext(request); if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
        const record = await businessFoundationLifecycleMutations[serviceName].create({ tenantId: businessTenantId, [idName]: recordId, ...data });
        if (!record) return response.status(409).json({ ok: false, code: `CLOUD_BUSINESS_${codeName}_CONFLICT` });
        response.status(201).json({ ok: true, [pathName.slice(0, -1)]: record });
      } catch (error) {
        if (error?.code === '23505') return response.status(409).json({ ok: false, code: `CLOUD_BUSINESS_${codeName}_NAME_EXISTS` });
        if (error?.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
        businessUnavailable(response);
      }
    });
    app.put(`/api/business/${pathName}/:${idName}`, async (request, response) => {
      if (!businessTenantId || !businessFoundationLifecycleMutations) return businessUnavailable(response);
      const recordId = String(request.params[idName] || '').trim(); const data = parser(request.body, true);
      if (!recordId || !data) return businessInputInvalid(response);
      try {
        const context = await desktopBusinessContext(request); if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
        const record = await businessFoundationLifecycleMutations[serviceName].update({ tenantId: businessTenantId, [idName]: recordId, ...data });
        if (!record) return response.status(409).json({ ok: false, code: `CLOUD_BUSINESS_${codeName}_CONFLICT` });
        response.json({ ok: true, [pathName.slice(0, -1)]: record });
      } catch (error) {
        if (error?.code === '23505') return response.status(409).json({ ok: false, code: `CLOUD_BUSINESS_${codeName}_NAME_EXISTS` });
        if (error?.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
        businessUnavailable(response);
      }
    });
    app.delete(`/api/business/${pathName}/:${idName}`, async (request, response) => {
      if (!businessTenantId || !businessFoundationLifecycleMutations) return businessUnavailable(response);
      const recordId = String(request.params[idName] || '').trim(); const expectedUpdatedAt = instant(request.body?.expectedUpdatedAt);
      if (!recordId || !expectedUpdatedAt || !exactBody(request.body, ['expectedUpdatedAt'])) return businessInputInvalid(response);
      try {
        const context = await desktopBusinessContext(request); if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
        const record = await businessFoundationLifecycleMutations[serviceName].remove({ tenantId: businessTenantId, [idName]: recordId, expectedUpdatedAt });
        if (!record) return response.status(409).json({ ok: false, code: `CLOUD_BUSINESS_${codeName}_CONFLICT` });
        response.json({ ok: true, [pathName.slice(0, -1)]: record });
      } catch (error) {
        if (error?.code === 'P0001') return response.status(409).json({ ok: false, code: `CLOUD_BUSINESS_${codeName}_REFERENCED` });
        if (error?.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
        businessUnavailable(response);
      }
    });
  }

  app.post('/api/business/rooms', async (request, response) => {
    if (!businessTenantId || !businessRoomLifecycleMutations) return businessUnavailable(response);
    const update = exactBody(request.body, ['roomId', 'name', 'address']);
    const roomId = String(update?.roomId || '').trim(); const name = boundedText(update?.name, 256); const address = optionalText(update?.address);
    if (!roomId || !name || address === undefined) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      const room = await businessRoomLifecycleMutations.create({ tenantId: businessTenantId, roomId, name, address });
      if (!room) return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_ROOM_CONFLICT' });
      response.status(201).json({ ok: true, room });
    } catch (error) {
      if (error?.code === '23505' || error?.message === 'VNEXT_BUSINESS_ROOM_NAME_EXISTS') return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_ROOM_NAME_EXISTS' });
      businessUnavailable(response);
    }
  });
  app.put('/api/business/rooms/:roomId', async (request, response) => {
    if (!businessTenantId || !businessRoomLifecycleMutations) return businessUnavailable(response);
    const roomId = String(request.params.roomId || '').trim(); const update = exactBody(request.body, ['expectedUpdatedAt', 'name', 'address']);
    const expectedUpdatedAt = instant(update?.expectedUpdatedAt); const name = boundedText(update?.name, 256); const address = optionalText(update?.address);
    if (!roomId || !expectedUpdatedAt || !name || address === undefined) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      const room = await businessRoomLifecycleMutations.update({ tenantId: businessTenantId, roomId, expectedUpdatedAt, name, address });
      if (!room) return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_ROOM_CONFLICT' });
      response.json({ ok: true, room });
    } catch (error) {
      if (error?.code === '23505' || error?.message === 'VNEXT_BUSINESS_ROOM_NAME_EXISTS') return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_ROOM_NAME_EXISTS' });
      businessUnavailable(response);
    }
  });
  app.delete('/api/business/rooms/:roomId', async (request, response) => {
    if (!businessTenantId || !businessRoomLifecycleMutations) return businessUnavailable(response);
    const roomId = String(request.params.roomId || '').trim(); const expectedUpdatedAt = instant(request.body?.expectedUpdatedAt);
    if (!roomId || !expectedUpdatedAt || !exactBody(request.body, ['expectedUpdatedAt'])) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      const room = await businessRoomLifecycleMutations.remove({ tenantId: businessTenantId, roomId, expectedUpdatedAt });
      if (!room) return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_ROOM_CONFLICT' });
      response.json({ ok: true, room });
    } catch (error) {
      if (error?.code === 'P0001' || error?.message === 'VNEXT_BUSINESS_ROOM_REFERENCED') return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_ROOM_REFERENCED' });
      businessUnavailable(response);
    }
  });

  app.post('/api/business/teachers', async (request, response) => {
    if (!businessTenantId || !businessTeacherLifecycleMutations) return businessUnavailable(response);
    const update = exactBody(request.body, ['teacherId', 'name', 'phone', 'subject', 'hourlyRate', 'notes']);
    const teacherId = String(update?.teacherId || '').trim(); const name = boundedText(update?.name, 256);
    const phone = boundedText(update?.phone, 64); const subject = boundedText(update?.subject, 128); const notes = optionalText(update?.notes);
    if (!teacherId || !name || phone === undefined || subject === undefined || notes === undefined
      || !(update?.hourlyRate === null || (typeof update?.hourlyRate === 'number' && Number.isFinite(update.hourlyRate) && update.hourlyRate >= 0 && update.hourlyRate <= 100000))) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      const teacher = await businessTeacherLifecycleMutations.create({ tenantId: businessTenantId, teacherId, name, phone, subject, hourlyRate: update.hourlyRate, notes });
      if (!teacher) return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_TEACHER_CONFLICT' });
      response.status(201).json({ ok: true, teacher });
    } catch (_) { businessUnavailable(response); }
  });
  app.put('/api/business/teachers/:teacherId', async (request, response) => {
    if (!businessTenantId || !businessTeacherLifecycleMutations) return businessUnavailable(response);
    const teacherId = String(request.params.teacherId || '').trim();
    const update = exactBody(request.body, ['expectedUpdatedAt', 'name', 'phone', 'subject', 'hourlyRate', 'notes']);
    const expectedUpdatedAt = instant(update?.expectedUpdatedAt); const name = boundedText(update?.name, 256);
    const phone = boundedText(update?.phone, 64); const subject = boundedText(update?.subject, 128); const notes = optionalText(update?.notes);
    if (!teacherId || !expectedUpdatedAt || !name || phone === undefined || subject === undefined || notes === undefined
      || !(update?.hourlyRate === null || (typeof update?.hourlyRate === 'number' && Number.isFinite(update.hourlyRate) && update.hourlyRate >= 0 && update.hourlyRate <= 100000))) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      const teacher = await businessTeacherLifecycleMutations.update({ tenantId: businessTenantId, teacherId, expectedUpdatedAt, name, phone, subject, hourlyRate: update.hourlyRate, notes });
      if (!teacher) return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_TEACHER_CONFLICT' });
      response.json({ ok: true, teacher });
    } catch (_) { businessUnavailable(response); }
  });
  app.delete('/api/business/teachers/:teacherId', async (request, response) => {
    if (!businessTenantId || !businessTeacherLifecycleMutations) return businessUnavailable(response);
    const teacherId = String(request.params.teacherId || '').trim(); const expectedUpdatedAt = instant(request.body?.expectedUpdatedAt);
    if (!teacherId || !expectedUpdatedAt || !exactBody(request.body, ['expectedUpdatedAt'])) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      const teacher = await businessTeacherLifecycleMutations.remove({ tenantId: businessTenantId, teacherId, expectedUpdatedAt });
      if (!teacher) return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_TEACHER_CONFLICT' });
      response.json({ ok: true, teacher });
    } catch (error) {
      if (error?.code === 'P0001' || error?.message === 'VNEXT_BUSINESS_TEACHER_REFERENCED') return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_TEACHER_REFERENCED' });
      businessUnavailable(response);
    }
  });

  app.put('/api/business/students/:studentId/record', async (request, response) => {
    if (!businessTenantId || !businessStudentRecordUpdate) return businessUnavailable(response);
    const studentId = String(request.params.studentId || '').trim();
    const update = exactBody(request.body, ['expectedUpdatedAt', 'name', 'school', 'gradeYear', 'gradeCurrent', 'institutionId', 'parentName', 'notes', 'sourceType', 'studentSource', 'contacts']);
    if (!studentId || !update) return businessInputInvalid(response);
    const expectedUpdatedAt = instant(update.expectedUpdatedAt);
    const name = boundedText(update.name, 256);
    const school = boundedText(update.school, 256);
    const gradeCurrent = boundedText(update.gradeCurrent, 128);
    const institutionId = boundedText(update.institutionId, 256);
    const parentName = boundedText(update.parentName, 256);
    const notes = optionalText(update.notes);
    const studentSource = boundedText(update.studentSource, 512);
    const contacts = studentContacts(update.contacts, true);
    const gradeYear = update.gradeYear;
    const sourceType = update.sourceType;
    if (!expectedUpdatedAt || !name || school === undefined || gradeCurrent === undefined || institutionId === undefined
      || parentName === undefined || notes === undefined || studentSource === undefined || contacts === null
      || !(gradeYear === null || (Number.isInteger(gradeYear) && gradeYear >= 1900 && gradeYear <= 2200))
      || !(sourceType === null || (Number.isInteger(sourceType) && [1, 2].includes(sourceType)))) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context || !Array.isArray(context.roles) || !context.roles.includes('super_admin')) {
        return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      }
      const result = await businessStudentRecordUpdate({
        tenantId: businessTenantId, studentId, expectedUpdatedAt, name, school, gradeYear, gradeCurrent,
        institutionId, parentName, notes, sourceType, studentSource, contacts,
      });
      if (!result || typeof result !== 'object' || !result.id || !result.updatedAt) {
        return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_STUDENT_CONFLICT' });
      }
      response.json({ ok: true, student: result });
    } catch (error) {
      if (error && error.code === 'CLOUD_BUSINESS_ACCESS_DENIED') return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      businessUnavailable(response);
    }
  });
  app.post('/api/business/students', async (request, response) => {
    if (!businessTenantId || !businessStudentLifecycleMutations) return businessUnavailable(response);
    const update = exactBody(request.body, ['studentId', 'name', 'school', 'gradeYear', 'gradeCurrent', 'institutionId', 'parentName', 'notes', 'sourceType', 'studentSource', 'contacts']);
    const studentId = String(update?.studentId || '').trim();
    const name = boundedText(update?.name, 256); const school = boundedText(update?.school, 256); const gradeCurrent = boundedText(update?.gradeCurrent, 128);
    const institutionId = boundedText(update?.institutionId, 256); const parentName = boundedText(update?.parentName, 256); const notes = optionalText(update?.notes); const studentSource = boundedText(update?.studentSource, 512);
    const contacts = studentContacts(update?.contacts);
    if (!studentId || !name || school === undefined || gradeCurrent === undefined || institutionId === undefined || parentName === undefined || notes === undefined || studentSource === undefined || contacts === null
      || !(update.gradeYear === null || (Number.isInteger(update.gradeYear) && update.gradeYear >= 1900 && update.gradeYear <= 2200))
      || !(update.sourceType === null || (Number.isInteger(update.sourceType) && [1, 2].includes(update.sourceType)))) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      const student = await businessStudentLifecycleMutations.create({ tenantId: businessTenantId, studentId, name, school, gradeYear: update.gradeYear, gradeCurrent, institutionId, parentName, notes, sourceType: update.sourceType, studentSource, contacts });
      if (!student) return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_STUDENT_CONFLICT' });
      response.status(201).json({ ok: true, student });
    } catch (_) { businessUnavailable(response); }
  });
  app.delete('/api/business/students/:studentId', async (request, response) => {
    if (!businessTenantId || !businessStudentLifecycleMutations) return businessUnavailable(response);
    const studentId = String(request.params.studentId || '').trim(); const expectedUpdatedAt = instant(request.body?.expectedUpdatedAt);
    if (!studentId || !expectedUpdatedAt || !exactBody(request.body, ['expectedUpdatedAt'])) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context?.roles?.includes('super_admin')) return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      const student = await businessStudentLifecycleMutations.remove({ tenantId: businessTenantId, studentId, expectedUpdatedAt });
      if (!student) return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_STUDENT_CONFLICT' });
      response.json({ ok: true, student });
    } catch (error) {
      if (error?.code === 'P0001' || error?.message === 'VNEXT_BUSINESS_STUDENT_REFERENCED') return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_STUDENT_REFERENCED' });
      businessUnavailable(response);
    }
  });
  app.put('/api/business/students/:studentId/contacts/:contactSlot', async (request, response) => {
    if (!businessTenantId) return businessUnavailable(response);
    const studentId = String(request.params.studentId || '').trim();
    const contactSlot = Number(request.params.contactSlot);
    const update = exactBody(request.body, ['expectedUpdatedAt', 'relationship', 'phone', 'wechat']);
    const expectedUpdatedAt = update?.expectedUpdatedAt === null ? null : instant(update?.expectedUpdatedAt);
    const relationship = update?.relationship;
    const phone = update?.phone;
    const wechat = update?.wechat;
    const validPhone = phone === null || (typeof phone === 'string' && /^1[3-9][0-9]{9}$/u.test(phone));
    const validWechat = wechat === null || (typeof wechat === 'string' && wechat === wechat.trim() && wechat.length > 0 && wechat.length <= 128);
    if (!studentId || !Number.isInteger(contactSlot) || contactSlot < 1 || contactSlot > 3 || !update
      || expectedUpdatedAt === undefined || !['student', 'guardian'].includes(relationship)
      || (contactSlot === 1 && relationship !== 'student') || (contactSlot > 1 && relationship !== 'guardian')
      || !validPhone || !validWechat || (phone === null && wechat === null)) return businessInputInvalid(response);
    try {
      const context = await desktopBusinessContext(request);
      if (!context || !Array.isArray(context.roles) || !context.roles.includes('super_admin')) throw businessAccessDenied();
      const result = await query(
        `WITH target AS (
           SELECT id FROM business.students WHERE id=$1 AND tenant_id=$2 AND legacy_deleted=false
         ), written AS (
           INSERT INTO business.student_contact_directory (contact_id,student_id,contact_slot,relationship,phone_value,phone_hmac,wechat_handle,status)
           SELECT 'student-contact-' || $1 || '-' || $3::text,$1,$3,$4,$5,NULL,$6,'active' FROM target
           ON CONFLICT (student_id,contact_slot) DO UPDATE
             SET relationship=EXCLUDED.relationship,phone_value=EXCLUDED.phone_value,phone_hmac=NULL,wechat_handle=EXCLUDED.wechat_handle,status='active',revoked_at=NULL,updated_at=transaction_timestamp()
             WHERE business.student_contact_directory.updated_at=$7::timestamptz
           RETURNING contact_id AS "id",student_id AS "studentId",contact_slot AS "slot",relationship,phone_value AS "phone",wechat_handle AS "wechat",status,updated_at AS "updatedAt"
         ) SELECT * FROM written`,
        [studentId, businessTenantId, contactSlot, relationship, phone, wechat, expectedUpdatedAt],
      );
      const contact = result?.rows?.[0];
      if (!contact) return response.status(409).json({ ok: false, code: 'CLOUD_BUSINESS_STUDENT_CONTACT_CONFLICT' });
      response.json({ ok: true, contact });
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
  app.post('/api/storage-agent/artifact-deliveries/lease', async (request, response) => {
    if (!storageAgent || typeof storageAgent.leaseArtifactDelivery !== 'function') return response.status(503).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_UNAVAILABLE' });
    const body = exactBody(request.body, ['agentId']);
    const token = storageAgentToken(request);
    if (!body || !token) return response.status(400).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_INPUT_INVALID' });
    try {
      const delivery = await storageAgent.leaseArtifactDelivery({ agentId: body.agentId, token });
      response.json({ ok: true, delivery });
    } catch (error) {
      storageAgentFailure(response, error);
    }
  });
  app.post('/api/storage-agent/artifact-deliveries/:deliveryId/upload', async (request, response) => {
    if (!storageAgent || typeof storageAgent.uploadArtifactDelivery !== 'function') return response.status(503).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_UNAVAILABLE' });
    const token = storageAgentToken(request);
    const agentId = String(request.get('x-gewu-storage-agent-id') || '');
    const leaseToken = String(request.get('x-gewu-storage-agent-lease-token') || '');
    if (!token || !agentId || !leaseToken || !Buffer.isBuffer(request.body) || request.body.length < 1 || request.body.length > (64 * 1024 * 1024)) return response.status(400).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_INPUT_INVALID' });
    try {
      const delivery = await storageAgent.uploadArtifactDelivery({ agentId, token, deliveryId: String(request.params.deliveryId || ''), leaseToken, bytes: request.body });
      response.json({ ok: true, delivery });
    } catch (error) {
      storageAgentFailure(response, error);
    }
  });
  app.post('/api/storage-agent/question-asset-deliveries/lease', async (request, response) => {
    if (!storageAgent || typeof storageAgent.leaseQuestionAssetDelivery !== 'function') return response.status(503).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_UNAVAILABLE' });
    const body = exactBody(request.body, ['agentId']);
    const token = storageAgentToken(request);
    if (!body || !token) return response.status(400).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_INPUT_INVALID' });
    try {
      const delivery = await storageAgent.leaseQuestionAssetDelivery({ agentId: body.agentId, token });
      response.json({ ok: true, delivery });
    } catch (error) {
      storageAgentFailure(response, error);
    }
  });
  app.post('/api/storage-agent/question-asset-deliveries/:deliveryId/upload', async (request, response) => {
    if (!storageAgent || typeof storageAgent.uploadQuestionAssetDelivery !== 'function') return response.status(503).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_UNAVAILABLE' });
    const token = storageAgentToken(request);
    const agentId = String(request.get('x-gewu-storage-agent-id') || '');
    const leaseToken = String(request.get('x-gewu-storage-agent-lease-token') || '');
    if (!token || !agentId || !leaseToken || !Buffer.isBuffer(request.body) || request.body.length < 1 || request.body.length > (64 * 1024 * 1024)) return response.status(400).json({ ok: false, code: 'CLOUD_STORAGE_AGENT_INPUT_INVALID' });
    try {
      const delivery = await storageAgent.uploadQuestionAssetDelivery({ agentId, token, deliveryId: String(request.params.deliveryId || ''), leaseToken, bytes: request.body });
      response.json({ ok: true, delivery });
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
