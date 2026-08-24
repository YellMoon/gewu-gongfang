'use strict';

const DEFAULT_RUNTIME_DATABASE_USER = 'gewu_cloud_schedule_reader';

function resolveRuntimeDatabaseUser(value) {
  const user = typeof value === 'string' && value.trim()
    ? value.trim()
    : DEFAULT_RUNTIME_DATABASE_USER;
  if (!/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/u.test(user)) {
    throw new Error('CLOUD_RUNTIME_DATABASE_USER_INVALID');
  }
  return user;
}

module.exports = Object.freeze({ DEFAULT_RUNTIME_DATABASE_USER, resolveRuntimeDatabaseUser });
