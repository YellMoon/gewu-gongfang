'use strict';

const crypto = require('crypto');
const { types } = require('util');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, keys) {
  if (!plainObject(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  return value;
}

function text(value, { nullable = false, max = 1048576 } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > max) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  return value;
}

function json(value, { array = false, nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (array ? !Array.isArray(value) : !plainObject(value)) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  try {
    const serialized = stableJson(value);
    if (serialized.length > 1048576) throw failure('CLOUD_QUESTION_INPUT_INVALID');
    return serialized;
  } catch (error) {
    if (error?.code === 'CLOUD_QUESTION_INPUT_INVALID') throw error;
    throw failure('CLOUD_QUESTION_INPUT_INVALID');
  }
}

function stableJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw failure('CLOUD_QUESTION_INPUT_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item)).join(',')}]`;
  if (!plainObject(value)) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function canonicalContentHash({ stem, answer, explanation, options, richContent }) {
  return crypto.createHash('sha256').update(stableJson({ stem, answer, explanation, options, richContent }), 'utf8').digest('hex');
}

function canonicalHash(value) {
  return crypto.createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

const LEGACY_QUESTION_FIELDS = new Set([
  'id', 'subject', 'subject_id', 'chapter_id', 'type', 'difficulty', 'status',
  'content', 'stem', 'options', 'answer', 'analysis', 'explanation', 'rich_content',
  'knowledge_point_ids', 'model_point_ids', 'taxonomy_ids', 'source', 'year', 'grade',
  'semester', 'exam_type', 'region', 'school', 'edit_status', 'has_image', 'has_formula',
]);

function optionalLegacyText(value, max = 1048576) {
  if (value === undefined || value === null || value === '') return null;
  return text(value, { max });
}

function idList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 4096) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  return value.map(item => text(item, { max: 128 }));
}

function taxonomyMap(value) {
  if (value === undefined || value === null) return {};
  if (Array.isArray(value)) return Object.fromEntries(value.map(id => [text(id, { max: 128 }), []]));
  if (!plainObject(value) || Reflect.ownKeys(value).length > 128) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  const result = {};
  for (const [systemId, nodeIds] of Object.entries(value)) {
    const id = text(systemId, { max: 128 });
    result[id] = idList(nodeIds);
  }
  return result;
}

function sortOrder(value) {
  if (!Number.isSafeInteger(value) || value < -1000000 || value > 1000000) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  return value;
}

function expectedVersion(value) {
  const version = text(value, { max: 64 });
  if (!Number.isFinite(Date.parse(version))) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  return version;
}

function deletionConfirmation(value) {
  const confirmation = exact(value, ['confirmed', 'expectedAffectedQuestionCount']);
  if (confirmation.confirmed !== true || !Number.isSafeInteger(confirmation.expectedAffectedQuestionCount) || confirmation.expectedAffectedQuestionCount < 0) {
    throw failure('CLOUD_QUESTION_INPUT_INVALID');
  }
  return confirmation.expectedAffectedQuestionCount;
}

function taxonomySystem(value, idOverride = null) {
  const record = exact(value, idOverride === null ? ['id', 'subject', 'name', 'sort_order'] : ['subject', 'name', 'sort_order']);
  return {
    id: idOverride === null ? text(record.id, { max: 128 }) : text(idOverride, { max: 128 }),
    subject: text(record.subject, { max: 128 }), name: text(record.name, { max: 256 }), sortOrder: sortOrder(record.sort_order),
  };
}

function taxonomyNode(value, idOverride = null) {
  const record = exact(value, idOverride === null ? ['id', 'system_id', 'parent_id', 'name', 'sort_order'] : ['system_id', 'parent_id', 'name', 'sort_order']);
  return {
    id: idOverride === null ? text(record.id, { max: 128 }) : text(idOverride, { max: 128 }),
    systemId: text(record.system_id, { max: 128 }),
    parentId: record.parent_id === null ? null : text(record.parent_id, { max: 128 }),
    name: text(record.name, { max: 256 }), sortOrder: sortOrder(record.sort_order),
  };
}

function legacyQuestion(record) {
  if (!plainObject(record) || Reflect.ownKeys(record).some(key => !LEGACY_QUESTION_FIELDS.has(key))) {
    throw failure('CLOUD_QUESTION_INPUT_INVALID');
  }
  const stem = typeof record.content === 'string' && record.content.trim()
    ? text(record.content) : text(record.stem);
  const questionType = text(record.type, { max: 128 });
  const difficulty = record.difficulty === undefined ? 3 : record.difficulty;
  if (!Number.isSafeInteger(difficulty) || difficulty < 1 || difficulty > 5) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  const options = record.options === undefined ? [] : record.options;
  if (!Array.isArray(options)) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  const richContent = record.rich_content === undefined || record.rich_content === null ? null : record.rich_content;
  if (richContent !== null && !plainObject(richContent)) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  return {
    id: text(record.id, { max: 128 }), subject: text(record.subject, { max: 128 }), questionType,
    difficulty, stem, answer: optionalLegacyText(record.answer),
    explanation: optionalLegacyText(record.explanation === undefined ? record.analysis : record.explanation),
    options, richContent,
    taxonomy: {
      knowledgePointIds: idList(record.knowledge_point_ids), modelPointIds: idList(record.model_point_ids),
      taxonomyIds: taxonomyMap(record.taxonomy_ids),
    },
    hasFormula: Boolean(record.has_formula),
  };
}

function desktopCommand(value) {
  const command = exact(value, ['commandId', 'payloadHash', 'type', 'payload']);
  const commandId = text(command.commandId, { max: 128 });
  const type = text(command.type, { max: 128 });
  if (!/^(question|taxonomy-system|taxonomy-node)\.(create|update|delete)\.v1$/.test(type)
    || typeof command.payloadHash !== 'string' || !/^[0-9a-f]{64}$/.test(command.payloadHash)) {
    throw failure('CLOUD_QUESTION_INPUT_INVALID');
  }
  const payload = plainObject(command.payload) ? command.payload : null;
  if (!payload || canonicalHash({ type, payload }) !== command.payloadHash) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  if (type === 'question.create.v1') {
    const draft = exact(payload, ['record']);
    return { commandId, payloadHash: command.payloadHash, type, question: legacyQuestion(draft.record) };
  }
  if (type === 'taxonomy-system.create.v1') {
    const draft = exact(payload, ['record']);
    return { commandId, payloadHash: command.payloadHash, type, taxonomy: taxonomySystem(draft.record) };
  }
  if (type === 'taxonomy-node.create.v1') {
    const draft = exact(payload, ['record']);
    return { commandId, payloadHash: command.payloadHash, type, taxonomy: taxonomyNode(draft.record) };
  }
  if (type === 'taxonomy-system.update.v1' || type === 'taxonomy-node.update.v1') {
    const draft = exact(payload, ['id', 'changes', 'expectedVersion']);
    return {
      commandId, payloadHash: command.payloadHash, type, expectedVersion: expectedVersion(draft.expectedVersion),
      taxonomy: type.startsWith('taxonomy-system.') ? taxonomySystem(draft.changes, draft.id) : taxonomyNode(draft.changes, draft.id),
    };
  }
  if (type === 'taxonomy-system.delete.v1') {
    const draft = exact(payload, ['id', 'expectedVersion', 'confirmation']);
    return {
      commandId, payloadHash: command.payloadHash, type, id: text(draft.id, { max: 128 }),
      expectedVersion: expectedVersion(draft.expectedVersion), expectedAffectedQuestionCount: deletionConfirmation(draft.confirmation),
    };
  }
  if (type === 'taxonomy-node.delete.v1') {
    const draft = exact(payload, ['id', 'systemId', 'expectedVersion', 'confirmation']);
    return {
      commandId, payloadHash: command.payloadHash, type, id: text(draft.id, { max: 128 }), systemId: text(draft.systemId, { max: 128 }),
      expectedVersion: expectedVersion(draft.expectedVersion), expectedAffectedQuestionCount: deletionConfirmation(draft.confirmation),
    };
  }
  if (type === 'question.update.v1') {
    if (Reflect.ownKeys(payload).some(key => !['id', 'changes', 'expectedVersion'].includes(key))
      || typeof payload.id !== 'string' || !plainObject(payload.changes)) throw failure('CLOUD_QUESTION_INPUT_INVALID');
    return { commandId, payloadHash: command.payloadHash, type, question: legacyQuestion({ id: payload.id, ...payload.changes }) };
  }
  if (Reflect.ownKeys(payload).some(key => !['id', 'expectedVersion'].includes(key))) throw failure('CLOUD_QUESTION_INPUT_INVALID');
  return { commandId, payloadHash: command.payloadHash, type, id: text(payload.id, { max: 128 }) };
}

function actor(value) {
  if (!plainObject(value) || !Array.isArray(value.roles) || typeof value.accountId !== 'string' || !value.accountId.trim()) throw failure('CLOUD_QUESTION_ACCESS_DENIED');
  if (!value.roles.includes('super_admin') && !value.roles.includes('teacher')) throw failure('CLOUD_QUESTION_ACCESS_DENIED');
  return { accountId: value.accountId, roles: value.roles };
}

function questionRow(row) {
  if (!plainObject(row) || typeof row.id !== 'string' || !row.id || !['draft', 'published', 'archived'].includes(row.status) || !Number.isSafeInteger(Number(row.version)) || Number(row.version) < 1
    || typeof row.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(row.contentHash)) throw failure('CLOUD_QUESTION_UNAVAILABLE');
  return { id: row.id, status: row.status, version: Number(row.version), contentHash: row.contentHash };
}

function questionListRow(row) {
  if (!plainObject(row) || typeof row.id !== 'string' || !row.id || typeof row.subject !== 'string' || !row.subject
    || typeof row.type !== 'string' || !row.type || !Number.isSafeInteger(Number(row.difficulty))
    || !['draft', 'published', 'archived'].includes(row.status) || typeof row.content !== 'string'
    || !Array.isArray(row.options) || !Number.isSafeInteger(Number(row.version)) || Number(row.version) < 1) {
    throw failure('CLOUD_QUESTION_UNAVAILABLE');
  }
  const taxonomy = plainObject(row.taxonomy) ? row.taxonomy : {};
  const knowledgePointIds = idList(taxonomy.knowledgePointIds);
  const modelPointIds = idList(taxonomy.modelPointIds);
  const taxonomyIds = taxonomyMap(taxonomy.taxonomyIds);
  if (row.answer !== null && row.answer !== undefined && typeof row.answer !== 'string') throw failure('CLOUD_QUESTION_UNAVAILABLE');
  if (row.analysis !== null && row.analysis !== undefined && typeof row.analysis !== 'string') throw failure('CLOUD_QUESTION_UNAVAILABLE');
  if (row.rich_content !== null && row.rich_content !== undefined && !plainObject(row.rich_content)) throw failure('CLOUD_QUESTION_UNAVAILABLE');
  if (typeof row.has_formula !== 'boolean') throw failure('CLOUD_QUESTION_UNAVAILABLE');
  if (row.source !== null && row.source !== undefined && typeof row.source !== 'string') throw failure('CLOUD_QUESTION_UNAVAILABLE');
  if (row.knowledgeLabels !== null && row.knowledgeLabels !== undefined && !Array.isArray(row.knowledgeLabels)) throw failure('CLOUD_QUESTION_UNAVAILABLE');
  const knowledgeLabels = Array.isArray(row.knowledgeLabels)
    ? row.knowledgeLabels.filter(label => typeof label === 'string' && label.trim()) : [];
  return {
    id: row.id, subject: row.subject, type: row.type, difficulty: Number(row.difficulty), status: row.status,
    content: row.content, options: row.options, answer: row.answer ?? null, analysis: row.analysis ?? null,
    rich_content: row.rich_content ?? null, knowledge_point_ids: knowledgePointIds, model_point_ids: modelPointIds,
    taxonomy_ids: taxonomyIds, has_formula: row.has_formula, version: Number(row.version),
    source: row.source ?? '', knowledgeLabels,
  };
}

function taxonomyMutationRow(result, entity) {
  if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('CLOUD_QUESTION_UNAVAILABLE');
  const row = result.rows[0];
  if (!plainObject(row) || !['committed', 'conflict', 'impact_changed'].includes(row.outcome)
    || typeof row.id !== 'string' || row.id.length === 0 || !Number.isSafeInteger(Number(row.affectedQuestionCount)) || Number(row.affectedQuestionCount) < 0) {
    throw failure('CLOUD_QUESTION_UNAVAILABLE');
  }
  if (row.outcome !== 'committed') {
    return {
      status: 'rejected',
      result: {
        error: { code: row.outcome === 'impact_changed' ? 'CLOUD_QUESTION_TAXONOMY_DELETE_IMPACT_CHANGED' : 'CLOUD_QUESTION_TAXONOMY_CONFLICT' },
        id: row.id, affectedQuestionCount: Number(row.affectedQuestionCount),
      },
    };
  }
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt || '');
  if (!Number.isFinite(Date.parse(updatedAt))) throw failure('CLOUD_QUESTION_UNAVAILABLE');
  return { status: 'committed', result: { id: row.id, entity, updatedAt, affectedQuestionCount: Number(row.affectedQuestionCount) } };
}

async function executeTaxonomyCommand(command, tenantId, currentQuery) {
  const value = command.taxonomy;
  switch (command.type) {
    case 'taxonomy-system.create.v1':
      return taxonomyMutationRow(await currentQuery(
        'SELECT outcome,id,updated_at AS "updatedAt",affected_question_count AS "affectedQuestionCount" FROM business.vnext_create_question_taxonomy_system_v1($1,$2,$3,$4,$5)',
        [tenantId, value.id, value.subject, value.name, value.sortOrder],
      ), 'taxonomy-system');
    case 'taxonomy-system.update.v1':
      return taxonomyMutationRow(await currentQuery(
        'SELECT outcome,id,updated_at AS "updatedAt",affected_question_count AS "affectedQuestionCount" FROM business.vnext_update_question_taxonomy_system_v1($1,$2,$3::timestamptz,$4,$5,$6)',
        [tenantId, value.id, command.expectedVersion, value.subject, value.name, value.sortOrder],
      ), 'taxonomy-system');
    case 'taxonomy-system.delete.v1':
      return taxonomyMutationRow(await currentQuery(
        'SELECT outcome,id,updated_at AS "updatedAt",affected_question_count AS "affectedQuestionCount" FROM business.vnext_delete_question_taxonomy_system_v1($1,$2,$3::timestamptz,$4)',
        [tenantId, command.id, command.expectedVersion, command.expectedAffectedQuestionCount],
      ), 'taxonomy-system');
    case 'taxonomy-node.create.v1':
      return taxonomyMutationRow(await currentQuery(
        'SELECT outcome,id,updated_at AS "updatedAt",affected_question_count AS "affectedQuestionCount" FROM business.vnext_create_question_taxonomy_node_v1($1,$2,$3,$4,$5,$6)',
        [tenantId, value.id, value.systemId, value.parentId, value.name, value.sortOrder],
      ), 'taxonomy-node');
    case 'taxonomy-node.update.v1':
      return taxonomyMutationRow(await currentQuery(
        'SELECT outcome,id,updated_at AS "updatedAt",affected_question_count AS "affectedQuestionCount" FROM business.vnext_update_question_taxonomy_node_v1($1,$2,$3::timestamptz,$4,$5,$6,$7)',
        [tenantId, value.id, command.expectedVersion, value.systemId, value.parentId, value.name, value.sortOrder],
      ), 'taxonomy-node');
    case 'taxonomy-node.delete.v1':
      return taxonomyMutationRow(await currentQuery(
        'SELECT outcome,id,updated_at AS "updatedAt",affected_question_count AS "affectedQuestionCount" FROM business.vnext_delete_question_taxonomy_node_v1($1,$2,$3::timestamptz,$4,$5)',
        [tenantId, command.id, command.expectedVersion, command.systemId, command.expectedAffectedQuestionCount],
      ), 'taxonomy-node');
    default:
      throw failure('CLOUD_QUESTION_COMMAND_UNSUPPORTED');
  }
}

function createQuestionAuthorityService({ query, transaction } = {}) {
  if (typeof query !== 'function' || typeof transaction !== 'function') throw failure('CLOUD_QUESTION_INPUT_INVALID');
  return Object.freeze({
    async list(input) {
      const request = exact(input, ['tenantId', 'actor', 'limit']);
      const tenantId = text(request.tenantId, { max: 128 });
      actor(request.actor);
      if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 1000) throw failure('CLOUD_QUESTION_INPUT_INVALID');
      const result = await query(
        `SELECT q.id,q.subject,q.question_type AS type,q.difficulty,q.source,q.status,c.stem AS content,c.options_json AS options,
                c.answer,c.explanation AS analysis,c.rich_content_json AS rich_content,q.taxonomy_json AS taxonomy,q.has_formula,c.version,
                COALESCE((
                  SELECT jsonb_agg(DISTINCT n.name ORDER BY n.name)
                  FROM business.question_taxonomy_nodes n
                  JOIN jsonb_each(CASE WHEN jsonb_typeof(q.taxonomy_json->'taxonomyIds')='object' THEN q.taxonomy_json->'taxonomyIds' ELSE '{}'::jsonb END) systems(system_id,node_ids) ON true
                  JOIN jsonb_array_elements_text(CASE WHEN jsonb_typeof(systems.node_ids)='array' THEN systems.node_ids ELSE '[]'::jsonb END) selected(node_id) ON true
                  WHERE n.tenant_id=q.tenant_id AND n.deleted=false AND n.system_id=systems.system_id AND n.id=selected.node_id
                ), '[]'::jsonb) AS "knowledgeLabels"
           FROM business.questions q
           JOIN business.question_contents c ON c.question_id=q.id AND c.tenant_id=q.tenant_id
          WHERE q.tenant_id=$1 AND q.deleted=false AND c.deleted=false
          ORDER BY c.updated_at DESC,q.id ASC LIMIT $2`,
        [tenantId, request.limit],
      );
      if (!result || !Array.isArray(result.rows)) throw failure('CLOUD_QUESTION_UNAVAILABLE');
      return result.rows.map(questionListRow);
    },
    async create(input, currentQuery = query) {
      const request = exact(input, ['tenantId', 'actor', 'question']);
      const tenantId = text(request.tenantId, { max: 128 });
      const currentActor = actor(request.actor);
      const question = exact(request.question, ['id', 'subject', 'questionType', 'difficulty', 'stem', 'answer', 'explanation', 'options', 'richContent', 'taxonomy', 'hasFormula']);
      const id = text(question.id, { max: 128 });
      const subject = text(question.subject, { max: 128 });
      const questionType = text(question.questionType, { max: 128 });
      if (!Number.isSafeInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > 5 || typeof question.hasFormula !== 'boolean') throw failure('CLOUD_QUESTION_INPUT_INVALID');
      const stem = text(question.stem);
      const answer = question.answer === null ? null : text(question.answer, { max: 1048576 });
      const explanation = question.explanation === null ? null : text(question.explanation, { max: 1048576 });
      const options = json(question.options, { array: true });
      const richContent = json(question.richContent, { nullable: true });
      const taxonomy = json(question.taxonomy);
      const contentHash = canonicalContentHash({ stem, answer, explanation, options: JSON.parse(options), richContent: richContent === null ? null : JSON.parse(richContent) });
      const result = await currentQuery(
        `WITH inserted_question AS (
           INSERT INTO business.questions (id,tenant_id,subject,question_type,difficulty,created_by_account_id,taxonomy_json,has_formula)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
           RETURNING id,status
         ), inserted_content AS (
           INSERT INTO business.question_contents (question_id,tenant_id,stem,answer,explanation,options_json,rich_content_json,content_hash)
           SELECT $1,$2,$9,$10,$11,$12::jsonb,$13::jsonb,$14 FROM inserted_question
           RETURNING version,content_hash AS "contentHash"
         ) SELECT q.id,q.status,c.version,c."contentHash" FROM inserted_question q CROSS JOIN inserted_content c`,
        [id, tenantId, subject, questionType, question.difficulty, currentActor.accountId, taxonomy, question.hasFormula, stem, answer, explanation, options, richContent, contentHash],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) throw failure('CLOUD_QUESTION_UNAVAILABLE');
      return questionRow(result.rows[0]);
    },
    async submitDesktopDraft(input) {
      const request = exact(input, ['tenantId', 'actor', 'command']);
      const tenantId = text(request.tenantId, { max: 128 });
      const currentActor = actor(request.actor);
      const command = desktopCommand(request.command);
      return transaction(async transactionQuery => {
      if (typeof transactionQuery !== 'function') throw failure('CLOUD_QUESTION_UNAVAILABLE');
      const previous = await transactionQuery(
        `SELECT payload_hash AS "payloadHash",status,result_json AS result,result_hash AS "resultHash"
         FROM business.desktop_question_command_receipts WHERE tenant_id=$1 AND command_id=$2`,
        [tenantId, command.commandId],
      );
      if (!previous || !Array.isArray(previous.rows)) throw failure('CLOUD_QUESTION_UNAVAILABLE');
      if (previous.rows.length > 1) throw failure('CLOUD_QUESTION_RECEIPT_CONFLICT');
      if (previous.rows.length === 1) {
        const stored = previous.rows[0];
        if (!plainObject(stored) || stored.payloadHash !== command.payloadHash || !['committed', 'rejected'].includes(stored.status)
          || !plainObject(stored.result) || typeof stored.resultHash !== 'string'
          || canonicalHash(stored.result) !== stored.resultHash) {
          throw failure('CLOUD_QUESTION_RECEIPT_CONFLICT');
        }
        return { commandId: command.commandId, payloadHash: command.payloadHash, status: stored.status, result: stored.result, resultHash: stored.resultHash };
      }
      let result;
      let receiptStatus = 'committed';
      if (command.type === 'question.create.v1') {
        result = await this.create({ tenantId, actor: currentActor, question: command.question }, transactionQuery);
      } else if (command.type === 'question.update.v1') {
        const question = command.question;
        const options = json(question.options, { array: true });
        const richContent = json(question.richContent, { nullable: true });
        const taxonomy = json(question.taxonomy);
        const contentHash = canonicalContentHash({ stem: question.stem, answer: question.answer, explanation: question.explanation, options: JSON.parse(options), richContent: richContent === null ? null : JSON.parse(richContent) });
        const updated = await transactionQuery(
          `WITH updated_question AS (
             UPDATE business.questions SET subject=$3,question_type=$4,difficulty=$5,taxonomy_json=$6::jsonb,has_formula=$7,updated_at=transaction_timestamp()
             WHERE id=$1 AND tenant_id=$2 AND deleted=false RETURNING id,status
           ), updated_content AS (
             UPDATE business.question_contents SET stem=$8,answer=$9,explanation=$10,options_json=$11::jsonb,rich_content_json=$12::jsonb,content_hash=$13,version=version+1,updated_at=transaction_timestamp()
             WHERE question_id=$1 AND tenant_id=$2 AND deleted=false RETURNING version,content_hash AS "contentHash"
           ) SELECT q.id,q.status,c.version,c."contentHash" FROM updated_question q CROSS JOIN updated_content c`,
          [question.id, tenantId, question.subject, question.questionType, question.difficulty, taxonomy, question.hasFormula, question.stem, question.answer, question.explanation, options, richContent, contentHash],
        );
        if (!updated || !Array.isArray(updated.rows) || updated.rows.length !== 1) throw failure('CLOUD_QUESTION_UNAVAILABLE');
        result = questionRow(updated.rows[0]);
      } else if (command.type === 'question.delete.v1') {
        const deleted = await transactionQuery(
          `WITH deleted_question AS (
             UPDATE business.questions SET deleted=true,deleted_at=transaction_timestamp(),updated_at=transaction_timestamp()
             WHERE id=$1 AND tenant_id=$2 AND deleted=false RETURNING id,status
           ), deleted_content AS (
             UPDATE business.question_contents SET deleted=true,version=version+1,updated_at=transaction_timestamp()
             WHERE question_id=$1 AND tenant_id=$2 AND deleted=false RETURNING version,content_hash AS "contentHash"
           ) SELECT q.id,q.status,c.version,c."contentHash" FROM deleted_question q CROSS JOIN deleted_content c`,
          [command.id, tenantId],
        );
        if (!deleted || !Array.isArray(deleted.rows) || deleted.rows.length !== 1) throw failure('CLOUD_QUESTION_UNAVAILABLE');
        result = questionRow(deleted.rows[0]);
      } else {
        const taxonomyResult = await executeTaxonomyCommand(command, tenantId, transactionQuery);
        receiptStatus = taxonomyResult.status;
        result = taxonomyResult.result;
      }
      const receipt = {
        commandId: command.commandId, payloadHash: command.payloadHash, status: receiptStatus, result,
        resultHash: canonicalHash(result),
      };
      await transactionQuery(
        `INSERT INTO business.desktop_question_command_receipts
           (tenant_id,command_id,payload_hash,status,result_json,result_hash,actor_account_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
        [tenantId, receipt.commandId, receipt.payloadHash, receipt.status, stableJson(receipt.result), receipt.resultHash, currentActor.accountId],
      );
      return receipt;
      });
    },
  });
}

module.exports = Object.freeze({ createQuestionAuthorityService });
