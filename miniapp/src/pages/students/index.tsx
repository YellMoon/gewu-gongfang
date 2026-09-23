import { useState, useEffect, useRef } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro, { useDidShow, useDidHide, usePullDownRefresh } from '@tarojs/taro';
import { Student, StudentSource } from '../../types';
import { getLocalData, pullFromCloudBusinessProjection } from '../../utils/sync';
import { studentSchoolLabel, studentGradeLabel } from '../../utils/studentDisplay';
import { EmptyState, LoadingSkeleton } from '../../components/shared';
import ForbiddenPage from '../../components/ForbiddenContent';
import { authSessionRuntime } from '../../utils/authSession';
import { canAccessMiniappPage, refreshMiniappPageAccess } from '../../utils/miniappPageAccess';
import './index.scss';

export default function Students() {
  const [students, setStudents] = useState<Student[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestSequence = useRef(0);
  const resultSession = useRef<ReturnType<typeof authSessionRuntime.capture> | null>(null);

  const handleRefresh = async () => {
    const sequence = ++requestSequence.current;
    const session = authSessionRuntime.capture();
    const isCurrent = () => sequence === requestSequence.current && authSessionRuntime.isSameSession(session);
    setStudents([]);
    setLoading(true);
    setLoadFailed(false);
    try {
      if (!await refreshMiniappPageAccess('/pages/students/index') || !isCurrent()) return;
      let refreshed = false;
      try { refreshed = await pullFromCloudBusinessProjection(); } catch { /* Use authorized cache below. */ }
      if (!isCurrent() || !canAccessMiniappPage('/pages/students/index')) return;
      setStudents(getLocalData<Student>('students'));
      resultSession.current = session;
      setLoadFailed(!refreshed);
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        void Taro.stopPullDownRefresh();
      }
    }
  };

  useDidShow(handleRefresh);
  usePullDownRefresh(handleRefresh);
  useDidHide(() => {
    requestSequence.current++;
    setStudents([]);
    setLoading(true);
  });
  useEffect(() => () => { requestSequence.current++; }, []);

  if (!canAccessMiniappPage('/pages/students/index')) return <ForbiddenPage />;
  if (resultSession.current !== null && !authSessionRuntime.isSameSession(resultSession.current)) {
    return <View className='students-page'><LoadingSkeleton /></View>;
  }
  if (!loading && loadFailed && students.length === 0) {
    return <View className='students-page'><EmptyState text='暂时无法读取学生资料' actionText='重试' onAction={handleRefresh} /></View>;
  }

  const filteredStudents = students.filter((s) =>
    !searchText
    || s.name.includes(searchText)
    || (s.phone && s.phone.includes(searchText))
    || (s.school && s.school.includes(searchText))
  );

  return (
    <View className="students-page">
      {loadFailed && <View className='people-cache-notice'><Text>暂时无法更新，显示已保存的数据</Text></View>}

      <View className="search-bar">
        <Input
          className="search-input"
          placeholder="搜索学生姓名/电话/学校"
          value={searchText}
          onInput={(e) => setSearchText(e.detail.value)}
          confirmType="search"
        />
      </View>

      {loading ? (
        <LoadingSkeleton rows={5} avatar />
      ) : filteredStudents.length === 0 ? (
        <EmptyState
          icon="生"
          text={searchText ? '没有匹配的学生' : '暂无学生数据'}
        />
      ) : (
        <View className="student-list">
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
                  {studentSchoolLabel(s.school) ? `${studentSchoolLabel(s.school)} · ` : ''}
                  {studentGradeLabel(s) ? `${studentGradeLabel(s)} · ` : ''}
                  余额 {s.balance_hours || 0} 小时
                </Text>
                <Text className="student-contact">{s.phone || s.parent_wechat || ''}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
