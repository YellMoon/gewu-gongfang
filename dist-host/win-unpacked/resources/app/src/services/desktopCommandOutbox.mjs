function outboxError(code) {
  return Object.assign(new Error(code), { code });
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function validDraft(input) {
  return input && typeof input === 'object' && !Array.isArray(input)
    && /^[a-z][a-z0-9_.-]*\.v[1-9][0-9]*$/.test(String(input.type || ''))
    && input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload);
}

export function createDesktopCommandOutbox({
  store,
  codec,
  createId = () => globalThis.crypto?.randomUUID?.(),
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof store?.read !== 'function' || typeof store?.write !== 'function'
    || typeof codec?.seal !== 'function' || typeof codec?.open !== 'function') {
    throw outboxError('AUTHORITY_OUTBOX_SECURE_STORAGE_REQUIRED');
  }

  async function load() {
    const sealed = await store.read();
    if (!sealed) return { protocol: 'gewu.authority-outbox.v1', items: {} };
    const state = await codec.open(sealed);
    if (state?.protocol !== 'gewu.authority-outbox.v1'
      || !state.items || typeof state.items !== 'object' || Array.isArray(state.items)) {
      throw outboxError('AUTHORITY_OUTBOX_CORRUPT');
    }
    return state;
  }

  async function save(state) {
    await store.write(await codec.seal(state));
  }

  async function itemFor(id) {
    const state = await load();
    const item = state.items[String(id || '')];
    if (!item) throw outboxError('AUTHORITY_OUTBOX_ITEM_NOT_FOUND');
    return { state, item };
  }

  async function append(input) {
    if (!validDraft(input)) throw outboxError('AUTHORITY_DRAFT_INVALID');
    const id = String(createId() || '').trim();
    const createdAt = new Date(now()).toISOString();
    if (!id || !Number.isFinite(Date.parse(createdAt))) throw outboxError('AUTHORITY_DRAFT_ID_OR_CLOCK_INVALID');
    const state = await load();
    if (state.items[id]) throw outboxError('AUTHORITY_DRAFT_ID_CONFLICT');
    state.items[id] = {
      id,
      type: input.type,
      payload: clone(input.payload),
      preview: clone(input.preview || {}),
      status: 'awaiting_confirmation',
      createdAt,
      updatedAt: createdAt,
      confirmation: null,
      submission: null,
      receipt: null,
      conflict: null,
    };
    await save(state);
    return clone(state.items[id]);
  }

  async function get(id) {
    return clone((await itemFor(id)).item);
  }

  async function list() {
    const state = await load();
    return Object.values(state.items).map(clone);
  }

  async function confirm(id) {
    const { state, item } = await itemFor(id);
    if (item.status !== 'awaiting_confirmation') {
      throw outboxError('AUTHORITY_DRAFT_CONFIRMATION_STATE_INVALID');
    }
    const confirmedAt = new Date(now()).toISOString();
    item.status = 'confirmed';
    item.confirmation = { confirmedAt };
    item.updatedAt = confirmedAt;
    await save(state);
    return clone(item);
  }

  async function markSubmitted(id, submission) {
    const { state, item } = await itemFor(id);
    if (item.status !== 'confirmed') throw outboxError('AUTHORITY_DRAFT_NOT_CONFIRMED');
    if (!submission?.commandId || !submission?.payloadHash || !submission?.transportUsed) {
      throw outboxError('AUTHORITY_SUBMISSION_INVALID');
    }
    item.status = 'submitted';
    item.submission = clone(submission);
    item.updatedAt = new Date(now()).toISOString();
    await save(state);
    return clone(item);
  }

  async function recordTransport(id, transportUsed) {
    const { state, item } = await itemFor(id);
    if (item.status !== 'submitted' || !item.submission) {
      throw outboxError('AUTHORITY_SUBMISSION_STATE_INVALID');
    }
    const name = String(transportUsed || '').trim();
    if (!name) throw outboxError('AUTHORITY_SUBMISSION_INVALID');
    item.submission.transportUsed = name;
    item.updatedAt = new Date(now()).toISOString();
    await save(state);
    return clone(item);
  }

  async function acknowledge(id, receipt) {
    const { state, item } = await itemFor(id);
    const expected = item.submission;
    if (!expected || receipt?.commandId !== expected.commandId
      || receipt?.payloadHash !== expected.payloadHash
      || !receipt?.resultHash) {
      item.status = 'conflict';
      item.conflict = {
        code: 'AUTHORITY_RECEIPT_CONFLICT',
        received: clone(receipt || null),
      };
      item.updatedAt = new Date(now()).toISOString();
      await save(state);
      throw outboxError('AUTHORITY_RECEIPT_CONFLICT');
    }
    if (receipt.status === 'rejected') {
      item.status = 'conflict';
      item.receipt = clone(receipt);
      item.conflict = {
        code: String(
          receipt?.result?.error?.code || 'AUTHORITY_COMMAND_REJECTED',
        ),
        received: clone(receipt),
      };
      item.updatedAt = new Date(now()).toISOString();
      await save(state);
      return clone(item);
    }
    item.status = 'completed';
    item.receipt = clone(receipt);
    item.updatedAt = new Date(now()).toISOString();
    await save(state);
    return clone(item);
  }

  return Object.freeze({
    acknowledge,
    append,
    confirm,
    get,
    list,
    markSubmitted,
    recordTransport,
  });
}

export { outboxError };
