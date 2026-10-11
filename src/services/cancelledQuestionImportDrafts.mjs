// Only an authenticated, explicit cloud cancellation may discard local drafts.
export async function discardCancelledQuestionImportDrafts({ items, bridge, readTask, active = () => true }) {
  const states = new Map();
  let removed = 0;
  for (const item of items) {
    const taskId = item.type === 'question.create.v1' && item.payload?.record?.import_task_id;
    if (!taskId || item.status === 'completed' || !active()) continue;
    if (!states.has(taskId)) states.set(taskId, await readTask(taskId));
    const task = states.get(taskId);
    if (task?.taskId !== taskId || task.status !== 'cancelled' || !active()) continue;
    const current = (await bridge.list()).find(row => row.id === item.id);
    if (current && current.status !== 'completed' && JSON.stringify(current.payload) === JSON.stringify(item.payload) && active()) {
      await bridge.removeDraft(item.id);
      removed += 1;
    }
  }
  return removed;
}
