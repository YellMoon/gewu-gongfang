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
import OperateLog from './pages/OperateLog';
import ErrorBoundary from './components/ErrorBoundary';
import TodayWorkbench from './pages/TodayWorkbench';
import QuestionBasket from './components/QuestionBasket';
import AppShell from './layout/AppShell';
import { PageKey, questionBankPages } from './navigation/appNavigation';
import { NavigationContext, NavigationInput, normalizeNavigationTarget } from './navigation/navigationContext';
import { getRuntimeConfig } from './services/runtimeConfigClient';
import { processMiniappCloudTasks, publishCloudHeartbeat } from './services/cloudRelayHostApi';

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

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const runHostCloudLoop = async () => {
      try {
        const config = await getRuntimeConfig();
        if (config.nodeRole !== 'primary-host' || !config.cloudBaseUrl) return;
        await publishCloudHeartbeat();
        await processMiniappCloudTasks();
      } catch (error) {
        if (!stopped) console.warn('[cloud-relay-host] background poll skipped', error);
      }
    };

    runHostCloudLoop();
    timer = setInterval(runHostCloudLoop, 60 * 1000);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
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
      case 'system-params': return <SystemSettings context={pageContext as any} />;
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
export default App;
