'use strict';

const express = require('express');

function createCloudBusinessApp({ query, businessScheduleUpdate = null, businessScheduleStudentOverride = null, desktopRegistration = null, desktopPairing = null, businessTenantId = null }) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  if (businessScheduleUpdate !== null && typeof businessScheduleUpdate !== 'function') throw new TypeError('businessScheduleUpdate is invalid');
  if (businessScheduleStudentOverride !== null && typeof businessScheduleStudentOverride !== 'function') throw new TypeError('businessScheduleStudentOverride is invalid');
  if (desktopRegistration && (typeof desktopRegistration.begin !== 'function' || typeof desktopRegistration.register !== 'function')) throw new TypeError('desktopRegistration is invalid');
  if (desktopPairing && (typeof desktopPairing.start !== 'function' || typeof desktopPairing.confirm !== 'function' || typeof desktopPairing.read !== 'function')) throw new TypeError('desktopPairing is invalid');
  if (businessTenantId !== null && (typeof businessTenantId !== 'string' || !businessTenantId.trim())) throw new TypeError('businessTenantId is invalid');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', async (_request, response) => {
    try {
      await query('SELECT 1 AS ok');
      response.json({ ok: true, database: 'postgresql', businessAuthority: 'cloud' });
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
  app.post('/api/desktop/online-verification', async (request, response) => {
    if (!desktopRegistration) return desktopUnavailable(response);
    try {
      const result = await desktopRegistration.begin(request.body);
      response.json({ ok: true, verificationToken: result.verificationToken });
    } catch (error) {
      identityFailure(response, error);
    }
  });
  app.post('/api/desktop/online-registration', async (request, response) => {
    if (!desktopRegistration) return desktopUnavailable(response);
    try {
      const result = await desktopRegistration.register(request.body);
      response.json({ ok: true, receiptId: result.receiptId, sessionId: result.sessionId, replayed: result.replayed, sessionToken: result.sessionToken });
    } catch (error) {
      identityFailure(response, error);
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
  app.get('/api/business/schedules', async (request, response) => {
    if (!desktopRegistration || typeof desktopRegistration.sessionContext !== 'function' || !businessTenantId) return businessUnavailable(response);
    const token = sessionToken(request);
    if (!token) return response.status(403).json({ ok: false, code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
    try {
      const context = await desktopRegistration.sessionContext({ sessionToken: token });
      if (!context || !Array.isArray(context.roles) || !context.roles.includes('super_admin')) {
        return response.status(403).json({ ok: false, code: 'CLOUD_BUSINESS_ACCESS_DENIED' });
      }
      const result = await query(
        `SELECT s.id AS "id", s.course_id AS "courseId", c.display_name AS "courseName", s.start_at AS "startAt", s.end_at AS "endAt", s.updated_at AS "updatedAt", s.status AS "status", s.room_display_snapshot AS "roomDisplay", s.calculated_tuition AS "tuition", s.calculated_teacher_fee AS "teacherFee"
         FROM business.schedules s
         JOIN business.courses c ON c.tenant_id=s.tenant_id AND c.id=s.course_id
         WHERE s.tenant_id=$1
         ORDER BY s.start_at ASC, s.id ASC`,
        [businessTenantId],
      );
      response.json({ ok: true, schedules: result.rows });
    } catch (_) {
      businessUnavailable(response);
    }
  });
  app.put('/api/business/schedules/:scheduleId', async (request, response) => {
    if (!desktopRegistration || typeof desktopRegistration.sessionContext !== 'function' || !businessTenantId || !businessScheduleUpdate) return businessUnavailable(response);
    const token = sessionToken(request);
    if (!token) return response.status(403).json({ ok: false, code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
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
      const context = await desktopRegistration.sessionContext({ sessionToken: token });
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
    } catch (_) {
      businessUnavailable(response);
    }
  });
  app.put('/api/business/schedules/:scheduleId/students/:studentId', async (request, response) => {
    if (!desktopRegistration || typeof desktopRegistration.sessionContext !== 'function' || !businessTenantId || !businessScheduleStudentOverride) return businessUnavailable(response);
    const token = sessionToken(request);
    if (!token) return response.status(403).json({ ok: false, code: 'CLOUD_ONLINE_IDENTITY_REJECTED' });
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
      const context = await desktopRegistration.sessionContext({ sessionToken: token });
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
    } catch (_) {
      businessUnavailable(response);
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
