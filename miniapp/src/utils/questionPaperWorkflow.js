function toggleOrderedSelection(selected, questionId) {
  const id = String(questionId); const current = selected.map(String); const index = current.indexOf(id);
  return index >= 0 ? current.filter(item => item !== id) : [...current, id];
}
function createTaskDraft(input, options = {}) {
  const idempotencyKey = (options.idFactory || (() => `${Date.now()}-${Math.random().toString(36).slice(2)}`))();
  return { localId: `draft-${idempotencyKey}`, confirmed: false, createdAt: options.now || Date.now(), status: 'draft', phase: 'draft', progress: 0,
    request: { protocolVersion: 2, taskType: input.taskType, targetHostDeviceId: input.targetHostDeviceId, idempotencyKey,
      payload: { questionIds: [...input.questionIds], title: input.title, answerPosition: input.answerPosition, formulaMode: input.formulaMode } } };
}
function confirmTaskDraft(draft, task) { return { ...draft, confirmed: true, taskId: task.id, status: task.status, phase: task.phase || 'queued', progress: Number(task.progress || 0), resultExpiresAt: task.result_expires_at || null }; }
function canCancel(task) { return task.confirmed && ['pending_host', 'processing'].includes(task.status); }
function canRetry(task) { return task.confirmed && ['failed', 'cancelled'].includes(task.status); }
function isExpired(task, now = Date.now()) { return Boolean(task.resultExpiresAt && Date.parse(task.resultExpiresAt) <= now); }
module.exports = { canCancel, canRetry, confirmTaskDraft, createTaskDraft, isExpired, toggleOrderedSelection };
