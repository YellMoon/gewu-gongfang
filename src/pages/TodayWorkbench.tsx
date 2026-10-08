import React, { useEffect, useMemo, useState } from 'react';
import { Card, Empty, Space, Typography, message } from 'antd';
import {
  CalendarOutlined,
  DatabaseOutlined,
  DollarOutlined,
  FileSearchOutlined,
  ImportOutlined,
  RightOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Course, Payment, Question, Student, Teacher } from '../types';
import type { NavigationInput } from '../navigation/navigationContext';
import {
  StudentAlertRow,
  TodayCourseRow,
  buildQuestionIssues,
  buildStudentFinancialAlerts,
  getTodayCourseRows,
  groupTodayRowsByFirstTeacher,
} from '../utils/todayWorkbenchData';
import { readSchedulesFromPrimaryStore } from '../utils/scheduleStorage.mjs';

interface TodayWorkbenchProps {
  onNavigate: (target: NavigationInput) => void;
}

interface WorkbenchData {
  todayRows: TodayCourseRow[];
  arrears: StudentAlertRow[];
  closedBalances: StudentAlertRow[];
  issueCount: number;
}

const EMPTY_DATA: WorkbenchData = {
  todayRows: [],
  arrears: [],
  closedBalances: [],
  issueCount: 0,
};

const formatMoney = (value: number) => `¥${Number(value || 0).toFixed(2)}`;

const AlertCard: React.FC<{
  title: string;
  countLabel: string;
  tone: 'orange' | 'red' | 'blue' | 'green';
  description: string;
  onClick: () => void;
}> = ({ title, countLabel, tone, description, onClick }) => (
  <button className={`today-workbench__alert-card today-workbench__alert-card--${tone}`} onClick={onClick}>
    <span className="today-workbench__alert-card-head">
      <strong>{title}</strong>
      <span>{countLabel}</span>
    </span>
    <span className="today-workbench__alert-card-description">{description}</span>
  </button>
);

const TodayWorkbench: React.FC<TodayWorkbenchProps> = ({ onNavigate }) => {
  const [data, setData] = useState<WorkbenchData>(EMPTY_DATA);

  useEffect(() => {
    let stopped = false;
    const loadData = async () => {
      const dbService = (window as any).dbService;
      if (!dbService) {
        if (!stopped) setData(EMPTY_DATA);
        return;
      }

      try {
        const schedules = readSchedulesFromPrimaryStore(dbService, localStorage);
        const courses: Course[] = dbService.getAllCourses?.() || [];
        const students: Student[] = dbService.getAllStudents?.() || [];
        const teachers: Teacher[] = dbService.getAllTeachers?.() || [];
        const payments: Payment[] = dbService.getAllPayments?.() || [];
        const questions: Question[] = dbService.getAllQuestions?.() || [];
        const todayRows = getTodayCourseRows(schedules, courses, teachers);
        const financialAlerts = buildStudentFinancialAlerts(schedules, courses, students, teachers, payments);
        const issues = buildQuestionIssues(questions);

        if (!stopped) setData({
          todayRows,
          arrears: financialAlerts.arrears,
          closedBalances: financialAlerts.closedBalances,
          issueCount: issues.length,
        });
      } catch (error) {
        console.error('今日工作台数据加载失败', error);
        if (!stopped) setData(EMPTY_DATA);
      }
    };

    void loadData();
    const timer = window.setInterval(() => void loadData(), 30000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  const todayGroup = useMemo(() => groupTodayRowsByFirstTeacher(data.todayRows), [data.todayRows]);
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

  const goSchedule = (row: TodayCourseRow) => {
    onNavigate({
      page: 'course-calendar',
      context: { date: row.date, scheduleId: row.scheduleId, highlightToday: true },
    });
  };

  return (
    <div className="today-workbench">
      <div className="today-workbench__entry-grid">
        <button className="today-workbench__entry-card" onClick={goCourseCalendar}>
          <CalendarOutlined />
          <strong>课程表</strong>
          <span>查看今日课程安排</span>
        </button>
        <button className="today-workbench__entry-card" onClick={() => onNavigate('revenue-statistics')}>
          <DollarOutlined />
          <strong>费用统计</strong>
          <span>查看学费、课时费与明细</span>
        </button>
        <button className="today-workbench__entry-card" onClick={() => onNavigate('question-bank-tools')}>
          <DatabaseOutlined />
          <strong>题库</strong>
          <span>试题库、导入与体系、组卷</span>
        </button>
      </div>

      <div className="today-workbench__body-grid">
        <Card size="small" className="today-workbench__course-panel" title="今日课程">
          <div className="today-workbench__course-meta">
            {todayGroup.teacherName} · {todayGroup.rows.length} 节
          </div>
          {todayGroup.rows.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今日暂无课程" />
          ) : (
            <div className="today-workbench__course-list">
              {todayGroup.rows.map((row, index) => (
                <button key={row.scheduleId} className="today-workbench__course-row" onClick={() => goSchedule(row)}>
                  <span>{index + 1}. {row.timeRange}</span>
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
              ? `最高欠缴 ${formatMoney(data.arrears[0].amount)}。`
              : '当前没有需要处理的欠缴学生。'}
            onClick={goArrears}
          />
          <AlertCard
            title="结课学生学费剩余"
            countLabel={`${data.closedBalances.length} 人`}
            tone="red"
            description={data.closedBalances.length > 0
              ? `最高余额 ${formatMoney(data.closedBalances[0].amount)}。`
              : '当前没有结课余额异常。'}
            onClick={goClosedBalances}
          />
          <AlertCard
            title="题库问题试题编辑"
            countLabel={`${data.issueCount} 题`}
            tone="blue"
            description={data.issueCount > 0
              ? '查看待确认的问题试题。'
              : '当前没有未确认的问题试题。'}
            onClick={goProblemQuestions}
          />
        </div>
      </div>

      <Space size={8} wrap className="today-workbench__footer-links">
        <Typography.Text type="secondary">题库常用入口：</Typography.Text>
        <button onClick={() => onNavigate('question-bank-preview')}><FileSearchOutlined /> 试题库</button>
        <button onClick={() => onNavigate('question-bank-tools')}><ImportOutlined /> 导入与体系</button>
        <button onClick={() => onNavigate('question-bank-paper')}>组卷 <RightOutlined /></button>
      </Space>
    </div>
  );
};

export default TodayWorkbench;
