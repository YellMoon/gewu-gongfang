'use strict';

function invalid() {
  return Object.assign(new Error('desktop teacher registration repository input is invalid'), { code: 'CLOUD_DESKTOP_TEACHER_REGISTRATION_INVALID' });
}

function text(value, maximum) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= maximum ? value : null;
}

function createDesktopTeacherSelfRegistrationRepository({ query }) {
  if (typeof query !== 'function') throw invalid();
  return Object.freeze({
    async registerTeacher(input) {
      const tenantId = text(input?.tenantId, 512);
      const authorityId = text(input?.authorityId, 512);
      const accountId = text(input?.accountId, 512);
      const phoneHmac = typeof input?.phoneHmac === 'string' && /^[0-9a-f]{64}$/u.test(input.phoneHmac) ? input.phoneHmac : null;
      const teacherId = text(input?.teacherId, 128);
      const name = text(input?.name, 128);
      const subject = input?.subject === null ? null : text(input?.subject, 128);
      if (!tenantId || !authorityId || !accountId || !phoneHmac || !teacherId || !name || (input?.subject !== null && !subject)) throw invalid();
      const result = await query(
        `SELECT teacher_id AS "teacherId",updated_at AS "updatedAt"
           FROM business.vnext_self_register_teacher_v1($1,$2,$3,$4,$5,$6)`,
        [tenantId, accountId, phoneHmac, teacherId, name, subject],
      );
      const row = result?.rows?.[0];
      if (!row || row.teacherId !== teacherId || !(row.updatedAt instanceof Date)) throw invalid();
      return { teacherId, updatedAt: row.updatedAt.toISOString(), replayed: false };
    },
  });
}

module.exports = Object.freeze({ createDesktopTeacherSelfRegistrationRepository });
