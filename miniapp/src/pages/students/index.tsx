/**
 * 学生管理 v2 — 下拉刷新 + 骨架屏 + 网络状态
 */
import { useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { Student, StudentSource } from '../../types';
import { addCachedItem, removeCachedItem, setCachedList, withOfflineSupport, addPendingChange } from '../../utils/storage';
import { studentApi } from '../../utils/api';
import { updateLocalItem, getLocalData } from '../../utils/sync';
import { NetworkStatus, EmptyState, LoadingSkeleton, PullRefreshView } from '../../components/shared';
import './index.scss';

export default function Students() {
  const [students, setStudents] = useState<Student[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Partial<Student> | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', school: '', grade_year: '', notes: '' });

  useDidShow(() => { loadStudents(); });

  const loadStudents = () => {
    const data = getLocalData<Student>('students');
    setStudents(data);
    setLoading(false);
  };

  const handleRefresh = async () => {
    try {
      const res = await studentApi.getAll();
      if (res.success && res.data) {
        setCachedList('students', res.data);
        setStudents(res.data);
      }
    } catch {
      // 离线降级
      loadStudents();
    } finally {
      // done
    }
  };

  const filteredStudents = students.filter((s) =>
    !searchText || s.name.includes(searchText) || (s.phone && s.phone.includes(searchText)) || (s.school && s.school.includes(searchText))
  );


  const openAdd = () => {
    setEditingStudent(null);
    setForm({ name: '', phone: '', school: '', grade_year: '', notes: '' });
    setShowModal(true);
  };

  const openEdit = (s: Student) => {
    setEditingStudent(s);
    setForm({
      name: s.name,
      phone: s.phone || '',
      school: s.school || '',
      grade_year: s.grade_year?.toString() || '',
      notes: s.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      Taro.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }

    const now = new Date().toISOString();
    if (editingStudent) {
      const updated: Student = {
        ...editingStudent as Student,
        name: form.name,
        phone: form.phone,
        school: form.school,
        grade_year: form.grade_year ? parseInt(form.grade_year) : undefined,
        notes: form.notes,
        updated_at: now,
      };

      await withOfflineSupport('students', 'update', updated, () => studentApi.update(updated.id, updated));
      updateLocalItem('students', updated);
    } else {
      const newStudent: Student = {
        id: `local_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`,
        name: form.name,
        phone: form.phone,
        school: form.school,
        grade_year: form.grade_year ? parseInt(form.grade_year) : undefined,
        notes: form.notes,
        balance_hours: 0,
        balance_money: 0,
        created_at: now,
        updated_at: now,
      };

      await withOfflineSupport('students', 'create', newStudent, () => studentApi.create(newStudent));
      addCachedItem('students', newStudent);
    }

    setShowModal(false);
    loadStudents();
    Taro.showToast({ title: editingStudent ? '已修改' : '已添加', icon: 'success' });
  };

  const handleDelete = (s: Student) => {
    Taro.showModal({
      title: '确认删除',
      content: `确定删除学生「${s.name}」吗？`,
      success: (res) => {
        if (res.confirm) {
          removeCachedItem('students', s.id);
          addPendingChange({ id: s.id, table: 'students', action: 'delete', data: s, timestamp: Date.now() });
          loadStudents();
          Taro.showToast({ title: '已删除', icon: 'success' });
        }
      },
    });
  };

  return (
    <View className="students-page">
      <NetworkStatus onRetry={handleRefresh} />

      {/* 搜索栏 */}
      <View className="search-bar">
        <Input
          className="search-input"
          placeholder="🔍 搜索学生姓名/电话/学校"
          value={searchText}
          onInput={(e) => setSearchText(e.detail.value)}
          confirmType="search"
        />
        <View className="add-btn" onClick={openAdd}>
          <Text className="add-btn-text">+ 添加</Text>
        </View>
      </View>

      {/* 学生列表 */}
      {loading ? (
        <LoadingSkeleton rows={5} avatar />
      ) : filteredStudents.length === 0 ? (
        <EmptyState
          icon="👨‍🎓"
          text={searchText ? '没有匹配的学生' : '还没有学生，点击上方添加'}
          actionText={!searchText ? '添加学生' : undefined}
          onAction={!searchText ? openAdd : undefined}
        />
      ) : (
        <PullRefreshView onRefresh={handleRefresh} className="student-list">
          {filteredStudents.map((s) => (
            <View key={s.id} className="student-card">
              <View className="student-avatar">
                <Text className="student-avatar-text">{s.name.charAt(0)}</Text>
              </View>
              <View className="student-info" onClick={() => Taro.navigateTo({ url: `/pages/student-detail/index?id=${s.id}` })}>
                <View className="student-name-row">
                  <Text className="student-name">{s.name}</Text>
                  {s.source_type !== undefined && (
                    <Text className={`student-source ${s.source_type === StudentSource.SELF ? 'self' : 'inst'}`}>
                      {s.source_type === StudentSource.SELF ? '自有' : '机构'}
                    </Text>
                  )}
                </View>
                <Text className="student-detail">
                  {s.school ? `${s.school} · ` : ''}
                  {s.grade_year ? `${s.grade_year}年级 · ` : ''}
                  余额 {s.balance_hours}小时
                </Text>
                <Text className="student-contact">{s.phone || s.parent_wechat || ''}</Text>
              </View>
              <View className="student-actions">
                <Text className="action-edit" onClick={(e) => { e.stopPropagation(); openEdit(s); }}>编辑</Text>
                <Text className="action-del" onClick={(e) => { e.stopPropagation(); handleDelete(s); }}>删除</Text>
              </View>
            </View>
          ))}
        </PullRefreshView>
      )}

      {/* 模态框 */}
      {showModal && (
        <View className="modal-overlay" onClick={() => setShowModal(false)}>
          <View className="modal-content" onClick={(e) => e.stopPropagation()}>
            <Text className="modal-title">{editingStudent ? '编辑学生' : '添加学生'}</Text>
            <View className="form-group">
              <Text className="form-label">姓名 *</Text>
              <Input className="form-input" placeholder="请输入姓名" value={form.name} onInput={(e) => setForm({ ...form, name: e.detail.value })} />
            </View>
            <View className="form-group">
              <Text className="form-label">手机号</Text>
              <Input className="form-input" placeholder="请输入手机号" value={form.phone} onInput={(e) => setForm({ ...form, phone: e.detail.value })} />
            </View>
            <View className="form-group">
              <Text className="form-label">学校</Text>
              <Input className="form-input" placeholder="请输入学校" value={form.school} onInput={(e) => setForm({ ...form, school: e.detail.value })} />
            </View>
            <View className="form-group">
              <Text className="form-label">年级</Text>
              <Input className="form-input" placeholder="如：初一、高一" value={form.grade_year} onInput={(e) => setForm({ ...form, grade_year: e.detail.value })} />
            </View>
            <View className="form-group">
              <Text className="form-label">备注</Text>
              <Input className="form-input" placeholder="备注信息" value={form.notes} onInput={(e) => setForm({ ...form, notes: e.detail.value })} />
            </View>
            <View className="modal-actions">
              <View className="modal-btn cancel" onClick={() => setShowModal(false)}>
                <Text>取消</Text>
              </View>
              <View className="modal-btn confirm" onClick={handleSave}>
                <Text>保存</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
