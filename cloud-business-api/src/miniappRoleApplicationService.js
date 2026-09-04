'use strict';

function invalid() {
  return Object.assign(new Error('role application input is invalid'), { code: 'CLOUD_ROLE_APPLICATION_INVALID' });
}

function denied() {
  return Object.assign(new Error('role application access is denied'), { code: 'CLOUD_ROLE_APPLICATION_ACCESS_DENIED' });
}

function text(value, maximum = 128) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= maximum
    ? value
    : null;
}

function profileName(value) {
  const normalized = text(value, 64);
  return normalized && !/[\u0000-\u001f\u007f]/u.test(normalized) ? normalized : null;
}

function profilePhone(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\s+-]/gu, '');
  const mainland = normalized.startsWith('86') && normalized.length === 13 ? normalized.slice(2) : normalized;
  return /^1[3-9][0-9]{9}$/u.test(mainland) ? mainland : null;
}

function asIsoDate(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw invalid();
  return value.toISOString();
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw invalid();
  return value;
}

function applicationState(application) {
  if (!application) return 'not_submitted';
  if (['submitted', 'approved', 'rejected'].includes(application.status)) return application.status;
  throw invalid();
}

function createMiniappRoleApplicationService(config) {
  const settings = exact(config, ['now', 'randomId', 'phoneHash', 'cloudAccount', 'repository']);
  if (typeof settings.now !== 'function' || typeof settings.randomId !== 'function' || typeof settings.phoneHash !== 'function'
    || !settings.cloudAccount || typeof settings.cloudAccount.context !== 'function'
    || !settings.repository || typeof settings.repository.readLatest !== 'function' || typeof settings.repository.submit !== 'function'
    || typeof settings.repository.listSubmitted !== 'function' || typeof settings.repository.review !== 'function') throw invalid();

  async function visitor(token) {
    const value = text(token, 8192);
    if (!value) throw denied();
    const context = await settings.cloudAccount.context({ token: value });
    if (!context || !text(context.accountId, 512) || !Array.isArray(context.roles) || context.roles.length !== 0) throw denied();
    return { accountId: context.accountId };
  }

  async function mine({ token }) {
    const account = await visitor(token);
    const application = await settings.repository.readLatest({ accountId: account.accountId });
    return { state: applicationState(application), application };
  }

  function desktopReviewer(actor) {
    if (!actor || typeof actor !== 'object' || Array.isArray(actor)
      || !text(actor.accountId, 512) || !Array.isArray(actor.roles)
      || !actor.roles.includes('super_admin')) throw denied();
    return { accountId: actor.accountId };
  }

  async function reviewApplication({ actor, applicationId, decision, profileId }) {
    const normalizedApplicationId = text(applicationId, 128);
    const normalizedDecision = text(decision, 16);
    const normalizedProfileId = profileId === null ? null : text(profileId, 128);
    if (!normalizedApplicationId || !['approved', 'rejected'].includes(normalizedDecision)
      || (normalizedDecision === 'approved' && profileId !== null && !normalizedProfileId)
      || (normalizedDecision === 'rejected' && profileId !== null)) throw invalid();
    const reviewedAt = asIsoDate(settings.now());
    const application = await settings.repository.review({
      applicationId: normalizedApplicationId, decision: normalizedDecision, profileId: normalizedProfileId,
      reviewedAt, reviewerAccountId: actor.accountId,
    });
    return { state: applicationState(application), application };
  }

  async function listSubmittedForDesktop({ actor }) {
    desktopReviewer(actor);
    return { applications: await settings.repository.listSubmitted() };
  }

  async function reviewForDesktop({ actor, applicationId, decision, profileId }) {
    return reviewApplication({ actor: desktopReviewer(actor), applicationId, decision, profileId });
  }

  async function submit(input) {
    const value = exact(input, ['token', 'idempotencyKey', 'requestedIdentity', 'profileMode', 'profileName', 'profilePhone']);
    const account = await visitor(value.token);
    const idempotencyKey = text(value.idempotencyKey, 256);
    const requestedIdentity = text(value.requestedIdentity, 32);
    const profileMode = text(value.profileMode, 16);
    const normalizedProfileName = profileName(value.profileName);
    const normalizedProfilePhone = profilePhone(value.profilePhone);
    if (!idempotencyKey || !['teacher', 'student', 'family_member'].includes(requestedIdentity)
      || !['existing', 'new'].includes(profileMode) || (requestedIdentity === 'family_member' && profileMode !== 'existing')
      || !normalizedProfileName || !normalizedProfilePhone) throw invalid();
    const submittedAt = asIsoDate(settings.now());
    const applicationId = text(settings.randomId('role_application'), 128);
    const requestedProfileId = profileMode === 'new' ? text(settings.randomId(`${requestedIdentity}_profile`), 128) : null;
    let profilePhoneHmac;
    try {
      profilePhoneHmac = settings.phoneHash(normalizedProfilePhone);
    } catch (_) {
      throw invalid();
    }
    if (!applicationId || (profileMode === 'new' && !requestedProfileId) || !/^[0-9a-f]{64}$/u.test(profilePhoneHmac)) throw invalid();
    const application = await settings.repository.submit({
      accountId: account.accountId,
      applicationId,
      idempotencyKey,
      requestedIdentity,
      profileMode,
      profileName: normalizedProfileName,
      profilePhone: normalizedProfilePhone,
      profilePhoneHmac,
      requestedProfileId,
      submittedAt,
    });
    return { state: applicationState(application), application };
  }

  return Object.freeze({ mine, submit, listSubmittedForDesktop, reviewForDesktop });
}

module.exports = Object.freeze({ createMiniappRoleApplicationService });
