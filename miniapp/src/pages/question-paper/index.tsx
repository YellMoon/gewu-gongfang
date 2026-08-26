import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Input, Button, Picker, ScrollView, RichText } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { miniappCloudBusinessApi } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import { canUserSubmitMiniappWrite, createQuestionBasketRuntime, createQuestionPaperTaskCacheRuntime } from '../../utils/miniappAuthorizationRuntime';
import { storage } from '../../utils/storage';
// @ts-ignore CommonJS workflow module has no TypeScript declarations.
import * as workflow from '../../utils/questionPaperWorkflow';
import './index.scss';

type PaperAction = 'paper-export-word' | 'paper-export-pdf';
interface QuestionPreview { id: string; subject: string; type: string; stemPreview: string; answer?: string; explanation?: string; options?: any[]; difficulty?: number; source?: string; knowledgeLabels?: string[]; richContent?: any; status: string; }
interface PaperItem {
  id: string; subject: string; type: string; stemPreview: string; sectionTitle: string; score: number;
  answer?: string; explanation?: string; options?: any[]; difficulty?: number; source?: string; knowledgeLabels?: string[]; richContent?: any;
}
interface PaperTask { localId: string; confirmed: boolean; taskId?: string; status: string; phase: string; progress: number; request: any; error?: string; resultExpiresAt?: string | null; }
interface PaperDraft { title: string; answerPosition: 'end' | 'after'; formulaMode: string; items: Array<{ id: string; sectionTitle: string; score: number }>; }

const answerOptions = [{ value: 'end', label: '答案统一置后' }, { value: 'after', label: '答案逐题后' }];
const formulaOptions = [{ value: 'word-native', label: 'Word 原生公式' }, { value: 'eq-field', label: 'EQ 域公式' }, { value: 'mathtype-compatible', label: 'MathType 兼容' }, { value: 'latex-vector', label: 'LaTeX 矢量公式' }];
const statusText: Record<string, string> = { draft: '本地草稿', queued: '云端排队中', processing: '处理中', completed: '已完成', failed: '失败', cancelled: '已取消' };

for (const option of answerOptions) option.label = String.fromCharCode(31572, 26696, 20301, 32622, 65306) + option.label;
for (const option of formulaOptions) option.label = String.fromCharCode(20844, 24335, 26041, 24335, 65306) + option.label;

function sectionFor(type: string) {
  const sections: Record<string, string> = { single_choice: '一、单选题', multiple_choice: '二、多选题', true_false: '三、判断题', fill_blank: '四、填空题', calculation: '五、计算题', experiment: '六、实验题', essay: '七、简答题' };
  return sections[type] || '综合题';
}
function scoreFor(type: string) { return ['single_choice', 'true_false', 'fill_blank'].includes(type) ? 3 : 6; }
function questionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    single_choice: String.fromCharCode(21333, 36873, 39064), multiple_choice: String.fromCharCode(22810, 36873, 39064),
    true_false: String.fromCharCode(21028, 26029, 39064), fill_blank: String.fromCharCode(22635, 31354, 39064),
    essay: String.fromCharCode(31616, 31572, 39064), calculation: String.fromCharCode(35745, 31639, 39064), experiment: String.fromCharCode(23454, 39564, 39064),
  };
  return labels[type] || type;
}
const QUESTION_ASSET_REF = /question-asset:\/\/([0-9a-f]{64})/g;
function questionAssetKeys(value: unknown): string[] { return Array.from((typeof value === 'string' ? value : JSON.stringify(value || {})).matchAll(QUESTION_ASSET_REF)).map(match => match[1]); }
function questionAssetRequests(item: PaperItem): Array<{ questionId: string; assetKey: string }> { return Array.from(new Set([
  ...questionAssetKeys(item.stemPreview), ...questionAssetKeys(item.options), ...questionAssetKeys(item.answer), ...questionAssetKeys(item.explanation), ...questionAssetKeys(item.richContent),
])).map(assetKey => ({ questionId: item.id, assetKey })); }
function miniRichNodes(value: string, paths: Record<string, string>) { return String(value || '').replace(QUESTION_ASSET_REF, (_ref, assetKey) => paths[assetKey] || ''); }
function formatQuestionOption(option: any, index: number) {
  if (typeof option === 'string') return option;
  if (!option || typeof option !== 'object') return '';
  const label = String(option.label || option.key || option.value || String.fromCharCode(65 + index)).trim();
  const content = String(option.content || option.text || option.title || '').trim();
  return content ? label + String.fromCharCode(12290) + content : '';
}
function defaultItems(questions: QuestionPreview[], ids: string[]): PaperItem[] {
  const byId = new Map(questions.map(question => [question.id, question]));
  return ids.map(id => byId.get(id)).filter(Boolean).map(question => ({
    id: question!.id, subject: question!.subject, type: question!.type, stemPreview: question!.stemPreview,
    answer: question!.answer, explanation: question!.explanation, options: question!.options,
    difficulty: question!.difficulty, source: question!.source, knowledgeLabels: question!.knowledgeLabels, richContent: question!.richContent,
    sectionTitle: sectionFor(question!.type), score: scoreFor(question!.type),
  }));
}
function restoreItems(questions: QuestionPreview[], ids: string[], saved: PaperDraft | null): PaperItem[] {
  const defaults = defaultItems(questions, ids);
  if (!saved || !Array.isArray(saved.items) || saved.items.length !== defaults.length || saved.items.some((item, index) => item?.id !== defaults[index].id)) return defaults;
  return defaults.map((item, index) => ({
    ...item,
    sectionTitle: typeof saved.items[index].sectionTitle === 'string' && saved.items[index].sectionTitle.trim() ? saved.items[index].sectionTitle.trim() : item.sectionTitle,
    score: Number.isSafeInteger(saved.items[index].score) && saved.items[index].score >= 0 ? saved.items[index].score : item.score,
  }));
}

export default function QuestionPaperPage() {
  const basketRuntimeRef = useRef<any>(null);
  const assetRetryRef = useRef(0);
  if (!basketRuntimeRef.current) basketRuntimeRef.current = createQuestionBasketRuntime({
    readIdentity: () => Taro.getStorageSync('user_info'),
    read: (key: string) => storage.get<string[]>(key),
    write: (key: string, ids: string[]) => storage.set(key, ids),
  });
  const taskRuntimeRef = useRef<any>(null);
  if (!taskRuntimeRef.current) taskRuntimeRef.current = createQuestionPaperTaskCacheRuntime({
    readIdentity: () => Taro.getStorageSync('user_info'),
    read: (key: string) => storage.get<PaperTask[]>(key),
    write: (key: string, tasks: PaperTask[]) => storage.set(key, tasks),
  });
  const basketRuntime = basketRuntimeRef.current;
  const taskRuntime = taskRuntimeRef.current;
  const [basketState, setBasketState] = useState<{ scopeKey: string; ids: string[] }>(() => basketRuntime.snapshot());
  const [taskState, setTaskState] = useState<{ scopeKey: string; tasks: PaperTask[] }>(() => taskRuntime.snapshot());
  const [questions, setQuestions] = useState<QuestionPreview[]>([]);
  const [items, setItems] = useState<PaperItem[]>([]);
  const [title, setTitle] = useState('练习试卷');
  const [answerPosition, setAnswerPosition] = useState<'end' | 'after'>('end');
  const [formulaMode, setFormulaMode] = useState('word-native');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<PaperAction | null>(null);
  const [taskBusyId, setTaskBusyId] = useState('');
  const [assetPaths, setAssetPaths] = useState<Record<string, string>>({});
  const identity = Taro.getStorageSync('user_info');
  const canBuildPaper = canUserSubmitMiniappWrite(identity, 'question-paper', ['question-paper']);
  const editorKey = basketState.scopeKey ? 'question_paper_editor_v1_' + encodeURIComponent(basketState.scopeKey) : '';

  const reload = async () => {
    setLoading(true);
    const response: any = await miniappCloudBusinessApi.listQuestionPreviews(authSessionRuntime.capture().token);
    if (!response.success) {
      Taro.showToast({ title: '题目加载失败，请联网后重试', icon: 'none' });
      setQuestions([]);
      setItems([]);
      setLoading(false);
      return;
    }
    const listed = Array.isArray(response.data?.questions) ? response.data.questions : [];
    const currentBasket = basketRuntime.snapshot();
    setBasketState(currentBasket);
    const saved = currentBasket.scopeKey ? storage.get<PaperDraft>('question_paper_editor_v1_' + encodeURIComponent(currentBasket.scopeKey)) : null;
    const nextItems = restoreItems(listed, currentBasket.ids, saved);
    setQuestions(listed);
    setItems(nextItems);
    if (saved && typeof saved.title === 'string' && saved.title.trim()) setTitle(saved.title);
    if (saved?.answerPosition === 'after' || saved?.answerPosition === 'end') setAnswerPosition(saved.answerPosition);
    if (formulaOptions.some(option => option.value === saved?.formulaMode)) setFormulaMode(saved!.formulaMode);
    const requests = Array.from(new Map(nextItems.flatMap(questionAssetRequests).map(item => [item.questionId + ':' + item.assetKey, item])).values());
    const token = authSessionRuntime.capture().token;
    if (requests.length && token) {
      const loaded = await Promise.all(requests.map(async ({ questionId, assetKey }) => {
        const prepared: any = await miniappCloudBusinessApi.requestQuestionAssetDelivery(token, questionId, assetKey);
        const delivery = prepared.data?.delivery;
        if (!prepared.success || !delivery || delivery.status !== 'ready') return null;
        const downloaded: any = await miniappCloudBusinessApi.downloadQuestionAssetDelivery(token, delivery.deliveryId);
        return downloaded.success && downloaded.data?.tempFilePath ? [assetKey, downloaded.data.tempFilePath] as const : null;
      }));
      const next = Object.fromEntries(loaded.filter(Boolean) as Array<readonly [string, string]>);
      if (Object.keys(next).length) setAssetPaths(current => ({ ...current, ...next }));
      if (Object.keys(next).length < requests.length && assetRetryRef.current < 5) {
        assetRetryRef.current += 1;
        setTimeout(() => { void reload(); }, 1500);
      }
    }
    setLoading(false);
  };
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    const current = basketRuntime.snapshot();
    if (current.scopeKey !== basketState.scopeKey) setBasketState(current);
    const tasks = taskRuntime.snapshot();
    if (tasks.scopeKey !== taskState.scopeKey) setTaskState(tasks);
  });
  useEffect(() => {
    if (!editorKey || loading) return;
    storage.set<PaperDraft>(editorKey, { title, answerPosition, formulaMode, items: items.map(item => ({ id: item.id, sectionTitle: item.sectionTitle, score: item.score })) });
  }, [editorKey, loading, title, answerPosition, formulaMode, items]);

  const totalScore = useMemo(() => items.reduce((total, item) => total + item.score, 0), [items]);
  const typeStats = useMemo(() => Array.from(items.reduce((result, item) => result.set(item.type, (result.get(item.type) || 0) + 1), new Map<string, number>()).entries()), [items]);
  const difficultyStats = useMemo(() => Array.from(items.filter(item => Number.isFinite(item.difficulty)).reduce((result, item) => {
    const level = Number(item.difficulty); return result.set(level, (result.get(level) || 0) + 1);
  }, new Map<number, number>()).entries()).sort(([left], [right]) => left - right), [items]);
  const groups = useMemo(() => {
    const result: Array<{ title: string; count: number }> = [];
    for (const item of items) {
      const found = result.find(group => group.title === item.sectionTitle);
      if (found) found.count += 1; else result.push({ title: item.sectionTitle, count: 1 });
    }
    return result;
  }, [items]);
  const sectionOptions = useMemo(() => Array.from(new Set([
    ...Object.values({ single_choice: sectionFor('single_choice'), multiple_choice: sectionFor('multiple_choice'), true_false: sectionFor('true_false'), fill_blank: sectionFor('fill_blank'), calculation: sectionFor('calculation'), experiment: sectionFor('experiment'), essay: sectionFor('essay'), other: sectionFor('other') }),
    ...items.map(item => item.sectionTitle).filter(Boolean),
  ])), [items]);
  const updateItem = (id: string, patch: Partial<PaperItem>) => setItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  const moveItem = (index: number, offset: number) => setItems(current => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= current.length) return current;
    const next = current.slice();
    const currentItem = next[index];
    next[index] = next[nextIndex];
    next[nextIndex] = currentItem;
    return next;
  });
  const regroup = () => setItems(current => current.map(item => ({ ...item, sectionTitle: sectionFor(item.type) })));
  const removeItem = (id: string) => {
    const nextIds = basketState.ids.filter(questionId => questionId !== id);
    const result = basketRuntime.replace(nextIds, basketState.scopeKey);
    setBasketState(result.snapshot);
    setItems(current => current.filter(item => item.id !== id));
  };
  const persistTask = (tasks: PaperTask[]) => {
    const result = taskRuntime.replace(tasks, taskState.scopeKey);
    setTaskState(result.snapshot);
    return result.written;
  };
  const submit = async (taskType: PaperAction, retry?: PaperTask) => {
    if (!canBuildPaper || !taskState.scopeKey) return;
    const questionIds = retry?.request?.payload?.questionIds || items.map(item => item.id);
    const currentTitle = retry?.request?.payload?.title || title.trim();
    const layout = retry?.request?.payload?.layout || { items: items.map(item => ({ id: item.id, sectionTitle: item.sectionTitle, score: item.score })) };
    if (!currentTitle || questionIds.length === 0) {
      Taro.showToast({ title: '请先添加题目并填写试卷名称', icon: 'none' });
      return;
    }
    const draft: PaperTask = workflow.createTaskDraft({
      taskType, questionIds, title: currentTitle, answerPosition: retry?.request?.payload?.answerPosition || answerPosition,
      formulaMode: retry?.request?.payload?.formulaMode || formulaMode, layout,
    }, { idFactory: () => String(Date.now()) + '-' + Math.random().toString(36).slice(2) });
    setSubmitting(taskType);
    try {
      const currentQuestion = questions.find(question => question.id === questionIds[0]);
      const response: any = await miniappCloudBusinessApi.createPaperExportTask(authSessionRuntime.capture().token, taskType, {
        questionIds, title: currentTitle, subject: currentQuestion?.subject || 'general',
        answerPosition: draft.request.payload.answerPosition, formulaMode: draft.request.payload.formulaMode, layout: draft.request.payload.layout,
      }, draft.request.idempotencyKey);
      const cloud = response.data?.task;
      if (!response.success || !cloud) throw new Error('云端未确认本次导出');
      persistTask([{ ...draft, confirmed: true, taskId: cloud.taskId, status: cloud.status, phase: cloud.phase || cloud.status, progress: Number(cloud.progress || 0), error: '' }, ...taskState.tasks]);
    } catch (error: any) {
      persistTask([{ ...draft, error: error?.message || '导出提交失败' }, ...taskState.tasks]);
      Taro.showToast({ title: error?.message || '导出提交失败', icon: 'none' });
    } finally { setSubmitting(null); }
  };
  const refreshTasks = async () => {
    if (!taskState.scopeKey) return;
    const next = await Promise.all(taskState.tasks.map(async task => {
      if (!task.confirmed || !task.taskId) return task;
      const response: any = await miniappCloudBusinessApi.readPaperExportTask(authSessionRuntime.capture().token, task.taskId);
      const cloud = response.data?.task;
      return response.success && cloud ? { ...task, status: cloud.status, phase: cloud.phase || cloud.status, progress: Number(cloud.progress || 0), error: '' } : task;
    }));
    persistTask(next);
  };
  const cancelTask = async (task: PaperTask) => {
    if (!task.confirmed || !task.taskId || taskBusyId) return;
    setTaskBusyId(task.localId);
    try {
      const response: any = await miniappCloudBusinessApi.cancelPaperExportTask(authSessionRuntime.capture().token, task.taskId);
      const cloud = response.data?.task;
      if (!response.success || !cloud) throw new Error(response.error || String.fromCharCode(26242, 26102, 26080, 27861, 21462, 28040, 23548, 20986));
      persistTask(taskState.tasks.map(current => current.localId === task.localId ? {
        ...current, status: cloud.status, phase: cloud.phase || cloud.status, progress: Number(cloud.progress || 0), error: '',
      } : current));
    } catch (error: any) { Taro.showToast({ title: error?.message || String.fromCharCode(21462, 28040, 22833, 36133, 65292, 35831, 31245, 21518, 37325, 35797), icon: 'none' }); }
    finally { setTaskBusyId(''); }
  };
  const download = async (task: PaperTask) => {
    if (!task.taskId) return;
    try {
      const prepared: any = await miniappCloudBusinessApi.requestPaperExportDelivery(authSessionRuntime.capture().token, task.taskId);
      const delivery = prepared.data?.delivery;
      if (!prepared.success || !delivery) throw new Error('暂时无法准备导出文件');
      if (delivery.status !== 'ready') { Taro.showToast({ title: '文件正在准备，请稍后刷新', icon: 'none' }); return; }
      const file: any = await miniappCloudBusinessApi.downloadPaperExportDelivery(authSessionRuntime.capture().token, delivery.deliveryId);
      if (!file.success || !file.data?.tempFilePath) throw new Error('下载失败，请稍后重试');
      await Taro.openDocument({ filePath: file.data.tempFilePath, showMenu: true });
    } catch (error: any) { Taro.showToast({ title: error?.message || '下载失败', icon: 'none' }); }
  };

  if (!canBuildPaper) return <View className='question-paper-page access-boundary'><Text>{'关联教师身份后可选题组卷和导出。'}</Text><Button onClick={() => Taro.navigateTo({ url: '/pages/account-application/index' })}>{'去申请'}</Button></View>;
  const distributionSummary = items.length ? <View className='paper-summary paper-distribution'>{typeStats.map(([type, count]) => <Text key={type}>{questionTypeLabel(type) + ' ' + count + ' ' + String.fromCharCode(39064)}</Text>)}{difficultyStats.map(([level, count]) => <Text key={String(level)}>{String.fromCharCode(38590, 24230) + level + ' ' + count + ' ' + String.fromCharCode(39064)}</Text>)}</View> : null;
  return <View className='question-paper-page'>{distributionSummary}
    <View className='paper-form'><Text className='field-label'>{'试卷名称'}</Text><Input className='field-input' value={title} onInput={event => setTitle(event.detail.value)} />
      <Picker mode='selector' range={answerOptions.map(option => option.label)} value={answerOptions.findIndex(option => option.value === answerPosition)} onChange={event => setAnswerPosition(answerOptions[Number(event.detail.value)].value as 'end' | 'after')}><View className='picker-row'>{answerOptions.find(option => option.value === answerPosition)?.label}</View></Picker>
      <Picker mode='selector' range={formulaOptions.map(option => option.label)} value={formulaOptions.findIndex(option => option.value === formulaMode)} onChange={event => setFormulaMode(formulaOptions[Number(event.detail.value)].value)}><View className='picker-row'>{formulaOptions.find(option => option.value === formulaMode)?.label}</View></Picker>
    </View>
    <View className='paper-summary'><Text>{'题目 ' + items.length + ' 题'}</Text><Text>{'总分 ' + totalScore + ' 分'}</Text>{groups.map(group => <Text key={group.title}>{group.title + ' ' + group.count + ' 题'}</Text>)}</View>
    <View className='paper-tools'><Button className='compact-button' onClick={regroup} disabled={loading || !items.length}>{'按题型分组'}</Button><Button className='compact-button' onClick={reload}>{'刷新题目'}</Button></View>
    {loading ? <View className='paper-empty'><Text>{'正在加载已选题目'}</Text></View> : !items.length ? <View className='paper-empty'><Text>{'试题篮中暂无题目'}</Text><Button onClick={() => Taro.navigateBack()}>{'返回题库选题'}</Button></View> : <ScrollView className='paper-item-list' scrollY>{items.map((item, index) => <View key={item.id} className='paper-item'>
      <View className='paper-item-head'><Text>{String(index + 1) + '. ' + item.subject}</Text><View className='paper-order-actions'><Button size='mini' disabled={index === 0} onClick={() => moveItem(index, -1)}>{'上移'}</Button><Button size='mini' disabled={index === items.length - 1} onClick={() => moveItem(index, 1)}>{'下移'}</Button><Button size='mini' onClick={() => removeItem(item.id)}>{'移除'}</Button></View></View>
      <RichText className='paper-stem' nodes={miniRichNodes(item.stemPreview, assetPaths)} />{Array.isArray(item.options) && item.options.map((option, optionIndex) => { const content = formatQuestionOption(option, optionIndex); return content ? <RichText key={String(optionIndex)} className='paper-option' nodes={miniRichNodes(content, assetPaths)} /> : null; })}
      {(item.source || (item.knowledgeLabels || []).length) ? <View className='paper-question-tags'>{item.source ? <Text>{'\u6765\u6e90\uff1a' + item.source}</Text> : null}{(item.knowledgeLabels || []).map(label => <Text key={label}>{label}</Text>)}</View> : null}
      {answerPosition === 'after' ? <View className='paper-answer'><Text>{'\u7b54\u6848\uff1a' + (item.answer || '\u6682\u65e0')}</Text>{item.explanation ? <Text>{'\u89e3\u6790\uff1a' + item.explanation}</Text> : null}</View> : null}
      <View className='paper-edit-row'><Picker mode='selector' range={sectionOptions} value={Math.max(0, sectionOptions.indexOf(item.sectionTitle))} onChange={event => updateItem(item.id, { sectionTitle: sectionOptions[Number(event.detail.value)] })}><View className='section-picker'>{item.sectionTitle || '\u9009\u62e9\u5206\u7ec4'}</View></Picker><Input className='section-input' placeholder={'\u81ea\u5b9a\u4e49\u5206\u7ec4'} onInput={event => { const value = event.detail.value.trim(); if (value) updateItem(item.id, { sectionTitle: value }); }} /><Input className='score-input' type='number' value={String(item.score)} onInput={event => updateItem(item.id, { score: Math.max(0, Number(event.detail.value) || 0) })} /><Text>{'\u5206'}</Text></View>
    </View>)}</ScrollView>}
    {answerPosition === 'end' && items.length ? <View className='paper-answers'><Text className='answer-title'>{'\u53c2\u8003\u7b54\u6848\u4e0e\u89e3\u6790'}</Text>{items.map((item, index) => <View key={item.id} className='paper-answer'><Text>{String(index + 1) + '. \u7b54\u6848\uff1a' + (item.answer || '\u6682\u65e0')}</Text>{item.explanation ? <Text>{'\u89e3\u6790\uff1a' + item.explanation}</Text> : null}</View>)}</View> : null}
    <View className='paper-export-actions'><Button className='paper-export-pdf' loading={submitting === 'paper-export-pdf'} disabled={!items.length || Boolean(submitting)} onClick={() => submit('paper-export-pdf')}>{'导出 PDF'}</Button><Button className='paper-export-word' loading={submitting === 'paper-export-word'} disabled={!items.length || Boolean(submitting)} onClick={() => submit('paper-export-word')}>{'导出 Word'}</Button></View>
    <View className='result-card'><View className='preview-header'><Text className='preview-title'>{'导出记录'}</Text><Button className='preview-refresh' onClick={refreshTasks}>{'刷新'}</Button></View>{taskState.tasks.length ? taskState.tasks.map(task => <View key={task.localId} className='task-item'><Text>{task.request.payload.title}</Text><Text>{statusText[task.status] || task.status}</Text>{task.error ? <Text className='task-error'>{task.error}</Text> : null}<View className='task-actions'>{['queued', 'processing'].includes(task.status) && task.confirmed ? <Button size='mini' loading={taskBusyId === task.localId} onClick={() => cancelTask(task)}>{String.fromCharCode(21462, 28040)}</Button> : null}{task.status === 'completed' ? <Button size='mini' onClick={() => download(task)}>{'下载'}</Button> : null}{(task.status === 'failed' || task.status === 'cancelled' || task.status === 'draft') ? <Button size='mini' onClick={() => submit(task.request.taskType, task)}>{'重试'}</Button> : null}</View></View>) : <Text className='result-text'>{'暂无导出记录'}</Text>}</View>
  </View>;
}
