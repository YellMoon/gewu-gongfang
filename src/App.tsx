import React, { Suspense, useState, useEffect } from 'react';
import { Button, Card, Table, Tag, Empty } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import ScheduleList from './pages/ScheduleList';
import StudentList from './pages/StudentList';
import TeacherList from './pages/TeacherList';
import CourseList from './pages/CourseList';
import PaymentList from './pages/PaymentList';
import InstitutionManager from './pages/InstitutionManager';
import RevenueStatistics from './pages/RevenueStatistics';
import SystemSettings from './pages/SystemSettings';
import SchoolManager from './pages/SchoolManager';
import RoomManager from './pages/RoomManager';
import PersonalAssets from './pages/PersonalAssets';
import PermissionManager from './pages/PermissionManager';
import SyncSettings from './pages/SyncSettings';
import MenuManage from './pages/MenuManage';
import OperateLog from './pages/OperateLog';
import ErrorBoundary from './components/ErrorBoundary';
import AdminLogin from './pages/AdminLogin';
import Admin from './pages/Admin';
import TodayWorkbench from './pages/TodayWorkbench';
import QuestionBasket from './components/QuestionBasket';
import AppShell from './layout/AppShell';
import { PageKey, questionBankPages } from './navigation/appNavigation';
import { NavigationContext, NavigationInput, normalizeNavigationTarget } from './navigation/navigationContext';

const ScheduleCalendar = React.lazy(() => import('./pages/ScheduleCalendar'));
const QuestionBankTools = React.lazy(() => import('./pages/QuestionBankTools'));
const QuestionBankImport = React.lazy(() => import('./pages/QuestionBankImport'));
const QuestionBankPreview = React.lazy(() => import('./pages/QuestionBankPreview'));
const QuestionBankEdit = React.lazy(() => import('./pages/QuestionBankEdit'));
const QuestionBankPaper = React.lazy(() => import('./pages/QuestionBankPaper'));
const AuditCenter = React.lazy(() => import('./pages/AuditCenter'));


const PageLoading: React.FC = () => (
  <div style={{ padding: 50, textAlign: 'center', fontSize: 16 }}>
    页面加载中...
  </div>
);

const LazyPage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ErrorBoundary>
    <Suspense fallback={<PageLoading />}>
      {children}
    </Suspense>
  </ErrorBoundary>
);

const DEFAULT_PAGE: PageKey = 'today';

let dbService: any = null;

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<PageKey>(DEFAULT_PAGE);
  const [pageContext, setPageContext] = useState<NavigationContext>(undefined);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminLoginKey, setAdminLoginKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('Global error:', event.error);
      setError(event.error?.message || '未知错误');
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const target = normalizeNavigationTarget((event as CustomEvent<NavigationInput>).detail);
      if (target.page) {
        setCurrentPage(target.page);
        setPageContext(target.context);
      }
    };
    window.addEventListener('navigate-page', onNavigate as EventListener);
    return () => window.removeEventListener('navigate-page', onNavigate as EventListener);
  }, []);

  useEffect(() => {
    const loadDb = async () => {
      try {
        if (!dbService) {
          const dbModule = await import('./services/browserDatabase');
          dbService = dbModule.default;
        }
        (window as any).dbService = dbService;
        console.log('Database service loaded successfully');
        setDbLoaded(true);
      } catch (error) {
        console.error('Failed to load database service:', error);
        setDbLoaded(true);
      }
    };
    loadDb();
  }, []);

  const navigateTo = (input: NavigationInput) => {
    const target = normalizeNavigationTarget(input);
    setCurrentPage(target.page);
    setPageContext(target.context);
  };

  const refreshCurrentPage = () => {
    setRefreshKey((key) => key + 1);
  };

  const renderPage = () => {
    if (error) {
      return (
        <div style={{ padding: 50, textAlign: 'center', fontSize: 16, color: 'red' }}>
          <h3>系统错误</h3>
          <p>{error}</p>
          <p style={{ fontSize: 12, color: '#666' }}>请刷新页面或重启应用</p>
        </div>
      );
    }

    if (!dbLoaded) {
      return (
        <div style={{ padding: 50, textAlign: 'center', fontSize: 16 }}>
          系统加载中...
        </div>
      );
    }

    switch (currentPage) {
      case 'today': return <TodayWorkbench onNavigate={navigateTo} />;
      case 'course-calendar': return <LazyPage><ScheduleCalendar context={pageContext as any} /></LazyPage>;
      case 'schedule-list': return <ScheduleList />;
      case 'course-info': return <CourseList />;
      case 'student': return <StudentList />;
      case 'teacher': return <TeacherList />;
      case 'school': return <SchoolManager />;
      case 'address': return <RoomManager />;
      case 'institution': return <InstitutionManager />;
      case 'payment': return <PaymentList />;
      case 'revenue-statistics': return <RevenueStatistics context={pageContext as any} />;
      case 'question-bank-tools': return <LazyPage><QuestionBankTools onNavigate={navigateTo} context={pageContext as any} /></LazyPage>;
      case 'question-bank-import': return <LazyPage><QuestionBankImport /></LazyPage>;
      case 'question-bank-preview': return <LazyPage><QuestionBankPreview /></LazyPage>;
      case 'question-bank-edit': return <LazyPage><QuestionBankEdit /></LazyPage>;
      case 'question-bank-audit': return <LazyPage><AuditCenter /></LazyPage>;
      case 'question-bank-paper': return <LazyPage><QuestionBankPaper /></LazyPage>;

      case 'personal-assets': return <PersonalAssets />;
      case 'permission': return <PermissionManager />;
      case 'cloud-sync': return <ErrorBoundary><SyncSettings context={pageContext as any} /></ErrorBoundary>;
      case 'system-params': return <SystemSettings />;
      case 'admin': {
        const isLoggedIn = sessionStorage.getItem('admin_logged_in') === 'true';
        if (!isLoggedIn) {
          return (
            <AdminLogin
              key={adminLoginKey}
              onLoginSuccess={() => setAdminLoginKey((k) => k + 1)}
            />
          );
        }
        return <Admin />;
      }
      case 'invitee': return (
        <InviteeManager onNavigate={navigateTo} />
      );
      case 'menu-manage': return <MenuManage />;
      case 'operate-log': return <OperateLog />;
      default: return (
        <div style={{ padding: '200px', textAlign: 'center', color: '#999' }}>
          <h2>「{currentPage}」功能开发中...</h2>
        </div>
      );
    }
  };

  return (
    <AppShell currentPage={currentPage} onNavigate={navigateTo} onRefresh={refreshCurrentPage}>
      <div key={`${currentPage}-${refreshKey}`}>
        {renderPage()}
      </div>
      <QuestionBasket visible={questionBankPages.includes(currentPage)} />
    </AppShell>
  );
};

// ====== 被邀请者管理页面组件 ======
interface InviteeEntry {
  id: string;
  userType: string;
  userId: string;
  userName: string;
  module: string;
  permissionLevel: string;
  grantTime: string;
  expireTime: string;
}

interface InviteCode {
  code: string;
  created_at: string;
  used: boolean;
  used_by: string;
}

const InviteeManager: React.FC<{ onNavigate: (page: PageKey) => void }> = ({ onNavigate }) => {
  const [permissions, setPermissions] = useState<InviteeEntry[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('permissions_data');
      const allPerms: InviteeEntry[] = raw ? JSON.parse(raw) : [];
      setPermissions(allPerms.filter(p => p.userType === 'invitee'));
    } catch {
      setPermissions([]);
    }
    try {
      const raw = localStorage.getItem('invite_codes_geworks');
      setInviteCodes(raw ? JSON.parse(raw) : []);
    } catch {
      setInviteCodes([]);
    }
  }, []);

  const uniqueInvitees = React.useMemo(() => {
    const map = new Map<string, { userName: string; modules: string[]; expireTime: string; grantTime: string }>();
    permissions.forEach(p => {
      if (!map.has(p.userId)) {
        map.set(p.userId, { userName: p.userName, modules: [], expireTime: p.expireTime, grantTime: p.grantTime });
      }
      const entry = map.get(p.userId)!;
      entry.modules.push(p.module);
    });
    return Array.from(map.entries()).map(([userId, info]) => ({ userId, ...info }));
  }, [permissions]);

  const formatDate = (isoStr: string) => {
    if (!isoStr) return '永久';
    try { return new Date(isoStr).toLocaleDateString('zh-CN'); } catch { return isoStr; }
  };

  return (
    <div style={{ padding: 20, maxWidth: 1000 }}>
      <h3 style={{ marginBottom: 16 }}>被邀请者管理</h3>

      {/* 提示横幅 */}
      <div style={{
        padding: '12px 16px',
        background: '#e6f7ff',
        border: '1px solid #91d5ff',
        borderRadius: 8,
        marginBottom: 16,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ color: '#1890ff' }}>
          被邀请者权限由「权限管理」模块统一控制。先创建邀请码，被邀请者使用邀请码注册后，在权限管理中分配功能模块访问权限。
        </span>
        <Button type="primary" size="small" onClick={() => onNavigate('permission')}>
          前往权限管理
        </Button>
      </div>

      {/* 邀请码区域 */}
      <Card title="邀请码列表" size="small" style={{ marginBottom: 16 }} extra={
        <Tag color={inviteCodes.length > 0 ? 'blue' : 'default'}>{inviteCodes.length} 个</Tag>
      }>
        {inviteCodes.length === 0 ? (
          <Empty description="暂无邀请码，请前往权限管理生成" />
        ) : (
          <Table
            dataSource={inviteCodes}
            rowKey="code"
            pagination={false}
            size="small"
            columns={[
              { title: '邀请码', dataIndex: 'code', key: 'code', width: 200,
                render: (code: string) => <code style={{ fontSize: 16, fontWeight: 'bold', letterSpacing: 2 }}>{code}</code> },
              { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 180,
                render: (t: string) => t ? new Date(t).toLocaleString('zh-CN') : '-' },
              { title: '状态', dataIndex: 'used', key: 'used', width: 100,
                render: (used: boolean) => used ? <Tag color="red">已使用</Tag> : <Tag color="green">未使用</Tag> },
              { title: '使用者', dataIndex: 'used_by', key: 'used_by', width: 150,
                render: (by: string) => by || '-' },
            ]}
          />
        )}
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <Button type="link" icon={<LinkOutlined />} onClick={() => onNavigate('permission')}>
            在权限管理中生成邀请码
          </Button>
        </div>
      </Card>

      {/* 被邀请者权限列表 */}
      <Card title="已授权的被邀请者" size="small" extra={
        <Tag color={uniqueInvitees.length > 0 ? 'green' : 'default'}>{uniqueInvitees.length} 人</Tag>
      }>
        {uniqueInvitees.length === 0 ? (
          <Empty description="暂无被邀请者权限设置，请前往权限管理添加" />
        ) : (
          <Table
            dataSource={uniqueInvitees}
            rowKey="userId"
            pagination={{ pageSize: 10 }}
            size="small"
            columns={[
              { title: '用户名', dataIndex: 'userName', key: 'userName', width: 150 },
              { title: '授权模块', dataIndex: 'modules', key: 'modules',
                render: (modules: string[]) => modules.map(m => <Tag key={m} style={{ marginBottom: 2 }}>{m}</Tag>) },
              { title: '授权时间', dataIndex: 'grantTime', key: 'grantTime', width: 120,
                render: formatDate },
              { title: '到期时间', dataIndex: 'expireTime', key: 'expireTime', width: 120,
                render: formatDate },
            ]}
          />
        )}
      </Card>
    </div>
  );
};

export default App;
