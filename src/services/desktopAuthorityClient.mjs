import { verifyAuthorityReceipt } from './authorityTransports.mjs';

function authorityClientError(code) {
  return Object.assign(new Error(code), { code });
}

export function createDesktopAuthorityClient({
  outbox,
  createEnvelope,
  transports,
  createCloudQuestionCommand = null,
  submitCloudQuestion = null,
  createCloudBusinessCommand = null,
  submitCloudBusiness = null,
} = {}) {
  if (!outbox || typeof outbox.append !== 'function' || typeof outbox.get !== 'function'
    || typeof createEnvelope !== 'function' || typeof transports?.submit !== 'function') {
    throw authorityClientError('DESKTOP_AUTHORITY_CLIENT_DEPENDENCY_REQUIRED');
  }
  if ((createCloudQuestionCommand !== null && typeof createCloudQuestionCommand !== 'function')
    || (submitCloudQuestion !== null && typeof submitCloudQuestion !== 'function')
    || (createCloudBusinessCommand !== null && typeof createCloudBusinessCommand !== 'function')
    || (submitCloudBusiness !== null && typeof submitCloudBusiness !== 'function')) {
    throw authorityClientError('DESKTOP_AUTHORITY_CLIENT_DEPENDENCY_REQUIRED');
  }

  function cloudQuestionDraft(draft) {
    return /^question\.(create|update|delete)\.v[1-9][0-9]*$/.test(String(draft?.type || ''));
  }

  function cloudBusinessDraft(draft) {
    return /^(student|course|schedule|teacher|room|institution|payment|consumption|grade|personal-asset-record|personal-asset-category)\.(create|update|delete)\.v[1-9][0-9]*$/.test(String(draft?.type || ''));
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
    if (cloudQuestionDraft(draft)) {
      return submitCloudDraft(id, draft, options, createCloudQuestionCommand, submitCloudQuestion,
        'cloud-question-authority', 'CLOUD_QUESTION_AUTHORITY_UNAVAILABLE', 'CLOUD_QUESTION_COMMAND_INVALID');
    }
    if (cloudBusinessDraft(draft)) {
      return submitCloudDraft(id, draft, options, createCloudBusinessCommand, submitCloudBusiness,
        'cloud-business-authority', 'CLOUD_BUSINESS_AUTHORITY_UNAVAILABLE', 'CLOUD_BUSINESS_COMMAND_INVALID');
    }
    let command;
    if (draft.status === 'confirmed') {
      command = await createEnvelope(draft);
      await outbox.markSubmitted(id, {
        commandId: command.commandId,
        payloadHash: command.payloadHash,
        transportUsed: 'pending',
        command,
      });
    } else if (draft.status === 'submitted' && draft.submission?.command) {
      command = draft.submission.command;
    } else {
      throw authorityClientError('AUTHORITY_DRAFT_NOT_SUBMITTABLE');
    }
    const delivered = await transports.submit(command);
    verifyAuthorityReceipt(command, delivered.receipt);
    if (typeof outbox.recordTransport === 'function') {
      await outbox.recordTransport(id, delivered.transportUsed);
    }
    const acknowledged = await outbox.acknowledge(id, delivered.receipt);
    return Object.freeze({
      command,
      receipt: delivered.receipt,
      transportUsed: delivered.transportUsed,
      rejected: acknowledged?.status === 'conflict'
        && delivered.receipt?.status === 'rejected',
    });
  }

  async function confirmAndSubmit(id, options = {}) {
    await outbox.confirm(id);
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
