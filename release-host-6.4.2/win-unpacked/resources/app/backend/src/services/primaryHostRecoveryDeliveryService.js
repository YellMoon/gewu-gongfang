const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  ACK_SIGNATURE_ALGORITHM,
  CONTENT_ENCRYPTION_ALGORITHM,
  DELIVERY_PROTOCOL_VERSION,
  KEY_WRAP_ALGORITHM,
  RECOVERY_DELIVERY_KEY_ALGORITHM,
  sealRecoveryPackage,
  validateRecoveryDeliveryPublicKey,
  verifyRecoveryDeliveryAcknowledgement,
} = require('./primaryHostRecoveryDeliveryProtocol');

const ALERT_AFTER_MS = 24 * 60 * 60 * 1000;
const OVERDUE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const ACK_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function deliveryError(code, status = 409) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function requiredText(value, code, maxLength = 256) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw deliveryError(code, 400);
  return normalized;
}

function positiveInteger(value, code) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw deliveryError(code, 400);
  return normalized;
}

function fingerprintText(value, code) {
  const normalized = requiredText(value, code, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw deliveryError(code, 400);
  return normalized;
}

function nonceText(value, code) {
  const normalized = requiredText(value, code, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw deliveryError(code, 400);
  return normalized;
}

function canonicalTimestamp(value, code) {
  const normalized = requiredText(value, code, 64);
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) {
    throw deliveryError(code, 409);
  }
  return normalized;
}

function normalizeDescriptor(value = {}) {
  const code = 'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID';
  const descriptor = {
    protocolVersion: value.protocolVersion,
    keyAlgorithm: value.keyAlgorithm,
    keyWrapAlgorithm: value.keyWrapAlgorithm,
    contentEncryptionAlgorithm: value.contentEncryptionAlgorithm,
    acknowledgementSignatureAlgorithm: value.acknowledgementSignatureAlgorithm,
    recipientKeyFingerprint: fingerprintText(value.recipientKeyFingerprint, code),
  };
  if (descriptor.protocolVersion !== DELIVERY_PROTOCOL_VERSION
    || descriptor.keyAlgorithm !== RECOVERY_DELIVERY_KEY_ALGORITHM
    || descriptor.keyWrapAlgorithm !== KEY_WRAP_ALGORITHM
    || descriptor.contentEncryptionAlgorithm !== CONTENT_ENCRYPTION_ALGORITHM
    || descriptor.acknowledgementSignatureAlgorithm !== ACK_SIGNATURE_ALGORITHM) {
    throw deliveryError(code, 400);
  }
  return Object.freeze(descriptor);
}

function createPrimaryHostRecoveryDeliveryService({
  db,
  now = () => new Date(),
  uuid = uuidv4,
  randomBytes = crypto.randomBytes,
} = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw deliveryError('PRIMARY_HOST_RECOVERY_DELIVERY_DB_REQUIRED', 500);
  }

  const findById = db.prepare(`SELECT d.*, e.generation AS epoch_generation, e.status AS epoch_status
    FROM host_recovery_deliveries d
    JOIN primary_host_epochs e ON e.id=d.epoch_id
    WHERE d.id=?`);
  const findByEpoch = db.prepare(`SELECT d.*, e.generation AS epoch_generation, e.status AS epoch_status
    FROM host_recovery_deliveries d
    JOIN primary_host_epochs e ON e.id=d.epoch_id
    WHERE d.epoch_id=?`);
  const findPendingForTarget = db.prepare(`SELECT d.*, e.generation AS epoch_generation, e.status AS epoch_status
    FROM host_recovery_deliveries d
    JOIN primary_host_epochs e ON e.id=d.epoch_id
    WHERE d.user_id=? AND d.device_id=? AND d.status='pending'
    ORDER BY d.created_at DESC LIMIT 1`);
  const findAnyPendingForUser = db.prepare(`SELECT 1 FROM host_recovery_deliveries
    WHERE user_id=? AND status='pending' LIMIT 1`);
  const insertDelivery = db.prepare(`INSERT INTO host_recovery_deliveries
    (id, epoch_id, factor_id, user_id, device_id, protocol_version,
     recipient_key_fingerprint, recipient_public_key_pem, ack_nonce,
     envelope_json, status, row_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)`);
  const acknowledgeDelivery = db.prepare(`UPDATE host_recovery_deliveries
    SET status='acknowledged', envelope_json=NULL, recipient_public_key_pem=NULL,
        ack_nonce=NULL, acknowledged_at=?, updated_at=?, row_version=row_version+1
    WHERE id=? AND status='pending' AND row_version=?`);
  const insertAudit = db.prepare(`INSERT INTO authorization_audit_log
    (id, actor_user_id, target_user_id, action, before_json, after_json, created_at)
    VALUES (?, NULL, NULL, ?, ?, ?, ?)`);

  function currentDate() {
    const value = now();
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw deliveryError('PRIMARY_HOST_RECOVERY_DELIVERY_CLOCK_INVALID', 500);
    }
    return date;
  }

  function auditDigest(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
  }

  function appendAudit({ action, row, beforeStatus = null, afterStatus, errorCode = null, at }) {
    const summary = Object.freeze({
      deliveryIdDigest: auditDigest(row.id),
      epochIdDigest: auditDigest(row.epoch_id || row.epochId),
      recipientKeyFingerprintDigest: auditDigest(
        row.recipient_key_fingerprint || row.deliveryKey?.publicKeyFingerprint
      ),
      status: afterStatus,
      rowVersion: Number(row.row_version || row.rowVersion),
      errorCode,
    });
    insertAudit.run(
      uuid('recovery-delivery-audit'),
      action,
      beforeStatus === null ? null : JSON.stringify({ ...summary, status: beforeStatus }),
      JSON.stringify(summary),
      at || currentDate().toISOString()
    );
  }

  function rowForTarget({ id, epochId, userId, deviceId }) {
    const row = id ? findById.get(id) : findByEpoch.get(epochId);
    if (!row || row.user_id !== userId || row.device_id !== deviceId) {
      throw deliveryError('PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND', 404);
    }
    return row;
  }

  function attentionLevel(row) {
    if (row.status !== 'pending') return 'acknowledged';
    const ageMs = Math.max(0, currentDate().getTime() - Date.parse(row.created_at));
    if (ageMs >= OVERDUE_AFTER_MS) return 'overdue_7d';
    if (ageMs >= ALERT_AFTER_MS) return 'due_24h';
    return 'normal';
  }

  function publicStatus(row, { includeEnvelope = false, includeNonce = false } = {}) {
    const result = {
      id: row.id,
      epochId: row.epoch_id,
      factorId: row.factor_id,
      generation: Number(row.epoch_generation),
      status: row.status,
      rowVersion: Number(row.row_version),
      recipientKeyFingerprint: row.recipient_key_fingerprint,
      createdAt: row.created_at,
      acknowledgedAt: row.acknowledged_at || null,
      attentionLevel: attentionLevel(row),
    };
    if (row.status === 'pending' && includeNonce) result.ackNonce = row.ack_nonce;
    if (row.status === 'pending' && includeEnvelope) {
      try {
        result.envelope = JSON.parse(row.envelope_json);
      } catch (cause) {
        throw deliveryError('PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH', 500);
      }
    }
    return Object.freeze(result);
  }

  function prepare({
    epochId,
    factorId,
    userId,
    deviceId,
    generation,
    recoveryPackage,
    deliveryKey,
    recoveryDeliveryDescriptor,
  } = {}) {
    const code = 'PRIMARY_HOST_RECOVERY_DELIVERY_KEY_INVALID';
    const descriptor = normalizeDescriptor(recoveryDeliveryDescriptor);
    if (deliveryKey?.protocolVersion !== DELIVERY_PROTOCOL_VERSION) throw deliveryError(code, 400);
    let validatedKey;
    try {
      validatedKey = validateRecoveryDeliveryPublicKey(deliveryKey);
    } catch (_error) {
      throw deliveryError(code, 400);
    }
    if (validatedKey.publicKeyFingerprint !== descriptor.recipientKeyFingerprint) {
      throw deliveryError(code, 400);
    }
    const normalized = {
      id: uuid('recovery-delivery'),
      epochId: requiredText(epochId, 'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH', 128),
      factorId: requiredText(factorId, 'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH', 128),
      userId: requiredText(userId, 'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH', 128),
      deviceId: requiredText(deviceId, 'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH', 128),
      generation: positiveInteger(generation, 'PRIMARY_HOST_RECOVERY_DELIVERY_MISMATCH'),
      ackNonce: Buffer.from(randomBytes(32)).toString('hex'),
      createdAt: currentDate().toISOString(),
    };
    if (!/^[a-f0-9]{64}$/.test(normalized.ackNonce)) {
      throw deliveryError('PRIMARY_HOST_RECOVERY_DELIVERY_NONCE_GENERATION_FAILED', 500);
    }
    const envelope = sealRecoveryPackage({
      epochId: normalized.epochId,
      factorId: normalized.factorId,
      deviceId: normalized.deviceId,
      generation: normalized.generation,
      recoveryPackage,
      recipientKeyAlgorithm: validatedKey.algorithm,
      recipientPublicKeyPem: validatedKey.publicKeyPem,
      recipientPublicKeyFingerprint: validatedKey.publicKeyFingerprint,
    });
    return Object.freeze({
      ...normalized,
      rowVersion: 1,
      envelope,
      deliveryKey: validatedKey,
      recoveryDeliveryDescriptor: descriptor,
    });
  }

  function storePrepared(prepared = {}) {
    insertDelivery.run(
      prepared.id,
      prepared.epochId,
      prepared.factorId,
      prepared.userId,
      prepared.deviceId,
      DELIVERY_PROTOCOL_VERSION,
      prepared.deliveryKey.publicKeyFingerprint,
      prepared.deliveryKey.publicKeyPem,
      prepared.ackNonce,
      JSON.stringify(prepared.envelope),
      prepared.createdAt,
      prepared.createdAt
    );
    appendAudit({
      action: 'primary_host_recovery_delivery_created',
      row: prepared,
      afterStatus: 'pending',
      at: prepared.createdAt,
    });
    return getTargetDelivery({
      epochId: prepared.epochId,
      userId: prepared.userId,
      deviceId: prepared.deviceId,
    });
  }

  function getTargetDelivery({ id, epochId, userId, deviceId } = {}) {
    return publicStatus(rowForTarget({
      id: id ? requiredText(id, 'PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND', 128) : null,
      epochId: epochId ? requiredText(epochId, 'PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND', 128) : null,
      userId: requiredText(userId, 'PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND', 128),
      deviceId: requiredText(deviceId, 'PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND', 128),
    }), { includeEnvelope: true, includeNonce: true });
  }

  function getPendingSummary({ userId, deviceId } = {}) {
    const row = findPendingForTarget.get(
      requiredText(userId, 'PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND', 128),
      requiredText(deviceId, 'PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND', 128)
    );
    return row ? publicStatus(row) : null;
  }

  function hasPendingForUser(userId) {
    return Boolean(findAnyPendingForUser.get(
      requiredText(userId, 'PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND', 128)
    ));
  }

  function acknowledgementResult(row) {
    return Object.freeze({
      id: row.id,
      status: 'acknowledged',
      rowVersion: Number(row.row_version),
      acknowledgedAt: row.acknowledged_at,
      recipientKeyFingerprint: row.recipient_key_fingerprint,
    });
  }

  function acknowledge({ actor, acknowledgement, signature } = {}) {
    const row = rowForTarget({
      id: requiredText(
        acknowledgement?.deliveryId,
        'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_CONFLICT',
        128
      ),
      userId: requiredText(actor?.userId, 'PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND', 128),
      deviceId: requiredText(actor?.deviceId, 'PRIMARY_HOST_RECOVERY_DELIVERY_NOT_FOUND', 128),
    });
    if (row.status === 'acknowledged') return acknowledgementResult(row);

    const conflictCode = 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_CONFLICT';
    let normalized;
    try {
      normalized = {
        deliveryId: row.id,
        epochId: requiredText(acknowledgement.epochId, conflictCode, 128),
        factorId: requiredText(acknowledgement.factorId, conflictCode, 128),
        recipientKeyFingerprint: fingerprintText(
          acknowledgement.recipientKeyFingerprint,
          conflictCode
        ),
        expectedRowVersion: positiveInteger(acknowledgement.expectedRowVersion, conflictCode),
        acknowledgementNonce: nonceText(acknowledgement.acknowledgementNonce, conflictCode),
        acknowledgedAt: canonicalTimestamp(acknowledgement.acknowledgedAt, conflictCode),
      };
    } catch (_error) {
      appendAudit({
        action: 'primary_host_recovery_delivery_ack_failed',
        row,
        beforeStatus: 'pending',
        afterStatus: 'pending',
        errorCode: conflictCode,
      });
      throw deliveryError(conflictCode);
    }
    const skewMs = Math.abs(currentDate().getTime() - Date.parse(normalized.acknowledgedAt));
    const fieldsMatch = row.epoch_status === 'active'
      && normalized.epochId === row.epoch_id
      && normalized.factorId === row.factor_id
      && normalized.recipientKeyFingerprint === row.recipient_key_fingerprint
      && normalized.expectedRowVersion === Number(row.row_version)
      && normalized.acknowledgementNonce === row.ack_nonce
      && skewMs <= ACK_MAX_CLOCK_SKEW_MS;
    if (!fieldsMatch) {
      appendAudit({
        action: 'primary_host_recovery_delivery_ack_failed',
        row,
        beforeStatus: 'pending',
        afterStatus: 'pending',
        errorCode: conflictCode,
      });
      throw deliveryError(conflictCode);
    }
    if (!verifyRecoveryDeliveryAcknowledgement({
      acknowledgement: normalized,
      signature,
      publicKeyPem: row.recipient_public_key_pem,
    })) {
      const code = 'PRIMARY_HOST_RECOVERY_DELIVERY_ACK_PROOF_INVALID';
      appendAudit({
        action: 'primary_host_recovery_delivery_ack_failed',
        row,
        beforeStatus: 'pending',
        afterStatus: 'pending',
        errorCode: code,
      });
      throw deliveryError(code, 403);
    }

    const transaction = db.transaction(() => {
      const timestamp = currentDate().toISOString();
      const updated = acknowledgeDelivery.run(
        normalized.acknowledgedAt,
        timestamp,
        row.id,
        row.row_version
      );
      if (updated.changes !== 1) throw deliveryError(conflictCode);
      const acknowledged = findById.get(row.id);
      appendAudit({
        action: 'primary_host_recovery_delivery_acknowledged',
        row: acknowledged,
        beforeStatus: 'pending',
        afterStatus: 'acknowledged',
        at: timestamp,
      });
      return acknowledgementResult(acknowledged);
    });
    try {
      return transaction();
    } catch (error) {
      if (error?.code === conflictCode) {
        appendAudit({
          action: 'primary_host_recovery_delivery_ack_failed',
          row,
          beforeStatus: 'pending',
          afterStatus: 'pending',
          errorCode: conflictCode,
        });
      }
      throw error;
    }
  }

  return Object.freeze({
    prepare,
    storePrepared,
    getTargetDelivery,
    getPendingSummary,
    hasPendingForUser,
    acknowledge,
  });
}

module.exports = {
  ACK_MAX_CLOCK_SKEW_MS,
  ALERT_AFTER_MS,
  OVERDUE_AFTER_MS,
  createPrimaryHostRecoveryDeliveryService,
};
