import { useState, useEffect, useRef } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useRouter, useDidShow, useDidHide, usePullDownRefresh } from '@tarojs/taro';
import { Student, Payment, PaymentType, Grade } from '../../types';
import { getLocalItem, getLocalData, pullFromCloudBusinessProjection } from '../../utils/sync';
import { isStudentScopedUser } from '../../utils/permission';
import { studentSchoolLabel, studentGradeLabel, studentPaymentAmount } from '../../utils/studentDisplay';
import { authSessionRuntime } from '../../utils/authSession';
import { canAccessMiniappPage, refreshMiniappPageAccess } from '../../utils/miniappPageAccess';
import { EmptyState, LoadingSkeleton } from '../../components/shared';
import ForbiddenPage from '../../components/ForbiddenContent';
import './index.scss';

export default function StudentDetail() {
  const router = useRouter();
  const { id } = router.params;
  const isStudent = isStudentScopedUser();
  const [student, setStudent] = useState<Student | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestSequence = useRef(0);
  const resultSession = useRef<ReturnType<typeof authSessionRuntime.capture> | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'payments' | 'grades'>('info');

  // UTF-8: Only the initiating, still-authorized account may read or render its cache.
  const handleRefresh = async () => {
    const sequence = ++requestSequence.current;
    const session = authSessionRuntime.capture();
    const current = () => sequence === requestSequence.current && authSessionRuntime.isSameSession(session);
    setLoading(true);
    setLoadFailed(false);
    setStudent(null); setPayments([]); setGrades([]);
    try {
      if (!id || !await refreshMiniappPageAccess('/pages/student-detail/index') || !current()) return;
      let refreshed = false;
      try { refreshed = await pullFromCloudBusinessProjection(); } catch { /* Only this account's authorized cache is read below. */ }
      if (!current() || !canAccessMiniappPage('/pages/student-detail/index')) return;
      const s = getLocalItem<Student>('students', id);
      setStudent(s || null);
      if (s) {
        setPayments(getLocalData<Payment>('payments').filter(p => p.student_id === id));
        setGrades(getLocalData<Grade>('grades').filter(g => g.student_id === id));
      }
      resultSession.current = session;
      setLoadFailed(!refreshed);
    } finally {
      if (sequence === requestSequence.current) { setLoading(false); void Taro.stopPullDownRefresh(); }
    }
  };
  useDidShow(handleRefresh);
  usePullDownRefresh(handleRefresh);
  useDidHide(() => { requestSequence.current++; setStudent(null); setPayments([]); setGrades([]); setLoading(true); });
  useEffect(() => () => { requestSequence.current++; }, []);

  if (!canAccessMiniappPage('/pages/student-detail/index')) return <ForbiddenPage />;
  if (loading || (resultSession.current !== null && !authSessionRuntime.isSameSession(resultSession.current))) {
    return <View className='container student-detail-page'><LoadingSkeleton rows={3} /></View>;
  }
  if (!student && loadFailed) {
    return <View className='container student-detail-page'><EmptyState text='暂时无法读取学生资料' actionText='重试' onAction={handleRefresh} /></View>;
  }

  if (!student) {
    return (
      <View className='container student-detail-page'>
        <EmptyState icon='生' text='未找到该学生信息' actionText='返回首页' onAction={() => Taro.switchTab({ url: '/pages/index/index' })} />
      </View>
    );
  }

  const getPaymentTypeLabel = (t: PaymentType) => t === PaymentType.TUITION ? '学费' : '课时';
  const formatDate = (d: string) => d.split('T')[0];
  const getScoreClass = (score: number) => {
    if (score >= 90) return 'score-high';
    if (score >= 60) return 'score-mid';
    return 'score-low';
  };

  return (
    <View className='container student-detail-page'>
      {loadFailed && <View className='student-cache-notice'><Text>暂时无法更新，显示已保存的数据</Text></View>}
      {/* 学生头像和信息 */}
      <View className='student-header card'>
        <View className='student-avatar'>
          <Text className='avatar-text'>{student.name.charAt(0)}</Text>
        </View>
        <Text className='student-name'>{student.name}</Text>
        <Text className='student-info'>
          {[studentSchoolLabel(student.school), studentGradeLabel(student), student.phone].filter(Boolean).join(' · ')}
        </Text>
        <View className='balance-row'>
          <View className='balance-item'>
            <Text className='balance-value'>{student.balance_hours}</Text>
            <Text className='balance-label'>剩余课时</Text>
          </View>
          <View className='balance-divider' />
          <View className='balance-item'>
            <Text className='balance-value'>¥{student.balance_money}</Text>
            <Text className='balance-label'>账户余额</Text>
          </View>
        </View>
      </View>

      {/* Tab切换 */}
      <View className='view-tabs'>
        <View className={`tab ${activeTab === 'info' ? 'active' : ''}`} onClick={() => setActiveTab('info')}>基本信息</View>
        <View className={`tab ${activeTab === 'payments' ? 'active' : ''}`} onClick={() => setActiveTab('payments')}>缴费记录</View>
        <View className={`tab ${activeTab === 'grades' ? 'active' : ''}`} onClick={() => setActiveTab('grades')}>成绩记录</View>
      </View>

      {/* 基本信息 */}
      {activeTab === 'info' && (
        <View className='card'>
          <View className='info-row'><Text className='info-label'>姓名</Text><Text className='info-value'>{student.name}</Text></View>
          <View className='info-row'><Text className='info-label'>电话</Text><Text className='info-value'>{student.phone || '-'}</Text></View>
          <View className='info-row'><Text className='info-label'>学校</Text><Text className='info-value'>{studentSchoolLabel(student.school) || '-'}</Text></View>
          <View className='info-row'><Text className='info-label'>年级</Text><Text className='info-value'>{studentGradeLabel(student) || '-'}</Text></View>
          {!isStudent && <View className='info-row'><Text className='info-label'>来源</Text><Text className='info-value'>{student.source_type === 1 ? '自有生源' : student.source_type === 2 ? '机构生源' : '-'}</Text></View>}
          {!isStudent && <View className='info-row'><Text className='info-label'>备注</Text><Text className='info-value'>{student.notes || '-'}</Text></View>}
          {!isStudent && <View className='info-row'><Text className='info-label'>创建时间</Text><Text className='info-value'>{formatDate(student.created_at)}</Text></View>}
        </View>
      )}

      {/* 缴费记录 */}
      {activeTab === 'payments' && (
        <View>
          {payments.length === 0 ? (
            <View className='empty-state'>
              <Text className='empty-state-icon'>账</Text>
              <Text className='empty-state-text'>暂无缴费记录</Text>
            </View>
          ) : (
            <View className='card'>
              {payments.map((p) => (
                <View key={p.id} className='list-item'>
                  <View className='list-item-content'>
                    <Text className='list-item-title'>{getPaymentTypeLabel(p.payment_type)}</Text>
                    <Text className='list-item-desc'>{formatDate(p.payment_date)} · {p.payment_method || '未记录'}</Text>
                  </View>
                  <Text className='list-item-extra income'>{studentPaymentAmount(p)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* 成绩记录 */}
      {activeTab === 'grades' && (
        <View>
          {grades.length === 0 ? (
            <View className='empty-state'>
              <Text className='empty-state-icon'>绩</Text>
              <Text className='empty-state-text'>暂无成绩记录</Text>
            </View>
          ) : (
            <View className='card'>
              {grades.map((g) => (
                <View key={g.id} className='list-item'>
                  <View className='list-item-content'>
                    <Text className='list-item-title'>{g.subject}</Text>
                    <Text className='list-item-desc'>{g.exam_date ? formatDate(g.exam_date) : ''}</Text>
                  </View>
                  <Text className={`list-item-extra score ${getScoreClass(g.score)}`}>{g.score}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
