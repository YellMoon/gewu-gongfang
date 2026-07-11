function resolveBackendPort(env = process.env) {
  const explicit = Number(env.PORT);
  if (Number.isInteger(explicit) && explicit > 0 && explicit <= 65535) return explicit;

  const runtime = String(env.APP_ENV || env.SCHEDULE_ENV || env.NODE_ENV || 'dev').toLowerCase();
  return runtime === 'prod' || runtime === 'production' ? 3002 : 3001;
}

module.exports = { resolveBackendPort };
