import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Input, Button, Picker, RichText } from '@tarojs/components';
import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { miniappCloudBusinessApi } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import { canUserSubmitMiniappWrite, createQuestionPaperTaskCacheRuntime } from '../../utils/miniappAuthorizationRuntime';
import { storage } from '../../utils/storage';
import { questionBasketStore, useQuestionBasket } from '../../utils/questionBasketStore';
import QuestionBasketOverlay from '../../components/QuestionBasketOverlay';
// @ts-ignore CommonJS workflow module has no TypeScript declarations.
import * as workflow from '../../utils/questionPaperWorkflow';
// @ts-ignore CommonJS shared display module has no TypeScript declarations.
import * as questionDisplayRuntime from '../../utils/questionDisplay';
import './index.scss';

type PaperAction = 'paper-export-word' | 'paper-export-pdf';
interface QuestionPreview { id: string; subject: string; type: string; stemPreview: string; answer?: string; explanation?: string; options?: any[]; difficulty?: number; sourceLabel?: string; source?: string; region?: string; school?: string; examType?: string; examYear?: string | number; knowledgeLabels?: string[]; richContent?: any; status: string; }
interface PaperItem {
  id: string; subject: string; type: string; stemPreview: string; sectionTitle: string; score: number;
  answer?: string; explanation?: string; options?: any[]; difficulty?: number; sourceLabel?: string; source?: string; region?: string; school?: string; examType?: string; examYear?: string | number; knowledgeLabels?: string[]; richContent?: any;
}
interface PaperTask { localId: string; confirmed: boolean; taskId?: string; status: string; phase: string; progress: number; request: any; error?: string; message?: string; resultExpiresAt?: string | null; }
interface PaperDraft { title: string; answerPosition: 'end' | 'after'; formulaMode: string; items: Array<{ id: string; sectionTitle: string; score: number }>; }
interface QuestionDisplay {
  stem: string;
  options: Array<{ label: string; content: string }>;
  subQuestions: Array<{ label: string; content: string; answer: string }>;
  answer: string;
  explanation: string;
}
type PaperLayoutField = 'sectionTitle' | 'score';
type PaperLayoutEditPhase = 'input' | 'blur';
interface PaperLayoutFieldResult {
  valid: boolean;
  rawValue: string;
  value: string | number | null;
  error: string;
  patch: Partial<Pick<PaperItem, PaperLayoutField>> | null;
  showError: boolean;
}
interface PaperLayoutValidationError { itemId: string; itemIndex: number; field: PaperLayoutField | 'layout'; message: string; }
interface PaperLayoutValidationResult {
  valid: boolean;
  errors: PaperLayoutValidationError[];
  error: string;
  layout: { items: Array<{ id: string; sectionTitle: string; score: number }> } | null;
}

const createQuestionDisplay = questionDisplayRuntime.createQuestionDisplay as (question: unknown) => QuestionDisplay;
const columnsForOptions = questionDisplayRuntime.columnsForOptions as (options: QuestionDisplay['options']) => number;
const resolveQuestionAssetRefs = questionDisplayRuntime.resolveQuestionAssetRefs as (value: string, paths: Record<string, string>) => string;
const reconcilePaperItemsWithBasket = workflow.reconcilePaperItemsWithBasket as (items: PaperItem[], basketIds: string[]) => PaperItem[];
const unavailableSelectionIds = workflow.unavailableSelectionIds as (selectedIds: string[], questions: QuestionPreview[]) => string[];
const normalizePaperLayoutField = workflow.normalizePaperLayoutField as (field: PaperLayoutField, value: unknown) => Omit<PaperLayoutFieldResult, 'patch' | 'showError'>;
const applyPaperLayoutFieldEdit = workflow.applyPaperLayoutFieldEdit as (item: PaperItem, edit: { field: PaperLayoutField; value: unknown; phase: PaperLayoutEditPhase }) => PaperLayoutFieldResult;
const validateAndNormalizePaperLayout = workflow.validateAndNormalizePaperLayout as (input: { questionIds: string[]; items: Array<{ id: string; sectionTitle: unknown; score: unknown }> }) => PaperLayoutValidationResult;

const answerOptions = [{ value: 'end', label: '答案统一置后' }, { value: 'after', label: '答案逐题后' }];
const formulaOptions = [{ value: 'word-native', label: 'Word 原生公式' }, { value: 'eq-field', label: 'EQ 域公式' }, { value: 'mathtype-compatible', label: 'MathType 兼容' }, { value: 'latex-vector', label: 'LaTeX 矢量公式' }];
const statusText: Record<string, string> = { draft: '本地草稿', queued: '云端排队中', processing: '处理中', completed: '已完成', failed: '失败', cancelled: '已取消' };

statusText.timed_out = '\u5df2\u8d85\u65f6';
for (const option of answerOptions) option.label = String.fromCharCode(31572, 26696, 20301, 32622, 65306) + option.label;
for (const option of formulaOptions) option.label = String.fromCharCode(20844, 24335, 26041, 24335, 65306) + option.label;

const FORMULA_RENDERING_LABEL = String.fromCharCode(20844, 24335, 65306, 20860, 23481, 25490, 29256);
const PAPER_TASK_POLL_INTERVAL_MS = 2500;

function isPendingPaperTask(task: PaperTask) {
  return task.confirmed && Boolean(task.taskId) && ['queued', 'processing'].includes(task.status);
}

function isPaperScore(value: unknown): value is number {
  return typeof value === 'number' && normalizePaperLayoutField('score', value).valid;
}

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
function subjectLabel(subject: string) {
  const labels: Record<string, string> = {
    physics: '\u7269\u7406', mathematics: '\u6570\u5b66', math: '\u6570\u5b66', chemistry: '\u5316\u5b66',
    biology: '\u751f\u7269', chinese: '\u8bed\u6587', english: '\u82f1\u8bed',
  };
  return labels[subject] || subject || '\u672a\u8bbe\u7f6e\u79d1\u76ee';
}
function questionSourceLabel(question: PaperItem) {
  const authoritativeLabel = String(question.sourceLabel || '').trim();
  if (authoritativeLabel) return authoritativeLabel;
  const parts = [question.source, question.region, question.school, question.examType, question.examYear]
    .map(value => String(value ?? '').trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join(' / ');
}
const QUESTION_ASSET_REF = /question-asset:\/\/([0-9a-f]{64})/g;
const QUESTION_ASSET_POLL_ATTEMPTS = 5;
const QUESTION_ASSET_POLL_INTERVAL_MS = 1500;
const QUESTION_ASSET_CONCURRENCY = 4;
function questionAssetKeys(value: unknown): string[] { return Array.from((typeof value === 'string' ? value : JSON.stringify(value || {})).matchAll(QUESTION_ASSET_REF)).map(match => match[1]); }
function questionAssetRequests(item: PaperItem): Array<{ questionId: string; assetKey: string }> {
  const display = createQuestionDisplay(item);
  return Array.from(new Set(questionAssetKeys(display))).map(assetKey => ({ questionId: item.id, assetKey }));
}
function miniRichNodes(value: string, paths: Record<string, string>) { return resolveQuestionAssetRefs(value, paths); }
function defaultItems(questions: QuestionPreview[], ids: string[]): PaperItem[] {
  const byId = new Map(questions.map(question => [question.id, question]));
  return ids.map(id => byId.get(id)).filter(Boolean).map(question => ({
    id: question!.id, subject: question!.subject, type: question!.type, stemPreview: question!.stemPreview,
    answer: question!.answer, explanation: question!.explanation, options: question!.options,
    difficulty: question!.difficulty,
    sourceLabel: question!.sourceLabel, source: question!.source, region: question!.region, school: question!.school,
    examType: question!.examType, examYear: question!.examYear,
    knowledgeLabels: question!.knowledgeLabels, richContent: question!.richContent,
    sectionTitle: sectionFor(question!.type), score: scoreFor(question!.type),
  }));
}
function restoreItems(questions: QuestionPreview[], ids: string[], saved: PaperDraft | null): PaperItem[] {
  const defaults = defaultItems(questions, ids);
  if (!saved || !Array.isArray(saved.items) || saved.items.length !== defaults.length || saved.items.some((item, index) => item?.id !== defaults[index].id)) return defaults;
  return defaults.map((item, index) => {
    const savedSection = normalizePaperLayoutField('sectionTitle', saved.items[index].sectionTitle);
    return {
      ...item,
      sectionTitle: savedSection.valid ? String(savedSection.value) : item.sectionTitle,
      score: isPaperScore(saved.items[index].score) ? saved.items[index].score : item.score,
    };
  });
}

function mergeQuestions(current: QuestionPreview[], incoming: QuestionPreview[]): QuestionPreview[] {
  const byId = new Map(current.map(question => [question.id, question]));
  incoming.forEach(question => {
    if (question?.id) byId.set(question.id, question);
  });
  return Array.from(byId.values());
}

export default function QuestionPaperPage() {
  const requestedQuestionAssetsRef = useRef<Set<string>>(new Set());
  const pageActiveRef = useRef(true);
  const taskRuntimeRef = useRef<any>(null);
  if (!taskRuntimeRef.current) taskRuntimeRef.current = createQuestionPaperTaskCacheRuntime({
    readIdentity: () => Taro.getStorageSync('user_info'),
    read: (key: string) => storage.get<PaperTask[]>(key),
    write: (key: string, tasks: PaperTask[]) => storage.set(key, tasks),
  });
  const taskRuntime = taskRuntimeRef.current;
  const basketState = useQuestionBasket();
  const [taskState, setTaskState] = useState<{ scopeKey: string; tasks: PaperTask[] }>(() => taskRuntime.snapshot());
  const [questions, setQuestions] = useState<QuestionPreview[]>([]);
  const [items, setItems] = useState<PaperItem[]>([]);
  const [title, setTitle] = useState('练习试卷');
  const [answerPosition, setAnswerPosition] = useState<'end' | 'after'>('end');
  const formulaMode = 'latex-vector';
  const [loading, setLoading] = useState(true);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [submitting, setSubmitting] = useState<PaperAction | null>(null);
  const [taskBusyId, setTaskBusyId] = useState('');
  const [taskSyncState, setTaskSyncState] = useState<'idle' | 'refreshing' | 'offline'>('idle');
  const [assetPaths, setAssetPaths] = useState<Record<string, string>>({});
  const [layoutEdits, setLayoutEdits] = useState<Record<string, Partial<Record<PaperLayoutField, string>>>>({});
  const [layoutErrors, setLayoutErrors] = useState<Record<string, string>>({});
  const identity = Taro.getStorageSync('user_info');
  const canBuildPaper = canUserSubmitMiniappWrite(identity, 'question-paper', ['question-paper']);
  const editorKey = basketState.scopeKey ? 'question_paper_editor_v1_' + encodeURIComponent(basketState.scopeKey) : '';

  const loadQuestionAssets = async (nextItems: PaperItem[], session: any) => {
    const token = session?.token;
    if (!token) return;
    const requests = Array.from(new Map(nextItems.flatMap(questionAssetRequests).map(item => [item.questionId + ':' + item.assetKey, item])).values()).filter(({ questionId, assetKey }) => {
      const requestKey = questionId + ':' + assetKey;
      if (assetPaths[assetKey] || requestedQuestionAssetsRef.current.has(requestKey)) return false;
      requestedQuestionAssetsRef.current.add(requestKey);
      return true;
    });
    if (!requests.length) return;
    const loadAsset = async ({ questionId, assetKey }: { questionId: string; assetKey: string }) => {
      const requestKey = questionId + ':' + assetKey;
      let requestCompleted = false;
      try {
        if (!pageActiveRef.current || !authSessionRuntime.isSameSession(session)) return null;
        const prepared: any = await miniappCloudBusinessApi.requestQuestionAssetDelivery(token, questionId, assetKey);
        let delivery = prepared.data?.delivery;
        if (!prepared.success || !delivery) return null;
        const deliveryId = delivery.deliveryId;
        for (let attempt = 0; ['queued', 'leased'].includes(delivery.status) && attempt < QUESTION_ASSET_POLL_ATTEMPTS; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, QUESTION_ASSET_POLL_INTERVAL_MS));
          if (!pageActiveRef.current || !authSessionRuntime.isSameSession(session)) return null;
          const refreshed: any = await miniappCloudBusinessApi.readQuestionAssetDelivery(token, deliveryId);
          if (!refreshed.success || !refreshed.data?.delivery || refreshed.data.delivery.deliveryId !== deliveryId) return null;
          delivery = refreshed.data.delivery;
        }
        if (delivery.status !== 'ready' || !pageActiveRef.current || !authSessionRuntime.isSameSession(session)) return null;
        const downloaded: any = await miniappCloudBusinessApi.downloadQuestionAssetDelivery(token, deliveryId);
        if (!downloaded.success || !downloaded.data?.tempFilePath) return null;
        requestCompleted = true;
        return [assetKey, downloaded.data.tempFilePath] as const;
      } catch {
        return null;
      } finally {
        if (!requestCompleted) requestedQuestionAssetsRef.current.delete(requestKey);
      }
    };
    const loaded: Array<readonly [string, string]> = [];
    let nextRequestIndex = 0;
    const workers = Array.from({ length: Math.min(QUESTION_ASSET_CONCURRENCY, requests.length) }, async () => {
      while (nextRequestIndex < requests.length) {
        const requestIndex = nextRequestIndex;
        nextRequestIndex += 1;
        const result = await loadAsset(requests[requestIndex]);
        if (result) loaded.push(result);
      }
    });
    await Promise.all(workers);
    if (!pageActiveRef.current || !authSessionRuntime.isSameSession(session)) return;
    const next = Object.fromEntries(loaded);
    if (Object.keys(next).length) setAssetPaths(current => ({ ...current, ...next }));
  };

  const reload = async () => {
    setLoading(true);
    setCatalogError('');
    const session = authSessionRuntime.capture();
    questionBasketStore.reconcileIdentity();
    const currentBasket = questionBasketStore.snapshot();
    const handoff = questionBasketStore.readPaperSelection();
    const selectedIds = handoff ? handoff.selectedIds : currentBasket.ids;
    const response: any = await miniappCloudBusinessApi.listQuestionPreviewsByIds(session.token, selectedIds);
    if (!pageActiveRef.current || !authSessionRuntime.isSameSession(session)) return;
    if (!response.success) {
      setCatalogError('\u9898\u76ee\u8bfb\u53d6\u672a\u5b8c\u6210\uff0c\u8bf7\u8054\u7f51\u540e\u4e0b\u62c9\u91cd\u8bd5');
      Taro.showToast({ title: '题目加载失败，请联网后重试', icon: 'none' });
      setLoading(false);
      return;
    }
    const listed = Array.isArray(response.data?.questions) ? response.data.questions : [];
    questionBasketStore.seedQuestions(listed);
    const unavailableIds = Array.isArray(response.data?.unavailableIds) ? response.data.unavailableIds : [];
    const saved = currentBasket.scopeKey ? storage.get<PaperDraft>('question_paper_editor_v1_' + encodeURIComponent(currentBasket.scopeKey)) : null;
    const nextItems = restoreItems(listed, selectedIds, saved);
    setQuestions(listed);
    setItems(nextItems);
    if (saved && typeof saved.title === 'string' && saved.title.trim()) setTitle(saved.title);
    if (saved?.answerPosition === 'after' || saved?.answerPosition === 'end') setAnswerPosition(saved.answerPosition);
    setCatalogLoaded(true);
    setLoading(false);
    if (unavailableIds.length) {
      Taro.showToast({ title: String(unavailableIds.length) + String.fromCharCode(36947, 39064, 24050, 19981, 21487, 29992, 65292, 26410, 21152, 20837, 24403, 21069, 35797, 21367), icon: 'none' });
    }
    void loadQuestionAssets(nextItems, session);
  };
  useEffect(() => {
    pageActiveRef.current = true;
    void reload();
    return () => {
      pageActiveRef.current = false;
    };
  }, []);
  useEffect(() => {
    const tasks = taskRuntime.snapshot();
    if (tasks.scopeKey !== taskState.scopeKey) setTaskState(tasks);
  });
  useEffect(() => {
    if (!editorKey || loading || !catalogLoaded) return;
    storage.set<PaperDraft>(editorKey, { title, answerPosition, formulaMode, items: items.map(item => ({ id: item.id, sectionTitle: item.sectionTitle, score: item.score })) });
  }, [editorKey, loading, catalogLoaded, title, answerPosition, formulaMode, items]);
  useEffect(() => {
    if (loading) return;
    setItems(current => {
      const next = reconcilePaperItemsWithBasket(current, basketState.ids);
      if (next.length === current.length && next.every((item, index) => item === current[index])) return current;
      return next;
    });
  }, [basketState.revision, loading]);

  const totalScore = useMemo(() => items.reduce((total, item) => total + item.score, 0), [items]);
  const typeStats = useMemo(() => Array.from(items.reduce((result, item) => result.set(item.type, (result.get(item.type) || 0) + 1), new Map<string, number>()).entries()), [items]);
  const difficultyStats = useMemo(() => Array.from(items.filter(item => Number.isFinite(item.difficulty)).reduce((result, item) => {
    const level = Number(item.difficulty); return result.set(level, (result.get(level) || 0) + 1);
  }, new Map<number, number>()).entries()).sort(([left], [right]) => left - right), [items]);
  const groupedItems = useMemo(() => {
    const result: Array<{ title: string; rows: Array<{ item: PaperItem; index: number }> }> = [];
    items.forEach((item, index) => {
      const title = item.sectionTitle || sectionFor(item.type);
      let group = result.find(row => row.title === title);
      if (!group) {
        group = { title, rows: [] };
        result.push(group);
      }
      group.rows.push({ item, index });
    });
    return result;
  }, [items]);
  const sectionOptions = useMemo(() => Array.from(new Set([
    ...Object.values({ single_choice: sectionFor('single_choice'), multiple_choice: sectionFor('multiple_choice'), true_false: sectionFor('true_false'), fill_blank: sectionFor('fill_blank'), calculation: sectionFor('calculation'), experiment: sectionFor('experiment'), essay: sectionFor('essay'), other: sectionFor('other') }),
    ...items.map(item => item.sectionTitle).filter(Boolean),
  ])), [items]);
  const updateItem = (id: string, patch: Partial<PaperItem>) => setItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  const layoutFieldKey = (id: string, field: PaperLayoutField) => id + ':' + field;
  const clearLayoutEdit = (id: string, field: PaperLayoutField) => setLayoutEdits(current => {
    if (!Object.prototype.hasOwnProperty.call(current[id] || {}, field)) return current;
    const row = { ...(current[id] || {}) };
    delete row[field];
    const next = { ...current };
    if (Object.keys(row).length) next[id] = row;
    else delete next[id];
    return next;
  });
  const setLayoutError = (id: string, field: PaperLayoutField, error: string) => setLayoutErrors(current => {
    const key = layoutFieldKey(id, field);
    if ((current[key] || '') === error) return current;
    const next = { ...current };
    if (error) next[key] = error;
    else delete next[key];
    return next;
  });
  const handleLayoutFieldEdit = (item: PaperItem, field: PaperLayoutField, value: unknown, phase: PaperLayoutEditPhase) => {
    const result = applyPaperLayoutFieldEdit(item, { field, value, phase });
    if (phase === 'input') {
      setLayoutEdits(current => ({ ...current, [item.id]: { ...(current[item.id] || {}), [field]: result.rawValue } }));
    }
    setLayoutError(item.id, field, result.error);
    if (result.patch) updateItem(item.id, result.patch);
    if (phase === 'blur' && result.valid) clearLayoutEdit(item.id, field);
    if (result.showError) Taro.showToast({ title: result.error, icon: 'none' });
  };
  const editedLayoutItems = () => items.map(item => {
    const edits = layoutEdits[item.id] || {};
    return {
      id: item.id,
      sectionTitle: Object.prototype.hasOwnProperty.call(edits, 'sectionTitle') ? edits.sectionTitle : item.sectionTitle,
      score: Object.prototype.hasOwnProperty.call(edits, 'score') ? edits.score : item.score,
    };
  });
  const resolveBasketQuestions = async (ids: string[]) => {
    const session = authSessionRuntime.capture();
    const response: any = await miniappCloudBusinessApi.listQuestionPreviewsByIds(session.token, ids);
    if (!pageActiveRef.current || !authSessionRuntime.isSameSession(session)) {
      return { success: false, error: '\u767b\u5f55\u72b6\u6001\u5df2\u53d8\u66f4' };
    }
    if (!response.success) {
      return { success: false, error: response.error || '\u9898\u76ee\u8bfb\u53d6\u672a\u5b8c\u6210' };
    }
    const resolved: QuestionPreview[] = Array.isArray(response.data?.questions) ? response.data.questions : [];
    questionBasketStore.seedQuestions(resolved);
    setQuestions(current => mergeQuestions(current, resolved));
    void loadQuestionAssets(defaultItems(resolved, ids), session);
    return {
      success: true,
      unavailableIds: Array.isArray(response.data?.unavailableIds) ? response.data.unavailableIds : [],
    };
  };
  const applyBasketSelection = (selectedIds: string[]) => {
    const hydratedQuestions = mergeQuestions(questions, selectedIds.map(id => questionBasketStore.question(id)).filter(Boolean));
    const unavailableIds = unavailableSelectionIds(selectedIds, hydratedQuestions);
    if (unavailableIds.length) {
      Taro.showToast({ title: String.fromCharCode(25152, 36873, 39064, 30446, 20013, 26377, 24050, 19981, 21487, 29992, 30340, 39064, 30446), icon: 'none' });
      return;
    }
    const currentById = new Map(items.map(item => [item.id, item]));
    const nextItems = defaultItems(hydratedQuestions, selectedIds).map(item => currentById.get(item.id) || item);
    setItems(nextItems);
    void loadQuestionAssets(nextItems, authSessionRuntime.capture());
  };
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
    const writeResult = questionBasketStore.removeMany([id]);
    if (!writeResult.written && writeResult.reason === 'persistence-failed') {
      Taro.showToast({ title: String.fromCharCode(35797, 39064, 31726, 20445, 23384, 22833, 36133, 65292, 35831, 37325, 35797), icon: 'none' });
      return;
    }
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
    if (!currentTitle || questionIds.length === 0) {
      Taro.showToast({ title: '请先添加题目并填写试卷名称', icon: 'none' });
      return;
    }
    const layoutInputItems = retry?.request?.payload?.layout?.items || editedLayoutItems();
    const layoutValidation = validateAndNormalizePaperLayout({ questionIds, items: layoutInputItems });
    if (!layoutValidation.valid || !layoutValidation.layout) {
      if (!retry) {
        const nextErrors: Record<string, string> = {};
        layoutValidation.errors.forEach(error => {
          if (error.itemId && (error.field === 'sectionTitle' || error.field === 'score')) {
            nextErrors[layoutFieldKey(error.itemId, error.field)] = error.message;
          }
        });
        setLayoutErrors(nextErrors);
      }
      const firstError = layoutValidation.errors[0];
      const prefix = firstError && firstError.itemIndex >= 0 ? '\u7b2c' + String(firstError.itemIndex + 1) + '\u9898\uff1a' : '';
      Taro.showToast({ title: prefix + (firstError?.message || '\u8bf7\u68c0\u67e5\u5206\u7ec4\u4e0e\u5206\u503c\u8bbe\u7f6e'), icon: 'none' });
      return;
    }
    const layout = layoutValidation.layout;
    if (!retry) {
      const normalizedById = new Map(layout.items.map(item => [item.id, item]));
      setItems(current => current.map(item => ({ ...item, ...(normalizedById.get(item.id) || {}) })));
      setLayoutEdits({});
      setLayoutErrors({});
    }
    const draft: PaperTask = workflow.createTaskDraft({
      taskType, questionIds, title: currentTitle, answerPosition: retry?.request?.payload?.answerPosition || answerPosition,
      formulaMode, layout,
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
      persistTask([{ ...draft, confirmed: true, taskId: cloud.taskId, status: cloud.status, phase: cloud.phase || cloud.status, progress: Number(cloud.progress || 0), message: cloud.message || '', resultExpiresAt: cloud.resultExpiresAt || cloud.result_expires_at || null, error: '' }, ...taskState.tasks]);
    } catch (error: any) {
      persistTask([{ ...draft, error: error?.message || '导出提交失败' }, ...taskState.tasks]);
      Taro.showToast({ title: error?.message || '导出提交失败', icon: 'none' });
    } finally { setSubmitting(null); }
  };
  const refreshTasks = async () => {
    const current = taskRuntime.snapshot();
    if (!current.scopeKey) return;
    setTaskSyncState('refreshing');
    const session = authSessionRuntime.capture();
    let refreshUnavailable = false;
    const next = await Promise.all(current.tasks.map(async (task: PaperTask) => {
      if (!isPendingPaperTask(task) || !pageActiveRef.current || !authSessionRuntime.isSameSession(session)) return task;
      try {
        const response: any = await miniappCloudBusinessApi.readPaperExportTask(session.token, task.taskId!);
        const cloud = response.data?.task;
        if (!response.success || !cloud) {
          refreshUnavailable = true;
          return task;
        }
        return { ...task, status: cloud.status, phase: cloud.phase || cloud.status, progress: Number(cloud.progress || 0), message: cloud.message || '', resultExpiresAt: cloud.resultExpiresAt || cloud.result_expires_at || task.resultExpiresAt || null, error: '' };
      } catch (_error) {
        refreshUnavailable = true;
        return task;
      }
    }));
    if (!pageActiveRef.current || !authSessionRuntime.isSameSession(session)) return;
    const result = taskRuntime.replace(next, current.scopeKey);
    setTaskState(result.snapshot);
    setTaskSyncState(refreshUnavailable ? 'offline' : 'idle');
  };
  const cancelTask = async (task: PaperTask) => {
    if (!task.confirmed || !task.taskId || taskBusyId) return;
    setTaskBusyId(task.localId);
    try {
      const response: any = await miniappCloudBusinessApi.cancelPaperExportTask(authSessionRuntime.capture().token, task.taskId);
      const cloud = response.data?.task;
      if (!response.success || !cloud) throw new Error(response.error || String.fromCharCode(26242, 26102, 26080, 27861, 21462, 28040, 23548, 20986));
      persistTask(taskState.tasks.map(current => current.localId === task.localId ? {
        ...current, status: cloud.status, phase: cloud.phase || cloud.status, progress: Number(cloud.progress || 0), message: cloud.message || '', error: '',
      } : current));
    } catch (error: any) { Taro.showToast({ title: error?.message || String.fromCharCode(21462, 28040, 22833, 36133, 65292, 35831, 31245, 21518, 37325, 35797), icon: 'none' }); }
    finally { setTaskBusyId(''); }
  };
  const download = async (task: PaperTask) => {
    if (!task.taskId || taskBusyId) return;
    setTaskBusyId(task.localId);
    try {
      const prepared: any = await miniappCloudBusinessApi.requestPaperExportDelivery(authSessionRuntime.capture().token, task.taskId);
      const delivery = prepared.data?.delivery;
      if (!prepared.success || !delivery) throw new Error('暂时无法准备导出文件');
      if (delivery.status !== 'ready') { Taro.showToast({ title: '文件正在准备，请稍后刷新', icon: 'none' }); return; }
      const file: any = await miniappCloudBusinessApi.downloadPaperExportDelivery(authSessionRuntime.capture().token, delivery.deliveryId);
      if (!file.success || !file.data?.tempFilePath) throw new Error('下载失败，请稍后重试');
      await Taro.openDocument({ filePath: file.data.tempFilePath, showMenu: true });
    } catch (error: any) { Taro.showToast({ title: error?.message || '下载失败', icon: 'none' }); }
    finally { setTaskBusyId(''); }
  };

  usePullDownRefresh(async () => {
    try {
      await reload();
      await refreshTasks();
    } finally {
      Taro.stopPullDownRefresh();
    }
  });

  useEffect(() => {
    const hasPendingTask = taskState.tasks.some(isPendingPaperTask);
    if (!taskState.scopeKey || !hasPendingTask) return undefined;
    const timer = setInterval(() => { void refreshTasks(); }, PAPER_TASK_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [taskState.scopeKey, taskState.tasks.map(task => `${task.localId}:${task.taskId || ''}:${task.status}`).join('|')]);

  const renderPaperItem = (item: PaperItem, index: number) => {
    const display = createQuestionDisplay(item);
    const optionColumns = columnsForOptions(display.options);
    const sourceLabel = questionSourceLabel(item);
    return <View key={item.id} className='paper-item'>
      <View className='paper-item-head'>
        <View className='paper-item-identity'><Text className='paper-item-number'>{String(index + 1)}</Text><Text>{questionTypeLabel(item.type)}</Text></View>
        <View className='paper-order-actions'>
          <Button size='mini' disabled={index === 0} onClick={() => moveItem(index, -1)}>{'\u4e0a\u79fb'}</Button>
          <Button size='mini' disabled={index === items.length - 1} onClick={() => moveItem(index, 1)}>{'\u4e0b\u79fb'}</Button>
          <Button size='mini' onClick={() => removeItem(item.id)}>{'\u79fb\u9664'}</Button>
        </View>
      </View>
      <RichText className='paper-stem' nodes={miniRichNodes(display.stem, assetPaths)} />
      {display.options.length ? <View className={'paper-options columns-' + optionColumns}>{display.options.map((option, optionIndex) => <View key={option.label + '-' + String(optionIndex)} className='paper-option'><Text className='paper-option-label'>{option.label + '.'}</Text><RichText className='paper-option-content' nodes={miniRichNodes(option.content, assetPaths)} /></View>)}</View> : null}
      {display.subQuestions.length ? <View className='paper-subquestions'>{display.subQuestions.map((subQuestion, subIndex) => <View key={subQuestion.label + '-' + String(subIndex)} className='paper-subquestion'><Text className='paper-subquestion-label'>{subQuestion.label}</Text><RichText className='paper-subquestion-content' nodes={miniRichNodes(subQuestion.content, assetPaths)} /></View>)}</View> : null}
      {(sourceLabel || (item.knowledgeLabels || []).length) ? <View className='paper-question-tags'>{sourceLabel ? <Text>{'\u6765\u6e90\uff1a' + sourceLabel}</Text> : null}{(item.knowledgeLabels || []).map(label => <Text key={label}>{label}</Text>)}</View> : null}
      {answerPosition === 'after' ? <View className='paper-answer'><Text>{'\u7b54\u6848\uff1a'}</Text><RichText className='paper-answer-content' nodes={miniRichNodes(display.answer || '\u6682\u65e0', assetPaths)} />{display.subQuestions.some(subQuestion => subQuestion.answer) ? <View className='paper-subquestion-answers'>{display.subQuestions.map((subQuestion, subIndex) => subQuestion.answer ? <View key={subQuestion.label + '-' + String(subIndex)}><Text>{subQuestion.label + ' '}</Text><RichText className='paper-answer-content' nodes={miniRichNodes(subQuestion.answer, assetPaths)} /></View> : null)}</View> : null}{display.explanation ? <View><Text>{'\u89e3\u6790\uff1a'}</Text><RichText className='paper-answer-content' nodes={miniRichNodes(display.explanation, assetPaths)} /></View> : null}</View> : null}
      <View className='paper-edit-row'>
        <Picker mode='selector' range={sectionOptions} value={Math.max(0, sectionOptions.indexOf(item.sectionTitle))} onChange={event => handleLayoutFieldEdit(item, 'sectionTitle', sectionOptions[Number(event.detail.value)], 'blur')}><View className='section-picker'>{item.sectionTitle || '\u9009\u62e9\u5206\u7ec4'}</View></Picker>
        <Input className='section-input' placeholder={'\u81ea\u5b9a\u4e49\u5206\u7ec4'} value={layoutEdits[item.id]?.sectionTitle ?? ''} onInput={event => handleLayoutFieldEdit(item, 'sectionTitle', event.detail.value, 'input')} onBlur={event => handleLayoutFieldEdit(item, 'sectionTitle', event.detail.value, 'blur')} />
        <Input className='score-input' type='digit' value={layoutEdits[item.id]?.score ?? String(item.score)} onInput={event => handleLayoutFieldEdit(item, 'score', event.detail.value, 'input')} onBlur={event => handleLayoutFieldEdit(item, 'score', event.detail.value, 'blur')} />
        <Text>{'\u5206'}</Text>
      </View>
      {layoutErrors[layoutFieldKey(item.id, 'sectionTitle')] || layoutErrors[layoutFieldKey(item.id, 'score')] ? <View className='paper-edit-errors'>
        {layoutErrors[layoutFieldKey(item.id, 'sectionTitle')] ? <Text className='paper-field-error'>{layoutErrors[layoutFieldKey(item.id, 'sectionTitle')]}</Text> : null}
        {layoutErrors[layoutFieldKey(item.id, 'score')] ? <Text className='paper-field-error'>{layoutErrors[layoutFieldKey(item.id, 'score')]}</Text> : null}
      </View> : null}
    </View>;
  };

  if (!canBuildPaper) return <View className='question-paper-page access-boundary'><Text>{'组卷和导出需要教师角色。'}</Text><Button onClick={() => Taro.navigateTo({ url: '/pages/account-application/index' })}>{'去申请'}</Button></View>;
  const taskProgress = (task: PaperTask) => Math.max(0, Math.min(100, Number(task.progress) || 0));
  return <View className='question-paper-page'>
    <View className='paper-form'>
      <Text className='field-label'>{'\u8bd5\u5377\u540d\u79f0'}</Text>
      <Input className='field-input' value={title} onInput={event => setTitle(event.detail.value)} />
      <Picker mode='selector' range={answerOptions.map(option => option.label)} value={answerOptions.findIndex(option => option.value === answerPosition)} onChange={event => setAnswerPosition(answerOptions[Number(event.detail.value)].value as 'end' | 'after')}><View className='picker-row'>{answerOptions.find(option => option.value === answerPosition)?.label}</View></Picker>
      <View className='picker-row'>{FORMULA_RENDERING_LABEL}</View>
    </View>

    {catalogError ? <View className='paper-status-banner offline'><Text>{catalogError}</Text><Text>{'\u4e0b\u62c9\u9875\u9762\u91cd\u8bd5'}</Text></View> : null}

    <View className='paper-overview'>
      <View className='paper-overview-main'>
        <View className='paper-metric'><Text className='paper-metric-value'>{String(items.length)}</Text><Text className='paper-metric-label'>{'\u9898\u76ee'}</Text></View>
        <View className='paper-metric'><Text className='paper-metric-value'>{String(totalScore)}</Text><Text className='paper-metric-label'>{'\u603b\u5206'}</Text></View>
        <Button className='compact-button' onClick={regroup} disabled={loading || !items.length}>{'\u6309\u9898\u578b\u5206\u7ec4'}</Button>
      </View>
      <View className='paper-distribution-row'>
        <Text className='paper-distribution-label'>{'\u9898\u578b'}</Text>
        <View className='paper-distribution-tags'>{typeStats.length ? typeStats.map(([type, count]) => <Text key={type}>{questionTypeLabel(type) + ' ' + count}</Text>) : <Text>{'\u6682\u65e0'}</Text>}</View>
      </View>
      <View className='paper-distribution-row'>
        <Text className='paper-distribution-label'>{'\u96be\u5ea6'}</Text>
        <View className='paper-distribution-tags'>{difficultyStats.length ? difficultyStats.map(([level, count]) => <Text key={String(level)}>{String(level) + ' \u7ea7 ' + count}</Text>) : <Text>{'\u6682\u65e0'}</Text>}</View>
      </View>
    </View>

    {taskState.tasks.length || taskSyncState === 'offline' ? <View className='result-card'>
      <View className='preview-header'><Text className='preview-title'>{'\u5bfc\u51fa\u8bb0\u5f55'}</Text>{taskSyncState === 'refreshing' ? <Text className='task-sync-state'>{'\u6b63\u5728\u540c\u6b65'}</Text> : null}</View>
      {taskSyncState === 'offline' ? <View className='task-offline-state'><Text>{'\u6682\u65f6\u65e0\u6cd5\u66f4\u65b0\u5bfc\u51fa\u8fdb\u5ea6\uff0c\u4e0b\u62c9\u540e\u91cd\u8bd5'}</Text></View> : null}
      {taskState.tasks.length ? <View className='task-list'>{taskState.tasks.map(task => <View key={task.localId} className={'task-item status-' + task.status}>
        <View className='task-item-head'>
          <View className='task-item-title-wrap'><Text className='task-item-title'>{task.request.payload.title}</Text><Text className='task-format'>{task.request.taskType === 'paper-export-pdf' ? 'PDF' : 'Word'}</Text></View>
          <Text className='task-status'>{statusText[task.status] || task.status}</Text>
        </View>
        <View className='task-meta'><Text>{String((task.request.payload.questionIds || []).length) + ' \u9898'}</Text><Text>{String(taskProgress(task)) + '%'}</Text></View>
        <View className='paper-task-progress-track'><View className='paper-task-progress-fill' style={{ width: String(taskProgress(task)) + '%' }} /></View>
        {task.error || task.message ? <Text className={task.error ? 'task-error' : 'task-message'}>{task.error || task.message}</Text> : null}
        <View className='task-actions'>
          {['queued', 'processing'].includes(task.status) && task.confirmed ? <Button size='mini' loading={taskBusyId === task.localId} onClick={() => cancelTask(task)}>{'\u53d6\u6d88'}</Button> : null}
          {task.status === 'completed' ? <Button className='primary' size='mini' loading={taskBusyId === task.localId} onClick={() => download(task)}>{'\u4e0b\u8f7d'}</Button> : null}
          {['failed', 'cancelled', 'timed_out', 'draft'].includes(task.status) ? <Button size='mini' loading={submitting === task.request.taskType} onClick={() => submit(task.request.taskType, task)}>{'\u91cd\u8bd5'}</Button> : null}
        </View>
      </View>)}</View> : null}
    </View> : null}

    {loading && !items.length ? <View className='paper-empty'><Text>{'\u6b63\u5728\u8bfb\u53d6\u5df2\u9009\u9898\u76ee'}</Text></View> : !items.length ? (catalogError ? null : <View className='paper-empty'><Text>{'\u8bd5\u9898\u7bee\u4e2d\u6682\u65e0\u9898\u76ee'}</Text><Button onClick={() => Taro.navigateBack()}>{'\u8fd4\u56de\u9898\u5e93\u9009\u9898'}</Button></View>) : <View className='paper-item-list'>{groupedItems.map(group => <View key={group.title} className='paper-section'>
      <View className='paper-section-head'><Text className='paper-section-title'>{group.title}</Text><Text className='paper-section-count'>{group.rows.length + ' \u9898'}</Text></View>
      <View className='paper-section-questions'>{group.rows.map(({ item, index }) => renderPaperItem(item, index))}</View>
    </View>)}</View>}

    {answerPosition === 'end' && items.length ? <View className='paper-answers'><Text className='answer-title'>{'\u53c2\u8003\u7b54\u6848\u4e0e\u89e3\u6790'}</Text>{items.map((item, index) => { const display = createQuestionDisplay(item); return <View key={item.id} className='paper-answer'><Text>{String(index + 1) + '. \u7b54\u6848\uff1a'}</Text><RichText className='paper-answer-content' nodes={miniRichNodes(display.answer || '\u6682\u65e0', assetPaths)} />{display.subQuestions.some(subQuestion => subQuestion.answer) ? <View className='paper-subquestion-answers'>{display.subQuestions.map((subQuestion, subIndex) => subQuestion.answer ? <View key={subQuestion.label + '-' + String(subIndex)}><Text>{subQuestion.label + ' '}</Text><RichText className='paper-answer-content' nodes={miniRichNodes(subQuestion.answer, assetPaths)} /></View> : null)}</View> : null}{display.explanation ? <View><Text>{'\u89e3\u6790\uff1a'}</Text><RichText className='paper-answer-content' nodes={miniRichNodes(display.explanation, assetPaths)} /></View> : null}</View>; })}</View> : null}

    <View className='paper-export-actions'><Button className='paper-export-pdf' loading={submitting === 'paper-export-pdf'} disabled={!items.length || Boolean(submitting)} onClick={() => submit('paper-export-pdf')}>{'\u5bfc\u51fa PDF'}</Button><Button className='paper-export-word' loading={submitting === 'paper-export-word'} disabled={!items.length || Boolean(submitting)} onClick={() => submit('paper-export-word')}>{'\u5bfc\u51fa Word'}</Button></View>

    <QuestionBasketOverlay
      canUse={canBuildPaper}
      onRestricted={() => Taro.navigateTo({ url: '/pages/account-application/index' })}
      resolveNodes={value => miniRichNodes(value, assetPaths)}
      onResolveQuestions={resolveBasketQuestions}
      onBeginPaper={applyBasketSelection}
    />
  </View>;
}
