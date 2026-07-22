/**
 * 首页仪表盘 v3 - 数据快照 + 今日摘要 + 角色入口
 */
import { useState, useCallback, useMemo } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { api, readCloudSnapshot } from '../../utils/api';
import { authSessionRuntime } from '../../utils/authSession';
import { captureTrustedAuthSession, clearAuthenticatedSession } from '../../utils/miniappApiSessionRuntime';
import { accountSessionCleanupStorageKeys, isUnrecognizedIdentity } from '../../utils/accountExperience';
import {
  fetchPermissions,
  getPermittedModules,
  hasModulePermission,
  clearPermissionCache,
  getMiniappRolePolicy,
  getLinkedStudentIds,
  getEffectiveMiniappAccess,
  MiniappCapability,
  MiniappRole,
} from '../../utils/permission';
import { getLocalData } from '../../utils/sync';
import { clearBusinessCache, setBusinessCacheIdentity, setCachedList } from '../../utils/storage';
import { scopeDashboardCollections } from '../../utils/miniappAuthorizationRuntime';
import { getMiniappHomeDisplayName } from '../../utils/miniappHomePresentation';
import { NetworkStatus, LoadingSkeleton, EmptyState } from '../../components/shared';
import AccountStatusBanner from '../../components/AccountStatusBanner';
import MembershipBadge from '../../components/MembershipBadge';
import { Schedule, ScheduleStatus, Student, Course } from '../../types';
import './index.scss';

interface UserInfo {
  id: string;
  name?: string;
  nickname?: string;
  user_type: MiniappRole;
  avatar?: string;
  account_state?: 'formal' | 'unrecognized';
  token_use?: 'miniapp-session' | 'unrecognized-student';
  capabilities?: MiniappCapability[];
  membership?: { status?: string } | null;
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

const MODULE_CONFIG: Record<string, { mark: string; tone: string; pages: string; action: string }> = {
  scheduling: { mark: '课', tone: 'teal', pages: '/pages/schedule/index', action: '查看课程安排' },
  'question-bank': { mark: '题', tone: 'indigo', pages: '/pages/question-bank/index', action: '组卷与导出' },
  assets: { mark: '账', tone: 'amber', pages: '/pages/assets/index', action: '财务导入与统计' },
};

const ADMIN_SHORTCUTS = [
  { mark: '生', label: '学生管理', desc: '维护学员与课程关系', url: '/pages/students/index' },
  { mark: '课', label: '课程管理', desc: '课程、班型与收费', url: '/pages/courses/index' },
  { mark: '缴', label: '缴费记录', desc: '付款与课消核对', url: '/pages/payments/index' },
  { mark: '统', label: '数据统计', desc: '收入、课时和趋势', url: '/pages/stats/index' },
];

const STUDENT_SHORTCUTS = [
  { mark: '表', label: '我的课表', desc: '查看本人相关课程', url: '/pages/schedule/index' },
  { mark: '卷', label: '题库组卷', desc: '选题、组卷和导出', url: '/pages/question-bank/index' },
];

function cacheSnapshotPayload(payload?: Record<string, any>) {
  if (!payload) return;
  if (Array.isArray(payload.students)) setCachedList('students', payload.students);
  if (Array.isArray(payload.courses)) setCachedList('courses', payload.courses);
  if (Array.isArray(payload.schedules)) setCachedList('schedules', payload.schedules);
  if (Array.isArray(payload.teachers)) setCachedList('teachers', payload.teachers);
  if (Array.isArray(payload.payments)) setCachedList('payments', payload.payments);
  if (Array.isArray(payload.consumptions)) setCachedList('consumptions', payload.consumptions);
  if (Array.isArray(payload.assetRecords)) setCachedList('assetRecords', payload.assetRecords);
  if (Array.isArray(payload.assetCategories)) setCachedList('assetCategories', payload.assetCategories);
  if (Array.isArray(payload.questions)) setCachedList('questions', payload.questions);
}

export default function Index() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [access, setAccess] = useState<any>({ role: 'pending', modules: [], capabilities: [], canReadUsers: false, canReviewUsers: false });
  const [dashboard, setDashboard] = useState<DashboardData>({
    todayClasses: 0, todayRevenue: 0, monthRevenue: 0, totalStudents: 0, pendingSync: 0,
  });

  useDidShow(() => {
    checkLogin();
  });

  const checkLogin = async () => {
    const session = captureTrustedAuthSession(authSessionRuntime);
    if (!session) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }

    const savedUser = session.identity as UserInfo;
    setUser({ ...savedUser, name: getMiniappHomeDisplayName(savedUser) });
    if (isUnrecognizedIdentity(savedUser)) {
      await fetchPermissions();
      const nextAccess = getEffectiveMiniappAccess(savedUser);
      setAccess(nextAccess);
      setModules([
        { id: 'scheduling', name: '\u8bfe\u7a0b\u8868', description: '', icon: '' },
        { id: 'question-bank', name: '\u793a\u4f8b\u9898', description: '', icon: '' },
      ]);
      setSnapshot(null);
      setDashboard({ todayClasses: 0, todayRevenue: 0, monthRevenue: 0, totalStudents: 0, pendingSync: 0 });
      setLoading(false);
      return;
    }
    setBusinessCacheIdentity(savedUser);
    const permissionResult = await fetchPermissions();
    const verifiedSession = captureTrustedAuthSession(authSessionRuntime);
    if (!verifiedSession) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    const verifiedUser = verifiedSession.identity as UserInfo;
    setUser({ ...verifiedUser, name: getMiniappHomeDisplayName(verifiedUser) });
    const nextAccess = getEffectiveMiniappAccess(verifiedUser);
    setAccess(nextAccess);
    if (permissionResult.capabilities.length === 0 || nextAccess.modules.length === 0) {
      setModules([]);
      setSnapshot(null);
      setDashboard({ todayClasses: 0, todayRevenue: 0, monthRevenue: 0, totalStudents: 0, pendingSync: 0 });
      setLoading(false);
      return;
    }
    await Promise.all([loadModules(nextAccess), loadDashboard(verifiedUser), loadSnapshot(verifiedUser)]);
  };

  const loadSnapshot = async (currentUser: UserInfo) => {
    if (currentUser.user_type === 'pending') return;
    try {
      const res = await readCloudSnapshot('full');
      const payload = res as any;
      if (res.success) {
        const nextSnapshot = payload.snapshot || payload.data?.snapshot || null;
        cacheSnapshotPayload(nextSnapshot?.payload);
        setSnapshot(nextSnapshot);
      }
    } catch {
      setSnapshot(null);
    }
  };

  const loadModules = async (currentAccess: any) => {
    try {
      const res = await api.get<{ modules: ModuleInfo[] }>('/api/modules');
      if (res.success && res.data) {
        const permittedIds = currentAccess.modules || getPermittedModules();
        const allModules = res.data.modules.filter((m) => permittedIds.includes(m.id));
        setModules(allModules);
      }
    } catch (err) {
      console.error('加载模块失败:', err);
    } finally {
      setLoading(false);
    }
  };

  /** 从本地数据计算仪表盘统计 */
  const loadDashboard = async (authenticatedUser?: UserInfo) => {
    try {
      const students = getLocalData<Student>('students');
      const schedules = getLocalData<Schedule>('schedules');
      const courses = getLocalData<Course>('courses');
      const currentUser = authenticatedUser || user;
      if (!currentUser || currentUser.user_type === 'pending') {
        setDashboard({ todayClasses: 0, todayRevenue: 0, monthRevenue: 0, totalStudents: 0, pendingSync: 0 });
        return;
      }
      const rolePolicy = getMiniappRolePolicy(currentUser);
      const linkedStudentIds = getLinkedStudentIds(currentUser);
      const courseStudentIds = (course?: any) => [
        ...(Array.isArray(course?.student_ids) ? course.student_ids : []),
        ...(Array.isArray(course?.student_pricings) ? course.student_pricings.map((p: any) => p.student_id || p.studentId) : []),
      ].filter(Boolean);
      const identityScoped = scopeDashboardCollections(currentUser, { students, courses, schedules });
      const courseById = new Map(identityScoped.courses.map((course: any) => [course.id, course]));
      const scopedSchedules = rolePolicy.role === 'student'
        ? identityScoped.schedules.filter((schedule: any) => {
          const directStudentIds = [
            ...(Array.isArray(schedule.student_ids) ? schedule.student_ids : []),
            ...(Array.isArray(schedule.student_pricings) ? schedule.student_pricings.map((p: any) => p.student_id || p.studentId) : []),
            ...courseStudentIds(courseById.get(schedule.course_id)),
          ].filter(Boolean);
          return directStudentIds.some((id: string) => linkedStudentIds.includes(id));
        })
        : identityScoped.schedules;
      const scopedStudents = rolePolicy.role === 'student'
        ? identityScoped.students.filter((student: any) => linkedStudentIds.includes(student.id))
        : identityScoped.students;

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

  const formatSnapshotTime = (value?: string) => {
    if (!value) return '等待主机发布';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const hour = String(parsed.getHours()).padStart(2, '0');
    const minute = String(parsed.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hour}:${minute}`;
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
          const currentUser = Taro.getStorageSync('user_info');
          clearAuthenticatedSession({
            invalidateAndAdvance: () => authSessionRuntime.invalidateAndAdvance(),
            clearPermissionCache,
            clearBusinessCache,
            removeStorage: (key: string) => Taro.removeStorageSync(key),
            cleanupStorageKeys: accountSessionCleanupStorageKeys,
          }, [currentUser]);
          Taro.redirectTo({ url: '/pages/login/index' });
        }
      },
    });
  };

  const getUserTypeLabel = (type: string) => {
    const labels: Record<string, string> = { admin: '管理员', teacher: '教师', student: '学生' };
    return labels[type] || type;
  };

  const isStudent = user?.user_type === 'student';
  const showAdminShortcuts = access.modules.includes('scheduling') && !['student', 'pending'].includes(access.role);
  const roleLabel = user ? getUserTypeLabel(user.user_type) : '未登录';
  const greeting = isStudent ? '学习面板' : '运营面板';
  const snapshotLabel = formatSnapshotTime(snapshot?.created_at);
  const userDisplayName = user ? getMiniappHomeDisplayName(user) : '';
  const moduleActions = useMemo(() => (
    modules
      .filter((mod) => MODULE_CONFIG[mod.id])
      .map((mod) => ({ ...mod, config: MODULE_CONFIG[mod.id] }))
  ), [modules]);
  const shortcuts = showAdminShortcuts ? ADMIN_SHORTCUTS : STUDENT_SHORTCUTS;

  if (access.experienceOnly && user) {
    return (
      <View className='home-page'>
        <AccountStatusBanner />
        <View className='home-hero'>
          <View className='home-hero__topline'>
            <Text className='home-brand'>{'\u683c\u7269\u5de5\u574a'}</Text>
            <View className='home-role-pill'><Text className='home-role-pill__text'>{'\u4f53\u9a8c\u8d26\u53f7'}</Text></View>
          </View>
          <View className='home-hero__body'>
            <View className='home-avatar'><Text className='home-avatar__text'>{userDisplayName.charAt(0) || '\u683c'}</Text></View>
            <View className='home-hero__copy'>
              <Text className='home-hero__title'>{userDisplayName}</Text>
              <Text className='home-hero__subtitle'>{'\u53ef\u67e5\u770b\u7a7a\u8bfe\u8868\u3001\u4f7f\u7528\u56db\u9053\u793a\u4f8b\u9898\u5e76\u63d0\u4ea4\u6b63\u5f0f\u8d26\u53f7\u7533\u8bf7\u3002'}</Text>
            </View>
            <View className='home-logout' onClick={handleLogout}><Text className='home-logout__text'>{'\u9000\u51fa'}</Text></View>
          </View>
        </View>
        <View className='home-section'>
          <View className='home-section__header'><Text className='home-section__title'>{'\u53ef\u7528\u529f\u80fd'}</Text><Text className='home-section__meta'>3</Text></View>
          <View className='home-action-list'>
            <View className='home-action-card tone-teal' onClick={() => Taro.switchTab({ url: '/pages/schedule/index' })}><View className='home-module-mark'><Text className='home-module-mark__text'>{'\u8bfe'}</Text></View><View className='home-action-card__body'><Text className='home-action-card__title'>{'\u8bfe\u7a0b\u8868'}</Text><Text className='home-action-card__desc'>{'\u5f53\u524d\u8d26\u53f7\u6682\u65e0\u6b63\u5f0f\u8bfe\u7a0b\u6570\u636e'}</Text></View><Text className='home-action-card__arrow'>{'\u203a'}</Text></View>
            <View className='home-action-card tone-indigo' onClick={() => Taro.navigateTo({ url: '/pages/question-bank/index' })}><View className='home-module-mark'><Text className='home-module-mark__text'>{'\u9898'}</Text></View><View className='home-action-card__body'><Text className='home-action-card__title'>{'\u793a\u4f8b\u9898\u4e0e\u7ec4\u5377'}</Text><Text className='home-action-card__desc'>{'\u56db\u9053\u793a\u4f8b\u9898\u4e0d\u5c5e\u4e8e\u6b63\u5f0f\u9898\u5e93'}</Text></View><Text className='home-action-card__arrow'>{'\u203a'}</Text></View>
            <View className='home-action-card tone-amber' onClick={() => Taro.navigateTo({ url: '/pages/account-application/index' })}><View className='home-module-mark'><Text className='home-module-mark__text'>{'\u7533'}</Text></View><View className='home-action-card__body'><Text className='home-action-card__title'>{'\u7533\u8bf7\u6b63\u5f0f\u8d26\u53f7'}</Text><Text className='home-action-card__desc'>{'\u67e5\u770b\u7533\u8bf7\u72b6\u6001\u6216\u63d0\u4ea4\u771f\u5b9e\u8d44\u6599'}</Text></View><Text className='home-action-card__arrow'>{'\u203a'}</Text></View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="home-page">
      <NetworkStatus onRetry={loadDashboard} />

      <View className="home-hero">
        <View className="home-hero__topline">
          <Text className="home-brand">格物工坊</Text>
          <View className="home-role-pill">
            <Text className="home-role-pill__text">{roleLabel}</Text>
          </View>
        </View>

        <View className="home-hero__body">
          <View className="home-avatar">
            <Text className="home-avatar__text">{user?.name?.charAt(0) || '格'}</Text>
          </View>
          <View className="home-hero__copy">
            {user ? <MembershipBadge membership={user.membership} /> : null}
            <Text className="home-hero__title">{greeting}</Text>
            <Text className="home-hero__subtitle">
              {user ? `${user.name}` : '登录后查看今日课程与授权数据。'}
              {false && (
                <View className="member-badge">
                  <Text className="member-text">会员</Text>
                </View>
              )}
              {user ? '，今天先看课程、题库和数据快照。' : ''}
            </Text>
          </View>
          {user && (
            <View className="home-logout" onClick={handleLogout}>
              <Text className="home-logout__text">退出</Text>
            </View>
          )}
        </View>

        <View className="home-status-panel">
          <View className="home-status-panel__item">
            <Text className="home-status-panel__label">数据快照</Text>
            <Text className="home-status-panel__value">{snapshotLabel}</Text>
          </View>
          <View className="home-status-panel__divider" />
          <View className="home-status-panel__item">
            <Text className="home-status-panel__label">同步状态</Text>
            <Text className="home-status-panel__value">{dashboard.pendingSync > 0 ? `${dashboard.pendingSync} 条待同步` : '本地可用'}</Text>
          </View>
        </View>
      </View>

      <View className="home-metric-grid">
        <View className="home-metric-card tone-teal">
          <Text className="home-metric-card__label">今日课程</Text>
          <View className="home-metric-card__value-row">
            <Text className="home-metric-card__value">{dashboard.todayClasses}</Text>
            <Text className="home-metric-card__suffix">节</Text>
          </View>
        </View>
        <View className="home-metric-card tone-green">
          <Text className="home-metric-card__label">今日收入</Text>
          <Text className="home-metric-card__value">{formatMoney(dashboard.todayRevenue)}</Text>
        </View>
        <View className="home-metric-card tone-indigo">
          <Text className="home-metric-card__label">本月收入</Text>
          <Text className="home-metric-card__value">{formatMoney(dashboard.monthRevenue)}</Text>
        </View>
        <View className="home-metric-card tone-amber">
          <Text className="home-metric-card__label">学生总数</Text>
          <View className="home-metric-card__value-row">
            <Text className="home-metric-card__value">{dashboard.totalStudents}</Text>
            <Text className="home-metric-card__suffix">人</Text>
          </View>
        </View>
      </View>

      <View className="home-section">
        <View className="home-section__header">
          <Text className="home-section__title">核心入口</Text>
          <Text className="home-section__meta">{moduleActions.length} 个可用</Text>
        </View>
        {loading ? (
          <LoadingSkeleton rows={2} avatar />
        ) : modules.length === 0 ? (
          <EmptyState icon="空" text="暂无可访问的模块" />
        ) : (
          <View className="home-action-list">
            {moduleActions.map((mod) => {
              const config = mod.config;
              return (
                <View key={mod.id} className={`home-action-card tone-${config.tone}`} onClick={() => handleModuleClick(mod)}>
                  <View className="home-module-mark">
                    <Text className="home-module-mark__text">{config.mark}</Text>
                  </View>
                  <View className="home-action-card__body">
                    <Text className="home-action-card__title">{mod.name}</Text>
                    <Text className="home-action-card__desc">{config.action || mod.description}</Text>
                  </View>
                  <Text className="home-action-card__arrow">›</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {loading ? null : modules.some(m => m.id === 'scheduling') && (
        <View className="home-section">
          <View className="home-section__header">
            <Text className="home-section__title">{isStudent ? '我的学习' : '运营快捷入口'}</Text>
            <Text className="home-section__meta">{isStudent ? '只读与组卷' : '常用管理'}</Text>
          </View>
          <View className="home-shortcut-grid">
            {shortcuts.map((item) => (
              <View key={item.url} className="home-shortcut-card" onClick={() => Taro.navigateTo({ url: item.url })}>
                <Text className="home-shortcut-card__mark">{item.mark}</Text>
                <Text className="home-shortcut-card__title">{item.label}</Text>
                <Text className="home-shortcut-card__desc">{item.desc}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {!loading && access.canReadUsers && (
        <View className="home-section">
          <View className="home-section__header">
            <Text className="home-section__title">权限管理</Text>
            <Text className="home-section__meta">{access.canReviewUsers ? '\u5ba1\u6838\u4e0e\u5206\u7c7b' : '\u53ea\u8bfb\u67e5\u770b'}</Text>
          </View>
          <View className="home-admin-list">
            <View className="home-admin-row" onClick={() => Taro.navigateTo({ url: '/pages/admin/users/index' })}>
              <Text className="home-admin-row__mark">员</Text>
              <View className="home-admin-row__body">
                <Text className="home-admin-row__title">{'\u7528\u6237\u6743\u9650'}</Text>
                <Text className="home-admin-row__desc">{access.canReviewUsers ? '\u5ba1\u6838\u7528\u6237\u7c7b\u578b\u4e0e\u8001\u5e08\u7ed1\u5b9a' : '\u67e5\u770b\u7528\u6237\u7c7b\u578b\u4e0e\u72b6\u6001'}</Text>
              </View>
              <Text className="home-admin-row__arrow">›</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
