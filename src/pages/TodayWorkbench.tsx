import React from 'react';
import { Button, Card, Col, Row, Space, Statistic, Tag, Typography } from 'antd';
import {
  CalendarOutlined,
  CloudSyncOutlined,
  DatabaseOutlined,
  DollarOutlined,
  FileTextOutlined,
  ToolOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { PageKey } from '../navigation/appNavigation';

interface TodayWorkbenchProps {
  onNavigate: (page: PageKey) => void;
}

const TodayWorkbench: React.FC<TodayWorkbenchProps> = ({ onNavigate }) => {
  const handleQuestionIssueEdit = (_id: string) => {
    onNavigate('question-bank-edit');
  };

  return (
    <div className="today-workbench">
      <Card size="small" title="今日工作台" className="today-workbench__quick-card">
        <div className="today-workbench__quick-actions">
          <Button type="primary" icon={<CalendarOutlined />} onClick={() => onNavigate('course-calendar')}>
            查看课程表
          </Button>
          <Button icon={<FileTextOutlined />} onClick={() => onNavigate('schedule-list')}>
            排课列表
          </Button>
          <Button icon={<ToolOutlined />} onClick={() => onNavigate('question-bank-tools')}>
            题库工具
          </Button>
          <Button icon={<DollarOutlined />} onClick={() => onNavigate('payment')}>
            缴费管理
          </Button>
        </div>
      </Card>

      <Row gutter={[12, 12]} className="today-workbench__metrics">
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="今日课程" value="进入查看" prefix={<CalendarOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="待核对费用" value="待查看" prefix={<DollarOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="问题试题" value="进入查看" prefix={<DatabaseOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="同步状态" value="待查看" prefix={<CloudSyncOutlined />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={12}>
          <Card
            size="small"
            title="今日课程"
            extra={
              <Button size="small" type="link" onClick={() => onNavigate('course-calendar')}>
                课程表 <RightOutlined />
              </Button>
            }
          >
            <Space direction="vertical" size={10} className="today-workbench__card-body">
              <Typography.Text type="secondary">
                今日课程需要进入课程表按日期查看和维护。
              </Typography.Text>
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card
            size="small"
            title="题库问题"
            extra={<Tag color="default">进入题库查看</Tag>}
          >
            <Space direction="vertical" size={10} className="today-workbench__card-body">
              <Typography.Text type="secondary">
                问题试题队列尚未接入持久化统计，请进入题库工具或试题编辑查看和处理。
              </Typography.Text>
              <Space size={8} wrap>
                <Button size="small" onClick={() => onNavigate('question-bank-tools')}>
                  题库工具
                </Button>
                <Button size="small" type="primary" onClick={() => handleQuestionIssueEdit('today-entry')}>
                  试题编辑
                </Button>
              </Space>
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card
            size="small"
            title="费用核对"
            extra={
              <Button size="small" type="link" onClick={() => onNavigate('revenue-statistics')}>
                费用统计 <RightOutlined />
              </Button>
            }
          >
            <Space direction="vertical" size={10} className="today-workbench__card-body">
              <Typography.Text type="secondary">
                统计基于每条排课明细计算，仅纳入正常出勤记录；请在费用统计中核对异常或待确认数据。
              </Typography.Text>
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card
            size="small"
            title="最近导入与同步"
            extra={
              <Button size="small" type="link" onClick={() => onNavigate('cloud-sync')}>
                云同步 <RightOutlined />
              </Button>
            }
          >
            <Space direction="vertical" size={10} className="today-workbench__card-body">
              <Typography.Text type="secondary">
                查看最近导入、上传和下载任务的同步状态，必要时进入云同步处理。
              </Typography.Text>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default TodayWorkbench;
