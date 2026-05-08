/**
 * 教师管理 v2 — 完整CRUD + 下拉刷新 + 骨架屏
 */
import { useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { Teacher } from '../../types';
import { addCachedItem, removeCachedItem, setCachedList, withOfflineSupport, addPendingChange } from '../../utils/storage';
import { teacherApi } from '../../utils/api';
import { getLocalData } from '../../utils/sync';
import { NetworkStatus, EmptyState, LoadingSkeleton, PullRefreshView } from '../../components/shared';
import './index.scss';

export default function Teachers() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', subject: '', hourly_rate: '', notes: '' });

  useDidShow(() => { loadTeachers(); });

  const loadTeachers = () => {
    setTeachers(getLocalData<Teacher>('teachers'));
    setLoading(false);
  };

  const handleRefresh = async () => {
    try {
      const res = await teacherApi.getAll();
      if (res.success && res.data) {
        setCachedList('teachers', res.data);
        setTeachers(res.data);
      }
    } catch { loadTeachers(); }
  };

  const openAdd = () => {
    setEditingTeacher(null);
    setForm({ name: '', phone: '', subject: '', hourly_rate: '', notes: '' });
    setShowModal(true);
  };

  const openEdit = (t: Teacher) => {
    setEditingTeacher(t);
    setForm({ name: t.name, phone: t.phone || '', subject: t.subject || '', hourly_rate: t.hourly_rate?.toString() || '', notes: t.notes || '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { Taro.showToast({ title: '请输入姓名', icon: 'none' }); return; }
    const now = new Date().toISOString();

    if (editingTeacher) {
      const updated: Teacher = { ...editingTeacher, name: form.name, phone: form.phone, subject: form.subject, hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : undefined, notes: form.notes, updated_at: now };
      await withOfflineSupport('teachers', 'update', updated, () => teacherApi.update(updated.id, updated));
      addCachedItem('teachers', updated);
    } else {
      const newT: Teacher = { id: `local_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`, name: form.name, phone: form.phone, subject: form.subject, hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : undefined, notes: form.notes, created_at: now, updated_at: now };
      await withOfflineSupport('teachers', 'create', newT, () => teacherApi.create(newT));
      addCachedItem('teachers', newT);
    }
    setShowModal(false);
    loadTeachers();
    Taro.showToast({ title: editingTeacher ? '已修改' : '已添加', icon: 'success' });
  };

  const handleDelete = (t: Teacher) => {
    Taro.showModal({
      title: '确认删除', content: `确定删除老师「${t.name}」吗？`,
      success: (res) => {
        if (res.confirm) {
          removeCachedItem('teachers', t.id);
          addPendingChange({ id: t.id, table: 'teachers', action: 'delete', data: t, timestamp: Date.now() });
          loadTeachers();
          Taro.showToast({ title: '已删除', icon: 'success' });
        }
      },
    });
  };

  return (
    <View className="teachers-page">
      <NetworkStatus onRetry={handleRefresh} />

      <View className="search-bar">
        <Text className="page-title">教师管理 ({teachers.length})</Text>
        <View className="add-btn" onClick={openAdd}><Text className="add-btn-text">+ 添加</Text></View>
      </View>

      {loading ? <LoadingSkeleton rows={4} avatar /> : teachers.length === 0 ? (
        <EmptyState icon="👩‍🏫" text="还没有老师" actionText="添加老师" onAction={openAdd} />
      ) : (
        <PullRefreshView onRefresh={handleRefresh} className="teacher-list">
          {teachers.map(t => (
            <View key={t.id} className="teacher-card">
              <View className="teacher-avatar"><Text className="teacher-avatar-text">{t.name.charAt(0)}</Text></View>
              <View className="teacher-info">
                <Text className="teacher-name">{t.name}</Text>
                <Text className="teacher-detail">{[t.subject, t.phone].filter(Boolean).join(' · ') || '暂无信息'}</Text>
              </View>
              {t.hourly_rate && <Text className="teacher-rate">¥{t.hourly_rate}/时</Text>}
              <View className="teacher-actions">
                <Text className="action-edit" onClick={() => openEdit(t)}>编辑</Text>
                <Text className="action-del" onClick={() => handleDelete(t)}>删除</Text>
              </View>
            </View>
          ))}
        </PullRefreshView>
      )}

      {showModal && (
        <View className="modal-overlay" onClick={() => setShowModal(false)}>
          <View className="modal-content" onClick={e => e.stopPropagation()}>
            <Text className="modal-title">{editingTeacher ? '编辑老师' : '添加老师'}</Text>
            <View className="form-group"><Text className="form-label">姓名 *</Text><Input className="form-input" placeholder="请输入姓名" value={form.name} onInput={e => setForm({...form, name: e.detail.value})} /></View>
            <View className="form-group"><Text className="form-label">手机号</Text><Input className="form-input" placeholder="请输入手机号" value={form.phone} onInput={e => setForm({...form, phone: e.detail.value})} /></View>
            <View className="form-group"><Text className="form-label">科目</Text><Input className="form-input" placeholder="如：数学、英语" value={form.subject} onInput={e => setForm({...form, subject: e.detail.value})} /></View>
            <View className="form-group"><Text className="form-label">课时费 (元/时)</Text><Input className="form-input" type="digit" placeholder="如：200" value={form.hourly_rate} onInput={e => setForm({...form, hourly_rate: e.detail.value})} /></View>
            <View className="form-group"><Text className="form-label">备注</Text><Input className="form-input" placeholder="备注信息" value={form.notes} onInput={e => setForm({...form, notes: e.detail.value})} /></View>
            <View className="modal-actions">
              <View className="modal-btn cancel" onClick={() => setShowModal(false)}><Text>取消</Text></View>
              <View className="modal-btn confirm" onClick={handleSave}><Text>保存</Text></View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
