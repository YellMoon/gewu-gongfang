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
} = {}) {
  if (!outbox || typeof outbox.append !== 'function' || typeof outbox.get !== 'function'
    || typeof createEnvelope !== 'function' || typeof transports?.submit !== 'function') {
    throw authorityClientError('DESKTOP_AUTHORITY_CLIENT_DEPENDENCY_REQUIRED');
  }
  if ((createCloudQuestionCommand !== null && typeof createCloudQuestionCommand !== 'function')
    || (submitCloudQuestion !== null && typeof submitCloudQuestion !== 'function')) {
    throw authorityClientError('DESKTOP_AUTHORITY_CLIENT_DEPENDENCY_REQUIRED');
  }

  function cloudQuestionDraft(draft) {
    return /^question\.(create|update|delete)\.v[1-9][0-9]*$/.test(String(draft?.type || ''));
  }

  async function appendDraft(draft) {
    return outbox.append(draft);
  }

  async function submit(id, options = {}) {
    const draft = await outbox.get(id);
    if (draft.status === 'awaiting_confirmation') return undefined;
    if (cloudQuestionDraft(draft)) {
      if (!createCloudQuestionCommand || !submitCloudQuestion) {
        throw authorityClientError('CLOUD_QUESTION_AUTHORITY_UNAVAILABLE');
      }
      let command;
      if (draft.status === 'confirmed') {
        command = await createCloudQuestionCommand(draft);
        if (!command || command.commandId !== draft.id || command.type !== draft.type
          || command.payload !== draft.payload || typeof command.payloadHash !== 'string') {
          throw authorityClientError('CLOUD_QUESTION_COMMAND_INVALID');
        }
        await outbox.markSubmitted(id, {
          commandId: command.commandId,
          payloadHash: command.payloadHash,
          transportUsed: 'cloud-question-authority',
          command,
        });
      } else if (draft.status === 'submitted' && draft.submission?.command) {
        command = draft.submission.command;
      } else {
        throw authorityClientError('AUTHORITY_DRAFT_NOT_SUBMITTABLE');
      }
      const receipt = await submitCloudQuestion(command, options);
      const acknowledged = await outbox.acknowledge(id, receipt);
      return Object.freeze({
        command,
        receipt,
        transportUsed: 'cloud-question-authority',
        rejected: acknowledged?.status === 'conflict' && receipt?.status === 'rejected',
      });
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

  function requireLocalExecutor(executeLocalDraft) {
    if (typeof executeLocalDraft !== 'function') {
      throw authorityClientError('PRIMARY_HOST_LOCAL_DRAFT_EXECUTOR_REQUIRED');
    }
    return executeLocalDraft;
  }

  async function submitLocal(id, executeLocalDraft) {
    const execute = requireLocalExecutor(executeLocalDraft);
    const draft = await outbox.get(id);
    if (!['confirmed', 'submitted'].includes(draft.status)) {
      throw authorityClientError('AUTHORITY_DRAFT_NOT_SUBMITTABLE');
    }
    const executed = await execute({
      type: draft.type,
      payload: draft.payload,
      commandId: draft.id,
      idempotencyKey: draft.id,
    });
    const command = executed?.envelope;
    const receipt = executed?.receipt;
    if (!command?.commandId || !command?.payloadHash || !receipt) {
      throw authorityClientError('PRIMARY_HOST_LOCAL_DRAFT_RESULT_INVALID');
    }
    verifyAuthorityReceipt(command, receipt);
    if (draft.status === 'confirmed') {
      await outbox.markSubmitted(id, {
        commandId: command.commandId,
        payloadHash: command.payloadHash,
        transportUsed: 'primary-host-local',
        command,
      });
    }
    const acknowledged = await outbox.acknowledge(id, receipt);
    return Object.freeze({
      command,
      receipt,
      transportUsed: 'primary-host-local',
      rejected: acknowledged?.status === 'conflict' && receipt.status === 'rejected',
    });
  }

  async function confirmAndExecuteLocal(id, executeLocalDraft) {
    await outbox.confirm(id);
    return submitLocal(id, executeLocalDraft);
  }

  return Object.freeze({
    appendDraft,
    confirmAndExecuteLocal,
    confirmAndSubmit,
    get: id => outbox.get(id),
    list: () => outbox.list(),
    submit,
    submitLocal,
  });
}

export { authorityClientError };
