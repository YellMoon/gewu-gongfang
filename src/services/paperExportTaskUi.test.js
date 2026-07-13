const assert = require('assert');
const fs = require('fs');

(async () => {
  const { getPaperExportTaskPresentation } = await import('./paperExportTaskPresentation.mjs');
  const phases = ['queued', 'host_unavailable', 'claimed', 'snapshotting', 'rendering', 'validating', 'publishing', 'completed', 'failed', 'cancelled', 'timed_out'];
  for (const phase of phases) {
    const task = phase === 'host_unavailable'
      ? { status: 'draft', phase: 'draft', errorCode: 'TARGET_HOST_REQUIRED' }
      : { status: ['completed', 'failed', 'cancelled', 'timed_out'].includes(phase) ? phase : (phase === 'queued' ? 'pending_host' : 'processing'), phase };
    const view = getPaperExportTaskPresentation(task);
    assert.strictEqual(view.key, phase);
    assert.ok(view.label && view.color, `${phase} needs a visible label and tone`);
  }
  assert.strictEqual(getPaperExportTaskPresentation({ status: 'draft', phase: 'draft' }).accepted, false);
  assert.strictEqual(getPaperExportTaskPresentation({ status: 'pending_host', phase: 'queued' }).accepted, true);

  const source = fs.readFileSync('src/pages/QuestionBankPaper.tsx', 'utf8');
  const indexSource = fs.readFileSync('src/index.tsx', 'utf8');
  assert.ok(source.includes("from '../services/paperExportTaskService'"), 'paper page must use the persistent unified task client');
  assert.ok(source.includes('loadPaperExportTasks'), 'task history must be restored from local storage');
  assert.ok(source.includes('refreshPendingPaperExportTasks'), 'restart must resume non-terminal task polling');
  assert.ok(source.includes('cancelPaperExportTask'), 'accepted tasks need cancellation');
  assert.ok(source.includes('retryPaperExportTask'), 'failed drafts need a fresh-key retry');
  assert.ok(source.includes('downloadPaperExportTask'), 'completed tasks need refreshed authenticated downloads');
  assert.ok(source.includes('Progress'), 'phase progress must be visible');
  assert.ok(source.includes('aria-live="polite"'), 'task updates must be announced without stealing focus');
  assert.ok(source.includes('paper-export-task-card'), 'task cards need responsive styling and a focus target');
  assert.ok(!source.includes("disabled={items.length === 0 || !hostReady"), 'non-host paper export must not remain disabled');
  assert.ok(!source.includes('bordered={false}'), 'paper title input must not use deprecated bordered');
  assert.ok(!source.includes('bodyStyle='), 'question cards must not use deprecated bodyStyle');
  assert.ok(source.includes('Input as AntdInput') && source.includes('InputNumber as AntdInputNumber'), 'deprecated addon props must be intercepted by local labeled controls');
  assert.ok(source.includes('const LabeledInput') && source.includes('paper-editor-field-label'), 'editor labels must use explicit Space/Typography layout');
  assert.ok(source.includes('App as AntdApp'), 'page messages must use antd App context');
  assert.ok(source.includes('const { message: messageApi } = AntdApp.useApp()'), 'page must bind context-aware message API');
  assert.ok(!source.includes('  message,') && !source.includes('const message = messageApi') && !source.includes('message.success('), 'all notifications must call the context-aware message API directly');
  assert.ok(indexSource.includes('<AntdApp>') && indexSource.includes('</AntdApp>'), 'root must provide the antd App message context');
  console.log('paper export task UI regression checks passed');
})().catch(error => { console.error(error); process.exit(1); });
