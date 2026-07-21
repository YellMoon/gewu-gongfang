'use strict';

const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const REDACTED = '[redacted]';

function cutoffFor(now) {
  const value = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(value.getTime())) throw new TypeError('valid retention time is required');
  return new Date(value.getTime() - RETENTION_MS).toISOString();
}

function runMiniappPrivacyRetention(db, now = new Date()) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new TypeError('db is required');
  }
  const cutoff = cutoffFor(now);
  const redactLoginEvents = db.prepare(`UPDATE miniapp_login_events
    SET phone_normalized = ?
    WHERE created_at < ? AND phone_normalized <> ?`);
  const redactApplications = db.prepare(`UPDATE miniapp_role_applications
    SET payload_json = '{}', verified_phone_normalized = ?, student_phone_normalized = NULL,
        parent_phone_normalized = NULL, rejection_reason = NULL
    WHERE status IN (?, ?) AND updated_at < ?
      AND (payload_json <> '{}' OR verified_phone_normalized <> ?
        OR student_phone_normalized IS NOT NULL OR parent_phone_normalized IS NOT NULL
        OR rejection_reason IS NOT NULL)`);
  const redactApproved = db.prepare(`UPDATE miniapp_role_applications
    SET payload_json = '{}', verified_phone_normalized = ?, student_phone_normalized = NULL,
        parent_phone_normalized = NULL, rejection_reason = NULL
    WHERE status = 'approved' AND updated_at < ?
      AND (payload_json <> '{}' OR verified_phone_normalized <> ?
        OR student_phone_normalized IS NOT NULL OR parent_phone_normalized IS NOT NULL
        OR rejection_reason IS NOT NULL)`);

  return db.transaction(() => ({
    loginEventsRedacted: redactLoginEvents.run(REDACTED, cutoff, REDACTED).changes,
    rejectedPayloadsRedacted: redactApplications.run(REDACTED, 'rejected', 'withdrawn', cutoff, REDACTED).changes,
    approvedPayloadsRedacted: redactApproved.run(REDACTED, cutoff, REDACTED).changes,
  }))();
}

module.exports = { RETENTION_MS, runMiniappPrivacyRetention };
