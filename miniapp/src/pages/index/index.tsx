/**
 * 首页仪表盘 v3 - 最近更新 + 今日摘要 + 角色入口
 */
import { useState, useCallback, useMemo, useRef } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { authSessionRuntime } from '../../utils/authSession';
import { captureTrustedAuthSession, clearAuthenticatedSession } from '../../utils/miniappApiSessionRuntime';
import { accountSessionCleanupStorageKeys, isVisitorIdentity } from '../../utils/accountExperience';
import {
  clearPermissionCache,
  fetchPermissions,
  getEffectiveMiniappAccess,
  getMiniappRolePolicy,
  MiniappCapability,
  MiniappRole,
} from '../../utils/permission';
import { getLocalData, pullFromCloudBusinessProjection } from '../../utils/sync';
import { shanghaiDateKey } from '../../utils/cloudBusinessProjection';
import { clearBusinessCache, setBusinessCacheIdentity } from '../../utils/storage';
import { getMiniappHomeDisplayName, getMiniappHomeRoleLabel } from '../../utils/miniappHomePresentation';
import { NetworkStatus, LoadingSkeleton, EmptyState } from '../../components/shared';
import MembershipBadge from '../../components/MembershipBadge';
import { Schedule, ScheduleStatus, Student, Course } from '../../types';
import './index.scss';

interface UserInfo {
  id: string;
  name?: string;
  nickname?: string;
  user_type: MiniappRole;
  avatar?: string;
  account_state?: 'formal' | 'visitor';
  token_use?: 'miniapp-cloud' | 'miniapp-visitor';
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
  courseCount: number;
  pendingSync: number;
}

const MODULE_CONFIG: Record<string, { mark: string; tone: string; pages: string; action: string }> = {
  scheduling: { mark: '课', tone: 'teal', pages: '/pages/schedule/index', action: '查看课程安排' },
  'question-bank': { mark: '题', tone: 'indigo', pages: '/pages/question-bank/index', action: '查看题库' },
  assets: { mark: '账', tone: 'amber', pages: '/pages/assets/index', action: '财务导入与统计' },
};

const STAFF_SHORTCUTS = [
  { mark: '生', label: '学生资料', desc: '查看学生与课程信息', url: '/pages/students/index' },
  { mark: '课', label: '课程资料', desc: '查看课程、班型与收费', url: '/pages/courses/index' },
  { mark: '缴', label: '缴费记录', desc: '查看付款与课消记录', url: '/pages/payments/index' },
  { mark: '统', label: '数据统计', desc: '查看收入、课时和趋势', url: '/pages/stats/index' },
];

const STUDENT_SHORTCUTS = [
  { mark: '表', label: '我的课表', desc: '查看本人相关课程', url: '/pages/schedule/index' },
  { mark: '题', label: '题库', desc: '查看题目与解析', url: '/pages/question-bank/index' },
];

export default function Index() {
  const homeLoadGeneration = useRef(0);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [cloudConnection, setCloudConnection] = useState<'checking' | 'connected' | 'unavailable'>('checking');
  const [access, setAccess] = useState<any>({ role: 'visitor', modules: [], capabilities: [] });
  const [dashboard, setDashboard] = useState<DashboardData>({
    todayClasses: 0, todayRevenue: 0, monthRevenue: 0, totalStudents: 0, courseCount: 0, pendingSync: 0,
  });

  useDidShow(() => {
    checkLogin();
  });

  const checkLogin = async () => {
    const generation = ++homeLoadGeneration.current;
    const stillCurrent = () => homeLoadGeneration.current === generation;
    setUser(null);
    setModules([]);
    setLoading(true);
    setSnapshot(null);
    setCloudConnection('checking');
    setAccess({ role: 'visitor', modules: [], capabilities: [] });
    setDashboard({ todayClasses: 0, todayRevenue: 0, monthRevenue: 0, totalStudents: 0, courseCount: 0, pendingSync: 0 });
    const session = captureTrustedAuthSession(authSessionRuntime);
    if (!session) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }

    const savedUser = session.identity as UserInfo;
    setUser({ ...savedUser, name: getMiniappHomeDisplayName(savedUser) });
    if (isVisitorIdentity(savedUser)) {
      const policy = getMiniappRolePolicy(savedUser);
      const nextAccess = policy;
      setAccess(nextAccess);
      setModules([
        { id: 'scheduling', name: '\u8bfe\u7a0b\u8868', description: '', icon: '' },
        { id: 'question-bank', name: '\u9898\u5e93', description: '', icon: '' },
      ]);
      setSnapshot(null);
      setCloudConnection('unavailable');
      setDashboard({ todayClasses: 0, todayRevenue: 0, monthRevenue: 0, totalStudents: 0, courseCount: 0, pendingSync: 0 });
      setLoading(false);
      return;
    }
    setBusinessCacheIdentity(savedUser);
    const verifiedSession = captureTrustedAuthSession(authSessionRuntime);
    if (!verifiedSession) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    await fetchPermissions();
    if (!stillCurrent()) return;
    const confirmedSession = captureTrustedAuthSession(authSessionRuntime);
    if (!confirmedSession) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    const confirmedUser = confirmedSession.identity as UserInfo;
    setUser({ ...confirmedUser, name: getMiniappHomeDisplayName(confirmedUser) });
    const nextAccess = getEffectiveMiniappAccess(confirmedUser);
    setAccess(nextAccess);
    if (nextAccess.modules.length === 0) {
      setModules([]);
      setSnapshot(null);
      setCloudConnection('unavailable');
      setDashboard({ todayClasses: 0, todayRevenue: 0, monthRevenue: 0, totalStudents: 0, courseCount: 0, pendingSync: 0 });
      setLoading(false);
      return;
    }
    await loadSnapshot(confirmedUser, stillCurrent);
    if (!stillCurrent()) return;
    await Promise.all([loadModules(nextAccess, stillCurrent), loadDashboard(confirmedUser, stillCurrent)]);
  };

  const loadSnapshot = async (currentUser: UserInfo, stillCurrent: () => boolean = () => true) => {
    try {
      const refreshed = await pullFromCloudBusinessProjection();
      if (stillCurrent()) {
        setSnapshot(refreshed ? { created_at: new Date().toISOString() } : null);
        setCloudConnection(refreshed ? 'connected' : 'unavailable');
      }
    } catch (error) {
      console.warn('[CLOUD_BUSINESS_PROJECTION_LOAD_FAILED]', error);
      if (stillCurrent()) {
        setSnapshot(null);
        setCloudConnection('unavailable');
      }
    }
  };

  const loadModules = async (currentAccess: any, stillCurrent: () => boolean = () => true) => {
    try {
      const cloudModuleNames: Record<string, string> = {
        scheduling: '\u8bfe\u7a0b\u5b89\u6392',
        'question-bank': '\u9898\u5e93',
        assets: '\u8d22\u52a1\u5bfc\u5165',
      };
      const res = { success: true, data: { modules: Object.keys(MODULE_CONFIG).map(id => ({ id, name: cloudModuleNames[id] || id, description: '', icon: '' })) } };
      if (res.success && res.data) {
        const permittedIds = currentAccess.modules || [];
        const allModules = res.data.modules.filter((m) => permittedIds.includes(m.id));
        if (stillCurrent()) setModules(allModules);
      }
    } catch (err) {
      console.error('加载模块失败:', err);
    } finally {
      if (stillCurrent()) setLoading(false);
    }
  };

  /** 从本地数据计算仪表盘统计 */
  const loadDashboard = async (authenticatedUser?: UserInfo, stillCurrent: () => boolean = () => true) => {
    try {
      const students = getLocalData<Student>('students');
      const schedules = getLocalData<Schedule>('schedules');
      const courses = getLocalData<Course>('courses');
      const currentUser = authenticatedUser || user;
      if (!currentUser) {
        if (stillCurrent()) setDashboard({ todayClasses: 0, todayRevenue: 0, monthRevenue: 0, totalStudents: 0, courseCount: 0, pendingSync: 0 });
        return;
      }
      const rolePolicy = getMiniappRolePolicy(currentUser);
      const scopedSchedules = schedules;
      const scopedStudents = students;

      const today = shanghaiDateKey(new Date());
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

      if (stillCurrent()) setDashboard({
        todayClasses,
        todayRevenue,
        monthRevenue,
        totalStudents: scopedStudents.length,
        courseCount: courses.length,
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
    if (!value) return '云端数据待载入';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const hour = String(parsed.getHours()).padStart(2, '0');
    const minute = String(parsed.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hour}:${minute}`;
  };

  const handleModuleClick = useCallback((mod: ModuleInfo) => {
    if (!access.modules.includes(mod.id)) {
      Taro.navigateTo({ url: '/pages/forbidden/index' });
      return;
    }
    const config = MODULE_CONFIG[mod.id];
    if (!config?.pages) {
      Taro.navigateTo({ url: '/pages/forbidden/index' });
      return;
    }
    Taro.navigateTo({ url: config.pages });
  }, [access.modules]);

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

  const isStudent = user?.user_type === 'student';
  const showStaffShortcuts = access.modules.includes('scheduling') && !['student', 'visitor'].includes(access.role);
  const roleLabel = user ? getMiniappHomeRoleLabel(user.user_type) : '未登录';
  const greeting = user?.user_type === "super_admin" ? "运营面板" : isStudent ? "学习面板" : "教学面板";
  const visibleRoleLabel = user ? getMiniappHomeRoleLabel(user) : roleLabel;
  const snapshotLabel = formatSnapshotTime(snapshot?.created_at);
  const userDisplayName = user ? getMiniappHomeDisplayName(user) : '';
  const visitor = isVisitorIdentity(user);
  const moduleActions = useMemo(() => (
    modules
      .filter((mod) => MODULE_CONFIG[mod.id])
      .map((mod) => ({ ...mod, config: MODULE_CONFIG[mod.id] }))
  ), [modules]);
  const shortcuts = showStaffShortcuts ? STAFF_SHORTCUTS : STUDENT_SHORTCUTS;

  if (visitor && user) {
    return (
      <View className='home-page'>
        <View className='home-hero'>
          <View className='home-hero__topline'>
            <Text className='home-brand'>{'\u683c\u7269\u5de5\u574a'}</Text>
            {null}
          </View>
          <View className='home-hero__body'>
            <View className='home-avatar'><Text className='home-avatar__text'>{userDisplayName.charAt(0) || '\u683c'}</Text></View>
            <View className='home-hero__copy'>
              <Text className='home-hero__title'>{userDisplayName}</Text>
              <Text className='home-hero__subtitle'>{'\u67e5\u770b\u8bfe\u7a0b\u5b89\u6392\u548c\u9898\u5e93\u5185\u5bb9\uff0c\u6216\u7533\u8bf7\u89d2\u8272\u3002'}</Text>
            </View>
            <View className='home-logout' onClick={handleLogout}><Text className='home-logout__text'>{'\u9000\u51fa'}</Text></View>
          </View>
        </View>
        <View className='home-section'>
          <View className='home-section__header'><Text className='home-section__title'>{'\u53ef\u7528\u529f\u80fd'}</Text><Text className='home-section__meta'>{'3'}</Text></View>
          <View className='home-action-list'>
            <View className='home-action-card tone-teal' onClick={() => Taro.switchTab({ url: '/pages/schedule/index' })}><View className='home-module-mark'><Text className='home-module-mark__text'>{'\u8bfe'}</Text></View><View className='home-action-card__body'><Text className='home-action-card__title'>{'\u8bfe\u7a0b\u8868'}</Text><Text className='home-action-card__desc'>{'\u67e5\u770b\u8bfe\u7a0b\u5b89\u6392\u3002'}</Text></View><Text className='home-action-card__arrow'>{'\u203a'}</Text></View>
            <View className='home-action-card tone-indigo' onClick={() => Taro.switchTab({ url: '/pages/question-bank/index' })}><View className='home-module-mark'><Text className='home-module-mark__text'>{'\u9898'}</Text></View><View className='home-action-card__body'><Text className='home-action-card__title'>{'\u9898\u5e93'}</Text><Text className='home-action-card__desc'>{'\u6d4f\u89c8\u5df2\u5f00\u653e\u7684\u9898\u76ee\u3002'}</Text></View><Text className='home-action-card__arrow'>{'\u203a'}</Text></View>
            <View className='home-action-card tone-amber' onClick={() => Taro.navigateTo({ url: '/pages/account-application/index' })}><View className='home-module-mark'><Text className='home-module-mark__text'>{'\u7533'}</Text></View><View className='home-action-card__body'><Text className='home-action-card__title'>{'\u7533\u8bf7\u89d2\u8272'}</Text><Text className='home-action-card__desc'>{'\u9009\u62e9\u6559\u5e08\u3001\u5b66\u751f\u6216\u5bb6\u5ead\u6210\u5458\u3002'}</Text></View><Text className='home-action-card__arrow'>{'\u203a'}</Text></View>
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
            <Text className="home-role-pill__text">{visibleRoleLabel}</Text>
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
              {user ? `${user.name}` : '登录后查看今天的课程。'}

              {user ? '，今天看看课程和题库。' : ''}
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
            <Text className="home-status-panel__label">最近更新</Text>
            <Text className="home-status-panel__value">{snapshotLabel}</Text>
          </View>
          <View className="home-status-panel__divider" />
          <View className="home-status-panel__item">
            <Text className="home-status-panel__label">联网状态</Text>
            <Text className="home-status-panel__value">{cloudConnection === 'connected'
              ? '\u5df2\u8054\u7f51'
              : cloudConnection === 'unavailable'
                ? '\u6682\u65f6\u65e0\u6cd5\u8054\u7f51'
                : '\u6b63\u5728\u8fde\u63a5'}</Text>
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
          <Text className="home-metric-card__label">{isStudent ? '已关联课程' : '今日收入'}</Text>
          <Text className="home-metric-card__value">{isStudent ? dashboard.courseCount : formatMoney(dashboard.todayRevenue)}</Text>
        </View>
        {!isStudent && <View className="home-metric-card tone-indigo">
          <Text className="home-metric-card__label">本月收入</Text>
          <Text className="home-metric-card__value">{formatMoney(dashboard.monthRevenue)}</Text>
        </View>}
        {!isStudent && <View className="home-metric-card tone-amber">
          <Text className="home-metric-card__label">学生总数</Text>
          <View className="home-metric-card__value-row">
            <Text className="home-metric-card__value">{dashboard.totalStudents}</Text>
            <Text className="home-metric-card__suffix">人</Text>
          </View>
        </View>}
      </View>

      <View className="home-section">
        <View className="home-section__header">
          <Text className="home-section__title">常用功能</Text>
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
            <Text className="home-section__title">{isStudent ? '我的学习' : '教学工具'}</Text>
            <Text className="home-section__meta">{isStudent ? '常用内容' : '常用资料'}</Text>
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


    </View>
  );
}
