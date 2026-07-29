import { verifyAuthorityReceipt } from './authorityTransports.mjs';

function authorityClientError(code) {
  return Object.assign(new Error(code), { code });
}

export function createDesktopAuthorityClient({
  outbox,
  createEnvelope,
  transports,
} = {}) {
  if (!outbox || typeof outbox.append !== 'function' || typeof outbox.get !== 'function'
    || typeof createEnvelope !== 'function' || typeof transports?.submit !== 'function') {
    throw authorityClientError('DESKTOP_AUTHORITY_CLIENT_DEPENDENCY_REQUIRED');
  }

  async function appendDraft(draft) {
    return outbox.append(draft);
  }

  async function submit(id) {
    const draft = await outbox.get(id);
    if (draft.status === 'awaiting_confirmation') return undefined;
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

  async function confirmAndSubmit(id) {
    await outbox.confirm(id);
    return submit(id);
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
