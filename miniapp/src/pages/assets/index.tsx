import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { miniappCloudBusinessApi } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import { assertMiniappWriteAllowed } from '../../utils/permission';
import { getLocalData } from '../../utils/sync';
import { EmptyState, NetworkStatus } from '../../components/shared';
// @ts-ignore CommonJS CSV parser has no TypeScript declarations.
import { parsePersonalAssetCsv } from '../../utils/personalAssetCsv';
import './index.scss';

interface AssetRecord { id: string; category_id: string; amount: number; type: 'income' | 'expense'; date: string; notes?: string; }
interface AssetCategory { id: string; name: string; type: 'income' | 'expense'; color: string; }

export default function Assets() {
  const [records, setRecords] = useState<AssetRecord[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('month');

  useDidShow(() => {
    setRecords(getLocalData<AssetRecord>('assetRecords'));
    setCategories(getLocalData<AssetCategory>('assetCategories'));
  });

  const submitAssetImportTask = async () => {
    try {
      assertMiniappWriteAllowed('asset-import');
      const selected: any = await Taro.chooseMessageFile({ count: 1, type: 'file', extension: ['csv'] });
      const filePath = selected?.tempFiles?.[0]?.path;
      if (typeof filePath !== 'string' || !filePath) throw new Error('CSV_FILE_REQUIRED');
      const content = await new Promise<string>((resolve, reject) => {
        Taro.getFileSystemManager().readFile({ filePath, encoding: 'utf8', success: result => resolve(String(result.data || '')), fail: reject });
      });
      const response = await miniappCloudBusinessApi.importPersonalAssets(authSessionRuntime.capture().token, parsePersonalAssetCsv(content), `asset-import-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      if (!response.success) throw new Error(response.error || '\u5bfc\u5165\u5931\u8d25');
      Taro.showToast({ title: '\u8d22\u52a1\u5bfc\u5165\u5df2\u4fdd\u5b58', icon: 'success' });
    } catch (error: any) {
      Taro.showToast({ title: error?.message || '\u5bfc\u5165\u5931\u8d25', icon: 'none' });
    }
  };

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const yearKey = String(now.getFullYear());
  const filteredRecords = useMemo(() => {
    if (period === 'month') return records.filter(record => record.date?.startsWith(monthKey));
    if (period === 'year') return records.filter(record => record.date?.startsWith(yearKey));
    return records;
  }, [records, period, monthKey, yearKey]);
  const totalIncome = filteredRecords.filter(record => record.type === 'income').reduce((sum, record) => sum + record.amount, 0);
  const totalExpense = filteredRecords.filter(record => record.type === 'expense').reduce((sum, record) => sum + record.amount, 0);
  const categoryStats = useMemo(() => {
    const values = new Map<string, { name: string; amount: number; color: string; type: string }>();
    for (const record of filteredRecords) {
      const category = categories.find(item => item.id === record.category_id);
      const key = record.category_id || 'unknown';
      const value = values.get(key) || { name: category?.name || '\u672a\u5206\u7c7b', amount: 0, color: category?.color || '#999', type: record.type };
      value.amount += record.amount;
      values.set(key, value);
    }
    return Array.from(values.values()).sort((left, right) => right.amount - left.amount);
  }, [filteredRecords, categories]);

  return (
    <View className='assets-page'>
      <NetworkStatus />
      <View className='task-card' onClick={submitAssetImportTask}>
        <Text className='task-title'>{'\u5bfc\u5165\u8d22\u52a1\u6570\u636e'}</Text>
        <Text className='task-desc'>{'\u9009\u62e9\u4e2a\u4eba\u8d44\u4ea7\u7edf\u8ba1\u6240\u9700\u7684\u6570\u636e\u6587\u4ef6\u5e76\u5f00\u59cb\u5bfc\u5165\u3002'}</Text>
      </View>
      <View className='overview-card'><View className='overview-row'>
        <View className='overview-item'><Text className='ov-label'>{'\u603b\u6536\u5165'}</Text><Text className='ov-value income'>{'\u00a5'}{totalIncome.toFixed(0)}</Text></View>
        <View className='overview-item'><Text className='ov-label'>{'\u603b\u652f\u51fa'}</Text><Text className='ov-value expense'>{'\u00a5'}{totalExpense.toFixed(0)}</Text></View>
        <View className='overview-item'><Text className='ov-label'>{'\u7ed3\u4f59'}</Text><Text className={`ov-value ${totalIncome - totalExpense >= 0 ? 'income' : 'expense'}`}>{'\u00a5'}{(totalIncome - totalExpense).toFixed(0)}</Text></View>
      </View></View>
      <View className='period-bar'>
        {[{ key: 'month' as const, label: '\u672c\u6708' }, { key: 'year' as const, label: '\u672c\u5e74' }, { key: 'all' as const, label: '\u5168\u90e8' }].map(item => <View key={item.key} className={`period-tag ${period === item.key ? 'active' : ''}`} onClick={() => setPeriod(item.key)}><Text>{item.label}</Text></View>)}
      </View>
      {filteredRecords.length === 0 ? <EmptyState icon={'\u8d26'} text={'\u6682\u65e0\u8d44\u4ea7\u8bb0\u5f55'} /> : <ScrollView scrollY className='stats-scroll'><View className='stats-content'>
        {categoryStats.map((item, index) => <View key={`${item.name}-${index}`} className='cat-row'><View className='cat-dot' style={{ background: item.color }} /><Text className='cat-name'>{item.name}</Text><Text className={`cat-amount ${item.type}`}>{'\u00a5'}{item.amount.toFixed(0)}</Text></View>)}
        <View className='cat-section'><Text className='cat-title'>{'\u6700\u8fd1\u8bb0\u5f55'}</Text>{filteredRecords.slice(0, 20).map(record => <View key={record.id} className='record-row'><Text>{record.date}</Text><Text className={record.type}>{'\u00a5'}{record.amount.toFixed(0)}</Text></View>)}</View>
      </View></ScrollView>}
    </View>
  );
}
