import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Input, Button, ScrollView, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { miniappCloudBusinessApi } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import { createQuestionPaperTaskCacheRuntime, usesLimitedQuestionProjection } from '../../utils/miniappAuthorizationRuntime';
import { storage } from '../../utils/storage';
import { isVisitorIdentity } from '../../utils/accountExperience';
// @ts-ignore CommonJS workflow module has no TypeScript declarations.
import * as workflow from '../../utils/questionPaperWorkflow';
import './index.scss';

type PaperAction = 'question-paper' | 'paper-export-word' | 'paper-export-pdf';
type PreviewState = 'loading' | 'ready' | 'empty' | 'offline' | 'forbidden';
interface QuestionPreview { id: string; subject: string; type: string; stemPreview: string; status: string; }
interface PaperTask { localId: string; confirmed: boolean; taskId?: string; status: string; phase: string; progress: number; createdAt: number; resultExpiresAt?: string | null; request: any; error?: string; }

const answers = [{ value: 'end', label: '\u7b54\u6848\u7edf\u4e00\u7f6e\u540e' }, { value: 'after', label: '\u7b54\u6848\u9010\u9898\u540e' }];
const formulas = [{ value: 'word-native', label: 'Word native' }, { value: 'eq-field', label: 'EQ field' }, { value: 'mathtype-compatible', label: 'MathType' }, { value: 'latex-vector', label: 'LaTeX vector' }];
const actionCopy: Record<PaperAction, string> = { 'question-paper': '\u521b\u5efa\u7ec4\u5377', 'paper-export-word': '\u5bfc\u51fa Word', 'paper-export-pdf': '\u5bfc\u51fa PDF' };
const statusCopy: Record<string, string> = { draft: '\u672c\u5730\u7ec4\u5377\u8349\u7a3f', queued: '\u4e91\u7aef\u6392\u961f\u4e2d', processing: '\u5904\u7406\u4e2d', completed: '\u5df2\u5b8c\u6210', failed: '\u5931\u8d25', cancelled: '\u5df2\u53d6\u6d88' };

export default function QuestionBankPage() {
  const identity = Taro.getStorageSync('user_info');
  const isVisitor = isVisitorIdentity(identity);
  const useLimitedProjection = usesLimitedQuestionProjection(identity);

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
  const [answerIndex, setAnswerIndex] = useState(0);
  const [formulaIndex, setFormulaIndex] = useState(0);
  const [taskState, setTaskState] = useState<{ scopeKey: string; tasks: PaperTask[] }>(() => taskCacheRuntime.snapshot());
  const [submitting, setSubmitting] = useState<PaperAction | null>(null);
  const tasks = taskState.tasks;

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
  const sessionToken = () => authSessionRuntime.capture().token;

  const loadQuestions = async () => {
    setPreviewState('loading'); setPreviewMessage('');
    const response: any = await miniappCloudBusinessApi.listQuestionPreviews(sessionToken());
    if (!response.success) {
      const forbidden = ['CLOUD_BUSINESS_ACCESS_DENIED', 'FORBIDDEN'].includes(String(response.code));
      setPreviewState(forbidden ? 'forbidden' : 'offline');
      setPreviewMessage(forbidden ? '\u8bf7\u8054\u7cfb\u6570\u636e\u8d1f\u8d23\u4eba\u786e\u8ba4\u9898\u5e93\u6743\u9650' : '\u8bf7\u8054\u7f51\u540e\u91cd\u8bd5');
      return;
    }
    const list = Array.isArray(response.data?.questions) ? response.data.questions : [];
    setQuestions(list);
    setPreviewState(list.length ? 'ready' : 'empty');
  };

  const refreshTask = async (task: PaperTask) => {
    if (!task.confirmed || !task.taskId) return task;
    try {
      const response: any = await miniappCloudBusinessApi.readPaperExportTask(sessionToken(), task.taskId);
      const cloud = response.data?.task;
      if (!response.success || !cloud) return { ...task, error: '\u6682时无法刷新任务，请稍后重试' };
      return { ...task, status: cloud.status, phase: cloud.phase || cloud.status, progress: Number(cloud.progress || 0), error: '' };
    } catch { return { ...task, error: 'refresh failed' }; }
  };
  const refreshAll = async () => {
    if (!synchronizeTaskScope()) return;
    persist(await Promise.all(tasks.map(refreshTask)));
  };
  useEffect(() => {
    loadQuestions();
    if (!useLimitedProjection) refreshAll();
  }, [useLimitedProjection]);
  useEffect(() => {
    const current = taskCacheRuntime.snapshot();
    if (current.scopeKey !== taskState.scopeKey) setTaskState(current);
  });

  const filtered = useMemo(() => {
    const key = searchText.trim().toLowerCase();
    return questions.filter(question => !key || `${question.subject} ${question.stemPreview} ${question.type}`.toLowerCase().includes(key));
  }, [questions, searchText]);

  const submit = async (taskType: PaperAction, source?: PaperTask) => {
    if (!synchronizeTaskScope()) return;
    const questionIds = source?.request?.payload?.questionIds || selectedIds;
    const taskTitle = source?.request?.payload?.title || title.trim();
    if (!taskTitle || questionIds.length === 0) {
      Taro.showToast({ title: questionIds.length ? '\u8bf7\u8f93\u5165\u8bd5\u5377\u540d\u79f0' : '\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u9053\u9898', icon: 'none' });
      return;
    }
    const draft: PaperTask = workflow.createTaskDraft({
      taskType, questionIds, title: taskTitle,
      answerPosition: source?.request?.payload?.answerPosition || answers[answerIndex].value,
      formulaMode: source?.request?.payload?.formulaMode || formulas[formulaIndex].value,
    }, { idFactory: () => `${Date.now()}-${Math.random().toString(36).slice(2)}` });
    if (taskType === 'question-paper') {
      persist([draft, ...tasks]);
      return;
    }
    setSubmitting(taskType);
    try {
      const selectedQuestion = questions.find(question => questionIds.includes(question.id));
      const response: any = await miniappCloudBusinessApi.createPaperExportTask(sessionToken(), taskType, {
        questionIds, title: taskTitle, subject: selectedQuestion?.subject || 'general',
        answerPosition: draft.request.payload.answerPosition, formulaMode: draft.request.payload.formulaMode,
      }, draft.request.idempotencyKey);
      const cloud = response.data?.task;
      if (!response.success || !cloud) throw new Error('\u4e91端未确认本次提交');
      persist([{ ...draft, confirmed: true, taskId: cloud.taskId, status: cloud.status, phase: cloud.phase || cloud.status, progress: Number(cloud.progress || 0), error: '' }, ...tasks]);
    } catch (error: any) {
      persist([{ ...draft, error: error?.message || 'cloud not confirmed' }, ...tasks]);
    } finally { setSubmitting(null); }
  };

  const cancelTask = async (task: PaperTask) => {
    if (!synchronizeTaskScope() || !workflow.canCancel(task) || !task.taskId) return;
    const response: any = await miniappCloudBusinessApi.cancelPaperExportTask(sessionToken(), task.taskId);
    if (response.success) persist(tasks.map(item => item.localId === task.localId ? { ...item, status: 'cancelled', phase: 'cancelled' } : item));
  };
  const downloadTask = async (task: PaperTask) => {
    if (!synchronizeTaskScope() || !task.taskId) return;
    try {
      const requested: any = await miniappCloudBusinessApi.requestPaperExportDelivery(sessionToken(), task.taskId);
      const delivery = requested.data?.delivery;
      if (!requested.success || !delivery) throw new Error('\u6682时无法准备导出文件');
      if (delivery.status !== 'ready') {
        Taro.showToast({ title: '\u5bfc\u51fa\u6587\u4ef6\u6b63\u5728\u51c6\u5907\uff0c\u8bf7\u7a0d\u540e\u5237\u65b0', icon: 'none' });
        return;
      }
      const file: any = await miniappCloudBusinessApi.downloadPaperExportDelivery(sessionToken(), delivery.deliveryId);
      if (!file.success || !file.data?.tempFilePath) throw new Error('\u4e0b载失败，请稍后重试');
      await Taro.openDocument({ filePath: file.data.tempFilePath, showMenu: true });
    } catch (error: any) { Taro.showToast({ title: error?.message || 'download failed', icon: 'none' }); }
  };

  const stateText = previewState === 'loading' ? '\u6b63\u5728\u52a0\u8f7d\u9898\u76ee' : previewState === 'empty' ? '\u4e91\u7aef\u6682\u65e0\u53ef\u7528\u9898\u76ee' : previewState === 'forbidden' ? '\u5f53\u524d\u8d26\u53f7\u65e0\u6743\u8bfb\u53d6\u9898\u5e93' : '\u79bb\u7ebf\u6216\u4e91\u7aef\u4e0d\u53ef\u8fbe';
  if (useLimitedProjection) return <View className='question-bank-page'>
    <View className='hero-card'><Text className='hero-title'>{isVisitor ? '\u8bbf\u5ba2\u9898\u76ee\u9884\u89c8' : '\u9898\u76ee\u9884\u89c8'}</Text><Text className='hero-subtitle'>{'\u9898\u5e93\u6587\u5b57\u9884\u89c8\u7531\u4e91\u7aef\u6743\u5a01\u63d0\u4f9b'}</Text></View>
    <View className='preview-card'><View className='preview-header'><Text className='preview-title'>{'\u9898\u76ee\u9884\u89c8'}</Text><Button className='preview-refresh' onClick={loadQuestions}>{'\u5237\u65b0'}</Button></View>
      {previewState !== 'ready' ? <View className={`question-preview-empty state-${previewState}`}><Text>{stateText}</Text><Text>{previewMessage}</Text></View> : <ScrollView className='question-preview-list' scrollY>{questions.map(question => <View key={question.id} className='question-preview-item'><View className='question-preview-meta'><Text>{question.subject}</Text><Text>{question.type}</Text></View><Text className='question-preview-stem'>{question.stemPreview}</Text></View>)}</ScrollView>}
    </View>
  </View>;
  return <View className='question-bank-page'>
    <View className='hero-card'><Text className='hero-title'>{'\u9898\u5e93\u7ec4\u5377\u4e0e\u5bfc\u51fa'}</Text><Text className='hero-subtitle'>{'\u9009\u9898\u4e0e\u5bfc\u51fa\u4efb\u52a1\u5747\u7ecf\u4e91\u7aef\u786e\u8ba4'}</Text></View>
    <View className='form-card'><View className='form-row'><Text className='field-label'>{'\u8bd5\u5377\u540d\u79f0'}</Text><Input className='field-input' value={title} onInput={event => setTitle(event.detail.value)} /></View><Picker mode='selector' range={answers.map(item => item.label)} value={answerIndex} onChange={event => setAnswerIndex(Number(event.detail.value))}><View className='picker-row'>{answers[answerIndex].label}</View></Picker><Picker mode='selector' range={formulas.map(item => item.label)} value={formulaIndex} onChange={event => setFormulaIndex(Number(event.detail.value))}><View className='picker-row'>{formulas[formulaIndex].label}</View></Picker></View>
    <View className='preview-card'><View className='preview-header'><View><Text className='preview-title'>{`\u9009\u62e9\u9898\u76ee (${selectedIds.length})`}</Text><Text className='preview-subtitle'>{'\u4e91\u7aef\u9898\u5e93\u9884\u89c8'}</Text></View><Button className='preview-refresh' onClick={loadQuestions}>{'\u5237\u65b0'}</Button></View><Input className='preview-search' value={searchText} onInput={event => setSearchText(event.detail.value)} />
      {previewState !== 'ready' ? <View className={`question-preview-empty state-${previewState}`}><Text>{stateText}</Text><Text>{previewMessage}</Text></View> : <ScrollView className='question-preview-list' scrollY>{filtered.map(question => { const order = selectedIds.indexOf(question.id); return <View key={question.id} className={`question-preview-item ${order >= 0 ? 'selected' : ''}`} onClick={() => setSelectedIds(workflow.toggleOrderedSelection(selectedIds, question.id))}><View className='question-preview-meta'><Text>{order >= 0 ? `#${order + 1}` : '+'}</Text><Text>{question.subject}</Text><Text>{question.type}</Text></View><Text className='question-preview-stem'>{question.stemPreview}</Text></View>; })}</ScrollView>}
    </View>
    <View className='action-card'>{(['question-paper', 'paper-export-word', 'paper-export-pdf'] as PaperAction[]).map(action => <Button key={action} className={`action-button ${action}`} loading={submitting === action} disabled={Boolean(submitting) || selectedIds.length === 0} onClick={() => submit(action)}>{actionCopy[action]}</Button>)}</View>
    <View className='result-card'><View className='preview-header'><Text className='preview-title'>{'\u4efb\u52a1\u8bb0\u5f55'}</Text><Button className='preview-refresh' onClick={refreshAll}>{'\u6062\u590d/\u5237\u65b0'}</Button></View>{tasks.length === 0 ? <Text className='result-text'>{'\u6682\u65e0\u4efb\u52a1'}</Text> : tasks.map(task => <View key={task.localId} className='task-item'><Text className='result-text'>{task.request.payload.title}</Text><Text className='result-value'>{statusCopy[task.status] || task.status} / {task.phase} / {task.progress}%</Text>{task.error ? <Text className='task-error'>{task.error}</Text> : null}<View className='task-actions'>{workflow.canCancel(task) ? <Button size='mini' onClick={() => cancelTask(task)}>{'\u53d6\u6d88'}</Button> : null}{(task.status === 'draft' || workflow.canRetry(task)) ? <Button size='mini' onClick={() => submit(task.request.taskType, task)}>{'\u91cd\u8bd5'}</Button> : null}{task.status === 'completed' && task.taskId ? <Button size='mini' onClick={() => downloadTask(task)}>{'\u4e0b\u8f7d'}</Button> : null}</View></View>)}</View>
  </View>;
}
