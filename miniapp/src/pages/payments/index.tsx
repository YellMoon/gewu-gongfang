import { useState } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import { useDidShow } from '@tarojs/taro';
import { Payment, PaymentType, Student } from '../../types';
import { setCachedList } from '../../utils/storage';
import { paymentApi } from '../../utils/api';
import { getLocalData } from '../../utils/sync';
import { NetworkStatus, EmptyState, LoadingSkeleton } from '../../components/shared';
import './index.scss';

export default function Payments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStudentId, setFilterStudentId] = useState('');

  useDidShow(() => {
    loadData();
  });

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
    } catch {
      loadData();
    } finally {
      setRefreshing(false);
    }
  };

  const filteredPayments = filterStudentId
    ? payments.filter(p => p.student_id === filterStudentId)
    : payments;

  const getStudentName = (id: string) => students.find(s => s.id === id)?.name || '未知';
  const totalAmount = filteredPayments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <View className="payments-page">
      <NetworkStatus onRetry={handleRefresh} />

      <View className="pay-summary">
        <View className="pay-stat">
          <Text className="pay-stat-value">¥{totalAmount.toFixed(0)}</Text>
          <Text className="pay-stat-label">{filterStudentId ? '该学生缴费' : '总缴费'}</Text>
        </View>
        <View className="pay-stat">
          <Text className="pay-stat-value">{filteredPayments.length}</Text>
          <Text className="pay-stat-label">缴费笔数</Text>
        </View>
      </View>

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

      {loading ? <LoadingSkeleton rows={5} /> : filteredPayments.length === 0 ? (
        <EmptyState icon="💰" text="暂无缴费记录" />
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
    </View>
  );
}
