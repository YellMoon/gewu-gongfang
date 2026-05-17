import React, { Suspense, useState, useEffect } from 'react';
import { Layout, Button, Card, Table, Tag, Empty } from 'antd';
import {
  CalendarOutlined,
  TeamOutlined,
  BookOutlined,
  DollarOutlined,
  SettingOutlined,
  DatabaseOutlined,
  ToolOutlined,
  UserOutlined,
  FileTextOutlined,
  FileWordOutlined,
  BarChartOutlined,
  LockOutlined,
  MenuOutlined,
  UploadOutlined,
  LinkOutlined,
  EditOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons';
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
import QuestionBasket from './components/QuestionBasket';


const { Header, Content } = Layout;

const ScheduleCalendar = React.lazy(() => import('./pages/ScheduleCalendar'));
const QuestionBankImport = React.lazy(() => import('./pages/QuestionBankImport'));
const QuestionBankPreview = React.lazy(() => import('./pages/QuestionBankPreview'));
const QuestionBankEdit = React.lazy(() => import('./pages/QuestionBankEdit'));
const QuestionBankPaper = React.lazy(() => import('./pages/QuestionBankPaper'));
const AuditCenter = React.lazy(() => import('./pages/AuditCenter'));
const TeachingTools = React.lazy(() => import('./pages/TeachingTools'));

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

const QUESTION_BANK_PAGES: PageKey[] = [
  'question-bank-import',
  'question-bank-preview',
  'question-bank-edit',
  'question-bank-paper',
  'question-bank-audit',
];

type PageKey =
  | 'course-calendar' | 'schedule-list' | 'course-info'
  | 'school' | 'address' | 'institution'
  | 'question-bank-import' | 'question-bank-preview' | 'question-bank-edit' | 'question-bank-paper' | 'question-bank-audit' | 'teaching-tool'
  | 'payment' | 'revenue-statistics' | 'personal-assets'
  | 'admin' | 'teacher' | 'student' | 'invitee' | 'permission'
  | 'menu-manage'  | 'system-params' | 'operate-log'
  | 'cloud-sync';

interface MenuItem {
  key: PageKey;
  label: string;
  icon: React.ReactNode;
}

interface MenuGroup {
  label: string;
  icon?: React.ReactNode;
  items: MenuItem[];
}

const MENU_GROUPS: MenuGroup[] = [
  {
    label: '教务管理',
    icon: <CalendarOutlined />,
    items: [
      { key: 'course-calendar', label: '课程表', icon: <CalendarOutlined /> },
      { key: 'schedule-list', label: '排课列表', icon: <FileTextOutlined /> },
      { key: 'course-info', label: '课程信息', icon: <BookOutlined /> },
      { key: 'institution', label: '机构', icon: <TeamOutlined /> },
      { key: 'school', label: '学校', icon: <TeamOutlined /> },
      { key: 'address', label: '上课地址', icon: <TeamOutlined /> },
    ],
  },
  {
    label: '题库',
    icon: <DatabaseOutlined />,
    items: [
      { key: 'question-bank-import', label: '试题导入', icon: <UploadOutlined /> },
      { key: 'question-bank-preview', label: '试题预览', icon: <FileTextOutlined /> },
      { key: 'question-bank-edit', label: '试题编辑', icon: <EditOutlined /> },
      { key: 'question-bank-audit', label: '审核中心', icon: <SafetyCertificateOutlined /> },
      { key: 'question-bank-paper', label: '组卷', icon: <FileWordOutlined /> }
    ]
  },
  {
    label: '教学工具',
    icon: <ToolOutlined />,
    items: [
      { key: 'teaching-tool', label: '教学工具', icon: <ToolOutlined /> }
    ]
  },
  {
    label: '财务',
    icon: <DollarOutlined />,
    items: [
      { key: 'payment', label: '缴费', icon: <DollarOutlined /> },
      { key: 'revenue-statistics', label: '费用统计', icon: <BarChartOutlined /> },
      { key: 'personal-assets', label: '个人资产统计', icon: <DatabaseOutlined /> }
    ],
  },
  {
    label: '用户管理',
    icon: <UserOutlined />,
    items: [
      { key: 'admin', label: '管理员', icon: <UserOutlined /> },
      { key: 'teacher', label: '老师', icon: <TeamOutlined /> },
      { key: 'student', label: '学生', icon: <UserOutlined /> },
      { key: 'invitee', label: '被邀请者', icon: <UserOutlined /> },
      { key: 'permission', label: '权限管理', icon: <LockOutlined /> }
    ],
  },
  {
    label: '云同步',
    icon: <DatabaseOutlined />,
    items: [
      { key: 'cloud-sync', label: '云同步', icon: <DatabaseOutlined /> }
    ]
  },
  {
    label: '系统管理',
    icon: <SettingOutlined />,
    items: [
      { key: 'menu-manage', label: '菜单结构管理', icon: <MenuOutlined /> },
      { key: 'system-params', label: '系统参数', icon: <SettingOutlined /> },
      { key: 'operate-log', label: '操作日志', icon: <FileTextOutlined /> },
    ],
  },
];

const DEFAULT_PAGE: PageKey = 'course-calendar';

let dbService: any = null;

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<PageKey>(DEFAULT_PAGE);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);
  const [adminLoginKey, setAdminLoginKey] = useState(0);
  const dropdownTimerRef = React.useRef<number | null>(null);

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
      const page = (event as CustomEvent<PageKey>).detail;
      if (page) {
        setCurrentPage(page);
        setOpenDropdown(null);
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

  const handleDropdownEnter = (idx: number, itemCount: number) => {
    // 清空关闭定时器
    if (dropdownTimerRef.current) {
      clearTimeout(dropdownTimerRef.current);
      dropdownTimerRef.current = null;
    }
    // 只有1个菜单项的组不需要下拉框，关闭其他已打开的下拉框
    if (itemCount <= 1) {
      setOpenDropdown(null);
      return;
    }
    setOpenDropdown(idx);
  };

  const handleDropdownLeave = () => {
    dropdownTimerRef.current = window.setTimeout(() => {
      setOpenDropdown(null);
    }, 200);
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
      case 'course-calendar': return <LazyPage><ScheduleCalendar /></LazyPage>;
      case 'schedule-list': return <ScheduleList />;
      case 'course-info': return <CourseList />;
      case 'student': return <StudentList />;
      case 'teacher': return <TeacherList />;
      case 'school': return <SchoolManager />;
      case 'address': return <RoomManager />;
      case 'institution': return <InstitutionManager />;
      case 'payment': return <PaymentList />;
      case 'revenue-statistics': return <RevenueStatistics />;
      case 'question-bank-import': return <LazyPage><QuestionBankImport /></LazyPage>;
      case 'question-bank-preview': return <LazyPage><QuestionBankPreview /></LazyPage>;
      case 'question-bank-edit': return <LazyPage><QuestionBankEdit /></LazyPage>;
      case 'question-bank-audit': return <LazyPage><AuditCenter /></LazyPage>;
      case 'question-bank-paper': return <LazyPage><QuestionBankPaper /></LazyPage>;
      case 'teaching-tool': return <LazyPage><TeachingTools /></LazyPage>;
      case 'personal-assets': return <PersonalAssets />;
      case 'permission': return <PermissionManager />;
      case 'cloud-sync': return <ErrorBoundary><SyncSettings /></ErrorBoundary>;
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
        <InviteeManager onNavigate={(page) => { setCurrentPage(page); setOpenDropdown(null); }} />
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

  const getCurrentGroupLabel = (): string => {
    for (const group of MENU_GROUPS) {
      if (group.items.some(item => item.key === currentPage)) {
        return group.label;
      }
    }
    return '教务管理';
  };

  return (
    <Layout style={{ minHeight: '100vh', background: '#fff' }}>
      <style>{`
        @keyframes dropdownIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .menu-group-label:hover {
          background: #f0f5ff !important;
        }
        .menu-group-label { transition: all 0.2s ease !important; }
        .menu-dropdown-item:hover {
          background: #e6f7ff !important;
        }
      `}</style>
      <Header style={{
        background: '#fff',
        padding: '0 10px',
        borderBottom: '1px solid #d9d9d9',
        display: 'flex',
        alignItems: 'center',
        height: 44,
        lineHeight: '44px',
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        overflow: 'visible',
        flexWrap: 'nowrap',
      }}>
        <div style={{
          fontSize: 14,
          fontWeight: 700,
          color: '#1890ff',
          marginRight: 12,
          whiteSpace: 'nowrap',
          userSelect: 'none',
          flexShrink: 0,
        }}>
          🏭 格物工坊
        </div>

        <div style={{ display: 'flex', gap: 2, flex: 1 }}>
          {MENU_GROUPS.map((group, idx) => {
            const isActive = group.items.some(item => item.key === currentPage);
            const isOpen = openDropdown === idx;
            const currentLabel = getCurrentGroupLabel();

            return (
              <div
                key={group.label}
                style={{ position: 'relative' }}
                onMouseEnter={() => handleDropdownEnter(idx, group.items.length)}
                onMouseLeave={handleDropdownLeave}
              >
                <div
                  style={{
                    padding: '4px 8px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? '#1890ff' : '#333',
                    background: isActive ? '#e6f7ff' : 'transparent',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                onClick={() => {
                  if (group.items.length === 1) {
                    // 单个菜单项直接跳转
                    setCurrentPage(group.items[0].key);
                    setOpenDropdown(null);
                  } else {
                    // 多个菜单项展开/收起下拉
                    setOpenDropdown(openDropdown === idx ? null : idx);
                  }
                }}
                >
                  {group.icon}
                  {group.label}
                  {group.items.length > 1 && (
                    <MenuOutlined style={{ fontSize: 10, opacity: 0.5 }} />
                  )}
                </div>

                {isOpen && group.items.length > 1 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    minWidth: 150,
                    background: '#fff',
                    borderRadius: 8,
                    boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
                    border: '1px solid #d9d9d9',
                    padding: '2px 0',
                    zIndex: 1001,
                    animation: 'dropdownIn 0.15s ease-out',
                    transformOrigin: 'top center',
                  }}>
                    {group.items.map(item => (
                      <div className="menu-dropdown-item"
                        key={item.key}
                        onClick={() => {
                          setCurrentPage(item.key);
                          setOpenDropdown(null);
                        }}
                        style={{
                          padding: '4px 10px',
                          fontSize: 12,
                          cursor: 'pointer',
                          color: currentPage === item.key ? '#1890ff' : '#333',
                          background: currentPage === item.key ? '#e6f7ff' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={(e) => {
                          if (currentPage !== item.key) {
                            e.currentTarget.style.background = '#f5f5f5';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (currentPage !== item.key) {
                            e.currentTarget.style.background = 'transparent';
                          }
                        }}
                      >
                        {item.icon}
                        {item.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Header>
      <Content style={{ padding: 16, minHeight: 'calc(100vh - 48px)' }}>
        {renderPage()}
      </Content>
      <QuestionBasket visible={QUESTION_BANK_PAGES.includes(currentPage)} />
    </Layout>
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
