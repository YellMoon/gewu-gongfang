import React from 'react';
import { Alert, Button, Empty, List, Popconfirm, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons';

export type QuestionIssue = {
  id: string;
  title: string;
  subject?: string;
  reason: string;
  updatedAt?: string;
};

interface QuestionIssueQueueProps {
  issues: QuestionIssue[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}

const QuestionIssueQueue: React.FC<QuestionIssueQueueProps> = ({ issues, onEdit, onDelete }) => {
  if (issues.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待处理问题试题" />;
  }

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Alert
        type="warning"
        showIcon
        message={`有 ${issues.length} 道问题试题待处理`}
        description="请优先核对题干、答案、解析或学科归类异常的试题。"
      />
      <List
        size="small"
        dataSource={issues}
        pagination={{ pageSize: 8, hideOnSinglePage: true }}
        rowKey="id"
        renderItem={(issue) => (
          <List.Item
            actions={[
              <Button
                key="edit"
                size="small"
                type="link"
                icon={<EditOutlined />}
                onClick={() => onEdit(issue.id)}
              >
                编辑
              </Button>,
              <Popconfirm key="delete" title="确定删除这道问题试题？" okText="删除" cancelText="取消" onConfirm={() => onDelete(issue.id)}>
                <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={
                <Space size={6} wrap>
                  <Typography.Text type="secondary">{issues.findIndex(row => row.id === issue.id) + 1}.</Typography.Text>
                  <Typography.Text strong>{issue.title}</Typography.Text>
                  {issue.subject ? <Tag color="blue">{issue.subject}</Tag> : null}
                </Space>
              }
              description={
                <Space size={8} wrap>
                  <Typography.Text type="secondary">{issue.reason}</Typography.Text>
                  {issue.updatedAt ? <Typography.Text type="secondary">{issue.updatedAt}</Typography.Text> : null}
                </Space>
              }
            />
          </List.Item>
        )}
      />
    </Space>
  );
};

export default QuestionIssueQueue;
