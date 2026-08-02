require('dotenv').config();
const http = require('http');
const { createApp } = require('./src/app');
const { createHostTaskWakeup } = require('./src/websocket/hostTaskWakeup');
const { createHostCommandWorker } = require('./src/services/hostCommandWorker');
const { createAuthorityHostRuntime } = require('./src/services/authorityHostRuntime');
const {
  createAuthorityCommandSource,
  publishAuthorityControlRecords,
  publishAuthorityHostEpoch,
  publishAuthorityProjection,
} = require('./src/services/cloudRelayClient');
const {
  createAuthorityProjectionPublisherService,
} = require('./src/services/authorityProjectionPublisherService');
const {
  createAuthorityProjectionSourceService,
} = require('./src/services/authorityProjectionSourceService');
const {
  createAuthorityControlMirrorSourceService,
} = require('./src/services/authorityControlMirrorSourceService');
const { createAuthorityProjectionWorker } = require('./src/services/authorityProjectionWorker');
const {
  derivePrimaryHostSigningKey,
  signPrimaryHostProjection,
} = require('../shared/primaryHostSigningKey');
const { getInstance } = require('./src/database');
const { resolveBackendPort } = require('./src/runtimePort');
const { CloudRelaySocketServer } = require('./src/websocket/cloudRelayServer');
const { AuthoritySocketServer } = require('./src/websocket/authoritySocketServer');
const { createAuthorityCompositeCommandSource } = require('./src/services/authorityCompositeCommandSource');
const { createAuthoritySocketCommandHandler } = require('./src/services/authoritySocketCommandHandler');

const PORT = resolveBackendPort();
const runtimeConfig = runtimeConfigFromEnv();
const app = createApp();
const server = http.createServer(app);
app.set('cloudRelaySocketServer', new CloudRelaySocketServer(server, {
  db: app.locals.authorityDatabase,
  authorityEnabled: runtimeConfig.nodeRole !== 'primary-host',
}));
let hostTaskWakeup = null;
let hostCommandWorker = null;
let authorityProjectionWorker = null;
let authoritySocketServer = null;

function runtimeConfigFromEnv() {
  return {
    nodeRole: process.env.GEWU_NODE_ROLE || 'desktop-client',
    deviceId: process.env.GEWU_DEVICE_ID || process.env.HOST_DEVICE_ID || '',
    cloudBaseUrl: process.env.GEWU_CLOUD_BASE_URL || process.env.GATEWAY_WS_URL || '',
    hostCredential: process.env.GEWU_PRIMARY_HOST_CREDENTIAL || '',
    hostGeneration: process.env.GEWU_PRIMARY_HOST_GENERATION || '',
  };
}

server.listen(PORT, () => {
  if (runtimeConfig.nodeRole === 'primary-host') {
    const managedHostAuth = Object.freeze({
      hostCredential: runtimeConfig.hostCredential,
      hostDeviceId: runtimeConfig.deviceId,
      hostGeneration: runtimeConfig.hostGeneration,
    });
    const cloudSource = createAuthorityCommandSource(managedHostAuth);
    const commandSource = createAuthorityCompositeCommandSource({
      sources: [
        { id: 'local', source: app.locals.authorityCommandInbox },
        { id: 'cloud', source: cloudSource },
      ],
    });
    const database = getInstance();
    const authorityRuntime = createAuthorityHostRuntime({
      database,
      targetHostId: runtimeConfig.deviceId,
      commandSource,
    });
    const projectionSource = createAuthorityProjectionSourceService({ db: database.db });
    const controlMirrorSource = createAuthorityControlMirrorSourceService({ db: database.db });
    const derivedHostSigningKey = derivePrimaryHostSigningKey(runtimeConfig.hostCredential);
    const hostSigningKey = Object.freeze({
      algorithm: derivedHostSigningKey.algorithm,
      publicKeyPem: derivedHostSigningKey.publicKeyPem,
      publicKeyFingerprint: derivedHostSigningKey.publicKeyFingerprint,
    });
    const projectionPublisher = createAuthorityProjectionPublisherService({
      db: database.db,
      loadSource: input => projectionSource.load(input),
      prepareRemote: async target => {
        await publishAuthorityHostEpoch({
          id: target.hostEpochId,
          authorityId: target.authorityId,
          generation: Number(runtimeConfig.hostGeneration),
          deviceId: runtimeConfig.deviceId,
          hostSigningKey,
        }, managedHostAuth);
        return publishAuthorityControlRecords(controlMirrorSource.load(target), managedHostAuth);
      },
      signProjection: input => signPrimaryHostProjection({
        hostCredential: runtimeConfig.hostCredential,
        projection: input,
      }),
      publishRemote: projection => publishAuthorityProjection(projection, managedHostAuth),
    });
    authorityProjectionWorker = createAuthorityProjectionWorker({
      db: database.db,
      publisher: projectionPublisher,
      targetHostId: runtimeConfig.deviceId,
      intervalMs: 15000,
      log: message => console.warn(`[ProjectionWorker] ${message}`),
    });
    authorityProjectionWorker.start();
    hostCommandWorker = createHostCommandWorker({
      processOnce: async () => {
        const result = await authorityRuntime.processor.processOnce();
        if (Number(result?.processed || 0) > 0) void authorityProjectionWorker?.wake();
        return result;
      },
      log: message => console.warn(`[HostWorker] ${message}`),
    });
    hostCommandWorker.start();
    void authorityProjectionWorker.wake();
    const socketHandler = createAuthoritySocketCommandHandler({
      deviceAuth: app.locals.authorityDeviceRequestAuth,
      authorizeCommand: envelope => app.locals.authorityCommandAuthorization.authorize(envelope),
      inbox: app.locals.authorityCommandInbox,
      worker: hostCommandWorker,
    });
    authoritySocketServer = new AuthoritySocketServer(server, { handler: socketHandler });
    app.set('authoritySocketServer', authoritySocketServer);
    hostTaskWakeup = createHostTaskWakeup({
      runtimeConfig,
      localPort: PORT,
      worker: hostCommandWorker,
      authorityFrameHandler: socketHandler,
      log: message => console.warn(`[HostWS] ${message}`),
    });
    hostTaskWakeup?.start();
  }
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`WebSocket host wakeup: ${hostTaskWakeup ? 'enabled' : 'disabled'}`);
});

function shutdown() {
  hostTaskWakeup?.stop();
  hostCommandWorker?.stop();
  authorityProjectionWorker?.stop();
  authoritySocketServer?.close();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
