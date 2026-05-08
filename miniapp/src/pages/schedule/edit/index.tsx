/**
 * 新建/编辑排课表单 v1
 */
import { useState, useEffect } from 'react';
import { View, Text, Input, Picker, Textarea } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { Course, Schedule, ScheduleStatus, Student } from '../../../types';
import { getLocalData, getLocalItem, updateLocalItem, addLocalItem } from '../../../utils/sync';
import { addPendingChange } from '../../../utils/storage';
import { scheduleApi } from '../../../utils/api';
import './edit.scss';

interface FormData {
  course_id: string;
  start_date: string;
  start_hour: string;
  start_min: string;
  duration: string;
  room: string;
  notes: string;
  student_ids: string[];
}

export default function ScheduleEdit() {
  const router = useRouter();
  const { id } = router.params;
  const isEditing = !!id;

  const [courses, setCourses] = useState<Course[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<Student[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showStudentPicker, setShowStudentPicker] = useState(false);

  const [form, setForm] = useState<FormData>({
    course_id: '',
    start_date: new Date().toISOString().split('T')[0],
    start_hour: '09',
    start_min: '00',
    duration: '90',
    room: '',
    notes: '',
    student_ids: [],
  });

  useEffect(() => {
    const allCourses = getLocalData<Course>('courses');
    const allSt = getLocalData<Student>('students');
    setCourses(allCourses);
    setAllStudents(allSt);

    if (isEditing && id) {
      const s = getLocalItem<Schedule>('schedules', id);
      if (s) {
        setForm({
          course_id: s.course_id,
          start_date: s.start_time.split('T')[0],
          start_hour: s.start_time.substring(11, 13),
          start_min: s.start_time.substring(14, 16),
          duration: String(Math.round((new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 60000)),
          room: s.room || '',
          notes: s.notes || '',
          student_ids: s.student_ids || [],
        });
        setSelectedStudents(allSt.filter(st => s.student_ids?.includes(st.id)));
      }
    }
  }, [id]);

  const toggleStudent = (st: Student) => {
    const exists = selectedStudents.find(s => s.id === st.id);
    if (exists) {
      setSelectedStudents(selectedStudents.filter(s => s.id !== st.id));
      setForm(f => ({ ...f, student_ids: f.student_ids.filter(sid => sid !== st.id) }));
    } else {
      setSelectedStudents([...selectedStudents, st]);
      setForm(f => ({ ...f, student_ids: [...f.student_ids, st.id] }));
    }
  };

  const selectedCourse = courses.find(c => c.id === form.course_id);
  const availableStudents = allStudents.filter(st => {
    // 如果有学生定价，过滤出该课程的学生
    if (selectedCourse?.student_pricings && selectedCourse.student_pricings.length > 0) {
      return selectedCourse.student_pricings.some(sp => sp.student_id === st.id);
    }
    return true;
  });

  const handleSubmit = async () => {
    if (!form.course_id) {
      Taro.showToast({ title: '请选择课程', icon: 'none' });
      return;
    }
    if (selectedStudents.length === 0) {
      Taro.showToast({ title: '请选择学生', icon: 'none' });
      return;
    }

    setSubmitting(true);
    try {
      const startTime = `${form.start_date}T${form.start_hour.padStart(2, '0')}:${form.start_min.padStart(2, '0')}:00`;
      const endTime = new Date(new Date(startTime).getTime() + parseInt(form.duration) * 60000).toISOString();

      const now = new Date().toISOString();
      const data: Schedule = {
        id: id || `local_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`,
        course_id: form.course_id,
        start_time: startTime,
        end_time: endTime,
        status: ScheduleStatus.PLANNED,
        room: form.room || undefined,
        student_ids: form.student_ids,
        notes: form.notes || undefined,
        created_at: now,
        updated_at: now,
      };

      if (isEditing && id) {
        updateLocalItem('schedules', data);
        await scheduleApi.update(id, data).catch(() => {});
        addPendingChange({ id, table: 'schedules', action: 'update', data, timestamp: Date.now() });
      } else {
        addLocalItem('schedules', data);
        await scheduleApi.create(data).catch(() => {});
        addPendingChange({ id: data.id, table: 'schedules', action: 'create', data, timestamp: Date.now() });
      }

      Taro.showToast({ title: isEditing ? '已更新' : '已创建', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 800);
    } catch (err) {
      Taro.showToast({ title: '操作失败', icon: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // 日期选择

  return (
    <View className="se-container">
      {/* 课程选择 */}
      <View className="se-field">
        <Text className="se-label">课程 *</Text>
        <Picker
          mode="selector"
          range={courses.map(c => c.display_name || c.name)}
          value={courses.findIndex(c => c.id === form.course_id)}
          onChange={(e) => {
            const idx = Number(e.detail.value as string);
            if (idx >= 0) {
              setForm(f => ({ ...f, course_id: courses[idx].id, student_ids: [], room: courses[idx].room_name || f.room }));
              setSelectedStudents([]);
            }
          }}
        >
          <View className={`se-value ${!form.course_id ? 'placeholder' : ''}`}>
            <Text>{form.course_id ? (courses.find(c => c.id === form.course_id)?.display_name || '已选课程') : '请选择课程'}</Text>
            <Text className="se-arrow">›</Text>
          </View>
        </Picker>
      </View>

      {/* 日期 */}
      <View className="se-field">
        <Text className="se-label">日期</Text>
        <Picker
          mode="date"
          value={form.start_date}
          onChange={(e) => setForm(f => ({ ...f, start_date: e.detail.value }))}
        >
          <View className="se-value">
            <Text>{form.start_date}</Text>
            <Text className="se-arrow">›</Text>
          </View>
        </Picker>
      </View>

      {/* 时间 */}
      <View className="se-row">
        <View className="se-field se-half">
          <Text className="se-label">开始时间</Text>
          <Picker
            mode="time"
            value={`${form.start_hour}:${form.start_min}`}
            onChange={(e) => {
              const [h, m] = e.detail.value.split(':');
              setForm(f => ({ ...f, start_hour: h, start_min: m }));
            }}
          >
            <View className="se-value">
              <Text>{form.start_hour}:{form.start_min}</Text>
              <Text className="se-arrow">›</Text>
            </View>
          </Picker>
        </View>
        <View className="se-field se-half">
          <Text className="se-label">时长 (分钟)</Text>
          <Input
            className="se-input"
            type="number"
            value={form.duration}
            onInput={(e) => setForm(f => ({ ...f, duration: e.detail.value }))}
          />
        </View>
      </View>

      {/* 上课地点 */}
      <View className="se-field">
        <Text className="se-label">上课地点</Text>
        <Input
          className="se-input"
          placeholder="教室/地址"
          value={form.room}
          onInput={(e) => setForm(f => ({ ...f, room: e.detail.value }))}
        />
      </View>

      {/* 学生选择 */}
      <View className="se-field">
        <Text className="se-label">学生 * ({selectedStudents.length}人)</Text>
        <View className="se-student-tags">
          {selectedStudents.map(st => (
            <View key={st.id} className="se-student-tag" onClick={() => toggleStudent(st)}>
              <Text>{st.name} ✕</Text>
            </View>
          ))}
          <View className="se-add-student" onClick={() => setShowStudentPicker(true)}>
            <Text>+ 添加</Text>
          </View>
        </View>
      </View>

      {/* 学生选择弹窗 */}
      {showStudentPicker && (
        <View className="se-overlay" onClick={() => setShowStudentPicker(false)}>
          <View className="se-student-list" onClick={(e) => e.stopPropagation()}>
            <Text className="se-student-list-title">选择学生</Text>
            {availableStudents.map(st => {
              const selected = selectedStudents.find(s => s.id === st.id);
              return (
                <View key={st.id} className={`se-student-item ${selected ? 'selected' : ''}`} onClick={() => toggleStudent(st)}>
                  <View className="se-sticker-avatar">
                    <Text>{st.name.charAt(0)}</Text>
                  </View>
                  <Text className="se-sticker-name">{st.name}</Text>
                  {selected && <Text className="se-check">✓</Text>}
                </View>
              );
            })}
            {availableStudents.length === 0 && (
              <Text className="se-empty">暂无可选学生</Text>
            )}
            <View className="se-student-done" onClick={() => setShowStudentPicker(false)}>
              <Text>完成 ({selectedStudents.length}人)</Text>
            </View>
          </View>
        </View>
      )}

      {/* 备注 */}
      <View className="se-field">
        <Text className="se-label">备注</Text>
        <Textarea
          className="se-textarea"
          placeholder="备注信息"
          value={form.notes}
          onInput={(e) => setForm(f => ({ ...f, notes: e.detail.value }))}
        />
      </View>

      {/* 提交按钮 */}
      <View className="se-submit" onClick={handleSubmit}>
        <Text className="se-submit-text">{submitting ? '提交中...' : isEditing ? '保存修改' : '创建排课'}</Text>
      </View>
    </View>
  );
}
