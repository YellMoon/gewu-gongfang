// 考试成绩分析 — 内置教学工具插件
import React from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Empty } from 'antd';
import { BarChartOutlined } from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import type { PluginComponentProps } from '../plugin-api';

const COLORS = ['#1890ff', '#52c41a', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2', '#f5222d', '#2f54eb'];

const PerformanceAnalysis: React.FC<PluginComponentProps> = ({ api }) => {
  const [gradeStats, setGradeStats] = React.useState<any>(null);
  const [grades, setGrades] = React.useState<any[]>([]);
  const [students, setStudents] = React.useState<any[]>([]);

  React.useEffect(() => {
    const loadData = async () => {
      try {
        const db = (window as any).dbService;
        if (!db) return;
        setGrades(db.getAllGrades?.() || []);
        setGradeStats(db.getPerformanceStats?.() || null);
        setStudents(db.getAllStudents?.() || []);
      } catch (e) {
        console.error('Failed to load performance data:', e);
      }
    };
    loadData();
  }, []);

  const stats = gradeStats;
  const recentGrades = [...grades].sort(
    (a, b) => b.created_at?.localeCompare(a.created_at) || 0
  ).slice(0, 20);

  return (
    <div>
      {stats && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <Card><Statistic title="考试总次数" value={stats.totalExams} suffix="次" valueStyle={{ fontSize: 28 }} /></Card>
          </Col>
          <Col span={6}>
            <Card><Statistic title="科目数量" value={stats.subjectStats?.length || 0} suffix="科" valueStyle={{ fontSize: 28, color: '#1890ff' }} /></Card>
          </Col>
          <Col span={6}>
            <Card><Statistic title="学员总数" value={students.length} suffix="人" valueStyle={{ fontSize: 28 }} /></Card>
          </Col>
          <Col span={6}>
            <Card><Statistic title="总成绩记录" value={grades.length} suffix="条" valueStyle={{ fontSize: 28, color: '#52c41a' }} /></Card>
          </Col>
        </Row>
      )}

      {stats?.subjectStats?.length > 0 && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col span={16}>
            <Card title="各科目平均分" size="small">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={stats.subjectStats}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="subject" />
                  <YAxis domain={[0, 100]} />
                  <ReTooltip />
                  <Legend />
                  <Bar dataKey="avgScore" name="平均分" fill="#1890ff" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </Col>
          <Col span={8}>
            <Card title="成绩分布" size="small">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={stats.subjectStats.map((s: any) => ({ name: s.subject, value: s.count }))}
                    cx="50%" cy="50%" outerRadius={90}
                    dataKey="value"
                    label={({ name, percent }: any) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                  >
                    {stats.subjectStats.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <ReTooltip />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </Col>
        </Row>
      )}

      <Card title="各科详细统计" size="small" style={{ marginBottom: 16 }}>
        <Table
          columns={[
            { title: '科目', dataIndex: 'subject', key: 'subject' },
            {
              title: '平均分', dataIndex: 'avgScore', key: 'avgScore',
              render: (v: number) => (
                <Tag color={v >= 80 ? 'green' : v >= 60 ? 'orange' : 'red'}>{v}分</Tag>
              ),
            },
            {
              title: '最高分', dataIndex: 'max', key: 'max',
              render: (v: number) => <span style={{ color: '#3f8600' }}>{v}分</span>,
            },
            {
              title: '最低分', dataIndex: 'min', key: 'min',
              render: (v: number) => <span style={{ color: '#cf1322' }}>{v}分</span>,
            },
            { title: '记录数', dataIndex: 'count', key: 'count' },
          ]}
          dataSource={stats?.subjectStats || []}
          rowKey="subject"
          pagination={false}
          size="small"
        />
      </Card>

      <Card title="最近成绩记录" size="small">
        <Table
          columns={[
            { title: '学员', dataIndex: 'student_name', key: 'student_name' },
            { title: '科目', dataIndex: 'subject', key: 'subject', render: (s: string) => <Tag>{s}</Tag> },
            {
              title: '成绩', dataIndex: 'score', key: 'score',
              render: (v: number) => {
                const color = v >= 90 ? '#3f8600' : v >= 75 ? '#1890ff' : v >= 60 ? '#fa8c16' : '#cf1322';
                return <span style={{ color, fontWeight: 600, fontSize: 16 }}>{v}</span>;
              },
            },
            { title: '评语', dataIndex: 'notes', key: 'notes', ellipsis: true },
            { title: '日期', dataIndex: 'exam_date', key: 'exam_date', width: 110 },
          ]}
          dataSource={recentGrades}
          rowKey="id"
          pagination={false}
          size="small"
          locale={{ emptyText: '暂无成绩记录，请在学员管理中录入成绩' }}
        />
      </Card>
    </div>
  );
};

export default PerformanceAnalysis;
