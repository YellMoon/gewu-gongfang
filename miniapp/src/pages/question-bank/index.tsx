import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Input, Button, Picker, RichText, ScrollView } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { miniappCloudBusinessApi } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import { canUserSubmitMiniappWrite, isRetiredIdentity, roleOf } from '../../utils/miniappAuthorizationRuntime';
import { questionBasketStore, useQuestionBasket } from '../../utils/questionBasketStore';
import QuestionBasketOverlay from '../../components/QuestionBasketOverlay';
// @ts-ignore CommonJS display module has no TypeScript declarations.
import * as questionDisplayRuntime from '../../utils/questionDisplay';
import './index.scss';

type PreviewState = 'loading' | 'ready' | 'empty' | 'offline' | 'forbidden';

interface QuestionPreview {
  id: string;
  subject: string;
  type: string;
  stemPreview: string;
  answer?: string;
  explanation?: string;
  options?: any[];
  difficulty?: number;
  sourceLabel?: string;
  source?: string;
  region?: string;
  school?: string;
  examType?: string;
  examYear?: string | number;
  grade?: string;
  semester?: string;
  knowledgeLabels?: string[];
  richContent?: any;
  status: string;
}

interface QuestionDisplay {
  stem: string;
  options: Array<{ label: string; content: string }>;
  subQuestions: Array<{ label: string; content: string; answer?: string }>;
  answer: string;
  explanation: string;
}

interface QuestionFilterOptions {
  subjects: string[];
  types: string[];
  sources: string[];
  knowledgePoints: string[];
  difficulties: number[];
  grades: string[];
  semesters: string[];
  examTypes: string[];
  examYears: string[];
}

const { columnsForOptions, createQuestionDisplay, hasQuestionAnswerContent, resolveQuestionAssetRefs } = questionDisplayRuntime as any;
const QUESTION_ASSET_REF = /question-asset:\/\/([0-9a-f]{64})/g;
const VISITOR_QUESTION_LIMIT = 20;
const QUESTION_PAGE_SIZE = 40;
const QUESTION_ASSET_CONCURRENCY = 4;
const QUESTION_VISIBLE_MEDIA_CONCURRENCY = 2;
const QUESTION_INITIAL_MEDIA_PREFETCH = 4;

function questionAssetKeys(value: unknown): string[] {
  const source = typeof value === 'string' ? value : JSON.stringify(value || {});
  return Array.from(source.matchAll(QUESTION_ASSET_REF)).map(match => match[1]);
}

function questionAssetRequests(question: QuestionPreview): Array<{ questionId: string; assetKey: string }> {
  const display = createQuestionDisplay(question);
  return Array.from(new Set(questionAssetKeys(display))).map(assetKey => ({ questionId: question.id, assetKey }));
}

function miniRichNodes(value: string, paths: Record<string, string>) {
  return resolveQuestionAssetRefs(value, paths);
}

function appendUniqueQuestions(current: QuestionPreview[], incoming: QuestionPreview[]) {
  const next = current.slice();
  const indexes = new Map(next.map((question, index) => [question.id, index]));
  incoming.forEach(question => {
    const existingIndex = indexes.get(question.id);
    if (existingIndex === undefined) {
      indexes.set(question.id, next.length);
      next.push(question);
    } else {
      next[existingIndex] = question;
    }
  });
  return next;
}

function questionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    single_choice: '单选题',
    multiple_choice: '多选题',
    true_false: '判断题',
    fill_blank: '填空题',
    essay: '简答题',
    calculation: '计算题',
    experiment: '实验题',
  };
  return labels[type] || type || '其他题型';
}

function subjectLabel(subject: string) {
  const labels: Record<string, string> = {
    physics: '物理',
    mathematics: '数学',
    math: '数学',
    chemistry: '化学',
    biology: '生物',
    chinese: '语文',
    english: '英语',
  };
  return labels[subject] || subject || '未设置';
}

function questionSourceLabel(question: QuestionPreview) {
  const authoritativeLabel = String(question.sourceLabel || '').trim();
  if (authoritativeLabel) return authoritativeLabel;
  const parts = [question.source, question.region, question.school, question.examType, question.examYear]
    .map(value => String(value ?? '').trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join(' / ');
}

export default function QuestionBankPage() {
  const requestedQuestionAssetsRef = useRef<Set<string>>(new Set());
  const moreAccessPromptOpenRef = useRef(false);
  const pageActiveRef = useRef(true);
  const questionListGenerationRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const hasMoreQuestionsRef = useRef(false);
  const nextQuestionCursorRef = useRef<string | null>(null);
  const [questions, setQuestions] = useState<QuestionPreview[]>([]);
  const basketState = useQuestionBasket();
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedSource, setSelectedSource] = useState('');
  const [selectedKnowledge, setSelectedKnowledge] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedSemester, setSelectedSemester] = useState('');
  const [selectedExamType, setSelectedExamType] = useState('');
  const [selectedExamYear, setSelectedExamYear] = useState('');
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState>('loading');
  const [previewMessage, setPreviewMessage] = useState('');
  const [questionTotal, setQuestionTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState<QuestionFilterOptions>({
    subjects: [], types: [], sources: [], knowledgePoints: [], difficulties: [],
    grades: [], semesters: [], examTypes: [], examYears: [],
  });
  const [hasMoreQuestions, setHasMoreQuestions] = useState(false);
  const [nextQuestionCursor, setNextQuestionCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [assetPaths, setAssetPaths] = useState<Record<string, string>>({});

  const [identity, setIdentity] = useState<any>(() => Taro.getStorageSync('user_info'));
  const canBuildPaper = canUserSubmitMiniappWrite(identity, 'question-paper', ['question-paper']);
  const isVisitor = !identity || isRetiredIdentity(identity) || roleOf(identity) === 'visitor';

  useEffect(() => {
    pageActiveRef.current = true;
    return () => {
      pageActiveRef.current = false;
    };
  }, []);

  useDidShow(() => {
    setIdentity(Taro.getStorageSync('user_info'));
    questionBasketStore.reconcileIdentity();
  });

  const loadQuestionAssets = async (question: QuestionPreview) => {
    const requests = questionAssetRequests(question).filter(({ questionId, assetKey }) => {
      const requestKey = questionId + ':' + assetKey;
      if (assetPaths[assetKey] || requestedQuestionAssetsRef.current.has(requestKey)) return false;
      requestedQuestionAssetsRef.current.add(requestKey);
      return true;
    });
    if (!requests.length) return;
    const session = authSessionRuntime.capture();
    const token = session.token;
    const loadAsset = async ({ questionId, assetKey }: { questionId: string; assetKey: string }) => {
      const requestKey = questionId + ':' + assetKey;
      let requestCompleted = false;
      try {
        if (!pageActiveRef.current || !authSessionRuntime.isSameSession(session)) return null;
        const prepared: any = await miniappCloudBusinessApi.requestQuestionAssetDelivery(token, questionId, assetKey);
        let delivery = prepared.data?.delivery;
        if (!prepared.success || !delivery) return null;
        const deliveryId = delivery.deliveryId;
        for (let attempt = 0; ['queued', 'leased'].includes(delivery.status) && attempt < 5; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
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

  const prefetchQuestionAssets = async (targets: QuestionPreview[]) => {
    let nextTargetIndex = 0;
    const workers = Array.from({ length: Math.min(QUESTION_VISIBLE_MEDIA_CONCURRENCY, targets.length) }, async () => {
      while (nextTargetIndex < targets.length) {
        const targetIndex = nextTargetIndex;
        nextTargetIndex += 1;
        await loadQuestionAssets(targets[targetIndex]);
      }
    });
    await Promise.all(workers);
  };

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
    void prefetchQuestionAssets(resolved);
    return {
      success: true,
      unavailableIds: Array.isArray(response.data?.unavailableIds) ? response.data.unavailableIds : [],
    };
  };

  const loadQuestionPage = async (append: boolean, cursor: string | null) => {
    if (append && loadingMoreRef.current) return;
    const generation = append ? questionListGenerationRef.current : questionListGenerationRef.current + 1;
    if (!append) {
      questionListGenerationRef.current = generation;
      setPreviewState('loading');
      setPreviewMessage('');
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    const session = authSessionRuntime.capture();
    const currentIdentity = Taro.getStorageSync('user_info');
    const visitorRequest = !currentIdentity || isRetiredIdentity(currentIdentity) || roleOf(currentIdentity) === 'visitor';
    const requestOptions = {
      ...(visitorRequest ? {} : { limit: QUESTION_PAGE_SIZE, ...(cursor ? { cursor } : {}) }),
      subject: selectedSubject || undefined,
      query: selectedSubject && searchText.trim() ? searchText.trim() : undefined,
      source: selectedSubject && selectedSource ? selectedSource : undefined,
      knowledgePoint: selectedSubject && selectedKnowledge ? selectedKnowledge : undefined,
      type: selectedSubject && selectedType ? selectedType : undefined,
      difficulty: selectedSubject && selectedDifficulty ? Number(selectedDifficulty) : undefined,
      grade: selectedSubject && selectedGrade ? selectedGrade : undefined,
      semester: selectedSubject && selectedSemester ? selectedSemester : undefined,
      examType: selectedSubject && selectedExamType ? selectedExamType : undefined,
      examYear: selectedSubject && selectedExamYear ? selectedExamYear : undefined,
    };
    const response: any = await miniappCloudBusinessApi.listQuestionPreviews(session.token, requestOptions);
    if (!pageActiveRef.current || generation !== questionListGenerationRef.current || !authSessionRuntime.isSameSession(session)) {
      if (append) {
        loadingMoreRef.current = false;
        if (pageActiveRef.current) setLoadingMore(false);
      }
      return;
    }
    if (!response.success) {
      if (append) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
        Taro.showToast({ title: String.fromCharCode(21152, 36733, 26356, 22810, 39064, 30446, 22833, 36133, 65292, 35831, 37325, 35797), icon: 'none' });
        return;
      }
      setHasMoreQuestions(false);
      hasMoreQuestionsRef.current = false;
      nextQuestionCursorRef.current = null;
      setNextQuestionCursor(null);
      setQuestionTotal(0);
      const forbidden = ['CLOUD_BUSINESS_ACCESS_DENIED', 'FORBIDDEN'].includes(String(response.code));
      setPreviewState(forbidden ? 'forbidden' : 'offline');
      setPreviewMessage(forbidden ? '请联系数据负责人确认题库权限' : '请联网后重试');
      return;
    }
    const list: QuestionPreview[] = Array.isArray(response.data?.questions) ? response.data.questions as QuestionPreview[] : [];
    const nextFilterOptions: QuestionFilterOptions = response.data?.filterOptions && typeof response.data.filterOptions === 'object'
      ? response.data.filterOptions as QuestionFilterOptions
      : {
        subjects: [], types: [], sources: [], knowledgePoints: [], difficulties: [],
        grades: [], semesters: [], examTypes: [], examYears: [],
      };
    setFilterOptions(nextFilterOptions);
    setQuestionTotal(response.data?.total ?? list.length);
    if (!selectedSubject && nextFilterOptions.subjects.length) {
      hasMoreQuestionsRef.current = false;
      nextQuestionCursorRef.current = null;
      setHasMoreQuestions(false);
      setNextQuestionCursor(null);
      setQuestions([]);
      setSelectedSubject(nextFilterOptions.subjects[0]);
      return;
    }
    const continuationCursor = !visitorRequest && typeof response.data?.nextCursor === 'string' ? response.data.nextCursor : null;
    const canContinue = response.data?.hasMore === true && (visitorRequest || Boolean(continuationCursor));
    hasMoreQuestionsRef.current = canContinue;
    nextQuestionCursorRef.current = continuationCursor;
    setHasMoreQuestions(canContinue);
    setNextQuestionCursor(continuationCursor);
    if (append) {
      questionBasketStore.seedQuestions(list);
      setQuestions(current => appendUniqueQuestions(current, list));
      void prefetchQuestionAssets(list.slice(0, QUESTION_INITIAL_MEDIA_PREFETCH));
      loadingMoreRef.current = false;
      setLoadingMore(false);
      return;
    }
    questionBasketStore.seedQuestions(list);
    setQuestions(list);
    setPreviewState(list.length ? 'ready' : 'empty');
  };

  const loadQuestions = async () => loadQuestionPage(false, null);

  const loadMoreQuestions = async () => {
    if (!hasMoreQuestionsRef.current || !nextQuestionCursorRef.current || loadingMoreRef.current) return;
    await loadQuestionPage(true, nextQuestionCursorRef.current);
  };

  useEffect(() => {
    const timer = setTimeout(() => { void loadQuestions(); }, searchText.trim() || selectedSource.trim() ? 300 : 0);
    return () => clearTimeout(timer);
  }, [selectedSubject, selectedType, selectedSource, selectedKnowledge, selectedDifficulty, selectedGrade, selectedSemester, selectedExamType, selectedExamYear, searchText]);

  const subjectValues = filterOptions.subjects;
  const activeSubject = selectedSubject;
  const typeValues = filterOptions.types;
  const knowledgeValues = filterOptions.knowledgePoints;
  const difficultyValues = filterOptions.difficulties;
  const gradeValues = filterOptions.grades || [];
  const semesterValues = filterOptions.semesters || [];
  const examTypeValues = filterOptions.examTypes || [];
  const examYearValues = filterOptions.examYears || [];

  const matchingQuestions = useMemo(() => (
    questions.map(question => ({
      question,
      display: createQuestionDisplay(question) as QuestionDisplay,
    }))
  ), [questions]);

  const visibleQuestions = isVisitor ? matchingQuestions.slice(0, VISITOR_QUESTION_LIMIT) : matchingQuestions;
  const hasActiveFilters = Boolean(searchText.trim() || selectedType || selectedSource || selectedKnowledge || selectedDifficulty
    || selectedGrade || selectedSemester || selectedExamType || selectedExamYear);
  const initialMediaQuestionKey = visibleQuestions.slice(0, QUESTION_INITIAL_MEDIA_PREFETCH)
    .map(({ question }) => question.id + ':' + questionAssetKeys(createQuestionDisplay(question)).join(','))
    .join('|');

  useEffect(() => {
    const firstVisibleQuestions = visibleQuestions.slice(0, QUESTION_INITIAL_MEDIA_PREFETCH).map(({ question }) => question);
    if (firstVisibleQuestions.length) void prefetchQuestionAssets(firstVisibleQuestions);
  }, [initialMediaQuestionKey]);

  const requestMoreQuestionAccess = () => {
    if (moreAccessPromptOpenRef.current) return;
    moreAccessPromptOpenRef.current = true;
    Taro.showModal({
      title: '继续浏览',
      content: '申请教师、学生或家庭成员角色后可继续浏览。',
      confirmText: '去申请',
      success: result => {
        if (result.confirm) Taro.navigateTo({ url: '/pages/account-application/index' });
      },
      complete: () => {
        moreAccessPromptOpenRef.current = false;
      },
    });
  };

  const requestRoleApplication = () => {
    Taro.showModal({
      title: '组卷需要教师角色',
      content: '申请教师角色后即可选题、组卷和导出。',
      confirmText: '去申请',
      success: result => {
        if (result.confirm) Taro.navigateTo({ url: '/pages/account-application/index' });
      },
    });
  };

  const toggleBasket = (questionId: string) => {
    questionBasketStore.reconcileIdentity();
    if (!canBuildPaper || !questionBasketStore.snapshot().scopeKey) {
      requestRoleApplication();
      return;
    }
    const writeResult = questionBasketStore.toggle(questionId);
    if (!writeResult.written && writeResult.reason === 'persistence-failed') {
      Taro.showToast({ title: String.fromCharCode(35797, 39064, 31726, 20445, 23384, 22833, 36133, 65292, 35831, 37325, 35797), icon: 'none' });
    }
  };

  const toggleQuestionExpansion = (question: QuestionPreview) => {
    const expanding = expandedQuestionId !== question.id;
    setExpandedQuestionId(expanding ? question.id : null);
    if (expanding) void loadQuestionAssets(question);
  };

  const onReachPreviewEnd = () => {
    if (isVisitor) {
      if (hasMoreQuestions) requestMoreQuestionAccess();
      return;
    }
    void loadMoreQuestions();
  };

  usePullDownRefresh(async () => {
    try {
      await loadQuestions();
    } finally {
      Taro.stopPullDownRefresh();
    }
  });

  useReachBottom(onReachPreviewEnd);

  const changeSubject = (index: number) => {
    const nextSubject = subjectValues[index] || '';
    setSelectedSubject(nextSubject);
    setSelectedType('');
    setSelectedSource('');
    setSelectedKnowledge('');
    setSelectedDifficulty('');
    setSelectedGrade('');
    setSelectedSemester('');
    setSelectedExamType('');
    setSelectedExamYear('');
  };

  const clearFilters = () => {
    setSearchText('');
    setSelectedType('');
    setSelectedSource('');
    setSelectedKnowledge('');
    setSelectedDifficulty('');
    setSelectedGrade('');
    setSelectedSemester('');
    setSelectedExamType('');
    setSelectedExamYear('');
  };

  const moreFilterCount = [selectedSource, selectedKnowledge, selectedGrade, selectedSemester, selectedExamType, selectedExamYear]
    .filter(Boolean).length;

  const stateText = previewState === 'loading'
    ? '正在加载题库'
    : previewState === 'empty'
      ? '题库中暂无题目'
      : previewState === 'forbidden'
        ? '当前账号暂无题库访问权限'
        : '暂时无法加载题库';

  return <View className='question-bank-page'>
    <View className='question-filter-panel'>
      <View className='question-filter-primary'>
        <Text className='filter-label'>{'科目'}</Text>
        <Picker
          mode='selector'
          range={subjectValues.map(subjectLabel)}
          value={Math.max(0, subjectValues.indexOf(selectedSubject || activeSubject))}
          disabled={!subjectValues.length}
          onChange={event => changeSubject(Number(event.detail.value))}
        >
          <View className='question-subject-picker'>
            <Text>{subjectLabel(activeSubject)}</Text>
          </View>
        </Picker>
      </View>
      <View className='question-search'>
        <Input
          className='question-search-input'
          placeholder='搜索题干、题号或选项'
          value={searchText}
          confirmType='search'
          onInput={event => setSearchText(event.detail.value)}
        />
        {searchText ? <Text className='question-search-clear' onClick={() => setSearchText('')}>{'清除'}</Text> : null}
      </View>
      <View className='question-filter-grid'>
        <Picker
          className='question-filter-cell question-filter-type'
          mode='selector'
          range={['全部题型', ...typeValues.map(questionTypeLabel)]}
          value={selectedType ? Math.max(1, typeValues.indexOf(selectedType) + 1) : 0}
          onChange={event => setSelectedType(Number(event.detail.value) ? typeValues[Number(event.detail.value) - 1] : '')}
        >
          <View className={'question-filter-picker ' + (selectedType ? 'active' : '')}>
            <Text>{selectedType ? questionTypeLabel(selectedType) : '题型'}</Text>
          </View>
        </Picker>
        <Button
          className={'question-more-filter-button ' + (moreFilterCount ? 'active' : '')}
          onClick={() => setMoreFiltersOpen(true)}
        >
          {'\u66f4\u591a\u7b5b\u9009' + (moreFilterCount ? ' (' + moreFilterCount + ')' : '')}
        </Button>
        <View className={'question-more-filter-layer ' + (moreFiltersOpen ? 'open' : '')} catchMove={moreFiltersOpen}>
          <View className='question-more-filter-backdrop' onClick={() => setMoreFiltersOpen(false)} />
          <ScrollView className='question-more-filter-sheet question-more-filter-scroll' scrollY enhanced showScrollbar={false} onClick={(event: any) => event.stopPropagation()}>
            <View className='question-more-filter-header'>
              <Text className='question-more-filter-title'>{'\u7b5b\u9009'}</Text>
              <Button className='question-more-filter-done' onClick={() => setMoreFiltersOpen(false)}>{'\u5b8c\u6210'}</Button>
            </View>
            <Text className='question-more-filter-field-label'>{'年级'}</Text>
            <Picker
              className='question-filter-cell question-filter-grade'
              mode='selector'
              range={['全部年级', ...gradeValues]}
              value={selectedGrade ? Math.max(1, gradeValues.indexOf(selectedGrade) + 1) : 0}
              onChange={event => setSelectedGrade(Number(event.detail.value) ? gradeValues[Number(event.detail.value) - 1] : '')}
            >
              <View className={'question-filter-picker ' + (selectedGrade ? 'active' : '')}>
                <Text>{selectedGrade || '全部年级'}</Text>
              </View>
            </Picker>
            <Text className='question-more-filter-field-label'>{'学年'}</Text>
            <Picker
              className='question-filter-cell question-filter-exam-year'
              mode='selector'
              range={['全部学年', ...examYearValues]}
              value={selectedExamYear ? Math.max(1, examYearValues.indexOf(selectedExamYear) + 1) : 0}
              onChange={event => setSelectedExamYear(Number(event.detail.value) ? examYearValues[Number(event.detail.value) - 1] : '')}
            >
              <View className={'question-filter-picker ' + (selectedExamYear ? 'active' : '')}>
                <Text>{selectedExamYear || '全部学年'}</Text>
              </View>
            </Picker>
            <Text className='question-more-filter-field-label'>{'学期'}</Text>
            <Picker
              className='question-filter-cell question-filter-semester'
              mode='selector'
              range={['全部学期', ...semesterValues]}
              value={selectedSemester ? Math.max(1, semesterValues.indexOf(selectedSemester) + 1) : 0}
              onChange={event => setSelectedSemester(Number(event.detail.value) ? semesterValues[Number(event.detail.value) - 1] : '')}
            >
              <View className={'question-filter-picker ' + (selectedSemester ? 'active' : '')}>
                <Text>{selectedSemester || '全部学期'}</Text>
              </View>
            </Picker>
            <Text className='question-more-filter-field-label'>{'考试类型'}</Text>
            <Picker
              className='question-filter-cell question-filter-exam-type'
              mode='selector'
              range={['全部考试类型', ...examTypeValues]}
              value={selectedExamType ? Math.max(1, examTypeValues.indexOf(selectedExamType) + 1) : 0}
              onChange={event => setSelectedExamType(Number(event.detail.value) ? examTypeValues[Number(event.detail.value) - 1] : '')}
            >
              <View className={'question-filter-picker ' + (selectedExamType ? 'active' : '')}>
                <Text>{selectedExamType || '全部考试类型'}</Text>
              </View>
            </Picker>
            <Text className='question-more-filter-field-label'>{'来源'}</Text>
            <View className='question-source-filter'>
              <Input
                className='question-source-input'
                placeholder='来源、地区、学校或年份'
                value={selectedSource}
                onInput={event => setSelectedSource(event.detail.value)}
              />
              {selectedSource ? <Text className='question-source-clear' onClick={() => setSelectedSource('')}>{'清除'}</Text> : null}
            </View>
            <Text className='question-more-filter-field-label'>{'知识点'}</Text>
            <Picker
              className='question-filter-cell question-filter-knowledge'
              mode='selector'
              range={['全部知识点', ...knowledgeValues]}
              value={selectedKnowledge ? Math.max(1, knowledgeValues.indexOf(selectedKnowledge) + 1) : 0}
              onChange={event => setSelectedKnowledge(Number(event.detail.value) ? knowledgeValues[Number(event.detail.value) - 1] : '')}
            >
              <View className={'question-filter-picker ' + (selectedKnowledge ? 'active' : '')}>
                <Text>{selectedKnowledge || '全部知识点'}</Text>
              </View>
            </Picker>
            <View className='question-more-filter-footer'>
              <Button
                className='question-more-filter-clear'
                onClick={() => {
                  setSelectedSource('');
                  setSelectedKnowledge('');
                  setSelectedGrade('');
                  setSelectedSemester('');
                  setSelectedExamType('');
                  setSelectedExamYear('');
                }}
              >
                {'清除更多筛选'}
              </Button>
            </View>
          </ScrollView>
        </View>
        <Picker
          className='question-filter-cell question-filter-difficulty'
          mode='selector'
          range={['\u5168\u90e8\u96be\u5ea6', ...difficultyValues.map(value => '\u96be\u5ea6 ' + String(value))]}
          value={selectedDifficulty ? Math.max(1, difficultyValues.indexOf(Number(selectedDifficulty)) + 1) : 0}
          onChange={event => setSelectedDifficulty(Number(event.detail.value) ? String(difficultyValues[Number(event.detail.value) - 1]) : '')}
        >
          <View className={'question-filter-picker ' + (selectedDifficulty ? 'active' : '')}>
            <Text>{selectedDifficulty ? '\u96be\u5ea6 ' + selectedDifficulty : '\u96be\u5ea6'}</Text>
          </View>
        </Picker>
      </View>
      {moreFilterCount ? <View className='question-active-filters'>
        {selectedSource ? <Button className='question-active-filter' onClick={() => setSelectedSource('')}>
          {'\u6765\u6e90\uff1a' + selectedSource + '\uff0c\u6e05\u9664'}
        </Button> : null}
        {selectedKnowledge ? <Button className='question-active-filter' onClick={() => setSelectedKnowledge('')}>
          {'\u77e5\u8bc6\u70b9\uff1a' + selectedKnowledge + '\uff0c\u6e05\u9664'}
        </Button> : null}
        {selectedGrade ? <Button className='question-active-filter' onClick={() => setSelectedGrade('')}>
          {'年级：' + selectedGrade + '，清除'}
        </Button> : null}
        {selectedExamYear ? <Button className='question-active-filter' onClick={() => setSelectedExamYear('')}>
          {'学年：' + selectedExamYear + '，清除'}
        </Button> : null}
        {selectedSemester ? <Button className='question-active-filter' onClick={() => setSelectedSemester('')}>
          {'学期：' + selectedSemester + '，清除'}
        </Button> : null}
        {selectedExamType ? <Button className='question-active-filter' onClick={() => setSelectedExamType('')}>
          {'考试类型：' + selectedExamType + '，清除'}
        </Button> : null}
      </View> : null}
      {previewState === 'ready' ? <View className='question-list-summary'>
        <Text>{'共 ' + questionTotal + ' 题'}</Text>
        {hasActiveFilters ? <Text className='question-filter-reset' onClick={clearFilters}>{'清除筛选'}</Text> : null}
      </View> : null}
    </View>

    {previewState !== 'ready'
      ? <View className={'question-preview-empty state-' + previewState}>
        <Text className='question-empty-title'>{stateText}</Text>
        {previewMessage ? <Text className='question-empty-message'>{previewMessage}</Text> : null}
        {previewState === 'offline' ? <Button className='question-retry' onClick={loadQuestions}>{'重试'}</Button> : null}
      </View>
      : !visibleQuestions.length
        ? <View className='question-preview-empty state-filtered'>
          <Text className='question-empty-title'>{'没有符合条件的题目'}</Text>
          <Text className='question-empty-message'>{'换一个筛选条件试试'}</Text>
          {hasActiveFilters ? <Button className='question-retry' onClick={clearFilters}>{'清除筛选'}</Button> : null}
        </View>
        : <View className='question-preview-list'>
          {visibleQuestions.map(({ question: rawQuestion, display }, index) => {
            const question = { ...rawQuestion, source: questionSourceLabel(rawQuestion) };
            const expanded = expandedQuestionId === question.id;
            const hasAnswerContent = hasQuestionAnswerContent(display);
            const inBasket = basketState.ids.includes(question.id);
            const optionColumns = columnsForOptions(display.options);
            return <View
              key={question.id}
              className={'question-preview-item ' + (inBasket ? 'selected' : '')}
              onClick={() => { void loadQuestionAssets(question); }}
            >
              <View className='question-card-index'>{String(index + 1)}</View>
              <View className='question-card-body'>
                <View className='question-card-meta'>
                  <Text>{questionTypeLabel(question.type)}</Text>
                  {question.difficulty ? <Text>{'难度 ' + question.difficulty}</Text> : null}
                </View>
                <RichText className='question-preview-stem' nodes={miniRichNodes(display.stem, assetPaths)} />
                {display.subQuestions.length ? <View className='question-subquestions'>
                  {display.subQuestions.map((subQuestion, subIndex) => <View key={String(subIndex)} className='question-subquestion'>
                    <Text className='question-subquestion-label'>{subQuestion.label || '(' + String(subIndex + 1) + ')'}</Text>
                    <RichText className='question-subquestion-content' nodes={miniRichNodes(subQuestion.content, assetPaths)} />
                  </View>)}
                </View> : null}
                {display.options.length ? <View className={'question-options cols-' + optionColumns}>
                  {display.options.map((option, optionIndex) => <View key={String(optionIndex)} className='question-option'>
                    <Text className='question-option-label'>{option.label + '.'}</Text>
                    <RichText className='question-option-content' nodes={miniRichNodes(option.content, assetPaths)} />
                  </View>)}
                </View> : null}
                {(question.source || (question.knowledgeLabels || []).length) ? <View className='question-card-footer'>
                  {question.source ? <Text className='question-source'>{'来源：' + question.source}</Text> : null}
                  {(question.knowledgeLabels || []).length ? <View className='question-knowledge'>
                    <Text className='question-knowledge-label'>{'知识点：'}</Text>
                    {(question.knowledgeLabels || []).map(label => <Text key={label} className='question-knowledge-tag'>{label}</Text>)}
                  </View> : null}
                </View> : null}
                {expanded && hasAnswerContent ? <View className='question-preview-answer'>
                  <View className='question-answer-section'>
                    <Text className='question-answer-label'>{'答案'}</Text>
                    <RichText className='question-answer-content' nodes={miniRichNodes(display.answer || '暂无', assetPaths)} />
                  </View>
                  {display.subQuestions.some(subQuestion => subQuestion.answer) ? <View className='question-subquestion-answers'>
                    <Text className='question-answer-label'>{'\u5404\u5c0f\u9898\u7b54\u6848'}</Text>
                    {display.subQuestions.map((subQuestion, subIndex) => subQuestion.answer ? <View key={subQuestion.label + '-' + String(subIndex)} className='question-subquestion-answer'>
                      <Text className='question-subquestion-label'>{subQuestion.label}</Text>
                      <RichText className='question-answer-content' nodes={miniRichNodes(subQuestion.answer, assetPaths)} />
                    </View> : null)}
                  </View> : null}
                  {display.explanation ? <View className='question-answer-section'>
                    <Text className='question-answer-label'>{'解析'}</Text>
                    <RichText className='question-answer-content' nodes={miniRichNodes(display.explanation, assetPaths)} />
                  </View> : null}
                </View> : null}
                <View className='question-card-actions'>
                  {hasAnswerContent ? <Button
                    className='question-answer-toggle'
                    onClick={(event: any) => {
                      event.stopPropagation();
                      toggleQuestionExpansion(question);
                    }}
                  >
                    {expanded ? '收起答案与解析' : '查看答案与解析'}
                  </Button> : null}
                  <Button
                    className={'basket-toggle ' + (inBasket ? 'selected' : '')}
                    onClick={(event: any) => {
                      event.stopPropagation();
                      toggleBasket(question.id);
                    }}
                  >
                    {inBasket ? '移出试题篮' : '加入试题篮'}
                  </Button>
                </View>
              </View>
            </View>;
          })}
        </View>}
    {loadingMore && nextQuestionCursor ? <View className='question-loading-more'>
      <Text>{'\u6b63\u5728\u52a0\u8f7d\u66f4\u591a\u9898\u76ee'}</Text>
    </View> : null}
    <QuestionBasketOverlay
      canUse={canBuildPaper}
      aboveTabBar
      onRestricted={requestRoleApplication}
      resolveNodes={value => miniRichNodes(value, assetPaths)}
      onResolveQuestions={resolveBasketQuestions}
    />
  </View>;
}
