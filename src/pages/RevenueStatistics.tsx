import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Divider,
  Empty,
  Row,
  Select as AntSelect,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { BarChartOutlined, LineChartOutlined, PieChartOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, LineElement, PointElement, Filler } from 'chart.js';
import { Bar, Line, Pie } from 'react-chartjs-2';
import AutoCloseSelect from '../components/AutoCloseSelect';
import StatsPageLayout from '../layout/StatsPageLayout';
import {
  BillingUnit,
  Consumption,
  Course,
  CourseSourceType,
  CourseType,
  Payment,
  RevenueStats,
  Schedule,
  ScheduleStatus,
  Student,
  StudentTuitionStats,
  Teacher,
  TeacherFeeMode,
} from '../types';
import {
  StudentCourseFeeDetail,
  TeacherFeeDetail,
  buildFinancialDetails,
  courseTypeNames,
  sourceTypeNames,
} from '../utils/financialDetails';

const { RangePicker } = DatePicker;
const Select = AutoCloseSelect as typeof AntSelect;
const { Text } = Typography;

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, LineElement, PointElement, Filler);

type ScheduleItem = Schedule & {
  course_name?: string;
  course_type?: CourseType;
};

interface TeacherIncomeSummary {
  teacherId: string;
  teacherName: string;
  total: number;
  courseCount: number;
  studentCount: number;
  durationHours: number;
}

interface StudentTuitionSummary extends StudentTuitionStats {
  courseCount: number;
  durationHours: number;
  teacherFeeTotal: number;
  byCourseType?: Array<{ type: CourseType; typeName: string; amount: number; percentage: number }>;
}

const roundMoney = (value: number): number => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const moneyText = (amount: number, color: string = 'green') => (
  <Tag color={color}>¥{roundMoney(amount).toFixed(2)}</Tag>
);

const unitSuffix = (billingUnit: BillingUnit) => (billingUnit === BillingUnit.PER_HOUR ? '/小时' : '/次');

const RevenueStatistics: React.FC = () => {
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().startOf('month'),
    dayjs().endOf('month'),
  ]);
  const [stats, setStats] = useState<RevenueStats | null>(null);
  const [studentStats, setStudentStats] = useState<StudentTuitionSummary[]>([]);
  const [teacherIncomeStats, setTeacherIncomeStats] = useState<TeacherIncomeSummary[]>([]);
  const [studentDetails, setStudentDetails] = useState<StudentCourseFeeDetail[]>([]);
  const [teacherDetails, setTeacherDetails] = useState<TeacherFeeDetail[]>([]);
  const [showChart, setShowChart] = useState<'bar' | 'pie' | 'line' | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>('');
  const [filterStudentId, setFilterStudentId] = useState<string | undefined>(undefined);
  const [filterTeacherId, setFilterTeacherId] = useState<string | undefined>(undefined);
  const [filterCourseTypes, setFilterCourseTypes] = useState<CourseType[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [allTeachers, setAllTeachers] = useState<Teacher[]>([]);
  const dbService = (window as any).dbService;

  const loadLocalSchedules = (): ScheduleItem[] => {
    try {
      const saved = localStorage.getItem('schedules');
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error('读取排课数据失败', error);
      return [];
    }
  };

  const loadStats = async () => {
    if (!dbService) {
      console.warn('dbService not available yet');
      return;
    }

    setLoading(true);
    try {
      const startDate = dateRange[0].format('YYYY-MM-DD');
      const endDate = dateRange[1].format('YYYY-MM-DD');
      const courses: Course[] = dbService.getAllCourses?.() || [];
      const students: Student[] = dbService.getAllStudents?.() || [];
      const teachers: Teacher[] = dbService.getAllTeachers?.() || [];
      const payments: Payment[] = dbService.getAllPayments?.() || [];
      const consumptions: Consumption[] = dbService.getAllConsumptions?.() || [];
      const schedules = loadLocalSchedules();

      setAllStudents(students);
      setAllTeachers(teachers);

      const validSchedules = schedules.filter(schedule => {
        const dateStr = schedule.start_time.split(' ')[0];
        if (dateStr < startDate || dateStr > endDate) return false;
        if (schedule.status === ScheduleStatus.LEAVE || schedule.status === ScheduleStatus.CANCELLED) return false;
        if (filterCourseTypes.length > 0 && !filterCourseTypes.includes(schedule.course_type || CourseType.ONE_ON_ONE)) return false;
        return true;
      });

      const details = buildFinancialDetails(validSchedules, courses, students, teachers);
      const allStudentDetails = details.studentDetails;
      const allTeacherDetails = details.teacherDetails;

      const displayedStudentDetails = allStudentDetails.filter(row => {
        if (filterStudentId && row.studentId !== filterStudentId) return false;
        if (filterTeacherId && row.teacherId !== filterTeacherId) return false;
        return true;
      });
      const displayedTeacherDetails = allTeacherDetails.filter(row => {
        if (filterTeacherId && row.teacherId !== filterTeacherId) return false;
        return true;
      });

      const totalTuition = roundMoney(allStudentDetails.reduce((sum, row) => sum + row.tuitionTotal, 0));
      const byCourseType = new Map<CourseType, number>();
      const bySourceType = new Map<CourseSourceType, number>();
      const byMonth = new Map<string, number>();
      const byInstitution = new Map<string, number>();

      allStudentDetails.forEach(row => {
        byCourseType.set(row.courseType, roundMoney((byCourseType.get(row.courseType) || 0) + row.tuitionTotal));
        if (row.sourceType) {
          bySourceType.set(row.sourceType, roundMoney((bySourceType.get(row.sourceType) || 0) + row.tuitionTotal));
        }
        if (row.institutionId) {
          byInstitution.set(row.institutionId, roundMoney((byInstitution.get(row.institutionId) || 0) + row.tuitionTotal));
        }
        const month = row.date.substring(0, 7);
        byMonth.set(month, roundMoney((byMonth.get(month) || 0) + row.tuitionTotal));
      });

      const result: RevenueStats = {
        total: totalTuition,
        totalSchedules: validSchedules.length,
        byCourseType: Array.from(byCourseType.entries()).map(([type, amount]) => ({
          type,
          typeName: courseTypeNames[type] || '未知',
          amount,
          percentage: totalTuition > 0 ? roundMoney((amount / totalTuition) * 100) : 0,
        })),
        bySourceType: Array.from(bySourceType.entries()).map(([sourceType, amount]) => ({
          sourceType,
          sourceName: sourceTypeNames[sourceType] || '未知',
          amount,
          percentage: totalTuition > 0 ? roundMoney((amount / totalTuition) * 100) : 0,
        })),
        byInstitution: Array.from(byInstitution.entries()).map(([institutionId, amount]) => {
          const institution = dbService.getAllInstitutions?.().find((item: any) => item.id === institutionId);
          return {
            institutionId,
            institutionName: institution?.name || '未知机构',
            amount,
            percentage: totalTuition > 0 ? roundMoney((amount / totalTuition) * 100) : 0,
          };
        }),
        byMonth: Array.from(byMonth.entries())
          .map(([month, amount]) => ({ month, amount }))
          .sort((a, b) => a.month.localeCompare(b.month)),
      };
      setStats(result);

      const teacherMap = new Map<string, TeacherIncomeSummary>();
      displayedTeacherDetails.forEach(row => {
        const current = teacherMap.get(row.teacherId) || {
          teacherId: row.teacherId,
          teacherName: row.teacherName,
          total: 0,
          courseCount: 0,
          studentCount: 0,
          durationHours: 0,
        };
        current.total = roundMoney(current.total + row.teacherFeeTotal);
        current.courseCount += 1;
        current.studentCount += row.studentCount;
        current.durationHours = roundMoney(current.durationHours + row.durationHours);
        teacherMap.set(row.teacherId, current);
      });
      setTeacherIncomeStats(Array.from(teacherMap.values()).sort((a, b) => b.total - a.total));

      const studentMap = new Map<string, StudentTuitionSummary & { byCourseTypeMap: Map<CourseType, number> }>();
      displayedStudentDetails.forEach(row => {
        const current = studentMap.get(row.studentId) || {
          studentId: row.studentId,
          studentName: row.studentName,
          total: 0,
          courseCount: 0,
          durationHours: 0,
          teacherFeeTotal: 0,
          byCourseTypeMap: new Map<CourseType, number>(),
        };
        current.total = roundMoney(current.total + row.tuitionTotal);
        current.courseCount += 1;
        current.durationHours = roundMoney(current.durationHours + row.durationHours);
        current.teacherFeeTotal = roundMoney(current.teacherFeeTotal + row.teacherFeeTotal);
        current.byCourseTypeMap.set(row.courseType, roundMoney((current.byCourseTypeMap.get(row.courseType) || 0) + row.tuitionTotal));
        studentMap.set(row.studentId, current);
      });

      const studentResult = Array.from(studentMap.values()).map(item => ({
        studentId: item.studentId,
        studentName: item.studentName,
        total: item.total,
        courseCount: item.courseCount,
        durationHours: item.durationHours,
        teacherFeeTotal: item.teacherFeeTotal,
        byCourseType: Array.from(item.byCourseTypeMap.entries()).map(([type, amount]) => ({
          type,
          typeName: courseTypeNames[type] || '未知',
          amount,
          percentage: item.total > 0 ? roundMoney((amount / item.total) * 100) : 0,
        })),
      })).sort((a, b) => b.total - a.total);
      setStudentStats(studentResult);
      setStudentDetails(displayedStudentDetails);
      setTeacherDetails(displayedTeacherDetails);

      const validPayments = payments.filter(payment => payment.payment_date >= startDate && payment.payment_date <= endDate);
      const validConsumptions = consumptions.filter(item => item.consumption_date >= startDate && item.consumption_date <= endDate);
      console.info('费用统计辅助数据', {
        totalPayment: roundMoney(validPayments.reduce((sum, payment) => sum + payment.amount, 0)),
        totalConsumptionHours: roundMoney(validConsumptions.reduce((sum, item) => sum + item.hours, 0)),
        totalConsumptionAmount: roundMoney(validConsumptions.reduce((sum, item) => sum + item.amount, 0)),
      });

      setLastRefresh(new Date().toLocaleTimeString());
      message.success('统计数据已刷新');
    } catch (error) {
      console.error('统计加载失败', error);
      message.error('统计加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const totalTeacherFee = roundMoney(teacherIncomeStats.reduce((sum, row) => sum + row.total, 0));
  const netIncome = roundMoney((stats?.total || 0) - totalTeacherFee);

  const courseTypeChartData = stats?.byCourseType ? {
    labels: stats.byCourseType.map(item => item.typeName),
    datasets: [{
      label: '学费收入',
      data: stats.byCourseType.map(item => item.amount),
      backgroundColor: ['#1677ff', '#52c41a', '#faad14', '#f5222d'],
    }],
  } : null;

  const sourceTypeChartData = stats?.bySourceType ? {
    labels: stats.bySourceType.map(item => item.sourceName),
    datasets: [{
      data: stats.bySourceType.map(item => item.percentage),
      backgroundColor: ['#1677ff', '#52c41a', '#faad14'],
    }],
  } : null;

  const monthTrendChartData = stats?.byMonth ? {
    labels: stats.byMonth.map(item => item.month),
    datasets: [{
      label: '月学费收入',
      data: stats.byMonth.map(item => item.amount),
      borderColor: '#1677ff',
      backgroundColor: 'rgba(22, 119, 255, 0.16)',
      fill: true,
    }],
  } : null;

  const teacherColumns = [
    { title: '老师', dataIndex: 'teacherName', key: 'teacherName', width: 140 },
    { title: '课程节数', dataIndex: 'courseCount', key: 'courseCount', width: 100, render: (value: number) => `${value} 节` },
    { title: '学生人次', dataIndex: 'studentCount', key: 'studentCount', width: 100 },
    { title: '总时长', dataIndex: 'durationHours', key: 'durationHours', width: 100, render: (value: number) => `${roundMoney(value)} 小时` },
    { title: '总课时费', dataIndex: 'total', key: 'total', width: 120, render: (value: number) => moneyText(value, 'orange') },
  ];

  const studentColumns = [
    { title: '学生', dataIndex: 'studentName', key: 'studentName', width: 140 },
    { title: '课程次数', dataIndex: 'courseCount', key: 'courseCount', width: 100, render: (value: number) => `${value} 次` },
    { title: '总时长', dataIndex: 'durationHours', key: 'durationHours', width: 100, render: (value: number) => `${roundMoney(value)} 小时` },
    { title: '总学费', dataIndex: 'total', key: 'total', width: 120, render: (value: number) => moneyText(value) },
    { title: '对应课时费', dataIndex: 'teacherFeeTotal', key: 'teacherFeeTotal', width: 120, render: (value: number) => moneyText(value, 'orange') },
    {
      title: '按班型',
      key: 'byCourseType',
      render: (_: unknown, record: StudentTuitionSummary) => (
        <Space size="small" wrap>
          {record.byCourseType?.map(item => (
            <Tag key={item.type} color="blue">{item.typeName}: ¥{item.amount.toFixed(2)}</Tag>
          ))}
        </Space>
      ),
    },
  ];

  const studentDetailColumns = [
    { title: '上课日期', dataIndex: 'date', key: 'date', width: 110, fixed: 'left' as const },
    { title: '时间段', dataIndex: 'timeRange', key: 'timeRange', width: 110 },
    { title: '学生', dataIndex: 'studentName', key: 'studentName', width: 120 },
    { title: '科目/课程', dataIndex: 'courseName', key: 'courseName', width: 180 },
    { title: '老师', dataIndex: 'teacherName', key: 'teacherName', width: 120 },
    { title: '时长', dataIndex: 'durationHours', key: 'durationHours', width: 90, render: (value: number) => `${roundMoney(value)} 小时` },
    { title: '单位', dataIndex: 'billingUnitName', key: 'billingUnitName', width: 70 },
    {
      title: '学费单价',
      dataIndex: 'tuitionUnitPrice',
      key: 'tuitionUnitPrice',
      width: 110,
      render: (value: number, record: StudentCourseFeeDetail) => `¥${roundMoney(value).toFixed(2)}${unitSuffix(record.billingUnit)}`,
    },
    { title: '总学费', dataIndex: 'tuitionTotal', key: 'tuitionTotal', width: 110, render: (value: number) => moneyText(value) },
    {
      title: '课时费单价',
      dataIndex: 'teacherFeeUnitPrice',
      key: 'teacherFeeUnitPrice',
      width: 120,
      render: (value: number, record: StudentCourseFeeDetail) => `¥${roundMoney(value).toFixed(2)}${unitSuffix(record.billingUnit)}`,
    },
    { title: '计费口径', dataIndex: 'teacherFeeModeName', key: 'teacherFeeModeName', width: 90 },
    { title: '总课时费', dataIndex: 'teacherFeeTotal', key: 'teacherFeeTotal', width: 110, render: (value: number) => moneyText(value, 'orange') },
    {
      title: '价格来源',
      dataIndex: 'pricingSource',
      key: 'pricingSource',
      width: 100,
      render: (value: StudentCourseFeeDetail['pricingSource']) => {
        const labels = { schedule: '排课快照', course: '课程定价', fallback: '兜底估算' };
        const colors = { schedule: 'green', course: 'blue', fallback: 'volcano' };
        return <Tag color={colors[value]}>{labels[value]}</Tag>;
      },
    },
  ];

  const teacherDetailColumns = [
    { title: '上课日期', dataIndex: 'date', key: 'date', width: 110, fixed: 'left' as const },
    { title: '时间段', dataIndex: 'timeRange', key: 'timeRange', width: 110 },
    { title: '老师', dataIndex: 'teacherName', key: 'teacherName', width: 120 },
    { title: '科目/课程', dataIndex: 'courseName', key: 'courseName', width: 180 },
    { title: '学生', dataIndex: 'studentNames', key: 'studentNames', width: 220 },
    { title: '学生人数', dataIndex: 'studentCount', key: 'studentCount', width: 90 },
    { title: '时长', dataIndex: 'durationHours', key: 'durationHours', width: 90, render: (value: number) => `${roundMoney(value)} 小时` },
    { title: '单位', dataIndex: 'billingUnitName', key: 'billingUnitName', width: 70 },
    {
      title: '课时费单价',
      dataIndex: 'feeUnitPrice',
      key: 'feeUnitPrice',
      width: 120,
      render: (value: number, record: TeacherFeeDetail) => `¥${roundMoney(value).toFixed(2)}${unitSuffix(record.billingUnit)}`,
    },
    { title: '计费口径', dataIndex: 'teacherFeeModeName', key: 'teacherFeeModeName', width: 90 },
    { title: '总课时费', dataIndex: 'teacherFeeTotal', key: 'teacherFeeTotal', width: 120, render: (value: number) => moneyText(value, 'orange') },
  ];

  const filtersNode = (
    <>
        <Row gutter={[16, 12]} align="middle">
          <Col>
            <Space>
              <span>统计范围：</span>
              <RangePicker
                value={dateRange}
                onChange={dates => {
                  if (dates?.[0] && dates?.[1]) setDateRange([dates[0], dates[1]]);
                }}
              />
            </Space>
          </Col>
          <Col>
            <Button type="primary" icon={<ReloadOutlined />} onClick={loadStats} loading={loading}>
              统计
            </Button>
          </Col>
          {lastRefresh && (
            <Col>
              <Text type="secondary" style={{ fontSize: 12 }}>上次刷新：{lastRefresh}</Text>
            </Col>
          )}
          <Col flex="auto" />
          <Col>
            <Space wrap>
              <Button icon={<BarChartOutlined />} onClick={() => setShowChart(showChart === 'bar' ? null : 'bar')}>班型收入图</Button>
              <Button icon={<PieChartOutlined />} onClick={() => setShowChart(showChart === 'pie' ? null : 'pie')}>来源占比图</Button>
              <Button icon={<LineChartOutlined />} onClick={() => setShowChart(showChart === 'line' ? null : 'line')}>月度趋势图</Button>
            </Space>
          </Col>
        </Row>

        <Divider style={{ margin: '12px 0' }} />

        <Row gutter={[16, 12]} align="middle">
          <Col>
            <Space>
              <span>筛选学生：</span>
              <Select
                placeholder="全部学生"
                allowClear
                showSearch
                style={{ width: 180 }}
                value={filterStudentId}
                onChange={setFilterStudentId}
                filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                options={allStudents.map(student => ({ label: student.name, value: student.id }))}
              />
            </Space>
          </Col>
          <Col>
            <Space>
              <span>筛选老师：</span>
              <Select
                placeholder="全部老师"
                allowClear
                showSearch
                style={{ width: 180 }}
                value={filterTeacherId}
                onChange={setFilterTeacherId}
                filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                options={allTeachers.map(teacher => ({ label: teacher.name, value: teacher.id }))}
              />
            </Space>
          </Col>
          <Col>
            <Space>
              <span>课程类型：</span>
              <Select
                mode="multiple"
                placeholder="全部类型"
                allowClear
                style={{ width: 240 }}
                value={filterCourseTypes}
                onChange={setFilterCourseTypes}
                options={[
                  { label: '一对一', value: CourseType.ONE_ON_ONE },
                  { label: '一对二', value: CourseType.ONE_ON_TWO },
                  { label: '小组课', value: CourseType.GROUP },
                  { label: '大班课', value: CourseType.LARGE_CLASS },
                ]}
                maxTagCount={3}
              />
            </Space>
          </Col>
        </Row>
    </>
  );

  const metricsNode = (
    <>

      {stats && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <Card><Statistic title="应收学费" value={stats.total} precision={2} prefix="¥" valueStyle={{ color: '#3f8600' }} /></Card>
          </Col>
          <Col span={6}>
            <Card><Statistic title="老师课时费" value={totalTeacherFee} precision={2} prefix="¥" valueStyle={{ color: '#cf6b00' }} /></Card>
          </Col>
          <Col span={6}>
            <Card><Statistic title="净收入估算" value={netIncome} precision={2} prefix="¥" valueStyle={{ color: netIncome >= 0 ? '#1677ff' : '#cf1322' }} /></Card>
          </Col>
          <Col span={6}>
            <Card><Statistic title="排课数量" value={stats.totalSchedules || 0} suffix="节" /></Card>
          </Col>
        </Row>
      )}

      {(!stats || stats.totalSchedules === 0) && !loading && (
        <Card style={{ marginBottom: 16, textAlign: 'center' }}>
          <Empty description="当前筛选范围内没有可统计的排课数据" />
        </Card>
      )}

    </>
  );

  const summaryNode = (
    <>
      {showChart && stats && stats.total > 0 && (
        <Card
          title={
            <Space>
              {showChart === 'bar' && <BarChartOutlined />}
              {showChart === 'pie' && <PieChartOutlined />}
              {showChart === 'line' && <LineChartOutlined />}
              {showChart === 'bar' && '班型收入分布'}
              {showChart === 'pie' && '课程来源占比'}
              {showChart === 'line' && '月度收入趋势'}
              <Button size="small" onClick={() => setShowChart(null)}>关闭</Button>
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          {showChart === 'bar' && courseTypeChartData && <Bar data={courseTypeChartData} options={{ responsive: true, plugins: { legend: { display: false } } }} height={80} />}
          {showChart === 'pie' && sourceTypeChartData && (
            <div style={{ maxWidth: 420, margin: '0 auto' }}>
              <Pie data={sourceTypeChartData} options={{ responsive: true, plugins: { legend: { position: 'bottom' } } }} />
            </div>
          )}
          {showChart === 'line' && monthTrendChartData && <Line data={monthTrendChartData} options={{ responsive: true, plugins: { legend: { display: false } } }} height={80} />}
        </Card>
      )}

      {stats && stats.total > 0 && (
        <Row gutter={16}>
          <Col span={12}>
            <Card title="按班型统计" size="small" style={{ marginBottom: 16 }}>
              <Table
                columns={[
                  { title: '班型', dataIndex: 'typeName', key: 'typeName' },
                  { title: '学费收入', dataIndex: 'amount', key: 'amount', render: (amount: number) => `¥${amount.toFixed(2)}` },
                  { title: '占比', dataIndex: 'percentage', key: 'percentage', render: (pct: number) => `${pct}%` },
                ]}
                dataSource={stats.byCourseType}
                rowKey="typeName"
                pagination={false}
                size="small"
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card title="按课程来源统计" size="small" style={{ marginBottom: 16 }}>
              <Table
                columns={[
                  { title: '来源', dataIndex: 'sourceName', key: 'sourceName' },
                  { title: '学费收入', dataIndex: 'amount', key: 'amount', render: (amount: number) => `¥${amount.toFixed(2)}` },
                  { title: '占比', dataIndex: 'percentage', key: 'percentage', render: (pct: number) => `${pct}%` },
                ]}
                dataSource={stats.bySourceType}
                rowKey="sourceName"
                pagination={false}
                size="small"
              />
            </Card>
          </Col>
        </Row>
      )}

    </>
  );

  const detailsNode = (
    <>

      <Card title={`老师课时费汇总${filterTeacherId ? '（已筛选）' : ''}`} size="small" style={{ marginTop: 16 }}>
        {teacherIncomeStats.length > 0 ? (
          <Table columns={teacherColumns} dataSource={teacherIncomeStats} rowKey="teacherId" pagination={{ pageSize: 10 }} size="small" />
        ) : (
          <Empty description="暂无老师课时费数据" />
        )}
      </Card>

      <Card title="老师课时费明细" size="small" style={{ marginTop: 16 }}>
        {teacherDetails.length > 0 ? (
          <Table
            columns={teacherDetailColumns}
            dataSource={teacherDetails}
            rowKey="key"
            pagination={{ pageSize: 20 }}
            size="small"
            scroll={{ x: 1320 }}
          />
        ) : (
          <Empty description="暂无老师课时费明细" />
        )}
      </Card>

      <Card title={`学生学费汇总${filterStudentId ? '（已筛选）' : ''}`} size="small" style={{ marginTop: 16 }}>
        {studentStats.length > 0 ? (
          <Table columns={studentColumns} dataSource={studentStats} rowKey="studentId" pagination={{ pageSize: 10 }} size="small" />
        ) : (
          <Empty description="暂无学生学费数据" />
        )}
      </Card>

      <Card title="学生课程费用明细" size="small" style={{ marginTop: 16 }}>
        {studentDetails.length > 0 ? (
          <Table
            columns={studentDetailColumns}
            dataSource={studentDetails}
            rowKey="key"
            pagination={{ pageSize: 20 }}
            size="small"
            scroll={{ x: 1520 }}
          />
        ) : (
          <Empty description="暂无学生课程费用明细" />
        )}
      </Card>
    </>
  );

  return (
    <StatsPageLayout
      filters={filtersNode}
      metrics={metricsNode}
      summary={summaryNode}
      details={detailsNode}
    />
  );
};

export default RevenueStatistics;
