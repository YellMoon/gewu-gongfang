import { useState } from 'react';
import { View, Text } from '@tarojs/components';
import { useDidShow } from '@tarojs/taro';
import { Teacher } from '../../types';
import { getLocalData, pullFromCloudBusinessProjection } from '../../utils/sync';
import { NetworkStatus, EmptyState, LoadingSkeleton, PullRefreshView } from '../../components/shared';
import './index.scss';

export default function Teachers() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);

  useDidShow(() => {
    void handleRefresh();
  });

  const loadTeachers = () => {
    setTeachers(getLocalData<Teacher>('teachers'));
    setLoading(false);
  };

  const handleRefresh = async () => {
    try {
      await pullFromCloudBusinessProjection();
      loadTeachers();
    } catch {
      loadTeachers();
    }
  };

  return (
    <View className="teachers-page">
      <NetworkStatus onRetry={handleRefresh} />

      <View className="search-bar">
        <Text className="page-title">教师 ({teachers.length})</Text>
      </View>

      {loading ? <LoadingSkeleton rows={4} avatar /> : teachers.length === 0 ? (
        <EmptyState icon="师" text="暂无教师数据" />
      ) : (
        <PullRefreshView onRefresh={handleRefresh} className="teacher-list">
          {teachers.map(t => (
            <View key={t.id} className="teacher-card">
              <View className="teacher-avatar">
                <Text className="teacher-avatar-text">{t.name.charAt(0)}</Text>
              </View>
              <View className="teacher-info">
                <Text className="teacher-name">{t.name}</Text>
                <Text className="teacher-detail">{[t.subject, t.phone].filter(Boolean).join(' · ') || '暂无信息'}</Text>
              </View>
              {t.hourly_rate && <Text className="teacher-rate">¥{t.hourly_rate}/时</Text>}
            </View>
          ))}
        </PullRefreshView>
      )}
    </View>
  );
}
