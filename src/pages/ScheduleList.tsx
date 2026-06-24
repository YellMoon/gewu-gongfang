import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, DatePicker, Tag, Space, message
} from 'antd';
import { SearchOutlined, DownloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { Schedule, ScheduleStatus, Student, Teacher, Course } from '../types';
import * as XLSX from 'xlsx-js-style';
import AutoCloseSelect from '../components/AutoCloseSelect';
import DataPageLayout from '../layout/DataPageLayout';
import { buildCourseColorMap } from '../utils/courseColors';
import {
  buildScheduleExportModel,
  createScheduleWorkbook,
} from '../utils/scheduleExcelExport.mjs';
import { applyScheduleListFilters } from '../utils/scheduleListFilters.mjs';

const { RangePicker } = DatePicker;

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
  const [appliedFilters, setAppliedFilters] = useState<{
    filterTeacher?: string;
    filterStudent?: string;
    filterDateRange: [dayjs.Dayjs, dayjs.Dayjs] | null;
  }>({
    filterTeacher: undefined,
    filterStudent: undefined,
    filterDateRange: null,
  });

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

  // 鏁版嵁鍒锋柊鏃朵繚鐣欏凡搴旂敤鐨勬煡璇㈡潯浠讹紝閬垮厤瀹氭椂鍒锋柊鍚庡洖鍒板叏閲?
  useEffect(() => {
    setFilteredSchedules(applyScheduleListFilters(schedules, courses, appliedFilters));
  }, [schedules, courses, appliedFilters]);

  const handleQuery = () => {
    const nextFilters = { filterTeacher, filterStudent, filterDateRange };
    const result = applyScheduleListFilters(schedules, courses, nextFilters);
    setAppliedFilters(nextFilters);
    setFilteredSchedules(result);
    message.success(`查询完成，共 ${result.length} 条记录`);
  };

  // 瀵煎嚭涓?Excel
  const handleExport = () => {
    if (filteredSchedules.length === 0) {
      message.warning('没有数据可导出');
      return;
    }

    const exportModel = buildScheduleExportModel({
      schedules: filteredSchedules,
      courses,
      teachers,
      students,
      filterTeacher,
      filterStudent,
      dateRange: filterDateRange ? [
        filterDateRange[0].format('YYYY-MM-DD'),
        filterDateRange[1].format('YYYY-MM-DD'),
      ] : undefined,
      courseColorMap: buildCourseColorMap(courses),
    });
    const workbook = createScheduleWorkbook(XLSX, exportModel);
    XLSX.writeFile(workbook, exportModel.fileName);
    message.success('已导出 ' + filteredSchedules.length + ' 条记录到 ' + exportModel.fileName);
    return;

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
          const statusText = getScheduleStatusText(s);

          excelData.push({
            '日期': idx === 0 ? dayjs(dayStr).format('M月D日') : '',
            '星期': idx === 0 ? dayLabel : '',
            '时间': `${startTime}-${endTime}`,
            '课程名称': s.course_name || course?.name || '',
            '年份': s.course_year || course?.year || '',
            '学期': s.course_semester || course?.semester || '',
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
      { wch: 10 }, // 年份
      { wch: 12 }, // 学期
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
      case ScheduleStatus.LEAVE: return 'orange';
      case ScheduleStatus.CANCELLED: return 'red';
      default: return 'gray';
    }
  };

  const getScheduleStatusText = (record: any) => {
    if (record.status === ScheduleStatus.PLANNED && dayjs(record.end_time).isBefore(dayjs())) {
      return '已结束';
    }
    return getStatusText(record.status);
  };

  const getScheduleStatusColor = (record: any) => {
    if (record.status === ScheduleStatus.PLANNED && dayjs(record.end_time).isBefore(dayjs())) {
      return 'green';
    }
    return getStatusColor(record.status);
  };

  const getStatusText = (status: any) => {
    switch (status) {
      case ScheduleStatus.PLANNED: return '计划中';
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

  const getCourseMeta = (record: any) => {
    const course = courses.find(c => c.id === record.course_id);
    return {
      year: record.course_year || course?.year || '-',
      semester: record.course_semester || course?.semester || '-',
    };
  };

  const columns: ColumnsType<any> = [
    { title: '序号', key: 'index', width: 60, render: (_, __, index) => index + 1 },
    { title: '日期', key: 'date', width: 100, render: (_, record) => dayjs(record.start_time).format('YYYY-MM-DD') },
    { title: '时间', key: 'time', width: 120, render: (_, record) => {
      const s = dayjs(record.start_time);
      const e = dayjs(record.end_time);
      return `${s.format('HH:mm')} - ${e.format('HH:mm')}`;
    } },
    { title: '年份', key: 'course_year', width: 80, render: (_, record) => getCourseMeta(record).year },
    { title: '学期', key: 'course_semester', width: 90, render: (_, record) => getCourseMeta(record).semester },
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
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (_: any, record) => <Tag color={getScheduleStatusColor(record)}>{getScheduleStatusText(record)}</Tag> },
    { title: '教室', dataIndex: 'room', key: 'room', width: 120 },
    { title: '备注', dataIndex: 'notes', key: 'notes', width: 160, ellipsis: true },
  ];

  return (
    <DataPageLayout
      toolbar={(
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Space wrap size={12} align="center">
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
            <RangePicker
              style={{ width: 240 }}
              placeholder={['开始日期', '结束日期']}
              value={filterDateRange as any}
              onChange={(val) => setFilterDateRange(val as [dayjs.Dayjs, dayjs.Dayjs])}
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={handleQuery}>
              查询
            </Button>
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出
            </Button>
          </Space>
          <Space>
            <span style={{ color: '#666' }}>共 {filteredSchedules.length} 条记录</span>
          </Space>
        </div>
      )}
      table={(
        <Table
          columns={columns}
          dataSource={filteredSchedules}
          rowKey="id"
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }}
          scroll={{ x: 1280 }}
          size="small"
        />
      )}
      drawerOpen={false}
      drawerTitle=""
      onDrawerClose={() => undefined}
      drawerContent={null}
    />
  );
};

export default ScheduleList;
