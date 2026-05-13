import React, { useState, useEffect } from 'react';
import { 
  Card, DatePicker, Select as AntSelect, Button, Table, Statistic, Row, Col,
  Divider, Typography, Tag, Empty, Space, Radio, message
} from 'antd';
import { BarChartOutlined, PieChartOutlined, LineChartOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { RevenueStats, StudentTuitionStats, CourseType, CourseSourceType, ServiceType, ScheduleStatus, Course, Payment, Consumption, PaymentType, BillingUnit, TeacherFeeMode } from '../types';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement } from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';
import AutoCloseSelect from '../components/AutoCloseSelect';

const { RangePicker } = DatePicker;
const Select = AutoCloseSelect as typeof AntSelect;
const { Title: TitleText } = Typography;

// 注册 Chart.js
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

const courseTypeNames: Record<number, string> = { 1: '一对一', 2: '一对二', 3: '小组课', 4: '大班课' };
const sourceTypeNames: Record<number, string> = { 1: '自有课程', 2: '机构排课', 3: '混合班' };

interface ScheduleItem {
  id: string;
  course_id: string;
  course_name: string;
  course_type: CourseType;
  start_time: string;
  end_time: string;
  status: ScheduleStatus;
  room?: string;
  notes?: string;
}

const RevenueStatistics: React.FC = () => {
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().startOf('month'),
    dayjs().endOf('month')
  ]);
  const [stats, setStats] = useState<RevenueStats | null>(null);
  const [studentStats, setStudentStats] = useState<StudentTuitionStats[]>([]);
  const [teacherIncomeStats, setTeacherIncomeStats] = useState<{ teacherId: string; teacherName: string; total: number; courseCount: number }[]>([]);
  const [showChart, setShowChart] = useState<'bar' | 'pie' | 'line' | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>('');
  const [filterStudentId, setFilterStudentId] = useState<string | undefined>(undefined);
  const [filterTeacherId, setFilterTeacherId] = useState<string | undefined>(undefined);
  const [filterCourseTypes, setFilterCourseTypes] = useState<CourseType[]>([]);
  const dbService = (window as any).dbService;
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [allTeachers, setAllTeachers] = useState<any[]>([]);

  const loadStats = async () => {
    if (!dbService) {
      console.warn('dbService not available yet');
      return;
    }
    setLoading(true);
    try {
      const startDate = dateRange[0].format('YYYY-MM-DD');
      const endDate = dateRange[1].format('YYYY-MM-DD');

      // 从数据库加载课程列表
      const courses: Course[] = dbService.getAllCourses() || [];
      
      // 加载学生和老师数据
      const students = dbService.getAllStudents ? dbService.getAllStudents() : [];
      const teachers = dbService.getAllTeachers ? dbService.getAllTeachers() : [];
      setAllStudents(students);
      setAllTeachers(teachers);
      
      // 从localStorage加载排课数据（与ScheduleCalendar一致）
      let schedules: ScheduleItem[] = [];
      try {
        const saved = localStorage.getItem('schedules');
        if (saved) schedules = JSON.parse(saved);
      } catch (e) {
        console.error('读取排课数据失败', e);
      }

      // 加载缴费和消耗记录
      const payments: Payment[] = dbService.getAllPayments ? dbService.getAllPayments() : [];
      const consumptions: Consumption[] = dbService.getAllConsumptions ? dbService.getAllConsumptions() : [];

      // ========== 收入统计 ==========
      // 筛选时间范围内的排课，排除请假和取消
      const validSchedules = schedules.filter(s => {
        const dateStr = s.start_time.split(' ')[0];
        if (!(dateStr >= startDate && dateStr <= endDate)) return false;
        if (s.status === ScheduleStatus.LEAVE || s.status === ScheduleStatus.CANCELLED) return false;
        // 课程类型筛选
        if (filterCourseTypes.length > 0) {
          if (!filterCourseTypes.includes(s.course_type)) return false;
        }
        return true;
      });

      let total = 0;
      const byCourseType = new Map<number, number>();
      const bySourceType = new Map<number, number>();
      const byMonth = new Map<string, number>();
      const byInstitution = new Map<string, number>();

      validSchedules.forEach(schedule => {
        const course = courses.find(c => c.id === schedule.course_id);
        // 计算学费：优先用课程定价，否则按课时计算
        let tuition = 0;
        if (course) {
          const startTime = schedule.start_time.split(' ')[1];
          const endTime = schedule.end_time.split(' ')[1];
          const [startH, startM] = startTime.split(':').map(Number);
          const [endH, endM] = endTime.split(':').map(Number);
          const hours = (endH * 60 + endM - startH * 60 - startM) / 60;
          
          if (course.billing_unit === 2) {
            // 按次计费
            tuition = course.price_tuition || 0;
          } else {
            // 按小时计费
            tuition = (course.price_tuition || 0) * hours;
          }

          byCourseType.set(course.type, (byCourseType.get(course.type) || 0) + tuition);
          bySourceType.set(course.source_type, (bySourceType.get(course.source_type) || 0) + tuition);
          
          if (course.institution_id) {
            const institutions = dbService.getAllInstitutions ? dbService.getAllInstitutions() : [];
            byInstitution.set(course.institution_id, (byInstitution.get(course.institution_id) || 0) + tuition);
          }
        }

        total += tuition;
        const month = schedule.start_time.substring(0, 7);
        byMonth.set(month, (byMonth.get(month) || 0) + tuition);
      });

      // ========== 缴费统计 ==========
      const validPayments = payments.filter(p => {
        const dateStr = p.payment_date;
        return dateStr >= startDate && dateStr <= endDate;
      });
      const totalPayment = validPayments.reduce((sum, p) => sum + p.amount, 0);

      // ========== 课时消耗统计 ==========
      const validConsumptions = consumptions.filter(c => {
        const dateStr = c.consumption_date;
        return dateStr >= startDate && dateStr <= endDate;
      });
      const totalConsumptionHours = validConsumptions.reduce((sum, c) => sum + c.hours, 0);
      const totalConsumptionAmount = validConsumptions.reduce((sum, c) => sum + c.amount, 0);

      // ========== 学生学费统计 ==========
      const studentTuitionMap = new Map<string, { total: number; byCourseType: Map<number, number> }>();
      
      validSchedules.forEach(schedule => {
        const course = courses.find(c => c.id === schedule.course_id);
        if (!course) return;
        
        const startTime = schedule.start_time.split(' ')[1];
        const endTime = schedule.end_time.split(' ')[1];
        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);
        const hours = (endH * 60 + endM - startH * 60 - startM) / 60;
        let tuition = course.billing_unit === 2 
          ? (course.price_tuition || 0) 
          : (course.price_tuition || 0) * hours;

        // 如果有学生定价，按学生分配
        if (course.student_pricings && course.student_pricings.length > 0) {
          course.student_pricings.forEach(sp => {
            if (sp.status === ScheduleStatus.LEAVE || sp.status === ScheduleStatus.CANCELLED) return;
            const spTuition = sp.tuition * (course.billing_unit === 2 ? 1 : hours);
            if (!studentTuitionMap.has(sp.student_id)) {
              studentTuitionMap.set(sp.student_id, { total: 0, byCourseType: new Map() });
            }
            const sData = studentTuitionMap.get(sp.student_id)!;
            sData.total += spTuition;
            sData.byCourseType.set(course.type, (sData.byCourseType.get(course.type) || 0) + spTuition);
          });
        } else {
          // 无学生定价，按课程关联的学生分配（一对一）
          const students = dbService.getAllStudents ? dbService.getAllStudents() : [];
          // 尝试从缴费记录推断关联学生
          const relatedStudents = students.filter((s: any) => 
            validPayments.some(p => p.student_id === s.id)
          );
          if (relatedStudents.length > 0) {
            relatedStudents.forEach((student: any) => {
              if (!studentTuitionMap.has(student.id)) {
                studentTuitionMap.set(student.id, { total: 0, byCourseType: new Map() });
              }
              const sData = studentTuitionMap.get(student.id)!;
              sData.total += tuition / relatedStudents.length;
              sData.byCourseType.set(course.type, (sData.byCourseType.get(course.type) || 0) + tuition / relatedStudents.length);
            });
          }
        }
      });

      // 构建结果
      const result: RevenueStats = {
        total,
        totalSchedules: validSchedules.length,
        byCourseType: Array.from(byCourseType.entries()).map(([type, amount]) => ({
          type: type as CourseType,
          typeName: courseTypeNames[type] || '未知',
          amount,
          percentage: total > 0 ? Math.round(amount / total * 10000) / 100 : 0
        })),
        bySourceType: Array.from(bySourceType.entries()).map(([sourceType, amount]) => ({
          sourceType: sourceType as CourseSourceType,
          sourceName: sourceTypeNames[sourceType] || '未知',
          amount,
          percentage: total > 0 ? Math.round(amount / total * 10000) / 100 : 0
        })),
        byInstitution: Array.from(byInstitution.entries()).map(([instId, amount]) => {
          const institutions = dbService.getAllInstitutions ? dbService.getAllInstitutions() : [];
          const inst = institutions.find((i: any) => i.id === instId);
          return {
            institutionId: instId,
            institutionName: inst?.name || '未知机构',
            amount,
            percentage: total > 0 ? Math.round(amount / total * 10000) / 100 : 0
          };
        }),
        byMonth: Array.from(byMonth.entries()).map(([month, amount]) => ({
          month,
          amount
        })).sort((a, b) => a.month.localeCompare(b.month))
      };
      setStats(result);

      // ========== 老师收入统计 ==========
      const teacherIncomeMap = new Map<string, { total: number; courseCount: number }>();
      validSchedules.forEach(schedule => {
        const course = courses.find(c => c.id === schedule.course_id);
        if (!course || !course.teacher_id) return;
        // 老师筛选
        if (filterTeacherId && course.teacher_id !== filterTeacherId) return;
        
        const startTime = schedule.start_time.split(' ')[1];
        const endTime = schedule.end_time.split(' ')[1];
        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);
        const hours = (endH * 60 + endM - startH * 60 - startM) / 60;
        
        let teacherFee = 0;
        if (course.billing_unit === BillingUnit.PER_SESSION) {
          // 按次课计费
          teacherFee = course.price_teacher || 0;
          if (course.teacher_fee_mode === TeacherFeeMode.PER_STUDENT && course.student_pricings) {
            const activeStudents = course.student_pricings.filter(sp => sp.status !== ScheduleStatus.LEAVE && sp.status !== ScheduleStatus.CANCELLED).length;
            teacherFee = (course.price_teacher || 0) * (activeStudents || 1);
          }
        } else {
          // 按小时计费
          teacherFee = (course.price_teacher || 0) * hours;
          if (course.teacher_fee_mode === TeacherFeeMode.PER_STUDENT && course.student_pricings) {
            const activeStudents = course.student_pricings.filter(sp => sp.status !== ScheduleStatus.LEAVE && sp.status !== ScheduleStatus.CANCELLED).length;
            teacherFee = (course.price_teacher || 0) * hours * (activeStudents || 1);
          }
        }
        
        const tid = course.teacher_id;
        if (!teacherIncomeMap.has(tid)) {
          teacherIncomeMap.set(tid, { total: 0, courseCount: 0 });
        }
        const tData = teacherIncomeMap.get(tid)!;
        tData.total += teacherFee;
        tData.courseCount += 1;
      });
      
      const teacherIncomeResult = Array.from(teacherIncomeMap.entries()).map(([teacherId, data]) => {
        const teacher = teachers.find((t: any) => t.id === teacherId);
        return {
          teacherId,
          teacherName: teacher?.name || '未知老师',
          total: Math.round(data.total * 100) / 100,
          courseCount: data.courseCount
        };
      }).sort((a, b) => b.total - a.total);
      setTeacherIncomeStats(teacherIncomeResult);

      // 学生统计
      const allStudentsForStats = students;
      let studentResult: StudentTuitionStats[] = Array.from(studentTuitionMap.entries()).map(([studentId, data]) => {
        const student = allStudentsForStats.find((s: any) => s.id === studentId);
        return {
          studentId,
          studentName: student?.name || '未知学生',
          total: Math.round(data.total * 100) / 100,
          byCourseType: Array.from(data.byCourseType.entries()).map(([type, amount]) => ({
            type: type as CourseType,
            typeName: courseTypeNames[type] || '未知',
            amount: Math.round(amount * 100) / 100,
            percentage: data.total > 0 ? Math.round(amount / data.total * 10000) / 100 : 0
          }))
        };
      });
      
      // 学生筛选
      if (filterStudentId) {
        studentResult = studentResult.filter(s => s.studentId === filterStudentId);
      }
      
      studentResult.sort((a, b) => b.total - a.total);
      setStudentStats(studentResult);
      setLastRefresh(new Date().toLocaleTimeString());
      message.success('统计数据已刷新');
    } catch (e) {
      console.error('统计加载失败', e);
      message.error('统计加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  // 图表数据
  const courseTypeChartData = stats?.byCourseType ? {
    labels: stats.byCourseType.map(ct => ct.typeName),
    datasets: [{
      label: '收入（元）',
      data: stats.byCourseType.map(ct => ct.amount),
      backgroundColor: ['#1890ff', '#52c41a', '#faad14', '#f5222d'],
    }]
  } : null;

  const sourceTypeChartData = stats?.bySourceType ? {
    labels: stats.bySourceType.map(st => st.sourceName),
    datasets: [{
      data: stats.bySourceType.map(st => st.percentage),
      backgroundColor: ['#1890ff', '#52c41a', '#faad14'],
    }]
  } : null;

  const monthTrendChartData = stats?.byMonth ? {
    labels: stats.byMonth.map(m => m.month),
    datasets: [{
      label: '月收入（元）',
      data: stats.byMonth.map(m => m.amount),
      borderColor: '#1890ff',
      backgroundColor: 'rgba(24, 144, 255, 0.2)',
      fill: true,
    }]
  } : null;

  const studentColumns = [
    { title: '学生姓名', dataIndex: 'studentName', key: 'studentName', width: 150 },
    { 
      title: '总学费', 
      dataIndex: 'total', 
      key: 'total',
      width: 120,
      render: (amount: number) => <Tag color="green">¥{amount.toFixed(2)}</Tag>
    },
    {
      title: '按班型分布',
      key: 'byCourseType',
      render: (_: any, record: StudentTuitionStats) => (
        <Space size="small">
          {record.byCourseType?.map(ct => (
            <Tag key={ct.type} color="blue">{ct.typeName}: ¥{ct.amount.toFixed(0)}</Tag>
          ))}
        </Space>
      )
    }
  ];

  return (
    <div>
      {/* 日期范围选择 + 统计按钮 */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col>
            <Space>
              <span>统计范围：</span>
              <RangePicker 
                value={dateRange}
                onChange={(dates) => dates && setDateRange([dates[0] as dayjs.Dayjs, dates[1] as dayjs.Dayjs])}
              />
            </Space>
          </Col>
          <Col>
            <Button 
              type="primary" 
              icon={<ReloadOutlined />} 
              onClick={loadStats}
              loading={loading}
            >
              统计
            </Button>
          </Col>
          {lastRefresh && (
            <Col>
              <span style={{ color: '#999', fontSize: 12 }}>上次刷新：{lastRefresh}</span>
            </Col>
          )}
          <Col flex="auto" />
          <Col>
            <Space>
              <Button icon={<BarChartOutlined />} onClick={() => setShowChart(showChart === 'bar' ? null : 'bar')}>班型收入图</Button>
              <Button icon={<PieChartOutlined />} onClick={() => setShowChart(showChart === 'pie' ? null : 'pie')}>来源占比图</Button>
              <Button icon={<LineChartOutlined />} onClick={() => setShowChart(showChart === 'line' ? null : 'line')}>月度趋势图</Button>
            </Space>
          </Col>
        </Row>
        <Divider style={{ margin: '12px 0' }} />
        <Row gutter={16} align="middle">
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
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={allStudents.map((s: any) => ({ label: s.name, value: s.id }))}
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
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={allTeachers.map((t: any) => ({ label: t.name, value: t.id }))}
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
      </Card>

      {/* 总览统计 */}
      {stats && (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}>
              <Card>
                <Statistic 
                  title="总收入（按排课计算）" 
                  value={stats.total} 
                  precision={2}
                  prefix="¥"
                  valueStyle={{ color: '#3f8600' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic 
                  title="排课数量" 
                  value={stats.totalSchedules || 0}
                  suffix="节"
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic 
                  title="统计月份数" 
                  value={stats.byMonth?.length || 0}
                  suffix="个月"
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic 
                  title="班型数量" 
                  value={stats.byCourseType?.length || 0}
                  suffix="种"
                />
              </Card>
            </Col>
          </Row>
        </>
      )}

      {/* 无数据提示 */}
      {(!stats || stats.total === 0) && !loading && (
        <Card style={{ marginBottom: 16, textAlign: 'center' }}>
          <Empty description={
            <span>
              暂无统计数据，请确认：<br/>
              1. 所选日期范围内有排课记录<br/>
              2. 排课状态不是"请假"或"取消"<br/>
              3. 课程已设置学费
            </span>
          } />
        </Card>
      )}

      {/* 图表展示 */}
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
              <Button size="small" onClick={() => setShowChart(null)} style={{ marginLeft: 16 }}>关闭</Button>
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          {showChart === 'bar' && courseTypeChartData && (
            <Bar data={courseTypeChartData} options={{ responsive: true, plugins: { legend: { display: false } } }} height={80} />
          )}
          {showChart === 'pie' && sourceTypeChartData && (
            <div style={{ maxWidth: 400, margin: '0 auto' }}>
              <Pie data={sourceTypeChartData} options={{ responsive: true, plugins: { legend: { position: 'bottom' } } }} />
            </div>
          )}
          {showChart === 'line' && monthTrendChartData && (
            <Line data={monthTrendChartData} options={{ responsive: true, plugins: { legend: { display: false } } }} height={80} />
          )}
        </Card>
      )}

      {/* 多维度统计表格 */}
      {stats && stats.total > 0 && (
        <Row gutter={16}>
          <Col span={12}>
            <Card title="📊 按班型统计" size="small" style={{ marginBottom: 16 }}>
              <Table 
                columns={[
                  { title: '班型', dataIndex: 'typeName', key: 'typeName' },
                  { 
                    title: '收入', 
                    dataIndex: 'amount', 
                    key: 'amount',
                    render: (amount: number) => `¥${amount.toFixed(2)}`
                  },
                  { 
                    title: '占比', 
                    dataIndex: 'percentage', 
                    key: 'percentage',
                    render: (pct: number) => `${pct}%`
                  }
                ]}
                dataSource={stats.byCourseType}
                rowKey="typeName"
                pagination={false}
                size="small"
              />
            </Card>
          </Col>
          
          <Col span={12}>
            <Card title="🏢 按课程来源统计" size="small" style={{ marginBottom: 16 }}>
              <Table 
                columns={[
                  { title: '来源', dataIndex: 'sourceName', key: 'sourceName' },
                  { 
                    title: '收入', 
                    dataIndex: 'amount', 
                    key: 'amount',
                    render: (amount: number) => `¥${amount.toFixed(2)}`
                  },
                  { 
                    title: '占比', 
                    dataIndex: 'percentage', 
                    key: 'percentage',
                    render: (pct: number) => `${pct}%`
                  }
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

      {stats && stats.byInstitution && stats.byInstitution.length > 0 && (
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col span={12}>
            <Card title="🏛️ 按机构统计" size="small" style={{ marginBottom: 16 }}>
              <Table 
                columns={[
                  { title: '机构', dataIndex: 'institutionName', key: 'institutionName' },
                  { 
                    title: '收入', 
                    dataIndex: 'amount', 
                    key: 'amount',
                    render: (amount: number) => `¥${amount.toFixed(2)}`
                  },
                  { 
                    title: '占比', 
                    dataIndex: 'percentage', 
                    key: 'percentage',
                    render: (pct: number) => `${pct}%`
                  }
                ]}
                dataSource={stats.byInstitution}
                rowKey="institutionName"
                pagination={false}
                size="small"
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* 老师收入统计 */}
      <Card title={`💰 老师收入统计${filterTeacherId ? '（已筛选）' : ''}`} size="small" style={{ marginTop: 16 }}>
        {teacherIncomeStats.length > 0 ? (
          <Table 
            columns={[
              { title: '老师姓名', dataIndex: 'teacherName', key: 'teacherName', width: 150 },
              { 
                title: '收入', 
                dataIndex: 'total', 
                key: 'total',
                width: 120,
                render: (amount: number) => <Tag color="orange">¥{amount.toFixed(2)}</Tag>
              },
              { 
                title: '课程数', 
                dataIndex: 'courseCount', 
                key: 'courseCount',
                width: 100,
                render: (count: number) => `${count} 节`
              }
            ]}
            dataSource={teacherIncomeStats}
            rowKey="teacherId"
            pagination={{ pageSize: 10 }}
            size="small"
          />
        ) : (
          <Empty description="暂无老师收入数据" />
        )}
      </Card>

      {/* 学生学费统计 */}
      <Card title={`👨‍🎓 学生学费统计（按班型）${filterStudentId ? '（已筛选）' : ''}`} size="small" style={{ marginTop: 16 }}>
        {studentStats.length > 0 ? (
          <Table 
            columns={studentColumns}
            dataSource={studentStats}
            rowKey="studentId"
            pagination={{ pageSize: 10 }}
            size="small"
          />
        ) : (
          <Empty description="暂无学生学费数据" />
        )}
      </Card>
    </div>
  );
};

export default RevenueStatistics;
