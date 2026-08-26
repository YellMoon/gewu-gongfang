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
  const settings = exact(config, ['now', 'randomId', 'cloudAccount', 'repository']);
  if (typeof settings.now !== 'function' || typeof settings.randomId !== 'function'
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
      || (normalizedDecision === 'approved' && !normalizedProfileId) || (normalizedDecision === 'rejected' && profileId !== null)) throw invalid();
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
    const value = exact(input, ['token', 'idempotencyKey', 'requestedIdentity', 'profileMode', 'bindingHint']);
    const account = await visitor(value.token);
    const idempotencyKey = text(value.idempotencyKey, 256);
    const requestedIdentity = text(value.requestedIdentity, 32);
    const profileMode = text(value.profileMode, 16);
    const bindingHint = value.bindingHint === null ? null : (typeof value.bindingHint === 'string' && value.bindingHint === value.bindingHint.trim() && value.bindingHint.length <= 128 ? value.bindingHint || null : undefined);
    if (!idempotencyKey || !['teacher', 'student', 'family_member'].includes(requestedIdentity)
      || !['existing', 'new'].includes(profileMode) || (requestedIdentity === 'family_member' && profileMode !== 'existing')
      || bindingHint === undefined || !bindingHint) throw invalid();
    const submittedAt = asIsoDate(settings.now());
    const applicationId = text(settings.randomId('role_application'), 128);
    if (!applicationId) throw invalid();
    const application = await settings.repository.submit({
      accountId: account.accountId,
      applicationId,
      idempotencyKey,
      requestedIdentity,
      profileMode,
      bindingHint,
      submittedAt,
    });
    return { state: applicationState(application), application };
  }

  return Object.freeze({ mine, submit, listSubmittedForDesktop, reviewForDesktop });
}

module.exports = Object.freeze({ createMiniappRoleApplicationService });
