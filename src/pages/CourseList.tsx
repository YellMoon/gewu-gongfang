import React, { useState, useEffect } from 'react';
import { 
  Table, Button, Form, Input, InputNumber, Modal, Select as AntSelect,
  Space, message, Popconfirm, Tag, Row, Col, Divider
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, PlusCircleOutlined, MinusCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Course, CourseType, CourseSourceType, Institution, BillingUnit, TeacherFeeMode, ServiceType, Teacher, StudentCoursePricing, Student } from '../types';
import AutoCloseSelect from '../components/AutoCloseSelect';
import { getColorForRoom } from '../utils/courseColors';
import { filterCourses } from '../utils/courseFilters';
import DataPageLayout from '../layout/DataPageLayout';

const Select = AutoCloseSelect as typeof AntSelect;
const { Option } = Select;
const { Item } = Form;

const courseTypeMap: Record<CourseType, string> = {
  [CourseType.ONE_ON_ONE]: '一对一',
  [CourseType.ONE_ON_TWO]: '一对二',
  [CourseType.GROUP]: '小组课',
  [CourseType.LARGE_CLASS]: '大班课',
};

const semesterOptions = ['春学期', '秋学期', '寒假', '暑假'];

const courseSourceTypeMap: Record<CourseSourceType, string> = {
  [CourseSourceType.SELF]: '自有课程',
  [CourseSourceType.INSTITUTION]: '机构排课',
  [CourseSourceType.MIXED]: '混合班',
};

const billingUnitMap: Record<BillingUnit, string> = {
  [BillingUnit.PER_HOUR]: '元/小时',
  [BillingUnit.PER_SESSION]: '元/次',
};

const teacherFeeModeMap: Record<TeacherFeeMode, string> = {
  [TeacherFeeMode.PER_SESSION]: '按一次课',
  [TeacherFeeMode.PER_STUDENT]: '按学生分摊',
};

const serviceTypeMap: Record<ServiceType, string> = {
  [ServiceType.IN_CENTER]: '中心内',
  [ServiceType.AT_HOME]: '上门',
};

const CourseList: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [filteredCourses, setFilteredCourses] = useState<Course[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [filterType, setFilterType] = useState<CourseType | undefined>();
  const [filterSource, setFilterSource] = useState<CourseSourceType | undefined>();
  const [filterActive, setFilterActive] = useState<boolean | undefined>(true);
  const [filterTeacher, setFilterTeacher] = useState<string | undefined>();
  const [form] = Form.useForm();
  const billingUnit = Form.useWatch('billing_unit', form) ?? BillingUnit.PER_HOUR;
  const sourceType = Form.useWatch('source_type', form) as CourseSourceType | undefined;
  const studentPricingsDraft = Form.useWatch('student_pricings', form) || [];
  const isPureInstitutionCourseDraft = sourceType === CourseSourceType.INSTITUTION && studentPricingsDraft.length === 0;
  const canEditCourseTeacherFeeDirectly = isPureInstitutionCourseDraft;
  const dbService = (window as any).dbService;

  const loadData = async () => {
    if (!dbService) {
      console.warn('dbService not available yet');
      return;
    }
    const coursesData = dbService.getAllCourses();
    const institutionsData = dbService.getAllInstitutions();
    const teachersData = dbService.getAllTeachers();
    const studentsData = dbService.getAllStudents();
    // 获取已保存的上课地址
    const roomsData = dbService.getAllRooms ? dbService.getAllRooms() : [];
    setCourses([...coursesData]);
    setStudents([...studentsData]);
    setRooms([...roomsData]);
    setInstitutions([...institutionsData]);
    setTeachers([...teachersData]);
  };

  // 过滤：只显示未结课
  useEffect(() => {
    setFilteredCourses(filterCourses(courses, { filterType, filterSource, filterTeacher, filterActive }));
  }, [courses, filterType, filterSource, filterTeacher, filterActive]);

  useEffect(() => {
    loadData();
  }, []);

  const handleAdd = () => {
    setEditingCourse(null);
    form.resetFields();
    form.setFieldsValue({ year: new Date().getFullYear() });
    setModalVisible(true);
  };

  const syncSchedulesRoomName = (savedCourse?: any) => {
    try {
      const saved = localStorage.getItem('schedules');
      if (!saved) return;
      const schedules = JSON.parse(saved);
      const allCourses = dbService.getAllCourses();
      let updated = false;
      const newSchedules = schedules.map((s: any) => {
        const course = allCourses.find((c: any) => c.id === s.course_id);
        if (course && course.room_name && s.room !== course.room_name) {
          updated = true;
          return { ...s, room: course.room_name };
        }
        return s;
      });
      if (updated) {
        localStorage.setItem('schedules', JSON.stringify(newSchedules));
      }
    } catch (e) { /* ignore */ }
  };

  const handleEdit = (course: Course) => {
    setEditingCourse(course);
    form.resetFields();
    // 显式处理年份：InputNumber 的 defaultValue 会干扰 form.setFieldsValue
    form.setFieldsValue({
      ...course,
      year: course.year !== undefined ? Number(course.year) : undefined,
    });
    setModalVisible(true);
  };

  const handleDelete = async (id: string) => {
    const deletedCourse = courses.find(c => c.id === id);
    dbService.deleteCourse(id);
    message.success('删除成功');
    (window as any).operateLogger?.log('删除', `删除课程「${deletedCourse?.display_name || deletedCourse?.name || id}」`, '课程管理');
    loadData();
  };

  const handleToggleActive = async (course: Course) => {
    const nextActive = !course.active;
    dbService.updateCourse(course.id, { active: nextActive });
    message.success(nextActive ? '已设为未结课' : '已设为已结课');
    (window as any).operateLogger?.log('修改', `修改课程「${course.display_name || course.name}」状态为「${nextActive ? '未结课' : '已结课'}」`, '课程管理');
    loadData();
  };

  const getCourseStudentNames = (course: Course) => {
    const names = (course.student_pricings || [])
      .map(pricing => students.find(student => student.id === pricing.student_id)?.name)
      .filter(Boolean);
    return names.length > 0 ? names.join('、') : '-';
  };

  const handleSubmit = async () => {
    try {
      const fv = form.getFieldsValue();
      if (!fv.display_name) { message.warning('请输入课程名称'); return; }
      if (fv.type === undefined) { message.warning('请选择课程类型'); return; }
      if (fv.source_type === undefined) { message.warning('请选择课程来源'); return; }
      if (!fv.teacher_id) { message.warning('请选择老师'); return; }
      if (fv.year === undefined || fv.year === null) { message.warning('请选择年份'); return; }
      if (!fv.semester) { message.warning('请选择学期'); return; }
      if (!fv.room_id || (Array.isArray(fv.room_id) && fv.room_id.length === 0)) { message.warning('请选择上课地址'); return; }
      if ((fv.source_type === CourseSourceType.INSTITUTION || fv.source_type === CourseSourceType.MIXED) && !fv.institution_id) {
        message.warning('请选择所属机构'); return;
      }
      let values = await form.validateFields();
      // 自动设置 teacher_name
      if (values.teacher_id) {
        const teacher = teachers.find(t => t.id === values.teacher_id);
        values.teacher_name = teacher?.name;
      }
      // 课程名称直接使用 display_name，不拼接年份和学期
      values.name = values.display_name;
      // 处理 room_id 字段（兼容旧数据可能为数组）
      if (Array.isArray(values.room_id)) {
        values.room_id = values.room_id.filter(Boolean).join(', ');
      }
      // 处理 room_name：始终从 room_id 同步最新房间名称，新地址自动录入教室表
      if (values.room_id) {
        const roomId = String(values.room_id).split(',')[0].trim();
        const room = rooms.find(r => r.id === roomId || r.name === roomId);
        if (room) {
          values.room_name = room.name;
        } else {
          // 用户输入了新地址，自动添加到教室库
          values.room_name = roomId;
          if (dbService.addOrUpdateRoom) {
            dbService.addOrUpdateRoom(roomId);
          }
        }
      } else {
        values.room_name = '';
      }
      // 自动根据上课地址分配课程颜色（如果用户未手动指定）
      if (!values.color) {
        values.color = getColorForRoom(values.room_id || values.room_name || '', rooms);
      }
      // 默认 active = true
      if (values.active === undefined) {
        values.active = true;
      }
      if (editingCourse) {
        // 确保年份被保留：防止 antd InputNumber defaultValue 导致 year 丢失
        if (values.year === undefined || values.year === null) {
          values.year = editingCourse.year !== undefined ? Number(editingCourse.year) : new Date().getFullYear();
        }
        dbService.updateCourse(editingCourse.id, values);
        message.success('更新成功');
        (window as any).operateLogger?.log('修改', `修改课程「${values.display_name || values.name}」`, '课程管理');
        // 自动同步 localStorage 排课数据中的上课地址
        syncSchedulesRoomName(values);
      } else {
        dbService.createCourse(values);
        message.success('添加成功');
        (window as any).operateLogger?.log('创建', `创建课程「${values.display_name || values.name}」`, '课程管理');
        syncSchedulesRoomName(values);
      }
      setModalVisible(false);
      // 重新加载数据确保列表刷新
      setTimeout(() => loadData(), 100);
    } catch (error: any) {
      console.error('验证失败:', error);
    }
  };

  const columns: ColumnsType<Course> = [
    { title: '序号', key: 'index', width: 70, render: (_, __, index) => index + 1 },
    { title: '年份', dataIndex: 'year', key: 'year', width: 80 },
    { title: '学期', dataIndex: 'semester', key: 'semester', width: 80 },
    { title: '课程名称', dataIndex: 'name', key: 'name', width: 180 },
    { 
      title: '课程类型', 
      dataIndex: 'type', 
      key: 'type',
      width: 90,
      render: (type: CourseType) => <Tag color="blue">{courseTypeMap[type]}</Tag>
    },
    { 
      title: '课程来源', 
      dataIndex: 'source_type', 
      key: 'source_type',
      width: 100,
      render: (sourceType: CourseSourceType) => (
        <Tag color={sourceType === CourseSourceType.SELF ? 'green' : 'orange'}>
          {courseSourceTypeMap[sourceType]}
        </Tag>
      )
    },
    { 
      title: '学费', 
      dataIndex: 'price_tuition', 
      key: 'price_tuition',
      width: 100,
      render: (price: number, record: Course) => {
        const unit = billingUnitMap[record.billing_unit];
        return `¥${price}${unit}`;
      }
    },
    { 
      title: '课时费', 
      dataIndex: 'price_teacher', 
      key: 'price_teacher',
      width: 100,
      render: (price: number, record: Course) => {
        const unit = billingUnitMap[record.billing_unit];
        return `¥${price}${unit}`;
      }
    },
    { 
      title: '状态',
      dataIndex: 'active',
      key: 'active',
      width: 100,
      render: (active: boolean, record: Course) => (
        <Button
          size="small"
          type={active ? 'primary' : 'default'}
          danger={!active}
          onClick={() => handleToggleActive(record)}
        >
          {active ? '未结课' : '已结课'}
        </Button>
      )
    },
    { 
      title: '默认时长', 
      dataIndex: 'default_duration_minutes', 
      key: 'default_duration_minutes',
      width: 90,
      render: (v: number) => v ? `${(v / 60).toFixed(1)}小时` : '-'
    },
    { title: '上课地址', dataIndex: 'room_name', key: 'room_name', width: 100 },
    { title: '老师', dataIndex: 'teacher_name', key: 'teacher_name', width: 100 },
    { title: '学生', key: 'students', width: 180, ellipsis: true, render: (_, record) => getCourseStudentNames(record) },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除吗？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const modalFooter = (
    <div className="data-page-layout__drawer-footer">
      <Button onClick={() => setModalVisible(false)}>取消</Button>
      <Button type="primary" onClick={handleSubmit}>确定</Button>
    </div>
  );

  return (
    <>
    <DataPageLayout
      toolbar={
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <Space wrap size={12}>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>添加课程</Button>
            <Select
              placeholder="筛选课程类型"
              allowClear
              style={{ width: 140 }}
              value={filterType}
              onChange={setFilterType}
            >
              <Option value={CourseType.ONE_ON_ONE}>一对一</Option>
              <Option value={CourseType.ONE_ON_TWO}>一对二</Option>
              <Option value={CourseType.GROUP}>小组课</Option>
              <Option value={CourseType.LARGE_CLASS}>大班课</Option>
            </Select>
            <Select
              placeholder="筛选课程来源"
              allowClear
              style={{ width: 140 }}
              value={filterSource}
              onChange={setFilterSource}
            >
              <Option value={CourseSourceType.SELF}>自有课程</Option>
              <Option value={CourseSourceType.INSTITUTION}>机构排课</Option>
              <Option value={CourseSourceType.MIXED}>混合班</Option>
            </Select>
            <Select
              placeholder="筛选状态"
              allowClear
              style={{ width: 140 }}
              value={filterActive}
              onChange={setFilterActive}
            >
              <Option value={true}>未结课</Option>
              <Option value={false}>已结课</Option>
            </Select>
            <Select
              placeholder="筛选老师"
              allowClear
              showSearch
              style={{ width: 180 }}
              value={filterTeacher}
              onChange={setFilterTeacher}
            >
              {teachers.map(t => (
                <Option key={t.id} value={t.id}>{t.name}</Option>
              ))}
            </Select>
          </Space>
        </div>
      }
      table={
        <Table 
          columns={columns} 
          dataSource={filteredCourses} 
          rowKey="id"
          pagination={{ pageSize: 20 }}
          scroll={{ x: 1580 }}
        />
      }
    />
    <Modal
      title={editingCourse ? '编辑课程' : '添加课程'}
      open={modalVisible}
      onCancel={() => setModalVisible(false)}
      footer={modalFooter}
      width={920}
      destroyOnClose
      centered
    >
        <Form form={form} layout="vertical">
          <Divider>基本信息</Divider>

          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="teacher_id" label="选择老师" 
                initialValue={teachers.length > 0 ? teachers[0].id : undefined}
              >
                <Select placeholder="选择老师" showSearch allowClear
                  filterOption={(input, option) =>
                    String(option?.children ?? '').toLowerCase().includes(input.toLowerCase())
                  }>
                  {teachers.map(teacher => (
                    <Option key={teacher.id} value={teacher.id}>
                      {teacher.name} {teacher.subject && `(${teacher.subject})`}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="year" label="年份">
                <InputNumber min={2020} max={2100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="semester" label="学期">
                <Select placeholder="请选择学期">
                  {semesterOptions.map(s => <Option key={s} value={s}>{s}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="display_name" label="课程名称">
                <Input placeholder="请输入课程名称" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="source_type" label="课程来源">
                <Select placeholder="请选择">
                  <Option value={CourseSourceType.SELF}>自有课程</Option>
                  <Option value={CourseSourceType.INSTITUTION}>机构排课</Option>
                  <Option value={CourseSourceType.MIXED}>混合班</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="institution_id" label="所属机构">
                <Select placeholder={sourceType === CourseSourceType.INSTITUTION || sourceType === CourseSourceType.MIXED ? '请选择机构' : '选择机构排课或混合班后可编辑'}
                  allowClear
                  disabled={sourceType !== CourseSourceType.INSTITUTION && sourceType !== CourseSourceType.MIXED}
                >
                  {institutions.map(inst => (
                    <Option key={inst.id} value={inst.id}>{inst.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="room_id" label="上课地址">
                <Select
                  mode="tags"
                  maxTagCount={1}
                  showSearch
                  allowClear
                  placeholder="选择或输入上课地址"
                  onChange={(values: string[]) => {
                    if (values.length > 1) {
                      const lastVal = values[values.length - 1];
                      form.setFieldsValue({ room_id: [lastVal] });
                    }
                    const lastVal = values[values.length - 1];
                    if (lastVal && !rooms.find(r => r.id === lastVal || r.name === lastVal)) {
                      if (dbService.addOrUpdateRoom) {
                        dbService.addOrUpdateRoom(lastVal);
                        setTimeout(() => setRooms([...(dbService.getAllRooms?.() || [])]), 100);
                      }
                    }
                    // 自动分配课程颜色
                    const color = getColorForRoom(lastVal, rooms);
                    form.setFieldsValue({ color });
                  }}
                  filterOption={(input, option) =>
                    (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={[
                    ...rooms.map(r => ({ label: r.name, value: r.id })),
                    ...rooms.map(r => ({ label: r.name, value: r.name })),
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="type" label="课程类型">
                <Select placeholder="请选择">
                  <Option value={CourseType.ONE_ON_ONE}>一对一</Option>
                  <Option value={CourseType.ONE_ON_TWO}>一对二</Option>
                  <Option value={CourseType.GROUP}>小组课</Option>
                  <Option value={CourseType.LARGE_CLASS}>大班课</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="default_duration_minutes" label="默认时长" initialValue={120}>
                <Select style={{ width: '100%' }} placeholder="拖拽排课时默认使用">
                  {[0.5,1,1.5,2,2.5,3,3.5,4].map(h => (
                    <Option key={h} value={h * 60}>{h}小时</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="active" label="课程状态" initialValue={true}>
                <Select>
                  <Option value={true}>未结课（出现在排课选择中）</Option>
                  <Option value={false}>已结课（不会出现在排课中）</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Divider>学生绑定</Divider>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>
            根据课程类型自动限制学生人数：一对一=1，一对二=2，小组课=最多10，大班课无限制
          </div>

          <Form.List name="student_pricings">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <Row gutter={16} key={key} style={{ alignItems: 'center' }}>
                    <Col span={10}>
                      <Item
                        {...restField}
                        name={[name, 'student_id']}
                        rules={[{ required: true, message: '请选择学生' }]}
                      >
                        <Select placeholder="选择学生" showSearch allowClear
                          filterOption={(input, option) =>
                            String(option?.children ?? '').toLowerCase().includes(input.toLowerCase())
                          }>
                          {students.map(s => (
                            <Option key={s.id} value={s.id}>{s.name}</Option>
                          ))}
                        </Select>
                      </Item>
                    </Col>
                    <Col span={6}>
                      <Item
                        {...restField}
                        name={[name, 'tuition']}
                        rules={[{ required: true, message: '请输入学费' }]} 
                        initialValue={form.getFieldValue('price_tuition') || 0}
                      >
                        <InputNumber min={0} prefix={billingUnit === BillingUnit.PER_HOUR ? '¥/h' : '¥/次'} style={{ width: '100%' }} 
                          onChange={() => {
                            // 延迟计算，等表单值更新后再汇总
                            setTimeout(() => {
                              const pricings = form.getFieldValue('student_pricings') || [];
                              const totalTuition = pricings.reduce((sum: number, p: any) => sum + (p?.tuition || 0), 0);
                              form.setFieldValue('price_tuition', totalTuition);
                            }, 0);
                          }}
                        />
                      </Item>
                    </Col>
                    <Col span={6}>
                      <Item
                        {...restField}
                        name={[name, 'teacher_fee']}
                        initialValue={form.getFieldValue('price_teacher') || 0}
                      >
                        <InputNumber min={0} prefix={billingUnit === BillingUnit.PER_HOUR ? '¥/h' : '¥/次'} style={{ width: '100%' }} 
                          onChange={() => {
                            setTimeout(() => {
                              const pricings = form.getFieldValue('student_pricings') || [];
                              const totalTeacherFee = pricings.reduce((sum: number, p: any) => sum + (p?.teacher_fee || 0), 0);
                              form.setFieldValue('price_teacher', totalTeacherFee);
                            }, 0);
                          }}
                        />
                      </Item>
                    </Col>
                    <Col span={2}>
                      <MinusCircleOutlined onClick={() => remove(name)} />
                    </Col>
                  </Row>
                ))}
                <Row>
                  <Col span={24}>
                    <Button type="dashed" onClick={() => {
                      const type = form.getFieldValue('type');
                      const maxCount = 
                        type === CourseType.ONE_ON_ONE ? 1 :
                        type === CourseType.ONE_ON_TWO ? 2 :
                        type === CourseType.GROUP ? 10 : 999;
                      const currentCount = (form.getFieldValue('student_pricings') || []).length;
                      if (currentCount >= maxCount) {
                        message.warning(`课程类型最多容纳 ${maxCount} 名学生`);
                        return;
                      }
                      add();
                    }} icon={<PlusCircleOutlined />}>
                      添加学生
                    </Button>
                  </Col>
                </Row>
              </>
            )}
          </Form.List>

          <Divider>费用设置</Divider>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="billing_unit" label="计费单位" initialValue={BillingUnit.PER_HOUR}>
                <Select placeholder="请选择">
                  <Option value={BillingUnit.PER_HOUR}>按小时计费</Option>
                  <Option value={BillingUnit.PER_SESSION}>按次课计费</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="teacher_fee_mode" label="课时费计算方式" initialValue={TeacherFeeMode.PER_SESSION}>
                <Select placeholder="请选择">
                  <Option value={TeacherFeeMode.PER_SESSION}>按一次课计算</Option>
                  <Option value={TeacherFeeMode.PER_STUDENT}>按学生分摊</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="price_tuition" label={`学费/${billingUnit === BillingUnit.PER_HOUR ? '小时' : '次'}（自动汇总）`} initialValue={0}>
                <InputNumber min={0} style={{ width: '100%' }} prefix="¥" readOnly />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="price_teacher"
                label={`课时费/${billingUnit === BillingUnit.PER_HOUR ? '小时' : '次'}（自动汇总）${isPureInstitutionCourseDraft ? ' / 纯机构可手填' : ''}`}
                initialValue={0}
              >
                <InputNumber min={0} style={{ width: '100%' }} prefix="¥" readOnly={!canEditCourseTeacherFeeDirectly} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
    </Modal>
    </>
  );
};

export default CourseList;
