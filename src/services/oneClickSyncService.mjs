function emptyActionCounts() {
  return { create: 0, update: 0, delete: 0 };
}

function makeChangeSummary(changes) {
  const byAction = emptyActionCounts();
  const byTable = {};
  for (const change of changes || []) {
    const action = change?.action || 'update';
    byAction[action] = (byAction[action] || 0) + 1;
    const table = change?.table || 'unknown';
    byTable[table] = (byTable[table] || 0) + 1;
  }
  return {
    total: (changes || []).length,
    byAction,
    byTable,
  };
}

function riskLevelOf(change) {
  return change?.riskLevel
    || change?.risk_level
    || change?.data?._risk_level
    || (change?.action === 'delete' ? 'high' : 'normal');
}

function summarizeRisk(changes) {
  const risk = { high: 0, medium: 0, normal: 0 };
  for (const change of changes || []) {
    const level = riskLevelOf(change);
    if (level === 'high') risk.high += 1;
    else if (level === 'medium') risk.medium += 1;
    else risk.normal += 1;
  }
  return risk;
}

export function buildOneClickSyncPreview(input) {
  const pendingChanges = input?.pendingChanges || [];
  const incomingChanges = input?.incomingChanges || [];
  const upload = makeChangeSummary(pendingChanges);
  const download = makeChangeSummary(incomingChanges);
  const risk = summarizeRisk([...pendingChanges, ...incomingChanges]);
  return {
    channel: input?.channel || 'unknown',
    hostOnline: input?.hostOnline !== false,
    upload,
    download,
    risk,
    pendingChanges,
    incomingChanges,
    confirmationRequired: upload.total > 0 || download.total > 0 || risk.high > 0 || input?.hostOnline === false,
  };
}

export async function chooseSyncTransport(transports) {
  const diagnostics = [];
  for (const transport of transports || []) {
    if (!transport) continue;
    try {
      const check = transport.check ? await transport.check() : { ok: true };
      if (check?.ok) return { ...transport, check, diagnostics };
      diagnostics.push({ name: transport.name || 'unknown', code: check?.code || 'TRANSPORT_UNAVAILABLE', reason: check?.reason || '' });
    } catch (error) {
      diagnostics.push({ name: transport.name || 'unknown', code: error?.code || 'TRANSPORT_CHECK_FAILED', reason: error?.message || '' });
    }
  }
  return { unavailable: true, diagnostics };
}

function getPendingChanges(engine) {
  if (!engine) return [];
  if (typeof engine.getPendingChanges === 'function') return engine.getPendingChanges();
  if (typeof engine.getPendingOps === 'function') return engine.getPendingOps();
  return [];
}

function getLastSyncTime(engine) {
  try {
    return engine?.getStatus?.()?.lastSyncTime || 0;
  } catch {
    return 0;
  }
}

async function previewTransport(transport, engine, pendingChanges) {
  if (!transport?.preview) {
    return { success: true, hostOnline: true, incomingChanges: [] };
  }
  const preview = await transport.preview({
    deviceId: engine?.getDeviceId?.(),
    lastSyncTime: getLastSyncTime(engine),
    pendingChanges,
  });
  return {
    success: preview?.success !== false,
    hostOnline: preview?.hostOnline !== false,
    incomingChanges: preview?.incomingChanges || preview?.changes || [],
    raw: preview,
  };
}

export async function runOneClickSync(options) {
  const engine = options?.engine;
  const transports = options?.transports || [];
  const confirmPreview = options?.confirmPreview || (async () => true);
  const buildLocalDataMaps = options?.buildLocalDataMaps || (() => ({}));
  const applyLocalDataMaps = options?.applyLocalDataMaps || (() => {});
  const pendingChanges = getPendingChanges(engine);

  try {
    if (typeof options?.requireOnlineSession !== 'function') {
      const error = new Error('ONLINE_DESKTOP_SESSION_REQUIRED');
      error.code = 'ONLINE_DESKTOP_SESSION_REQUIRED';
      throw error;
    }
    await options.requireOnlineSession();
  } catch (error) {
    return {
      status: 'failed',
      error: error?.code || 'ONLINE_DESKTOP_SESSION_REQUIRED',
      diagnostics: [{ name: 'identity', code: error?.code || 'ONLINE_DESKTOP_SESSION_REQUIRED', reason: error?.message || '' }],
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
    };
  }

  const transport = await chooseSyncTransport(transports);
  if (transport?.unavailable) {
    const codes = transport.diagnostics.map(item => item.code);
    const error = codes.find(code => ['ONLINE_DESKTOP_SESSION_REQUIRED', 'AUTHORIZATION_CONTEXT_REQUIRED', 'PAIRING_NOT_APPROVED', 'USER_NOT_APPROVED', 'DEVICE_CREDENTIAL_REVOKED'].includes(code))
      || (transport.diagnostics.some(item => item.name === 'cloud') ? 'CLOUD_UNREACHABLE' : 'NO_SYNC_TRANSPORT_AVAILABLE');
    return {
      status: 'failed',
      error,
      diagnostics: transport.diagnostics,
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
    };
  }

  const remotePreview = await previewTransport(transport, engine, pendingChanges);
  const preview = buildOneClickSyncPreview({
    channel: transport.name,
    hostOnline: remotePreview.hostOnline,
    pendingChanges,
    incomingChanges: remotePreview.incomingChanges,
  });

  const accepted = await confirmPreview(preview);
  if (!accepted) {
    return {
      status: 'cancelled',
      channel: transport.name,
      preview,
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
    };
  }

  if (transport.queueOnly || (transport.name === 'cloud' && remotePreview.hostOnline === false)) {
    if (!transport.submitSyncRequest) {
      return {
        status: 'failed',
        channel: transport.name,
        preview,
        error: 'CLOUD_RELAY_QUEUE_UNAVAILABLE',
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
      };
    }
    const queued = await transport.submitSyncRequest({
      deviceId: engine?.getDeviceId?.(),
      pendingChanges,
      preview,
    });
    if (!queued?.success) {
      return {
        status: 'failed',
        channel: transport.name,
        preview,
        error: queued?.error || 'CLOUD_RELAY_QUEUE_FAILED',
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
      };
    }
    return {
      status: 'waiting-host',
      channel: transport.name,
      preview,
      requestId: queued.requestId,
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
    };
  }

  let uploaded = 0;
  if (pendingChanges.length > 0) {
    const pushResult = await engine.push(batch => transport.pushSyncBatch(batch));
    if (!pushResult?.success) {
      return {
        status: 'failed',
        channel: transport.name,
        preview,
        error: 'PUSH_FAILED',
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
      };
    }
    uploaded = pushResult.pushed || pendingChanges.length;
  }

  const localData = buildLocalDataMaps();
  const pullResult = await engine.pull(lastSyncTs => transport.pullSyncOps(lastSyncTs), localData);
  if (!pullResult?.success) {
    return {
      status: 'failed',
      channel: transport.name,
      preview,
      error: 'PULL_FAILED',
      uploaded,
      downloaded: 0,
      conflicts: 0,
    };
  }
  applyLocalDataMaps(localData);

  return {
    status: 'synced',
    channel: transport.name,
    preview,
    uploaded,
    downloaded: pullResult.applied || 0,
    conflicts: (pullResult.conflicts || []).length,
  };
}
