import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Input, Button, ScrollView, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { cancelMiniappTask, createPaperTaskV2, getMiniappTaskResult, readQuestionPreview } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import { createSessionBoundOperation, openSessionBoundDocument } from '../../utils/miniappApiSessionRuntime';
import { createQuestionPaperTaskCacheRuntime } from '../../utils/miniappAuthorizationRuntime';
import { storage } from '../../utils/storage';
import { isUnrecognizedIdentity } from '../../utils/accountExperience';
// @ts-ignore CommonJS workflow module has no TypeScript declarations.
import * as workflow from '../../utils/questionPaperWorkflow';
import './index.scss';

type PaperAction = 'question-paper' | 'paper-export-word' | 'paper-export-pdf';
type PreviewState = 'loading' | 'ready' | 'empty' | 'offline' | 'forbidden';
interface QuestionPreview { id: string; type: string; stemPreview: string; status: string; }
interface PaperTask { localId: string; confirmed: boolean; taskId?: string; status: string; phase: string; progress: number; createdAt: number; resultExpiresAt?: string | null; hostBaseUrl?: string | null; request: any; result?: any; error?: string; }

const answers = [{ value: 'end', label: '\u7b54\u6848\u7edf\u4e00\u7f6e\u540e' }, { value: 'after-each', label: '\u7b54\u6848\u9010\u9898\u540e' }];
const formulas = [{ value: 'word-native', label: 'Word native' }, { value: 'eq-field', label: 'EQ field' }, { value: 'mathtype-compatible', label: 'MathType' }, { value: 'latex-vector', label: 'LaTeX vector' }];
const actionCopy: Record<PaperAction, string> = { 'question-paper': '\u521b\u5efa\u7ec4\u5377', 'paper-export-word': '\u5bfc\u51fa Word', 'paper-export-pdf': '\u5bfc\u51fa PDF' };
const statusCopy: Record<string, string> = { draft: '\u672c\u5730\u8349\u7a3f\uff08\u672a\u83b7\u4e91\u786e\u8ba4\uff09', pending_host: '\u7b49\u5f85\u6570\u636e\u4e3b\u673a', processing: '\u5904\u7406\u4e2d', completed: '\u5df2\u5b8c\u6210', failed: '\u5931\u8d25', cancelled: '\u5df2\u53d6\u6d88' };

function absoluteHostUrl(base: string, endpoint: string) { return `${base.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`; }
function authHeader(token: string, extra: Record<string, string> = {}) { return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }; }

export default function QuestionBankPage() {
  const isUnrecognized = isUnrecognizedIdentity(Taro.getStorageSync('user_info'));
  useEffect(() => {
    if (isUnrecognized) Taro.reLaunch({ url: '/pages/unrecognized-experience/index' });
  }, [isUnrecognized]);
  const taskCacheRuntimeRef = useRef<any>(null);
  if (!taskCacheRuntimeRef.current) {
    taskCacheRuntimeRef.current = createQuestionPaperTaskCacheRuntime({
      readIdentity: () => Taro.getStorageSync('user_info'),
      read: (key: string) => storage.get<PaperTask[]>(key),
      write: (key: string, value: PaperTask[]) => storage.set(key, value),
    });
  }
  const taskCacheRuntime = taskCacheRuntimeRef.current;
  const [title, setTitle] = useState('\u7ec3\u4e60\u8bd5\u5377');
  const [questions, setQuestions] = useState<QuestionPreview[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [previewState, setPreviewState] = useState<PreviewState>('loading');
  const [previewMessage, setPreviewMessage] = useState('');
  const [hostAvailable, setHostAvailable] = useState(false);
  const [targetHostDeviceId, setTargetHostDeviceId] = useState('');
  const [hostBaseUrl, setHostBaseUrl] = useState('');
  const [answerIndex, setAnswerIndex] = useState(0);
  const [formulaIndex, setFormulaIndex] = useState(0);
  const [taskState, setTaskState] = useState<{ scopeKey: string; tasks: PaperTask[] }>(() => taskCacheRuntime.snapshot());
  const tasks = taskState.tasks;
  const [submitting, setSubmitting] = useState<PaperAction | null>(null);
  const synchronizeTaskScope = () => {
    const current = taskCacheRuntime.snapshot();
    if (current.scopeKey !== taskState.scopeKey) { setTaskState(current); return false; }
    return Boolean(current.scopeKey);
  };
  const persist = (next: PaperTask[]) => {
    const result = taskCacheRuntime.replace(next, taskState.scopeKey);
    setTaskState(result.snapshot);
    return result.written;
  };

  const loadQuestions = async () => {
    setPreviewState('loading'); setPreviewMessage('');
    try {
      const response: any = await readQuestionPreview();
      if (!response.success) { setPreviewState(['USER_NOT_APPROVED', 'FORBIDDEN'].includes(String(response.code)) ? 'forbidden' : 'offline'); setPreviewMessage(response.error || 'unavailable'); return; }
      const list = response.questions || response.data?.questions || [];
      setQuestions(list);
      setHostAvailable(Boolean(response.hostAvailable)); setTargetHostDeviceId(response.targetHostDeviceId || ''); setHostBaseUrl(response.hostBaseUrl || '');
      setPreviewState(list.length ? 'ready' : 'empty');
      if (!response.hostAvailable) setPreviewMessage('\u6570\u636e\u4e3b\u673a\u5f53\u524d\u4e0d\u53ef\u7528');
      else if (!response.hostBaseUrl) setPreviewMessage('\u4e3b\u673a\u672a\u767b\u8bb0\u5b89\u5168\u4e0b\u8f7d\u5730\u5740');
    } catch { setPreviewState('offline'); setPreviewMessage('\u79bb\u7ebf\u6216\u4e91\u7aef\u4e0d\u53ef\u8fbe'); }
  };

  const refreshTask = async (task: PaperTask) => {
    if (!task.confirmed || !task.taskId) return task;
    try {
      const response: any = await getMiniappTaskResult(task.taskId); const cloud = response.task || response.data?.task;
      if (!response.success || !cloud) return { ...task, error: response.error || 'not found' };
      const sameTargetHost = targetHostDeviceId && targetHostDeviceId === task.request?.targetHostDeviceId;
      return { ...task, status: cloud.status, phase: cloud.phase || cloud.status, progress: Number(cloud.progress || 0), resultExpiresAt: cloud.result_expires_at || task.resultExpiresAt, result: cloud.result || cloud.result_payload || task.result, hostBaseUrl: sameTargetHost ? (hostBaseUrl || task.hostBaseUrl) : task.hostBaseUrl, error: cloud.error_code || '' };
    } catch { return { ...task, error: 'refresh failed' }; }
  };
  const refreshAll = async () => { if (!synchronizeTaskScope()) return; persist(await Promise.all(tasks.map(refreshTask))); };
  useEffect(() => { if (isUnrecognized) return; loadQuestions(); refreshAll(); }, [isUnrecognized]);
  useEffect(() => {
    const current = taskCacheRuntime.snapshot();
    if (current.scopeKey !== taskState.scopeKey) setTaskState(current);
  });

  const filtered = useMemo(() => { const key = searchText.trim().toLowerCase(); return questions.filter(q => !key || `${q.stemPreview} ${q.type}`.toLowerCase().includes(key)); }, [questions, searchText]);

  const submit = async (taskType: PaperAction, source?: PaperTask) => {
    if (!synchronizeTaskScope()) return;
    const questionIds = source?.request?.payload?.questionIds || selectedIds;
    if (!title.trim() || questionIds.length === 0) { Taro.showToast({ title: questionIds.length ? '\u8bf7\u8f93\u5165\u8bd5\u5377\u540d\u79f0' : '\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u9053\u9898', icon: 'none' }); return; }
    const draft: PaperTask = workflow.createTaskDraft({ taskType, questionIds, title: source?.request?.payload?.title || title.trim(), answerPosition: source?.request?.payload?.answerPosition || answers[answerIndex].value, formulaMode: source?.request?.payload?.formulaMode || formulas[formulaIndex].value, targetHostDeviceId }, { idFactory: () => `${Date.now()}-${Math.random().toString(36).slice(2)}` });
    draft.hostBaseUrl = hostBaseUrl || source?.hostBaseUrl || null;
    if (!persist([draft, ...tasks])) return;
    if (!hostAvailable || !targetHostDeviceId) return;
    setSubmitting(taskType);
    try {
      const request = draft.request;
      const response: any = await createPaperTaskV2(request.taskType, request.payload, request.targetHostDeviceId, request.idempotencyKey);
      const cloud = response.task || response.data?.task;
      if (!response.success || !cloud) throw new Error(response.error || 'cloud not confirmed');
      persist([{ ...workflow.confirmTaskDraft(draft, cloud), result: cloud.result || cloud.result_payload || null, hostBaseUrl: draft.hostBaseUrl }, ...tasks]);
    } catch (error: any) { persist([{ ...draft, error: error?.message || 'cloud not confirmed' }, ...tasks]); }
    finally { setSubmitting(null); }
  };

  const cancelTask = async (task: PaperTask) => { if (!synchronizeTaskScope() || !workflow.canCancel(task) || !task.taskId) return; const response: any = await cancelMiniappTask(task.taskId); if (response.success) persist(tasks.map(item => item.localId === task.localId ? { ...item, status: 'cancelled', phase: 'cancelled' } : item)); };
  const exchangeAccess = async (task: PaperTask, sessionBoundary: ReturnType<typeof createSessionBoundOperation>) => {
    const endpoint = task.result?.accessEndpoint || task.result?.accessUrl;
    if (!task.hostBaseUrl || !endpoint) throw new Error('host URL unavailable');
    const response = await sessionBoundary.run((requestSession: any) => Taro.request({ url: absoluteHostUrl(task.hostBaseUrl || '', endpoint), method: 'GET', header: authHeader(requestSession.token), timeout: 30000 }));
    if (response.statusCode !== 200 || !(response.data as any)?.success) throw new Error((response.data as any)?.error || 'access denied');
    return (response.data as any).data;
  };
  const downloadTask = async (task: PaperTask) => {
    if (!synchronizeTaskScope()) return;
    if (workflow.isExpired(task)) { Taro.showToast({ title: '\u6587\u4ef6\u5df2\u8fc7\u671f', icon: 'none' }); return; }
    try {
      const sessionBoundary = createSessionBoundOperation(authSessionRuntime);
      let access = await exchangeAccess(task, sessionBoundary);
      const download = () => sessionBoundary.run((requestSession: any) => Taro.downloadFile({ url: absoluteHostUrl(task.hostBaseUrl || '', access.fileUrl), header: authHeader(requestSession.token, { 'x-gewu-artifact-token': access.token }) }));
      let file = await download(); if (file.statusCode === 410) { access = await exchangeAccess(task, sessionBoundary); file = await download(); }
      if (file.statusCode !== 200) throw new Error('download failed');
      await openSessionBoundDocument(sessionBoundary, {
        filePath: file.tempFilePath,
        openDocument: (options: any) => Taro.openDocument(options),
        removeTemporaryFile: (filePath: string) => new Promise<void>(resolve => {
          try { Taro.getFileSystemManager().unlink({ filePath, complete: () => resolve() }); } catch (_error) { resolve(); }
        }),
      });
    } catch (error: any) { Taro.showToast({ title: error?.message || 'download failed', icon: 'none' }); }
  };

  const stateText = previewState === 'loading' ? '\u6b63\u5728\u52a0\u8f7d\u9898\u76ee' : previewState === 'empty' ? '\u4e91\u7aef\u6682\u65e0\u53ef\u7528\u9898\u76ee' : previewState === 'forbidden' ? '\u5f53\u524d\u8d26\u53f7\u65e0\u6743\u8bfb\u53d6\u9898\u5e93' : '\u79bb\u7ebf\u6216\u4e91\u7aef\u4e0d\u53ef\u8fbe';
  const availabilityLabel = hostAvailable ? targetHostDeviceId : '\u4e3b\u673a\u4e0d\u53ef\u7528';
  if (isUnrecognized) {
    return <View className='question-bank-page'>
      <View className='preview-card'>
        <Text className='preview-title'>{'\u6b63\u5728\u8fdb\u5165\u4f53\u9a8c\u9898\u5e93'}</Text>
      </View>
    </View>;
  }
  return <View className='question-bank-page'>
    {false && (
      <View className="experience-section">
        <View className="section-header">
          <Text className="section-title">体验题库</Text>
          <Text className="section-subtitle">固定示例题，不属于正式题库</Text>
        </View>
        <Button
          className="experience-btn"
          onClick={() => Taro.navigateTo({ url: '/pages/unrecognized-experience/index' })}
        >
          进入体验
        </Button>
      </View>
    )}
    <View className='hero-card'><Text className='hero-title'>{'\u9898\u5e93\u7ec4\u5377\u4e0e\u5bfc\u51fa'}</Text><Text className='hero-subtitle'>{'\u6309\u9009\u62e9\u987a\u5e8f\u63d0\u4ea4\u771f\u5b9e\u9898\u76ee ID'}</Text></View>
    <View className='form-card'><View className='form-row'><Text className='field-label'>{'\u8bd5\u5377\u540d\u79f0'}</Text><Input className='field-input' value={title} onInput={e => setTitle(e.detail.value)} /></View><Picker mode='selector' range={answers.map(x => x.label)} value={answerIndex} onChange={e => setAnswerIndex(Number(e.detail.value))}><View className='picker-row'>{answers[answerIndex].label}</View></Picker><Picker mode='selector' range={formulas.map(x => x.label)} value={formulaIndex} onChange={e => setFormulaIndex(Number(e.detail.value))}><View className='picker-row'>{formulas[formulaIndex].label}</View></Picker></View>
    <View className='preview-card'><View className='preview-header'><View><Text className='preview-title'>{`\u9009\u62e9\u9898\u76ee (${selectedIds.length})`}</Text><Text className='preview-subtitle'>{availabilityLabel}</Text></View><Button className='preview-refresh' onClick={loadQuestions}>{'\u5237\u65b0'}</Button></View><Input className='preview-search' value={searchText} onInput={e => setSearchText(e.detail.value)} />{previewState !== 'ready' ? <View className={`question-preview-empty state-${previewState}`}><Text>{stateText}</Text><Text>{previewMessage}</Text></View> : <ScrollView className='question-preview-list' scrollY>{filtered.map(q => { const order = selectedIds.indexOf(q.id); return <View key={q.id} className={`question-preview-item ${order >= 0 ? 'selected' : ''}`} onClick={() => setSelectedIds(workflow.toggleOrderedSelection(selectedIds, q.id))}><View className='question-preview-meta'><Text>{order >= 0 ? `#${order + 1}` : '+'}</Text><Text>{q.type}</Text><Text>{q.status}</Text></View><Text className='question-preview-stem'>{q.stemPreview}</Text></View>; })}</ScrollView>}</View>
    <View className='action-card'>{(['question-paper', 'paper-export-word', 'paper-export-pdf'] as PaperAction[]).map(a => <Button key={a} className={`action-button ${a}`} loading={submitting === a} disabled={Boolean(submitting) || selectedIds.length === 0} onClick={() => submit(a)}>{actionCopy[a]}</Button>)}</View>
    <View className='result-card'><View className='preview-header'><Text className='preview-title'>{'\u4efb\u52a1\u8bb0\u5f55'}</Text><Button className='preview-refresh' onClick={refreshAll}>{'\u6062\u590d/\u5237\u65b0'}</Button></View>{tasks.length === 0 ? <Text className='result-text'>{'\u6682\u65e0\u4efb\u52a1'}</Text> : tasks.map(task => <View key={task.localId} className='task-item'><Text className='result-text'>{task.request.payload.title}</Text><Text className='result-value'>{statusCopy[task.status] || task.status} / {task.phase} / {task.progress}%</Text>{task.error ? <Text className='task-error'>{task.error}</Text> : null}<View className='task-actions'>{workflow.canCancel(task) ? <Button size='mini' onClick={() => cancelTask(task)}>{'\u53d6\u6d88'}</Button> : null}{(task.status === 'draft' || workflow.canRetry(task)) ? <Button size='mini' onClick={() => submit(task.request.taskType, task)}>{'\u91cd\u8bd5'}</Button> : null}{task.status === 'completed' && task.result?.artifactId ? <Button size='mini' onClick={() => downloadTask(task)}>{'\u4e0b\u8f7d'}</Button> : null}</View></View>)}</View>
  </View>;
}
