const GLOBAL_KEY = '__GEWU_DESKTOP_IDENTITY_PARTITION__';
const CONTEXT_GLOBAL_KEY = '__GEWU_DESKTOP_IDENTITY_CONTEXT__';
const PARTITION_PATTERN = /^[A-Za-z0-9._:-]{3,512}$/;

function partitionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function readCurrentDesktopIdentityPartition(target = globalThis) {
  const value = String(target?.[GLOBAL_KEY] || '').trim();
  if (!value) throw partitionError('DESKTOP_IDENTITY_PARTITION_REQUIRED');
  if (!PARTITION_PATTERN.test(value)) throw partitionError('DESKTOP_IDENTITY_PARTITION_INVALID');
  return value;
}

export function setCurrentDesktopIdentityPartition(partitionKey, target = globalThis) {
  const value = String(partitionKey || '').trim();
  if (!PARTITION_PATTERN.test(value)) throw partitionError('DESKTOP_IDENTITY_PARTITION_INVALID');
  target[GLOBAL_KEY] = value;
  return value;
}

export function clearCurrentDesktopIdentityPartition(target = globalThis) {
  try { delete target[GLOBAL_KEY]; } catch (_error) { target[GLOBAL_KEY] = undefined; }
  try { delete target[CONTEXT_GLOBAL_KEY]; } catch (_error) { target[CONTEXT_GLOBAL_KEY] = undefined; }
}

export function setCurrentDesktopIdentityContext(context, target = globalThis) {
  const userId = String(context?.userId || '').trim();
  const activeRole = String(context?.activeRole || '').trim();
  const partitionKey = String(context?.partitionKey || '').trim();
  if (!userId || !activeRole || !PARTITION_PATTERN.test(partitionKey)) {
    throw partitionError('DESKTOP_IDENTITY_CONTEXT_INVALID');
  }
  setCurrentDesktopIdentityPartition(partitionKey, target);
  target[CONTEXT_GLOBAL_KEY] = Object.freeze({
    userId,
    activeRole,
    teacherId: context.teacherId || null,
    studentId: context.studentId || null,
    partitionKey,
    offline: Boolean(context.offline),
  });
  return target[CONTEXT_GLOBAL_KEY];
}

export function readCurrentDesktopIdentityContext(target = globalThis) {
  const context = target?.[CONTEXT_GLOBAL_KEY];
  if (!context || context.partitionKey !== readCurrentDesktopIdentityPartition(target)) {
    throw partitionError('DESKTOP_IDENTITY_CONTEXT_REQUIRED');
  }
  return context;
}

export function partitionedStorageKey(baseKey, target = globalThis) {
  const base = String(baseKey || '').trim();
  if (!base || base.length > 256) throw partitionError('DESKTOP_IDENTITY_STORAGE_KEY_INVALID');
  return `${base}::${encodeURIComponent(readCurrentDesktopIdentityPartition(target))}`;
}

export function migrateLegacyStorageValue(
  storage,
  baseKey,
  { target = globalThis, allowRoles = [] } = {}
) {
  const partitionedKey = partitionedStorageKey(baseKey, target);
  const existing = storage?.getItem?.(partitionedKey);
  if (existing != null) return existing;
  const legacy = storage?.getItem?.(baseKey);
  if (legacy == null) return null;
  const role = readCurrentDesktopIdentityContext(target).activeRole;
  const allowed = allowRoles === 'all'
    || (Array.isArray(allowRoles) && allowRoles.includes(role));
  if (!allowed) return null;
  storage?.setItem?.(partitionedKey, legacy);
  return legacy;
}
