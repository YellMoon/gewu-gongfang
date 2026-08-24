'use strict';

function createDesktopRegistrationPgAdapter({ writerPool } = {}) {
  if (!writerPool || typeof writerPool.query !== 'function') {
    throw new TypeError('desktop registration writer pool is required');
  }
  return async function registerDesktopOnline(input) {
    const result = await writerPool.query(
      'SELECT receipt_id AS "receiptId", session_id AS "sessionId", replayed FROM vnext_control_plane.vnext_register_unified_desktop_online($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [input.assertionId, input.idempotencyKey, input.receiptId, input.auditEventId, input.outboxEventId, input.sessionId, input.linkId, input.sessionExpiresAt, input.canonicalResultJson, input.resultSha256, input.canonicalPayloadJson, input.payloadSha256],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      receiptId: row.receiptId,
      sessionId: row.sessionId,
      replayed: row.replayed,
    };
  };
}

module.exports = Object.freeze({ createDesktopRegistrationPgAdapter });
