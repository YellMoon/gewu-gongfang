/**
 * 资产统计 v1 — 收支概览 + 分类统计 + 趋势
 */
import { useState, useMemo } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { getLocalData } from '../../utils/sync';
import { NetworkStatus, EmptyState, StatCard } from '../../components/shared';
import './index.scss';

interface AssetRecord {
  id: string;
  category_id: string;
  amount: number;
  type: 'income' | 'expense';
  date: string;
  notes?: string;
  created_at: string;
}

interface AssetCategory {
  id: string;
  name: string;
  type: 'income' | 'expense';
  color: string;
}

export default function Assets() {
  const [records, setRecords] = useState<AssetRecord[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('month');

  useDidShow(() => { loadData(); });

  const loadData = () => {
    setRecords(getLocalData<AssetRecord>('assetRecords'));
    setCategories(getLocalData<AssetCategory>('assetCategories'));
  };

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisYear = String(now.getFullYear());

  const filteredRecords = useMemo(() => {
    if (period === 'month') return records.filter(r => r.date?.startsWith(thisMonth));
    if (period === 'year') return records.filter(r => r.date?.startsWith(thisYear));
    return records;
  }, [records, period, thisMonth, thisYear]);

  const totalIncome = filteredRecords.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const totalExpense = filteredRecords.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const netProfit = totalIncome - totalExpense;

  // 按分类汇总
  const categoryStats = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; color: string; type: string }>();
    filteredRecords.forEach(r => {
      const cat = categories.find(c => c.id === r.category_id);
      const key = r.category_id || 'unknown';
      const existing = map.get(key) || { name: cat?.name || '未分类', amount: 0, color: cat?.color || '#999', type: r.type };
      existing.amount += r.amount;
      map.set(key, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [filteredRecords, categories]);

  const incomeStats = categoryStats.filter(s => s.type === 'income');
  const expenseStats = categoryStats.filter(s => s.type === 'expense');

  return (
    <View className="assets-page">
      <NetworkStatus />

      {/* 总览卡片 */}
      <View className="overview-card">
        <View className="overview-row">
          <View className="overview-item">
            <Text className="ov-label">总收入</Text>
            <Text className="ov-value income">¥{totalIncome.toFixed(0)}</Text>
          </View>
          <View className="overview-item">
            <Text className="ov-label">总支出</Text>
            <Text className="ov-value expense">¥{totalExpense.toFixed(0)}</Text>
          </View>
          <View className="overview-item">
            <Text className="ov-label">净利润</Text>
            <Text className={`ov-value ${netProfit >= 0 ? 'income' : 'expense'}`}>¥{netProfit.toFixed(0)}</Text>
          </View>
        </View>
      </View>

      {/* 时间筛选 */}
      <View className="period-bar">
        {[{ k: 'month' as const, v: '本月' }, { k: 'year' as const, v: '本年' }, { k: 'all' as const, v: '全部' }].map(p => (
          <View key={p.k} className={`period-tag ${period === p.k ? 'active' : ''}`} onClick={() => setPeriod(p.k)}>
            <Text>{p.v}</Text>
          </View>
        ))}
      </View>

      {filteredRecords.length === 0 ? (
        <EmptyState icon="💰" text="暂无资产记录" />
      ) : (
        <ScrollView scrollY className="stats-scroll">
          {/* 收入分类 */}
          {incomeStats.length > 0 && (
            <View className="cat-section">
              <Text className="cat-title">收入分类</Text>
              {incomeStats.map((s, i) => (
                <View key={i} className="cat-row">
                  <View className="cat-dot" style={{ background: s.color }} />
                  <Text className="cat-name">{s.name}</Text>
                  <View className="cat-bar-wrap">
                    <View className="cat-bar" style={{ width: `${totalIncome > 0 ? (s.amount / totalIncome * 100) : 0}%`, background: s.color }} />
                  </View>
                  <Text className="cat-amount income">¥{s.amount.toFixed(0)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* 支出分类 */}
          {expenseStats.length > 0 && (
            <View className="cat-section">
              <Text className="cat-title">支出分类</Text>
              {expenseStats.map((s, i) => (
                <View key={i} className="cat-row">
                  <View className="cat-dot" style={{ background: s.color }} />
                  <Text className="cat-name">{s.name}</Text>
                  <View className="cat-bar-wrap">
                    <View className="cat-bar" style={{ width: `${totalExpense > 0 ? (s.amount / totalExpense * 100) : 0}%`, background: s.color }} />
                  </View>
                  <Text className="cat-amount expense">¥{s.amount.toFixed(0)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* 最近记录 */}
          <View className="cat-section">
            <Text className="cat-title">最近记录</Text>
            {filteredRecords.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20).map(r => {
              const cat = categories.find(c => c.id === r.category_id);
              return (
                <View key={r.id} className="record-row">
                  <View className="record-dot" style={{ background: cat?.color || '#999' }} />
                  <View className="record-info">
                    <Text className="record-name">{cat?.name || '未分类'}</Text>
                    <Text className="record-date">{r.date} {r.notes ? `· ${r.notes}` : ''}</Text>
                  </View>
                  <Text className={`record-amount ${r.type}`}>{r.type === 'income' ? '+' : '-'}¥{r.amount}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
