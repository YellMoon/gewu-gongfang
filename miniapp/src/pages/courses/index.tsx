/**
 * 课程管理 v2 — 筛选 + 下拉刷新 + 完整信息展示
 */
import { useState } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { Course, CourseType } from '../../types';
import { setCachedList } from '../../utils/storage';
import { courseApi } from '../../utils/api';
import { getLocalData } from '../../utils/sync';
import { NetworkStatus, EmptyState, LoadingSkeleton } from '../../components/shared';
import './index.scss';

const TYPE_LABELS: Record<number, string> = { 1: '一对一', 2: '一对二', 3: '小组课', 4: '大班课' };
const SOURCE_LABELS: Record<number, string> = { 1: '自有', 2: '机构', 3: '混合' };

export default function Courses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [filter, setFilter] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useDidShow(() => { loadCourses(); });

  const loadCourses = () => {
    setCourses(getLocalData<Course>('courses'));
    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await courseApi.getAll();
      if (res.success && res.data) {
        setCachedList('courses', res.data);
        setCourses(res.data);
      }
    } catch { loadCourses(); }
    finally { setRefreshing(false); }
  };

  const filteredCourses = filter === 0 ? courses : courses.filter(c => c.type === filter);
  const activeCourses = filteredCourses.filter(c => c.active);
  const inactiveCourses = filteredCourses.filter(c => !c.active);

  return (
    <View className="courses-page">
      <NetworkStatus onRetry={handleRefresh} />

      {/* 筛选栏 */}
      <ScrollView scrollX className="filter-bar">
        {[{ k: 0, v: '全部' }, { k: 1, v: '一对一' }, { k: 2, v: '一对二' }, { k: 3, v: '小组课' }, { k: 4, v: '大班课' }].map(f => (
          <View key={f.k} className={`filter-tag ${filter === f.k ? 'active' : ''}`} onClick={() => setFilter(f.k)}>
            <Text>{f.v}</Text>
          </View>
        ))}
      </ScrollView>

      {loading ? <LoadingSkeleton rows={4} /> : filteredCourses.length === 0 ? (
        <EmptyState icon="📚" text="暂无课程" />
      ) : (
        <ScrollView
          className="course-list"
          scrollY
          refresherEnabled
          refresherTriggered={refreshing}
          onRefresherRefresh={handleRefresh}
          refresherBackground="#f5f5f5"
        >
          {/* 进行中 */}
          {activeCourses.length > 0 && (
            <View className="course-section">
              <Text className="section-label">进行中 ({activeCourses.length})</Text>
              {activeCourses.map(c => (
                <View key={c.id} className="course-card">
                  <View className="course-header">
                    <Text className="course-name">{c.display_name || c.name}</Text>
                    <Text className="course-type-tag">{TYPE_LABELS[c.type]}</Text>
                  </View>
                  <View className="course-meta">
                    <Text className="meta-item">来源: {SOURCE_LABELS[c.source_type] || '未知'}</Text>
                    {c.teacher_name && <Text className="meta-item">老师: {c.teacher_name}</Text>}
                    {c.room_name && <Text className="meta-item">教室: {c.room_name}</Text>}
                  </View>
                  <View className="course-price">
                    <Text className="price-tuition">学费 ¥{c.price_tuition}/{c.billing_unit === 1 ? '时' : '次'}</Text>
                    <Text className="price-teacher">师费 ¥{c.price_teacher}/{c.billing_unit === 1 ? '时' : '次'}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* 已结课 */}
          {inactiveCourses.length > 0 && (
            <View className="course-section">
              <Text className="section-label inactive">已结课 ({inactiveCourses.length})</Text>
              {inactiveCourses.map(c => (
                <View key={c.id} className="course-card inactive">
                  <View className="course-header">
                    <Text className="course-name">{c.display_name || c.name}</Text>
                    <Text className="course-type-tag">{TYPE_LABELS[c.type]}</Text>
                  </View>
                  <View className="course-meta">
                    <Text className="meta-item">{SOURCE_LABELS[c.source_type] || ''} {c.teacher_name ? `· ${c.teacher_name}` : ''}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
