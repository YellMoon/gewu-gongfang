const express = require('express');
const {
  createAuthorityProtocolRouter,
} = require('../../../backend/src/routes/authorityProtocol');
const {
  createAuthorityCommandAuthorizationService,
} = require('../../../backend/src/services/authorityCommandAuthorizationService');
const {
  createAuthorityCommandInboxService,
} = require('../../../backend/src/services/authorityCommandInboxService');
const {
  createAuthorityCommandPolicy,
} = require('../../../backend/src/services/authorityCommandRegistry');
const {
  createAuthorityDeviceRequestAuth,
} = require('../services/authorityDeviceRequestAuth');
const { safeCredentialEqual } = require('../websocket/authMiddleware');
const {
  createGatewayAuthorityProjectionService,
} = require('../services/authorityProjectionService');
const {
  validatePrimaryHostSigningPublicKey,
} = require('../../../shared/primaryHostSigningKey');
const {
  createAuthorityDeviceControlMirrorService,
} = require('../services/authorityDeviceControlMirrorService');
const {
  createAuthorityDeviceControlMirrorReadService,
} = require('../services/authorityDeviceControlMirrorReadService');

function gatewayAuthorityError(code, statusCode) {
  return Object.assign(new Error(code), { code, statusCode });
}

function createGatewayAuthorityProtocolRouter({
  db,
  commandPolicy = createAuthorityCommandPolicy(),
} = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw gatewayAuthorityError('AUTHORITY_CONTROL_PLANE_DATABASE_REQUIRED', 500);
  }
  const router = express.Router();
  const deviceAuth = createAuthorityDeviceRequestAuth({ db });
  const projectionService = createGatewayAuthorityProjectionService({ db });
  const deviceControlMirrors = createAuthorityDeviceControlMirrorService({ db });
  const deviceControlSource = createAuthorityDeviceControlMirrorReadService({ db });
  const authenticateDevice = (req, res, next) => {
    try {
      req.authorityActor = deviceAuth.authenticate(req);
      next();
    } catch (error) {
      res.status(error?.statusCode || 401).json({
        success: false,
        error: { code: error?.code || 'AUTHORITY_DEVICE_AUTH_FAILED' },
      });
    }
  };
  router.post('/commands', authenticateDevice);
  router.get('/commands/:id/receipt', authenticateDevice);

  const inbox = createAuthorityCommandInboxService({
    db,
    targetHostIdFor: envelope => {
      const epoch = db.prepare(`SELECT device_id, db_authority_id FROM primary_host_epochs
        WHERE id=? AND status='active'`).get(envelope.hostEpochId);
      if (!epoch || epoch.db_authority_id !== envelope.authorityId) {
        throw gatewayAuthorityError('AUTHORITY_HOST_EPOCH_INACTIVE', 403);
      }
      return epoch.device_id;
    },
  });
  const authorization = createAuthorityCommandAuthorizationService({
    db,
    commandPolicy,
  });
  const authorizeHostRequest = req => {
    const deviceId = String(req.headers['x-gewu-host-device-id'] || '').trim();
    const generation = Number(req.headers['x-gewu-host-generation']);
    const credential = String(req.headers['x-gewu-host-credential'] || '');
    const epoch = deviceId && Number.isSafeInteger(generation) && generation > 0
      ? db.prepare(`SELECT id, db_authority_id, generation, credential_version, host_credential_hash
        FROM primary_host_epochs
        WHERE device_id=? AND generation=? AND status='active'`)
        .get(deviceId, generation)
      : null;
    if (!epoch || !credential || !safeCredentialEqual(credential, epoch.host_credential_hash)) {
      throw gatewayAuthorityError('AUTHORITY_HOST_CREDENTIAL_INVALID', 403);
    }
    return Object.freeze({
      deviceId,
      epochId: epoch.id,
      authorityId: epoch.db_authority_id,
      generation: Number(epoch.generation),
    });
  };

  router.post('/host/epoch', (req, res) => {
    try {
      const host = authorizeHostRequest(req);
      const epoch = req.body?.epoch || {};
      if (String(epoch.id || '') !== host.epochId
        || String(epoch.authorityId || '') !== host.authorityId
        || String(epoch.deviceId || '') !== host.deviceId
        || Number(epoch.generation) !== host.generation) {
        throw gatewayAuthorityError('AUTHORITY_HOST_EPOCH_MIRROR_MISMATCH', 403);
      }
      let signingKey;
      try {
        signingKey = validatePrimaryHostSigningPublicKey(epoch.hostSigningKey);
      } catch (error) {
        throw gatewayAuthorityError(error?.code || 'PRIMARY_HOST_SIGNING_PUBLIC_KEY_INVALID', 400);
      }
      const updatedAt = new Date().toISOString();
      const updated = db.prepare(`UPDATE primary_host_epochs
        SET host_public_key=?,updated_at=?
        WHERE id=? AND db_authority_id=? AND device_id=? AND generation=? AND status='active'`)
        .run(
          signingKey.publicKeyPem,
          updatedAt,
          host.epochId,
          host.authorityId,
          host.deviceId,
          host.generation,
        );
      if (updated.changes !== 1) {
        throw gatewayAuthorityError('AUTHORITY_HOST_EPOCH_INACTIVE', 403);
      }
      return res.json({
        success: true,
        epoch: Object.freeze({
          id: host.epochId,
          authorityId: host.authorityId,
          deviceId: host.deviceId,
          generation: host.generation,
          hostPublicKey: signingKey.publicKeyPem,
        }),
      });
    } catch (error) {
      return res.status(error?.statusCode || 400).json({
        success: false,
        error: { code: error?.code || 'AUTHORITY_HOST_EPOCH_MIRROR_FAILED' },
      });
    }
  });

  router.get('/host/epoch', (req, res) => {
    try {
      const host = authorizeHostRequest(req);
      const epoch = db.prepare(`SELECT id,db_authority_id AS authorityId,device_id AS deviceId,
        generation,host_public_key AS hostPublicKey
        FROM primary_host_epochs WHERE id=? AND status='active'`).get(host.epochId);
      if (!epoch || epoch.authorityId !== host.authorityId || epoch.deviceId !== host.deviceId
        || Number(epoch.generation) !== host.generation || !epoch.hostPublicKey) {
        throw gatewayAuthorityError('AUTHORITY_HOST_EPOCH_INACTIVE', 403);
      }
      return res.json({ success: true, epoch });
    } catch (error) {
      return res.status(error?.statusCode || 400).json({ success: false,
        error: { code: error?.code || 'AUTHORITY_HOST_EPOCH_READ_FAILED' } });
    }
  });

  router.post('/host/projections', (req, res) => {
    try {
      const host = authorizeHostRequest(req);
      if (host.epochId !== req.body?.projection?.hostEpochId) {
        throw gatewayAuthorityError('AUTHORITY_PROJECTION_HOST_EPOCH_MISMATCH', 403);
      }
      const published = projectionService.publish(req.body.projection);
      return res.json({ success: true, projection: published });
    } catch (error) {
      return res.status(error?.statusCode || 400).json({
        success: false,
        error: { code: error?.code || 'AUTHORITY_PROJECTION_PUBLISH_FAILED' },
      });
    }
  });

  router.post('/host/control-records', (req, res) => {
    try {
      const host = authorizeHostRequest(req);
      const snapshot = req.body?.snapshot || {};
      if (String(snapshot.authorityId || '') !== host.authorityId
        || String(snapshot.hostEpochId || '') !== host.epochId
        || Number(snapshot.hostGeneration) !== host.generation) {
        throw gatewayAuthorityError(
          'AUTHORITY_DEVICE_CONTROL_MIRROR_HOST_MISMATCH',
          403,
        );
      }
      const result = deviceControlMirrors.replace(snapshot);
      return res.json({ success: true, result });
    } catch (error) {
      return res.status(error?.statusCode || 400).json({
        success: false,
        error: { code: error?.code || 'AUTHORITY_DEVICE_CONTROL_MIRROR_FAILED' },
      });
    }
  });

  router.get('/host/control-records', (req, res) => {
    try {
      const host = authorizeHostRequest(req);
      return res.json({
        success: true,
        snapshot: deviceControlSource.load({
          authorityId: host.authorityId,
          hostEpochId: host.epochId,
          hostGeneration: host.generation,
        }),
      });
    } catch (error) {
      return res.status(error?.statusCode || 400).json({
        success: false,
        error: { code: error?.code || 'AUTHORITY_DEVICE_CONTROL_MIRROR_READ_FAILED' },
      });
    }
  });

  router.get('/projections/current', authenticateDevice, (req, res) => {
    try {
      const authorityId = String(req.headers['x-gewu-authority-id'] || '').trim();
      const projection = projectionService.read({
        authorityId,
        userId: req.authorityActor.userId,
        role: req.authorityActor.role,
      });
      if (!projection) throw gatewayAuthorityError('AUTHORITY_PROJECTION_NOT_FOUND', 404);
      authorization.authorize({
        authorityId,
        hostEpochId: projection.hostEpochId,
        actor: req.authorityActor,
        lease: {
          id: String(req.headers['x-gewu-authority-lease-id'] || '').trim(),
          grantVersion: Number(req.headers['x-gewu-authority-grant-version']),
        },
        type: 'projection.read.v1',
        payload: {},
      });
      return res.json({ success: true, projection });
    } catch (error) {
      return res.status(error?.statusCode || 403).json({
        success: false,
        error: { code: error?.code || 'AUTHORITY_PROJECTION_READ_FAILED' },
      });
    }
  });

  router.use(createAuthorityProtocolRouter({
    authorizeCommand: ({ envelope }) => authorization.authorize(envelope),
    enqueueCommand: envelope => inbox.enqueue(envelope),
    findReceipt: input => inbox.findReceipt(input),
    authorizeHostRequest,
    claimCommands: input => inbox.claim(input),
    renewCommandClaim: input => inbox.renew(input),
    publishHostReceipt: (receipt, claim) => inbox.publishReceipt(receipt, claim),
    onCommandQueued: ({ envelope, queued, request }) => {
      const epoch = db.prepare(`SELECT device_id FROM primary_host_epochs
        WHERE id=? AND status='active'`).get(envelope.hostEpochId);
      if (epoch?.device_id) {
        request.app?.get('wsServer')?.notifyHostNewTask(epoch.device_id, {
          id: queued.id,
          task_type: 'authority-command-v1',
        });
      }
    },
  }));
  return router;
}

module.exports = {
  createGatewayAuthorityProtocolRouter,
  gatewayAuthorityError,
};
