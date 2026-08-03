const RECORD_FIELDS = new Set([
  'id', 'account_id', 'date', 'type', 'category_id', 'category_name', 'amount',
  'student_id', 'student_name', 'note',
]);
const RECORD_CHANGE_FIELDS = new Set([...RECORD_FIELDS].filter(key => key !== 'id'));
const CATEGORY_FIELDS = new Set(['id', 'name', 'type', 'color']);

function assetRecordError(code, statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
}

function requiredText(value, code, maxLength = 256) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maxLength) throw assetRecordError(code);
  return normalized;
}

function optionalText(value, code, maxLength = 256) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, code, maxLength);
}

function requireExactFields(value, allowed, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.has(key))) {
    throw assetRecordError(code);
  }
  return value;
}

function actorId(actor = {}) {
  return requiredText(actor.userId || actor.id, 'ASSET_RECORD_ACTOR_REQUIRED');
}

function recordType(value) {
  const normalized = String(value || '').trim();
  if (!['income', 'expense'].includes(normalized)) {
    throw assetRecordError('ASSET_RECORD_TYPE_INVALID');
  }
  return normalized;
}

function amount(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw assetRecordError('ASSET_RECORD_AMOUNT_INVALID');
  }
  return normalized;
}

function recordDate(value) {
  const normalized = requiredText(value, 'ASSET_RECORD_DATE_REQUIRED', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)
    || !Number.isFinite(Date.parse(`${normalized}T00:00:00.000Z`))) {
    throw assetRecordError('ASSET_RECORD_DATE_INVALID');
  }
  return normalized;
}

function projectRecord(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.record_id,
    authorityId: row.authority_id,
    ownerUserId: row.owner_user_id,
    accountId: row.account_id,
    date: row.record_date,
    type: row.record_type,
    categoryId: row.category_id || null,
    categoryName: row.category_name || null,
    amount: Number(row.amount),
    studentId: row.student_id || null,
    studentName: row.student_name || null,
    note: row.note || null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function projectCategory(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.category_id,
    authorityId: row.authority_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    type: row.category_type,
    color: row.color || null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function createPersonalAssetRecordService({
  db,
  now = () => new Date().toISOString(),
} = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw assetRecordError('ASSET_RECORD_DATABASE_REQUIRED', 500);
  }
  const findRecord = db.prepare('SELECT * FROM personal_asset_records WHERE record_id=?');
  const findCategory = db.prepare('SELECT * FROM personal_asset_categories WHERE category_id=?');
  const findAccount = db.prepare('SELECT * FROM asset_accounts WHERE account_id=?');

  function currentTime() {
    const timestamp = new Date(now());
    if (!Number.isFinite(timestamp.getTime())) {
      throw assetRecordError('ASSET_RECORD_CLOCK_INVALID', 500);
    }
    return timestamp.toISOString();
  }

  function ensureAccount({ authorityId, ownerUserId, accountId }) {
    const requested = String(accountId || '').trim();
    const id = requested || `personal-ledger:${authorityId}:${ownerUserId}`;
    let row = findAccount.get(id);
    if (!row && requested) throw assetRecordError('ASSET_RECORD_ACCOUNT_NOT_FOUND', 404);
    if (!row) {
      const timestamp = currentTime();
      db.prepare(`INSERT INTO asset_accounts
        (account_id,authority_id,owner_user_id,account_type,provider,label,masked_identifier,balance,currency,status,created_at,updated_at)
        VALUES(?,?,?,'custom',NULL,'个人资产',NULL,0,'CNY','active',?,?)`)
        .run(id, authorityId, ownerUserId, timestamp, timestamp);
      row = findAccount.get(id);
    }
    if (row.authority_id !== authorityId || row.owner_user_id !== ownerUserId
      || row.status !== 'active') {
      throw assetRecordError('ASSET_RECORD_ACCOUNT_FORBIDDEN', 403);
    }
    return row;
  }

  function verifyCategory({ categoryId, authorityId, ownerUserId }) {
    if (!categoryId) return null;
    const category = findCategory.get(categoryId);
    if (!category) throw assetRecordError('ASSET_RECORD_CATEGORY_NOT_FOUND', 404);
    if (category.authority_id !== authorityId || category.owner_user_id !== ownerUserId
      || category.status !== 'active') {
      throw assetRecordError('ASSET_RECORD_CATEGORY_FORBIDDEN', 403);
    }
    return category;
  }

  function create({ actor, authorityId, record } = {}) {
    const owner = actorId(actor);
    const authority = requiredText(authorityId, 'ASSET_RECORD_AUTHORITY_REQUIRED');
    const input = requireExactFields(record, RECORD_FIELDS, 'ASSET_RECORD_FIELD_FORBIDDEN');
    const id = requiredText(input.id, 'ASSET_RECORD_ID_REQUIRED');
    if (findRecord.get(id)) throw assetRecordError('ASSET_RECORD_ID_CONFLICT', 409);
    const account = ensureAccount({
      authorityId: authority,
      ownerUserId: owner,
      accountId: input.account_id,
    });
    const categoryId = optionalText(input.category_id, 'ASSET_RECORD_CATEGORY_INVALID');
    const category = verifyCategory({ categoryId, authorityId: authority, ownerUserId: owner });
    const timestamp = currentTime();
    db.prepare(`INSERT INTO personal_asset_records
      (record_id,authority_id,owner_user_id,account_id,record_date,record_type,
       category_id,category_name,amount,student_id,student_name,note,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`)
      .run(
        id,
        authority,
        owner,
        account.account_id,
        recordDate(input.date),
        recordType(input.type),
        categoryId,
        optionalText(input.category_name, 'ASSET_RECORD_CATEGORY_NAME_INVALID')
          || category?.name || null,
        amount(input.amount),
        optionalText(input.student_id, 'ASSET_RECORD_STUDENT_INVALID'),
        optionalText(input.student_name, 'ASSET_RECORD_STUDENT_NAME_INVALID'),
        optionalText(input.note, 'ASSET_RECORD_NOTE_INVALID', 2000),
        timestamp,
        timestamp,
      );
    return projectRecord(findRecord.get(id));
  }

  function update({ actor, id, changes } = {}) {
    const owner = actorId(actor);
    const recordId = requiredText(id, 'ASSET_RECORD_ID_REQUIRED');
    const existing = findRecord.get(recordId);
    if (!existing) throw assetRecordError('ASSET_RECORD_NOT_FOUND', 404);
    if (existing.owner_user_id !== owner) {
      throw assetRecordError('ASSET_RECORD_FORBIDDEN', 403);
    }
    const input = requireExactFields(changes, RECORD_CHANGE_FIELDS, 'ASSET_RECORD_FIELD_FORBIDDEN');
    if (Object.keys(input).length === 0) throw assetRecordError('ASSET_RECORD_CHANGES_REQUIRED');
    const account = Object.hasOwn(input, 'account_id')
      ? ensureAccount({
        authorityId: existing.authority_id,
        ownerUserId: owner,
        accountId: input.account_id,
      })
      : findAccount.get(existing.account_id);
    const categoryId = Object.hasOwn(input, 'category_id')
      ? optionalText(input.category_id, 'ASSET_RECORD_CATEGORY_INVALID')
      : existing.category_id;
    const category = verifyCategory({
      categoryId,
      authorityId: existing.authority_id,
      ownerUserId: owner,
    });
    db.prepare(`UPDATE personal_asset_records SET
      account_id=?,record_date=?,record_type=?,category_id=?,category_name=?,amount=?,
      student_id=?,student_name=?,note=?,updated_at=? WHERE record_id=?`)
      .run(
        account.account_id,
        Object.hasOwn(input, 'date') ? recordDate(input.date) : existing.record_date,
        Object.hasOwn(input, 'type') ? recordType(input.type) : existing.record_type,
        categoryId,
        Object.hasOwn(input, 'category_name')
          ? optionalText(input.category_name, 'ASSET_RECORD_CATEGORY_NAME_INVALID')
          : (existing.category_name || category?.name || null),
        Object.hasOwn(input, 'amount') ? amount(input.amount) : Number(existing.amount),
        Object.hasOwn(input, 'student_id')
          ? optionalText(input.student_id, 'ASSET_RECORD_STUDENT_INVALID') : existing.student_id,
        Object.hasOwn(input, 'student_name')
          ? optionalText(input.student_name, 'ASSET_RECORD_STUDENT_NAME_INVALID') : existing.student_name,
        Object.hasOwn(input, 'note')
          ? optionalText(input.note, 'ASSET_RECORD_NOTE_INVALID', 2000) : existing.note,
        currentTime(),
        recordId,
      );
    return projectRecord(findRecord.get(recordId));
  }

  function remove({ actor, id } = {}) {
    const owner = actorId(actor);
    const recordId = requiredText(id, 'ASSET_RECORD_ID_REQUIRED');
    const existing = findRecord.get(recordId);
    if (!existing) throw assetRecordError('ASSET_RECORD_NOT_FOUND', 404);
    if (existing.owner_user_id !== owner) {
      throw assetRecordError('ASSET_RECORD_FORBIDDEN', 403);
    }
    db.prepare("UPDATE personal_asset_records SET status='deleted',updated_at=? WHERE record_id=?")
      .run(currentTime(), recordId);
    return projectRecord(findRecord.get(recordId));
  }

  function createCategory({ actor, authorityId, record } = {}) {
    const owner = actorId(actor);
    const authority = requiredText(authorityId, 'ASSET_RECORD_AUTHORITY_REQUIRED');
    const input = requireExactFields(record, CATEGORY_FIELDS, 'ASSET_CATEGORY_FIELD_FORBIDDEN');
    const id = requiredText(input.id, 'ASSET_CATEGORY_ID_REQUIRED');
    if (findCategory.get(id)) throw assetRecordError('ASSET_CATEGORY_ID_CONFLICT', 409);
    const timestamp = currentTime();
    db.prepare(`INSERT INTO personal_asset_categories
      (category_id,authority_id,owner_user_id,name,category_type,color,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'active',?,?)`)
      .run(
        id,
        authority,
        owner,
        requiredText(input.name, 'ASSET_CATEGORY_NAME_REQUIRED'),
        recordType(input.type),
        optionalText(input.color, 'ASSET_CATEGORY_COLOR_INVALID', 32),
        timestamp,
        timestamp,
      );
    return projectCategory(findCategory.get(id));
  }

  function deleteCategory({ actor, id } = {}) {
    const owner = actorId(actor);
    const categoryId = requiredText(id, 'ASSET_CATEGORY_ID_REQUIRED');
    const existing = findCategory.get(categoryId);
    if (!existing) throw assetRecordError('ASSET_CATEGORY_NOT_FOUND', 404);
    if (existing.owner_user_id !== owner) {
      throw assetRecordError('ASSET_CATEGORY_FORBIDDEN', 403);
    }
    db.prepare("UPDATE personal_asset_categories SET status='deleted',updated_at=? WHERE category_id=?")
      .run(currentTime(), categoryId);
    return projectCategory(findCategory.get(categoryId));
  }

  return Object.freeze({
    create,
    update,
    delete: remove,
    createCategory,
    deleteCategory,
  });
}

module.exports = {
  assetRecordError,
  createPersonalAssetRecordService,
};
