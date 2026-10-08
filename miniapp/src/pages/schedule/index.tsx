import { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useDidShow, useDidHide, usePullDownRefresh } from '@tarojs/taro';
import { Schedule, ScheduleStatus, Course } from '../../types';
import { getCachedList } from '../../utils/storage';
import { pullFromCloudBusinessProjection } from '../../utils/sync';
import {
  shanghaiDateKey,
  shiftShanghaiDateKey,
  shanghaiWeekDateKeys,
  shanghaiDateParts,
} from '../../utils/cloudBusinessProjection';
import { EmptyState, LoadingSkeleton } from '../../components/shared';
import ForbiddenPage from '../../components/ForbiddenContent';
import { authSessionRuntime } from '../../utils/authSession';
import { canAccessMiniappPage, refreshMiniappPageAccess } from '../../utils/miniappPageAccess';
import { isVisitorIdentity } from '../../utils/accountExperience';
import './index.scss';
// Both clients use the same location palette and contrast algorithm.
const { buildCourseColorMap, getTextColorForBackground, DEFAULT_COURSE_COLOR } = require('../../../../shared/courseColors');
const { holidays2026 } = require('../../../../shared/calendarHolidays');

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

const MIN_START_HOUR = 8;
const MAX_END_HOUR = 23;
const SLOT_DURATION = 5;
const SLOT_HEIGHT = 2.5;

interface ScheduleWithCourse extends Schedule {
  course_name?: string;
  course_type?: number;
  room_display?: string;
  card_background?: string;
  card_text_color?: string;
}

export default function SchedulePage() {
  const identity = authSessionRuntime.capture().identity;
  const isVisitor = isVisitorIdentity(identity);
  const isLimitedIdentity = isVisitor;
  const [currentDateKey, setCurrentDateKey] = useState(() => shanghaiDateKey(new Date()));
  const [schedules, setSchedules] = useState<ScheduleWithCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestSequence = useRef(0);
  const resultSession = useRef<ReturnType<typeof authSessionRuntime.capture> | null>(null);

  const loadData = () => {
    if (isLimitedIdentity) {
      setSchedules([]);
      setLoading(false);
      return;
    }
    const allSchedules = getCachedList<ScheduleWithCourse>('schedules');
    const cachedCourses = getCachedList<Course>('courses');
    const rooms = getCachedList<{ id: string; name: string }>('rooms');
    const colorMap = buildCourseColorMap(cachedCourses, rooms);
    // Match the desktop calendar's display derivation without changing cloud data.
    const normalizeRoom = (value?: string) => String(value || '').split(',').map(item => item.trim()).find(Boolean) || '';
    const resolveRoom = (schedule: ScheduleWithCourse, course?: Course) => {
      const room = normalizeRoom(course?.room_name ? course.room_name : schedule.room);
      const courseRoomId = normalizeRoom(course?.room_id);
      const courseRoomName = normalizeRoom(course?.room_name);
      if (room) {
        const match = rooms.find(item => item.id === room || item.name === room);
        if (match) return normalizeRoom(match.name);
        return room === courseRoomId && courseRoomName ? courseRoomName : room;
      }
      return courseRoomName || normalizeRoom(rooms.find(item => item.id === courseRoomId || item.name === courseRoomId)?.name || courseRoomId);
    };

    const enriched: ScheduleWithCourse[] = allSchedules.map((s) => {
      const course = cachedCourses.find((c) => c.id === s.course_id);
      // UTF-8: retain cloud-backed lesson labels after its course leaves the selector.
      const courseName = String(course?.display_name || '').trim() || String(course?.name || '').replace(/^\d{4}\s+\S+学期\s+/, '').trim() || String(s.course_name || '').trim();
      const background = colorMap[s.course_id] || DEFAULT_COURSE_COLOR;
      return { ...s, course_name: courseName || '未知课程', course_type: course?.type ?? s.course_type, room_display: resolveRoom(s, course), card_background: background, card_text_color: getTextColorForBackground(background) };
    });

    setSchedules(enriched);
    setLoading(false);
  };

  const handleRefresh = async () => {
    const sequence = ++requestSequence.current;
    const session = authSessionRuntime.capture();
    const isCurrent = () => sequence === requestSequence.current && authSessionRuntime.isSameSession(session);
    setSchedules([]);
    setLoading(true); setLoadFailed(false);
    setRefreshing(true);
    try {
      if (isVisitorIdentity(session.identity) || !await refreshMiniappPageAccess('/pages/schedule/index') || !isCurrent()) return;
      let refreshed = false;
      try { refreshed = await pullFromCloudBusinessProjection(); } catch { /* Authorized cache below. */ }
      if (!isCurrent() || !canAccessMiniappPage('/pages/schedule/index')) return;
      loadData();
      resultSession.current = session;
      setLoadFailed(!refreshed);
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false); setRefreshing(false);
        void Taro.stopPullDownRefresh();
      }
    }
  };

  useDidShow(handleRefresh);
  usePullDownRefresh(handleRefresh);
  useDidHide(() => { requestSequence.current++; setSchedules([]); setLoading(true); });
  useEffect(() => () => { requestSequence.current++; }, []);

  const weekRange = useMemo(() => shanghaiWeekDateKeys(currentDateKey), [currentDateKey]);
  const weekRows = [weekRange, shanghaiWeekDateKeys(shiftShanghaiDateKey(currentDateKey, 7))];

  const formatTime = (time?: string) => String(time || '').substring(11, 16);
  const isToday = (dateKey: string) => dateKey === shanghaiDateKey(new Date());

  const getStatusClass = (status: ScheduleStatus) => {
    switch (status) {
      case ScheduleStatus.PLANNED: return 'status-planned';
      case ScheduleStatus.COMPLETED: return 'status-completed';
      case ScheduleStatus.CANCELLED: return 'status-cancelled';
      case ScheduleStatus.LEAVE: return 'status-leave';
      default: return 'status-planned';
    }
  };

  const navigateWeek = (dir: number) => {
    setCurrentDateKey(current => shiftShanghaiDateKey(current, dir * 7));
  };

  const getSchedulesForDate = (dateKey: string) => schedules.filter(schedule => schedule.start_time?.startsWith(dateKey));
  const minuteOfDay = (time?: string) => {
    const clock = formatTime(time);
    return /^\d{2}:\d{2}$/.test(clock) ? Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3)) : null;
  };
  const timeToSlot = (minutes: number) => Math.floor((minutes - MIN_START_HOUR * 60) / SLOT_DURATION);
  const getWeekHours = (dates: readonly string[]) => {
    let minHour = MIN_START_HOUR, maxHour = MAX_END_HOUR;
    for (const schedule of schedules) {
      if (!dates.includes(schedule.start_time?.slice(0, 10)) || [3, 4].includes(schedule.status)) continue;
      const start = minuteOfDay(schedule.start_time), end = minuteOfDay(schedule.end_time);
      if (start !== null && start / 60 < minHour) minHour = Math.floor(start / 60);
      if (end !== null && end / 60 > maxHour) maxHour = Math.ceil(end / 60);
    }
    return { minHour, maxHour };
  };
  const getPosition = (schedule: ScheduleWithCourse, minStartSlot: number) => {
    const start = minuteOfDay(schedule.start_time), end = minuteOfDay(schedule.end_time);
    if (start === null || end === null || end <= start) return null;
    return { top: (timeToSlot(start) - minStartSlot) * SLOT_HEIGHT, height: (timeToSlot(end) - timeToSlot(start)) * SLOT_HEIGHT };
  };

  const renderScheduleCard = (schedule: ScheduleWithCourse, position?: { top: number; height: number } | null) => (
    <View
      key={schedule.id}
      className={`schedule-card ${getStatusClass(schedule.status)}`}
      // Desktop's final settled JSX overrides status opacity/border after its status helper.
      style={{ background: schedule.card_background, opacity: 1, position: position ? 'absolute' : 'relative', top: position ? `${position.top}px` : undefined, height: position ? `${position.height}px` : 'auto', minHeight: '24px', left: position ? '4px' : undefined, right: position ? '4px' : undefined, zIndex: 10 }}
      onClick={() => Taro.navigateTo({ url: `/pages/schedule/detail/index?id=${schedule.id}` })}
    >
      <View className="schedule-body">
        <Text className="schedule-course" style={{ color: schedule.card_text_color }}>{schedule.course_name}</Text>
        <View className="schedule-location-time" style={{ color: schedule.card_text_color }}>
          {schedule.room_display && <Text className="schedule-place">{`${schedule.room_display} `}</Text>}
          <Text className="schedule-time-range">{[formatTime(schedule.start_time), formatTime(schedule.end_time)].filter(Boolean).join('-')}</Text>
        </View>
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

  if (!canAccessMiniappPage('/pages/schedule/index')) return <ForbiddenPage />;
  if (resultSession.current !== null && !authSessionRuntime.isSameSession(resultSession.current)) {
    return <View className='schedule-page'><LoadingSkeleton /></View>;
  }
  // UTF-8: Do not represent an unavailable uncached projection as an empty week.
  if (!loading && loadFailed && schedules.length === 0) {
    return <View className='schedule-page'><EmptyState text='暂时无法读取课表' actionText='重试' onAction={handleRefresh} /></View>;
  }

  return (
    <View className="schedule-page">
      {loadFailed && <View className='teaching-cache-notice'><Text>暂时无法更新，显示已保存的数据</Text></View>}



      <View className="schedule-toolbar">
        <View className="nav-arrow" onClick={() => navigateWeek(-1)}><Text>上一周</Text></View>
        <View className="nav-today" onClick={() => setCurrentDateKey(shanghaiDateKey(new Date()))}><Text>本周</Text></View>
        <View className="nav-arrow" onClick={() => navigateWeek(1)}><Text>下一周</Text></View>
      </View>

      {loading ? <LoadingSkeleton rows={5} /> : (
        <ScrollView className="week-view" scrollX scrollY enableFlex refresherEnabled
          refresherTriggered={refreshing} onRefresherRefresh={handleRefresh} refresherBackground="#fff">
          <View className="calendar-board">
            {weekRows.map((dates) => {
              const { minHour, maxHour } = getWeekHours(dates);
              const minStartSlot = timeToSlot(minHour * 60);
              return (
                <View className="week-grid" key={dates[0]}>
                  {dates.map((dateKey, index) => {
                    const daySchedules = getSchedulesForDate(dateKey);
                    let maxEndSlot = timeToSlot(maxHour * 60);
                    for (const schedule of daySchedules) {
                      const end = minuteOfDay(schedule.end_time);
                      if (end !== null) maxEndSlot = Math.max(maxEndSlot, timeToSlot(end) + 1);
                    }
                    const bodyHeight = Math.max(SLOT_HEIGHT, (maxEndSlot - minStartSlot) * SLOT_HEIGHT);
                    const date = shanghaiDateParts(dateKey);
                    const holiday = holidays2026.find((item: { start: string; end: string }) => dateKey >= item.start && dateKey <= item.end);
                    const unplaced = daySchedules.filter(schedule => !getPosition(schedule, minStartSlot));
                    return (
                      <View key={dateKey} data-date={dateKey} className={`day-column ${isToday(dateKey) ? 'today' : ''} ${holiday ? 'holiday' : ''}`}>
                        <View className="day-section-title">
                          <Text className="day-name">{`周${WEEKDAYS[index]}${holiday ? ` (${holiday.name})` : ''}`}</Text>
                          <Text className="day-date">{`${date.month}月${date.day}日`}</Text>
                        </View>
                        <View className="day-grid-body" data-min-start-slot={minStartSlot} style={{ height: `${bodyHeight}px` }}>
                          {Array.from({ length: Math.ceil((maxEndSlot - minStartSlot) / 12) + 1 }, (_, lineIndex) => lineIndex * 30).filter(top => top <= bodyHeight).map(top => (
                            <View key={top} className="hour-grid-line" style={{ top: `${top}px` }} />
                          ))}
                          <View className="hour-grid-line grid-bottom-line" style={{ top: `${bodyHeight - 1}px` }} />
                          {daySchedules.map(schedule => {
                            const position = getPosition(schedule, minStartSlot);
                            return position ? renderScheduleCard(schedule, position) : null;
                          })}
                        </View>
                        {unplaced.length > 0 && <View className="schedule-unplaced">{unplaced.map(schedule => renderScheduleCard(schedule))}</View>}
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
