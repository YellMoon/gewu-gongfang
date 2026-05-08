import React, { useState, useEffect } from 'react';
import { Card, Table, Statistic, Row, Col, DatePicker, Button, Select, Space } from 'antd';
import { MoneyCollectOutlined, BookOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { RangePickerProps } from 'antd/es/date-picker';

const { RangePicker } = DatePicker;

const FinanceStats: React.FC = () => {
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().startOf('month'),
    dayjs().endOf('month')
  ]);
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalHours: 0,
    totalConsumption: 0,
    paymentCount: 0
  });
  const dbService = (window as any).dbService;

  const loadStats = async () => {
    const startDate = dateRange[0].format('YYYY-MM-DD');
    const endDate = dateRange[1].format('YYYY-MM-DD');
    
    const revenueStats = dbService.getRevenueStats(startDate, endDate);
    const consumptionStats = dbService.getConsumptionStats(startDate, endDate);
    
    setStats({
      totalRevenue: revenueStats.total_revenue || 0,
      paymentCount: revenueStats.payment_count || 0,
      totalHours: consumptionStats.total_hours || 0,
      totalConsumption: consumptionStats.total_amount || 0,
    });
  };

  useEffect(() => {
    loadStats();
  }, [dateRange]);

  const onDateRangeChange: RangePickerProps['onChange'] = (dates) => {
    if (dates && dates[0] && dates[1]) {
      setDateRange([dates[0] as dayjs.Dayjs, dates[1] as dayjs.Dayjs]);
    }
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col>
            <Space>
              <span>统计范围：</span>
              <RangePicker 
                value={dateRange}
                onChange={onDateRangeChange}
                allowClear={false}
              />
            </Space>
          </Col>
          <Col push={12}>
            <Button onClick={loadStats}>刷新统计</Button>
          </Col>
        </Row>
      </Card>

      <Row gutter={16}>
        <Col span={8}>
          <Card>
            <Statistic 
              title="总收入" 
              value={stats.totalRevenue} 
              precision={2}
              prefix="¥"
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic 
              title="总课时消耗" 
              value={stats.totalHours} 
              precision={1}
              suffix="课时"
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic 
              title="课时费总额" 
              value={stats.totalConsumption} 
              precision={2}
              prefix="¥"
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="收支明细" style={{ marginTop: 16 }}>
        <Table
          columns={[
            { title: '日期', dataIndex: 'date', key: 'date' },
            { title: '类型', dataIndex: 'type', key: 'type' },
            { title: '学生', dataIndex: 'student', key: 'student' },
            { title: '金额', dataIndex: 'amount', key: 'amount' },
            { title: '备注', dataIndex: 'notes', key: 'notes' },
          ]}
          dataSource={[]}
          locale={{ emptyText: '功能开发中...' }}
        />
      </Card>
    </div>
  );
};

export default FinanceStats;
