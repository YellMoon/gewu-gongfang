import { useState, useEffect, useRef } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useRouter, useDidShow, useDidHide, usePullDownRefresh } from '@tarojs/taro';
import { Schedule, ScheduleStatus, Course, Student } from '../../../types';
import { getLocalItem, getLocalData, pullFromCloudBusinessProjection } from '../../../utils/sync';
import { isStudentScopedUser } from '../../../utils/permission';
import { EmptyState, LoadingSkeleton } from '../../../components/shared';
import ForbiddenPage from '../../../components/ForbiddenContent';
import { authSessionRuntime } from '../../../utils/authSession';
import { isVisitorIdentity } from '../../../utils/accountExperience';
import { canAccessMiniappPage, refreshMiniappPageAccess } from '../../../utils/miniappPageAccess';
import { studentSchoolLabel, studentGradeLabel } from '../../../utils/studentDisplay';
import './detail.scss';

const STATUS_MAP: Record<number, { label: string; color: string }> = {
  [ScheduleStatus.PLANNED]: { label: '待上课', color: '#1f6f68' },
  [ScheduleStatus.COMPLETED]: { label: '已完成', color: '#28784f' },
  [ScheduleStatus.CANCELLED]: { label: '已取消', color: '#c94f3d' },
  [ScheduleStatus.LEAVE]: { label: '请假', color: '#b46f3a' },
};

const TYPE_LABELS: Record<number, string> = { 1: '一对一', 2: '一对二', 3: '小组课', 4: '大班课' };

// UTF-8: Existing projection snapshot fields survive removal from course selectors.
type ScheduleWithCourseSnapshot = Schedule & { course_name?: string; course_type?: number };

export default function ScheduleDetail() {
  const router = useRouter();
  const isStudent = isStudentScopedUser();
  const { id } = router.params;
  const [schedule, setSchedule] = useState<ScheduleWithCourseSnapshot | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestSequence = useRef(0);
  const resultSession = useRef<ReturnType<typeof authSessionRuntime.capture> | null>(null);

  const handleRefresh = async () => {
    const sequence = ++requestSequence.current;
    const session = authSessionRuntime.capture();
    const isCurrent = () => sequence === requestSequence.current && authSessionRuntime.isSameSession(session);
    setSchedule(null); setCourse(null); setStudents([]);
    setLoading(true); setLoadFailed(false);
    try {
      if (!id || isVisitorIdentity(session.identity) || !await refreshMiniappPageAccess('/pages/schedule/detail/index') || !isCurrent()) return;
      let refreshed = false;
      try { refreshed = await pullFromCloudBusinessProjection(); } catch { /* Authorized cache below. */ }
      if (!isCurrent() || !canAccessMiniappPage('/pages/schedule/detail/index')) return;
      loadDetail();
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
  useDidHide(() => { requestSequence.current++; setSchedule(null); setCourse(null); setStudents([]); setLoading(true); });
  useEffect(() => () => { requestSequence.current++; }, []);

  const loadDetail = () => {
    const scheduleItem = getLocalItem<ScheduleWithCourseSnapshot>('schedules', id);
    if (!scheduleItem) return;

    setSchedule(scheduleItem);
    const allCourses = getLocalData<Course>('courses');
    setCourse(allCourses.find(courseItem => courseItem.id === scheduleItem.course_id) || null);

    const allStudents = getLocalData<Student>('students');
    const enrolled = allStudents.filter(student => scheduleItem.student_ids?.includes(student.id));
    setStudents(enrolled);
  };

  if (isVisitorIdentity(authSessionRuntime.capture().identity) || !canAccessMiniappPage('/pages/schedule/detail/index')) return <ForbiddenPage />;
  if (loading || (resultSession.current !== null && !authSessionRuntime.isSameSession(resultSession.current))) {
    return <View className='sd-container'><LoadingSkeleton rows={3} /></View>;
  }
  if (!schedule && loadFailed) {
    return <View className='sd-container'><EmptyState text='暂时无法读取排课详情' actionText='重试' onAction={handleRefresh} /></View>;
  }
  if (!schedule) {
    return (
      <View className="container">
        <EmptyState icon='课' text='未找到排课记录' />
      </View>
    );
  }

  const status = STATUS_MAP[schedule.status] || { label: '未知', color: '#999' };
  const formatTime = (time: string) => {
    const date = new Date(time);
    return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <View className="sd-container">
      {loadFailed && <View className='teaching-cache-notice'><Text>暂时无法更新，显示已保存的数据</Text></View>}
      <View className="sd-status-bar" style={{ background: status.color }}>
        <Text className="sd-status-label">{status.label}</Text>
      </View>

      <View className="card">
        <Text className="sd-course-name">{course?.display_name || course?.name || schedule.course_name || '未知课程'}</Text>
        <View className="sd-tags">
          <Text className="sd-tag">{TYPE_LABELS[course?.type || schedule.course_type || 1]}</Text>
          {schedule.room && <Text className="sd-tag">{schedule.room}</Text>}
        </View>
        <View className="sd-time-row">
          <View className="sd-time-item">
            <Text className="sd-time-label">开始时间</Text>
            <Text className="sd-time-value">{formatTime(schedule.start_time)}</Text>
          </View>
          <View className="sd-time-item">
            <Text className="sd-time-label">结束时间</Text>
            <Text className="sd-time-value">{formatTime(schedule.end_time)}</Text>
          </View>
        </View>
      </View>

      {!isStudent && <View className="card sd-card-gap">
        <Text className="sd-section-title">费用信息</Text>
        <View className="sd-cost-row">
          <Text className="sd-cost-label">课时费</Text>
          <Text className="sd-cost-value">¥{schedule.calculated_tuition || 0}</Text>
        </View>
        <View className="sd-cost-row">
          <Text className="sd-cost-label">教师费</Text>
          <Text className="sd-cost-value sd-cost-value--expense">¥{schedule.calculated_teacher_fee || 0}</Text>
        </View>
      </View>
}
      <View className="card sd-card-gap">
        <Text className="sd-section-title">参与学生 ({students.length})</Text>
        {students.length === 0 ? (
          <Text className="sd-empty-text">暂无</Text>
        ) : (
          students.map(student => (
            <View key={student.id} className="sd-student-row" onClick={() => Taro.navigateTo({ url: `/pages/student-detail/index?id=${student.id}` })}>
              <View className="sd-student-avatar"><Text>{student.name.charAt(0)}</Text></View>
              <View className="sd-student-info">
                <Text className="sd-student-name">{student.name}</Text>
                <Text className="sd-student-detail">{studentSchoolLabel(student.school)} {studentGradeLabel(student)}</Text>
              </View>
              <Text className="sd-arrow">›</Text>
            </View>
          ))
        )}
      </View>

      {schedule.notes && (
        <View className="card sd-card-gap">
          <Text className="sd-section-title">备注</Text>
          <Text className="sd-notes-text">{schedule.notes}</Text>
        </View>
      )}
    </View>
  );
}
