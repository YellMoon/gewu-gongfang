import { useState, useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { Student, Payment, PaymentType, Grade } from '../../types';
import { getLocalItem, getLocalData } from '../../utils/sync';
import './index.scss';

export default function StudentDetail() {
  const router = useRouter();
  const { id } = router.params;
  const [student, setStudent] = useState<Student | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [activeTab, setActiveTab] = useState<'info' | 'payments' | 'grades'>('info');

  useEffect(() => {
    if (id) {
      const s = getLocalItem<Student>('students', id);
      setStudent(s || null);

      const allPayments = getLocalData<Payment>('payments');
      setPayments(allPayments.filter((p) => p.student_id === id));

      const allGrades = getLocalData<Grade>('grades');
      setGrades(allGrades.filter((g) => g.student_id === id));
    }
  }, [id]);

  if (!student) {
    return (
      <View className='container'>
        <View className='empty-state'>
          <Text className='empty-state-icon'>❓</Text>
          <Text className='empty-state-text'>未找到该学生信息</Text>
        </View>
      </View>
    );
  }

  const getPaymentTypeLabel = (t: PaymentType) => t === PaymentType.TUITION ? '学费' : '课时';
  const formatDate = (d: string) => d.split('T')[0];

  return (
    <View className='container'>
      {/* 学生头像和信息 */}
      <View className='student-header card'>
        <View className='student-avatar'>
          <Text className='avatar-text'>{student.name.charAt(0)}</Text>
        </View>
        <Text className='student-name'>{student.name}</Text>
        <Text className='student-info'>
          {[student.school, student.grade_current, student.phone].filter(Boolean).join(' · ')}
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
          <View className='info-row'><Text className='info-label'>学校</Text><Text className='info-value'>{student.school || '-'}</Text></View>
          <View className='info-row'><Text className='info-label'>年级</Text><Text className='info-value'>{student.grade_current || '-'}</Text></View>
          <View className='info-row'><Text className='info-label'>来源</Text><Text className='info-value'>{student.source_type === 1 ? '自有生源' : student.source_type === 2 ? '机构生源' : '-'}</Text></View>
          <View className='info-row'><Text className='info-label'>备注</Text><Text className='info-value'>{student.notes || '-'}</Text></View>
          <View className='info-row'><Text className='info-label'>创建时间</Text><Text className='info-value'>{formatDate(student.created_at)}</Text></View>
        </View>
      )}

      {/* 缴费记录 */}
      {activeTab === 'payments' && (
        <View>
          {payments.length === 0 ? (
            <View className='empty-state'>
              <Text className='empty-state-icon'>💰</Text>
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
                  <Text className='list-item-extra' style={{ color: '#52c41a', fontWeight: 600 }}>+¥{p.amount}</Text>
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
              <Text className='empty-state-icon'>📝</Text>
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
                  <Text className='list-item-extra' style={{ fontWeight: 700, fontSize: 32, color: g.score >= 90 ? '#52c41a' : g.score >= 60 ? '#1890ff' : '#ff4d4f' }}>{g.score}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
