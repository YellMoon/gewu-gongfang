import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Progress } from 'antd';
import { UserOutlined, BookOutlined, CalendarOutlined, DollarOutlined } from '@ant-design/icons';

const Dashboard: React.FC = () => {
  const [overview, setOverview] = useState({
    studentCount: 0,
    courseCount: 0,
    scheduleCount: 0,
    revenue: 0
  });
  const dbService = (window as any).dbService;

  const loadOverview = async () => {
    const students = dbService.getAllStudents();
    const courses = dbService.getAllCourses();
    const schedules = dbService.getAllSchedules();
    
    setOverview({
      studentCount: students.length,
      courseCount: courses.length,
      scheduleCount: schedules.length,
      revenue: 0 // TODO: 计算总收入
    });
  };

  useEffect(() => {
    loadOverview();
  }, []);

  return (
    <div>
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic 
              title="学生总数" 
              value={overview.studentCount} 
              prefix={<UserOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic 
              title="课程总数" 
              value={overview.courseCount} 
              prefix={<BookOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic 
              title="排课数量" 
              value={overview.scheduleCount} 
              prefix={<CalendarOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic 
              title="本月收入" 
              value={overview.revenue} 
              prefix="¥"
              precision={2}
              valueStyle={{ color: '#f5222d' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="快速开始" style={{ marginTop: 16 }}>
        <div style={{ color: '#666' }}>
          <p>👋 欢迎使用排课管理系统！</p>
          <p>建议操作顺序：</p>
          <ol>
            <li>在「学生管理」中添加学生信息</li>
            <li>在「课程管理」中设置课程类型和价格</li>
            <li>在「排课系统」中安排课程时间</li>
            <li>在「财务管理」中记录缴费和课时消耗</li>
          </ol>
        </div>
      </Card>
    </div>
  );
};

export default Dashboard;
