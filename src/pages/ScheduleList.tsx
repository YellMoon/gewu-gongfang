import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Card, Row, Col, Select, DatePicker, Tag, Space, message
} from 'antd';
import { CalendarOutlined, SearchOutlined, DownloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { Schedule, ScheduleStatus, Student, Teacher, Course } from '../types';
import * as XLSX from 'xlsx';

const { Option } = Select;
const { RangePicker } = DatePicker;

// 一周的天数列表
const WEEK_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const ScheduleList: React.FC = () => {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [filteredSchedules, setFilteredSchedules] = useState<any[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [filterTeacher, setFilterTeacher] = useState<string | undefined>();
  const [filterStudent, setFilterStudent] = useState<string | undefined>();
  const [filterDateRange, setFilterDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);

  const dbService = (window as any).dbService;

  const loadData = useCallback(async () => {
    if (!dbService) {
      console.warn('dbService not available yet');
      return;
    }
    // 从课程表组件保存的 localStorage 读取排课数据
    let scheduleData: any[] = [];
    try {
      // 主要数据源：ScheduleCalendar 保存到 'schedules' key
      const stored1 = localStorage.getItem('schedules');
      // 备选数据源：之前可能的 key
      const stored2 = localStorage.getItem('scheduleCalendar');
      
      if (stored1) {
        const parsed = JSON.parse(stored1);
        if (Array.isArray(parsed)) scheduleData = parsed;
      } else if (stored2) {
        const parsed = JSON.parse(stored2);
        if (Array.isArray(parsed)) scheduleData = parsed;
      }
    } catch (e) {
      console.warn('Failed to parse schedule data:', e);
    }

    // 过滤掉已删除的排课
    scheduleData = scheduleData.filter((s: any) => s.status !== 'DELETED');

    // 按时间排序（最新在前）
    scheduleData.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

    setSchedules(scheduleData);
    
    try {
      setStudents(dbService.getAllStudents?.() || []);
      setTeachers(dbService.getAllTeachers?.() || []);
      setCourses(dbService.getAllCourses?.() || []);
    } catch (e) {
      console.warn('Failed to load reference data:', e);
    }
  }, [dbService]);

  useEffect(() => {
    loadData();
    // 定期刷新数据
    const timer = setInterval(loadData, 10000);
    return () => clearInterval(timer);
  }, [loadData]);

  // 初始显示所有排课（不自动筛选）
  useEffect(() => {
    setFilteredSchedules(schedules);
  }, [schedules]);

  // "查询"按钮 - 点击后根据筛选条件过滤
  const handleQuery = () => {
    let result = [...schedules];

    // 老师筛选
    if (filterTeacher) {
      result = result.filter((s) => {
        const course = courses.find(c => c.id === s.course_id);
        return course?.teacher_id === filterTeacher;
      });
    }

    // 学生筛选
    if (filterStudent) {
      result = result.filter((s) => {
        const course = courses.find(c => c.id === s.course_id);
        return course?.student_pricings?.some((p: any) => p.student_id === filterStudent) ||
          s.student_ids?.includes(filterStudent);
      });
    }

    // 日期范围筛选
    if (filterDateRange) {
      const [start, end] = filterDateRange;
      result = result.filter((s) => {
        const sDate = dayjs(s.start_time).startOf('day');
        return sDate.isAfter(start.startOf('day')) && sDate.isBefore(end.endOf('day'));
      });
    }

    // 按时间排序（倒序）
    result.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

    setFilteredSchedules(result);
    message.success(`查询完成，共 ${result.length} 条记录`);
  };

  // 导出为 Excel
  const handleExport = () => {
    if (filteredSchedules.length === 0) {
      message.warning('没有数据可导出');
      return;
    }

    // 按周分组
    const weekGroups: Record<string, any[]> = {};
    
    filteredSchedules.forEach(s => {
      const date = dayjs(s.start_time);
      // 获取周一日期作为周标识
      const monday = date.startOf('isoWeek').format('YYYY-MM-DD');
      if (!weekGroups[monday]) weekGroups[monday] = [];
      weekGroups[monday].push(s);
    });

    // 生成 Excel 数据（每周一行表头 + 数据行）
    const excelData: any[] = [];
    const wscols: Array<{ wch: number }> = [];

    Object.keys(weekGroups).sort().forEach(weekMonday => {
      const monday = dayjs(weekMonday);
      const sunday = monday.add(6, 'day');
      const weekLabel = `${monday.format('M月D日')} - ${sunday.format('M月D日')}`;
      
      // 周表头行
      excelData.push({ '课程表': `📅 ${weekLabel}`, '_a': '', '_b': '', '_c': '', '_d': '', '_e': '', '_f': '' });

      // 按日期分组
      const dayGroups: Record<string, any[]> = {};
      weekGroups[weekMonday].forEach(s => {
        const dayStr = dayjs(s.start_time).format('YYYY-MM-DD');
        if (!dayGroups[dayStr]) dayGroups[dayStr] = [];
        dayGroups[dayStr].push(s);
      });

      Object.keys(dayGroups).sort().forEach(dayStr => {
        const daySchedules = dayGroups[dayStr];
        const dayLabel = dayjs(dayStr).format('dddd');
        
        daySchedules.forEach((s, idx) => {
          const course = courses.find(c => c.id === s.course_id);
          const startTime = dayjs(s.start_time).format('HH:mm');
          const endTime = dayjs(s.end_time).format('HH:mm');
          const teacherName = course ? (teachers.find(t => t.id === course.teacher_id)?.name || '') : '';
          const studentNames: string[] = [];
          if (course?.student_pricings) {
            course.student_pricings.forEach((sp: any) => {
              const st = students.find(st => st.id === sp.student_id);
              if (st) studentNames.push(st.name);
            });
          }
          const statusText = getStatusText(s.status);

          excelData.push({
            '日期': idx === 0 ? dayjs(dayStr).format('M月D日') : '',
            '星期': idx === 0 ? dayLabel : '',
            '时间': `${startTime}-${endTime}`,
            '课程名称': s.course_name || course?.name || '',
            '老师': teacherName,
            '学生': studentNames.join(', '),
            '上课地址': s.room || course?.room_name || '',
            '状态': statusText,
            '备注': s.notes || '',
          });
        });
      });

      // 空行分隔周
      excelData.push({});
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(wb, ws, '排课列表');

    // 自动列宽
    ws['!cols'] = [
      { wch: 12 }, // 日期
      { wch: 10 }, // 星期
      { wch: 14 }, // 时间
      { wch: 30 }, // 课程名称
      { wch: 12 }, // 老师
      { wch: 25 }, // 学生
      { wch: 18 }, // 上课地址
      { wch: 10 }, // 状态
      { wch: 20 }, // 备注
    ];

    const fileName = `排课列表_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`;
    XLSX.writeFile(wb, fileName);
    message.success(`已导出 ${filteredSchedules.length} 条记录到 ${fileName}`);
  };

  const getStatusColor = (status: any) => {
    switch (status) {
      case ScheduleStatus.PLANNED: return 'blue';
      case ScheduleStatus.COMPLETED: return 'green';
      case ScheduleStatus.LEAVE: return 'orange';
      case ScheduleStatus.CANCELLED: return 'red';
      default: return 'gray';
    }
  };

  const getStatusText = (status: any) => {
    switch (status) {
      case ScheduleStatus.PLANNED: return '计划中';
      case ScheduleStatus.COMPLETED: return '已完成';
      case ScheduleStatus.LEAVE: return '请假';
      case ScheduleStatus.CANCELLED: return '已取消';
      default: return '未知';
    }
  };

  const getTeacherName = (teacherId: string) => {
    return teachers.find(t => t.id === teacherId)?.name || '未知老师';
  };

  const getStudentName = (studentId: string) => {
    return students.find(s => s.id === studentId)?.name || '未知学生';
  };

  const getCourseName = (courseId: string) => {
    return courses.find(c => c.id === courseId)?.name || '未知课程';
  };

  const columns: ColumnsType<any> = [
    { title: '#', key: 'index', width: 50, render: (_, __, index) => index + 1 },
    { title: '日期', key: 'date', width: 100, render: (_, record) => dayjs(record.start_time).format('YYYY-MM-DD') },
    { title: '时间', key: 'time', width: 120, render: (_, record) => {
      const s = dayjs(record.start_time);
      const e = dayjs(record.end_time);
      return `${s.format('HH:mm')} - ${e.format('HH:mm')}`;
    } },
    { title: '课程', dataIndex: 'course_id', key: 'course_id', width: 160, render: (id: string) => getCourseName(id) },
    { title: '老师', key: 'teacher', width: 90, render: (_, record) => {
      const course = courses.find(c => c.id === record.course_id);
      return getTeacherName(course?.teacher_id || '');
    } },
    { title: '学生', key: 'students', width: 160, render: (_, record) => {
      const course = courses.find(c => c.id === record.course_id);
      const studentIds: string[] = record.student_ids || course?.student_pricings?.map((p: any) => p.student_id) || [];
      return studentIds.map((id: string) => getStudentName(id)).join(', ');
    } },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (status: any) => <Tag color={getStatusColor(status)}>{getStatusText(status)}</Tag> },
    { title: '教室', dataIndex: 'room', key: 'room', width: 120 },
    { title: '备注', dataIndex: 'notes', key: 'notes', width: 160, ellipsis: true },
  ];

  return (
    <div style={{ padding: 0 }}>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={12} align="middle">
          <Col>
            <Select
              placeholder="老师"
              allowClear
              showSearch
              style={{ width: 130 }}
              value={filterTeacher}
              onChange={(val) => setFilterTeacher(val)}
              filterOption={(input, option) =>
                (typeof option?.children === 'string' ? option.children : '').toLowerCase().includes(input.toLowerCase())
              }
            >
              {teachers.map(t => <Option key={t.id} value={t.id}>{t.name}</Option>)}
            </Select>
          </Col>
          <Col>
            <Select
              placeholder="学生"
              allowClear
              showSearch
              style={{ width: 130 }}
              value={filterStudent}
              onChange={(val) => setFilterStudent(val)}
              filterOption={(input, option) =>
                (typeof option?.children === 'string' ? option.children : '').toLowerCase().includes(input.toLowerCase())
              }
            >
              {students.map(s => <Option key={s.id} value={s.id}>{s.name}</Option>)}
            </Select>
          </Col>
          <Col>
            <RangePicker
              style={{ width: 240 }}
              value={filterDateRange as any}
              onChange={(val) => setFilterDateRange(val as [dayjs.Dayjs, dayjs.Dayjs])}
            />
          </Col>
          <Col>
            <Button type="primary" icon={<SearchOutlined />} onClick={handleQuery}>
              查询
            </Button>
          </Col>
          <Col>
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出
            </Button>
          </Col>
        </Row>
      </Card>

      <Card>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}><CalendarOutlined /> 排课列表</h3>
          <Space>
            <span style={{ color: '#666' }}>共 {filteredSchedules.length} 条记录</span>
            <Button size="small" onClick={() => {
              setFilterTeacher(undefined);
              setFilterStudent(undefined);
              setFilterDateRange(null);
              setFilteredSchedules(schedules);
            }}>
              重置
            </Button>
          </Space>
        </div>

        <Table
          columns={columns}
          dataSource={filteredSchedules}
          rowKey="id"
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }}
          scroll={{ x: 1100 }}
          size="small"
        />
      </Card>
    </div>
  );
};

export default ScheduleList;
