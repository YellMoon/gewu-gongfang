/**
 * 缴费记录 v2 — 下拉刷新 + 新增缴费 + 按学生筛选
 */
import { useState } from 'react';
import { View, Text, Input, Picker, ScrollView } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { Payment, PaymentType, Student } from '../../types';
import { addCachedItem, setCachedList, withOfflineSupport, addPendingChange } from '../../utils/storage';
import { paymentApi } from '../../utils/api';
import { getLocalData } from '../../utils/sync';
import { NetworkStatus, EmptyState, LoadingSkeleton } from '../../components/shared';
import './index.scss';

export default function Payments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [filterStudentId, setFilterStudentId] = useState('');
  const [form, setForm] = useState({ student_id: '', amount: '', payment_type: '1', notes: '' });

  useDidShow(() => { loadData(); });

  const loadData = () => {
    setPayments(getLocalData<Payment>('payments'));
    setStudents(getLocalData<Student>('students'));
    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await paymentApi.getAll();
      if (res.success && res.data) {
        setCachedList('payments', res.data);
        setPayments(res.data);
      }
    } catch { loadData(); }
    finally { setRefreshing(false); }
  };

  const filteredPayments = filterStudentId
    ? payments.filter(p => p.student_id === filterStudentId)
    : payments;

  const getStudentName = (id: string) => students.find(s => s.id === id)?.name || '未知';
  const totalAmount = filteredPayments.reduce((sum, p) => sum + p.amount, 0);

  const handleAdd = async () => {
    if (!form.student_id) { Taro.showToast({ title: '请选择学生', icon: 'none' }); return; }
    if (!form.amount || Number(form.amount) <= 0) { Taro.showToast({ title: '请输入金额', icon: 'none' }); return; }

    const now = new Date().toISOString();
    const newPayment: Payment = {
      id: `local_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 9)}`,
      student_id: form.student_id,
      amount: Number(form.amount),
      payment_type: Number(form.payment_type) as PaymentType,
      payment_date: now.split('T')[0],
      notes: form.notes,
      created_at: now,
    };

    await withOfflineSupport('payments', 'create', newPayment, () => paymentApi.create(newPayment));
    addCachedItem('payments', newPayment);
    setShowModal(false);
    setForm({ student_id: '', amount: '', payment_type: '1', notes: '' });
    loadData();
    Taro.showToast({ title: '缴费记录已添加', icon: 'success' });
  };

  return (
    <View className="payments-page">
      <NetworkStatus onRetry={handleRefresh} />

      {/* 统计栏 */}
      <View className="pay-summary">
        <View className="pay-stat">
          <Text className="pay-stat-value">¥{totalAmount.toFixed(0)}</Text>
          <Text className="pay-stat-label">{filterStudentId ? '该学生缴费' : '总缴费'}</Text>
        </View>
        <View className="pay-stat">
          <Text className="pay-stat-value">{filteredPayments.length}</Text>
          <Text className="pay-stat-label">缴费笔数</Text>
        </View>
        <View className="pay-add-btn" onClick={() => setShowModal(true)}>
          <Text className="pay-add-text">+ 新增</Text>
        </View>
      </View>

      {/* 学生筛选 */}
      {students.length > 0 && (
        <ScrollView scrollX className="filter-bar">
          <View className={`filter-tag ${!filterStudentId ? 'active' : ''}`} onClick={() => setFilterStudentId('')}>
            <Text>全部</Text>
          </View>
          {students.slice(0, 20).map(s => (
            <View key={s.id} className={`filter-tag ${filterStudentId === s.id ? 'active' : ''}`} onClick={() => setFilterStudentId(s.id)}>
              <Text>{s.name}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {/* 缴费列表 */}
      {loading ? <LoadingSkeleton rows={5} /> : filteredPayments.length === 0 ? (
        <EmptyState icon="💰" text="暂无缴费记录" actionText="新增缴费" onAction={() => setShowModal(true)} />
      ) : (
        <ScrollView
          className="pay-list"
          scrollY
          refresherEnabled
          refresherTriggered={refreshing}
          onRefresherRefresh={handleRefresh}
          refresherBackground="#f5f5f5"
        >
          {filteredPayments.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(p => (
            <View key={p.id} className="pay-card">
              <View className="pay-left">
                <Text className="pay-student">{getStudentName(p.student_id)}</Text>
                <Text className="pay-date">{p.payment_date} · {p.payment_type === PaymentType.TUITION ? '学费' : '课时'}</Text>
                {p.notes && <Text className="pay-notes">{p.notes}</Text>}
              </View>
              <Text className="pay-amount">+¥{p.amount}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {/* 新增缴费弹窗 */}
      {showModal && (
        <View className="modal-overlay" onClick={() => setShowModal(false)}>
          <View className="modal-content" onClick={e => e.stopPropagation()}>
            <Text className="modal-title">新增缴费</Text>
            <View className="form-group">
              <Text className="form-label">学生 *</Text>
              <Picker
                mode="selector"
                range={students.map(s => s.name)}
                value={students.findIndex(s => s.id === form.student_id)}
                onChange={e => { const idx = Number(e.detail.value as string); if (idx >= 0) setForm({...form, student_id: students[idx].id}); }}
              >
                <View className="form-picker"><Text>{form.student_id ? getStudentName(form.student_id) : '请选择学生'}</Text></View>
              </Picker>
            </View>
            <View className="form-group">
              <Text className="form-label">金额 *</Text>
              <Input className="form-input" type="digit" placeholder="请输入金额" value={form.amount} onInput={e => setForm({...form, amount: e.detail.value})} />
            </View>
            <View className="form-group">
              <Text className="form-label">类型</Text>
              <Picker
                mode="selector"
                range={['学费', '课时']}
                value={Number(form.payment_type) - 1}
                onChange={e => setForm({...form, payment_type: String(Number(e.detail.value as string) + 1)})}
              >
                <View className="form-picker"><Text>{Number(form.payment_type) === 1 ? '学费' : '课时'}</Text></View>
              </Picker>
            </View>
            <View className="form-group">
              <Text className="form-label">备注</Text>
              <Input className="form-input" placeholder="备注信息" value={form.notes} onInput={e => setForm({...form, notes: e.detail.value})} />
            </View>
            <View className="modal-actions">
              <View className="modal-btn cancel" onClick={() => setShowModal(false)}><Text>取消</Text></View>
              <View className="modal-btn confirm" onClick={handleAdd}><Text>确认</Text></View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
