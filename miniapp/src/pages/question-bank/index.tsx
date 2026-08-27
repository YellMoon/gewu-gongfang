import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Input, Button, ScrollView, RichText } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { miniappCloudBusinessApi } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import { canUserSubmitMiniappWrite, createQuestionBasketRuntime, isRetiredIdentity, roleOf } from '../../utils/miniappAuthorizationRuntime';
import { storage } from '../../utils/storage';
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
  source?: string;
  knowledgeLabels?: string[];
  richContent?: any;
  status: string;
}

const QUESTION_ASSET_REF = /question-asset:\/\/([0-9a-f]{64})/g;

function questionAssetKeys(value: unknown): string[] {
  const source = typeof value === 'string' ? value : JSON.stringify(value || {});
  return Array.from(source.matchAll(QUESTION_ASSET_REF)).map(match => match[1]);
}

function questionAssetRequests(question: QuestionPreview): Array<{ questionId: string; assetKey: string }> {
  return Array.from(new Set([
    ...questionAssetKeys(question.stemPreview), ...questionAssetKeys(question.options), ...questionAssetKeys(question.answer), ...questionAssetKeys(question.explanation), ...questionAssetKeys(question.richContent),
  ])).map(assetKey => ({ questionId: question.id, assetKey }));
}

function miniRichNodes(value: string, paths: Record<string, string>) {
  return String(value || '').replace(QUESTION_ASSET_REF, (_ref, assetKey) => paths[assetKey] || '');
}

function formatQuestionOption(option: any, index: number) {
  if (typeof option === 'string') return option;
  if (!option || typeof option !== 'object') return '';
  const label = String(option.label || option.key || option.value || String.fromCharCode(65 + index)).trim();
  const content = String(option.content || option.text || option.title || '').trim();
  return content ? label + '。' + content : '';
}

function questionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    single_choice: '单选题', multiple_choice: '多选题', true_false: '判断题', fill_blank: '填空题', essay: '简答题', calculation: '计算题', experiment: '实验题',
  };
  return labels[type] || type;
}

export default function QuestionBankPage() {
  const basketRuntimeRef = useRef<any>(null);
  const assetRetryRef = useRef(0);
  if (!basketRuntimeRef.current) {
    basketRuntimeRef.current = createQuestionBasketRuntime({
      readIdentity: () => Taro.getStorageSync('user_info'),
      read: (key: string) => storage.get<string[]>(key),
      write: (key: string, ids: string[]) => storage.set(key, ids),
    });
  }
  const basketRuntime = basketRuntimeRef.current;
  const [questions, setQuestions] = useState<QuestionPreview[]>([]);
  const [basketState, setBasketState] = useState<{ scopeKey: string; ids: string[] }>(() => basketRuntime.snapshot());
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [previewState, setPreviewState] = useState<PreviewState>('loading');
  const [previewMessage, setPreviewMessage] = useState('');
  const [assetPaths, setAssetPaths] = useState<Record<string, string>>({});

  const identity = Taro.getStorageSync('user_info');
  const canBuildPaper = canUserSubmitMiniappWrite(identity, 'question-paper', ['question-paper']);
  const isVisitor = !identity || isRetiredIdentity(identity) || roleOf(identity) === 'visitor';
  const sessionToken = () => authSessionRuntime.capture().token;

  const synchronizeBasketScope = () => {
    const current = basketRuntime.snapshot();
    if (current.scopeKey !== basketState.scopeKey) {
      setBasketState(current);
      // A restored session can mount this page before its identity reaches storage.
      // An empty initial scope is safe to hydrate and use immediately; a switch
      // between two established scopes still requires a deliberate second action.
      return !basketState.scopeKey && current.scopeKey ? current : null;
    }
    return current.scopeKey ? current : null;
  };
  const replaceBasket = (ids: string[], expectedScopeKey: string) => {
    const result = basketRuntime.replace(ids, expectedScopeKey);
    setBasketState(result.snapshot);
    return result.written;
  };
  const loadQuestions = async () => {
    setPreviewState('loading');
    setPreviewMessage('');
    const response: any = await miniappCloudBusinessApi.listQuestionPreviews(sessionToken());
    if (!response.success) {
      const forbidden = ['CLOUD_BUSINESS_ACCESS_DENIED', 'FORBIDDEN'].includes(String(response.code));
      setPreviewState(forbidden ? 'forbidden' : 'offline');
      setPreviewMessage(forbidden ? '请联系数据负责人确认题库权限' : '请联网后重试');
      return;
    }
    const list: QuestionPreview[] = Array.isArray(response.data?.questions) ? response.data.questions as QuestionPreview[] : [];
    setQuestions(list);
    setPreviewState(list.length ? 'ready' : 'empty');
    const requests = Array.from(new Map(list.flatMap(questionAssetRequests).map(item => [item.questionId + ':' + item.assetKey, item])).values());
    if (!requests.length) return;
    const token = sessionToken();
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
      setTimeout(() => { void loadQuestions(); }, 1500);
    }
  };
  useEffect(() => { loadQuestions(); }, []);
  useEffect(() => {
    const current = basketRuntime.snapshot();
    if (current.scopeKey !== basketState.scopeKey) setBasketState(current);
  });

  const filtered = useMemo(() => {
    const key = searchText.trim().toLowerCase();
    return questions.filter(question => !key || [question.subject, question.type, question.stemPreview, question.source, ...(question.knowledgeLabels || [])]
      .filter(Boolean).join(' ').toLowerCase().includes(key));
  }, [questions, searchText]);

  const requestRoleApplication = () => {
    Taro.showModal({
      title: '关联身份后可组卷',
      content: '选题、组卷和导出仅对已关联的教师身份开放。',
      confirmText: '去申请',
      success: result => { if (result.confirm) Taro.navigateTo({ url: '/pages/account-application/index' }); },
    });
  };
  const openBasket = () => {
    const currentBasket = synchronizeBasketScope();
    if (!canBuildPaper || !currentBasket) {
      requestRoleApplication();
      return;
    }
    Taro.navigateTo({ url: '/pages/question-paper/index' });
  };
  const toggleBasket = (questionId: string) => {
    const currentBasket = synchronizeBasketScope();
    if (!canBuildPaper || !currentBasket) {
      requestRoleApplication();
      return;
    }
    const ids = currentBasket.ids.includes(questionId)
      ? currentBasket.ids.filter(id => id !== questionId) : [...currentBasket.ids, questionId];
    replaceBasket(ids, currentBasket.scopeKey);
  };
  const onReachPreviewEnd = () => {
    if (isVisitor && questions.length >= 20) requestRoleApplication();
  };
  const stateText = previewState === 'loading' ? '正在加载题目'
    : previewState === 'empty' ? '云端暂无可用题目'
      : previewState === 'forbidden' ? '当前账号无权读取题库' : '离线或云端不可达';

  return <View className='question-bank-page'>
    <View className='question-bank-toolbar'>
      <Text className='page-title'>{'题库'}</Text>
      <Button className='basket-entry' onClick={openBasket}>{'试题篮' + (basketState.ids.length ? ' (' + basketState.ids.length + ')' : '')}</Button>
    </View>
    <View className='preview-card'>
      <View className='preview-header'><Text className='preview-title'>{'题目'}</Text><Button className='preview-refresh' onClick={loadQuestions}>{'刷新'}</Button></View>
      <Input className='preview-search' placeholder='搜索题目、来源或知识点' value={searchText} onInput={event => setSearchText(event.detail.value)} />
      {previewState !== 'ready' ? <View className={'question-preview-empty state-' + previewState}><Text>{stateText}</Text>{previewMessage ? <Text>{previewMessage}</Text> : null}</View> : <ScrollView className='question-preview-list' scrollY onScrollToLower={onReachPreviewEnd}>{filtered.map(question => {
        const expanded = expandedQuestionId === question.id;
        const inBasket = basketState.ids.includes(question.id);
        return <View key={question.id} className={'question-preview-item ' + (inBasket ? 'selected' : '')} onClick={() => setExpandedQuestionId(expanded ? null : question.id)}>
          <View className='question-preview-meta'><Text>{question.subject}</Text><Text>{questionTypeLabel(question.type)}</Text>{question.difficulty ? <Text>{'难度 ' + question.difficulty}</Text> : null}</View>
          <RichText className='question-preview-stem' nodes={miniRichNodes(question.stemPreview, assetPaths)} />
          {Array.isArray(question.options) && question.options.map((option, index) => {
            const content = formatQuestionOption(option, index);
            return content ? <RichText key={String(index)} className='question-preview-stem option-line' nodes={miniRichNodes(content, assetPaths)} /> : null;
          })}
          {(question.source || (question.knowledgeLabels || []).length) ? <View className='question-detail-tags'>
            {question.source ? <Text>{'来源：' + question.source}</Text> : null}
            {(question.knowledgeLabels || []).map(label => <Text key={label}>{label}</Text>)}
          </View> : null}
          {expanded ? <View className='question-preview-answer'><Text>{'答案：'}{question.answer || '暂无'}</Text>{question.explanation ? <Text>{'解析：'}{question.explanation}</Text> : null}</View> : null}
          {canBuildPaper ? <Button className='basket-toggle' onClick={(event: any) => { event.stopPropagation(); toggleBasket(question.id); }}>{inBasket ? '移出试题篮' : '加入试题篮'}</Button> : null}
        </View>;
      })}</ScrollView>}
    </View>
  </View>;
}
