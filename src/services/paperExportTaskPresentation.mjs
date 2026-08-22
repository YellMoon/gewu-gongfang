const LABELS = {
  draft: '\u672c\u5730\u8349\u7a3f\uff08\u7f51\u7edc\u672a\u786e\u8ba4\uff09',
  queued: '\u5df2\u6392\u961f',
  cloud_unavailable: '\u4e91\u7aef\u4efb\u52a1\u670d\u52a1\u4e0d\u53ef\u7528',
  claimed: '\u4e91\u7aef\u5df2\u63a5\u5355',
  snapshotting: '\u6b63\u5728\u56fa\u5316\u8bd5\u5377\u5feb\u7167',
  rendering: '\u6b63\u5728\u751f\u6210\u6587\u6863',
  validating: '\u6b63\u5728\u6821\u9a8c\u516c\u5f0f\u4e0e\u6392\u7248',
  publishing: '\u6b63\u5728\u53d1\u5e03\u4e0b\u8f7d\u6587\u4ef6',
  completed: '\u5df2\u5b8c\u6210',
  failed: '\u751f\u6210\u5931\u8d25',
  cancelled: '\u5df2\u53d6\u6d88',
  timed_out: '\u751f\u6210\u8d85\u65f6',
};

const COLORS = {
  draft: 'default', queued: 'blue', cloud_unavailable: 'orange', claimed: 'cyan', snapshotting: 'geekblue',
  rendering: 'processing', validating: 'purple', publishing: 'gold', completed: 'green', failed: 'red', cancelled: 'default', timed_out: 'volcano',
};

export function getPaperExportTaskPresentation(task = {}) {
  let key = String(task.phase || task.status || 'draft');
  if (task.status === 'draft') key = task.errorCode === 'CLOUD_TASK_UNAVAILABLE' ? 'cloud_unavailable' : 'draft';
  if (['completed', 'failed', 'cancelled', 'timed_out'].includes(task.status)) key = task.status;
  if (!LABELS[key]) key = task.status === 'processing' ? 'claimed' : 'queued';
  return { key, label: LABELS[key], color: COLORS[key], accepted: task.status !== 'draft' || task.accepted === true || Boolean(task.serverTaskId) };
}

export const paperExportPhaseLabels = LABELS;
