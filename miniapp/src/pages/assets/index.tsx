// UTF-8: Keep imports explicit and scoped to the initiating session.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from '@tarojs/components';
import Taro, { useDidShow, useDidHide, usePullDownRefresh } from '@tarojs/taro';
import { miniappCloudBusinessApi } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import { assertMiniappWriteAllowed } from '../../utils/permission';
import { getLocalData, pullFromCloudBusinessProjection } from '../../utils/sync';
import { EmptyState, LoadingSkeleton } from '../../components/shared';
import { canAccessMiniappPage, refreshMiniappPageAccess } from '../../utils/miniappPageAccess';
import ForbiddenPage from '../../components/ForbiddenContent';
// @ts-ignore CommonJS CSV parser has no TypeScript declarations.
import { parsePersonalAssetCsv } from '../../utils/personalAssetCsv';
// @ts-ignore CommonJS import helpers share the tested retry contract.
import { personalAssetImportKey, personalAssetImportError } from '../../utils/personalAssetImport';
import './index.scss';

interface AssetRecord { id: string; category_id: string; category_name?: string; amount: number; type: 'income' | 'expense'; date: string; note?: string; }
interface AssetCategory { id: string; name: string; type: 'income' | 'expense'; color: string; }

export default function Assets() {
  const [records, setRecords] = useState<AssetRecord[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('month');

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [importing, setImporting] = useState(false);
  const importLock = useRef(false);
  const alive = useRef(true);
  const visible = useRef(true);
  const readSequence = useRef(0);
  const resultSession = useRef<ReturnType<typeof authSessionRuntime.capture> | null>(null);
  const refresh = async () => {
    const sequence = ++readSequence.current;
    const session = authSessionRuntime.capture();
    const current = () => alive.current && visible.current && sequence === readSequence.current && authSessionRuntime.isSameSession(session);
    setRecords([]); setCategories([]); setLoading(true); setLoadFailed(false);
    try {
      if (!await refreshMiniappPageAccess('/pages/assets/index') || !current() || !canAccessMiniappPage('/pages/assets/index')) return;
      let refreshed = false;
      try { refreshed = await pullFromCloudBusinessProjection(); } catch { /* Only scoped cache is used below. */ }
      if (!current() || !canAccessMiniappPage('/pages/assets/index')) return;
      setRecords(getLocalData<AssetRecord>('assetRecords'));
      setCategories(getLocalData<AssetCategory>('assetCategories'));
      resultSession.current = session;
      setLoadFailed(!refreshed);
    } finally {
      if (alive.current && sequence === readSequence.current) { setLoading(false); void Taro.stopPullDownRefresh(); }
    }
  };
  useDidShow(() => { visible.current = true; return refresh(); });
  usePullDownRefresh(refresh);
  // Native file selection may hide/show this page; retain its lock and session.
  useDidHide(() => { visible.current = false; readSequence.current++; setRecords([]); setCategories([]); setLoading(true); });
  useEffect(() => { alive.current = true; return () => { alive.current = false; readSequence.current++; }; }, []);

  const submitAssetImportTask = async () => {
    if (importLock.current || !alive.current || !visible.current) return;
    const session = authSessionRuntime.capture();
    const current = () => alive.current && visible.current && authSessionRuntime.isSameSession(session) && canAccessMiniappPage('/pages/assets/index');
    if (!session.token || !current()) return;
    importLock.current = true; setImporting(true);
    try {
      assertMiniappWriteAllowed('asset-import');
      const selected: any = await Taro.chooseMessageFile({ count: 1, type: 'file', extension: ['csv'] });
      if (!current()) return;
      const filePath = selected?.tempFiles?.[0]?.path;
      if (typeof filePath !== 'string' || !filePath) throw new Error('CSV_FILE_REQUIRED');
      const content = await new Promise<string>((resolve, reject) => {
        Taro.getFileSystemManager().readFile({ filePath, encoding: 'utf8', success: result => resolve(String(result.data || '')), fail: reject });
      });
      if (!current()) return;
      const rows = parsePersonalAssetCsv(content);
      const confirmed = await Taro.showModal({ title: '导入个人资产', content: `将向当前账号导入 ${rows.length} 条记录。相同文件重复导入不会重复添加。`, confirmText: '导入', cancelText: '取消' });
      if (!confirmed.confirm || !current()) return;
      assertMiniappWriteAllowed('asset-import');
      const response = await miniappCloudBusinessApi.importPersonalAssets(session.token, rows, personalAssetImportKey(rows));
      if (!current()) return;
      if (!response.success) throw Object.assign(new Error(response.error || 'IMPORT_FAILED'), { code: response.code });
      const replayed = response.data?.receipt?.replayed;
      await refresh();
      if (current()) Taro.showToast({ title: replayed ? '这份文件已导入' : '导入成功', icon: 'success' });
    } catch (error: any) {
      if (current() && !/cancel/i.test(String(error?.errMsg || error?.message || ''))) Taro.showToast({ title: personalAssetImportError(error), icon: 'none' });
    } finally {
      importLock.current = false;
      if (alive.current) setImporting(false);
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
  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);
  const categoryStats = useMemo(() => {
    const values = new Map<string, { name: string; amount: number; color: string; type: string }>();
    for (const record of filteredRecords) {
      const category = categoryById.get(record.category_id);
      const key = record.category_id || 'unknown';
      const value = values.get(key) || { name: category?.name || '\u672a\u5206\u7c7b', amount: 0, color: category?.color || '#999', type: record.type };
      value.amount += record.amount;
      values.set(key, value);
    }
    return Array.from(values.values()).sort((left, right) => right.amount - left.amount);
  }, [filteredRecords, categoryById]);

  if (!canAccessMiniappPage('/pages/assets/index')) return <ForbiddenPage />;
  // UTF-8: Loading and read failures are not empty financial records.
  if (resultSession.current && !authSessionRuntime.isSameSession(resultSession.current)) return <View className='assets-page'><LoadingSkeleton /></View>;
  if (loading) return <View className='assets-page'><LoadingSkeleton /></View>;
  if (loadFailed && records.length === 0) return <View className='assets-page'><EmptyState text='暂时无法读取个人资产' actionText='重试' onAction={refresh} /></View>;

  return (
    <View className='assets-page'>
      {loadFailed && <View className='asset-cache-notice'><Text>暂时无法更新，显示已保存的数据</Text></View>}
      <View className={`task-card${importing ? ' review-read-only' : ''}`} onClick={submitAssetImportTask}>
        <Text className='task-title'>{importing ? '正在处理…' : '导入财务数据'}</Text>
        <Text className='task-desc'>选择 CSV 文件，确认后导入当前账号。</Text>
      </View>
      <View className='overview-card'><View className='overview-row'>
        <View className='overview-item'><Text className='ov-label'>{'\u603b\u6536\u5165'}</Text><Text className='ov-value income'>{'\u00a5'}{totalIncome.toFixed(2)}</Text></View>
        <View className='overview-item'><Text className='ov-label'>{'\u603b\u652f\u51fa'}</Text><Text className='ov-value expense'>{'\u00a5'}{totalExpense.toFixed(2)}</Text></View>
        <View className='overview-item'><Text className='ov-label'>{'\u7ed3\u4f59'}</Text><Text className={`ov-value ${totalIncome - totalExpense >= 0 ? 'income' : 'expense'}`}>{'\u00a5'}{(totalIncome - totalExpense).toFixed(2)}</Text></View>
      </View></View>
      <View className='period-bar'>
        {[{ key: 'month' as const, label: '\u672c\u6708' }, { key: 'year' as const, label: '\u672c\u5e74' }, { key: 'all' as const, label: '\u5168\u90e8' }].map(item => <View key={item.key} className={`period-tag ${period === item.key ? 'active' : ''}`} onClick={() => setPeriod(item.key)}><Text>{item.label}</Text></View>)}
      </View>
      {filteredRecords.length === 0 ? <EmptyState icon={'\u8d26'} text={'\u6682\u65e0\u8d44\u4ea7\u8bb0\u5f55'} /> : <View className='stats-content'>
        {categoryStats.map((item, index) => <View key={`${item.name}-${index}`} className='cat-row'><View className='cat-dot' style={{ background: item.color }} /><Text className='cat-name'>{item.name}</Text><Text className={`cat-amount ${item.type}`}>{'\u00a5'}{item.amount.toFixed(2)}</Text></View>)}
        <View className='cat-section'><Text className='cat-title'>{'\u6700\u8fd1\u8bb0\u5f55'}</Text>{filteredRecords.slice(0, 20).map(record => <View key={record.id} className='record-row'>
          <View className='record-info'>
            <Text className='record-name'>{categoryById.get(record.category_id)?.name || record.category_name || '未分类'}</Text>
            {record.note && <Text className='record-note'>{record.note}</Text>}
            <Text className='record-date'>{record.date}</Text>
          </View>
          <Text className={`record-amount ${record.type}`}>{record.type === 'income' ? '+' : '-'}¥{record.amount.toFixed(2)}</Text>
        </View>)}</View>
      </View>}
    </View>
  );
}
