import { useState, useEffect, useRef } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useDidShow, useDidHide, usePullDownRefresh } from '@tarojs/taro';
import { Schedule, ScheduleStatus, Course } from '../../types';
import { getLocalData, pullFromCloudBusinessProjection } from '../../utils/sync';
import { canAccessMiniappPage, refreshMiniappPageAccess } from '../../utils/miniappPageAccess';
import { EmptyState, LoadingSkeleton } from '../../components/shared';
import ForbiddenPage from '../../components/ForbiddenContent';
import { authSessionRuntime } from '../../utils/authSession';
import './index.scss';

interface StatsData {
  totalRevenue: number;
  totalSchedules: number;
  byCourseType: { typeName: string; amount: number; count: number }[];
  byMonth: { month: string; amount: number; count: number }[];
}

export default function Stats() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestSequence = useRef(0);
  const resultSession = useRef<ReturnType<typeof authSessionRuntime.capture> | null>(null);
  const [courseTypeCollapsed, setCourseTypeCollapsed] = useState(false);
  const [monthCollapsed, setMonthCollapsed] = useState(false);

  const refresh = async () => {
    const sequence = ++requestSequence.current;
    const session = authSessionRuntime.capture();
    const isCurrent = () => sequence === requestSequence.current && authSessionRuntime.isSameSession(session);
    setStats(null);
    setLoading(true);
    setLoadFailed(false);
    try {
      if (!await refreshMiniappPageAccess('/pages/stats/index') || !isCurrent()) return;
      let refreshed = false;
      try {
        refreshed = await pullFromCloudBusinessProjection();
      } catch {
        // A failed refresh may show only this session's authorized saved data.
      }
      if (!isCurrent() || !canAccessMiniappPage('/pages/stats/index')) return;
      const schedules = getLocalData<Schedule>('schedules');
      const courses = getLocalData<Course>('courses');
      resultSession.current = session;
      setStats(refreshed || schedules.length > 0 || courses.length > 0 ? calculateStats(schedules, courses) : null);
      setLoadFailed(!refreshed);
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        void Taro.stopPullDownRefresh();
      }
    }
  };

  useDidShow(refresh);
  usePullDownRefresh(refresh);
  useDidHide(() => {
    requestSequence.current++;
    setStats(null);
    setLoading(true);
  });
  useEffect(() => () => { requestSequence.current++; }, []);

  const calculateStats = (schedules: Schedule[], courses: Course[]): StatsData => {

    const completed = schedules.filter((s) => s.status === ScheduleStatus.COMPLETED);

    let totalRevenue = 0;
    const byCourseType = new Map<number, { amount: number; count: number }>();
    const byMonth = new Map<string, { amount: number; count: number }>();

    completed.forEach((s) => {
      const tuition = s.calculated_tuition || 0;
      totalRevenue += tuition;

      const course = courses.find((c) => c.id === s.course_id);
      if (course) {
        const ct = byCourseType.get(course.type) || { amount: 0, count: 0 };
        ct.amount += tuition;
        ct.count += 1;
        byCourseType.set(course.type, ct);
      }

      const month = s.start_time.substring(0, 7);
      const mt = byMonth.get(month) || { amount: 0, count: 0 };
      mt.amount += tuition;
      mt.count += 1;
      byMonth.set(month, mt);
    });

    const typeNames: Record<number, string> = { 1: '一对一', 2: '一对二', 3: '小组课', 4: '大班课' };

    return {
      totalRevenue,
      totalSchedules: completed.length,
      byCourseType: Array.from(byCourseType.entries())
        .map(([type, v]) => ({ typeName: typeNames[type] || '未知', amount: v.amount, count: v.count }))
        .sort((a, b) => b.amount - a.amount),
      byMonth: Array.from(byMonth.entries())
        .map(([month, v]) => ({ month, amount: v.amount, count: v.count }))
        .sort((a, b) => b.month.localeCompare(a.month)),
    };
  };

  if (!canAccessMiniappPage('/pages/stats/index')) return <ForbiddenPage />;
  if (loading) return <View className='container'><LoadingSkeleton /></View>;
  if (!stats || resultSession.current === null || !authSessionRuntime.isSameSession(resultSession.current)) {
    return <View className='container'><EmptyState text='暂时无法读取统计数据' actionText='重试' onAction={refresh} /></View>;
  }

  return (
    <View className='container'>
      {loadFailed && <View className='stats-cache-notice'><Text>暂时无法更新，显示已保存的数据</Text></View>}
      {/* 总收入卡片 */}
      <View className='revenue-card'>
        <Text className='revenue-label'>累计收入</Text>
        <Text className='revenue-amount'>¥{stats.totalRevenue.toFixed(2)}</Text>
        <Text className='revenue-desc'>已完成 {stats.totalSchedules} 次课程</Text>
      </View>

      {/* 按课程类型 */}
      {stats.byCourseType.length > 0 && (
        <View className='card'>
          <View className='card-title' onClick={() => setCourseTypeCollapsed(!courseTypeCollapsed)}>
            <Text>按课程类型</Text>
            <Text className='collapse-icon'>{courseTypeCollapsed ? '›' : '⌄'}</Text>
          </View>
          {!courseTypeCollapsed && stats.byCourseType.map((ct, idx) => (
            <View key={idx} className='stat-row'>
              <Text className='stat-name'>{ct.typeName}</Text>
              <View className='stat-bar-wrap'>
                <View className='stat-bar' style={{ width: `${stats.totalRevenue > 0 ? (ct.amount / stats.totalRevenue * 100) : 0}%` }} />
              </View>
              <View className='stat-values'>
                <Text className='stat-amount'>¥{ct.amount.toFixed(0)}</Text>
                <Text className='stat-count'>{ct.count}次</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* 按月统计 */}
      {stats.byMonth.length > 0 && (
        <View className='card'>
          <View className='card-title' onClick={() => setMonthCollapsed(!monthCollapsed)}>
            <Text>按月统计</Text>
            <Text className='collapse-icon'>{monthCollapsed ? '›' : '⌄'}</Text>
          </View>
          {!monthCollapsed && stats.byMonth.map((m, idx) => (
            <View key={idx} className='stat-row'>
              <Text className='stat-name'>{m.month}</Text>
              <View className='stat-values' style={{ alignItems: 'flex-end' }}>
                <Text className='stat-amount'>¥{m.amount.toFixed(0)}</Text>
                <Text className='stat-count'>{m.count}次</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {stats.totalSchedules === 0 && (
        <View className='empty-state'>
          <Text className='empty-state-icon'>统</Text>
          <Text className='empty-state-text'>暂无完成课程数据</Text>
        </View>
      )}
    </View>
  );
}
