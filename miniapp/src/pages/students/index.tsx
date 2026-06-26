import { useState } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { Student, StudentSource } from '../../types';
import { setCachedList } from '../../utils/storage';
import { studentApi } from '../../utils/api';
import { getLocalData } from '../../utils/sync';
import { NetworkStatus, EmptyState, LoadingSkeleton, PullRefreshView } from '../../components/shared';
import './index.scss';

export default function Students() {
  const [students, setStudents] = useState<Student[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(true);

  useDidShow(() => {
    loadStudents();
  });

  const loadStudents = () => {
    setStudents(getLocalData<Student>('students'));
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
      loadStudents();
    }
  };

  const filteredStudents = students.filter((s) =>
    !searchText
    || s.name.includes(searchText)
    || (s.phone && s.phone.includes(searchText))
    || (s.school && s.school.includes(searchText))
  );

  return (
    <View className="students-page">
      <NetworkStatus onRetry={handleRefresh} />

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
          icon="👨‍🎓"
          text={searchText ? '没有匹配的学生' : '暂无学生数据'}
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
                  余额 {s.balance_hours || 0} 小时
                </Text>
                <Text className="student-contact">{s.phone || s.parent_wechat || ''}</Text>
              </View>
            </View>
          ))}
        </PullRefreshView>
      )}
    </View>
  );
}
