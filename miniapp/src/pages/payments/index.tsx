// UTF-8: Session-bound read-only financial view; currency and hours stay separate.
import { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useDidShow, useDidHide, usePullDownRefresh } from '@tarojs/taro';
import { Payment, PaymentType, Student } from '../../types';
import { getLocalData, pullFromCloudBusinessProjection } from '../../utils/sync';
import { NetworkStatus, EmptyState, LoadingSkeleton } from '../../components/shared';
import { sortPaymentsNewestFirst } from './paymentsRuntime';
import { canAccessMiniappPage, refreshMiniappPageAccess } from '../../utils/miniappPageAccess';
import ForbiddenPage from '../../components/ForbiddenContent';
import { authSessionRuntime } from '../../utils/authSession';
import './index.scss';

export default function Payments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStudentId, setFilterStudentId] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const requestSequence = useRef(0);
  const resultSession = useRef<ReturnType<typeof authSessionRuntime.capture> | null>(null);

  const handleRefresh = async () => {
    const sequence = ++requestSequence.current;
    const session = authSessionRuntime.capture();
    const isCurrent = () => sequence === requestSequence.current && authSessionRuntime.isSameSession(session);
    setPayments([]);
    setStudents([]);
    setLoading(true);
    setLoadFailed(false);
    setRefreshing(true);
    try {
      if (!await refreshMiniappPageAccess('/pages/payments/index') || !isCurrent()) return;
      let refreshed = false;
      try { refreshed = await pullFromCloudBusinessProjection(); } catch { /* Authorized cache below. */ }
      if (!isCurrent() || !canAccessMiniappPage('/pages/payments/index')) return;
      const nextStudents = getLocalData<Student>('students');
      setPayments(getLocalData<Payment>('payments'));
      setStudents(nextStudents);
      setFilterStudentId(id => nextStudents.some(student => student.id === id) ? id : '');
      resultSession.current = session;
      setLoadFailed(!refreshed);
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
        void Taro.stopPullDownRefresh();
      }
    }
  };

  useDidShow(handleRefresh);
  usePullDownRefresh(handleRefresh);
  useDidHide(() => { requestSequence.current++; setPayments([]); setStudents([]); setLoading(true); });
  useEffect(() => () => { requestSequence.current++; }, []);

  if (!canAccessMiniappPage('/pages/payments/index')) return <ForbiddenPage />;
  if (resultSession.current !== null && !authSessionRuntime.isSameSession(resultSession.current)) {
    return <View className="payments-page"><LoadingSkeleton /></View>;
  }
  if (!loading && loadFailed && payments.length === 0 && students.length === 0) {
    return <View className="payments-page"><EmptyState text="暂时无法读取缴费记录" actionText="重试" onAction={handleRefresh} /></View>;
  }

  const filteredPayments = filterStudentId
    ? payments.filter(p => p.student_id === filterStudentId)
    : payments;

  const getStudentName = (id: string) => students.find(s => s.id === id)?.name || '未知';
  const totalAmount = filteredPayments.reduce((sum, p) => sum + (p.payment_type === PaymentType.TUITION ? p.amount : 0), 0);
  const totalHours = filteredPayments.reduce((sum, p) => sum + (p.payment_type === PaymentType.HOURS ? p.amount : 0), 0);

  return (
    <View className="payments-page">
      <NetworkStatus onRetry={handleRefresh} />
      {loadFailed && <View className="payments-cache-notice"><Text>暂时无法更新，显示已保存的数据</Text></View>}

      {!loading && <View className="pay-summary">
        <View className="pay-stat">
          <Text className="pay-stat-value">¥{totalAmount.toFixed(2)}</Text>
          <Text className="pay-stat-label">缴费金额</Text>
        </View>
        <View className="pay-stat">
          <Text className="pay-stat-value">{Number(totalHours.toFixed(4))}</Text>
          <Text className="pay-stat-label">充值课时</Text>
        </View>
        <View className="pay-stat">
          <Text className="pay-stat-value">{filteredPayments.length}</Text>
          <Text className="pay-stat-label">缴费笔数</Text>
        </View>
      </View>}

      {students.length > 0 && (
        <ScrollView scrollX className="filter-bar">
          <View className={`filter-tag ${!filterStudentId ? 'active' : ''}`} onClick={() => setFilterStudentId('')}>
            <Text>全部</Text>
          </View>
          {students.map(s => (
            <View key={s.id} className={`filter-tag ${filterStudentId === s.id ? 'active' : ''}`} onClick={() => setFilterStudentId(s.id)}>
              <Text>{s.name}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {loading ? <LoadingSkeleton rows={5} /> : filteredPayments.length === 0 ? (
        <EmptyState icon="缴" text="暂无缴费记录" />
      ) : (
        <ScrollView
          className="pay-scroll"
          scrollY
          refresherEnabled
          refresherTriggered={refreshing}
          onRefresherRefresh={handleRefresh}
          refresherBackground="#f7f4ee"
        >
          <View className="pay-list">
            {sortPaymentsNewestFirst(filteredPayments).map(p => (
              <View key={p.id} className="pay-card">
                <View className="pay-left">
                  <Text className="pay-student">{getStudentName(p.student_id)}</Text>
                  <Text className="pay-date">{p.payment_date} · {p.payment_type === PaymentType.TUITION ? '学费' : '课时'}</Text>
                  {p.notes && <Text className="pay-notes">{p.notes}</Text>}
                </View>
                <Text className="pay-amount">{p.payment_type === PaymentType.HOURS ? `+${p.amount} 课时` : `+¥${p.amount.toFixed(2)}`}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
