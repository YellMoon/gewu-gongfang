import { useState, useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { Schedule, ScheduleStatus, Course, Student } from '../../../types';
import { getLocalItem, getLocalData } from '../../../utils/sync';
import './detail.scss';

const STATUS_MAP: Record<number, { label: string; color: string }> = {
  [ScheduleStatus.PLANNED]: { label: '待上课', color: '#1890ff' },
  [ScheduleStatus.COMPLETED]: { label: '已完成', color: '#52c41a' },
  [ScheduleStatus.CANCELLED]: { label: '已取消', color: '#ff4d4f' },
  [ScheduleStatus.LEAVE]: { label: '请假', color: '#fa8c16' },
};

const TYPE_LABELS: Record<number, string> = { 1: '一对一', 2: '一对二', 3: '小组课', 4: '大班课' };

export default function ScheduleDetail() {
  const router = useRouter();
  const { id } = router.params;
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [students, setStudents] = useState<Student[]>([]);

  useEffect(() => {
    if (id) loadDetail();
  }, [id]);

  const loadDetail = () => {
    const scheduleItem = getLocalItem<Schedule>('schedules', id);
    if (!scheduleItem) return;

    setSchedule(scheduleItem);
    const allCourses = getLocalData<Course>('courses');
    setCourse(allCourses.find(courseItem => courseItem.id === scheduleItem.course_id) || null);

    const allStudents = getLocalData<Student>('students');
    const enrolled = allStudents.filter(student => scheduleItem.student_ids?.includes(student.id));
    setStudents(enrolled);
  };

  if (!schedule) {
    return (
      <View className="container">
        <View className="empty-state">
          <Text className="empty-state-icon">📅</Text>
          <Text className="empty-state-text">未找到排课记录</Text>
        </View>
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
      <View className="sd-status-bar" style={{ background: status.color }}>
        <Text className="sd-status-label">{status.label}</Text>
      </View>

      <View className="card">
        <Text className="sd-course-name">{course?.display_name || course?.name || '未知课程'}</Text>
        <View className="sd-tags">
          <Text className="sd-tag">{TYPE_LABELS[course?.type || 1]}</Text>
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

      <View className="card" style={{ marginTop: 16 }}>
        <Text className="sd-section-title">费用信息</Text>
        <View className="sd-cost-row">
          <Text className="sd-cost-label">课时费</Text>
          <Text className="sd-cost-value">¥{schedule.calculated_tuition || 0}</Text>
        </View>
        <View className="sd-cost-row">
          <Text className="sd-cost-label">教师费</Text>
          <Text className="sd-cost-value" style={{ color: '#ff4d4f' }}>¥{schedule.calculated_teacher_fee || 0}</Text>
        </View>
      </View>

      <View className="card" style={{ marginTop: 16 }}>
        <Text className="sd-section-title">参与学生 ({students.length})</Text>
        {students.length === 0 ? (
          <Text className="sd-empty-text">暂无</Text>
        ) : (
          students.map(student => (
            <View key={student.id} className="sd-student-row" onClick={() => Taro.navigateTo({ url: `/pages/student-detail/index?id=${student.id}` })}>
              <View className="sd-student-avatar"><Text>{student.name.charAt(0)}</Text></View>
              <View className="sd-student-info">
                <Text className="sd-student-name">{student.name}</Text>
                <Text className="sd-student-detail">{student.school || ''} {student.grade_current || ''}</Text>
              </View>
              <Text className="sd-arrow">›</Text>
            </View>
          ))
        )}
      </View>

      {schedule.notes && (
        <View className="card" style={{ marginTop: 16 }}>
          <Text className="sd-section-title">备注</Text>
          <Text className="sd-notes-text">{schedule.notes}</Text>
        </View>
      )}
    </View>
  );
}
