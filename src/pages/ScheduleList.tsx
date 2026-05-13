import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Card, Row, Col, Select, DatePicker, Tag, Space, message
} from 'antd';
import { CalendarOutlined, SearchOutlined, DownloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { Schedule, ScheduleStatus, Student, Teacher, Course } from '../types';
import * as XLSX from 'xlsx';
import AutoCloseSelect from '../components/AutoCloseSelect';

const { RangePicker } = DatePicker;

// 涓€鍛ㄧ殑澶╂暟鍒楄〃
const WEEK_DAYS = ['鍛ㄤ竴', '鍛ㄤ簩', '鍛ㄤ笁', '鍛ㄥ洓', '鍛ㄤ簲', '鍛ㄥ叚', '鍛ㄦ棩'];

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
    // 浠庤绋嬭〃缁勪欢淇濆瓨鐨?localStorage 璇诲彇鎺掕鏁版嵁
    let scheduleData: any[] = [];
    try {
      // 涓昏鏁版嵁婧愶細ScheduleCalendar 淇濆瓨鍒?'schedules' key
      const stored1 = localStorage.getItem('schedules');
      // 澶囬€夋暟鎹簮锛氫箣鍓嶅彲鑳界殑 key
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

    // 杩囨护鎺夊凡鍒犻櫎鐨勬帓璇?    scheduleData = scheduleData.filter((s: any) => s.status !== 'DELETED');

    // 鎸夋椂闂存帓搴忥紙鏈€鏂板湪鍓嶏級
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
    // 瀹氭湡鍒锋柊鏁版嵁
    const timer = setInterval(loadData, 10000);
    return () => clearInterval(timer);
  }, [loadData]);

  // 鍒濆鏄剧ず鎵€鏈夋帓璇撅紙涓嶈嚜鍔ㄧ瓫閫夛級
  useEffect(() => {
    setFilteredSchedules(schedules);
  }, [schedules]);

  const handleQuery = () => {
    let result = [...schedules];

    if (filterTeacher) {
      result = result.filter((s) => {
        const course = courses.find(c => c.id === s.course_id);
        return course?.teacher_id === filterTeacher;
      });
    }

    if (filterStudent) {
      result = result.filter((s) => {
        const course = courses.find(c => c.id === s.course_id);
        return course?.student_pricings?.some((p: any) => p.student_id === filterStudent) ||
          s.student_ids?.includes(filterStudent);
      });
    }

    if (filterDateRange) {
      const [start, end] = filterDateRange;
      result = result.filter((s) => {
        const sDate = dayjs(s.start_time).startOf('day');
        return sDate.isAfter(start.startOf('day')) && sDate.isBefore(end.endOf('day'));
      });
    }

    result.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

    setFilteredSchedules(result);
    message.success(`查询完成，共 ${result.length} 条记录`);
  };

  // 瀵煎嚭涓?Excel
  const handleExport = () => {
    if (filteredSchedules.length === 0) {
      message.warning('没有数据可导出');
      return;
    }

    // 鎸夊懆鍒嗙粍
    const weekGroups: Record<string, any[]> = {};
    
    filteredSchedules.forEach(s => {
      const date = dayjs(s.start_time);
      const monday = date.startOf('isoWeek').format('YYYY-MM-DD');
      if (!weekGroups[monday]) weekGroups[monday] = [];
      weekGroups[monday].push(s);
    });

    // 鐢熸垚 Excel 鏁版嵁锛堟瘡鍛ㄤ竴琛岃〃澶?+ 鏁版嵁琛岋級
    const excelData: any[] = [];
    const wscols: Array<{ wch: number }> = [];

    Object.keys(weekGroups).sort().forEach(weekMonday => {
      const monday = dayjs(weekMonday);
      const sunday = monday.add(6, 'day');
      const weekLabel = `${monday.format('M月D日')} - ${sunday.format('M月D日')}`;
      
      // 鍛ㄨ〃澶磋
      excelData.push({ '课程表': weekLabel, '_a': '', '_b': '', '_c': '', '_d': '', '_e': '', '_f': '' });

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

      excelData.push({});
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    XLSX.utils.book_append_sheet(wb, ws, '排课列表');

    // 鑷姩鍒楀
    ws['!cols'] = [
      { wch: 12 }, // 鏃ユ湡
      { wch: 10 }, // 鏄熸湡
      { wch: 14 }, // 鏃堕棿
      { wch: 30 }, // 璇剧▼鍚嶇О
      { wch: 12 }, // 鑰佸笀
      { wch: 25 }, // 瀛︾敓
      { wch: 18 }, // 涓婅鍦板潃
      { wch: 10 },
      { wch: 20 },
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
    return teachers.find(t => t.id === teacherId)?.name || '鏈煡鑰佸笀';
  };

  const getStudentName = (studentId: string) => {
    return students.find(s => s.id === studentId)?.name || '鏈煡瀛︾敓';
  };

  const getCourseName = (courseId: string) => {
    return courses.find(c => c.id === courseId)?.name || '鏈煡璇剧▼';
  };

  const columns: ColumnsType<any> = [
    { title: '#', key: 'index', width: 50, render: (_, __, index) => index + 1 },
    { title: '鏃ユ湡', key: 'date', width: 100, render: (_, record) => dayjs(record.start_time).format('YYYY-MM-DD') },
    { title: '鏃堕棿', key: 'time', width: 120, render: (_, record) => {
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
            <AutoCloseSelect
              placeholder="老师"
              allowClear
              showSearch
              style={{ width: 130 }}
              value={filterTeacher}
              onChange={(val: string | undefined) => setFilterTeacher(val)}
              options={teachers.map(t => ({ label: t.name, value: t.id }))}
              filterOption={(input: string, option: any) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          <Col>
            <AutoCloseSelect
              placeholder="学生"
              allowClear
              showSearch
              style={{ width: 130 }}
              value={filterStudent}
              onChange={(val: string | undefined) => setFilterStudent(val)}
              options={students.map(s => ({ label: s.name, value: s.id }))}
              filterOption={(input: string, option: any) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Col>
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
