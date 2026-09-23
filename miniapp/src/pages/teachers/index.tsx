import { useState, useEffect, useRef } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useDidShow, useDidHide, usePullDownRefresh } from '@tarojs/taro';
import { Teacher } from '../../types';
import { getLocalData, pullFromCloudBusinessProjection } from '../../utils/sync';
import { EmptyState, LoadingSkeleton } from '../../components/shared';
import ForbiddenPage from '../../components/ForbiddenContent';
import { authSessionRuntime } from '../../utils/authSession';
import { canAccessMiniappPage, refreshMiniappPageAccess } from '../../utils/miniappPageAccess';
import './index.scss';

export default function Teachers() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestSequence = useRef(0);
  const resultSession = useRef<ReturnType<typeof authSessionRuntime.capture> | null>(null);

  const handleRefresh = async () => {
    const sequence = ++requestSequence.current;
    const session = authSessionRuntime.capture();
    const isCurrent = () => sequence === requestSequence.current && authSessionRuntime.isSameSession(session);
    setTeachers([]);
    setLoading(true);
    setLoadFailed(false);
    try {
      if (!await refreshMiniappPageAccess('/pages/teachers/index') || !isCurrent()) return;
      let refreshed = false;
      try { refreshed = await pullFromCloudBusinessProjection(); } catch { /* Use authorized cache below. */ }
      if (!isCurrent() || !canAccessMiniappPage('/pages/teachers/index')) return;
      setTeachers(getLocalData<Teacher>('teachers'));
      resultSession.current = session;
      setLoadFailed(!refreshed);
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        void Taro.stopPullDownRefresh();
      }
    }
  };

  useDidShow(handleRefresh);
  usePullDownRefresh(handleRefresh);
  useDidHide(() => {
    requestSequence.current++;
    setTeachers([]);
    setLoading(true);
  });
  useEffect(() => () => { requestSequence.current++; }, []);

  if (!canAccessMiniappPage('/pages/teachers/index')) return <ForbiddenPage />;
  if (resultSession.current !== null && !authSessionRuntime.isSameSession(resultSession.current)) {
    return <View className='teachers-page'><LoadingSkeleton /></View>;
  }
  if (!loading && loadFailed && teachers.length === 0) {
    return <View className='teachers-page'><EmptyState text='暂时无法读取教师资料' actionText='重试' onAction={handleRefresh} /></View>;
  }

  return (
    <View className="teachers-page">
      {loadFailed && <View className='people-cache-notice'><Text>暂时无法更新，显示已保存的数据</Text></View>}

      <View className="search-bar">
        <Text className="page-title">教师 ({teachers.length})</Text>
      </View>

      {loading ? <LoadingSkeleton rows={4} avatar /> : teachers.length === 0 ? (
        <EmptyState icon="师" text="暂无教师数据" />
      ) : (
        <View className="teacher-list">
          {teachers.map(t => (
            <View key={t.id} className="teacher-card">
              <View className="teacher-avatar">
                <Text className="teacher-avatar-text">{t.name.charAt(0)}</Text>
              </View>
              <View className="teacher-info">
                <Text className="teacher-name">{t.name}</Text>
                <Text className="teacher-detail">{[t.subject, t.phone].filter(Boolean).join(' · ') || '暂无信息'}</Text>
              </View>
              {Boolean(t.hourly_rate) && <Text className="teacher-rate">¥{t.hourly_rate}/时</Text>}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
