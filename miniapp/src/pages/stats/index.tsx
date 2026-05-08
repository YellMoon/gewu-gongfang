import { useState, useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import { Schedule, ScheduleStatus, Course, CourseType } from '../../types';
import { getLocalData } from '../../utils/sync';
import './index.scss';

interface StatsData {
  totalRevenue: number;
  totalSchedules: number;
  byCourseType: { typeName: string; amount: number; count: number }[];
  byMonth: { month: string; amount: number; count: number }[];
}

export default function Stats() {
  const [stats, setStats] = useState<StatsData>({
    totalRevenue: 0,
    totalSchedules: 0,
    byCourseType: [],
    byMonth: [],
  });

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = () => {
    const schedules = getLocalData<Schedule>('schedules');
    const courses = getLocalData<Course>('courses');

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

    setStats({
      totalRevenue,
      totalSchedules: completed.length,
      byCourseType: Array.from(byCourseType.entries())
        .map(([type, v]) => ({ typeName: typeNames[type] || '未知', amount: v.amount, count: v.count }))
        .sort((a, b) => b.amount - a.amount),
      byMonth: Array.from(byMonth.entries())
        .map(([month, v]) => ({ month, amount: v.amount, count: v.count }))
        .sort((a, b) => b.month.localeCompare(a.month)),
    });
  };

  return (
    <View className='container'>
      {/* 总收入卡片 */}
      <View className='revenue-card'>
        <Text className='revenue-label'>累计收入</Text>
        <Text className='revenue-amount'>¥{stats.totalRevenue.toFixed(2)}</Text>
        <Text className='revenue-desc'>已完成 {stats.totalSchedules} 次课程</Text>
      </View>

      {/* 按课程类型 */}
      {stats.byCourseType.length > 0 && (
        <View className='card'>
          <View className='card-title'><Text>按课程类型</Text></View>
          {stats.byCourseType.map((ct, idx) => (
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
          <View className='card-title'><Text>按月统计</Text></View>
          {stats.byMonth.map((m, idx) => (
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
          <Text className='empty-state-icon'>📊</Text>
          <Text className='empty-state-text'>暂无完成课程数据</Text>
        </View>
      )}
    </View>
  );
}
