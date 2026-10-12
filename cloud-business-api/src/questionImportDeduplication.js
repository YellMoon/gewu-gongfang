'use strict';
const { identityKey, mergeQuestion } = require('../../shared/questionDeduplication');

async function mergeExactImportedQuestion({ query, tenantId, accountId, binding, incoming, canonicalContentHash }) {
  // Separate statement: waiting import transactions must read a fresh snapshot.
  await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${tenantId}:question-import`]);
  const bound = await query(`SELECT item.candidate_json AS candidate,task.source_file_name AS source
    FROM business.question_import_items item JOIN business.question_import_tasks task ON task.task_id=item.import_task_id
    WHERE task.tenant_id=$1 AND task.account_id=$2 AND task.task_id=$3 AND task.status='drafts_prepared'
      AND item.item_id=$4 AND item.item_index=$5 AND item.content_hash=$6 AND item.status='draft_prepared'
      AND NOT EXISTS (SELECT 1 FROM business.question_import_media_objects media
        WHERE media.import_task_id=task.task_id AND media.item_index=item.item_index
          AND (media.storage_state<>'verified' OR NOT EXISTS (SELECT 1 FROM business.storage_task_receipts receipt WHERE receipt.task_id=media.storage_task_id)
            OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(item.candidate_json->'assets','[]'::jsonb)) asset
              WHERE asset->>'assetIndex'=media.asset_index::text AND asset->>'contentHash'=media.expected_sha256
                AND asset->>'mimeType'=media.mime_type AND asset->>'sizeBytes'=media.expected_bytes::text)))
    FOR UPDATE OF item`, [tenantId, accountId, binding.taskId, binding.itemId, binding.itemIndex, binding.contentHash]);
  if (bound.rows.length !== 1) throw Object.assign(new Error('CLOUD_QUESTION_UNAVAILABLE'), { code: 'CLOUD_QUESTION_UNAVAILABLE' });
  const candidates = await query(`SELECT q.id,c.stem,c.options_json AS options,c.rich_content_json AS rich_content,q.subject
    FROM business.questions q JOIN business.question_contents c ON c.question_id=q.id AND c.tenant_id=q.tenant_id
    WHERE q.tenant_id=$1 AND q.subject=$2 AND NOT q.deleted AND NOT c.deleted ORDER BY q.created_at,q.id`, [tenantId, incoming.subject]);
  const key = identityKey(incoming);
  const candidate = candidates.rows.find(row => identityKey(row) === key);
  if (!candidate) return null;
  const locked = await query(`SELECT q.*,c.stem,c.answer,c.explanation,c.options_json AS options,c.rich_content_json AS rich_content,c.version,q.taxonomy_json AS taxonomy
    FROM business.questions q JOIN business.question_contents c ON c.question_id=q.id AND c.tenant_id=q.tenant_id
    WHERE q.id=$1 AND q.tenant_id=$2 AND NOT q.deleted AND NOT c.deleted FOR UPDATE OF q,c`, [candidate.id, tenantId]);
  const prior = locked.rows[0];
  if (!prior || identityKey(prior) !== key) throw Object.assign(new Error('CLOUD_QUESTION_CONFLICT'), { code: 'CLOUD_QUESTION_CONFLICT' });
  prior.year = prior.exam_year;
  if (prior.school_ids?.length) prior.school = null;
  const merged = mergeQuestion(prior, incoming);
  const value = merged.question;
  const hash = canonicalContentHash({ stem: prior.stem, answer: value.answer, explanation: value.explanation, options: prior.options, richContent: value.rich_content });
  const metadata = JSON.stringify(value);
  const result = await query(`WITH updated_content AS (
      UPDATE business.question_contents SET answer=$3,explanation=$4,rich_content_json=$5::jsonb,content_hash=$6,version=version+1,updated_at=transaction_timestamp()
      WHERE question_id=$1 AND tenant_id=$2 RETURNING version,content_hash AS "contentHash"
    ), updated_question AS (
      UPDATE business.questions SET taxonomy_json=$7::jsonb,metadata_labels=$8::jsonb->'metadata_labels',school_ids=$8::jsonb->'school_ids',
        organization_type=COALESCE(NULLIF(organization_type,''),$8::jsonb->>'organization_type'),source=COALESCE(NULLIF(source,''),$8::jsonb->>'source'),exam_year=COALESCE(NULLIF(exam_year,''),$8::jsonb->>'year'),
        grade=COALESCE(NULLIF(grade,''),$8::jsonb->>'grade'),semester=COALESCE(NULLIF(semester,''),$8::jsonb->>'semester'),
        exam_type=COALESCE(NULLIF(exam_type,''),$8::jsonb->>'exam_type'),region=COALESCE(NULLIF(region,''),$8::jsonb->>'region'),school=COALESCE(NULLIF(school,''),$8::jsonb->>'school'),
        difficulty_coefficient=COALESCE(difficulty_coefficient,($8::jsonb->>'difficulty_coefficient')::numeric),
        subject_id=COALESCE(subject_id,$8::jsonb->>'subject_id'),chapter_id=COALESCE(chapter_id,$8::jsonb->>'chapter_id'),
        has_formula=has_formula OR COALESCE(($8::jsonb->>'has_formula')::boolean,false),
        has_image=has_image OR COALESCE(($8::jsonb->>'has_image')::boolean,false),updated_at=transaction_timestamp()
      WHERE id=$1 AND tenant_id=$2 RETURNING id,status
    ), added_assets AS (
      INSERT INTO business.question_assets(id,tenant_id,question_id,asset_type,file_name,mime_type,size_bytes,storage_object_id,storage_object_version,content_hash,state)
      SELECT concat('question_asset_merge_',media.media_id),$2,$1,COALESCE(asset->>'assetType','image'),asset->>'fileName',media.mime_type,media.expected_bytes,
        media.object_id,media.object_version,media.expected_sha256,'verified'
      FROM business.question_import_media_objects media JOIN business.question_import_items item ON item.import_task_id=media.import_task_id AND item.item_index=media.item_index
      JOIN LATERAL jsonb_array_elements(COALESCE(item.candidate_json->'assets','[]'::jsonb)) asset ON asset->>'assetIndex'=media.asset_index::text
      WHERE item.item_id=$10 AND media.storage_state='verified'
        AND NOT EXISTS (SELECT 1 FROM business.question_assets existing WHERE existing.storage_object_id=media.object_id AND existing.storage_object_version=media.object_version)
      RETURNING id
    ), submitted_item AS (
      UPDATE business.question_import_items SET status='submitted',updated_at=transaction_timestamp(),
        validation_json=validation_json || jsonb_build_object('deduplication',jsonb_build_object('questionId',$1::text,'similarity',100,'merged',true,'filled',$11::jsonb,'conflicts',$12::jsonb))
      WHERE import_task_id=$9 AND item_id=$10 RETURNING item_id
    ), submitted_task AS (
      UPDATE business.question_import_tasks SET status='submitted',phase='submitted',updated_at=transaction_timestamp()
      WHERE task_id=$9 AND NOT EXISTS (SELECT 1 FROM business.question_import_items pending WHERE pending.import_task_id=$9 AND pending.item_id<>$10 AND pending.status IN ('accepted','warning','draft_prepared'))
      RETURNING task_id
    ) SELECT q.id,q.status,c.version,c."contentHash" FROM updated_question q CROSS JOIN updated_content c CROSS JOIN submitted_item`,
    [prior.id, tenantId, value.answer, value.explanation, JSON.stringify(value.rich_content), hash, JSON.stringify(value.taxonomy), metadata,
      binding.taskId, binding.itemId, JSON.stringify(merged.filled), JSON.stringify(merged.conflicts)]);
  if (result.rows.length !== 1) throw new Error('CLOUD_QUESTION_UNAVAILABLE');
  return { ...result.rows[0], filled: merged.filled, conflicts: merged.conflicts };
}

module.exports = { mergeExactImportedQuestion };
