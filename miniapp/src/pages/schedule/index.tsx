import { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { Schedule, ScheduleStatus, Course } from '../../types';
import { getCachedList, setCachedList } from '../../utils/storage';
import { scheduleApi } from '../../utils/api';
import { NetworkStatus, EmptyState, LoadingSkeleton } from '../../components/shared';
import './index.scss';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

interface ScheduleWithCourse extends Schedule {
  course_name?: string;
  course_type?: number;
}

export default function SchedulePage() {
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedules, setSchedules] = useState<ScheduleWithCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadData();
  }, [currentDate]);

  const loadData = () => {
    const allSchedules = getCachedList<Schedule>('schedules');
    const courses = getCachedList<Course>('courses');

    const enriched: ScheduleWithCourse[] = allSchedules.map((s) => {
      const course = courses.find((c) => c.id === s.course_id);
      return { ...s, course_name: course?.display_name || course?.name || '未知课程', course_type: course?.type };
    });

    setSchedules(enriched);
    setLoading(false);
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await scheduleApi.getAll();
      if (res.success && res.data) {
        setCachedList('schedules', res.data);
        loadData();
      }
    } catch {
      loadData();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const weekRange = useMemo(() => {
    if (viewMode === 'day') return null;
    const day = currentDate.getDay();
    const monday = new Date(currentDate);
    monday.setDate(currentDate.getDate() - (day === 0 ? 6 : day - 1));
    monday.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return date;
    });
  }, [currentDate, viewMode]);

  const formatDate = (date: Date) => date.toISOString().split('T')[0];
  const formatTime = (time: string) => time.substring(11, 16);
  const isToday = (date: Date) => {
    const today = new Date();
    return date.getDate() === today.getDate()
      && date.getMonth() === today.getMonth()
      && date.getFullYear() === today.getFullYear();
  };

  const getCourseTypeLabel = (type?: number) => {
    const map: Record<number, string> = { 1: '一对一', 2: '一对二', 3: '小组课', 4: '大班课' };
    return map[type || 1] || '';
  };

  const getStatusClass = (status: ScheduleStatus) => {
    switch (status) {
      case ScheduleStatus.PLANNED: return 'status-planned';
      case ScheduleStatus.COMPLETED: return 'status-completed';
      case ScheduleStatus.CANCELLED: return 'status-cancelled';
      case ScheduleStatus.LEAVE: return 'status-leave';
      default: return 'status-planned';
    }
  };

  const getStatusLabel = (status: ScheduleStatus) => {
    const map: Record<number, string> = { 1: '待上课', 2: '已完成', 3: '已取消', 4: '请假' };
    return map[status] || '未知';
  };

  const navigateWeek = (dir: number) => {
    const date = new Date(currentDate);
    date.setDate(date.getDate() + dir * 7);
    setCurrentDate(date);
  };

  const getSchedulesForDate = (date: Date): ScheduleWithCourse[] => {
    const dateString = formatDate(date);
    return schedules.filter((schedule) => schedule.start_time?.startsWith(dateString));
  };

  const renderScheduleCard = (schedule: ScheduleWithCourse) => (
    <View
      key={schedule.id}
      className={`schedule-card ${getStatusClass(schedule.status)}`}
      onClick={() => Taro.navigateTo({ url: `/pages/schedule/detail/index?id=${schedule.id}` })}
    >
      <View className="schedule-time">
        <Text className="time-text">{formatTime(schedule.start_time)}</Text>
      </View>
      <View className="schedule-body">
        <Text className="schedule-course">{schedule.course_name}</Text>
        <Text className="schedule-sub">
          {getCourseTypeLabel(schedule.course_type)} · {getStatusLabel(schedule.status)}
        </Text>
        <Text className="schedule-note">{schedule.room || ''}</Text>
      </View>
    </View>
  );

  return (
    <View className="schedule-page">
      <NetworkStatus onRetry={handleRefresh} />

      <View className="view-toggle">
        <View className={`toggle-btn ${viewMode === 'week' ? 'active' : ''}`} onClick={() => setViewMode('week')}>
          <Text>周视图</Text>
        </View>
        <View className={`toggle-btn ${viewMode === 'day' ? 'active' : ''}`} onClick={() => setViewMode('day')}>
          <Text>日视图</Text>
        </View>
      </View>

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : viewMode === 'week' ? (
        <ScrollView
          className="week-view"
          scrollY
          refresherEnabled
          refresherTriggered={refreshing}
          onRefresherRefresh={handleRefresh}
          refresherBackground="#f5f5f5"
        >
          <View className="week-nav">
            <Text className="nav-arrow" onClick={() => navigateWeek(-1)}>‹</Text>
            <Text className="nav-title">
              {weekRange ? `${weekRange[0].getMonth() + 1}月${weekRange[0].getDate()}日 - ${weekRange[6].getMonth() + 1}月${weekRange[6].getDate()}日` : ''}
            </Text>
            <Text className="nav-arrow" onClick={() => navigateWeek(1)}>›</Text>
            <Text className="nav-today" onClick={() => setCurrentDate(new Date())}>今天</Text>
          </View>

          <View className="week-header">
            {weekRange?.map((date, index) => (
              <View key={index} className={`week-day ${isToday(date) ? 'today' : ''}`}>
                <Text className="day-name">{WEEKDAYS[index]}</Text>
                <Text className="day-num">{date.getDate()}</Text>
              </View>
            ))}
          </View>

          {weekRange?.map((date, index) => {
            const daySchedules = getSchedulesForDate(date);
            if (daySchedules.length === 0) return null;
            return (
              <View key={index} className="day-column">
                {daySchedules.map(renderScheduleCard)}
              </View>
            );
          })}

          {schedules.length === 0 && <EmptyState icon="📅" text="暂无排课数据" />}
        </ScrollView>
      ) : (
        <ScrollView
          className="day-view"
          scrollY
          refresherEnabled
          refresherTriggered={refreshing}
          onRefresherRefresh={handleRefresh}
          refresherBackground="#f5f5f5"
        >
          <View className="day-nav">
            <Text className="nav-arrow" onClick={() => { const date = new Date(currentDate); date.setDate(date.getDate() - 1); setCurrentDate(date); }}>‹</Text>
            <View className="day-title-wrap">
              <Text className="day-title-text">
                {currentDate.getMonth() + 1}月{currentDate.getDate()}日{isToday(currentDate) ? '（今天）' : ''}
              </Text>
            </View>
            <Text className="nav-arrow" onClick={() => { const date = new Date(currentDate); date.setDate(date.getDate() + 1); setCurrentDate(date); }}>›</Text>
            <Text className="nav-today" onClick={() => setCurrentDate(new Date())}>今天</Text>
          </View>

          {getSchedulesForDate(currentDate).map(renderScheduleCard)}

          {getSchedulesForDate(currentDate).length === 0 && (
            <EmptyState icon="📅" text="当天没有课程" />
          )}
        </ScrollView>
      )}
    </View>
  );
}
