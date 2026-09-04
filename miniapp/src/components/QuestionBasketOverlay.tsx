import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, CheckboxGroup, PageContainer, RichText, ScrollView, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { questionBasketStore, useQuestionBasket } from '../utils/questionBasketStore';
// @ts-ignore CommonJS question display module is shared with direct Node tests.
import * as questionDisplayRuntime from '../utils/questionDisplay';
import './QuestionBasketOverlay.scss';

interface QuestionBasketOverlayProps {
  canUse: boolean;
  aboveTabBar?: boolean;
  onRestricted: () => void;
  resolveNodes?: (value: string) => string;
  onResolveQuestions?: (ids: string[]) => Promise<{ success: boolean; unavailableIds?: string[]; error?: string }>;
  onBeginPaper?: (selectedIds: string[]) => void;
}

const { createQuestionDisplay } = questionDisplayRuntime as any;
const copy = {
  basket: '\u8bd5\u9898\u7bee',
  total: '\u5171',
  questions: '\u9898',
  close: '\u5173\u95ed',
  deselectAll: '\u53d6\u6d88\u5168\u9009',
  selectAll: '\u5168\u9009',
  removeSelected: '\u79fb\u51fa\u6240\u9009',
  clear: '\u6e05\u7a7a',
  moveUp: '\u4e0a\u79fb',
  moveDown: '\u4e0b\u79fb',
  remove: '\u79fb\u51fa',
  selected: '\u5df2\u9009',
  beginPaper: '\u8fdb\u5165\u7ec4\u5377',
};

function questionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    single_choice: '\u5355\u9009\u9898',
    multiple_choice: '\u591a\u9009\u9898',
    true_false: '\u5224\u65ad\u9898',
    fill_blank: '\u586b\u7a7a\u9898',
    essay: '\u7b80\u7b54\u9898',
    calculation: '\u8ba1\u7b97\u9898',
    experiment: '\u5b9e\u9a8c\u9898',
  };
  return labels[type] || type || '\u5176\u4ed6\u9898\u578b';
}

function subjectLabel(subject: string) {
  const labels: Record<string, string> = {
    physics: '\u7269\u7406',
    mathematics: '\u6570\u5b66',
    math: '\u6570\u5b66',
    chemistry: '\u5316\u5b66',
    biology: '\u751f\u7269',
    chinese: '\u8bed\u6587',
    english: '\u82f1\u8bed',
  };
  return labels[subject] || subject || '\u672a\u8bbe\u7f6e\u79d1\u76ee';
}

export default function QuestionBasketOverlay({ canUse, aboveTabBar = false, onRestricted, resolveNodes, onResolveQuestions, onBeginPaper }: QuestionBasketOverlayProps) {
  const basket = useQuestionBasket();
  const resolutionGenerationRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [resolutionState, setResolutionState] = useState<'idle' | 'loading' | 'ready' | 'offline'>('idle');
  const [resolutionError, setResolutionError] = useState('');
  const [authoritativeUnavailableIds, setAuthoritativeUnavailableIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const unavailable = new Set(authoritativeUnavailableIds);
    setSelectedIds(current => current.filter(id => basket.ids.includes(id) && !unavailable.has(id)));
  }, [basket.revision, authoritativeUnavailableIds.join('|'), open]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const unavailableSet = useMemo(() => new Set(authoritativeUnavailableIds), [authoritativeUnavailableIds.join('|')]);
  const availableIds = useMemo(
    () => basket.ids.filter(id => !unavailableSet.has(id)),
    [basket.ids.join('|'), authoritativeUnavailableIds.join('|')],
  );
  const allSelected = availableIds.length > 0 && selectedIds.length === availableIds.length && availableIds.every(id => selectedSet.has(id));
  const unresolvedIds = useMemo(
    () => basket.ids.filter(id => !unavailableSet.has(id) && !questionBasketStore.question(id)),
    [basket.ids.join('|'), basket.questionRevision, authoritativeUnavailableIds.join('|')],
  );
  const typeStats = useMemo(() => {
    const stats = new Map<string, number>();
    basket.ids.forEach(id => {
      const question = questionBasketStore.question(id);
      const type = question
        ? questionTypeLabel(question.type || '')
        : unavailableSet.has(id) ? '\u5df2\u5931\u6548' : '\u6b63\u5728\u8bfb\u53d6';
      stats.set(type, (stats.get(type) || 0) + 1);
    });
    return Array.from(stats.entries());
  }, [basket.ids.join('|'), basket.revision, basket.questionRevision, authoritativeUnavailableIds.join('|')]);

  const resolveBasketQuestions = async (ids: string[]) => {
    const missingIds = ids.filter(id => !questionBasketStore.question(id));
    setAuthoritativeUnavailableIds([]);
    setResolutionError('');
    if (!missingIds.length) {
      setResolutionState('ready');
      return;
    }
    if (!onResolveQuestions) {
      setResolutionState('offline');
      setResolutionError('\u6682\u65f6\u65e0\u6cd5\u8bfb\u53d6\u8bd5\u9898\u7bee');
      return;
    }
    const generation = resolutionGenerationRef.current + 1;
    resolutionGenerationRef.current = generation;
    setResolutionState('loading');
    try {
      const result = await onResolveQuestions(missingIds);
      if (generation !== resolutionGenerationRef.current) return;
      if (!result?.success) {
        setResolutionState('offline');
        setResolutionError(result?.error || '\u9898\u76ee\u8bfb\u53d6\u672a\u5b8c\u6210\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc');
        return;
      }
      const unavailableIds = (result.unavailableIds || []).filter(id => missingIds.includes(id));
      setAuthoritativeUnavailableIds(unavailableIds);
      setSelectedIds(current => current.filter(id => !unavailableIds.includes(id)));
      const unresolved = missingIds.filter(id => !unavailableIds.includes(id) && !questionBasketStore.question(id));
      if (unresolved.length) {
        setResolutionState('offline');
        setResolutionError('\u9898\u76ee\u8bfb\u53d6\u672a\u5b8c\u6210\uff0c\u8bf7\u4e0b\u62c9\u540e\u91cd\u8bd5');
        return;
      }
      setResolutionState('ready');
    } catch (error: any) {
      if (generation !== resolutionGenerationRef.current) return;
      setResolutionState('offline');
      setResolutionError(error?.message || '\u9898\u76ee\u8bfb\u53d6\u672a\u5b8c\u6210\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc');
    }
  };

  const showWriteFailure = (result: any, emptyMessage = '\u8bf7\u5148\u9009\u62e9\u8981\u7ec4\u5377\u7684\u9898\u76ee') => {
    if (result?.reason === 'persistence-failed') {
      Taro.showToast({ title: '\u8bd5\u9898\u7bee\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5', icon: 'none' });
      return;
    }
    if (result?.reason === 'unavailable-questions') {
      Taro.showToast({ title: '\u6240\u9009\u9898\u76ee\u4e2d\u6709\u5df2\u4e0d\u53ef\u7528\u7684\u9898\u76ee', icon: 'none' });
      return;
    }
    Taro.showToast({ title: emptyMessage, icon: 'none' });
  };

  const openBasket = () => {
    questionBasketStore.reconcileIdentity();
    if (!canUse || !questionBasketStore.snapshot().scopeKey) {
      onRestricted();
      return;
    }
    const ids = questionBasketStore.snapshot().ids;
    setSelectedIds(ids);
    setOpen(true);
    void resolveBasketQuestions(ids);
  };

  const clearBasket = () => {
    Taro.showModal({
      title: '\u6e05\u7a7a\u8bd5\u9898\u7bee',
      content: '\u786e\u5b9a\u79fb\u51fa\u8bd5\u9898\u7bee\u4e2d\u7684\u5168\u90e8\u9898\u76ee\u5417\uff1f',
      confirmText: copy.clear,
      confirmColor: '#C53D43',
      success: result => {
        if (!result.confirm) return;
        const writeResult = questionBasketStore.clear();
        if (!writeResult.written && writeResult.reason !== 'unchanged') {
          showWriteFailure(writeResult, '\u8bd5\u9898\u7bee\u6e05\u7a7a\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
          return;
        }
        setSelectedIds([]);
        setOpen(false);
      },
    });
  };

  const beginPaper = () => {
    if (resolutionState === 'loading' || resolutionState === 'offline' || unresolvedIds.some(id => selectedSet.has(id))) {
      Taro.showToast({ title: resolutionState === 'loading' ? '\u6b63\u5728\u6062\u590d\u8bd5\u9898\u7bee\uff0c\u8bf7\u7a0d\u5019' : '\u9898\u76ee\u8bfb\u53d6\u672a\u5b8c\u6210\uff0c\u8bf7\u91cd\u8bd5', icon: 'none' });
      return;
    }
    const result = questionBasketStore.beginPaper(selectedIds);
    if (!result.written) {
      showWriteFailure(result);
      return;
    }
    setOpen(false);
    if (onBeginPaper) onBeginPaper(result.selection?.selectedIds || selectedIds);
    else Taro.navigateTo({ url: '/pages/question-paper/index' });
  };

  return <>
    <Button className={'global-question-basket ' + (aboveTabBar ? 'above-tab-bar' : 'above-safe-area')} onClick={openBasket}>
      <Text className='global-question-basket-label'>{copy.basket}</Text>
      {basket.ids.length ? <Text className='global-question-basket-count'>{String(basket.ids.length)}</Text> : null}
    </Button>

    <PageContainer
      show={open}
      position='bottom'
      round
      overlay
      closeOnSlideDown
      zIndex={2000}
      onClickOverlay={() => setOpen(false)}
      onAfterLeave={() => setOpen(false)}
    >
      <View className='question-basket-drawer'>
        <View className='question-basket-head'>
          <View>
            <Text className='question-basket-title'>{copy.basket}</Text>
            <Text className='question-basket-total'>{copy.total + ' ' + basket.ids.length + ' ' + copy.questions}</Text>
          </View>
          <Button className='question-basket-close' onClick={() => setOpen(false)}>{copy.close}</Button>
        </View>

        {typeStats.length ? <View className='question-basket-stats'>
          {typeStats.map(([type, count]) => <Text key={type}>{type + ' ' + count}</Text>)}
        </View> : null}

        {resolutionState === 'loading' ? <View className='question-basket-resolution loading'>
          <Text>{'\u6b63\u5728\u6062\u590d\u8bd5\u9898\u7bee\u4e2d\u7684\u9898\u76ee'}</Text>
        </View> : null}
        {resolutionState === 'offline' ? <View className='question-basket-resolution offline'>
          <Text>{resolutionError}</Text>
          <Button onClick={() => { void resolveBasketQuestions(basket.ids); }}>{'\u91cd\u8bd5'}</Button>
        </View> : null}
        {authoritativeUnavailableIds.length ? <View className='question-basket-resolution unavailable'>
          <Text>{String(authoritativeUnavailableIds.length) + '\u9898\u5df2\u4ece\u9898\u5e93\u79fb\u9664\uff0c\u53ef\u4ece\u8bd5\u9898\u7bee\u4e2d\u5220\u9664'}</Text>
        </View> : null}

        {basket.ids.length ? <>
          <View className='question-basket-selection-bar'>
            <Checkbox
              className='question-basket-select-all'
              value='__all__'
              checked={allSelected}
              onClick={() => setSelectedIds(allSelected ? [] : availableIds.slice())}
            >{allSelected ? copy.deselectAll : copy.selectAll}</Checkbox>
            <Button
              className='question-basket-text-action danger'
              disabled={!selectedIds.length}
              onClick={() => {
                const writeResult = questionBasketStore.removeMany(selectedIds);
                if (!writeResult.written && writeResult.reason !== 'unchanged') {
                  showWriteFailure(writeResult, '\u79fb\u51fa\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
                  return;
                }
                setSelectedIds([]);
              }}
            >{copy.removeSelected}</Button>
            <Button className='question-basket-text-action danger' onClick={clearBasket}>{copy.clear}</Button>
          </View>

          <CheckboxGroup className='question-basket-list-group' onChange={event => {
            const changedIds = (event.detail.value || []).map(String);
            const lockedIds = selectedIds.filter(id => unresolvedIds.includes(id));
            setSelectedIds(Array.from(new Set(changedIds.concat(lockedIds))));
          }}>
            <ScrollView className='question-basket-list' scrollY>
            {basket.ids.map((id, index) => {
              const question = questionBasketStore.question(id);
              const display = question ? createQuestionDisplay(question) : null;
              return <View key={id} className='question-basket-item'>
                <Checkbox className='question-basket-item-check' value={id} checked={selectedSet.has(id)} disabled={!question} />
                <View className='question-basket-item-main'>
                  <View className='question-basket-item-meta'>
                    <Text>{String(index + 1)}</Text>
                    {question ? <Text>{subjectLabel(question.subject)}</Text> : null}
                    {question ? <Text>{questionTypeLabel(question.type)}</Text> : null}
                  </View>
                  {display ? <RichText className='question-basket-item-stem' nodes={resolveNodes ? resolveNodes(display.stem) : display.stem} /> : <Text className={'question-basket-item-missing ' + (unavailableSet.has(id) ? 'unavailable' : 'pending')}>{unavailableSet.has(id) ? '\u9898\u76ee\u5df2\u4ece\u9898\u5e93\u79fb\u9664' : resolutionState === 'offline' ? '\u6682\u65f6\u65e0\u6cd5\u8bfb\u53d6\u8be5\u9898' : '\u6b63\u5728\u8bfb\u53d6\u9898\u76ee'}</Text>}
                </View>
                <View className='question-basket-item-actions'>
                  <Button disabled={index === 0} onClick={() => {
                    const writeResult = questionBasketStore.move(id, -1);
                    if (!writeResult.written && writeResult.reason === 'persistence-failed') showWriteFailure(writeResult);
                  }}>{copy.moveUp}</Button>
                  <Button disabled={index === basket.ids.length - 1} onClick={() => {
                    const writeResult = questionBasketStore.move(id, 1);
                    if (!writeResult.written && writeResult.reason === 'persistence-failed') showWriteFailure(writeResult);
                  }}>{copy.moveDown}</Button>
                  <Button className='danger' onClick={() => {
                    const writeResult = questionBasketStore.removeMany([id]);
                    if (!writeResult.written && writeResult.reason !== 'unchanged') showWriteFailure(writeResult, '\u79fb\u51fa\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
                  }}>{copy.remove}</Button>
                </View>
              </View>;
            })}
            </ScrollView>
          </CheckboxGroup>
        </> : <View className='question-basket-empty'>
          <Text className='question-basket-empty-title'>{'\u8bd5\u9898\u7bee\u8fd8\u662f\u7a7a\u7684'}</Text>
          <Text>{'\u8fd4\u56de\u9898\u5e93\uff0c\u9009\u62e9\u9700\u8981\u7ec4\u5377\u7684\u9898\u76ee\u3002'}</Text>
        </View>}

        <View className='question-basket-footer'>
          <Text>{copy.selected + ' ' + selectedIds.length + ' ' + copy.questions}</Text>
          <Button className='question-basket-paper-action' disabled={!selectedIds.length || resolutionState === 'loading' || resolutionState === 'offline' || unresolvedIds.some(id => selectedSet.has(id))} onClick={beginPaper}>{resolutionState === 'loading' ? '\u6b63\u5728\u6062\u590d' : copy.beginPaper}</Button>
        </View>
      </View>
    </PageContainer>
  </>;
}
