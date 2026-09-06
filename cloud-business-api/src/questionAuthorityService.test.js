'use strict';

const assert = require('assert');
const crypto = require('crypto');

const { createQuestionAuthorityService } = require('./questionAuthorityService');
const { stableJson } = require('../../shared/authorityProtocol');
require('./questionPagination.test');

function signedCommand(commandId, type, payload) {
  return {
    commandId, type, payload,
    payloadHash: crypto.createHash('sha256').update(stableJson({ type, payload }), 'utf8').digest('hex'),
  };
}

async function main() {
  const calls = [];
  const receipts = new Map();
  let commandTransactions = 0;
  const query = async (text, values) => {
    calls.push([text, values]);
    if (text.includes('FROM business.desktop_question_command_receipts')) {
      const receipt = receipts.get(`${values[0]}:${values[1]}`);
      return { rows: receipt ? [receipt] : [] };
    }
    if (text.includes('INSERT INTO business.desktop_question_command_receipts')) {
      receipts.set(`${values[0]}:${values[1]}`, {
        payloadHash: values[2], status: values[3], result: JSON.parse(values[4]), resultHash: values[5],
      });
      return { rows: [] };
    }
    if (text.includes('vnext_create_question_taxonomy_system_v1')) return { rows: [{ outcome: 'committed', id: values[1], updatedAt: '2026-08-24T05:00:00.000Z', affectedQuestionCount: 0 }] };
    if (text.includes('vnext_update_question_taxonomy_system_v1')) return { rows: [{ outcome: 'committed', id: values[1], updatedAt: '2026-08-24T05:01:00.000Z', affectedQuestionCount: 0 }] };
    if (text.includes('vnext_delete_question_taxonomy_system_v1')) return { rows: [{ outcome: 'committed', id: values[1], updatedAt: '2026-08-24T05:02:00.000Z', affectedQuestionCount: values[3] }] };
    if (text.includes('vnext_create_question_taxonomy_node_v1')) return { rows: [{ outcome: 'committed', id: values[1], updatedAt: '2026-08-24T05:03:00.000Z', affectedQuestionCount: 0 }] };
    if (text.includes('vnext_update_question_taxonomy_node_v1')) return { rows: [{ outcome: 'committed', id: values[1], updatedAt: '2026-08-24T05:04:00.000Z', affectedQuestionCount: 0 }] };
    if (text.includes('vnext_delete_question_taxonomy_node_v1')) return { rows: [{ outcome: 'committed', id: values[1], updatedAt: '2026-08-24T05:05:00.000Z', affectedQuestionCount: values[4] }] };
    if (text.includes('SELECT q.id,q.subject,q.question_type AS type')) {
      return { rows: [{
        id: 'question-1', subject: 'physics', type: 'single_choice', difficulty: 3, status: 'draft',
        content: 'Cloud text', options: ['A'], answer: 'answer', analysis: 'analysis', rich_content: null,
        source: '2026 city mock', knowledgeLabels: ['Dynamics'],
        taxonomy: { knowledgePointIds: [], modelPointIds: [], taxonomyIds: [] }, has_formula: false, version: 1,
      }] };
    }
    return { rows: [{ id: 'question-1', status: 'draft', version: 1, contentHash: 'a'.repeat(64) }] };
  };
  const service = createQuestionAuthorityService({
    query,
    transaction: async work => { commandTransactions += 1; return work(query); },
  });
  const created = await service.create({
    tenantId: 'default',
    actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
    question: {
      id: 'question-1', subject: 'physics', questionType: 'single_choice', difficulty: 3,
      stem: 'What is the unit of force?', answer: 'newton', explanation: null,
      options: ['N', 'J'], richContent: null, taxonomy: { chapter: 'mechanics' }, hasFormula: false,
    },
  });
  assert.deepStrictEqual(created, { id: 'question-1', status: 'draft', version: 1, contentHash: 'a'.repeat(64) });
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0][0].includes('INSERT INTO business.questions') && calls[0][0].includes('INSERT INTO business.question_contents'));
  assert.ok(calls[0][0].includes('created_by_account_id'));
  assert.strictEqual(calls[0][1][0], 'question-1');
  assert.strictEqual(calls[0][1][1], 'default');
  assert.strictEqual(calls[0][1][5], 'teacher-account-1');
  assert.ok(!calls[0][0].match(/oss_url|file_path|data_url|storage_state/iu), 'the text command must not revive local or object-byte authority fields');

  const listed = await service.list({
    tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] }, limit: 200,
  });
  assert.strictEqual(listed.nextCursor, null);
  assert.deepStrictEqual(listed.questions, [{
    id: 'question-1', subject: 'physics', type: 'single_choice', difficulty: 3, status: 'draft',
    content: 'Cloud text', options: ['A'], answer: 'answer', analysis: 'analysis', rich_content: null,
    source: '2026 city mock', knowledgeLabels: ['Dynamics'],
    knowledge_point_ids: [], model_point_ids: [], taxonomy_ids: {}, has_formula: false, version: 1,
  }]);
  assert.ok(calls.some(call => call[0].includes('FROM business.questions q') && call[0].includes('business.question_contents c')),
    'the question list must read cloud structured text only from the cloud authority tables');
  const questionListQuery = calls.find(call => call[0].includes('FROM business.questions q'))[0];
  assert.match(questionListQuery, /taxonomyIds'->'knowledge'/u, 'desktop cloud list knowledge labels must use only the knowledge taxonomy system');
  assert.doesNotMatch(questionListQuery, /jsonb_each/u, 'model and custom systems must remain independent from knowledge labels');

  const commandPayload = {
    record: {
      id: 'question-3', subject: 'physics', type: 'single_choice', difficulty: 3,
      content: 'Cloud is authoritative', options: [], answer: 'yes', analysis: '',
      knowledge_point_ids: ['kp-1'], model_point_ids: [], taxonomy_ids: [], has_formula: false,
    },
  };
  const commandPayloadHash = crypto.createHash('sha256')
    .update(stableJson({ type: 'question.create.v1', payload: commandPayload }), 'utf8').digest('hex');
  const receipt = await service.submitDesktopDraft({
    tenantId: 'default',
    actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
    command: {
      commandId: 'question-command-1',
      payloadHash: commandPayloadHash,
      type: 'question.create.v1',
      payload: commandPayload,
    },
  });
  assert.deepStrictEqual(receipt, {
    commandId: 'question-command-1', payloadHash: commandPayloadHash, status: 'committed',
    result: { id: 'question-1', status: 'draft', version: 1, contentHash: 'a'.repeat(64) },
    resultHash: receipt.resultHash,
  });
  assert.match(receipt.resultHash, /^[0-9a-f]{64}$/);
  assert.strictEqual(commandTransactions, 1, 'each accepted desktop draft must execute inside one transaction');
  assert.ok(!calls.some(call => call[0].match(/storage_state|file_path|data_url|oss_url/iu)));
  const replayedReceipt = await service.submitDesktopDraft({
    tenantId: 'default',
    actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
    command: {
      commandId: 'question-command-1', payloadHash: commandPayloadHash,
      type: 'question.create.v1', payload: commandPayload,
    },
  });
  assert.deepStrictEqual(replayedReceipt, receipt, 'a retry must return the original cloud receipt without a second question write');
  assert.strictEqual(calls.filter(call => call[0].includes('INSERT INTO business.questions')).length, 2,
    'the initial direct-create test and one command create are the only question inserts');

  const importedCommandPayload = {
    record: {
      id: 'question-imported-1', subject: 'physics', type: 'single_choice', difficulty: 3,
      content: 'Imported cloud text', options: [{ label: 'A', content: 'force' }, { label: 'B', content: 'energy' }], answer: 'A', analysis: '',
      knowledge_point_ids: [], model_point_ids: [], taxonomy_ids: [], has_formula: false,
      import_task_id: 'question_import_task_demo',
      import_item_id: 'question_import_item_demo_0',
      import_item_index: 0,
      import_content_hash: 'd'.repeat(64),
    },
  };
  const importedCommandHash = crypto.createHash('sha256')
    .update(stableJson({ type: 'question.create.v1', payload: importedCommandPayload }), 'utf8').digest('hex');
  const importedReceipt = await service.submitDesktopDraft({
    tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
    command: {
      commandId: 'question-imported-command-1', payloadHash: importedCommandHash,
      type: 'question.create.v1', payload: importedCommandPayload,
    },
  });
  assert.strictEqual(importedReceipt.status, 'committed');
  const importedWrite = calls.find(call => call[0].includes('question_import_media_objects'));
  assert.ok(importedWrite, 'an imported draft must bind the NAS objects inside the cloud question transaction');
  assert.ok(importedWrite[0].includes('storage_task_receipts') && importedWrite[0].includes('business.question_assets'),
    'only NAS-receipted media may become cloud question assets');
  assert.ok(importedWrite[0].includes('source_file_name') && importedWrite[0].includes('source'),
    'a confirmed import must retain the original file name as the cloud question source label');
  assert.ok(importedWrite[0].includes("task.status='drafts_prepared'") && importedWrite[0].includes("item.status='draft_prepared'"),
    'the binding must accept only the user-confirmed import item');
  assert.ok(importedWrite[0].includes("SET status='submitted'") && importedWrite[0].includes("phase='submitted'"),
    'a bound import item must become non-reusable in the same transaction');
  assert.deepStrictEqual(importedWrite[1].slice(-4), [
    'question_import_task_demo', 'question_import_item_demo_0', 0, 'd'.repeat(64),
  ]);

  const malformedImportedOptions = [
    [{ label: 'A', content: 'first B\uff0esecond C\uff0ethird D\uff0efourth' }],
    [{ label: 'A', content: 'first B\uff0esecond' }, { label: 'C', content: 'third D\uff0efourth' }],
  ];
  for (const [index, options] of malformedImportedOptions.entries()) {
    const payload = {
      record: {
        id: `question-imported-invalid-${index}`, subject: 'physics', type: 'single_choice', difficulty: 3,
        content: 'Malformed imported choice', options, answer: index === 0 ? 'A' : 'C', analysis: '',
        knowledge_point_ids: [], model_point_ids: [], taxonomy_ids: [], has_formula: false,
        import_task_id: `question_import_task_invalid_${index}`,
        import_item_id: `question_import_item_invalid_${index}`,
        import_item_index: index, import_content_hash: String(index + 1).repeat(64),
      },
    };
    await assert.rejects(
      () => service.submitDesktopDraft({
        tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
        command: signedCommand(`question-imported-invalid-command-${index}`, 'question.create.v1', payload),
      }),
      /CLOUD_QUESTION_INPUT_INVALID/,
      'a malformed imported choice must not reach question authority',
    );
  }

  const nonChoiceImport = await service.create({
    tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
    question: {
      id: 'question-imported-problem', subject: 'physics', questionType: 'problem', difficulty: 3,
      stem: 'Explain the process', answer: 'A full derivation', explanation: null,
      options: [{ label: 'A', content: 'first B\uff0esecond C\uff0ethird D\uff0efourth' }],
      richContent: null, taxonomy: {}, hasFormula: false,
      importBinding: { taskId: 'question_import_task_problem', itemId: 'question_import_item_problem_0', itemIndex: 0, contentHash: 'e'.repeat(64) },
    },
  });
  assert.strictEqual(nonChoiceImport.id, 'question-1', 'non-choice imports must remain outside the choice-only structure gate');

  let taxonomySequence = 0;
  async function submitTaxonomy(type, payload) {
    taxonomySequence += 1;
    return service.submitDesktopDraft({
      tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
      command: {
        commandId: `taxonomy-command-${taxonomySequence}`, type, payload,
        payloadHash: crypto.createHash('sha256').update(stableJson({ type, payload }), 'utf8').digest('hex'),
      },
    });
  }
  const taxonomyReceipts = [];
  taxonomyReceipts.push(await submitTaxonomy('taxonomy-system.create.v1', { record: { id: 'system-1', subject: 'physics', name: 'Knowledge', sort_order: 1 } }));
  taxonomyReceipts.push(await submitTaxonomy('taxonomy-system.update.v1', { id: 'system-1', expectedVersion: '2026-08-24T05:00:00.000Z', changes: { subject: 'physics', name: 'Knowledge points', sort_order: 2 } }));
  taxonomyReceipts.push(await submitTaxonomy('taxonomy-node.create.v1', { record: { id: 'node-1', system_id: 'system-1', parent_id: null, name: 'Mechanics', sort_order: 1 } }));
  taxonomyReceipts.push(await submitTaxonomy('taxonomy-node.update.v1', { id: 'node-1', expectedVersion: '2026-08-24T05:03:00.000Z', changes: { system_id: 'system-1', parent_id: null, name: 'Dynamics', sort_order: 2 } }));
  taxonomyReceipts.push(await submitTaxonomy('taxonomy-node.delete.v1', { id: 'node-1', systemId: 'system-1', expectedVersion: '2026-08-24T05:04:00.000Z', confirmation: { confirmed: true, expectedAffectedQuestionCount: 1 } }));
  taxonomyReceipts.push(await submitTaxonomy('taxonomy-system.delete.v1', { id: 'system-1', expectedVersion: '2026-08-24T05:01:00.000Z', confirmation: { confirmed: true, expectedAffectedQuestionCount: 0 } }));
  assert.ok(taxonomyReceipts.every(item => item.status === 'committed'));
  for (const functionName of [
    'vnext_create_question_taxonomy_system_v1', 'vnext_update_question_taxonomy_system_v1',
    'vnext_delete_question_taxonomy_system_v1', 'vnext_create_question_taxonomy_node_v1',
    'vnext_update_question_taxonomy_node_v1', 'vnext_delete_question_taxonomy_node_v1',
  ]) assert.ok(calls.some(call => call[0].includes(functionName)), `${functionName} must adjudicate taxonomy drafts`);

  const rejectedReceipts = new Map();
  const rejectedService = createQuestionAuthorityService({
    query: async () => ({ rows: [] }),
    transaction: async work => work(async (text, values) => {
      if (text.includes('FROM business.desktop_question_command_receipts')) {
        const stored = rejectedReceipts.get(`${values[0]}:${values[1]}`);
        return { rows: stored ? [stored] : [] };
      }
      if (text.includes('vnext_delete_question_taxonomy_node_v1')) {
        return { rows: [{ outcome: 'impact_changed', id: values[1], updatedAt: null, affectedQuestionCount: 2 }] };
      }
      if (text.includes('INSERT INTO business.desktop_question_command_receipts')) {
        rejectedReceipts.set(`${values[0]}:${values[1]}`, { payloadHash: values[2], status: values[3], result: JSON.parse(values[4]), resultHash: values[5] });
        return { rows: [] };
      }
      throw new Error('unexpected rejected taxonomy query');
    }),
  });
  const rejectedPayload = { id: 'node-2', systemId: 'system-1', expectedVersion: '2026-08-24T05:04:00.000Z', confirmation: { confirmed: true, expectedAffectedQuestionCount: 1 } };
  const rejectedCommand = {
    commandId: 'taxonomy-command-rejected', type: 'taxonomy-node.delete.v1', payload: rejectedPayload,
    payloadHash: crypto.createHash('sha256').update(stableJson({ type: 'taxonomy-node.delete.v1', payload: rejectedPayload }), 'utf8').digest('hex'),
  };
  const rejectedReceipt = await rejectedService.submitDesktopDraft({ tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] }, command: rejectedCommand });
  assert.strictEqual(rejectedReceipt.status, 'rejected');
  assert.deepStrictEqual(rejectedReceipt.result, { error: { code: 'CLOUD_QUESTION_TAXONOMY_DELETE_IMPACT_CHANGED' }, id: 'node-2', affectedQuestionCount: 2 });
  assert.deepStrictEqual(await rejectedService.submitDesktopDraft({ tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] }, command: rejectedCommand }), rejectedReceipt,
    'a rejected taxonomy command must replay its durable receipt without mutating again');

  const failedState = { questionWrites: 0, receiptWrites: 0 };
  const receiptFailureService = createQuestionAuthorityService({
    query: async () => { throw new Error('the command path must use its transaction query'); },
    transaction: async work => {
      const staged = { ...failedState };
      const transactionQuery = async text => {
        if (text.includes('FROM business.desktop_question_command_receipts')) return { rows: [] };
        if (text.includes('INSERT INTO business.questions')) {
          staged.questionWrites += 1;
          return { rows: [{ id: 'question-rollback', status: 'draft', version: 1, contentHash: 'b'.repeat(64) }] };
        }
        if (text.includes('INSERT INTO business.desktop_question_command_receipts')) {
          staged.receiptWrites += 1;
          throw new Error('receipt write failure');
        }
        throw new Error('unexpected query');
      };
      const result = await work(transactionQuery);
      Object.assign(failedState, staged);
      return result;
    },
  });
  await assert.rejects(
    () => receiptFailureService.submitDesktopDraft({
      tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
      command: { commandId: 'question-command-rollback', payloadHash: commandPayloadHash, type: 'question.create.v1', payload: commandPayload },
    }),
    /receipt write failure/,
  );
  assert.deepStrictEqual(failedState, { questionWrites: 0, receiptWrites: 0 },
    'a receipt failure must roll back the question text mutation instead of leaving an unreceipted cloud write');

  const updatePayload = {
    id: 'question-3',
    expectedVersion: 1,
    changes: {
      subject: 'physics', type: 'single_choice', difficulty: 4,
      content: 'Cloud update is authoritative', options: [{ label: 'A', content: 'force' }, { label: 'B', content: 'energy' }], answer: 'A', analysis: '',
      knowledge_point_ids: [], model_point_ids: [], taxonomy_ids: [], has_formula: true, status: 'published',
    },
  };
  const updateReceipt = await service.submitDesktopDraft({
    tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
    command: {
      commandId: 'question-command-2', type: 'question.update.v1', payload: updatePayload,
      payloadHash: crypto.createHash('sha256').update(stableJson({ type: 'question.update.v1', payload: updatePayload }), 'utf8').digest('hex'),
    },
  });
  assert.strictEqual(updateReceipt.status, 'committed');
  assert.ok(calls.some(call => call[0].includes('UPDATE business.questions') && call[0].includes('UPDATE business.question_contents')));
  const publishedWrite = calls.find(call => call[0].includes('UPDATE business.questions') && call[0].includes('status=COALESCE($8,q.status)'));
  assert.ok(publishedWrite, 'a teacher question update must be able to publish an imported question through the cloud authority command');
  assert.strictEqual(publishedWrite[1][7], 'published');
  assert.match(publishedWrite[0], /c\.version=\$15::integer/u, 'question updates must compare-and-swap against the listed content version');
  assert.strictEqual(publishedWrite[1][14], 1);

  const malformedPublishPayload = {
    id: 'question-3', expectedVersion: 1,
    changes: {
      subject: 'physics', type: 'single_choice', difficulty: 4, status: 'published',
      content: 'Packed options must not publish',
      options: [{ label: 'A', content: 'first B\uff0esecond' }, { label: 'C', content: 'third D\uff0efourth' }],
      answer: 'C', analysis: '', knowledge_point_ids: [], model_point_ids: [], taxonomy_ids: [], has_formula: false,
    },
  };
  await assert.rejects(
    () => service.submitDesktopDraft({
      tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
      command: signedCommand('question-command-invalid-publish', 'question.update.v1', malformedPublishPayload),
    }),
    /CLOUD_QUESTION_INPUT_INVALID/,
    'a malformed choice must not be published by the question authority',
  );
  const statusPreservingMalformedPayload = {
    ...malformedPublishPayload,
    changes: { ...malformedPublishPayload.changes },
  };
  delete statusPreservingMalformedPayload.changes.status;
  await assert.rejects(
    () => service.submitDesktopDraft({
      tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
      command: signedCommand('question-command-invalid-status-preserving-update', 'question.update.v1', statusPreservingMalformedPayload),
    }),
    /CLOUD_QUESTION_INPUT_INVALID/,
    'omitting status must not bypass the structure gate when an existing published choice is edited',
  );
  const invalidAnswerPublishPayload = {
    ...updatePayload,
    changes: { ...updatePayload.changes, answer: 'C' },
  };
  await assert.rejects(
    () => service.submitDesktopDraft({
      tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
      command: signedCommand('question-command-invalid-answer', 'question.update.v1', invalidAnswerPublishPayload),
    }),
    /CLOUD_QUESTION_INPUT_INVALID/,
    'a choice answer must refer only to labels present in the submitted options',
  );

  for (const [commandId, type, payload] of [
    ['question-update-missing-version', 'question.update.v1', { id: 'question-3', changes: updatePayload.changes }],
    ['question-update-invalid-version', 'question.update.v1', { id: 'question-3', changes: updatePayload.changes, expectedVersion: '1' }],
    ['question-delete-missing-version', 'question.delete.v1', { id: 'question-3' }],
  ]) {
    await assert.rejects(
      () => service.submitDesktopDraft({
        tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
        command: signedCommand(commandId, type, payload),
      }),
      /CLOUD_QUESTION_INPUT_INVALID/,
      'question update/delete must carry the integer version returned by question list',
    );
  }

  const deletePayload = { id: 'question-3', expectedVersion: 1 };
  const deleteReceipt = await service.submitDesktopDraft({
    tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] },
    command: {
      commandId: 'question-command-3', type: 'question.delete.v1', payload: deletePayload,
      payloadHash: crypto.createHash('sha256').update(stableJson({ type: 'question.delete.v1', payload: deletePayload }), 'utf8').digest('hex'),
    },
  });
  assert.strictEqual(deleteReceipt.status, 'committed');
  const deleteWrite = calls.find(call => call[0].includes('deleted=true') && call[0].includes('business.question_contents'));
  assert.ok(deleteWrite);
  assert.match(deleteWrite[0], /c\.version=\$3::integer/u, 'question deletes must compare-and-swap against the listed content version');
  assert.strictEqual(deleteWrite[1][2], 1);

  const conflictReceipts = new Map();
  const conflictService = createQuestionAuthorityService({
    query: async () => ({ rows: [] }),
    transaction: async work => work(async (text, values) => {
      if (text.includes('FROM business.desktop_question_command_receipts')) {
        const stored = conflictReceipts.get(`${values[0]}:${values[1]}`);
        return { rows: stored ? [stored] : [] };
      }
      if (text.includes('UPDATE business.question_contents AS c')) return { rows: [] };
      if (text.includes('INSERT INTO business.desktop_question_command_receipts')) {
        conflictReceipts.set(`${values[0]}:${values[1]}`, {
          payloadHash: values[2], status: values[3], result: JSON.parse(values[4]), resultHash: values[5],
        });
        return { rows: [] };
      }
      throw new Error('unexpected question conflict query');
    }),
  });
  const conflictCommand = signedCommand('question-command-conflict', 'question.update.v1', { ...updatePayload, expectedVersion: 99 });
  const conflictReceipt = await conflictService.submitDesktopDraft({
    tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] }, command: conflictCommand,
  });
  assert.strictEqual(conflictReceipt.status, 'rejected');
  assert.deepStrictEqual(conflictReceipt.result, { error: { code: 'CLOUD_QUESTION_CONFLICT' }, id: 'question-3' });
  assert.deepStrictEqual(await conflictService.submitDesktopDraft({
    tenantId: 'default', actor: { accountId: 'teacher-account-1', roles: ['teacher'] }, command: conflictCommand,
  }), conflictReceipt, 'a rejected question CAS conflict must replay its durable receipt');

  await assert.rejects(
    () => service.create({ tenantId: 'default', actor: { accountId: 'student-account-1', roles: ['student'] }, question: {
      id: 'question-2', subject: 'physics', questionType: 'single_choice', difficulty: 3,
      stem: 'Blocked', answer: null, explanation: null, options: [], richContent: null, taxonomy: {}, hasFormula: false,
    } }),
    /CLOUD_QUESTION_ACCESS_DENIED/
  );
}

main().then(() => console.log('cloud question authority service checks passed')).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
