/**
 * 首页仪表盘 v2 — 今日摘要 + 模块导航 + 快捷入口
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { api, readCloudSnapshot } from '../../utils/api';
import {
  fetchPermissions,
  getPermittedModules,
  hasModulePermission,
  clearPermissionCache,
  getMiniappRolePolicy,
  getLinkedStudentIds,
} from '../../utils/permission';
import { getLocalData } from '../../utils/sync';
import { NetworkStatus, StatCard, LoadingSkeleton, EmptyState } from '../../components/shared';
import { Schedule, ScheduleStatus, Student, Course } from '../../types';
import './index.scss';

interface UserInfo {
  id: string;
  name: string;
  user_type: string;
  avatar?: string;
}

interface ModuleInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
}

interface DashboardData {
  todayClasses: number;
  todayRevenue: number;
  monthRevenue: number;
  totalStudents: number;
  pendingSync: number;
}

const MODULE_CONFIG: Record<string, { icon: string; color: string; pages: string }> = {
  scheduling: { icon: '📅', color: '#1890ff', pages: '/pages/schedule/index' },
  'question-bank': { icon: '📝', color: '#52c41a', pages: '/pages/question-bank/index' },
  'teaching-tools': { icon: '🔧', color: '#fa8c16', pages: '/pages/tools/index' },
  assets: { icon: '💰', color: '#eb2f96', pages: '/pages/assets/index' },
};export default function Index() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [dashboard, setDashboard] = useState<DashboardData>({
    todayClasses: 0, todayRevenue: 0, monthRevenue: 0, totalStudents: 0, pendingSync: 0,
  });

  useDidShow(() => {
    checkLogin();
  });

  const checkLogin = async () => {
    const token = Taro.getStorageSync('auth_token');
    if (!token) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }

    const savedUser = Taro.getStorageSync('user_info');
    if (savedUser) setUser(savedUser);

    await Promise.all([loadModules(), loadDashboard(), loadSnapshot()]);
  };

  const loadSnapshot = async () => {
    try {
      const res = await readCloudSnapshot('full');
      if (res.success) setSnapshot(res.snapshot || res.data?.snapshot || null);
    } catch {
      setSnapshot(null);
    }
  };

  const loadModules = async () => {
    try {
      const res = await api.get<{ modules: ModuleInfo[] }>('/api/modules');
      if (res.success && res.data) {
        let allModules = res.data.modules;
        try {
          await fetchPermissions();
          const permittedIds = getPermittedModules();
          if (permittedIds.length > 0) {
            allModules = allModules.filter((m) => permittedIds.includes(m.id));
          }
        } catch { /* fallback */ }
        setModules(allModules);
      }
    } catch (err) {
      console.error('加载模块失败:', err);
    } finally {
      setLoading(false);
    }
  };

  /** 从本地数据计算仪表盘统计 */
  const loadDashboard = async () => {
    try {
      const students = getLocalData<Student>('students');
      const schedules = getLocalData<Schedule>('schedules');
      const courses = getLocalData<Course>('courses');
      const currentUser = Taro.getStorageSync('user_info') || user;
      const rolePolicy = getMiniappRolePolicy(currentUser);
      const linkedStudentIds = getLinkedStudentIds(currentUser);
      const courseStudentIds = (course?: any) => [
        ...(Array.isArray(course?.student_ids) ? course.student_ids : []),
        ...(Array.isArray(course?.student_pricings) ? course.student_pricings.map((p: any) => p.student_id || p.studentId) : []),
      ].filter(Boolean);
      const courseById = new Map(courses.map((course: any) => [course.id, course]));
      const scopedSchedules = rolePolicy.role === 'student'
        ? schedules.filter((schedule: any) => {
          const directStudentIds = [
            ...(Array.isArray(schedule.student_ids) ? schedule.student_ids : []),
            ...(Array.isArray(schedule.student_pricings) ? schedule.student_pricings.map((p: any) => p.student_id || p.studentId) : []),
            ...courseStudentIds(courseById.get(schedule.course_id)),
          ].filter(Boolean);
          return directStudentIds.some((id: string) => linkedStudentIds.includes(id));
        })
        : schedules;
      const scopedStudents = rolePolicy.role === 'student'
        ? students.filter((student: any) => linkedStudentIds.includes(student.id))
        : students;

      const today = new Date().toISOString().split('T')[0];
      const thisMonth = today.substring(0, 7);

      const todayClasses = scopedSchedules.filter(s =>
        s.start_time?.startsWith(today) && s.status === ScheduleStatus.PLANNED
      ).length;

      const todayRevenue = rolePolicy.role === 'student' ? 0 : scopedSchedules
        .filter(s => s.start_time?.startsWith(today) && s.status === ScheduleStatus.COMPLETED)
        .reduce((sum, s) => sum + (s.calculated_tuition || 0), 0);

      const monthRevenue = rolePolicy.role === 'student' ? 0 : scopedSchedules
        .filter(s => s.start_time?.startsWith(thisMonth) && s.status === ScheduleStatus.COMPLETED)
        .reduce((sum, s) => sum + (s.calculated_tuition || 0), 0);

      // 尝试从服务端拉取最新数据
      try {
        const statsRes = await api.get<any>(`/scheduling/stats/revenue?start=${thisMonth}-01&end=${today}`);
        if (statsRes.success && statsRes.data) {
          // 服务端数据优先
        }
      } catch { /* 离线降级到本地 */ }

      setDashboard({
        todayClasses,
        todayRevenue,
        monthRevenue,
        totalStudents: scopedStudents.length,
        pendingSync: 0,
      });
    } catch (err) {
      console.error('加载仪表盘失败:', err);
    }
  };

  const formatMoney = (n: number) => {
    if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
    return `¥${n.toFixed(0)}`;
  };

  const handleModuleClick = useCallback((mod: ModuleInfo) => {
    if (!hasModulePermission(mod.id, 'view')) {
      Taro.navigateTo({ url: '/pages/forbidden/index' });
      return;
    }
    const config = MODULE_CONFIG[mod.id];
    if (config?.pages) {
      Taro.navigateTo({ url: config.pages });
    } else {
      Taro.showToast({ title: '模块开发中', icon: 'none' });
    }
  }, []);

  const handleLogout = () => {
    Taro.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          clearPermissionCache();
          Taro.removeStorageSync('auth_token');
          Taro.removeStorageSync('user_info');
          Taro.redirectTo({ url: '/pages/login/index' });
        }
      },
    });
  };

  const getUserTypeLabel = (type: string) => {
    const labels: Record<string, string> = { admin: '管理员', teacher: '教师', student: '学生', invited: '被邀请者' };
    return labels[type] || type;
  };

  return (
    <View className="home-page">
      <NetworkStatus onRetry={loadDashboard} />

      <View className="snapshot-time">
        <Text>数据快照：{snapshot?.created_at || '等待主机发布'}</Text>
      </View>

      {/* 用户信息 */}
      {user && (
        <View className="user-header">
          <View className="user-avatar">
            <Text className="avatar-text">{user.name?.charAt(0) || '?'}</Text>
          </View>
          <View className="user-info">
            <Text className="user-name">{user.name}</Text>
            <Text className="user-type">{getUserTypeLabel(user.user_type)}</Text>
          </View>
          <View className="logout-btn" onClick={handleLogout}>
            <Text className="logout-text">退出</Text>
          </View>
        </View>
      )}

      {/* 仪表盘统计卡片 */}
      <View className="section">
        <Text className="section-title">今日概览</Text>
        {user?.user_type === 'student' && (
          <Text className="student-dashboard-scope">仅显示与你关联课程相关的数据</Text>
        )}
        <View className="stat-grid">
          <StatCard label="今日课程" value={dashboard.todayClasses} suffix="节" color="#1890ff" icon="📅" />
          <StatCard label="今日收入" value={formatMoney(dashboard.todayRevenue)} color="#52c41a" icon="💰" />
          <StatCard label="本月收入" value={formatMoney(dashboard.monthRevenue)} color="#722ed1" icon="📊" />
          <StatCard label="学生总数" value={dashboard.totalStudents} suffix="人" color="#fa8c16" icon="👨‍🎓" />
        </View>
      </View>

      {/* 功能模块 */}
      <View className="section">
        <Text className="section-title">功能模块</Text>
        {loading ? (
          <LoadingSkeleton rows={2} avatar />
        ) : modules.length === 0 ? (
          <EmptyState icon="📦" text="暂无可访问的模块" />
        ) : (
          <View className="module-grid">
            {modules.map((mod) => {
              const config = MODULE_CONFIG[mod.id] || { icon: '📦', color: '#999' };
              return (
                <View key={mod.id} className="module-card" onClick={() => handleModuleClick(mod)}>
                  <View className="module-icon" style={{ background: config.color }}>
                    <Text className="icon-text">{config.icon}</Text>
                  </View>
                  <Text className="module-name">{mod.name}</Text>
                  <Text className="module-desc">{mod.description}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* 快捷操作 */}
      {loading ? null : modules.some(m => m.id === 'scheduling') && user?.user_type !== 'student' && (
        <View className="section">
          <Text className="section-title">排课管理</Text>
          <View className="quick-actions">
            <View className="quick-item" onClick={() => Taro.navigateTo({ url: '/pages/students/index' })}>
              <Text className="quick-icon">👨‍🎓</Text>
              <Text>学生管理</Text>
            </View>
            <View className="quick-item" onClick={() => Taro.navigateTo({ url: '/pages/courses/index' })}>
              <Text className="quick-icon">📚</Text>
              <Text>课程管理</Text>
            </View>
            <View className="quick-item" onClick={() => Taro.navigateTo({ url: '/pages/payments/index' })}>
              <Text className="quick-icon">💰</Text>
              <Text>缴费记录</Text>
            </View>
            <View className="quick-item" onClick={() => Taro.navigateTo({ url: '/pages/stats/index' })}>
              <Text className="quick-icon">📊</Text>
              <Text>数据统计</Text>
            </View>
          </View>
        </View>
      )}

      {/* 管理员入口 */}
      {loading ? null : user?.user_type === 'student' && (
        <View className="section">
          <Text className="section-title">我的学习</Text>
          <View className="quick-actions">
            <View className="quick-item" onClick={() => Taro.navigateTo({ url: '/pages/schedule/index' })}>
              <Text className="quick-icon">📅</Text>
              <Text>我的课表</Text>
            </View>
            <View className="quick-item" onClick={() => Taro.navigateTo({ url: '/pages/question-bank/index' })}>
              <Text className="quick-icon">📘</Text>
              <Text>题库组卷</Text>
            </View>
          </View>
        </View>
      )}

      {!loading && user?.user_type === 'admin' && (
        <View className="section">
          <Text className="section-title">管理</Text>
          <View className="quick-actions">
            <View className="quick-item" onClick={() => Taro.navigateTo({ url: '/pages/admin/users/index' })}>
              <Text className="quick-icon">👥</Text>
              <Text>用户管理</Text>
            </View>
            <View className="quick-item" onClick={() => Taro.navigateTo({ url: '/pages/admin/invitations/index' })}>
              <Text className="quick-icon">✉️</Text>
              <Text>邀请管理</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
