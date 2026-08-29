import { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { Schedule, ScheduleStatus, Course, Student } from '../../types';
import { getCachedList } from '../../utils/storage';
import { pullFromCloudBusinessProjection } from '../../utils/sync';
import {
  shanghaiDateKey,
  shiftShanghaiDateKey,
  shanghaiWeekDateKeys,
  shanghaiDateParts,
} from '../../utils/cloudBusinessProjection';
import { NetworkStatus, EmptyState, LoadingSkeleton } from '../../components/shared';
import { isVisitorIdentity } from '../../utils/accountExperience';
import './index.scss';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

// ScheduleStatus: PLANNED=1, CANCELLED=3, LEAVE=4
const SCHEDULE_STATUS_CANCELLED = 3;
const SCHEDULE_STATUS_LEAVE = 4;

interface ScheduleWithCourse extends Schedule {
  course_name?: string;
  course_type?: number;
}

function displayStudentName(student: Student) {
  const name = String(student?.name || '').trim();
  return name && !/^e2e-/i.test(name) && !name.toLowerCase().includes('e2e-role-test-') ? name : '学生';
}

export default function SchedulePage() {
  const identity = Taro.getStorageSync('user_info');
  const isVisitor = isVisitorIdentity(identity);
  const isLimitedIdentity = isVisitor;
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week');
  const [currentDateKey, setCurrentDateKey] = useState(() => shanghaiDateKey(new Date()));
  const [schedules, setSchedules] = useState<ScheduleWithCourse[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void handleRefresh();
  }, [currentDateKey]);

  const loadData = () => {
    if (isLimitedIdentity) {
      setSchedules([]);
      setCourses([]);
      setStudents([]);
      setLoading(false);
      return;
    }
    const allSchedules = getCachedList<Schedule>('schedules');
    const cachedCourses = getCachedList<Course>('courses');
    const allStudents = getCachedList<Student>('students');

    const enriched: ScheduleWithCourse[] = allSchedules.map((s) => {
      const course = cachedCourses.find((c) => c.id === s.course_id);
      return { ...s, course_name: course?.display_name || course?.name || '未知课程', course_type: course?.type };
    });

    setSchedules(enriched);
    setCourses(cachedCourses);
    setStudents(allStudents);
    setLoading(false);
  };

  const handleRefresh = useCallback(async () => {
    if (isLimitedIdentity) {
      setSchedules([]);
      setCourses([]);
      setStudents([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    try {
      await pullFromCloudBusinessProjection();
      loadData();
    } catch {
      loadData();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const weekRange = useMemo(() => {
    if (viewMode === 'day') return null;
    return shanghaiWeekDateKeys(currentDateKey);
  }, [currentDateKey, viewMode]);
  const weekTitle = useMemo(() => {
    if (!weekRange) return '';
    const start = shanghaiDateParts(weekRange[0]);
    const end = shanghaiDateParts(weekRange[6]);
    return `${start.month}\u6708${start.day}\u65e5 - ${end.month}\u6708${end.day}\u65e5`;
  }, [weekRange]);
  const currentDateParts = useMemo(() => shanghaiDateParts(currentDateKey), [currentDateKey]);

  const formatTime = (time: string) => time.substring(11, 16);
  const isToday = (dateKey: string) => dateKey === shanghaiDateKey(new Date());

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
    setCurrentDateKey(current => shiftShanghaiDateKey(current, dir * 7));
  };

  const getSchedulesForDate = (dateKey: string): ScheduleWithCourse[] => {
    return schedules.filter((schedule) => {
      if (!schedule.start_time?.startsWith(dateKey)) return false;
      
      // 如果选中了学生，筛选该学生的课程，但排除请假和取消的
      if (selectedStudentId) {
        if (schedule.status === SCHEDULE_STATUS_CANCELLED || schedule.status === SCHEDULE_STATUS_LEAVE) {
          return false;
        }
        // 检查课程的学生列表
        const course = courses.find(c => c.id === schedule.course_id);
        const courseStudentIds = (course?.student_pricings || []).map(p => p.student_id);
        const scheduleStudentIds = schedule.student_ids || [];
        const allStudentIds = [...new Set([...courseStudentIds, ...scheduleStudentIds])];
        if (!allStudentIds.includes(selectedStudentId)) {
          return false;
        }
      }
      
      return true;
    });
  };
  const getDayTitle = (dateKey: string, index: number) => {
    const date = shanghaiDateParts(dateKey);
    return `\u5468${WEEKDAYS[index]} ${date.month}/${date.day}`;
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

  if (isLimitedIdentity) {
    return (
      <View className='schedule-page'>
        <EmptyState
          icon={'\u8bfe'}
          text={'\u6682\u65e0\u8bfe\u7a0b\u5b89\u6392'}
          actionText={'\u7533\u8bf7\u89d2\u8272'}
          onAction={() => Taro.navigateTo({ url: '/pages/account-application/index' })}
        />
      </View>
    );
  }

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

      {/* 学生筛选栏 */}
      {students.length > 0 && (
        <ScrollView scrollX className="filter-bar">
          <View
            className={`filter-tag ${!selectedStudentId ? 'active' : ''}`}
            onClick={() => setSelectedStudentId('')}
          >
            <Text>全部学生</Text>
          </View>
          {students.map(student => (
            <View
              key={student.id}
              className={`filter-tag ${selectedStudentId === student.id ? 'active' : ''}`}
              onClick={() => setSelectedStudentId(student.id)}
            >
              <Text>{displayStudentName(student)}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : viewMode === 'week' ? (
        <ScrollView
          className="week-view"
          scrollY
          refresherEnabled
          refresherTriggered={refreshing}
          onRefresherRefresh={handleRefresh}
          refresherBackground="#f7f4ee"
        >
          <View className="week-nav">
            <Text className="nav-arrow" onClick={() => navigateWeek(-1)}>‹</Text>
            <Text className="nav-title">
              {weekTitle}
            </Text>
            <Text className="nav-arrow" onClick={() => navigateWeek(1)}>›</Text>
            <Text className="nav-today" onClick={() => setCurrentDateKey(shanghaiDateKey(new Date()))}>今天</Text>
          </View>

          <View className="week-header">
            {weekRange?.map((dateKey, index) => (
              <View key={dateKey} className={`week-day ${isToday(dateKey) ? 'today' : ''}`}>
                <Text className="day-name">{WEEKDAYS[index]}</Text>
                <Text className="day-num">{shanghaiDateParts(dateKey).day}</Text>
              </View>
            ))}
          </View>

          <View className="week-grid">
            {weekRange?.map((dateKey, index) => {
              const daySchedules = getSchedulesForDate(dateKey);
              return (
                <View key={dateKey} className={`day-column ${daySchedules.length === 0 ? 'is-empty' : ''}`}>
                  <View className={`day-section-title ${isToday(dateKey) ? 'today' : ''}`}>
                    <Text>{getDayTitle(dateKey, index)}</Text>
                    <Text className="day-section-count">{daySchedules.length} {'\u8282'}</Text>
                  </View>
                  <View className="day-column-inner">
                    {daySchedules.length > 0 ? (
                      daySchedules.map(renderScheduleCard)
                    ) : (
                      <Text className="empty-day-text">{'\u6682\u65e0\u8bfe\u7a0b'}</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          {schedules.length === 0 && <EmptyState icon="课" text="暂无排课数据" />}
        </ScrollView>
      ) : (
        <ScrollView
          className="day-view"
          scrollY
          refresherEnabled
          refresherTriggered={refreshing}
          onRefresherRefresh={handleRefresh}
          refresherBackground="#f7f4ee"
        >
          <View className="day-nav">
            <Text className="nav-arrow" onClick={() => setCurrentDateKey(current => shiftShanghaiDateKey(current, -1))}>‹</Text>
            <View className="day-title-wrap">
              <Text className="day-title-text">
                {currentDateParts.month}{'\u6708'}{currentDateParts.day}{'\u65e5'}{isToday(currentDateKey) ? '\uff08\u4eca\u5929\uff09' : ''}
              </Text>
            </View>
            <Text className="nav-arrow" onClick={() => setCurrentDateKey(current => shiftShanghaiDateKey(current, 1))}>›</Text>
            <Text className="nav-today" onClick={() => setCurrentDateKey(shanghaiDateKey(new Date()))}>今天</Text>
          </View>

          <View className="day-column-inner">
            {getSchedulesForDate(currentDateKey).map(renderScheduleCard)}
          </View>

          {getSchedulesForDate(currentDateKey).length === 0 && (
            <EmptyState icon="课" text="当天没有课程" />
          )}
        </ScrollView>
      )}
    </View>
  );
}
