import { courseRoomDraftDependencies } from './authorityDraftDependencies.mjs';

function authorityClientError(code) {
  return Object.assign(new Error(code), { code });
}

export function createDesktopAuthorityClient({
  outbox,
  createCloudQuestionCommand = null,
  submitCloudQuestion = null,
  createCloudBusinessCommand = null,
  submitCloudBusiness = null,
} = {}) {
  if (!outbox || typeof outbox.append !== 'function' || typeof outbox.get !== 'function') {
    throw authorityClientError('DESKTOP_AUTHORITY_CLIENT_DEPENDENCY_REQUIRED');
  }
  if ((createCloudQuestionCommand !== null && typeof createCloudQuestionCommand !== 'function')
    || (submitCloudQuestion !== null && typeof submitCloudQuestion !== 'function')
    || (createCloudBusinessCommand !== null && typeof createCloudBusinessCommand !== 'function')
    || (submitCloudBusiness !== null && typeof submitCloudBusiness !== 'function')) {
    throw authorityClientError('DESKTOP_AUTHORITY_CLIENT_DEPENDENCY_REQUIRED');
  }

  function cloudQuestionDraft(draft) {
    return /^(question|taxonomy-system|taxonomy-node)\.(create|update|delete)\.v[1-9][0-9]*$/.test(String(draft?.type || ''));
  }

  function cloudBusinessDraft(draft) {
    return /^(student|course|schedule|teacher|room|institution|school|payment|consumption|grade|personal-asset-record|personal-asset-category)\.(create|update|delete)\.v[1-9][0-9]*$/.test(String(draft?.type || ''));
  }

  function unregisteredBusinessMutation(draft) {
    return /^[a-z][a-z0-9-]*\.(create|update|delete)\.v[1-9][0-9]*$/.test(String(draft?.type || ''));
  }

  async function submitCloudDraft(id, draft, options, createCommand, submitCommand, transportUsed, unavailableCode, invalidCode) {
    if (!createCommand || !submitCommand) throw authorityClientError(unavailableCode);
    let command;
    if (draft.status === 'confirmed') {
      command = await createCommand(draft);
      if (!command || command.commandId !== draft.id || command.type !== draft.type
        || command.payload !== draft.payload || typeof command.payloadHash !== 'string') {
        throw authorityClientError(invalidCode);
      }
      await outbox.markSubmitted(id, { commandId: command.commandId, payloadHash: command.payloadHash, transportUsed, command });
    } else if (draft.status === 'submitted' && draft.submission?.command) {
      command = draft.submission.command;
    } else {
      throw authorityClientError('AUTHORITY_DRAFT_NOT_SUBMITTABLE');
    }
    const receipt = await submitCommand(command, options);
    const acknowledged = await outbox.acknowledge(id, receipt);
    return Object.freeze({ command, receipt, transportUsed, rejected: acknowledged?.status === 'conflict' && receipt?.status === 'rejected' });
  }

  async function appendDraft(draft) {
    return outbox.append(draft);
  }

  async function submit(id, options = {}) {
    const draft = await outbox.get(id);
    if (draft.status === 'awaiting_confirmation') return undefined;
    const dependencies = courseRoomDraftDependencies(draft, await outbox.list());
    for (const dependency of dependencies) {
      if (dependency.status === 'awaiting_confirmation') throw authorityClientError('AUTHORITY_DRAFT_DEPENDENCY_CONFIRMATION_REQUIRED');
      await submit(dependency.id, options);
      if ((await outbox.get(dependency.id)).status !== 'completed') throw authorityClientError('AUTHORITY_DRAFT_DEPENDENCY_BLOCKED');
    }
    if (cloudQuestionDraft(draft)) {
      return submitCloudDraft(id, draft, options, createCloudQuestionCommand, submitCloudQuestion,
        'cloud-question-authority', 'CLOUD_QUESTION_AUTHORITY_UNAVAILABLE', 'CLOUD_QUESTION_COMMAND_INVALID');
    }
    if (cloudBusinessDraft(draft)) {
      return submitCloudDraft(id, draft, options, createCloudBusinessCommand, submitCloudBusiness,
        'cloud-business-authority', 'CLOUD_BUSINESS_AUTHORITY_UNAVAILABLE', 'CLOUD_BUSINESS_COMMAND_INVALID');
    }
    if (unregisteredBusinessMutation(draft)) {
      throw authorityClientError('CLOUD_BUSINESS_DRAFT_MAPPING_REQUIRED');
    }
    throw authorityClientError('CLOUD_AUTHORITY_DRAFT_TYPE_UNSUPPORTED');
  }

  async function confirmAndSubmit(id, options = {}, confirmation) {
    const draft = await outbox.get(id);
    const dependencies = courseRoomDraftDependencies(draft, await outbox.list());
    if (dependencies.length && !confirmation) throw authorityClientError('AUTHORITY_DRAFT_DEPENDENCY_CONFIRMATION_REQUIRED');
    if (confirmation) {
      const expectedIds = [...dependencies.map(item => item.id), id];
      if (!Array.isArray(confirmation.items)
        || JSON.stringify(confirmation.items.map(item => item?.id)) !== JSON.stringify(expectedIds)) {
        throw authorityClientError('AUTHORITY_DRAFT_CONFIRMATION_CHANGED');
      }
      await outbox.confirmBatch(confirmation.items);
    } else {
      await outbox.confirm(id);
    }
    return submit(id, options);
  }

  return Object.freeze({
    appendDraft,
    confirmAndSubmit,
    get: id => outbox.get(id),
    list: () => outbox.list(),
    submit,
  });
}

export { authorityClientError };
