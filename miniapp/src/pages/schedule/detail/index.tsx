/**
 * 排课详情 v1
 */
import { useState, useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { Schedule, ScheduleStatus, Course, Student, Teacher } from '../../../types';
import { getLocalItem, getLocalData, updateLocalItem } from '../../../utils/sync';
import { addPendingChange } from '../../../utils/storage';
import { scheduleApi } from '../../../utils/api';
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
    const s = getLocalItem<Schedule>('schedules', id);
    if (!s) return;

    setSchedule(s);
    const allCourses = getLocalData<Course>('courses');
    setCourse(allCourses.find(c => c.id === s.course_id) || null);

    const allStudents = getLocalData<Student>('students');
    const enrolled = allStudents.filter(st => s.student_ids?.includes(st.id));
    setStudents(enrolled);
  };

  const changeStatus = (newStatus: ScheduleStatus) => {
    if (!schedule) return;
    Taro.showModal({
      title: '确认操作',
      content: `将课程状态改为「${STATUS_MAP[newStatus]?.label}」？`,
      success: (res) => {
        if (!res.confirm) return;
        const updated: Schedule = { ...schedule, status: newStatus, updated_at: new Date().toISOString() };
        updateLocalItem('schedules', updated);
        addPendingChange({ id: updated.id, table: 'schedules', action: 'update', data: updated, timestamp: Date.now() });
        setSchedule(updated);
        Taro.showToast({ title: '状态已更新', icon: 'success' });
      },
    });
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
  const formatTime = (t: string) => {
    const d = new Date(t);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <View className="sd-container">
      {/* 状态顶栏 */}
      <View className="sd-status-bar" style={{ background: status.color }}>
        <Text className="sd-status-label">{status.label}</Text>
      </View>

      {/* 课程基本信息 */}
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

      {/* 费用信息 */}
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

      {/* 学生列表 */}
      <View className="card" style={{ marginTop: 16 }}>
        <Text className="sd-section-title">参与学生 ({students.length})</Text>
        {students.length === 0 ? (
          <Text className="sd-empty-text">暂无</Text>
        ) : (
          students.map(st => (
            <View key={st.id} className="sd-student-row" onClick={() => Taro.navigateTo({ url: `/pages/student-detail/index?id=${st.id}` })}>
              <View className="sd-student-avatar"><Text>{st.name.charAt(0)}</Text></View>
              <View className="sd-student-info">
                <Text className="sd-student-name">{st.name}</Text>
                <Text className="sd-student-detail">{st.school || ''} {st.grade_current || ''}</Text>
              </View>
              <Text className="sd-arrow">›</Text>
            </View>
          ))
        )}
      </View>

      {/* 备注 */}
      {schedule.notes && (
        <View className="card" style={{ marginTop: 16 }}>
          <Text className="sd-section-title">备注</Text>
          <Text className="sd-notes-text">{schedule.notes}</Text>
        </View>
      )}

      {/* 操作按钮 */}
      <View className="sd-actions">
        {schedule.status === ScheduleStatus.PLANNED && (
          <>
            <View className="sd-action-btn complete" onClick={() => changeStatus(ScheduleStatus.COMPLETED)}>
              <Text>标记完成</Text>
            </View>
            <View className="sd-action-btn cancel" onClick={() => changeStatus(ScheduleStatus.CANCELLED)}>
              <Text>取消课程</Text>
            </View>
          </>
        )}
        {schedule.status === ScheduleStatus.COMPLETED && (
          <View className="sd-action-btn reopen" onClick={() => changeStatus(ScheduleStatus.PLANNED)}>
            <Text>重新打开</Text>
          </View>
        )}
      </View>
    </View>
  );
}
