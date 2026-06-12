import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, Space, Tag, Typography, message } from 'antd';
import {
  CalendarOutlined,
  CloudSyncOutlined,
  DatabaseOutlined,
  DollarOutlined,
  FileSearchOutlined,
  ImportOutlined,
  RightOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Course, Payment, Question, Student, Teacher } from '../types';
import type { NavigationInput } from '../navigation/navigationContext';
import { SyncEngine } from '../services/syncEngine';
import {
  StudentAlertRow,
  SyncSnapshot,
  TodayCourseRow,
  buildQuestionIssues,
  buildStudentFinancialAlerts,
  getTodayCourseRows,
  groupTodayRowsByFirstTeacher,
  parseStoredSchedules,
} from '../utils/todayWorkbenchData';

interface TodayWorkbenchProps {
  onNavigate: (target: NavigationInput) => void;
}

interface WorkbenchData {
  todayRows: TodayCourseRow[];
  arrears: StudentAlertRow[];
  closedBalances: StudentAlertRow[];
  issueCount: number;
  syncSnapshot: SyncSnapshot;
}

const EMPTY_DATA: WorkbenchData = {
  todayRows: [],
  arrears: [],
  closedBalances: [],
  issueCount: 0,
  syncSnapshot: { pendingCount: 0, hasIssues: false, lastSyncTime: null },
};

const formatMoney = (value: number) => `¥${Number(value || 0).toFixed(2)}`;

const AlertCard: React.FC<{
  title: string;
  countLabel: string;
  tone: 'orange' | 'red' | 'blue' | 'green';
  description: string;
  zeroHint?: string;
  onClick: () => void;
}> = ({ title, countLabel, tone, description, zeroHint, onClick }) => (
  <button className={`today-workbench__alert-card today-workbench__alert-card--${tone}`} onClick={onClick}>
    <span className="today-workbench__alert-card-head">
      <strong>{title}</strong>
      <span>{countLabel}</span>
    </span>
    <span className="today-workbench__alert-card-description">{description}</span>
    {zeroHint && <span className="today-workbench__alert-card-zero">{zeroHint}</span>}
  </button>
);

const TodayWorkbench: React.FC<TodayWorkbenchProps> = ({ onNavigate }) => {
  const [data, setData] = useState<WorkbenchData>(EMPTY_DATA);

  useEffect(() => {
    const loadData = () => {
      const dbService = (window as any).dbService;
      if (!dbService) {
        setData(EMPTY_DATA);
        return;
      }

      try {
        const schedules = parseStoredSchedules(localStorage.getItem('schedules'));
        const courses: Course[] = dbService.getAllCourses?.() || [];
        const students: Student[] = dbService.getAllStudents?.() || [];
        const teachers: Teacher[] = dbService.getAllTeachers?.() || [];
        const payments: Payment[] = dbService.getAllPayments?.() || [];
        const questions: Question[] = dbService.getAllQuestions?.() || [];
        const todayRows = getTodayCourseRows(schedules, courses, teachers);
        const financialAlerts = buildStudentFinancialAlerts(schedules, courses, students, teachers, payments);
        const issues = buildQuestionIssues(questions);

        let syncSnapshot: SyncSnapshot = { pendingCount: 0, hasIssues: false, lastSyncTime: null };
        try {
          const engine = new SyncEngine();
          const status = engine.getStatus();
          syncSnapshot = {
            pendingCount: status.pendingCount || 0,
            hasIssues: !status.online,
            lastSyncTime: status.lastSyncTime,
          };
        } catch {
          syncSnapshot = { pendingCount: 0, hasIssues: true, lastSyncTime: null };
        }

        setData({
          todayRows,
          arrears: financialAlerts.arrears,
          closedBalances: financialAlerts.closedBalances,
          issueCount: issues.length,
          syncSnapshot,
        });
      } catch (error) {
        console.error('今日工作台数据加载失败', error);
        setData(EMPTY_DATA);
      }
    };

    loadData();
    const timer = window.setInterval(loadData, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const todayGroup = useMemo(() => groupTodayRowsByFirstTeacher(data.todayRows), [data.todayRows]);
  const todayText = dayjs().format('YYYY年M月D日');
  const syncNormal = !data.syncSnapshot.hasIssues && data.syncSnapshot.pendingCount === 0;

  const goCourseCalendar = () => {
    onNavigate({ page: 'course-calendar', context: { date: dayjs().format('YYYY-MM-DD'), highlightToday: true } });
  };

  const goArrears = () => {
    if (data.arrears.length === 0) {
      message.info('暂无欠缴学生');
      return;
    }
    onNavigate({ page: 'revenue-statistics', context: { mode: 'arrears' } });
  };

  const goClosedBalances = () => {
    if (data.closedBalances.length === 0) {
      message.info('暂无结课余额异常');
      return;
    }
    onNavigate({ page: 'revenue-statistics', context: { mode: 'closed-balance' } });
  };

  const goProblemQuestions = () => {
    if (data.issueCount === 0) {
      message.info('暂无问题试题');
      return;
    }
    onNavigate({ page: 'question-bank-tools', context: { mode: 'problem-questions' } });
  };

  const goSync = () => {
    if (syncNormal) {
      message.info('当前同步正常');
      return;
    }
    onNavigate({ page: 'cloud-sync', context: { mode: data.syncSnapshot.hasIssues ? 'issues' : 'pending' } });
  };

  const goSchedule = (row: TodayCourseRow) => {
    onNavigate({
      page: 'course-calendar',
      context: { date: row.date, scheduleId: row.scheduleId, highlightToday: true },
    });
  };

  return (
    <div className="today-workbench">
      <div className="today-workbench__hero">
        <div>
          <Typography.Text strong>{todayText}</Typography.Text>
          <br />
          <Typography.Text type="secondary">高频入口和待处理提醒</Typography.Text>
        </div>
        <Tag color={syncNormal ? 'green' : 'orange'} icon={<SyncOutlined />}>
          {syncNormal ? '云同步正常' : `待处理同步 ${data.syncSnapshot.pendingCount} 条`}
        </Tag>
      </div>

      <div className="today-workbench__entry-grid">
        <button className="today-workbench__entry-card" onClick={goCourseCalendar}>
          <CalendarOutlined />
          <strong>课程表</strong>
          <span>进入当日所在周，今日列高亮</span>
        </button>
        <button className="today-workbench__entry-card" onClick={() => onNavigate('revenue-statistics')}>
          <DollarOutlined />
          <strong>费用统计</strong>
          <span>主动核对学费、课时费和明细</span>
        </button>
        <button className="today-workbench__entry-card" onClick={() => onNavigate('question-bank-tools')}>
          <DatabaseOutlined />
          <strong>题库</strong>
          <span>试题库、导入与知识树、组卷</span>
          <span className="today-workbench__entry-sub">试题库 · 导入与知识树 · 组卷</span>
        </button>
        <button className="today-workbench__entry-card" onClick={() => onNavigate('cloud-sync')}>
          <CloudSyncOutlined />
          <strong>云同步</strong>
          <span>查看同步控制台和本地队列</span>
        </button>
      </div>

      <div className="today-workbench__body-grid">
        <Card size="small" className="today-workbench__course-panel" title="今日课程信息提示">
          <div className="today-workbench__course-meta">
            默认首位老师：{todayGroup.teacherName} · {todayGroup.rows.length} 节
          </div>
          {todayGroup.rows.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今日暂无课程" />
          ) : (
            <div className="today-workbench__course-list">
              {todayGroup.rows.map(row => (
                <button key={row.scheduleId} className="today-workbench__course-row" onClick={() => goSchedule(row)}>
                  <span>{row.timeRange}</span>
                  <span>{row.room || '未设置地点'} · {row.teacherName}</span>
                  <strong>{row.courseName}</strong>
                </button>
              ))}
              <Typography.Text type="secondary">
                点击某一节课会进入课程表，并定位到对应日期和课程。
              </Typography.Text>
            </div>
          )}
        </Card>

        <div className="today-workbench__alert-stack">
          <AlertCard
            title="学生费用欠缴"
            countLabel={`${data.arrears.length} 人`}
            tone="orange"
            description={data.arrears.length > 0
              ? `最高欠缴 ${formatMoney(data.arrears[0].amount)}，点击直接查看欠缴结果集。`
              : '当前没有需要处理的欠缴学生。'}
            zeroHint={data.arrears.length === 0 ? '点击仅提示，不跳转' : undefined}
            onClick={goArrears}
          />
          <AlertCard
            title="结课学生学费剩余"
            countLabel={`${data.closedBalances.length} 人`}
            tone="red"
            description={data.closedBalances.length > 0
              ? `最高余额 ${formatMoney(data.closedBalances[0].amount)}，点击直接查看对应明细。`
              : '当前没有结课余额异常。'}
            zeroHint={data.closedBalances.length === 0 ? '点击仅提示，不跳转' : undefined}
            onClick={goClosedBalances}
          />
          <AlertCard
            title="题库问题试题编辑"
            countLabel={`${data.issueCount} 题`}
            tone="blue"
            description={data.issueCount > 0
              ? '点击直接打开问题试题队列。'
              : '当前没有未确认的问题试题。'}
            zeroHint={data.issueCount === 0 ? '点击仅提示，不跳转' : undefined}
            onClick={goProblemQuestions}
          />
          <AlertCard
            title="云同步情况"
            countLabel={syncNormal ? '正常' : `${data.syncSnapshot.pendingCount} 条`}
            tone="green"
            description={syncNormal
              ? '最近同步状态正常。'
              : '点击直接查看待同步或异常同步项。'}
            zeroHint={syncNormal ? '点击仅提示，不跳转' : undefined}
            onClick={goSync}
          />
        </div>
      </div>

      <Space size={8} wrap className="today-workbench__footer-links">
        <Typography.Text type="secondary">题库常用入口：</Typography.Text>
        <button onClick={() => onNavigate('question-bank-preview')}><FileSearchOutlined /> 试题库</button>
        <button onClick={() => onNavigate('question-bank-tools')}><ImportOutlined /> 导入与知识树</button>
        <button onClick={() => onNavigate('question-bank-paper')}>组卷 <RightOutlined /></button>
      </Space>
    </div>
  );
};

export default TodayWorkbench;
