import React from 'react';
import { Button, Card, Col, Empty, Row, Space, Statistic, Tag, Typography } from 'antd';
import {
  CalendarOutlined,
  CloudSyncOutlined,
  DatabaseOutlined,
  DollarOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { PageKey } from '../navigation/appNavigation';
import QuestionIssueQueue, { QuestionIssue } from '../components/question-bank/QuestionIssueQueue';

interface TodayWorkbenchProps {
  onNavigate: (page: PageKey) => void;
}

const questionIssues: QuestionIssue[] = [];

const TodayWorkbench: React.FC<TodayWorkbenchProps> = ({ onNavigate }) => {
  return (
    <div className="today-workbench">
      <Row gutter={[12, 12]} className="today-workbench__metrics">
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="今日课程" value={0} prefix={<CalendarOutlined />} suffix="节" />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="待核对费用" value={0} prefix={<DollarOutlined />} suffix="项" />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="问题试题" value={questionIssues.length} prefix={<DatabaseOutlined />} suffix="道" />
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
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无今日课程数据" />
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card
            size="small"
            title="题库问题"
            extra={<Tag color={questionIssues.length > 0 ? 'warning' : 'default'}>{questionIssues.length} 道</Tag>}
          >
            <QuestionIssueQueue
              issues={questionIssues}
              onEdit={() => onNavigate('question-bank-preview')}
            />
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
