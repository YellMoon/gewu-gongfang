import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { storage } from './storage';
// @ts-ignore CommonJS store runtime is shared with direct Node contract tests.
import * as basketRuntime from './questionBasketStoreRuntime';

export interface QuestionBasketSnapshot {
  scopeKey: string;
  ids: string[];
  revision: number;
  questionRevision: number;
}

export interface QuestionBasketWriteResult {
  written: boolean;
  reason?: 'scope-changed' | 'invalid-id' | 'no-selection' | 'out-of-range' | 'unchanged' | 'persistence-failed' | 'unavailable-questions';
  unavailableIds?: string[];
  snapshot: QuestionBasketSnapshot;
  selection?: {
    scopeKey: string;
    selectedIds: string[];
    basketRevision: number;
    createdAt: number;
  };
}

export const questionBasketStore: any = basketRuntime.createQuestionBasketStore({
  readIdentity: () => Taro.getStorageSync('user_info'),
  read: (key: string) => storage.get<any>(key),
  write: (key: string, value: any) => storage.setChecked(key, value),
  now: () => Date.now(),
});

export function useQuestionBasket(): QuestionBasketSnapshot {
  const [snapshot, setSnapshot] = useState<QuestionBasketSnapshot>(() => questionBasketStore.snapshot());

  useEffect(() => {
    const update = () => setSnapshot(questionBasketStore.snapshot());
    const unsubscribe = questionBasketStore.subscribe(update);
    questionBasketStore.reconcileIdentity();
    update();
    return unsubscribe;
  }, []);

  return snapshot;
}

export const paperSelectionCacheKey = basketRuntime.paperSelectionCacheKey as (scopeKey: string) => string;
